---
date: 2026-11-03T09:59:12+0700
author: Yogiswara Utama
commit: faae538
branch: main
repository: advisor-turn-gate
topic: "jarvis-advisor-evolution"
tags: [plan, advisor-turn-gate, triggers, memory, dialogue, tools, specialists, async, eval, slices]
status: ready
parent: ".rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md"
phase_count: 9
phases:
  - { n: 1, title: "Trigger arms + 1.4.x guard", files: [triggers.ts, plan-turn.ts, config.ts, index.ts, tests/test.mjs], depends_on: [] }
  - { n: 2, title: "Prompt budget", files: [prompt.ts, config.ts, index.ts, tests/test.mjs], depends_on: [1] }
  - { n: 3, title: "Project memory", files: [memory.ts, config.ts, prompt.ts, index.ts, .gitignore, README.md, tests/test.mjs], depends_on: [2] }
  - { n: 4, title: "Dialogue", files: [plan-turn.ts, index.ts, tests/test.mjs], depends_on: [3] }
  - { n: 5, title: "Read-only tools", files: [sandbox.ts, advisor.ts, config.ts, index.ts, tests/test.mjs], depends_on: [4] }
  - { n: 6, title: "Specialist consult", files: [advisor.ts, config.ts, index.ts, tests/test.mjs], depends_on: [5] }
  - { n: 7, title: "Async fire", files: [index.ts, config.ts, plan-turn.ts, tests/test.mjs, README.md], depends_on: [6] }
  - { n: 8, title: "Eval harness", files: [eval/runner.mjs, eval/fixtures/allowlist-refusal.json, eval/fixtures/budget-window.json, eval/fixtures/consult-aggregation.json, eval/fixtures/dialogue-keys.json, eval/fixtures/tool-use-script.json, eval/fixtures/trigger-arms.json, package.json, .github/workflows/ci.yml, README.md, tests/test.mjs], depends_on: [7] }
  - { n: 9, title: "Lint repair", files: [README.md, memory.ts, index.ts, tests/test.mjs, eval/runner.mjs, eval/fixtures/budget-window.json, eval/fixtures/consult-aggregation.json, eval/fixtures/dialogue-keys.json], depends_on: [8] }
last_updated: 2026-11-03T12:07:45+0700
last_updated_by: pi
last_updated_note: "Phase 9 added: lint repair from the 2026-11-03_11-54-11 validation verdict"
---

# jarvis-advisor-evolution Implementation Plan

## Overview

Eight config-gated capability slices for the one-shot advisor gate, decomposed 1:1 from the design artifact's `## Slices` section: multi-signal triggers, a prompt token budget, per-project memory, advisor dialogue, read-only tools, on-demand specialist consults, an optional async fire mode, and an offline eval harness. Every new module clones the house pure-spoke shape (zero runtime imports, thunks injected at the seam, `plan*` verbs, `*Decision` unions on `action`). All code blocks pass through verbatim from the design's `## Architecture` section; all Success Criteria pass through verbatim from its `## Slices` section.

Design: `.rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md` (status: ready, slice-verifier approved through 8 micro-checkpoints).

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

Verification of "done": `npm test` green with all pinned sections t1 through t27, `npm run eval` green with 8/8 scores, `npm run lint` and `npm run typecheck` clean.

## What We're NOT Doing

- Advisor write access of any kind (suggest-only, always).
- Any channel to the user beyond the transcript.
- Always-on specialists (on-demand consult only).
- Waking an idle agent (commit at natural boundaries only).
- Memory beyond count-cap retention.
- Live-model eval runs.
- A runtime probe for cross-session latch sharing (per-session isolation accepted).
- Sandbox verbs beyond read_file (no list, no grep — extendable later).

## Ordering

Strictly sequential 1 → 9 per the design's Ordering Constraints; Phase 9 repairs the validation lint drift; each slice builds on the locked previous one. No parallel phases.

- Phase 1 is the foundation: it extends PlanGateArgs (the seam every later phase wires through) and pins the trigger/cadence/markFired interaction every later fire depends on.
- Phase 3's digest composes with Phase 2's window; Phase 4's keys feed Phase 3's digest identity; Phase 6's consult leg rides Phase 5's loop; Phase 8 evaluates every prior pillar.

## Phase 1: Trigger arms + 1.4.x guard

### Overview

Adds the pure trigger spoke (four signals: error outcome, token growth, context pressure, risky tools) and the 1.4.x host feature-detect. Trigger arms slot between the no-model arm and the cadence arm in planGate: a trigger fire passes the same gate-pass (outcome check, markFired, vetoes, resolve), so the latch spends exactly once per fire. On-cadence turns invoke no trigger thunk; an unarmed config passes no thunk at all. On a pre-1.4 host the gate notifies once and disables.

### Changes Required:

#### 1. New pure trigger spoke
**File**: `triggers.ts`
**Changes**: NEW. Pure trigger predicates, `parseRiskyTools` list parser, `triggersArmed` check, and `planTrigger` fixed-order evaluation. Zero runtime imports.

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

#### 2. Trigger arm + host support in the plan core
**File**: `plan-turn.ts`
**Changes**: TYPE-only `TriggerDecision` import; laziness banner update; optional `trigger` thunk on PlanGateArgs; trigger arms between no-model and cadence with the error-signal outcome-veto bypass (F007 slide preserved); `planHostSupport` core appended.

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

Region D — appended at end of file (lands in this phase):

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

(Phase 4 lands Regions E, F, G; Phase 7 lands Regions S7-PT-A and S7-PT-B of this same merged fence.)
```

#### 3. Four trigger config fields
**File**: `config.ts`
**Changes**: `triggerMinNewTokens`, `triggerContextPercent`, `triggerOnError`, `triggerRiskyTools` — interface fields, DEFAULT_CONFIG entries, MIN/MAX constants, per-type narrowing with `clampWithWarn` (`triggerOnError`/`triggerRiskyTools` unclamped: boolean and any-string doors).

```ts
Slices 1, 2, 3 regions. implement reads the original at disk; later phases rewrite this fence with the merged result.

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

(Phase 2 lands Regions E-H; Phase 3 lands Regions I-L; Phase 5 lands Regions M-P; Phase 6 lands Regions Q-S; Phase 7 lands Regions T-V.)
```

#### 4. Seam wiring: signals builder + trigger thunk + host-support latch
**File**: `index.ts`
**Changes**: imports (`planHostSupport`, `stampDetails` deferred to Phase 4, triggers trio); factory `hostChecked`/`hostSupported` latch (the `fireCount` half of Region B lands in Phase 4); handler-top host-support gate; thresholds built per dispatch; defensive signals builder and trigger thunk on the planGate call.

```ts
Slices 1, 2, 3, 4, 7 regions (merged). implement reads the original at disk.

Region A — imports. This phase lands the SLICE-1 state (the second block below: the
plan-turn line REPLACES the original two-symbol import in place; the triggers line
joins alphabetical). The merged first block shows where Phases 3 (memory line) and
4 (stampDetails on the plan-turn line) take the same seam:

import { digestMessage, projectKeyFor, readEntries, recordAdvice } from "./memory";
import { planCommit, planGate, planHostSupport, stampDetails } from "./plan-turn";
import { parseRiskyTools, planTrigger, triggersArmed } from "./triggers";

import { planCommit, planGate, planHostSupport } from "./plan-turn";
import { parseRiskyTools, planTrigger, triggersArmed } from "./triggers";

Region B — factory closure, after `let lastFiredTurn = -1;`. This phase lands ONLY
the host-support half below; the FR1 fireCount half (second block) lands in Phase 4:

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

