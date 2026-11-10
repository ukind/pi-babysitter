// tests/suites/advisor.mjs — F030 suite: banners 13 through 18 and 26 through
// 26c of the former monolith — resolution, the call, the deadline, consults.

import {
  CONSULT_ANSWER_HEADER,
  CONSULT_QUESTION_REFUSAL,
  CONSULT_SECTION_SEPARATOR,
  CONSULT_SPECIALIST_NAME,
  CONSULT_SPECIALIST_TOOL,
  CONSULT_UNCONFIGURED_REFUSAL,
  callWithDeadline,
  extractAdvisorText,
  getRuntimeCompleteSimple,
  resolveAdvisorModel,
  runAdvisor,
  stripAdvisorMarkup,
  undeclaredToolRefusalFor,
} from "../../advisor.ts";
import { DEFAULT_CONFIG, loadConfig, MIN_TIMEOUT_MS } from "../../config.ts";
import { reportFailure } from "../../report.ts";
import { READ_FILE_TOOL } from "../../sandbox.ts";
import { assert, withConfig } from "../helpers.mjs";

// --- 13. model resolution: an uncredentialed provider is skipped, not thrown.
{
  const registry = {
    find: (p, id) =>
      p === "anthropic" && id === "x" ? { provider: "anthropic", id: "x" } : undefined,
    getAvailable: () => [{ provider: "anthropic", id: "x" }],
  };
  const ok = resolveAdvisorModel(registry, "anthropic", "x");
  assert(ok.ok && ok.model.id === "x", "t13: a credentialed model resolves");
  const noCreds = resolveAdvisorModel(
    { find: () => ({ provider: "openai", id: "y" }), getAvailable: () => [] },
    "openai",
    "y",
  );
  assert(
    !noCreds.ok && /no credentials/.test(noCreds.reason),
    "t13: an uncredentialed provider is skipped with a reason",
  );
  const missing = resolveAdvisorModel(registry, "anthropic", "nope");
  assert(
    !missing.ok && /not in the registry/.test(missing.reason),
    "t13: an unknown model is skipped with a reason",
  );
}

// --- 14. the completion facade resolves only when the host exposes the private slot.
{
  const withSlot = { runtime: { completeSimple: () => Promise.resolve({}) } };
  assert(
    typeof getRuntimeCompleteSimple(withSlot) === "function",
    "t14: the facade resolves when the slot exists",
  );
  assert(getRuntimeCompleteSimple({}) === undefined, "t14: no runtime slot yields undefined");
  assert(getRuntimeCompleteSimple(null) === undefined, "t14: a null registry yields undefined");
  assert(
    getRuntimeCompleteSimple({ runtime: null }) === undefined,
    "t14: a null runtime yields undefined",
  );
  assert(
    getRuntimeCompleteSimple({ runtime: { completeSimple: "nope" } }) === undefined,
    "t14: a non-function slot yields undefined",
  );
}

// --- 15. the advisor call: happy path, error surfacing, and fail-open.
assert(
  extractAdvisorText({
    content: [
      { type: "thinking", thinking: "x" },
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ],
  }) === "a\nb",
  "t15: text blocks are joined and thinking is ignored",
);
assert(
  extractAdvisorText({ content: [{ type: "thinking", thinking: "x" }] }) === "",
  "t15: no text yields an empty string",
);

