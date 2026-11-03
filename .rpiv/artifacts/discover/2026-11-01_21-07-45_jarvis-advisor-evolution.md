---
date: 2026-11-01T21:07:45+0700
author: Yogiswara Utama
commit: faae538
branch: main
repository: advisor-turn-gate
topic: "jarvis-advisor-evolution"
tags: [intent, frd, advisor, dialogue, memory, triggers, tools, eval]
status: ready
last_updated: 2026-11-01T21:07:45+0700
last_updated_by: Yogiswara Utama
---

# FRD: jarvis-advisor-evolution

## Summary
Evolve the one-shot, blind, stateless advisor gate into a JARVIS-grade advisory system over 12 months with unlimited resources. The advisor converses across fires, remembers past advice and outcomes, and fires on risk and cost signals, not turn counts alone. It keeps one rule forever: it advises in the transcript; it never applies changes itself.

## Problem & Intent
The developer's words, verbatim:

> "i want the advisor have higher quality and features. kinda like JARVIS in ironman"

Earlier framing, verbatim: "what would be absolute improve this project? assume unlimited dev resources and 12 months. use many tokens, be ambitious. let it rip". The developer delegated persona and framing decisions to the interviewer ("you decide"). Today the gate is a periodic blind reviewer: one model call per N turns, transcript-only input, no memory, one committed message, no follow-up (advisor.ts:301, index.ts:72). The intent is an advisor that behaves like an always-aware engineering partner: it knows the history, sees the code, chooses when to speak, and improves measurably.

## Goals
- Dialogue: the advisor can follow up on its own prior advice across fires.
- Memory: past advice plus adoption signals persist locally; the advisor avoids repeating itself.
- Proactive triggers: fires respond to token growth, cost, error signals, and risky tool usage, not only turn count.
- Grounded advice: the advisor reads the repo itself through a read-only tool allowlist.
- Depth on demand: a specialist consult joins when the base advisor flags a domain.
- Measurable quality: a scored eval harness gates regressions in CI.

## Non-Goals
- No direct user channel. Advisor output stays inside the executor transcript as custom_message entries (developer ruled out a UI/notify channel).
- No auto-apply. The advisor stays suggest-only, always; no autonomy dial ships (developer chose this explicitly).
- No standing specialist fleet. Specialists run only on-demand after a base-advisor flag.
- No new runtime npm dependencies; host capabilities stay duck-typed per the existing pattern (advisor.ts:89-103).
- No cloud memory. Advice memory stays local to the machine.

## Functional Requirements
1. Dialogue: the system SHALL rehydrate the prior advice exchange into the advisor messages on every fire after a committed correction.
2. Memory: the system SHALL store each committed advice entry with a fault-class label and SHALL inject a memory digest into the fire context; a repeat fault SHALL yield advice that references the prior entry.
3. Triggers: the system SHALL support a configurable signal set — turn count (existing), token growth, cumulative session cost, error/abort signals, and risky-tool-usage events — each individually clamp-guarded like existing numeric fields (config.ts:81).
4. Read-only tools: the system SHALL pass an allowlisted toolset (read, grep, glob, safe read-only checks) to the advisor and SHALL resolve advisor toolUse turns in-session; toolUse SHALL be admitted as a stopReason only when tools are enabled.
5. Tool guard: the system SHALL refuse any advisor request for a tool outside the allowlist with a pinned reason string, and the markup-strip defense stays as backstop (advisor.ts:114-160).
6. Hybrid specialists: the base advisor SHALL be able to request exactly one specialist consult per fire (extra completeSimple call with a specialist system prompt); the commit SHALL aggregate base and specialist text into ONE custom_message entry.
7. Prompt budget: the system SHALL replace the full-transcript send with a rolling summary of old turns plus a verbatim recent tail, and SHALL enforce a per-fire token budget config field with clamp warnings.
8. Async mode: the system SHALL support an optional non-blocking fire whose commit lands at the next boundary; the in-process blocking behavior remains the default.
9. Eval harness: the system SHALL provide `npm run eval` scoring advisor outputs on golden session fixtures (drift caught, repeats avoided, advice adopted on the forced continuation), exiting nonzero on score regression.
10. Backward compatibility: today's single-model one-shot configuration SHALL keep working unchanged, and an empty `model` SHALL still disable the gate entirely (plan-turn.ts:90).

