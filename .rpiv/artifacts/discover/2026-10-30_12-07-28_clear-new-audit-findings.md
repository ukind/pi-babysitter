---
date: 2026-10-30T12:07:28+0700
author: Yogiswara Utama
commit: 236cc25
branch: main
repository: advisor-turn-gate
topic: "Clear new audit findings F021-F028 and F008"
tags: [intent, frd, gate-mjs, advisor, config, hooks]
status: ready
last_updated: 2026-10-30T12:07:28+0700
last_updated_by: Yogiswara Utama
---

# FRD: Clear new audit findings F021-F028 and F008

## Summary
Fix all 8 new findings (F021-F028) from TECH_DEBT_AUDIT.md plus the still-open F008, in one pass at HEAD 236cc25. Each fix follows the audit recommendation, adjusted where the probe proved a deeper root cause (F021/F022 share one per-token fix). Every fix carries a regression fixture, so the next audit repeats nothing.

## Problem & Intent
The developer's framing: **"Future maintainer — open findings rot the next audit and drift into real breakage later."** The audit verified 9/9 claims at current HEAD. The intent is to clear the new findings now, while each site is fresh and the audit's evidence is current, instead of carrying known defects into the next repeat run.

## Goals
- F021: close the force-push bypass for fully-qualified refspecs (`refs/heads/main`, `+refs/heads/main`, `HEAD:refs/heads/main`).
- F022: attribute the `+` force marker per refspec, so an unforced `main` in a compound push is no longer blocked.
- F023: strip fake tool-call markup in the `function_calls` and `invoke` dialects before it reaches the durable transcript.
- F024: make the shipped state and README.md:9-10 agree, by untracking config.json and shipping config.example.json with an empty model.
- F008: accept the caret range on the host package explicitly, in writing, at the reach site.
- F025/F026/F027/F028: the four single-edit hygiene items, each with its audit-recommended resolution.
- One regression fixture per behavior change, in the existing t19b and t15b blocks.

## Non-Goals
- F020 (undici advisories): dev-only, no local fix, tracked upstream. Excluded by decision.
- The audit's maintainer open questions (child-session latch sharing, .claude launch points, user-global stale rule, blocking-call UX). Out of scope; listed as follow-ups.
- No refactor beyond the findings. No new modules. No new dependencies. No feature work.

## Functional Requirements
1. **F021+F022 — per-token refspec matcher.** `blocksProtectedForcePush` (gate.mjs:62-80) SHALL test each normalized refspec token against the protected-branch shape instead of testing the rejoined command string, because the current `join(" ")` (gate.mjs:74-76) destroys which token carried the `+`. The shape SHALL accept optional `refs/heads/` prefix and optional `HEAD[:n]:` prefix with optional `refs/heads/` after the colon, so all of these block when forced: `git push --force origin refs/heads/main`, `git push origin +refs/heads/main`, `git push -f origin HEAD:refs/heads/main`. The compound push `git push origin main +feature/x` (unforced main) SHALL stay allowed. Existing t19b allowed forms (`--force-with-lease origin main`, `+feature/x`, `feature/x`) SHALL stay allowed.
2. **F023 — widen markup vocabulary.** The vocabulary group in tiers 2, 2b, 3 and the guard `TOOL_MARKUP_PATTERN` (advisor.ts:122-123, 133, 144, 156) SHALL become `(?:tool_call|function_calls|function|parameter|invoke)`, longest alternatives first. The documented invariant "guard-hit implies tier-hit" (advisor.ts:152-155) SHALL hold: every guard alternative has a covering tier with the same `<\/?` prefix and `\b` suffix.
3. **F024 — untrack shipped config.** The repo SHALL `git rm --cached config.json`, add config.json to .gitignore, and commit a config.example.json with `"model": ""` and the remaining fields at code defaults (narrowed per-type against DEFAULT_CONFIG rules). README.md:9-10 ("ships disabled") SHALL become true for a fresh clone.
4. **F025 — delete dead gate helper.** `shouldGate` (config.ts:131-134) SHALL be deleted; the t1 modulo expectations SHALL fold into t1b as inline references.
5. **F026 — one shared timeout constant.** A named constant (for example `SYNTAX_CHECK_BUDGET_MS = 10_000`) SHALL live in lib.mjs; feedback.mjs:23 SHALL import it, and the describeSpawnResult timeout message (lib.mjs:62) SHALL derive from it, so the two literals cannot drift.
6. **F027 — reword out-of-repo citation.** The guard.ts:43-45 comment SHALL name the host user settings as outside this repo instead of citing "settings.json:84-90". The t11 assertion SHALL stay.
7. **F028 — empty-string error message.** advisor.ts:315 SHALL use `response.errorMessage || fallback` so `errorMessage: ""` yields the fallback reason, never the bare prefix "advisor-turn-gate: ".
8. **F008 — caret risk recorded.** package.json:20 SHALL keep `^1.4.0`. The advisor.ts banner at the documented public class field (advisor.ts:69 area) SHALL state in writing that a caret minor bump can move the facade slot, and that the accepted mitigation is the per-gate-pass report.

