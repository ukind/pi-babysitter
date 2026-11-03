import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { BoundaryResult } from "@earendil-works/pi-coding-agent";
import type { AdvisorOutcome, AdvisorResolution } from "./advisor";
import type { TriggerDecision } from "./triggers";

/** The advice draft both commit paths build (blocking turn_end, async settle). */
function buildAdviceDraft(
  customType: string,
  text: string,
  display: boolean,
  details?: AdvisorEntryDetails,
) {
  return {
    type: "custom_message" as const,
    customType,
    content: text,
    display,
    // The conditional spread is load-bearing: a literal details: undefined
    // would still create the key, and t24 pins its absence for the
    // unstamped shape.
    ...(details === undefined ? {} : { details }),
  };
}

/**
 * One committed guidance entry plus the forced continuation.
 *
 * The optional details stamp (FR1) rides the draft verbatim: the host stores it as
 * extension-specific metadata (session-manager.d.ts:103 "not sent to LLM") while the
 * content itself replays into later context as a user message — the dialogue is the
 * host's own re-projection, and the stamp only makes each entry machine-identifiable.
 * An absent stamp leaves the draft WITHOUT a details key: the pre-FR1 byte shape, so
 * entries from both sides of the upgrade coexist in one session file.
 */
export function buildCorrection(
  customType: string,
  text: string,
  display: boolean,
  peerEntries: BoundaryResult["entries"],
  details?: AdvisorEntryDetails,
): BoundaryResult {
  return {
    // The spread is mandatory. emitBoundary REPLACES the accumulator
    // (runner.js:775-776), so a returned array that omits event.entries discards
    // every peer draft — five other packages already register turn_end.
    entries: [...(peerEntries ?? []), buildAdviceDraft(customType, text, display, details)],
    continue: true,
  };
}

/** What planGate tells the seam to do. */
export type GateDecision =
  | { action: "skip"; reason: string }
  | { action: "notify"; message: string }
  | {
      action: "consult";
      model: Model<Api>;
      systemPrompt: string;
      messages: Message[];
      timeoutMs: number;
    };

/** The plain boundary data plus the injected sibling thunks planGate reads. */
export interface PlanGateArgs {
  // Plain data: read once per dispatch at the seam, no I/O in here.
  enabled: boolean;
  model: string;
  interval: number;
  systemPrompt: string;
  timeoutMs: number;
  turnIndex: number;
  outcome: string;
  llmMessages: Message[];
  // The turn the gate last fired on (F007). The factory starts it at -1, so the first
  // fire lands on turn interval - 1 (0-based) — exact parity with the modulo sequence.
  lastFiredTurn: number;
  // Injected siblings, pre-bound at the seam. None runs past an early-out.
  gates: (turnIndex: number, interval: number, lastFiredTurn: number) => boolean;
  isChild: () => boolean;
  parseModel: () => { provider: string; modelId: string } | undefined;
  resolve: (provider: string, modelId: string) => AdvisorResolution;
  buildMessages: (messages: Message[]) => Message[];
  // FR3 trigger thunk, pre-bound with signals and thresholds at the seam. Absent
  // when no threshold is armed, so an unarmed config pays nothing. Runs ONLY on a
  // cadence miss: an on-cadence turn evaluates no signals (the cadence answer
  // already fires the gate).
  trigger?: () => TriggerDecision;
  // Invoked exactly once per gate-pass: after the completed check, before the vetoes.
  // The seam owns the single lastFiredTurn write; this core stays pure.
  markFired: (turnIndex: number) => void;
}

/**
 * Decide whether the just-finished turn owes the advisor a call.
 *
 * The arm order pins the pre-extraction semantics: disabled, no model, off cadence,
 * errored turn, child session, unparseable model — every arm silent except the
 * resolution failure, which reports through the notify arm in the exact reportFailure
 * format the old index.ts:70 produced. The F007 mark runs at gate-pass, after the
 * completed check and before the vetoes: an errored boundary does not spend its slot,
 * a vetoed one does.
 */
