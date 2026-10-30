import type { BoundaryResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveAdvisorModel, runAdvisor, stripAdvisorMarkup } from "./advisor";
import { loadConfig, parseModelKey, shouldGate } from "./config";
import { isChildSession } from "./guard";
import { planCommit, planGate } from "./plan-turn";
import { buildAdvisorMessages } from "./prompt";
import { reportFailure } from "./report";

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
  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
    // Config is read per dispatch, not once at factory time, so interval and model
    // can be retuned without a reload.
    const config = loadConfig();

    // The decision cores are pure (plan-turn.ts); this handler owns I/O only. The
    // thunks keep the pre-extraction laziness: planGate runs none of them past an
    // early-out, so an off-cadence turn pays for no scan, parse, or resolve.
    const gate = planGate({
      enabled: config.enabled,
      model: config.model,
      interval: config.interval,
      systemPrompt: config.systemPrompt,
      timeoutMs: config.timeoutMs,
      turnIndex: event.turnIndex,
      outcome: event.outcome,
      llmMessages: event.context.llmMessages,
      gates: shouldGate,
      isChild: () => isChildSession(event.context.llmMessages),
      parseModel: () => parseModelKey(config.model),
      resolve: (provider, modelId) => resolveAdvisorModel(ctx.modelRegistry, provider, modelId),
      buildMessages: buildAdvisorMessages,
    });
    if (gate.action === "skip") return;
    if (gate.action === "notify") {
      reportFailure(ctx, gate.message);
      return;
    }

    // The single await splits the decision: everything before it is planGate, the
    // advisor call is I/O, everything after it is planCommit.
    const outcome = await runAdvisor({
      registry: ctx.modelRegistry,
      model: gate.model,
      systemPrompt: gate.systemPrompt,
      messages: gate.messages,
      timeoutMs: gate.timeoutMs,
      signal: ctx.signal,
    });

    const commit = planCommit({
      outcome,
      customType: config.customType,
      display: config.display,
      peerEntries: event.entries,
      strip: stripAdvisorMarkup,
    });
    if (commit.action === "notify") {
      reportFailure(ctx, commit.message);
      return;
    }
    return commit.result;
  });
}
