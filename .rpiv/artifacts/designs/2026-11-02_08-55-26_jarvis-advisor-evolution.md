---
date: 2026-11-02T08:55:26+0700
author: Yogiswara Utama
commit: faae538
branch: main
repository: advisor-turn-gate
topic: "jarvis-advisor-evolution"
tags: [design, advisor-turn-gate, triggers, memory, dialogue, tools, specialists, async, eval, slices]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-02_08-36-12_jarvis-advisor-evolution.md
last_updated: 2026-11-02T22:40:11+0700
last_updated_by: Yogiswara Utama
---

# Design: jarvis-advisor-evolution — 8 Config-Gated Pillar Slices

## Summary

The one-shot advisor gate gains eight capabilities, each landed as its own config-gated slice on the existing star topology: multi-signal triggers, a prompt token budget, per-project memory, advisor dialogue, read-only tools, on-demand specialist consults, an optional async fire mode, and an offline eval harness. Every new module clones the house pure-spoke shape (zero runtime imports, thunks injected at the seam, plan* verbs, *Decision unions on action). Shared seams (PlanGateArgs, loadConfig, index.ts wiring) take additive-only changes, and every slice keeps the never-throw / fail-open contract with test-pinned reason strings.

## Requirements

- FR1 dialogue: the advisor sees its own prior exchanges across fires.
- FR2 memory: per-project local store, digest injected per fire, count-cap retention.
- FR3 multi-signal triggers: token growth, context pressure, trouble outcome, risky tools; arms ahead of cadence.
- FR4 read-only advisor tools: tool loop over completeSimple, allowlisted sandbox reads, bounded rounds.
- FR6 specialist consult: declared consult_specialist tool, one extra model leg, single aggregated entry.
- FR7 prompt budget: rolling summary fold + verbatim tail under a clamp-guarded token field.
- FR8 async fire: turn_end abstains, result commits at the next agent_before_settle.
- FR9 eval harness: second offline runner, golden fixtures, score-gated CI.
- Hard constraints: never throw / fail-open with pinned strings; star topology; zero runtime npm dependencies; host 1.4.x feature-detect; mandatory peer spread on every commit; strip stays the last filter.

## Current State Analysis

The gate fires on cadence only (config.ts shouldFire, plan-turn.ts:94), ships the full transcript (prompt.ts:82-84), keeps no state beyond the factory latch (index.ts:32), sees no files, consults no one, and blocks turn_end for up to 60s (advisor.ts:232-266, :319-326).

### Key Discoveries

- planGate arm order is pinned semantics (plan-turn.ts:89-119): disabled -> no model -> cadence (:94) -> outcome (:100) -> markFired (:104) -> child veto -> parse -> resolve -> consult. Trigger arms slot between :90 and :104 without moving markFired; both cadence and trigger fires pass the same gate-pass and spend the latch exactly once.
- The F007 slide (errored boundary skips without spending the slot) must survive: cadence fires never review errored turns; only the triggerOnError arm may, by bypassing the outcome veto.
- The budget fold inserts in buildAdvisorMessages between stripToolDeclarations and ensureUserTail; every Message variant carries timestamp (pi-ai types.d.ts:361-432), so the fold is deterministic without tie-breaking.
- System messages carry section replay chains; the fold must never drop a system message (guard.ts:58-96 shows the content+sections shape).
- The tool loop wraps the single completeSimple call (advisor.ts:319-326); ToolCall content blocks detect a toolUse stop mid-loop; the terminal stop-only gate keeps rejecting a final toolUse (advisor.ts:329-334).
- completeSimple already accepts tools?: Tool[] (pi-ai types.d.ts:543-547); no host change is needed for FR4/FR6.
- custom_message entries replay into LLM context as user messages (session-manager.d.ts:78-80), so FR1 rehydration is largely free; the details field (session-manager.d.ts:113) carries stable keys.
- emitBoundary replaces the accumulator only when a handler returns entries !== undefined (runner.js:774-777); returning undefined is the abstain primitive FR8 builds on; agent_before_settle (types.d.ts:783-786, agent-session.js:1567-1581) returns the same BoundaryResult contract.
- The 0.79.9 runtime dispatches turn_end without boundary fields (agent-session.js:375-384): planGate would skip every fire silently. A feature-detect (outcome not a string, or context missing) notifies once and disables the gate.
- .gitignore covers config.json (:8) but no memory directory; FR2 must add its own line. CI (ci.yml verify job, node 22.6.0 + 24) runs test, lint, typecheck in flat steps; the eval step appends after typecheck.
- tests/test.mjs is ~1,260 lines with the sanctioned split trigger (~1,500 lines or second runner); FR9's eval/ is the sanctioned second runner.

## Scope

### Building

- triggers.ts: pure trigger predicates + thresholds-armed check + risky-tool list parser.
- Prompt budget window: pure chars/4 fold, clamp-guarded tokenBudget field, all system messages always kept.
- memory.ts: beside-module per-project store (.advisor-memory/), count-cap newest-kept, digest assembled as a synthetic system message after the strip; gitignored from day one.
- Dialogue: details stamping (fire id, turn index) at commit; prior advisor entries visible via the host's own re-projection.
- sandbox.ts + advisor tool loop: read_file only (size-capped, path-bounded), pinned refusal string, bounded rounds, shared per-fire deadline.
- Specialist consult: declared consult_specialist tool, one extra completeSimple leg inside the same deadline, single aggregated entry, base-only fail arm.
- Async fire mode: config-gated abstain at turn_end, detached advisor call, once-only commit at agent_before_settle with the settle event's own accumulator spread.
- eval/: second offline runner, golden fixtures per pillar, npm eval script, CI score gate, sanctioned test split.

### Not Building

- Advisor write access of any kind (suggest-only, always).
- Any channel to the user beyond the transcript.
- Always-on specialists (on-demand consult only).
- Waking an idle agent (commit at natural boundaries only).
- Memory beyond count-cap retention.
- Live-model eval runs.
- A runtime probe for cross-session latch sharing (per-session isolation accepted).
- Sandbox verbs beyond read_file (no list, no grep — extendable later).

## Decisions

### Sliced pillar releases (inherited)

Option 1 of the solutions artifact: each FR lands as one config-gated slice in dependency order. All alternatives (kernel refactor, tool-loop-centric, parallel v2) carried strategy-inherent risk; this one matches the repo's 22-commit history shape.

### Pure-spoke pattern across all new modules (directional confirm)

Developer confirmed: follow plan-turn.ts:88-119 shape — zero runtime imports, type-only pi imports, thunks injected at the seam, plan* verbs, *Decision unions on action — across triggers.ts, memory.ts, sandbox.ts, and the eval cores.

### Single test file until FR9 (designer decision)

Developer deferred ("you decide"). Keep tests/test.mjs single through Slices 1-7 even past ~1,500 lines; FR9's eval/ is the documented second runner and carries the fixture-style tests. Matches TECH_DEBT_AUDIT's split rule and the solutions recommendation.

### Per-session latch isolation (ambiguity resolved)

Cross-session latch sharing is not provable statically (per-extension jiti, moduleCache:false; guard.ts:6-27 documents the deleted broken probe). Developer confirmed: accept per-session isolation. Helper agents are already vetoed by the marker scan, so a shared counter buys nothing.

### Eval adoption = outcome flip (ambiguity resolved)

Developer confirmed: "advice adopted" scores as the seeded continuation turn flipping its outcome to completed after the advice entry. Deterministic, fully offline, fewest fixtures.

### Token estimate = chars/4 (ambiguity resolved)

Developer confirmed: message size = JSON-rendered characters / 4. Pure, deterministic, offline-testable; no event threading; calibration deferred until eval scores demand it.

### Sandbox = read_file only (ambiguity resolved)

Developer confirmed: one read-only verb with byte-size and path bounds, pinned refusal for everything else. Smallest safe surface; extending later is additive.

### Digest rides a synthetic system message (designer decision)

The memory digest is built as a system message AFTER stripToolDeclarations, never appended to the stable advisor systemPrompt: per-fire data does not belong in instruction text, the strip keeps it tool-delta-free (prompt.ts:32-49), and it composes with the FR7 window as a fresh tail-side message. Research listed both options as valid; this one satisfies strictly more constraints.

### Tool loop shares one per-fire deadline (designer decision)

Each round's completeSimple call runs under callWithDeadline with the REMAINING budget (timeoutMs minus elapsed), not a fresh budget per round. Preserves the t16 deadline semantics and the "same deadline" wording of the solutions for specialists and tools alike.

### Trigger arms sit between the no-model arm and the cadence arm (evidence-pinned)

A trigger fire passes the same gate-pass as a cadence fire: outcome check, markFired, vetoes, resolve all run unchanged, so the latch spends exactly once per fire. The trigger thunk runs only when cadence missed (on-cadence turns pay nothing), and only when thresholds are armed (otherwise the seam passes undefined). The triggerOnError arm bypasses the outcome veto for "error" only; "aborted" always skips, and cadence-due errored turns keep the F007 slide.

### 1.4.x feature-detect folded into Slice 1

The version guard reads the same seam Slice 1 extends (event boundary fields). planHostSupport(outcome, context) is a pure core in plan-turn.ts; index.ts checks once per process, notifies once, and stays disabled below 1.4.

### Window fold order: strip -> fold -> tail (evidence-pinned)

buildAdvisorMessages becomes ensureUserTail(applyTokenBudget(stripToolDeclarations(llmMessages), budget)). The strip stays first in the pipeline; the tail guarantee runs last. All system messages are always kept; only user/assistant/toolResult middle messages fold. The prompt.ts "full transcript" banner comment is updated in Slice 2 (the invariant it documents is deliberately reversed).

## Architecture

### triggers.ts — NEW

Pure trigger predicates, thresholds-armed check, risky-tool list parser. Zero runtime imports.

```ts
/**
 * triggers.ts — multi-signal fire triggers for the advisor gate (FR3).
 *
 * Cadence asks "is it time?". Triggers ask "did something just happen that is
 * worth reviewing now?". A triggered turn fires AHEAD of cadence: it passes the
 * same gate-pass (outcome check, markFired, vetoes), so the latch spends exactly
 * once per fire no matter which arm passed.
 *
 * This module imports nothing, so the offline test resolves no package at all.
 * Signals arrive as plain data; the seam (index.ts) builds them defensively from
 * the event, so a host with missing fields degrades to nulls, never to a throw.
 */

/** One fire-worthy signal, named for pins and eval scoring. */
export type TriggerSignal = "error" | "tokens" | "pressure" | "risky-tool";

/** What planTrigger tells planGate to do. */
export type TriggerDecision =
  | { action: "none"; reason: string }
  | { action: "fire"; signal: TriggerSignal; detail?: string };

/** The per-turn signals the seam extracts. Every field tolerates absence. */
export interface TriggerSignals {
  /** totalTokens of the just-finished turn's message usage, or null when absent. */
  turnTokens: number | null;
  /** Context-window percent from ctx.getContextUsage(), or null when absent. */
  contextPercent: number | null;
  /** The boundary outcome: "completed" | "aborted" | "error" ("" when unknown). */
  outcome: string;
  /** toolName of every tool result this turn, in order. */
  toolNames: string[];
}

/** The clamp-guarded thresholds, pre-shaped by the seam from config. */
export interface TriggerThresholds {
  /** Fire when turnTokens >= this. 0 disables the signal. */
  minNewTokens: number;
  /** Fire when contextPercent >= this. 0 disables the signal. */
  contextPercent: number;
  /** Fire when the turn errored. Aborted turns never fire. */
  onError: boolean;
  /** Allowlisted tool names; a match on any tool result fires. Empty disables. */
  riskyTools: string[];
}

/**
 * Parse the config string "git push, rm" into a name list.
 *
 * Split on commas, trim each entry, drop empties. Names compare exactly
 * (case-sensitive, whole string) against toolResult toolName values, so the
 * user writes the tool's literal name.
 */
export function parseRiskyTools(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** True when at least one signal is armed. The seam passes no thunk otherwise. */
export function triggersArmed(thresholds: TriggerThresholds): boolean {
  return (
    thresholds.onError ||
    thresholds.minNewTokens > 0 ||
    thresholds.contextPercent > 0 ||
    thresholds.riskyTools.length > 0
  );
}

/**
 * Evaluate the four signals in a fixed order; the first armed hit fires.
 *
 * The order is load-bearing: trouble outcome first (the strongest look-now
 * signal), then token growth, then context pressure, then risky tools.
 * planGate bypasses the outcome veto only for the "error" signal, so that arm
 * must stay first for an errored turn to ever reach consult.
 */
export function planTrigger(
  signals: TriggerSignals,
  thresholds: TriggerThresholds,
): TriggerDecision {
  if (thresholds.onError && signals.outcome === "error") {
    return { action: "fire", signal: "error", detail: signals.outcome };
  }
  if (
    thresholds.minNewTokens > 0 &&
    signals.turnTokens !== null &&
    signals.turnTokens >= thresholds.minNewTokens
  ) {
    return { action: "fire", signal: "tokens", detail: String(signals.turnTokens) };
  }
  if (
    thresholds.contextPercent > 0 &&
    signals.contextPercent !== null &&
    signals.contextPercent >= thresholds.contextPercent
  ) {
    return { action: "fire", signal: "pressure", detail: String(signals.contextPercent) };
  }
  const risky = signals.toolNames.find((name) => thresholds.riskyTools.includes(name));
  if (risky !== undefined) {
    return { action: "fire", signal: "risky-tool", detail: risky };
  }
  return { action: "none", reason: "no signal" };
}
```

### memory.ts — NEW

Beside-module per-project store behind MEMORY_DIR_URL; count-cap newest-kept; pure digest builder producing a synthetic system message.

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Message } from "@earendil-works/pi-ai";

/**
 * memory.ts — per-project advisor memory (FR2).
 *
 * The store lives beside this module in .advisor-memory/, one JSON file per project
 * key. Each fire appends its advice; the cap keeps the newest entries; the next
 * fire's digest is a synthetic system message the seam injects at the recency end
 * of the advisor payload. The directory is gitignored from day one — deleting it
 * is a full reset.
 *
 * The I/O shape is cloned from config.ts: a beside-module URL whose href the test
 * suite swaps per window, ENOENT read as the normal empty state, every other read
 * or write failure warned once per process and degraded, never thrown. The gate's
 * never-throw contract covers this module: a failed memory write costs the next
 * fire its digest, never the current entry.
 *
 * The pi-ai import is TYPE-only, so the offline test resolves no package.
 */

/** One recorded piece of advice, in store order (oldest first, newest last). */
export interface MemoryEntry {
  /** Date.now() at the fire that recorded the entry, injected by the seam. */
  timestamp: number;
  /** The advisor's reply text, trimmed by recordAdvice. */
  text: string;
}

/**
 * The beside-module store directory. A mutable URL object on purpose — the same
 * affordance CONFIG_URL gives withConfig: the suite rewrites href per window and
 * restores it in a finally, with no restart and no production surface.
 */
export const MEMORY_DIR_URL = new URL(".advisor-memory/", import.meta.url);

/** Exact digest header prefix; the tests pin the full assembled text. */
export const DIGEST_HEADER_PREFIX = "Advisor memory from earlier fires";

/** Warn at most once per process — memory I/O runs on every fire while enabled. */
let memoryWarned = false;

function warnOnce(message: string): void {
  if (memoryWarned) return;
  memoryWarned = true;
  console.warn(message);
}

/**
 * Re-arm the warn-once latch. Test-only surface, the F002 affordance: the suite's
 * memory windows start fresh, so the memory tests carry no ordering constraint.
 */
export function resetMemoryWarnOnceForTest(): void {
  memoryWarned = false;
}

/** Slug cap for a store filename, leaving headroom under Windows path limits. */
const KEY_SLUG_MAX = 80;

/**
 * FNV-1a over the raw cwd, as a fixed-width hex suffix.
 *
 * The slug is truncated to keep store paths short beside an already-deep module
 * path; the hash distinguishes two long cwds whose truncated slugs collide.
 */
function hashKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A stable per-project store key for a working directory.
 *
 * Filename-safe slug of the cwd plus a hash of the untruncated cwd, so the same
 * directory always maps to the same file and different directories never share
 * one file's name.
 */
export function projectKeyFor(cwd: string): string {
  const slug = cwd.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, KEY_SLUG_MAX);
  return `${slug}-${hashKey(cwd)}`;
}

function storeUrl(key: string): URL {
  return new URL(`${key}.json`, MEMORY_DIR_URL);
}

/**
 * Keep the newest `cap` entries.
 *
 * A cap of 0 (memory off) or any non-finite cap yields the empty store shape;
 * at or under the cap the input array is returned as-is.
 */
export function capEntries(entries: MemoryEntry[], cap: number): MemoryEntry[] {
  if (!Number.isFinite(cap) || cap <= 0) return [];
  if (entries.length <= cap) return entries;
  return entries.slice(entries.length - cap);
}

/** Structural guard: one parsed element is a well-formed MemoryEntry. */
function isEntry(value: unknown): value is MemoryEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as { timestamp?: unknown; text?: unknown };
  return typeof entry.timestamp === "number" && typeof entry.text === "string";
}

/**
 * Parse one store file: the entries, or the reason a read failed.
 *
 * ENOENT is the normal first-fire state and comes back as ok with no entries.
 * Every other failure — corrupt JSON, a non-array body, a hostile store path —
 * comes back as not-ok with the reason for the caller to report.
 */
function parseStore(
  key: string,
): { ok: true; entries: MemoryEntry[] } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(storeUrl(key), "utf-8")) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, reason: "memory store is not a JSON array" };
    }
    return { ok: true, entries: parsed.filter(isEntry) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: true, entries: [] };
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read one project's entries, newest last.
 *
 * ENOENT is the normal first-fire state and stays silent. Every other read
 * failure warns once and reads as empty, so the next successful write rebuilds
 * a valid file from scratch. Wrong-shaped elements inside an otherwise valid
 * array are dropped silently by the structural guard.
 */
export function readEntries(key: string): MemoryEntry[] {
  const read = parseStore(key);
  if (read.ok) return read.entries;
  warnOnce(
    `[advisor-turn-gate] ignoring unreadable advisor memory (${read.reason}); treating as empty`,
  );
  return [];
}

/**
 * The write path's silent pre-read: a failed read is subsumed by the whole-file
 * write that follows, so only the write's own failure is ever reported.
 */
function readEntriesQuiet(key: string): MemoryEntry[] {
  const read = parseStore(key);
  return read.ok ? read.entries : [];
}

/**
 * Append one fire's advice to a project's store, keeping only the newest cap.
 *
 * Never throws: this is the gate's fail-open contract applied to memory. Blank
 * advice is skipped rather than stored. The pre-read is silent, so a corrupt
 * store is overwritten whole and self-heals without a warning; a failed WRITE
 * warns once, and the entries already on disk stay untouched because the new
 * file is written atomically-whole (one writeFileSync per fire).
 */
export function recordAdvice(key: string, text: string, cap: number, timestamp: number): void {
  const trimmed = text.trim();
  if (!trimmed || !Number.isFinite(cap) || cap <= 0) return;
  try {
    const entries = capEntries([...readEntriesQuiet(key), { timestamp, text: trimmed }], cap);
    mkdirSync(MEMORY_DIR_URL, { recursive: true });
    writeFileSync(storeUrl(key), `${JSON.stringify(entries, null, 2)}\n`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnOnce(`[advisor-turn-gate] advisor memory write failed (${reason}); continuing without it`);
  }
}

/**
 * Build the digest as a synthetic system message, or undefined for an empty store.
 *
 * Entries appear oldest first, so the digest reads chronologically and the newest
 * advice sits closest to the tail of the advisor payload. The timestamp is
 * injected by the seam; the builder stays pure.
 */
export function digestMessage(entries: MemoryEntry[], timestamp: number): Message | undefined {
  if (entries.length === 0) return undefined;
  const lines = entries.map((entry) => `- ${entry.text}`);
  const noun = entries.length === 1 ? "entry" : "entries";
  return {
    role: "system",
    content: `${DIGEST_HEADER_PREFIX} (${entries.length} ${noun}):\n${lines.join("\n")}`,
    timestamp,
  };
}
```

### sandbox.ts — NEW

The advisor's single read_file verb: a pure `planRead` path bound, an FsLike-injected executor (the ModelRegistryLike pattern applied to node:fs), the declared READ_FILE_TOOL surface, and the pinned refusal. The SandboxResult data replays as ToolResultMessage entries in advisor.ts's loop.

```ts
import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * sandbox.ts — the advisor's read_file-only tool sandbox (FR4).
 *
 * The host exposes no extension file-read API from turn_end (research, verified):
 * ExtensionToolContext.executeTool exists only inside a tool's execute(), so this
 * module self-executes the one allowlisted read through node:fs and hands the
 * result back as plain data for the tool loop in advisor.ts to replay as a
 * ToolResultMessage entry.
 *
 * Two layers:
 *   - planRead is the PURE path bound: resolve against the root, refuse escapes.
 *     No fs, so the offline suite pins it with zero I/O.
 *   - createSandbox is the I/O closure behind a structural FsLike seam: the
 *     allowlist gate, the realpath escape re-check (symlinks), the byte cap, and
 *     the read itself. The seam defaults to node:fs; the suite injects stubs, so
 *     every failure shape is deterministic on every platform. It NEVER throws —
 *     every failure comes back as { ok: false, reason } for the loop to feed the
 *     advisor as an errored tool result, the same fail-open shape as everywhere
 *     else in the gate.
 *
 * The refusal strings are contract (pinned by t25) and carry no angle-bracket
 * markup vocabulary, so they cannot interact with stripAdvisorMarkup's tiers:
 * the strip stays the last filter on the COMMITTED text, and nothing this module
 * produces reaches the commit without passing through it.
 *
 * This module imports no sibling, so the offline test resolves nothing beyond
 * node builtins.
 */

/** The only tool name this sandbox executes. Everything else is refused. */
export const READ_FILE_TOOL_NAME = "read_file";

/**
 * Hard byte cap on one sandboxed read. A module constant, not a config field:
 * the decomposition scopes Slice 5 to toolsEnabled + maxToolRounds, and a cap
 * that only ever protects the payload size does not need per-project tuning.
 * 64 KiB is ample for a source file and small enough that it cannot flood the
 * advisor payload.
 */
export const SANDBOX_MAX_BYTES = 65536;

/** One sandbox execution: the text to feed the advisor, or why it refused. */
export type SandboxResult = { ok: true; text: string } | { ok: false; reason: string };

/** The seam-facing executor shape; advisor.ts calls this once per ToolCall block. */
export type AdvisorSandbox = (name: string, args: unknown) => SandboxResult;

/**
 * The pinned refusal for any tool name other than read_file.
 *
 * One function so the string has exactly one source: the loop's tests pin it
 * through this export, so a wording change fails the suite instead of drifting.
 */
export function sandboxRefusalFor(name: string): string {
  return `advisor sandbox refused "${name}": only read_file is allowed`;
}

/** What planRead decided about one requested path. */
export type ReadDecision =
  | { action: "allow"; absolute: string }
  | { action: "refuse"; reason: string };

/**
 * The pure path bound: resolve the request against the root, refuse escapes.
 *
 * No fs here — the prefix check runs on the RESOLVED path only. The symlink
 * case (a path that resolves inside but points outside) is the I/O closure's
 * job: createSandbox re-checks the prefix against the injected realpath's
 * answer.
 */
export function planRead(root: string, requested: unknown): ReadDecision {
  if (typeof requested !== "string" || requested.trim() === "") {
    return {
      action: "refuse",
      reason: 'advisor sandbox refused the read: "path" must be a non-empty string',
    };
  }
  const normalizedRoot = resolve(root);
  const absolute = resolve(normalizedRoot, requested);
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  if (absolute !== normalizedRoot && !absolute.startsWith(rootWithSep)) {
    return {
      action: "refuse",
      reason: `advisor sandbox refused "${requested}": outside the project directory`,
    };
  }
  return { action: "allow", absolute };
}

/**
 * The structural fs seam (the ModelRegistryLike pattern, applied to node:fs).
 *
 * The default wires node's own functions; the suite injects stubs so the
 * symlink-escape and read-error shapes are pinned without platform-dependent
 * fixtures. Narrow on purpose: the sandbox reads buffers and realpaths strings,
 * nothing else.
 */
export interface FsLike {
  readFileSync(path: string): Buffer;
  realpathSync(path: string): string;
}

const defaultFs: FsLike = { readFileSync, realpathSync };

/** Structural shape of a declared tool (pi-ai Tool, duck-typed; no sibling import). */
interface DeclaredTool {
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * The declared tool surface handed to completeSimple when toolsEnabled is on.
 *
 * The parameters value is a plain JSON-Schema object: the real pi-ai Tool type
 * narrows it to typebox, but every consumer on this path is structural, and a
 * plain object keeps typebox out of the offline test's module graph entirely.
 */
export const READ_FILE_TOOL: DeclaredTool = {
  name: READ_FILE_TOOL_NAME,
  description:
    "Read one file from the project directory. Returns the file text up to a hard byte " +
    "cap. Paths must stay inside the project directory.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project-relative path, or an absolute path inside the project directory.",
      },
    },
    required: ["path"],
  },
};