(Phase 2 lands Region E; Phase 3 lands Regions G and H; Phase 4 lands Region B's fireCount half and Region I; Phase 5 lands Regions S5-A and S5-B; Phase 6 lands Regions S6-A/B/C; Phase 7 lands Regions S7-A/B/C/D.)
```

#### 5. Pinned test sections t21 + t21c
**File**: `tests/test.mjs`
**Changes**: import extensions (planHostSupport + triggers trio); header/t9 banner prose; section 21 (arm order, planGate integration, host support) and 21c (clamp/narrowing doors) appended after t20.

```js
Slices 1, 2, 3, 4 regions. implement reads the original at disk; later phases rewrite this fence with the merged result.

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

(Phase 2 lands Regions C, C2, D; Phase 3 lands Regions A3, A4, E; Phase 4 lands Regions F, G; Phase 5 lands Regions A5, A6, B5; Phase 6 lands Regions A7, B6; Phase 7 lands Region B7; Phase 8 lands Region S8-T-A.)
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green; new t21 + t21c pass)
- [x] planTrigger arm order, off-state, exact-match, and aborted pins pass (t21)
- [x] planGate: trigger fires ahead of cadence, spends the latch exactly once, error-trigger bypasses the outcome veto, cadence-due errored turns keep the F007 slide, on-cadence turns invoke no trigger thunk (t21)
- [x] planHostSupport accepts 1.4 shapes and rejects the bare 0.79 emit with the pinned message (t21)
- [x] The four trigger fields clamp through clampWithWarn with the shared latch and wrong-typed neighbors stay intact (t21c)
- [x] Lint clean: `npx biome check triggers.ts plan-turn.ts config.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with the four trigger fields at defaults (0 / 0 / false / "") keeps today's firing behavior exactly
- [ ] `triggerContextPercent: 1` fires the gate before the next cadence boundary in a live session; the latch advanced exactly once
- [ ] With `enabled: false`, no host-support warning appears even on an old host

---

## Phase 2: Prompt budget

### Overview

Adds the chars/4 token estimate and the `applyTokenBudget` fold between stripToolDeclarations and ensureUserTail, gated by a clamp-guarded `tokenBudget` config field (0 = identity, today's behavior byte for byte). All system messages always survive; the last message never folds; the fold walks oldest-first and stops as soon as the kept total (marker allowance included) fits.

### Changes Required:

#### 1. Fold + estimate in the prompt spoke
**File**: `prompt.ts`
**Changes**: module banner first-sentence update; `CHARS_PER_TOKEN`, `MARKER_TOKEN_ALLOWANCE`, `BUDGET_FOLD_MARKER_PREFIX` constants; `estimateMessageTokens`; `applyTokenBudget`; `buildAdvisorMessages` gains the `tokenBudget = 0` parameter piping the fold between strip and tail (the optional `digest` parameter of the merged Region C fence is Phase 3's delta and lands there).

```ts
Slices 2, 3 regions (merged). implement reads the original at disk.

Region A — module banner, first sentence. "The advisor receives the executor's full projected context" becomes "The advisor receives the executor's projected context".

Region B — appended after stripToolDeclarations, before ensureUserTail (lands in this phase):

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

THIS PHASE lands buildAdvisorMessages with the tokenBudget parameter ONLY — the
two-arg form the seam calls as buildAdvisorMessages(messages, config.tokenBudget):

export function buildAdvisorMessages(llmMessages: Message[], tokenBudget = 0): Message[] {
  return ensureUserTail(applyTokenBudget(stripToolDeclarations(llmMessages), tokenBudget));
}

(Phase 3 REWRITES buildAdvisorMessages to the merged Region C fence below, which adds
the optional digest parameter and its doc comment.)
```

#### 2. tokenBudget config field
**File**: `config.ts`
**Changes**: interface field, DEFAULT_CONFIG `0`, MIN/MAX constants, clampWithWarn narrowing. (The design's Region H fence contains a duplicated partial copy of the same block; the plan carries the complete single block.)

```ts
Region E — AdvisorGateConfig interface, after triggerRiskyTools:

  /** Soft cap for the advisor payload, in estimated tokens (JSON characters / 4). 0 disables the fold. */
  tokenBudget: number;

Region F — DEFAULT_CONFIG, after triggerRiskyTools: "":

  tokenBudget: 0,

Region G — hard bounds, after MAX_TRIGGER_PERCENT:

export const MIN_TOKEN_BUDGET = 0;
export const MAX_TOKEN_BUDGET = 1000000;

Region H — loadConfig return, after the triggerRiskyTools entry (the design's fence
carried a duplicated partial copy of this block; this is the complete single block):

      tokenBudget:
        typeof parsed.tokenBudget === "number"
          ? clampWithWarn(
              "tokenBudget",
              parsed.tokenBudget,
              MIN_TOKEN_BUDGET,
              MAX_TOKEN_BUDGET,
            )
          : DEFAULT_CONFIG.tokenBudget,
```

#### 3. Budget binding at the seam
**File**: `index.ts`
**Changes**: the planGate `buildMessages` thunk becomes `(messages) => buildAdvisorMessages(messages, config.tokenBudget)` (Region E; superseded by Phase 3's Region G).

```ts
Region E — planGate args, the buildMessages line. Replace:

      buildMessages: buildAdvisorMessages,

with:

      // FR7: the budget binds per dispatch like everything else, so retuning it needs
      // no reload. The 0 default keeps the fold an identity and the payload identical
      // to the pre-FR7 shape (t10 pins that one-arg call form).
      buildMessages: (messages) => buildAdvisorMessages(messages, config.tokenBudget);

