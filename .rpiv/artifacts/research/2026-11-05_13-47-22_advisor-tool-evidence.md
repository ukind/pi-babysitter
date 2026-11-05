---
date: 2026-11-05T13:47:22+0700
author: Yogiswara Utama
commit: b449b83
branch: main
repository: advisor-turn-gate
topic: "Advisor tool evidence"
tags: [research, codebase, prompt-shaping, advisor-payload, tool-evidence, pipeline]
status: ready
last_updated: 2026-11-05T13:47:22+0700
last_updated_by: Yogiswara Utama
---

# Research: Advisor tool evidence

## Research Question

How should the advisor payload carry the executor's real tool outputs so the advisor stops filing false fabrication accusations — the regression caused by commit `2514358` narrowing the payload to user/assistant roles (dropping every `toolResult` while keeping orphaned `toolCall` blocks), which makes the pi-ai host transform back-fill synthetic `"No result provided"` error results? The FRD fix shape: a new pure pass `inlineToolEvidence(messages: Message[]): Message[]` in `prompt.ts`, placed first in `buildAdvisorMessages` before `keepAdvisorRoles`.

## Summary

The pass slots innermost in the pipeline as `keepAdvisorRoles(inlineToolEvidence(llmMessages))` (`prompt.ts:230-232`) and must copy the house aliasing pattern: cheap scan, same-array identity when no tool activity, per-message rebuild only where needed. Pairing must mirror the host transform's window semantics (`transform-messages.js:138-212`): results bind to calls by `toolCallId` inside the window from a calls-bearing assistant message to the next assistant/user/end boundary; system messages are never boundaries. The decisive scope finding: **every `toolResult` fixture that flows through `buildAdvisorMessages` has `content: []`** (`tests/test.mjs:671, :707, :720, :1707`), so the skip-empties decision (recorded below) keeps every existing pin green byte-for-byte — zero re-pins across t10/t10b/t22/t23. Emitted messages are `UserMessage`s with single-`TextContent` array content, source timestamps propagated; failed outputs carry a trailing `[tool output ended in error]` line; the fold stays untouched (fold-independently decision). Config gains one convention line after "You have no tools and cannot call any." (`config.ts:56`) and `config.example.json` gains the full default verbatim. New pins go in a `t10c` band after `t10b` (`tests/test.mjs:728-730`) plus one appended `t7b` assert. The precedent record warns: `2514358` passed every offline gate and broke production in 26 minutes — the new pins must assert what the provider will see (no `toolCall` items, no `"No result provided"` text), not just roles.

## Detailed Findings

### Pipeline composition and the insertion point

- `buildAdvisorMessages` (`prompt.ts:225-237`) composes inner-to-outer: `keepAdvisorRoles` → `stripToolDeclarations` → `applyTokenBudget` → `ensureUserTail`, then splices the optional digest (`prompt.ts:230-236`). FRD req 2 inserts the new pass innermost: `keepAdvisorRoles(inlineToolEvidence(llmMessages))`.
- Every existing pass carries a cheap-scan same-array identity door: filter `prompt.ts:54` (all-keep), floor `prompt.ts:55-57` (nothing survives → original array), strip `prompt.ts:81` (`.some` on `hasToolDeclarations`), fold `prompt.ts:142/:143/:146/:159`, tail `prompt.ts:199`. `inlineToolEvidence` must add a fifth door of the same shape or the reference-identity pins (`tests/test.mjs:712`, `:1635-1637`) lose meaning.
- Required copy-on-write contract: rebuild **only** assistant messages whose `content` contains a `type: "toolCall"` item (spread, new `content` array, notes replacing call blocks in position); replace each emitted `toolResult` with the injected user line at its position; return every untouched message by reference; never mutate `llmMessages` (it is the live executor context, `index.ts:92`).
- The strip's delta-removal map (`prompt.ts:82-93`) only executes on the filter's floor path today. Post-inline, the floor's firing class narrows from {no user ∧ no assistant} to {no user ∧ no assistant ∧ no toolResult}; system-only transcripts still reach it, so `stripToolDeclarations` stays load-bearing and its behavior is unchanged.

