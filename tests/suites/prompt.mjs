// tests/suites/prompt.mjs — F030 suite: banners 10 through 10c and 22 through
// 22c of the former monolith — shaping, evidence inlining, and the budget.

import { DEFAULT_CONFIG, loadConfig, MAX_TOKEN_BUDGET, MIN_TOKEN_BUDGET } from "../../config.ts";
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
} from "../../prompt.ts";
import { assert, captureWarn, shapeJson, withConfig } from "../helpers.mjs";

// --- 10. prompt assembly: roles filtered first, tool deltas stripped, user tail guaranteed.
{
  const withNoise = [
    {
      role: "system",
      content: "base",
      toolsAdded: [{ name: "read" }],
      toolsRemoved: [],
      timestamp: 1,
    },
    { role: "user", content: "do it", timestamp: 2 },
    { role: "toolResult", content: [], timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: "thinking" }], timestamp: 4 },
  ];
  const out = buildAdvisorMessages(withNoise);
  assert(
    out.length === 3,
    "t10: the filter drops the system replay and the toolResult, then the nudge appends",
  );
  assert(out[0].content === "do it", "t10: the user message leads the filtered payload");
  assert(out[1].content[0].text === "thinking", "t10: the assistant message survives in place");
  assert(out[out.length - 1].role === "user", "t10: a user tail is guaranteed");
  assert(out[2].content[0].text === ADVISOR_NUDGE, "t10: the appended message is the nudge");
  const noDeltas = [
    { role: "system", content: "base", timestamp: 1 },
    { role: "user", content: "x", timestamp: 2 },
  ];
  assert(
    stripToolDeclarations(noDeltas) === noDeltas,
    "t10: nothing to strip returns the same array",
  );
  const alreadyUser = [
    { role: "user", content: "a", timestamp: 1 },
    { role: "toolResult", content: [], timestamp: 2 },
  ];
  assert(
    ensureUserTail(alreadyUser).length === 2,
    "t10: no nudge when the tail is not an assistant message",
  );
  assert(ensureUserTail([]).length === 0, "t10: an empty context stays empty");
}