export function planGate(args: PlanGateArgs): GateDecision {
  if (!args.enabled) return { action: "skip", reason: "the gate is disabled" };
  if (!args.model) return { action: "skip", reason: "no model configured" };
  // FR3 trigger arms. Cadence stays the primary clock: an on-cadence turn pays
  // nothing for signal evaluation (the trigger thunk runs only on a cadence
  // miss), and an unarmed config passes no thunk at all. Either arm passes the
  // SAME gate-pass — the outcome check and markFired below run identically — so
  // the latch spends exactly once per fire no matter which arm passed. The
  // none-literal is inlined because a VALUE sibling import would break the
  // zero-runtime-import contract this module documents.
  const notTriggered: TriggerDecision = { action: "none", reason: "no signal" };
  const cadenceDue = args.gates(args.turnIndex, args.interval, args.lastFiredTurn);
  const triggered = !cadenceDue && args.trigger ? args.trigger() : notTriggered;
  if (!cadenceDue && triggered.action !== "fire") {
    return { action: "skip", reason: "off cadence" };
  }
  // An aborted or errored turn has no work worth reviewing — UNLESS the error IS
  // the trigger (triggerOnError): then the trouble is the signal and the fire
  // bypasses this veto. Cadence fires never bypass it, so the F007 slide is
  // untouched: a cadence-due errored turn still skips without spending its slot.
  // Aborted turns never fire: no trigger signal covers them.
  const errorTriggered = triggered.action === "fire" && triggered.signal === "error";
  if (args.outcome !== "completed" && !errorTriggered) {
    return { action: "skip", reason: `turn ${args.outcome}` };
  }
  // Gate-pass. Record the fire BEFORE the vetoes, so a vetoed boundary spends its slot
  // and retries stay bounded to one per interval — a commit-time update would
  // re-attempt a broken registry on every later turn.
  args.markFired(args.turnIndex);
  // The authoritative veto.
  if (args.isChild()) return { action: "skip", reason: "child session" };
  const parsed = args.parseModel();
  // config.ts already dropped an unparseable model (with a warn) at load, so this is a
  // safety net: fail-open SILENTLY, reporting nothing (pins index.ts:65-66).
  if (!parsed) return { action: "skip", reason: "unparseable model" };
  const resolution = args.resolve(parsed.provider, parsed.modelId);
  if (!resolution.ok) {
    return { action: "notify", message: `advisor-turn-gate: ${resolution.reason}` };
  }
  return {
    action: "consult",
    model: resolution.model,
    systemPrompt: args.systemPrompt,
    messages: args.buildMessages(args.llmMessages),
    timeoutMs: args.timeoutMs,
  };
}

/** What planCommit tells the seam to do. */
export type CommitDecision =
  | { action: "notify"; message: string }
  | { action: "commit"; result: BoundaryResult };

/** The advisor outcome plus the injected shaper planCommit reads. */
export interface PlanCommitArgs {
  outcome: AdvisorOutcome;
  customType: string;
  display: boolean;
  peerEntries: BoundaryResult["entries"];
  strip: (text: string) => string;
  // FR1 dialogue stamp, pre-built by the seam with stampDetails. Absent means
  // unstamped; both notify arms ignore it.
  details?: AdvisorEntryDetails;
}

/**
 * Turn the advisor outcome into either a report or the committed correction.
 *
 * Both failure arms notify in the exact reportFailure formats the pre-extraction
 * index.ts used (:84 and :93); the commit arm assembles the accumulator spread through
 * buildCorrection.
 */
export function planCommit(args: PlanCommitArgs): CommitDecision {
  if (!args.outcome.ok) {
    // Fail-open: no entries, no continuation. The loop still schedules.
    return { action: "notify", message: `advisor-turn-gate: ${args.outcome.reason}` };
  }
  // The strip is the last filter before the durable transcript. A reply that is
  // nothing but markup strips to "" — committing an empty entry would be worse
  // than committing nothing, so the husk fails open like every other path.
  const stripped = args.strip(args.outcome.text);
  if (!stripped) {
    return { action: "notify", message: "advisor-turn-gate: advisor reply was markup only" };
  }
  return {
    action: "commit",
    result: buildCorrection(
      args.customType,
      stripped,
      args.display,
      args.peerEntries,
      args.details,
    ),
  };
}