### The pairing contract (host transform, reverse-engineered)

- `transformMessages` second pass (`transform-messages.js:138-212`) tracks `pendingToolCalls` per assistant message (`:182-185` — wholesale replacement, Set reset), registers results by `msg.toolCallId` (`:190`), and synthesizes `{ role: "toolResult", ..., content: [{ type: "text", text: "No result provided" }], isError: true }` (`:151-158`, text at `:155`) for every pending id unresolved at a flush point.
- Flush boundaries are exactly: next assistant message (`:171`), any user message (`:203`), end of input (`:211`). **System messages are held back, not boundaries** (`:193-200`). The pass must mirror this: pair within the window, never treat system messages as boundaries.
- Errored/aborted assistant messages are dropped whole by the transform (`:178-180`) after closing the previous batch (`:171`). `keepAdvisorRoles` keeps all assistant messages regardless of `stopReason` (`prompt.ts:53-57`), so the rewrite must be exhaustive across every `stopReason` — including `"error"`/`"aborted"`, where the note dies with the dropped message but the `[tool output]` user line survives (user messages are never dropped, `transform-messages.js:73-74`).
- Degradation matrix (all decided or mechanical): unpaired call → note only, no crash (FRD req 5); orphan result (unknown id) → standalone `[tool output]` line, preserving evidence the filter would delete; duplicate results → one line per result message; result-before-call (out of order) → mirror the window, do not pair globally (preserves transcript order, FRD req 4).

### Emitted message shapes

- Emit `UserMessage`s with `content: [{ type: "text", text }]` (legal per `types.d.ts:363-367`). Repo convention is 100% array-form for fresh messages (fold marker `prompt.ts:180-186`, nudge `prompt.ts:202`, consult question `advisor.ts:429-433` region, loop replay `advisor.ts:567`); `estimateMessageTokens` counts the JSON wrapper by design (`prompt.ts:121-123`), and the transform is identity on user messages regardless of form (`transform-messages.js:73-74`).
- `arguments: JsonObject` renders losslessly with `JSON.stringify` (`types.d.ts:308-310`). One verbatim-ness edge: when the model emitted invalid JSON, `arguments` is `{}` and the raw text lives in `argumentsError` (`types.d.ts:282`) — the note must append it when present.
- Multi-block `toolResult.content` (`types.d.ts:424`, `TextContent | ImageContent`): join text blocks with `"\n"` (precedent `extractAdvisorText`, `advisor.ts:196-202`, join at `:200`); images collapse to one placeholder per run, mirroring the transform's own `"(tool image omitted: model does not support images)"` behavior (`transform-messages.js:2`, `:31-45`).
- Timestamps: propagate the source `ToolResultMessage.timestamp` (`types.d.ts:431-432`) into the injected line; notes ride the assistant message's timestamp (`types.d.ts:392`). `Date.now()` would break the fold-marker timestamp determinism (`prompt.ts:179`) and the t22-style correspondence pins (`tests/test.mjs:1634`).
- Notes must stay prose-shaped — tool name plus arguments, no angle-bracket markup vocabulary. The anti-mimicry constraint (FRD Decision 3) rules out notes that read as tool-call syntax; `stripAdvisorMarkup` (`advisor.ts:289`) guards only the reply channel, not the payload.

### keepAdvisorRoles floors after the pass

- Door 1 (all-keep, same array, `prompt.ts:54`): newly reachable by tool-bearing, system-free transcripts — a path it could not take before. Door 2 (floor, original array, `prompt.ts:55-57`): survives for system-only transcripts; pinned directly by `tests/test.mjs:722-725`, which stays green because t10b calls the filter and never traverses the new pass.
- The security hinge is unchanged: on the floor, the original system messages return with deltas intact and `stripToolDeclarations` (`prompt.ts:81-93`) strips them; had the floor returned `[]`, the deltas would ship unstripped (`.some` on `[]` is false) and the payload would be empty (`prompt.ts:48-51`).

### Digest and ensureUserTail interaction

