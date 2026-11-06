---
date: 2026-11-06T06:56:55+0700
author: Yogiswara Utama
commit: d2cd108
branch: main
repository: advisor-turn-gate
topic: "Resolve all open tech-debt findings (F020, F029-F037)"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, gate-hook, sandbox, memory, docs, tests, host-bump]
last_updated: 2026-11-06T06:56:55+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Resolve all open tech-debt findings (F020, F029-F037)

**Date**: 2026-11-06T06:56:55+0700
**Author**: Yogiswara Utama
**Commit**: d2cd108
**Branch**: main
**Repository**: advisor-turn-gate

## Research Question

Chained from the discover FRD (`.rpiv/artifacts/discover/2026-11-05_21-08-52_tech-debt-remediation.md`): how to implement the nine open TECH_DEBT_AUDIT.md findings (F020, F029-F037) by adopting the audit's probe-verified recommendations as written — security pair first (F035, F031), then docs (F029, F034), then the test split (F030), then the dependency bump with its F008 re-record (F020), then the four Low quick wins (F032, F033, F036, F037) — one commit per finding group, each naming its finding ID.

## Summary

**Problem**: Nine open audit findings tax every new slice — a root-like `rm` matcher gap, an absent sandbox secret denylist, three drifted prose docs, a false pure-module rule, a 3,343-line test monolith, an unrecorded 1.5.0 host bump, eight dead exports, a false memory-banner claim, an unbounded per-entry memory vector, and a silent trigger-starvation gap.
**Recommended**: Candidate A — adopt every fix as written, ten commits in the FRD order. Matches every past fix-series commit; the FRD's order already solves the sequencing constraints.
**Effort**: Med (~1.5–2 days; F030 is a half-day of byte-identical surgery; the other nine commits are minutes-to-an-hour each; F020 carries a manual reach check).
**Confidence**: High — all seams traced with corrected `file:line` coordinates at HEAD `d2cd108`; precedents cover every pattern in the series.

## Problem Statement

**Requirements:**
- Resolve all nine open findings, adopting the audit's recommendations as written (discover-confirmed).
- One commit per finding group, ID in the subject, ledger stamped at series end (FRD).
- Keep every existing test pin byte-identical on the F030 move; new pins are additive.
- Survive the full gate per commit: `npm test` exit 0, `npm run eval` 6/6, `tsc --noEmit` + `biome check .` clean, `npm audit` 0.

**Constraints:**
- Hub-and-spoke star topology: pure modules keep zero runtime imports; the hub imports every spoke (`.rpiv/guidance/architecture.md:59`).
- `tsconfig.json:17` covers root `*.ts` only — hooks and the test layer stay outside tsc; the suite is their gate.
- F030 mandates exactly eight files in `tests/suites/` and a runner under 30 lines; helpers live in `tests/helpers.mjs` (research-checkpoint decision).
- F031 denylist is strict — no `.env.example` exception (discover-confirmed).
- F020's merge is gated on the manual `runtime` reach check — t14/t16 are provably blind to slot relocation.

**Success criteria:**
- `grep -n "1.5.0"` hits `advisor.ts`, `TECH_DEBT_AUDIT.md`, `package.json`, and the F020 commit body.
- `ls tests/suites/` shows exactly eight suites; `tests/test.mjs` is a ≤12-line runner.
- knip shows zero dead exports AND `starvedTriggerWarn` used (post-F032+F036).
- TECH_DEBT_AUDIT.md shows zero OPEN rows; the uncommitted run-#3 audit content is committed.

## Current State

