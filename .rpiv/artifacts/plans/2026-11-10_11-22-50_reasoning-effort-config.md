---
date: 2026-11-10T11:22:50+0700
author: Yogiswara Utama
commit: 4af3ccb
branch: main
repository: advisor-turn-gate
topic: "Reasoning effort config for the advisor and specialist calls"
tags: [plan, config, advisor, specialist, reasoning-effort, warn-latch, eval-mirror, docs]
status: ready
parent: .rpiv/artifacts/research/2026-11-10_10-35-12_reasoning-effort-config.md
phase_count: 4
phases:
  - { n: 1, title: Config layer, files: [config.ts, tests/suites/config.mjs], depends_on: [] }
  - { n: 2, title: Advisor layer, files: [advisor.ts, tests/suites/advisor.mjs], depends_on: [1] }
  - { n: 3, title: Seam and eval mirror, files: [index.ts, eval/runner.mjs], depends_on: [1, 2] }
  - { n: 4, title: Docs and terminal checks, files: [README.md, config.example.json, .agents/skills/advisor-turn-gate/SKILL.md, TECH_DEBT_AUDIT.md], depends_on: [1, 2, 3] }
unresolved_phase_count: 0
last_updated: 2026-11-10T14:16:49+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Phase 1 executed: applied to the tree, t27→t28 band rename, latch-pin AV count corrected, all five Phase 1 AV gates green"
---

# Reasoning Effort Config Implementation Plan

## Overview

Add two config.json fields, `reasoningEffort` and `specialistReasoningEffort`, that set the reasoning effort of the advisor call and the specialist consult call. Both fields are plain strings with `""` as the unset sentinel, validated at load against a locally duplicated six-level list, with one warn latch per field. The advisor module narrows strings to the host's `ThinkingLevel` type at its own boundary and adds `reasoning` to its two `completeSimple` options objects through a conditional spread, so the key is absent — never `undefined` — whenever no level applies.

## Requirements

From the FRD (`.rpiv/artifacts/discover/2026-11-10_10-33-59_reasoning-effort-config.md`):

- FR1: accept a `reasoningEffort` string field in config.json.
- FR2: accept a `specialistReasoningEffort` string field in config.json.
- FR3: accept only `minimal`, `low`, `medium`, `high`, `xhigh`, `max` for both fields.
- FR4: omit the `reasoning` key — absent, not `undefined` — when a field is absent, empty, or not a string.
- FR5: warn once per field on an unaccepted (present, string, not in the set) value, and omit the key for that call.
- FR6: the advisor call passes its level as `options.reasoning` at the `runAdvisor` `completeSimple` site.
- FR7: the specialist consult passes its own level as `options.reasoning` at the `runConsultLeg` `completeSimple` site.
- FR8: `CompleteSimpleFn` types `reasoning` as `ThinkingLevel`, not `string`.
- FR9: the README config table carries one row per new field.
- FR10: `config.example.json` carries both keys.
- NFR: no added model call or latency; the only new input is a validated enum; the warn message names the field, the rejected value, and the accepted values; the config read never throws.
- Developer checkpoint additions: SKILL.md field-count line reworded in the same change; TECH_DEBT_AUDIT.md field counts corrected alongside; the live personal config.json is NOT touched.

## Current State Analysis

The extension never passes `reasoning` today: both options literals are exactly `{ signal }` (`advisor.ts:519` main loop, `advisor.ts:405` consult leg). The host facade accepts `options.reasoning` as `ThinkingLevel` (`node_modules/@earendil-works/pi-ai/dist/types.d.ts:236`); the local `CompleteSimpleFn` declares it as `string` (`advisor.ts:26`), and the `as CompleteSimpleFn` cast at `advisor.ts:194` launders that wider type past tsc. The host clamps unsupported levels in the API adapter (`openai-completions.js:508`), not in the facade the extension reaches; an unset option short-circuits to no `reasoning` field on the wire, which is today's behavior byte-for-byte.

### Key Discoveries

- `AdvisorGateConfig` holds 18 fields narrowed one per line in `loadConfig` (`config.ts:6-43`, `config.ts:204-297`). The nearest precedents are the `specialistModel` and `specialistSystemPrompt` arms (`config.ts:287-294`).
- The warn latch is ONE module-level boolean (`configWarned`, `config.ts:101`; `warnOnce`, `config.ts:103-107`; `resetWarnOnceForTest`, `config.ts:114-116`). Five pins assert `warns.length === 1` for two clamped fields in one read (`tests/suites/config.mjs:169-171`, `tests/suites/triggers.mjs:210`, `tests/suites/prompt.mjs:443`, `tests/suites/memory.mjs:250`, `tests/suites/tools.mjs:515`), so the boolean cannot be re-keyed; the per-field latch must be a second, separate structure.
- `THINKING_LEVELS` is a runtime value reachable only through the `./providers/*` subpath (`pi-ai package.json:26-29`), which is closed: pi-ai is devDependencies-only (`package.json:20-25`) and `advisor.ts:1` is `import type` only. The `ThinkingLevel` TYPE is re-exported from the root (`types.d.ts:18`), so the type may be imported; the list is duplicated as runtime data in both spokes, following the `DEFAULT_MAX_TOOL_ROUNDS` parity precedent (`advisor.ts:47-53`, pinned behaviourally and literally at `tests/suites/tools.mjs:337` and `:517`).
- The omit-key idiom is the conditional spread, precedent `plan-turn.ts:26-30` (a literal `details: undefined` still creates the key; t24 pins its absence).
- Every existing completion stub ignores the third argument (`tests/suites/advisor.mjs:226`, `:424`, `:505`, `:565`, `eval/runner.mjs:190`), so no existing pin can see the options object; the key-absence contract needs a new capturing stub.
- `index.ts:202-219` builds one `advisorArgs` literal for both fire modes (async `:236`, blocking `:266`); the specialist object is built at `index.ts:180-195`, literal at `:189-192`, behind the `config.specialistModel` gate. Post-extraction fields read `config.*` at this I/O layer — the fixed seam direction (Developer Context Q1).
- `eval/runner.mjs` mirrors the seam independently (`:261` blind DEFAULT_CONFIG spread, `:272-281` specialist mirror, `:318-330` runAdvisor args) and is untyped `.mjs`; its facade ignores the options argument, so fixtures stay byte-identical.
- The settle handler re-reads config but consumes only `customType` and `display` (`index.ts:313-317`); no settle change is needed.
- README table spans `README.md:23-42` in interface declaration order; the new rows grow column 1 past `specialistSystemPrompt` (24 -> 27 chars), so all 20 table lines re-pad. The prose at `README.md:19-21` covers two doors; the enum-reject door is a third case neither sentence describes.
- `config.example.json` carries a 7-key prefix of the interface order; the developer-approved shape grows it to 11 keys (`reasoningEffort` plus `specialistModel`, `specialistSystemPrompt`, and `specialistReasoningEffort`, so the specialist block works when copied; FR10 mandates both new fields in the example). `biome.json:20-24` formats JSON, so key order and formatting must survive `npm run lint`.
- Staleness riders (developer-approved): `.agents/skills/advisor-turn-gate/SKILL.md:26` says "All seven config fields" (13 stale after this change); `TECH_DEBT_AUDIT.md:28` and `:52` say the README documents 17 fields (18 today).

## Desired End State

A config.json carrying the new fields:

```json
{
  "model": "stepfun/step-5-preview",
  "reasoningEffort": "high",
  "specialistModel": "openai/gpt-5.1",
  "specialistSystemPrompt": "Answer as a domain specialist.",
  "specialistReasoningEffort": "low"
}
```

produces an advisor `completeSimple` call whose options carry `reasoning: "high"` and a consult-leg call whose options carry `reasoning: "low"`. A config without the fields, with empty strings, with wrong-typed values, or with out-of-set values produces calls whose options object has NO `reasoning` own key — asserted with `Object.hasOwn` — and each out-of-set field warns exactly once per process, naming the field, the rejected value, and the accepted levels. Two invalid fields produce two warnings. Existing configs behave byte-identically to today.

## What We're NOT Doing

- No `temperature`, `maxTokens`, or `samplingParams` pass-through (FRD non-goal, developer narrowed mid-interview).
- No catch-all OpenAI-compatible params object (superseded FRD draft rejected).
- No per-provider translation layer; values go as-is.
- No model-capability detection; the host clamps unsupported levels (`models.js:706-724`), and the extension does not report it.
- No `"off"` acceptance: it is indistinguishable from an absent field (`openai-completions.js:509` converts `"off"` to `undefined`).
- No change to the model resolution path, the deadline, the tool loop, or the settle handler.
- No threading through `planGate`/`GateDecision` (fixed direction: the I/O-layer literal seam).
- No edit to the live personal `config.json` (developer decision).
- No runtime import of `THINKING_LEVELS` (zero runtime npm dependencies holds).

## Decisions

### D1: Plain-string fields, `""` sentinel, appended at interface end
Inherited developer answer (research Q, `config.ts`): fields type as plain `string`, empty means unset, matching `model` (`config.ts:48`) and `specialistModel` (`config.ts:73`); `runAdvisor` narrows before sending. Both fields append after `asyncMode` in FR order — the append-at-end precedent `asyncMode` set after the FR6 specialist pair. Values trim before validation, matching `specialistModel`/`customType`. `AdvisorGateConfig` stays free of pi-ai types (`config.ts:1` imports only `node:fs`).

### D2: Per-field warn latch as a second structure
A module-level `Set<string>` of already-warned field names, consulted by the new validator only. The five shared-latch pins forbid re-keying `warnOnce`; `TECH_DEBT_AUDIT.md:138` records duplicated latches as the accepted price of plain-node loadability. `resetWarnOnceForTest` clears the boolean AND the set, or a warning tripped in one fixture window suppresses the same field in the next. Wrong-typed values stay silent (the t5 door); present-but-unaccepted strings warn once per field with the exact message pinned in tests.

### D3: Duplicated level lists, type-only host import
`config.ts` declares the six accepted levels as runtime data for the validator; `advisor.ts` declares its own runtime set for the narrowing guard plus `import type { ThinkingLevel } from "@earendil-works/pi-ai"` (resolves through `types.d.ts:18`). Parity is pinned the `DEFAULT_MAX_TOOL_ROUNDS` way: each suite pins its own module's list (the warn message's literal enumeration pins config's; a behavioural out-of-list pin plus a literal tuple pin cover advisor's), never by cross-module comparison.

### D4: I/O-layer literal seam
The advisor level rides the `advisorArgs` literal (`index.ts:202-219`); the specialist level rides the `SpecialistConfig` literal (`index.ts:189-192`). Confirmed direction (Developer Context Q1): post-extraction fields read `config.*` at the I/O layer, as `toolsEnabled`/`maxToolRounds`/`specialist`/`asyncMode` already do. `planGate` never reads the values; threading the core would cost seven edits for two pass-through hops. The eval mirror gets the same two lines (`eval/runner.mjs:279`, `:318-330`); the developer fixed that answer (research Q, `eval/runner.mjs`).

### D5: Omit-key via conditional spread, narrowed at the advisor boundary
`runAdvisor` params gain `reasoning?: string` and `SpecialistConfig` gains `reasoning?: string` (raw config values; only the advisor module needs the host type). `runAdvisor` narrows once at entry against its local set; the per-round options literal becomes `{ signal, ...(level !== undefined ? { reasoning: level } : {}) }` (`plan-turn.ts:26-30` idiom). `runConsultLeg` narrows the specialist level the same way. `CompleteSimpleFn`'s options type tightens `reasoning?: string` -> `reasoning?: ThinkingLevel` (FR8), which removes the laundered-wider-type hole the `advisor.ts:194` cast exposed. An out-of-list value can therefore never reach the provider even if validation upstream is bypassed.

### D6: Docs and example grow with the change
README gains two rows (interface-declaration order, column re-pad) and a prose sentence for the third door (present, string, not in the set: one warning per field, key omitted). `config.example.json` grows to 11 keys so the specialist block works when copied (developer-approved relaxation of the strict-prefix property; FR10 puts both new fields in the example). SKILL.md's field-count line becomes count-neutral; TECH_DEBT_AUDIT's two counts are corrected (developer decisions Q2/Q3).

## Phase 1: Config layer

### Overview

Delivers the two validated config fields with per-field warn latching, plus their config.mjs pins. Depends on nothing (foundation); Phases 2-4 build on its field names and defaults.

### Changes Required:

#### 1. config.ts

**File**: config.ts
**Changes**: MODIFY — interface + defaults gain the two fields; a private accepted-level tuple, the per-field warn Set, and a `reasoningLevelOrUnset` validator arrive; `resetWarnOnceForTest` clears both latches; `loadConfig` gains the two narrowing arms after `asyncMode`. Five edit sites, in file order:

```ts
// --- edit 1 of 5 — AdvisorGateConfig, after `asyncMode: boolean;` (config.ts:41-42) ---
  /** Commit the advisor's reply at the next agent settlement instead of blocking turn_end. */
  asyncMode: boolean;
  /** Reasoning effort for the advisor call. Empty omits the option entirely. */
  reasoningEffort: string;
  /** Reasoning effort for the specialist consult call. Empty omits the option entirely. */
  specialistReasoningEffort: string;
}

// --- edit 2 of 5 — DEFAULT_CONFIG, after `asyncMode: false,` (config.ts:79) ---
  asyncMode: false,
  reasoningEffort: "",
  specialistReasoningEffort: "",
};

// --- edit 3 of 5 — extends the latch block (config.ts:99-116) ---
/**
 * The accepted reasoning-effort levels, duplicated from the host's THINKING_LEVELS
 * (pi-ai dist/providers/model-schema.d.ts:2). The runtime value is unreachable from
 * the package root barrel and this module imports no pi-ai type, so the list is
 * declared here as data. "off" is deliberately absent: the host converts it to
 * undefined (openai-completions.js:509), which is indistinguishable from an unset
 * field. The advisor module carries its own copy for the narrowing guard; the
 * parity is pinned by each suite's own literal assertion, never by a cross-module
 * comparison (the DEFAULT_MAX_TOOL_ROUNDS precedent).
 */
const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Warn at most once per process — the handler calls loadConfig() on every turn. */
let configWarned = false;

/**
 * The per-field warn latch for the reasoning-effort validators.
 *
 * A SECOND structure, not a re-key of configWarned: five pins assert that two
 * clamped fields in one read produce exactly one warning through the shared
 * boolean (t5, t21c, t22c, t23c, t25c), so warnOnce cannot become per-field
 * without breaking them. Only the two reasoning-effort validators consult this
 * set; every clamp and the model-format and broken-config warnings keep riding
 * the shared boolean. TECH_DEBT_AUDIT.md:138 records duplicated latches as the
 * accepted price of plain-node loadability.
 */
const reasoningWarned = new Set<string>();

function warnOnce(message: string): void {
  if (configWarned) return;
  configWarned = true;
  console.warn(message);
}

/**
 * Re-arm the warn-once latches. Test-only surface: the suite's withConfig() calls this at
 * entry, so every fixture window starts fresh and the config tests carry no ordering
 * constraint. Production never re-arms a warning: one notice per process is the contract.
 *
 * BOTH latches are cleared: a reasoning-effort warning tripped in one fixture window
 * must not suppress the same field's warning in the next window.
 */
export function resetWarnOnceForTest(): void {
  configWarned = false;
  reasoningWarned.clear();
}

// --- edit 4 of 5 — after clampWithWarn (config.ts:141) ---
/**
 * Validate one reasoning-effort field: trim, accept only a listed level, warn once
 * per field on an unaccepted value.
 *
 * Three doors, in order:
 *   - absent or wrong-typed: silent fallback to THIS field's default (the t5 door —
 *     a wrong-typed field never reaches a warning), mirroring the per-field
 *     DEFAULT_CONFIG.<field> fallback the specialistModel/specialistSystemPrompt
 *     arms use (config.ts:287-294).
 *   - empty after trim: the valid unset state, silent (the specialistModel
 *     precedent — empty is not a misconfiguration).
 *   - present, non-empty, not in the list: warn ONCE for this field and return
 *     the unset sentinel, so the call omits the option entirely.
 *
 * The latch is per field, so two bad fields in one read produce two warnings.
 */
function reasoningLevelOrUnset(
  fieldName: "reasoningEffort" | "specialistReasoningEffort",
  value: unknown,
): string {
  if (typeof value !== "string") return DEFAULT_CONFIG[fieldName];
  const trimmed = value.trim();
  if (trimmed === "") return trimmed;
  if (!REASONING_LEVELS.includes(trimmed as (typeof REASONING_LEVELS)[number])) {
    if (!reasoningWarned.has(fieldName)) {
      reasoningWarned.add(fieldName);
      console.warn(
        `[advisor-turn-gate] config.json ${fieldName} "${trimmed}" is not an accepted ` +
          `reasoning level (accepted ${REASONING_LEVELS.join(", ")}); the option is omitted`,
      );
    }
    return "";
  }
  return trimmed;
}

// --- edit 5 of 5 — loadConfig return literal, after the asyncMode arm (config.ts:295-296) ---
      asyncMode:
        typeof parsed.asyncMode === "boolean" ? parsed.asyncMode : DEFAULT_CONFIG.asyncMode,
      reasoningEffort: reasoningLevelOrUnset("reasoningEffort", parsed.reasoningEffort),
      specialistReasoningEffort: reasoningLevelOrUnset(
        "specialistReasoningEffort",
        parsed.specialistReasoningEffort,
      ),
    };
```

#### 2. tests/suites/config.mjs

**File**: tests/suites/config.mjs
**Changes**: MODIFY — new t28 band appended at the end of the suite: the three doors, the per-field latch, the exact pinned message, latch-window isolation (one `withConfig` window per warn-count assert — the t3 idiom), the clamp-door independence pin, and the specialist door pair.

```js
// --- 28. the reasoning-effort fields: the three doors, the per-field latch, and the
//         defaults. Extends t5/t7/t26c; the shared boolean latch is untouched, so the
//         five "share the warn-once latch" pins elsewhere keep their meaning.
{
  // Door 1: a valid level survives, trimmed. Wrong-typed and absent stay silent.
  const valid = withConfig(JSON.stringify({ reasoningEffort: "  high  " }), () => loadConfig());
  assert(valid.reasoningEffort === "high", "t28: a padded valid level is trimmed and kept");
  const silent = captureWarn(() => {
    const wrong = withConfig(JSON.stringify({ reasoningEffort: 42 }), () => loadConfig());
    assert(
      wrong.reasoningEffort === DEFAULT_CONFIG.reasoningEffort,
      "t28: a wrong-typed reasoningEffort falls back to the default",
    );
    const empty = withConfig(JSON.stringify({ reasoningEffort: "   " }), () => loadConfig());
    assert(empty.reasoningEffort === "", "t28: an empty reasoningEffort is the valid unset state");
  });
  assert(silent.length === 0, "t28: wrong-typed and empty fields warn nothing");
  // Door 3: an unaccepted value warns once, names field/value/levels, and unset.
  // BOTH reads share ONE withConfig window: withConfig re-arms the latch at entry
  // (helpers.mjs:41), so two windows would produce two warns and prove nothing —
  // the t3 idiom (config.mjs:109-117).
  const warns = captureWarn(() =>
    withConfig(JSON.stringify({ reasoningEffort: "ultra" }), () => {
      const bad = loadConfig();
      assert(bad.reasoningEffort === "", "t28: an unaccepted level unset the field");
      const again = loadConfig();
      assert(again.reasoningEffort === "", "t28: the second read still unset the field");
    }),
  );
  assert(warns.length === 1, "t28: an unaccepted level warns once per process");
  assert(
    warns[0] ===
      '[advisor-turn-gate] config.json reasoningEffort "ultra" is not an accepted ' +
      "reasoning level (accepted minimal, low, medium, high, xhigh, max); the option is omitted",
    "t28: the warning names the field, the rejected value, and the accepted levels",
  );
  // The per-field latch: two bad fields in one read produce two warnings, and the
  // shared boolean latch is NOT what produces them (a clamp in the same read still
  // rides the boolean, so the counts stay separable).
  const twoFields = captureWarn(() =>
    withConfig(
      JSON.stringify({ reasoningEffort: "ultra", specialistReasoningEffort: "nope" }),
      () => loadConfig(),
    ),
  );
  assert(twoFields.length === 2, "t28: two unaccepted fields warn once each");
  assert(
    twoFields[0].includes("reasoningEffort") && twoFields[1].includes("specialistReasoningEffort"),
    "t28: each warning names its own field",
  );
  // The latch is per field, not per process: a fresh window re-arms both fields.
  const reArmed = captureWarn(() =>
    withConfig(JSON.stringify({ reasoningEffort: "ultra" }), () => loadConfig()),
  );
  assert(reArmed.length === 1, "t28: a fresh fixture window re-arms the per-field latch");
  // The shared boolean latch still caps a clamp read at one warning, and a reasoning
  // warning does not consume it (the two structures are independent).
  const mixed = captureWarn(() =>
    withConfig(JSON.stringify({ interval: 0, reasoningEffort: "ultra" }), () => {
      const cfg = loadConfig();
      assert(cfg.interval === MIN_INTERVAL, "t28: the clamp still lands beside the new field");
      assert(cfg.reasoningEffort === "", "t28: the new field still unset beside the clamp");
    }),
  );
  assert(mixed.length === 2, "t28: a clamp and a reasoning warning are independent latches");
  // Defaults: both fields ship unset, so today's behavior is the default.
  assert(DEFAULT_CONFIG.reasoningEffort === "", "t28: the advisor level ships unset");
  assert(DEFAULT_CONFIG.specialistReasoningEffort === "", "t28: the specialist level ships unset");
  // The specialist field rides the same three doors, with its own per-field default.
  const spec = withConfig(JSON.stringify({ specialistReasoningEffort: "low" }), () => loadConfig());
  assert(spec.specialistReasoningEffort === "low", "t28: a valid specialist level survives");
  const specSilent = captureWarn(() => {
    const wrong = withConfig(
      JSON.stringify({ specialistReasoningEffort: 42 }),
      () => loadConfig(),
    );
    assert(
      wrong.specialistReasoningEffort === DEFAULT_CONFIG.specialistReasoningEffort,
      "t28: a wrong-typed specialist level falls back to its own default",
    );
    const empty = withConfig(
      JSON.stringify({ specialistReasoningEffort: "   " }),
      () => loadConfig(),
    );
    assert(
      empty.specialistReasoningEffort === "",
      "t28: an empty specialist level is the valid unset state",
    );
  });
  assert(specSilent.length === 0, "t28: the specialist doors stay silent");
}
```

