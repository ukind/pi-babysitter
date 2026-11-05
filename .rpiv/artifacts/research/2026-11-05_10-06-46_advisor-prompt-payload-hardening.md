---
date: 2026-11-05T10:06:46+0700
author: Yogiswara Utama
commit: 7cc8e04
branch: main
repository: advisor-turn-gate
topic: "Advisor markup-only diagnosis and prompt-payload hardening"
tags: [research, codebase, advisor, prompt-shaping, plan-turn, eval-runner]
status: ready
last_updated: 2026-11-05T10:06:46+0700
last_updated_by: Yogiswara Utama
---

# Research: Advisor markup-only diagnosis and prompt-payload hardening

## Research Question
Chain from the FRD at `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md`. The chosen approach: a pure role-filter function in `prompt.ts` as the FIRST pass of `buildAdvisorMessages` (keep `user`/`assistant`, drop `system`/`toolResult`, identity floor when nothing survives), plus a rewritten `DEFAULT_CONFIG.systemPrompt` in `config.ts`; `tests/test.mjs` pins the filter, the identity floor, the pipeline order, and the new prompt text; no `config.json` field is added. This research answers: what is the exact pipeline shape the filter slots into, what consumes its output, what constraints bind the prompt rewrite, what breaks in tests and eval, and where are the seams the FRD did not name.

Method note: the scope-tracer pass formulated 7 questions; the developer directed synthesis from its findings plus direct verification reads instead of a codebase-analyzer dispatch. Every file:line below was verified in-session against current source at commit 7cc8e04.

## Summary
The filter slots cleanly as the first pass of the `buildAdvisorMessages` composition (`prompt.ts:186-200`). No runtime consumer inspects input-role `system` or `toolResult` entries: `runAdvisor` shallow-copies the array (`advisor.ts:493`), the specialist leg builds its own payload (`advisor.ts:389-397`), the child-session veto reads raw messages before shaping (`guard.ts:124-130`, bound at `index.ts:95`), and the in-loop `toolResult` replay happens on the advisor's own conversation after the input copy (`advisor.ts:560-574`). The prompt rewrite is a one-string change with zero wiring: `DEFAULT_CONFIG.systemPrompt` (`config.ts:50-61`) reaches the model untouched whenever `config.json` omits the key (`config.ts:223-226`; the live `config.json` omits it). The cost lands in two places the FRD did not name: the eval harness's `budget-respected` score asserts system-message survival and fails guaranteed post-filter (`eval/runner.mjs:83-86`, sole consumer `eval/fixtures/budget-window.json`), and the t10/t22 window pins in `tests/test.mjs` flip truth value rather than merely going stale. Both are in scope per developer decision. `stripToolDeclarations` survives as live code: it becomes a no-op on the filtered path but still strips executor deltas on the identity-floor path.

## Detailed Findings

### Pipeline shape and the filter's slot
- `buildAdvisorMessages` is a three-pass composition plus digest insert: `ensureUserTail(applyTokenBudget(stripToolDeclarations(llmMessages), tokenBudget))`, then the digest goes in front of the final message (`prompt.ts:186-200`). The doc comment pins the ordering contract: "the strip runs first so the fold sizes stripped messages" (`prompt.ts:172-175`).
- The filter runs BEFORE this composition per FR3, so the fold sizes the filtered payload. On the filtered path `stripToolDeclarations` (`prompt.ts:45-66`) is vacuous — no `system` message survives — but it stays live on the identity-floor path, where the original payload (executor system replays with `toolsAdded`/`toolsRemoved` deltas) re-enters the pipeline and still gets stripped.
- `applyTokenBudget` (`prompt.ts:104-158`) skips `role === "system"` while folding (`prompt.ts:115`): dead on the filtered path (no systems remain), live on the identity-floor path. Its doc invariant 2 — "Every system message survives; they carry the replay chains the advisor reads" (`prompt.ts:95`) — becomes false as a blanket claim and must be re-scoped.
- The digest is a synthetic `role: "system"` message built by `digestMessage` (`memory.ts:189-198`) that joins AFTER the pipeline (`prompt.ts:193-199`), so the filter never sees it. The FRD acceptance wording "zero system or toolResult entries" reads as transcript entries only; the digest is exempt by construction. The existing pin `shaped[2].role === "system"` (`tests/test.mjs:1822`) survives.
- The fold marker interpolates only a count, never message content (`prompt.ts:136-139`), so dropped transcript content cannot leak into the marker text — the FRD security note holds.