// --- 15b. stripAdvisorMarkup: the four passes, the AC1 invariant, and exact identity.
{
  const cases = [
    // Tier 1: a complete multi-line region is removed whole.
    [
      "complete region",
      "<tool_call>\n<function=foo>\n<parameter=x>1</parameter>\n</function>\n</tool_call>\nKeep this.",
      "Keep this.",
    ],
    // Tier 1: attributes on the opener and a lenient closer.
    ["attributes and lenient closer", '<tool_call name="x">body</tool_call >tail', "tail"],
    // Tier 2: residual vocabulary debris, payload included.
    ["residual function debris", "<function=foo>\nbody\n</function>\nafter", "after"],
    ["residual parameter debris", "<parameter=x>1</parameter>\nafter", "after"],
    // Tier 3: an unterminated region — prose kept, tag gone.
    ["unterminated opener", "before <tool_call> after", "before  after"],
    ["orphan closer", "before </tool_call> after", "before  after"],
    // A mid-tag cut is NOT markup: no tier matches it, and AC1 — which bans the
    // "<tool_call" substring — is not violated. The documented survival limit.
    ["mid-tag cut survives", "before <tool_ca after", "before <tool_ca after"],
    // Orphan vocabulary tokens are swept even without a paired counterpart —
    // the executable trace caught the pair-anchored tier 2 letting both through.
    ["orphan function opener", "<function=foo>\nafter", "after"],
    ["orphan parameter closer", "before </parameter> after", "before  after"],
    // F023: the widened dialects. A complete region, an orphan opener, and an
    // orphan closer for the new vocabulary.
    [
      "complete function_calls region",
      '<function_calls>\n<invoke name="x">\n<parameter=y>1</parameter>\n</invoke>\n</function_calls>\nKeep.',
      "Keep.",
    ],
    ["orphan invoke opener", '<invoke name="x">\nafter', "after"],
    ["orphan function_calls closer", "before </function_calls> after", "before  after"],
    // A mid-tag cut of the new dialect is NOT markup either: `<function_ca`
    // matches no widened arm (n-to-_ is no boundary; the function_calls arm
    // needs the full token), so the guard must miss it. The blank-line-run
    // input pins the guard's miss directly: byte-identity proves the collapse
    // pass never ran, not merely that the tags are gone.
    [
      "function_ca cut survives blank-line runs",
      "para1\n\n\nbefore <function_ca after\n\n\npara2",
      "para1\n\n\nbefore <function_ca after\n\n\npara2",
    ],
  ];
  for (const [name, input, expected] of cases) {
    const out = stripAdvisorMarkup(input);
    assert(out === expected, `t15b: ${name} (got ${JSON.stringify(out)})`);
    const residue = [
      "<tool_call>",
      "</tool_call>",
      "<function_calls>",
      "</function_calls>",
      "<invoke>",
      "</invoke>",
    ];
    assert(
      residue.every((tag) => !out.includes(tag)),
      `t15b: ${name} leaves no fake-markup substring`,
    );
  }
  // Innocent prose survives byte-identical.
  const innocent = "<file.ts:10> is where it drifts";
  assert(stripAdvisorMarkup(innocent) === innocent, "t15b: innocent prose is byte-identical");
  // Identity when clean, mirroring t10 at :245.
  assert(
    stripAdvisorMarkup("plain guidance") === "plain guidance",
    "t15b: clean text is the identity",
  );
  // Exact byte-identity for clean prose with blank-line runs: the guard early
  // return makes AC3 unconditional (the collapse pass never sees clean input).
  assert(
    stripAdvisorMarkup("para1\n\n\npara2") === "para1\n\n\npara2",
    "t15b: clean prose with blank-line runs is byte-identical",
  );
  // A whole-reply-is-markup husk strips to the empty string the guard consumes.
  assert(
    stripAdvisorMarkup("<tool_call>\n</function>\n</tool_call>") === "",
    "t15b: a markup-only reply strips to empty",
  );
  // Whitespace repair: no doubled blank lines after region removal.
  assert(
    stripAdvisorMarkup("a\n\n\n<tool_call>>x</tool_call>\n\n\nb") === "a\n\nb",
    "t15b: blank-line runs collapse after removal",
  );
  // The empty input is the identity, not a crash.
  assert(stripAdvisorMarkup("") === "", "t15b: an empty reply is the identity");
}

