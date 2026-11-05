---
date: 2026-11-05T11:04:26+0700
author: Yogiswara Utama
commit: 7cc8e04
branch: main
repository: advisor-turn-gate
topic: "Advisor markup-only hardening: payload role filter + prompt rewrite"
tags: [plans, advisor, prompt-shaping, plan-turn, eval-runner]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-05_10-28-09_advisor-markup-hardening.md
phase_count: 1
phases:
  - { n: 1, title: Role filter and prompt rewrite, files: [prompt.ts, config.ts, tests/test.mjs, eval/runner.mjs, eval/fixtures/budget-window.json, .rpiv/guidance/architecture.md, TECH_DEBT_AUDIT.md], depends_on: [] }
unresolved_phase_count: 0
last_updated: 2026-11-05T11:04:26+0700
last_updated_by: Yogiswara Utama
---

# Advisor Markup-Only Hardening: Payload Role Filter + Prompt Rewrite — Implementation Plan

## Overview

The advisor gate fires with no tool channel, yet the advisor model answers with tool-call markup in plain text because the payload reads as a tool conversation. This plan inserts a pure role-whitelist filter as the first pass of `buildAdvisorMessages` and rewrites `DEFAULT_CONFIG.systemPrompt` to match the narrowed role. The tests, the eval gate, and the stale prose (the guidance lines and the audit row) are repaired in the same phase, so the tree is green at every applied boundary.

## Requirements

- FR1: `DEFAULT_CONFIG.systemPrompt` defines the role as reviewing only the supervised model's reasoning trace and outputs, states that no tools exist, demands plain prose, bans tool-call markup and angle-bracket tool syntax, and keeps the brevity and no-praise directives.
- FR2: `buildAdvisorMessages` keeps messages with role `user` or `assistant` and drops role `system` and `toolResult`. No config toggle.
- FR3: The filter runs as the FIRST pipeline pass, before `applyTokenBudget`, `ensureUserTail`, and digest insertion, so the fold sizes the filtered payload.
- FR4: The filter is an identity when no `user` or `assistant` message survives: the original array returns, never an empty one.
- FR5: `planCommit` and `planSettle` markup-only notify strings stay byte-identical (`plan-turn.ts:185`, `plan-turn.ts:286`).
- FR6: Tests pin the filter roles, both identity doors, the pipeline order, and the new default prompt text, offline, with no live model calls.

## Current State Analysis

`buildAdvisorMessages` (`prompt.ts:186-200`) composes three passes: `stripToolDeclarations` (`prompt.ts:45-66`) removes `toolsAdded`/`toolsRemoved` from system messages, `applyTokenBudget` (`prompt.ts:104-158`) folds old non-system messages under a budget, and `ensureUserTail` (`prompt.ts:160-167`) appends the nudge after an assistant tail. The digest joins after the pipeline (`prompt.ts:192-195`). `DEFAULT_CONFIG.systemPrompt` (`config.ts:50-58`) governs live behavior because `config.json` omits the key (`config.ts:223-226`).

### Key Discoveries

