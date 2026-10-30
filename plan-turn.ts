import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { BoundaryResult } from "@earendil-works/pi-coding-agent";
import type { AdvisorOutcome, AdvisorResolution } from "./advisor";

/**
 * plan-turn.ts — the advisor gate's decision cores, extracted from index.ts.
 *
 * The turn_end decision splits around the single await: everything before runAdvisor is
 * planGate, everything after it is planCommit. Both are pure, and every sibling
 * capability arrives as an injected thunk, so this module has ZERO runtime imports —
 * no package resolves at runtime and no sibling is imported at runtime. The three
 * imports above are TYPE-only, so they are erased before the module runs under plain
 * node and under pi's jiti alike (precedents: index.ts:1, prompt.ts:1). The offline
 * suite imports this file directly, which is the point of the extraction: the decision
 * logic of index.ts becomes testable without loading index.ts.
 *
 * Laziness is part of the contract. Every early-out returns BEFORE any thunk runs, so
 * an off-cadence turn pays for no child scan, no parse, no resolve — the exact
 * short-circuit economics of the pre-extraction index.ts.
 */

/** One committed guidance entry plus the forced continuation. */
export function buildCorrection(
  customType: string,
  text: string,
  display: boolean,
  peerEntries: BoundaryResult["entries"],
): BoundaryResult {
  return {
    // The spread is mandatory. emitBoundary REPLACES the accumulator
    // (runner.js:775-776), so a returned array that omits event.entries discards
    // every peer draft — five other packages already register turn_end.
    entries: [
      ...(peerEntries ?? []),
      { type: "custom_message", customType, content: text, display },
    ],
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
  // Injected siblings, pre-bound at the seam. None runs past an early-out.
  gates: (turnIndex: number, interval: number) => boolean;
  isChild: () => boolean;
  parseModel: () => { provider: string; modelId: string } | undefined;
  resolve: (provider: string, modelId: string) => AdvisorResolution;
  buildMessages: (messages: Message[]) => Message[];
}

/**
 * Decide whether the just-finished turn owes the advisor a call.
 *
 * The arm order pins the pre-extraction semantics: disabled, no model, off cadence,
 * errored turn, child session, unparseable model — every arm silent except the
 * resolution failure, which reports through the notify arm in the exact reportFailure
 * format the old index.ts:70 produced.
 */
export function planGate(args: PlanGateArgs): GateDecision {
  if (!args.enabled) return { action: "skip", reason: "the gate is disabled" };
  if (!args.model) return { action: "skip", reason: "no model configured" };
  // Cadence. The modulo form is required: a threshold form such as
  // `turnIndex >= interval` latches and fires on every later turn.
  if (!args.gates(args.turnIndex, args.interval)) {
    return { action: "skip", reason: "off cadence" };
  }
  // An aborted or errored turn has no work worth reviewing.
  if (args.outcome !== "completed") return { action: "skip", reason: `turn ${args.outcome}` };
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
    result: buildCorrection(args.customType, stripped, args.display, args.peerEntries),
  };
}
