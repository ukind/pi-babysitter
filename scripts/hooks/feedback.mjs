#!/usr/bin/env node
/**
 * PostToolUse feedback hook for Claude Code.
 *
 * After Write or Edit touches a JS or TS file, runs `node --check` on the file
 * and reports the result on stderr. Always exits 0: this hook observes and
 * reports, it never blocks. Node 22.6 or newer parses TypeScript in check
 * mode, so .ts files get real syntax feedback.
 *
 * Requires Node.js 22.6 or newer. The floor is enforced at install time:
 * package.json declares engines ">=22.6.0" and .npmrc sets engine-strict,
 * so an older Node fails npm install instead of failing at first hook run
 * (F013).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  describeSpawnResult,
  isHookInvocation,
  parseHookStdin,
  readHookField,
  SYNTAX_CHECK_BUDGET_MS,
} from "./lib.mjs";

const CHECKED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], {
    timeout: SYNTAX_CHECK_BUDGET_MS,
  });
  // The spawnSync decision table lives in describeSpawnResult (lib.mjs): the timeout is
  // named as a timeout there instead of surfacing raw ETIMEDOUT noise (F018).
  return describeSpawnResult(result);
}

if (isHookInvocation(process.argv, "feedback.mjs")) {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  const payload = parseHookStdin(raw);
  if (!payload) process.exit(0);
  const file = readHookField(payload, "file_path");
  if (typeof file !== "string" || file.length === 0) process.exit(0);
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (!CHECKED_EXTENSIONS.has(extension)) process.exit(0);
  const outcome = syntaxCheck(file);
  if (!outcome.ok) {
    process.stderr.write(`Syntax check failed for ${file}: ${outcome.detail}\n`);
  }
  process.exit(0);
}
