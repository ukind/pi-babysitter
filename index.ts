import type { BoundaryResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SpecialistConfig } from "./advisor";
import { resolveAdvisorModel, runAdvisor, stripAdvisorMarkup } from "./advisor";
import { loadConfig, parseModelKey, shouldFire } from "./config";
import { isChildSession } from "./guard";
import { digestMessage, projectKeyFor, readEntries, recordAdvice } from "./memory";
import type { HeldAdvice } from "./plan-turn";
import { planCommit, planGate, planHostSupport, planSettle, stampDetails } from "./plan-turn";
import { buildAdvisorMessages } from "./prompt";
import { reportFailure } from "./report";
import { createSandbox, READ_FILE_TOOL, SANDBOX_MAX_BYTES } from "./sandbox";
import { parseRiskyTools, planTrigger, triggersArmed } from "./triggers";

/**
 * index.ts — the advisor gate's wiring.
 *
 * The only file the runtime loads. Auto-discovered as a folder entry
 * (package-manager.js:440-444 → resolveExtensionEntries:381-406, which prefers a
 * package.json manifest, then index.ts, then index.js). No settings.json edit.
 *
 * The decision logic is pure and lives in plan-turn.ts; this file owns I/O only: the
 * config read, the registry-bound thunks, the single advisor await, and reporting.
 *
 * Sibling imports are extensionless, the form `simple-english/index.ts:16` proves under
 * pi's per-extension jiti. The alias map at loader.js:37-88 holds only bare package
 * specifiers, so relative specifiers resolve against the importing file untouched.
 *
 * The pi-coding-agent import is TYPE-only, so it is erased before the module runs.
 */

