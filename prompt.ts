import type { Message } from "@earendil-works/pi-ai";

/**
 * prompt.ts — context shaping for the advisor call.
 *
 * The advisor receives the executor's projected context, minus the tool
 * declarations that would let it call tools. Shapes are copied from
 * `@juicesharp/rpiv-advisor/advisor/context.ts:31-56`; nothing is imported.
 *
 * The pi-ai import is TYPE-only, so it is erased before the module runs and the offline
 * test resolves no package. That is the invariant `extensions/taste-router/test.mjs`
 * asserts of its own index.ts at t14.
 */

/**
 * Appended when the context ends on an assistant turn.
 *
 * Some providers reject a payload ending on an assistant message ("This model does not
 * support assistant message prefill"). The nudge exists only to guarantee a user tail —
 * it carries no instructions, because the advisor's system prompt already says what to
 * do. Restating it here would give the model two directives to reconcile.
 *
 * The template's nudge is one line for the same reason
 * (`@juicesharp/rpiv-advisor/advisor/messages.ts:33`:
 * "Please advise on the executor's situation above.").
 */
export const ADVISOR_NUDGE = "Advise on the work above.";

/** True when a system message carries tool deltas that would make the executor's tools callable. */
function hasToolDeclarations(message: Message): boolean {
  if (message.role !== "system") return false;
  const system = message as { toolsAdded?: unknown; toolsRemoved?: unknown };
  return Boolean(system.toolsAdded || system.toolsRemoved);
}

/**
 * Strip `toolsAdded` and `toolsRemoved` from system messages.
 *
 * Pi 1.0 and later records the executor's system prompt and tool loadout in the
 * transcript as `system` messages, and every provider resolves the request's tools from
 * those deltas. `tools: []` on the request alone therefore leaves the executor's tools
 * callable, and the advisor can stop on a `toolUse` with no text. Drop the deltas, keep
 * the prompt text.
 */
export function stripToolDeclarations(messages: Message[]): Message[] {
  if (!messages.some(hasToolDeclarations)) return messages;
  return messages.map((message) => {
    if (!hasToolDeclarations(message)) return message;
    const {
      toolsAdded: _added,
      toolsRemoved: _removed,
      ...rest
    } = message as {
      toolsAdded?: unknown;
      toolsRemoved?: unknown;
    };
    return rest as Message;
  });
}

/** Chars-per-token divisor for the size estimate (FR7, the settled chars/4 decision). */
const CHARS_PER_TOKEN = 4;

/**
 * The fold marker's reserved budget, in estimated tokens.
 *
 * The estimate door is the SAME one every message goes through — chars/4 over the
 * JSON-rendered MESSAGE, wrapper included — so the bound must count the wrapper: the
 * marker text is at most ~107 characters (16-char prefix and separator space, a count
 * of at most seven digits, fixed wording), and the JSON wrapper adds at most ~80 more,
 * so the marker estimates under 50 tokens. The allowance is 64, and the fold accounts
 * for it while choosing what to fold, so a fold that fits is guaranteed to fit WITH the
 * marker included.
 */
const MARKER_TOKEN_ALLOWANCE = 64;

/** Exact prefix of the fold-marker message; the tests pin it. */
export const BUDGET_FOLD_MARKER_PREFIX = "[context folded]";

/**
 * Estimate one message's token cost: its JSON-rendered characters / 4, rounded up.
 *
 * Lexical, deterministic, offline — the settled FR7 decision. Calibration rides the
 * eval harness (Slice 8) once its scores demand it.
 */
export function estimateMessageTokens(message: Message): number {
  return Math.ceil(JSON.stringify(message).length / CHARS_PER_TOKEN);
}