/**
 * Build the sandbox executor for one project root.
 *
 * maxBytes defaults to SANDBOX_MAX_BYTES and fs to node's own functions; the
 * suite passes a small explicit cap and stub fs objects to pin the size,
 * escape, and read-error refusals deterministically.
 */
export function createSandbox(
  root: string,
  maxBytes: number = SANDBOX_MAX_BYTES,
  fs: FsLike = defaultFs,
): AdvisorSandbox {
  return (name, args) => {
    // The allowlist gate comes first: one verb, everything else refused by name.
    if (name !== READ_FILE_TOOL_NAME) {
      return { ok: false, reason: sandboxRefusalFor(name) };
    }
    const path = (args as { path?: unknown } | null | undefined)?.path;
    const plan = planRead(root, path);
    if (plan.action === "refuse") return { ok: false, reason: plan.reason };
    const requested = path as string;
    try {
      // Symlink escape re-check: the REAL path must still live under the root.
      // A missing file throws ENOENT here, which the catch reports as the
      // ordinary no-such-file outcome.
      const real = fs.realpathSync(plan.absolute);
      const normalizedRoot = resolve(root);
      const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
      if (real !== normalizedRoot && !real.startsWith(rootWithSep)) {
        return {
          ok: false,
          reason: `advisor sandbox refused "${requested}": outside the project directory`,
        };
      }
      // Read the whole file and cap on the BUFFER LENGTH, not a stat: one
      // syscall fewer and no size race between stat and read.
      const bytes = fs.readFileSync(real);
      if (bytes.length > maxBytes) {
        return {
          ok: false,
          reason: `advisor sandbox refused "${requested}": ${bytes.length} bytes exceeds the ${maxBytes} byte cap`,
        };
      }
      return { ok: true, text: bytes.toString("utf-8") };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ok: false, reason: `advisor sandbox refused "${requested}": no such file` };
      }
      if (code === "EISDIR") {
        return { ok: false, reason: `advisor sandbox refused "${requested}": not a file` };
      }
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `advisor sandbox refused "${requested}": ${reason}` };
    }
  };
}
```

### eval/runner.mjs — NEW

Second offline runner: per-fixture JSON scenarios replayed through planGate -> scripted facade -> planCommit with the index.ts seam thunks; eight pinned scores over six fixtures; a gate self-test; process.exitCode gate.

```js
/**
 * eval/runner.mjs — the offline eval harness (FR9), the sanctioned second runner.
 *
 * TECH_DEBT_AUDIT.md sets the split rule ("~1,500 lines or when a second runner
 * appears"); this directory is that second runner. Each fixture under eval/fixtures/
 * seeds one pillar's scenario as pure JSON: a projected llmMessages context, the gate
 * config, per-turn trigger signals, a scripted completion facade, and optional sandbox
 * or memory state. The runner replays the REAL pipeline — planGate, buildAdvisorMessages,
 * runAdvisor over the scripted facade, planCommit — binding the same seam thunks
 * index.ts binds (Region D triggers, Region G digest, Region S6-B specialist), then
 * scores the committed entries.
 *
 * The scores are the CI gate: the exit code is 1 when any fixture errors or any score
 * fails. A gate that cannot fail is not a gate, so the runner self-tests the scorer on
 * startup: a known-false expectation must register as a failure before any fixture runs.
 *
 * Offline by construction: no live model, no auth, no network. The completion facade is
 * a queue of scripted responses; the model registry is a two-line stub that resolves any
 * "stub/..." key. Memory I/O lands in a per-fixture temp dir behind the MEMORY_DIR_URL
 * affordance (the withConfig pattern), so no real store is ever touched.
 *
 * Run: npm run eval   (node --experimental-strip-types eval/runner.mjs)
 * Score names and reason strings are contract, same as the unit suite: a rename here is
 * a CI-visible change, not a refactor.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONSULT_ANSWER_HEADER,
  CONSULT_SECTION_SEPARATOR,
  resolveAdvisorModel,
  runAdvisor,
  stripAdvisorMarkup,
} from "../advisor.ts";
import { DEFAULT_CONFIG, parseModelKey, shouldFire } from "../config.ts";
import {
  DIGEST_HEADER_PREFIX,
  MEMORY_DIR_URL,
  digestMessage,
  projectKeyFor,
  readEntries,
  recordAdvice,
} from "../memory.ts";
import { planCommit, planGate, stampDetails } from "../plan-turn.ts";
import {
  BUDGET_FOLD_MARKER_PREFIX,
  buildAdvisorMessages,
  estimateMessageTokens,
} from "../prompt.ts";
import { READ_FILE_TOOL, SANDBOX_MAX_BYTES, createSandbox } from "../sandbox.ts";
import { parseRiskyTools, planTrigger, triggersArmed } from "../triggers.ts";

/**
 * One fixed clock for every replay (FR2 timestamps and digest stamps). Dates never
 * print, so a constant keeps the output byte-stable across runs and machines.
 */
const CLOCK = 1751500000000;

/**
 * The fold marker's estimated cost, re-declared at the value of prompt.ts's unexported
 * MARKER_TOKEN_ALLOWANCE (the DEFAULT_MAX_TOOL_ROUNDS parity pattern). The
 * budget-respected score bounds the built payload at budget + this slack, which is
 * exactly the guarantee the fold's own exit condition provides.
 */
const MARKER_SLACK = 64;

/** The pinned score names. The fixtures declare a subset; unknown names fail their fixture. */
const SCORES = {
  "drift-caught": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    return entry !== undefined && entry.content.includes(fixture.expect.adviceIncludes);
  },
  "budget-respected": (replay, fixture) => {
    const built = replay.builtMessages ?? [];
    const total = built.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    const markerRan = built.some((message) =>
      messageText(message).startsWith(BUDGET_FOLD_MARKER_PREFIX),
    );
    const systemsKept = fixture.systemTexts.every((text) =>
      built.some((message) => messageText(message).includes(text)),
    );
    return markerRan && systemsKept && total <= fixture.config.tokenBudget + MARKER_SLACK;
  },
  "sandbox-read-applied": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    return (
      entry !== undefined &&
      replay.facadeCalls === fixture.expect.facadeCalls &&
      entry.content.includes(fixture.expect.adviceIncludes)
    );
  },
  "single-entry-aggregation": (replay) => {
    if (replay.commits.length !== 1) return false;
    const text = replay.commits[0]?.content;
    if (typeof text !== "string" || text.includes("\n\n\n")) return false;
    const parts = text.split(CONSULT_SECTION_SEPARATOR);
    return parts.length === 2 && parts[1].startsWith(CONSULT_ANSWER_HEADER);
  },
  "allowlist-refused": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    if (entry === undefined || entry.content.includes(fixture.expect.adviceExcludes)) return false;
    const toolResults = (replay.lastFacadeMessages ?? []).filter((m) => m.role === "toolResult");
    return toolResults.some(
      (m) => m.isError === true && messageText(m).includes(fixture.expect.toolResultIncludes),
    );
  },
  "repeats-avoided": (replay, fixture) => {
    const digest = (replay.builtMessages ?? []).find(
      (message) =>
        message.role === "system" && messageText(message).startsWith(DIGEST_HEADER_PREFIX),
    );
    if (digest === undefined || !messageText(digest).includes(fixture.expect.digestIncludes)) {
      return false;
    }
    const prior = fixture.priorEntries.at(-1)?.text;
    const entry = replay.commits.at(-1);
    return entry !== undefined && entry.content !== prior;
  },
  "dialogue-keys": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    const details = entry?.details;
    return (
      details !== undefined &&
      details.fire === fixture.expect.details.fire &&
      details.turn === fixture.expect.details.turn
    );
  },
  "advice-adopted": (replay, fixture) => {
    return replay.lastResult?.continue === true && fixture.continuation?.outcome === "completed";
  },
};

/** Flatten one Message to text: system content is a string, the rest are block arrays. */
function messageText(message) {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => block.text ?? "").join("\n");
}

/** The score evaluation primitive. Only literal true passes; the self-test pins both arms. */
function evaluateScore(name, pass) {
  return { name, pass: pass === true };
}

/**
 * The gate self-test: a known-true expectation passes and a known-false one fails.
 * If the scorer could not register a failure, every later PASS row would be noise —
 * the runner must prove its own gate before gating anything else.
 */
function selfTestGate() {
  return evaluateScore("gate-self-test", true).pass && !evaluateScore("gate-self-test", false).pass;
}

/** A registry stub that resolves any "stub/..." key (find + the credential snapshot). */
function makeRegistry() {
  const model = { provider: "stub", id: "stub-model" };
  return {
    find: () => model,
    getAvailable: () => [{ provider: "stub", id: "stub-model" }],
    runtime: { completeSimple: undefined },
  };
}

/**
 * The scripted completion facade: the replay re-points state.currentScript at each
 * turn's facade before its calls, and the queue shifts per call — advisor rounds and
 * consult legs draw from the same turn script. The captured context of the LAST call
 * carries the replayed toolResult messages the allowlist-refused score inspects. An
 * exhausted queue yields a deterministic no-text stop response, so the fire fails open
 * instead of hanging.
 */
function makeFacade(state) {
  return (model, context) => {
    state.facadeCalls += 1;
    state.lastFacadeMessages = context.messages;
    const script = state.currentScript ?? [];
    const next =
      script.length > 0
        ? script.shift()
        : { stopReason: "stop", content: [{ type: "text", text: "" }] };
    return Promise.resolve(next);
  };
}

/**
 * Per-fixture isolation: a temp project root for the sandbox (fixture sandboxFiles
 * written inside, the optional outsideFile written beside it but OUTSIDE the root) and
 * a temp memory dir swapped in behind MEMORY_DIR_URL, seeded from priorEntries.
 * Cleanup restores the real href and removes both temp trees even on a throwing replay.
 */
function makeEnv(fixture) {
  const tempRoot = mkdtempSync(join(tmpdir(), "advisor-eval-"));
  const project = join(tempRoot, "project");
  mkdirSync(project, { recursive: true });
  for (const [name, text] of Object.entries(fixture.sandboxFiles ?? {})) {
    const file = join(project, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  if (fixture.outsideFile !== undefined) {
    writeFileSync(join(tempRoot, fixture.outsideFile.name), fixture.outsideFile.text);
  }
  const memDir = mkdtempSync(join(tmpdir(), "advisor-eval-mem-"));
  const realHref = MEMORY_DIR_URL.href;
  MEMORY_DIR_URL.href = pathToFileURL(memDir + "/").href;
  if ((fixture.priorEntries ?? []).length > 0) {
    const key = projectKeyFor(project);
    writeFileSync(
      join(memDir, key + ".json"),
      JSON.stringify(fixture.priorEntries, null, 2) + "\n",
    );
  }
  return {
    project,
    restore: () => {
      MEMORY_DIR_URL.href = realHref;
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(memDir, { recursive: true, force: true });
    },
  };
}

/**
 * Replay one fixture through the blocking-mode pipeline, mirroring the index.ts seam:
 * the Region D trigger thunk (armed only when thresholds say so), the Region G
 * buildMessages thunk (digest when memoryCap allows), the Region S6-B specialist
 * resolution, the Region H post-commit memory record, and the Region I details stamp.
 * State (latch, fire count, captures) lives across the fixture's turns in order.
 */
async function replayFixture(fixture) {
  const env = makeEnv(fixture);
  const state = {
    lastFiredTurn: -1,
    fireCount: 0,
    commits: [],
    lastResult: undefined,
    notified: [],
    facadeCalls: 0,
    builtMessages: undefined,
    lastFacadeMessages: undefined,
    currentScript: [],
  };
  try {
    const config = { ...DEFAULT_CONFIG, ...fixture.config };
    const registry = makeRegistry();
    registry.runtime.completeSimple = makeFacade(state);
    const key = projectKeyFor(env.project);
    // Region D mirror: thresholds shaped from config, the thunk armed only when armed.
    const thresholds = {
      minNewTokens: config.triggerMinNewTokens,
      contextPercent: config.triggerContextPercent,
      onError: config.triggerOnError,
      riskyTools: parseRiskyTools(config.triggerRiskyTools),
    };
    // Region S6-B mirror: the specialist resolves at fire time or stays undefined.
    let specialist;
    if (config.specialistModel) {
      const parsed = parseModelKey(config.specialistModel);
      if (parsed) {
        const resolution = resolveAdvisorModel(registry, parsed.provider, parsed.modelId);
        if (resolution.ok) {
          specialist = { model: resolution.model, systemPrompt: config.specialistSystemPrompt };
        }
      }
    }
    for (const turn of fixture.turns) {
      state.currentScript = turn.facade ?? [];
      const gate = planGate({
        enabled: config.enabled,
        model: config.model,
        interval: config.interval,
        systemPrompt: config.systemPrompt,
        timeoutMs: config.timeoutMs,
        turnIndex: turn.turnIndex,
        outcome: turn.outcome,
        llmMessages: turn.llmMessages,
        lastFiredTurn: state.lastFiredTurn,
        gates: shouldFire,
        isChild: () => false,
        parseModel: () => parseModelKey(config.model),
        resolve: (provider, modelId) => resolveAdvisorModel(registry, provider, modelId),
        // Region G mirror: the digest rides the same thunk, paying only on a fire.
        buildMessages: (messages) => {
          const digest =
            config.memoryCap > 0 ? digestMessage(readEntries(key), CLOCK) : undefined;
          return buildAdvisorMessages(messages, config.tokenBudget, digest);
        },
        markFired: (turnIndex) => {
          state.lastFiredTurn = turnIndex;
        },
        trigger:
          triggersArmed(thresholds) && turn.signals !== undefined
            ? () => planTrigger(turn.signals, thresholds)
            : undefined,
      });
      if (gate.action === "skip") continue;
      if (gate.action === "notify") {
        state.notified.push(gate.message);
        continue;
      }
      state.builtMessages = gate.messages;
      const outcome = await runAdvisor({
        registry,
        model: gate.model,
        systemPrompt: gate.systemPrompt,
        messages: gate.messages,
        timeoutMs: gate.timeoutMs,
        tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined,
        executeTool: config.toolsEnabled
          ? createSandbox(env.project, SANDBOX_MAX_BYTES)
          : undefined,
        maxToolRounds: config.maxToolRounds,
        specialist,
      });
      const commit = planCommit({
        outcome,
        customType: config.customType,
        display: config.display,
        peerEntries: [],
        strip: stripAdvisorMarkup,
        details: stampDetails(state.fireCount + 1, turn.turnIndex),
      });
      if (commit.action === "notify") {
        state.notified.push(commit.message);
        continue;
      }
      state.commits.push(commit.result.entries.at(-1));
      state.lastResult = commit.result;
      state.fireCount += 1;
      // Region H mirror: the commit-stripped text is what enters the digest channel.
      if (outcome.ok && config.memoryCap > 0) {
        recordAdvice(key, stripAdvisorMarkup(outcome.text), config.memoryCap, CLOCK);
      }
    }
    return { ...state, error: undefined };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ...state, error: reason };
  } finally {
    env.restore();
  }
}

/** One fixture's structural contract, checked before any score runs. */
function structuralFailure(replay, fixture) {
  if (replay.error !== undefined) return `replay threw: ${replay.error}`;
  const expectedCommits = fixture.expect?.commits ?? 0;
  if (replay.commits.length !== expectedCommits) {
    return `expected ${expectedCommits} commit(s), replay produced ${replay.commits.length}`;
  }
  return undefined;
}

async function main() {
  if (!selfTestGate()) {
    console.log("eval: gate self-test FAIL (a known-false expectation did not register)");
    process.exitCode = 1;
    return;
  }
  console.log("eval: gate self-test PASS");
  const files = readdirSync(new URL("./fixtures/", import.meta.url))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    console.log("eval: no fixtures found");
    process.exitCode = 1;
    return;
  }
  let fixturesGreen = 0;
  let totalScores = 0;
  let passedScores = 0;
  for (const file of files) {
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(new URL("./fixtures/" + file, import.meta.url), "utf-8"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`eval: ${file} ERROR (unreadable fixture: ${reason})`);
      process.exitCode = 1;
      continue;
    }
    const replay = await replayFixture(fixture);
    const failure = structuralFailure(replay, fixture);
    if (failure !== undefined) {
      console.log(`eval: ${fixture.name} ERROR (${failure})`);
      process.exitCode = 1;
      continue;
    }
    fixturesGreen += 1;
    for (const name of fixture.scores) {
      totalScores += 1;
      const check = SCORES[name];
      if (check === undefined) {
        console.log(`eval: ${fixture.name}/${name} FAIL (unknown score name)`);
        process.exitCode = 1;
        continue;
      }
      const { pass } = evaluateScore(name, check(replay, fixture));
      console.log(`eval: ${fixture.name}/${name} ${pass ? "PASS" : "FAIL"}`);
      if (pass) passedScores += 1;
      else process.exitCode = 1;
    }
  }
  console.log(
    `eval: ${fixturesGreen}/${files.length} fixture(s) replayed, ` +
      `${passedScores}/${totalScores} score(s) pass`,
  );
}

