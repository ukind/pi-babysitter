---
date: 2026-11-02T08:36:12+0700
author: Yogiswara Utama
commit: faae538
branch: main
repository: advisor-turn-gate
topic: "jarvis-advisor-evolution"
confidence: high
complexity: high
status: ready
verdict: pass
tags: [solutions, advisor-turn-gate, triggers, memory, dialogue, tools, specialists, async, eval]
last_updated: 2026-11-02T08:36:12+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: jarvis-advisor-evolution

**Date**: 2026-11-02T08:36:12+0700
**Author**: Yogiswara Utama
**Commit**: faae538
**Branch**: main
**Repository**: advisor-turn-gate

## Research Question
Evolve the one-shot, blind, stateless advisor gate into a JARVIS-grade advisory system: dialogue across fires, local memory, multi-signal triggers, read-only advisor tools, on-demand specialist consults, a prompt budget, an optional async fire mode, and an offline eval harness — without breaking the never-throw/fail-open contract, the star topology, or backward compatibility.

## Summary
**Problem**: The gate fires on cadence only, ships the full transcript, keeps no state, sees no files, consults no one, and blocks turn_end for up to 60s — eight FRD pillars must land without breaking fail-open, star topology, or pinned test contracts.
**Recommended**: Sliced pillar releases — each FR lands as its own config-gated slice (pure spoke + config fields + pinned tests + one commit series), in dependency order, with the sanctioned eval/ split as the terminal slice. It is the only candidate whose every dimension came back fits-or-mild-friction, and it is literally the shape of the repo's own remediation history.
**Effort**: Med (~6-9 working days across 8 slices)
**Confidence**: High

## Problem Statement

**Requirements:**
- FR1 dialogue: the advisor sees its own prior exchanges across fires.
- FR2 memory: per-project local store, digest injected per fire, count-cap retention.
- FR3 multi-signal triggers: token growth, context pressure, trouble outcome, risky tools — arms ahead of cadence.
- FR4 read-only advisor tools: tool loop over completeSimple, allowlisted sandbox reads, bounded rounds.
- FR6 specialist consult: declared consult_specialist tool, one extra model leg, single aggregated entry.
- FR7 prompt budget: rolling summary fold + verbatim tail under a clamp-guarded token field.
- FR8 async fire: turn_end abstains, result commits at the next agent_before_settle.
- FR9 eval harness: second offline runner, golden fixtures, score-gated CI.

**Constraints:**
- Hard: never throw / fail-open with test-pinned reason strings; star topology (index.ts sole runtime-loaded hub; pure spokes zero runtime imports); zero runtime npm dependencies; 1.4.x host (feature-detect, disable below); mandatory peer spread on every commit; strip stays the last filter (F023 byte-identity discipline).
- Soft: single-purpose commits each carrying a regression test; per-field config narrowing + clampWithWarn; one test file until the sanctioned split trigger.

**Success criteria:**
- All eight pillars live behind config, default-off where behavioral.
- Existing suite stays green throughout; every new failure path has an exact-string pin.
- CI (test + lint + typecheck) green on every slice; eval scores gate FR9.

## Current State

**Existing implementation:**
- Hub owns I/O only: config read per dispatch (index.ts:41), thunk binding (index.ts:46-68), the single advisor await (index.ts:67-75), latch write (index.ts:63-66), planCommit + return (index.ts:77-87).
- planGate arm order pinned (plan-turn.ts:93-121): disabled -> no model -> cadence -> outcome completed -> markFired (:104, spend-at-gate-pass) -> child veto -> parse -> resolve.
- planCommit strips then commits exactly one custom_message draft with the mandatory peer spread (plan-turn.ts:23-38, :145-160).
- advisor.ts: single call site (advisor.ts:305-309), tools: [] (advisor.ts:21-26), stop-only gate (advisor.ts:311-317), shared callWithDeadline (advisor.ts:212-247), markup tiers + byte-identical guard (advisor.ts:114-198).
- config.ts: per-field narrowing (config.ts:166-204), clampWithWarn MIN/MAX (config.ts:49-52, :81-93), CONFIG_URL beside-module (config.ts:55).
- prompt.ts: full-transcript ship today (prompt.ts:77-84), stripToolDeclarations (prompt.ts:32-49), ensureUserTail (prompt.ts:52-62).
- tests/test.mjs: single file ~1,257 lines, plain node:assert, stubbed facade, withConfig (tests/test.mjs:67-80); documented split rule at ~1,500 lines or second runner (TECH_DEBT_AUDIT.md).

**Relevant patterns:**
- Pure-core extraction with thunk injection: plan-turn.ts (084b1f8, F006) — reused by every candidate slice.
- Cadence slide past errored turns with fold-parity pins (ad697e5, F007) — template for trigger-arm pins.
- Beside-module personal state, untracked (1690b9e, F024) — template for the memory store.
- Structural *-Like host interfaces (advisor.ts:16-19, report.ts:14-18, guard.ts:45-48) — template for the fs sandbox and any new reach.