### Default system prompt flow and rewrite constraints
- The string lives inside `DEFAULT_CONFIG` at `config.ts:45-67` (`systemPrompt` at `config.ts:50-61`). `loadConfig()` falls back to it whenever `config.json` lacks a non-empty `systemPrompt` (`config.ts:223-226`). The live `config.json` omits the key, so rewriting the constant changes live advisor behavior with zero wiring changes.
- Flow to the model: seam passes `config.systemPrompt` into planGate args (`index.ts:88`), the consult arm returns it on the `GateDecision` (`plan-turn.ts:145`), the seam binds `gate.systemPrompt` into advisorArgs (`index.ts:177`), and `runAdvisor` sends it as `context.systemPrompt` (`advisor.ts:511`).
- Content constraints the new text must satisfy (FR1): the role is reviewing only the supervised model's reasoning trace and outputs; no tools exist; plain prose demanded; tool-call markup and angle-bracket syntax banned; brevity and no-praise directives retained (all present verbatim in the current string, `config.ts:50-61`).
- Test constraint: t7b pins are regex substring checks, deliberately never full-string equality (`tests/test.mjs:395-398`), asserting `/no tools/` and `/text only/` against `DEFAULT_CONFIG.systemPrompt` (`tests/test.mjs:401-402`). The rewrite must keep both substrings or the pins must change in the same slice (FRD FR6 pins "the new prompt text"; keeping the two substrings is the cheapest path).
- The specialist leg's prompt (`config.ts`, `specialistSystemPrompt` field inside `DEFAULT_CONFIG`) already carries its own markup ban and is a FRD non-goal — untouched.

### Consumer audit — nothing reads input system/toolResult structurally
- `planGate` consult arm carries the shaped array opaquely as `messages` on the `GateDecision` (`plan-turn.ts:143-147`); the seam forwards it (`index.ts:178`).
- `runAdvisor` copies the input into a fresh conversation array (`advisor.ts:493`) and sends it through `completeSimple` (`advisor.ts:508-514`). The `toolCall` filter reads `response.content`, not the input (`advisor.ts:521-524` band). The in-loop `toolResult` messages are appended to the advisor's own conversation after the input copy (`advisor.ts:560-574`) — the filter cannot starve a consult-armed fire's self-correction replay.
- The specialist leg `runConsultLeg` builds its own tool-free payload inline — `specialist.systemPrompt` plus a single `role: "user"` question (`advisor.ts:389-397`) — and never passes through `buildAdvisorMessages`. Confirmed FRD non-goal.
- `isChildSession` scans raw `event.context.llmMessages` before any shaping (`guard.ts:124-130`, bound at `index.ts:95`) — unaffected by the filter.
- Committed advisor advice replays into later transcripts as `role: "user"` messages (the `buildCorrection` doc, `plan-turn.ts:37-40`), so the advisor's own dialogue loop survives the filter.
- Live config sharpens the stakes: `triggerOnError: true` (`config.json:10`) fires the gate on errored turns — the toolResult-saturated context FRD Finding 3 names — so the filter's token reduction lands hardest exactly where markup emission was observed.

### Identity floor semantics (decided: same-array identity)
- Developer decision: return the original array object when no `user`/`assistant` message survives. Precedent: `stripToolDeclarations` returns the same array when nothing matches (`prompt.ts:46`), `applyTokenBudget` returns the same array at every identity door (`prompt.ts:105-110`), and t22 pins these with strict equality (`tests/test.mjs:1559-1568`).
- Downstream interaction is already pinned: `buildAdvisorMessages([], 0, digest)` yields `[digest]` alone (`tests/test.mjs:1848`), and `ensureUserTail` appends no nudge when the tail is not assistant (`tests/test.mjs:684-688` band). The identity floor preserves both behaviors because the empty/filtered-out input flows through the unchanged composition.
- `runAdvisor`'s shallow copy (`advisor.ts:493`) means same-array identity in the filter shares no mutable state with the fire: safety costs nothing here.

