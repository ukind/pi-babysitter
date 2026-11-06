/**
 * tests/helpers.mjs — the shared suite helpers (F030): the assert primitive, the
 * tmpRoot fixture and its exit handler, the withConfig and captureWarn windows,
 * shapeJson, the marker helpers, and the gateArgs factory (shared by the gate and
 * triggers suites). Bytes moved verbatim from the tests/test.mjs monolith where
 * noted; the export prefixes are the only edit. Every suite imports this module
 * before its own body, so the exit handler and the summary line register before
 * any suite body runs and survive a throwing import.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_URL, resetWarnOnceForTest, shouldFire } from "../config.ts";

export const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else console.log("PASS:", msg);
};

// tmpRoot has no package.json, so it is the deterministic "no repo signal" cwd.
export const tmpRoot = mkdtempSync(join(tmpdir(), "advisor-turn-gate-"));
// Cleanup AND summary live in the exit handler, not as trailing statements: a throwing
// assertion must not leak the temp dir or swallow the summary line.
process.on("exit", () => {
  rmSync(tmpRoot, { recursive: true, force: true });
  console.log(process.exitCode ? "test.mjs: FAILURES" : "test.mjs: all green");
});

/**
 * Point CONFIG_URL at a fixture, run fn, restore. CONFIG_URL is a mutable URL object and
 * loadConfig() reads it per call, so no restart is needed.
 */
export const realHref = CONFIG_URL.href;
export function withConfig(text, fn) {
  // F002: re-arm the warn-once latch so every fixture window starts fresh and the
  // config tests carry no cross-test ordering constraint.
  resetWarnOnceForTest();
  const file = join(tmpRoot, "config-under-test.json");
  writeFileSync(file, text);
  CONFIG_URL.href = pathToFileURL(file).href;
  try {
    return fn();
  } finally {
    CONFIG_URL.href = realHref;
  }
}

export function captureWarn(fn) {
  const seen = [];
  const orig = console.warn;
  console.warn = (s) => seen.push(String(s));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

// JSON of messages with the timestamp key dropped: the one field two back-to-back
// buildAdvisorMessages calls can legitimately differ on (each nudge stamps its own
// Date.now(), so a millisecond boundary between calls is legal, not a divergence).
export const shapeJson = (messages) =>
  JSON.stringify(messages.map(({ timestamp: _ts, ...rest }) => rest));

export const Q = String.fromCharCode(34);
export const marker = (name) => `<active_agent name=${Q}${name}${Q}/>`;

export const gateArgs = (overrides = {}) => ({
  enabled: true,
  model: "anthropic/claude-sonnet-4-5",
  interval: 2,
  systemPrompt: "sp",
  timeoutMs: 5000,
  turnIndex: 1,
  outcome: "completed",
  llmMessages: [{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 }],
  lastFiredTurn: -1,
  gates: shouldFire,
  isChild: () => false,
  parseModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-4-5" }),
  resolve: () => ({ ok: true, model: { provider: "anthropic", id: "claude-sonnet-4-5" } }),
  buildMessages: (messages) => messages,
  markFired: () => {},
  ...overrides,
});