await main();
```

### eval/fixtures/allowlist-refusal.json — NEW

Golden fixture for FR4 (allowlist refusal    ).

```json
{
  "name": "allowlist-refusal",
  "pillar": "FR4",
  "config": {
    "model": "stub/stub-model",
    "interval": 10,
    "timeoutMs": 1000,
    "toolsEnabled": true,
    "maxToolRounds": 3
  },
  "outsideFile": {
    "name": "secrets.env",
    "text": "SECRET_MARKER the deploy token lives here"
  },
  "turns": [
    {
      "turnIndex": 9,
      "outcome": "completed",
      "llmMessages": [
        { "role": "system", "content": "You are the executor.", "timestamp": 1 },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "The deploy failed. Find the token config." }],
          "timestamp": 2
        },
        {
          "role": "assistant",
          "content": [{ "type": "text", "text": "I will check the environment files." }],
          "timestamp": 3
        }
      ],
      "facade": [
        {
          "stopReason": "toolUse",
          "content": [
            {
              "type": "toolCall",
              "id": "call-1",
              "name": "read_file",
              "arguments": { "path": "../secrets.env" }
            }
          ]
        },
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "The read outside the project was refused, so I cannot see the token file. From the transcript: the deploy script never loads secrets.env. Wire it into the deploy step and rerun."
            }
          ]
        }
      ]
    }
  ],
  "expect": {
    "commits": 1,
    "toolResultIncludes": "outside the project directory",
    "adviceExcludes": "SECRET_MARKER"
  },
  "scores": ["allowlist-refused"]
}
```

### eval/fixtures/budget-window.json — NEW

Golden fixture for FR7 (budget window    ).

```json
{
  "name": "budget-window",
  "pillar": "FR7",
  "config": {
    "model": "stub/stub-model",
    "interval": 10,
    "timeoutMs": 1000,
    "tokenBudget": 500
  },
  "systemTexts": ["SYSTEM ONE", "SYSTEM TWO"],
  "turns": [
    {
      "turnIndex": 9,
      "outcome": "completed",
      "llmMessages": [
        { "role": "system", "content": "SYSTEM ONE: prefer plain functions.", "timestamp": 1 },
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass. u1: the retry helper widens the loop and the tests still pass."
            }
          ],
          "timestamp": 2
        },
        {
          "role": "assistant",
          "content": [
            {
              "type": "text",
              "text": "a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch. a1: the loop now retries on every failure and the helper grew another branch."
            }
          ],
          "timestamp": 3
        },
        { "role": "system", "content": "SYSTEM TWO: log with the module tag.", "timestamp": 4 },
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "u2: the second pass rewrote the retry gate again and the suite is slower. u2: the second pass rewrote the retry gate again and the suite is slower. u2: the second pass rewrote the retry gate again and the suite is slower. u2: the second pass rewrote the retry gate again and the suite is slower. u2: the second pass rewrote the retry gate again and the suite is slower. u2: the second pass rewrote the retry gate again and the suite is slower. u2: the second pass rewrote the retry gate again and the suite is slower."
            }
          ],
          "timestamp": 5
        },
        {
          "role": "assistant",
          "content": [
            {
              "type": "text",
              "text": "a2: the gate now nests and the helper is hard to follow. a2: the gate now nests and the helper is hard to follow. a2: the gate now nests and the helper is hard to follow. a2: the gate now nests and the helper is hard to follow. a2: the gate now nests and the helper is hard to follow. a2: the gate now nests and the helper is hard to follow."
            }
          ],
          "timestamp": 6
        },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "Latest note: the retry loop stalls on the third pass." }],
          "timestamp": 7
        }
      ],
      "facade": [
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "The retry gate nests three deep and the helper carries two branches. Flatten it: one retry path, one cap, one log line."
            }
          ]
        }
      ]
    }
  ],
  "expect": { "commits": 1 },
  "scores": ["budget-respected"]
}
```

### eval/fixtures/consult-aggregation.json — NEW

Golden fixture for FR6 (consult aggregation    ).

```json
{
  "name": "consult-aggregation",
  "pillar": "FR6",
  "config": {
    "model": "stub/stub-model",
    "interval": 10,
    "timeoutMs": 1000,
    "specialistModel": "stub/stub-model",
    "specialistSystemPrompt": "Answer as a domain specialist.",
    "maxToolRounds": 3
  },
  "turns": [
    {
      "turnIndex": 9,
      "outcome": "completed",
      "llmMessages": [
        { "role": "system", "content": "You are the executor.", "timestamp": 1 },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "The indexer lags on large repos. Why?" }],
          "timestamp": 2
        },
        {
          "role": "assistant",
          "content": [{ "type": "text", "text": "I profiled the walk; the lag grows with repo size." }],
          "timestamp": 3
        }
      ],
      "facade": [
        {
          "stopReason": "toolUse",
          "content": [
            {
              "type": "toolCall",
              "id": "call-1",
              "name": "consult_specialist",
              "arguments": { "question": "What is the usual cause of indexer lag on large repos?" }
            }
          ]
        },
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "Unbounded directory walks without a VCS ignore filter are the usual cause."
            }
          ]
        },
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "The walk visits node_modules and .git. Add the VCS ignore filter before the walk and re-measure."
            }
          ]
        }
      ]
    }
  ],
  "expect": { "commits": 1, "facadeCalls": 3 },
  "scores": ["single-entry-aggregation"]
}
```

### eval/fixtures/dialogue-keys.json — NEW

Golden fixture for FR1+FR2 (dialogue keys    ).

```json
{
  "name": "dialogue-keys",
  "pillar": "FR1+FR2",
  "config": {
    "model": "stub/stub-model",
    "interval": 10,
    "timeoutMs": 1000,
    "memoryCap": 5
  },
  "priorEntries": [
    {
      "timestamp": 100,
      "text": "Earlier fire: extract the retry helper before widening the loop."
    }
  ],
  "turns": [
    {
      "turnIndex": 9,
      "outcome": "completed",
      "llmMessages": [
        { "role": "system", "content": "You are the executor.", "timestamp": 1 },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "The sync loop is in. Review it." }],
          "timestamp": 2
        },
        {
          "role": "assistant",
          "content": [
            { "type": "text", "text": "The sync loop landed with its own retry path." }
          ],
          "timestamp": 3
        }
      ],
      "facade": [
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "The sync loop grew a second retry path beside the extracted helper. Keep one retry path and cap attempts at 3."
            }
          ]
        }
      ]
    }
  ],
  "continuation": { "turnIndex": 10, "outcome": "completed" },
  "expect": {
    "commits": 1,
    "details": { "fire": "1", "turn": "9" },
    "digestIncludes": "Earlier fire"
  },
  "scores": ["repeats-avoided", "dialogue-keys", "advice-adopted"]
}
```

### eval/fixtures/tool-use-script.json — NEW

Golden fixture for FR4 (tool use script    ).

```json
{
  "name": "tool-use-script",
  "pillar": "FR4",
  "config": {
    "model": "stub/stub-model",
    "interval": 10,
    "timeoutMs": 1000,
    "toolsEnabled": true,
    "maxToolRounds": 3
  },
  "sandboxFiles": {
    "docs/notes.md": "The rate limiter caps retries at 3 per minute."
  },
  "turns": [
    {
      "turnIndex": 9,
      "outcome": "completed",
      "llmMessages": [
        { "role": "system", "content": "You are the executor.", "timestamp": 1 },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "Why do the sync retries stall?" }],
          "timestamp": 2
        },
        {
          "role": "assistant",
          "content": [{ "type": "text", "text": "I wrote docs/notes.md while investigating." }],
          "timestamp": 3
        }
      ],
      "facade": [
        {
          "stopReason": "toolUse",
          "content": [
            {
              "type": "toolCall",
              "id": "call-1",
              "name": "read_file",
              "arguments": { "path": "docs/notes.md" }
            }
          ]
        },
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "The rate limiter caps retries at 3 per minute, and the sync loop burns all 3 on one batch. Space the batches or raise the cap deliberately."
            }
          ]
        }
      ]
    }
  ],
  "expect": { "commits": 1, "facadeCalls": 2, "adviceIncludes": "caps retries at 3 per minute" },
  "scores": ["sandbox-read-applied"]
}
```

### eval/fixtures/trigger-arms.json — NEW

Golden fixture for FR3 (trigger arms    ).

```json
{
  "name": "trigger-arms",
  "pillar": "FR3",
  "config": {
    "model": "stub/stub-model",
    "interval": 10,
    "timeoutMs": 1000,
    "triggerOnError": true
  },
  "turns": [
    {
      "turnIndex": 3,
      "outcome": "error",
      "llmMessages": [
        { "role": "system", "content": "You are the executor.", "timestamp": 1 },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "Run the auth suite and fix what fails." }],
          "timestamp": 2
        },
        {
          "role": "assistant",
          "content": [
            { "type": "text", "text": "The run failed: auth.spec.ts:42 expected 200 got 401." }
          ],
          "timestamp": 3
        },
        {
          "role": "user",
          "content": [{ "type": "text", "text": "The turn errored before any fix landed." }],
          "timestamp": 4
        }
      ],
      "signals": {
        "turnTokens": 1200,
        "contextPercent": 31,
        "outcome": "error",
        "toolNames": []
      },
      "facade": [
        {
          "stopReason": "stop",
          "content": [
            {
              "type": "text",
              "text": "auth.spec.ts:42 fails because the request omits the auth header. Attach the bearer token before the client retries."
            }
          ]
        }
      ]
    }
  ],
  "expect": { "commits": 1, "adviceIncludes": "auth.spec.ts:42" },
  "scores": ["drift-caught"]
}
```

### index.ts — MODIFY

Slices 1, 2, 3, 4, 5, 6, 7: trigger thunk + signals builder + host-support latch (1), budget binding (2), memory read/write + digest injection (3), fire metadata for details stamping (4), sandbox wiring (5), specialist wiring (6), async abstain + agent_before_settle registration (7).

```ts
Slices 1, 2, 3, 4, 7 regions (merged). implement reads the original at disk.

Region A — imports (Slices 1, 3, 4 merged: the plan-turn line REPLACES the original
two-symbol import in place; the memory line inserts between the guard and plan-turn
imports, alphabetical):

import { digestMessage, projectKeyFor, readEntries, recordAdvice } from "./memory";
import { planCommit, planGate, planHostSupport, stampDetails } from "./plan-turn";
import { parseRiskyTools, planTrigger, triggersArmed } from "./triggers";

import { planCommit, planGate, planHostSupport } from "./plan-turn";
import { parseRiskyTools, planTrigger, triggersArmed } from "./triggers";

Region B — factory closure, after `let lastFiredTurn = -1;` (Slices 1, 4 merged):

  // The 1.4 boundary check runs at most once per process, and only when the gate
  // would actually run (enabled with a model): a deliberately disabled gate on an
  // old host must not warn about a problem it never intended to hit.
  let hostChecked = false;
  let hostSupported = true;

  // FR1: the dialogue counter. It advances ONLY when a commit lands, so the
  // stamped ordinals stay dense: entry k carries fire k. A vetoed gate-pass or
  // a failed advisor call burns no ordinal (unlike the latch, this is identity,
  // not rate control — the F007 spend-early rule does not apply).
  let fireCount = 0;

Region C — handler top, after `const config = loadConfig();`:

    if (!hostChecked && config.enabled && config.model) {
      hostChecked = true;
      const support = planHostSupport(event.outcome, event.context);
      if (!support.supported) {
        hostSupported = false;
        reportFailure(ctx, support.message);
      }
    }
    if (!hostSupported) return;

Region D — planGate args, after the buildMessages line (thresholds built just above the planGate call):

    const thresholds = {
      minNewTokens: config.triggerMinNewTokens,
      contextPercent: config.triggerContextPercent,
      onError: config.triggerOnError,
      riskyTools: parseRiskyTools(config.triggerRiskyTools),
    };

      // FR3: the trigger thunk closes over this turn's event and the context.
      // Signals read defensively so a partially-shaped event degrades to nulls,
      // never to a throw; the thunk itself runs only on a cadence miss.
      trigger: triggersArmed(thresholds)
        ? () =>
            planTrigger(
              {
                turnTokens:
                  (event.message as { usage?: { totalTokens?: number } } | undefined)?.usage
                    ?.totalTokens ?? null,
                contextPercent: ctx.getContextUsage?.()?.percent ?? null,
                outcome: typeof event.outcome === "string" ? event.outcome : "",
                toolNames: (event.toolResults ?? []).map((result) => result.toolName),
              },
              thresholds,
            )
        : undefined,

Region E — planGate args, the buildMessages line. (Superseded by Slice 3's Region G below; kept for the slice-2 diff history.) Replace:

      buildMessages: buildAdvisorMessages,

with:

      // FR7: the budget binds per dispatch like everything else, so retuning it needs
      // no reload. The 0 default keeps the fold an identity and the payload identical
      // to the pre-FR7 shape (t10 pins that one-arg call form).
      buildMessages: (messages) => buildAdvisorMessages(messages, config.tokenBudget);

Region F — imports. (Merged into Region A above; kept for the slice-3 diff history.)

Region G — planGate args, REPLACES the buildMessages line produced by Region E above:

      // FR7: the budget binds per dispatch like everything else, so retuning it needs
      // no reload. The 0 default keeps the fold an identity and the payload identical
      // to the pre-FR7 shape (t10 pins that one-arg call form).
      // FR2: the digest read rides the same thunk, so the store I/O also pays only on
      // a fire — the same laziness that keeps an off-cadence turn free. An empty
      // store (or a cap of 0) passes no digest and the payload stays byte-identical.
      buildMessages: (messages) => {
        const digest =
          config.memoryCap > 0
            ? digestMessage(readEntries(projectKeyFor(process.cwd())), Date.now())
            : undefined;
        return buildAdvisorMessages(messages, config.tokenBudget, digest);
      },

Region H — after the runAdvisor await, before planCommit:

    // FR2: record THIS fire's advice after a successful call, before the commit.
    // The text gets the same strip the commit gets, so the digest channel carries
    // no fake-markup vocabulary back into a later fire's context. recordAdvice
    // never throws; a failed write costs the next fire its digest, never the
    // current entry.
    if (outcome.ok && config.memoryCap > 0) {
      recordAdvice(projectKeyFor(process.cwd()), stripAdvisorMarkup(outcome.text), config.memoryCap, Date.now());
    }

Region I — the planCommit call and its tail. REPLACES the original call, notify
check, and return (Slice 4):

    const commit = planCommit({
      outcome,
      customType: config.customType,
      display: config.display,
      peerEntries: event.entries,
      strip: stripAdvisorMarkup,
      // FR1: the dialogue stamp. fireCount + 1 is the ordinal THIS commit would
      // earn; the counter advances below only when the commit actually lands.
      details: stampDetails(fireCount + 1, event.turnIndex),
    });
    if (commit.action === "notify") {
      reportFailure(ctx, commit.message);
      return;
    }
    // FR1: the ordinal advances only on a landed commit, so stamped fires stay
    // dense: entry k carries fire k. Notify arms (advisor error, markup husk)
    // burn no ordinal.
    fireCount += 1;
    return commit.result;

Slice 5 regions:

Region S5-A — imports. INSERT between the ./report import and the ./triggers import
(alphabetical seam order: advisor, config, guard, memory, plan-turn, prompt, report,
sandbox, triggers):

import { createSandbox, READ_FILE_TOOL, SANDBOX_MAX_BYTES } from "./sandbox";

Region S5-B — the runAdvisor call gains four fields (REPLACES the existing call):

    const outcome = await runAdvisor({
      registry: ctx.modelRegistry,
      model: gate.model,
      systemPrompt: gate.systemPrompt,
      messages: gate.messages,
      timeoutMs: gate.timeoutMs,
      signal: ctx.signal,
      // FR4: the sandbox arms only when the config turns it on. An off config
      // passes no tools and no executor, so the call is byte-identical to the
      // pre-FR4 single shot (the existing suite pins it untouched).
      tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined,
      executeTool: config.toolsEnabled ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES) : undefined,
      maxToolRounds: config.maxToolRounds,
    });

Slice 6 regions:

Region S6-A — imports. One TYPE-only pi-ai import joins the top (the specialist model
object's type; erased before the module runs, the advisor.ts discipline), and the
advisor import gains a type-only SpecialistConfig line (the VALUE import stays
touched-by-nothing):

import type { Api, Model } from "@earendil-works/pi-ai";

import type { SpecialistConfig } from "./advisor";

Region S6-B — between the gate consult block and the runAdvisor call. The specialist
resolves at fire time, only when configured; a failed resolution is the base-only fail
arm (no consult tool declared, the fire looks exactly like the pre-FR6 shape):

    // FR6: resolve the specialist at fire time, only when a model is configured.
    // parseModelKey and resolveAdvisorModel never throw; their reason strings are
    // pinned at t8 and t13. A failed parse or resolution passes no specialist, so
    // the fire commits base-only advice — the consult is an upgrade, never a
    // dependency, and its absence stays silent (the pre-FR6 shape).
    let specialist: SpecialistConfig | undefined;
    if (config.specialistModel) {
      const parsedSpecialist = parseModelKey(config.specialistModel);
      if (parsedSpecialist) {
        const specialistResolution = resolveAdvisorModel(
          ctx.modelRegistry,
          parsedSpecialist.provider,
          parsedSpecialist.modelId,
        );
        if (specialistResolution.ok) {
          specialist = {
            model: specialistResolution.model,
            systemPrompt: config.specialistSystemPrompt,
          };
        }
      }
    }

Region S6-C — the runAdvisor call gains one field (REPLACES the slice-5 Region S5-B call):

    const outcome = await runAdvisor({
      registry: ctx.modelRegistry,
      model: gate.model,
      systemPrompt: gate.systemPrompt,
      messages: gate.messages,
      timeoutMs: gate.timeoutMs,
      signal: ctx.signal,
      // FR4: the sandbox arms only when the config turns it on. An off config
      // passes no tools and no executor, so the call is byte-identical to the
      // pre-FR4 single shot (the existing suite pins it untouched).
      tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined,
      executeTool: config.toolsEnabled ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES) : undefined,
      maxToolRounds: config.maxToolRounds,
      // FR6: undefined when unconfigured or unresolved — the consult stays undeclared.
      specialist,
    });

Slice 7 regions:

Region S7-A — imports. The HeldAdvice TYPE import joins the type-only group, inserted
DIRECTLY AFTER the existing line `import type { SpecialistConfig } from "./advisor";`
(alphabetical sibling order: ./advisor before ./plan-turn; biome's organizeImports may
re-sort type-only imports when the file is applied — the final placement is normalized
by `npm run format` and verified at implement time). The plan-turn VALUE import line
REPLACES the locked one:

import type { HeldAdvice } from "./plan-turn";

import { planCommit, planGate, planHostSupport, planSettle, stampDetails } from "./plan-turn";

Region S7-B — factory closure, appended directly after the locked fireCount block:

  // FR8: the async fire slots. advisorInFlight guards ONE detached call at a time;
  // heldAdvice holds ONE completed call awaiting its settle commit. Two slots,
  // never one: a completed-but-uncommitted result must survive a new call
  // STARTING, so a gate-pass while EITHER slot is busy is a consumed fire (the
  // latch already spent — F007), never a queue and never an overwrite.
  let advisorInFlight = false;
  let heldAdvice: HeldAdvice | undefined;

Region S7-C — REPLACES the slice-6 Region S6-C runAdvisor call (after the specialist
resolution block). One args literal now serves both fire modes:

    // One args literal serves both fire modes: the branch below decides only HOW
    // the call runs, never what it sends. ctx.signal rides both modes: a mid-run
    // fire detaches while the run continues, so a user abort still kills the
    // detached call (it fails open into the held slot); at natural completion no
    // abort fires and the deadline is the bound.
    const advisorArgs = {
      registry: ctx.modelRegistry,
      model: gate.model,
      systemPrompt: gate.systemPrompt,
      messages: gate.messages,
      timeoutMs: gate.timeoutMs,
      signal: ctx.signal,
      // FR4: the sandbox arms only when the config turns it on. An off config
      // passes no tools and no executor, so the call is byte-identical to the
      // pre-FR4 single shot (the existing suite pins it untouched).
      tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined,
      executeTool: config.toolsEnabled ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES) : undefined,
      maxToolRounds: config.maxToolRounds,
      // FR6: undefined when unconfigured or unresolved — the consult stays undeclared.
      specialist,
    };

    // FR8: async mode abstains. The advisor call detaches under the SAME deadline;
    // the resolved outcome is held for the settle handler. turn_end returns
    // undefined, so emitBoundary keeps every peer draft and forces no
    // continuation — and the latch already spent at gate-pass, so this fire does
    // not retry (F007).
    if (config.asyncMode) {
      // Load-bearing BOTH-slot guard (the slice-verifier blocker): a call that
      // starts while heldAdvice is occupied would resolve into a full slot and
      // silently overwrite the held outcome (reachable at interval 1 inside one
      // multi-turn run, where settle fires only at run end). Testing heldAdvice
      // too makes the write in .then safe by construction: exactly one call is
      // ever in flight, so exactly one .then can ever write the slot.
      if (advisorInFlight || heldAdvice) return;
      const fireTurn = event.turnIndex;
      advisorInFlight = true;
      void runAdvisor(advisorArgs)
        .then((outcome) => {
          advisorInFlight = false;
          heldAdvice = { outcome, turnIndex: fireTurn };
          // FR2: the async fire records its advice exactly like the blocking
          // path (Region H): after a successful call, before its commit — which
          // here lands at settle. The fire-time config governs, and the text
          // gets the same strip the commit gets. recordAdvice never throws.
          if (outcome.ok && config.memoryCap > 0) {
            recordAdvice(
              projectKeyFor(process.cwd()),
              stripAdvisorMarkup(outcome.text),
              config.memoryCap,
              Date.now(),
            );
          }
        })
        .catch(() => {
          // Unreachable while runAdvisor honors its never-throw contract; kept so
          // a contract violation can never surface as an unhandled rejection.
          advisorInFlight = false;
          heldAdvice = {
            outcome: { ok: false, reason: "async advisor call threw" },
            turnIndex: fireTurn,
          };
        });
      return;
    }

    // Blocking mode: THE single await (the pre-FR8 shape, byte-identical payload).
    const outcome = await runAdvisor(advisorArgs);

Region S7-D — the settle registration, appended after the turn_end pi.on block closes,
inside the factory:

  // FR8: the once-only settle commit. The slot clears BEFORE anything else, so a
  // surprise can never double-commit. Config is read only when advice is held, so
  // an async-off session pays nothing per settle. The 1.4 host-support guard needs
  // no repeat here: heldAdvice only fills behind the turn_end guard, so an
  // unsupported host never has advice to commit.
  pi.on("agent_before_settle", (event, ctx) => {
    const held = heldAdvice;
    if (!held) return;
    heldAdvice = undefined;
    const config = loadConfig();
    const settle = planSettle({
      held,
      customType: config.customType,
      display: config.display,
      peerEntries: event.entries,
      strip: stripAdvisorMarkup,
      details: stampDetails(fireCount + 1, held.turnIndex),
    });
    if (settle.action === "abstain") return;
    if (settle.action === "notify") {
      reportFailure(ctx, settle.message);
      return;
    }
    fireCount += 1;
    return settle.result;
  });
```

### plan-turn.ts — MODIFY

Slices 1, 4, 7: trigger arm + planHostSupport (1), details stamping in buildCorrection (4), planSettle core for the once-only settle commit (7).

```ts
Slices 1, 4, 7 regions (merged). implement reads the original at disk.

Region A — imports (top of file). Add one TYPE-only sibling import after the advisor type import:

import type { TriggerDecision } from "./triggers";

Region A2 — module banner. The Laziness paragraph becomes:

  Laziness is part of the contract. Every early-out returns BEFORE any thunk runs, with
  one exception: on a cadence miss with an armed trigger, the trigger thunk runs and the
  other thunks still do not (t21 pins the economics). An off-cadence turn pays for no
  child scan, no parse, no resolve, and no mark.

The next sentence drops the count: "The three imports above are TYPE-only" becomes
"The imports above are TYPE-only".

Region E — buildCorrection. REPLACES the whole function and its doc comment (Slice 4:
the optional details stamp joins the draft; an absent stamp stays key-less):

