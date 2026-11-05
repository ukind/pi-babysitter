---
date: 2026-11-05T14:39:59+0700
author: Yogiswara Utama
commit: b449b83
branch: main
repository: advisor-turn-gate
topic: "Advisor tool evidence — payload fix for false fabrication accusations"
confidence: high
complexity: medium
status: ready
verdict: pass
tags: [solutions, prompt-shaping, advisor-payload, tool-evidence, pure-pass]
last_updated: 2026-11-05T14:39:59+0700
last_updated_by: Yogiswara Utama
---

# Solution Analysis: Advisor tool evidence — payload fix for false fabrication accusations

**Date**: 2026-11-05T14:39:59+0700
**Author**: Yogiswara Utama
**Commit**: b449b83
**Branch**: main
**Repository**: advisor-turn-gate

## Research Question

How should the advisor payload carry the executor's real tool outputs so the advisor stops filing false fabrication accusations — the regression caused by commit `2514358` narrowing the payload to user/assistant roles (dropping every `toolResult` while keeping orphaned `toolCall` blocks), which makes the pi-ai host transform back-fill synthetic `"No result provided"` error results?

Four candidates were independently scored by four parallel codebase-analyzer agents across six dimensions (approach-shape, precedent-fit, integration-risk, migration-cost, verification-cost, novelty), each with file:line evidence verified at HEAD `b449b83`.

## Summary

**Problem**: The advisor sees every executor tool call paired with a synthetic `isError: true` "No result provided" result and concludes the supervised agent fabricated its outputs.
**Recommended**: Inline evidence pass — a sixth pure pass `inlineToolEvidence` in `prompt.ts`, composed innermost as `keepAdvisorRoles(inlineToolEvidence(llmMessages))`, converting `toolCall` blocks into prose notes and non-empty `toolResult`s into `[tool output]` user lines at their positions. It is the only candidate that removes the back-fill's cause rather than decorating around it.
**Effort**: Low-Med (~1 day: ~170-250 lines across 5-7 files, one eval re-run, a four-claim doc sweep).
**Confidence**: High — decisive evidence is traced at the source level, and the skip-empties decision was verified against all five `toolResult` fixtures (all `content: []`), so zero existing pins re-pin.

## Problem Statement

**Requirements** (from the FRD, `.rpiv/artifacts/discover/2026-11-05_13-19-15_advisor-tool-evidence.md`):
- No content item of type `toolCall` remains in the payload the provider sees (req 3).
- The host back-fill cannot fire because call blocks are rewritten to text (req 5).
- Evidence is positioned after its paired call's note, preserving transcript order (req 4).
- Full output always, verbatim; `applyTokenBudget` stays the guard when configured.
- The default system prompt documents the `[tool output]` convention (req on config surface); `config.example.json` matches.

**Constraints** (hard):
- Anti-mimicry: no markup-shaped tool syntax in the payload (recorded developer decision; the reason `2514358` exists).
- Never mutate `event.context.llmMessages` (live executor transcript, `index.ts:92`).
- `prompt.ts` stays a pure module with zero runtime imports (`prompt.ts:1` is the type-only invariant).
- Copy-on-write aliasing discipline: cheap-scan identity doors, same-array return when nothing changes.
- Offline test suite stays green; pins must assert provider-visible payload facts.

**Success criteria**:
- Provider-visible payload contains zero `toolCall` items and zero `"No result provided"` text.
- Existing pins hold byte-for-byte (t10, t10b, t22, t23, t7b).
- Evidence pairs read in transcript order with the error marker on failed outputs.
- The four falsified doc claims are swept in the same change.

## Current State

**Existing implementation:**
- `buildAdvisorMessages` (`prompt.ts:225-237`) composes inner-to-outer: `keepAdvisorRoles` → `stripToolDeclarations` → `applyTokenBudget` → `ensureUserTail`, then splices the optional memory digest (`:233-236`).
- `keepAdvisorRoles` (`prompt.ts:53-57`) drops every non-user/assistant role — including all `toolResult`s — while `stripToolDeclarations` (`:80-94`) only removes `toolsAdded`/`toolsRemoved` properties from system messages; `toolCall` blocks inside kept assistant messages survive.
- `runAdvisor` copies the shaped array verbatim (`advisor.ts:493`) and sends it into `completeSimple` (`:509-513`), where the host transform runs: pending calls register from assistant `toolCall` blocks (`transform-messages.js:182-185`), results register by `toolCallId` (`:189-192`), and every pending id unresolved at a flush boundary (next assistant `:171`, any user `:203`, end `:211`; system held back `:193-200`) gets the synthetic `{ content: [{ type: "text", text: "No result provided" }], isError: true }` (`:151-158`, text at `:155`).

