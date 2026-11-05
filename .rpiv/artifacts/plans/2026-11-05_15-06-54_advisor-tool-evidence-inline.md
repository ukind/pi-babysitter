---
date: 2026-11-05T15:06:54+0700
author: Yogiswara Utama
commit: b449b83
branch: main
repository: advisor-turn-gate
topic: "Advisor tool evidence — inline evidence pass"
tags: [plan, prompt-shaping, advisor-payload, tool-evidence, pure-pass]
status: ready
parent: .rpiv/artifacts/solutions/2026-11-05_14-39-59_advisor-tool-evidence-inline.md
phase_count: 4
phases:
  - { n: 1, title: Evidence pass, files: [prompt.ts], depends_on: [] }
  - { n: 2, title: Config surface, files: [config.ts, config.example.json], depends_on: [1] }
  - { n: 3, title: Test band, files: [tests/test.mjs], depends_on: [1, 2] }
  - { n: 4, title: "Doc sweep + full baseline", files: [README.md, TECH_DEBT_AUDIT.md, AGENTS.md], depends_on: [1, 2, 3] }
unresolved_phase_count: 0
last_updated: 2026-11-05T15:06:54+0700
last_updated_by: Yogiswara Utama
---

# Advisor Tool Evidence Inline — Implementation Plan

## Overview

Add a sixth pure identity-door pass, `inlineToolEvidence`, to `prompt.ts`, composed innermost as `keepAdvisorRoles(inlineToolEvidence(llmMessages))`. The pass rewrites every assistant `toolCall` block into a prose note in position and every non-empty `toolResult` into a `[tool output]` user line in position; empty-content results pass untouched and drop downstream, so every existing pin stays byte-identical. With no pending call left in the payload, the pi-ai host transform's synthetic `"No result provided"` back-fill cannot fire — the cause of the false fabrication accusations is removed, not decorated around.

## Requirements

- No content item of type `toolCall` remains in the payload the provider sees (FRD req 3).
- The host back-fill cannot fire because call blocks are rewritten to text (FRD req 5).
- Evidence sits after its paired call's note, preserving transcript order (FRD req 4).
- Full output always, verbatim; `applyTokenBudget` stays the guard when configured.
- The default system prompt documents the `[tool output]` convention; `config.example.json` carries the full default verbatim.
- Never mutate `event.context.llmMessages` (`index.ts:92`); `prompt.ts` stays pure with zero runtime imports; copy-on-write aliasing discipline.

## Current State Analysis

`buildAdvisorMessages` (`prompt.ts:225-237`) composes inner-to-outer: `keepAdvisorRoles` → `stripToolDeclarations` → `applyTokenBudget` → `ensureUserTail`, then splices the optional memory digest. `keepAdvisorRoles` (`prompt.ts:53-57`) drops every non-user/assistant role — including all `toolResult`s — while `stripToolDeclarations` (`prompt.ts:80-94`) only removes `toolsAdded`/`toolsRemoved` properties from system messages, so `toolCall` blocks inside kept assistant messages survive into the payload.

The host transform (`@earendil-works/pi-ai` `transform-messages.js`, caret `^1.4.0`) registers pending calls from assistant `toolCall` blocks, registers results by `toolCallId`, and back-fills every unresolved pending id with `{ content: [{ type: "text", text: "No result provided" }], isError: true }` at a flush boundary: the next assistant message, any user message, or the end of the conversation. Verified live at HEAD: the flush runs before the errored/aborted-assistant skip; errored/aborted assistants are dropped entirely; user messages flush then pass through; system messages are held back without flushing; a final flush runs after the loop.

The advisor's real outputs therefore never reach it: every executor call is paired with a synthetic error, and the advisor concludes the supervised agent fabricated its results — the regression commit `2514358` introduced when it narrowed the payload to user/assistant roles.

### Key Discoveries

- Five identity-door precedents exist in `prompt.ts` (`:54`, `:55-57`, `:81`, `:142-159`, `:199-200`) — the dominant idiom for this pass.
- All five `toolResult` fixtures in `tests/test.mjs` have `content: []` (`:671`, `:693`, `:707`, `:720`, `:1707`) — skip-empties keeps every existing band byte-for-byte with zero re-pins.
- The only eval-fixture `toolResult` (`eval/fixtures/budget-window.json:68`) also has `content: []`; the `budget-respected` scorer's `narrowed` predicate (`eval/runner.mjs:86-88`) checks built-message roles only, so eval scores stay static.
- Lettered test-band precedent: `t15b` (`tests/test.mjs:857`) — a later pure pass band adjacent to its host band.
- Constant-prefix freeze precedent: `BUDGET_FOLD_MARKER_PREFIX` (`prompt.ts:113`), pinned via `startsWith` at 3 sites.
- Array-form fresh-message construction precedent: fold marker (`prompt.ts:168-181`), nudge (`:202`).
- Text-join precedent: `extractAdvisorText` (`advisor.ts:196-202`).
- t25/t26 loop and consult conversations are built in-test and replayed through `runAdvisor` — never shaped by `buildAdvisorMessages` — so they are structurally immune to this change.
- `eval/runner.mjs` binds the same `buildAdvisorMessages` seam (`:277-287`); no eval code change is needed.

## Desired End State

A transcript turn that reads, pre-shaping:

```
assistant: [toolCall read_file {"path":"src/auth.ts"}]
toolResult(isError=false): [{type:"text",text:"export function verifyToken..."}]
```

shapes to a provider-visible payload of:

```
assistant: [text "Tool call: read_file with arguments {\"path\":\"src/auth.ts\"}"]
user:      "[tool output] read_file\nexport function verifyToken..."
```

The advisor reads the call it is supervising and the output that call really produced, adjacent and in order. No `toolCall` item exists for the host transform to register, so no synthetic `"No result provided"` error can appear beside any call. A failed output carries a trailing `[tool output ended in error]` line, so genuine failures stay visible as failures.

## What We're NOT Doing

- No change to `keepAdvisorRoles` or `stripToolDeclarations` — the role filter and delta strip stay exactly as pinned.
- No change to `applyTokenBudget` — `[tool output]` user lines fold like any other message; a note/output straddle at an exact budget break is accepted (FRD fold-independence decision).
- No change to the loop and consult replay channels (`advisor.ts:537`, `:567`) — those conversations are advisor-internal and already pair natively.
- No change to the specialist prompt (`config.ts:70-74`) — the specialist never sees evidence lines.
- No redaction pass for tool-output secrets — the FRD explicitly assumed none exists; out of scope.
- No special-casing of `stopReason: "error"`/`"aborted"` assistant messages — the host drops those assistants, so their note dies while the `[tool output]` line survives; accepted in the FRD.
- No pairing map by `toolCallId` — pairing is positional, mirroring the transform's window semantics.
- No host/`node_modules` code changes (F008 contract: caret range stays; pins catch drift).

## Decisions

### Fix shape: inline evidence pass (Option 1 of 4)

The solutions artifact scored four candidates; keep-role widening ships orphan `toolResult`s the transform never re-associates (dangling `tool_call_id` at the wire), a trailing digest leaves the synthetic back-fill intact behind a false-green pin, and a naive revert of `2514358` violates the recorded anti-mimicry decision. Evidence: `transform-messages.js` pairing machine (verified live); solutions artifact Comparison table.

### Composition: innermost, wrapping `keepAdvisorRoles`

`keepAdvisorRoles(inlineToolEvidence(llmMessages))` at `prompt.ts:230`. The evidence pass runs first so the role filter sees the rewritten user lines and drops the remaining empty `toolResult`s exactly as today — byte-identical pins depend on this order. Evidence: FRD composition decision; `prompt.ts:225-237`.

### Skip-empties: empty-content `toolResult`s pass through untouched

All five suite fixtures and the one eval fixture carry `content: []`, so the pass returns the same array on every existing input and every pin holds byte-for-byte. Evidence: `tests/test.mjs:671, :693, :707, :720, :1707`; `eval/fixtures/budget-window.json:68` (all verified).

### Full output always, verbatim; no budget change

Text blocks join with `"\n"`; one image placeholder per result regardless of image count; `applyTokenBudget` remains the only guard. A `[tool output]` line folds independently of its note. Evidence: FRD full-output and fold-independence decisions.

### Error marking: trailing `[tool output ended in error]` line

An `isError: true` result carries the trailing line so genuine failures stay visible as failures. Evidence: FRD error-marking decision.

### Prompt convention line + example-file key

One concat line documents the `[tool output]` convention in `DEFAULT_CONFIG.systemPrompt` after the no-tools sentence (`config.ts:50-58`); the full default is mirrored verbatim into `config.example.json` between `timeoutMs` and `customType`. This consciously reverses one clause of the example-file minimalism decision (`1690b9e`, F005) for discovery-surface parity. Evidence: FRD config-surface decision; `README.md:28`; `TECH_DEBT_AUDIT.md:38`.

### Prefix freeze: exported constant + `startsWith` pins

`TOOL_OUTPUT_PREFIX` follows the `BUDGET_FOLD_MARKER_PREFIX` precedent (`prompt.ts:113`). Evidence: FRD test-surface decision.

## Phase 1: Evidence pass

### Overview

Delivers the `inlineToolEvidence` pure pass, its exported prefix constant, and the innermost composition in `buildAdvisorMessages`. Foundation phase; no dependencies; no parallelism (every later slice builds on it).

### Changes Required:

#### 1. prompt.ts

**File**: prompt.ts
**Changes**: MODIFY — add `TOOL_OUTPUT_PREFIX`, the `inlineToolEvidence` pass with its identity door, and the innermost composition; amend the module banner's role-filter sentence.

**(A) Module banner — replace the first paragraph of the doc banner:**

```ts
/**
 * prompt.ts — context shaping for the advisor call.
 *
 * The advisor receives the executor's reasoning trace plus its real tool evidence:
 * inlineToolEvidence rewrites toolCall blocks into prose notes and non-empty
 * toolResult outputs into [tool output] user lines in position, then the role filter
 * keeps user and assistant messages and drops the system replay chains and the
 * remaining empty toolResult entries. A later pass strips the tool declarations that
 * would let it call tools. Shapes are copied from
 * `@juicesharp/rpiv-advisor/advisor/context.ts:31-56`; nothing is imported.
 *
 * The pi-ai import is TYPE-only, so it is erased before the module runs and the offline
 * test resolves no package. That is the invariant `extensions/taste-router/test.mjs`
 * asserts of its own index.ts at t14.
 */
```

