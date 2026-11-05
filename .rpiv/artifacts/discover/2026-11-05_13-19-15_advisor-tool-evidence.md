---
date: 2026-11-05T13:19:15+0700
author: Yogiswara Utama
commit: b449b83
branch: main
repository: advisor-turn-gate
topic: "Advisor tool evidence"
tags: [intent, frd, prompt-shaping, advisor-payload, regression]
status: ready
last_updated: 2026-11-05T13:19:15+0700
last_updated_by: Yogiswara Utama
---

# FRD: Advisor tool evidence

## Summary

Commit `2514358` narrowed the advisor payload to user and assistant turns, which silently deleted every `toolResult` message while keeping the assistant messages' `toolCall` blocks. The pi-ai host then back-fills each orphaned call with a synthetic error result reading `"No result provided"`, so the advisor sees confident claims ("secrets grep is now a real pass: 0 hits") sitting next to synthetic tool failures — and concludes the supervised agent fabricated everything. The fix injects the executor's real tool outputs into the payload as plain text, so the advisor can verify claims without the payload becoming a tool conversation.

## Problem & Intent

The developer's framing, verbatim: **"previously not like that. diagnose first"** — the fabrication accusations are a regression that started after the most recent changes, and the developer wanted the root cause proven before any fix direction was chosen.

Sample advisor output (the defect in the wild):

> The agent is hallucinating tool results and about to commit on fabricated diffs. Every bash call returned "No result provided" — including the git rev-parse --show-toplevel path check — yet it asserts "Repo path verified" and "secrets grep is now a real pass: 0 hits" ... Those claims are invented ...

Diagnosis performed and verified in this session against primary sources:

- `keepAdvisorRoles` (`prompt.ts:53-57`) keeps only `user`/`assistant` messages, deleting every `toolResult` — the executor's real bash output.
- Assistant messages keep their `toolCall` blocks, so every call the advisor sees is orphaned.
- The pi-ai provider transform synthesizes for each orphan: `content: [{ type: "text", text: "No result provided" }], isError: true` (`node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:155`).
- The narrowing commit is `2514358` "Narrow the advisor payload to user and assistant turns", authored 2026-11-05 12:53:22 +0700 — about 26 minutes before this discover run (13:19:15 +0700), matching "previously not like that".