export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
  // F007: the cadence latch lives in the factory closure, so the seam owns the single
  // write and the pure core stays pure. A pi reload re-runs this factory while
  // turnIndex keeps climbing: the reset latch puts the threshold in the past, so the
  // next completed turn fires EARLY (up to interval-1 turns) and cadence re-locks
  // after that one fire. Reload may fire early; it never skips.
  let lastFiredTurn = -1;

  // The 1.4 boundary check runs at most once per process, and only when the gate
  // would actually run (enabled with a model): a deliberately disabled gate on an
  // old host must not warn about a problem it never intended to hit.
  let hostChecked = false;
  let hostSupported = true;

  // FR1: the dialogue counter. It advances ONLY when a commit lands, so the
  // stamped ordinals stay dense: entry k carries fire k. A vetoed gate-pass or
  // a failed advisor call burns no ordinal (unlike the latch, this is identity,
  // not rate control — the F007 spend-early rule does not apply).
  let fireCount = 0;

  // FR8: the async fire slots. advisorInFlight guards ONE detached call at a time;
  // heldAdvice holds ONE completed call awaiting its settle commit. Two slots,
  // never one: a completed-but-uncommitted result must survive a new call
  // STARTING, so a gate-pass while EITHER slot is busy is a consumed fire (the
  // latch already spent — F007), never a queue and never an overwrite.
  let advisorInFlight = false;
  let heldAdvice: HeldAdvice | undefined;

  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
    // Config is read per dispatch, not once at factory time, so interval and model
    // can be retuned without a reload.
    const config = loadConfig();

    if (!hostChecked && config.enabled && config.model) {
      hostChecked = true;
      const support = planHostSupport(event.outcome, event.context);
      if (!support.supported) {
        hostSupported = false;
        reportFailure(ctx, support.message);
      }
    }
    if (!hostSupported) return;

    // The decision cores are pure (plan-turn.ts); this handler owns I/O only. The
    // thunks keep the pre-extraction laziness: planGate runs none of them past an
    // early-out, so an off-cadence turn pays for no scan, parse, resolve, or mark.
    const thresholds = {
      minNewTokens: config.triggerMinNewTokens,
      contextPercent: config.triggerContextPercent,
      onError: config.triggerOnError,
      riskyTools: parseRiskyTools(config.triggerRiskyTools),
    };

    const gate = planGate({
      enabled: config.enabled,
      model: config.model,
      interval: config.interval,
      systemPrompt: config.systemPrompt,
      timeoutMs: config.timeoutMs,
      turnIndex: event.turnIndex,
      outcome: event.outcome,
      llmMessages: event.context.llmMessages,
      lastFiredTurn,
      gates: shouldFire,
      isChild: () => isChildSession(event.context.llmMessages),
      parseModel: () => parseModelKey(config.model),
      resolve: (provider, modelId) => resolveAdvisorModel(ctx.modelRegistry, provider, modelId),
      // FR7: the budget binds per dispatch like everything else, so retuning it needs
      // no reload. The 0 default keeps the fold an identity and the payload identical
      // to the pre-FR7 shape (t10 pins that one-arg call form).
      // FR2: the digest read rides the same thunk, so the store I/O also pays only on
      // a fire — the same laziness that keeps an off-cadence turn free. An empty
      // store (or a cap of 0) passes no digest and the payload stays byte-identical.
      buildMessages: (messages) => {
        const digest =
          config.memoryCap > 0
            ? digestMessage(readEntries(projectKeyFor(process.cwd())), Date.now())
            : undefined;
        return buildAdvisorMessages(messages, config.tokenBudget, digest);
      },
      // FR3: the trigger thunk closes over this turn's event and the context.
      // Signals read defensively so a partially-shaped event degrades to nulls,
      // never to a throw; the thunk itself runs only on a cadence miss.
      trigger: triggersArmed(thresholds)
        ? () =>
            planTrigger(
              {
                // usage.output is what this turn added to the conversation; totalTokens
                // is request size (input context plus output) and would fire every turn.
                turnTokens:
                  (event.message as { usage?: { output?: number } } | undefined)?.usage?.output ??
                  null,
                contextPercent: ctx.getContextUsage?.()?.percent ?? null,
                outcome: typeof event.outcome === "string" ? event.outcome : "",
                toolNames: (event.toolResults ?? []).map((result) => result.toolName),
              },
              thresholds,
            )
        : undefined,
      // The single lastFiredTurn write in the codebase. planGate invokes this at
      // gate-pass — after the completed check, before the vetoes — so an errored
      // boundary does not spend its slot and a vetoed one does.
      markFired: (turnIndex) => {
        lastFiredTurn = turnIndex;
      },
    });

    if (gate.action === "skip") return;
    if (gate.action === "notify") {
      reportFailure(ctx, gate.message);
      return;
    }

    // The single await splits the decision: everything before it is planGate, the
    // advisor call is I/O, everything after it is planCommit.
    // FR6: resolve the specialist at fire time, only when a model is configured.
    // parseModelKey and resolveAdvisorModel never throw; their reason strings are
    // pinned at t8 and t13. A failed parse or resolution passes no specialist, so
    // the fire commits base-only advice — the consult is an upgrade, never a
    // dependency, and its absence stays silent (the pre-FR6 shape).
    let specialist: SpecialistConfig | undefined;
    if (config.specialistModel) {
      const parsedSpecialist = parseModelKey(config.specialistModel);
      if (parsedSpecialist) {
        const specialistResolution = resolveAdvisorModel(
          ctx.modelRegistry,
          parsedSpecialist.provider,
          parsedSpecialist.modelId,
        );
        if (specialistResolution.ok) {
          specialist = {
            model: specialistResolution.model,
            systemPrompt: config.specialistSystemPrompt,
          };
        }
      }
    }

    // One args literal serves both fire modes: the branch below decides only HOW
    // the call runs, never what it sends. ctx.signal rides both modes: a mid-run
    // fire detaches while the run continues, so a user abort still kills the
    // detached call (it fails open into the held slot); at natural completion no
    // abort fires and the deadline is the bound.
    const advisorArgs = {
      registry: ctx.modelRegistry,
      model: gate.model,
      systemPrompt: gate.systemPrompt,
      messages: gate.messages,
      timeoutMs: gate.timeoutMs,
      signal: ctx.signal,
      // FR4: the sandbox arms only when the config turns it on. An off config
      // passes no tools and no executor, so the call is byte-identical to the
      // pre-FR4 single shot (the existing suite pins it untouched).
      tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined,
      executeTool: config.toolsEnabled
        ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES)
        : undefined,
      maxToolRounds: config.maxToolRounds,
      // FR6: undefined when unconfigured or unresolved — the consult stays undeclared.
      specialist,
    };

    // FR8: async mode abstains. The advisor call detaches under the SAME deadline;
    // the resolved outcome is held for the settle handler. turn_end returns
    // undefined, so emitBoundary keeps every peer draft and forces no
    // continuation — and the latch already spent at gate-pass, so this fire does
    // not retry (F007).
    if (config.asyncMode) {
      // Load-bearing BOTH-slot guard (the slice-verifier blocker): a call that
      // starts while heldAdvice is occupied would resolve into a full slot and
      // silently overwrite the held outcome (reachable at interval 1 inside one
      // multi-turn run, where settle fires only at run end). Testing heldAdvice
      // too makes the write in .then safe by construction: exactly one call is
      // ever in flight, so exactly one .then can ever write the slot.
      if (advisorInFlight || heldAdvice) return;
      const fireTurn = event.turnIndex;
      advisorInFlight = true;
      void runAdvisor(advisorArgs)
        .then((outcome) => {
          advisorInFlight = false;
          heldAdvice = { outcome, turnIndex: fireTurn };
          // FR2: the async fire records its advice exactly like the blocking
          // path (Region H): after a successful call, before its commit — which
          // here lands at settle. The fire-time config governs, and the text
          // gets the same strip the commit gets. recordAdvice never throws.
          if (outcome.ok && config.memoryCap > 0) {
            recordAdvice(
              projectKeyFor(process.cwd()),
              stripAdvisorMarkup(outcome.text),
              config.memoryCap,
              Date.now(),
            );
          }
        })
        .catch(() => {
          // Unreachable while runAdvisor honors its never-throw contract; kept so
          // a contract violation can never surface as an unhandled rejection.
          advisorInFlight = false;
          heldAdvice = {
            outcome: { ok: false, reason: "async advisor call threw" },
            turnIndex: fireTurn,
          };
        });
      return;
    }

    // Blocking mode: THE single await (the pre-FR8 shape, byte-identical payload).
    const outcome = await runAdvisor(advisorArgs);

    // FR2: record THIS fire's advice after a successful call, before the commit.
    // The text gets the same strip the commit gets, so the digest channel carries
    // no fake-markup vocabulary back into a later fire's context. recordAdvice
    // never throws; a failed write costs the next fire its digest, never the
    // current entry.
    if (outcome.ok && config.memoryCap > 0) {
      recordAdvice(
        projectKeyFor(process.cwd()),
        stripAdvisorMarkup(outcome.text),
        config.memoryCap,
        Date.now(),
      );
    }

    const commit = planCommit({
      outcome,
      customType: config.customType,
      display: config.display,
      peerEntries: event.entries,
      strip: stripAdvisorMarkup,
      // FR1: the dialogue stamp. fireCount + 1 is the ordinal THIS commit would
      // earn; the counter advances below only when the commit actually lands.
      details: stampDetails(fireCount + 1, event.turnIndex),
    });

    if (commit.action === "notify") {
      reportFailure(ctx, commit.message);
      return;
    }
    // FR1: the ordinal advances only on a landed commit, so stamped fires stay
    // dense: entry k carries fire k. Notify arms (advisor error, markup husk)
    // burn no ordinal.
    fireCount += 1;
    return commit.result;
  });

  // FR8: the once-only settle commit. The slot clears BEFORE anything else, so a
  // surprise can never double-commit. Config is read only when advice is held, so
  // an async-off session pays nothing per settle. The 1.4 host-support guard needs
  // no repeat here: heldAdvice only fills behind the turn_end guard, so an
  // unsupported host never has advice to commit.
  pi.on("agent_before_settle", (event, ctx) => {
    const held = heldAdvice;
    if (!held) return;
    heldAdvice = undefined;
    const config = loadConfig();
    const settle = planSettle({
      held,
      customType: config.customType,
      display: config.display,
      peerEntries: event.entries,
      strip: stripAdvisorMarkup,
      details: stampDetails(fireCount + 1, held.turnIndex),
    });
    if (settle.action === "abstain") return;
    if (settle.action === "notify") {
      reportFailure(ctx, settle.message);
      return;
    }
    fireCount += 1;
    return settle.result;
  });
}
