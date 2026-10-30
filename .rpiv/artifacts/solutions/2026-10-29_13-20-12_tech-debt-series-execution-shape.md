---
date: 2026-10-29T13:20:12+0700
author: Yogiswara Utama
commit: 829c948
branch: main
repository: advisor-turn-gate
topic: "execution shape for the F001-F020 commit series (session structure, handoffs, lanes)"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, execution-mechanics, session-shape, tech-debt]
last_updated: 2026-10-29T13:20:12+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: execution shape for the F001-F020 commit series

**Date**: 2026-10-29T13:20:12+0700
**Author**: Yogiswara Utama
**Commit**: 829c948
**Branch**: main
**Repository**: advisor-turn-gate

## Research Question

The prior solutions artifact selected per-finding commits A-J for the 20 findings F001-F020. This analysis picks the execution shape: session structure, handoff usage, and parallelism.

## Summary

**Problem**: The 10-commit series is fully specified. The open question is how the executor runs it: one session, one session per commit, phase-grouped sessions, or a serial core with a parallel lane tail.
**Recommended**: Single-session pass - execute A-J in one session. Run the gate trio at every commit boundary. Zero ceremony; wall-clock lands at the plan's own floor. If context fidelity degrades, stop at a green boundary, write one handoff, and resume fresh. That switch costs nothing.
**Effort**: Med (~1.5-2 focused days; gate wall-clock is tens of minutes in total)
**Confidence**: High

## Problem Statement

**Requirements:**
- Land commits A-J with npm test, biome, and tsc green at every boundary.
- Obey the six hard sequencing edges (see Current State).
- Keep restart cheap when a session dies mid-series.
- Honor the red-first run inside commit C.

**Constraints:**
- Hard: the zero-sibling-import invariant (tests/test.mjs:22-24). One wrong runtime import in plan-turn.ts fails the whole suite at commit E.
- Hard: t1 pins the cadence sets verbatim (tests/test.mjs:129-150). shouldGate (config.ts:101-105) stays.
- Hard: the pre-commit hook is local-only (core.hooksPath) and omits tsc. No structural gate stops a red commit. The executor runs the trio explicitly.
- Soft: new .rpiv handoff files must not become dangling provenance (the F015 lesson).

**Success criteria:**
- The series lands green, in order, one commit per finding group.
- A dead session restarts at the next letter by reading two artifacts plus git log.
- No new failure surfaces beyond the plan's accepted ones (gate count, one red-first run).

## Current State

**Existing implementation:**
The repo is two commits old at 829c948. The commit plan A-J and the verified line map live in two untracked artifacts under .rpiv/artifacts/. Execution tooling exists: the gate trio (package.json:9-12, mirrored at .github/workflows/ci.yml:14-17), a local-only pre-commit hook (.githooks/pre-commit:3-5), and the create-handoff / resume-handoff skill pair. No handoff file exists in this repo. The skills have zero recorded usage here.

**Relevant patterns:**
- Per-finding, gate-verified commits: the recorded lesson from b1f3a16 to 829c948. The only big-bang needed a cleanup commit 4 minutes later.
- Run npm test after every step: tests/test.mjs is the proven churn hotspot.
- Gate activation does not travel with clones or worktrees: core.hooksPath is local config.

**Integration points:**
- tests/test.mjs - 8 of 10 commits touch it. Only I and J do not (correction 1 below).
- gate.mjs and feedback.mjs headers - G rewrites them, H reorders feedback, I adds Node-floor notes. I must follow G and H.
- AGENTS.md - touched by B (:18), D (:16), G (Files line), and J (:41) in disjoint regions.
- TECH_DEBT_AUDIT.md - untracked and biome-failing today. Only J includes it, after a format pass.