- The running pi-bolt host passes `role: "system"` through into `event.context.llmMessages` verbatim (`dist/core/messages.js:111` release 1.4.0 parity). The persisted prompt-state system messages carry the executor's prompt sections and `toolsAdded`/`toolsRemoved` deltas. The npm copies drop system and must never be cited for host-behavior claims.
- The filter chokepoint inherits 13 call sites with zero caller edits: production `index.ts:109`, eval `runner.mjs:288`, 11 test sites.
- The digest is `role: "system"` (`memory.ts:189-198`) and joins after the pipeline, so it is never a filter input. The `repeats-avoided` score still finds it (`runner.mjs:111-120`).
- The `allowlist-refused` score inspects `toolResult` messages that `runAdvisor` appends for its own sandbox refusals — after the filter. No third eval break. Verified against `eval/fixtures/allowlist-refusal.json` and the `runAdvisor` tool loop.
- `tests/test.mjs` pins `DEFAULT_CONFIG.systemPrompt` by substring only (`:401-402`, `/no tools/`, `/text only/`). No full-string pin exists, so the rewrite breaks nothing by itself.
- Verified surgery map against live lines: t10 `:665-666` pass vacuously after the filter (the assert runs on a user message that never carried the field), t10 `:667` flips (`"base"` → `"do it"`), t10 `:669` flips (`4` → `3`), t10 `:670` crashes (`out[3]` becomes undefined). t22 `:1634` flips (`3` → `2`). t22 `:1653-1657` passes vacuously (`budgeted[0]` becomes the user message). t7b (`:393-404`), t9 (`:614`), t23 (`:1812-1861`), t27 (`:3057-3070`), and the direct `applyTokenBudget`/`stripToolDeclarations` pins (`:671-678`, `:1559-1568`) stay green.
- Fold arithmetic for the re-scoped `budget-window` fixture: filtered total is about 618 estimated tokens against a 500 budget. The fold takes `u1` and `a1` (two folds), and `u2`, `a2`, and the tail survive. `keptTexts` must therefore cite `a2` and the tail only.
- The stale-prose surface outside source is three lines: `.rpiv/guidance/architecture.md:3` (the overview sentence promises "the projected transcript") and `:15` (the spoke map), plus `TECH_DEBT_AUDIT.md:104` ("The full transcript ships on every gate. Deliberate." — falsified by FR2). `TECH_DEBT_AUDIT.md:100` keeps describing `stripToolDeclarations` truthfully because the strip survives as the floor-path defense.

## Desired End State

A mixed transcript shapes to a conversation that reads as prose review, not tool use:

```ts
keepAdvisorRoles([
  { role: "system", content: "executor prompt", toolsAdded: [...], timestamp: 1 },
  { role: "user", content: "do it", timestamp: 2 },
  { role: "toolResult", content: [], timestamp: 3 },
  { role: "assistant", content: [{ type: "text", text: "thinking" }], timestamp: 4 },
]);
// => [{ role: "user", content: "do it", timestamp: 2 },
//     { role: "assistant", content: [{ type: "text", text: "thinking" }], timestamp: 4 }]
```

`buildAdvisorMessages` returns only `user` and `assistant` payloads plus the nudge, and the digest when armed. A system-and-toolResult-only transcript returns the original array, so the strip still removes its deltas downstream. The eval `budget-respected` score proves the drop in CI: the fixture ships system texts and one `toolResult` in its input, and the score asserts their absence plus survivor presence on the built payload.

## What We're NOT Doing

- No config toggle for the filter and no new `config.json` field.
- No husk-path change, no sanitize-and-commit, no corrective retry; the FR5 notify strings stay byte-identical.
- No strip-dialect widening in `advisor.ts` (the parked fallback lever).
- No specialist-leg payload change (`runConsultLeg` untouched).
- No `toolChoice` plumbing through the facade.
- No host-package change of any kind.
- No edit to `plan-turn.ts`, `advisor.ts`, `guard.ts`, `memory.ts`, or `index.ts`.

## Decisions

### D1 — Filter shape: clone the in-repo pure-transform convention

Ambiguity: which shape for the new filter. Explored: (a) bare `filter` — allocates on every call, no identity promise, no precedent; (b) identity door + `filter` + floor — the repo convention (`prompt.ts:45-66`, `prompt.ts:104-109`, `memory.ts:98-101`, `advisor.ts:289-290`, doc "Identity when clean is EXACT" at `advisor.ts:280`). Decision: (b), exported as `keepAdvisorRoles` with a private `isAdvisorRole` predicate. The `every` door returns clean transcripts unchanged with no allocation. The FR4 floor returns the original array when nothing survives. Directional confirm run at Step 4; the developer routed it to the advisor model, which confirmed with refinements (D2 and D4).

### D2 — Plain boolean predicate, not a type guard