**Relevant patterns:**
- Pure pass with identity doors: 5 existing doors in `prompt.ts` (`:54`, `:55-57`, `:81`, `:142/:143/:146/:159`, `:199-200`) — the dominant idiom.
- Lettered test bands: 5 existing (`t10b` `tests/test.mjs:702`, `t15b` `:857`, `t22c` `:1718`, `t23c` `:1926`, `t27c` `:3131`).
- Constant-prefix pin: `BUDGET_FOLD_MARKER_PREFIX` (`prompt.ts:113`), pinned via `startsWith` at 3 sites.
- Array-form fresh-message construction: 3 sites (fold marker `prompt.ts:168-181`, nudge `:201-203`, loop replay `advisor.ts:567`).

**Integration points:**
- `index.ts:92` — the live transcript the pass must never mutate; `index.ts:104-110` — the `buildMessages` thunk, the only seam through which the pass is reached.
- `advisor.ts:493/:509-513` — the verbatim send that makes shaped-array pins provider-visible.
- `eval/runner.mjs:277/:287/:319` — the eval harness binds the same seam; fixtures re-run after the substrate changes.

## Solution Options

### Option 1: Inline evidence pass (RECOMMENDED)

**How it works:**
A new exported pure function `inlineToolEvidence(messages: Message[])` in `prompt.ts` walks the transcript with the host transform's window semantics (flush at next assistant, any user, end; system messages never boundaries), rebuilds only assistant messages whose `content` contains `type: "toolCall"` items (blocks replaced in position by prose notes carrying tool name + arguments, `argumentsError` appended when present), replaces each non-empty `toolResult` at its position with a `UserMessage` of single-`TextContent` array form (`[tool output]` prefix, source `timestamp` propagated, trailing `[tool output ended in error]` line on `isError`, multi-block text joined with `"\n"`, one image placeholder per run), passes empty-content results through untouched (skip-empties), and returns a new array — untouched messages by reference, `llmMessages` never mutated. Composed innermost: `keepAdvisorRoles(inlineToolEvidence(llmMessages))` (`prompt.ts:230`). Plus: one convention line in `DEFAULT_CONFIG.systemPrompt` after "You have no tools and cannot call any." (`config.ts:56`), a `systemPrompt` key in `config.example.json` (full default verbatim), a new `t10c` test band, one appended t7b assert, and a four-claim doc sweep.

**Pros:**
- Removes the back-fill's **cause**: no pending call survives, so the transform's synthetic never fires (`transform-messages.js:147-166` requires a pending id; none remains).
- Strongest precedent fit: the 6th identity-door pass in a mature idiom; reuses lettered bands, constant-prefix pins, array-form construction, and the `extractAdvisorText` join (`advisor.ts:196-202`).
- Zero re-pins: all five `toolResult` fixtures in the suite have `content: []` (`tests/test.mjs:671, :707, :720, :1707`, plus `:693` feeding `ensureUserTail` directly) — verified; skip-empties keeps t10/t10b/t22/t23/t7b byte-for-byte. t25/t26 are structurally immune (loop/consult conversations are built in-test, never shaped by `prompt.ts`).
- Its two decisive pins (zero `toolCall` items; no `"No result provided"` text) are **offline-assertable** because the shaped array is sent verbatim (`advisor.ts:493`, `:509-513`) and `transform-messages.js:155` is the string's only producer — the first provider-visible pins in the suite.