**Corrections found during candidate fit (feed design and plan):**
1. The prior artifact states "every commit but A touches tests/test.mjs". That is wrong. Commit A's own step list shrinks t7b (tests/test.mjs:246-256) and the readFileSync import (:26). The research makes the import shrink mandatory. Correct count: 8 of 10 commits touch the file. Only I and J do not.
2. The artifacts cite the exit handler at tests/test.mjs:29-32. The real location is tests/test.mjs:76-79 (process.on("exit") prints from process.exitCode). The t12 block sits at :376-404, not :380-400. Re-anchor by test name. Never trust the stale 829c948 line numbers.

## Solution Options

### Option 1: Single-session pass
**How it works:**
One agent session lands A-J in order in this checkout. After each commit it runs npm test, npm run lint, and npm run typecheck, and commits only on green. No handoffs, no worktrees, no lanes.

**Pros:**
- Zero coordination ceremony. The two artifacts already carry all state, so handoffs add cost without new information.
- Wall-clock lands at the plan floor (~1.5-2 focused days). Each gate run takes seconds. The suite is offline with waits bounded near 1.5s (tests/test.mjs:621-639).
- Strongest precedent fit. The recorded lesson constrains commit granularity, not session count. One writer on one branch matches the whole repo history.
- Recovery is artifact-complete. Each green boundary is a restart point. A dead session reads two artifacts plus git log and resumes at the next letter. Cost: minutes, not reconstruction.

