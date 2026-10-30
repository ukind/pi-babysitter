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
 * The blocklist is deliberately narrow, and every rule is cheap string work:
 * recursive rm on root-like targets, forced pushes to a protected branch (a
 * leading + on a refspec is git's own force marker), git reset --hard,
 * destructive git clean, SQL drops, mkfs, raw disk writes, and a
 * world-writable chmod from root. Everything else passes untouched.
 *
 * `evaluate` is exported so tests can exercise the decision core without
 * spawning this process.
 *
 * Requires Node.js 22.6 or newer. The floor is enforced at install time:
 * package.json declares engines ">=22.6.0" and .npmrc sets engine-strict,
 * so an older Node fails npm install instead of failing at first hook run
 * (F013).
 */

import { readFileSync } from "node:fs";
import { isHookInvocation, parseHookStdin, readHookField } from "./lib.mjs";

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
  const tokens = command.trim().split(/\s+/);
  // Two force signals: the explicit flag (unchanged), and a leading + on a
  // refspec — git's own force marker (git-push(1)). The flag scan cannot see
  // the +: `git push origin +main` and `git push --force-with-lease origin
  // +main` carry no --force or -f at all.
  const flagForced = /\s--force(?!-with-lease)\b|\s-f\b/.test(command);
  const anyPlus = tokens.some((token) => token.startsWith("+"));
  if (!flagForced && !anyPlus) return false;
  // Per-token refspec matching (F021, F022). The old form stripped every +
  // and matched one whitespace-anchored regex over the rejoined string, so a
  // fully-qualified ref (`refs/heads/main`) hid `main` behind the slash and
  // bypassed the matcher, while an unrelated `+feature/x` convicted the whole
  // command once its `+` was erased. git semantics: an explicit flag forces
  // EVERY refspec; a `+` forces only its own token. Protection keys on the
  // DESTINATION, so any source prefix before the colon is allowed —
  // `+main:main`, `HEAD:refs/heads/main`, and the empty-source delete form
  // `:main` still block.
  const protectedBranch = /^(?:[^:]*:)?(?:refs\/heads\/)?(?:main|master)$/;
  return tokens.some((token) => {
    if (token.startsWith("-")) return false;
    const forced = flagForced || token.startsWith("+");
    const refspec = token.startsWith("+") ? token.slice(1) : token;
    return forced && protectedBranch.test(refspec);
  });
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

if (isHookInvocation(process.argv, "gate.mjs")) {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    process.exit(0); // fail open: unreadable input never blocks the agent
  }
  const payload = parseHookStdin(raw);
  if (!payload) process.exit(0); // fail open: an unusable body never blocks the agent
  const command = readHookField(payload, "command");
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