**Cons:**
- The pairing walk must mirror the host window semantics exhaustively across every `stopReason` — including `"error"`/`"aborted"`, where the note dies with the dropped assistant message but the `[tool output]` line survives (user messages pass through, `transform-messages.js:73-74`).
- ~170-250 lines and a four-claim doc sweep — the largest change surface of the four candidates.
- The `[tool output]` user lines are ordinary fold candidates; a note/output straddle is possible when the budget breaks exactly at a note (accepted: fold-independently, no `applyTokenBudget` change).

**Complexity:** Medium (~1 day)
- Files to create: 0
- Files to modify: 5-7 (`prompt.ts` ~+70-100, `config.ts` +1 concat line, `config.example.json` +1 key, `tests/test.mjs` ~+90-130, `README.md`/`TECH_DEBT_AUDIT.md`/`AGENTS.md` ~5-10 edited lines)
- Risk level: Low-Med — concentrated in one seam (the window mirror), mitigated by red-first provider-visible pins.

### Option 2: Keep-role widening

**How it works:**
Widen `isAdvisorRole`/`keepAdvisorRoles` so `role: "toolResult"` passes through, and extend `stripToolDeclarations` to delete `toolCall` blocks from assistant content. No new message shapes; the transform sees results natively.

**Pros:**
- The synthetic back-fill does not fire (verified trace: pending set stays empty, `closePendingToolCalls` no-ops at all three boundaries).
- Smallest `prompt.ts` diff (~25-40 lines); no config changes; no prompt-convention line needed.

