import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";

/**
 * advisor.ts — the advisor model call.
 *
 * Patterns are copied from `@juicesharp/rpiv-advisor`; nothing is imported from it.
 * The pi-ai imports are TYPE-only, so they are erased before the module runs.
 *
 * This module imports no sibling, so the offline test can import it directly. A
 * `./config.ts` specifier would resolve under plain node but is unproven under pi's
 * jiti; the extensionless `./config` form that `simple-english/index.ts:16` proves
 * under jiti does NOT resolve under plain node. Importing no sibling avoids choosing,
 * at the cost of the caller passing the parsed provider and modelId in.
 */

/** The minimal slice of the model registry this module needs. */
interface ModelRegistryLike {
  find(provider: string, modelId: string): unknown;
  getAvailable(): Array<{ provider: string; id: string }>;
}

/** The auth-aware completion facade Pi keeps behind the registry's private `runtime` slot. */
type CompleteSimpleFn = (
  model: Model<Api>,
  context: { systemPrompt: string; messages: Message[]; tools: [] },
  options?: { signal?: AbortSignal; reasoning?: string; sessionId?: string },
) => Promise<AssistantMessage>;

export type AdvisorResolution = { ok: true; model: Model<Api> } | { ok: false; reason: string };

export type AdvisorOutcome = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Resolve the advisor model from an already-parsed provider and modelId.
 *
 * Two gates:
 *   1. `find` resolves the pair to a live catalog entry.
 *   2. The pair appears in `getAvailable()`, the credential-backed snapshot.
 *
 * Gate 2 is a cheap pre-filter, not the safety net. The real safety net is
 * `runAdvisor`'s error branch, because a missing credential does not throw — see the
 * note there.
 *
 * The string-format gate lives in config.ts, which drops an unparseable `model` before
 * it reaches here.
 */
export function resolveAdvisorModel(
  registry: ModelRegistryLike,
  provider: string,
  modelId: string,
): AdvisorResolution {
  const found = registry.find(provider, modelId);
  if (!found) {
    return { ok: false, reason: `model "${provider}/${modelId}" is not in the registry` };
  }
  const key = `${provider}/${modelId}`;
  const credentialed = registry
    .getAvailable()
    .some((candidate) => `${candidate.provider}/${candidate.id}` === key);
  if (!credentialed) {
    return { ok: false, reason: `provider "${provider}" has no credentials` };
  }
  return { ok: true, model: found as Model<Api> };
}

/**
 * Resolve Pi's auth-aware completion facade when the host exposes one.
 *
 * `ModelRegistry` keeps `runtime` as a public class field
 * (install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js:5-9),
 * so this reach is stable on 1.4.0. Calling that facade is what lets Pi apply
 * credential-derived request fields such as GitHub Copilot's OAuth-specific `baseUrl`.
 * Older hosts, and future hosts that move the slot, simply fall through.
 *
 * F008 (accepted in writing): package.json declares this package `^1.4.0`, so a
 * minor bump can relocate the `runtime` slot. When it moves, this function returns
 * undefined, runAdvisor's fail-fast guard returns "no auth-aware completion facade
 * on this host", and the commit seam notifies through reportFailure (plan-turn.ts's
 * failure arm -> index.ts's notify -> report.ts:30-37) on every gate pass whose turn
 * completed — the cadence latch spends on the outcome check (index.ts:60-61), so the
 * failure re-reports each interval until the facade returns. The per-fire report is
 * the accepted contract; the caret stays.
 *
 * The returned method is bound because `ModelRuntime.completeSimple()` calls other
 * runtime methods through `this`.
 *
 * Copied from `@juicesharp/rpiv-advisor/advisor/pi-compat.ts:38-49`.
 */
export function getRuntimeCompleteSimple(modelRegistry: unknown): CompleteSimpleFn | undefined {
  try {
    if (modelRegistry === null || typeof modelRegistry !== "object") return undefined;
    const runtime = (modelRegistry as { runtime?: unknown }).runtime;
    if (runtime === null || typeof runtime !== "object") return undefined;
    const completeSimple = (runtime as { completeSimple?: unknown }).completeSimple;
    return typeof completeSimple === "function"
      ? (completeSimple.bind(runtime) as CompleteSimpleFn)
      : undefined;
  } catch {
    // A malformed or private host shape must not break extension load.
    return undefined;
  }
}

