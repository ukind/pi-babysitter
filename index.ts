import type { BoundaryResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveAdvisorModel, runAdvisor, stripAdvisorMarkup } from "./advisor";
import { loadConfig, parseModelKey, shouldGate } from "./config";
import { isChildSession } from "./guard";
import { buildAdvisorMessages } from "./prompt";
import { reportFailure } from "./report";

/**
 * index.ts — the advisor gate's wiring.
 *
 * The only file the runtime loads. Auto-discovered as a folder entry
 * (package-manager.js:440-444 → resolveExtensionEntries:381-406, which prefers a
 * package.json manifest, then index.ts, then index.js). No settings.json edit.
 *
 * Sibling imports are extensionless, the form `simple-english/index.ts:16` proves under
 * pi's per-extension jiti. The alias map at loader.js:37-88 holds only bare package
 * specifiers, so relative specifiers resolve against the importing file untouched.
 *
 * The pi-coding-agent import is TYPE-only, so it is erased before the module runs.
 */

/** One committed guidance entry plus the forced continuation. */
function buildCorrection(
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

export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
    // Config is read per dispatch, not once at factory time, so interval and model
    // can be retuned without a reload.
    const config = loadConfig();
    if (!config.enabled || !config.model) return;

    // Cadence. The modulo form is required: a threshold form such as
    // `turnIndex >= interval` latches and fires on every later turn.
    if (!shouldGate(event.turnIndex, config.interval)) return;

    // An aborted or errored turn has no work worth reviewing.
    if (event.outcome !== "completed") return;

    // The authoritative veto.
    if (isChildSession(event.context.llmMessages)) return;

    // config.ts already dropped an unparseable model, so this is a safety net.
    const parsed = parseModelKey(config.model);
    if (!parsed) return;

    const resolution = resolveAdvisorModel(ctx.modelRegistry, parsed.provider, parsed.modelId);
    if (!resolution.ok) {
      reportFailure(ctx, `advisor-turn-gate: ${resolution.reason}`);
      return;
    }

    const outcome = await runAdvisor({
      registry: ctx.modelRegistry,
      model: resolution.model,
      systemPrompt: config.systemPrompt,
      messages: buildAdvisorMessages(event.context.llmMessages),
      timeoutMs: config.timeoutMs,
      signal: ctx.signal,
    });
    if (!outcome.ok) {
      // Fail-open: no entries, no continuation. The loop still schedules.
      reportFailure(ctx, `advisor-turn-gate: ${outcome.reason}`);
      return;
    }

    // The strip is the last filter before the durable transcript. A reply that is
    // nothing but markup strips to "" — committing an empty entry would be worse
    // than committing nothing, so the husk fails open like every other path.
    const stripped = stripAdvisorMarkup(outcome.text);
    if (!stripped) {
      reportFailure(ctx, "advisor-turn-gate: advisor reply was markup only");
      return;
    }
    return buildCorrection(config.customType, stripped, config.display, event.entries);
  });
}