The floor returns the unfiltered array, so the return type must stay `Message[]`. A type guard would force naming union members pi-ai may not export, for no gain. Advisor refinement, adopted.

### D3 — Filter-first pipeline order

The filter is pass zero: `ensureUserTail(applyTokenBudget(stripToolDeclarations(keepAdvisorRoles(llmMessages)), tokenBudget))`. The fold sizes the filtered payload (FR3). A filter-last order would fold against system bulk that then gets dropped, wasting budget on invisible messages. Pinned by the t22 no-marker lead assertion.

### D4 — The strip stays; it is the floor-path defense

After filter-first, system messages reach the strip only through the FR4 floor (the original array with nothing dropped). There the strip still removes `toolsAdded`/`toolsRemoved`, so the strip is load-bearing, not dead. Its doc comment (`prompt.ts:37-43`) is re-scoped to say exactly that, and t22 pins the path. Advisor refinement, adopted.

### D5 — Prompt rewrite keeps the pinned substrings

The new `DEFAULT_CONFIG.systemPrompt` keeps `/no tools/` and `/text only/` verbatim (t7b pins at `tests/test.mjs:401-402`) and adds the role scoping ("reasoning trace", "outputs") that t7b pins as new substrings. Brevity, no-praise, and the angle-bracket ban carry over unchanged.

### D6 — Test surgery replaces vacuous survivors with real pins

Flip t10 `:667` and `:669`, crash-fix t10 `:670`, flip t22 `:1634`. Replace the vacuous t10 `:665-666` and t22 `:1653-1657` asserts with pipeline-order pins: the t22 replacement proves the fold sizes the filtered payload (no marker leads) and that the floor path still strips deltas. New band t10b (after t10, the `t7b`/`t15b` letter-suffix convention) pins roles, both doors by reference, and the empty transcript. t7b gains the two new substring pins.

### D7 — Eval re-scope proves the drop

`budget-respected` keeps its name (score names are contract) and re-scopes to: every built message is `user` or `assistant`, the fixture's `systemTexts` are absent from the built payload, and `keptTexts` survivors are present, alongside the existing `markerRan` and budget bound. The fixture keeps the system texts in its input so the replay proves the drop, and gains one `toolResult` entry mid-payload so both drops are proven. Unfixed, the runner exits 1 (`runner.mjs:403`).

### D8 — Stale-prose re-scope (guidance lines plus audit row)

`.rpiv/guidance/architecture.md:15` and the `:3` overview sentence gain the role filter. `TECH_DEBT_AUDIT.md:104` ("The full transcript ships on every gate. Deliberate.") is reworded to record the narrowed payload as the new deliberate state: early decisions still reach the advisor through the kept user and assistant turns. `TECH_DEBT_AUDIT.md:100` stays accurate under D4 and is untouched.

### D9 — One phase

Six files, one concern. Cutting tests into a later phase lands the earlier phase red. The single phase keeps every applied state green once all hunks land.

## Phase 1: Role filter and prompt rewrite

### Overview

Delivers the role filter, the prompt rewrite, the test surgery with net-new pins, the eval re-scope, and the guidance re-scope as one vertical change. Depends on nothing; nothing runs in parallel with it.

### Changes Required:

#### 1. prompt.ts

**File**: prompt.ts

**Changes**: MODIFY — header re-scope (`:5-8`), new `isAdvisorRole` predicate and `keepAdvisorRoles` filter (inserted before the strip block, mirroring pipeline order), strip doc re-scope (`:37-43`), fold invariant re-scope (`:95`), composition doc re-scope (`:170-177`) and the filter-first insert (`:191`).