- The digest joins **after** all shaping (`index.ts:104-110` builds it lazily; `prompt.ts:233-236` splices `[...shaped.slice(0, -1), digest, tail]`). The splice reads `shaped.at(-1)` at runtime, so the structural pins — digest at `length-2`, `role: "system"` (`memory.ts:194`), starved-budget survival (`tests/test.mjs:1885-1891`) — are insertion-proof. The t23 fixtures are tool-free (`tests/test.mjs:1872-1875`), so all t23 pins hold.
- What shifts: a transcript ending on `toolResult` now ends on the `[tool output]` user line, so `ensureUserTail` (`prompt.ts:199-204`) appends no nudge — the user-tail guarantee is met by the evidence line instead. The t22 floor pin's wording ("adds no nudge after a toolResult tail", `tests/test.mjs:1715`) becomes the general case for tool-tailed transcripts. With skip-empties, every existing fixture still ends as today, so nothing re-pins.

### Fold behavior with inlined evidence

- The fold's walk (`prompt.ts:150-157`) folds a **contiguous prefix of non-system messages**, skipping `system` (`prompt.ts:152`) and never the last message (`:150`). `[tool output]` lines are `role: "user"` → ordinary fold candidates.
- Pair fate under fold-independently: note + output fold together whenever the break lands at or after the output (the common case); the only possible split is note-folded/output-kept, when the break fires exactly at the note; the reverse is impossible. A terminal giant output is unfldable — the fold returns still-over payloads by the documented best-effort contract (`prompt.ts:135-137`), and `tokenBudget` default 0 (`config.ts:87`) means the fold is off and full evidence ships (FRD req 6 decision).
- Exemption was evaluated and rejected: skipping evidence lines like the system skip would make `total - foldedTokens` never reach budget for any transcript containing one, breaking "the fold bounds the payload" (FRD req 6). No `applyTokenBudget` change ships.

### Config surface

- `DEFAULT_CONFIG.systemPrompt` (`config.ts:50-58`) gains one convention line documenting the `[tool output]` prefix and the error-marker line; natural landing is immediately after "You have no tools and cannot call any." (`config.ts:56`) — the convention is the stated exception to that sentence, and input-shape facts precede output directives in the prompt's structure.
- Nothing pins the prompt byte-for-byte: t7b pins four position-independent substrings only — "no tools", "text only", "reasoning trace", "outputs" (`tests/test.mjs:398-411`), plus `display` at `:412`. Any placement keeps t7b green; one appended assert (`/\[tool output\]/`) locks the convention.
- Narrowing is untouched (`config.ts:223-226`): non-blank override wins, default otherwise. Override-holders keep their own text forever (accepted FRD trade-off).
- `config.example.json:1-8` carries exactly six keys — enabled/interval/model/timeoutMs/customType/display, all byte-identical to `DEFAULT_CONFIG` counterparts; **no `systemPrompt` key**. FRD req 8's "updated to match" means: add `"systemPrompt"` with the full new default string verbatim, keyed between `timeoutMs` and `customType` (declaration order `config.ts:50`, README table order `README.md:28`).
- The specialist prompt (`config.ts:70-74`) has a similar markup ban but never sees evidence lines — `runConsultLeg` builds its own single-user-message payload (`advisor.ts:450+`, consult path), bypassing `buildAdvisorMessages`. No change there.
- Doc claims that falsify when this lands: `README.md:28` ("Optional override, not shipped — the code default is the single source") and `TECH_DEBT_AUDIT.md:38` (F005, "The code default is the single source") + `TECH_DEBT_AUDIT.md:104` ("The advisor payload narrows to user and assistant turns … toolResult entries read as a tool conversation" — the payload description drifts again). `AGENTS.md:4` and `README.md:4` ("reads the projected transcript") were already stale before this work (precedent finding).
- No test reads `config.example.json` — grep confirms zero references; the example-vs-default sync is enforced only by the FRD's manual `git diff` acceptance check.

### Test blast radius and new pin placement

