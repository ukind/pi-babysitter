import type { Message } from "@earendil-works/pi-ai";

/**
 * prompt.ts — context shaping for the advisor call.
 *
 * The advisor receives the executor's full projected context, minus the tool
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
 * The full context is sent, not a trimmed window: the advisor is meant to catch drift
 * caused by early decisions, and a tail-only view cannot see them.
 */
export function buildAdvisorMessages(llmMessages: Message[]): Message[] {
  return ensureUserTail(stripToolDeclarations(llmMessages));
}