**(B) Insert immediately after the `keepAdvisorRoles` function and before `stripToolDeclarations`:**

```ts
/** Exact prefix of an inlined tool-output line; the tests pin it. */
export const TOOL_OUTPUT_PREFIX = "[tool output]";

/** Trailing line marking an errored tool output. */
const TOOL_OUTPUT_ERROR_LINE = "[tool output ended in error]";

/** The one placeholder standing in for every image block of a result. */
const TOOL_OUTPUT_IMAGE_LINE = "[image output omitted]";

/**
 * The prose note that replaces one toolCall block, carrying name and arguments.
 *
 * Prose only: no angle-bracket vocabulary and no tag-shaped syntax, because the payload
 * must not read as a tool conversation the advisor can imitate (the recorded anti-mimicry
 * decision behind the role filter). Arguments render as JSON — braces and quotes are
 * ordinary prose to a language model, and they carry the call's real shape verbatim.
 */
function toolCallNote(call: {
  name?: unknown;
  arguments?: unknown;
  argumentsError?: unknown;
}): string {
  const name = typeof call.name === "string" && call.name ? call.name : "unknown tool";
  let note = `Tool call: ${name}`;
  if (call.arguments !== undefined) {
    let rendered: string;
    try {
      rendered = JSON.stringify(call.arguments) ?? String(call.arguments);
    } catch {
      rendered = String(call.arguments);
    }
    note += ` with arguments ${rendered}`;
  }
  if (typeof call.argumentsError === "string" && call.argumentsError) {
    note += ` (arguments could not be parsed: ${call.argumentsError})`;
  }
  return note;
}

/**
 * The user-side text for one toolResult: the pinned prefix, the verbatim body, the
 * error marker.
 *
 * Text blocks join with "\n"; every image block collapses into ONE placeholder line (an
 * image is invisible to a text model no matter how many arrive). The name rides the
 * prefix line so an output stays attributable to its call even when a fold or a dropped
 * errored assistant breaks the adjacency.
 */
function toolOutputLines(result: {
  toolName?: unknown;
  content?: unknown;
  isError?: unknown;
}): string {
  const name = typeof result.toolName === "string" && result.toolName ? result.toolName : "";
  const lines = [name ? `${TOOL_OUTPUT_PREFIX} ${name}` : TOOL_OUTPUT_PREFIX];
  const body: string[] = [];
  let sawImage = false;
  for (const block of Array.isArray(result.content) ? result.content : []) {
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") body.push(typed.text);
    else if (typed.type === "image") sawImage = true;
  }
  if (body.length > 0) lines.push(body.join("\n"));
  if (sawImage) lines.push(TOOL_OUTPUT_IMAGE_LINE);
  if (result.isError === true) lines.push(TOOL_OUTPUT_ERROR_LINE);
  return lines.join("\n");
}

/**
 * Rewrite tool activity into prose evidence, in position.
 *
 * The pi-ai host transform (transform-messages.js, caret ^1.4.0) registers pending calls
 * from assistant `toolCall` blocks and back-fills every unresolved one with a synthetic
 * `isError: true` "No result provided" result at the next assistant message, any user
 * message, or the end of the conversation. A narrowed payload that keeps the call blocks
 * but drops the results therefore shows the advisor a fake failure beside every call —
 * the fabrication-accusation regression. This pass removes the cause: each call block
 * becomes a prose note in position and each non-empty toolResult becomes a user line in
 * position, so no pending call survives and the back-fill cannot fire. Empty-content
 * results (every fixture in the suite) pass through untouched and are dropped by the
 * role filter downstream, which keeps every existing pin byte-identical.
 *
 * Evidence sits at the result's transcript position, after its call's note, so pairing
 * reads in transcript order. On stopReason "error"/"aborted" the host drops the
 * assistant, so the note dies while the user line survives — accepted (the FRD records
 * it): the named prefix line keeps the output attributable.
 *
 * Copy-on-write, like every pass here: untouched messages return by reference, rebuilt
 * ones are fresh objects, and the live transcript (`index.ts:92`) is never mutated.
 */
export function inlineToolEvidence(messages: Message[]): Message[] {
  const carriesToolActivity = (message: Message): boolean => {
    if (message.role === "toolResult") {
      return Array.isArray(message.content) && message.content.length > 0;
    }
    if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
    return message.content.some((block) => (block as { type?: unknown }).type === "toolCall");
  };
  if (!messages.some(carriesToolActivity)) return messages;
  return messages.map((message) => {
    if (message.role === "toolResult") {
      if (!Array.isArray(message.content) || message.content.length === 0) return message;
      const timestamp = (message as { timestamp?: number }).timestamp;
      return {
        role: "user",
        content: [
          {
            type: "text",
            text: toolOutputLines(message as {
              toolName?: unknown;
              content?: unknown;
              isError?: unknown;
            }),
          },
        ],
        timestamp: timestamp ?? 0,
      } as Message;
    }
    if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
    if (!message.content.some((block) => (block as { type?: unknown }).type === "toolCall")) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((block) => {
        const typed = block as {
          type?: unknown;
          name?: unknown;
          arguments?: unknown;
          argumentsError?: unknown;
        };
        if (typed.type !== "toolCall") return block;
        return { type: "text", text: toolCallNote(typed) };
      }),
    } as Message;
  });
}
```