/** Pull the advisor's answer text out of the response, ignoring thinking and tool blocks. */
export function extractAdvisorText(response: AssistantMessage): string {
  return response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Tier 1: a complete fake tool-call region, opener through closer.
 *
 * Requires the literal tag name `tool_call`, so `<file.ts:10>` and
 * `<active_agent name="x"/>` cannot match. `[^>]*` admits attributes on the
 * opener and `\s*` admits a lenient closer (`</tool_call >`).
 */
const TOOL_CALL_REGION_PATTERN = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/g;

/**
 * Tier 2: residual vocabulary debris — a `<function=…>…</function>`,
 * `<function_calls>…</function_calls>`, or `<parameter=…>…</parameter>`
 * construct a truncated or hand-written region leaves behind, payload
 * included. The widened group (F023) adds the function_calls and invoke
 * dialects the audit caught reaching the transcript.
 *
 * Bounded attribute matching admits both quoted and unquoted values. Swept
 * AFTER tier 1 so a complete region is removed whole and this only sees
 * orphans.
 */
const TOOL_VOCABULARY_PATTERN =
  /<(?:tool_call|function_calls|function|parameter|invoke)\b[^>]*>[\s\S]*?<\/(?:tool_call|function_calls|function|parameter|invoke)\s*>/g;

/**
 * Tier 3: the literal guarantee. Any surviving opener or closer tag is
 * deleted unconditionally, which is what makes AC1 a direct assertion rather
 * than an inference from tier-1 coverage. The group must stay BYTE-IDENTICAL
 * to TOOL_MARKUP_PATTERN's (F023): tier 3 superset of the guard is what makes
 * a guard hit always mean a tier hit.
 *
 * The cost is deliberate: the advisor cannot quote a fake tool call as
 * evidence. AC1 is substring-shaped, so the guarantee wins over the quote.
 */
const TOOL_CALL_LITERAL_PATTERN =
  /<\/?(?:tool_call|function_calls|function|parameter|invoke)\b[^>]*>?/g;

/**
 * Tier 2b: orphan sweep — vocabulary tokens whose paired counterpart never
 * arrived (`<function=foo>` with no closer, `</parameter>` or
 * `</function_calls>` with no opener, a bare `<invoke>`).
 *
 * The pair-anchored tier 2 lets both through; the executable trace caught it.
 * Swept LAST so paired constructs are removed whole first and this only sees
 * the residue. The \b form also matches a bare `<function …>` opener — the
 * accepted cost of closing the orphan inlet.
 */
const TOOL_VOCABULARY_ORPHAN_PATTERN =
  /<\/?(?:tool_call|function_calls|function|parameter|invoke)\b[^>]*>/g;

/**
 * The identity guard: fires when ANY tier could match — a tool_call,
 * function_calls, invoke, function, or parameter tag (open or closed).
 *
 * Returns the input byte-identical otherwise. Its misses are exactly the
 * pipeline's no-ops: `<tool_callx` (no word boundary) matches neither, so the
 * guard cannot strand markup the tiers would have removed. Proven by trace:
 * every tier-triggering fixture matches, and every guard-missing fixture is
 * one the pipeline leaves unchanged. The group must stay BYTE-IDENTICAL to
 * TOOL_CALL_LITERAL_PATTERN's (F023): a guard hit must always mean a tier hit.
 */
const TOOL_MARKUP_PATTERN = /<\/?(?:tool_call|function_calls|function|parameter|invoke)\b/;

/**
 * Strip fake tool-call markup from the advisor's reply, keeping the advice.
 *
 * The advisor runs with `tools: []` (runAdvisor's `completeSimple` call) and fakes tool calls as
 * plain text. `extractAdvisorText` keeps every text block, so that pseudo-syntax
 * reaches the commit seam verbatim and lands in the durable transcript and the
 * LLM context re-projection. This is the filter between the two.
 *
 * Four passes, in order: complete regions, paired vocabulary debris, the
 * literal tag sweep, then an orphan sweep for vocabulary tokens whose pair
 * never arrived. The result is trimmed, so a reply that is nothing but
 * markup strips to `""` — the value the empty-guard at the commit seam
 * consumes.
 *
 * Identity when clean is EXACT and unconditional: the guard returns the input
 * untouched when no tier could match, so the whitespace repair below only ever
 * sees a reply that carried markup (the executable trace caught the unguarded
 * draft collapsing blank-line runs in clean prose — an AC3 violation). A
 * mid-tag cut (`<tool_ca`) and a tag-shaped miss (`<tool_callx`) are NOT
 * markup under this rule and survive; AC1, which bans the `<tool_call>` tag
 * substring, is not violated by either. The `<tool_call`-with-no-`>`-anywhere
 * input eats the tail — ratified: that reply is already degenerate.
 */
export function stripAdvisorMarkup(text: string): string {
  if (!text || !TOOL_MARKUP_PATTERN.test(text)) return text;
  return (
    text
      .replace(TOOL_CALL_REGION_PATTERN, "")
      .replace(TOOL_VOCABULARY_PATTERN, "")
      .replace(TOOL_CALL_LITERAL_PATTERN, "")
      .replace(TOOL_VOCABULARY_ORPHAN_PATTERN, "")
      // Whitespace repair: a removed region can leave a doubled blank line where
      // the "\n" join at :102 put one. Collapse runs of blank lines to one.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Run `call` under a hard deadline.
 *
 * The runtime has no handler deadline of its own: `runner.js:774` is the single await,
 * reached through four nested awaits with no `Promise.race` and no abort enforcement.
 * The budget is therefore constructed here.
 *
 * The timeout promise is `Promise<never>` so `Promise.race` narrows to the call's type.
 * The timer is deliberately NOT `unref`'d, a departure from the
 * `orca-agent-status.ts:323-347` precedent. That precedent posts fire-and-forget, where a
 * pending timer really can outlive the operation. Here the timer is awaited inside the
 * handler and cleared in `finally` on every path, so it can never delay process exit —
 * and leaving it as a loop driver makes the deadline fire on time even when the advisor
 * call has no other pending I/O. An external abort signal is forwarded so a user
 * interrupt cancels the advisor call too.
 *
 * `MIN_TIMEOUT_MS` in config.ts floors the budget at 1000ms, so a configured value below
 * that is clamped up. The offline criteria therefore use 1000, not something smaller.
 */
export async function callWithDeadline<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`advisor call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    // The pending assignment sits INSIDE the try: a call implementation that throws
    // synchronously must reach the finally below, or the deliberately-not-unref'd timer
    // stays alive and rejects at +timeoutMs with no handler — a process crash up to a
    // full budget after the throw (F001). A throwing call creates no pending, so there
    // is no second failure path: the throw propagates to runAdvisor's backstop and the
    // turn still fails open, now with the timer cleared on the way out.
    const pending = call(controller.signal);
    // The losing branch must not produce an unhandled rejection: a call that fails after
    // the deadline already won would otherwise crash the process.
    pending.catch(() => {});
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Call the advisor and return its text, or the reason it could not be called.
 *
 * Never throws. Every failure path is fail-open: the caller commits no entry and
 * requests no continuation, and the agent loop keeps scheduling.
 *
 * THE `catch` IS A BACKSTOP, NOT THE MAIN PATH. `completeSimple` resolves through
 * `lazyStream`, whose `setup().catch`
 * (install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/api/lazy.js:57-64)
 * pushes an `error` event and calls `outer.end(message)`, and `EventStream.end`
 * (install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js:52-58)
 * RESOLVES the final-result promise. A missing credential, a provider 500, and a
 * network failure therefore all RESOLVE with an `AssistantMessage` whose
 * `stopReason` is `"error"` and whose `errorMessage` carries the cause. Reading only
 * the text would report every one of them as "advisor returned no text" and throw the
 * cause away, so `stopReason` is checked first.
 *
 * `apiKey` and `headers` are deliberately NOT passed. `prepareRequest`
 * (model-runtime.js:452-470) resolves auth internally and applies credential-derived
 * fields such as an OAuth `baseUrl`; an explicit override at `:468` bypasses that
 * resolution and reintroduces the endpoint mismatch.
 *
 * THE GATE ADMITS EXACTLY ONE STOP REASON. `StopReason` is a closed 7-member
 * union (`pi-ai types.d.ts:307`): "pending" | "stop" | "length" | "toolUse" |
 * "error" | "aborted" | "deferred". Only "stop" means the provider finished the
 * reply. Every other member is either a failure ("error", "aborted") or an
 * unfinished reply ("length" is a cap hit, "toolUse" means it stopped to call a
 * tool it does not have, "pending"/"deferred" are transport states). An
 * unfinished reply is the truncation inlet: cut mid-tag, it commits partial
 * fake-markup debris into durable JSONL. Failing open here drops the guidance
 * for that turn — visible via `advisor stopped with <reason>` at the commit
 * seam — which is cheaper than committing debris.
 */
export async function runAdvisor(params: {
  registry: ModelRegistryLike;
  model: Model<Api>;
  systemPrompt: string;
  messages: Message[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<AdvisorOutcome> {
  // This guard stays BEFORE the try: it is a fail-fast precondition, not a transport
  // failure for the deadline machinery to own. t16 pins the exact reason string, and the
  // host reports it only when a session has a UI (report.ts:30-37), so the guard's
  // position is load-bearing documentation: a refactor that pulls it inside the try
  // couples a missing facade to a catch widened for transport failures (F008).
  const completeSimple = getRuntimeCompleteSimple(params.registry);
  if (!completeSimple) {
    return { ok: false, reason: "no auth-aware completion facade on this host" };
  }
  try {
    const response = await callWithDeadline(
      (signal) =>
        completeSimple(
          params.model,
          { systemPrompt: params.systemPrompt, messages: params.messages, tools: [] },
          { signal },
        ),
      params.timeoutMs,
      params.signal,
    );
    if (response.stopReason !== "stop") {
      return {
        ok: false,
        reason: response.errorMessage || `advisor stopped with ${response.stopReason}`,
      };
    }
    const text = extractAdvisorText(response);
    if (!text) return { ok: false, reason: "advisor returned no text" };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
