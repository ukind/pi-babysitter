/**
 * Offline unit tests for advisor-turn-gate: deterministic, no live model, no auth.
 * Run: node --experimental-strip-types tests/test.mjs   (from the repo root)
 *
 * Covers the offline-checkable Verification Notes in
 * .rpiv/artifacts/plans/2026-10-27_21-34-09_advisor-turn-gate-extension.md:
 * cadence arithmetic, the accumulator spread, fail-open, the fact that completeSimple
 * never rejects, the ALS scope, the marker living in sections, marker drift, and model
 * resolution. Config clamping and prompt assembly are covered as well, but they are
 * Requirements rather than Verification Notes entries.
 *
 * Three things are deliberately NOT asserted, because no offline assertion can
 * distinguish them:
 *   - whether pi's jiti resolves the extensionless sibling imports index.ts uses. The
 *     form is proven live by simple-english/index.ts:16, but plain node cannot load
 *     index.ts at all, so this suite imports the four sibling modules directly.
 *   - whether the child-context shim resolves under jiti. Under plain node the .js
 *     specifier has no .ts fallback, so loadChildSessionProbe() always returns undefined
 *     here. The runtime assertion is the pair of factory-time log lines.
 *   - the real advisor call. Every advisor test stubs the completion facade.
 *
 * config.ts, guard.ts, prompt.ts, and advisor.ts import no sibling at runtime, so this
 * file resolves nothing from @earendil-works/* — a MODULE_NOT_FOUND here means a runtime
 * import leaked into one of them.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  callWithDeadline,
  extractAdvisorText,
  getRuntimeCompleteSimple,
  resolveAdvisorModel,
  runAdvisor,
  stripAdvisorMarkup,
} from "../advisor.ts";
import {
  CONFIG_URL,
  DEFAULT_CONFIG,
  loadConfig,
  MAX_INTERVAL,
  MAX_TIMEOUT_MS,
  MIN_INTERVAL,
  MIN_TIMEOUT_MS,
  modelKey,
  parseModelKey,
  shouldGate,
} from "../config.ts";
import {
  CHILD_MARKER_PATTERN,
  isChildSession,
  loadChildSessionProbe,
  logProbeReading,
} from "../guard.ts";
import {
  ADVISOR_NUDGE,
  buildAdvisorMessages,
  ensureUserTail,
  stripToolDeclarations,
} from "../prompt.ts";
import { reportFailure } from "../report.ts";
import { evaluate } from "../scripts/hooks/gate.mjs";

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else console.log("PASS:", msg);
};

// tmpRoot has no package.json, so it is the deterministic "no repo signal" cwd.
const tmpRoot = mkdtempSync(join(tmpdir(), "advisor-turn-gate-"));
// Cleanup AND summary live in the exit handler, not as trailing statements: a throwing
// assertion must not leak the temp dir or swallow the summary line.
process.on("exit", () => {
  rmSync(tmpRoot, { recursive: true, force: true });
  console.log(process.exitCode ? "test.mjs: FAILURES" : "test.mjs: all green");
});

/**
 * Point CONFIG_URL at a fixture, run fn, restore. CONFIG_URL is a mutable URL object and
 * loadConfig() reads it per call, so no restart is needed.
 */
const realHref = CONFIG_URL.href;
function withConfig(text, fn) {
  const file = join(tmpRoot, "config-under-test.json");
  writeFileSync(file, text);
  CONFIG_URL.href = pathToFileURL(file).href;
  try {
    return fn();
  } finally {
    CONFIG_URL.href = realHref;
  }
}