```ts
// A. Header doc (:5-8) — replace the two-sentence scope with:
 * The advisor receives the executor's reasoning trace only: the role filter keeps
 * user and assistant messages and drops the system replay chains and toolResult
 * entries that would read as a tool-using conversation. A later pass strips the
 * tool declarations that would let it call tools. Shapes are copied from
 * `@juicesharp/rpiv-advisor/advisor/context.ts:31-56`; nothing is imported.

// B. NEW — insert after the ADVISOR_NUDGE const, before hasToolDeclarations:
/** True when a message is part of the reasoning trace the advisor is meant to read. */
function isAdvisorRole(message: Message): boolean {
  return message.role === "user" || message.role === "assistant";
}

/**
 * Keep only the reasoning trace: user and assistant messages (FR2).
 *
 * The executor's transcript replays its own system prompt and tool loadout as system
 * messages, and toolResult chains read as a tool-using conversation. Both are the
 * mimicry substrate behind the markup-only failure: a payload that looks like a tool
 * conversation invites a tool-trained model to answer with tool-call markup as plain
 * text. The whitelist form also drops any future role by default. No config toggle:
 * the advisor reads the trace and the outputs, nothing else (FRD role note).
 *
 * Two identity doors (FR4):
 *   1. An all-keep transcript returns unchanged — the SAME array, no allocation.
 *   2. A transcript where nothing survives returns the ORIGINAL array — an empty
 *      payload must never reach the provider, and the strip downstream stays
 *      load-bearing on exactly this path (the returned system messages carry the
 *      tool deltas it removes). Pinned by t10b and the t22 floor-path pins.
 */
export function keepAdvisorRoles(messages: Message[]): Message[] {
  if (messages.every(isAdvisorRole)) return messages;
  const kept = messages.filter(isAdvisorRole);
  return kept.length > 0 ? kept : messages;
}

// C. stripToolDeclarations doc (:37-43) — append before the closing */:
 * In the shaped pipeline this pass now serves the identity floor of `keepAdvisorRoles`:
 * only a payload where no user or assistant message survives still carries system
 * messages, and those are exactly the ones the floor returns untouched. Pinned
 * through the floor path by t22; the filter's floor door by t10b.

// D. applyTokenBudget invariant 2 (:95) — replace the old invariant-2 line with:
 *   2. Every system message survives. The role filter upstream means the normal
 *      pipeline payload carries none; the survivors are the floor path's original
 *      systems, and those must never fold.

// E. buildAdvisorMessages doc (:172-174) — replace the order sentence with:
 * Pipeline order is load-bearing (the settled window decision): the role filter runs
 * first so the fold sizes the filtered payload, the strip follows (it is load-bearing
 * only on the filter's identity floor, where system messages survive), and the tail
 * guarantee runs last so even a folded context ends on a user message.
// and in the same doc block, change "the historical behavior, pinned by t10."
// to "the historical behavior, pinned by t22." (t22 :1628-1634 owns the one-arg pin).

// F. The insert (:191) — replace the single shaped line with:
  const shaped = ensureUserTail(
    applyTokenBudget(stripToolDeclarations(keepAdvisorRoles(llmMessages)), tokenBudget),
  );
```

#### 1. config.ts

**File**: config.ts

**Changes**: MODIFY — rewrite `DEFAULT_CONFIG.systemPrompt` (`:50-58`), keeping `/no tools/` and `/text only/`.

```ts
  systemPrompt:
    "You are a senior engineer reviewing the reasoning trace and outputs of another " +
    "agent's work in progress. That transcript is all you receive; find what is going " +
    "wrong or about to go wrong, and say so in a few direct sentences. Name the file " +
    "and the line when you can. Do not restate the task. Do not praise. If the work " +
    "is on track, say so briefly and stop. " +
    "You have no tools and cannot call any. Reply in text only: never write " +
    "tool-call markup, angle-bracket tool syntax, or anything that imitates a " +
    "tool call. Supervise the reasoning trace in plain prose.",
```

#### 1. tests/test.mjs

**File**: tests/test.mjs

**Changes**: MODIFY — add `keepAdvisorRoles` to the prompt import (`:85-93`); t10 surgery (`:651-670`) and re-scope banner; new t10b band after t10; t7b gains two substring pins (after `:402`); t22 `:1634` flip and `:1646-1657` replacement with the filter-before-fold and floor-path strip pins.

