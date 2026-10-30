---
date: 2026-10-29T12:55:09+0700
author: Yogiswara Utama
commit: 829c948
branch: main
repository: advisor-turn-gate
topic: "tech-debt fix execution strategy (F001-F020)"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, commit-strategy, sequencing, tech-debt]
last_updated: 2026-10-29T12:55:09+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: tech-debt fix execution strategy (F001-F020)

**Date**: 2026-10-29T12:55:09+0700
**Author**: Yogiswara Utama
**Commit**: 829c948
**Branch**: main
**Repository**: advisor-turn-gate

## Research Question

How should the 20 verified findings from TECH_DEBT_AUDIT.md (F001-F020) be executed as a commit series on this repo, given the research artifact's corrected line map, four resolved maintainer decisions, and hard sequencing edges?

## Summary

**Problem**: 20 verified tech-debt findings span 6 modules, 2 hooks, a 782-line test file, and all docs. The findings have known dependency edges (F005→F019, F009+F017 shared header, probe deletion→F006→F007) and one crash-class bug (F001).
**Recommended**: Per-finding commits, dependency-ordered - every commit owns a closed touch list from the research's verified line map, and every intermediate state is verifiable green with the local gate trio.
**Effort**: Med-High (~1.5-2 focused days; ~10 commits, heaviest are F006 extraction and the hooks pass)
**Confidence**: High

## Problem Statement

**Requirements:**
- Fix all 20 verified findings F001-F020 at HEAD 829c948.
- Keep the fail-open contract (.agents/rules/main.md:19) intact through every step.
- Keep npm test, biome, and tsc green at every commit boundary.
- Respect the recorded sequencing edges: F005 before F019 wording; F009+F017 in one pass; probe deletion before/accompanying F006; F007's shouldFire designed into F006's planGate injection.