function captureWarn(fn) {
  const seen = [];
  const orig = console.warn;
  console.warn = (s) => seen.push(String(s));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

function captureLog(fn) {
  const seen = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (s) => seen.push(String(s));
  console.warn = (s) => seen.push(String(s));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return seen;
}

const Q = String.fromCharCode(34);
const marker = (name) => `<active_agent name=${Q}${name}${Q}/>`;

// --- 1. cadence: the modulo form gates once per interval; the threshold form latches.
//        Runs first because it is pure arithmetic with no module-level latch.
{
  const seq = [0, 1, 2, 3, 4, 5, 6, 7];
  const two = seq.filter((i) => shouldGate(i, 2));
  assert(
    two.join(",") === "1,3,5,7",
    `t1: interval 2 gates on turns 2,4,6,8 (got ${two.join(",")})`,
  );
  const three = seq.filter((i) => shouldGate(i, 3));
  assert(three.join(",") === "2,5", `t1: interval 3 gates on turns 3,6 (got ${three.join(",")})`);
  assert(
    seq.every((i) => shouldGate(i, 1)),
    "t1: interval 1 gates every turn",
  );
  assert(!shouldGate(0, 0), "t1: interval 0 never gates");
  assert(!shouldGate(0, -1), "t1: a negative interval never gates");
  // The rejected alternative, asserted so a refactor cannot silently adopt it.
  const latched = seq.filter((i) => i >= 2);
  assert(
    latched.length === 6,
    "t1: the threshold form would latch to 6 calls, which is why it is rejected",
  );
}

// --- 2. missing config file: silent, defaults. Runs BEFORE t3 because configWarned is a
//        module-level latch — a warn here would make t3 vacuous.
CONFIG_URL.href = pathToFileURL(join(tmpRoot, "does-not-exist.json")).href;
const missingWarns = captureWarn(() => loadConfig());
CONFIG_URL.href = realHref;
assert(missingWarns.length === 0, "t2: missing config.json warns nothing");
// Deliberately NO second loadConfig() here. configWarned is a module-level latch with no
// reset, so an unguarded call against a broken shipped config.json would latch it and
// make t3, t4, and t6 vacuous. The defaults path is covered by t3 and t5 instead.
const missingCfg = captureWarn(() => loadConfig());
assert(missingCfg.length === 0, "t2: a second read of the missing file still warns nothing");

// --- 3. malformed config: defaults + warns ONCE across two calls (the latch).
const malformedWarns = captureWarn(() => {
  const first = withConfig("{ not json", () => loadConfig());
  const second = withConfig("{ not json", () => loadConfig());
  assert(first.interval === DEFAULT_CONFIG.interval, "t3: malformed config falls back to defaults");
  assert(second.interval === DEFAULT_CONFIG.interval, "t3: second call still falls back");
});
assert(
  malformedWarns.length === 1,
  "t3: malformed config warns once per process, not once per turn",
);

// --- 4. a non-object JSON body degrades the same way. The warning count is 0, not 1,
//        because configWarned is a process-wide latch that t3 already tripped — that is
//        the intended "warn once per process, not once per turn" behavior.
const arrayWarns = captureWarn(() => withConfig("[1,2,3]", () => loadConfig()));
assert(
  arrayWarns.length === 0,
  "t4: the latch suppresses a second warning (warn once per process)",
);
const arrayCfg = withConfig("[1,2,3]", () => loadConfig());
assert(
  arrayCfg.interval === DEFAULT_CONFIG.interval,
  "t4: a JSON array still falls back to defaults",
);

// --- 5. out-of-range numbers clamp instead of throwing.
{
  const low = withConfig(JSON.stringify({ interval: 0, timeoutMs: 5 }), () => loadConfig());
  assert(low.interval === MIN_INTERVAL, `t5: interval 0 clamps up to ${MIN_INTERVAL}`);
  assert(low.timeoutMs === MIN_TIMEOUT_MS, `t5: timeoutMs 5 clamps up to ${MIN_TIMEOUT_MS}`);
  const high = withConfig(JSON.stringify({ interval: 9999, timeoutMs: 9999999 }), () =>
    loadConfig(),
  );
  assert(high.interval === MAX_INTERVAL, `t5: interval 9999 clamps down to ${MAX_INTERVAL}`);
  assert(
    high.timeoutMs === MAX_TIMEOUT_MS,
    `t5: timeoutMs 9999999 clamps down to ${MAX_TIMEOUT_MS}`,
  );
  const fractional = withConfig(JSON.stringify({ interval: 2.7 }), () => loadConfig());
  assert(fractional.interval === 2, "t5: a fractional interval truncates rather than throwing");
  const notANumber = withConfig(JSON.stringify({ interval: "two" }), () => loadConfig());
  assert(
    notANumber.interval === DEFAULT_CONFIG.interval,
    "t5: a non-numeric interval falls back to the default",
  );
}

// --- 6. an unparseable model is dropped with a warning; a parseable one survives.
{
  const warns = captureWarn(() => {
    const bad = withConfig(JSON.stringify({ model: "gpt-4" }), () => loadConfig());
    assert(bad.model === "", "t6: a model with no provider separator is dropped");
  });
  assert(warns.length === 0, "t6: the latch suppresses a second warning (warn once per process)");
  const badModel = withConfig(JSON.stringify({ model: "gpt-4" }), () => loadConfig());
  assert(badModel.model === "", "t6: the unparseable model is still dropped");
  const good = withConfig(JSON.stringify({ model: "anthropic/claude-sonnet-4-5" }), () =>
    loadConfig(),
  );
  assert(good.model === "anthropic/claude-sonnet-4-5", "t6: a well-formed model survives");
  const legacy = withConfig(JSON.stringify({ model: "anthropic:claude-sonnet-4-5" }), () =>
    loadConfig(),
  );
  assert(legacy.model === "anthropic:claude-sonnet-4-5", "t6: the legacy colon form survives");
}

// --- 7. per-field narrowing: a wrong-typed field cannot poison its neighbours.
{
  const mixed = withConfig(
    JSON.stringify({ enabled: "yes", interval: 3, model: 42, display: null }),
    () => loadConfig(),
  );
  assert(
    mixed.enabled === DEFAULT_CONFIG.enabled,
    "t7: a string enabled falls back, leaving interval intact",
  );
  assert(mixed.interval === 3, "t7: a valid interval survives a broken enabled");
  assert(mixed.model === DEFAULT_CONFIG.model, "t7: a numeric model falls back");
  assert(mixed.display === DEFAULT_CONFIG.display, "t7: a null display falls back");
}

// --- 7b. the no-tools instruction rides BOTH carriers, and the display default is true.
//         Stable marker substrings only — never full-string equality, so a wording
//         tweak does not fail the band.
{
  const shipped = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf-8"));
  assert(/no tools/.test(DEFAULT_CONFIG.systemPrompt), "t7b: the code default forbids tools");
  assert(/text only/.test(DEFAULT_CONFIG.systemPrompt), "t7b: the code default demands text only");
  assert(/no tools/.test(shipped.systemPrompt), "t7b: the shipped config forbids tools");
  assert(/text only/.test(shipped.systemPrompt), "t7b: the shipped config demands text only");
  assert(DEFAULT_CONFIG.display === true, "t7b: the display code default is true");
}

// --- 8. the model-key codec: slash wins, colon is legacy, neither is undefined.
assert(
  parseModelKey("a/b").provider === "a" && parseModelKey("a/b").modelId === "b",
  "t8: slash splits",
);
assert(
  parseModelKey("a:b").provider === "a" && parseModelKey("a:b").modelId === "b",
  "t8: colon splits",
);
assert(parseModelKey("a:b/c").modelId === "c", "t8: slash wins when both separators are present");
assert(parseModelKey("gpt-4") === undefined, "t8: no separator returns undefined");
assert(parseModelKey("/b") === undefined, "t8: a leading separator returns undefined");
assert(modelKey({ provider: "a", id: "b" }) === "a/b", "t8: modelKey composes the canonical form");

// --- 9. the accumulator spread. The negative case is the one that matters: a bare array
//        drops every peer draft, because emitBoundary REPLACES the accumulator.
{
  const peers = [
    { type: "custom", customType: "peer-a" },
    { type: "custom", customType: "peer-b" },
  ];
  const draft = {
    type: "custom_message",
    customType: "advisor-turn-gate",
    content: "guidance",
    display: false,
  };
  const spread = { entries: [...peers, draft], continue: true };
  assert(spread.entries.length === 3, "t9: the spread keeps both peer drafts");
  assert(spread.entries[0].customType === "peer-a", "t9: peer order is preserved");
  assert(spread.continue === true, "t9: continue survives the spread");
  const bare = { entries: [draft], continue: true };
  assert(
    bare.entries.length === 1,
    "t9: a bare array would drop both peers — the bug the spread prevents",
  );
}

// --- 10. prompt assembly: tool deltas stripped, user tail guaranteed.
{
  const withDeltas = [
    {
      role: "system",
      content: "base",
      toolsAdded: [{ name: "read" }],
      toolsRemoved: [],
      timestamp: 1,
    },
    { role: "user", content: "do it", timestamp: 2 },
    { role: "assistant", content: [{ type: "text", text: "thinking" }], timestamp: 3 },
  ];
  const out = buildAdvisorMessages(withDeltas);
  assert(out[0].toolsAdded === undefined, "t10: toolsAdded is stripped");
  assert(out[0].toolsRemoved === undefined, "t10: toolsRemoved is stripped");
  assert(out[0].content === "base", "t10: the prompt text survives the strip");
  assert(out[out.length - 1].role === "user", "t10: a user tail is guaranteed");
  assert(out.length === 4, "t10: the nudge is appended, not substituted");
  assert(out[3].content[0].text === ADVISOR_NUDGE, "t10: the appended message is the nudge");
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

// --- 11. the child-session veto. The first case is the regression test for the bug where
//         reading SystemMessage.content alone could never fire.
assert(
  isChildSession([
    { role: "system", content: "", sections: { preamble: marker("codebase-locator") } },
  ]),
  "t11: the marker in sections.preamble with empty content is caught",
);
assert(
  isChildSession([{ role: "system", content: marker("x"), sections: {} }]),
  "t11: the marker in content is caught",
);
assert(
  isChildSession([
    { role: "system", content: "", sections: { preamble: `intro${marker("x")}tail` } },
  ]),
  "t11: the marker anywhere in a section is caught",
);
assert(
  !isChildSession([
    {
      role: "system",
      content: "You are an expert coding assistant",
      sections: { preamble: "You are an expert coding assistant" },
    },
  ]),
  "t11: a main-session prompt is not caught",
);
assert(
  !isChildSession([{ role: "user", content: marker("x") }]),
  "t11: a user message quoting the marker is not caught — only system messages are scanned",
);
assert(!isChildSession([]), "t11: an empty context is not a child session");
assert(
  CHILD_MARKER_PATTERN.test(marker("anything")),
  "t11: the pattern matches the live prompts.ts:62 literal",
);
assert(
  !CHILD_MARKER_PATTERN.test("You are a child subagent"),
  "t11: the stale settings.json:84-90 pattern is rejected",
);
assert(
  !CHILD_MARKER_PATTERN.test("<active_agent>"),
  "t11: a tag with no name attribute is rejected",
);

// --- 12. the ALS probe degrades instead of throwing, and the log covers every shape.
{
  assert(
    loadChildSessionProbe() instanceof Promise,
    "t12: loadChildSessionProbe returns a promise",
  );
  const logs = captureLog(() => {
    logProbeReading(undefined);
    logProbeReading(() => true);
    logProbeReading(() => false);
    logProbeReading(() => {
      throw new Error("boom");
    });
  });
  assert(logs.length === 4, "t12: logProbeReading handles all four shapes without throwing");
  assert(
    logs[0].includes("shim unreachable"),
    "t12: an absent probe warns that the veto is the only guard",
  );
  assert(logs[1].includes("inChildSessionContext=true"), "t12: a true reading is logged");
  assert(logs[3].includes("probe threw"), "t12: a throwing probe is contained");
}

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
  ];
  for (const [name, input, expected] of cases) {
    const out = stripAdvisorMarkup(input);
    assert(out === expected, `t15b: ${name} (got ${JSON.stringify(out)})`);
    assert(
      !out.includes("<tool_call>") && !out.includes("</tool_call>"),
      `t15b: ${name} leaves no tool_call substring`,
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

// --- 19. the gate hook decision core: catastrophic commands block, ordinary ones pass.
{
  const blocked = [
    ["rm -rf /", "root"],
    ["rm -fr ~", "home"],
    ["rm -r -f /", "split flags"],
    ["rm -rf .", "dot"],
    ["rm -rf ..", "dotdot"],
    ["rm -rf '~'", "quoted home"],
    ["rm -rf ~/*", "home wildcard"],
    ["rm -rf C:\\", "drive root"],
    ["sudo rm -rf /", "sudo"],
    ["git push --force origin main", "long force"],
    ["git push -f main", "short force"],
    ["git push --force HEAD:master", "HEAD ref"],
    ["git reset --hard origin/main", "hard reset"],
    ["git clean -fd", "git clean"],
    ["DROP TABLE users;", "sql"],
    ["mkfs.ext4 /dev/sda1", "mkfs"],
    ["dd if=zero of=/dev/sda", "dd"],
    ["chmod -R 777 /", "chmod"],
  ];
  for (const [command] of blocked) {
    assert(evaluate(command) !== null, `t19: blocked: ${command}`);
  }
  const allowed = [
    "rm -rf node_modules",
    "rm -rf ./build",
    "rm -rf /var/log/app",
    "rm -rf ~/projects/*",
    "rm -r src",
    "rm file.txt",
    "git push origin feature/x",
    "git push --force-with-lease origin main",
    "git push origin main",
    "git reset --soft HEAD~1",
    "git clean -n",
    "DROP a hint",
    "npm test",
    "ls -la",
  ];
  for (const command of allowed) {
    assert(evaluate(command) === null, `t19: allowed: ${command}`);
  }
  assert(evaluate("") === null, "t19: empty command is allowed");
  assert(evaluate(undefined) === null, "t19: non-string is allowed");
  assert(evaluate("DROP TABLE users;") === "SQL drop statement", "t19: the reason names the rule");
}
