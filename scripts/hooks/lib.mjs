/**
 * Shared plumbing for the Claude Code hook scripts.
 *
 * Plain node only: no project imports, no node_modules lookups. The hooks run
 * before git operations in arbitrary checkouts, where the extension's
 * extensionless sibling imports do not resolve. Biome lints this file; tsc
 * never sees it (all of .mjs is outside the typecheck surface).
 *
 * Only the pure helpers live here. Each hook keeps its own exit dispatch —
 * the process.exit boundaries are the one piece of these scripts that ships
 * untested, because faking argv and stdin buys less than the dispatch costs.
 */

/**
 * Whether node was started as the named hook script. Path-separator safe:
 * Claude Code invokes the hooks with absolute paths, and Windows uses
 * backslashes.
 */
export function isHookInvocation(argv, scriptName) {
  const entry = argv?.[1] ?? "";
  return entry.replace(/\\/g, "/").endsWith(scriptName);
}

/**
 * Parse one hook stdin payload. Returns the parsed object, or undefined on
 * any parse failure or non-object body: the caller's `if (!payload)
 * exit(0)` is then the fail-open gate, and a hostile body can never block.
 */
export function parseHookStdin(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read one tool-input field across both payload spellings Claude Code ships:
 * snake_case `tool_input` and camelCase `toolInput`. Returns the raw value
 * (possibly undefined); the caller owns the type check, because the gate and
 * the feedback hook reject different shapes.
 */
export function readHookField(payload, key) {
  return payload?.tool_input?.[key] ?? payload?.toolInput?.[key];
}