```js
// Import (:85-93): insert one line into the "../prompt.ts" import block, between
// estimateMessageTokens and stripToolDeclarations:
  keepAdvisorRoles,

// t7b (after :402): insert after the "text only" assert:
assert(
  /reasoning trace/.test(DEFAULT_CONFIG.systemPrompt),
  "t7b: the code default scopes the role to the reasoning trace",
);
assert(
  /outputs/.test(DEFAULT_CONFIG.systemPrompt),
  "t7b: the code default scopes the role to the outputs",
);

// t10 banner (:651) — replace:
// --- 10. prompt assembly: roles filtered first, tool deltas stripped, user tail guaranteed.

// t10 body (:653-670) — replace from "const withDeltas = [" through the ADVISOR_NUDGE
// assert; the enclosing block braces and the :671-687 direct pins stay untouched:
  const withNoise = [
    {
      role: "system",
      content: "base",
      toolsAdded: [{ name: "read" }],
      toolsRemoved: [],
      timestamp: 1,
    },
    { role: "user", content: "do it", timestamp: 2 },
    { role: "toolResult", content: [], timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: "thinking" }], timestamp: 4 },
  ];
  const out = buildAdvisorMessages(withNoise);
  assert(
    out.length === 3,
    "t10: the filter drops the system replay and the toolResult, then the nudge appends",
  );
  assert(out[0].content === "do it", "t10: the user message leads the filtered payload");
  assert(
    out[1].content[0].text === "thinking",
    "t10: the assistant message survives in place",
  );
  assert(out[out.length - 1].role === "user", "t10: a user tail is guaranteed");
  assert(out[2].content[0].text === ADVISOR_NUDGE, "t10: the appended message is the nudge");

// t10b — NEW band, after t10's closing brace, before the t11 banner:
// --- 10b. the role filter: the whitelist, both identity doors, by reference (FR2/FR4).
{
  const mixed = [
    { role: "system", content: "s", timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "u" }], timestamp: 2 },
    { role: "toolResult", content: [], timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 4 },
  ];
  const kept = keepAdvisorRoles(mixed);
  assert(kept.length === 2, "t10b: only the user and assistant messages survive");
  assert(kept[0] === mixed[1] && kept[1] === mixed[3], "t10b: survivors keep their references");
  const clean = [
    { role: "user", content: [{ type: "text", text: "u" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 2 },
  ];
  assert(
    keepAdvisorRoles(clean) === clean,
    "t10b: an all-keep transcript returns the same array",
  );
  const floor = [
    { role: "system", content: "s", timestamp: 1 },
    { role: "toolResult", content: [], timestamp: 2 },
  ];
  assert(
    keepAdvisorRoles(floor) === floor,
    "t10b: nothing survives, so the original array returns",
  );
  const emptyArr = [];
  assert(keepAdvisorRoles(emptyArr) === emptyArr, "t10b: an empty transcript is the identity");
}

// t22 (:1634) — replace the length assert with:
  assert(
    plain.length === 2,
    "t22: the system is filtered out, so the payload is the assistant plus the nudge",
  );

// t22 (:1646-1657) — replace the fatDelta block with:
  // The filter runs before the fold: the huge system never counts toward the budget,
  // so no marker leads and the payload fits without folding.
  const bigSystem = m("system", "s".repeat(4000), 1);
  const ordered = buildAdvisorMessages([bigSystem, m("user", "u", 2), m("assistant", "a", 3)], 50);
  assert(
    ordered[0].content[0].text === "u",
    "t22: no fold marker leads — the fold sized the filtered payload",
  );
  assert(
    ordered.length === 3,
    "t22: the filtered payload fits the budget, so only the nudge appended",
  );

  // The strip stays load-bearing on the filter's identity floor: a payload where no
  // user or assistant message survives returns from the filter with deltas intact.
  const floored = buildAdvisorMessages(
    [
      { role: "system", content: "s", toolsAdded: [{ name: "x".repeat(400) }], timestamp: 1 },
      { role: "toolResult", content: [], timestamp: 2 },
    ],
    10000,
  );
  assert(
    floored[0].toolsAdded === undefined && floored[0].content === "s",
    "t22: the floor path still strips the deltas and keeps the prompt text",
  );
  assert(
    floored.length === 2,
    "t22: the floor path adds no nudge after a toolResult tail",
  );
```

