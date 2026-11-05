---
date: 2026-11-05T10:28:09+0700
author: Yogiswara Utama
commit: 7cc8e04
branch: main
repository: advisor-turn-gate
topic: "Advisor markup-only hardening: payload narrowing vs alternatives"
confidence: high
complexity: low
status: ready
verdict: pass
tags: [solutions, advisor, prompt-shaping, plan-turn, eval-runner]
last_updated: 2026-11-05T10:28:09+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Advisor markup-only hardening (payload narrowing vs alternatives)

**Date**: 2026-11-05T10:28:09+0700
**Author**: Yogiswara Utama
**Commit**: 7cc8e04
**Branch**: main
**Repository**: advisor-turn-gate

## Research Question
Which solution shape prevents the advisor's "markup only" failure — fake tool-call markup emitted as plain text by the preview model because its input context mimics a tool-using conversation — given the FRD at `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` and the research at `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md`?

## Summary
**Problem**: The advisor model (stepfun/step-5-preview) sometimes answers with tool-call markup in plain text. The input payload mimics a tool conversation: persisted prompt-state system messages carry tool declarations and `toolsAdded`/`toolsRemoved` deltas, and `toolResult` chains ship whole (`triggerOnError: true` aims the gate at exactly the densest, errored turns).
**Recommended**: Role filter + prompt rewrite (Option 1) — the FRD-chosen approach, now independently re-verified with one research-doc correction folded in.
**Effort**: Low (~0.5–1 day: ~80–120 lines across 5 files).
**Confidence**: High — every load-bearing claim re-verified in-session against source at `7cc8e04` and the running host binary.

## Problem Statement

**Requirements (from the FRD, locked):**
- The advisor reviews only the reasoning trace and outputs of the supervised model; it has no tools and must answer in plain prose.
- Keep `user`/`assistant`; drop `system`/`toolResult`; no config toggle.
- Filter runs first in `buildAdvisorMessages`; identity floor returns the original array when nothing survives.
- Test surgery (not sibling pins) for the flipping pins; the eval `budget-respected` score is fixed in the same slice.
- The two markup-only notify strings (`plan-turn.ts:185`, `:286`) stay byte-identical (FR5).

**Constraints:**
- Hard: zero runtime npm dependencies; doc comments are pinned contracts; CI runs test + lint + typecheck + eval, and the eval runner is the CI gate (`exit 1`).
- Soft: keep the t7b substring pins (`/no tools/`, `/text only/`) alive by keeping both substrings in the rewritten prompt.

