---
date: 2026-11-05T09:47:20+0700
author: Yogiswara Utama
commit: 7cc8e04
branch: main
repository: advisor-turn-gate
topic: "Advisor markup-only diagnosis and prompt-payload hardening"
tags: [intent, frd, advisor, prompt-shaping, plan-turn]
status: ready
last_updated: 2026-11-05T09:47:20+0700
last_updated_by: Yogiswara Utama
---

# FRD: Advisor markup-only diagnosis and prompt-payload hardening

## Summary
The advisor gate fires with no real tool channel, yet `stepfun/step-5-preview` writes tool calls as plain text in its trained markup dialect. The reply strips to empty, and `planCommit`/`planSettle` fail open with `advisor-turn-gate: advisor reply was markup only` — the designed outcome, not a malfunction. The follow-up work hardens the default system prompt and narrows the advisor payload to the supervised model's reasoning trace and outputs, removing the markup trigger at its source.

## Problem & Intent
Developer framing (verbatim): "why the model still insist of making tool call and cause this warning appear: Warning: advisor-turn-gate: advisor reply was markup only". Chosen outcome: understand the cause first, then decide the fix.

Root cause, fully grounded:

1. The call carries no real tool channel. `toolsEnabled` and `specialistModel` are unset in the live `config.json`, so the tool loop never arms and `runAdvisor` sends `tools: []`. `stripToolDeclarations` also deletes `toolsAdded`/`toolsRemoved` from system messages. Every "tool call" the advisor makes is plain text by construction.
2. The ban was in play and failed. No `systemPrompt` override exists, so the advisor received `DEFAULT_CONFIG.systemPrompt`, which states verbatim: "You have no tools and cannot call any... never write tool-call markup". `step-5-preview` overrode that explicit instruction.
3. Why a tool-trained model does that: when it judges the next action is a tool call, it serializes the call in its trained dialect as text. The payload pulls hard — a transcript saturated with tool activity, the terminal nudge "Advise on the work above.", and `triggerOnError: true`, which fires the gate on errored turns, the highest-risk context.
4. Nothing intercepts it mid-flight: the tool loop consumes only structured `toolCall` blocks; text markup arrives inside a normal text block with `stopReason: "stop"`.
5. `stripAdvisorMarkup` removes the four dialect tiers; a markup-only reply trims to `""`.
6. The seam drops the fire with the pinned notify. Replies that mix prose with markup already survive; "markup only" means the reply contained zero advice. Each warning is one fully wasted fire.

Developer's role statement (verbatim, drives the fix): "the advisor should be only read the reasoning trace and output of the supervised model, therefore no need to tool calling".

## Goals
- Root cause understood and recorded (satisfied by this document).
- Default prompt hardened: the advisor's role is reviewing the supervised model's reasoning trace and outputs, with a plain-prose-only output rule.
- Payload narrowed to user and assistant messages; executor system replays and toolResult entries leave the advisor's view.
- The fail-open warning contract stays byte-identical.

## Non-Goals
- No convert/salvage path that commits a note for markup-only replies (declined option).
- No change to the warning text or the empty-strip fail-open behavior.
- No new `config.json` field and no opt-out toggle for the filter.
- No advisor model swap in this work (kept as a follow-up lever).
- The specialist leg payload (`runConsultLeg`) is untouched.

## Functional Requirements
1. The system SHALL ship a rewritten `DEFAULT_CONFIG.systemPrompt` that defines the role as reviewing only the supervised model's reasoning trace and outputs, states that no tools exist, demands plain prose, bans tool-call markup and angle-bracket tool syntax, and keeps the existing brevity and no-praise directives.
2. The system SHALL filter the advisor payload in `buildAdvisorMessages` (`prompt.ts`): keep messages with role `user` or `assistant`; drop role `system` and `toolResult`.
3. The filter SHALL run as the FIRST pass of the pipeline (before `applyTokenBudget`, `ensureUserTail`, and digest insertion), so the fold sizes the filtered payload.
4. The filter SHALL be an identity when no `user` or `assistant` message survives: a transcript of only system and toolResult entries yields the original payload, never an empty one.
5. The system SHALL keep `planCommit` and `planSettle` markup-only notify strings byte-identical (`plan-turn.ts:185`, `plan-turn.ts:286`).
6. The system SHALL pin the filter roles, the identity floor, the pipeline order, and the new default prompt text in `tests/test.mjs`, offline, with no live model calls.

## Non-Functional Requirements
- **Performance**: no specific constraint; the narrowed payload strictly reduces tokens per fire.
- **Security**: sandbox and specialist surfaces untouched; dropped content must not leak into the fold marker text.
- **UX / Accessibility**: committed entry shape (`custom_message`, `customType`, `display`) unchanged.
- **Reliability**: fail-open semantics preserved end-to-end; the identity floor guarantees a non-empty payload.

## Constraints & Assumptions
- TypeScript strict, zero runtime npm dependencies, Node >= 22.6.
- Pure decision code carries zero runtime imports; decision cores use the `plan*` verb naming; runtime modules import siblings extensionless.
- `config.json` is re-read per dispatch; this work adds no field, so `config.ts` changes only in the `DEFAULT_CONFIG.systemPrompt` string.
- Assumption: hardening plus narrowing reduces markup-only fires for `stepfun/step-5-preview`. Model instruction-following remains the dominant variable; verify by observing the warning frequency after deployment.