#### 1. eval/runner.mjs

**File**: eval/runner.mjs

**Changes**: MODIFY — re-scope the `budget-respected` score (`:77-88`): `narrowed` role check, `systemsDropped` absence check, `survivorsKept` presence check, existing `markerRan` and budget bound kept. The score name stays contract.

```js
  "budget-respected": (replay, fixture) => {
    const built = replay.builtMessages ?? [];
    const total = built.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    const markerRan = built.some((message) =>
      messageText(message).startsWith(BUDGET_FOLD_MARKER_PREFIX),
    );
    const narrowed = built.every(
      (message) => message.role === "user" || message.role === "assistant",
    );
    const survivorsKept = fixture.keptTexts.every((text) =>
      built.some((message) => messageText(message).includes(text)),
    );
    const systemsDropped = fixture.systemTexts.every(
      (text) => !built.some((message) => messageText(message).includes(text)),
    );
    return (
      markerRan &&
      narrowed &&
      survivorsKept &&
      systemsDropped &&
      total <= fixture.config.tokenBudget + MARKER_SLACK
    );
  },
```

#### 1. eval/fixtures/budget-window.json

**File**: eval/fixtures/budget-window.json

**Changes**: MODIFY — add one mid-payload `toolResult` entry and the `keptTexts` survivor list; system texts stay in the input so the replay proves the drop.

```json
// top level, after the "systemTexts" line:
  "keptTexts": ["a2: the gate now nests", "Latest note: the retry loop stalls"],

// turns[0].llmMessages — insert between the a2 assistant entry (timestamp 6) and the
// "Latest note" user entry (timestamp 7):
        {
          "role": "toolResult",
          "content": [],
          "timestamp": 6
        },
```

#### 1. .rpiv/guidance/architecture.md

**File**: .rpiv/guidance/architecture.md

**Changes**: MODIFY — the prompt.ts spoke line gains the role filter (`:15`) and the overview sentence (`:3`) stops promising the full transcript.

```md
// line 3 — inside the Project Overview paragraph, replace the middle clause:
- Every N completed turns it sends the projected transcript to an advisor model (`tools: []`)
+ Every N completed turns it sends the transcript's user and assistant turns to an advisor model (`tools: []`)

// line 15:
                    ├─ prompt.ts     # context shaper: filter roles, strip tool deltas, ensure user tail (zero imports)
```

#### 1. TECH_DEBT_AUDIT.md

**File**: TECH_DEBT_AUDIT.md

**Changes**: MODIFY — the :104 audit row records the narrowed payload as the new deliberate state (Step 9, applied reviewer concern).

```md
// :104 — replace the row with:
- **The advisor payload narrows to user and assistant turns (prompt.ts, keepAdvisorRoles).** Deliberate (FR1/FR2): the system replay chains and toolResult entries read as a tool conversation and fed the markup-only failure. Early decisions still reach the advisor through the kept user and assistant turns.
```

### Success Criteria:
#### Automated Verification:
- [x] Unit suite passes: `npm test`
- [x] Eval gate passes: `npm run eval` exits 0 and prints `eval: budget-window/budget-respected PASS`
- [x] Lint passes: `npm run lint`
- [x] Typecheck passes: `npm run typecheck`
- [x] Contract files untouched: `git diff --quiet -- plan-turn.ts advisor.ts index.ts guard.ts memory.ts triggers.ts sandbox.ts report.ts` exits 0
- [x] Audit row and guidance lines updated: `grep -c "full transcript ships" TECH_DEBT_AUDIT.md` returns 0 and `grep -c "projected transcript" .rpiv/guidance/architecture.md` returns 0