- The only `role: "toolResult"` fixtures flowing through `buildAdvisorMessages` are `tests/test.mjs:671` (t10 withNoise), `:707` (t10b mixed), `:720` (t10b floor), `:1707` (t22 floor) — all `content: []`. Under skip-empties the pass returns them untouched, `keepAdvisorRoles` drops them as today, and **every existing pin holds byte-for-byte**: t10 `:675-685`, t10b `:711-727`, t22 `:1601-1716`, t23 `:1870-1919`, t7b `:395-413`, all config-door bands.
- All other `toolCall`/`toolResult` hits (`tests/test.mjs:2144-2366`, `2477-2934`) live in t25/t26 and assert `runAdvisor`'s **internal** loop/consult conversation — built directly in the tests (`:2157`, `:2218`, …), replayed at `advisor.ts:537`/`:567`, never shaped by `prompt.ts`. Structurally immune; all hold.
- Pin (c) — "no payload text contains `No result provided`" — is offline-assertable because `runAdvisor` sends the shaped array verbatim (`advisor.ts:493` copies, `:509-513` sends) and the transform is the string's only producer (`transform-messages.js:155`); the repo never writes it (`advisor.ts:571` carries executor text or pinned refusals, `advisor.ts:65`, `:98-118`). Pin (a) (zero surviving `toolCall` items) structurally implies (c).
- Suite must **not** import the host transform — the header at `tests/test.mjs:16-21` makes a `MODULE_NOT_FOUND` the tripwire for exactly that leak (`prompt.ts:1` type-only import is the invariant).
- Placement per the file's convention (numbered band = territory, lettered suffix = later phase extension, e.g. t15b `:857`, the c-chains `:1540/:1718/:1926/:3131`): new band **t10c between `tests/test.mjs:728` and `:730`**, banner `// --- 10c. inlineToolEvidence: call notes, [tool output] lines, and the unpaired degrade (advisor-tool-evidence FRD).` Direct-pass pins: identity door (no tool activity → same array), (a), (b) with exact prefix freeze (export the prefix as a constant, `startsWith` pin — house style of `BUDGET_FOLD_MARKER_PREFIX`, `prompt.ts:113`, pinned `tests/test.mjs:1621-1622`), (c), (d), the empty-content skip pin (the assertion that locks skip-empties and keeps t10/t10b/t22 green), multi-call ordering, error-marker line. Composed pins ride inside t10c via `buildAdvisorMessages`. One appended bare assert in t7b (`:398-412`) for the convention substring. Import `inlineToolEvidence` in the existing `../prompt.ts` block (`tests/test.mjs:109-119`).

## Code References

