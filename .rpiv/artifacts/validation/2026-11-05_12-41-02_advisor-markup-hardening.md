---
template_version: 1
date: 2026-11-05T12:41:02+0700
author: Yogiswara Utama
commit: 7cc8e04
branch: main
repository: advisor-turn-gate
topic: "Validation of Advisor markup-only hardening: payload role filter + prompt rewrite"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-05_11-04-26_advisor-markup-hardening.md"
tags: [validation, advisor, prompt-shaping, eval-runner]
last_updated: 2026-11-05T12:41:02+0700
---

## Validation Report: Advisor markup-only hardening: payload role filter + prompt rewrite

### Implementation Status

- ✓ Phase 1: Role filter and prompt rewrite — Fully implemented. All seven target files carry diffs that match the plan hunks hunk-for-hunk; implementation is uncommitted in the working tree on top of `7cc8e04`, and the dirty set is exactly the plan's declared write-set (nothing extra tracked or untracked).

### Automated Verification Results

- ✓ Unit suite: `npm test` — all green, including the new t7b substring pins, the reworked t10, the new t10b band, and the re-pinned t22.
- ✓ Eval gate: `npm run eval` — exit 0, prints `eval: budget-window/budget-respected PASS`; 6/6 fixtures replayed, 8/8 scores pass, startup self-test gate green.
- ✓ Lint: `npm run lint` — `biome check .`, 35 files, exit 0.
- ✓ Typecheck: `npm run typecheck` — `tsc --noEmit`, exit 0.
- ✓ Contract files untouched: `git diff --quiet -- plan-turn.ts advisor.ts index.ts guard.ts memory.ts triggers.ts sandbox.ts report.ts` — exit 0. FR5 confirmed at the string level too: the markup-only notify strings are byte-identical at `plan-turn.ts:185` and `plan-turn.ts:286`.
- ✓ Stale prose in declared targets: both criterion greps return 0 (`full transcript ships` in TECH_DEBT_AUDIT.md, `projected transcript` in .rpiv/guidance/architecture.md).

### Code Review Findings

#### Matches Plan:

- `prompt.ts:31-58` — `isAdvisorRole` private predicate + `keepAdvisorRoles` with the `every` door and the FR4 floor, inserted after `ADVISOR_NUDGE` and before `hasToolDeclarations`, exactly as hunk B specifies. Both identity doors return the same array reference (pinned by t10b `===` asserts).
- `prompt.ts:76-80` — strip doc re-scope carries the Step 8 reviewer amendment ("Pinned through the floor path by t22; the filter's floor door by t10b").
- `prompt.ts:227-230` — filter-first pipeline: `ensureUserTail(applyTokenBudget(stripToolDeclarations(keepAdvisorRoles(llmMessages)), tokenBudget))`. The fold sizes the filtered payload (FR3), proven by the t22 no-marker-lead pin.
- `config.ts:50-58` — the rewritten `DEFAULT_CONFIG.systemPrompt` matches the plan text verbatim and keeps `/no tools/` and `/text only/` (FR1, D5).
- `tests/test.mjs` — all six surgery points landed: import added, t7b gains the `/reasoning trace/` and `/outputs/` pins, t10 banner and body replaced per hunk, t10b band covers the whitelist, both doors by reference, and the empty transcript, t22 `:1671-1674` flips to `length === 2`, and the fatDelta block is replaced with the filter-before-fold and floor-path-strip pins (D6).
- `eval/runner.mjs:80-99` — `budget-respected` re-scoped exactly as hunked: `markerRan`, `narrowed`, `survivorsKept`, `systemsDropped`, budget bound; score name unchanged (contract).
- `eval/fixtures/budget-window.json` — `keptTexts` added after `systemTexts`; one `toolResult` entry inserted mid-payload at timestamp 6 between a2 and the tail note; system texts stay in the input so the replay proves the drop (D7).
- `.rpiv/guidance/architecture.md:3,15` — overview sentence and the prompt.ts spoke line re-scoped per D8.
- `TECH_DEBT_AUDIT.md:104` — audit row records the narrowed payload as the new deliberate state, per the Step 8 applied finding.
- FR1–FR6 all verified in code: role statement present (FR1), whitelist without a config toggle (FR2), filter-first order (FR3), both identity doors (FR4), byte-identical notify strings (FR5), offline tests with no live model calls (FR6).

#### Deviations from Plan:

- `AGENTS.md:4` and `README.md:4` — both still say "It reads the projected transcript", which FR2 falsifies. The plan's stale-prose inventory (Key Discoveries, D8) declared a three-line surface (guidance `:3`+`:15`, audit `:104`) and missed these two. The implementation is faithful to the plan; the plan's sweep was incomplete. Both files sit outside the declared write-set and were correctly left untouched. Comment-only gap: the remedy is doc text, no executable line changes, non-blocking — it does not force the verdict. Fix alongside the next doc pass or in a follow-up commit.
- Minor: the Verification Notes pointer `runner.mjs:153-156` for `selfTestGate` is now `eval/runner.mjs:165` — the score re-scope added ~12 lines above it. The pointer was correct at authoring time against `7cc8e04` (the Step 8 review verified it); this is inherent line-number drift from the run's own insertion, and the self-test's behavior is unaffected (it gates startup and passed). Doc-pointer-only, non-blocking.

#### Pattern Conformance:

- ✓ `keepAdvisorRoles` clones the in-repo pure-transform convention exactly: private predicate, `every` identity door, floor return — the template the plan named (`stripToolDeclarations`, `applyTokenBudget`, `advisor.ts` "Identity when clean is EXACT").
- ✓ The t10b band follows the letter-suffix convention (t7b/t15b/t22c) and the strict `===` reference-identity pin style of `tests/test.mjs` direct-transform bands.
- ✓ Biome and tsc pass over the new code; extensionless sibling imports unchanged; no runtime imports added anywhere.

#### Potential Issues:

- None. The one candidate (the two stale doc lines above) is already recorded as a plan deviation; no executable risk surfaced.

### Manual Testing Required:

Both manual criteria from the plan were executed as part of this validation (the user requested it):

1. Rewritten `DEFAULT_CONFIG.systemPrompt` reads as the role statement:
   - [x] Verified. The shipped text scopes the role ("reviewing the reasoning trace and outputs of another agent's work in progress"), states the transcript is all the advisor receives, demands plain prose, bans tool-call markup and angle-bracket tool syntax, and keeps the brevity, no-praise, and name-file-and-line directives. Coherent, self-consistent, and exactly FR1. The final taste call is the developer's, but the text reads as intended.
2. `.rpiv/guidance/architecture.md:15` describes prompt.ts accurately:
   - [x] Verified. The line now reads "context shaper: filter roles, strip tool deltas, ensure user tail (zero imports)" — precisely the three passes prompt.ts performs (`keepAdvisorRoles`, `stripToolDeclarations`, `ensureUserTail`), and the pi-ai import is type-only, so "zero imports" holds at runtime.

Live efficacy of the rewrite (does the advisor stop answering in markup) remains a deployment-time observation and is correctly not a phase gate — telemetry is UI-gated per the plan's Verification Notes.

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Fold the two stale lines (`AGENTS.md:4`, `README.md:4`) into the commit series as a small doc-only commit: "The payload is the transcript's user and assistant turns" — one sentence each, no code.