/**
 * Fold the earliest non-system messages into one marker until the payload fits the budget.
 *
 * Invariants, in priority order:
 *   1. tokenBudget <= 0 (the default) is the identity — today's behavior, byte for byte.
 *   2. Every system message survives; they carry the replay chains the advisor reads.
 *   3. The last message never folds — the tail stays verbatim.
 *   4. The fold walks oldest-first and stops as soon as the kept total (marker
 *      allowance included) fits, so the verbatim tail is as long as the budget allows.
 *
 * Best-effort by design: a context of only system messages, or one whose systems plus
 * tail already exceed the budget, comes back unfolded or still over — the invariants
 * above win over the number.
 */
export function applyTokenBudget(messages: Message[], tokenBudget: number): Message[] {
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) return messages;
  if (messages.length === 0) return messages;
  const sizes = messages.map(estimateMessageTokens);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= tokenBudget) return messages;

  const foldedIndices: number[] = [];
  let foldedTokens = 0;
  for (let i = 0; i < messages.length - 1; i += 1) {
    const message = messages[i];
    if (message === undefined || message.role === "system") continue;
    const size = sizes[i];
    if (size === undefined) continue;
    foldedIndices.push(i);
    foldedTokens += size;
    if (total - foldedTokens + MARKER_TOKEN_ALLOWANCE <= tokenBudget) break;
  }
  if (foldedIndices.length === 0) return messages;

  const foldSet = new Set(foldedIndices);
  const firstIndex = foldedIndices[0];
  if (firstIndex === undefined) return messages;
  const firstFolded = messages[firstIndex] as { timestamp?: number } | undefined;
  if (!firstFolded) return messages;

  const marker: Message = {
    role: "user",
    content: [
      {
        type: "text",
        text:
          BUDGET_FOLD_MARKER_PREFIX +
          " " +
          foldedIndices.length +
          " earliest message(s) folded to fit the token budget. Everything below is verbatim.",
      },
    ],
    timestamp: firstFolded.timestamp ?? 0,
  };
  // The marker leads the result: its own text promises "Everything below is
  // verbatim", which is literally true only when it sits above every kept
  // message. The kept messages keep their relative order; the marker carries the
  // first folded message's timestamp (t22 pins the exact shape).
  const result: Message[] = [marker];
  for (const [i, message] of messages.entries()) {
    if (!foldSet.has(i)) result.push(message);
  }
  return result;
}
/**
 * Guarantee a user tail.
 *
 * A context that ends on an assistant message is rejected by some providers and, where
 * it is accepted, reads as a request to continue rather than to review.
 */
export function ensureUserTail(messages: Message[]): Message[] {
  const last = messages.at(-1);
  if (last === undefined || last.role !== "assistant") return messages;
  return [
    ...messages,
    { role: "user", content: [{ type: "text", text: ADVISOR_NUDGE }], timestamp: Date.now() },
  ];
}

/**
 * Shape the executor's projected context for the advisor call.
 *
 * Pipeline order is load-bearing (the settled window decision): the strip runs first so
 * the fold sizes stripped messages, and the tail guarantee runs last so even a folded
 * context ends on a user message. tokenBudget defaults to 0, where the fold is the
 * identity and the full context is sent — the historical behavior, pinned by t10.
 *
 * With a budget set, the earliest non-system messages fold into one marker. Early
 * decisions can scroll out of view; that is the deliberate trade — a bounded payload
 * the provider accepts beats an unbounded one it rejects.
 *
 * The optional digest (FR2) is a synthetic system message inserted in front of the
 * payload's final message: the tail the tail guarantee produced — the nudge, when one
 * rides — stays terminal, the per-fire data sits at the recency end, and the digest is
 * never a fold candidate because it joins after the fold has run.
 */
export function buildAdvisorMessages(
  llmMessages: Message[],
  tokenBudget = 0,
  digest?: Message,
): Message[] {
  const shaped = ensureUserTail(applyTokenBudget(stripToolDeclarations(llmMessages), tokenBudget));
  if (!digest) return shaped;
  const tail = shaped.at(-1);
  if (tail === undefined) return [digest];
  return [...shaped.slice(0, -1), digest, tail];
}