**(C) `buildAdvisorMessages` — replace the composition (was `stripToolDeclarations(keepAdvisorRoles(llmMessages))`):**

```ts
  const shaped = ensureUserTail(
    applyTokenBudget(
      stripToolDeclarations(keepAdvisorRoles(inlineToolEvidence(llmMessages))),
      tokenBudget,
    ),
  );
```

**(D) `buildAdvisorMessages` doc comment — replace the "Pipeline order is load-bearing" paragraph:**

```ts
 * Pipeline order is load-bearing (the settled window decision): the evidence inliner
 * runs first so toolCall blocks never survive into the payload, the role filter runs
 * next so the fold sizes the filtered payload (and drops the remaining empty
 * toolResults), the strip follows (it is load-bearing only on the filter's identity
 * floor, where system messages survive), and the tail guarantee runs last so even a
 * folded context ends on a user message. tokenBudget defaults to 0, where the fold is
 * the identity and the full context is sent — the historical behavior, pinned by t22.
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Lint passes on the phase's file: `npx biome check prompt.ts`
- [x] The pass and constant exist and compose innermost: `grep -c "inlineToolEvidence" prompt.ts` returns 3 or more
- [x] No clock reaches the pass: `grep -n "Date.now" prompt.ts` returns exactly one match (the nudge stamp in `ensureUserTail`)

#### Manual Verification:
- [x] Read `inlineToolEvidence` and confirm: no input mutation, untouched messages return by reference, notes are prose-shaped with no angle-bracket markup vocabulary
- [x] Confirm the module banner and the `buildAdvisorMessages` doc comment both name the evidence pass, so the pipeline order reads correctly at the composition site

## Phase 2: Config surface

### Overview

Documents the `[tool output]` convention in the code-default system prompt and mirrors the full default into `config.example.json`. Depends on Phase 1 (the convention names the lines Phase 1 emits); no parallelism.

### Changes Required:

#### 2. config.ts:50-58

**File**: config.ts
**Changes**: MODIFY — one concat line appended inside the `systemPrompt` default, after the no-tools sentence.

Replace the final piece of the `systemPrompt` default:

```ts
    "tool call. Supervise the reasoning trace in plain prose. " +
    "Tool calls and their outputs reach you as plain prose: a note that names the " +
    "call and its arguments, then a line that starts with [tool output] and carries " +
    "the output verbatim. A trailing [tool output ended in error] line marks a " +
    "failed output.",
```

(The preceding pieces of the default are unchanged; only the final `"tool call. Supervise the reasoning trace in plain prose.",` line is replaced by the five lines above.)

#### 3. config.example.json

**File**: config.example.json
**Changes**: MODIFY — add the `systemPrompt` key carrying the full code default verbatim, between `timeoutMs` and `customType`.

```json
{
  "enabled": true,
  "interval": 2,
  "model": "",
  "timeoutMs": 60000,
  "systemPrompt": "You are a senior engineer reviewing the reasoning trace and outputs of another agent's work in progress. That transcript is all you receive; find what is going wrong or about to go wrong, and say so in a few direct sentences. Name the file and the line when you can. Do not restate the task. Do not praise. If the work is on track, say so briefly and stop. You have no tools and cannot call any. Reply in text only: never write tool-call markup, angle-bracket tool syntax, or anything that imitates a tool call. Supervise the reasoning trace in plain prose. Tool calls and their outputs reach you as plain prose: a note that names the call and its arguments, then a line that starts with [tool output] and carries the output verbatim. A trailing [tool output ended in error] line marks a failed output.",
  "customType": "advisor-turn-gate",
  "display": true
}
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Lint passes on the phase's files: `npx biome check config.ts config.example.json`
- [x] The convention line rides the code default: `grep -c "tool output" config.ts` returns 1 or more
- [x] The example file matches the code default byte-for-byte: `node --experimental-strip-types -e "import {readFileSync} from 'node:fs'; import {DEFAULT_CONFIG} from './config.ts'; const ex = JSON.parse(readFileSync('config.example.json','utf8')); if (ex.systemPrompt !== DEFAULT_CONFIG.systemPrompt) process.exit(1);"` exits 0

#### Manual Verification:
- [x] Read the new systemPrompt text end-to-end and confirm it reads as one coherent instruction set, with the anti-mimicry block ("no tools" + "reply in text only") left intact and the convention note appended after it
- [x] Confirm the example file's key order places `systemPrompt` between `timeoutMs` and `customType`

## Phase 3: Test band

### Overview

Adds the `t10c` lettered band (identity door, provider-visible pins, error marker, skip-empties, multi-call ordering, one composed pin) and the appended t7b assert. Depends on Phases 1 and 2; no parallelism.

### Changes Required:

#### 4. tests/test.mjs:85-94

**File**: tests/test.mjs
**Changes**: MODIFY — extend the prompt.ts import block with `inlineToolEvidence` and `TOOL_OUTPUT_PREFIX`.

```js
import {
  ADVISOR_NUDGE,
  applyTokenBudget,
  BUDGET_FOLD_MARKER_PREFIX,
  buildAdvisorMessages,
  ensureUserTail,
  estimateMessageTokens,
  inlineToolEvidence,
  keepAdvisorRoles,
  stripToolDeclarations,
  TOOL_OUTPUT_PREFIX,
} from "../prompt.ts";
```

#### 5. tests/test.mjs:395-413

