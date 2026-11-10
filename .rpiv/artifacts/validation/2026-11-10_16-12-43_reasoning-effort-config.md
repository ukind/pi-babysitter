---
template_version: 1
date: 2026-11-10T16:12:43+0700
author: Yogiswara Utama
commit: 8cd75b2
branch: main
repository: advisor-turn-gate
topic: "Validation of Reasoning effort config for the advisor and specialist calls"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-10_11-22-50_reasoning-effort-config.md"
tags: [validation, config, advisor, specialist, reasoning-effort, warn-latch, eval-mirror, docs]
last_updated: 2026-11-10T16:12:43+0700
---

## Validation Report: Reasoning effort config for the advisor and specialist calls

Re-validation at HEAD `8cd75b2`. The prior run (report `2026-11-10_15-44-25`, verdict pass, at `8fc4e9b`) covered the same plan; the three commits since (`0b594be` plan-note correction, `ccb4c39` prior validation report, `8cd75b2` audit findings) carry no implementation changes. Every automated gate and every manual item was re-measured fresh in this run, including a full base-commit regression measurement.

### Implementation Status

- ✓ Phase 1: Config layer — Fully implemented
- ✓ Phase 2: Advisor layer — Fully implemented
- ✓ Phase 3: Seam and eval mirror — Fully implemented
- ✓ Phase 4: Docs and terminal checks — Fully implemented

### Automated Verification Results

All counts in this section were measured fresh at HEAD `8cd75b2` in this run.

- ✓ Whole-plan suite: `npm test` — 560 PASS / 0 FAIL, `test.mjs: all green`
- ✓ Phase 1 shared-latch pins: `npm test 2>&1 | grep -cE "share the (warn-once )?latch"` — 5, as pinned
- ✓ Phase 1 per-field independence: `grep -c "t28: two unaccepted fields warn once each"` — 1
- ✓ Phase 2 omit-key contract: `npm test 2>&1 | grep -c "NO reasoning own key"` — 2
- ✓ Phase 2 t16/t26 pins unchanged: HEAD 14 / 42; base `4af3ccb` measured 14 / 42 — identical on both sides
- ✓ Phase 3 seam forwarding: `grep -c "config.reasoningEffort" index.ts` = 1, `grep -c "config.specialistReasoningEffort" index.ts` = 1
- ✓ Phase 3 eval mirror: `grep -c "config.reasoningEffort" eval/runner.mjs` = 1, `grep -c "config.specialistReasoningEffort" eval/runner.mjs` = 1
- ✓ Phase 3 fixtures untouched: `git diff 4af3ccb..HEAD --stat -- eval/fixtures/` — empty
- ✓ Phase 3/4 eval gate: `npm run eval` — 6/6 fixtures, 8/8 scores
- ✓ Phase 4 README rows and third door: `grep -ci "ReasoningEffort" README.md` = 2, `grep -c "warns once for that field" README.md` = 1
- ✓ Phase 4 example: `grep -ci "ReasoningEffort" config.example.json` = 2; valid JSON with exactly 11 keys
- ✓ Phase 4 SKILL.md count-neutral line = 1; audit counts `documents 20 config fields` = 1 and `all 20 fields` = 1
- ✓ Whole-plan typecheck: `npm run typecheck` — exit 0
- ✓ Whole-plan lint: `npm run lint` — 44 files, no fixes
- ✓ Drift greps: `seven config fields` and `17 config fields` — zero hits in README.md, SKILL.md, TECH_DEBT_AUDIT.md
- ✓ No regressions detected — base `4af3ccb` measured (detached worktree, full suite): 526 tests / 526 pass / 0 fail; delta -> 560 / 560 / 0 (+34 passing asserts from the new t28 and t29 bands, 0 failures on either side)

### Code Review Findings

#### Matches Plan:

- config.ts:44,46 — `reasoningEffort` and `specialistReasoningEffort` appended to `AdvisorGateConfig` after `asyncMode`, plain `string`, exactly as D1 specifies.
- config.ts:116 — `REASONING_LEVELS` is the six-level `as const` tuple; `"off"` is absent, per D3.
- config.ts:132 — `reasoningWarned` is a second `Set<string>` structure beside the shared boolean (`configWarned`), not a re-key of it; the five shared-latch pins stay green untouched.
- config.ts:148 — `resetWarnOnceForTest` clears both latches, so a warning tripped in one fixture window cannot suppress the next.
- config.ts:193 — `reasoningLevelOrUnset` implements the three doors in order (wrong-typed to per-field default, empty to the unset sentinel, out-of-set to warn once per field and `""`), with the union-typed `fieldName` parameter.
- config.ts:368-371 — the two narrowing arms sit after the `asyncMode` arm in the `loadConfig` return literal.
- advisor.ts:6 — `ThinkingLevel` joins the type-only import; no runtime pi-ai import was added (zero runtime npm dependencies holds).
- advisor.ts:33 — `CompleteSimpleFn` options retype `reasoning?: string` to `reasoning?: ThinkingLevel` (FR8), closing the laundering hole the `as CompleteSimpleFn` cast exposed.
- advisor.ts:76,95 — the advisor-side six-level tuple typed `readonly ThinkingLevel[]` plus `narrowReasoningLevel`, returning `undefined` for `undefined`, `""`, and out-of-list values.
- advisor.ts:443,463 — the consult leg narrows once into `specialistLevel` and spreads conditionally (the plan-review suggestion landed).
- advisor.ts:566 — `const reasoning = narrowReasoningLevel(params.reasoning)` hoisted beside `startedAt`, before the `for(;;)` loop — once per fire, not per round.
- advisor.ts:591 — the per-round options literal uses the conditional spread, so no `reasoning` own key exists when unset (the `plan-turn.ts:26-30` idiom).
- index.ts:194 — the fire-time specialist literal carries `reasoning: config.specialistReasoningEffort` inside the `specialistResolution.ok` gate.
- index.ts:225 — `advisorArgs` carries `reasoning: config.reasoningEffort` after `maxToolRounds`; the value is read at the I/O layer, never threaded through `planGate` (D4).
- index.ts:205,245,275 — SEAM CLOSURE: the single `advisorArgs` literal at :205 feeds BOTH fire paths — `void runAdvisor(advisorArgs)` at :245 (async) and `await runAdvisor(advisorArgs)` at :275 (blocking); the `reasoning` slot reaches `runAdvisor` in both modes.
- eval/runner.mjs:285,339 — the two mirror lines match the index.ts seam; the blind `DEFAULT_CONFIG` spread forwards the `""` sentinel, so fixtures stay byte-identical.
- README.md:21-23 — the third-door prose landed; the clamp latch is disambiguated as one warning per process.
- README.md:45-46 — both new rows in interface-declaration order; the full table shares one pipe shape (22 lines, pipes at columns 0/30/54/225), so the re-pad is uniform.
- config.example.json — 11 keys in interface order; both prompt values are byte-identical to the loaded `DEFAULT_CONFIG` strings (verified against the module, not by eye).
- .agents/skills/advisor-turn-gate/SKILL.md:26 — the count-neutral replacement landed; the stale field count is gone.
- TECH_DEBT_AUDIT.md:28,52 — both counts corrected to 20.
- tests/suites/config.mjs — the t28 band (20 assert lines) pins the three doors, the per-field latch, the exact warning string, latch-window isolation, clamp independence, and the specialist door pair.
- tests/suites/advisor.mjs — the t29 band (14 assert lines) records the third argument every existing stub ignores; the omit-key contract is asserted with `Object.hasOwn`, never truthiness.

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Duplicated-constant + two-pin parity (`DEFAULT_MAX_TOOL_ROUNDS` pattern): config-level list is pinned by the warning message literal enumeration (t28), advisor-side list by the behavioural out-of-list pin plus the literal tuple pin (t29 final assert) — never a cross-module comparison.
- ✓ The conditional-spread omit-key idiom is copied at both `completeSimple` sites, comment included.
- ✓ The new config arms mirror the `specialistModel`/`specialistSystemPrompt` narrowing shape (per-field `DEFAULT_CONFIG` fallback on the wrong-typed door).
- ✓ The seam reads the new values at the I/O layer like `toolsEnabled`/`maxToolRounds`/`specialist`; no spoke imports a sibling at runtime.
- ✓ The t28/t29 bands follow the established `withConfig`/`captureWarn` assert idiom.
- Acceptable variation, not a deviation: the bands grew past the skeleton budget (t28 ~20 asserts, t29 14) — the plan Verification Notes predicted exactly this growth (the `faa98a5` latch precedent).