**Constraints:**
- Hard: zero-sibling-import invariant (tests/test.mjs:22-24) - plan-turn.ts must not runtime-import advisor.ts or the whole suite stops loading.
- Hard: t1 pins the modulo cadence sequences exactly (tests/test.mjs:129-150); shouldGate (config.ts:101-105) stays so t1 passes verbatim.
- Hard: t2/t3/t4/t6 are order-dependent until F002 lands; the fix flips t4:181-183 and t6:218 from 0 to 1.
- Soft: docs consistent at exactly one SHA (research's Commit-B rationale) - prose files need no test surface.
- Soft: TECH_DEBT_AUDIT.md currently fails biome and must be formatted before any commit that includes it.

**Success criteria:**
- All 20 findings fixed with per-finding commits, each gate-green.
- New tests exist for F001 (sync-throw), F006 (planGate/planCommit battery), F007 (fold parity), F009 (blocked + prefixed refspecs), F018 (describeSpawnResult).
- CI runs npm ci against a quoted ["22.6.0", "24"] matrix (F012/F013).
- Docs name all seven config fields and no stale commands (F010/F011/F019).

## Current State

**Existing implementation:**
The repo is two commits old. b1f3a16 dropped the whole extension (+4,353 lines, 25 files). 829c948 cleaned lone blocks in tests 4 minutes later. All 20 findings were born in b1f3a16 and verified current at HEAD; the corrected file:line map lives in the research artifact.

**Relevant patterns:**
- Pure-core extraction: gate.mjs:64-75 exports evaluate, unit-tested as t19 - the template F006 generalizes into plan-turn.ts.
- Fail-open everywhere: runAdvisor catches at advisor.ts:310-312; reportFailure wraps notify (report.ts:30-37).
- Type-only imports erase: advisor.ts:1,8-9 and index.ts:1,19-23 - devDependencies never bind the host (decisive for F008).
- Warn-once-per-process latch: config.ts:50-56, order-dependent tests t2-t6 until F002 lands.

**Integration points:**
- advisor.ts:235 - the F001 sync-throw hole (assignment outside the try at :237; leaked deliberately-unref'd timer rejects unhandled up to 60s later).
- gate.mjs:52-57 - blocksProtectedForcePush; both "git push origin +main" and "git push --force origin +main" pass today.
- index.ts:53-58 - cadence-then-outcome order; an errored boundary spends the advisor slot (F007).
- config.json:6 - shipped personal model default; ship-empty decided (gate disabled until the cloner opts in).
- .agents/rules/main.md:4-10 - hard YAML parse error; applyTo governs nothing today (F010).

## Solution Options

### Option 1: Per-finding commits, dependency-ordered
**How it works:**
Each finding (or tightly coupled finding pair) = one commit, topologically ordered so the gate trio stays green at every step. Order: F005+F015 → config group (F002+F014+F016) → F001 → probe deletion → F006 → F007 → F009+F017 → F018 → CI/tooling (F012+F013) → prose docs pass. Every commit's touch list is pre-known from the research's corrected line map.

**Pros:**
- Verbatim match to the repo's own recorded lesson: "land the tech-debt fix as small, gate-verified, per-finding commits, not one sweep" (research, Precedents; b1f3a16 → 829c948 in 4 minutes).
- Near-zero rediscovery cost: the research supplies exact file:line touch lists, test flips (t4:181-183, t6:218), and deletion ranges (t12 :380-400).
- Pinpointed bisection: a red gate names the finding, never the series.
- All hard edges respected by construction: F005 before F019 wording, F009+F017 share one gate.mjs:1-11 header pass, probe deletion precedes F006 so plan-turn.ts is born with no probe thunk, F007 injects into the already-landed planGate.

**Cons:**
- Highest gate-run count: ~18-42 invocations (3 gates × ~10 commits) versus 3 for a sweep.
- Five separate small AGENTS.md touches (:16, :18, :24-25, :41) - disjoint line regions, no conflict, but narrative spreads across commits.
- F001 needs one deliberate red-first run: its new test can masquerade green on regressed code via the exit handler (tests/test.mjs:29-32).

**Complexity:** Medium (~1.5-2 days)
- Files to create: 2 (plan-turn.ts ~150-250 lines with tests; lib.mjs ~40 lines)
- Files to modify: ~12 (advisor.ts, config.ts, guard.ts, index.ts, both hooks, config.json delete, tests/test.mjs heavily, AGENTS.md, README.md, .agents/rules/main.md, package.json, ci.yml)
- Risk level: Low (each step independently revertable; no step depends on unverified state)

### Option 2: Layer-batched commits
**How it works:**
Five commits grouped by module instead of by finding: (1) config.ts F002+F005+F014+F016, (2) advisor.ts F001+F008, (3) guard+index F003/F004/F006/F007, (4) hooks F009+F017+F018, (5) docs+CI everything else.

**Pros:**
- Simple mental model: one file-set per commit; commit 1's latch coupling (F002×F014) is actually easiest batched.
- Fewer gate runs (~15-18); ordering edges still satisfiable in the stated sequence.

**Cons:**
- Commit 3 bundles four findings across guard.ts:52-111, index.ts:43-96, a new plan-turn.ts, and a full test battery - blast radius closer to b1f3a16 than to the 829c948 ideal; bundling forfeits intermediate greens (probe-deleted-without-extraction is never verified).
- A F006 mistake that runtime-imports advisor.ts fails the ENTIRE suite, not a local test - suite-wide failure mode for one commit.
- Mis-batch: F013's Node-floor lines sit in gate.mjs:14 and feedback.mjs:10 (code-adjacent headers) but land in the prose docs commit, contradicting the "every touched file is prose" rationale.
- Weakest evidence: nothing in-repo or in the research justifies module batching; the recorded lesson says per-finding.

**Complexity:** Medium (~1.5 days)
- Files to create: same 2; same modify count, concentrated in fewer commits
- Risk level: Medium (commit 3 concentrates the F006/F007/laziness risk with no intermediate baseline)

### Option 3: Plan-turn-first restructure
**How it works:**
Extract plan-turn.ts (F006) first, then land structural fixes inside the new pure core (probe deletion as a removed thunk, F007 shouldFire injection, F016), then config/advisor fixes, then hooks, then docs/CI.

**Pros:**
- Later fixes land in final homes by construction - no fix lands in index.ts only to move into plan-turn.ts later.

**Cons:**
- Contradicts the resolved F006 design: the research specifies plan-turn.ts is born with NO probe parameter (one less thunk). F006-first builds the probe thunk, then tears it out - a self-inflicted build-then-teardown cycle in the newest file.
- Cadence injection swaps from shouldGate to shouldFire inside planGate; every commit-1 cadence-through-the-core test is re-baselined.
- Front-loads the heaviest verification (the entire F006 battery) into the least-proven commit with no prior green baseline; if the laziness battery is subtly wrong, all later commits inherit the broken core.
- config.ts churns in three consecutive phases before resetWarnOnceForTest exists, so t2-t6 stay order-dependent while unrelated edits land around them.

**Complexity:** Medium-High (~2 days; more rework than Option 1)
- Files to create: same 2
- Risk level: Medium-High (risk concentrated at commit 1→2 boundary)

### Option 4: Single sweep
**How it works:**
All 20 findings in one pass on a branch: all code fixes, all test flips/expansions, both new modules, and the docs pass in one changeset, one review, one merge.

**Pros:**
- Exactly 3 gate runs and one review.
- No ordering edges to manage - they convert into intra-diff consistency obligations.

**Cons:**
- The repo history IS the counter-example: b1f3a16 (25-file big-bang) needed the 829c948 cleanup commit 4 minutes later; the recorded lesson forbids this shape explicitly.
- One red run costs bisection equal to the whole series; tooling blind spots (biome missed lone blocks with zero diagnostics; F010 has no automated gate at all) mean the sweep's signals are weak exactly where the changeset is biggest.
- Open scope questions (F009 refspec shapes, F014 truncation wording, F013 minimal-vs-full) bounce the ENTIRE changeset, forcing re-execution of ~17 conflict-free findings.
- Merging prose fixes into the code changeset forfeits the docs-pass isolation the research mandates.

**Complexity:** High (~1.5-2.5 days; rework risk dominates)
- Files to create: same 2; everything lands at once
- Risk level: High

## Comparison

| Criteria | Opt 1 per-finding | Opt 2 layer-batch | Opt 3 plan-turn-first | Opt 4 sweep |
|----------|-------------------|-------------------|----------------------|-------------|
| Complexity | M | M | M-H | H |
| Codebase fit | High (recorded lesson) | Low-Med | Low | Fail (counter-example) |
| Risk | Low | Medium | Med-High | High |
| Intermediate verifiability | Every commit green | 4 of 5 green; c3 monolithic | c1 unbaselined | Terminal only |
| Ordering-edge cost | Designed out | c5 mis-batch (F013) | Build-then-teardown | Internalized, unauditable |

## Recommendation

**Selected:** Option 1 - Per-finding commits, dependency-ordered

**Rationale:**
- It is the repo's own recorded lesson applied to itself; the only stable commit in history (829c948) has exactly this shape, and the only big-bang required an immediate follow-up.
- Every ordering edge in the research resolves to a commit boundary, not a coordination cost: F005→F019, F009+F017 co-land, probe deletion before F006, F007 inside the landed planGate.
- Per-commit green gives pinpointed bisection in a repo where the lint gate is proven non-exhaustive and F010 has no gate at all - hand-written asserts and frequent npm test runs are the only real verification.

**Why not alternatives:**
- Option 2: commit 3 is a 4-finding sweep across the load-bearing seam (one wrong import in plan-turn.ts fails the whole suite); F013 mis-batches into the prose commit; forfeits intermediate greens exactly where risk peaks.
- Option 3: builds the probe thunk the research says must not exist, then removes it; re-baselines every cadence test; front-loads risk into the least-proven commit. Its benefit (fixes land in final homes) is already delivered by Option 1's ordering.
- Option 4: direct precedent-fit failure; open scope questions bounce the entire changeset; verification collapses to one terminal signal.

**Trade-offs:**
- Accepting ~18-42 gate invocations for pinpointed bisection.
- Accepting one deliberate red-first run for F001 (its test can masquerade green via the exit handler at tests/test.mjs:29-32).
- Accepting five small AGENTS.md passes for per-finding narrative clarity.

**Implementation approach:**
1. Commit A - F005 + F015 (one file): delete config.json:6; shrink t7b (tests/test.mjs:246-256) and the readFileSync import (:26); reword the provenance header (:5-14) as historical. Verify bit-identical behavior via the fallback (config.ts:145-148).
2. Commit B - F002 + F014 + F016 (config group, co-landed to settle the latch topology once): export resetWarnOnceForTest() (~config.ts:57), call at withConfig entry (tests/test.mjs:86-95); flip t4:181-183 and t6:218 to 1; delete ordering comments (:152-153, :158-160, :176-178); add clamp/truncation warns at call sites (config.ts:136-144) with the single shared latch, t5 expansion (Infinity clamps to min; wrong-type stays silent); delete modelKey (config.ts:106-109, tests :46/:257/:270); AGENTS.md:18 codec wording.
3. Commit C - F001 + F008 comment: move the pending assignment + .catch inside the try (advisor.ts:235→:237 block); add the sync-throw test after tests/test.mjs:639 (listener registered BEFORE await; assert rejection surfaces, no unhandled rejection after ≥5× deadline); RED-FIRST run against unfixed advisor.ts; one comment at advisor.ts:286-289 pinning the guard outside the try.
4. Commit D - F003/F004 probe deletion: guard.ts:52-111, index.ts:43-45 + veto :61, t12 (tests/test.mjs:380-400) + imports, AGENTS.md:16; keep the SCOPE/IDENTITY rationale (guard.ts:12-27); check captureLog users before removal.
5. Commit E - F006 extraction: new zero-import plan-turn.ts with planGate/planCommit, thunks for child/parse/resolve (NO probe thunk), injected buildAdvisorMessages/stripAdvisorMarkup; relocate buildCorrection (index.ts:23-40); replace t9 (tests/test.mjs:272-294); new battery (veto order, laziness, silent parse fail-open, resolution-notify format, consult completeness, commit assembly, interval ≤0); fix the invariant comment (:22-24) incl. the report.ts omission; doc Files lists.
6. Commit F - F007 cadence slide: shouldFire(turnIndex, interval, lastFiredTurn) in config.ts beside shouldGate (:101-105, which stays); lastFiredTurn=-1 in the factory closure (index.ts:44 region); update at gate-pass BEFORE vetoes; inject shouldFire into planGate; tests: fold parity (intervals 2/3 vs t1's exact sets), slide case, no-latch re-lock, interval ≤0, reload-early-fire pin; reconcile t1:144-149 wording.
7. Commit G - F009 + F017 (one pass, shared header): normalize a +-prefixed protected refspec as a force signal AND for the branch match; handle +HEAD:main and multi-refspec (block when any protected ref is +-forced); blocked cases near tests/test.mjs:738-740; force-with-lease stays allowed (:759); extract isHookInvocation/parseHookStdin/readHookField into lib.mjs (node builtins only); headers + AGENTS.md Files line.
8. Commit H - F018: describeSpawnResult(result) in lib.mjs; reorder feedback.mjs:19-24 (error → status===0 → signal → status; claim "timed out after 10s" only on status null + signal set); first syntaxCheck tests (valid file ok, broken file stderr, constructed {status:null, signal:"SIGTERM"} timeout shape) appended after tests/test.mjs:773.
9. Commit I - CI/tooling (F012 + F013): engines node ">=22.6.0" in package.json; engine-strict .npmrc; npm ci in ci.yml:15; matrix ["22.6.0", "24"] QUOTED (unquoted parses as a YAML float) at ci.yml:14; Node-floor notes at gate.mjs:14 and feedback.mjs:10.
10. Commit J - prose docs pass: F010 frontmatter (corrected glob set ["*.ts", "*.mjs", "*.md", "tests/**", "scripts/hooks/*.mjs"]); F011 three sites (main.md:35, AGENTS.md:41, main.md:31→tests/test.mjs) + hooks entries in main.md Files; F019 seven-field README table (+SKILL.md instance), wording per ship-empty decision; format + commit TECH_DEBT_AUDIT.md with quick-win checkbox stamps (:81,:84,:89,:90).

**Integration points:**
- advisor.ts:235-237 - the only production logic move in the series (F001).
- config.ts:57, :101-105 region, :106-109, :136-144 - latch helper, shouldFire addition, modelKey deletion, clamp warns.
- guard.ts:52-111 / index.ts:43-45, :61 - probe deletion; index.ts:53-58 - cadence rewrite under F007.
- NEW plan-turn.ts - receives planGate/planCommit + buildCorrection; NEW lib.mjs - receives hook parsing + describeSpawnResult.
- tests/test.mjs - every commit but A touches it (flips :181-183/:218; deletions :26 shrink, :246-256, :270, :380-400; appends after :639 and :773; t9 replacement :272-294).

**Patterns to follow:**
- Pure-core + injected siblings: scripts/hooks/gate.mjs:64-75 (evaluate), generalized by F006.
- Thunk injection for laziness: index.ts:55-62 short-circuit economics, preserved as thunks in planGate.
- Type-only host imports: index.ts:1,19-23; plan-turn.ts must runtime-import nothing.
- Discriminated result unions: {ok, reason} / {action, ...} shapes per layer.

**Risks:**
- F001 test masquerades green on regressed code (exit handler prints from process.exitCode, tests/test.mjs:29-32): mitigate with the red-first run in Commit C.
- Latch topology ambiguity (single shared vs separate clamp latch) reworks resetWarnOnceForTest: mitigate by co-landing F002+F014 in Commit B with the single shared latch (research-recommended, honors config.ts:49).
- t1:144-149 anti-threshold wording rots mid-sequence (gate stays green, docs mislead): acceptable; reconcile inside Commit F itself.
- tsc blind to all .mjs and biome proven non-exhaustive: mitigate by running npm test after every step (tests/test.mjs is the proven churn hotspot).

## Scope Boundaries
- Executing all 20 findings as ~10 gate-green commits in the order above.
- NOT redesigning the blocking turn_end call (F001 lands either way; the timer-unref decision stays deferred).
- NOT migrating .claude/settings.json to user-scoped paths (recorded no-fix).
- NOT changing the pi-coding-agent caret posture beyond the F008 comment and F012 lockfile discipline.
- NOT altering shouldGate/t1 (stays verbatim) or the raw "node --experimental-strip-types test.mjs" script form (F013 target).

## Testing Strategy

**Unit tests:**
- F001: sync-throw fixture callWithDeadline(() => { throw new Error("sync boom"); }, 50) - rejection surfaces, no unhandled rejection after ≥5× deadline, listener removed; RED-FIRST against unfixed code.
- F002: resetWarnOnceForTest in withConfig; t3 unchanged (exactly 1 per invocation); t4/t6 flip to 1.
- F014: Infinity interval clamps to min with field-naming warn; 2.7 truncation warns with "truncated" wording; wrong-typed field stays silent (negative assert).
- F006: veto order (probe gone; child spy uninvoked when vetoed earlier), laziness (off-cadence: thunks uninvoked), silent parse fail-open, resolution-failure notify format, consult completeness (messages === buildMessages(llmMessages), invoked once), advisor-error/markup-only commit formats, commit assembly with peers, interval ≤0.
- F007: fold parity vs t1's exact sets (intervals 2 and 3), error-at-boundary slide, stale-threshold single fire + re-lock, interval ≤0 never fires, reload early-fire pin.
- F009: blocked "git push origin +main", "+master", "git push --force origin +main", "+HEAD:main", mixed refspecs; force-with-lease stays allowed; reason string assert.
- F018: describeSpawnResult on {status:0}, {status:1, stderr}, {status:null, signal:"SIGTERM"}; syntaxCheck ok/broken-file on mkdtemp files.

**Integration tests:**
- Full npm test after every commit (suite must stay green; ordering-sensitive t2-t6 prove the F002 reset).
- CI matrix job exercises the Node 22.6 floor post-Commit I (the only runtime catch for @types/node ^26.6.6 admissions).

**Manual verification:**
- [ ] F010: paste fixed frontmatter through a YAML parser (no automated gate exists).
- [ ] F011/F019: execute every documented command/path verbatim (docs drifted at birth).
- [ ] Hooks: run one Claude Code session in this checkout; confirm gate blocks +main pushes and feedback reports node --check failures.
- [ ] TECH_DEBT_AUDIT.md passes npx biome check before Commit J.

## Open Questions

**Resolved during research:**
- Probe disposition - DELETE (fresh-jiti identity argument, guard.ts:20-27; no import route can reach the live ALS).
- Cadence at errored boundaries - fire on next completed turn (F007 shape adopted).
- modelKey - DELETE (advisor.ts:54,56,59 inlines its body; parseModelKey stays, config.ts:78-84).
- Shipped model default - SHIP EMPTY (gate disabled until cloners opt in via README).
- Execution strategy (this artifact) - per-finding, dependency-ordered commits.

**Requires user input:**
- F014 wording: does truncation (interval 2.7→2) warn as a clamp? Default: yes, message says "clamped or truncated".
- F013 scope: minimal (engines + npm ci) vs full (engine-strict + matrix). Default: full, quoted "22.6.0".
- F009 refspec shapes: block +HEAD:main and mixed-refspec forms? Default: block any +-forced protected ref.
- TECH_DEBT_AUDIT.md lifecycle: format + commit (stamped) vs biome.json exclusion. Default: format + commit in Commit J.
- Blocking turn_end UX (60s ceiling): keep blocking vs fire-and-forget precedent (advisor.ts:203-210). Default: keep blocking; answer before any timer-unref change.

**Blockers:**
- None. All decisions have defaults; every commit is independently executable.

## References

- .rpiv/artifacts/research/2026-10-29_11-16-22_tech-debt-fixes.md - verified F001-F020 line map, decisions, sequencing edges (source of truth for every file:line above)
- TECH_DEBT_AUDIT.md - original finding list (untracked; fails biome; format before Commit J)
- advisor.ts:215-242 - callWithDeadline and the F001 hole
- scripts/hooks/gate.mjs:52-57, :64-99 - force-push regexes + evaluate pattern
- tests/test.mjs:22-24, :129-150, :152-229, :272-294, :380-400, :621-639, :726-773 - invariant comment, t1 cadence pin, latch ordering tests, t9, t12, async-rejection guard, t19 hook contract
- config.ts:44-61, :101-109, :136-148 - clamps, latch, shouldGate/modelKey, clamp sites, systemPrompt fallback
- b1f3a16 / 829c948 - the precedent pair behind the selected shape