### Success Criteria:

#### Automated Verification:
- [x] The new t28 band passes inside the full suite: `npm test`
- [x] The five shared-latch pins stay green and untouched: `npm test 2>&1 | grep -cE "share the (warn-once )?latch"` returns 5 (t5's pin says "share the latch"; the other four say "share the warn-once latch")
- [x] The per-field independence pin holds: `npm test 2>&1 | grep -c "t28: two unaccepted fields warn once each"` returns 1
- [x] Strict types compile with the new fields and the union-typed validator: `npm run typecheck`
- [x] Lint clean on this phase's files: `npx biome check config.ts tests/suites/config.mjs` (after one biome format pass on the band)

#### Manual Verification:
- [ ] A config.json holding `"reasoningEffort": "ultra"` produces exactly one warning naming the accepted levels on the first advisor-eligible turn, and no warning on later turns of the same session.

## Phase 2: Advisor layer

### Overview

Delivers the type tightening, the local narrowing guard, and the omit-key options shape at both `completeSimple` sites, plus the advisor.mjs option-capture pins. Depends on Phase 1 (level vocabulary and defaults); can be generated only after it.

### Changes Required:

#### 1. advisor.ts

**File**: advisor.ts
**Changes**: MODIFY — `ThinkingLevel` joins the type-only import; `CompleteSimpleFn` options `reasoning` retyped (FR8, closes the laundering hole at `advisor.ts:194`); a private six-level tuple + `narrowReasoningLevel` guard arrive; `runAdvisor` params gain `reasoning?: string` narrowed ONCE PER FIRE beside `startedAt` (before the `for(;;)` loop); the per-round options literal gains the conditional spread referencing the hoisted const; `SpecialistConfig` gains `reasoning?: string`; `runConsultLeg` options gains the same spread. Eight edit sites, in file order:

```ts
// --- edit 1 of 8 — the type import (advisor.ts:1) ---
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  ThinkingLevel,
  ToolCall,
} from "@earendil-works/pi-ai";

// --- edit 2 of 8 — CompleteSimpleFn options (advisor.ts:23-27) ---
/** The auth-aware completion facade Pi keeps behind the registry's private `runtime` slot. */
type CompleteSimpleFn = (
  model: Model<Api>,
  context: { systemPrompt: string; messages: Message[]; tools?: AdvisorTool[] },
  options?: { signal?: AbortSignal; reasoning?: ThinkingLevel; sessionId?: string },
) => Promise<AssistantMessage>;

// --- edit 3 of 8 — the local level set + guard (after DEFAULT_MAX_TOOL_ROUNDS, advisor.ts:53) ---
/**
 * The accepted reasoning-effort levels, duplicated from the host's THINKING_LEVELS
 * (pi-ai dist/providers/model-schema.d.ts:2).
 *
 * Deliberately the SAME six values as config.ts's REASONING_LEVELS: the offline
 * suite pins the parity (t29), because this module imports no sibling and cannot
 * read the constant — the DEFAULT_MAX_TOOL_ROUNDS pattern (advisor.ts:47-53).
 * "off" is absent for the same reason config.ts omits it: the host converts it to
 * undefined (openai-completions.js:509), which is indistinguishable from an unset
 * field.
 *
 * The TYPE is imported from the package root (types.d.ts:18 re-exports
 * ThinkingLevel); only the runtime VALUE is unreachable, so the list is data here.
 */
const REASONING_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Narrow one config-supplied reasoning level to the host's ThinkingLevel, or
 * undefined when it must be omitted.
 *
 * config.ts already validated the value against the same six levels and unset an
 * unaccepted one, so this guard is a second, independent door: a value that
 * bypasses the config layer (a direct runAdvisor caller, the eval mirror's blind
 * DEFAULT_CONFIG spread) still cannot reach the provider outside the union. The
 * empty string is the unset sentinel, not a level.
 */
function narrowReasoningLevel(value: string | undefined): ThinkingLevel | undefined {
  if (value === undefined || value === "") return undefined;
  return REASONING_LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

// --- edit 4 of 8 — SpecialistConfig gains the field (advisor.ts:119-122) ---
/** What the seam hands runAdvisor for the optional specialist leg. */
export interface SpecialistConfig {
  model: Model<Api>;
  systemPrompt: string;
  /**
   * The specialist's reasoning level, straight from config.specialistReasoningEffort.
   * Empty or absent omits the option; narrowReasoningLevel enforces the union.
   */
  reasoning?: string;
}

// --- edit 5 of 8 — runConsultLeg options (advisor.ts:405) ---
    // Narrowed ONCE per leg, before the call: the same single-evaluation discipline
    // the loop path applies (edit 7).
    const specialistLevel = narrowReasoningLevel(specialist.reasoning);
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
          {
            signal,
            // The conditional spread is load-bearing: a literal reasoning: undefined
            // would still create the key, and t29 pins its absence (the plan-turn.ts:26-30
            // idiom).
            ...(specialistLevel ? { reasoning: specialistLevel } : {}),
          },
        ),
      budgetMs,
      externalSignal,
    );

// --- edit 6 of 8 — runAdvisor params gain the field (advisor.ts:457-478) ---
  /** The optional specialist (FR6). Absent keeps consult_specialist undeclared. */
  specialist?: SpecialistConfig;
  /**
   * The advisor call's reasoning level, straight from config.reasoningEffort.
   * Empty or absent omits the option; narrowReasoningLevel enforces the union.
   */
  reasoning?: string;
}): Promise<AdvisorOutcome> {

// --- edit 7 of 8 — the hoisted narrowing (inside the try, beside startedAt, BEFORE the for(;;) loop) ---
    const startedAt = Date.now();
    // Narrowed ONCE per fire, before the loop: the value is a config snapshot and
    // cannot change mid-loop, so every round sends the same level (or none).
    const reasoning = narrowReasoningLevel(params.reasoning);
    let conversation = [...params.messages];

// --- edit 8 of 8 — the per-round options literal (advisor.ts:514-522, references the hoisted const) ---
      const remaining = Math.max(0, params.timeoutMs - (Date.now() - startedAt));
      const response = await callWithDeadline(
        (signal) =>
          completeSimple(
            params.model,
            { systemPrompt: params.systemPrompt, messages: conversation, tools: requestTools },
            {
              signal,
              // The conditional spread is load-bearing: a literal reasoning: undefined
              // would still create the key, and t29 pins its absence (the plan-turn.ts:26-30
              // idiom).
              ...(reasoning ? { reasoning } : {}),
            },
          ),
        remaining,
        params.signal,
      );
```

#### 2. tests/suites/advisor.mjs

**File**: tests/suites/advisor.mjs
**Changes**: MODIFY — a module-level literal tuple declaration (emitted BEFORE the band, so no temporal-dead-zone) plus the new t29 band appended at the end of the suite: the omit-key contract at both `completeSimple` sites, the narrowing guard, the advisor/specialist independence, and the level-list parity pin.

```js
// The literal tuple is re-declared in the suite rather than imported: the module's
// list is private (the DEFAULT_MAX_TOOL_ROUNDS precedent — the parity pin is two
// INDEPENDENT literal assertions, never a cross-module comparison).
const REASONING_LEVELS_LITERAL = ["minimal", "low", "medium", "high", "xhigh", "max"];

// --- 29. the reasoning-effort option: the omit-key contract at both completeSimple
//         sites, the narrowing guard, and the level-list parity pin.
{
  // A capturing facade: records the THIRD argument of every call, which every
  // existing stub ignores (t16/t26 stubs take (model, context) only).
  const makeCapturingRegistry = (script) => {
    const seen = [];
    let step = 0;
    const registry = {
      runtime: {
        completeSimple: (model, context, options) => {
          seen.push({ model, context, options });
          const next = script[step] ?? { stopReason: "stop", content: [{ type: "text", text: "x" }] };
          step += 1;
          return Promise.resolve(next);
        },
      },
    };
    return { registry, seen };
  };

  // (a) The advisor call carries the level when configured.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    const outcome = await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      reasoning: "high",
    });
    assert(outcome.ok && outcome.text === "advice", "t29: the advisor call still succeeds");
    assert(seen.length === 1, "t29: one call, no loop armed");
    assert(
      seen[0].options?.reasoning === "high",
      "t29: the advisor call carries reasoning: high",
    );
  }

  // (b) The omit-key contract: no reasoning param means NO OWN KEY, not undefined.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
    });
    assert(
      seen[0].options !== undefined && !Object.hasOwn(seen[0].options, "reasoning"),
      "t29: an unset advisor level leaves NO reasoning own key",
    );
    assert(seen[0].options?.signal !== undefined, "t29: the signal still rides the options");
  }

  // (c) The empty string is the unset sentinel, not a level.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      reasoning: "",
    });
    assert(
      !Object.hasOwn(seen[0].options ?? {}, "reasoning"),
      "t29: an empty advisor level omits the key",
    );
  }

  // (d) The narrowing guard: an out-of-list value never reaches the provider.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      reasoning: "ultra",
    });
    assert(
      !Object.hasOwn(seen[0].options ?? {}, "reasoning"),
      "t29: an out-of-list advisor level omits the key (the guard's behavioural parity pin)",
    );
  }

  // (e) The specialist leg carries its own level, independently of the advisor's.
  {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    const { registry, seen } = makeCapturingRegistry([
      {
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "cs1", name: "consult_specialist", arguments: { question: "q?" } },
        ],
      },
      { stopReason: "stop", content: [{ type: "text", text: "specialist answer" }] },
      { stopReason: "stop", content: [{ type: "text", text: "final" }] },
    ]);
    const outcome = await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
      timeoutMs: 5000,
      maxToolRounds: 3,
      reasoning: "high",
      specialist: { model: specialistModel, systemPrompt: "sp2", reasoning: "low" },
    });
    assert(outcome.ok, "t29: the consult fire succeeds");
    assert(seen.length === 3, "t29: main + leg + main");
    assert(
      seen[0].options?.reasoning === "high",
      "t29: the advisor rounds carry reasoning: high",
    );
    assert(
      seen[1].options?.reasoning === "low",
      "t29: the specialist leg carries its own reasoning: low",
    );
    assert(
      seen[2].options?.reasoning === "high",
      "t29: the post-leg advisor round still carries reasoning: high",
    );
  }

  // (f) An unset specialist level omits the key on the leg.
  {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    const { registry, seen } = makeCapturingRegistry([
      {
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "cs1", name: "consult_specialist", arguments: { question: "q?" } },
        ],
      },
      { stopReason: "stop", content: [{ type: "text", text: "specialist answer" }] },
      { stopReason: "stop", content: [{ type: "text", text: "final" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
      timeoutMs: 5000,
      maxToolRounds: 3,
      specialist: { model: specialistModel, systemPrompt: "sp2" },
    });
    assert(
      !Object.hasOwn(seen[1].options ?? {}, "reasoning"),
      "t29: an unset specialist level leaves NO reasoning own key on the leg",
    );
  }

  // (g) The level-list parity pin: the literal tuple, asserted independently (the
  //     DEFAULT_MAX_TOOL_ROUNDS two-pin pattern — tools.mjs:337 behavioural,
  //     :517 literal). Behavioural coverage is (d) above.
  assert(
    REASONING_LEVELS_LITERAL.join(",") === "minimal,low,medium,high,xhigh,max",
    "t29: the advisor-side level list is the six-level tuple, pinned literally",
  );
}
```

### Success Criteria:

#### Automated Verification:
- [x] The new t29 band passes inside the full suite: `npm test`
- [x] The omit-key contract is asserted by key absence, not truthiness: `npm test 2>&1 | grep -c "NO reasoning own key"` returns 2
- [x] The t16 and t26 pins stay green untouched: `npm test 2>&1 | grep -c "t16:"` matches the pre-change count (14), same for "t26:" (42)
- [x] Strict types compile with the retyped options and the narrowed params: `npm run typecheck`
- [x] Lint clean on this phase's files: `npx biome check advisor.ts tests/suites/advisor.mjs` (after one biome format pass on the band)

#### Manual Verification:
- [ ] With `reasoningEffort` set, the advisor request carries the level; with it unset, the request carries no reasoning field at all (inspect one live call's payload).

## Phase 3: Seam and eval mirror

### Overview

Wires the two config values into the fire-time literals in `index.ts` and keeps the eval mirror faithful. Depends on Phases 1-2; no other file changes.

### Changes Required:

#### 1. index.ts

**File**: index.ts
**Changes**: MODIFY — `advisorArgs` literal gains `reasoning: config.reasoningEffort` after `maxToolRounds` (index.ts:216); the fire-time specialist literal gains `reasoning: config.specialistReasoningEffort` (index.ts:189-192). Two edit sites:

```ts
// --- edit 1 of 2 — the advisorArgs literal (index.ts:202-219), add after maxToolRounds ---
      maxToolRounds: config.maxToolRounds,
      // The advisor call's reasoning level. Empty (the default) omits the option
      // entirely at the advisor boundary (advisor.ts's narrowReasoningLevel +
      // conditional spread), so an unset field reproduces today's request byte for
      // byte. Read here at the I/O layer like maxToolRounds and specialist — the
      // post-extraction seam direction, not threaded through planGate.
      reasoning: config.reasoningEffort,
      // FR6: undefined when unconfigured or unresolved — the consult stays undeclared.
      specialist,

// --- edit 2 of 2 — the SpecialistConfig literal (index.ts:189-192) ---
        if (specialistResolution.ok) {
          specialist = {
            model: specialistResolution.model,
            systemPrompt: config.specialistSystemPrompt,
            // The specialist's own level, independent of the advisor's. Empty omits
            // the option on the consult leg (advisor.ts's narrowReasoningLevel).
            reasoning: config.specialistReasoningEffort,
          };
        }
```

#### 2. eval/runner.mjs

**File**: eval/runner.mjs
**Changes**: MODIFY — the Region S6-B specialist mirror gains `reasoning: config.specialistReasoningEffort` (literal at eval/runner.mjs:279); the `runAdvisor` args mirror gains `reasoning: config.reasoningEffort` after `maxToolRounds` (:328). Fixtures stay byte-identical: the facade (`makeFacade`, eval/runner.mjs:190) never reads the third argument and the blind DEFAULT_CONFIG spread forwards the `""` sentinel. Two edit sites:

```js
// --- edit 1 of 2 — the specialist mirror (eval/runner.mjs:272-281, literal at :279) ---
    // Region S6-B mirror: the specialist resolves at fire time or stays undefined.
    let specialist;
    if (config.specialistModel) {
      const parsed = parseModelKey(config.specialistModel);
      if (parsed) {
        const resolution = resolveAdvisorModel(registry, parsed.provider, parsed.modelId);
        if (resolution.ok) {
          specialist = {
            model: resolution.model,
            systemPrompt: config.specialistSystemPrompt,
            // Mirror of index.ts:189-192 — the specialist's own level. The blind
            // DEFAULT_CONFIG spread at :261 forwards the "" sentinel, so fixtures
            // without the key stay byte-identical.
            reasoning: config.specialistReasoningEffort,
          };
        }
      }
    }

// --- edit 2 of 2 — the runAdvisor args mirror (eval/runner.mjs:318-330), add after maxToolRounds ---
        maxToolRounds: config.maxToolRounds,
        // Mirror of index.ts:202-219 — the advisor level. The blind DEFAULT_CONFIG
        // spread at :261 forwards the "" sentinel, so fixtures without the key stay
        // byte-identical (the facade ignores the third argument anyway).
        reasoning: config.reasoningEffort,
        specialist,
```

### Success Criteria:

#### Automated Verification:
- [ ] Both forwarding lines landed in the seam: `grep -c "config.reasoningEffort" index.ts` returns 1 and `grep -c "config.specialistReasoningEffort" index.ts` returns 1
- [ ] Both mirror lines landed in the eval runner: `grep -c "config.reasoningEffort" eval/runner.mjs` returns 1 and `grep -c "config.specialistReasoningEffort" eval/runner.mjs` returns 1
- [ ] The golden fixtures are untouched by this phase: `git diff --stat eval/fixtures/` prints nothing
- [ ] The eval suite replays every fixture green with the mirror in place: `npm run eval`
- [ ] Strict types compile with the two forwarding lines against Phase 2's param types: `npm run typecheck`
- [ ] Lint clean on this phase's files: `npx biome check index.ts eval/runner.mjs`

#### Manual Verification:
- [ ] With `reasoningEffort` set in config.json, one live advisor request carries the level; with it unset, the request carries no reasoning field (inspect the payload of one call each way).
- [ ] The eval score table printed by `npm run eval` is identical to the pre-change run (same fixture count, same PASS rows).

## Phase 4: Docs and terminal checks

### Overview

Documents the fields (README rows + third-door prose, example to 11 keys) and applies the two approved staleness riders. Depends on Phases 1-3; terminal phase carries the whole-plan checks.

### Changes Required:

#### 1. README.md

**File**: README.md
**Changes**: MODIFY — prose gains the enum-reject door and disambiguates the clamp latch ("per process"); the table gains two rows in declaration order and every line re-pads (column 1 = 27 content chars, sized to `specialistReasoningEffort`; column 2 unchanged at 21; column 3 re-pads to the widest meaning cell). Two edit sites:

```md
<!-- edit 1 of 2 — the prose above the table (README.md:19-21) -->
`config.json` is read on every turn, so changes apply without a reload. A field that
is absent or wrong-typed falls back to the default below. Out-of-range numbers are
clamped into range, with a one-time warning per process. A reasoning-effort field
holding a value outside the accepted set (minimal, low, medium, high, xhigh, max)
warns once for that field, and the option is omitted from the model call.

<!-- edit 2 of 2 — the table (README.md:23-42), full replacement, all lines re-padded -->
| Field                       | Default               | Meaning                                                                                                                                                                  |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`                   | `true`                | Master switch. `false` skips the advisor call and the continuation entirely.                                                                                             |
| `interval`                  | `2`                   | Advisor runs on the first completed turn at or past each N-turn boundary. Clamped 1-100.                                                                                 |
| `model`                     | `""` (disabled)       | `provider/modelId` of the advisor model. Empty or unparseable disables the gate.                                                                                         |
| `timeoutMs`                 | `60000`               | Advisor call budget in milliseconds. Clamped 1000-60000.                                                                                                                 |
| `systemPrompt`              | code default          | Optional override. The code default is the single source; `config.example.json` carries a copy for reference.                                                            |
| `customType`                | `"advisor-turn-gate"` | The committed guidance entry's custom type.                                                                                                                              |
| `display`                   | `true`                | Whether the committed entry renders in the TUI transcript.                                                                                                               |
| `triggerMinNewTokens`       | `0` (disabled)        | Fire before the next boundary when a finished turn grew by this many tokens. Clamped 0-100000.                                                                           |
| `triggerContextPercent`     | `0` (disabled)        | Fire before the next boundary when the context window is at least this percent full. Clamped 0-100.                                                                      |
| `triggerOnError`            | `false`               | Fire on a turn that ended in an error. Aborted turns never fire.                                                                                                         |
| `triggerRiskyTools`         | `""` (disabled)       | Comma-separated tool names. Any exact match on this turn's tool results fires early.                                                                                     |
| `tokenBudget`               | `0` (disabled)        | Soft cap for the advisor payload in estimated tokens (JSON characters / 4). System messages and the verbatim tail always survive the fold. Clamped 0-1000000.            |
| `memoryCap`                 | `0` (disabled)        | Advisor entries kept per project in the local `.advisor-memory/` store. Each fire appends its advice; the next fire's prompt carries the digest. Clamped 0-200.          |
| `toolsEnabled`              | `false`               | Let the advisor read project files through a read-only sandbox during a fire.                                                                                            |
| `maxToolRounds`             | `3`                   | Read rounds per fire when `toolsEnabled` is on.                                                                                                                          |
| `specialistModel`           | `""` (disabled)       | `provider/modelId` of an on-demand specialist the advisor can consult. Empty disables the consult leg.                                                                   |
| `specialistSystemPrompt`    | code default          | Optional system prompt for the specialist. The code default is the single source.                                                                                        |
| `asyncMode`                 | `false` (blocking)    | Commit the advisor's reply at the next agent settlement instead of blocking turn_end. The advisor never wakes an idle agent.                                             |
| `reasoningEffort`           | `""` (unset)          | Reasoning effort for the advisor call: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Unset or unlisted omits the option; an unlisted value warns once per process. |
| `specialistReasoningEffort` | `""` (unset)          | Reasoning effort for the specialist consult, independent of the advisor's. Same accepted values; inert until `specialistModel` is set.                                   |
```

#### 2. config.example.json

**File**: config.example.json
**Changes**: MODIFY — grows to 11 keys: `specialistModel` and `specialistSystemPrompt` after `display`, then `reasoningEffort` and `specialistReasoningEffort` last (interface order: the two new fields sit after `asyncMode` in the interface, which the example omits). Every added value ships `""`, so copying the file leaves the gate off. Both prompt values are byte-identical copies of the `DEFAULT_CONFIG` strings (the F005-reversal precedent).

```json
{
  "enabled": true,
  "interval": 2,
  "model": "",
  "timeoutMs": 60000,
  "systemPrompt": "You are a senior engineer reviewing the reasoning trace and outputs of another agent's work in progress. That transcript is all you receive; find what is going wrong or about to go wrong, and say so in a few direct sentences. Name the file and the line when you can. Do not restate the task. Do not praise. If the work is on track, say so briefly and stop. You have no tools and cannot call any. Reply in text only: never write tool-call markup, angle-bracket tool syntax, or anything that imitates a tool call. Supervise the reasoning trace in plain prose. Tool calls and their outputs reach you as plain prose: a note that names the call and its arguments, then a line that starts with [tool output] and carries the output verbatim. A trailing [tool output ended in error] line marks a failed output.",
  "customType": "advisor-turn-gate",
  "display": true,
  "specialistModel": "",
  "specialistSystemPrompt": "You are a domain specialist consulted by a senior engineer who is reviewing another agent's work. Answer the question asked in a few direct sentences. Name the file and the line when you can. Reply in text only: never write tool-call markup or anything that imitates a tool call.",
  "reasoningEffort": "",
  "specialistReasoningEffort": ""
}
```

#### 3. .agents/skills/advisor-turn-gate/SKILL.md

**File**: .agents/skills/advisor-turn-gate/SKILL.md
**Changes**: MODIFY — the "All seven config fields" line becomes count-neutral, so it can never go stale again.

```md
All config fields live in `config.json`. The README documents each field with
its default. The gate ships disabled: set `model` to `provider/modelId` to activate it.
```

#### 4. TECH_DEBT_AUDIT.md

**File**: TECH_DEBT_AUDIT.md

**Changes**: MODIFY — the two "17 config fields" counts are corrected to the current table size (18 today + the two new fields = 20), per the developer's "correct alongside" decision. Two edit sites:

```md
<!-- edit 1 of 2 — the mental-model paragraph sentence (TECH_DEBT_AUDIT.md:28) -->
README documents 20 config fields and matches the code defaults checked this run.

<!-- edit 2 of 2 — the F019 row description cell (TECH_DEBT_AUDIT.md:52) -->
The table now carries all 20 fields and matches `DEFAULT_CONFIG`.
```

### Success Criteria:

#### Automated Verification:
- [ ] The README table carries both new rows: `grep -ci "ReasoningEffort" README.md` returns 2 (case-insensitive: `reasoningEffort` and `specialistReasoningEffort`; the hyphenated prose does not match)
- [ ] The third-door prose landed: `grep -c "warns once for that field" README.md` returns 1
- [ ] The example carries both new keys: `grep -ci "ReasoningEffort" config.example.json` returns 2
- [ ] The example is valid JSON with 11 keys: `node -e "const c=require('./config.example.json');if(Object.keys(c).length!==11)process.exit(1)"` exits 0
- [ ] The SKILL.md count-neutral line landed: `grep -c "All config fields live in" .agents/skills/advisor-turn-gate/SKILL.md` returns 1
- [ ] The audit counts are corrected: `grep -c "documents 20 config fields" TECH_DEBT_AUDIT.md` returns 1 and `grep -c "all 20 fields" TECH_DEBT_AUDIT.md` returns 1
- [ ] The whole suite is green (terminal whole-plan gate): `npm test`
- [ ] Strict types compile across the whole plan (terminal whole-plan gate): `npm run typecheck`
- [ ] Lint and format clean across the whole plan, including the example's key order (terminal whole-plan gate): `npm run lint`
- [ ] The eval score gate passes with the mirror in place (terminal whole-plan gate): `npm run eval`

#### Manual Verification:
- [ ] The README table renders with aligned columns (the 27-char first column) in a markdown viewer.
- [ ] Copying `config.example.json` to `config.json` and setting `model` plus `reasoningEffort` activates the gate with the level applied; the specialist block works when `specialistModel` is also set.

## Ordering Constraints

Phase 1 before Phase 2 (advisor tests reference the config vocabulary and the suites run in one process). Phases 1-2 before Phase 3 (the seam forwards values whose names and defaults Phase 1 fixes and whose call-site shape Phase 2 fixes). Phase 4 last: the README row count, the example key order, and the corrected audit counts describe the post-Phase-3 tree, and the terminal whole-plan checks need every phase landed. No phase runs in parallel with another under sequential implement; the plan is written for that lane.

## Verification Notes

- Known risk: the five shared-latch pins (`tests/suites/config.mjs:169-171`, `triggers.mjs:210`, `prompt.mjs:443`, `memory.mjs:250`, `tools.mjs:515`) must stay green untouched — they are the constraint that forces the second latch structure. Check: run `npm test` and confirm the five "share the warn-once latch" PASS lines are unchanged. CORRECTED 2026-11-10 at execution: the five pins use two phrasings — t5 says "share the latch" (config.mjs:170), the other four say "share the warn-once latch"; count with `grep -cE "share the (warn-once )?latch"` (returns 5).
- Known risk: every existing completion stub ignores the options argument, so a regressed `{ signal, reasoning: undefined }` is invisible to the current suite. Check: the new t29 pins must assert `Object.hasOwn(options, "reasoning") === false`, not truthiness.
- Known risk: the eval mirror drifts silently (already diverged once on `signal`). Check: `npm run eval` passes with fixtures unchanged; grep the runner for `reasoningEffort` to confirm both mirror lines landed.
- Known risk: `tsc` cannot see the eval mirror (untyped `.mjs`) and `index.ts` is imported by nothing executable, so the two forwarding lines have zero typecheck coverage. Check: `npm run typecheck` green AND a grep for `config.reasoningEffort` in both `index.ts` and `eval/runner.mjs`.
- Precedent lesson: latch changes are test-heavy (commit `faa98a5`: 124 test lines per 37 code lines). Actual band sizes: Phase 1 t28 carries ~20 asserts, Phase 2 t29 ~14 — both grew past the skeleton's ~8/~6 budget during verification, exactly as the precedent predicts. Budget the suite work first and expect the bands to grow.
- Precedent lesson: duplicated constants need two pins (`tools.mjs:337` behavioural, `:517` literal). The advisor-side list gets exactly that pair in t29.
- Warn message format is contract: pin the exact string, which also pins config's list contents by enumeration.
- Biome formats JSON (`biome.json:20-24`): `npm run lint` must stay green with the example's new key order.
- README table re-pad: column 1 grows to 27 content chars for `specialistReasoningEffort`; all 20 table lines re-align.
- Known risk: suite t-labels are globally unique by convention. t27 was already owned by the dialogue suite's settle band; the config band landed as t28 and the advisor band is t29. Check before adding any band: `grep -ho 't[0-9][0-9]*[a-z]*:' tests/suites/*.mjs | sort -u`.

## Performance Considerations

No added model call and no added latency: the option rides the existing request. The validator is one `Set.has` per new field per config read (once per dispatch); the advisor narrowing is one `Set.has` per fire and per consult leg. The per-round options literal grows by at most one own key. Nothing allocates per turn on a quiet path: the config arms run per dispatch (existing cost), the narrowing runs only on a fire.

## Migration Notes

Not applicable — no persisted schema changes. config.json fields are additive; absent fields reproduce today's behavior exactly (the wire carries no `reasoning` field either way: `openai-completions.js:508` short-circuits an unset option). Rollback is reverting the commit; no data migration exists.

## Pattern References

- `config.ts:287-294` — the `specialistModel`/`specialistSystemPrompt` narrowing arms; the template for the two new arms.
- `config.ts:99-116` — the boolean latch block; the new Set sits beside it and shares the reset surface.
- `plan-turn.ts:26-30` — the conditional-spread omit-key idiom and its comment; copied at both options sites.
- `advisor.ts:47-53` + `tests/suites/tools.mjs:337`, `:517` — the duplicated-constant + two-pin parity pattern for the level lists.
- `tests/suites/advisor.mjs:424-480` — the t26 stub shape (call-counting, context-capturing facade); the t29 capturing stub extends it to the third argument.
- `tests/suites/config.mjs:163-171` (t5) and `tests/suites/advisor.mjs:905-955` (t26c) — the config-band assert idiom the t28 band follows.

## Developer Context

- Input recovery: the invoked path `.rpiv/artifacts/solutions/2026-11-10_11-11-18_reasoning-effort-config.md` does not exist on disk (solutions/ tops out at 2026-11-06). Blueprint proceeded from the ready upstream artifacts for the identical topic: `.rpiv/artifacts/research/2026-11-10_10-35-12_reasoning-effort-config.md` and its FRD `.rpiv/artifacts/discover/2026-11-10_10-33-59_reasoning-effort-config.md`, both read fully with their developer Q/As inherited as fixed decisions.
- Q (checkpoint, seam direction): "The two new config values forward at the I/O layer — inside the advisorArgs literal (index.ts:202-219, the pattern toolsEnabled/maxToolRounds/specialist already use) — not through the planGate core. Confirm or move off?" First answer was "i dont understand"; re-asked in plain words. **A: "Add to advisorArgs"** — two lines in the existing literal, nothing else changes.
- Q (checkpoint, SKILL.md staleness): "SKILL.md:26 says 'All seven config fields' — stale by 13 after this change. Fix inside this change or leave?" **A: "Fix in this change."**
- Q (checkpoint, audit counts): "TECH_DEBT_AUDIT.md:28/:52 say 17 fields; the table has 18 today. Correct alongside or leave as point-in-time?" **A: "Correct alongside."**
- Q (checkpoint, live config.json): "Edit the live personal file too, or leave untouched?" **A: "Leave untouched."**
- Inherited research Q/As recorded as fixed decisions: field names (`reasoningEffort`/`specialistReasoningEffort`); plain string + empty sentinel + `runAdvisor` narrows; both calls with separate fields; unset sends nothing; invalid warns once and sends nothing; one warning per field; host clamps unsupported levels; both docs files updated; eval mirror line added to both copies; example grows with all three specialist keys.
- Step 6.2 verifier availability: the Phase 4 slice-verifier hung twice (frozen at 5 tool calls, abandoned) and a third instance was stopped by the developer; one dispatch ran the verification inline (orchestrator-performed, disclosed at the 6.3 checkpoint and ratified by the developer's approve). The final late-finishing instance confirmed the fences (FR9/FR10/D6 satisfied) and caught two defective AV grep patterns, corrected before lock. Developer process directives recorded for the next blueprint: dispatch verifiers static-only from the start; hard-kill any verifier past 8 minutes and re-dispatch; when a verifier cannot run, say so and let the developer decide (never self-certify); move the cheap gate forward — run `npm test` after Phase 1 lands, not at Phase 4 (Phase 1 was executed under that directive).
- Phase 1 execution note (2026-11-10): applied to the tree per developer directive; all five Phase 1 AV gates green on the corrected first run; post-run corrections — config band renamed t27→t28 (t27 was owned by the dialogue suite), band banner 27→28, latch-pin AV count corrected, one biome format pass on the band. The artifact file itself lost its tail to a 50KB read-truncation during the Phase 1 checkbox write and was reconstructed verbatim from session history the same hour; every section below Phase 4's fences is that reconstruction.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 2 §1 (advisor.ts) | advisor.ts:398-417 | suggestion | code-quality | Edit 5's consult-leg spread evaluates `narrowReasoningLevel(specialist.reasoning)` twice (truthiness test plus value), while edit 7's stated rationale is "Narrowed ONCE per fire" — the same single-evaluation discipline the loop path applies. | Hoist `const specialistLevel = narrowReasoningLevel(specialist.reasoning);` at runConsultLeg entry and spread `...(specialistLevel ? { reasoning: specialistLevel } : {})` | applied: Phase 2 edit 5 now hoists `const specialistLevel = narrowReasoningLevel(specialist.reasoning);` before the call and spreads `...(specialistLevel ? { reasoning: specialistLevel } : {})` |
| code     | Phase 4 (Overview) | <n/a> | suggestion | actionability | The Phase 4 Overview says "example to 10 keys" but §2 says "grows to 11 keys", Current State Analysis says 11, D6 says 11, and the §2 JSON fence carries exactly 11 keys — the Overview's count is stale prose that contradicts the fence an implementer copies. | Change the Phase 4 Overview parenthetical to "example to 11 keys" to match §2 and the fence | applied: Phase 4 Overview now reads "example to 11 keys" |
| coverage | (none) | <n/a> | — | verification-coverage | No findings — every `## Verification Notes` entry (§1-§9) and every research `## Precedents & Lessons` entry (P1-P3, CL1-CL3) lands in a phase Success Criteria bullet or a visible code mirror. | — | n/a — no findings to resolve |

## Plan History

- Phase 1: Config layer — revised per slice-verifier (t28 Door-3 pin moved into ONE withConfig window; validator wrong-typed door now returns DEFAULT_CONFIG[fieldName] with a union-typed fieldName; specialist door pins added), approved; EXECUTED 2026-11-10: applied to the tree per developer directive, all five AV gates green on the corrected first run; post-run corrections — band renamed t27→t28 (t27 was already owned by the dialogue suite's settle band), band banner 27→28, the latch-pin AV bullet's count corrected (five pins use two phrasings: "share the latch" ×1, "share the warn-once latch" ×4), one biome format pass on the band
- Phase 2: Advisor layer — revised per slice-verifier (narrowing hoisted out of the for(;;) loop to once-per-fire beside startedAt; REASONING_LEVELS_LITERAL declaration moved above the t29 band to avoid a TDZ ReferenceError), approved; revised at Step 9 (consult-leg narrowing hoisted to one const per the code reviewer's applied suggestion); EXECUTED 2026-11-10: applied to the tree per developer directive, all five AV gates green on the first run (14/14 t29 asserts, t16=14 and t26=42 unchanged, typecheck clean, one biome format pass on the band)
- Phase 3: Seam and eval mirror — revised per slice-verifier (Success Criteria block added; the first dispatch shipped the fences without their criteria), approved
- Phase 4: Docs and terminal checks — approved; the slice-verifier completed late (two earlier dispatch attempts hung and were abandoned; one pass ran inline) and caught two defective AV grep patterns (case-sensitive "reasoningEffort" cannot match "specialistReasoningEffort"), corrected to case-insensitive "ReasoningEffort" before lock

## References

- Research: `.rpiv/artifacts/research/2026-11-10_10-35-12_reasoning-effort-config.md` (status: ready)
- FRD: `.rpiv/artifacts/discover/2026-11-10_10-33-59_reasoning-effort-config.md` (status: ready)
- Superseded FRD draft: `.rpiv/artifacts/discover/2026-11-10_10-22-22_reasoning-effort-config.md`
- Host anchors: `node_modules/@earendil-works/pi-ai/dist/types.d.ts:18,236`, `dist/providers/model-schema.d.ts:2,79`, `dist/models.js:693-724`, `dist/api/openai-completions.js:508,666-677`, `pi-coding-agent/dist/core/model-runtime.js:452-484,524-525`
- Latch precedent commit: `faa98a5`; eval-mirror birth commit: `06f3552`; example-file precedent commit: `1690b9e`
