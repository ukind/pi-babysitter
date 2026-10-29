#!/usr/bin/env node
/**
 * PostToolUse feedback hook for Claude Code.
 *
 * After Write or Edit touches a JS or TS file, runs `node --check` on the file
 * and reports the result on stderr. Always exits 0: this hook observes and
 * reports, it never blocks. Node 22.6 or newer parses TypeScript in check
 * mode, so .ts files get real syntax feedback.
 *
 * Requires Node.js 22.6 or newer.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CHECKED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], { timeout: 10_000 });
  if (result.error) return { ok: false, detail: result.error.message };
  if (result.status === 0) return { ok: true, detail: "syntax ok" };
  const stderr = result.stderr?.toString().trim() ?? "";
  return { ok: false, detail: stderr.length > 0 ? stderr : `exit code ${result.status}` };
}

function isHookInvocation(argv) {
  const entry = argv[1] ?? "";
  return /feedback\.mjs$/.test(entry.replace(/\\/g, "/"));
}

if (isHookInvocation(process.argv)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const file = payload?.tool_input?.file_path ?? payload?.toolInput?.file_path;
  if (typeof file !== "string" || file.length === 0) process.exit(0);
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (!CHECKED_EXTENSIONS.has(extension)) process.exit(0);
  const outcome = syntaxCheck(file);
  if (!outcome.ok) {
    process.stderr.write(`Syntax check failed for ${file}: ${outcome.detail}\n`);
  }
  process.exit(0);
}
