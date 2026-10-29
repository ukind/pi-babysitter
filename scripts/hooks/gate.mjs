#!/usr/bin/env node
/**
 * PreToolUse gate hook for Claude Code.
 *
 * Reads one JSON object on stdin that describes the tool call. Blocks
 * catastrophic Bash commands and allows everything else. Exit code 2 blocks
 * the call and feeds the stderr text back to the agent. Any parse error or
 * unexpected shape fails open: the call proceeds, so the gate never becomes
 * a denial-of-service on itself.
 *
 * `evaluate` is exported so tests can exercise the decision core without
 * spawning this process.
 *
 * Requires Node.js 22.6 or newer.
 */

import { readFileSync } from "node:fs";

/** Targets whose deletion endangers data outside one project. */
const ROOT_LIKE_TARGETS = new Set([
  "/",
  "/.",
  "//",
  "~",
  "~/",
  "~/*",
  "/*",
  "*",
  ".",
  "..",
  "../..",
]);

function isRootLikeTarget(token) {
  const target = token.replace(/^["']|["']$/g, "");
  return ROOT_LIKE_TARGETS.has(target) || /^[a-zA-Z]:\\?$/.test(target);
}

function isFlag(token) {
  return token.startsWith("-") && token.length > 1;
}

function blocksRecursiveRemove(command) {
  if (!/\brm\s/.test(command)) return false;
  const tokens = command.trim().split(/\s+/);
  const flagText = tokens.filter(isFlag).join(" ");
  if (!/r/i.test(flagText)) return false;
  const targets = tokens.slice(1).filter((token) => !isFlag(token));
  return targets.some(isRootLikeTarget);
}

function blocksProtectedForcePush(command) {
  if (!/\bgit\s+push\b/.test(command)) return false;
  const forced = /\s--force(?!-with-lease)\b|\s-f\b/.test(command);
  const protectedBranch = /\s(?:origin\s+)?(?:(?:HEAD|HEAD~\d+):)?(?:main|master)\b/.test(command);
  return forced && protectedBranch;
}

/**
 * Pure decision core: returns the name of the first matching deny rule, or
 * null to allow. Order matters only for the reported reason; a command that
 * matches two rules is blocked either way.
 */
export function evaluate(command) {
  if (typeof command !== "string" || command.length === 0) return null;
  if (blocksRecursiveRemove(command)) return "rm -r[f] on a root-like target";
  if (blocksProtectedForcePush(command)) return "forced push to a protected branch";
  if (/\bgit\s+reset\s+--hard\b/.test(command)) return "git reset --hard";
  if (/\bgit\s+clean\s+-\w*f/.test(command)) return "destructive git clean";
  if (/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i.test(command)) return "SQL drop statement";
  if (/\bmkfs(?:\.\w+)?\b/.test(command)) return "filesystem format";
  if (/\bdd\s+[^|;&]*\bof=\/dev\//.test(command)) return "raw disk write";
  if (/\bchmod\s+-R\s+777\s+\/\s*$/.test(command)) return "world-writable chmod from root";
  return null;
}

function isHookInvocation(argv) {
  const entry = argv[1] ?? "";
  return /gate\.mjs$/.test(entry.replace(/\\/g, "/"));
}

if (isHookInvocation(process.argv)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0); // fail open: unreadable input never blocks the agent
  }
  const command = payload?.tool_input?.command ?? payload?.toolInput?.command;
  if (typeof command !== "string") process.exit(0);
  const violation = evaluate(command);
  if (violation !== null) {
    process.stderr.write(
      `Blocked by gate hook: ${violation}. ` +
        "Rephrase without the destructive form, or ask the user for approval.\n",
    );
    process.exit(2);
  }
  process.exit(0);
}
