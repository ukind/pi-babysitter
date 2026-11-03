---
template_version: 1
date: 2026-11-03T11:54:11+0700
author: Yogiswara Utama
commit: no-commit
branch: no-branch
repository: unknown
topic: "Validation of jarvis-advisor-evolution"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-11-03_09-59-12_jarvis-advisor-evolution.md"
tags: [validation, advisor-turn-gate, triggers, memory, dialogue, tools, specialists, async, eval, slices]
blockers: [{ id: "b1", command: "npm run lint", file: "tests/test.mjs", line: 1681 }]
last_updated: 2026-11-03T11:54:11+0700
---

## Validation Report: jarvis-advisor-evolution

### Implementation Status

Git history unavailable — validation based on file inspection only. All eight phases landed on disk; the code, the pinned tests, the eval gate, and the typecheck are green. The lint gate fails in the final tree.

- ✓ Phase 1: Trigger arms + 1.4.x guard — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 2: Prompt budget — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 3: Project memory — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 4: Dialogue — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 5: Read-only tools — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 6: Specialist consult — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 7: Async fire — Fully implemented; its lint criterion fails in the final tree (finding D1)
- ✓ Phase 8: Eval harness — Fully implemented; its lint criterion fails in the final tree (finding D1)

### Automated Verification Results

- ✓ Whole suite: `npm test` — exit 0, "test.mjs: all green"; all pinned sections t1 through t27 pass
- ✓ Eval: `npm run eval` — exit 0; gate self-test PASS; 6/6 fixtures replayed; 8/8 scores pass; every pinned score row prints PASS (trigger-arms/drift-caught, budget-window/budget-respected, tool-use-script/sandbox-read-applied, consult-aggregation/single-entry-aggregation, allowlist-refusal/allowlist-refused, dialogue-keys/repeats-avoided, dialogue-keys/dialogue-keys, dialogue-keys/advice-adopted)
- ✓ Typecheck: `npm run typecheck` — exit 0
- ✗ Lint: `npm run lint` — exit 1; 10 errors, 3 warnings, 6 infos across 6 plan-declared files (finding D1)
- ✓ Nothing-moved contract: `grep -c "^// ---" tests/test.mjs` returns exactly 37
- ✓ Phase 7 contracts: `continue: true` appears exactly once (plan-turn.ts:47, inside buildCorrection); `advisorInFlight || heldAdvice` appears exactly once (index.ts:202); "async advisor call threw" appears once; `stripAdvisorMarkup(outcome.text)` appears twice (index.ts:216, 245 — blocking record plus async record)
- ✓ Phase 3 contract: `stripAdvisorMarkup(outcome.text)` reaches the record call (index.ts:216)
- ✓ Phase 8 contract: "known-false expectation" appears exactly once (eval/runner.mjs:358)
- ✓ No regressions detected — the untouched pre-existing suite sections stay green alongside the new pins

### Code Review Findings

#### Matches Plan:

- triggers.ts — zero runtime imports; the TriggerSignal, TriggerDecision, parseRiskyTools, triggersArmed, and planTrigger surfaces match the Phase 1 fences, with the fixed error → tokens → pressure → risky-tool order
- plan-turn.ts — planGate, planCommit, planHostSupport, stampDetails, and planSettle all exported per plan; the single `continue: true` sits inside buildCorrection; peer spread precedes the stamped draft
- config.ts — all new fields default-off, narrowed per type against DEFAULT_CONFIG with clampWithWarn and MIN/MAX constants; the live config.json carries none of the new fields
- index.ts:42-72 — the host-support latch checks once, only when enabled with a model, and disables through reportFailure; index.ts:77, 104, 114, 149-160, 183 — per-dispatch thresholds, budgeted buildMessages closure, trigger thunk armed only through triggersArmed, fire-time specialist resolution, and createSandbox all match the plan Regions
- memory.ts, prompt.ts, sandbox.ts — exports match the plan surfaces; .gitignore covers .advisor-memory/ from day one
- .github/workflows/ci.yml — the eval step runs after typecheck, on both node 22.6.0 and 24
- tests/test.mjs — 37 section banners intact; the suite imports exactly the nine sibling modules the banner claims

#### Deviations from Plan:

- D1 (blocking): every phase's "- [x] Lint clean" criterion fails against the final tree. `npm run lint` exits 1 with 10 errors. The errors are: README.md format; memory.ts format; eval/fixtures/budget-window.json, eval/fixtures/consult-aggregation.json, and eval/fixtures/dialogue-keys.json format; organizeImports at index.ts:1, eval/runner.mjs:40, and tests/test.mjs:34; noSelfCompare at tests/test.mjs:1681; noShadowRestrictedNames at tests/test.mjs:1964. All six affected files sit in the plan's own declared write-set, so these are in-delta failures — no pre-existing-debt downgrade applies.
- D2 (non-blocking, comment-only): tests/test.mjs:16 reads "nine sibling modules". The plan prose carried "seven" (Phase 2 Region C2) and the slice-3 handoff carried "eight". The shipped count of nine matches the real import list, so the implementation corrected stale plan arithmetic. Comment-only, no executable line changes.

#### Pattern Conformance:

- ✓ The pure-spoke contract holds: triggers.ts imports nothing; prompt.ts and plan-turn.ts are type-only; guard.ts imports nothing; memory.ts carries only node:fs beside the module plus a type-only pi-ai import; sandbox.ts is the IO adapter over the injected FsLike seam
- ✓ plan* verbs and *Decision discriminated unions on `action` hold across plan-turn.ts, triggers.ts, and sandbox.ts
- Minor observation: the eval summary prints fixturesGreen/files.length, so a deleted fixture shrinks both numbers (5/5 with one removed). The plan's wording ("drops the summary count by one") holds. Acceptable variation, not a deviation

#### Potential Issues:

- tests/test.mjs:1681 — the determinism pin compares two identical call expressions, and biome's noSelfCompare rejects it as written. Restructure as `const key = projectKeyFor("C:\\repo a");` then assert `key === projectKeyFor("C:\\repo a")` — the pin survives, the error does not
- tests/test.mjs:1964 — the local `escape` shadows a known global. Rename it to `parentEscape`
- 3 warnings (eval/runner.mjs:75 optional chain; unused `model` parameters at eval/runner.mjs:176 and tests/test.mjs:2810) do not fail `biome check` today. Clear them while editing the same files

### Manual Testing Required:

Executed during validation, offline — all passed:

1. Default-off parity (P1-P7): the live config.json carries none of the new fields; DEFAULT_CONFIG verified; the untouched suite sections stay green.
2. Fixture delete (P8): removing eval/fixtures/budget-window.json drops the summary to 5/5 fixtures, 7/7 scores, exit 0; the runner still passes; restored to 6/6, 8/8.
3. Expectation edit (P8): changing trigger-arms.json's adviceIncludes to a false string prints `trigger-arms/drift-caught FAIL`, 7/8 scores, exit 1; restored to green.
4. Credential-less eval (P8): `env -i` with an empty environment passes 8/8 — no credentials, no network.
5. CI order (P8, file inspection): the eval step runs after typecheck on node 22.6.0 and 24.

Requires a live host, model, and session — not executable here:

1. P1: `triggerContextPercent: 1` fires before the next cadence; the latch spends once; an `enabled: false` gate stays silent on an old host.
2. P2-P4: `tokenBudget: 2000` on a long session commits and renders; `.advisor-memory/<key>.json` appears after two fires and a delete resets it; the session file shows details {"fire":"1","turn":N} then fire 2; the advisor's next fire sees prior advice; pre-slice-4 entries without details still replay.
3. P5-P6: a live `read_file` round is visible and cited, with no writes; an outside-project path shows as refused in prose with no leak; a live consult carries the --- section; a specialist without credentials lands base-only advice.
4. P7: `asyncMode: true` returns turn_end instantly, lands one entry at settle with the fire-time stamp, keeps an idle agent idle, skips while a call is in flight or held, records memory at settle, and reports one failure when the advisor is unreachable.

### Recommendations:

- Run `npm run format` — it clears 8 of the 10 lint errors (5 format + 3 import-order).
- Hand-fix tests/test.mjs:1681 and tests/test.mjs:1964 per Potential Issues.
- Re-run `/skill:validate`. Estimated total: 10 to 15 minutes.