- `prompt.ts:1` — type-only pi-ai import; the pure-module invariant tests guard
- `prompt.ts:29` — `ADVISOR_NUDGE`
- `prompt.ts:31-34` — `isAdvisorRole` predicate
- `prompt.ts:53-57` — `keepAdvisorRoles`: door 1 `:54`, filter `:55`, floor `:56-57`
- `prompt.ts:60-64` — `hasToolDeclarations` predicate
- `prompt.ts:80-94` — `stripToolDeclarations`: `.some` door `:81`, rest-destructure map `:82-93`
- `prompt.ts:97` — `CHARS_PER_TOKEN = 4`
- `prompt.ts:110` — `MARKER_TOKEN_ALLOWANCE = 64`
- `prompt.ts:113` — `BUDGET_FOLD_MARKER_PREFIX = "[context folded]"`
- `prompt.ts:121-123` — `estimateMessageTokens` (chars/4 over JSON-rendered message)
- `prompt.ts:141-193` — `applyTokenBudget`: identity doors `:142/:143/:146/:159`, walk `:150-157`, system skip `:152`, marker `:168-181`, timestamp `:179`
- `prompt.ts:197-204` — `ensureUserTail` (door `:199-200`, nudge append `:201-203`)
- `prompt.ts:224-237` — `buildAdvisorMessages`: pipeline `:230-232`, digest splice `:233-236`
- `advisor.ts:23-27` — `CompleteSimpleFn` facade type
- `advisor.ts:65` — `undeclaredToolRefusalFor` (pinned loop refusal)
- `advisor.ts:196-202` — `extractAdvisorText` (text join precedent, `:200`)
- `advisor.ts:289` — `stripAdvisorMarkup` (reply channel only)
- `advisor.ts:450` — `runAdvisor` entry
- `advisor.ts:493` — `conversation = [...params.messages]` (shaped array copied verbatim)
- `advisor.ts:509-513` — `completeSimple` call; the payload the host transform sees
- `advisor.ts:525-529` — loop gate + calls filter
- `advisor.ts:537` — assistant replay
- `advisor.ts:567, :571` — loop `toolResult` replay with `isError: !result.ok`
- `config.ts:16, :40` — `systemPrompt` / `specialistSystemPrompt` interface fields
- `config.ts:50-58` — `DEFAULT_CONFIG.systemPrompt` (anti-mimicry block `:56-58`)
- `config.ts:70-74` — specialist default (has markup ban, no evidence lines)
- `config.ts:87-88` — `MIN_TOKEN_BUDGET = 0` / `MAX_TOKEN_BUDGET = 1000000`
- `config.ts:223-226` — systemPrompt per-type narrowing (untouched)
- `config.ts:263` — tokenBudget clamp
- `config.ts:287-290` — specialist narrowing door
- `config.example.json:1-8` — six keys, no `systemPrompt` today
- `index.ts:92` — `llmMessages: event.context.llmMessages` (live executor transcript)
- `index.ts:104-110` — `buildMessages` thunk (digest `:107`, pipeline call `:109`)
- `index.ts:219, :248` — `stripAdvisorMarkup` on record/commit paths
- `memory.ts:189-199` — `digestMessage` (system role at `:194`)
- `plan-turn.ts:82` — `buildMessages` thunk type; `:145-146` prompt/messages ride-through
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:252-256` — `TextContent`
- `types.d.ts:266-270` — `ImageContent` (base64 `data` `:268`)
- `types.d.ts:271-283` — `ToolCall` (`id` `:273`, `name` `:274`, `arguments` `:275`, `argumentsError` `:282`)
- `types.d.ts:307` — `StopReason` union
- `types.d.ts:308-310` — `JsonValue`/`JsonObject`
- `types.d.ts:363-367` — `UserMessage` (`content: string | (TextContent|ImageContent)[]` `:365`)
- `types.d.ts:368-399` — `AssistantMessage` (`content` union `:370`, `timestamp` `:392`)
- `types.d.ts:420-435` — `ToolResultMessage` (`toolCallId` `:422`, `content` `:424`, `isError` `:430`, `timestamp` `:431-432`)
- `types.d.ts:436` — `Message` union
- `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:2` — tool-image placeholder constant
- `transform-messages.js:31-45` — `replaceImagesWithPlaceholder` (per-run collapse)
- `transform-messages.js:73-74` — system/user identity (never reshaped)
- `transform-messages.js:138-212` — second pass (the pairing machine)
- `transform-messages.js:147-166` — `closePendingToolCalls`; synthetic at `:151-158`, text `:155`
- `transform-messages.js:171` — flush before the error/aborted skip (`:178-180`)
- `transform-messages.js:182-185` — pending batch assignment + Set reset
- `transform-messages.js:189-192` — result registration by `toolCallId`
- `transform-messages.js:193-200` — system holdback (never a boundary)
- `transform-messages.js:201-205, :211` — user flush / end flush
- `tests/test.mjs:3` — runner command; `:16-21` offline-invariant header; `:109-119` prompt import block; `:163` `shapeJson`; `:147-160` assert helper
- `tests/test.mjs:395-413` — t7b (substring pins `:398-411`)
- `tests/test.mjs:660-702` — t10 (fixture `:662-673`, toolResult `:671`, pins `:675-685`)
- `tests/test.mjs:702-730` — t10b (mixed `:703-708`, all-keep `:714-717`, floor `:718-725`, empty `:726-727`)
- `tests/test.mjs:857` — t15b band (the lettered-band precedent for a new pure pass)
- `tests/test.mjs:1583-1718` — t22 (identity doors `:1601-1608`, fold battery `:1609-1665`, window `:1667-1703`, floor `:1704-1716`, toolResult `:1707`, pin `:1715`)
- `tests/test.mjs:1750-1926` — t23 digest window (`:1870-1919`; starved `:1885-1891`)
- `tests/test.mjs:2030-2416` — t25 loop (replay pins `:2180-2189`)
- `tests/test.mjs:2459-3005` — t26 consult (replay channel only)
- `tests/test.mjs:3131` — t27c (the lineage-chain suffix convention)
- `eval/runner.mjs:277, :287, :319` — eval harness forwards both system prompts and the shaped gate payload
- `README.md:4` — stale "projected transcript" claim (pre-existing)
- `README.md:28` — "not shipped" claim falsified by the example-file change
- `TECH_DEBT_AUDIT.md:38` — F005 "code default is the single source" wording drifts
- `TECH_DEBT_AUDIT.md:104` — payload description drifts again
- `AGENTS.md:4` — stale "projected transcript" claim (pre-existing)

## Integration Points

### Inbound References
- `index.ts:92` — `planGate` receives `event.context.llmMessages` (the live executor transcript the pass must never mutate)
- `index.ts:109` — the `buildMessages` thunk calls `buildAdvisorMessages(messages, config.tokenBudget, digest)`; the new pass is reached only through this seam
- `plan-turn.ts:146` — the consult decision invokes the thunk (`args.buildMessages(args.llmMessages)`) on every gate-pass
- `eval/runner.mjs:287-319` — the eval harness binds the same seam, so pipeline changes propagate to CI fixtures

### Outbound Dependencies
- `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:138-212` — the host pairing machine the pass must satisfy (observable rule: no pending call, no synthetic)
- `advisor.ts:493, :509-513` — `runAdvisor` sends the shaped array verbatim into `completeSimple`
- `types.d.ts:271-283, :420-435` — the block/message shapes the pass consumes and emits

### Infrastructure Wiring
- `tests/test.mjs:3` — offline runner `node --experimental-strip-types tests/test.mjs`; no framework, no network
- `eval/fixtures/` + `eval/runner.mjs` — CI-scored fixtures; the markup-hardening evals measure this payload substrate (FRD follow-up: re-run after the shape changes)
- `config.example.json` — discovery surface only; no suite pin (FRD acceptance = manual `git diff`)

## Architecture Insights

- Star-topology pure pass: `prompt.ts` keeps zero runtime imports (type-only `prompt.ts:1`); the new pass is a pure function with no siblings — capabilities arrive as arguments, matching every existing spoke.
- Identity-door composition is the repo's aliasing discipline: five cheap-scan same-array doors chain so tool-free transcripts stay allocation-free and byte-identical end to end; the new pass adds the sixth.
- The digest's insertion-proofness is structural, not positional: both the splice (`prompt.ts:234-236`) and the tail check (`prompt.ts:199-200`) read `shaped.at(-1)` at runtime, so they re-resolve under any tail identity.
- Two tool-result channels exist by design and never meet: the transcript channel (shaped by `prompt.ts`, where the fix lands) and the loop channel (`advisor.ts:537/:567`, structured, untouched).
- Window-scoped pairing beats global id pairing: mirroring the transform's flush boundaries preserves transcript order and keeps the pass's observable contract identical to the host's rule.

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: The narrowing itself (the direct cause)
**Commit(s)**: `2514358` — "Narrow the advisor payload to user and assistant turns" (2026-11-05)
**Blast radius**: 7 files across 3 layers + docs/eval — prompt.ts, config.ts, tests/test.mjs, eval/runner.mjs + fixture, .rpiv/guidance/architecture.md, TECH_DEBT_AUDIT.md

**Follow-up fixes**:
- None yet at HEAD `b449b83` — the regression this research targets was observed ~26 minutes after landing.

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` — the consumer audit was role-level, not content-block-level; it missed the provider transform reading `toolCall` blocks inside kept assistant messages.
- `.rpiv/artifacts/validation/2026-11-05_12-41-02_advisor-markup-hardening.md` — all four offline gates green and 6/6 fixtures passed, yet production broke within the hour; offline shape validation cannot catch provider-transform behavior.
- Same doc — the plan's stale-prose sweep missed `AGENTS.md:4`/`README.md:4` (still unfixed at HEAD).