**Cons:**
- **Its central mechanism claim is false**: the transform performs no re-association — a call-less assistant cannot own a result, so `toolResult`s ship as **orphans**. At the wire: OpenAI-family serialization produces `{ role: "tool", tool_call_id: <dangling> }` (`openai-completions.js:1087-1092`), Anthropic wraps orphan `tool_result` blocks (`anthropic-messages.js:1191-1212`) — acceptance rests on remote-API leniency, commonly a 400.
- Partially re-opens anti-mimicry: the payload again reads as a tool conversation (the narrowing's recorded rationale, `prompt.ts:10-13`), with arbitrary executor-controlled text in the provider-native tool role that `stripAdvisorMarkup` (`advisor.ts:289`, reply-channel only) never sees; `params.tools = []` gets advertised over tool-role history (`openai-completions.js:609-612`).
- The most common tool-bearing turn shape (`stopReason: "toolUse"`, all-content-is-toolCall) becomes an empty shell — no drop-vs-keep rule specified; `ensureUserTail` fires only on assistant tails, so tool tails ship nudged-less and void the tail guarantee.
- Breaks t10 (`:675-685`), t10b (`:711-725`), t22 floor (`:1704-1716`), and the CI eval gate's `narrowed` predicate (`eval/runner.mjs:86-88` vs `budget-window.json:68`) — guaranteed red.
- The decisive verification surface (provider acceptance of orphan wire messages) lies **beyond even the host transform** — strictly untestable offline, a larger blind spot than the one that burned `2514358`.

**Complexity:** Medium (~1-1.5 days counting test + eval surgery)
- Files to modify: 4-5 (~25-40 lines `prompt.ts`, ~60-100 lines tests, ~10-20 lines eval, ~5-10 docs)
- Risk level: High

### Option 3: Trailing evidence digest

**How it works:**
Keep the narrowing; collect call+output pairs into one digest-style message appended after shaping, in the `digestMessage` style (`memory.ts:189-199`).

**Pros:**
- Rides the stable digest precedent (builder + splice + seam, triple-pinned at `tests/test.mjs:1861-1905`).
- Nothing in the transcript is rewritten; `index.ts` untouched; constraints 2-4 satisfied trivially.

**Cons:**
- **The defect survives intact**: orphaned `toolCall` blocks are untouched, so the synthetic `"No result provided"` fires for **every** call (`transform-messages.js:182-185` registers them; `existingToolResultIds` stays empty). The model reads fake failures adjacent to the calls **plus** a contradictory trailing prose account — the accusation trigger is not removed, it is contradicted.
- The decisive pin is a **false green**: the shaped array genuinely contains no `"No result provided"` text (the string is injected host-side, after dispatch), so an offline assert passes while production still shows synthetics — the exact offline-green/production-red class of `2514358`.
- Bypasses the fold entirely (appended post-`applyTokenBudget`), so "full output always" × N calls exceeds any configured budget without bound; the memory digest is bounded by `memoryCap`, this by nothing.
- Two-digest ordering is unspecified (first two-digest payload in repo history); a system-role variant is held back by the transform (`:193-200`) and lands after the synthetics; a user-role variant orphans the nudge's meaning; FRD req 4 (transcript order) fails by construction.
- The sketched `name({args})` format re-introduces call-shaped text — the mimicry substrate class the `strip → widen → narrow` chain was spent removing.

**Complexity:** Medium (~1 day)
- Files to modify: 4-5 (~60-120 lines `prompt.ts`, config line, example key, ~40-80 lines tests)
- Risk level: High — high integration risk and high drift exposure for zero corrective benefit.

### Option 4: Naive revert of `2514358`

**How it works:**
`git revert 2514358` — restore the pre-narrowing full-transcript payload (all roles, `toolCall` blocks and `toolResult`s as-is). Mechanically the cleanest candidate: parent `7cc8e04` and HEAD are adjacent; `2514358..HEAD` contains only the artifact-only commit `b449b83`; zero conflict surface; the write-set is the mirror of one 7-file commit.

**Pros:**
- One conflict-free command; the pre-`2514358` behavior is verified correct against the **current** host transform (real results register by `toolCallId`, `:189-192`, and suppress the synthetic entirely — "no pending call, no synthetic result").
- Accidentally re-trues the stale `AGENTS.md:4`/`README.md:4` "projected transcript" claims.

**Cons:**
- **Directly contradicts the recorded developer decision**: "Keep anti-mimicry — a naive revert re-opens the markup-mimicry failure" (FRD Decision 3). The observed pre-narrowing failure: `stepfun/step-5-preview` serialized tool calls as markup text, replies stripped to `""`, every fire died on the pinned `advisor reply was markup only` warning — one wasted fire per occurrence, swapping the current fail-ugly for a fail-open regression that offline tests demonstrably cannot catch.
- Deletes the only executable guards of the floor invariant (t10b `:702-728`, t22 `:1704-1716`) with **no replacement**, and restores the zero-provider-visible-pins blind spot that caused the incident chain.
- Re-exposes unredacted tool-output secrets the current FRD explicitly assumed away (with no redaction pass in existence).
- Docs flip a third time in one day (`architecture.md:3,15`, `TECH_DEBT_AUDIT.md:104`); any future inline-evidence work must re-base onto the restored pipeline and re-derive the slot analysis.

**Complexity:** Low (~1 hour)
- Files to modify: 7 (by the revert itself)
- Risk level: High — constraint violation, secrets, and verification-value regression outweigh mechanical simplicity.

## Comparison

| Criteria | 1. Inline evidence pass | 2. Keep-role widening | 3. Trailing evidence digest | 4. Naive revert |
|----------|----------|----------|----------|----------|
| Complexity | M (~1 day) | M (~1-1.5 days) | M (~1 day) | L (~1 hour) |
| Codebase fit | H (6th door in dominant idiom) | L (0 precedents; reverses the record) | M (rides digest; first two-digest payload) | L (repo has never rolled back) |
| Risk | L-M (one mirror seam, pinnable) | H (orphan wire acceptance, untestable) | H (defect survives; false-green pin) | H (recorded constraint violated) |
| Removes the back-fill cause | Yes | Yes (via orphaning, unverified downstream) | **No** | Yes |
| Existing pins | 0 re-pin (skip-empties, verified) | ~3 bands break + CI eval red | 0 break but 0 cover | All narrowing pins deleted, none replaced |
| Decisive fact offline-assertable | Yes (2 provider-visible pins) | No (lives beyond the transform) | No (false green) | No (needs live observation) |

## Recommendation

**Selected:** Option 1 — Inline evidence pass.

**Rationale:**
- Only candidate that removes the synthetic back-fill's **cause** (no pending call survives the rewrite) while keeping the anti-mimicry constraint: notes are prose-shaped, no angle-bracket vocabulary, and the role filter stays — evidence goes in front of it, not around it.
- Dominant idiom: the 6th cheap-scan identity-door pure pass, 5 lettered-band precedents, 1 constant-prefix pin precedent, 3 array-form construction sites — every convention it needs already exists and is counted.
- Zero re-pins verified: all five `toolResult` fixtures have `content: []`; skip-empties keeps every existing band byte-for-byte, and t25/t26 are structurally immune.
- First suite pins that assert **provider-visible** payload facts — exactly the gap (`2514358` passed every offline gate and broke in ~26 minutes) this research's precedent record demands closing.

**Why not alternatives:**
- Option 2: its pairing claim does not exist in the transform; orphan `toolResult`s reach provider APIs with dangling `tool_call_id`, acceptance unverified and untestable offline; partially re-opens anti-mimicry; guaranteed CI red without surgery.
- Option 3: the defect mechanism survives untouched — the model still reads `isError: true` synthetics beside every call, now contradicted by trailing prose; the decisive pin is a false green; unbounded post-fold payload.
- Option 4: mechanically trivial but contradicts the recorded FRD decision, re-opens a production-verified failure mode, deletes pin architecture without replacement, and re-exposes secrets.

**Trade-offs:**
- Accepting the pairing-walk complexity (mirror of `transform-messages.js:138-212`) for in-position evidence that provably kills the back-fill.
- Accepting the rare note/output fold straddle (fold-independently) and the never-fold-last bound for zero `applyTokenBudget` changes.
- Accepting the example-file minimalism reversal (one clause of `1690b9e`, consciously reversed per the FRD) for discovery-surface parity.

**Implementation approach:**
1. Land `inlineToolEvidence` in `prompt.ts` with the window-mirroring walk, prose notes (name + arguments, `argumentsError` appended, no markup vocabulary), `[tool output]` user lines (verbatim text join, error marker, propagated timestamps, image placeholder), skip-empties, and the sixth identity door — composed innermost at `prompt.ts:230`.
2. Add the convention line to `DEFAULT_CONFIG.systemPrompt` after `config.ts:56`; mirror the full default into `config.example.json` keyed between `timeoutMs` and `customType`.
3. Add the `t10c` band (identity door, zero surviving `toolCall` items, prefix freeze via exported constant + `startsWith`, no `"No result provided"`, error marker, empty-content skip, multi-call ordering, one composed pin) and the appended t7b assert.
4. Sweep the falsified docs: `README.md:28`, `TECH_DEBT_AUDIT.md:38` (F005) and `:104`, plus the pre-existing stale `AGENTS.md:4`/`README.md:4` claims.
5. Re-run the eval fixtures (the runner binds the same seam; score expectations may move).

**Integration points:**
- `prompt.ts:230` — the single composition-site edit.
- `config.ts:50-58` — one concat line; narrowing at `:223-226` untouched.
- `tests/test.mjs:728-730` — `t10c` band placement; import added to the `:109-119` prompt block; t7b assert near `:398-412`.
- `eval/runner.mjs:277/:287/:319` — fixture re-run obligation.

**Patterns to follow:**
- Identity-door pure pass: `prompt.ts:54`, `:81`, `:142-159` (sixth of the kind).
- Lettered test band: `t15b` (`tests/test.mjs:857`) — later pure pass adjacent to its host band.
- Constant-prefix freeze: `BUDGET_FOLD_MARKER_PREFIX` (`prompt.ts:113`), `startsWith` pins.
- Array-form message construction: `prompt.ts:180-186`, `:202`; text join: `advisor.ts:200`.

**Risks:**
- Host transform drift (caret-pinned `^1.4.0`, `node_modules` untracked): mitigated by the red-first provider-visible pins (they fail if the observable rule "no pending call, no synthetic" changes shape) and by pinning the window semantics as documented in-repo.
- Mimicry via the new notes: mitigated by prose-shaped notes and `stripAdvisorMarkup` continuing to guard the reply channel; watch the fix-chain pattern (strip → widen → narrow → fabricate) with a post-deploy observation.
- Offline-green overconfidence: the class-level lesson stands — after landing, observe one live fire before declaring the regression closed.

**Conditions that would change the recommendation:** a future pi-ai minor that changes the transform's observable rule would force re-verification of the window mirror (the pins catch this); a developer reversal of the anti-mimicry constraint would make Option 4 mechanically attractive but it would still fail on secrets exposure and pin-architecture loss.

## Scope Boundaries
- Building: the pure evidence pass, its composition slot, the config convention line, the example-file key, the test band, the doc sweep, the eval re-run.
- Not doing: any `applyTokenBudget` change (fold-independently), any change to `keepAdvisorRoles`, `stripToolDeclarations`, the loop/consult channels (`advisor.ts:537/:567`), the specialist prompt (`config.ts:70-74`, never sees evidence lines), or host/`node_modules` code.

## Testing Strategy

**Unit tests** (single `tests/test.mjs`, plain `node:assert`, no host imports — the `:16-21` header makes `MODULE_NOT_FOUND` the tripwire):
- `t10c` band: identity door (same array, no tool activity); zero surviving `type: "toolCall"` items in the shaped payload; exported `[tool output]` prefix constant pinned via `startsWith`; no `"No result provided"` text anywhere in the payload (red-first: fails on pre-fix code); error-marker trailing line on `isError`; empty-content skip (locks skip-empties and certifies t10/t10b/t22 greenness); multi-call positional ordering; one composed `buildAdvisorMessages` pin.
- Appended t7b assert: `/\[tool output\]/.test(DEFAULT_CONFIG.systemPrompt)`.
- Existing bands byte-for-byte: t10 `:675-685`, t10b `:711-727`, t22 `:1583-1716`, t23 `:1870-1919`, t7b `:395-413`, all config-door bands.

**Integration tests:**
- Eval fixture re-run via `eval/runner.mjs` (same seam binding); budget-window and markup-hardening score expectations updated with the substrate.

**Manual verification:**
- [ ] One live gate fire post-deploy: advisor reply contains no fabrication accusation; no `advisor reply was markup only` warning.
- [ ] `git diff config.example.json config.ts` shows the key and default are byte-identical (FRD acceptance check; no suite reads the example).
- [ ] Doc sweep grep: no remaining "not shipped" claim at `README.md:28`; `TECH_DEBT_AUDIT.md:38/:104` and `AGENTS.md:4`/`README.md:4` re-worded.

## Open Questions
**Resolved during research:**
- Do any existing `toolResult` fixtures carry text? — No: all five have `content: []` (`tests/test.mjs:671, :707, :720, :1707`, `:693`); skip-empties keeps every pin green (agent-verified).
- Does the transform pair results to call-less assistants (Option 2's premise)? — No: pairing requires assistant-carried `toolCall` blocks (`transform-messages.js:182-185`); call-less assistants leave the pending set empty and results ship as orphans (agent-traced).
- Would a trailing digest suppress the synthetic (Option 3's premise)? — No: pending calls flush with synthetics at every boundary regardless of appended messages (`:171`, `:201-205`, `:211`); the digest lands after the fakes (agent-traced).
- Is pre-`2514358` behavior correct against the current transform (Option 4's premise)? — Yes, but irrelevant: the constraint collision is decisional, recorded in the FRD (agent-verified).

**Requires user input:** None — the FRD records every decision (fix shape, full output, skip-empties, error marking, fold independence, prompt update).

**Blockers:** None.

## References

- `.rpiv/artifacts/research/2026-11-05_13-47-22_advisor-tool-evidence.md` - the driving research: pairing contract, insertion point, test blast radius, precedent lessons
- `.rpiv/artifacts/discover/2026-11-05_13-19-15_advisor-tool-evidence.md` - the FRD: root cause, decisions, requirements, acceptance criteria
- `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` - the prior FRD that introduced `keepAdvisorRoles` (the anti-mimicry motive)
- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` - consumer-audit lesson: audit content blocks, not roles
- `.rpiv/artifacts/validation/2026-11-05_12-41-02_advisor-markup-hardening.md` - offline-gates-green record for `2514358` (the class-level warning)
- `prompt.ts:225-237` - `buildAdvisorMessages`, the composition site
- `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:138-212` - the host pairing machine the pass must satisfy
- `advisor.ts:493, :509-513` - the verbatim send that makes shaped-array pins provider-visible
- `.rpiv/artifacts/solutions/` - this document; feeds `/skill:design`