/**
 * One committed guidance entry plus the forced continuation.
 *
 * The optional details stamp (FR1) rides the draft verbatim: the host stores it as
 * extension-specific metadata (session-manager.d.ts:103 "not sent to LLM") while the
 * content itself replays into later context as a user message — the dialogue is the
 * host's own re-projection, and the stamp only makes each entry machine-identifiable.
 * An absent stamp leaves the draft WITHOUT a details key: the pre-FR1 byte shape, so
 * entries from both sides of the upgrade coexist in one session file.
 */
export function buildCorrection(
  customType: string,
  text: string,
  display: boolean,
  peerEntries: BoundaryResult["entries"],
  details?: AdvisorEntryDetails,
): BoundaryResult {
  return {
    // The spread is mandatory. emitBoundary REPLACES the accumulator
    // (runner.js:775-776), so a returned array that omits event.entries discards
    // every peer draft — five other packages already register turn_end.
    entries: [
      ...(peerEntries ?? []),
      {
        type: "custom_message",
        customType,
        content: text,
        display,
        // The conditional spread is load-bearing: a literal details: undefined
        // would still create the key, and t24 pins its absence for the
        // unstamped shape.
        ...(details === undefined ? {} : { details }),
      },
    ],
    continue: true,
  };
}

Region B — PlanGateArgs. Add one optional thunk field after the buildMessages field:

  buildMessages: (messages: Message[]) => Message[];
  // FR3 trigger thunk, pre-bound with signals and thresholds at the seam. Absent
  // when no threshold is armed, so an unarmed config pays nothing. Runs ONLY on a
  // cadence miss: an on-cadence turn evaluates no signals (the cadence answer
  // already fires the gate).
  trigger?: () => TriggerDecision;

Region C — planGate, cadence + outcome arms. This block REPLACES the code from the
"Cadence." comment through the outcome check:

  // FR3 trigger arms. Cadence stays the primary clock: an on-cadence turn pays
  // nothing for signal evaluation (the trigger thunk runs only on a cadence
  // miss), and an unarmed config passes no thunk at all. Either arm passes the
  // SAME gate-pass — the outcome check and markFired below run identically — so
  // the latch spends exactly once per fire no matter which arm passed. The
  // none-literal is inlined because a VALUE sibling import would break the
  // zero-runtime-import contract this module documents.
  const notTriggered: TriggerDecision = { action: "none", reason: "no signal" };
  const cadenceDue = args.gates(args.turnIndex, args.interval, args.lastFiredTurn);
  const triggered = !cadenceDue && args.trigger ? args.trigger() : notTriggered;
  if (!cadenceDue && triggered.action !== "fire") {
    return { action: "skip", reason: "off cadence" };
  }
  // An aborted or errored turn has no work worth reviewing — UNLESS the error IS
  // the trigger (triggerOnError): then the trouble is the signal and the fire
  // bypasses this veto. Cadence fires never bypass it, so the F007 slide is
  // untouched: a cadence-due errored turn still skips without spending its slot.
  // Aborted turns never fire: no trigger signal covers them.
  const errorTriggered = triggered.action === "fire" && triggered.signal === "error";
  if (args.outcome !== "completed" && !errorTriggered) {
    return { action: "skip", reason: `turn ${args.outcome}` };
  }

Arms from markFired onward are unchanged.

Region F — PlanCommitArgs and planCommit's commit arm (Slice 4). Add one optional
field after strip:

  strip: (text: string) => string;
  // FR1 dialogue stamp, pre-built by the seam with stampDetails. Absent means
  // unstamped; both notify arms ignore it.
  details?: AdvisorEntryDetails;

and the commit arm becomes:

  return {
    action: "commit",
    result: buildCorrection(
      args.customType,
      stripped,
      args.display,
      args.peerEntries,
      args.details,
    ),
  };

Region D — appended at end of file:

/** What planHostSupport tells the seam about the running host. */
export type HostSupport = { supported: true } | { supported: false; message: string };

/**
 * Feature-detect the 1.4 boundary surface from the first turn_end event.
 *
 * The 0.79.x host dispatches turn_end as a bare emit with no outcome and no
 * context (agent-session.js:375-384); under it planGate would skip every fire
 * silently. The version number itself is not on the extension context, and a
 * hardcoded package read would be a second fragile reach like F008, so the
 * detect reads the event fields the gate actually needs.
 */
export function planHostSupport(outcome: unknown, context: unknown): HostSupport {
  if (typeof outcome === "string" && context !== null && typeof context === "object") {
    return { supported: true };
  }
  return {
    supported: false,
    message:
      "advisor-turn-gate: host boundary events predate 1.4; " +
      "the gate is disabled until the host is upgraded",
  };
}

Region G — appended at end of file (Slice 4):

/** The stable keys every committed advisor entry carries (FR1). */
export interface AdvisorEntryDetails {
  /** 1-based ordinal of the fire that produced the entry; the seam counts commits. */
  fire: string;
  /** The turnIndex the fire landed on. */
  turn: string;
}

/**
 * The details stamp for fire number fire (1-based) on turn turnIndex.
 *
 * The single source of the key names: the seam, Slice 7's settle lookup, and the
 * eval fixtures all read entries through these two keys, and t24 pins them, so a
 * seam-side rename cannot ship silently. The values are strings for stable JSON
 * round-trips and greppable session files.
 */
export function stampDetails(fire: number, turnIndex: number): AdvisorEntryDetails {
  return { fire: String(fire), turn: String(turnIndex) };
}

Slice 7 regions:

Region S7-PT-A — buildCorrection refactor (t24 pins stay green byte-for-byte). ADDS an
unexported shared draft builder above buildCorrection, and buildCorrection delegates to
it (the Region E doc comment on buildCorrection is unchanged):

/** The advice draft both commit paths build (blocking turn_end, async settle). */
function buildAdviceDraft(
  customType: string,
  text: string,
  display: boolean,
  details?: AdvisorEntryDetails,
) {
  return {
    type: "custom_message" as const,
    customType,
    content: text,
    display,
    // The conditional spread is load-bearing: a literal details: undefined
    // would still create the key, and t24 pins its absence for the
    // unstamped shape.
    ...(details === undefined ? {} : { details }),
  };
}

export function buildCorrection(
  customType: string,
  text: string,
  display: boolean,
  peerEntries: BoundaryResult["entries"],
  details?: AdvisorEntryDetails,
): BoundaryResult {
  return {
    // The spread is mandatory. emitBoundary REPLACES the accumulator
    // (runner.js:775-776), so a returned array that omits event.entries discards
    // every peer draft — five other packages already register turn_end.
    entries: [...(peerEntries ?? []), buildAdviceDraft(customType, text, display, details)],
    continue: true,
  };
}

Region S7-PT-B — appended at end of file:

/** One completed async advisor call waiting for its settle commit (FR8). */
export interface HeldAdvice {
  /** The advisor outcome, exactly as runAdvisor resolved it. */
  outcome: AdvisorOutcome;
  /** The turnIndex captured at fire time; the settle event carries none. */
  turnIndex: number;
}

/** What planSettle tells the seam to do at agent_before_settle. */
export type SettleDecision =
  | { action: "abstain" }
  | { action: "notify"; message: string }
  | { action: "commit"; result: BoundaryResult };

/** The held advice plus the injected shapers planSettle reads. */
export interface PlanSettleArgs {
  held: HeldAdvice | undefined;
  customType: string;
  display: boolean;
  peerEntries: BoundaryResult["entries"];
  strip: (text: string) => string;
  details: AdvisorEntryDetails;
}

/**
 * Turn one held async advisor outcome into the once-only settle decision.
 *
 * The abstain arm is the every-settle common case: an async-off session holds
 * nothing and decides nothing. The notify arms reuse the exact reportFailure
 * formats the blocking path pins. The commit arm spreads the SETTLE event's own
 * accumulator and deliberately omits the continue key: a truthy result.continue
 * at agent_before_settle makes the host ensure one next provider request
 * (agent-session.js:1578-1584), which would wake an idle agent — FR8 forbids
 * that. The draft is byte-identical to the blocking draft (shared builder); only
 * the continue key differs.
 */
export function planSettle(args: PlanSettleArgs): SettleDecision {
  if (!args.held) return { action: "abstain" };
  if (!args.held.outcome.ok) {
    return { action: "notify", message: `advisor-turn-gate: ${args.held.outcome.reason}` };
  }
  const stripped = args.strip(args.held.outcome.text);
  if (!stripped) {
    return { action: "notify", message: "advisor-turn-gate: advisor reply was markup only" };
  }
  return {
    action: "commit",
    result: {
      entries: [
        ...(args.peerEntries ?? []),
        buildAdviceDraft(args.customType, stripped, args.display, args.details),
      ],
      // NO continue: the settle path never wakes an idle agent (FR8).
    },
  };
}
```

### prompt.ts — MODIFY

Slices 2, 3: applyTokenBudget fold + buildAdvisorMessages budget parameter (2); digest message injection point (3).

```ts
Slices 2, 3 regions (merged). implement reads the original at disk.

Region A — module banner, first sentence. "The advisor receives the executor's full projected context" becomes "The advisor receives the executor's projected context".

Region B — appended after stripToolDeclarations, before ensureUserTail:

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
    if (messages[i].role === "system") continue;
    foldedIndices.push(i);
    foldedTokens += sizes[i];
    if (total - foldedTokens + MARKER_TOKEN_ALLOWANCE <= tokenBudget) break;
  }
  if (foldedIndices.length === 0) return messages;

  const foldSet = new Set(foldedIndices);
  const firstFolded = messages[foldedIndices[0]] as { timestamp?: number };
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
  const result: Message[] = [];
  let markerPlaced = false;
  for (let i = 0; i < messages.length; i += 1) {
    if (!foldSet.has(i)) {
      result.push(messages[i]);
    } else if (!markerPlaced) {
      markerPlaced = true;
      result.push(marker);
    }
  }
  return result;
}

Region C — buildAdvisorMessages REPLACES the existing function and its doc comment (the
Slice 3 merged form: the fold and pipeline are unchanged; the optional digest joins after
the fold and before the tail check):

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
```

### advisor.ts — MODIFY

Slices 5, 6: tool loop + widened request tools + mid-loop toolUse admission with terminal rejection (5); consult_specialist leg + aggregation separator that survives the 3-newline collapse (6).

```ts
Slices 5, 6 regions (merged). implement reads the original at disk.

Region T1 — after AdvisorOutcome (Slice 5; unchanged) plus the FR6 consult surface (Slice 6):

/** The structural shape of one advisor-declared tool (pi-ai Tool, duck-typed). */
export interface AdvisorTool {
  name: string;
  description: string;
  parameters: unknown;
}

/** One tool execution: the text to replay, or why it refused. */
export type ToolExecutionResult = { ok: true; text: string } | { ok: false; reason: string };

/** The seam-facing executor the loop calls once per ToolCall block. */
export type ToolExecutor = (name: string, args: unknown) => ToolExecutionResult;

/**
 * The loop's round cap when the caller passes none.
 *
 * Deliberately the SAME number as DEFAULT_CONFIG.maxToolRounds (config.ts):
 * the offline suite pins the parity (t25), because this module imports no
 * sibling and cannot read the constant.
 */
const DEFAULT_MAX_TOOL_ROUNDS = 3;

// --- FR6: the specialist consult surface (Slice 6). ---

/** The specialist consult's declared tool name. */
export const CONSULT_SPECIALIST_NAME = "consult_specialist";

/**
 * The declared consult tool, appended to the request's tool list when a
 * specialist is configured. Plain JSON-Schema parameters keep typebox out of
 * the offline test's module graph (the READ_FILE_TOOL decision).
 */
export const CONSULT_SPECIALIST_TOOL: AdvisorTool = {
  name: CONSULT_SPECIALIST_NAME,
  description:
    "Consult the on-demand specialist model with one focused question. Use it when the " +
    "review needs domain expertise you lack. One question per call; the answer arrives " +
    "as the tool result.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The focused question for the specialist, with the context it needs.",
      },
    },
    required: ["question"],
  },
};

/** Pinned refusal for a malformed question argument (t26). */
export const CONSULT_QUESTION_REFUSAL =
  'advisor consult refused: "question" must be a non-empty string';

/** Pinned refusal for a consult requested with no specialist configured (t26). */
export const CONSULT_UNCONFIGURED_REFUSAL =
  "advisor consult refused: no specialist model is configured";

/**
 * Pinned refusal for a toolUse naming a tool this fire never declared (t26).
 * Reachable only in specialist-only mode (the declared list is exactly the
 * consult tool and no executor is injected); the refusal replays as an errored
 * toolResult so the advisor self-corrects instead of failing the fire.
 */
export function undeclaredToolRefusalFor(name: string): string {
  return `advisor tool "${name}" is not declared; use only the tools declared for this fire`;
}

/**
 * Joins the fire's base advice and each specialist answer into ONE text.
 *
 * The longest newline run inside the separator is two, so stripAdvisorMarkup's
 * 3-newline collapse (the /\n{3,}/g pass) can never rewrite a join — t26 pins
 * the aggregated bytes through the strip itself. The separator carries no
 * angle-bracket vocabulary, so no strip tier can match it either.
 */
export const CONSULT_SECTION_SEPARATOR = "\n\n---\n\n";

/** Header line above each aggregated specialist answer; t26 pins it. */
export const CONSULT_ANSWER_HEADER = "Specialist consult answer:";

/** What the seam hands runAdvisor for the optional specialist leg. */
export interface SpecialistConfig {
  model: Model<Api>;
  systemPrompt: string;
}

Region T2 — CompleteSimpleFn's context parameter (Slice 5; unchanged in Slice 6):

type CompleteSimpleFn = (
  model: Model<Api>,
  context: { systemPrompt: string; messages: Message[]; tools?: AdvisorTool[] },
  options?: { signal?: AbortSignal; reasoning?: string; sessionId?: string },
) => Promise<AssistantMessage>;

Region T5 — the consult leg (Slice 6; new function, placed directly before runAdvisor):

/**
 * The specialist leg (FR6): ONE extra completeSimple call under the fire's
 * remaining budget.
 *
 * The leg is deliberately TOOL-FREE: the specialist answers in text or not at
 * all, so no second tool loop and no recursion can start here. Its failure is
 * the base-only fail arm: every outcome comes back as data for the loop to
 * replay as a toolResult, and the fire never fails because the specialist did.
 * A provider failure RESOLVES with stopReason "error" (the lazyStream shape),
 * checked before any text extraction. The shared clock's own rejection
 * ("advisor call timed out after Xms") surfaces through the catch verbatim —
 * the leg spends the fire's remaining budget, never a fresh one.
 */
async function runConsultLeg(
  completeSimple: CompleteSimpleFn,
  specialist: SpecialistConfig,
  args: unknown,
  budgetMs: number,
  externalSignal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const question = (args as { question?: unknown } | null | undefined)?.question;
  if (typeof question !== "string" || question.trim() === "") {
    return { ok: false, reason: CONSULT_QUESTION_REFUSAL };
  }
  try {
    const response = await callWithDeadline(
      (signal) =>
        completeSimple(
          specialist.model,
          {
            systemPrompt: specialist.systemPrompt,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: question }],
                timestamp: Date.now(),
              },
            ],
          },
          { signal },
        ),
      budgetMs,
      externalSignal,
    );
    if (response.stopReason !== "stop") {
      return {
        ok: false,
        reason: response.errorMessage || `specialist stopped with ${response.stopReason}`,
      };
    }
    const text = extractAdvisorText(response);
    if (!text) return { ok: false, reason: "specialist returned no text" };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

Region T3 — runAdvisor (Slice 6 REPLACES the Slice 5 form: the loop arms on tools OR a
specialist, routes consult calls to the internal leg, and aggregates successful consult
answers into the committed text):