// --- 16. runAdvisor never throws and surfaces the real cause.
const runCases = [
  [
    "happy",
    { stopReason: "stop", content: [{ type: "text", text: "guidance" }] },
    (o) => o.ok && o.text === "guidance",
  ],
  [
    "error surfaces errorMessage",
    { stopReason: "error", errorMessage: "Provider is not configured: anthropic", content: [] },
    (o) => !o.ok && /Provider is not configured/.test(o.reason),
  ],
  [
    "empty errorMessage falls back",
    { stopReason: "error", errorMessage: "", content: [] },
    (o) => !o.ok && o.reason === "advisor stopped with error",
  ],
  [
    "aborted surfaces the stop reason",
    { stopReason: "aborted", content: [] },
    (o) => !o.ok && /advisor stopped with aborted/.test(o.reason),
  ],
  [
    "clean stop with no text",
    { stopReason: "stop", content: [{ type: "thinking", thinking: "x" }] },
    (o) => !o.ok && o.reason === "advisor returned no text",
  ],
  [
    "length is rejected",
    { stopReason: "length", content: [{ type: "text", text: "partial guidance" }] },
    (o) => !o.ok && /advisor stopped with length/.test(o.reason),
  ],
  [
    "toolUse is rejected",
    { stopReason: "toolUse", content: [{ type: "text", text: "x" }] },
    (o) => !o.ok && /advisor stopped with toolUse/.test(o.reason),
  ],
  [
    "pending is rejected",
    { stopReason: "pending", content: [{ type: "text", text: "x" }] },
    (o) => !o.ok && /advisor stopped with pending/.test(o.reason),
  ],
  [
    "deferred is rejected",
    { stopReason: "deferred", content: [{ type: "text", text: "x" }] },
    (o) => !o.ok && /advisor stopped with deferred/.test(o.reason),
  ],
  [
    "a clean stop with markup returns raw text",
    { stopReason: "stop", content: [{ type: "text", text: "see <tool_call>x</tool_call>" }] },
    (o) => o.ok && o.text === "see <tool_call>x</tool_call>",
  ],
];
for (const [name, response, check] of runCases) {
  const registry = { runtime: { completeSimple: () => Promise.resolve(response) } };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(check(outcome), `t16: ${name}`);
}
{
  const noFacade = await runAdvisor({
    registry: {},
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(
    !noFacade.ok && /no auth-aware completion facade/.test(noFacade.reason),
    "t16: a host without the facade fails open",
  );
}
{
  const keep = setInterval(() => {}, 500);
  const registry = { runtime: { completeSimple: () => new Promise(() => {}) } };
  const t0 = Date.now();
  const hung = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: MIN_TIMEOUT_MS,
  });
  const dt = Date.now() - t0;
  clearInterval(keep);
  assert(
    !hung.ok && /timed out/.test(hung.reason),
    "t16: a hanging call fails open at the deadline",
  );
  // The bound is asserted silently: embedding dt would make the output differ between
  // runs and break the phase's own determinism criterion.
  assert(
    dt >= MIN_TIMEOUT_MS - 50 && dt < MIN_TIMEOUT_MS + 2000,
    `t16: the deadline fires on time for a ${MIN_TIMEOUT_MS}ms budget`,
  );
}
{
  // The losing branch must not produce an unhandled rejection. Tested against
  // callWithDeadline directly because MIN_TIMEOUT_MS floors runAdvisor's budget at 1000ms,
  // which would make the rejection arrive before the deadline.
  const keep = setInterval(() => {}, 500);
  let unhandled = false;
  const onUnhandled = () => {
    unhandled = true;
  };
  process.on("unhandledRejection", onUnhandled);
  await callWithDeadline(
    () => new Promise((_, rej) => setTimeout(() => rej(new Error("late failure")), 300)),
    100,
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  clearInterval(keep);
  process.removeListener("unhandledRejection", onUnhandled);
  assert(!unhandled, "t16: a rejection after the deadline does not produce an unhandled rejection");
}
{
  // A call implementation that throws SYNCHRONOUSLY must not leak the deadline timer. The
  // pending assignment and its .catch sit inside callWithDeadline's try (F001), so the
  // finally clears the timer and the throw reaches runAdvisor's backstop as a usable
  // fail-open reason. On the regressed shape the throw skips the finally, the timer
  // survives, and at +timeoutMs the timeout promise rejects with no handler — which this
  // listener observes, and which would otherwise crash the suite several green-looking
  // tests later (the exit handler prints from process.exitCode, so a crash can even
  // masquerade as a pass).
  const keep = setInterval(() => {}, 500);
  const syncThrow = () => {
    throw new Error("sync boom");
  };
  let unhandled = null;
  const onUnhandled = (err) => {
    unhandled = err;
  };
  process.on("unhandledRejection", onUnhandled);
  let outcome = null;
  try {
    outcome = await callWithDeadline(syncThrow, 50);
  } catch (err) {
    outcome = err;
  }
  await new Promise((r) => setTimeout(r, 250));
  clearInterval(keep);
  process.removeListener("unhandledRejection", onUnhandled);
  assert(
    outcome instanceof Error && /sync boom/.test(outcome.message),
    "t16b: a synchronously throwing call rejects with the throw itself, not a timeout",
  );
  assert(
    unhandled === null,
    "t16b: a synchronous throw leaks no timer and produces no unhandled rejection",
  );
}

// --- 17. callWithDeadline forwards an external abort and clears its timer.
{
  const value = await callWithDeadline((_signal) => Promise.resolve("answer"), 5000);
  assert(value === "answer", "t17: the success path resolves with the call's value");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  let aborted = false;
  try {
    await callWithDeadline(
      (signal) =>
        new Promise((_, rej) => {
          signal.addEventListener("abort", () => rej(new Error("aborted")));
        }),
      5000,
      controller.signal,
    );
  } catch (err) {
    aborted = /aborted/.test(err.message);
  }
  assert(aborted, "t17: an external abort cancels the call");
  const preAborted = new AbortController();
  preAborted.abort();
  let immediate = false;
  try {
    await callWithDeadline(
      (signal) =>
        new Promise((_, rej) => {
          signal.addEventListener("abort", () => rej(new Error("aborted")));
        }),
      100,
      preAborted.signal,
    );
  } catch {
    immediate = true;
  }
  assert(immediate, "t17: an already-aborted signal rejects immediately");
}

// --- 18. failure reporting is gated on hasUI and swallows a stale UI.
{
  let seen = null;
  reportFailure(
    {
      hasUI: true,
      ui: {
        notify: (m, l) => {
          seen = [m, l];
        },
      },
    },
    "boom",
  );
  assert(seen && seen[1] === "warning", "t18: a UI gets the warning at warning level");
  seen = null;
  reportFailure(
    {
      hasUI: false,
      ui: {
        notify: () => {
          seen = "leaked";
        },
      },
    },
    "boom",
  );
  assert(seen === null, "t18: no UI means no notification");
  let threw = false;
  try {
    reportFailure(
      {
        hasUI: true,
        ui: {
          notify: () => {
            throw new Error("stale ui");
          },
        },
      },
      "boom",
    );
  } catch {
    threw = true;
  }
  assert(!threw, "t18: a throwing notify is swallowed");
}

// --- 26. FR6 specialist consult: the declared tool, the consult leg, the routing,
//         the shared deadline, and the aggregation.
{
  // Happy path: one consult round, the leg answers tool-free, the loop continues,
  // and the final stop aggregates base + specialist byte-exact.
  let calls = 0;
  const contexts = [];
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        calls += 1;
        contexts.push({ model, context });
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "cs1",
                name: "consult_specialist",
                arguments: { question: "Is the retry policy sound?" },
              },
            ],
          });
        }
        if (model === specialistModel) {
          return Promise.resolve({
            stopReason: "stop",
            content: [{ type: "text", text: "back off exponentially; cap at five tries" }],
          });
        }
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "final guidance" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
    timeoutMs: 5000,
    maxToolRounds: 3,
    specialist: { model: specialistModel, systemPrompt: "specialist prompt" },
  });
  assert(
    outcome.ok &&
      outcome.text ===
        "final guidance\n\n---\n\nSpecialist consult answer:\nback off exponentially; cap at five tries",
    "t26: the fire aggregates base advice and the specialist answer byte-exact",
  );
  assert(calls === 3, "t26: a consult fire costs exactly three calls (main, leg, main)");
  const legContext = contexts[1];
  assert(
    legContext.model === specialistModel && legContext.context.systemPrompt === "specialist prompt",
    "t26: the specialist leg carries the specialist model and system prompt",
  );
  assert(
    legContext.context.messages.length === 1 &&
      legContext.context.messages[0].role === "user" &&
      legContext.context.messages[0].content[0].text === "Is the retry policy sound?",
    "t26: the specialist leg receives the question as its only user message",
  );
  assert(legContext.context.tools === undefined, "t26: the specialist leg is tool-free");
  assert(
    contexts[2].context.messages.length === 3 &&
      contexts[2].context.messages[2].role === "toolResult" &&
      contexts[2].context.messages[2].isError === false &&
      contexts[2].context.messages[2].content[0].text ===
        "back off exponentially; cap at five tries",
    "t26: the consult answer replays to the advisor as a non-error toolResult",
  );
  assert(
    contexts[2].context.tools.length === 1 &&
      contexts[2].context.tools[0].name === CONSULT_SPECIALIST_NAME,
    "t26: the consult tool rides every round's request",
  );
  assert(
    CONSULT_SPECIALIST_TOOL.parameters.properties.question.type === "string",
    "t26: the declared tool takes one string question",
  );
}
{
  // Two consults aggregate in fire order between the pinned separators and headers.
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  const registry = {
    runtime: {
      completeSimple: (model) => {
        step += 1;
        if (model === specialistModel) {
          const text = step === 2 ? "answer one" : "answer two";
          return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text }] });
        }
        const isLast = step === 5;
        return Promise.resolve(
          isLast
            ? { stopReason: "stop", content: [{ type: "text", text: "final" }] }
            : {
                stopReason: "toolUse",
                content: [
                  {
                    type: "toolCall",
                    id: `cs${step}`,
                    name: "consult_specialist",
                    arguments: { question: step === 1 ? "q one" : "q two" },
                  },
                ],
              },
        );
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    outcome.ok &&
      outcome.text ===
        [
          "final",
          `${CONSULT_ANSWER_HEADER}\nanswer one`,
          `${CONSULT_ANSWER_HEADER}\nanswer two`,
        ].join(CONSULT_SECTION_SEPARATOR),
    "t26: two consults aggregate in fire order with the pinned separator and header",
  );
  assert(
    stripAdvisorMarkup(outcome.text) === outcome.text,
    "t26: the aggregated text passes through stripAdvisorMarkup byte-identical",
  );
  assert(
    !outcome.text.includes("\n\n\n"),
    "t26: no run of three newlines exists anywhere in the aggregated text",
  );
}
{
  // Base-only fail arm: the specialist leg resolves with stopReason "error"; the
  // reason replays as an errored toolResult and the final text carries no section.
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        step += 1;
        if (model === specialistModel) {
          return Promise.resolve({
            stopReason: "error",
            errorMessage: "Provider is not configured: openai",
            content: [],
          });
        }
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "cs1",
                name: "consult_specialist",
                arguments: { question: "q" },
              },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "base only" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    outcome.ok && outcome.text === "base only",
    "t26: a failed leg commits base-only advice with no section",
  );
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === "Provider is not configured: openai",
    "t26: a failed leg replays its reason as an errored toolResult",
  );
}
{
  // Base-only fail arm: a hung specialist leg dies at the shared remaining budget,
  // and the shared-clock timeout text rides the errored toolResult verbatim.
  const keep = setInterval(() => {}, 500);
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        step += 1;
        if (model === specialistModel) return new Promise(() => {});
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "cs1",
                name: "consult_specialist",
                arguments: { question: "q" },
              },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "base only" }],
        });
      },
    },
  };
  const t0 = Date.now();
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: MIN_TIMEOUT_MS,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  const dt = Date.now() - t0;
  clearInterval(keep);
  assert(
    outcome.ok && outcome.text === "base only",
    "t26: a hung leg still lands base-only advice",
  );
  // The shared clock names the SLICE it raced (fire budget minus elapsed), so the
  // number varies with machine load; the pin asserts the clock's exact text SHAPE —
  // the shared-clock rejection verbatim, not a leg-specific error.
  assert(
    finalContext.messages[1].isError === true &&
      /^advisor call timed out after \d+ms$/.test(finalContext.messages[1].content[0].text),
    "t26: the shared-clock timeout text rides the errored toolResult verbatim",
  );
  assert(
    dt >= MIN_TIMEOUT_MS - 50 && dt < MIN_TIMEOUT_MS + 2000,
    "t26: the consult leg races the fire's remaining budget, not a fresh one",
  );
}
{
  // The leg's two remaining failure arms pin the fail-open contract (Step 4
  // coverage fix; design follow-up: the design's t26 carries no pins for these
  // arms despite the every-failure-path-gets-a-pin note): an empty-text stop
  // reply and a non-error non-stop reply each replay as an errored toolResult
  // with the exact pinned reason, and the fire still lands base-only advice.
  const arms = [
    { stopReason: "stop", content: [{ type: "text", text: "" }] },
    { stopReason: "maxTokens", errorMessage: undefined, content: [] },
  ];
  for (const legReply of arms) {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    let step = 0;
    let finalContext = null;
    const registry = {
      runtime: {
        completeSimple: (model, context) => {
          step += 1;
          if (model === specialistModel) return Promise.resolve(legReply);
          if (step === 1) {
            return Promise.resolve({
              stopReason: "toolUse",
              content: [
                {
                  type: "toolCall",
                  id: "cs1",
                  name: "consult_specialist",
                  arguments: { question: "q" },
                },
              ],
            });
          }
          finalContext = context;
          return Promise.resolve({
            stopReason: "stop",
            content: [{ type: "text", text: "base only" }],
          });
        },
      },
    };
    const outcome = await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      specialist: { model: specialistModel, systemPrompt: "sp2" },
    });
    assert(
      outcome.ok && outcome.text === "base only",
      "t26: a failed leg arm never fails the fire",
    );
    assert(
      finalContext !== null && finalContext.messages[1].isError === true,
      "t26: the failed leg arm replays as an errored toolResult",
    );
    assert(
      finalContext.messages[1].content[0].text === "specialist returned no text" ||
        finalContext.messages[1].content[0].text === "specialist stopped with maxTokens",
      "t26: the leg's no-text and non-stop arms carry their exact pinned reasons",
    );
  }
}
// The question guard: missing, empty, whitespace-only, and non-string questions
// refuse with the pinned string; the leg never runs; the fire still lands.
for (const bad of [{}, { question: "" }, { question: "   " }, { question: 42 }]) {
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (model, context) => {
        step += 1;
        if (model === specialistModel) {
          throw new Error("the leg must never run for a malformed question");
        }
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "cs1", name: "consult_specialist", arguments: bad }],
          });
        }
        finalContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "base" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(outcome.ok && outcome.text === "base", "t26: a malformed question never fails the fire");
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === CONSULT_QUESTION_REFUSAL,
    "t26: a malformed question refuses with the pinned string",
  );
}
{
  // The unconfigured consult: the loop is armed by the sandbox tools alone, the
  // advisor names consult_specialist anyway, and the pinned refusal replays.
  let step = 0;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        step += 1;
        if (step === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              {
                type: "toolCall",
                id: "c1",
                name: "consult_specialist",
                arguments: { question: "q" },
              },
            ],
          });
        }
        finalContext = context;
        return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text: "base" }] });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 3,
  });
  assert(
    outcome.ok && outcome.text === "base",
    "t26: an unconfigured consult never fails the fire",
  );
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === CONSULT_UNCONFIGURED_REFUSAL,
    "t26: an unconfigured consult refuses with the pinned string",
  );
  assert(
    finalContext.tools.length === 1 && finalContext.tools[0].name === "read_file",
    "t26: no specialist means the consult tool is not declared",
  );
}
{
  // Specialist-only arming: no sandbox, no executor — consult_specialist is the
  // only declared tool, and an undeclared name refuses with the pinned string.
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  let step = 0;
  let declared = null;
  let finalContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        step += 1;
        if (step === 1) {
          declared = context.tools;
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c1", name: "write_file", arguments: { path: "x" } }],
          });
        }
        finalContext = context;
        return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text: "base" }] });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    declared.length === 1 && declared[0].name === CONSULT_SPECIALIST_NAME,
    "t26: a specialist-only fire declares exactly the consult tool",
  );
  assert(outcome.ok && outcome.text === "base", "t26: an undeclared name never fails the fire");
  assert(
    finalContext.messages[1].isError === true &&
      finalContext.messages[1].content[0].text === undeclaredToolRefusalFor("write_file"),
    "t26: an undeclared tool name refuses with the pinned string",
  );
}
{
  // The round budget counts consult rounds: maxToolRounds 1 spends one consult
  // round and then rejects at the terminal gate with the SAME pinned toolUse
  // reason, after main + leg + terminal main.
  let calls = 0;
  const specialistModel = { provider: "openai", id: "gpt-5.1" };
  const registry = {
    runtime: {
      completeSimple: (model) => {
        calls += 1;
        if (model === specialistModel) {
          return Promise.resolve({ stopReason: "stop", content: [{ type: "text", text: "leg" }] });
        }
        return Promise.resolve({
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: `c${calls}`,
              name: "consult_specialist",
              arguments: { question: "q" },
            },
          ],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    maxToolRounds: 1,
    specialist: { model: specialistModel, systemPrompt: "sp2" },
  });
  assert(
    !outcome.ok && outcome.reason === "advisor stopped with toolUse",
    "t26: an exhausted round budget rejects consults with the pinned toolUse reason",
  );
  assert(calls === 3, "t26: maxToolRounds 1 spends main + leg + terminal main");
}
{
  // Default-off: an unarmed call (no tools, no specialist) with a plain stop keeps
  // the single-call shape and byte-identical text — the pre-FR6 contract.
  let calls = 0;
  const registry = {
    runtime: {
      completeSimple: () => {
        calls += 1;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "plain" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(
    outcome.ok && outcome.text === "plain" && calls === 1,
    "t26: the default-off fire is the single-call shape",
  );
}

{
  // F023 strip discipline (Step 4 coverage fix; design follow-up: the design's
  // Verification Note 4 demands the byte-identity guard discipline for every new
  // refusal vocabulary, and t26 pins only the separator): the consult refusal
  // strings pass stripAdvisorMarkup byte-identical.
  const refusals = [
    CONSULT_QUESTION_REFUSAL,
    CONSULT_UNCONFIGURED_REFUSAL,
    undeclaredToolRefusalFor("write_file"),
  ];
  for (const refusal of refusals) {
    assert(
      stripAdvisorMarkup(refusal) === refusal,
      "t26: the consult refusal strings survive the strip byte-identical",
    );
  }
}

// --- 26c. the specialistModel and specialistSystemPrompt fields ride the same
//          narrowing doors (extends t5/t7/t21c/t22c/t23c/t25c).
{
  const cfg = withConfig(
    JSON.stringify({ specialistModel: "  openai/gpt-5.1  ", specialistSystemPrompt: "custom" }),
    () => loadConfig(),
  );
  assert(cfg.specialistModel === "openai/gpt-5.1", "t26c: a padded specialistModel is trimmed");
  assert(cfg.specialistSystemPrompt === "custom", "t26c: a custom specialist prompt survives");
  const wrong = withConfig(
    JSON.stringify({ specialistModel: 42, specialistSystemPrompt: "   ", interval: 6 }),
    () => loadConfig(),
  );
  assert(
    wrong.specialistModel === DEFAULT_CONFIG.specialistModel &&
      wrong.specialistSystemPrompt === DEFAULT_CONFIG.specialistSystemPrompt &&
      wrong.interval === 6,
    "t26c: wrong-typed and empty specialist fields fall back, leaving neighbors intact",
  );
  assert(DEFAULT_CONFIG.specialistModel === "", "t26c: the code default is consults OFF");
  assert(
    DEFAULT_CONFIG.specialistSystemPrompt.length > 0,
    "t26c: the specialist prompt ships a non-empty default",
  );
}

// The literal tuple is re-declared in the suite rather than imported: the module's
// list is private (the DEFAULT_MAX_TOOL_ROUNDS precedent — the parity pin is two
// INDEPENDENT literal assertions, never a cross-module comparison).
const REASONING_LEVELS_LITERAL = ["minimal", "low", "medium", "high", "xhigh", "max"];

// --- 29. the reasoning-effort option: the omit-key contract at both completeSimple
//         sites, the narrowing guard, and the level-list parity pin.
{
  // A capturing facade: records the THIRD argument of every call, which every
  // existing stub ignores (t16/t26 stubs take (model, context) only).
  const makeCapturingRegistry = (script) => {
    const seen = [];
    let step = 0;
    const registry = {
      runtime: {
        completeSimple: (model, context, options) => {
          seen.push({ model, context, options });
          const next = script[step] ?? {
            stopReason: "stop",
            content: [{ type: "text", text: "x" }],
          };
          step += 1;
          return Promise.resolve(next);
        },
      },
    };
    return { registry, seen };
  };

  // (a) The advisor call carries the level when configured.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    const outcome = await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      reasoning: "high",
    });
    assert(outcome.ok && outcome.text === "advice", "t29: the advisor call still succeeds");
    assert(seen.length === 1, "t29: one call, no loop armed");
    assert(seen[0].options?.reasoning === "high", "t29: the advisor call carries reasoning: high");
  }

  // (b) The omit-key contract: no reasoning param means NO OWN KEY, not undefined.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
    });
    assert(
      seen[0].options !== undefined && !Object.hasOwn(seen[0].options, "reasoning"),
      "t29: an unset advisor level leaves NO reasoning own key",
    );
    assert(seen[0].options?.signal !== undefined, "t29: the signal still rides the options");
  }

  // (c) The empty string is the unset sentinel, not a level.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      reasoning: "",
    });
    assert(
      !Object.hasOwn(seen[0].options ?? {}, "reasoning"),
      "t29: an empty advisor level omits the key",
    );
  }

  // (d) The narrowing guard: an out-of-list value never reaches the provider.
  {
    const { registry, seen } = makeCapturingRegistry([
      { stopReason: "stop", content: [{ type: "text", text: "advice" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [],
      timeoutMs: 5000,
      reasoning: "ultra",
    });
    assert(
      !Object.hasOwn(seen[0].options ?? {}, "reasoning"),
      "t29: an out-of-list advisor level omits the key (the guard's behavioural parity pin)",
    );
  }

  // (e) The specialist leg carries its own level, independently of the advisor's.
  {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    const { registry, seen } = makeCapturingRegistry([
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "cs1",
            name: "consult_specialist",
            arguments: { question: "q?" },
          },
        ],
      },
      { stopReason: "stop", content: [{ type: "text", text: "specialist answer" }] },
      { stopReason: "stop", content: [{ type: "text", text: "final" }] },
    ]);
    const outcome = await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
      timeoutMs: 5000,
      maxToolRounds: 3,
      reasoning: "high",
      specialist: { model: specialistModel, systemPrompt: "sp2", reasoning: "low" },
    });
    assert(outcome.ok, "t29: the consult fire succeeds");
    assert(seen.length === 3, "t29: main + leg + main");
    assert(seen[0].options?.reasoning === "high", "t29: the advisor rounds carry reasoning: high");
    assert(
      seen[1].options?.reasoning === "low",
      "t29: the specialist leg carries its own reasoning: low",
    );
    assert(
      seen[2].options?.reasoning === "high",
      "t29: the post-leg advisor round still carries reasoning: high",
    );
  }

  // (f) An unset specialist level omits the key on the leg.
  {
    const specialistModel = { provider: "openai", id: "gpt-5.1" };
    const { registry, seen } = makeCapturingRegistry([
      {
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "cs1",
            name: "consult_specialist",
            arguments: { question: "q?" },
          },
        ],
      },
      { stopReason: "stop", content: [{ type: "text", text: "specialist answer" }] },
      { stopReason: "stop", content: [{ type: "text", text: "final" }] },
    ]);
    await runAdvisor({
      registry,
      model: { provider: "a", id: "b" },
      systemPrompt: "sp",
      messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
      timeoutMs: 5000,
      maxToolRounds: 3,
      specialist: { model: specialistModel, systemPrompt: "sp2" },
    });
    assert(
      !Object.hasOwn(seen[1].options ?? {}, "reasoning"),
      "t29: an unset specialist level leaves NO reasoning own key on the leg",
    );
  }

  // (g) The level-list parity pin: the literal tuple, asserted independently (the
  //     DEFAULT_MAX_TOOL_ROUNDS two-pin pattern — tools.mjs:337 behavioural,
  //     :517 literal). Behavioural coverage is (d) above.
  assert(
    REASONING_LEVELS_LITERAL.join(",") === "minimal,low,medium,high,xhigh,max",
    "t29: the advisor-side level list is the six-level tuple, pinned literally",
  );
}