### Manual Testing Required:

Legend: [x] = executed this run as described; [ ] = simulated offline against the real modules, live equivalent outstanding. The simulations run the actual `config.ts` / `advisor.ts` code with a capturing stub facade in one process; they cannot prove the provider wire format, only the extension-side option construction (the host-side clamp was anchored at plan time, `openai-completions.js:508`).

1. Warn-once latch (Phase 1) — simulated, not live:
   - [ ] One process, three consecutive reads with `"reasoningEffort": "ultra"`: read 1 warned exactly once with the pinned message naming the field, the rejected value, and all six accepted levels; reads 2 and 3 warned zero times.
2. Payload inspection (Phase 2 / Phase 3) — simulated at the module boundary:
   - [x] Advisor call with the field set: options own keys = `["reasoning", "signal"]`, `reasoning: "high"`.
   - [x] Advisor call with the field unset: options own keys = `["signal"]` — `Object.hasOwn(options, "reasoning")` is false.
   - [x] Advisor call with an out-of-list value (`"ultra"`): options own keys = `["signal"]` — the narrowing guard omits the key.
   - [x] Specialist leg: call 2 carries `reasoning: "low"` while calls 1 and 3 carry `reasoning: "high"` — the two levels are independent.
   - [ ] One live provider round-trip confirming the `reasoning` field reaches the wire.
3. Eval score-table comparison (Phase 3) — exact, re-measured at base:
   - [x] Base-commit run at `4af3ccb` (detached worktree) printed a byte-identical table to the HEAD run: 10 rows, 6/6 fixtures, 8/8 scores, same PASS rows in the same order.
4. README table alignment (Phase 4) — byte-level, no viewer:
   - [x] All 22 table lines share one pipe shape (pipes at columns 0/30/54/225), so the 27-char first column aligns in any markdown viewer.
   - [ ] Rendered-viewer eyeball outstanding.
5. Copy-and-activate smoke test (Phase 4) — simulated, not live:
   - [x] `config.example.json` copied with `model` + `reasoningEffort: "high"` (+ the specialist keys): `loadConfig` parses with zero warnings, both prompts byte-match the code defaults, and the end-to-end `runAdvisor` call carries `high` on the advisor rounds and `low` on the consult leg.
   - [ ] Live TUI activation of the copied config outstanding.

Residual, non-blocking (requires a live session; every offline equivalent is green this run):
- [ ] One real provider round-trip with the level set, confirming the `reasoning` field reaches the wire.
- [ ] README table eyeballed in a rendered markdown viewer; live copy-and-activate in the TUI.

### Recommendations:

- Ready to commit — implementation is complete and validated. All implementation commits already exist (`1747486`, `b197964`, `8fc4e9b`); the working tree carries only this validation artifact.
- This re-validation adds fresh evidence the prior report lacked: the base-commit regression measurement (526/0 at `4af3ccb`), the byte-identical base-vs-HEAD eval tables, and the five manual items re-executed offline in one driver.
- The two live residual items need a real provider session; schedule them with the next natural live use of the gate.