export async function runAdvisor(params: {
  registry: ModelRegistryLike;
  model: Model<Api>;
  systemPrompt: string;
  messages: Message[];
  timeoutMs: number;
  signal?: AbortSignal;
  /** Declared advisor tools. Absent or empty keeps the single-call shape byte-identical. */
  tools?: AdvisorTool[];
  /** The executor for ToolCall blocks. Required with tools; without it the loop never arms. */
  executeTool?: ToolExecutor;
  /** Tool-use rounds per fire. Defaults to DEFAULT_MAX_TOOL_ROUNDS (t25 pins the parity). */
  maxToolRounds?: number;
  /** The optional specialist (FR6). Absent keeps consult_specialist undeclared. */
  specialist?: SpecialistConfig;
}): Promise<AdvisorOutcome> {
  // This guard stays BEFORE the try: it is a fail-fast precondition, not a transport
  // failure for the deadline machinery to own. t16 pins the exact reason string.
  const completeSimple = getRuntimeCompleteSimple(params.registry);
  if (!completeSimple) {
    return { ok: false, reason: "no auth-aware completion facade on this host" };
  }
  try {
    // FR4/FR6: the loop arms when a sandbox tool list OR a specialist arrives. An
    // unarmed call (neither) passes tools: [] exactly as before, so every pre-FR4
    // behavior — including each t16 pin — is untouched by construction.
    const executeTool = params.executeTool;
    const consultArmed = params.specialist !== undefined;
    const loopArmed = (params.tools?.length ?? 0) > 0 || consultArmed;
    const maxRounds = params.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    const requestTools = !loopArmed
      ? []
      : consultArmed
        ? [...(params.tools ?? []), CONSULT_SPECIALIST_TOOL]
        : (params.tools ?? []);
    // The shared per-fire deadline (the settled decision): the clock starts once,
    // and every round — main calls and consult legs alike — races the REMAINING
    // budget, never a fresh one. Round 1 gets the full budget, so an unarmed
    // call's timing is identical to the old shape.
    const startedAt = Date.now();
    let conversation = [...params.messages];
    // FR6: successful consult answers aggregate into the committed text, in fire order.
    const consultAnswers: string[] = [];
    let rounds = 0;
    for (;;) {
      const remaining = params.timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        return { ok: false, reason: `advisor call timed out after ${params.timeoutMs}ms` };
      }
      const response = await callWithDeadline(
        (signal) =>
          completeSimple(
            params.model,
            { systemPrompt: params.systemPrompt, messages: conversation, tools: requestTools },
            { signal },
          ),
        remaining,
        params.signal,
      );
      // A mid-loop toolUse is CONSUMED here: the call blocks execute, the results
      // replay as toolResult messages, and the loop continues. No injected executor
      // is required at this gate — consult rounds are self-contained — but a call
      // naming a tool this fire never declared refuses per call, so the advisor
      // self-corrects instead of failing the fire. Once the rounds are spent
      // (rounds >= maxRounds), a toolUse falls through to the terminal gate below
      // and rejects with the SAME pinned reason the single-call path always
      // produced — no extra grace call spent on a tool-happy advisor.
      if (response.stopReason === "toolUse" && loopArmed && rounds < maxRounds) {
        const calls = response.content.filter(
          (
            block,
          ): block is {
            type: "toolCall";
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          } => block.type === "toolCall",
        );
        if (calls.length === 0) {
          // Degenerate: the provider claims toolUse but sent no call blocks.
          return { ok: false, reason: "advisor stopped with toolUse" };
        }
        rounds += 1;
        conversation = [...conversation, response];
        for (const call of calls) {
          let result: ToolExecutionResult;
          if (call.name === CONSULT_SPECIALIST_NAME) {
            if (!params.specialist) {
              result = { ok: false, reason: CONSULT_UNCONFIGURED_REFUSAL };
            } else {
              // Fresh remaining-at-call budget: elapsed includes this round's main call.
              const legBudget = params.timeoutMs - (Date.now() - startedAt);
              result =
                legBudget <= 0
                  ? { ok: false, reason: `advisor call timed out after ${params.timeoutMs}ms` }
                  : await runConsultLeg(
                      completeSimple,
                      params.specialist,
                      call.arguments,
                      legBudget,
                      params.signal,
                    );
            }
            if (result.ok) consultAnswers.push(result.text);
          } else if (executeTool) {
            // The executor never throws (the sandbox's contract).
            result = executeTool(call.name, call.arguments);
          } else {
            result = { ok: false, reason: undeclaredToolRefusalFor(call.name) };
          }
          conversation = [
            ...conversation,
            {
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              content: [{ type: "text", text: result.ok ? result.text : result.reason }],
              isError: !result.ok,
              timestamp: Date.now(),
            },
          ];
        }
        continue;
      }
      // The terminal gate is UNCHANGED: stop-only admission. Provider errors still
      // RESOLVE with stopReason "error" and errorMessage is checked first.
      if (response.stopReason !== "stop") {
        return {
          ok: false,
          reason: response.errorMessage || `advisor stopped with ${response.stopReason}`,
        };
      }
      const text = extractAdvisorText(response);
      if (!text) return { ok: false, reason: "advisor returned no text" };
      // FR6 aggregation: the fire's advice and every successful specialist answer
      // land as ONE text, base first, consults in fire order. The separator's
      // longest newline run is two, so the strip's 3-newline collapse can never
      // rewrite the join (t26 pins the exact bytes through stripAdvisorMarkup).
      if (consultAnswers.length === 0) return { ok: true, text };
      return {
        ok: true,
        text: [
          text,
          ...consultAnswers.map((answer) => `${CONSULT_ANSWER_HEADER}\n${answer}`),
        ].join(CONSULT_SECTION_SEPARATOR),
      };
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
```

### config.ts — MODIFY

Slices 1, 2, 3, 5, 6, 7: triggerMinNewTokens, triggerContextPercent, triggerOnError, triggerRiskyTools (1); tokenBudget (2); memoryCap (3); toolsEnabled, maxToolRounds (5); specialistModel, specialistSystemPrompt (6); asyncMode (7). Every field: interface + DEFAULT_CONFIG + MIN/MAX + per-type narrowing.

```ts
Slices 1, 2, 3 regions. implement reads the original at disk; later slices rewrite this fence with the merged result.

Region A — AdvisorGateConfig interface, after display:

  /** Fire when a turn's usage grew by at least this many tokens. 0 disables the signal. */
  triggerMinNewTokens: number;
  /** Fire when the context window is at least this percent full. 0 disables the signal. */
  triggerContextPercent: number;
  /** Fire when a turn errors. Aborted turns never fire. */
  triggerOnError: boolean;
  /** Comma-separated risky tool names; any exact match on a tool result fires. Empty disables. */
  triggerRiskyTools: string;

Region B — DEFAULT_CONFIG, after display: true,:

  triggerMinNewTokens: 0,
  triggerContextPercent: 0,
  triggerOnError: false,
  triggerRiskyTools: "",

Region C — hard bounds, after MAX_TIMEOUT_MS:

export const MIN_TRIGGER_TOKENS = 0;
export const MAX_TRIGGER_TOKENS = 100000;
export const MIN_TRIGGER_PERCENT = 0;
export const MAX_TRIGGER_PERCENT = 100;

Region D — loadConfig return, after the display line:

      // triggerRiskyTools accepts ANY string including "" — empty is the valid
      // disabled state, so unlike systemPrompt/customType an empty value does
      // not fall back to the default.
      triggerMinNewTokens:
        typeof parsed.triggerMinNewTokens === "number"
          ? clampWithWarn(
              "triggerMinNewTokens",
              parsed.triggerMinNewTokens,
              MIN_TRIGGER_TOKENS,
              MAX_TRIGGER_TOKENS,
            )
          : DEFAULT_CONFIG.triggerMinNewTokens,
      triggerContextPercent:
        typeof parsed.triggerContextPercent === "number"
          ? clampWithWarn(
              "triggerContextPercent",
              parsed.triggerContextPercent,
              MIN_TRIGGER_PERCENT,
              MAX_TRIGGER_PERCENT,
            )
          : DEFAULT_CONFIG.triggerContextPercent,
      triggerOnError:
        typeof parsed.triggerOnError === "boolean"
          ? parsed.triggerOnError
          : DEFAULT_CONFIG.triggerOnError,
      triggerRiskyTools:
        typeof parsed.triggerRiskyTools === "string"
          ? parsed.triggerRiskyTools
          : DEFAULT_CONFIG.triggerRiskyTools,

Region E — AdvisorGateConfig interface, after triggerRiskyTools:

  /** Soft cap for the advisor payload, in estimated tokens (JSON characters / 4). 0 disables the fold. */
  tokenBudget: number;

Region F — DEFAULT_CONFIG, after triggerRiskyTools: "":

  tokenBudget: 0,

Region G — hard bounds, after MAX_TRIGGER_PERCENT:

export const MIN_TOKEN_BUDGET = 0;
export const MAX_TOKEN_BUDGET = 1000000;

Region H — loadConfig return, after the triggerRiskyTools entry:

      tokenBudget:
        typeof parsed.tokenBudget === "number"
          ? clampWithWarn(
              "tokenBudget",
              parsed.tokenBudget,
              MIN_TOKEN_BUDGET,
              MAX_TOKEN_BUDGET,
      tokenBudget:
        typeof parsed.tokenBudget === "number"
          ? clampWithWarn(
              "tokenBudget",
              parsed.tokenBudget,
              MIN_TOKEN_BUDGET,
              MAX_TOKEN_BUDGET,
            )
          : DEFAULT_CONFIG.tokenBudget,

Region I — AdvisorGateConfig interface, after tokenBudget:

  /** Advisor entries kept per project in the local memory store. 0 disables memory. */
  memoryCap: number;

Region J — DEFAULT_CONFIG, after tokenBudget: 0,:

  memoryCap: 0,

Region K — hard bounds, after MAX_TOKEN_BUDGET:

export const MIN_MEMORY_CAP = 0;
export const MAX_MEMORY_CAP = 200;

Region L — loadConfig return, after the tokenBudget entry:

      memoryCap:
        typeof parsed.memoryCap === "number"
          ? clampWithWarn("memoryCap", parsed.memoryCap, MIN_MEMORY_CAP, MAX_MEMORY_CAP)
          : DEFAULT_CONFIG.memoryCap,

Slice 5 regions:

Region M — AdvisorGateConfig interface, after memoryCap:

  /** Whether the advisor may declare its read_file sandbox tool. */
  toolsEnabled: boolean;
  /** Tool-use rounds the advisor may spend per fire. 1 allows one round. */
  maxToolRounds: number;

Region N — DEFAULT_CONFIG, after memoryCap: 0,:

  toolsEnabled: false,
  maxToolRounds: 3,

Region O — hard bounds, after MAX_MEMORY_CAP:

export const MIN_TOOL_ROUNDS = 1;
export const MAX_TOOL_ROUNDS = 10;

Region P — loadConfig return, after the memoryCap entry:

      toolsEnabled:
        typeof parsed.toolsEnabled === "boolean"
          ? parsed.toolsEnabled
          : DEFAULT_CONFIG.toolsEnabled,
      maxToolRounds:
        typeof parsed.maxToolRounds === "number"
          ? clampWithWarn("maxToolRounds", parsed.maxToolRounds, MIN_TOOL_ROUNDS, MAX_TOOL_ROUNDS)
          : DEFAULT_CONFIG.maxToolRounds,

Slice 6 regions:

Region Q — AdvisorGateConfig interface, after maxToolRounds:

  /** "provider/modelId" of the on-demand specialist. Empty disables consults. */
  specialistModel: string;
  /** System prompt handed to the specialist leg. */
  specialistSystemPrompt: string;

Region R — DEFAULT_CONFIG, after maxToolRounds: 3,:

  specialistModel: "",
  specialistSystemPrompt:
    "You are a domain specialist consulted by a senior engineer who is reviewing " +
    "another agent's work. Answer the question asked in a few direct sentences. " +
    "Name the file and the line when you can. Reply in text only: never write " +
    "tool-call markup or anything that imitates a tool call.",

Region S — loadConfig return, after the maxToolRounds entry:

      // specialistModel accepts ANY string including "" — empty is the valid
      // disabled state (the triggerRiskyTools precedent). A non-empty but
      // unparseable value never arms the consult: the seam's parseModelKey gate
      // drops it, and the fire proceeds base-only. No clamp, no warn: the
      // specialist is optional and its misconfiguration degrades to the pre-FR6
      // behavior, not to an error channel.
      specialistModel:
        typeof parsed.specialistModel === "string"
          ? parsed.specialistModel.trim()
          : DEFAULT_CONFIG.specialistModel,
      specialistSystemPrompt:
        typeof parsed.specialistSystemPrompt === "string" && parsed.specialistSystemPrompt.trim()
          ? parsed.specialistSystemPrompt
          : DEFAULT_CONFIG.specialistSystemPrompt,

Slice 7 regions:

Region T — AdvisorGateConfig interface, after specialistSystemPrompt:

  /** Commit the advisor's reply at the next agent settlement instead of blocking turn_end. */
  asyncMode: boolean;

Region U — DEFAULT_CONFIG, after the specialistSystemPrompt default string:

  asyncMode: false,

Region V — loadConfig return, after the specialistSystemPrompt entry:

      asyncMode:
        typeof parsed.asyncMode === "boolean" ? parsed.asyncMode : DEFAULT_CONFIG.asyncMode,
```

### tests/test.mjs — MODIFY

Every slice appends a pinned section; t9 laziness and t5/t7 config bands extend per new thunk/field; FR9 adds the second runner — fixture-style scenarios live in eval/ and nothing pinned moves.

```js
Slices 1, 2, 3, 4 regions. implement reads the original at disk; later slices rewrite this fence with the merged result.

Region A — import block: extend the plan-turn import with planHostSupport, and add:

import { parseRiskyTools, planTrigger, triggersArmed } from "../triggers.ts";

Region A2 — header and t9 banner prose. The header sentence listing the sibling modules gains triggers.ts:

  config.ts, guard.ts, prompt.ts, advisor.ts, report.ts, plan-turn.ts, and triggers.ts
  import no sibling at runtime, so this file resolves nothing from @earendil-works/*

The t9 banner sentence "an off-cadence turn invokes no thunk at all" becomes:

  an off-cadence turn invokes no thunk beyond the trigger (t21 pins the trigger's
  cadence-miss-only economics)

Region B — appended after section t20:

// --- 21. FR3 triggers: planTrigger arm order, planGate integration, host support.
{
  const signals = (overrides = {}) => ({
    turnTokens: null,
    contextPercent: null,
    outcome: "completed",
    toolNames: [],
    ...overrides,
  });
  const thresholds = (overrides = {}) => ({
    minNewTokens: 0,
    contextPercent: 0,
    onError: false,
    riskyTools: [],
    ...overrides,
  });
  assert(
    planTrigger(signals(), thresholds()).action === "none",
    "t21: nothing armed fires nothing",
  );
  assert(
    planTrigger(signals({ outcome: "error" }), thresholds({ onError: true })).signal === "error",
    "t21: the error signal fires first when armed",
  );
  assert(
    planTrigger(
      signals({ outcome: "error", turnTokens: 99999 }),
      thresholds({ onError: true, minNewTokens: 1000 }),
    ).signal === "error",
    "t21: trouble outcome outranks token growth",
  );
  assert(
    planTrigger(
      signals({ turnTokens: 20000, contextPercent: 90 }),
      thresholds({ minNewTokens: 1000, contextPercent: 50 }),
    ).signal === "tokens",
    "t21: token growth outranks context pressure",
  );
  assert(
    planTrigger(
      signals({ contextPercent: 90, toolNames: ["git push"] }),
      thresholds({ contextPercent: 50, riskyTools: ["git push"] }),
    ).signal === "pressure",
    "t21: context pressure outranks risky tools",
  );
  assert(
    planTrigger(
      signals({ toolNames: ["read", "git push"] }),
      thresholds({ riskyTools: ["git push", "rm"] }),
    ).signal === "risky-tool",
    "t21: a risky tool fires last",
  );
  assert(
    planTrigger(signals({ turnTokens: 10 }), thresholds({ minNewTokens: 1000 })).action === "none",
    "t21: a sub-threshold signal does not fire",
  );
  assert(
    planTrigger(signals({ outcome: "aborted" }), thresholds({ onError: true })).action === "none",
    "t21: an aborted turn never fires the error signal",
  );
  assert(
    planTrigger(signals({ toolNames: ["git push"] }), thresholds({ riskyTools: ["gitpush"] }))
      .action === "none",
    "t21: risky-tool matching is exact, not substring",
  );
  assert(
    JSON.stringify(parseRiskyTools(" git push , rm , ")) ===
      JSON.stringify(["git push", "rm"]),
    "t21: parseRiskyTools trims and drops empties",
  );
  assert(triggersArmed(thresholds()) === false, "t21: all-off thresholds are unarmed");
  assert(
    triggersArmed(thresholds({ minNewTokens: 1 })) === true,
    "t21: one armed signal is enough",
  );
}
{
  // planGate integration: the trigger arm sits between no-model and cadence.
  let triggerCalls = 0;
  const fire = () => {
    triggerCalls++;
    return { action: "fire", signal: "tokens", detail: "20000" };
  };
  const latch = { value: -1 };
  let marks = 0;
  const fired = planGate(
    gateArgs({
      turnIndex: 0,
      interval: 2,
      trigger: fire,
      markFired: (i) => {
        marks++;
        latch.value = i;
      },
    }),
  );
  assert(fired.action === "consult", "t21: a trigger fire consults ahead of cadence");
  assert(
    triggerCalls === 1 && marks === 1 && latch.value === 0,
    "t21: the trigger fire spends the latch once",
  );
  triggerCalls = 0;
  planGate(gateArgs({ turnIndex: 1, interval: 2, trigger: fire }));
  assert(triggerCalls === 0, "t21: an on-cadence turn invokes no trigger thunk");
  marks = 0;
  const quiet = planGate(
    gateArgs({
      turnIndex: 0,
      interval: 2,
      trigger: () => ({ action: "none", reason: "no signal" }),
      markFired: () => {
        marks++;
      },
    }),
  );
  assert(
    quiet.action === "skip" && marks === 0,
    "t21: an untriggered cadence miss skips without spending",
  );
  const errorFired = planGate(
    gateArgs({
      turnIndex: 0,
      interval: 2,
      outcome: "error",
      trigger: () => ({ action: "fire", signal: "error", detail: "error" }),
    }),
  );
  assert(errorFired.action === "consult", "t21: an error-triggered fire bypasses the outcome veto");
  assert(
    planGate(gateArgs({ turnIndex: 1, interval: 2, outcome: "error" })).action === "skip",
    "t21: a cadence-due errored turn still skips (the F007 slide)",
  );
  assert(
    planGate(
      gateArgs({
        turnIndex: 0,
        interval: 2,
        outcome: "aborted",
        trigger: () => ({ action: "fire", signal: "tokens", detail: "1" }),
      }),
    ).action === "skip",
    "t21: an aborted turn skips even when another signal fired",
  );
  assert(
    planGate(gateArgs({ turnIndex: 0, interval: 2, trigger: undefined })).action === "skip",
    "t21: an unarmed config skips a cadence miss with no trigger",
  );
}
{
  // planHostSupport: the 1.4 boundary surface vs the 0.79 bare emit.
  assert(
    planHostSupport("completed", { llmMessages: [] }).supported === true,
    "t21: a 1.4-shaped event is supported",
  );
  const stale = planHostSupport(undefined, undefined);
  assert(
    stale.supported === false && /predate 1\.4/.test(stale.message),
    "t21: a bare 0.79 emit is rejected with the pinned message",
  );
  assert(
    planHostSupport(null, { llmMessages: [] }).supported === false,
    "t21: a null outcome is rejected",
  );
  assert(
    planHostSupport("completed", null).supported === false,
    "t21: a missing context is rejected",
  );
}

// --- 21c. the four trigger fields ride the same clamp/narrowing doors (extends t5/t7).
{
  const clamped = withConfig(
    JSON.stringify({
      triggerMinNewTokens: -5,
      triggerContextPercent: 101,
      triggerOnError: "yes",
      triggerRiskyTools: 42,
    }),
    () => loadConfig(),
  );
  assert(
    clamped.triggerMinNewTokens === 0,
    "t21c: a negative triggerMinNewTokens clamps to 0 (off)",
  );
  assert(
    clamped.triggerContextPercent === 100,
    "t21c: an over-100 triggerContextPercent clamps to 100",
  );
  assert(
    clamped.triggerOnError === false,
    "t21c: a string triggerOnError falls back to the default",
  );
  assert(
    clamped.triggerRiskyTools === "",
    "t21c: a numeric triggerRiskyTools falls back to the default",
  );
  const warns = captureWarn(() =>
    withConfig(
      JSON.stringify({ triggerMinNewTokens: 1e999, triggerContextPercent: -1 }),
      () => loadConfig(),
    ),
  );
  assert(warns.length === 1, "t21c: two clamped trigger fields share the warn-once latch");
  const armed = withConfig(
    JSON.stringify({ triggerMinNewTokens: 5000, triggerRiskyTools: "git push" }),
    () => loadConfig(),
  );
  assert(
    armed.triggerMinNewTokens === 5000 && armed.triggerRiskyTools === "git push",
    "t21c: armed values survive",
  );
}

Region C — prompt import becomes:

import {
  ADVISOR_NUDGE,
  applyTokenBudget,
  BUDGET_FOLD_MARKER_PREFIX,
  buildAdvisorMessages,
  ensureUserTail,
  estimateMessageTokens,
  stripToolDeclarations,
} from "../prompt.ts";

The config import gains MAX_TOKEN_BUDGET and MIN_TOKEN_BUDGET (after MAX_TIMEOUT_MS and after MIN_TIMEOUT_MS respectively).

Region C2 — header bullet, one-word accuracy carry-along: "this suite imports the six sibling modules directly" becomes "seven" (Slice 1 added triggers.ts to the listed modules but left the count stale).

Region D — appended after the t21c block:

// --- 22. FR7 prompt budget: the chars/4 estimate, the fold, the window order, and the
//         tokenBudget config door. t10's one-arg buildAdvisorMessages call stays green:
//         the default budget is 0 and the fold is the identity.
{
  const m = (role, text, timestamp) =>
    role === "system"
      ? { role, content: text, timestamp }
      : { role, content: [{ type: "text", text }], timestamp };

  // The estimate is JSON-rendered characters / 4, rounded up.
  const probe = m("user", "abcd", 1);
  assert(
    estimateMessageTokens(probe) === Math.ceil(JSON.stringify(probe).length / 4),
    "t22: the estimate is JSON-rendered characters / 4, rounded up",
  );

  // Off is the identity: 0, negative, and non-finite budgets return the SAME array.
  const small = [m("system", "s", 1), m("user", "u", 2)];
  assert(applyTokenBudget(small, 0) === small, "t22: budget 0 is the identity");
  assert(applyTokenBudget(small, -5) === small, "t22: a negative budget is the identity");
  assert(
    applyTokenBudget(small, Number.NaN) === small,
    "t22: a non-finite budget is the identity",
  );
  assert(applyTokenBudget([], 5000) === [], "t22: an empty context is the identity");
  assert(
    applyTokenBudget(small, 100000) === small,
    "t22: an under-budget context is the identity",
  );

  // A fold that fits: systems kept, tail verbatim, marker rides the first folded slot.
  const sys1 = m("system", "S1".repeat(50), 1);
  const u1 = m("user", "u1".repeat(60), 2);
  const a1 = m("assistant", "a1".repeat(60), 3);
  const u2 = m("user", "u2".repeat(60), 4);
  const tail = m("assistant", "tail".repeat(5), 5);
  const sizes = [sys1, u1, a1, u2, tail].map(estimateMessageTokens);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  // Fits only once BOTH u1 and a1 are folded. The +80 slack stays under the identity
  // door (budget = total - 15 < total) yet clears the 64-token marker allowance only
  // after the second fold: folding u1 alone leaves 64 <= 80 - sizes[2] false while
  // sizes[2] > 16, and folding a1 makes 64 <= 80 true, so the walk stops there.
  const budget = total - sizes[1] - sizes[2] + 80;
  const folded = applyTokenBudget([sys1, u1, a1, u2, tail], budget);
  assert(folded.length === 4, "t22: the fold replaces two messages with one marker");
  assert(folded[0].role === "user", "t22: the marker is a user message");
  assert(
    folded[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
    "t22: the marker carries the pinned prefix",
  );
  assert(
    /2 earliest message\(s\)/.test(folded[0].content[0].text),
    "t22: the marker names the folded count",
  );
  assert(folded[0].timestamp === 2, "t22: the marker rides the first folded timestamp");
  assert(folded[1] === sys1, "t22: the system message survives in place");
  assert(folded[2] === u2, "t22: the kept messages stay byte-identical");
  assert(folded[3] === tail, "t22: the last message never folds");

  // Best-effort: systems plus tail alone can exceed the budget; the fold still returns
  // the invariant-respecting shape instead of throwing or dropping a system message.
  const overflow = [
    m("system", "S".repeat(400), 1),
    m("user", "m".repeat(200), 2),
    m("assistant", "t".repeat(400), 3),
  ];
  const starved = applyTokenBudget(overflow, 10);
  assert(starved.length === 3, "t22: a starved budget folds what it may and keeps the shape");
  assert(
    starved[0].role === "user" &&
      starved[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
    "t22: the starved fold still places the marker",
  );
  assert(starved[1] === overflow[0], "t22: the system message survives a starved fold");
  assert(starved[2] === overflow[2], "t22: the tail survives a starved fold");

  // Nothing foldable: system-only and lone-message contexts are the identity even over budget.
  const onlySystems = [m("system", "a".repeat(400), 1), m("system", "b".repeat(400), 2)];
  assert(
    applyTokenBudget(onlySystems, 10) === onlySystems,
    "t22: a system-only context never folds",
  );
  const lone = [m("user", "x".repeat(400), 1)];
  assert(
    applyTokenBudget(lone, 10) === lone,
    "t22: the last message never folds, so a lone context is the identity",
  );

  // The window through buildAdvisorMessages: the default 0 equals an explicit 0.
  const plain = buildAdvisorMessages([sys1, a1]);
  const explicit = buildAdvisorMessages([sys1, a1], 0);
  assert(
    JSON.stringify(plain) === JSON.stringify(explicit),
    "t22: the default budget equals an explicit 0",
  );
  assert(plain.length === 3, "t22: with no budget the nudge still appends (t10 re-pin)");

  // Strip, fold, tail: a folding context still ends on the user nudge.
  const windowed = buildAdvisorMessages(
    [m("user", "u".repeat(200), 1), m("assistant", "a".repeat(200), 2)],
    10,
  );
  assert(
    windowed.at(-1).content[0].text === ADVISOR_NUDGE,
    "t22: the nudge is appended after a fold (strip, fold, tail order)",
  );

  // The strip still runs inside the budgeted pipeline: the delta key is gone.
  const fatDelta = {
    role: "system",
    content: "s",
    toolsAdded: [{ name: "x".repeat(400) }],
    timestamp: 1,
  };
  const budgeted = buildAdvisorMessages([fatDelta, m("user", "u", 2)], 10000);
  assert(
    budgeted[0].toolsAdded === undefined,
    "t22: the strip still runs inside the budgeted pipeline",
  );
}

// --- 22c. the tokenBudget field rides the same clamp/narrowing doors (extends t5/t7/t21c).
{
  const clamped = withConfig(JSON.stringify({ tokenBudget: -50 }), () => loadConfig());
  assert(
    clamped.tokenBudget === MIN_TOKEN_BUDGET,
    "t22c: a negative tokenBudget clamps to 0 (off)",
  );
  const high = withConfig(JSON.stringify({ tokenBudget: 9999999 }), () => loadConfig());
  assert(
    high.tokenBudget === MAX_TOKEN_BUDGET,
    "t22c: an over-max tokenBudget clamps down to the maximum",
  );
  const wrong = withConfig(JSON.stringify({ tokenBudget: "big", interval: 3 }), () =>
    loadConfig(),
  );
  assert(
    wrong.tokenBudget === DEFAULT_CONFIG.tokenBudget && wrong.interval === 3,
    "t22c: a string tokenBudget falls back, leaving neighbors intact",
  );
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"tokenBudget": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.tokenBudget === MIN_TOKEN_BUDGET && cfg.interval === 1,
        "t22c: an infinite tokenBudget clamps to 0 next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t22c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.tokenBudget === 0, "t22c: the code default is 0 (the fold is off)");
}

Region A3 — import extensions (the config import gains MAX_MEMORY_CAP and MIN_MEMORY_CAP in
alphabetical slots; add the memory import):

import {
  capEntries,
  digestMessage,
  MEMORY_DIR_URL,
  projectKeyFor,
  readEntries,
  recordAdvice,
  resetMemoryWarnOnceForTest,
} from "../memory.ts";

Region A4 — header prose. The sibling-list sentence gains memory.ts:

  config.ts, guard.ts, memory.ts, prompt.ts, advisor.ts, report.ts, plan-turn.ts, and
  triggers.ts import no sibling at runtime, so this file resolves nothing from
  @earendil-works/* — a MODULE_NOT_FOUND here means a runtime import leaked into one of them.

The count bullet "this suite imports the six sibling modules directly" (Slice 2's Region C2
made it "seven") becomes "eight" — memory.ts is the eighth.

Region E — appended after the t22c block:

// --- 23. FR2 memory: the store round-trip, the cap, the digest, and the window ride.
{
  const realMemoryHref = MEMORY_DIR_URL.href;
  const storeDir = join(tmpRoot, "memory-store");
  resetMemoryWarnOnceForTest();
  rmSync(storeDir, { recursive: true, force: true });
  MEMORY_DIR_URL.href = `${pathToFileURL(storeDir).href}/`;
  try {
    // The key is stable per cwd and distinct per directory.
    assert(
      projectKeyFor("C:\\repo a") === projectKeyFor("C:\\repo a"),
      "t23: the same cwd maps to the same store key",
    );
    assert(
      projectKeyFor("C:\\repo a") !== projectKeyFor("C:\\repo  a"),
      "t23: a different cwd maps to a different store key",
    );
    assert(
      /^[A-Za-z0-9._-]+$/.test(projectKeyFor("C:\\repo a/\\*?:")),
      "t23: the key is filename-safe for a hostile cwd",
    );

    // Round-trip: two appends read back in order.
    recordAdvice("proj", "note one", 5, 1);
    recordAdvice("proj", "note two", 5, 2);
    const entries = readEntries("proj");
    assert(entries.length === 2, "t23: two appends store two entries");
    assert(
      entries[0].text === "note one" && entries[1].text === "note two",
      "t23: entries read back oldest first",
    );
    assert(entries[0].timestamp === 1, "t23: the seam's timestamp is stored");

    // The write-time cap keeps the newest.
    recordAdvice("proj", "note three", 2, 3);
    const capped = readEntries("proj");
    assert(
      capped.length === 2 && capped[0].text === "note two" && capped[1].text === "note three",
      "t23: the cap keeps the newest entries",
    );

    // Blank advice is skipped, not stored.
    recordAdvice("proj", "   ", 2, 4);
    assert(readEntries("proj").length === 2, "t23: blank advice is skipped");

    // An unknown key reads as the empty store, silently.
    const silent = captureWarn(() => readEntries("unknown"));
    assert(readEntries("unknown").length === 0, "t23: an unknown key reads as empty");
    assert(silent.length === 0, "t23: the ENOENT read warns nothing");

    // A corrupt store warns once with the pinned reason and reads as empty (the latch).
    rmSync(storeDir, { recursive: true, force: true });
    recordAdvice("proj", "seed", 5, 1);
    writeFileSync(join(storeDir, "proj.json"), "{ not json");
    const corruptWarns = captureWarn(() => {
      assert(readEntries("proj").length === 0, "t23: a corrupt store reads as empty");
      assert(readEntries("proj").length === 0, "t23: the corrupt store still reads as empty");
    });
    assert(
      corruptWarns.length === 1 &&
        corruptWarns[0].includes("ignoring unreadable advisor memory"),
      "t23: a corrupt store warns once with the pinned reason",
    );

    // capEntries: the pure cap arithmetic.
    const seeded = [
      { timestamp: 1, text: "a" },
      { timestamp: 2, text: "b" },
      { timestamp: 3, text: "c" },
    ];
    assert(capEntries(seeded, 0).length === 0, "t23: cap 0 is the empty store");
    assert(capEntries(seeded, -1).length === 0, "t23: a negative cap is the empty store");
    assert(capEntries(seeded, 5) === seeded, "t23: an over-cap cap is the identity");
    assert(capEntries(seeded, 3) === seeded, "t23: an at-cap cap is the identity");
    const two = capEntries(seeded, 2);
    assert(
      two.length === 2 && two[0].text === "b" && two[1].text === "c",
      "t23: an over-cap cap keeps the newest two",
    );

    // A write into a hostile path never throws; the warn carries the pinned reason.
    // The pre-read is silent, so the write's warn is deterministic on every platform.
    resetMemoryWarnOnceForTest();
    writeFileSync(join(tmpRoot, "memory-blocker"), "not a directory");
    const blockedHref = MEMORY_DIR_URL.href;
    MEMORY_DIR_URL.href = `${pathToFileURL(join(tmpRoot, "memory-blocker")).href}/`;
    let threw = false;
    const hostileWarns = captureWarn(() => {
      try {
        recordAdvice("proj", "lost advice", 5, 1);
      } catch {
        threw = true;
      }
    });
    MEMORY_DIR_URL.href = blockedHref;
    assert(!threw, "t23: a hostile store path never throws");
    assert(
      hostileWarns.length === 1 && hostileWarns[0].includes("advisor memory write failed"),
      "t23: a failed write warns once with the pinned reason",
    );

    // The digest builder: exact text, singular and plural, empty -> undefined.
    assert(digestMessage([], 1) === undefined, "t23: an empty store builds no digest");
    const one = digestMessage([{ timestamp: 1, text: "only advice" }], 7);
    assert(
      one.role === "system" &&
        one.content === "Advisor memory from earlier fires (1 entry):\n- only advice" &&
        one.timestamp === 7,
      "t23: the singular digest is exact",
    );
    const twoEntry = digestMessage(
      [
        { timestamp: 1, text: "first advice" },
        { timestamp: 2, text: "second advice" },
      ],
      7,
    );
    assert(
      twoEntry.content ===
        "Advisor memory from earlier fires (2 entries):\n- first advice\n- second advice",
      "t23: the plural digest is exact and reads oldest first",
    );

    // The window ride: base ends on an assistant, so the nudge rides and the digest
    // is inserted in front of it — the nudge stays terminal.
    const base = [
      { role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 },
    ];
    const digest = digestMessage([{ timestamp: 1, text: "prior fire" }], 5);
    const shaped = buildAdvisorMessages(base, 0, digest);
    assert(shaped.length === 4, "t23: the digest adds exactly one message");
    assert(shaped[2] === digest, "t23: the digest sits after the transcript");
    assert(shaped[2].role === "system", "t23: the digest is a system message");
    assert(shaped[3].content[0].text === ADVISOR_NUDGE, "t23: the nudge stays terminal");

    // The digest never folds and keeps the recency slot, even over a starved budget.
    const starved = buildAdvisorMessages(base, 1, digest);
    assert(
      starved.includes(digest) && starved[starved.length - 2] === digest,
      "t23: the digest survives a starved budget at the recency end",
    );
    assert(
      starved[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
      "t23: the transcript itself still folds under the budget",
    );

    // A transcript with its own user tail: the digest goes in front of it, the tail
    // stays terminal, and no nudge rides (ensureUserTail is untouched).
    const userTailed = buildAdvisorMessages([base[0]], 0, digest);
    assert(
      userTailed.length === 2 && userTailed[0] === digest && userTailed[1] === base[0],
      "t23: the digest is inserted in front of the transcript's own user tail",
    );

    // An empty transcript degrades to the digest alone; no nudge is invented.
    const empty = buildAdvisorMessages([], 0, digest);
    assert(
      empty.length === 1 && empty[0] === digest,
      "t23: an empty context yields the digest alone",
    );

    // Default-off: no digest is byte-identical to the pre-FR2 two-arg call.
    assert(
      JSON.stringify(buildAdvisorMessages(base)) ===
        JSON.stringify(buildAdvisorMessages(base, 0, undefined)),
      "t23: the absent digest is byte-identical to the pre-FR2 shape",
    );
  } finally {
    MEMORY_DIR_URL.href = realMemoryHref;
    rmSync(storeDir, { recursive: true, force: true });
  }
}

// --- 23c. the memoryCap field rides the same clamp/narrowing doors (extends t5/t7/t21c/t22c).
{
  const clamped = withConfig(JSON.stringify({ memoryCap: -3 }), () => loadConfig());
  assert(clamped.memoryCap === MIN_MEMORY_CAP, "t23c: a negative memoryCap clamps to 0 (off)");
  const high = withConfig(JSON.stringify({ memoryCap: 99999 }), () => loadConfig());
  assert(
    high.memoryCap === MAX_MEMORY_CAP,
    "t23c: an over-max memoryCap clamps down to the maximum",
  );
  const wrong = withConfig(JSON.stringify({ memoryCap: "many", interval: 4 }), () => loadConfig());
  assert(
    wrong.memoryCap === DEFAULT_CONFIG.memoryCap && wrong.interval === 4,
    "t23c: a string memoryCap falls back, leaving neighbors intact",
  );
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ memoryCap: "many" }), () => loadConfig()),
  );
  assert(silent.length === 0, "t23c: a wrong-typed memoryCap never reaches the clamp");
  const warns = captureWarn(() =>
    withConfig('{"memoryCap": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.memoryCap === MIN_MEMORY_CAP && cfg.interval === 1,
        "t23c: an infinite memoryCap clamps to 0 next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t23c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.memoryCap === 0, "t23c: the code default is 0 (memory off)");
}

Region F — the plan-turn import gains stampDetails (planHostSupport stays: locked
t21 asserts it — the round-1 verifier catch):

import { buildCorrection, planCommit, planGate, planHostSupport, stampDetails } from "../plan-turn.ts";

Region G — appended after the t23c block:

// --- 24. FR1 dialogue: the stamp core, the commit passthrough, and the key-less default.
{
  // stampDetails: the stable keys, exact and ordered.
  const stamp = stampDetails(3, 11);
  assert(
    stamp.fire === "3" && stamp.turn === "11",
    "t24: the stamp is the exact { fire, turn } string pair",
  );
  assert(
    JSON.stringify(Object.keys(stamp)) === JSON.stringify(["fire", "turn"]),
    "t24: the keys are stable and fire comes first",
  );
  assert(
    stampDetails(1, 0).fire === "1" && stampDetails(1, 0).turn === "0",
    "t24: the first fire stamps ordinal 1 on turn 0",
  );
}
{
  // buildCorrection: the stamp rides the draft; an absent stamp leaves NO key.
  const stamped = buildCorrection("advisor-turn-gate", "text", true, [], stampDetails(2, 7));
  const draft = stamped.entries[0];
  assert(draft.type === "custom_message", "t24: the stamped draft is a custom_message");
  assert(
    draft.details !== undefined &&
      draft.details.fire === "2" &&
      draft.details.turn === "7",
    "t24: the stamp rides the committed draft",
  );
  const unstamped = buildCorrection("advisor-turn-gate", "text", true, []);
  assert(
    unstamped.entries.length === 1 && !("details" in unstamped.entries[0]),
    "t24: an absent stamp leaves the draft key-less (the pre-FR1 byte shape)",
  );
  const peers = [{ type: "custom", customType: "peer-a" }];
  const withPeers = buildCorrection("ct", "t", true, peers, stampDetails(1, 1));
  assert(
    withPeers.entries.length === 2 &&
      withPeers.entries[0].customType === "peer-a" &&
      withPeers.entries[1].details?.fire === "1",
    "t24: stamping keeps the peer spread and the draft rides last",
  );
  assert(withPeers.continue === true, "t24: continue survives stamping");
}
{
  // planCommit: the passthrough reaches the committed draft; the notify arms stay
  // unchanged in format and carry no details anywhere.
  const committed = planCommit({
    outcome: { ok: true, text: "guidance" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(4, 12),
  });
  assert(
    committed.action === "commit" && committed.result.entries[0].details?.fire === "4",
    "t24: planCommit stamps the commit",
  );
  const failed = planCommit({
    outcome: { ok: false, reason: "advisor stopped with error" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(4, 12),
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t24: a failure notifies in the exact format, stamp or no stamp",
  );
}

Slice 5 regions:

Region A5 — imports. The node:fs import gains mkdirSync (symlinkSync is NOT needed:
the escape case rides stub fs). The config import gains MAX_TOOL_ROUNDS and
MIN_TOOL_ROUNDS (alphabetical slots). Add the sandbox import after the prompt import:

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

import {
  createSandbox,
  planRead,
  READ_FILE_TOOL,
  sandboxRefusalFor,
  SANDBOX_MAX_BYTES,
} from "../sandbox.ts";

Region A6 — header prose. The sibling-list sentence gains sandbox.ts:

  config.ts, guard.ts, memory.ts, prompt.ts, advisor.ts, report.ts, plan-turn.ts,
  triggers.ts, and sandbox.ts import no sibling at runtime, so this file resolves
  nothing from @earendil-works/* — a MODULE_NOT_FOUND here means a runtime import
  leaked into one of them.

The count bullet "this suite imports the eight sibling modules directly" (Slice 3's
Region A4 made it "eight") becomes "nine" — sandbox.ts is the ninth.

Region B5 — appended after the t24 blocks (end of the tests fence):

// --- 25. FR4 read-only tools: the pure path bound, the sandbox I/O, the loop, and
//         the shared deadline.
{
  // planRead: the pure prefix bound. Cases ride join()/resolve() so they hold on
  // win32 and POSIX alike; planRead does no fs, so no fixture files are needed.
  const root = join(tmpRoot, "sandbox-plan-root");
  assert(planRead(root, "src/a.ts").action === "allow", "t25: a project-relative path is allowed");
  assert(
    planRead(root, join(root, "src", "a.ts")).action === "allow",
    "t25: an absolute path inside the root is allowed",
  );
  const escape = planRead(root, join("..", "evil.ts"));
  assert(
    escape.action === "refuse" && escape.reason.includes("outside the project directory"),
    "t25: a parent escape is refused with the pinned wording",
  );
  assert(
    planRead(root, join(root, "..", "evil.ts")).action === "refuse",
    "t25: an in-root-relative escape sequence is refused",
  );
  assert(
    planRead(root, join(tmpdir(), "elsewhere", "x.ts")).action === "refuse",
    "t25: an absolute path outside the root is refused",
  );
  assert(planRead(root, "").action === "refuse", "t25: an empty path is refused");
  assert(planRead(root, undefined).action === "refuse", "t25: a missing path is refused");
  assert(planRead(root, 42).action === "refuse", "t25: a non-string path is refused");
}

{
  // The real sandbox over real files in tmpRoot: the happy path and the shape
  // refusals node itself produces. The escape and read-error shapes ride stub fs
  // in the next block, so this block stays platform-stable.
  const root = join(tmpRoot, "sandbox-live");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "note.txt"), "hello advice");
  const sandbox = createSandbox(root);
  const okRead = sandbox("read_file", { path: "note.txt" });
  assert(okRead.ok && okRead.text === "hello advice", "t25: a real read returns the file text");
  const wrongName = sandbox("write_file", { path: "note.txt" });
  assert(
    !wrongName.ok && wrongName.reason === sandboxRefusalFor("write_file"),
    "t25: a non-allowlisted name is refused with the pinned string",
  );
  const outside = sandbox("read_file", { path: join("..", "config-under-test.json") });
  assert(
    !outside.ok && outside.reason.includes("outside the project directory"),
    "t25: the sandbox refuses a parent escape",
  );
  const missing = sandbox("read_file", { path: "nope.txt" });
  assert(!missing.ok && missing.reason.includes("no such file"), "t25: a missing file refuses");
  const dirRead = sandbox("read_file", { path: "." });
  assert(!dirRead.ok && dirRead.reason.includes("not a file"), "t25: a directory read refuses");
  const capped = createSandbox(root, 4);
  const overCap = capped("read_file", { path: "note.txt" });
  assert(
    !overCap.ok && overCap.reason.includes("byte cap"),
    "t25: an over-cap read refuses with the byte-cap wording",
  );
  assert(createSandbox(root)("read_file", null).ok === false, "t25: null args refuse");
  assert(createSandbox(root)("read_file", {}).ok === false, "t25: path-less args refuse");
  assert(
    createSandbox(root)("read_file", { path: 42 }).ok === false,
    "t25: a numeric path refuses",
  );
}

{
  // The FsLike seam: a stub realpath escaping the root and a stub read throwing
  // are pinned deterministically — no real symlinks, no platform guards.
  const root = join(tmpRoot, "sandbox-stub");
  const escapeFs = {
    readFileSync: () => Buffer.alloc(0),
    realpathSync: () => join(tmpdir(), "outside", "secret.txt"),
  };
  const escaped = createSandbox(root, SANDBOX_MAX_BYTES, escapeFs)("read_file", {
    path: "note.txt",
  });
  assert(
    !escaped.ok && escaped.reason.includes("outside the project directory"),
    "t25: a realpath escaping the root is refused (stub fs)",
  );
  const boomFs = {
    readFileSync: () => {
      const err = new Error("disk gone");
      err.code = "EACCES";
      throw err;
    },
    realpathSync: (p) => p,
  };
  const denied = createSandbox(root, SANDBOX_MAX_BYTES, boomFs)("read_file", { path: "note.txt" });
  assert(
    !denied.ok && denied.reason.includes("disk gone"),
    "t25: a read error surfaces through the injected fs with its message",
  );
}

{
  // The loop: a toolUse round is consumed, the result replays, the terminal stop commits.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.ts" } },
            ],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "final guidance" }],
        });
      },
    },
  };
  const executed = [];
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: (name, args) => {
      executed.push([name, args]);
      return { ok: true, text: "file body" };
    },
    maxToolRounds: 3,
  });
  assert(outcome.ok && outcome.text === "final guidance", "t25: the loop resolves to the final text");
  assert(calls === 2, "t25: a consumed toolUse costs exactly one extra call");
  assert(
    executed.length === 1 && executed[0][0] === "read_file" && executed[0][1].path === "a.ts",
    "t25: the executor receives the call name and arguments",
  );
  assert(secondContext !== null, "t25: the second call carries the replayed conversation");
  assert(secondContext.messages.length === 3, "t25: the replay appends assistant + toolResult");
  assert(secondContext.messages[1].role === "assistant", "t25: the assistant turn is replayed");
  const result = secondContext.messages[2];
  assert(
    result.role === "toolResult" &&
      result.toolCallId === "c1" &&
      result.isError === false &&
      result.content[0].text === "file body",
    "t25: a successful execution replays as a non-error toolResult",
  );
  assert(
    secondContext.tools.length === 1 && secondContext.tools[0].name === "read_file",
    "t25: the declared tool rides every round's request",
  );
}

{
  // A refusal replays as isError and the advisor still gets its turn.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c2", name: "write_file", arguments: { path: "x" } },
            ],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "adapted guidance" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: (name) => ({ ok: false, reason: sandboxRefusalFor(name) }),
    maxToolRounds: 3,
  });
  assert(outcome.ok && outcome.text === "adapted guidance", "t25: a refusal does not fail the fire");
  assert(
    secondContext.messages[2].isError === true &&
      secondContext.messages[2].content[0].text === sandboxRefusalFor("write_file"),
    "t25: a refusal replays as an errored toolResult carrying the pinned reason",
  );
}

{
  // The rounds cap: a tool-happy advisor hits the terminal gate with the SAME
  // pinned reason the single-call path always produced, after exactly
  // maxRounds + 1 calls and no grace call.
  let calls = 0;
  const toolUse = () => {
    calls += 1;
    return Promise.resolve({
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "c" + calls, name: "read_file", arguments: {} }],
    });
  };
  const capped = await runAdvisor({
    registry: { runtime: { completeSimple: toolUse } },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 1,
  });
  assert(
    !capped.ok && capped.reason === "advisor stopped with toolUse",
    "t25: an exhausted round budget rejects with the pinned toolUse reason",
  );
  assert(calls === 2, "t25: maxToolRounds 1 spends exactly one loop round");
  calls = 0;
  const defaulted = await runAdvisor({
    registry: { runtime: { completeSimple: toolUse } },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
  });
  assert(
    !defaulted.ok && defaulted.reason === "advisor stopped with toolUse",
    "t25: the default cap rejects too",
  );
  assert(calls === 4, "t25: the omitted maxToolRounds defaults to 3 rounds (config parity)");
}

{
  // Unarmed runAdvisor with a toolUse response keeps the single-call rejection —
  // the t16 pin re-run through the new gate order.
  let calls = 0;
  const outcome = await runAdvisor({
    registry: {
      runtime: {
        completeSimple: () => {
          calls += 1;
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c", name: "read_file", arguments: {} }],
          });
        },
      },
    },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(
    !outcome.ok && outcome.reason === "advisor stopped with toolUse",
    "t25: an unarmed call still rejects a toolUse outright",
  );
  assert(calls === 1, "t25: an unarmed toolUse never loops");
}

{
  // Integration: the REAL sandbox refuses through the loop, by name, with the pinned string.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c3", name: "write_file", arguments: { path: "x" } },
            ],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "guidance after refusal" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: createSandbox(tmpRoot),
    maxToolRounds: 3,
  });
  assert(outcome.ok, "t25: a refused non-allowlisted call still lands guidance");
  assert(
    secondContext.messages[2].content[0].text === sandboxRefusalFor("write_file"),
    "t25: the real sandbox's refusal text reaches the advisor verbatim",
  );
}

{
  // The shared deadline: a fast toolUse round then a hung round dies at the
  // ORIGINAL budget, not budget-plus-round.
  const keep = setInterval(() => {}, 500);
  let calls = 0;
  const registry = {
    runtime: {
      completeSimple: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c", name: "read_file", arguments: { path: "a" } },
            ],
          });
        }
        return new Promise(() => {});
      },
    },
  };
  const t0 = Date.now();
  const hung = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: MIN_TIMEOUT_MS,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 3,
  });
  const dt = Date.now() - t0;
  clearInterval(keep);
  assert(
    !hung.ok && /timed out/.test(hung.reason),
    "t25: a hung second round fails open at the deadline",
  );
  assert(
    dt >= MIN_TIMEOUT_MS - 50 && dt < MIN_TIMEOUT_MS + 2000,
    `t25: the shared deadline fires on time for a ${MIN_TIMEOUT_MS}ms budget`,
  );
}

// --- 25c. the toolsEnabled and maxToolRounds fields ride the same clamp/narrowing
//          doors (extends t5/t7/t21c/t22c/t23c).
{
  const clamped = withConfig(JSON.stringify({ maxToolRounds: 0 }), () => loadConfig());
  assert(
    clamped.maxToolRounds === MIN_TOOL_ROUNDS,
    "t25c: a zero maxToolRounds clamps up to the minimum",
  );
  const high = withConfig(JSON.stringify({ maxToolRounds: 999 }), () => loadConfig());
  assert(
    high.maxToolRounds === MAX_TOOL_ROUNDS,
    "t25c: an over-max maxToolRounds clamps down to the maximum",
  );
  const wrong = withConfig(
    JSON.stringify({ toolsEnabled: "yes", maxToolRounds: "three", interval: 5 }),
    () => loadConfig(),
  );
  assert(
    wrong.toolsEnabled === DEFAULT_CONFIG.toolsEnabled &&
      wrong.maxToolRounds === DEFAULT_CONFIG.maxToolRounds &&
      wrong.interval === 5,
    "t25c: wrong-typed tool fields fall back, leaving neighbors intact",
  );
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ maxToolRounds: "three" }), () => loadConfig()),
  );
  assert(silent.length === 0, "t25c: a wrong-typed maxToolRounds never reaches the clamp");
  const warns = captureWarn(() =>
    withConfig('{"maxToolRounds": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.maxToolRounds === MIN_TOOL_ROUNDS && cfg.interval === 1,
        "t25c: an infinite maxToolRounds clamps up next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t25c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.toolsEnabled === false, "t25c: the code default is tools OFF");
  assert(DEFAULT_CONFIG.maxToolRounds === 3, "t25c: the code default is 3 rounds");
}

Slice 6 regions:

Region A7 — the advisor import becomes:

import {
  callWithDeadline,
  CONSULT_ANSWER_HEADER,
  CONSULT_QUESTION_REFUSAL,
  CONSULT_SECTION_SEPARATOR,
  CONSULT_SPECIALIST_NAME,
  CONSULT_SPECIALIST_TOOL,
  CONSULT_UNCONFIGURED_REFUSAL,
  extractAdvisorText,
  getRuntimeCompleteSimple,
  resolveAdvisorModel,
  runAdvisor,
  stripAdvisorMarkup,
  undeclaredToolRefusalFor,
} from "../advisor.ts";

(No new module, so the sibling count stays "nine" and no header prose changes. No new
config constants — the two fields are unclamped strings.)

Region B6 — appended after the t25c block (end of the tests fence):

// --- 26. FR6 specialist consult: the declared tool, the consult leg, the routing,
//         the shared deadline, and the aggregation.
{
  // Happy path: one consult round, the leg answers tool-free, the loop continues,
  // and the final stop aggregates base + specialist byte-exact.
  let calls = 0;
  const contexts = [];
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        calls += 1;
        contexts.push({ model, context });
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "cs1",
                name: "consult_specialist",
                arguments: { question: "Is the retry policy sound?" },
              },
            ],
          });
        }
        if (model === specialistModel) {
          return Promise.resolve({
            stopReason: "stop",
            content: [{ type: "text", text: "back off exponentially; cap at five tries" }],
          });
        }
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "final guidance" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
    timeoutMs: 5000,
    maxToolRounds: 3,
    specialist: { model: specialistModel, systemPrompt: "specialist prompt" },
  });
  assert(
    outcome.ok &&
      outcome.text ===
      "final guidance\n\n---\n\nSpecialist consult answer:\nback off exponentially; cap at five tries",
    "t26: the fire aggregates base advice and the specialist answer byte-exact",
  );
  assert(calls === 3, "t26: a consult fire costs exactly three calls (main, leg, main)");
  const legContext = contexts[1];
  assert(
    legContext.model === specialistModel &&
      legContext.context.systemPrompt === "specialist prompt",
    "t26: the specialist leg carries the specialist model and system prompt",
  );
  assert(
    legContext.context.messages.length === 1 &&
      legContext.context.messages[0].role === "user" &&
      legContext.context.messages[0].content[0].text === "Is the retry policy sound?",
    "t26: the specialist leg receives the question as its only user message",
  );
  assert(legContext.context.tools === undefined, "t26: the specialist leg is tool-free");
  assert(
    contexts[2].context.messages.length === 3 &&
      contexts[2].context.messages[2].role === "toolResult" &&
      contexts[2].context.messages[2].isError === false &&
      contexts[2].context.messages[2].content[0].text ===
        "back off exponentially; cap at five tries",
    "t26: the consult answer replays to the advisor as a non-error toolResult",
  );
  assert(
    contexts[2].context.tools.length === 1 &&
      contexts[2].context.tools[0].name === CONSULT_SPECIALIST_NAME,
    "t26: the consult tool rides every round's request",
  );
  assert(
    CONSULT_SPECIALIST_TOOL.parameters.properties.question.type === "string",
    "t26: the declared tool takes one string question",
  );
}
{
  // Two consults aggregate in fire order between the pinned separators and headers.
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  const registry = {
    runtime: {
      completeSimple: (model) => {
        step += 1;
        if (model === specialistModel) {
          const text = step === 2 ? "answer one" : "answer two";
          return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text }] });
        }
        const isLast = step === 5;
        return Promise.resolve(
          isLast
            ? { stopReason: "stop", content: [{ type: "text", text: "final" }] }
            : {
                stopReason: "toolUse",
                content: [
                  {
                    type: "toolCall",
                    id: `cs${step}`,
                    name: "consult_specialist",
                    arguments: { question: step === 1 ? "q one" : "q two" },
                  },
                ],
              },
        );
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    outcome.ok &&
      outcome.text ===
      ["final", `${CONSULT_ANSWER_HEADER}\nanswer one`, `${CONSULT_ANSWER_HEADER}\nanswer two`].join(
        CONSULT_SECTION_SEPARATOR,
      ),
    "t26: two consults aggregate in fire order with the pinned separator and header",
  );
  assert(
    stripAdvisorMarkup(outcome.text) === outcome.text,
    "t26: the aggregated text passes through stripAdvisorMarkup byte-identical",
  );
  assert(
    !outcome.text.includes("\n\n\n"),
    "t26: no run of three newlines exists anywhere in the aggregated text",
  );
}
{
  // Base-only fail arm: the specialist leg resolves with stopReason "error"; the
  // reason replays as an errored toolResult and the final text carries no section.
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        step += 1;
        if (model === specialistModel) {
          return Promise.resolve({
            stopReason: "error",
            errorMessage: "Provider is not configured: openai",
            content: [],
          });
        }
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "cs1",
                name: "consult_specialist",
                arguments: { question: "q" },
              },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "base only" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    outcome.ok && outcome.text === "base only",
    "t26: a failed leg commits base-only advice with no section",
  );
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === "Provider is not configured: openai",
    "t26: a failed leg replays its reason as an errored toolResult",
  );
}
{
  // Base-only fail arm: a hung specialist leg dies at the shared remaining budget,
  // and the shared-clock timeout text rides the errored toolResult verbatim.
  const keep = setInterval(() => {}, 500);
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        step += 1;
        if (model === specialistModel) return new Promise(() => {});
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "cs1",
                name: "consult_specialist",
                arguments: { question: "q" },
              },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "base only" }],
        });
      },
    },
  };
  const t0 = Date.now();
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: MIN_TIMEOUT_MS,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  const dt = Date.now() - t0;
  clearInterval(keep);
  assert(
    outcome.ok && outcome.text === "base only",
    "t26: a hung leg still lands base-only advice",
  );
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text.includes(
        `advisor call timed out after ${MIN_TIMEOUT_MS}ms`,
      ),
    "t26: the shared-clock timeout text rides the errored toolResult verbatim",
  );
  assert(
    dt >= MIN_TIMEOUT_MS - 50 && dt < MIN_TIMEOUT_MS + 2000,
    "t26: the consult leg races the fire's remaining budget, not a fresh one",
  );
}
{
  // The question guard: missing, empty, whitespace-only, and non-string questions
  // refuse with the pinned string; the leg never runs; the fire still lands.
  for (const bad of [{}, { question: "" }, { question: "   " }, { question: 42 }]) {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    let step = 0;
    let finalContext = null;
    const registry = {
      runtime: {
        completeSimple: (model, context) => {
          step += 1;
          if (model === specialistModel) {
            throw new Error("the leg must never run for a malformed question");
          }
          if (step === 1) {
            return Promise.resolve({
              stopReason: "toolUse",
              content: [
                { type: "toolCall", id: "cs1", name: "consult_specialist", arguments: bad },
              ],
            });
          }
          finalContext = context;
          return Promise.resolve({
            stopReason: "stop",
            content: [{ type: "text", text: "base" }],
          });
        },
      },
    };
    const outcome = await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      specialist: { model: specialistModel, systemPrompt: "sp2" },
    });
    assert(
      outcome.ok && outcome.text === "base",
      "t26: a malformed question never fails the fire",
    );
    assert(
      finalContext.messages[1].isError === true &&
        finalContext.messages[1].content[0].text === CONSULT_QUESTION_REFUSAL,
      "t26: a malformed question refuses with the pinned string",
    );
  }
}
{
  // The unconfigured consult: the loop is armed by the sandbox tools alone, the
  // advisor names consult_specialist anyway, and the pinned refusal replays.
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        step += 1;
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "c1",
                name: "consult_specialist",
                arguments: { question: "q" },
              },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text: "base" }] });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 3,
  });
  assert(
    outcome.ok && outcome.text === "base",
    "t26: an unconfigured consult never fails the fire",
  );
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === CONSULT_UNCONFIGURED_REFUSAL,
    "t26: an unconfigured consult refuses with the pinned string",
  );
  assert(
    finalContext.tools.length === 1 && finalContext.tools[0].name === "read_file",
    "t26: no specialist means the consult tool is not declared",
  );
}
{
  // Specialist-only arming: no sandbox, no executor — consult_specialist is the
  // only declared tool, and an undeclared name refuses with the pinned string.
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let declared = null;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        step += 1;
        if (step === 1) {
          declared = context.tools;
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c1", name: "write_file", arguments: { path: "x" } },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text: "base" }] });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    declared.length === 1 && declared[0].name === CONSULT_SPECIALIST_NAME,
    "t26: a specialist-only fire declares exactly the consult tool",
  );
  assert(
    outcome.ok && outcome.text === "base",
    "t26: an undeclared name never fails the fire",
  );
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === undeclaredToolRefusalFor("write_file"),
    "t26: an undeclared tool name refuses with the pinned string",
  );
}
{
  // The round budget counts consult rounds: maxToolRounds 1 spends one consult
  // round and then rejects at the terminal gate with the SAME pinned toolUse
  // reason, after main + leg + terminal main.
  let calls = 0;
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  const registry = {
    runtime: {
      completeSimple: (model) => {
        calls += 1;
        if (model === specialistModel) {
          return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text: "leg" }] });
        }
        return Promise.resolve({
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: `c${calls}`,
              name: "consult_specialist",
              arguments: { question: "q" },
            },
          ],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    maxToolRounds: 1,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    !outcome.ok && outcome.reason === "advisor stopped with toolUse",
    "t26: an exhausted round budget rejects consults with the pinned toolUse reason",
  );
  assert(calls === 3, "t26: maxToolRounds 1 spends main + leg + terminal main");
}
{
  // Default-off: an unarmed call (no tools, no specialist) with a plain stop keeps
  // the single-call shape and byte-identical text — the pre-FR6 contract.
  let calls = 0;
  const registry = {
    runtime: {
      completeSimple: () => {
        calls += 1;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "plain" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(
    outcome.ok && outcome.text === "plain" && calls === 1,
    "t26: the default-off fire is the single-call shape",
  );
}

// --- 26c. the specialistModel and specialistSystemPrompt fields ride the same
//          narrowing doors (extends t5/t7/t21c/t22c/t23c/t25c).
{
  const cfg = withConfig(
    JSON.stringify({ specialistModel: "  openai/gpt-5.1  ", specialistSystemPrompt: "custom" }),
    () => loadConfig(),
  );
  assert(cfg.specialistModel === "openai/gpt-5.1", "t26c: a padded specialistModel is trimmed");
  assert(
    cfg.specialistSystemPrompt === "custom",
    "t26c: a custom specialist prompt survives",
  );
  const wrong = withConfig(
    JSON.stringify({ specialistModel: 42, specialistSystemPrompt: "   ", interval: 6 }),
    () => loadConfig(),
  );
  assert(
    wrong.specialistModel === DEFAULT_CONFIG.specialistModel &&
      wrong.specialistSystemPrompt === DEFAULT_CONFIG.specialistSystemPrompt &&
      wrong.interval === 6,
    "t26c: wrong-typed and empty specialist fields fall back, leaving neighbors intact",
  );
  assert(DEFAULT_CONFIG.specialistModel === "", "t26c: the code default is consults OFF");
  assert(
    DEFAULT_CONFIG.specialistSystemPrompt.length > 0,
    "t26c: the specialist prompt ships a non-empty default",
  );
}

Slice 7 regions:

Region B7 — the plan-turn import line gains planSettle, alphabetically between
planHostSupport and stampDetails, and t27 + t27c are appended after the t26c block
(end of the tests fence; both former >100-col lines reflowed to the biome width; the
abstain pin is folded into the declaring commit block — biome rejects a declaration-free
lone block, the t7b/t9 banner rule):

import { buildCorrection, planCommit, planGate, planHostSupport, planSettle, stampDetails } from "../plan-turn.ts";

// --- 27. FR8 async fire: the settle core — abstain, the two notify arms, the
//         once-only commit shape, and the never-wake pin.
{
  // Abstain first: an empty slot decides nothing.
  assert(
    planSettle({
      held: undefined,
      customType: "advisor-turn-gate",
      display: true,
      peerEntries: [],
      strip: (text) => text,
      details: stampDetails(1, 0),
    }).action === "abstain",
    "t27: an empty slot abstains",
  );
  // Commit: peers spread first, the draft rides last, the stamp carries the
  // FIRE-TIME turn index, and the result carries NO continue key — the settle
  // path never wakes an idle agent (FR8).
  const peers = [{ type: "custom", customType: "peer-a" }];
  const settle = planSettle({
    held: { outcome: { ok: true, text: "async advice" }, turnIndex: 7 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: peers,
    strip: (text) => text,
    details: stampDetails(2, 7),
  });
  assert(settle.action === "commit", "t27: held advice commits");
  assert(
    settle.result.entries.length === 2 && settle.result.entries[0].customType === "peer-a",
    "t27: the settle commit keeps the settle event's peer spread",
  );
  const draft = settle.result.entries[1];
  assert(
    draft.type === "custom_message" &&
      draft.content === "async advice" &&
      draft.details?.fire === "2" &&
      draft.details?.turn === "7",
    "t27: the draft rides the stamp with the fire-time turn index",
  );
  assert(
    !("continue" in settle.result),
    "t27: the settle result carries NO continue key (never wakes an idle agent)",
  );
  const blocking = buildCorrection(
    "advisor-turn-gate",
    "async advice",
    true,
    peers,
    stampDetails(2, 7),
  );
  assert(
    JSON.stringify(draft) === JSON.stringify(blocking.entries[1]),
    "t27: the settle draft is byte-equal to the blocking draft",
  );
}
{
  // The strip thunk runs on the held text before the commit.
  const marked = planSettle({
    held: { outcome: { ok: true, text: "advice" }, turnIndex: 1 },
    customType: "ct",
    display: true,
    peerEntries: [],
    strip: (text) => `<${text}>`,
    details: stampDetails(1, 1),
  });
  assert(
    marked.action === "commit" && marked.result.entries[0].content === "<advice>",
    "t27: the strip runs on the held text",
  );
}
{
  // The failure arm notifies in the exact reportFailure format.
  const failed = planSettle({
    held: { outcome: { ok: false, reason: "advisor stopped with error" }, turnIndex: 3 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(1, 3),
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t27: a failed held call notifies in the exact format",
  );
  // The husk arm: markup-only advice fails open exactly like the blocking path
  // (the real strip's husk behavior is pinned at t15b/t9; a thunk isolates this arm).
  const husk = planSettle({
    held: { outcome: { ok: true, text: "markup husk" }, turnIndex: 4 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: () => "",
    details: stampDetails(1, 4),
  });
  assert(
    husk.action === "notify" &&
      husk.message === "advisor-turn-gate: advisor reply was markup only",
    "t27: a markup-only held reply notifies the husk message",
  );
}

// --- 27c. the asyncMode field rides the same narrowing doors (extends
//          t5/t7/t21c/t22c/t23c/t25c/t26c).
{
  const wrong = withConfig(JSON.stringify({ asyncMode: "yes", interval: 7 }), () => loadConfig());
  assert(
    wrong.asyncMode === false && wrong.interval === 7,
    "t27c: a wrong-typed asyncMode falls back, leaving neighbors intact",
  );
  const on = withConfig(JSON.stringify({ asyncMode: true }), () => loadConfig());
  assert(on.asyncMode === true, "t27c: asyncMode true survives");
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ asyncMode: 1 }), () => loadConfig()),
  );
  assert(silent.length === 0, "t27c: a wrong-typed asyncMode never warns");
  assert(DEFAULT_CONFIG.asyncMode === false, "t27c: the code default is blocking (async off)");
}

Slice 8 region:

Region S8-T-A — header banner prose. Appended after the MODULE_NOT_FOUND paragraph:

  eval/runner.mjs is the second offline runner (the sanctioned split, TECH_DEBT_AUDIT.md):
  golden fixtures per pillar replay the full pipeline — planGate, buildAdvisorMessages,
  runAdvisor over a scripted facade, planCommit — and CI gates on the score table.
  Fixture-style end-to-end scenarios live there; this file stays the unit-pin suite and
  nothing pinned moves.
```

### .gitignore — MODIFY

Slices 3, 8. Slice 3 adds the memory line:

```
.advisor-memory/
```

### README.md — MODIFY

Slices 3, 7, 8: config table rows (7 adds asyncMode); Verify section gains the eval command.

```md
Slice 3 adds one config table row:

| `memoryCap`    | `0` (disabled)        | Advisor entries kept per project in the local `.advisor-memory/` store. Each fire appends its advice; the next fire's prompt carries the digest. Clamped 0-200. |

Slice 7 adds one config table row (after the memoryCap row):

| `asyncMode` | `false` (blocking) | Commit the advisor's reply at the next agent settlement instead of blocking turn_end. The advisor never wakes an idle agent. |

Slice 8 adds the Verify-section eval line and rewrites the closing paragraph:

    npm install
    npm test
    npm run lint
    npm run typecheck
    npm run eval

and:

    `eval/` replays golden fixtures per pillar through the real gate pipeline and
    prints a score table. CI runs the same checks — test, lint, typecheck, and the
    eval score gate — on every push. Activate the pre-commit checks with
    `git config core.hooksPath .githooks`.
```

### package.json — MODIFY

Slice 8 adds the eval runner beside the test runner.

```json
"scripts": {
  "test": "node --experimental-strip-types tests/test.mjs",
  "eval": "node --experimental-strip-types eval/runner.mjs",
  "lint": "biome check .",
  "format": "biome check --write .",
  "typecheck": "tsc --noEmit"
},
```

### .github/workflows/ci.yml — MODIFY

Slice 8 appends the eval step after typecheck (at the existing 6-space step level).

```yaml
      - run: npm test
      - run: npm run lint
      - run: npm run typecheck
      # FR9: the eval score gate. A failing score fails the job: the runner sets
      # process.exitCode when any fixture errors or any score misses.
      - run: npm run eval
```

## Slices

### Slice 1: Trigger arms + 1.4.x guard

**Files**: `triggers.ts`, `plan-turn.ts`, `config.ts`, `index.ts`, `tests/test.mjs`

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green; new t21 + t21c pass)
- [ ] planTrigger arm order, off-state, exact-match, and aborted pins pass (t21)
- [ ] planGate: trigger fires ahead of cadence, spends the latch exactly once, error-trigger bypasses the outcome veto, cadence-due errored turns keep the F007 slide, on-cadence turns invoke no trigger thunk (t21)
- [ ] planHostSupport accepts 1.4 shapes and rejects the bare 0.79 emit with the pinned message (t21)
- [ ] The four trigger fields clamp through clampWithWarn with the shared latch and wrong-typed neighbors stay intact (t21c)
- [ ] Lint clean: `npx biome check triggers.ts plan-turn.ts config.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with the four trigger fields at defaults (0 / 0 / false / "") keeps today's firing behavior exactly
- [ ] `triggerContextPercent: 1` fires the gate before the next cadence boundary in a live session; the latch advanced exactly once
- [ ] With `enabled: false`, no host-support warning appears even on an old host

### Slice 2: Prompt budget

**Files**: `prompt.ts`, `config.ts`, `index.ts`, `tests/test.mjs`

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including t10's one-arg call; new t22 + t22c pass)
- [ ] The chars/4 estimate pin passes (t22)
- [ ] Fold pins: systems kept in place, tail byte-identical, marker carries the pinned prefix, folded count, and first folded timestamp (t22)
- [ ] Best-effort pins: starved budget keeps systems + tail, system-only and lone contexts are the identity over budget (t22)
- [ ] Window pins: default 0 equals explicit 0, nudge still appended after a fold, strip still runs inside the budgeted pipeline (t22)
- [ ] `tokenBudget` clamps (negative to 0, over-max to 1000000), narrows without poisoning neighbors, and shares the warn-once latch (t22c)
- [ ] Lint clean: `npx biome check prompt.ts config.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no tokenBudget field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `tokenBudget: 2000` on a long live session: the fire still commits and the entry renders, with no provider payload-size rejection

### Slice 3: Project memory

**Files**: memory.ts, config.ts, prompt.ts, index.ts, .gitignore, README.md, tests/test.mjs

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including t10's one-arg and t22's two-arg buildAdvisorMessages calls; new t23 + t23c pass)
- [ ] Digest pins pass: exact singular and plural header text, oldest-first order, timestamp passthrough, empty store builds no digest (t23)
- [ ] Store pins pass: ENOENT reads silent and empty, corrupt store warns once with the pinned reason through the shared latch, append plus count-cap keeps the newest, blank advice skipped, hostile store path never throws (t23)
- [ ] Window pins pass: the digest is inserted in front of the payload's final message (nudge stays terminal), survives a starved budget unfolded at the recency end, degrades to the digest alone on an empty context, and the absent digest is byte-identical to the pre-FR2 shape (t23)
- [ ] The recorded advice is the commit-stripped text: `stripAdvisorMarkup` runs before `recordAdvice` in the seam (`grep -n "stripAdvisorMarkup(outcome.text)" index.ts` finds the record call)
- [ ] `memoryCap` clamps (negative to 0, over-max to 200), narrows without poisoning neighbors, stays silent on wrong types, and shares the warn-once latch (t23c)
- [ ] Lint clean: `npx biome check memory.ts prompt.ts config.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no memoryCap field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `memoryCap: 20` live: after two fires, `.advisor-memory/<key>.json` exists beside the extension and holds the trimmed advice texts
- [ ] Deleting `.advisor-memory/` resets memory; the next fire recreates it with no error surfaced

### Slice 4: Dialogue

**Files**: `plan-turn.ts`, `index.ts`, `tests/test.mjs`

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including t9's four-arg buildCorrection call and t21's planHostSupport block; new t24 passes)
- [ ] stampDetails pins: exact { fire, turn } string pair, stable key order, ordinal 1 on turn 0 for the first fire (t24)
- [ ] buildCorrection pins: the stamp rides the committed draft; an absent stamp leaves the draft key-less (the pre-FR1 byte shape); the peer spread and continue survive stamping (t24)
- [ ] planCommit pins: the passthrough reaches the committed draft; the notify arm stays in the exact format with a stamp in play (t24)
- [ ] Lint clean: `npx biome check plan-turn.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] A live session with the gate on: after two fires, the session file shows the committed entries carrying details {"fire":"1","turn":N} then {"fire":"2","turn":M}
- [ ] The advisor's next fire demonstrably sees its own prior advice (host re-projection converts committed content to a user message; no config change needed)
- [ ] A session holding pre-slice-4 advisor entries: the next fire still works; old entries lack details and still replay into context

### Slice 5: Read-only tools

**Files**: `sandbox.ts`, `advisor.ts`, `config.ts`, `index.ts`, `tests/test.mjs`

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including every t16 runAdvisor pin; new t25 + t25c pass)
- [ ] planRead pins: relative allowed, in-root absolute allowed, parent escape refused, absolute-outside refused, empty/missing/non-string path refused (t25)
- [ ] Sandbox pins: real read returns text, non-allowlisted name refuses with the exact pinned string, missing-file and directory reads refuse, over-cap read refuses with the byte-cap wording, hostile args refuse, symlink-class escape refused via the injected FsLike (stub realpath), read errors surface through the seam (stub fs) (t25)
- [ ] Loop pins: a toolUse round costs exactly one extra call, the replay carries assistant + non-error toolResult, the declared tool rides every round (t25)
- [ ] Refusal pins: a refused execution replays as isError with the pinned reason and the fire still succeeds (t25)
- [ ] Rounds cap: maxToolRounds 1 spends exactly one round then rejects with "advisor stopped with toolUse"; the omitted default is 3 rounds (config parity) (t25)
- [ ] Unarmed pins: no tools + toolUse response rejects in one call, never loops (t25)
- [ ] Shared-deadline pin: a fast toolUse round then a hung round fails at the original budget (t25)
- [ ] toolsEnabled narrows per type and defaults false; maxToolRounds clamps 1-10, warns through the shared latch, wrong-typed neighbors stay intact (t25c)
- [ ] Lint clean: `npx biome check sandbox.ts advisor.ts config.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no toolsEnabled field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `toolsEnabled: true` live: an advisor fire that wants a file issues a visible read_file round and its final entry cites the file content; no write ever occurs
- [ ] A request for a path outside the project shows up in the advisor's final prose as refused, with no file contents leaked

### Slice 6: Specialist consult

**Files**: `advisor.ts`, `config.ts`, `index.ts`, `tests/test.mjs`

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including every t16 runAdvisor pin and the t25 loop pins; new t26 + t26c pass)
- [ ] Consult leg pins: the leg is tool-free, carries the specialist model and system prompt, and receives the advisor's question as its only user message (t26)
- [ ] Aggregation pins: one consult joins base + separator + header + answer byte-exact; two consults join in fire order; the aggregated text passes through stripAdvisorMarkup byte-identical and contains no 3-newline run (t26)
- [ ] Fail-arm pins: a specialist leg error or a hung leg (shared-clock timeout) replays as an errored toolResult carrying the cause, and the fire still commits base-only text with no separator or header (t26)
- [ ] Guard pins: missing/empty/whitespace/non-string question refuses with the pinned string and the leg never runs; consult without a configured specialist refuses with the pinned string; an undeclared tool name in specialist-only mode refuses with the pinned string (t26)
- [ ] Arming pins: a specialist-only fire declares exactly [consult_specialist]; consult rounds spend the shared maxToolRounds and the exhausted budget rejects with "advisor stopped with toolUse"; an unarmed call keeps the single-call shape byte-identical (t26)
- [ ] specialistModel narrows per type and trims; specialistSystemPrompt falls back to the default on empty or wrong type; both defaults keep consults off (t26c)
- [ ] Lint clean: `npx biome check advisor.ts config.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no specialistModel field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `specialistModel: "openai/gpt-5.1"` live: an advisor fire that flags a domain shows the consult round, and the committed entry carries the base advice, the --- separator, and the specialist answer section
- [ ] A specialist configured without credentials: fires still commit base-only advice; no consult section appears

### Slice 7: Async fire

**Files**: `index.ts`, `config.ts`, `plan-turn.ts`, `tests/test.mjs`, `README.md`

#### Automated Verification:
- [ ] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including every t24 buildCorrection pin; new t27 + t27c pass)
- [ ] planSettle pins: an empty slot abstains; a failed held call notifies `advisor-turn-gate: <reason>`; a markup-only husk notifies the exact husk message; a commit spreads the settle event's peers, rides the draft last, stamps the fire-time turn index, and runs the strip thunk (t27)
- [ ] The never-wake pin: the settle commit result carries NO `continue` key, and the settle draft is byte-equal to the blocking draft (`grep -n "continue: true" plan-turn.ts` returns exactly one hit, inside buildCorrection)
- [ ] The both-slot guard exists verbatim: `grep -n "advisorInFlight || heldAdvice" index.ts` returns exactly one hit (the overwrite blocker's fix), and the contract-violation catch reason exists verbatim: `grep -c "async advisor call threw" index.ts` returns 1
- [ ] Async memory parity: `grep -c "stripAdvisorMarkup(outcome.text)" index.ts` returns 2 (the Region H blocking record and the async .then record)
- [ ] asyncMode narrows per type with no warning and defaults false — the blocking shape (t27c)
- [ ] Lint clean: `npx biome check plan-turn.ts config.ts index.ts tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no asyncMode field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `asyncMode: true` live: turn_end returns instantly (no 60s block), the entry lands at the next settlement boundary stamped with the fire-time turn, and an idle agent stays idle after the commit
- [ ] A gate-pass while a previous async call is in flight OR a result is still held: the second call is skipped, exactly one entry lands, no outcome is overwritten, and the latch shows one spend per consumed fire
- [ ] asyncMode true with memoryCap on: the fire's advice lands in .advisor-memory/ even though the commit lands at settle
- [ ] asyncMode true with the advisor unreachable: the settle boundary reports the failure once; no entry commits

### Slice 8: Eval harness

**Files**: eval/runner.mjs, eval/fixtures/*.json (6), package.json, .github/workflows/ci.yml, README.md, tests/test.mjs

#### Automated Verification:
- [ ] Whole-suite baseline (terminal slice): `npm test` passes — every pinned section t1 through t27 stays green and nothing moved
- [ ] The nothing-moved contract: `grep -c "^// ---" tests/test.mjs` returns exactly 37 (t1..t27 banners complete, none relocated)
- [ ] Eval green offline: `npm run eval` exits 0, prints the gate self-test PASS line, replays 6/6 fixtures, and passes 8/8 scores
- [ ] Score rows each print PASS: trigger-arms/drift-caught, budget-window/budget-respected, tool-use-script/sandbox-read-applied, consult-aggregation/single-entry-aggregation, allowlist-refusal/allowlist-refused, dialogue-keys/repeats-avoided, dialogue-keys/dialogue-keys, dialogue-keys/advice-adopted
- [ ] The gate can fail: `grep -n "known-false expectation" eval/runner.mjs` returns exactly one hit (the self-test arm that proves a false expectation registers)
- [ ] Lint clean: `npx biome check eval/ package.json .github/workflows/ci.yml README.md tests/test.mjs`
- [ ] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] `npm run eval` prints the full score table plus the summary line; deleting one fixture file locally drops the summary count by one and the runner still passes
- [ ] CI: the eval step runs after typecheck on both node versions; editing one fixture expectation locally (for example adviceIncludes) turns the eval step red
- [ ] `npm run eval` runs with no credentials configured (the registry is a stub; no network happens)

## Desired End State

A user turns the system on incrementally in config.json, no reload needed:

```json
{
  "enabled": true,
  "model": "anthropic/claude-sonnet-4-5",
  "interval": 10,
  "triggerMinNewTokens": 20000,
  "triggerContextPercent": 70,
  "triggerOnError": true,
  "triggerRiskyTools": "git push, rm",
  "tokenBudget": 60000,
  "memoryCap": 20,
  "toolsEnabled": true,
  "maxToolRounds": 3,
  "specialistModel": "openai/gpt-5.1",
  "asyncMode": false
}
```

A fire then: reads the memory digest for this project, arms early when the turn grew 20k tokens or context crossed 70% or a risky tool ran, folds the transcript to the token budget keeping all system messages and a verbatim tail, lets the advisor read up to 3 files through the sandbox, consults the specialist when the advisor flags a domain, and commits ONE custom_message entry — stamped with fire id and turn index — that the next fire sees as dialogue. With asyncMode true, the advisor call detaches and the entry lands at the next natural settle. eval/ replays golden fixtures of all of it offline, and CI gates on the scores.

## File Map

- triggers.ts  # NEW — pure trigger predicates and arming check
- memory.ts  # NEW — per-project memory store + digest builder
- sandbox.ts  # NEW — read_file-only advisor tool sandbox
- eval/runner.mjs  # NEW — offline eval runner and scorer
- eval/fixtures/  # NEW — golden fixtures per pillar
- index.ts  # MODIFY — seam wiring for every slice; async settle registration
- plan-turn.ts  # MODIFY — trigger arm, host support, details stamping, planSettle
- prompt.ts  # MODIFY — budget fold + digest injection point
- advisor.ts  # MODIFY — tool loop + specialist leg
- config.ts  # MODIFY — ~11 new fields, all narrowed and clamped
- tests/test.mjs  # MODIFY — pinned sections per slice
- .gitignore  # MODIFY — .advisor-memory/
- README.md  # MODIFY — config rows + eval command
- package.json  # MODIFY — eval script
- .github/workflows/ci.yml  # MODIFY — eval score gate

## Ordering Constraints

- Strictly sequential 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8; each slice builds on the locked previous one.
- Slice 1 is the foundation: it extends PlanGateArgs (the seam every later slice wires through) and pins the trigger/cadence/markFired interaction every later fire depends on.
- Slice 3's digest composes with Slice 2's window; Slice 4's keys feed Slice 3's digest identity; Slice 6's consult leg rides Slice 5's loop; Slice 8 evaluates every prior pillar.
- No parallel slices; within a slice, test pins land with the code they pin.

## Verification Notes

- Every new failure path carries an exact-string pin (fail-open contract). Grep the test file for each new reason string.
- markFired interaction: trigger-fire and cadence-fire each spend the latch exactly once at gate-pass; errored cadence turns never spend (F007 slide preserved). Fold-parity pins in the t1b style.
- Peer spread: peerEntries survive fires in blocking mode (existing) and async mode (Slice 7 two-event seam test).
- Strip stays the last filter: no new fake-tool dialect bypasses the tiers; any new refusal vocabulary follows the F023 byte-identity guard discipline; the consult separator survives the 3-newline collapse (advisor.ts:186-190).
- Config: every new field narrowed per type against DEFAULT_CONFIG; clamps warn once; ENOENT silent; broken JSON warns once.
- customType stays "advisor-turn-gate" exactly (reload filter + denylist identifier).
- Version skew: on a pre-1.4 host the gate notifies once and disables; on 1.4.x nothing changes. Pin planHostSupport both ways.
- Default-off: with the new fields absent, behavior is byte-equivalent to today (verified by the untouched existing suite).
- Git history note: this session's metadata collection failed (PowerShell echo errors), so precedent-locator was skipped; precedent evidence (084b1f8, ad697e5, 1690b9e, 0a8ef09) was verified upstream in the research artifact and is inherited here.

## Performance Considerations

- Thunks stay lazy: an on-cadence turn evaluates no trigger signals; an unarmed config passes no trigger thunk at all.
- Memory I/O runs only on gate-pass fires; the store is one small JSON file per project.
- The budget fold is a single O(n) pass; no regex runs beyond the existing strip.
- Sandbox reads are size-capped; the loop is round-capped and deadline-bounded end to end.

## Migration Notes

- config.json changes are additive; absent fields keep today's behavior exactly (all behavioral features default-off).
- Memory files are new local state, untracked; no data migration. Deleting .advisor-memory/ is a full reset.
- Entries committed before Slice 4 lack details keys; the dialogue path treats them as key-less but still visible, so nothing breaks mid-series.
- Rollback per slice: behavioral slices revert by config (set the field off); code reverts by git per single-purpose slice.

## Pattern References

- plan-turn.ts:88-119 — pure core + thunk injection + Decision union (the shape every new module clones).
- config.ts:47,153-194 — beside-module URL state + per-field narrowing + ENOENT/broken-JSON discrimination.
- config.ts:69-97 — clampInt/clampWithWarn with named MIN/MAX.
- tests/test.mjs:115-193 — fold-parity pin style for firing semantics (t1b).
- tests/test.mjs:868-893 — scripted completion-facade stubs (t16).
- tests/test.mjs:86-110 — withConfig + captureWarn harness.
- advisor.ts:17-27, report.ts:18-21, guard.ts:51-55 — structural *-Like host interfaces.
- advisor.ts:114-198 — strip tiers + byte-identity guard (F023) discipline for any new refusal vocabulary.
- report.ts:30-38 — hasUI-gated failure reporting (FR8 reuses at fire time).

## Developer Context

**Q (directional): Follow the pure-spoke pattern across all new modules, or moving off it?**
A: "Follow pure-spoke."

**Q (directional): Keep the single test file until FR9's eval/ split, or split earlier?**
A: "you decide" -> designer decision: keep single file until FR9 (documented trigger).

**Q (genuine, asked as a batch of 4): latch scope / eval adoption / token estimate / sandbox verbs.**
A: "i dont understand" x4 -> re-asked in plain words as one apply-all question.

**Q (genuine, simplified): (1) skip the helper-counter investigation, (2) adopted = next fake turn ends well, (3) size = characters / 4, (4) advisor reads files only. Apply all four?**
A: "Yes, apply all four (Recommended)."

**Q (design confirm): 8 config-gated slices, pure-spoke pattern, decisions as listed — proceed to decomposition?**
A: "Proceed (Recommended)."

**Q (slices confirm): 8 slices, foundation first, eval last — approve?**
A: "Approve (Recommended)."

**Micro-checkpoint (Slice 3): approved as generated.**
slice-verifier ran four rounds. Round 1 flagged: the digest appended after ensureUserTail left the payload ending on a system message (the locked nudge rule only follows an assistant tail, tests/test.mjs:617-634) and missing pinned strings. Fixed by inserting the digest IN FRONT OF the payload's final message (tail stays terminal; ensureUserTail untouched) and pinning both warn reasons. Round 3 flagged a POSIX-conditional failure: the hostile-path block's read failed with ENOTDIR first and tripped the shared warn latch, suppressing the write warn on ubuntu-latest (CI) while passing on win32. Fixed with a silent pre-read in recordAdvice (the parseStore discriminated union); the write warn is now the only possible warn on every platform. Round 3 also flagged raw outcome.text carrying markup into the digest channel; fixed by recording stripAdvisorMarkup(outcome.text) (commit-path hygiene parity). A stale compaction draft (.rpiv/artifacts/handoffs/2026-11-02_12-23-18_jarvis-advisor-design-slice3.md, different naming, its own verifier/developer steps never ran) was disregarded as non-authoritative per the resume rule.

**Micro-checkpoint (Slice 6): approved as generated.**
slice-verifier round 1 ran the full adversarial pass: Decisions OK, Cross-slice OK (T1/T2 byte-identical to the locked fence; every locked t25 pin stays satisfiable; no Slice 7/8 forward references), Research OK. One VIOLATION: the merged T3 terminal gate carried a semicolon where the locked fence has a comma — fixed. Re-dispatch rounds 2 to 4 failed on agent infrastructure timeouts, so the fix was proven mechanically instead: the assembled merged advisor.ts and config.ts compile clean under tsc --strict (pi-ai stubbed via tsconfig paths), and the appended tests region passes node --check. A recount of the t26 stubs then caught what no verifier did: five empty-context blocks asserted the replayed toolResult at index [2] where the replay puts it at [1] — 10 assertion references fixed. REV 3 is the approved payload.

**Micro-checkpoint (Slice 7): approved as generated.**
Before generation this resume repaired 3 mechanical artifact defects: the triggers.ts entry had lost its code fence and held the slice-6 tests payload inline (fence restored; payload relocated byte-identically to the end of the tests fence, diff-verified), and the "### Slice 7: Async fire" heading had been corrupted into a Slice 6 bullet (restored). Locked content is otherwise untouched. slice-verifier round 1 then caught one blocker and three concerns: the heldAdvice slot could be silently overwritten by a resolving second call (both-slot guard added), the async branch returned before the locked Region H recordAdvice (FR2 parity record added in the .then), the README asyncMode row had no owning slice (Slice 7 adopted it — the developer ratified the README.md file-list gain at the checkpoint), and two test lines exceeded the biome width plus an unpinned catch reason (reflowed; string pinned by a grep criterion). Round 2 verified every fix and flagged 3 mechanical defects: a declaration-free lone test block (folded into the declaring commit block), a drifted host citation (agent-session.js:1578-1584), and an imprecise ctx.signal comment (mid-run fires keep the signal live; a user abort fails the detached call open into the held slot). Round-3 re-dispatch was proven mechanically instead (the slice-6 precedent): the assembled t27/t27c blocks pass node --check and biome check clean with no line over 100 columns. REV 3 is the approved payload.

**Micro-checkpoint (Slice 8): approved as generated.**
slice-verifier round 1 caught two blockers and one concern: the facade queue was built from a top-level fixture.facade key the fixtures never declare (every replay would run on an empty script and fail its structural commit check), the budget-window fixture's transcript sat under its own 800-token budget so the fold stayed the identity and the score could never pass, and six runner lines exceeded biome's 100-column width. Fixed by re-pointing the queue at turns[].facade per turn, lowering the budget to 500 with longer seeded texts (verifier arithmetic: a 668-token transcript folds to a 362-token kept shape, under 500 + 64), and reflowing every flagged line. Round 2 re-verified all fixes and the previously-OK areas: VIOLATIONS none. The skeleton's "FR9 moves fixture-style tests to eval/" prose was amended to the delivered wording — locked Slice 1-7 criteria require every pinned section to stay green under tests/test.mjs, so nothing moves; fixture-style scenarios live only in eval/. The eval/fixtures/ directory heading was split into six per-file headings (the slice-5 heading-amendment precedent), so one fence equals one file. REV 2 is the approved payload.

## Design History

- Slice 1: Trigger arms + 1.4.x guard — approved as generated
- Slice 2: Prompt budget — approved as generated
- Slice 3: Project memory — approved as generated (4 verifier rounds; see Developer Context)
- Slice 4: Dialogue — approved as generated (2 verifier rounds; round 1 caught the merged test import dropping planHostSupport)
- Slice 5: Read-only tools — approved as generated (2 verifier rounds; round 1 caught the missing FsLike seam, a contradictory import-order anchor, and a dead unpinned failure branch — all fixed; the skeleton's sandbox.ts heading one-liner was amended to match the delivered design)
- Slice 6: Specialist consult — approved as generated (verifier round 1 found one syntax defect in the merged fence, fixed; rounds 2 to 4 lost to agent timeouts, so the fixes were compile-proven via tsc strict and node --check on the assembled code; a messages-index bug in five t26 stubs was caught by recount and fixed)
- Slice 7: Async fire — approved as generated (2 verifier rounds; round 1 caught the held-slot overwrite blocker, the async memory-parity gap, and the unowned README row — all fixed; round 2 verified the fixes and flagged 3 mechanical defects — a declaration-free lone test block, a drifted host citation, and an imprecise signal comment — fixed and proven via biome check and node --check; the approved payload is REV 3)
- Slice 8: Eval harness — approved as generated (2 verifier rounds; round 1 caught the facade queue never loading (fixtures declare turns[].facade) and the budget fixture sitting under its own budget, plus six over-width lines — all fixed and arithmetically re-proven; round 2 clean; the tests/test.mjs "moves fixture-style tests" skeleton prose amended to the delivered nothing-moved wording; REV 2 is the approved payload)

## References

- .rpiv/artifacts/solutions/2026-11-02_08-36-12_jarvis-advisor-evolution.md — selected approach and slice order.
- .rpiv/artifacts/research/2026-11-01_21-23-59_jarvis-advisor-evolution.md — verified host surface for all eight pillars.
- .rpiv/artifacts/discover/2026-11-01_21-07-45_jarvis-advisor-evolution.md — FRD.
- .rpiv/guidance/architecture.md — star topology, boundary/config/test contracts.
- TECH_DEBT_AUDIT.md — F008 reach exception, F023 guard discipline, test split rule.