## Non-Functional Requirements
- **Performance**: no specific constraint. The per-dispatch config read (config.ts:170) stays as designed.
- **Security**: the force-push gate blocks every forced protected-branch form, including fully-qualified refspecs. The markup stripper keeps its identity behavior for innocent inputs (mid-tag cuts, `<file.ts:10>`); only fake tool-call dialects route into removal.
- **UX / Accessibility**: warn-once clamp messages and TUI failure reports unchanged. No new user-visible strings except fixture-pinned ones.
- **Reliability**: every path fails open. No new throw paths. Result shapes stay `{ok, reason}` / `{ok, detail}` with test-pinned reason strings.

## Constraints & Assumptions
- TypeScript strict; `npx tsc --noEmit` and `npx biome check .` stay green.
- Single test file tests/test.mjs, plain node:assert, `--experimental-strip-types`, no live model calls.
- Zero runtime npm dependencies; host packages stay `import type`; pure modules keep zero runtime imports.
- A handler never throws; host swallows throws, so diagnostics go through reportFailure.
- Assumption: config.json in the working tree stays local-only after untracking; the developer's personal model never re-enters a commit.

## Acceptance Criteria
- [ ] `npm test` exits 0 with three new t19b blocked fixtures: `git push --force origin refs/heads/main`, `git push origin +refs/heads/main`, `git push -f origin HEAD:refs/heads/main`.
- [ ] `npm test` exits 0 with a new t19b allowed fixture: `git push origin main +feature/x` passes (F022 false positive gone).
- [ ] `npm test` exits 0 with new t15b fixtures: a complete `<function_calls>` region strips clean, an orphan `<invoke>` strips clean, and the mid-tag cut `<function_ca` survives byte-identical.
- [ ] `shouldGate` is gone; t1 content lives inside t1b; `npm test` exits 0.
- [ ] `git ls-files config.json` prints nothing; `git ls-files config.example.json` prints the path; the example file carries `"model": ""`.
- [ ] README.md:9-10 matches repo state for a fresh clone (gate ships disabled).
- [ ] package.json:20 still reads `"^1.4.0"` and the advisor.ts:69-area banner states the accepted caret risk in one or more written sentences.
- [ ] A test pins the F028 behavior: `stopReason !== "stop"` with `errorMessage: ""` reports the fallback reason, not `"advisor-turn-gate: "`.
- [ ] `npx tsc --noEmit` exits 0 and `npx biome check .` exits 0.

## Recommended Approach
Surgical per-finding edits at the audited sites: replace the rejoined-string test with a per-token matcher inside `blocksProtectedForcePush` (gate.mjs), widen the shared vocabulary group across the four markup sites in advisor.ts while keeping the guard-vs-tier invariant, untrack config.json behind a committed config.example.json, name one shared timeout constant in lib.mjs, reword the guard.ts citation, and append fixtures to the existing t19b and t15b blocks in tests/test.mjs. No new modules; no dependency changes.