## Non-Functional Requirements
- **Performance**: per-fire token budget is bounded by config; async mode removes turn_end latency from the executor path; specialist consults share the fire's deadline (advisor.ts:232).
- **Security**: advisor tools are read-only and allowlisted; memory files stay local; no new network egress beyond the existing model calls; destructive-advice markup stays stripped before commit.
- **UX / Accessibility**: advice remains one display-flagged transcript entry per fire; concise by default; failures still report through reportFailure (report.ts:30-37).
- **Reliability**: never throw; fail-open on every path; spread peer entries on commit (plan-turn.ts:31); deadline and abort semantics extend to dialogue, tools, and specialist calls.

## Constraints & Assumptions
- Zero runtime npm dependencies; Node >= 22.6; TypeScript strict (package.json).
- Star topology preserved: pure decision spokes import nothing at runtime; capabilities arrive as injected thunks (plan-turn.ts doc block).
- Host access stays duck-typed through structural `-Like` interfaces; the `runtime.completeSimple` reach remains an accepted caret risk (advisor.ts F008 note).
- Assumption: the host exposes a tool-execution surface the extension can drive read-only with a bounded allowlist; research verifies this against pi 1.4.x extension APIs.
- Assumption: token and cost signals are derivable from turn context or usage metadata the host already carries; research verifies the exact event fields.
- The single test file may split when it passes ~1,500 lines or when the eval runner lands (TECH_DEBT_AUDIT threshold note).

## Acceptance Criteria
- [ ] `npm test` exits 0 with new sections pinning dialogue rehydration, memory digest, trigger signals, tool allowlist, specialist aggregation, and budget clamp strings.
- [ ] `npm run typecheck` and `npm run lint` exit 0.
- [ ] `npm run eval` exits 0 and prints per-fixture scores; exits nonzero when any score drops below its threshold.
- [ ] Fixture: a fire after a committed correction produces advisor messages containing the prior exchange (observable via stubbed facade).
- [ ] Fixture: a repeat fault yields advice text that references the prior memory entry.
- [ ] Fixture: inflated token counts fire the gate before the turn-count cadence would.
- [ ] Fixture: an advisor toolUse on an allowlisted read tool resolves and the loop continues to a final text answer.
- [ ] Fixture: a request for a non-allowlisted tool fails with the pinned reason string and commits nothing.
- [ ] Fixture: base-plus-specialist fire commits exactly ONE aggregated custom_message entry.
- [ ] Fixture: a malformed new config field leaves neighboring fields intact (field-narrowing extension of the existing pins).
- [ ] All existing test pins (t1-t20 contracts) stay green unchanged.

## Recommended Approach
Evolve the hub-and-spoke: keep `index.ts` as the only runtime-loaded hub, and add pure decision spokes — `memory.ts`, `triggers.ts`, `dialogue.ts`, `sandbox.ts` (read-only allowlist over a duck-typed host tool surface), `specialists.ts` (on-demand consult orchestration) — each thunk-injected like `plan-turn.ts`, plus an offline `eval/` harness under a new `npm run eval` script. Reuse the existing pipeline shape: plan (now multi-signal) -> single advisor await (now tool-loop + optional specialist) -> planCommit (now digest-building and aggregation), still never throwing and still spreading peer entries.

## Decisions

### Persona and framing delegated
**Question**: After 12 months of unlimited work, who should feel the biggest improvement, and what should be better for them?
**Recommended**: n/a — `intent` question
**Chosen**: "you decide" + JARVIS framing: "i want the advisor have higher quality and features. kinda like JARVIS in ironman"
**Rationale**: developer delegated; interpreter framed the daily pi user with an always-aware advisor as the beneficiary.

### JARVIS baseline pillars
**Question**: Which upgrades become the 12-month baseline — dialogue, persistent memory, multi-signal triggers?
**Recommended**: All three
**Chosen**: All three
**Rationale**: direct JARVIS intent + evidence of current one-shot, stateless, count-only design (plan-turn.ts:33-37, index.ts:32, config.ts:139) + confirmed.