**Integration points:**
- plan-turn.ts:99-104 — where trigger arms insert; markFired position is pinned semantics.
- prompt.ts:77-84 — where the budget window folds (strip -> window -> ensureUserTail).
- config.ts:166-204 — where every new field narrows.
- advisor.ts:305-317 — where the tool loop wraps the single call and toolUse legality re-derives the gate.
- index.ts:67-75 + agent-session.js:1567-1581 — where async mode splits the await across two boundaries.
- custom_message replay (session-manager.d.ts:78-80) — where dialogue rehydration is free.

## Solution Options

### Option 1: Sliced pillar releases
**How it works:**
Land each FR as one config-gated slice: extract the pure spoke first, wire thunks in index.ts, add clamp-guarded config fields, pin every new reason string, ship as its own commit series. Order follows dependency: FR3 triggers -> FR7 budget -> FR2 memory -> FR1 dialogue -> FR4 tools -> FR6 specialists -> FR8 async -> FR9 eval. No existing spoke is restructured.

**Pros:**
- Precedent-fit is maximal: 11 remediation commits already follow exactly this shape (TECH_DEBT_AUDIT.md:17; 084b1f8, ad697e5, 1690b9e verified).
- Migration-cost fits: per-slice delta is the 084b1f8 shape (one zero-import spoke + args field + config field); shared seams (PlanGateArgs, loadConfig, index.ts wiring) take additive-only changes, so merge conflicts stay shallow.
- Every slice ships value independently; a stalled series leaves the gate fully functional at the last landed slice.

**Cons:**
- Verification-cost friction: eight slices at ~40-60 assertions blow the single test file past ~1,500 lines before FR9 — resolved only because FR9's eval/ is the sanctioned second runner.
- Shared-seam churn: five of eight pillars touch plan-turn.ts args or config.ts (additive, but review load concentrates).

**Complexity:** Med (~6-9 days)
- Files to create: ~8 spokes/sandboxes/runner (~1,200 lines total)
- Files to modify: 5 (index.ts, plan-turn.ts, advisor.ts, config.ts, prompt.ts; ~400 lines additive)
- Risk level: Low (each slice re-proves fail-open in isolation)

### Option 2: Kernel + capability modules
**How it works:**
First refactor index.ts/plan-turn.ts into a fire-pipeline kernel with pluggable slots (pre-fire planner, leg executor, aggregator), then land all eight pillars as slot modules composed by the kernel.

**Pros:**
- Precedent-fit fits: kernel extraction is the house move scaled up; slots map 1:1 onto existing injection sites (plan-turn.ts:69-79, index.ts:40-66).
- After the refactor, pillars are genuinely independent modules; the shape is the cleanest end-state.

**Cons:**
- Migration-cost friction: the kernel landing is a big-bang rewrite of the only runtime hub plus a re-cut plan-turn.ts, forcing re-pins across ~24 test sections before any pillar ships.
- Verification-cost friction: FR8 still needs the brand-new two-event seam test; the refactor buys no early user value.
- Risk is paid up front; a mid-refactor stall leaves the extension in a half-migrated state.

**Complexity:** High (~10-14 days)
- Files to create: kernel + slot interfaces + 8 modules (~1,800 lines)
- Files to modify: index.ts and plan-turn.ts wholesale; test re-pins across the suite
- Risk level: Med (big-bang against the sole runtime hub)

### Option 3: Tool-loop-centric
**How it works:**
Push most new capability into the advisor's declared tool set (read_file, recall_memory, consult_specialist); planGate stays thin (cadence + async); complexity concentrates in the sandbox/loop and prompt budget.

**Pros:**
- Precedent-fit fits: every pillar extends an existing seam or clones a beside-module/structural-interface precedent; FR1 is pure precedent harvest.
- Concentrates novelty in one subsystem, making the hard safety argument (toolUse legality) a single place.

**Cons:**
- Integration-risk friction is the highest of the four: tools: [] is load-bearing twice (advisor.ts:21-26, prompt.ts:32-49) and the stop-only gate's truncation-inlet argument (advisor.ts:311-317) must be re-derived, not extended.
- Does not actually cover FR3: multi-signal triggers are plan arms by nature, so the candidate silently collapses into Option 1 for a third of the scope.
- Overturns two documented deliberate decisions (full-transcript ship banner, stop-only gate) in one move — review surface concentrates exactly where the safety story is thinnest.

**Complexity:** Med-High (~8-11 days)
- Files to create: sandbox, tool defs, loop harness (~900 lines)
- Files to modify: advisor.ts widest (loop around completeSimple), plus the same five as Option 1 for the non-tool pillars
- Risk level: Med (re-opens the truncation inlet the strip tiers close)

