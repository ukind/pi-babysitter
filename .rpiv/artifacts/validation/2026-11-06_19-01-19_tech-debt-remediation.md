---
template_version: 1
date: 2026-11-06T19:01:19+0700
author: Yogiswara Utama
commit: dc8567c
branch: main
repository: advisor-turn-gate
topic: "Validation of Tech-debt remediation series (F020, F029–F037)"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-06_14-09-03_tech-debt-remediation.md"
tags: [validation, gate-hook, sandbox, memory, docs, tests, host-bump, slice-series]
last_updated: 2026-11-06T19:01:19+0700
---

## Validation Report: Tech-debt remediation series (F020, F029–F037)

Second run. The first report (same path, overwritten per the skill's no-append rule) described a tree that no longer exists: it recorded 12 unpushed commits and an open CI criterion. Since then the series was pushed, CI went red on a Node-floor collision the plan never modeled, and two fix-forward commits landed (`ee25d25`, `dc8567c`). This run re-validates the tree at `dc8567c` and records the collision and its fix.

### Implementation Status

- ✓ Phase 1: F035 — root-like rm matcher widening — Fully implemented
- ✓ Phase 2: F031 — sandbox secret denylist — Fully implemented
- ✓ Phase 3: F029 — documentation drift, three twin docs — Fully implemented
- ✓ Phase 4: F034 — pure-module rule amendment + plan-turn.ts banner — Fully implemented
- ✓ Phase 5: F030 — test split into suites — Fully implemented
- ✓ Phase 6: F020+F008 — 1.5.0 bump + re-record — Fully implemented; post-push CI criterion now discharged (see Automated Verification Results)
- ✓ Phase 7: F032 — un-export eight dead names — Fully implemented (one extra swept name, see Deviations)
- ✓ Phase 8: F033 — memory banner reword — Fully implemented
- ✓ Phase 9: F036 — starved-trigger warn — Fully implemented (live-latch criteria remain declared homework)
- ✓ Phase 10: F037 — per-entry byte cap — Fully implemented
- ✓ Phase 11: Ledger close — Fully implemented

All eleven phases are committed one per finding, in FRD order, on `main`:
`8492fe0` (F035) → `ae89ae6` (F031) → `1dc4b52` (F029) → `31c5a21` (F034) → `2fc522c` (F030) → `b0e9f56` (F020+F008) → `8962f97` (F032) → `26dc043` (F033) → `2946bd1` (F036) → `046663a` (F037) → `1e91383` (ledger close).

### Automated Verification Results

- ✓ Unit suites: `npm test` — 526 PASS asserts, 0 FAIL, `test.mjs: all green`
- ✓ Lint + format: `npm run lint` — biome check over 44 files, no fixes needed
- ✓ Typecheck: `npx tsc --noEmit` — clean
- ✓ Eval score gate: `npm run eval` — 6/6 fixtures replayed, 8/8 scores pass
- ✓ Dependency audit: `npm audit` — 0 vulnerabilities
- ✓ Dead exports: `npx knip@6.44.1` — exit 0, zero unused exports
- ✓ Suite split: `ls tests/suites/` — exactly 8 files; `tests/test.mjs` is the 12-line runner
- ✓ CI matrix: run [42216351552](https://github.com/ukind/pi-babysitter/actions/runs/42216351552) — `verify (22.19.0)` ✓ and `verify (24)` ✓, all five steps at the 1.5.0 lockfile
- ✓ Node-floor agreement (the local proxy the plan lacked): 9 lockfile entries declare `"node": ">=22.19.0"`; `package.json:9` engines `>=22.19.0`; `.github/workflows/ci.yml:16` matrix `["22.19.0", "24"]`
- ✓ Working tree clean of tracked changes: `git status --porcelain` shows only untracked `.rpiv/artifacts/` workflow artifacts; `origin/main..HEAD` is empty

Four grep-count criteria disagree with the plan's predicted numbers. Each was investigated and each is a count-window or grep-mechanics artifact, not missing work (details under Deviations from Plan). No criterion's intent failed.

### Code Review Findings

#### Matches Plan:

- `scripts/hooks/gate.mjs:27-46` — the 14-member `ROOT_LIKE_TARGETS` Set; `:49` carries the widened drive-root regex `/^[a-zA-Z]:[\\\/]?$/` accepting both separators; reason string unchanged
- `sandbox.ts:52` — `SECRET_SEGMENT` denylist (strict, no `.env.example` carve-out); `:93` site 1 in `planRead` before any fs work; `:186` site 2 on the realpath before the prefix re-check
- `memory.ts` — un-exported `ADVICE_TEXT_MAX_BYTES = 2048` with the code-point walk-back (`0xc0` continuation mask); the F033 reworded banner line; the field doc reads "trimmed and byte-capped by recordAdvice"
- `triggers.ts` — pure `starvedTriggerWarn` builder, union-typed fixed pairs; `index.ts:12` import, `:64-65` the two independent per-signal latches, `:134-145` the seam warn gating on armed + null + un-latched
- `tests/suites/` — eight suites + `tests/helpers.mjs` (90 lines) + the 12-line bare-import runner; helpers registers the exit handler and carries the shared `gateArgs` factory
- `.rpiv/guidance/architecture.md`, `AGENTS.md`, `.agents/rules/main.md` — two-handler narrative, nine-spoke diagram, eval Commands row, CI sentence, suites/helpers doc rows; zero "secret" and zero stale-"single await" text
- `TECH_DEBT_AUDIT.md:62-70` — all nine series rows stamped `RESOLVED <short-sha>`; every SHA is the finding's actual fix commit (verified against `git log`); zero `| NEW` and zero `| OPEN` rows remain
- The F020 merge gate held: the locally-resolved `node_modules/@earendil-works/pi-coding-agent` is version 1.5.0; `dist/core/model-registry.js:6-9` declares `runtime` as a public class field and `dist/core/model-runtime.js:524` carries `completeSimple` — equivalent evidence to the plan's `npm pack` procedure, against the same resolved tarball
- Commit file-scopes match the phase file lists for ten of eleven series commits (F032 is the one documented deviation, below)

#### Deviations from Plan:

- `tests/helpers.mjs:70` (commit `8962f97`, F032) — the commit touches a fifth file beyond the plan's four: `export const Q` → `const Q`. After Phase 5's split, `Q` is used only inside helpers.mjs by `marker`, so knip flags it as a ninth dead export. The sweep is correct work — the phase's goal (knip clean) is achieved and verified — but the plan's Phase 7 criterion "exactly the four files and 8 changed lines, all 7-char `export ` deletions" under-counts: the actual commit is five files and nine export deletions. Plan deviation, non-blocking.
- Phase 5 pin-count criterion predicted 518 `^PASS:` lines; the actual count is 526. The 518 figure was true only at Phase 5's slice state; Phases 9 and 10 add eight pins afterwards (4 × t21d starved-trigger pins + 4 × F037 byte-cap asserts). 518 + 8 = 526. Criterion intent holds; the prediction was slice-scoped and not updated.
- Phase 6 guard.ts cite criterion predicted 3 matching lines; the actual count is 2 lines carrying 3 matches — `resource-loader.js:492` and `agent-session.js:1323` share line 92, and `grep -c` counts lines, not matches. All three repaired cites are present.
- Phase 11 criterion predicted 9 lines matching `RESOLVED [0-9a-f]{7}`; the actual count is 34, because the ledger retains 25 pre-series RESOLVED stamps from earlier audit rounds. The criterion's intent is fully verified: the nine series rows are stamped with real SHAs mapping 1:1 to the fix commits, and zero NEW/OPEN rows remain.
- Phase 3's criterion "grep suites/ in the three docs returns nothing" held only inside Phase 3's window; Phase 5's doc deltas deliberately add the `tests/suites/` rows afterwards (the plan's own slice-state rule predicts this). Superseded by design, not drift.
- **`dc8567c` — three files outside the plan's declared write-set, explained.** The plan's Phase 6 criteria verified `npm audit` = 0 and the lockfile's resolved versions but never cross-checked the new dependency's `engines.node` against the CI matrix. `@earendil-works/pi-agent-core@1.5.0` requires `node >=22.19.0`; `.github/workflows/ci.yml` still pinned `22.6.0`, so the first post-push run failed at `npm ci` with `EBADENGINE` before any test ran. The fix raises the matrix floor to `22.19.0` and aligns the two other declared floors (`package.json` engines, `.rpiv/guidance/architecture.md` prose). This is a plan-level gap — the plan's own post-push criterion was the right instinct but had no local proxy — recorded here as a plan deviation, non-blocking, with the fix verified green on both matrix legs.
- `ee25d25` — `.gitignore` gains `.pi/` (untracked local pi state in the repo root). Hygiene, outside the plan's write-set, non-blocking.
- Validation-context note (not an implementation deviation): the skill-run Metadata block reported `in_repo: no` / `repo: unknown`, but the working directory is the advisor-turn-gate git repository on `main`. Git evidence was used; the report's frontmatter carries the verified values.

#### Pattern Conformance:

- ✓ The eight suites follow the project's offline test conventions: shared helpers import first, plain `node:assert`, no live model calls, `--experimental-strip-types` loadable, exit-handler summary.
- ✓ All eleven series commit subjects follow the finding-ID convention (`F0xx` in the subject), keeping the 1:1 commit↔finding↔ledger-row mapping intact.
- ✓ The two fix-forward commits follow the same discipline (subject names the cause; body explains the collision), and no history was rewritten — the 12-commit series stands as pushed.
- Minor observation: the ninth dead-export sweep (`Q`) rides the F032 commit rather than a separate follow-up commit. Acceptable variation, not a deviation — same finding class, same commit boundary discipline.

#### Potential Issues:

- The 22.6–22.18 Node range is gone by design: the extension now genuinely requires Node >= 22.19.0 because of the 1.5.0 host family. Any consumer still on 22.6–22.18 cannot install the package. This is the intended trade (the two options considered were raising the floor versus pinning the host back to 1.4.x, which would have re-opened F020's advisories), recorded for visibility.
- Attribution correction: the cause of the pre-series CI failures (runs `42039372874`, `41977753307` on 2026-11-05) was never established — the failing steps were not examined before those runs were superseded. Only the series' own run failure (`EBADENGINE` at `npm ci`, run `42215923485`) is verified. Earlier statements that the 22.6.0 leg "was already failing with EBADENGINE before the series" are unverified; treat the pre-series cause as unknown.
- Two CI annotations are noise, not failures: the checkout/setup-node v4 Node-20 deprecation (bump the actions to v5 someday) and the ubuntu-latest migration note.

### Manual Testing Required:

Re-verified at `dc8567c` (this run): the full gate (`npm test` 526 PASS, `npm run lint`, `npx tsc --noEmit`, `npm run eval` 6/6, `npm audit` 0); the green CI run on both matrix legs (run 42216351552 — discharging the previously-open post-push criterion); the Node-floor agreement check across lockfile, manifest, and CI; the clean working tree with `origin/main..HEAD` empty; and the commit scopes of `ee25d25` and `dc8567c`.

Verified at `1e91383` (first run), code unchanged since — the two follow-up commits touched only `.gitignore`, the ci.yml matrix, the package.json engines line, and one architecture.md prose line, none of which this evidence reads: live `rm -rf C:/`-family gate probes (8/8 correct, including quoted `C:/`); the 1.5.0 host reach check (`runtime` field + `completeSimple` confirmed in the real dist); the nine-spoke↔import-block 1:1 match; the ci.yml steps (npm ci, test, lint, typecheck, eval); filename existence; doc-vs-source spot checks; biome-over-tests; byte-identical t19/F031 pin placement; doc deltas; commit-message placements; knip proofs; commit scopes for the eleven series commits; per-phase grep criteria; and the ledger SHA↔commit mapping (9/9). The remaining items need a live pi host:

1. F036 live-host latch behavior (Phase 9; pure logic is pinned by the passing t21d asserts, the seam latches need a real host):
   - [ ] With `triggerMinNewTokens` armed and a host supplying no usage data, the first starved cadence-miss turn warns once; later turns stay silent
   - [ ] A host supplying tokens but no context usage warns only the pressure message (latch independence)
   - [ ] No warn fires when the signal is present but sub-threshold, nor when the threshold is disarmed (0)
   - [ ] A pi reload re-arms both latches (factory lifetime)
2. Phase 2 POSIX-symlink probe (environment-blocked):
   - [ ] Optional re-run on a POSIX machine: link a secret-named file into a scratch project and read it through `createSandbox` — refused with `a secret file`. The probe was blocked here by the local command safety net (secret-basename rule); the deterministic stub-fs pin ("a realpath landing on a secret refuses") covers the same site and passes.

### Recommendations:

- Series is complete, validated, pushed, and green on CI at the 1.5.0 lockfile. No commit action needed — history is already one-commit-per-finding with ledger SHAs matching.
- After a pi reload with triggers armed, confirm the F036 latch behaviors once in a live session (four checklist items above).
- For future plans: add a local-proxy criterion for any dependency bump — lockfile `engines` floors, `package.json` engines, and the ci.yml matrix floor must agree, checked with grep before push. That single check would have caught the `EBADENGINE` collision locally.