## Decisions

### Scope of the fix pass
**Question**: Which findings go into this fix pass?
**Recommended**: All 9 — F021-F028 plus F008; F020 stays out (dev-only, no local fix); audit-recommended fixes adopted as written.
**Chosen**: All 9 (Recommended).
**Rationale**: The audit lists 9 actionable items and the probe verified 9/9 claims at HEAD 236cc25; F020 is environmental. Evidence: TECH_DEBT_AUDIT.md findings table + probe agent 1.

### F021 and F022 share one per-token fix
**Question**: Pre-resolved from codebase evidence — confirmed in scope answer.
**Recommended**: n/a — probe-derived.
**Chosen**: Implement F022's recommendation (per-refspec token matching) as the F021 fix, not the audit's regex-widening-only form.
**Rationale**: The audit's proposed regex still mis-flags `git push origin main +feature/x`; the root cause is the token rejoin at gate.mjs:74-76 that erases `+` attribution. Evidence: probe agent 2, A1-A2.

### F024 — which shipped state wins
**Question**: README says the gate ships disabled, but tracked config.json enables it with your personal model. Which state wins?
**Recommended**: Untrack config — gitignore config.json, commit config.example.json with empty model.
**Chosen**: Untrack config (Recommended).
**Rationale**: README becomes true; personal tuning stops leaking to clones. Evidence: README.md:9-10 vs config.json:2-4, probe agent 1 claim 8 + confirmed.

### F008 — pin or accept the caret
**Question**: The caret range on the host package is the last open structural-risk item. Pin it or accept it?
**Recommended**: Pin exact "1.4.0".
**Chosen**: Accept the caret, record the risk in writing at the reach site.
**Rationale**: Developer prefers upgrade flexibility; the per-gate-pass failure report (advisor.ts:69 documentation) is the accepted mitigation. Evidence: advisor.ts:69 + developer decision.

### F026 — unify the 10s budget
**Question**: The 10-second syntax-check budget exists as two literals (lib.mjs:62 string, feedback.mjs:23 number). How do we unify?
**Recommended**: One shared constant in lib.mjs; the message derives from it.
**Chosen**: Shared constant (Recommended).
**Rationale**: Single source of truth kills the drift the audit flagged. Evidence: lib.mjs:57-62, feedback.mjs:23.

### F025/F027/F028 — audit recommendations adopted
**Question**: Pre-resolved from codebase evidence — confirmed in scope answer.
**Recommended**: n/a — audit recommendation.
**Chosen**: Delete `shouldGate` (fold t1 into t1b); reword the guard.ts citation to name host settings as out-of-repo; swap `??` for `||` at advisor.ts:315.
**Rationale**: Each matches the audit's primary recommendation; probe verified all three sites. Evidence: config.ts:131-134, guard.ts:43-45, advisor.ts:312-315.

## Open Questions
None — every interview node resolved to a Decision.

## Suggested Follow-ups
- F020: re-run `npm audit` on the next dependency update; the undici advisories stay dev-only and tracked upstream.
- Child-session latch sharing: does a child session share `lastFiredTurn` (index.ts:32) or load a fresh module? Not determinable statically (plan-turn.ts:104).
- .claude/settings.json hook paths are repo-relative: is this directory the only Claude Code launch point?
- The stale "You are a child subagent" rule may still live in user-global host settings; guard.ts:43-45 cannot fix it from this repo.
- Keep the blocking advisor call inside turn_end with its 60-second ceiling, or adopt the fire-and-forget precedent (orca-agent-status)? UX question, deferred by the audit.

## References
- TECH_DEBT_AUDIT.md (input; repeat-run #2, HEAD 236cc25)
- .rpiv/guidance/root/architecture.md (hub-and-spoke model, extension conventions)
- README.md, package.json, config.json (F024/F008 evidence sites)
- Probe reports: codebase-locator (9/9 claims verified), codebase-analyzer (F021/F022 matcher mechanics, F023 tier/guard invariants)