/** What planHostSupport tells the seam about the running host. */
export type HostSupport = { supported: true } | { supported: false; message: string };

/**
 * Feature-detect the 1.4 boundary surface from the first turn_end event.
 *
 * The 0.79.x host dispatches turn_end as a bare emit with no outcome and no
 * context (agent-session.js:375-384); under it planGate would skip every fire
 * silently. The version number itself is not on the extension context, and a
 * hardcoded package read would be a second fragile reach like F008, so the
 * detect reads the event fields the gate actually needs.
 */
export function planHostSupport(outcome: unknown, context: unknown): HostSupport {
  if (typeof outcome === "string" && context !== null && typeof context === "object") {
    return { supported: true };
  }
  return {
    supported: false,
    message:
      "advisor-turn-gate: host boundary events predate 1.4; " +
      "the gate is disabled until the host is upgraded",
  };
}

/** The stable keys every committed advisor entry carries (FR1). */
export interface AdvisorEntryDetails {
  /** 1-based ordinal of the fire that produced the entry; the seam counts commits. */
  fire: string;
  /** The turnIndex the fire landed on. */
  turn: string;
}

/**
 * The details stamp for fire number fire (1-based) on turn turnIndex.
 *
 * The single source of the key names: the seam, Slice 7's settle lookup, and the
 * eval fixtures all read entries through these two keys, and t24 pins them, so a
 * seam-side rename cannot ship silently. The values are strings for stable JSON
 * round-trips and greppable session files.
 */
export function stampDetails(fire: number, turnIndex: number): AdvisorEntryDetails {
  return { fire: String(fire), turn: String(turnIndex) };
}

/** One completed async advisor call waiting for its settle commit (FR8). */
export interface HeldAdvice {
  /** The advisor outcome, exactly as runAdvisor resolved it. */
  outcome: AdvisorOutcome;
  /** The turnIndex captured at fire time; the settle event carries none. */
  turnIndex: number;
}

/** What planSettle tells the seam to do at agent_before_settle. */
export type SettleDecision =
  | { action: "abstain" }
  | { action: "notify"; message: string }
  | { action: "commit"; result: BoundaryResult };

/** The held advice plus the injected shapers planSettle reads. */
export interface PlanSettleArgs {
  held: HeldAdvice | undefined;
  customType: string;
  display: boolean;
  peerEntries: BoundaryResult["entries"];
  strip: (text: string) => string;
  details: AdvisorEntryDetails;
}

/**
 * Turn one held async advisor outcome into the once-only settle decision.
 *
 * The abstain arm is the every-settle common case: an async-off session holds
 * nothing and decides nothing. The notify arms reuse the exact reportFailure
 * formats the blocking path pins. The commit arm spreads the SETTLE event's own
 * accumulator and deliberately omits the continue key: a truthy result.continue
 * at agent_before_settle makes the host ensure one next provider request
 * (agent-session.js:1578-1584), which would wake an idle agent — FR8 forbids
 * that. The draft is byte-identical to the blocking draft (shared builder); only
 * the continue key differs.
 */
export function planSettle(args: PlanSettleArgs): SettleDecision {
  if (!args.held) return { action: "abstain" };
  if (!args.held.outcome.ok) {
    return { action: "notify", message: `advisor-turn-gate: ${args.held.outcome.reason}` };
  }
  const stripped = args.strip(args.held.outcome.text);
  if (!stripped) {
    return { action: "notify", message: "advisor-turn-gate: advisor reply was markup only" };
  }
  return {
    action: "commit",
    result: {
      entries: [
        ...(args.peerEntries ?? []),
        buildAdviceDraft(args.customType, stripped, args.display, args.details),
      ],
      // NO continue: the settle path never wakes an idle agent (FR8).
    },
  };
}