**File**: tests/test.mjs
**Changes**: MODIFY — append one t7b assert pinning the convention line in `DEFAULT_CONFIG.systemPrompt`.

Insert after the `/outputs/` assert and before the `display` assert:

```js
assert(
  /\[tool output\]/.test(DEFAULT_CONFIG.systemPrompt),
  "t7b: the code default documents the [tool output] convention",
);
```

#### 6. tests/test.mjs:728-730

**File**: tests/test.mjs
**Changes**: MODIFY — insert the `t10c` band after the `t10b` band (immediately before the `// --- 11.` banner).

```js
// --- 10c. inlineToolEvidence: the sixth identity-door pass. The zero-toolCall pin is
//          RED-FIRST and decisive: on the pre-fix pipeline (no pass composed) the shaped
//          payload still carries the assistant toolCall blocks, so it fails. No toolCall
//          block means the host transform registers no pending call, so its synthetic
//          "No result provided" back-fill cannot fire. The literal-text pin beside it is
//          NOT red-first (the synthetic is injected host-side, after shaping) and says so
//          in its own message. These are the first pins in the suite that assert what the
//          provider sees rather than what the shaper returns — the gap 2514358 walked
//          through.
{
  // The identity door: a transcript with no tool activity returns the SAME array. The
  // empty-content toolResult is the shape every existing fixture carries, so this door
  // is what keeps t10, t10b, t22, t23, and t7b byte-identical.
  const quiet = [
    { role: "system", content: "s", timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "u" }], timestamp: 2 },
    { role: "toolResult", content: [], timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 4 },
  ];
  assert(inlineToolEvidence(quiet) === quiet, "t10c: no tool activity returns the same array");
  const emptyArr = [];
  assert(inlineToolEvidence(emptyArr) === emptyArr, "t10c: an empty transcript is the identity");

  // The call rewrite: blocks become prose notes in position, text blocks keep their
  // references, and the input array is never mutated (index.ts:92 passes the live one).
  const calls = [
    { role: "user", content: [{ type: "text", text: "run it" }], timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "text", text: "checking the file" },
        { type: "toolCall", id: "c1", name: "read_file", arguments: { path: "src/auth.ts" } },
        { type: "text", text: "now the test" },
        { type: "toolCall", id: "c2", name: "broken_tool", argumentsError: "bad JSON" },
      ],
      timestamp: 2,
      stopReason: "toolUse",
    },
  ];
  const inlined = inlineToolEvidence(calls);
  assert(inlined[0] === calls[0], "t10c: untouched messages keep their references");
  assert(inlined[1] !== calls[1], "t10c: the rebuilt assistant is a fresh object");
  const blocks = inlined[1].content;
  assert(blocks[0] === calls[1].content[0], "t10c: text blocks keep their references");
  assert(
    blocks[1].type === "text" &&
      blocks[1].text === 'Tool call: read_file with arguments {"path":"src/auth.ts"}',
    "t10c: the note carries the tool name and its JSON arguments",
  );
  assert(blocks[2] === calls[1].content[2], "t10c: a mid text block stays in place");
  assert(
    blocks[3].type === "text" &&
      blocks[3].text === "Tool call: broken_tool (arguments could not be parsed: bad JSON)",
    "t10c: an argumentsError rides the note",
  );
  assert(calls[1].content[1].type === "toolCall", "t10c: the input array is never mutated");
  assert(inlined[1].timestamp === 2, "t10c: the rebuilt assistant keeps its timestamp");

  // The output rewrite: prefix + name, verbatim multi-block join, one image placeholder,
  // the error marker trailing, and the source timestamp propagated.
  const errored = [
    {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "read_file",
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
        { type: "image", source: {} },
        { type: "image", source: {} },
      ],
      isError: true,
      timestamp: 7,
    },
  ];
  const [outLine] = inlineToolEvidence(errored);
  assert(outLine.role === "user", "t10c: a non-empty toolResult ships as a user message");
  assert(outLine.timestamp === 7, "t10c: the source timestamp propagates");
  const outText = outLine.content[0].text;
  assert(
    outText.startsWith(`${TOOL_OUTPUT_PREFIX} read_file\n`),
    "t10c: the pinned prefix and the tool name lead the line",
  );
  assert(outText.includes("line one\nline two"), "t10c: multi-block text joins with a newline");
  assert(
    outText.split("[image output omitted]").length - 1 === 1,
    "t10c: every image collapses into one placeholder line",
  );
  assert(
    outText.endsWith("[tool output ended in error]"),
    "t10c: an errored output carries the trailing error marker",
  );

  // The degradation doors: an empty tool name yields the bare prefix, and a call with
  // no arguments renders no arguments clause.
  const nameless = inlineToolEvidence([
    { role: "toolResult", toolName: "", content: [{ type: "text", text: "x" }], timestamp: 1 },
  ]);
  assert(
    nameless[0].content[0].text === `${TOOL_OUTPUT_PREFIX}\nx`,
    "t10c: an empty tool name degrades to the bare prefix",
  );
  const noArgs = inlineToolEvidence([
    { role: "assistant", content: [{ type: "toolCall", id: "c", name: "noop" }], timestamp: 1 },
  ]);
  assert(
    noArgs[0].content[0].text === "Tool call: noop",
    "t10c: a call with no arguments renders no arguments clause",
  );

  // The composed pin: evidence rides the shaped payload, the empty toolResult still
  // drops, the nudge stays terminal, and the output line sits right after its note.
  const transcript = [
    { role: "system", content: "base", toolsAdded: [{ name: "read" }], timestamp: 0 },
    { role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "read_file", arguments: {} }],
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "read_file",
      content: [{ type: "text", text: "file body" }],
      isError: false,
      timestamp: 3,
    },
    { role: "toolResult", content: [], timestamp: 4 },
    { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 5 },
  ];
  const shaped = buildAdvisorMessages(transcript);
  const shapedJson = JSON.stringify(shaped);
  // Non-vacuity first: the fixture really carries a toolCall block, so the zero pin
  // below cannot pass because there was nothing to rewrite.
  assert(
    transcript.some(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "toolCall"),
    ),
    "t10c: the fixture really carries a toolCall block, so the zero pin is not vacuous",
  );
  // THE decisive pin, and the only red-first one: with the pass uncomposed the shaped
  // payload still carries the assistant toolCall blocks and this assert fails. No
  // toolCall block means the host transform registers no pending call, so its synthetic
  // "No result provided" back-fill cannot fire.
  assert(
    !shapedJson.includes('"toolCall"'),
    "t10c: the shaped payload carries zero toolCall items (provider-visible, red-first)",
  );
  // A literal-text guard, NOT a second decisive pin: the synthetic string is injected
  // host-side after shaping, so this assert passes on the pre-fix pipeline too. It
  // catches only a future change that writes the literal into the payload itself.
  assert(
    !shapedJson.includes("No result provided"),
    "t10c: the shaped payload never carries the synthetic back-fill text literally",
  );
  assert(
    shaped.some(
      (m) =>
        m.role === "assistant" && m.content[0].text === "Tool call: read_file with arguments {}",
    ),
    "t10c: the call note rides the payload inside its assistant message",
  );
  assert(
    shaped.some(
      (m) =>
        m.role === "user" && m.content[0].text === `${TOOL_OUTPUT_PREFIX} read_file\nfile body`,
    ),
    "t10c: the output line rides the payload after its note",
  );
  assert(
    !shaped.some((m) => m.role === "toolResult"),
    "t10c: the empty toolResult still drops downstream",
  );
  assert(
    shaped.at(-1).role === "user" && shaped.at(-1).content[0].text === ADVISOR_NUDGE,
    "t10c: the nudge stays terminal after the evidence rides",
  );
  const noteIdx = shaped.findIndex(
    (m) => m.role === "assistant" && String(m.content[0].text).startsWith("Tool call:"),
  );
  const outIdx = shaped.findIndex((m) => String(m.content[0].text).startsWith(TOOL_OUTPUT_PREFIX));
  assert(
    noteIdx !== -1 && outIdx === noteIdx + 1,
    "t10c: the output line sits immediately after its call note",
  );
}
```