### Option 4: Parallel v2 extension
**How it works:**
Clone the star topology into a sibling extension folder, land each pillar behind v2's own config gates, reach parity, then cut over and retire v1.

**Pros:**
- Integration-risk fits by deferral: v1's seams stay untouched until cutover; v1's suite stays green untouched throughout.
- Verification-cost fits: regression safety is inherited, not rebuilt.

**Cons:**
- Migration-cost friction: wholesale ~1,900 LOC clone; strip tiers, marker veto, and clamp machinery exist twice until retirement; F023 byte-identity discipline now applies across two copies.
- Deferred risk is not eliminated risk: FR8 still must re-derive the peer spread at the settle boundary at cutover; cutover itself is a seam event with no precedent (no two-live-extensions history exists in this repo).
- customType collision: v2 sharing the entry type conflicts with the reload filter/denylist; a new one orphans FR1 dialogue replay of v1-era entries.

**Complexity:** High (~12-16 days including dual-maintenance and cutover)
- Files to create: full v2 folder (~2,200 lines) 
- Files to modify: none in v1 until cutover, then a retirement series
- Risk level: Med (concentrated at cutover)

## Comparison

| Criteria | Sliced releases | Kernel + modules | Tool-loop-centric | Parallel v2 |
|----------|----------------|------------------|-------------------|-------------|
| Complexity | M | H | M-H | H |
| Codebase fit | H | H | M | M |
| Risk | L | M (up-front) | M (seam-local) | M (deferred to cutover) |
| First value shipped | slice 1 | after refactor | mid-series | after parity |
| Covers FR3 naturally | yes | yes | no (collapses to sliced) | yes |

## Recommendation

**Selected:** Option 1 — Sliced pillar releases

**Rationale:**
- Only candidate with no friction beyond the shared, pillar-inherent seams (markFired ordering, peer spread, toolUse legality) that every option must face anyway; the other three each add a strategy-inherent risk on top (big-bang hub rewrite, truncation-inlet re-derivation, cutover event).
- Precedent-fit is empirically the strongest: the repo's own 22-commit history is this exact shape, each commit single-purpose with a regression test (verified across git log; TECH_DEBT_AUDIT.md:17).
- Dependency-true order keeps every slice independently shippable and independently revertible; additive-only changes to the three shared seams keep conflicts shallow (agent-verified against PlanGateArgs and loadConfig).

**Why not alternatives:**
- Option 2: pays the big-bang hub rewrite before shipping any pillar; the clean slot end-state is buyable later if slice growth ever demands it.
- Option 3: not a full answer — FR3 triggers are plan arms regardless, so it degenerates to Option 1 plus a concentrated FR4/FR6 risk; its best idea (capability in the tool set) is absorbed below.
- Option 4: doubles every load-bearing mechanism until cutover and introduces an unprecedented cutover seam for risk that is deferred, not removed.

**Trade-offs:**
- Accepting single-test-file growth to the ~1,500-line sanctioned trigger in exchange for never blocking a slice on runner work; eval/ arrives exactly when the rule fires.
- Accepting mid-series review load on plan-turn.ts/config.ts in exchange for additive-only, low-blast-radius diffs.

**Implementation approach (slice order):**
1. FR3 triggers — pure trigger-predicate spoke (usage delta, ctx.getContextUsage, outcome, risky toolResults); arms insert before cadence; fold-parity pins like t1b; ~1 day.
2. FR7 budget — window fold between strip and ensureUserTail; tokenBudget clamp field; pure per-message rollup fold, no second model call; keep all system messages or fold section replay before cutting; ~1 day.
3. FR2 memory — memory.ts spoke, beside-module per-ctx.cwd store, count-cap newest-kept clamp field, digest as synthetic post-strip system message; gitignore from day one; ~1 day.
4. FR1 dialogue — filter llmMessages/entries for prior customType entries; stamp details (fire id, turn index, fault class) at commit for stable keys; ~0.5 day.
5. FR4 tools — widen CompleteSimpleFn type first; sandbox spoke behind an fs *-Like interface with pinned refusal string; bounded rounds + per-fire token field inside callWithDeadline; re-derive the toolUse safety argument in the gate banner; ~1.5 days.
6. FR6 specialists — declared consult_specialist tool; one extra completeSimple leg inside the same deadline; separator that survives the 3+-newline collapse (advisor.ts:186-190); failure arm commits base-only + reportFailure; ~1 day.
7. FR8 async — turn_end returns undefined (abstain); detached call holds result in closure; agent_before_settle commits with the settle event's accumulator spread; once-only clear; fail-open settle handler; ~1 day.
8. FR9 eval — eval/ second runner (the sanctioned split), golden fixtures per pillar (toolUse script, consult aggregation, budget window, allowlist refusal, trigger arms), score gates in CI; ~1-1.5 days.