**Cons:**
- One long context window spans ~1.5-2 days of edits. Compaction can degrade fidelity late in the series.
- Highest gate count: ~31 trio invocations (30 boundary runs, C's red-first run, the audit format check before J).
- Line-map decay is handled in-session by re-anchoring per commit.

**Complexity:** Medium (~1.5-2 days)
- Files to create: 2 (plan-turn.ts ~150-250 lines with its battery; lib.mjs ~40 lines)
- Files to modify: ~12 (unchanged from the plan)
- Risk level: Low (every step independently revertable; no unverified state)

### Option 2: Session-per-commit
**How it works:**
Ten fresh sessions. Each consumes a one-commit handoff note, lands exactly one commit green, then writes the next handoff and stops. The create-handoff / resume-handoff pair carries state between hops.

**Pros:**
- Best restart granularity. The handoff SHA and the commit boundary are the same point. A red at session k+1 names commit k without a bisect.
- Every commit is authored in a clean context.

**Cons:**
- Ceremony is strictly additive. Ten handoff writes cost ~5-10 minutes each. Ten interactive resumes cost ~10-15 minutes each, with two user confirmations and research-agent spawns per hop. Total: about 4-6 hours and ~20 user interactions.
- The resume flow's per-hop research step is redundant ten times over. The spec already lives in two finished artifacts.
- Line-map staleness compounds across 10 hops. Each note must refresh test.mjs anchors or it lies.
- No in-repo precedent for handoff files. Ten new .rpiv artifacts create a fresh F015-class rot surface.
- Wall-clock grows ~30-50%: about 2-2.5 focused days against the planned 1.5-2.

**Complexity:** Medium (~2-2.5 days)
- Files to create: the same 2 plus 10 handoff notes
- Risk level: Low-Medium (note fidelity becomes a load-bearing surface)

### Option 3: Phase-grouped sessions
**How it works:**
Four fresh sessions aligned to the dependency edges: [A,B,C], then [D,E,F], then [G,H,I], then [J]. One handoff per phase boundary.

**Pros:**
- Fresh window at the heaviest work. Commit E opens phase 2 clean, where a single session reaches it with a loaded context.
- The order-dependent latch tests t2-t6 (tests/test.mjs:152-229) live entirely inside phase 1.
- Phase boundaries create 3 named, documented resume points. The tooling also degrades gracefully into an unplanned mid-phase handoff if a session dies.

**Cons:**
- +2-3 hours of handoff and resume ceremony against the single-session floor.
- The line map drifts at every boundary (t9, t12, t19 anchors move). Each fresh session must re-anchor by test name.
- Cross-phase state must survive summarization: the untracked audit file, the ship-empty decision, and the open-question defaults.

**Complexity:** Medium (~1.5-2 days plus 2-3 hours)
- Risk level: Low (same commit plan; only the context holder changes)

### Option 4: Core chain + parallel side lanes
**How it works:**
Commits A-H land serially. Then I (CI/tooling) and J (prose docs) run as two parallel worktree lanes branched from H's tip. Each lane merges back with a post-merge gate run.

**Pros:**
- I and J are the only commits with zero tests/test.mjs surface and zero file overlap. They form the one safe parallel pair.
- A red lane blocks only itself.

**Cons:**
- Near-wash on wall-clock. The tail saves ~1-3 hours. Worktree setup, per-worktree hooksPath activation, merge runs, and context bootstrap cost ~1-2 hours.
- Two merge points are two new failure surfaces. The post-merge trio must not be skipped.
- Fresh worktrees cannot see the untracked artifacts or TECH_DEBT_AUDIT.md. Lane agents need absolute paths and a file copy.
- The recorded lesson cuts against unconsidered worktrees: core.hooksPath is local-only, so each lane starts with a silently inactive pre-commit. That is the exact b1f3a16 failure mode.
- Lane-I is safe only when branched from H's tip. An earlier branch collides on the rewritten gate.mjs and feedback.mjs headers.

**Complexity:** Medium (~1.5-2 days with a restructured tail)
- Risk level: Medium (merge surfaces, hook inactivity, worktree context loss)

## Comparison

| Criteria | Opt 1 single-session | Opt 2 per-commit | Opt 3 phase-grouped | Opt 4 lanes |
|----------|---------------------|------------------|---------------------|-------------|
| Complexity | M | M | M | M |
| Codebase fit | High | Low-Med (no precedent) | Med | Low-Med |
| Risk | Low | Low-Med | Low | Medium |
| Wall-clock | 1.5-2 days (floor) | 2-2.5 days | 1.5-2 days +2-3 h | 1.5-2 days, tail wash |
| Ceremony | None | 10 handoffs + 10 resumes | 3 handoffs + 3 resumes | 2 worktrees + 2 merges |
| Restart path | Next letter via artifacts | Handoff chain | Phase handoff | Lane-local + merges |

## Recommendation

**Selected:** Option 1 - Single-session pass

**Rationale:**
- Ceremony adds no information here. The solutions artifact carries every touch list and the research carries every anchor. Handoffs duplicate state that already exists on disk.
- Wall-clock lands at the plan's own floor. Every alternative adds hours of coordination the plan does not need.
- The risk profile is the plan's accepted one: ~31 cheap gate runs, one deliberate red-first run, pinpointed per-commit recovery.

**Why not alternatives:**
- Option 2: +4-6 hours and ~20 user interactions of additive ceremony. Staleness and note-fidelity risks grow with every hop. Nothing in the artifacts offsets the cost.
- Option 3: the strongest alternative and the designated fallback. It buys a clean window at commit E and documented resume points. The plan's near-zero rediscovery cost makes that hedge useful only if the single session actually degrades.
- Option 4: the tail saving is a wash after worktree and merge ceremony. It adds the hook-inactivity and untracked-context hazards for no floor reduction.

**Trade-offs:**
- Accepting one long context window in exchange for zero ceremony. Overflow stops at a clean green boundary, so the worst case is one restart-and-reread, not re-execution.
- Accepting the highest gate count. Each run takes seconds.
- Accepting in-session re-anchoring after verified line drift.

**Implementation approach:**
1. Preflight - read both artifacts. Note the two corrections above. Check git status clean.
2. Land A-J in order. After each commit run npm test, npm run lint, and npm run typecheck. Commit only on green.
3. Commit C - land the new test first. Run npm test and observe the expected red (check that the rejection surfaces and the exit handler stays clean). Then apply the advisor.ts:235 move. Then green.
4. Re-anchor by test name and section banner (t1-t19). Never by 829c948 line numbers.
5. Before J - format TECH_DEBT_AUDIT.md with npx biome check. Run the four manual checks (F010 YAML paste-through, F011 and F019 verbatim commands, one live hooks session).
6. Escalation rule - if compaction or drift makes fidelity suspect at any boundary, stop, write one handoff, and resume fresh. The switch is free at every green boundary.

**Integration points:**
- advisor.ts:235-237 - the only production logic move (C).
- config.ts:57 region, :101-109, :136-144 - latch helper, shouldFire, modelKey deletion, clamp warns (B, F).
- guard.ts:52-111 and index.ts:43-45, :61 - probe deletion (D).
- NEW plan-turn.ts and NEW lib.mjs - born in E and G.
- tests/test.mjs - 8 of 10 commits touch it.

**Patterns to follow:**
- Per-finding, gate-verified commits: 829c948.
- npm test after every step: the churn-hotspot lesson.
- Type-only host imports for plan-turn.ts: index.ts:1, :19-23.

**Risks:**
- Long-session fidelity decay: mitigate with the escalation rule (stop at a green boundary, hand off, resume).
- Line-map drift: mitigate by re-anchoring per test name. Two drifts are already verified.
- Red masquerade at C: mitigate with the red-first run and the exit-handler check at tests/test.mjs:76-79.
- Silent red commit (hook inactive): mitigate by running the trio explicitly at every boundary.

## Scope Boundaries
- Execute the A-J series in one session under the boundary protocol above.
- NOT changing the commit plan, its order, or its touch lists.
- NOT writing handoffs unless the escalation rule fires.
- NOT touching the deferred decisions (timer-unref, settings migration, shouldGate/t1, raw test script form).

## Testing Strategy

**Unit tests:**
- Unchanged from the plan: F001 sync-throw (red-first), F002 latch flips, F014 clamp and truncation warns, F006 planGate battery, F007 fold parity, F009 refspec blocks, F018 describeSpawnResult.

**Integration tests:**
- Full npm test after every commit. The suite must stay green through the latch-dependent t2-t6 window.
- The CI matrix job exercises the Node 22.6 floor after commit I lands.

**Manual verification:**
- [ ] F010 frontmatter passes through a YAML parser.
- [ ] Every F011 and F019 documented command and path executes verbatim.
- [ ] One live Claude Code session in this checkout: the gate blocks a +main push, and feedback reports node --check failures.
- [ ] TECH_DEBT_AUDIT.md passes npx biome check before commit J.

## Open Questions

**Resolved during research:**
- Can any shape break the sequencing edges? No. All six edges resolve to commit order in a serial lane. Every candidate preserves them by construction.
- Does tooling support multi-session shapes? Yes. create-handoff and resume-handoff are contract-matched and installed. Both fit agents flagged the F015-class rot risk for new .rpiv files and the interactive resume cost.
- Does parallelism pay on this plan? No. Only I and J are test.mjs-free and disjoint. The ~1-3 hour tail saving is consumed by ~1-2 hours of worktree and merge ceremony.

**Requires user input:**
- None blocking. The escalation rule needs no pre-decision. It fires only on observed decay.

**Blockers:**
- None. Every commit is independently executable from the two artifacts.

## References

- .rpiv/artifacts/solutions/2026-10-29_12-55-09_tech-debt-fix-execution-strategy.md - the A-J commit plan and touch lists (input to this analysis)
- .rpiv/artifacts/research/2026-10-29_11-16-22_tech-debt-fixes.md - verified line map, decisions, recorded lessons
- tests/test.mjs:22-24, :76-79, :152-229, :376-404, :621-639 - invariant, real exit-handler location, latch order tests, t12 block, timer-wait bounds
- package.json:9-12 and .github/workflows/ci.yml:14-17 - the gate trio
- .githooks/pre-commit:3-5 with AGENTS.md:27 - local-only hook activation
- create-handoff / resume-handoff SKILL.md under @juicesharp/rpiv-pi skills - the handoff contract (fallback path)