(Superseded by Phase 3's Region G below; kept for the slice-2 diff history.)
```

#### 4. Pinned test sections t22 + t22c
**File**: `tests/test.mjs`
**Changes**: prompt import gains the fold surface; config import gains the tokenBudget constants; count-bullet "six"→"seven"; sections 22 and 22c appended after t21c.

```js
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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including t10's one-arg call; new t22 + t22c pass)
- [x] The chars/4 estimate pin passes (t22)
- [x] Fold pins: systems kept in place, tail byte-identical, marker carries the pinned prefix, folded count, and first folded timestamp (t22)
- [x] Best-effort pins: starved budget keeps systems + tail, system-only and lone contexts are the identity over budget (t22)
- [x] Window pins: default 0 equals explicit 0, nudge still appended after a fold, strip still runs inside the budgeted pipeline (t22)
- [x] `tokenBudget` clamps (negative to 0, over-max to 1000000), narrows without poisoning neighbors, and shares the warn-once latch (t22c)
- [x] Lint clean: `npx biome check prompt.ts config.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no tokenBudget field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `tokenBudget: 2000` on a long live session: the fire still commits and the entry renders, with no provider payload-size rejection

---

## Phase 3: Project memory

### Overview

Adds the beside-module per-project memory store (`.advisor-memory/`, one JSON file per project key, count-cap newest-kept) and injects the digest as a synthetic system message in front of the payload's final message (the tail stays terminal). The recorded advice is the commit-stripped text. Store I/O is ENOENT-silent, warn-once on failure, never throws; the directory is gitignored from day one.

### Changes Required:

#### 1. New memory spoke
**File**: `memory.ts`
**Changes**: NEW. `MEMORY_DIR_URL` beside-module store (the CONFIG_URL affordance), FNV-1a `projectKeyFor` slug, `capEntries`, `readEntries`, `recordAdvice` (atomic-whole write, silent pre-read), `digestMessage` synthetic-system builder. Warn-once latch with test reset. node:fs + type-only pi-ai imports only.

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
    warnOnce(
      `[advisor-turn-gate] advisor memory write failed (${reason}); continuing without it`,
    );
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

#### 2. memoryCap config field
**File**: `config.ts`
**Changes**: interface field, DEFAULT_CONFIG `0`, MIN/MAX constants, clampWithWarn narrowing.

```ts
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
```

#### 3. Digest injection point in the prompt spoke
**File**: `prompt.ts`
**Changes**: `buildAdvisorMessages` rewritten to the Slice 3 merged form (Region C, verbatim below): the optional `digest` joins after the fold and before the tail check, inserted in front of the payload's final message.

```ts
Region C — buildAdvisorMessages REPLACES the existing function and its doc comment
(the Slice 3 merged form: the fold and pipeline are unchanged; the optional digest
joins after the fold and before the tail check):

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

#### 4. Memory read/write + digest injection at the seam
**File**: `index.ts`
**Changes**: memory import line (Region A's memory part); the buildMessages thunk gains the digest read (Region G, replaces Phase 2's Region E line); post-call `recordAdvice` of the commit-stripped text (Region H).

```ts
Region A — imports (memory part of the merged Region A: the memory line inserts between
the guard and plan-turn imports, alphabetical):

import { digestMessage, projectKeyFor, readEntries, recordAdvice } from "./memory";

Region G — planGate args, REPLACES the buildMessages line produced by Phase 2's Region E:

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
      recordAdvice(
        projectKeyFor(process.cwd()),
        stripAdvisorMarkup(outcome.text),
        config.memoryCap,
        Date.now(),
      );
    }
```

#### 5. Gitignore + README row
**File**: `.gitignore`
**Changes**: adds `.advisor-memory/`.

```gitignore
.advisor-memory/
```

**File**: `README.md`
**Changes**: adds the `memoryCap` config table row.

```md
| `memoryCap`    | `0` (disabled)        | Advisor entries kept per project in the local `.advisor-memory/` store. Each fire appends its advice; the next fire's prompt carries the digest. Clamped 0-200. |
```

#### 6. Pinned test sections t23 + t23c
**File**: `tests/test.mjs`
**Changes**: memory import + MIN/MAX_MEMORY_CAP import slots; header prose gains memory.ts and count "seven"→"eight"; sections 23 and 23c appended after t22c.

```js
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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including t10's one-arg and t22's two-arg buildAdvisorMessages calls; new t23 + t23c pass)
- [x] Digest pins pass: exact singular and plural header text, oldest-first order, timestamp passthrough, empty store builds no digest (t23)
- [x] Store pins pass: ENOENT reads silent and empty, corrupt store warns once with the pinned reason through the shared latch, append plus count-cap keeps the newest, blank advice skipped, hostile store path never throws (t23)
- [x] Window pins pass: the digest is inserted in front of the payload's final message (nudge stays terminal), survives a starved budget unfolded at the recency end, degrades to the digest alone on an empty context, and the absent digest is byte-identical to the pre-FR2 shape (t23)
- [x] The recorded advice is the commit-stripped text: `stripAdvisorMarkup` runs before `recordAdvice` in the seam (`grep -n "stripAdvisorMarkup(outcome.text)" index.ts` finds the record call)
- [x] `memoryCap` clamps (negative to 0, over-max to 200), narrows without poisoning neighbors, stays silent on wrong types, and shares the warn-once latch (t23c)
- [x] Lint clean: `npx biome check memory.ts prompt.ts config.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no memoryCap field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `memoryCap: 20` live: after two fires, `.advisor-memory/<key>.json` exists beside the extension and holds the trimmed advice texts
- [ ] Deleting `.advisor-memory/` resets memory; the next fire recreates it with no error surfaced

---

## Phase 4: Dialogue

### Overview

Stamps every committed advisor entry with stable `{ fire, turn }` string details so the host's own re-projection (custom_message entries replay into LLM context as user messages) becomes machine-identifiable dialogue. The counter advances only on landed commits, so ordinals stay dense; an absent stamp leaves the draft key-less (the pre-FR1 byte shape), so entries from both sides of the upgrade coexist.

### Changes Required:

#### 1. Stamp core + commit passthrough in the plan core
**File**: `plan-turn.ts`
**Changes**: `AdvisorEntryDetails` interface + `stampDetails` builder appended (Region G); `buildCorrection` replaced with the optional-details form (Region E); `PlanCommitArgs` gains the optional `details` field and the commit arm passes it through (Region F).

```ts
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
```

#### 2. Fire counter + stamping at the seam
**File**: `index.ts`
**Changes**: the `fireCount` half of the factory closure (Region B's FR1 part); the plan-turn import gains `stampDetails`; the planCommit call gains the stamp and the counter advances only on a landed commit (Region I, replaces the original call, notify check, and return).

```ts
Region B — factory closure, the FR1 half (appends after Phase 1's host-support half):

  // FR1: the dialogue counter. It advances ONLY when a commit lands, so the
  // stamped ordinals stay dense: entry k carries fire k. A vetoed gate-pass or
  // a failed advisor call burns no ordinal (unlike the latch, this is identity,
  // not rate control — the F007 spend-early rule does not apply).
  let fireCount = 0;

Region A — imports (plan-turn line gains stampDetails, completing the merged line):

import { planCommit, planGate, planHostSupport, stampDetails } from "./plan-turn";

Region I — the planCommit call and its tail. REPLACES the original call, notify
check, and return:

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
```

#### 3. Pinned test section t24
**File**: `tests/test.mjs`
**Changes**: plan-turn import gains stampDetails (Region F); section 24 appended after t23c.

```js
Region F — the plan-turn import gains stampDetails (planHostSupport stays: locked
t21 asserts it — the round-1 verifier catch):

import {
  buildCorrection,
  planCommit,
  planGate,
  planHostSupport,
  stampDetails,
} from "../plan-turn.ts";

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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including t9's four-arg buildCorrection call and t21's planHostSupport block; new t24 passes)
- [x] stampDetails pins: exact { fire, turn } string pair, stable key order, ordinal 1 on turn 0 for the first fire (t24)
- [x] buildCorrection pins: the stamp rides the committed draft; an absent stamp leaves the draft key-less (the pre-FR1 byte shape); the peer spread and continue survive stamping (t24)
- [x] planCommit pins: the passthrough reaches the committed draft; the notify arm stays in the exact format with a stamp in play (t24)
- [x] Lint clean: `npx biome check plan-turn.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] A live session with the gate on: after two fires, the session file shows the committed entries carrying details {"fire":"1","turn":N} then {"fire":"2","turn":M}
- [ ] The advisor's next fire demonstrably sees its own prior advice (host re-projection converts committed content to a user message; no config change needed)
- [ ] A session holding pre-slice-4 advisor entries: the next fire still works; old entries lack details and still replay into context

---

## Phase 5: Read-only tools

### Overview

Gives the advisor one read_file verb through a two-layer sandbox (pure `planRead` path bound + FsLike-injected I/O closure with realpath escape re-check and 64 KiB byte cap), wrapped in a bounded tool loop over completeSimple with the shared per-fire deadline: each round races the REMAINING budget, the terminal stop-only gate keeps rejecting a final toolUse, and refusals replay as errored toolResults so the advisor self-corrects instead of failing the fire. `toolsEnabled` defaults false (byte-identical single-call shape); `maxToolRounds` clamps 1-10 with default 3 (config parity with DEFAULT_MAX_TOOL_ROUNDS).

### Changes Required:

#### 1. New sandbox spoke
**File**: `sandbox.ts`
**Changes**: NEW. `planRead` pure prefix bound, `FsLike` structural seam (the ModelRegistryLike pattern applied to node:fs), `READ_FILE_TOOL` declared surface (plain JSON-Schema parameters), `sandboxRefusalFor` pinned refusal, `SANDBOX_MAX_BYTES` = 65536, `createSandbox` never-throw executor.

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
          reason:
            `advisor sandbox refused "${requested}": ${bytes.length} bytes exceeds the ${maxBytes} byte cap`,
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

#### 2. Tool loop + widened request in the advisor
**File**: `advisor.ts`
**Changes**: `AdvisorTool`/`ToolExecutionResult`/`ToolExecutor` types + `DEFAULT_MAX_TOOL_ROUNDS` (Region T1's FR4 part); `CompleteSimpleFn` context gains `tools?` (Region T2); `runAdvisor` gains `tools`/`executeTool`/`maxToolRounds` and the mid-loop toolUse consumption with the terminal gate (the fence below is the design's merged T3 — Phase 5 lands it WITHOUT the FR6 `specialist` parts; Phase 6 repeats the full merged fence as the replacement).

```ts
Slices 5, 6 regions (merged). implement reads the original at disk.

Region T1 — after AdvisorOutcome. THIS PHASE lands the FR4 part only:

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

/**
 * Pinned refusal for a toolUse naming a tool this fire never declared (t26).
 * Reachable only in specialist-only mode (the declared list is exactly the
 * consult tool and no executor is injected); the refusal replays as an errored
 * toolResult so the advisor self-corrects instead of failing the fire.
 *
 * Lands HERE, not with the rest of the FR6 surface in Phase 6: the merged loop
 * fence below calls it in its final else arm, and this phase's tsc --noEmit
 * gate compiles that call (Step 4 reviewer fix).
 */
export function undeclaredToolRefusalFor(name: string): string {
  return `advisor tool "${name}" is not declared; use only the tools declared for this fire`;
}

(The REST of the FR6 consult surface — CONSULT_SPECIALIST_NAME through SpecialistConfig — lands in Phase 6.)

Region T2 — CompleteSimpleFn's context parameter (Slice 5; unchanged in Slice 6):

type CompleteSimpleFn = (
  model: Model<Api>,
  context: { systemPrompt: string; messages: Message[]; tools?: AdvisorTool[] },
  options?: { signal?: AbortSignal; reasoning?: string; sessionId?: string },
) => Promise<AssistantMessage>;

Region T3 — runAdvisor. The fence below is the design's MERGED Slice 5+6 form. THIS
PHASE lands it WITHOUT the FR6 parts (the `specialist?` parameter, the SpecialistConfig
type reference, `consultArmed`, `consultAnswers`, the CONSULT_SPECIALIST_NAME routing
branch, and the aggregation tail — with no specialist the requestTools ternary collapses
to `(params.tools ?? [])` and the return stays `{ ok: true, text }`). Phase 6 REPLACES
the function with the full merged fence repeated there. Step 4 review fix: the
toolCall filter below uses a type-only `ToolCall` import — add
`import type { ToolCall } from "@earendil-works/pi-ai";` to the file's type-only
import group. The design's inline predicate object type does not compile against
pi-ai's JsonObject arguments type (TS2677; plan-local; design follow-up: the design's
advisor.ts Region T3 fence carries the non-compiling predicate):

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
          (block): block is ToolCall => block.type === "toolCall",
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

#### 3. toolsEnabled + maxToolRounds config fields
**File**: `config.ts`
**Changes**: interface fields, DEFAULT_CONFIG (`false` / `3`), MIN/MAX_TOOL_ROUNDS 1-10, boolean + clampWithWarn doors.

```ts
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
```

#### 4. Sandbox wiring at the seam
**File**: `index.ts`
**Changes**: sandbox import (Region S5-A); the runAdvisor call gains tools/executeTool/maxToolRounds, armed only when `toolsEnabled` (Region S5-B).

```ts
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
      executeTool: config.toolsEnabled
        ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES)
        : undefined,
      maxToolRounds: config.maxToolRounds,
    });