### Success Criteria:

#### Automated Verification:
- [x] Full suite passes: `npm test`
- [x] Eval score gate passes: `npm run eval`
- [x] Lint passes on the phase's file: `npx biome check tests/test.mjs`
- [x] The new band carries its asserts: `grep -c "t10c:" tests/test.mjs` returns 26
- [x] The decisive pin is red-first: with `inlineToolEvidence` removed from the `buildAdvisorMessages` composition, `npm test` fails on `t10c: the shaped payload carries zero toolCall items`

#### Manual Verification:
- [x] Read the `t10c` band and confirm every assert message names the behavior it pins, and that the two provider-visible asserts carry their red-first / literal-guard labels honestly
- [x] Confirm the band's fixtures use the same inline object-literal style as the neighboring `t10`/`t10b` bands

## Phase 4: Doc sweep + full baseline

### Overview

Sweeps the four falsified or stale doc claims and runs the full verification baseline (test, lint, typecheck, eval). Depends on Phases 1-3; no parallelism.

### Changes Required:

#### 7. README.md:28

**File**: README.md
**Changes**: MODIFY — the `systemPrompt` config-table row stops claiming "not shipped".

Replace the row's description cell (keep the column widths):

```
| `systemPrompt`           | code default          | Optional override. The code default is the single source; `config.example.json` carries a copy for reference.                                                   |
```

#### 8. README.md:3-4

**File**: README.md
**Changes**: MODIFY — the "projected transcript" claim names the filtered reasoning trace with inline tool evidence.

```
It reads the projected transcript, inlines the executor's tool calls and their
outputs as plain prose, calls a model with `tools: []`, and commits the advice as a
`custom_message` entry in the durable transcript.
```

#### 9. TECH_DEBT_AUDIT.md:38

**File**: TECH_DEBT_AUDIT.md
**Changes**: MODIFY — F005 row records the example-file reversal (description and recommendation cells; keep the column widths).

```
| F005 | RESOLVED 77da952       | Consistency rot          | config.json                               | Medium   | S      | The shipped `systemPrompt` is gone. The code default is the single source, and t7b bands only the default. REVERSED for the example file (2026-11-05): `config.example.json` now carries a copy; the code default stays the source of truth.                                                                                                                            | Done, with the example-file reversal recorded (2026-11-05).                                                                                     |
```

#### 10. TECH_DEBT_AUDIT.md:104

**File**: TECH_DEBT_AUDIT.md
**Changes**: MODIFY — the payload-narrowing note records that tool evidence now rides as user lines in front of the role filter.