#### Manual Verification:
- [ ] The rewritten `DEFAULT_CONFIG.systemPrompt` reads as the role statement you want the advisor to see
- [ ] `.rpiv/guidance/architecture.md:15` describes prompt.ts accurately after the change

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 | TECH_DEBT_AUDIT.md:104 | concern | codebase-fit | The stale-prose sweep claims `.rpiv/guidance/architecture.md:15` is "the only stale prose line outside source" and vets only `TECH_DEBT_AUDIT.md:100`, but :104 — "The full transcript ships on every gate (prompt.ts:77-81). Deliberate." — is falsified by the FR2 role filter this plan ships, so the tree lands with a doc contradicting the new payload contract while the artifact records the sweep as "resolved: one guidance line". | Amend D8/Key Discoveries to a two-line stale surface and either add a `TECH_DEBT_AUDIT.md:104` reword to Phase 1 or record that entry explicitly as accepted staleness. | applied: `TECH_DEBT_AUDIT.md:104` reworded to record the narrowed payload as deliberate; Phase 1 gains the file as its 7th target; D8 and Key Discoveries name the three-line stale surface (guidance `:3`+`:15`, audit `:104`). |
| code | Phase 1 §1 (prompt.ts) | tests/test.mjs:676-678 | suggestion | code-quality | Hunk C's appended strip doc claims the floor-serving behavior is "Pinned directly by t10", but after the D6 surgery t10's only direct `stripToolDeclarations` pin is the identity door (`stripToolDeclarations(noDeltas) === noDeltas`) — delta removal on the floor is exercised only through t22's `buildAdvisorMessages` pin and t10b pins the filter's own floor door. | Reword the doc line to "pinned through the floor path by t22, the filter's floor door by t10b" to match D4's own attribution. | applied: hunk C now reads "Pinned through the floor path by t22; the filter's floor door by t10b." |
| code | Phase 1 §1 (.rpiv/guidance/architecture.md) | .rpiv/guidance/architecture.md:3 | suggestion | codebase-fit | Line 3 of the same file being edited says the gate "sends the projected transcript to an advisor model", which is no longer accurate under the user/assistant whitelist, yet the hunk re-scopes only :15 and D8 calls :15 "the only stale prose line". | Extend the D8 hunk to also gain the role filter into the :3 overview sentence. | applied: the guidance hunk now covers `:3` and `:15`; a Success Criterion greps both stale phrases to zero. |
| code | Phase 1 (Verification Notes) | eval/runner.mjs:153 | suggestion | actionability | The note cites `runner.mjs:139-145` for the startup gate self-test, but `selfTestGate` lives at :149-155 — :139-145 is `messageText`/`evaluateScore`, so the verification pointer lands on the wrong functions. | Correct the pointer to `runner.mjs:153-156`. | applied: Verification Notes now cites `runner.mjs:153-156` (verified: `selfTestGate` declares at :153). |
| code | Phase 1 §1 (tests/test.mjs) | tests/test.mjs:652 | suggestion | actionability | The t10 surgery heading ranges the replacement at ":652-670", but line 652 is the band's opening brace `{` that the same heading says "stays untouched" — the replacement content actually begins at :653 (`const withDeltas = [`). | Re-range the heading to ":653-670" so the range and the brace exclusion agree. | applied: the fence comment now reads ":653-670"; line 652 (the block brace) is outside the range. |

_Step 8 coverage review returned no findings: all seven `## Verification Notes` entries land in the phase's Success Criteria or as visible code mirrors._

## Ordering Constraints

Single phase. The seven hunks land as one unit because the test surgery asserts the filter's behavior and the eval gate asserts the fixture's drop. Whole-repo gates (`npm test`, `npm run eval`, `npm run lint`, `npm run typecheck`) run at the end of the phase and are re-run by `validate` over the finished plan.