```

#### 5. Pinned test sections t25 + t25c
**File**: `tests/test.mjs`
**Changes**: fs import gains mkdirSync/mkdtempSync; sandbox import; header prose gains sandbox.ts and count "eight"→"nine"; sections 25 and 25c appended after t24.

```js
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

{
  // F023 strip discipline (Step 4 coverage fix; design follow-up: the design's
  // Verification Note 4 demands the byte-identity guard discipline for every new
  // refusal vocabulary, and t25 pins none of it): the sandbox refusal strings
  // pass stripAdvisorMarkup byte-identical, so no strip tier can ever rewrite one.
  for (const name of ["read_file", "write_file", "consult_specialist"]) {
    const refusal = sandboxRefusalFor(name);
    assert(
      stripAdvisorMarkup(refusal) === refusal,
      "t25: the allowlist refusal survives the strip byte-identical",
    );
  }
  const pathRefusal = planRead(join(tmpRoot), "../x.ts").action === "refuse"
    ? planRead(join(tmpRoot), "../x.ts").reason
    : "";
  assert(
    pathRefusal.length > 0 && stripAdvisorMarkup(pathRefusal) === pathRefusal,
    "t25: the outside-project refusal survives the strip byte-identical",
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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including every t16 runAdvisor pin; new t25 + t25c pass)
- [x] planRead pins: relative allowed, in-root absolute allowed, parent escape refused, absolute-outside refused, empty/missing/non-string path refused (t25)
- [x] Sandbox pins: real read returns text, non-allowlisted name refuses with the exact pinned string, missing-file and directory reads refuse, over-cap read refuses with the byte-cap wording, hostile args refuse, symlink-class escape refused via the injected FsLike (stub realpath), read errors surface through the seam (stub fs) (t25)
- [x] Loop pins: a toolUse round costs exactly one extra call, the replay carries assistant + non-error toolResult, the declared tool rides every round (t25)
- [x] Refusal pins: a refused execution replays as isError with the pinned reason and the fire still succeeds (t25)
- [x] Rounds cap: maxToolRounds 1 spends exactly one round then rejects with "advisor stopped with toolUse"; the omitted default is 3 rounds (config parity) (t25)
- [x] Unarmed pins: no tools + toolUse response rejects in one call, never loops (t25)
- [x] Shared-deadline pin: a fast toolUse round then a hung round fails at the original budget (t25)
- [x] Refusal vocabulary strip-discipline: `sandboxRefusalFor` and the outside-project refusal pass `stripAdvisorMarkup` byte-identical (t25)
- [x] toolsEnabled narrows per type and defaults false; maxToolRounds clamps 1-10, warns through the shared latch, wrong-typed neighbors stay intact (t25c)
- [x] Lint clean: `npx biome check sandbox.ts advisor.ts config.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no toolsEnabled field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `toolsEnabled: true` live: an advisor fire that wants a file issues a visible read_file round and its final entry cites the file content; no write ever occurs
- [ ] A request for a path outside the project shows up in the advisor's final prose as refused, with no file contents leaked

---

## Phase 6: Specialist consult

### Overview

Adds the declared `consult_specialist` tool and one extra tool-free completeSimple leg under the fire's remaining budget. Successful consult answers aggregate into ONE committed text (base first, answers in fire order) joined by a separator whose longest newline run is two, so the strip's 3-newline collapse can never rewrite a join. Every leg failure replays as an errored toolResult and the fire commits base-only advice; an unconfigured or unresolved specialist leaves the consult undeclared and the fire byte-identical to the pre-FR6 shape.

### Changes Required:

#### 1. Consult surface + leg + merged loop in the advisor
**File**: `advisor.ts`
**Changes**: `CONSULT_SPECIALIST_NAME`/`CONSULT_SPECIALIST_TOOL`/`CONSULT_QUESTION_REFUSAL`/`CONSULT_UNCONFIGURED_REFUSAL`/`undeclaredToolRefusalFor`/`CONSULT_SECTION_SEPARATOR`/`CONSULT_ANSWER_HEADER`/`SpecialistConfig` (Region T1's FR6 part); `runConsultLeg` (Region T5); `runAdvisor` replaced by the full merged T3 fence (consult routing, shared remaining-budget leg budget, aggregation tail) — replaces Phase 5's form.

```ts
Region T1 — the FR6 consult surface (Slice 6). Appends to the FR4 part landed in Phase 5:

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

(undeclaredToolRefusalFor landed in Phase 5's FR4 part — the merged loop's else arm
calls it and Phase 5's typecheck gate compiles that call; it is NOT re-declared here.)

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
answers into the committed text). The full merged fence is reproduced in Phase 5's
advisor code block verbatim — apply it here as the wholesale replacement of the
function body landed in Phase 5 (same fence, now complete with the FR6 parts:
the `specialist?: SpecialistConfig` parameter, `consultArmed`, `consultAnswers`,
the CONSULT_SPECIALIST_NAME routing branch with the fresh remaining-at-call leg
budget, and the aggregation tail joining base + header-prefixed answers with
CONSULT_SECTION_SEPARATOR).
```

#### 2. specialistModel + specialistSystemPrompt config fields
**File**: `config.ts`
**Changes**: interface fields, DEFAULT_CONFIG (empty model = consults off; ships the non-empty default specialist prompt), trim + empty-fallback narrowing doors (no clamp, no warn — the triggerRiskyTools precedent).

```ts
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
```

#### 3. Specialist resolution at the seam
**File**: `index.ts`
**Changes**: type-only pi-ai + SpecialistConfig imports (Region S6-A); fire-time specialist resolution between the gate consult block and the runAdvisor call (Region S6-B); the runAdvisor call gains `specialist` (Region S6-C, replaces Phase 5's Region S5-B call).

```ts
Region S6-A — imports. The advisor import gains a type-only SpecialistConfig line (the
VALUE import stays touched-by-nothing). The design's fence also added a TYPE-only pi-ai
`Api, Model` import, but nothing in index.ts names those types — SpecialistConfig
already carries the specialist model's type — and biome's unused-import rule fails the
phase lint gate, so that line is DROPPED here (Step 4 reviewer fix, plan-local; design
follow-up: the design's index.ts Region S6-A carries the unused import):

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

Region S6-C — the runAdvisor call gains one field (REPLACES Phase 5's Region S5-B call):

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
      executeTool: config.toolsEnabled
        ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES)
        : undefined,
      maxToolRounds: config.maxToolRounds,
      // FR6: undefined when unconfigured or unresolved — the consult stays undeclared.
      specialist,
    });
