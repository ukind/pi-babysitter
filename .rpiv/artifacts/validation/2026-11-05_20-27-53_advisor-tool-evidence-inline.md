---
template_version: 1
date: 2026-11-05T20:27:53+0700
author: Yogiswara Utama
commit: b449b83
branch: main
repository: advisor-turn-gate
topic: "Validation of Advisor tool evidence — inline evidence pass"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-11-05_15-06-54_advisor-tool-evidence-inline.md"
tags: [validation, prompt-shaping, advisor-payload, tool-evidence, pure-pass]
last_updated: 2026-11-05T20:27:53+0700
---

## Validation Report: Advisor tool evidence — inline evidence pass

### Implementation Status

- ✓ Phase 1: Evidence pass — Fully implemented
- ✓ Phase 2: Config surface — Fully implemented
- ✓ Phase 3: Test band — Fully implemented
- ✓ Phase 4: Doc sweep + full baseline — Fully implemented

Note: the metadata block flagged `in_repo: no`, but the repository is real (branch `main` at `b449b83`) and git evidence was gathered normally. The implementation rides the working tree uncommitted on top of `b449b83`; the four `.rpiv/artifacts/*` untracked files are this pipeline's own records, not scratch.

### Automated Verification Results

- ✓ Type checking: `npx tsc --noEmit` — clean
- ✓ Lint, repo-wide: `npm run lint` — 35 files checked, no errors
- ✓ Full suite: `npm test` — all green, including the 26 new t10c asserts
- ✓ Eval score gate: `npm run eval` — 6/6 fixtures replayed, 8/8 scores pass
- ✓ Pass exists and composes innermost: `grep -c "inlineToolEvidence" prompt.ts` — 3 (banner, export, composition)
- ✓ No clock reaches the pass: `grep -n "Date.now" prompt.ts` — exactly 1 (the nudge stamp at prompt.ts:344)
- ✓ Convention rides the code default: `grep -c "tool output" config.ts` — 2 (prefix line + error-marker line)
- ✓ Example-file parity: the plan's byte-equality node one-liner — exit 0 (`config.example.json.systemPrompt === DEFAULT_CONFIG.systemPrompt`)
- ✓ Band carries its asserts: `grep -c "t10c:" tests/test.mjs` — exactly 26
- ✓ Red-first verified empirically: with `inlineToolEvidence` uncomposed from `buildAdvisorMessages`, `npm test` exits 1 failing exactly `t10c: the shaped payload carries zero toolCall items (provider-visible, red-first)` plus its three downstream consequence asserts; all other bands stay green; `prompt.ts` restored byte-identical afterwards (sha1 match)
- ✓ Falsified claim gone: `grep -c "not shipped" README.md` — 0
- ✓ Both docs name the inlining: `grep -c "inlines the executor"` — 1 in README.md, 1 in AGENTS.md
- ✓ Audit records the reversal: `grep -c "REVERSED for the example file" TECH_DEBT_AUDIT.md` — 1
- ✓ Audit note names the pass: `grep -c "inlineToolEvidence" TECH_DEBT_AUDIT.md` — 1
- ✓ No regressions detected — t10, t10b, t22, t23, t7b and every config band pass unchanged

### Code Review Findings

#### Matches Plan:

- prompt.ts:60-63, 116-232 — `TOOL_OUTPUT_PREFIX`, the private error/image lines, `toolCallNote`, `toolOutputLines`, and `inlineToolEvidence` match the Phase 1 spec verbatim (modulo Biome canonical formatting of two argument lists — formatting only, no behavioral difference)
- prompt.ts:235-237 — the composition is exactly `stripToolDeclarations(keepAdvisorRoles(inlineToolEvidence(llmMessages)))`, innermost as decided
- prompt.ts:3-12, 253-259 — module banner and `buildAdvisorMessages` doc comment both name the evidence pass and state the load-bearing order
- config.ts:50-58 — the systemPrompt default ends with the five-line convention block after the intact anti-mimicry block
- config.example.json:6 — `systemPrompt` sits between `timeoutMs` and `customType`, byte-equal to the code default
- tests/test.mjs:85-94 — the prompt.ts import block gained `inlineToolEvidence` and `TOOL_OUTPUT_PREFIX` (Biome-sorted)
- tests/test.mjs:409-413 — the t7b convention assert matches the plan's spec exactly
- tests/test.mjs:728-922 — the t10c band matches the plan verbatim: identity doors, call rewrite with reference preservation, output rewrite with timestamp propagation, degradation doors, and the composed band with the honest red-first / literal-guard labels
- README.md:3-5, 29 — both swept claims now match shipped behavior; the table row records the example-file copy
- TECH_DEBT_AUDIT.md:38, 104 — F005 reversal recorded; payload-narrowing note names the pass
- AGENTS.md:3-5 — the projected-transcript claim now names the inlining
- eval/, index.ts, advisor.ts — untouched, as the plan requires

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ The pass follows the established identity-door idiom (`messages.some(...)` early return, same-array identity), copy-on-write rebuilds, `as Message` narrowing casts, and zero runtime imports — the sixth of the kind alongside `keepAdvisorRoles` and `stripToolDeclarations`
- ✓ `TOOL_OUTPUT_PREFIX` mirrors the `BUDGET_FOLD_MARKER_PREFIX` constant-freeze precedent; the t10c band follows the t15b lettered-band precedent and the neighboring bands' inline object-literal fixture style
- Minor observation: two code snippets in the plan render differently in the file because Biome wrapped `toolOutputLines(...)` arguments across lines — canonical formatter output, not a deviation

#### Potential Issues:

- .rpiv/guidance/architecture.md:3,15 — the guidance overview ("sends the transcript's user and assistant turns") and the spoke map ("filter roles, strip tool deltas, ensure user tail") predate the evidence pass and do not name `inlineToolEvidence`. Both are incomplete rather than false (nothing they claim became untrue), and this file is outside the plan's Phase 4 file list. Comment-only gap: no executable line changes and no downstream stage fails as written. Non-blocking; fold into the next doc-touching change.

### Manual Testing Required:

Performed during this validation (recorded, no longer homework):

1. Transform-drift re-verification (Phase 4 manual item 2) — discharged: read the installed `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js` at pi-ai 1.4.0 (inside the caret range). The back-fill pushes the synthetic `isError: true` "No result provided" result at exactly the three flush boundaries the pass mirrors (next assistant message, any user message, end of conversation), the flush runs before the errored/aborted skip, and system messages are held back without flushing. With zero `toolCall` blocks in the shaped payload, `pendingToolCalls` stays empty and the back-fill is unreachable. The pass's mirrored window is current.
2. Phase 1-3 manual criteria — performed: the pass mutates no input and returns untouched messages by reference; notes are prose-shaped with no angle-bracket markup vocabulary; banner and composition doc comment name the pass; the systemPrompt reads as one coherent instruction set with the anti-mimicry block intact and the convention appended after it; the example-file key order is correct; every t10c assert message names the behavior it pins and the red-first / literal-guard labels are honest (empirically confirmed by the uncomposition drill); the four swept doc claims match shipped behavior end-to-end; table alignment passes Biome's check.

Remaining for the human (the plan ships this item unchecked):

1. Live-fire observation (Phase 4 manual item 1):
   - [ ] Run one gate-enabled session with real tool calls and confirm the committed `custom_message` carries no fabrication accusation for calls whose outputs shipped
   - [ ] Confirm no `advisor reply was markup only` warning fires in that session

### Recommendations:

- Ready to commit — implementation is complete and validated.
- Fold the `.rpiv/guidance/architecture.md:3,15` wording into the next doc-touching change so the guidance map names the evidence pass.