**Existing implementation:**
- `scripts/hooks/gate.mjs:29-42` — `ROOT_LIKE_TARGETS` Set (11 members); `isRootLikeTarget` at :44-47 with drive-root regex `/^[a-zA-Z]:\\?$/` (:46) accepting `C:` and `C:\` but not `C:/`.
- `sandbox.ts:74-91` — `planRead` has shape guard, resolve, escape refusal only; no secret denylist. The realpath arm sits inside `createSandbox`'s closure (`sandbox.ts:164-172`).
- Docs drift: `.rpiv/guidance/architecture.md:9,12-20,34` (six-spoke narrative, "THE single await", missing CI eval step), `AGENTS.md:10,16-28,38`, and the discovered twin `.agents/rules/main.md:24-34` — all describe a two-handler shape and a Files list missing `memory.ts`, `sandbox.ts`, `triggers.ts`, `eval/runner.mjs`.
- `plan-turn.ts:1-4` — four TYPE-ONLY imports convict the guidance's "no sibling imports" rule at `architecture.md:59`; `plan-turn.ts:111-112` already promises a banner that does not exist.
- `tests/test.mjs` — 3,343 lines: header 1-29, import block 30-113, helpers 115-168, 39 banner sections 170-3343 mapping exhaustively onto eight suites (research doc, F030 finding).
- `package.json:24-25` — both host carets at `^1.4.0`; `npm audit fix` (non-force) resolves 1.5.0 within range, rewriting the lockfile only. F008's accepted caret contract needs re-record at `advisor.ts:155-179` (:161, :162, :166) and `TECH_DEBT_AUDIT.md:41,53`.
- Dead exports: eight zero-consumer names — `MIN/MAX_TRIGGER_TOKENS`, `MIN/MAX_TRIGGER_PERCENT` (`config.ts:87-90`), `READ_FILE_TOOL_NAME` (`sandbox.ts:34`), `ToolExecutionResult` (`advisor.ts:41`), `SandboxResult` (`sandbox.ts:46`), `TriggerSignal` (`triggers.ts:15`).
- `memory.ts:167` — the only "atomically-whole" occurrence: false (writeFileSync truncates-then-writes); the quiet pre-read chain (`memory.ts:155-158`) makes "self-healing whole-file rewrite" the true claim.
- `index.ts:114-134` + `triggers.ts:85-96` — armed-but-null trigger signals no-op silently; only `tokens` and `pressure` arms can starve; t21 never pins null.

**Relevant patterns:**
- One commit per finding group with ID in subject: `TECH_DEBT_AUDIT.md` Status column — F001→`81a8748`, F021→`4be01eb`, F024→`1690b9e`.
- Ledger stamping with real short SHAs and same-commit `RESOLVED (this commit)` flips: `c663ac1`.
- Matcher widening + fixture grammar: `74d3cec` → `4be01eb` (count pins 10→15 bumped in-commit).
- Append-only pin placement: t19's blocked/allowed arrays derive assert messages from data (`tests/test.mjs:1404-1426`), so new members slot between untouched lines.
- Once-latch + pure decision + seam-side report: the `hostChecked` block (`index.ts:64-71`) — F036's placement precedent.
- Un-exported module-local constant: `KEY_SLUG_MAX` (`memory.ts:59`) — F037's constant-shape precedent.

**Integration points:**
- `scripts/hooks/gate.mjs:95-106` — `evaluate()`: the exported pure core the suite imports directly.
- `sandbox.ts:74-91` / `:164-175` — the two F031 denylist sites; wired at `index.ts:184-187`.
- `index.ts:56-57` — factory closure slots; `:37,42-43,49` — the latch state F036 joins.
- `memory.ts:169-180` — `recordAdvice`: F033's claim (:167) and F037's cap site (:170-173).
- `tests/test.mjs:115-168` — the 54 helper lines moving to `tests/helpers.mjs`.

## Solution Options

### Option 1: Candidate A — Adopt-as-written in FRD order (ten commits)

**How it works:**
Land the nine fixes in the FRD's order — F035, F031, F029, F034, F030, F020+F008, F032, F033, F036, F037 — one commit per finding, each carrying its full blast radius (code + pins + its own prose sweep). The FRD order resolves the known sequencing constraints as written: F029's docs precede F030 (nothing false between commits), F034's banner cites by symbol (immune to F030's move), F030 lands before F020 (t14/t16 verification narrative cites the stable `tests/suites/advisor.mjs` path), F032 precedes F036 (post-both knip shows the builder used).

**Pros:**
- Matches every past fix-series commit: F001→`81a8748`, F021→`4be01eb`, F024→`1690b9e` — one commit per finding group, ID in the subject.
- Ledger rows map 1:1 to commits (`RESOLVED <sha>` format, `c663ac1` precedent) — grep-audit stays trivial.
- Zero sequencing re-derivation: the FRD order already solves F029/F034/F030/F020's content obligations (research doc, F029 sequencing paragraph).

**Cons:**
- Ten CI cycles instead of fewer; the quick wins (F032/F033/F036/F037) each pay the full gate alone.
- Every commit must budget its own nearby-prose sweep (composite lesson: residues were always NEARBY PROSE).

**Complexity:** Med (~1.5–2 days)
- Files to create: 9 (~3,300 lines moved + ~60 new: helpers, 8 suites)
- Files to modify: ~15 (gate.mjs, sandbox.ts, plan-turn.ts, triggers.ts, memory.ts, config.ts, advisor.ts, index.ts, 3 docs, README, TECH_DEBT_AUDIT.md, package-lock.json)
- Risk level: Low — each fix is mechanically specified with corrected coordinates.

### Option 2: Candidate B — Same fixes, regrouped commit boundaries

**How it works:**
Land identical fix content under different boundaries — for example a docs bundle (F029+F034), a quick-win bundle (F032+F033+F036+F037), or a split security pair. Same code lands; only commit grouping, ledger stamps, and revert granularity differ.

**Pros:**
- Fewer CI cycles (roughly 5–7 commits instead of 10).
- Thematically grouped commits read well in `git log --oneline`.

**Cons:**
- Breaks the 1:1 commit↔finding↔ledger-row mapping that `c663ac1` and the audit's Status column establish — row stamps like `RESOLVED <sha>` would cover multi-finding commits, weakening greppability.
- Regrouping must re-derive the constraint graph the FRD already solved: a F029+F034+F030 docs bundle either anticipates the `suites/` layout (docs for code that does not exist) or drags the split into the docs commit; F020 before F030 forces its verification narrative to cite a path about to change.

**Complexity:** Med (~1.5–2 days + constraint-graph re-derivation)
- Files to create/modify: identical to Option 1
- Risk level: Medium — sequencing mistakes surface as falsity windows between commits.

## Comparison

| Criteria | Option A (FRD order) | Option B (regrouped) |
|----------|----------------------|----------------------|
| Complexity | Med | Med (+ re-derivation) |
| Codebase fit | High | Medium |
| Precedent-fit | High | Low |
| Integration-risk | Low | Medium |
| Verification-cost | Low | Medium |
| Risk | Low | Medium |

> **Evidence source note:** Per-candidate fit dispatch (Step 4 agents) was skipped by developer directive before the checkpoint — every cell above is scored from the research artifact's probe-verified evidence at HEAD `d2cd108` (all nine seams traced with corrected `file:line` cites; `npm audit fix --dry-run` already run; ecosystem scan skipped because the topic is wholly internal). No cell was silently dropped; the two dropped dimensions (novelty — external-only, answered by the dry-run; migration-cost — identical fix sets, equal by construction) are null by decision.

## Recommendation

**Selected:** Option 1 — Candidate A, adopt-as-written in FRD order.

**Rationale:**
- Precedent-fit: every remediation commit in this repo's history is one commit per finding group with the ID in the subject (audit Status column: F001→`81a8748`, F021→`4be01eb`, F024→`1690b9e`); the FRD prescribes exactly this.
- Integration-risk: the FRD order dissolves the only real sequencing hazards — F029 docs precede F030 with no falsity window (test.mjs is still one file between them); F034's banner cites symbols, not lines, so the F030 move cannot stale it; F020 lands after F030, letting its verification narrative cite `tests/suites/advisor.mjs` once.
- Verification-cost: both candidates pay identical per-commit gates; A pays no extra ledger bookkeeping.

**Why not alternatives:**
- Option B: dominated on precedent-fit (no regrouped precedent exists; ledger stamps weaken) and integration-risk (must re-derive the constraint graph); equal or worse everywhere else.

**Trade-offs:**
- Accepting ten CI cycles for 1:1 commit↔finding↔ledger-row mapping and per-finding revert granularity.

**Implementation approach:**
1. **F035** — widen the rm matcher: append `"../"`, `"../*"`, `"~/.."` to `ROOT_LIKE_TARGETS` (11→14) and widen the regex to `/^[a-zA-Z]:[\\\/]?$/` (`scripts/hooks/gate.mjs:29-46`). Append 4 blocked pins after `["chmod -R 777 /", "chmod"],` and 1 allowed pin (`"rm -rf build"`) after `"ls -la",` in t19; bump count pins in-commit. `node_modules` is already pinned byte-exactly — do NOT duplicate. Live-probe `evaluate()` on all four new forms.
2. **F031** — sandbox secret denylist, strict: `SECRET_SEGMENT` regex `/(^|\/)(\.env[^/]*|\.npmrc|\.git|id_rsa[^/]*|[^/]*\.pem)$/i` on `requested.replace(/\\/g, "/")` inserted between `planRead`'s shape guard and `resolve` (`sandbox.ts:79-81`), outranking the escape check; SAME regex on `real.replace(/\\/g, "/")` at the realpath arm (:164-172). Refusal: `advisor sandbox refused "${requested}": a secret file`. Fixtures: pure-`planRead` spellings (t25 block :2229-2255), live reads (`.env`, `src/.env.example` refused; `README.md` passes end-to-end, :2257-2292), optional-but-recommended stub realpath-side pin (:2295-2313). README sentence under the `toolsEnabled` row (`README.md:38`).
3. **F029** — docs drift, THREE docs: rewrite the guidance fence (`architecture.md:9,12-20` — nine spokes, two handlers, eval line, four-step CI), `AGENTS.md:10,16-28,38`, and the twin `.agents/rules/main.md:24-34` in one docs-only commit. No test-layout anticipation — between F029 and F030 nothing is false.
4. **F034** — amend the pure-module rule at `architecture.md:59` to "no RUNTIME sibling imports; type-only sibling imports are permitted (erased under strip-types)" and add the plan-turn.ts banner (10-16 lines, house style) at `plan-turn.ts:6` after the import block. Cite by symbol/module, NEVER by line number.
5. **F030** — test split: create `tests/helpers.mjs` (54 helper lines; exit handler MUST live here so it registers before any suite body) + eight suites in banner order (`config` 170, `gate` 433, `prompt` 666, `advisor` 994, `triggers` 1569, `memory` 1947, `dialogue` 2156, `tools` 2227) + a 12-line static-import runner as `tests/test.mjs`. Pins move byte-for-byte; import subsets collapse per Biome; `§18 reportFailure` rides advisor, `§11` guard veto rides gate (stated in the commit message); the commit message names the one-file helpers deviation. The commit carries its own doc delta (guidance :29/:65, AGENTS.md :25, main.md :31, runner banner, `eval/runner.mjs:4-5`).
6. **F020+F008** — lockfile-only bump: `npm audit fix` resolves 1.5.0 within `^1.4.0` (carets stay unless the resolver rewrites — verify; else manifest untouched). Re-record F008 at `advisor.ts:166` (append the re-verification fact; `:161` version-prefixed anchor re-verified against 1.5.0 dist) + `TECH_DEBT_AUDIT.md:41` (`RE-RECORDED <sha> · re-verified at 1.5.0`) + :53 (F020 row → RESOLVED) + the commit body. Repair the stale `advisor.ts:171` cite (cadence-latch spend is `index.ts:135-137` via `plan-turn.ts:157-159`). Sweep the host-anchor census (all version-prefixed anchors re-verified; bare-filename anchors swept). **The manual `runtime` reach check gates the merge** — t14/t16 pass against any host and are blind to slot relocation. Commit the uncommitted `M TECH_DEBT_AUDIT.md` here.
7. **F032** — un-export eight dead names: 7-character deletions of the `export ` prefix at `config.ts:87-90`, `sandbox.ts:34,46`, `advisor.ts:41`, `triggers.ts:15`. In-file uses keep working; verify with tsc + npm test + eval + `npx knip@6.44.1` (manual; knip is not a devDependency).
8. **F033** — reword `memory.ts:167` to "self-healing whole-file rewrite" (true: quiet pre-read drops corrupt stores; one writeFileSync per fire). Body untouched.
9. **F036** — add pure builder export `starvedTriggerWarn(field, signal)` in `triggers.ts` returning `[advisor-turn-gate] trigger <name> is armed but this host provides no <signal> data` (bindings: config field names `triggerMinNewTokens`/`triggerContextPercent`; signal names `tokens`/`pressure`); add a PER-SIGNAL once-latch in the factory closure beside the slots (`index.ts:56-57`), fired seam-side where null-ness is decidable (`index.ts:114-134`); channel `console.warn` (NOT reportFailure — headless hosts). Pins (NEW, additive): builder bytes for both crosswalks + armed-but-null → `{ action: "none" }` for both arms, in `tests/suites/triggers.mjs`. Mirror the `hostChecked` precedent one-for-one.
10. **F037** — add un-exported `const ADVICE_TEXT_MAX_BYTES = 2048` beside `KEY_SLUG_MAX` (`memory.ts:59`); cap in `recordAdvice` between trim and append (:170-173) with `Buffer.byteLength(trimmed, "utf8")` (no new import — Node global); SILENT truncation (F036's text prescribes warns when it wants them; `KEY_SLUG_MAX` truncates silently; the shared `memoryWarned` latch must not be consumed). Fixture in t23's recordAdvice round-trip: over-cap record → `readEntries(key).at(-1).text` byte-capped. Note the bound on `MemoryEntry.text` (`memory.ts:27`).

**Integration points:**
- `scripts/hooks/gate.mjs:29-46` - F035 Set + regex widening
- `sandbox.ts:79-81` and `:164-172` - F031's two denylist sites
- `architecture.md:59` + `plan-turn.ts:6` - F034 rule + banner
- `tests/test.mjs:115-168,170-3343` - F030 helper + suite move surface
- `advisor.ts:155-179` + `TECH_DEBT_AUDIT.md:41,53` - F020/F008 re-record coordinates
- `memory.ts:170-173` + `triggers.ts` top region + `index.ts:56-57,114-134` - F037/F032/F036 seams

**Patterns to follow:**
- One commit per finding, ID in subject, pins travel with the change: `TECH_DEBT_AUDIT.md` Status column, `4be01eb`, `c663ac1`
- Once-latch + pure builder + seam-side report: `index.ts:64-71` (F036)
- Un-exported module-local constant: `KEY_SLUG_MAX`, `memory.ts:59` (F037)
- Fold adjacent stale citations into the fix that makes them stale: F023 precedent (`0a8ef09`) — applied at `advisor.ts:171` inside F020

**Risks:**
- F030 reflow/mis-scoping: mitigate — every movable line is already Biome-canonical (verbatim move cannot reflow a pin); verify `npx biome check tests/test.mjs` on the first written runner; dynamic-import loop is the documented fail-fast-preserving fallback.
- F020 silent headless failure: mitigate — manual reach check gates the merge (the pinned `no auth-aware completion facade` string is the observable shape if missed; reportFailure is hasUI-gated and swallowed in `--print`).
- Nearby-prose drift per fix: mitigate — budget one prose sweep per commit; the composite lesson shows every past residue was nearby prose.
- CI matrix is the only remote-only criterion (F020): accepted — verify post-push.
- F032/F036 collide in triggers.ts's top region: harmless — post-both knip must show `starvedTriggerWarn` USED.

## Scope Boundaries

- Building: the ten-commit series adopting all nine fixes as written; strict F031 denylist; `tests/helpers.mjs` + eight suites + thin runner; lockfile-only 1.5.0 with F008 re-record; three naming decisions resolved at the explore checkpoint (below).
- NOT doing: glob expansion in gate.mjs (out of scope, audit-confirmed); the bare `git push origin :main` force-push residual (candidate finding for the NEXT audit; F035's rm scope does not cover it); an `.env.example` exception; a config field for the byte cap (un-configured constant per both texts); folding `eval/runner.mjs` into the split; a reset affordance for F036's closure latch; reordering the FRD sequence.

## Testing Strategy

**Unit tests:**
- t19: 4 new blocked forms + `rm -rf build` allowed + count-pin bumps, appended between untouched lines (`tests/test.mjs:1384-1431` → `tests/suites/gate.mjs`).
- t25: denylist fixtures — pure `planRead` spellings (`src/.env.example`, `join()` win32, absolute), live reads (`.env`/`src/.env.example` refuse with `.includes("a secret file")`; `README.md` passes realpath→read→cap), stub realpath-side pin (`tests/suites/tools.mjs`).
- t21 additions: armed + `turnTokens: null` → `{ action: "none" }`; armed + `contextPercent: null` → `{ action: "none" }`; `starvedTriggerWarn` exact bytes for both crosswalks (`tests/suites/triggers.mjs`).
- t23 addition: over-cap recordAdvice round-trip asserting byte-capped `readEntries(key).at(-1).text` (`tests/suites/memory.mjs`).
- t14/t16 unchanged — they move byte-identically into `tests/suites/advisor.mjs` and stay the (insufficient) host-pins the manual check complements.

**Integration tests:**
- `npm test` — split runner fail-fast by construction (`assert` never throws; a suite-body throw aborts the static import graph, later suites never evaluate, process exits non-zero).
- `npm run eval` — 6/6 fixtures (`eval/fixtures/`: allowlist-refusal, budget-window, consult-aggregation, dialogue-keys, tool-use-script, trigger-arms).
- `tsc --noEmit` + `biome check .` clean per commit; `npm audit` 0 after F020.

**Manual verification:**
- [ ] F020: the 1.5.0 `runtime` reach check against the real `node_modules/@earendil-works/pi-coding-agent` dist — THE merge gate (t14/t16 provably blind to slot relocation; failure shape: pinned facade string, silent on headless hosts).
- [ ] F035: live probe of `evaluate()` on `rm -rf C:/`, `rm -rf "C:/"`, `rm -rf ../`, `rm -rf ../*`, `rm -rf ~/..` (blocked) and `rm -rf node_modules`, `rm -rf build` (allowed).
- [ ] F020 post-push: CI matrix green (the remote-only criterion).
- [ ] Post-F032+F036: `npx knip@6.44.1` — zero dead exports, `starvedTriggerWarn` used.

## Open Questions

**Resolved during research:**
- Helpers placement - `tests/helpers.mjs` beside the runner, OUTSIDE `suites/`; runner-exports ruled out by arithmetic (first import cycle risk); duplication ruled out as the F017 drift class. `evidence: helper census, research checkpoint 2026-11-05 + confirmed`
- F031 strictness - strict denylist, no example exception. `evidence: discover Q + confirmed`
- F020 inclusion - in scope with F008 re-record. `evidence: npm audit fix --dry-run + confirmed`
- F033/F037 depth - both minimal. `evidence: discover Q + confirmed`
- F030 split-vs-rule - split per module. `evidence: discover Q + confirmed`

**Resolved at this explore checkpoint (developer, 2026-11-06):**
- Candidate set - Candidate A (FRD order) selected over B (regrouped boundaries); B dominated on precedent-fit and integration-risk.
- F037 constant - `ADVICE_TEXT_MAX_BYTES = 2048`, un-exported beside `KEY_SLUG_MAX`, silent `Buffer.byteLength` truncation.
- F036 builder name - `starvedTriggerWarn(field, signal)`.
- F030 ownership - §18 reportFailure → advisor suite; §11 guard veto → gate suite; stated in the F030 commit message.

**Requires user input:**
- (none — all four open items resolved at the checkpoint)

**Blockers:**
- (none — the F020 reach check is a verification step inside commit 6, not an unknown)

## References

- `.rpiv/artifacts/research/2026-11-05_21-30-56_tech-debt-remediation.md` - the probe-verified findings feeding every cell of this doc
- `.rpiv/artifacts/discover/2026-11-05_21-08-52_tech-debt-remediation.md` - the FRD: decisions, FRs, acceptance criteria
- `TECH_DEBT_AUDIT.md:41,53,78-100` - F008/F020 rows and the verbatim fix blocks (file is UNCOMMITTED at HEAD; rides the series)
- `.rpiv/artifacts/plans/2026-10-30_14-20-04_f021-f028-f008-commit-series.md` - fixture-grammar lesson (:875)
- `.rpiv/artifacts/plans/2026-11-03…` / `designs/2026-11-02…` - historical F032 verbatim quotes (acceptance-grep false-positive source)
- Commits `4be01eb`, `c663ac1`, `74d3cec`, `829c948`, `b11a144`, `06f3552`, `dfa82f8`, `e7eb376` - the precedent set (matcher widening, ledger stamping, test surgery, docs drift, dependency discipline)