**Success criteria:**
- Advisor payload contains no prompt-state system messages and no `toolResult` chains; digest and nudge still join.
- Existing pipeline pins survive or are surgically replaced; eval CI stays green.
- Markup-only warning frequency trends down under live observation (the FRD's ratified efficacy check).

## Current State

**Existing implementation:**
- `prompt.ts:186-200` — `buildAdvisorMessages` = three-pass composition + digest insert. `stripToolDeclarations` (`prompt.ts:45-66`) removes `toolsAdded`/`toolsRemoved` from system messages; `applyTokenBudget` (`prompt.ts:104-158`) folds old messages under a budget, skipping `role === "system"` (`:115`); `ensureUserTail` (`:160-167`) appends a nudge after an assistant tail.
- `config.ts:50-58` — `DEFAULT_CONFIG.systemPrompt`: role framing, "no tools", prose demand, markup/angle-bracket ban. Governs live behavior because `config.json` omits the key (`config.ts:223-226`).
- `advisor.ts:211-296` — the output-side defense: four strip tiers behind `TOOL_MARKUP_PATTERN`, applied at every commit seam (`index.ts:219, :248, :259, :291`). The wire is already tool-free: `tools: []` ships on every advisor call (`advisor.ts:511`, `TECH_DEBT_AUDIT.md:26`).

**Verified host fact (new this session, corrects the research doc's open seam):**
- `event.context.llmMessages` is `convertToLlm(projection.messages)` built by the **running host binary** (pi-bolt.exe). The embedded `convertToLlm` — identical to `install/releases/1.4.0/.../pi-coding-agent/dist/core/messages.js:75`, `case "system"` at `:111` — **passes `role: "system"` through verbatim**. The npm copies (`~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js:75` and `pi-agent-core/dist/harness/messages.js:57`) drop system via `default → undefined`; the binary that actually runs this extension keeps it.
- Therefore live `llmMessages` DO contain the persisted prompt-state system messages (session format: the first request persists one with every prompt section and tool declaration; later ones patch sections and list `toolsAdded`/`toolsRemoved` — `pi-bolt` `docs/session-format.md:80`, `docs/message-types.md:95-105`). This includes the supervised model's own system prompt. Dropping it is the FRD's intent ("reasoning trace and outputs only"), and the tool-describing prompt is itself the mimicry vector.
- Child-session veto is fireable and filter-independent: the `<active_agent .../>` marker (producer: `@tintinweb/pi-subagents/src/prompts.ts:62`, delivered as `customPrompt` → `sections.preamble` per the `guard.ts` doc) rides the leading system message's `sections`; `isChildSession` scans content AND sections on the raw pre-shape array (`guard.ts:124-130`, bound `index.ts:95`) before any shaping.
- The digest (`role: "system"`, `memory.ts:189-198`) joins after the pipeline (`prompt.ts:192-195`) — never a filter input.

## Solution Options

### Option 1: Role filter + prompt rewrite (FRD-chosen)
**How it works:**
A pure role-whitelist function (keep `user`/`assistant`, drop `system`/`toolResult`, same-array identity floor) inserted as pass zero of the composition at `prompt.ts:191`, so the fold sizes the filtered payload. Plus a rewritten `DEFAULT_CONFIG.systemPrompt` (`config.ts:50-58`) matching the narrowed role. Closed-loop bookkeeping in the same slice: doc re-scopes, test surgery, eval score + fixture re-scope.

**Pros:**
- Directly removes the substrate that reads as a tool conversation — the only candidate that acts on the FRD's verified root cause (payload mimicry), while the wire is already tool-free.
- Maximum precedent: clones `stripToolDeclarations`' identity-door shape (`prompt.ts:46`) one slot earlier; the composition-insert maneuver landed verbatim in `06f3552`; strict-`===` pin style already exists (`tests/test.mjs:1559-1568`).
- Single chokepoint: 13 call sites inherit the filter with zero caller edits (production `index.ts:109`; eval `runner.mjs:288`; 11 test sites).

**Cons:**
- Guaranteed breakage that must be repaired in-slice: eval `budget-respected` (`runner.mjs:83-86`) fails → CI red; t10/t22 pins flip or go vacuous; three doc comments become false.
- Removes the supervised model's prompt sections from the advisor's view — intended per FR1, but a semantic payload change worth stating in the commit body.

**Complexity:** Low (~0.5–1 day)
- Files: prompt.ts (~22-28), config.ts (~9-12), tests/test.mjs (~45-75), eval/runner.mjs (~3-6), budget-window.json (~2-6); zero lines in plan-turn.ts / index.ts / advisor.ts / guard.ts / memory.ts.
- Risk level: Low — all breakage is in-slice and enumerated below.

### Option 2: Prompt rewrite only (rejected branch — evidence retained)
**How it works:**
Replace the `DEFAULT_CONFIG.systemPrompt` string only; payload untouched.

**Pros:**
- One file, ~9 lines, zero wiring, zero eval impact; substring pins designed to survive wording tweaks (`tests/test.mjs:394-402`).

**Cons:**
- Re-rolls the exact instruction the FRD recorded as already overridden by this model (Finding 2), while `tokenBudget: 0` keeps every `toolResult` shipping and `triggerOnError: true` aims the gate at the densest mimicry turns (`config.json:4,10`).
- CI cannot prove efficacy; warning telemetry only exists in UI sessions (`report.ts:30-37`).
- The FRD's own decision record chose payload narrowing *because* prompt-only's channel already failed.

**Complexity:** Low (~1 h). Risk: efficacy unbounded — a green merge can change nothing.

### Option 3: Strip widening + sanitize-commit (rejected branch — evidence retained)
**How it works:**
Output side: widen the four strip-tier regex alternations to more fake dialects, and/or convert the markup-only husk path into sanitize-and-commit or one corrective retry.

**Pros:**
- Widening (a) has exact precedent (`0a8ef09`, F023) and is cheap (~10-15 source lines, ~10-20 test lines).
- The existing loop is NOT a corrective retry for text husks (it gates on structured `toolCall` only, `advisor.ts:525`; fake markup rides text blocks with `stopReason: "stop"`, pinned `tests/test.mjs:954-955`) — so a retry would not be redundant.

**Cons:**
- A true husk has empty strip output (`stripped === ""`): there is no prose remainder to commit; "sanitize" would need a weaker filter that retains fake-call payload — zero precedent.
- Committed text replays into every later transcript (`plan-turn.ts:28-31`) and, when armed, the digest; salvage-commit amplifies junk injection.
- Retry doubles calls per husk, needs new conversation machinery (a bare re-call reproduces the mimicry), and has no offline unit surface if seam-level (`index.ts` is unloadable by plain node, `tests/test.mjs:14-16`).
- Husk-to-commit is the FRD's own parked/declined lever (Non-Goals; "convert-markup-to-note commit" kept for if hardening underperforms).
- Dialect whack-a-mole under byte-identity invariants (`advisor.ts:230, :261`) — a fallback lever, not a fix.

**Complexity:** (a) Low; (b) Medium-High (~50-150 lines across four layers). Risk: symptom-only; emission rate unchanged.

### Option 4: Facade no-tools enforcement (rejected on evidence)
**How it works:**
Pass `toolChoice: "none"` through the duck-typed `completeSimple` options so the provider API declares no native tool channel.

**Pros:**
- The field exists and forwards with no host change: pi-ai `types.d.ts:28,233-235`; runtime spread `model-runtime.js:451-470, :520-526`; adapter `openai-completions.js:617-619`. Migration ~3 lines in advisor.ts.
- The `tools: []` half is already shipped (`advisor.ts:511`) — zero migration.

**Cons (blocking):**
- **Inert against the failure**: the wire already declares no tools today (`tools: []`; adapter even sends explicit empty arrays when tool history exists, `openai-completions.js:609-613`), and the markup arrives as plain text. An API-level declaration cannot stop textual imitation — the repo's own `stripToolDeclarations` doc (`prompt.ts:37-43`) records that lesson.
- Armed-path contradiction: `toolChoice: "none"` would forbid `consult_specialist`/`read_file` when `loopArmed` (`advisor.ts:480-487`); must be conditioned, adding coupling.
- Provider rejection risk: the adapter forwards `tool_choice` with no tools-presence guard; strict OpenAI-compatible servers can 400, which resolves as `stopReason: "error"` → fail-open guidance loss (`advisor.ts:577-581`).
- Verification: provider obedience is untestable offline (`tests/test.mjs:2-3`); options-argument stubs don't exist today (every stub is `(model, context)`).

**Complexity:** Low (3 lines). Risk: adds failure paths while addressing nothing the root cause names.

## Comparison

| Criteria | 1 Role filter + prompt | 2 Prompt only | 3 Strip + sanitize | 4 Facade toolChoice |
|----------|----------|----------|----------|----------|
| Complexity | L/M (~0.5-1 d) | L (~1 h) | a: L, b: M/H | L (~3 lines) |
| Codebase fit | High (clones in-house shapes) | High | a: High, b: Low | Medium (first caller of the option) |
| Risk | Low (all breaks in-slice) | High (efficacy already falsified) | a: Low, b: High | High (inert + new failure paths) |
| Acts on root cause | Yes | No | No (symptom) | No (channel already closed) |

## Recommendation

**Selected:** Option 1 — Role filter + prompt rewrite.

**Rationale:**
- Only candidate that removes the mimicry substrate the FRD diagnosed; the other three either re-roll a falsified instruction (2), treat the symptom (3), or close a channel that is already closed on the wire (4).
- Every structural decision it needs is precedented in-repo: identity doors + `===` pins, composition insert, substring pin convention, surgery-not-siblings.
- The guaranteed breakage (eval score, t10/t22, three doc comments) is enumerated to the line and lands in the same slice, matching the FRD's locked decisions.

**Why not alternatives:**
- Option 2: the FRD's decision record already rejected prompt-only ("narrow the payload too"); its failure mode is on record.
- Option 3: (a) is the FRD's designated *fallback lever* after this work; (b) is the FRD's declined lever, and a husk has nothing to salvage by construction.
- Option 4: inert against plain-text imitation; adds armed-path coupling and a provider-400 risk; the load-bearing host-type question was answered and the candidate still fails on efficacy. Provider-semantics web research was not re-run (429'd once): moot given in-repo wire evidence.

**Trade-offs:**
- Accepting in-slice surgery (eval score, 2 test bands, 3 doc comments) for structural removal of the failure substrate.
- Accepting that the advisor no longer sees the supervised model's prompt sections — intended per FR1, stated in the commit body.

**Implementation approach:**
1. prompt.ts — filter function (clone the `stripToolDeclarations` shape; `===` floor), one-line insert at `:191` (filter first), doc re-scopes at `:6-7`, `:95`, `:172-173`.
2. config.ts — systemPrompt rewrite at `:50-58`, keeping "no tools"/"text only" substrings.
3. tests/test.mjs — surgery per verified map: **flip** t10 `:667`, `:669`; **crash-fix** t10 `:670` (out[3] becomes undefined → TypeError); **flip** t22 `:1634`. **Replace vacuous survivors** t10 `:665-666` and t22 `:1653-1657` (fatDelta) with real pipeline-order pins — left green they silently test nothing. Untouched: t7b `:401-402`, strip/identity direct pins `:675-678`/`:1559-1568`, t23 digest window `:1791-1856`, byte-pinned notify strings `:614`/`:3068`.
4. eval/runner.mjs + budget-window.json — re-scope `systemsKept` (`:83-86`) to absence-on-filtered-transcripts; keep system texts in the fixture input so the replay proves the drop. Unfixed = `exit 1` (`runner.mjs:403`).
5. Net-new pins (FR6): roles, `===` floor, filter-first order, new prompt substrings.

**Integration points:**
- `prompt.ts:191` — the composition insert (single chokepoint; 13 call sites inherit).
- `config.ts:50-58` — the prompt string (governs live via `config.ts:223-226`).
- `eval/runner.mjs:83-86` + `eval/fixtures/budget-window.json:10` — the CI gate repair.
- Untouched by contract: `plan-turn.ts:185`, `:286`; `advisor.ts:211-296`; `guard.ts:124-130`; `memory.ts:189-198`.

**Patterns to follow:**
- Pure function + same-array identity door: `prompt.ts:46` (`stripToolDeclarations`).
- Strict-`===` identity pins: `tests/test.mjs:1559-1568`.
- Substring pins for prose: `tests/test.mjs:394-402`.
- Composition insert with in-slice doc/pin/eval bookkeeping: `06f3552`.

**Risks:**
- Host-version divergence (verified, documented): the pi-bolt binary and release 1.4.0 pass `system` through into `event.context.llmMessages` (`messages.js:111`); the npm builds in `~/.pi/agent/npm/node_modules` drop it. The extension's live behavior is host-dependent; its own tests seed system messages directly, so pins stay host-independent. Do not cite the npm copy for host-behavior claims.
- Live efficacy is only observable in UI sessions (`report.ts:30-37`) — watch the warning frequency after deployment; the strip tiers (Option 3a) remain the designated fallback lever.

## Scope Boundaries
- Building: the role filter (first pass, `===` floor), the prompt rewrite, doc re-scopes, t10/t22 surgery, net-new pins, eval score + fixture re-scope.
- NOT building: any config toggle; husk-path changes or retry machinery (FR5 strings byte-identical); strip-dialect widening (parked fallback); specialist-leg changes; `toolChoice` plumbing; any host-package change.

## Testing Strategy

**Unit tests:**
- Filter: mixed transcript → only user/assistant out; `system`/`toolResult` dropped.
- Identity floor: system+toolResult-only transcript → the ORIGINAL array (`===`).
- Pipeline order: filter runs before strip/fold/tail (fold sizes the filtered payload); digest still joins (`t23` survives).
- Prompt: new substrings pinned in the t7b style; `/no tools/`, `/text only/` preserved.
- Surgery assertions per the map above (flip `:667`, `:669`; fix `:670` crash; `:1634`; replace `:665-666`, `:1653-1657`).

**Integration tests (eval):**
- `budget-respected` re-scoped: system texts absent on filtered transcripts, user/assistant survival asserted; fixture keeps systems in its input.
- All other six fixtures unharmed; digest lookup (`runner.mjs:111-120`) survives.

**Manual verification:**
- [ ] Deploy on a UI session; observe `advisor reply was markup only` frequency over the next working day (the FRD's ratified check; telemetry is UI-gated).
- [ ] Confirm a child-session fire still vetoes (marker in `sections.preamble` reaches the raw pre-shape array under the pi-bolt host).

## Open Questions
**Resolved during research:**
- Do `llmMessages` system entries include the supervised model's own system prompt? — Yes under the running pi-bolt host: the binary's `convertToLlm` passes `system` through (byte-extracted from pi-bolt.exe; matches release 1.4.0 `messages.js:111`), and persisted prompt-state system messages carry the prompt sections + tool deltas (`docs/session-format.md:80`). Dropping them is FRD-intended; the tool-describing prompt is the mimicry vector. The npm copies drop system — a host-version caveat, not a blocker.
- Can the facade express no-tools? — Yes (`toolChoice` exists and forwards), and it is already moot: the wire ships `tools: []` today and the failure persists as plain text.
- Is the child veto fireable? — Yes: marker rides `sections.preamble` of the leading system message (`pi-subagents` `prompts.ts:62`; guard reads content + sections on the raw pre-shape array).

**Requires user input:**
- None. Live-efficacy governance (escalation threshold to the parked levers) stays a deployment-observation question per the FRD.

**Blockers:**
- None.

## References
- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` — chained research; its surgery map is superseded where this doc notes flips vs vacuous passes (t10 `:665`, `:670`).
- `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` — the FRD; root cause and eight recorded decisions.
- `prompt.ts:186-200` — the composition and the filter's slot.
- `config.ts:50-58`, `config.ts:223-226` — the prompt constant and its live fallback.
- `eval/runner.mjs:77-88, :403` + `eval/fixtures/budget-window.json:10` — the CI gate that must be re-scoped in-slice.
- `advisor.ts:511`, `TECH_DEBT_AUDIT.md:26`, `prompt.ts:37-43` — the shipped `tools: []` and the recorded insufficiency of wire-level declarations.
- pi-bolt host (this session's verification): embedded `convertToLlm` passes `system` (byte-extracted from `pi-bolt.exe`); `install/releases/1.4.0/.../pi-coding-agent/dist/core/messages.js:111`; `docs/session-format.md:80`; `@tintinweb/pi-subagents/src/prompts.ts:62`.