**Takeaway**: pins must assert provider-visible payload facts (zero `toolCall` items, no `"No result provided"` text), and the doc sweep must include the two still-stale claims plus the rows this change falsifies.

### Precedent: Pipeline reshape (fold, digest, tool loop, eval harness)
**Commit(s)**: `06f3552` — "Land the jarvis-advisor-evolution slices" (2026-11-03)
**Blast radius**: 22 files, all layers

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` — four-layer sync discipline: composition code + ordering/invariant doc comments + test pins + eval fixtures in one commit.
- The eval runner binds the same seam thunks as index.ts; fixtures are part of the change surface.

**Takeaway**: land the pass with all four layers at once and re-run the markup-hardening evals after the substrate changes (FRD Suggested Follow-ups).

### Precedent: Markup-strip lineage
**Commit(s)**: `b1f3a16` — "Add advisor-turn-gate extension" (2026-10-29); `0a8ef09` — "Widen markup stripping to function_calls and invoke (F023)" (2026-10-30)
**Blast radius**: advisor.ts + tests/test.mjs per widening

**Follow-up fixes**:
- `779c589` — "Treat empty errorMessage as absent (F028)" (2026-10-30) — falsy-string bug caught by audit, not tests.

**Lessons from docs**:
- Every anti-markup measure was followed by a new leak shape; the fix chain has been symptom-chasing: strip → widen → narrow → fabricate.

**Takeaway**: keep the inlined notes prose-shaped (no angle-bracket tool syntax) so they cannot become the next mimicry substrate; `stripAdvisorMarkup` guards only the reply channel.

### Precedent: Config surface (example file)
**Commit(s)**: `1690b9e` — "Untrack config.json and ship config.example.json (F024)" (2026-10-30); `236cc25` — model set to stepfun/step-5-preview (2026-10-30)
**Blast radius**: config.example.json created minimal (six keys, deliberately no `systemPrompt`)

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-10-30_14-20-04_f021-f028-f008-commit-series.md:112` — the example's minimalism was deliberate ("six fields at DEFAULT_CONFIG values … no systemPrompt"); FRD req 8 consciously reverses that one clause.
- The live `config.json` omits `systemPrompt`, so the default-prompt change is live immediately with zero wiring.