### Test surgery map (decided: surgery, not sibling pins)
- t10 (`tests/test.mjs`, band around `:665-671`): `out[0].toolsAdded === undefined` (`:665`) becomes vacuous (out[0] is the user message post-filter); `out[0].content === "base"` (`:667`) flips false; `out.length === 4` (`:669`) becomes 3; the nudge index moves. Requires rewrite, not extension.
- t22 window band (`tests/test.mjs:1627-1663`): `plain.length === 3` for `buildAdvisorMessages([sys1, a1])` becomes 2; the `fatDelta` strip pin (`buildAdvisorMessages([fatDelta, user], 10000)`) goes vacuous for the same reason as t10's. Same surgery rationale.
- Survivors, verified: t22's strict-equality identity pins (`:1559-1568`) and direct fold-shape pins target `applyTokenBudget` directly; the composite strip-fold-tail window on `[user, assistant]` input passes (filter identity); t23's digest window pins (`:1822`, `:1848`) pass because the digest joins post-filter and the filter is identity on the empty base; the direct `stripToolDeclarations` identity pin (`:676-678`) survives; the byte-exact notify pins `advisor reply was markup only` (`tests/test.mjs:614`, `:3068`; strings at `plan-turn.ts:185`, `:286`) are untouched per FR5.
- Net-new pins per FR6: filter roles (`user`/`assistant` kept; `system`/`toolResult` dropped), identity floor as same-array `===`, pipeline order (filter first — a `toolResult`-only transcript yields the original payload), and the new default prompt text (substring style per `tests/test.mjs:395-398`).

### Eval runner coupling (decided: fix score + fixture in this work)
- The runner replays the real pipeline: its Region G mirror calls `buildAdvisorMessages(messages, config.tokenBudget, digest)` (`eval/runner.mjs:288`) with `llmMessages` seeded per fixture turn (`eval/runner.mjs:279`), so the filter inherits automatically.
- The `budget-respected` score requires `fixture.systemTexts` to appear in the built payload (`eval/runner.mjs:83-86`). Its sole consumer, `eval/fixtures/budget-window.json`, seeds two system entries interleaved with user/assistant messages — post-filter both vanish and the score fails guaranteed. The runner's own header declares scores to be the CI gate (exit code 1), so "defer" means a red build, not a stale artifact.
- Fix shape: re-scope `systemsKept` to assert system survival only where the filter is identity (an all-system transcript), and assert user/assistant survival on filtered fixtures; update `budget-window.json` accordingly.
- Other five fixtures unharmed: each seeds one system entry, none scores `budget-respected`, and their scores read commits or the facade's captured messages (`eval/runner.mjs:77-134` band). The `repeats-avoided` digest lookup (`role === "system"` + digest prefix, `eval/runner.mjs:111-120`) survives — the digest is exempt.

### Documentation and invariants the filter obsoletes
- False as blanket claims after the change: `prompt.ts:95` (invariant 2), the module banner framing "minus the tool declarations" (`prompt.ts:6-7`), and the ordering paragraph `prompt.ts:172-175`. All need re-wording to describe: filter first; strip still live on the identity-floor path; system-skip in the fold live only there.
- Vacuous but true on the filtered path: `stripToolDeclarations`' doc "Drop the deltas, keep the prompt text" (`prompt.ts:57-64`).
- This repo treats doc comments as pinned contracts (several have citing pins), so doc drift would fail review even with green tests.