```
- **The advisor payload narrows to user and assistant turns (prompt.ts, keepAdvisorRoles).** Deliberate (FR1/FR2): the system replay chains and toolResult entries read as a tool conversation and fed the markup-only failure. `inlineToolEvidence` runs in front of the filter and rewrites toolCall blocks into prose notes and non-empty toolResults into `[tool output]` user lines, so the real outputs still reach the advisor with no tool role surviving. Early decisions still reach the advisor through the kept user and assistant turns.
```

#### 11. AGENTS.md:3-4

**File**: AGENTS.md
**Changes**: MODIFY — the "projected transcript" claim names the filtered reasoning trace with inline tool evidence.

```
It reads the projected transcript, inlines the executor's tool calls and their
outputs as plain prose, calls a model with `tools: []`, and commits the advice as a
`custom_message` entry in the durable transcript.
```

### Success Criteria:

#### Automated Verification:
- [x] Full suite passes: `npm test`
- [x] Eval score gate passes: `npm run eval`
- [x] Lint and format pass repo-wide: `npm run lint`
- [x] Type checking passes: `npm run typecheck`
- [x] The falsified "not shipped" claim is gone: `grep -c "not shipped" README.md` returns 0
- [x] Both docs name the inlining: `grep -c "inlines the executor" README.md AGENTS.md` returns 1 in each
- [x] The audit records the reversal: `grep -c "REVERSED for the example file" TECH_DEBT_AUDIT.md` returns 1
- [x] The audit note names the pass: `grep -c "inlineToolEvidence" TECH_DEBT_AUDIT.md` returns 1