Observed impact during this very session: the active extension accused the discover agent itself of skipping the intent gate and inventing probe results, while the tool channel was verified live (random marker `MARKER b449b83 24318` confirmed visible in the developer's TUI). The accusations were the advisor reporting its own mangled view.

## Goals

- The advisor can verify tool-outcome claims against the executor's real tool outputs, so it stops filing false fabrication accusations.
- The anti-mimicry goal of `2514358` survives: the payload stays a pure-text conversation with no tool roles and no callable tools.
- Existing pipeline invariants (identity floors, user tail, budget fold, digest placement) keep their behavior and their test pins.

## Non-Goals

- No tool-calling for the advisor — `tools: []` stays; the advisor only reads text.
- No raw `toolResult`-role messages in the payload — the anti-mimicry constraint rules them out.
- No per-output truncation — the developer explicitly chose full output over a cap.
- No change to the role whitelist's kept roles (`user`/`assistant`) and no new config fields beyond the system-prompt default text.

## Functional Requirements

1. The system SHALL add a new pure pass in `prompt.ts` (proposed name `inlineToolEvidence(messages: Message[]): Message[]`) that converts tool activity into plain text, with ZERO runtime imports (pure-module invariant).
2. The pass SHALL run FIRST in the `buildAdvisorMessages` pipeline (`prompt.ts:230-232`), before `keepAdvisorRoles`, so it pairs `toolCall` blocks with their `toolResult` messages before the role filter drops the results.
3. The pass SHALL rewrite each assistant message's `toolCall` content blocks into a plain-text note (tool name plus verbatim arguments). After the pass, no content item of `type: "toolCall"` remains in the payload.
4. The pass SHALL re-inject each `toolResult` message as a plain-text `user`-role message beginning `[tool output]` followed by the verbatim output, positioned after its paired call's note, preserving transcript order. After the pass, no `role: "toolResult"` message remains.
5. The pass SHALL degrade safely: a `toolCall` with no matching `toolResult` (executor died mid-call) yields the text note only — no crash, and because the block was rewritten to text, the host back-fill cannot fire.
6. Output size SHALL be unbounded (full output always). `applyTokenBudget` (`prompt.ts:141`) remains the only size guard, active when `tokenBudget > 0` (default 0 = identity).
7. With requirement 3 satisfied, provider transforms SHALL never synthesize `"No result provided"` results for advisor requests — assertable by payload inspection in tests.
8. `DEFAULT_CONFIG.systemPrompt` (`config.ts:50`) SHALL gain one line documenting the `[tool output]` convention, and `config.example.json` SHALL be updated to match. Developers with an explicit `systemPrompt` override keep their own text (per-type narrowing at `config.ts:223-226` is untouched).
9. Existing invariants SHALL hold or be re-pinned with rationale: `keepAdvisorRoles` identity doors (all-keep returns the same array; empty-payload floor returns the original), `stripToolDeclarations` floor path, `ensureUserTail`, digest placement before the tail, and the fold-marker pins (t10b, t22 lineages).

## Non-Functional Requirements

- **Performance**: payload grows by the full text of every tool output — accepted by decision. When a `tokenBudget` is configured, the existing fold bounds the payload. No new runtime dependencies; no extra host round-trips.
- **Security**: tool outputs can contain secrets; shipping them in full restores pre-`2514358` exposure (that era shipped the full transcript). Accepted as an explicit assumption — see Constraints.
- **Reliability**: the new pass never throws (fail-open house rule); malformed transcripts degrade to text notes. A failed shaping costs the next fire its evidence, never the session.
- **UX**: advisor `custom_message` commits stop containing false fabrication accusations for calls whose outputs shipped. Commit shape, `customType`, and the reload filter are unchanged.

## Constraints & Assumptions

- Anti-mimicry constraint (the stated rationale of `2514358`, `prompt.ts:36-48`): the payload must remain pure text — no `toolResult` role, no callable tools.
- `prompt.ts` stays pure: zero runtime imports; the pi-ai import is type-only (offline test invariant).
- The host transform (`transform-messages.js:125-185`) is external and versioned; the fix relies only on its observable rule — no pending call, no synthetic result. A nested duplicate copy inside `pi-coding-agent/node_modules` behaves identically.
- Assumption: secrets inside tool outputs reaching the advisor model are acceptable (pre-`2514358` behavior). If wrong, revisit with a redaction pass — out of scope here.
- Assumption: assistant `toolCall` arguments are safe to inline verbatim as text.

## Acceptance Criteria

- [ ] `npm test` exits 0, including new pins: (a) shaped payload contains no `type: "toolCall"` items; (b) a `toolCall`+`toolResult` pair yields one `[tool output]` text line containing the verbatim output; (c) no payload text contains `No result provided`; (d) an unpaired `toolCall` yields a note and no crash.
- [ ] `npm run lint` exits 0 and `npm run typecheck` exits 0.
- [ ] `git diff config.example.json` shows the systemPrompt convention line added.
- [ ] Manual: in a gate-enabled session with real bash calls, the advisor's committed `custom_message` contains no fabrication accusation for calls whose outputs shipped.
- [ ] The t10b/t22 floor and fold pins still pass, or are updated with recorded rationale.

## Recommended Approach

One new pure pass in `prompt.ts` — `inlineToolEvidence` — placed first in the `buildAdvisorMessages` pipeline (before `keepAdvisorRoles`) so it pairs calls with results before the role filter drops them; after it runs, the filter sees a text-only transcript and its behavior is unchanged on normal payloads. `DEFAULT_CONFIG.systemPrompt` gains the convention line; tests extend the single existing suite. No config fields beyond the prompt default.

## Decisions

### Intent — regression, diagnose first
**Question**: "The advisor keeps accusing supervised agents of fabricating tool results. What is the real problem you want solved?"
**Recommended**: n/a — `intent` question, no recommendation offered.
**Chosen**: "previously not like that. diagnose first" (verbatim).
**Rationale**: the accusations are new behavior after the latest commits; the developer wanted root cause proven before scoping a fix.

### Root cause — narrowing commit plus host back-fill
**Question**: Pre-resolved from codebase evidence, then confirmed: "commit 2514358 made the role filter drop every toolResult message, so the host back-fills 'No result provided' for each orphaned tool call. Confirm this as the cause?"
**Recommended**: "Confirmed — proceed".
**Chosen**: Confirmed — proceed.
**Rationale**: `evidence: prompt.ts:53-57 + node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:155 + git show 2514358 (2026-11-05 12:53:22 +0700) + confirmed`. Probe-agent reports that misattributed the commit to `7cc8e04` were discarded; all citations were re-verified directly.

### Constraint — keep anti-mimicry
**Question**: "The narrowing was introduced on purpose: toolResult chains made the advisor mimic tool-call markup. Treat that anti-mimicry goal as a constraint the fix must respect?"
**Recommended**: "Keep anti-mimicry".
**Chosen**: Keep anti-mimicry.
**Rationale**: `evidence: prompt.ts:36-48 + confirmed` — a naive revert re-opens the markup-mimicry failure the commit targeted.

### Fix shape — plain-text evidence
**Question**: "Which fix shape should the FRD commit to? The advisor must stop seeing orphaned tool calls, while the anti-mimicry constraint rules out replaying raw toolResult messages."
**Recommended**: Plain-text evidence.
**Chosen**: Plain-text evidence.
**Rationale**: the only shape that preserves verifiability under the constraint. Trace-only loses the gate's core purpose (catching real fabrication); prompt-recalibration leaves the `"No result provided"` synthetics rendering next to confident claims.

### Tool output size — full output always
**Question**: "When a tool prints a huge output, how much of it goes into the plain-text '[tool output]' line the advisor reads?" (asked after clarifying that the advisor gains no tools — it only reads text)
**Recommended**: Fixed cap (~1200 chars with a truncation marker).
**Chosen**: Full output always.
**Rationale**: developer's explicit pick — completeness over payload economy; `applyTokenBudget` stays the guard when a budget is configured.

### System prompt note — yes, update default
**Question**: "Should the default advisor system prompt also document the new '[tool output]' convention?"
**Recommended**: Yes, update default.
**Chosen**: Yes, update default.
**Rationale**: prevents the advisor misreading injected lines; developers with explicit overrides keep their own text (`config.ts:223-226`).

## Open Questions

None. No item was explicitly deferred by the developer.

## Suggested Follow-ups

- Re-run the markup-hardening evals after the payload shape changes — the evidence-injection changes the substrate those evals measure (lineage: `0a8ef09`, `06f3552`).
- Verify the digest channel stays markup-free — the digest system message rides the same payload (`index.ts:105-109`, strip noted at `index.ts:241-243`).
- Re-check the TECH_DEBT_AUDIT.md wording about what ships per gate — `2514358` touched it (`git show 2514358 --stat`), and this FRD changes the answer again.
- Secrets-in-payload exposure returns to pre-`2514358` behavior; a redaction pass is a candidate future feature if that assumption proves wrong.

## References

- Sample advisor complaint (user-provided input to this discover run).
- `prompt.ts:31-60` (role filter + doors), `prompt.ts:71-90` (stripToolDeclarations), `prompt.ts:141-193` (applyTokenBudget), `prompt.ts:197-238` (ensureUserTail + buildAdvisorMessages) — all read directly this session.
- `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:125-185`, synthetic result at `:155`.
- `config.ts:50` (DEFAULT_CONFIG.systemPrompt), `config.ts:223-226` (override narrowing).
- Commits: `2514358` (the narrowing), `7cc8e04` / `b449b83` (artifact-only), `06f3552`, `0a8ef09`.
- Channel verification: `MARKER b449b83 24318` confirmed visible in the developer's TUI during this session.
