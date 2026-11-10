---
template_version: 1
date: 2026-11-10T15:44:25+0700
author: Yogiswara Utama
commit: 8fc4e9b
branch: main
repository: advisor-turn-gate
topic: "Validation of Reasoning effort config for the advisor and specialist calls"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-10_11-22-50_reasoning-effort-config.md"
tags: [validation, plan, config, advisor, specialist, reasoning-effort, warn-latch, eval-mirror, docs]
last_updated: 2026-11-10T16:02:05+0700
---

## Validation Report: Reasoning effort config for the advisor and specialist calls

### Implementation Status

- ✓ Phase 1: Config layer — Fully implemented
- ✓ Phase 2: Advisor layer — Fully implemented
- ✓ Phase 3: Seam and eval mirror — Fully implemented
- ✓ Phase 4: Docs and terminal checks — Fully implemented

### Automated Verification Results

- ✓ Phase 1 suite: `npm test` — all green; 560 PASS / 0 FAIL (base 4af3ccb measured: 526 / 0)
- ✓ Phase 1 shared-latch pins: `npm test 2>&1 | grep -cE "share the (warn-once )?latch"` — 5, as pinned
- ✓ Phase 1 per-field independence: `npm test 2>&1 | grep -c "t28: two unaccepted fields warn once each"` — 1
- ✓ Phase 1 typecheck: `npm run typecheck` — exit 0, no output
- ✓ Phase 1 lint: `npx biome check config.ts tests/suites/config.mjs` — 2 files, no fixes
- ✓ Phase 2 suite: `npm test` — all green; t29 band 14/14 asserts
- ✓ Phase 2 omit-key contract: `npm test 2>&1 | grep -c "NO reasoning own key"` — 2, as pinned
- ✓ Phase 2 t16/t26 pins unchanged: `grep -c "t16:"` = 14, `grep -c "t26:"` = 42 — MEASURED at base 4af3ccb (detached worktree, suite output): 14 / 42, identical at HEAD
- ✓ Phase 2 typecheck: `npm run typecheck` — exit 0
- ✓ Phase 2 lint: `npx biome check advisor.ts tests/suites/advisor.mjs` — 2 files, no fixes
- ✓ Phase 3 seam forwarding: `grep -c "config.reasoningEffort" index.ts` = 1, `grep -c "config.specialistReasoningEffort" index.ts` = 1
- ✓ Phase 3 eval mirror: `grep -c "config.reasoningEffort" eval/runner.mjs` = 1, `grep -c "config.specialistReasoningEffort" eval/runner.mjs` = 1
- ✓ Phase 3 fixtures untouched: `git diff 4af3ccb..HEAD --stat -- eval/fixtures/` — empty
- ✓ Phase 3 eval gate: `npm run eval` — 6/6 fixtures, 8/8 scores; table row-for-row identical to the base-commit run
- ✓ Phase 3 typecheck: `npm run typecheck` — exit 0
- ✓ Phase 3 lint: `npx biome check index.ts eval/runner.mjs` — 2 files, no fixes
- ✓ Phase 4 README rows: `grep -ci "ReasoningEffort" README.md` — 2
- ✓ Phase 4 third-door prose: `grep -c "warns once for that field" README.md` — 1
- ✓ Phase 4 example keys: `grep -ci "ReasoningEffort" config.example.json` — 2
- ✓ Phase 4 example validity: `node -e "const c=require('./config.example.json');if(Object.keys(c).length!==11)process.exit(1)"` — exit 0
- ✓ Phase 4 SKILL.md count-neutral: `grep -c "All config fields live in" .agents/skills/advisor-turn-gate/SKILL.md` — 1
- ✓ Phase 4 audit counts: `grep -c "documents 20 config fields" TECH_DEBT_AUDIT.md` = 1, `grep -c "all 20 fields" TECH_DEBT_AUDIT.md` = 1
- ✓ Phase 4 whole-plan suite: `npm test` — all green
- ✓ Phase 4 whole-plan typecheck: `npm run typecheck` — exit 0
- ✓ Phase 4 whole-plan lint: `npm run lint` — 44 files, no fixes
- ✓ Phase 4 whole-plan eval: `npm run eval` — 6/6 fixtures, 8/8 scores
- ✓ No regressions detected — base 4af3ccb measured: 526 tests / 526 pass / 0 fail; delta -> 560 / 560 / 0

### Code Review Findings

#### Matches Plan:

- config.ts:44,46 — `reasoningEffort` and `specialistReasoningEffort` appended to `AdvisorGateConfig` after `asyncMode`, plain `string`, exactly as D1 specifies.
- config.ts:84,85 — both defaults are `""` in `DEFAULT_CONFIG`, so today's behavior is the default.
- config.ts:116 — `REASONING_LEVELS` is the six-level `as const` tuple; `"off"` is absent, per D3.
- config.ts:132 — `reasoningWarned` is a second `Set<string>` structure, not a re-key of `configWarned` (config.ts:119); the five shared-latch pins stay green untouched.
- config.ts:148-151 — `resetWarnOnceForTest` clears both latches, so a warning tripped in one fixture window cannot suppress the next.
- config.ts:193-210 — `reasoningLevelOrUnset` implements the three doors in order (wrong-typed to per-field default, empty to unset, out-of-set to warn once and `""`), with the union-typed `fieldName` parameter.
- config.ts:368-371 — the two narrowing arms sit after the `asyncMode` arm in the `loadConfig` return literal.
- advisor.ts:6 — `ThinkingLevel` joins the type-only import; no runtime pi-ai import was added (zero runtime npm dependencies holds).
- advisor.ts:33 — `CompleteSimpleFn` options retype `reasoning?: string` to `reasoning?: ThinkingLevel` (FR8), closing the laundering hole the `as CompleteSimpleFn` cast exposed.
- advisor.ts:76-80 — the advisor-side six-level tuple, typed `readonly ThinkingLevel[]`.
- advisor.ts:95-98 — `narrowReasoningLevel` returns `undefined` for `undefined`, `""`, and out-of-list values.
- advisor.ts:171 — `SpecialistConfig.reasoning?: string`; advisor.ts:535 — `runAdvisor` params gain the same field.
- advisor.ts:443 — the consult leg narrows ONCE into `const specialistLevel` (the Step 9 reviewer's applied suggestion landed).
- advisor.ts:463 — the consult-leg options literal uses the conditional spread, so no `reasoning` key exists when unset.
- advisor.ts:566 — `const reasoning = narrowReasoningLevel(params.reasoning)` is hoisted beside `startedAt`, before the `for(;;)` loop — once per fire, not per round.
- advisor.ts:591 — the per-round options literal spreads `...(reasoning ? { reasoning } : {})`, the `plan-turn.ts:26-30` omit-key idiom.
- index.ts:194 — the fire-time specialist literal carries `reasoning: config.specialistReasoningEffort` inside the `specialistResolution.ok` gate.
- index.ts:225 — `advisorArgs` carries `reasoning: config.reasoningEffort` after `maxToolRounds`; the value is read at the I/O layer, never threaded through `planGate` (D4).
- index.ts:205,245,275 — SEAM CLOSURE (the one link no automated gate executes): the single `advisorArgs` literal at :205 is consumed by BOTH fire paths — `void runAdvisor(advisorArgs)` at :245 (async) and `await runAdvisor(advisorArgs)` at :275 (blocking). No swapped or orphaned literal exists; the `reasoning` slot (:225) and the `specialist` slot (:227) reach `runAdvisor` in both modes.
- eval/runner.mjs:285,339 — the two mirror lines match the index.ts seam; the blind `DEFAULT_CONFIG` spread forwards the `""` sentinel, so fixtures stay byte-identical.
- README.md:21-23 — the third-door prose sentence landed, and the clamp latch is disambiguated as "one-time warning per process".
- README.md:45-46 — both new rows in interface-declaration order; all 22 table lines share one pipe shape (columns at 0/30/54/225), so the re-pad is uniform.
- config.example.json — 11 keys in interface order; both prompt values are byte-identical to the `DEFAULT_CONFIG` strings (verified against the loaded module).
- .agents/skills/advisor-turn-gate/SKILL.md:26 — the count-neutral replacement landed; "All seven config fields" is gone.
- TECH_DEBT_AUDIT.md:28,52 — both counts corrected to 20.
- tests/suites/config.mjs — the t28 band pins the three doors, the per-field latch, the exact warning string, latch-window isolation, clamp independence, and the specialist door pair.
- tests/suites/advisor.mjs — the t29 capturing stub records the third argument every existing stub ignores; the omit-key contract is asserted with `Object.hasOwn`, never truthiness.

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ The two spokes follow the duplicated-constant + two-pin parity pattern (`DEFAULT_MAX_TOOL_ROUNDS`): config's list is pinned by the warning message's literal enumeration, advisor's by a behavioural out-of-list pin plus a literal tuple pin — never by cross-module comparison.
- ✓ The conditional-spread omit-key idiom is copied verbatim from `plan-turn.ts:26-30`, comment included, at both `completeSimple` sites.
- ✓ The new config arms mirror the `specialistModel`/`specialistSystemPrompt` narrowing shape (per-field `DEFAULT_CONFIG` fallback on the wrong-typed door).
- ✓ The seam reads the new values at the I/O layer like `toolsEnabled`/`maxToolRounds`/`specialist`; no spoke imports a sibling at runtime.
- ✓ The t28/t29 bands follow the established assert idiom (`withConfig` window per warn-count assert, `captureWarn` for latch counts).
- Acceptable variation, not a deviation: the t28 band grew to ~20 asserts and t29 to 14 against the skeleton's ~8/~6 budget — the plan's own Verification Notes predicted exactly this growth (the `faa98a5` latch precedent).

#### Potential Issues:

- Plan Verification Note correction (non-blocking, doc-only): the plan claims the two seam forwarding lines have "zero typecheck coverage" because `index.ts` is imported by nothing executable. Wrong — `tsc --noEmit` type-checks every file in the include set whether or not anything imports it, so the seam lines ARE covered. The eval-mirror half of the note stands (`.mjs` is outside tsc).

### Manual Testing Required:

All five manual items were discharged offline through the real modules (a scratch driver under `.rpiv/tmp/`, since deleted). Three of the five are SIMULATED, not live: the warn-once latch, the payload inspection, and the copy-and-activate smoke ran against a stub completion facade in one process, not a live provider session. The eval-table comparison and the README alignment check are exact (row-for-row and byte-level). Legend: [x] = executed as written; [ ] = simulated offline against a stub facade, live equivalent outstanding (each such heading says simulated). Results:

1. Warn-once latch check (Phase 1) — simulated, not live:
   - [ ] One process, three consecutive turns with `"reasoningEffort": "ultra"`: turn 1 warned exactly once with the pinned message naming the field, the rejected value, and all six accepted levels; turns 2 and 3 warned zero times.
2. Payload inspection (Phase 2 / Phase 3) — simulated, not live:
   - [ ] Advisor call with the field set: options = `{ signal, reasoning: "high" }`.
   - [ ] Advisor call with the field unset: options = `{ signal }` — no `reasoning` own key (`Object.hasOwn` false), the same shape the pre-change options object produced at the stub. The wire-level absence rests on the plan-time host reading (`openai-completions.js:508`), not on execution.
   - [ ] Specialist leg with `specialistReasoningEffort: "low"`: leg options = `{ signal, reasoning: "low" }` while the advisor rounds carry `high` — the two levels are independent.
3. Eval score-table comparison (Phase 3) — exact, at base:
   - [x] Base-commit run at 4af3ccb (detached worktree) printed the identical table: 6/6 fixtures, 8/8 scores, same PASS rows in the same order.
4. README table alignment check (Phase 4) — byte-level, no viewer:
   - [x] All 22 table lines share one pipe shape (pipes at columns 0/30/54/225), so the 27-char first column and the re-padded meaning column align in any markdown viewer.
5. Copy-and-activate smoke test (Phase 4) — simulated, not live:
   - [ ] `config.example.json` copied to `config.json` with `model` + `reasoningEffort: "high"`: the gate activates, the advisor call carries `reasoning: "high"`, and both prompt values match the code defaults.
   - [ ] With `specialistModel` also set, the specialist block works: the consult leg fires and the post-leg advisor round still carries `high`.

Residual, non-blocking (requires a live session; every offline equivalent is green):
- [ ] One real provider round-trip with the level set, confirming the `reasoning` field reaches the wire (the extension's path to the facade is proven above; the host adapter's clamp behavior was confirmed at plan time, `openai-completions.js:508`).
- [ ] README table eyeballed in a rendered markdown viewer (byte-level alignment verified programmatically).

### Recommendations:

- Ready to commit — implementation is complete and validated. Already committed across 1747486, b197964, 8fc4e9b; no new commits needed.
- Amendment note: this report was corrected in place after its single Write, per review findings (checkbox semantics, wire-level wording for the unset payload, t16/t26 measured at base, seam-closure proof, plan Verification-Note correction). The write-once contract prefers a fresh re-run; this run amended instead and discloses it here.
- Working-tree note: the implementation tree is clean; this validation artifact is itself the only untracked file (`?? .rpiv/artifacts/validation/2026-11-10_15-44-25_reasoning-effort-config.md`), expected pre-commit.