## Code References
- `prompt.ts:6-7` — module banner framing the payload shaping; needs filter mention
- `prompt.ts:27` — `ADVISOR_NUDGE` ("Advise on the work above."), the tail nudge text
- `prompt.ts:45-66` — `stripToolDeclarations`; same-array identity at `:46`; stays live on identity-floor path
- `prompt.ts:78` — `BUDGET_FOLD_MARKER_PREFIX`; marker text at `:136-139` interpolates only a count
- `prompt.ts:95` — fold invariant 2 ("Every system message survives"); false post-filter, re-scope
- `prompt.ts:104-158` — `applyTokenBudget`; system-skip at `:115`; identity doors `:105-110`
- `prompt.ts:160-167` — `ensureUserTail`
- `prompt.ts:172-175` — ordering contract doc; rewrite for filter-first
- `prompt.ts:186-200` — `buildAdvisorMessages` composition + digest insert; the filter's slot
- `config.ts:45-67` — `DEFAULT_CONFIG`; `systemPrompt` string at `:50-61`; specialist prompt also in block
- `config.ts:223-226` — `loadConfig` systemPrompt fallback (default wins when file omits key)
- `plan-turn.ts:83-90` — `GateDecision` consult shape (messages carried opaquely)
- `plan-turn.ts:143-147` — consult arm return; `systemPrompt` at `:145`, `buildMessages` call at `:146`
- `plan-turn.ts:185` — `planCommit` markup-only notify string (byte-pinned, FR5)
- `plan-turn.ts:286` — `planSettle` markup-only notify string (byte-pinned, FR5)
- `plan-turn.ts:37-40` — committed advice replays as user messages; dialogue loop survives filter
- `index.ts:88` — seam passes `config.systemPrompt` to planGate
- `index.ts:95` — child veto bound over raw `llmMessages` (pre-shape)
- `index.ts:104-110` — seam `buildMessages` thunk: digest when `memoryCap > 0`, then `buildAdvisorMessages`
- `index.ts:175-181` — advisorArgs literal; `messages: gate.messages` at `:178`
- `advisor.ts:372-423` — `runConsultLeg`; self-contained payload at `:389-397`; untouched
- `advisor.ts:450-603` — `runAdvisor`; input copy at `:493`; send at `:508-514`; in-loop toolResult replay `:560-574`
- `guard.ts:124-130` — `isChildSession` scans raw messages; unaffected
- `memory.ts:189-198` — `digestMessage` builds the `role: "system"` digest; joins post-filter
- `eval/runner.mjs:77-87` — `budget-respected` score; `systemsKept` at `:83-86`; fails guaranteed post-filter
- `eval/runner.mjs:279,288` — fixture `llmMessages` seed and the real-pipeline replay call
- `eval/fixtures/budget-window.json` — sole `budget-respected` consumer; 2 system entries interleaved with user/assistant
- `tests/test.mjs:395-402` — t7b substring-pin convention + the `/no tools/`, `/text only/` pins
- `tests/test.mjs:614` — t9 planCommit husk pin (byte-exact, survives)
- `tests/test.mjs:641-703` — t10 band; flips at `:665`, `:667`, `:669`
- `tests/test.mjs:1559-1568` — t22 strict-equality identity pins (the floor's precedent style)
- `tests/test.mjs:1627-1663` — t22 window band; `plain.length === 3` and fatDelta pin flip/vacate
- `tests/test.mjs:1795-1850` — t23 digest window pins; survive
- `tests/test.mjs:3068` — t27 planSettle husk pin (byte-exact, survives)
- `config.json:10` — `triggerOnError: true`; errored turns fire, the densest toolResult context

## Integration Points

### Inbound References
- `index.ts:104-110` — the only production caller of `buildAdvisorMessages` (via the planGate `buildMessages` thunk)
- `eval/runner.mjs:288` — the sanctioned second caller, replaying the identical two-arg-plus-digest form
- `tests/test.mjs` — t10/t22/t23 bands exercise the composition directly

### Outbound Dependencies
- `plan-turn.ts:146` — `args.buildMessages(args.llmMessages)`; the pure core takes the shaper as an injected thunk
- `advisor.ts:493,508-514` — the shaped array is shallow-copied and sent as `context.messages`
- `memory.ts:189-198` — supplies the optional digest that joins after the pipeline

### Infrastructure Wiring
- `config.ts:223-226` — default-prompt fallback; live `config.json` omits `systemPrompt`, so the constant governs
- `config.json:10` — `triggerOnError: true` routes errored (toolResult-dense) turns through the gate
- `index.ts:95` — child veto consumes raw messages before shaping; ordering keeps the veto filter-independent

## Architecture Insights
- The pipeline is a strict order contract documented in code: filter (new, first) → strip → fold → tail, with the digest joining after the fold so it is never a fold candidate (`prompt.ts:186-200`). Every reordering argument cites the same settled window decision the design doc recorded; the new filter extends, not replaces, that contract.
- Identity doors are a convention, not an optimization: every no-op path returns the input array, and t22 pins it with `===` (`tests/test.mjs:1559-1568`). The floor follows the convention.
- Failure surfaces are byte-pinned strings, never exceptions: both markup-only notify arms (`plan-turn.ts:185`, `:286`) and their test pins (`tests/test.mjs:614`, `:3068`) are contract per FR5; this work must not touch them.
- Test pinning style is substring-regex for prose and strict-equality for structure (`tests/test.mjs:395-398` vs `:1559-1568`); new pins should follow the same split.
- The eval runner binds the same seam thunks as `index.ts` (its header, `eval/runner.mjs:7-11` band), so any pipeline change propagates to CI through it — eval fixtures are part of the change surface, not downstream consumers.

## Precedents & Lessons
3 similar past changes analyzed (git log, current branch).

### Precedent: budget + digest + eval runner landing
**Commit(s)**: `06f3552` — "Land the jarvis-advisor-evolution slices: triggers, budget, memory, dialogue, tools, consult, async, eval" (2026-11-03 era)
**Blast radius**: the whole feature surface — `prompt.ts`, `config.ts`, `plan-turn.ts`, `index.ts`, `memory.ts`, `advisor.ts`, `eval/` — in one slice series
**Takeaway**: when `buildAdvisorMessages` last changed shape (fold inserted before tail), the ordering doc, the invariants, and the window pins were updated in the same slices; the new filter should land the same way — code, docs, pins, and eval fixture together.

### Precedent: markup dialect widening
**Commit(s)**: `0a8ef09` — "Widen markup stripping to function_calls and invoke (F023)"
**Blast radius**: `advisor.ts` strip tiers + pins
**Takeaway**: strip-dialect coverage is the fallback lever if markup-only fires persist after this work (FRD Suggested Follow-ups); the four tiers live in `advisor.ts`.

### Precedent: the config that armed the problem
**Commit(s)**: `236cc25` — "Exclude the .rpiv artifacts from biome checks; set the advisor model to stepfun/step-5-preview"
**Blast radius**: `config.json` (now untracked, `config.example.json` added)
**Takeaway**: `stepfun/step-5-preview` is a preview model whose instruction-following is the dominant remaining variable; observe the warning frequency after deployment (FRD assumption).

### Composite Lessons
- Pipeline-shape changes in this repo always touch four layers at once: composition code, the ordering/invariant doc comments, the window test pins, and the eval fixtures (`06f3552` precedent; the t10/t22 flips and the `budget-respected` breakage are this change's instances).
- The husk warning is a designed fail-open, not an error: two byte-pinned notify arms exist precisely so a markup-only reply costs one fire and no commit — hardening the prompt and narrowing the payload attack the cause, never the warning (`plan-turn.ts:185`, `:286`).

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` — the FRD this research chains from; root-cause diagnosis and the eight recorded decisions
- `.rpiv/artifacts/plans/2026-11-03_09-59-12_jarvis-advisor-evolution.md` — plan that landed the fold, digest parameter, and eval runner (current pipeline shape)
- `.rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md` — design recording the "strip first, tail last" ordering decision the filter now extends
- `.rpiv/artifacts/plans/2026-10-30_09-11-32_tech-debt-series-commits-a-j.md` — prior tech-debt series; F023 markup-strip widening origin

## Developer Context
**Q (discover: Outcome: understand the cause first): What outcome do you want from this work?**
A: Understand the cause; pick the fix after seeing it.

**Q (discover: Finding 1 — no real tool channel): Keep the finding that every tool call is plain text by construction?**
A: Confirmed, plus the scope note: "the advisor should be only read the reasoning trace and output of the supervised model, therefore no need to tool calling".

**Q (discover: Finding 2 — the prompt ban failed): Keep the failed prompt ban as the root cause?**
A: Confirmed.

**Q (discover: Finding 3 — the warning is the designed fail-open): Keep the warning as designed fail-open?**
A: Confirmed.

**Q (discover: Fix scope: harden the prompt): What should the follow-up work target?**
A: Harden the prompt.

**Q (discover: Cross-cutting role note lands in prompt AND payload): Where should the role note land?**
A: Narrow the payload too.

**Q (discover: Filter scope and unconditional behavior): Which roles does the filter keep, and is there a toggle?**
A: Keep `user` and `assistant`; drop `system` and `toolResult`; no config toggle.

**Q (discover: Filter placement and identity floor): Where does the filter run and what is its empty case?**
A: First pass in `buildAdvisorMessages`; identity when no `user`/`assistant` survives.

**Q (`prompt.ts:186-200`): Should the identity floor return the input array object or a copy?**
A: Same-array identity. Matches `stripToolDeclarations` (`prompt.ts:46`), the `applyTokenBudget` identity doors (`prompt.ts:105-110`), and the t22 strict-equality pins (`tests/test.mjs:1559-1568`). `runAdvisor`'s shallow copy (`advisor.ts:493`) makes sharing safe.

**Q (`eval/runner.mjs:83-86`): The `budget-respected` CI-gate score fails guaranteed post-filter. What is the eval runner's scope?**
A: Fix in this work. Re-scope `systemsKept` (systems asserted only where the filter is identity; user/assistant survival asserted on filtered fixtures) and update `eval/fixtures/budget-window.json` so CI stays green.

**Q (`tests/test.mjs:641-703`): How should the flipping pipeline pins be handled?**
A: Surgery, not sibling pins (developer steering during research). t10 (`:665`, `:667`, `:669`) and the t22 window band (`:1627-1663`) are rewritten to assert the post-filter shape; survivors (t23, identity pins, notify pins) stay untouched.

## Related Research
- None yet — first research artifact for this topic.

## Open Questions
None — carried forward from the FRD (which deferred nothing), and both research-stage decisions were resolved at the checkpoint.
