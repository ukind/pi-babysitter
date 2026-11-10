---
date: 2026-11-10T10:33:59+07:00
author: Yogiswara Utama
commit: 4af3ccb
branch: main
repository: advisor-turn-gate
topic: "Reasoning effort config for the advisor and specialist calls"
tags: [intent, frd, config, advisor, reasoning-effort]
status: ready
last_updated: 2026-11-10T10:33:59+07:00
last_updated_by: Yogiswara Utama
---

# FRD: Reasoning effort config for the advisor and specialist calls

## Summary

Add two config.json fields that set the reasoning effort of the advisor call and the specialist consult call. The host library already accepts the option; the extension never passes it. Absent or invalid values omit the key entirely, so today's behavior stays the default. The developer's stated uncertainty is whether the advisor reasons at all today.

## Problem & Intent

"im not sure with current behaviour is using reasoning or not"

The developer cannot tell whether the advisor call reasons today, and has no config surface to control it. The advisor call sends only `{ signal }` at both `completeSimple` sites in `advisor.ts`. The host facade accepts `options.reasoning` (`node_modules/@earendil-works/pi-ai/dist/types.d.ts:236`), and the extension's own `CompleteSimpleFn` type declares it as `string`, but no config field feeds it.

## Goals

- A config.json field sets the advisor call's reasoning effort.
- A second config.json field sets the specialist consult's reasoning effort, independently.
- An absent field omits the `reasoning` key from the options object, so existing configs behave exactly as today.
- An invalid value warns once per field and omits the `reasoning` key.

## Non-Goals

- `temperature`, `maxTokens`, and `samplingParams` pass-through. The host accepts all three (`types.d.ts:119-128`). The developer narrowed scope to reasoning effort only.
- A per-provider translation layer. Values go to the call as-is.
- A catch-all object for OpenAI-compatible extras such as `top_p` and `min_p`.
- Any change to the model resolution path, the deadline, or the tool loop.
- Model-capability detection. The host clamps unsupported levels itself.

## Functional Requirements

1. The system SHALL accept a `reasoningEffort` string field in config.json.
2. The system SHALL accept a `specialistReasoningEffort` string field in config.json.
3. The system SHALL accept only these values for both fields: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
4. The system SHALL omit the `reasoning` key from the options object when a field is absent, empty, or not a string. The key SHALL be absent, not present with value `undefined`.
5. The system SHALL warn once per field when that field holds an unaccepted value, and SHALL omit the `reasoning` key for that call.
6. The advisor call SHALL pass its level as `options.reasoning` at the `completeSimple` call site in `runAdvisor`.
7. The specialist consult SHALL pass its own level as `options.reasoning` at the `completeSimple` call site in `runConsultLeg`.
8. The local `CompleteSimpleFn` type in `advisor.ts` SHALL type `reasoning` as `ThinkingLevel`, not `string`.
9. The README config table SHALL carry one row per new field.
10. `config.example.json` SHALL carry both keys.

## Non-Functional Requirements

- **Performance**: no added model call and no added latency. The option rides the existing request.
- **Security**: the only new input is a validated enum. No free-form value reaches the provider.
- **UX / Accessibility**: the warn-once message names the field, the rejected value, and the accepted values.
- **Reliability**: the config read never throws. An invalid value degrades to "omit the key", never to an error channel.

## Constraints & Assumptions

- `config.ts` keeps its one-line-per-field shape with per-type narrowing against `DEFAULT_CONFIG`. A blind spread of the parsed object stays forbidden.
- The existing `warnOnce` latch is process-wide and shared across all fields (`config.ts`, `configWarned`). Requirement 5 needs one latch per field, so the latch becomes per-field. Existing fields keep their current behavior.
- `advisor.ts` imports no sibling at runtime. The accepted level list is therefore duplicated as a local constant, following the `DEFAULT_MAX_TOOL_ROUNDS` parity precedent (`advisor.ts`, with the t25 parity pin).
- `advisor.ts` imports pi-ai as `import type` only. `THINKING_LEVELS` is a runtime value (`providers/model-schema.d.ts:2`), so importing it would add a runtime dependency. Assumption: the list is duplicated, not imported.
- Zero runtime npm dependencies stays true.
- Tests use plain `node:assert` with no framework and no live model calls. The completion facade is stubbed.
- The specialist level rides `SpecialistConfig` (`advisor.ts:119-122`), which `index.ts` builds at fire time.
- The developer's live model is `stepfun/step-5-preview` via openrouter, whose `thinkingLevelMap` honors only `low`, `medium`, `high` (`providers/data/openrouter.json`). The host clamps the rest (`models.js:706-722`). The extension does not detect this.