## Verification Notes

- `npm test` exits 0 with the new pins; the surgery map is verified to the line against `7cc8e04`.
- `npm run eval` exits 0; `budget-respected` proves the drop. The runner self-tests its gate on startup (`runner.mjs:153-156`).
- `npm run lint` (biome check) and `npm run typecheck` (tsc --noEmit) exit clean.
- Byte-identity checks: `plan-turn.ts:185` and `plan-turn.ts:286` notify strings unchanged; pins at `tests/test.mjs:614` and `:3068` pass untouched.
- Survivor pins stay green without modification: t7b `:393-404`, t9 `:614`, t23 `:1812-1861`, t27 `:3057-3070`, direct `applyTokenBudget` pins `:1559-1568`, direct `stripToolDeclarations` pin `:671-678`.
- Precedent lesson (from memory): success-criteria grep counts can mislead because grep counts lines, not asserts. The criteria below avoid raw grep counts and pin behavior by band names instead.
- Live efficacy (the FRD's ratified check) is a deployment-time observation and is NOT a phase gate: telemetry is UI-gated (`report.ts:30-37`).

## Performance Considerations

The narrowed payload strictly reduces estimated tokens per fire. The `every` door keeps clean transcripts allocation-free. The re-scoped fixture keeps the fold armed: the filtered total (about 618 estimated tokens) still exceeds the 500 budget, so `markerRan` remains a meaningful assertion.

## Migration Notes

Not applicable — no persisted schema or stored data moves. `config.json` gains no field, so existing config files load unchanged.

## Pattern References

- `prompt.ts:31-66` — private predicate + identity door + transform: the template `keepAdvisorRoles` clones.
- `prompt.ts:104-109` — multi-door identity form (`applyTokenBudget`).
- `advisor.ts:280-296` — "Identity when clean is EXACT" doc convention.
- `tests/test.mjs:1559-1568` — strict `===` identity pins, reference-captured.
- `tests/test.mjs:393-404` — substring pins for prose, declaration-free lone-block avoidance.
- `tests/test.mjs:1543-1545` — band banner cross-referencing prior pins (the re-pin style).
- `.rpiv/artifacts/plans/2026-11-03_09-59-12_jarvis-advisor-evolution.md:689-801` — the 06f3552 composition-insert bookkeeping: banner reword, doc re-scope, in-slice pins.

## Developer Context

- Step 4 directional confirm: follow the pure-transform convention (`keepAdvisorRoles`, `every` door, private predicate, FR4 floor)? Developer routed to the advisor model. Advisor verdict: confirm, with refinements D2 (boolean predicate, not a type guard) and D4 (strip stays as floor-path defense, doc re-scope, pinned), plus two pins the plan must carry (filter-before-fold and strip-on-floor) — both landed in D6. Advisor verification requests: allowlist fixture toolResult provenance (resolved: `runAdvisor`-appended, no third eval break) and stale-prose sweep (resolved: one guidance line).
- Step 4 design summary: developer edited the file count from 5 to 6 (guidance file added) and approved.
- Step 5 decomposition: single slice proposed (advisor refinement: split tests land the slice red) and approved.

## Plan History

- Phase 1: Role filter and prompt rewrite — approved as generated

## References

- `.rpiv/artifacts/solutions/2026-11-05_10-28-09_advisor-markup-hardening.md` — parent solution analysis; the surgery map and rejected options.
- `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` — the FRD; root cause, FR1-FR6, recorded decisions.
- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` — upstream research; its surgery map is superseded by the parent solution where the two differ (t10 `:665`, `:670`).
- `prompt.ts:186-200` — the composition and the filter's slot.
- `config.ts:50-58`, `config.ts:223-226` — the prompt constant and its live fallback.
- `eval/runner.mjs:83-95`, `eval/runner.mjs:403` + `eval/fixtures/budget-window.json` — the CI gate and its fixture.