**Integration points:**
- plan-turn.ts:99-104 — trigger arms before cadence; markFired position untouched.
- prompt.ts:77-84 — window fold order: strip -> budget -> ensureUserTail.
- config.ts:166-204 — ~5 new fields (trigger thresholds, tokenBudget, memory cap, max rounds, specialist model), each MIN/MAX + clampWithWarn + narrowing.
- advisor.ts:305-317 — loop wraps the single call; stop-only gate widens with a re-derived argument.
- index.ts:67-75 — thunk wiring per slice; FR8 adds the before_settle registration.
- Commit path plan-turn.ts:145-160 — details stamping for FR1 keys; strip stays last.

**Patterns to follow:**
- Pure-core extraction with thunk injection: plan-turn.ts (084b1f8).
- Beside-module untracked state: config.ts:55, 1690b9e.
- Fold-parity interval pins: tests/test.mjs:129-151 (t1b).
- Byte-identity guard for any new strip/refusal vocabulary: advisor.ts:114-160 (F023).

**Risks:**
- Trigger arm misordering double-fires or starves the latch: pin arm-order folds before wiring (t9 style).
- toolUse re-opens the truncation inlet: re-derive the safety argument in the banner, keep the strip as backstop, guard new vocabulary byte-identically.
- FR8 peer spread at a second boundary: derive spread from the settle event's own accumulator; dedicated two-event seam test.
- Suite crosses ~1,500 lines mid-series: that is the sanctioned trigger; split into eval/ at FR9, not before.

## Scope Boundaries
- Building: the eight FRD pillars as config-gated slices on the existing extension, per the slice order above.
- Not building: advisor write access (suggest-only, always), any channel to the user beyond the transcript, always-on specialists (on-demand consult only), waking an idle agent (commit at natural boundaries only), memory beyond count-cap retention, live-model eval runs.

## Testing Strategy

**Unit tests:**
- Trigger arms: interval-set fold parity, arm-order pins, no-spend on untriggered turns.
- Budget: window determinism, tail stays user, system-section replay never orphaned.
- Memory: cap newest-kept, per-project keying, ENOENT-silent + broken-JSON-warn-once paths.
- Tool loop: scripted stub sequences (toolUse then stop), allowlist refusal pin, round/token caps.
- Specialists: consult leg aggregation to ONE entry, separator survives whitespace repair, base-only fail arm.
- Async: once-only settle commit, abstain returns undefined, fail-open settle handler.

**Integration tests:**
- eval/ golden fixtures: seeded llmMessages + config -> planGate -> scripted facade -> planCommit -> assert committed entry; drift-caught, repeat-avoided, budget-respected, refusal, single-entry aggregation scores.

**Manual verification:**
- [ ] Gate still disabled by default (empty model) after every slice.
- [ ] Config edits apply without reload on every new field.
- [ ] Async mode off by default; blocking path unchanged.
- [ ] Peer extensions' drafts survive a fire with and without async mode.

## Open Questions
**Resolved during research:**
- Can the advisor tool loop exist without host changes? Yes — completeSimple accepts tools?: Tool[] and returns toolUse (model-runtime.d.ts:101-107, pi-ai types.d.ts:267-283, :543-547).
- Is dialogue state free? Yes — custom_message entries replay into LLM context as user messages (session-manager.d.ts:78-80).
- Does async fire need a wake mechanism? No — abstention (return undefined) plus agent_before_settle covers it (runner.js:774-777, agent-session.js:1567-1581).

**Requires user input:**
- Latch scope across child sessions (index.ts:32) — accept per-session isolation, or fund a runtime probe before FR1.
- The offline definition of "advice adopted on the forced continuation" for FR9 scoring — default assumption: an outcome flip to completed after the advice entry, upgradeable later.

**Blockers:**
- None. Version skew is decided (require 1.4.x, feature-detect event fields, notify once + disable below).

## References
- .rpiv/artifacts/research/2026-11-01_21-23-59_jarvis-advisor-evolution.md — verified host surface for all eight pillars.
- .rpiv/artifacts/discover/2026-11-01_21-07-45_jarvis-advisor-evolution.md — FRD with delegated decisions.
- .rpiv/guidance/architecture.md — star topology, boundary/config/test contracts.
- TECH_DEBT_AUDIT.md — 28-finding ledger; F008 reach exception, F023 guard discipline, test split rule.
- plan-turn.ts:93-121 — arm order and latch semantics every slice must respect.
- advisor.ts:212-247, :283-333 — deadline and call site the loop and consult leg wrap.
- config.ts:166-204 — the one door every new field walks through.
- tests/test.mjs:129-151, :67-80 — fold-parity and withConfig patterns new pins copy.