## Acceptance Criteria
- [ ] `node --experimental-strip-types tests/test.mjs` exits 0 with the new pins in place.
- [ ] Shaping a mixed transcript through `buildAdvisorMessages` yields only `user` and `assistant` roles (plus the nudge or digest when armed); zero `system` or `toolResult` entries.
- [ ] A transcript containing only `system` and `toolResult` messages yields the original payload unchanged (identity floor).
- [ ] Existing fold-marker ordering pins still pass, proving the fold sizes the filtered payload.
- [ ] Existing `planCommit`/`planSettle` notify-string pins pass unchanged.
- [ ] `npx tsc --noEmit` and `npx biome check` exit clean.

## Recommended Approach
A pure role-filter function in `prompt.ts` slotted as the first pass of `buildAdvisorMessages`, plus a rewritten `DEFAULT_CONFIG.systemPrompt` in `config.ts`; `tests/test.mjs` pins the filter, the identity floor, and the new prompt text; no `config.json` field is added.

## Decisions

### Outcome: understand the cause first
**Question**: "The advisor model is called with tools disabled, but it still returns tool-call markup, and the extension then warns 'advisor reply was markup only'. What outcome do you want from this work?"
**Recommended**: n/a — `intent` question
**Chosen**: Understand the cause; pick the fix after seeing it.
**Rationale**: Developer wants diagnosis before remediation.

### Finding 1 — no real tool channel
**Question**: "Finding 1: the advisor call carries no real tool channel, so every tool call it makes is plain text, by construction. Keep this finding?"
**Recommended**: Confirmed
**Chosen**: Confirmed, plus the scope note: "the advisor should be only read the reasoning trace and output of the supervised model, therefore no need to tool calling".
**Rationale**: evidence: advisor.ts (unarmed loop sends `tools: []`) + prompt.ts `stripToolDeclarations` + `config.json` (`toolsEnabled`/`specialistModel` unset) + confirmed.

### Finding 2 — the prompt ban failed
**Question**: "Finding 2: the default system prompt explicitly banned markup, and step-5-preview overrode that instruction. Keep this as the root cause?"
**Recommended**: Confirmed
**Chosen**: Confirmed.
**Rationale**: evidence: config.ts `DEFAULT_CONFIG.systemPrompt` ban text + `config.json` carries no `systemPrompt` override + confirmed.

### Finding 3 — the warning is the designed fail-open
**Question**: "Finding 3: the warning is the designed fail-open for an empty strip, not a malfunction. Keep as recorded?"
**Recommended**: Confirmed
**Chosen**: Confirmed.
**Rationale**: evidence: plan-turn.ts:185 and plan-turn.ts:286 (empty strip → notify) + confirmed.

### Fix scope: harden the prompt
**Question**: "What should the FRD target as the follow-up work?"
**Recommended**: Convert, don't drop
**Chosen**: Harden the prompt.
**Rationale**: Developer pick; its known cost (the same channel already failed with this model) is mitigated by the payload decision below.

### Cross-cutting role note lands in prompt AND payload
**Question**: "Your note — the advisor reads only the supervised model's reasoning trace and outputs — can land in the prompt text alone, or also reshape the payload it reads. Where should it land?"
**Recommended**: Prompt wording only
**Chosen**: Narrow the payload too.
**Rationale**: Removes the markup trigger at its source; accepted cost: tool-result evidence of what went wrong drops out of view.

### Filter scope and unconditional behavior
**Question**: Pre-resolved from the chosen option's stated scope and the developer's verbatim role note.
**Recommended**: Keep `user` and `assistant`; drop `system` and `toolResult`; no config toggle.
**Chosen**: As recommended.
**Rationale**: The chosen option's text named "outputs plus task context" with tool-result drop as the accepted loss; the role note says "only read", which excludes an opt-out.

### Filter placement and identity floor
**Question**: Pre-resolved from codebase convention.
**Recommended**: First pass in `buildAdvisorMessages`; identity when no `user`/`assistant` survives.
**Chosen**: As recommended.
**Rationale**: evidence: prompt.ts settled window decision (the strip runs first so the fold sizes stripped messages); an empty payload must never reach the provider.

## Open Questions
None — no items were deferred during the interview.

## Suggested Follow-ups
- Declined levers, kept for if hardening underperforms: convert-markup-to-note commit and an enriched warning naming the first stripped tag (offered in the fix-scope question, not chosen).
- Model variable: `stepfun/step-5-preview` overrode an explicit ban; a small eval comparing candidate advisor models on markup emission would derisk the `model` choice (`config.ts`).
- Strip dialect coverage: if markup-only fires persist, check the raw offender against the four tiers in advisor.ts (`TOOL_CALL_REGION_PATTERN` and siblings); a stepfun-specific dialect may need a new tier.
- `stepfun/step-5-preview` is a preview model; its markup behavior can shift without a version change.

## References
- Live runtime config read during the probe: `config.json` (repository root).
- Source examined: `advisor.ts`, `prompt.ts`, `plan-turn.ts`, `config.ts`, `index.ts`.
- Warning-string origins: `plan-turn.ts:185`, `plan-turn.ts:286`; test pins at `tests/test.mjs:614`, `tests/test.mjs:3068`.
- Prior artifacts mentioning the warning: `.rpiv/artifacts/plans/2026-10-30_09-11-32_tech-debt-series-commits-a-j.md`.