// --- 10b. the role filter: the whitelist, both identity doors, by reference (FR2/FR4).
{
  const mixed = [
    { role: "system", content: "s", timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "u" }], timestamp: 2 },
    { role: "toolResult", content: [], timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 4 },
  ];
  const kept = keepAdvisorRoles(mixed);
  assert(kept.length === 2, "t10b: only the user and assistant messages survive");
  assert(kept[0] === mixed[1] && kept[1] === mixed[3], "t10b: survivors keep their references");
  const clean = [
    { role: "user", content: [{ type: "text", text: "u" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 2 },
  ];
  assert(keepAdvisorRoles(clean) === clean, "t10b: an all-keep transcript returns the same array");
  const floor = [
    { role: "system", content: "s", timestamp: 1 },
    { role: "toolResult", content: [], timestamp: 2 },
  ];
  assert(
    keepAdvisorRoles(floor) === floor,
    "t10b: nothing survives, so the original array returns",
  );
  const emptyArr = [];
  assert(keepAdvisorRoles(emptyArr) === emptyArr, "t10b: an empty transcript is the identity");
}

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

// --- 22. FR7 prompt budget: the chars/4 estimate, the fold, the window order, and the
//         tokenBudget config door. t10's one-arg buildAdvisorMessages call stays green:
//         the default budget is 0 and the fold is the identity.
{
  const m = (role, text, timestamp) =>
    role === "system"
      ? { role, content: text, timestamp }
      : { role, content: [{ type: "text", text }], timestamp };

  // The estimate is JSON-rendered characters / 4, rounded up.
  const probe = m("user", "abcd", 1);
  assert(
    estimateMessageTokens(probe) === Math.ceil(JSON.stringify(probe).length / 4),
    "t22: the estimate is JSON-rendered characters / 4, rounded up",
  );

  // Off is the identity: 0, negative, and non-finite budgets return the SAME array.
  const small = [m("system", "s", 1), m("user", "u", 2)];
  assert(applyTokenBudget(small, 0) === small, "t22: budget 0 is the identity");
  assert(applyTokenBudget(small, -5) === small, "t22: a negative budget is the identity");
  assert(applyTokenBudget(small, Number.NaN) === small, "t22: a non-finite budget is the identity");
  // The empty-context pin captures the reference first: two array literals are never
  // strictly equal, and the identity claim is same-array, not deep equality.
  const empty = [];
  assert(applyTokenBudget(empty, 5000) === empty, "t22: an empty context is the identity");
  assert(applyTokenBudget(small, 100000) === small, "t22: an under-budget context is the identity");

  // A fold that fits: systems kept, tail verbatim, marker rides the first folded slot.
  const sys1 = m("system", "S1".repeat(50), 1);
  const u1 = m("user", "u1".repeat(60), 2);
  const a1 = m("assistant", "a1".repeat(60), 3);
  const u2 = m("user", "u2".repeat(60), 4);
  const tail = m("assistant", "tail".repeat(5), 5);
  const sizes = [sys1, u1, a1, u2, tail].map(estimateMessageTokens);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  // Fits only once BOTH u1 and a1 are folded. The +80 slack stays under the identity
  // door (budget = total - 15 < total) yet clears the 64-token marker allowance only
  // after the second fold: folding u1 alone leaves 64 <= 80 - sizes[2] false while
  // sizes[2] > 16, and folding a1 makes 64 <= 80 true, so the walk stops there.
  const budget = total - sizes[1] - sizes[2] + 80;
  const folded = applyTokenBudget([sys1, u1, a1, u2, tail], budget);
  assert(folded.length === 4, "t22: the fold replaces two messages with one marker");
  assert(folded[0].role === "user", "t22: the marker is a user message");
  assert(
    folded[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
    "t22: the marker carries the pinned prefix",
  );
  assert(
    /2 earliest message\(s\)/.test(folded[0].content[0].text),
    "t22: the marker names the folded count",
  );
  assert(folded[0].timestamp === 2, "t22: the marker rides the first folded timestamp");
  assert(folded[1] === sys1, "t22: the system message survives in place");
  assert(folded[2] === u2, "t22: the kept messages stay byte-identical");
  assert(folded[3] === tail, "t22: the last message never folds");

  // Best-effort: systems plus tail alone can exceed the budget; the fold still returns
  // the invariant-respecting shape instead of throwing or dropping a system message.
  const overflow = [
    m("system", "S".repeat(400), 1),
    m("user", "m".repeat(200), 2),
    m("assistant", "t".repeat(400), 3),
  ];
  const starved = applyTokenBudget(overflow, 10);
  assert(starved.length === 3, "t22: a starved budget folds what it may and keeps the shape");
  assert(
    starved[0].role === "user" && starved[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
    "t22: the starved fold still places the marker",
  );
  assert(starved[1] === overflow[0], "t22: the system message survives a starved fold");
  assert(starved[2] === overflow[2], "t22: the tail survives a starved fold");

  // Nothing foldable: system-only and lone-message contexts are the identity even over budget.
  const onlySystems = [m("system", "a".repeat(400), 1), m("system", "b".repeat(400), 2)];
  assert(
    applyTokenBudget(onlySystems, 10) === onlySystems,
    "t22: a system-only context never folds",
  );
  const lone = [m("user", "x".repeat(400), 1)];
  assert(
    applyTokenBudget(lone, 10) === lone,
    "t22: the last message never folds, so a lone context is the identity",
  );

  // The window through buildAdvisorMessages: the default 0 equals an explicit 0.
  const plain = buildAdvisorMessages([sys1, a1]);
  const explicit = buildAdvisorMessages([sys1, a1], 0);
  assert(
    plain.length === explicit.length && shapeJson(plain) === shapeJson(explicit),
    "t22: the default budget equals an explicit 0",
  );
  assert(
    plain.length === 2,
    "t22: the system is filtered out, so the payload is the assistant plus the nudge",
  );

  // Strip, fold, tail: a folding context still ends on the user nudge.
  const windowed = buildAdvisorMessages(
    [m("user", "u".repeat(200), 1), m("assistant", "a".repeat(200), 2)],
    10,
  );
  assert(
    windowed.at(-1).content[0].text === ADVISOR_NUDGE,
    "t22: the nudge is appended after a fold (strip, fold, tail order)",
  );

  // The filter runs before the fold: the huge system never counts toward the budget,
  // so no marker leads and the payload fits without folding.
  const bigSystem = m("system", "s".repeat(4000), 1);
  const ordered = buildAdvisorMessages([bigSystem, m("user", "u", 2), m("assistant", "a", 3)], 50);
  assert(
    ordered[0].content[0].text === "u",
    "t22: no fold marker leads — the fold sized the filtered payload",
  );
  assert(
    ordered.length === 3,
    "t22: the filtered payload fits the budget, so only the nudge appended",
  );

  // The strip stays load-bearing on the filter's identity floor: a payload where no
  // user or assistant message survives returns from the filter with deltas intact.
  const floored = buildAdvisorMessages(
    [
      { role: "system", content: "s", toolsAdded: [{ name: "x".repeat(400) }], timestamp: 1 },
      { role: "toolResult", content: [], timestamp: 2 },
    ],
    10000,
  );
  assert(
    floored[0].toolsAdded === undefined && floored[0].content === "s",
    "t22: the floor path still strips the deltas and keeps the prompt text",
  );
  assert(floored.length === 2, "t22: the floor path adds no nudge after a toolResult tail");
}

// --- 22c. the tokenBudget field rides the same clamp/narrowing doors (extends t5/t7/t21c).
{
  const clamped = withConfig(JSON.stringify({ tokenBudget: -50 }), () => loadConfig());
  assert(
    clamped.tokenBudget === MIN_TOKEN_BUDGET,
    "t22c: a negative tokenBudget clamps to 0 (off)",
  );
  const high = withConfig(JSON.stringify({ tokenBudget: 9999999 }), () => loadConfig());
  assert(
    high.tokenBudget === MAX_TOKEN_BUDGET,
    "t22c: an over-max tokenBudget clamps down to the maximum",
  );
  const wrong = withConfig(JSON.stringify({ tokenBudget: "big", interval: 3 }), () => loadConfig());
  assert(
    wrong.tokenBudget === DEFAULT_CONFIG.tokenBudget && wrong.interval === 3,
    "t22c: a string tokenBudget falls back, leaving neighbors intact",
  );
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"tokenBudget": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.tokenBudget === MIN_TOKEN_BUDGET && cfg.interval === 1,
        "t22c: an infinite tokenBudget clamps to 0 next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t22c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.tokenBudget === 0, "t22c: the code default is 0 (the fold is off)");
}