### Advisor tool access
**Question**: Today the advisor is blind (advisor.ts:322, prompt.ts:33-56). How much tool access?
**Recommended**: Read-only tools
**Chosen**: Read-only tools
**Rationale**: grounded advice needs repo sight; sandbox keeps the security surface bounded; evidence: advisor.ts:320-325 + confirmed.

### Output channel
**Question**: Should the advisor get a channel directly to the user?
**Recommended**: Direct to user
**Chosen**: Transcript only
**Rationale**: developer rejected host UI coupling; advice stays executor-mediated; evidence: plan-turn.ts:33-37, report.ts:30-37 + confirmed.

### Brain architecture
**Question**: One advisor with capability modules, or a specialist team?
**Recommended**: One brain, modules
**Chosen**: Hybrid on-demand — base advisor consults a specialist only when it flags a domain
**Rationale**: balances depth against per-fire cost and transcript noise; evidence: single call site advisor.ts:301 + confirmed.

### Autonomy
**Question**: Should the advisor ever apply changes itself?
**Recommended**: Autonomy dial (default suggest-only)
**Chosen**: Suggest-only, always
**Rationale**: developer chose safety and reversibility over assistant-that-acts; no dial ships.

### Quality proof
**Question**: How should quality gains be proven?
**Recommended**: Eval harness
**Chosen**: Eval harness — golden fixtures plus adoption scoring, CI-gated
**Rationale**: "higher quality" is the stated goal; unmeasured quality claims fail it; evidence: existing offline test philosophy tests/test.mjs + confirmed.

### Prompt budget design (delegated)
**Question**: Pre-resolved from codebase evidence — full transcript ships every fire (prompt.ts:77-84); keep or change?
**Recommended**: Summarize old turns
**Chosen**: Rolling summary of old turns + verbatim recent tail + per-fire token budget field
**Rationale**: developer delegated detail ("you decide"); preserves drift detection from early turns while bounding cost; evidence: prompt.ts:77-84.

### Memory design (delegated)
**Question**: Pre-resolved from codebase evidence — only state is the cadence latch (index.ts:32); add memory?
**Recommended**: Persistent memory
**Chosen**: Local-only memory, session and project scopes, digest injected per fire
**Rationale**: covered by the confirmed pillars; locality avoids new egress; evidence: index.ts:32 + confirmed via pillars.

### Async fire mode (delegated)
**Question**: Blocking advisor call inside turn_end with 60s ceiling — keep?
**Recommended**: Add optional non-blocking fire
**Chosen**: Async mode optional, blocking stays default
**Rationale**: resolves TECH_DEBT_AUDIT maintainer question in the ambitious direction without breaking current contract; evidence: callWithDeadline advisor.ts:232.

### Specialist transport (delegated)
**Question**: How do on-demand specialists reach the commit?
**Recommended**: Extra completeSimple call, aggregated single entry
**Chosen**: Same
**Rationale**: honors the transcript-only and one-entry goals; evidence: buildCorrection plan-turn.ts:23-38.

## Open Questions
Items the developer delegated rather than answered; research resolves them.

- Does a child session share the factory's `lastFiredTurn` latch cross-session (index.ts:32)? Undeterminable statically; matters more once dialogue state exists.
- Which host event fields expose token/cost signals for the trigger set? Research verifies against pi 1.4.x.
- Memory retention and pruning policy (per-project cap, age-out) — delegated, needs a concrete default.

## Suggested Follow-ups
- F020: undici audit findings in package-lock.json are dev-only; track upstream (TECH_DEBT_AUDIT.md).
- Stale user-global "child subagent" host rule referenced at guard.ts:43-44 — delete it in host settings; this repo cannot.
- `.claude/settings.json` hooks use repo-relative paths; confirm the only launch point is this directory (TECH_DEBT_AUDIT maintainer question).
- A direct user channel via a pi host ask/notify surface was declined this round; revisit if the host gains a clean extension-facing ask API.

## References
- Probe agent reports: codebase-locator (surface inventory), codebase-analyzer (pipeline ceiling), 2026-11-01.
- Read firsthand: index.ts, plan-turn.ts, prompt.ts, advisor.ts (first 150 lines), TECH_DEBT_AUDIT.md.
- .rpiv/guidance/ architecture.md (root) and scripts/hooks guidance.
- AGENTS.md, tests/test.mjs contract strings, config.example.json.