**Takeaway**: expect review weight on the example's minimalism; the prompt change ships live on the next fire, and the model remains the uncontrolled variable — verify post-deploy behavior.

### Precedent: Cross-boundary escapes (F001 pattern)
**Commit(s)**: `81a8748` — F001 timer leak via synchronous throw (2026-10-30); artifact-only `7cc8e04`/`b449b83`
**Lessons from docs**:
- Cross-boundary behavior (throw timing, falsy strings, provider transforms) escapes offline tests; audits and live use catch it — build the degrade-safe paths (unpaired call → note only) with red-first pins.
- The FRD records probe agents misattributing the regression commit to `7cc8e04`; artifact commits sit interleaved with code commits — verify hashes with `git show` before citing.

**Takeaway**: treat FRD acceptance pin (d) as the F001-style red-first candidate.

### Composite Lessons
- Offline-green ≠ correct here: `2514358` passed test+eval+lint+typecheck+6/6 fixtures and broke production in ~26 minutes because no check covered the external transform (`transform-messages.js:138-212`).
- Audit consumers at content-block level, not role level — the prior audit's wrong premise ("every tool call is plain text by construction") passed developer confirmation and drove the bad fix.
- Fixes in this chain have caused the next incident; the anti-mimicry goal is a hard constraint and the role filter stays — the evidence goes in front of it, not around it.
- Four-layer sync is the landing discipline and still leaks; this change's doc sweep must include `README.md:28`, `TECH_DEBT_AUDIT.md:38/:104`, plus the pre-existing `AGENTS.md:4`/`README.md:4` staleness.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-11-05_13-19-15_advisor-tool-evidence.md` — the FRD driving this research (root cause, decisions, requirements, acceptance criteria)
- `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` — the prior FRD that introduced `keepAdvisorRoles` via `2514358`
- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` — consumer audit and four-layer sync lessons for the payload surface
- `.rpiv/artifacts/plans/2026-10-30_14-20-04_f021-f028-f008-commit-series.md` — F024 spec that created the minimal config.example.json
- `.rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md` — strip→fold→tail window-order decision evidence
- `.rpiv/artifacts/validation/2026-11-05_12-41-02_advisor-markup-hardening.md` — offline-gates-green validation record for `2514358`

## Developer Context

**Q (discover: Intent — regression, diagnose first): The advisor keeps accusing supervised agents of fabricating tool results. What is the real problem you want solved?**
A: "previously not like that. diagnose first" (verbatim) — root cause proven before scoping the fix.

**Q (discover: Root cause — narrowing commit plus host back-fill): commit 2514358 made the role filter drop every toolResult message, so the host back-fills 'No result provided' for each orphaned tool call. Confirm this as the cause?**
A: Confirmed — proceed. Evidence: `prompt.ts:53-57` + `transform-messages.js:155` + `git show 2514358`.

**Q (discover: Constraint — keep anti-mimicry): Treat the narrowing's anti-mimicry goal as a constraint the fix must respect?**
A: Keep anti-mimicry — a naive revert re-opens the markup-mimicry failure (`prompt.ts:36-48`).

**Q (discover: Fix shape — plain-text evidence): Which fix shape should the FRD commit to?**
A: Plain-text evidence — the only shape preserving verifiability under the constraint.

**Q (discover: Tool output size — full output always): How much of a huge tool output goes into the [tool output] line?**
A: Full output always — completeness over payload economy; `applyTokenBudget` stays the guard when configured.

**Q (discover: System prompt note — yes, update default): Should the default advisor system prompt document the [tool output] convention?**
A: Yes, update default; explicit override-holders keep their own text (`config.ts:223-226`).

**Q (`tests/test.mjs:671`): Every toolResult fixture flowing through buildAdvisorMessages has empty content (:671, :707, :720, :1707) — no verbatim output to inline. What should inlineToolEvidence do with a text-less toolResult?**
A: Skip empties — leave the text-less toolResult in place for the role filter to drop as today. Every existing pin holds byte-for-byte (t10 `:675-685`, t10b `:711-727`, t22 `:1704-1716`); the floor invariants keep the filter as sole dropper.

**Q (`types.d.ts:430`): Flattening a toolResult to text drops isError — the advisor loses the pass/fail signal the loop channel still carries (`advisor.ts:571`). Mark failed outputs?**
A: Mark failures — when `isError` is true, append a trailing `[tool output ended in error]` line after the verbatim output. The `[tool output]` prefix contract stays intact.

**Q (`prompt.ts:150-157`): The fold sweeps a contiguous prefix; if the budget breaks exactly at a call note, the note folds while its output stays. How should the fold treat note/output pairs?**
A: Fold independently — no `applyTokenBudget` changes (FRD req 6 faithful). The rare straddle is accepted; a terminal output is always fold-protected by the never-fold-last bound.

**Q (`prompt.ts:179` + `tests/test.mjs:1634`): Which timestamp should the injected [tool output] line carry?**
A: Propagate the source `ToolResultMessage.timestamp` (`types.d.ts:431-432`) — keeps the fold-marker timestamp rule deterministic and t22-style correspondence pins meaningful. (Resolved from analysis; not asked.)

**Q (`types.d.ts:282`): Should the call note render argumentsError when arguments is `{}` because the model emitted invalid JSON?**
A: Yes — append the raw `argumentsError` text; stringify-only would render `{}` and discard what the model actually sent. (Resolved from analysis; not asked.)

## Related Research

- `.rpiv/artifacts/research/2026-11-05_10-06-46_advisor-prompt-payload-hardening.md` — the payload-hardening research that preceded `2514358`; its consumer audit gap is what this fix closes

## Open Questions

None. No item was explicitly deferred by the developer.
