/**
 * guard.ts — subagent inertness for the advisor gate.
 *
 * One mechanism: `isChildSession` — the handler-time marker veto. AUTHORITATIVE.
 *
 * There is deliberately NO AsyncLocalStorage probe. Two independent reasons, either of
 * which alone is enough:
 *
 *   - SCOPE. `childSessionContext` is documented as marking "resource loading/session
 *     construction performed for a subagent"
 *     (npm/node_modules/@tintinweb/pi-subagents/src/child-context.ts:4-6).
 *     `runInChildSessionContext` wraps `createAgentSession` (src/agent-runner.ts:1106)
 *     and `loader.reload()` (src/agent-runner.ts:859), not the agent run. Whether a
 *     `turn_end` handler ever executes inside that scope is not determinable
 *     statically.
 *   - IDENTITY. `loadExtensionModule` builds a fresh jiti per extension with
 *     `moduleCache: false`
 *     (install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:480-483).
 *     The pi-subagents package declares `./src/index.ts` as its entry
 *     (npm/node_modules/@tintinweb/pi-subagents/package.json:62-64), so the runtime
 *     loads `src/child-context.ts` inside ITS jiti. This extension's jiti imports the
 *     same FILE but builds a second module object with a second `AsyncLocalStorage`,
 *     distinct from the one `src/agent-runner.ts:859` and `:1106` write. A probe
 *     imported here reads a storage nobody writes, so it reports `false` in every
 *     session, including a real child.
 *
 * The cost of a missed child is a billed advisor call and a committed entry in a session
 * that must stay inert, so the veto errs toward switching the gate off.
 *
 * This module imports nothing, so the offline test resolves no package at all.
 */

/**
 * The child-session marker, emitted by pi-subagents in BOTH prompt modes.
 *
 * `buildAgentPrompt` prepends `<active_agent name="${config.name}"/>` in replace mode and
 * places it after the inherited parent content in append mode
 * (npm/node_modules/@tintinweb/pi-subagents/src/prompts.ts:62). It is the only child
 * marker with full coverage, which is why it — not the `<sub_agent_context>` bridge
 * (append mode only) and not the `#<agentId>` session-name suffix (set only when
 * `options.agentId` is, src/agent-runner.ts:1108-1111) — carries the veto.
 *
 * The stale `"You are a child subagent"` pattern still configured at
 * settings.json:84-90 matches nothing in the installed package. The offline test asserts
 * this pattern matches the live literal and rejects that stale one.
 */
export const CHILD_MARKER_PATTERN = /<active_agent\s+name="[^"]*"\s*\/>/;

/** The slice of a system message the veto needs. Structural, so this module imports nothing. */
interface SystemMessageLike {
  role: string;
  content?: unknown;
  sections?: unknown;
}

/** Pull the instruction text out of a content value, which may be a string or text blocks. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type !== "text" || typeof candidate.text !== "string") continue;
    text += candidate.text;
  }
  return text;
}

/**
 * Render a system message the way pi does: `content` plus every `sections` value.
 *
 * The shape follows `getSystemMessageText`
 * (install/releases/1.4.0/node_modules/@earendil-works/pi-ai/dist/utils/text.js:11-18),
 * copied rather than imported so this module keeps zero imports — a value import would
 * break Phase 6's plain-node test, which resolves no package.
 *
 * READING `content` ALONE IS A BUG. `buildSystemPromptState`
 * (install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js:126-130)
 * returns `{ content: "", sections }` unless a `before_agent_start` handler forced a
 * prompt. pi-subagents passes the child prompt as `customPrompt`
 * (src/agent-runner.ts:856 → resource-loader.js:477 → agent-session.js:1305), which
 * `buildSystemPromptSections` puts in `sections.preamble`
 * (system-prompt.js:78-79). In a real child session the marker is therefore in
 * `sections.preamble` and `content` is the empty string.
 *
 * One deliberate difference from pi's reader: text blocks are concatenated without a
 * separator, where pi joins them with a newline. Every pi-generated system message
 * carries a string `content` (agent-session.js:1328 emits `content: ""`), so the array
 * branch is unreachable for `llmMessages` and the difference cannot change a verdict.
 */
function systemMessageText(message: SystemMessageLike): string {
  const parts = [contentText(message.content)];
  const sections = message.sections;
  if (sections && typeof sections === "object") {
    for (const value of Object.values(sections as Record<string, unknown>)) {
      if (typeof value === "string") parts.push(value);
    }
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}

/**
 * Authoritative child-session check.
 *
 * Scans every system message in the projected LLM context, reading `content` AND
 * `sections`. A false positive fails safe: the gate switches itself off in the main
 * session rather than firing in a child.
 *
 * `ctx.mode` and `ctx.hasUI` are deliberately NOT consulted. They answer "is there a
 * TUI?", not "am I a subagent?" — a guard written as `if (!ctx.hasUI) return;` disables
 * the gate in every `pi --print` run.
 */
export function isChildSession(llmMessages: readonly SystemMessageLike[]): boolean {
  for (const message of llmMessages) {
    if (message.role !== "system") continue;
    if (CHILD_MARKER_PATTERN.test(systemMessageText(message))) return true;
  }
  return false;
}