```

#### 4. Pinned test sections t26 + t26c
**File**: `tests/test.mjs`
**Changes**: advisor import gains the consult surface; sections 26 and 26c appended after t25c (end of the tests fence at this phase).

```js
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
  // The leg's two remaining failure arms pin the fail-open contract (Step 4
  // coverage fix; design follow-up: the design's t26 carries no pins for these
  // arms despite the every-failure-path-gets-a-pin note): an empty-text stop
  // reply and a non-error non-stop reply each replay as an errored toolResult
  // with the exact pinned reason, and the fire still lands base-only advice.
  const arms = [
    { stopReason: "stop", content: [{ type: "text", text: "" }] },
    { stopReason: "maxTokens", errorMessage: undefined, content: [] },
  ];
  for (const legReply of arms) {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    let step = 0;
    let finalContext = null;
    const registry = {
      runtime: {
        completeSimple: (model, context) => {
          step += 1;
          if (model === specialistModel) return Promise.resolve(legReply);
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
      "t26: a failed leg arm never fails the fire",
    );
    assert(
      finalContext !== null && finalContext.messages[1].isError === true,
      "t26: the failed leg arm replays as an errored toolResult",
    );
    assert(
      finalContext.messages[1].content[0].text === "specialist returned no text" ||
        finalContext.messages[1].content[0].text === "specialist stopped with maxTokens",
      "t26: the leg's no-text and non-stop arms carry their exact pinned reasons",
    );
  }
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

{
  // F023 strip discipline (Step 4 coverage fix; design follow-up: the design's
  // Verification Note 4 demands the byte-identity guard discipline for every new
  // refusal vocabulary, and t26 pins only the separator): the consult refusal
  // strings pass stripAdvisorMarkup byte-identical.
  const refusals = [
    CONSULT_QUESTION_REFUSAL,
    CONSULT_UNCONFIGURED_REFUSAL,
    undeclaredToolRefusalFor("write_file"),
  ];
  for (const refusal of refusals) {
    assert(
      stripAdvisorMarkup(refusal) === refusal,
      "t26: the consult refusal strings survive the strip byte-identical",
    );
  }
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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including every t16 runAdvisor pin and the t25 loop pins; new t26 + t26c pass)
- [x] Consult leg pins: the leg is tool-free, carries the specialist model and system prompt, and receives the advisor's question as its only user message (t26)
- [x] Aggregation pins: one consult joins base + separator + header + answer byte-exact; two consults join in fire order; the aggregated text passes through stripAdvisorMarkup byte-identical and contains no 3-newline run (t26)
- [x] Fail-arm pins: a specialist leg error or a hung leg (shared-clock timeout) replays as an errored toolResult carrying the cause, and the fire still commits base-only text with no separator or header (t26)
- [x] Guard pins: missing/empty/whitespace/non-string question refuses with the pinned string and the leg never runs; consult without a configured specialist refuses with the pinned string; an undeclared tool name in specialist-only mode refuses with the pinned string (t26)
- [x] Arming pins: a specialist-only fire declares exactly [consult_specialist]; consult rounds spend the shared maxToolRounds and the exhausted budget rejects with "advisor stopped with toolUse"; an unarmed call keeps the single-call shape byte-identical (t26)
- [x] Consult-leg failure arms pinned: an empty-text leg reply and a non-stop leg reply each replay as an errored toolResult with the exact pinned reason, and the fire lands base-only advice (t26)
- [x] Refusal vocabulary strip-discipline: every consult refusal string passes `stripAdvisorMarkup` byte-identical (t26)
- [x] specialistModel narrows per type and trims; specialistSystemPrompt falls back to the default on empty or wrong type; both defaults keep consults off (t26c)
- [x] Lint clean: `npx biome check advisor.ts config.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no specialistModel field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `specialistModel: "openai/gpt-5.1"` live: an advisor fire that flags a domain shows the consult round, and the committed entry carries the base advice, the --- separator, and the specialist answer section
- [ ] A specialist configured without credentials: fires still commit base-only advice; no consult section appears

---

## Phase 7: Async fire

### Overview

Config-gated (`asyncMode`, default false) abstention at turn_end: the advisor call detaches under the same deadline, the resolved outcome is held in a two-slot closure (`advisorInFlight` + `heldAdvice`, the both-slot guard makes the write safe by construction), and a registered `agent_before_settle` handler commits it once at the next natural settlement with the settle event's own accumulator spread. The settle result deliberately omits `continue` — the settle path never wakes an idle agent. Async memory parity: the detached call records its commit-stripped advice exactly like the blocking path.

### Changes Required:

#### 1. Shared draft builder + settle core in the plan core
**File**: `plan-turn.ts`
**Changes**: unexported `buildAdviceDraft` added above `buildCorrection` which delegates to it (Region S7-PT-A, t24 pins stay green byte-for-byte); `HeldAdvice`, `SettleDecision`, `PlanSettleArgs`, and `planSettle` appended (Region S7-PT-B).

```ts
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

#### 2. asyncMode config field
**File**: `config.ts`
**Changes**: interface field, DEFAULT_CONFIG `false`, boolean narrowing door (no clamp, no warn).

```ts
Region T — AdvisorGateConfig interface, after specialistSystemPrompt:

  /** Commit the advisor's reply at the next agent settlement instead of blocking turn_end. */
  asyncMode: boolean;

Region U — DEFAULT_CONFIG, after the specialistSystemPrompt default string:

  asyncMode: false,

Region V — loadConfig return, after the specialistSystemPrompt entry:

      asyncMode:
        typeof parsed.asyncMode === "boolean" ? parsed.asyncMode : DEFAULT_CONFIG.asyncMode,
```

#### 3. Async slots + detached call + settle registration at the seam
**File**: `index.ts`
**Changes**: `HeldAdvice` type import + plan-turn import gains `planSettle` (Region S7-A); factory `advisorInFlight`/`heldAdvice` slots (Region S7-B); the runAdvisor call replaced by the shared `advisorArgs` literal + async branch with the both-slot guard and FR2 parity record in the `.then` (Region S7-C, replaces Phase 6's Region S6-C call); `agent_before_settle` registration appended after the turn_end block (Region S7-D).

```ts
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

Region S7-C — REPLACES Phase 6's Region S6-C runAdvisor call (after the specialist
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
      executeTool: config.toolsEnabled
        ? createSandbox(process.cwd(), SANDBOX_MAX_BYTES)
        : undefined,
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

#### 4. README asyncMode row
**File**: `README.md`
**Changes**: adds the `asyncMode` config table row after the memoryCap row.

```md
| `asyncMode` | `false` (blocking) | Commit the advisor's reply at the next agent settlement instead of blocking turn_end. The advisor never wakes an idle agent. |
```

#### 5. Pinned test sections t27 + t27c
**File**: `tests/test.mjs`
**Changes**: plan-turn import gains planSettle; sections 27 and 27c appended after t26c (end of the tests fence).

```js
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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (existing sections stay green, including every t24 buildCorrection pin; new t27 + t27c pass)
- [x] planSettle pins: an empty slot abstains; a failed held call notifies `advisor-turn-gate: <reason>`; a markup-only husk notifies the exact husk message; a commit spreads the settle event's peers, rides the draft last, stamps the fire-time turn index, and runs the strip thunk (t27)
- [x] The never-wake pin: the settle commit result carries NO `continue` key, and the settle draft is byte-equal to the blocking draft (`grep -n "continue: true" plan-turn.ts` returns exactly one hit, inside buildCorrection)
- [x] The both-slot guard exists verbatim: `grep -n "advisorInFlight || heldAdvice" index.ts` returns exactly one hit (the overwrite blocker's fix), and the contract-violation catch reason exists verbatim: `grep -c "async advisor call threw" index.ts` returns 1
- [x] Async memory parity: `grep -c "stripAdvisorMarkup(outcome.text)" index.ts` returns 2 (the Region H blocking record and the async .then record)
- [x] asyncMode narrows per type with no warning and defaults false — the blocking shape (t27c)
- [x] Lint clean: `npx biome check plan-turn.ts config.ts index.ts tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] config.json with no asyncMode field behaves exactly as today (the untouched existing suite is the offline proof)
- [ ] `asyncMode: true` live: turn_end returns instantly (no 60s block), the entry lands at the next settlement boundary stamped with the fire-time turn, and an idle agent stays idle after the commit
- [ ] A gate-pass while a previous async call is in flight OR a result is still held: the second call is skipped, exactly one entry lands, no outcome is overwritten, and the latch shows one spend per consumed fire
- [ ] asyncMode true with memoryCap on: the fire's advice lands in .advisor-memory/ even though the commit lands at settle
- [ ] asyncMode true with the advisor unreachable: the settle boundary reports the failure once; no entry commits

---

## Phase 8: Eval harness

### Overview

The sanctioned second runner: eval/runner.mjs replays golden per-pillar fixtures through the REAL pipeline (planGate → buildAdvisorMessages → runAdvisor over a scripted facade → planCommit) binding the same seam thunks index.ts binds, then scores the committed entries with eight pinned scores and a scorer self-test. `npm run eval` gates CI after typecheck on both node versions. Fixture-style scenarios live only in eval/ — nothing pinned in tests/test.mjs moves.

### Changes Required:

#### 1. Offline eval runner
**File**: `eval/runner.mjs`
**Changes**: NEW. Per-fixture replay with temp-dir sandbox + MEMORY_DIR_URL swap isolation, the eight-score registry, scorer self-test, structural contract check, process.exitCode gate.

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

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

#### 2. Six golden fixtures
**Files**: `eval/fixtures/allowlist-refusal.json`, `eval/fixtures/budget-window.json`, `eval/fixtures/consult-aggregation.json`, `eval/fixtures/dialogue-keys.json`, `eval/fixtures/tool-use-script.json`, `eval/fixtures/trigger-arms.json`
**Changes**: NEW, one file per fixture (FR4 refusal, FR7 window, FR6 aggregation, FR1+FR2 keys, FR4 tool script, FR3 trigger arms).

The file `eval/fixtures/allowlist-refusal.json` (FR4, allowlist refusal):

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

The file `eval/fixtures/budget-window.json` (FR7, budget window):

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

The file `eval/fixtures/consult-aggregation.json` (FR6, consult aggregation):

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

The file `eval/fixtures/dialogue-keys.json` (FR1+FR2, dialogue keys):

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

The file `eval/fixtures/tool-use-script.json` (FR4, tool use script):

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

The file `eval/fixtures/trigger-arms.json` (FR3, trigger arms):

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

#### 3. package.json eval script
**File**: `package.json`
**Changes**: adds `"eval": "node --experimental-strip-types eval/runner.mjs"` beside the test runner.

```json
"scripts": {
  "test": "node --experimental-strip-types tests/test.mjs",
  "eval": "node --experimental-strip-types eval/runner.mjs",
  "lint": "biome check .",
  "format": "biome check --write .",
  "typecheck": "tsc --noEmit"
},
```

#### 4. CI eval score gate
**File**: `.github/workflows/ci.yml`
**Changes**: appends the eval step after typecheck in the verify job.

```yaml
      - run: npm test
      - run: npm run lint
      - run: npm run typecheck
      # FR9: the eval score gate. A failing score fails the job: the runner sets
      # process.exitCode when any fixture errors or any score misses.
      - run: npm run eval
```

#### 5. README eval section
**File**: `README.md`
**Changes**: Verify section gains the eval command; closing paragraph rewritten.

```md
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

#### 6. Test banner prose
**File**: `tests/test.mjs`
**Changes**: Region S8-T-A header banner prose appended after the MODULE_NOT_FOUND paragraph. Nothing pinned moves.

```js
Region S8-T-A — header banner prose. Appended after the MODULE_NOT_FOUND paragraph:

  eval/runner.mjs is the second offline runner (the sanctioned split, TECH_DEBT_AUDIT.md):
  golden fixtures per pillar replay the full pipeline — planGate, buildAdvisorMessages,
  runAdvisor over a scripted facade, planCommit — and CI gates on the score table.
  Fixture-style end-to-end scenarios live there; this file stays the unit-pin suite and
  nothing pinned moves.
```

### Success Criteria:

#### Automated Verification:
- [x] Whole-suite baseline (terminal slice): `npm test` passes — every pinned section t1 through t27 stays green and nothing moved
- [x] The nothing-moved contract: `grep -c "^// ---" tests/test.mjs` returns exactly 37 (t1..t27 banners complete, none relocated)
- [x] Eval green offline: `npm run eval` exits 0, prints the gate self-test PASS line, replays 6/6 fixtures, and passes 8/8 scores
- [x] Score rows each print PASS: trigger-arms/drift-caught, budget-window/budget-respected, tool-use-script/sandbox-read-applied, consult-aggregation/single-entry-aggregation, allowlist-refusal/allowlist-refused, dialogue-keys/repeats-avoided, dialogue-keys/dialogue-keys, dialogue-keys/advice-adopted
- [x] The gate can fail: `grep -n "known-false expectation" eval/runner.mjs` returns exactly one hit (the self-test arm that proves a false expectation registers)
- [x] Lint clean: `npx biome check eval/ package.json .github/workflows/ci.yml README.md tests/test.mjs`
- [x] Typecheck clean: `npx tsc --noEmit`

#### Manual Verification:
- [ ] `npm run eval` prints the full score table plus the summary line; deleting one fixture file locally drops the summary count by one and the runner still passes
- [ ] CI: the eval step runs after typecheck on both node versions; editing one fixture expectation locally (for example adviceIncludes) turns the eval step red
- [ ] `npm run eval` runs with no credentials configured (the registry is a stub; no network happens)

---

## Phase 9: Lint repair

### Overview

Repairs the lint drift the 2026-11-03_11-54-11 validation verdict recorded: `npm run lint` exits 1 with 10 errors across 6 files. Eight of the ten are safe auto-fixes (5 format, 3 import-order); two are hand edits in tests/test.mjs. The 3 warnings and 6 infos do not gate and stay untouched: plain `npm run format` applies safe fixes only, so the unsafe-fix infos survive by design. Phases 1-8's scoped lint criteria were true when each phase landed; this phase restores the tree-wide gate they assumed.

### Changes Required:

#### 1. Repo-wide safe formatting
**File**: README.md, memory.ts, eval/fixtures/budget-window.json, eval/fixtures/consult-aggregation.json, eval/fixtures/dialogue-keys.json, index.ts, eval/runner.mjs, tests/test.mjs
**Changes**: run `npm run format` (biome check --write .). Clears the README.md and memory.ts format rewraps, the three fixture-JSON format findings, and organizeImports at index.ts:1, eval/runner.mjs:40, and tests/test.mjs:34. Nothing pinned moves: the formatter rewraps code, never the `// ---` comment banners.

#### 2. Determinism pin restructure
**File**: `tests/test.mjs` (line 1681)
**Changes**: biome's noSelfCompare rejects two identical call expressions. Bind one result, compare against a fresh call — the pin keeps proving key stability, the lint error disappears. Apply after Change 1; the import-order fix does not shift these lines.

```js
const key = projectKeyFor("C:\\repo a");
assert(
  key === projectKeyFor("C:\\repo a"),
  "t23: the same cwd maps to the same store key",
);
```

#### 3. Shadowed-name rename
**File**: `tests/test.mjs` (line 1964)
**Changes**: rename the `escape` local (biome's noShadowRestrictedNames) to `parentEscape`, including the assertion two lines below that reads `escape.action`.

### Success Criteria:

#### Automated Verification:
- [x] `npm run lint` exits 0 (was exit 1 with 10 errors)
- [x] Tests pass: `node --experimental-strip-types tests/test.mjs` (all sections stay green, including t23 and t25)
- [x] Eval green: `npm run eval` exits 0 with 6/6 fixtures and 8/8 scores (formatting must not move fixture semantics)
- [x] Typecheck clean: `npx tsc --noEmit`
- [x] Nothing-moved contract: `grep -c "^// ---" tests/test.mjs` still returns exactly 37

#### Manual Verification:
- [ ] `git diff --stat` lists only the files this phase declares, and the eval score rows still print the same PASS names
---

## Testing Strategy

### Automated:
- Per-phase pinned sections in tests/test.mjs (t21..t27 + the per-phase *c config-door blocks), each landed with the code it pins.
- Per-phase scoped biome checks and `npx tsc --noEmit` (read-only, repo-wide permitted).
- Phase 9 (terminal): `npm run lint` exit 0, `npm test` whole-suite baseline, the nothing-moved grep contract, and `npm run eval` 8/8 score gate after the lint repair.

### Manual Testing Steps:
1. Every new failure path carries an exact-string pin (fail-open contract); grep the test file for each new reason string.
2. markFired interaction: trigger-fire and cadence-fire each spend the latch exactly once at gate-pass; errored cadence turns never spend (F007 slide preserved). Fold-parity pins in the t1b style.
3. Peer spread: peerEntries survive fires in blocking mode (existing) and async mode (Phase 7 two-event seam).
4. Strip stays the last filter: no new fake-tool dialect bypasses the tiers; the consult separator survives the 3-newline collapse.
5. Config: every new field narrowed per type against DEFAULT_CONFIG; clamps warn once; ENOENT silent; broken JSON warns once.
6. customType stays "advisor-turn-gate" exactly (reload filter + denylist identifier).
7. Version skew: on a pre-1.4 host the gate notifies once and disables; on 1.4.x nothing changes. Pin planHostSupport both ways.
8. Default-off: with the new fields absent, behavior is byte-equivalent to today (verified by the untouched existing suite).

## Performance Considerations

- Thunks stay lazy: an on-cadence turn evaluates no trigger signals; an unarmed config passes no trigger thunk at all.
- Memory I/O runs only on gate-pass fires; the store is one small JSON file per project.
- The budget fold is a single O(n) pass; no regex runs beyond the existing strip.
- Sandbox reads are size-capped; the loop is round-capped and deadline-bounded end to end.

## Migration Notes

- config.json changes are additive; absent fields keep today's behavior exactly (all behavioral features default-off).
- Memory files are new local state, untracked; no data migration. Deleting .advisor-memory/ is a full reset.
- Entries committed before Phase 4 lack details keys; the dialogue path treats them as key-less but still visible, so nothing breaks mid-series.
- Rollback per phase: behavioral slices revert by config (set the field off); code reverts by git per single-purpose slice.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 5 §2 (advisor.ts) | <n/a> | blocker | actionability | Phase 5's merged-T3 omission list removes only "the CONSULT_SPECIALIST_NAME routing branch", so the retained else arm `result = { ok: false, reason: undeclaredToolRefusalFor(call.name) }` lands in Phase 5, but `undeclaredToolRefusalFor` is exported in Phase 6 §1 (Region T1's FR6 surface) — Phase 5's advisor.ts references an identifier that does not exist yet and Phase 5's `npx tsc --noEmit` criterion fails | Move `undeclaredToolRefusalFor` into Phase 5's advisor fence (pull it out of T1's FR6 group), or inline the literal in Phase 5 and switch to the export in Phase 6 | applied: the export moved into Phase 5's T1 FR4 part (with a landing note); Phase 6's FR6 group no longer re-declares it |
| code | Phase 5 §2 / Phase 6 §1 (advisor.ts) | node_modules/@earendil-works/pi-ai/dist/types.d.ts:275 | blocker | code-quality | The toolCall filter's predicate narrows to `arguments: Record<string, unknown>`, which is not assignable to pi-ai `ToolCall.arguments: JsonObject` (`{ [key: string]: JsonValue }`), so TS2677 ("a type predicate's type must be assignable to its parameter's type") fails `tsc --noEmit`; Phase 6 §1 repeats the identical predicate verbatim | Import `type { ToolCall } from "@earendil-works/pi-ai"` (type-only, the file's existing discipline) and write `block is ToolCall`, or drop `arguments` from the predicate and cast once at the `executeTool` call | applied: predicate switched to `block is ToolCall` with the type-only import noted in Phase 5's T3 preamble (plan-local; design follow-up: the design's T3 fence carries the non-compiling predicate) |
| code | Phase 6 §3 (index.ts) | index.ts:1 | blocker | codebase-fit | Region S6-A adds `import type { Api, Model } from "@earendil-works/pi-ai";` but nothing in index.ts names `Api` or `Model` — the specialist object is typed solely through `SpecialistConfig` — and biome 2.x's recommended `correctness/noUnusedImports` makes Phase 6's `npx biome check index.ts` criterion fail | Delete the pi-ai type import line (SpecialistConfig already carries the model's type), or annotate the resolution site (e.g. `specialistResolution.model`) to consume it | applied: the unused `Api, Model` import dropped from Phase 6 Region S6-A with a drop note (plan-local; design follow-up: the design's index.ts S6-A carries the unused import) |
| code | Phase 8 §2 (eval/fixtures) | <n/a> | blocker | actionability | Each of the six fixture fences begins with a `// eval/fixtures/<name>.json …` label line inside the file content, and eval/runner.mjs's `JSON.parse(readFileSync(...))` throws on a leading comment, so all six fixtures report `ERROR (unreadable fixture)` and `npm run eval` exits 1 — the Phase 8 "6/6 fixtures, 8/8 scores" and CI gates go red | Declare the label lines fence annotations rather than file content (as the merged-fence markers are), or remove them so each fixture file is valid JSON | applied: the six label lines moved outside the JSON fences as per-file heading lines; fence content is now valid JSON |
| coverage | ## Testing Strategy §4 | <n/a> | blocker | verification-coverage | Note "Every new failure path carries an exact-string pin (fail-open contract); grep the test file for each new reason string." — two new Phase 6 failure arms in runConsultLeg (`"specialist returned no text"` and `` `specialist stopped with ${response.stopReason}` ``) have no t26 block, no Success Criteria bullet, and only the fence branch itself as a mirror (the path, not its pin); criteria NOT FOUND, code NOT FOUND for both arms | Add a t26 block under Phase 6's `#### Automated Verification:` driving the leg facade to a stop response with empty content and asserting the errored toolResult text equals `"specialist returned no text"` (and one for a non-error non-stop stopReason asserting the `specialist stopped with` prefix) | applied: t26 leg-failure-arms block added to Phase 6 (pins both arms incl. "specialist stopped with maxTokens") plus an Automated Verification bullet (design follow-up noted in the block comment) |
| coverage | ## Testing Strategy §7 | <n/a> | blocker | verification-coverage | Note "Strip stays the last filter: no new fake-tool dialect bypasses the tiers" (design Verification Note §4 adds: "any new refusal vocabulary follows the F023 byte-identity guard discipline" — dropped from the plan) — t26 pins only the consult separator/header through `stripAdvisorMarkup`; none of the new refusal strings (Phase 5 `sandboxRefusalFor`/outside-project/byte-cap family, Phase 6 `CONSULT_QUESTION_REFUSAL`/`CONSULT_UNCONFIGURED_REFUSAL`/`undeclaredToolRefusalFor`) is ever run through the strip, and only prose doc-comments assert the property; criteria NOT FOUND, code NOT FOUND | Add one Automated bullet under Phase 5 and Phase 6 pinning each new refusal string passes the strip byte-identical (`stripAdvisorMarkup(sandboxRefusalFor("x")) === sandboxRefusalFor("x")`, same for the three consult refusal strings), asserted in t25/t26 | applied: t25 strip-discipline block (allowlist + outside-project refusals), t26 strip-discipline block (three consult refusals), and strip-discipline bullets added to Phases 5 and 6 (design follow-up noted in the block comments) |
| code | Phase 3 §4 (index.ts); same class in Phase 4 §3, 5 §4, 6 §3, 7 §3 | biome.json:9 | concern | actionability | Region H's `recordAdvice(projectKeyFor(process.cwd()), stripAdvisorMarkup(outcome.text), config.memoryCap, Date.now());` line is ~115 columns while biome.json pins `lineWidth: 100` and the phase's `npx biome check index.ts` gate enforces formatting — the fence trips its own lint gate as shipped; the same class recurs in Phase 4 §3 (103-col plan-turn import) and the 104-col `executeTool:` line repeated in Phases 5 §4, 6 §3, and 7 §3 | Reflow the fenced lines to the 100-column width, or add `npm run format` to each phase's verification commands | applied: the recordAdvice call, the Phase 4 plan-turn test import, and all three executeTool lines reflowed to biome width, plus three same-class over-width lines (memory warnOnce, sandbox byte-cap reason, eval runner fs import) |
| code | Phase 8 §1 (eval/runner.mjs) | <n/a> | suggestion | code-quality | `MARKER_SLACK = 64` re-declares prompt.ts's unexported `MARKER_TOKEN_ALLOWANCE` with nothing binding the two values (unlike the `DEFAULT_MAX_TOOL_ROUNDS` parity, which t25 pins), so a future change to the allowance silently moves the budget-respected score's bound | Export `MARKER_TOKEN_ALLOWANCE` from prompt.ts and have the runner import it instead of re-declaring 64 | deferred: the design deliberately re-declares the value (the DEFAULT_MAX_TOOL_ROUNDS parity pattern, documented in the runner fence); exporting a new prompt.ts symbol changes module surface and belongs to a design follow-up, not this plan |
## Developer Context

- Step 5 triage outcome: 8 reviewer findings — 7 applied (4 fixture labels outside fences, unused import dropped, undeclaredToolRefusalFor moved to Phase 5, ToolCall predicate fix, consult-leg failure-arm pins, refusal strip-discipline pins, width reflows), 1 deferred (MARKER_SLACK parity re-declaration, deliberate design pattern). Three applied fixes are design-root defects patched plan-locally with design follow-up annotations: the advisor T3 predicate (TS2677), the index.ts S6-A unused import, and the two missing pin families. Revisit the design artifact before re-running /skill:design-dependent work on those fences.
- Metadata block collection failed in the invoking session (PowerShell echo stderr); commit/branch/repository frontmatter values were taken from live git (faae538, main) and the design's own frontmatter instead of the no-commit/no-branch placeholders.
- Design transcription notes: (1) the design's config.ts Region H fence contains a duplicated partial copy of the same clampWithWarn block — the plan carries the complete single block (flagged for triage); (2) the design's Architecture fences for prompt.ts, advisor.ts, index.ts, and tests/test.mjs are merged multi-slice presentations — the plan distributes each region block to its owning phase and marks merged fences (Phase 2/3 prompt Region C, Phase 5/6 advisor T3, Phase 5/6 index runAdvisor call) so implement lands the correct per-phase subset.
- All Success Criteria and code blocks pass through from the design artifact unchanged.

## References

- Design: `.rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md`
- Solution analysis: `.rpiv/artifacts/solutions/2026-11-02_08-36-12_jarvis-advisor-evolution.md`
- Research: `.rpiv/artifacts/research/2026-11-01_21-23-59_jarvis-advisor-evolution.md`
- FRD: `.rpiv/artifacts/discover/2026-11-01_21-07-45_jarvis-advisor-evolution.md`
- Guidance: `.rpiv/guidance/architecture.md`
- Audit: `TECH_DEBT_AUDIT.md`