## Acceptance Criteria

- [ ] `npm test` exits 0, with new pins in `tests/suites/config.mjs` and `tests/suites/advisor.mjs`.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run eval` exits 0.
- [ ] A config holding `"reasoningEffort": "high"` produces a stubbed `completeSimple` call whose options carry `reasoning: "high"`.
- [ ] A config with no `reasoningEffort` produces a call whose options object has no `reasoning` own key, asserted with `Object.hasOwn` or `deepStrictEqual` against an object without the key.
- [ ] A config holding `"reasoningEffort": "ultra"` produces exactly one warning naming the field and the accepted values, and a call with no `reasoning` own key.
- [ ] A config holding both `"reasoningEffort": "ultra"` and `"specialistReasoningEffort": "nope"` produces two warnings, one per field.
- [ ] A config holding `"specialistReasoningEffort": "low"` produces a consult-leg call whose options carry `reasoning: "low"`, while the advisor call carries its own level.
- [ ] The existing t16 single-call pins and the `eval/` golden fixtures still pass unchanged.
- [ ] `config.example.json` contains both keys, and the README table contains both rows.

## Recommended Approach

Two new string fields in `config.ts`, validated against one shared level list and narrowed per field, with a per-field warn latch. `index.ts` forwards the advisor level into `runAdvisor` and the specialist level into `SpecialistConfig`. Both `completeSimple` call sites in `advisor.ts` add `reasoning` to the options object they already build, omitting the key when no level is set.

## Decisions

### Who hits the problem
**Question**: What problem are you solving, and who hits it today when the config has no reasoning-effort or common OpenAI-compatible params?
**Recommended**: n/a — `intent` question
**Chosen**: The person maintaining the extension.
**Rationale**: The maintainer is the reader of the config surface, so a config field is the fix rather than a code path per provider.

### The actual symptom
**Question**: What actually goes wrong today? Describe the symptom you hit when the advisor call has no reasoning effort set.
**Recommended**: n/a — `intent` question
**Chosen**: "im not sure with current behaviour is using reasoning or not"
**Rationale**: The developer's uncertainty is the problem. The fix must make the behavior controllable, not just add a field.

### Pass-through or translation layer
**Question**: Today the advisor call sends only a stop signal. The host library already accepts those. Do you want config values sent as-is, or a translation step that reshapes them per provider?
**Recommended**: Send them as-is
**Chosen**: Send them as-is
**Rationale**: The host facade already accepts the option, so a translation layer adds code with no new capability. evidence: `node_modules/@earendil-works/pi-ai/dist/types.d.ts:236` + confirmed

### Catch-all object or named fields
**Question**: The host library has one catch-all field for extra OpenAI-compatible settings. Do you want one catch-all config object, or a separate config field for each setting?
**Recommended**: One catch-all object
**Chosen**: Neither. Scope narrowed to reasoning effort only.
**Rationale**: The developer cut `samplingParams`, `temperature`, and `maxTokens` from scope mid-interview.

### Local reasoning type
**Question**: `advisor.ts` declares `reasoning?: string` but the host wants `ThinkingLevel`. Fix the local type and validate the config value against the level list?
**Recommended**: Fix to ThinkingLevel
**Chosen**: Fix to ThinkingLevel
**Rationale**: The local type must match the host, or an invalid level reaches the provider unchecked. evidence: `node_modules/@earendil-works/pi-ai/dist/types.d.ts:236` + confirmed

### Which calls get a level
**Question**: The extension makes two kinds of model calls: the advisor, and the on-demand specialist consult. Which ones should get a reasoning effort setting?
**Recommended**: Both, one shared field
**Chosen**: Both, separate fields
**Rationale**: The advisor and the specialist can need different depths, so one shared value would force a compromise.

### Behavior when unset
**Question**: When config.json has no reasoning effort set for a call, what should that call send?
**Recommended**: Send nothing
**Chosen**: Send nothing
**Rationale**: Existing configs keep today's behavior byte for byte, so the change is additive only.

### Behavior on an invalid value
**Question**: Valid levels are minimal, low, medium, high, xhigh, max. What should happen when config.json holds something else?
**Recommended**: Warn once, send nothing
**Chosen**: Warn once, send nothing
**Rationale**: Matches the existing warn-once contract in `config.ts` and keeps the gate working on a typo.

### Two invalid fields at once
**Question**: `config.ts` has one shared warn-once latch. If both `reasoningEffort` and `specialistReasoningEffort` are invalid, only the first warns today. What should happen?
**Recommended**: One warning, both fields
**Chosen**: One warning per field
**Rationale**: A shared latch hides the second bad field. Per-field latches cost one small map and make every misconfiguration visible.

### Unsupported level on the live model
**Question**: Your model only honors low, medium, high. If config says `xhigh`, the host silently clamps it to `high`. What should the extension do?
**Recommended**: Let the host clamp it
**Chosen**: Let the host clamp it
**Rationale**: The host already owns model capability (`models.js:706-722`). Duplicating the level map in the extension adds a second source of truth that drifts. evidence: `providers/data/openrouter.json` + confirmed

### Field names
**Question**: What should the two config.json fields be called?
**Recommended**: `reasoningEffort` and `specialistReasoningEffort`
**Chosen**: `reasoningEffort` and `specialistReasoningEffort`
**Rationale**: Matches the host library's own name for the option, so a reader can find the host type from the config key.

### Documentation surface
**Question**: Should the README and config.example.json document the two new fields?
**Recommended**: Both files
**Chosen**: Both files
**Rationale**: A config field nobody can find is a field nobody uses.

## Open Questions

None. The developer deferred nothing.

## Suggested Follow-ups

- `temperature`, `maxTokens`, and `samplingParams` are accepted by the host and never passed by the extension — `node_modules/@earendil-works/pi-ai/dist/types.d.ts:119-128`. Out of scope by decision.
- The local `CompleteSimpleFn` in `advisor.ts` omits `temperature`, `maxTokens`, `samplingParams`, and `thinkingBudgets` from its options type, so the local type is narrower than the host's.
- `config.json` on disk holds no `systemPrompt`, so it runs the code default. Unrelated to this feature.
- The developer's live model maps `minimal`, `xhigh`, and `max` to `null` (`providers/data/openrouter.json`), so three of the six accepted levels are no-ops on that model. The host clamps them; the extension does not report it.

## References

- Input: free-text feature description, `the config does not have reasoning effort parameter and common params for open ai compatible`
- Prior FRD: `.rpiv/artifacts/discover/2026-11-10_10-22-22_reasoning-effort-config.md`
- `config.ts` — `AdvisorGateConfig`, `DEFAULT_CONFIG`, `loadConfig`, `clampWithWarn`, `warnOnce`, `configWarned`
- `advisor.ts` — `CompleteSimpleFn`, `SpecialistConfig`, `runAdvisor`, `runConsultLeg`
- `index.ts` — the fire-time args literal and the `SpecialistConfig` construction
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:119-128,236` — `temperature`, `samplingParams`, `maxTokens`, `reasoning`
- `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:2` — `THINKING_LEVELS`
- `node_modules/@earendil-works/pi-ai/dist/models.js:706-722` — `clampThinkingLevel`
- `node_modules/@earendil-works/pi-ai/dist/providers/data/openrouter.json` — the live model's `thinkingLevelMap`
- `README.md` config table, `config.example.json`