#### Manual Verification:
- [x] Read the four swept claims end-to-end and confirm each now matches the shipped behavior, with no remaining "projected transcript" wording that implies the full transcript ships
- [x] Confirm the TECH_DEBT_AUDIT table rows stay aligned (Biome's markdown formatter accepts the file: `npm run lint` exits 0)
- [ ] After landing, observe one live gate-enabled session with real tool calls: the committed `custom_message` contains no fabrication accusation for calls whose outputs shipped, and no `advisor reply was markup only` warning fires
- [ ] On any pi-ai upgrade inside the `^1.4.0` caret range, re-verify the installed `transform-messages.js` back-fill rule (the synthetic `"No result provided"` text plus the three flush boundaries: next assistant, any user, end) still matches the window the pass mirrors

## Ordering Constraints

Phase 1 lands the substrate; Phase 2 documents what Phase 1 emits; Phase 3 pins both; Phase 4 sweeps docs and runs the full baseline. Strictly sequential — no phase can run in parallel with another. The eval re-run belongs to Phase 4 because it replays the finished substrate.

## Verification Notes

- Red-first provider-visible pin: ONLY the zero-`toolCall`-items assert fails on pre-fix code (verified by uncomposing the pass and re-running the suite). The no-`"No result provided"` assert is a literal-text guard that passes pre-fix too, because the host injects that string after shaping — it catches only a future change that writes the literal into the payload itself. This is an authoring-time property of the band, not a post-landing command; the band comments state it.
- Existing bands byte-for-byte: t10 (`tests/test.mjs:675-685`), t10b (`:711-727`), t22 (`:1583-1716`), t23 (`:1870-1919`), t7b (`:395-413`), and every config-door band stay green unchanged.
- Eval scores static: `npm run eval` exits 0 with unchanged scores; the only fixture `toolResult` is `eval/fixtures/budget-window.json:68` with `content: []` (verified).
- Example-file parity: `config.example.json`'s `systemPrompt` value must equal `DEFAULT_CONFIG.systemPrompt` byte-identical (FRD acceptance check; no suite reads the example).
- Transform drift: the caret range (`^1.4.0`, F008 contract) can move the host transform; the provider-visible pins fail if the observable rule "no pending call, no synthetic" changes shape.
- Offline-green lesson: after landing, observe one live gate fire before declaring the regression closed — the class-level `2514358` record (`.rpiv/artifacts/validation/2026-11-05_12-41-02_advisor-markup-hardening.md`).
- Determinism: the pass propagates source `timestamp`s and calls no clock — no `Date.now()` reaches any output.

## Performance Considerations

The identity door scans messages once and returns the same array when no tool activity exists — the same cheap-scan idiom as the five existing doors. Rebuilt messages pay one `map` over content arrays and one `join` over text blocks, both linear in payload size; no regex runs over the payload. The pass adds O(payload) work to a once-per-fire path, negligible against the model call it feeds.

## Migration Notes

Not applicable — no persisted schema, no stored data, no config migration. Existing `config.json` files keep working; the new convention rides the code default.

## Pattern References

- Identity-door pure pass: `prompt.ts:54`, `:81`, `:142-159`, `:199-200` — the sixth of the kind.
- Constant-prefix freeze: `prompt.ts:113` (`BUDGET_FOLD_MARKER_PREFIX`), pinned via `startsWith`.
- Array-form message construction: `prompt.ts:168-181` (marker), `:202` (nudge).
- Text join: `advisor.ts:196-202` (`extractAdvisorText`).
- Lettered test band: `tests/test.mjs:857` (`t15b`) — a later pure pass band adjacent to its host band.
- Host pairing machine being mirrored: `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js` — flush at next assistant, any user, or end; errored/aborted assistants dropped; system messages held back.

## Developer Context

- Step 4 checkpoint (design summary): developer chose "Proceed" — zero genuine ambiguities remained; every decision was FRD-recorded and research-verified at HEAD `b449b83`.
- Step 5 checkpoint (decomposition): developer approved the 4-slice decomposition as presented.
- Research-stage verification additions: transform flush semantics re-verified live (flush before the errored/aborted skip; user flush; end flush); eval fixture `toolResult` confirmed `content: []` and the `narrowed` predicate confirmed role-only, so eval scores are static — stronger than the artifact's "may move".

## Plan History

- Phase 1: Evidence pass — approved as generated
- Phase 2: Config surface — approved as generated
- Phase 3: Test band — approved as generated
- Phase 4: Doc sweep + full baseline — approved as generated

## References

- `.rpiv/artifacts/solutions/2026-11-05_14-39-59_advisor-tool-evidence-inline.md` — the driving solutions artifact (Option 1 of 4, scored).
- `.rpiv/artifacts/research/2026-11-05_13-47-22_advisor-tool-evidence.md` — pairing contract, insertion point, test blast radius.
- `.rpiv/artifacts/discover/2026-11-05_13-19-15_advisor-tool-evidence.md` — the FRD: root cause, decisions, requirements, acceptance criteria.
- `.rpiv/artifacts/discover/2026-11-05_09-47-20_advisor-markup-only-hardening.md` — the prior FRD that introduced `keepAdvisorRoles` (the anti-mimicry motive).
- `.rpiv/artifacts/validation/2026-11-05_12-41-02_advisor-markup-hardening.md` — the offline-gates-green record for `2514358` (the class-level warning).
- `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js` — the host pairing machine the pass satisfies.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| coverage | ## Verification Notes §6 | <n/a>                  | blocker    | verification-coverage | The "observe one live gate fire after landing" obligation is never traced into any phase's Success Criteria, and no code mirror exists; the FRD acceptance check (a live session whose committed `custom_message` carries no fabrication accusation) and the solutions artifact's manual live-fire checkbox were both dropped | Add a Manual Verification bullet under Phase 4 requiring one live gate-enabled session with real tool calls after landing: the committed `custom_message` contains no fabrication accusation and no `advisor reply was markup only` warning | applied: Phase 4 Manual Verification gained the live-fire bullet |
| code     | Verification Notes (red-first bullet) | <n/a>          | concern    | actionability         | The bullet claims both the zero-`toolCall`-items assert and the no-`"No result provided"` assert must fail on pre-fix code, but the t10c band's own comment states the literal-text assert passes on the pre-fix pipeline — the second half is false and re-introduces the overclaim the planning correction removed | Reword the bullet to scope red-first to the zero-`toolCall`-items assert only, naming the no-`"No result provided"` assert as a non-red-first literal guard | applied: Verification Notes §1 reworded to name only the zero-`toolCall` assert as red-first |
| coverage | ## Verification Notes §1 | <n/a>                  | concern    | verification-coverage | Same overclaim as the code row: Phase 3's Automated red-first bullet verifies only the zero-`toolCall` pin, and the band comments state the literal pin is NOT red-first because the host injects the string after shaping | Rewrite §1 to name only the zero-`toolCall` assert as red-first and describe the no-`"No result provided"` assert as a literal guard that passes pre-fix | applied: same edit as the code row — §1 now names only the zero-`toolCall` assert as red-first |
| coverage | ## Verification Notes §5 | <n/a>                  | concern    | verification-coverage | The transform-drift note has no criteria bullet and no code mirror: neither t10c assert reads host behavior (the zero-`toolCall` pin is a pure shaped-payload fact; the literal pin cannot observe a host-injected string), so a pi-ai minor that changes the back-fill rule would pass every offline gate | Add a Manual Verification bullet under Phase 4 requiring re-verification of the installed `transform-messages.js` back-fill rule (the synthetic text plus the three flush boundaries) against the `^1.4.0` caret range on any pi-ai upgrade | applied: Phase 4 Manual Verification gained the transform-drift re-verification bullet |
| code     | Phase 3 §4 (tests/test.mjs) | tests/test.mjs:83-94   | suggestion | actionability         | The MODIFY locator `tests/test.mjs:109-119` points at the `assert` helper and the hooks/triggers imports; the prompt.ts import block the entry tells the implementer to extend actually lives at lines 83-94 | Change the locator to `tests/test.mjs:83-94` | applied: locator corrected to `tests/test.mjs:85-94` (the exact block bounds; the reviewer's 83-94 included two lines of the preceding plan-turn import) |
| code     | Phase 4 (Manual Verification) | TECH_DEBT_AUDIT.md:54 | suggestion | codebase-fit         | The check assumes Biome formats Markdown and therefore enforces the table alignment; the F021 row carries unescaped `|` characters inside cells (12 fields against the header's 10) and still passes `biome check .` at HEAD | Drop the Biome rationale and state the alignment check as a manual eyeball, noting that no tool enforces it | dismissed: the premise is false — Biome 2.6.4 does format markdown tables (verified: it rewrites `| a | b |` to `| a   | b   |`), and the plan's F005 row is byte-identical to Biome's canonical output. The F021 observation is real but does not make the rationale wrong: `npm run lint` runs `biome check .`, which covers `.md` files |
