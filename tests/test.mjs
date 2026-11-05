/**
 * Offline unit tests for advisor-turn-gate: deterministic, no live model, no auth.
 * Run: node --experimental-strip-types tests/test.mjs   (from the repo root)
 *
 * Covers the offline-checkable Verification Notes of the original extension plan
 * (the plan artifact is not committed; the path stays as a historical label only):
 * cadence arithmetic, the accumulator spread, fail-open, the fact that completeSimple
 * never rejects, the marker living in sections, marker drift, and model resolution.
 * Config clamping and prompt assembly are covered as well, but they are
 * Requirements rather than Verification Notes entries.
 *
 * Two things are deliberately NOT asserted, because no offline assertion can
 * distinguish them:
 *   - whether pi's jiti resolves the extensionless sibling imports index.ts uses. The
 *     form is proven live by simple-english/index.ts:16, but plain node cannot load
 *     index.ts at all, so this suite imports the nine sibling modules directly.
 *   - the real advisor call. Every advisor test stubs the completion facade.
 *
 * config.ts, guard.ts, memory.ts, prompt.ts, advisor.ts, report.ts, plan-turn.ts,
 * triggers.ts, and sandbox.ts import no sibling at runtime, so this file resolves
 * nothing from @earendil-works/* — a MODULE_NOT_FOUND here means a runtime import leaked
 * into one of them.
 *
 * eval/runner.mjs is the second offline runner (the sanctioned split, TECH_DEBT_AUDIT.md):
 * golden fixtures per pillar replay the full pipeline — planGate, buildAdvisorMessages,
 * runAdvisor over a scripted facade, planCommit — and CI gates on the score table.
 * Fixture-style end-to-end scenarios live there; this file stays the unit-pin suite and
 * nothing pinned moves.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
} from "../advisor.ts";
import {
  CONFIG_URL,
  DEFAULT_CONFIG,
  loadConfig,
  MAX_INTERVAL,
  MAX_MEMORY_CAP,
  MAX_TIMEOUT_MS,
  MAX_TOKEN_BUDGET,
  MAX_TOOL_ROUNDS,
  MIN_INTERVAL,
  MIN_MEMORY_CAP,
  MIN_TIMEOUT_MS,
  MIN_TOKEN_BUDGET,
  MIN_TOOL_ROUNDS,
  parseModelKey,
  resetWarnOnceForTest,
  shouldFire,
} from "../config.ts";
import { CHILD_MARKER_PATTERN, isChildSession } from "../guard.ts";
import {
  capEntries,
  digestMessage,
  MEMORY_DIR_URL,
  projectKeyFor,
  readEntries,
  recordAdvice,
  resetMemoryWarnOnceForTest,
} from "../memory.ts";
import {
  buildCorrection,
  planCommit,
  planGate,
  planHostSupport,
  planSettle,
  stampDetails,
} from "../plan-turn.ts";
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
import { reportFailure } from "../report.ts";
import {
  createSandbox,
  planRead,
  READ_FILE_TOOL,
  SANDBOX_MAX_BYTES,
  sandboxRefusalFor,
} from "../sandbox.ts";
import { syntaxCheck } from "../scripts/hooks/feedback.mjs";
import { evaluate } from "../scripts/hooks/gate.mjs";
import {
  describeSpawnResult,
  isHookInvocation,
  parseHookStdin,
  readHookField,
} from "../scripts/hooks/lib.mjs";
import { parseRiskyTools, planTrigger, triggersArmed } from "../triggers.ts";

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
  // F002: re-arm the warn-once latch so every fixture window starts fresh and the
  // config tests carry no cross-test ordering constraint.
  resetWarnOnceForTest();
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

// JSON of messages with the timestamp key dropped: the one field two back-to-back
// buildAdvisorMessages calls can legitimately differ on (each nudge stamps its own
// Date.now(), so a millisecond boundary between calls is legal, not a divergence).
const shapeJson = (messages) => JSON.stringify(messages.map(({ timestamp: _ts, ...rest }) => rest));

const Q = String.fromCharCode(34);
const marker = (name) => `<active_agent name=${Q}${name}${Q}/>`;

// --- 1b. cadence: the stateful threshold (F007) folds to the modulo sets, slides past
//         an errored boundary, and cannot latch. The pure modulo form lived here until
//         F025 deleted it; its pins ride the fold simulator.
{
  // The fold simulator: advance the latch only on fire, mirroring the seam's markFired.
  const fold = (seq, interval) => {
    let last = -1;
    return seq.filter((i) => {
      if (!shouldFire(i, interval, last)) return false;
      last = i;
      return true;
    });
  };
  const seq = [0, 1, 2, 3, 4, 5, 6, 7];
  assert(fold(seq, 2).join(",") === "1,3,5,7", "t1b: interval 2 folds to the modulo set");
  assert(fold(seq, 3).join(",") === "2,5", "t1b: interval 3 folds to the modulo set");
  assert(fold(seq, 1).join(",") === "0,1,2,3,4,5,6,7", "t1b: interval 1 folds to every turn");
  assert(!shouldFire(0, 0, -1), "t1b: interval 0 never fires");
  assert(!shouldFire(0, -1, -1), "t1b: a negative interval never fires");
  // The rejected STATELESS threshold form, asserted so a refactor cannot silently
  // adopt it (moved verbatim from the deleted t1, F025): once turnIndex reaches the
  // interval it fires on EVERY later turn. F007's shouldFire cannot latch because
  // lastFiredTurn advances on every fire (the slide pins below).
  const latched = seq.filter((i) => i >= 2);
  assert(
    latched.length === 6,
    "t1b: the stateless threshold form would latch to 6 calls, which is why it is rejected",
  );
  // No latch: after a quiet stretch the stale threshold fires once, then re-locks. The
  // stateless form would fire on EVERY later turn instead.
  assert(fold([0, 1, 2, 7, 8], 2).join(",") === "1,7", "t1b: a gap fires once and re-locks");
  // Reload parity: a fresh factory restarts the latch at -1 while turnIndex keeps
  // climbing, so the first post-reload completed turn fires early and cadence re-locks
  // one interval later. Reload may fire early; it never skips.
  assert(
    fold([6, 7, 8], 2).join(",") === "6,8",
    "t1b: a reload fires early on the next completed turn and re-locks one interval later",
  );
  // The slide, driven through the core so the markFired placement is pinned: an errored
  // boundary leaves the latch alone, and the next completed turn at or past the boundary
  // fires — which the modulo form would NOT do (modulo gates at the error's turnIndex 3
  // and then at 5, so it would wait for 5 after the error at 3; the slide fires at 4).
  const boundary = (overrides = {}) =>
    planGate({
      enabled: true,
      model: "a/b",
      interval: 2,
      systemPrompt: "sp",
      timeoutMs: 5000,
      turnIndex: 0,
      outcome: "completed",
      llmMessages: [],
      lastFiredTurn: -1,
      gates: shouldFire,
      isChild: () => false,
      parseModel: () => ({ provider: "a", modelId: "b" }),
      resolve: () => ({ ok: true, model: { provider: "a", id: "b" } }),
      buildMessages: (messages) => messages,
      markFired: () => {},
      ...overrides,
    });
  const latch = { value: -1 };
  let marks = 0;
  const runTurn = (turnIndex, outcome) =>
    boundary({
      turnIndex,
      outcome,
      lastFiredTurn: latch.value,
      markFired: (i) => {
        marks++;
        latch.value = i;
      },
    });
  assert(runTurn(3, "error").action === "skip", "t1b: an errored boundary skips");
  assert(marks === 0, "t1b: an errored boundary does not spend its slot");
  const slid = runTurn(4, "completed");
  assert(slid.action === "consult", "t1b: the next completed turn at or past the boundary fires");
  assert(marks === 1 && latch.value === 4, "t1b: the latch advanced to the firing turn");
  assert(runTurn(5, "completed").action === "skip", "t1b: cadence re-locks after the slide");
}

// --- 2. missing config file: silent, defaults. The ENOENT path never reaches the
//        warn-once latch, so no ordering constraint applies (F002).
CONFIG_URL.href = pathToFileURL(join(tmpRoot, "does-not-exist.json")).href;
const missingWarns = captureWarn(() => loadConfig());
CONFIG_URL.href = realHref;
assert(missingWarns.length === 0, "t2: missing config.json warns nothing");
const missingCfg = captureWarn(() => loadConfig());
assert(missingCfg.length === 0, "t2: a second read of the missing file still warns nothing");

// --- 3. malformed config: defaults + warns ONCE across two calls (the latch).
//        Both reads share ONE withConfig window: withConfig re-arms the latch at entry,
//        so two windows would produce two warns and prove nothing.
const malformedWarns = captureWarn(() =>
  withConfig("{ not json", () => {
    const first = loadConfig();
    assert(
      first.interval === DEFAULT_CONFIG.interval,
      "t3: malformed config falls back to defaults",
    );
    const second = loadConfig();
    assert(second.interval === DEFAULT_CONFIG.interval, "t3: second call still falls back");
  }),
);
assert(
  malformedWarns.length === 1,
  "t3: malformed config warns once across two reads in one window",
);

// --- 4. a non-object JSON body degrades the same way. withConfig re-arms the latch at
//        entry, so the array case warns once in its own fresh window (the F002 flip
//        from the old order-dependent 0).
const arrayWarns = captureWarn(() => withConfig("[1,2,3]", () => loadConfig()));
assert(arrayWarns.length === 1, "t4: a JSON array warns once in a fresh window");
const arrayCfg = withConfig("[1,2,3]", () => loadConfig());
assert(
  arrayCfg.interval === DEFAULT_CONFIG.interval,
  "t4: a JSON array still falls back to defaults",
);

// --- 4b. resetWarnOnceForTest re-arms the latch (the F002 affordance). withConfig
//         already re-arms at entry, so this proves the export directly with no window.
{
  const file = join(tmpRoot, "config-under-test.json");
  writeFileSync(file, "[1,2,3]");
  CONFIG_URL.href = pathToFileURL(file).href;
  resetWarnOnceForTest();
  const armed = captureWarn(() => loadConfig());
  assert(armed.length === 1, "t4b: after a reset the latch lets the warn through");
  const suppressed = captureWarn(() => loadConfig());
  assert(suppressed.length === 0, "t4b: the re-tripped latch suppresses the next read");
  resetWarnOnceForTest();
  const reArmed = captureWarn(() => loadConfig());
  assert(reArmed.length === 1, "t4b: resetWarnOnceForTest re-arms the latch again");
  CONFIG_URL.href = realHref;
}

// --- 5. out-of-range numbers clamp instead of throwing, and every clamp or truncation
//        warns once through the shared latch (F014). A wrong-typed field never reaches
//        the clamp and stays silent.
{
  const lowWarns = captureWarn(() => {
    const low = withConfig(JSON.stringify({ interval: 0, timeoutMs: 5 }), () => loadConfig());
    assert(low.interval === MIN_INTERVAL, `t5: interval 0 clamps up to ${MIN_INTERVAL}`);
    assert(low.timeoutMs === MIN_TIMEOUT_MS, `t5: timeoutMs 5 clamps up to ${MIN_TIMEOUT_MS}`);
  });
  assert(
    lowWarns.length === 1,
    "t5: two clamped fields in one call share the latch — 1 warn, not 2",
  );
  const high = withConfig(JSON.stringify({ interval: 9999, timeoutMs: 9999999 }), () =>
    loadConfig(),
  );
  assert(high.interval === MAX_INTERVAL, `t5: interval 9999 clamps down to ${MAX_INTERVAL}`);
  assert(
    high.timeoutMs === MAX_TIMEOUT_MS,
    `t5: timeoutMs 9999999 clamps down to ${MAX_TIMEOUT_MS}`,
  );
  const truncWarns = captureWarn(() => {
    const fractional = withConfig(JSON.stringify({ interval: 2.7 }), () => loadConfig());
    assert(fractional.interval === 2, "t5: a fractional interval truncates rather than throwing");
  });
  assert(truncWarns.length === 1, "t5: truncation warns through the same clamp door");
  // The F014 crux: the default timeoutMs equals MAX_TIMEOUT_MS, so the clamp warn is the
  // only observable difference between "field absent" and "field clamped to default".
  const maxedWarns = captureWarn(() => {
    const maxed = withConfig(JSON.stringify({ timeoutMs: 99999999 }), () => loadConfig());
    assert(
      maxed.timeoutMs === DEFAULT_CONFIG.timeoutMs,
      "t5: an over-max timeoutMs lands on the default value",
    );
  });
  assert(maxedWarns.length === 1, "t5: clamped-to-default stays observable through the warn");
  // JSON has no Infinity literal; 1e999 parses to Infinity.
  const infiniteWarns = captureWarn(() => {
    const infinite = withConfig('{"interval": 1e999}', () => loadConfig());
    assert(infinite.interval === MIN_INTERVAL, "t5: an infinite interval clamps to the minimum");
  });
  assert(infiniteWarns.length === 1, "t5: an infinite interval warns like a clamp");
  const notANumber = withConfig(JSON.stringify({ interval: "two" }), () => loadConfig());
  assert(
    notANumber.interval === DEFAULT_CONFIG.interval,
    "t5: a non-numeric interval falls back to the default",
  );
  const wrongTypeWarns = captureWarn(() =>
    withConfig(JSON.stringify({ interval: "two" }), () => loadConfig()),
  );
  assert(
    wrongTypeWarns.length === 0,
    "t5: a wrong-typed field never reaches the clamp and warns nothing",
  );
}

// --- 6. an unparseable model is dropped with a warning; a parseable one survives.
{
  const warns = captureWarn(() =>
    withConfig(JSON.stringify({ model: "gpt-4" }), () => {
      assert(loadConfig().model === "", "t6: a model with no provider separator is dropped");
      assert(loadConfig().model === "", "t6: the unparseable model is still dropped");
    }),
  );
  assert(warns.length === 1, "t6: two reads in one window warn once (the shared latch)");
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

// --- 7b. the no-tools instruction rides the code default, and the display default is true.
//         Stable marker substrings only — never full-string equality, so a wording
//         tweak does not fail the band. The shipped systemPrompt copy was removed
//         (F005): the config.ts fallback makes the behavior bit-identical, and no
//         shipped model exists to band against (the ship-empty decision).
// No lone block around the asserts: with the shipped read gone the block would carry no
// declaration, and biome rejects a declaration-free lone block (noUselessLoneBlockStatements).
assert(/no tools/.test(DEFAULT_CONFIG.systemPrompt), "t7b: the code default forbids tools");
assert(/text only/.test(DEFAULT_CONFIG.systemPrompt), "t7b: the code default demands text only");
assert(
  /reasoning trace/.test(DEFAULT_CONFIG.systemPrompt),
  "t7b: the code default scopes the role to the reasoning trace",
);
assert(
  /outputs/.test(DEFAULT_CONFIG.systemPrompt),
  "t7b: the code default scopes the role to the outputs",
);
assert(
  /\[tool output\]/.test(DEFAULT_CONFIG.systemPrompt),
  "t7b: the code default documents the [tool output] convention",
);
assert(DEFAULT_CONFIG.display === true, "t7b: the display code default is true");

// --- 8. the model-key parser: slash wins, colon is legacy, neither is undefined.
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

// --- 9. plan-turn.ts: the extracted decision cores. The early-outs must keep the exact
//        order and laziness of the pre-extraction index.ts — an off-cadence turn invokes
//        no thunk beyond the trigger (t21 pins the trigger's cadence-miss-only
//        economics) — and the notify arms must carry the exact reportFailure
//        formats, so the seam can stay a dumb dispatcher.
const gateArgs = (overrides = {}) => ({
  enabled: true,
  model: "anthropic/claude-sonnet-4-5",
  interval: 2,
  systemPrompt: "sp",
  timeoutMs: 5000,
  turnIndex: 1,
  outcome: "completed",
  llmMessages: [{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 }],
  lastFiredTurn: -1,
  gates: shouldFire,
  isChild: () => false,
  parseModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-4-5" }),
  resolve: () => ({ ok: true, model: { provider: "anthropic", id: "claude-sonnet-4-5" } }),
  buildMessages: (messages) => messages,
  markFired: () => {},
  ...overrides,
});
{
  // Laziness. The cadence thunk runs; nothing behind it does.
  const calls = {
    gates: 0,
    markFired: 0,
    isChild: 0,
    parseModel: 0,
    resolve: 0,
    buildMessages: 0,
  };
  const decision = planGate(
    gateArgs({
      gates: () => {
        calls.gates++;
        return false;
      },
      markFired: () => {
        calls.markFired++;
      },
      isChild: () => {
        calls.isChild++;
        return true;
      },
      parseModel: () => {
        calls.parseModel++;
        return undefined;
      },
      resolve: () => {
        calls.resolve++;
        return { ok: false, reason: "unused" };
      },
      buildMessages: (messages) => {
        calls.buildMessages++;
        return messages;
      },
    }),
  );
  assert(decision.action === "skip", "t9: an off-cadence turn skips");
  assert(calls.gates === 1, "t9: the cadence thunk runs exactly once");
  const behind =
    calls.markFired + calls.isChild + calls.parseModel + calls.resolve + calls.buildMessages;
  assert(behind === 0, "t9: an off-cadence turn invokes no other thunk (laziness preserved)");
}
{
  // The silent top early-outs, and the order: cadence precedes the outcome check, the
  // outcome check precedes the child veto, and the veto precedes parse and resolve.
  assert(planGate(gateArgs({ enabled: false })).action === "skip", "t9: a disabled gate skips");
  assert(
    planGate(gateArgs({ model: "" })).action === "skip",
    "t9: an empty model skips before any thunk",
  );
  const calls = { gates: 0, markFired: 0, isChild: 0 };
  const errored = planGate(
    gateArgs({
      outcome: "error",
      gates: () => {
        calls.gates++;
        return true;
      },
      markFired: () => {
        calls.markFired++;
      },
      isChild: () => {
        calls.isChild++;
        return true;
      },
    }),
  );
  assert(errored.action === "skip", "t9: an errored boundary skips");
  assert(calls.gates === 1 && calls.isChild === 0, "t9: cadence precedes the outcome check");
  assert(calls.markFired === 0, "t9: an errored boundary does not spend its slot (the F007 slide)");
  const marks = [];
  const vetoed = planGate(
    gateArgs({
      isChild: () => true,
      parseModel: () => {
        throw new Error("parse must not run past the veto");
      },
      markFired: (i) => {
        marks.push(i);
      },
    }),
  );
  assert(vetoed.action === "skip", "t9: a child session skips before parse and resolve");
  assert(
    marks.join(",") === "1",
    "t9: the mark runs before the veto — a vetoed boundary spends its slot",
  );
}
{
  // The parse arm fails open SILENTLY — a skip, never a notify (pins index.ts:65-66).
  const decision = planGate(gateArgs({ parseModel: () => undefined }));
  assert(decision.action === "skip", "t9: an unparseable model skips");
  assert(!("message" in decision), "t9: the parse arm reports nothing");
}
{
  // The one notify arm in planGate: the exact reportFailure format the old :70 built.
  const decision = planGate(
    gateArgs({
      resolve: () => ({ ok: false, reason: 'provider "anthropic" has no credentials' }),
    }),
  );
  assert(
    decision.action === "notify" &&
      decision.message === 'advisor-turn-gate: provider "anthropic" has no credentials',
    "t9: a resolution failure notifies in the exact report format",
  );
}
{
  // The consult arm: the complete request shape, built inside the core, exactly once.
  const llm = [{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 }];
  const shaped = [{ role: "user", content: [{ type: "text", text: "shaped" }], timestamp: 2 }];
  const model = { provider: "anthropic", id: "claude-sonnet-4-5" };
  let built = 0;
  const decision = planGate(
    gateArgs({
      llmMessages: llm,
      systemPrompt: "the prompt",
      timeoutMs: 4321,
      resolve: () => ({ ok: true, model }),
      buildMessages: (messages) => {
        built++;
        assert(messages === llm, "t9: buildMessages receives the raw context");
        return shaped;
      },
    }),
  );
  assert(decision.action === "consult", "t9: the happy path consults");
  assert(decision.model === model, "t9: the resolved model rides through");
  assert(decision.systemPrompt === "the prompt", "t9: the system prompt rides through");
  assert(decision.messages === shaped, "t9: the messages are the shaped context");
  assert(decision.timeoutMs === 4321, "t9: the timeout rides through");
  assert(built === 1, "t9: buildMessages runs exactly once, inside the core");
}
// No lone block around the real-cadence asserts: they declare nothing, and biome rejects
// a declaration-free lone block (noUselessLoneBlockStatements).
// The real cadence predicate rides the seam: t1b's modulo interval sets, replayed
// through the core against shouldFire, so a seam that drops or inverts turnIndex or
// lastFiredTurn cannot pass silently.
assert(
  planGate(gateArgs({ interval: 0 })).action === "skip",
  "t9: interval 0 never consults through the real cadence",
);
assert(
  planGate(gateArgs({ turnIndex: 1, interval: 2 })).action === "consult",
  "t9: interval 2 consults on turnIndex 1 through the real cadence",
);
assert(
  planGate(gateArgs({ turnIndex: 0, interval: 2 })).action === "skip",
  "t9: interval 2 skips turnIndex 0 through the real cadence",
);
{
  // planCommit: both failure arms notify in the exact old formats (:84 and :93).
  const failed = planCommit({
    outcome: { ok: false, reason: "advisor stopped with error" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t9: an advisor error notifies in the exact report format",
  );
  const husk = planCommit({
    outcome: { ok: true, text: "<tool_call>x</tool_call>" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: () => "",
  });
  assert(
    husk.action === "notify" && husk.message === "advisor-turn-gate: advisor reply was markup only",
    "t9: a markup-only reply notifies in the exact husk format",
  );
}
{
  // The commit arm: the accumulator spread, asserted against the REAL buildCorrection
  // instead of the inline re-implementation this banner used to carry.
  const peers = [
    { type: "custom", customType: "peer-a" },
    { type: "custom", customType: "peer-b" },
  ];
  const committed = planCommit({
    outcome: { ok: true, text: "guidance" },
    customType: "advisor-turn-gate",
    display: false,
    peerEntries: peers,
    strip: (text) => text,
  });
  assert(committed.action === "commit", "t9: a clean reply commits");
  assert(committed.result.entries.length === 3, "t9: the spread keeps both peer drafts");
  assert(committed.result.entries[0].customType === "peer-a", "t9: peer order is preserved");
  assert(
    committed.result.entries[2].type === "custom_message",
    "t9: the guidance draft rides last",
  );
  assert(committed.result.continue === true, "t9: continue survives the spread");
  // The never-tested branch: undefined peerEntries degrades to a lone draft, not a crash.
  const noPeers = buildCorrection("advisor-turn-gate", "text", true, undefined);
  assert(noPeers.entries.length === 1, "t9: undefined peerEntries degrades to a lone draft");
  // The rejected alternative, kept as documentation: a bare array drops every peer draft.
  const bare = { entries: [{ type: "custom_message" }], continue: true };
  assert(
    bare.entries.length === 1,
    "t9: a bare array would drop both peers — the bug the spread prevents",
  );
}

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
assert(
  !CHILD_MARKER_PATTERN.test('<active_agent name="..."/>'),
  "t11: the AGENTS.md prose placeholder (dots, no alphanumeric) is rejected",
);
assert(
  !isChildSession([
    {
      role: "system",
      content: "Skips child sessions via the <active_agent name='...'/> marker veto.",
    },
  ]),
  "t11: gate documentation riding the system prompt stays inert",
);
assert(
  CHILD_MARKER_PATTERN.test(marker("aop.worker")),
  "t11: a legitimate child marker with a dotted agent name is caught",
);
assert(
  isChildSession([{ role: "system", content: "", sections: { preamble: marker("aop.worker") } }]),
  "t11: a dotted-name child marker vetoes the session",
);

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

// --- 19b. the refspec force markers (F009, F021, F022): a leading + on a refspec is
//          git's own force signal, and every refspec token is matched individually
//          against the protected-branch shape.
{
  const blocked = [
    "git push origin +main",
    "git push origin +master",
    "git push +main",
    "git push origin +HEAD:main",
    "git push origin +HEAD~1:main",
    "git push --force origin +main",
    "git push -f origin +main",
    "git push --force-with-lease origin +main",
    "git push origin main +main",
    "git push origin +main:main",
    "git push --force origin refs/heads/main",
    "git push origin +refs/heads/main",
    "git push -f origin HEAD:refs/heads/main",
    "git push origin --force refs/heads/main",
    "git push origin +:main",
  ];
  for (const command of blocked) {
    assert(evaluate(command) !== null, `t19b: blocked: ${command}`);
  }
  assert(blocked.length === 15, "t19b: 15 forced-refspec forms block");
  assert(
    evaluate("git push origin +main") === "forced push to a protected branch",
    "t19b: the + form reports the same reason as the flag form",
  );
  // The force-with-lease allowance survives, scoped to UNMARKED refspecs; a +
  // on an unprotected branch is still an ordinary push; and a forced push of
  // an UNPROTECTED branch alongside a plain protected one no longer convicts
  // the whole command (F022's false positive).
  const allowed = [
    "git push --force-with-lease origin main",
    "git push origin +feature/x",
    "git push origin feature/x",
    "git push origin main +feature/x",
  ];
  for (const command of allowed) {
    assert(evaluate(command) === null, `t19b: allowed: ${command}`);
  }
}

// --- 19c. the shared hook plumbing (F017): invocation detection, stdin parse, field
//          read. Only each hook's exit dispatch stays untested.
{
  assert(
    isHookInvocation(["node", "/repo/scripts/hooks/gate.mjs"], "gate.mjs"),
    "t19c: the gate path matches gate.mjs",
  );
  assert(
    isHookInvocation(["node", "\\repo\\scripts\\hooks\\gate.mjs"], "gate.mjs"),
    "t19c: a Windows path matches gate.mjs",
  );
  assert(
    !isHookInvocation(["node", "/repo/scripts/hooks/feedback.mjs"], "gate.mjs"),
    "t19c: the feedback hook does not match gate.mjs",
  );
  assert(!isHookInvocation(["node"], "gate.mjs"), "t19c: a missing entry arg never matches");
  const object = parseHookStdin('{"tool_input":{"command":"ls"}}');
  assert(object?.tool_input?.command === "ls", "t19c: an object body parses");
  assert(parseHookStdin("{ not json") === undefined, "t19c: a parse error returns undefined");
  assert(parseHookStdin("42") === undefined, "t19c: a non-object body returns undefined");
  assert(parseHookStdin("null") === undefined, "t19c: a null body returns undefined");
  const payload = { tool_input: { command: "ls" }, toolInput: { file_path: "a.ts" } };
  assert(readHookField(payload, "command") === "ls", "t19c: the snake_case carrier reads");
  assert(
    readHookField(payload, "file_path") === "a.ts",
    "t19c: the camelCase carrier is the fallback",
  );
  assert(readHookField({}, "command") === undefined, "t19c: a missing field returns undefined");
  assert(
    readHookField(undefined, "command") === undefined,
    "t19c: a missing payload returns undefined",
  );
}

// --- 20. the feedback hook's syntax check (F018): the spawnSync decision table, with the
//         timeout named. Node 22+ sets error=ETIMEDOUT alongside status=null and signal on
//         a spawnSync timeout (verified live on v24.14.0), so the timeout shape rides the
//         error branch — not the audit's traced "exit code null" fall-through.
{
  // A real valid file: the ok branch, through syntaxCheck itself.
  const valid = join(tmpRoot, "syntax-valid.mjs");
  writeFileSync(valid, "export const ok = 1;\n");
  const okResult = syntaxCheck(valid);
  assert(okResult.ok && okResult.detail === "syntax ok", "t20: a valid file reports syntax ok");

  // A real broken file: the stderr branch carries node's own syntax error text.
  const broken = join(tmpRoot, "syntax-broken.mjs");
  writeFileSync(broken, "const = ;\n");
  const badResult = syntaxCheck(broken);
  assert(
    !badResult.ok && badResult.detail.length > 0,
    "t20: a broken file carries the stderr text",
  );
  assert(
    !/exit code/.test(badResult.detail),
    "t20: a syntax error reports stderr, never the bare exit code",
  );

  // The F018 crux, constructed: the spawnSync timeout shape on Node 22+ — error set
  // (ETIMEDOUT), status null, signal SIGTERM.
  const timedOut = describeSpawnResult({
    error: new Error("spawnSync node.exe ETIMEDOUT"),
    status: null,
    signal: "SIGTERM",
  });
  assert(
    !timedOut.ok && timedOut.detail === "timed out after 10s (signal SIGTERM)",
    "t20: the timeout shape reports the timeout, not the ETIMEDOUT noise",
  );

  // A spawn error without the timeout shape (spawn failure, no signal): the raw message.
  const spawnedError = describeSpawnResult({ error: new Error("spawn failed"), status: null });
  assert(
    !spawnedError.ok && spawnedError.detail === "spawn failed",
    "t20: a plain spawn error surfaces its message",
  );

  // The no-error kill shape (external SIGTERM): reported as a kill, never as a timeout.
  const killed = describeSpawnResult({ status: null, signal: "SIGTERM" });
  assert(
    !killed.ok && killed.detail === "killed by SIGTERM before exit",
    "t20: a signal kill without an error is not claimed as a timeout",
  );

  // A non-zero exit with no stderr names the exit code.
  const silentFail = describeSpawnResult({ status: 1, stderr: null });
  assert(
    !silentFail.ok && silentFail.detail === "exit code 1",
    "t20: a non-zero exit with no stderr names the exit code",
  );
}

// --- 21. FR3 triggers: planTrigger arm order, planGate integration, host support.
{
  const signals = (overrides = {}) => ({
    turnTokens: null,
    contextPercent: null,
    outcome: "completed",
    toolNames: [],
    ...overrides,
  });
  const thresholds = (overrides = {}) => ({
    minNewTokens: 0,
    contextPercent: 0,
    onError: false,
    riskyTools: [],
    ...overrides,
  });
  assert(
    planTrigger(signals(), thresholds()).action === "none",
    "t21: nothing armed fires nothing",
  );
  assert(
    planTrigger(signals({ outcome: "error" }), thresholds({ onError: true })).signal === "error",
    "t21: the error signal fires first when armed",
  );
  assert(
    planTrigger(
      signals({ outcome: "error", turnTokens: 99999 }),
      thresholds({ onError: true, minNewTokens: 1000 }),
    ).signal === "error",
    "t21: trouble outcome outranks token growth",
  );
  assert(
    planTrigger(
      signals({ turnTokens: 20000, contextPercent: 90 }),
      thresholds({ minNewTokens: 1000, contextPercent: 50 }),
    ).signal === "tokens",
    "t21: token growth outranks context pressure",
  );
  assert(
    planTrigger(
      signals({ contextPercent: 90, toolNames: ["git push"] }),
      thresholds({ contextPercent: 50, riskyTools: ["git push"] }),
    ).signal === "pressure",
    "t21: context pressure outranks risky tools",
  );
  assert(
    planTrigger(
      signals({ toolNames: ["read", "git push"] }),
      thresholds({ riskyTools: ["git push", "rm"] }),
    ).signal === "risky-tool",
    "t21: a risky tool fires last",
  );
  assert(
    planTrigger(signals({ turnTokens: 10 }), thresholds({ minNewTokens: 1000 })).action === "none",
    "t21: a sub-threshold signal does not fire",
  );
  assert(
    planTrigger(signals({ outcome: "aborted" }), thresholds({ onError: true })).action === "none",
    "t21: an aborted turn never fires the error signal",
  );
  assert(
    planTrigger(signals({ toolNames: ["git push"] }), thresholds({ riskyTools: ["gitpush"] }))
      .action === "none",
    "t21: risky-tool matching is exact, not substring",
  );
  assert(
    JSON.stringify(parseRiskyTools(" git push , rm , ")) === JSON.stringify(["git push", "rm"]),
    "t21: parseRiskyTools trims and drops empties",
  );
  assert(triggersArmed(thresholds()) === false, "t21: all-off thresholds are unarmed");
  assert(
    triggersArmed(thresholds({ minNewTokens: 1 })) === true,
    "t21: one armed signal is enough",
  );
}
{
  // planGate integration: the trigger arm sits between no-model and cadence.
  let triggerCalls = 0;
  const fire = () => {
    triggerCalls++;
    return { action: "fire", signal: "tokens", detail: "20000" };
  };
  const latch = { value: -1 };
  let marks = 0;
  const fired = planGate(
    gateArgs({
      turnIndex: 0,
      interval: 2,
      trigger: fire,
      markFired: (i) => {
        marks++;
        latch.value = i;
      },
    }),
  );
  assert(fired.action === "consult", "t21: a trigger fire consults ahead of cadence");
  assert(
    triggerCalls === 1 && marks === 1 && latch.value === 0,
    "t21: the trigger fire spends the latch once",
  );
  triggerCalls = 0;
  planGate(gateArgs({ turnIndex: 1, interval: 2, trigger: fire }));
  assert(triggerCalls === 0, "t21: an on-cadence turn invokes no trigger thunk");
  marks = 0;
  const quiet = planGate(
    gateArgs({
      turnIndex: 0,
      interval: 2,
      trigger: () => ({ action: "none", reason: "no signal" }),
      markFired: () => {
        marks++;
      },
    }),
  );
  assert(
    quiet.action === "skip" && marks === 0,
    "t21: an untriggered cadence miss skips without spending",
  );
  const errorFired = planGate(
    gateArgs({
      turnIndex: 0,
      interval: 2,
      outcome: "error",
      trigger: () => ({ action: "fire", signal: "error", detail: "error" }),
    }),
  );
  assert(errorFired.action === "consult", "t21: an error-triggered fire bypasses the outcome veto");
  assert(
    planGate(gateArgs({ turnIndex: 1, interval: 2, outcome: "error" })).action === "skip",
    "t21: a cadence-due errored turn still skips (the F007 slide)",
  );
  assert(
    planGate(
      gateArgs({
        turnIndex: 0,
        interval: 2,
        outcome: "aborted",
        trigger: () => ({ action: "fire", signal: "tokens", detail: "1" }),
      }),
    ).action === "skip",
    "t21: an aborted turn skips even when another signal fired",
  );
  assert(
    planGate(gateArgs({ turnIndex: 0, interval: 2, trigger: undefined })).action === "skip",
    "t21: an unarmed config skips a cadence miss with no trigger",
  );
}
{
  // planHostSupport: the 1.4 boundary surface vs the 0.79 bare emit.
  assert(
    planHostSupport("completed", { llmMessages: [] }).supported === true,
    "t21: a 1.4-shaped event is supported",
  );
  const stale = planHostSupport(undefined, undefined);
  assert(
    stale.supported === false && /predate 1\.4/.test(stale.message),
    "t21: a bare 0.79 emit is rejected with the pinned message",
  );
  assert(
    planHostSupport(null, { llmMessages: [] }).supported === false,
    "t21: a null outcome is rejected",
  );
  assert(
    planHostSupport("completed", null).supported === false,
    "t21: a missing context is rejected",
  );
}

// --- 21c. the four trigger fields ride the same clamp/narrowing doors (extends t5/t7).
{
  const clamped = withConfig(
    JSON.stringify({
      triggerMinNewTokens: -5,
      triggerContextPercent: 101,
      triggerOnError: "yes",
      triggerRiskyTools: 42,
    }),
    () => loadConfig(),
  );
  assert(
    clamped.triggerMinNewTokens === 0,
    "t21c: a negative triggerMinNewTokens clamps to 0 (off)",
  );
  assert(
    clamped.triggerContextPercent === 100,
    "t21c: an over-100 triggerContextPercent clamps to 100",
  );
  assert(
    clamped.triggerOnError === false,
    "t21c: a string triggerOnError falls back to the default",
  );
  assert(
    clamped.triggerRiskyTools === "",
    "t21c: a numeric triggerRiskyTools falls back to the default",
  );
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"triggerMinNewTokens": 1e999, "triggerContextPercent": -1}', () => loadConfig()),
  );
  assert(warns.length === 1, "t21c: two clamped trigger fields share the warn-once latch");
  const armed = withConfig(
    JSON.stringify({ triggerMinNewTokens: 5000, triggerRiskyTools: "git push" }),
    () => loadConfig(),
  );
  assert(
    armed.triggerMinNewTokens === 5000 && armed.triggerRiskyTools === "git push",
    "t21c: armed values survive",
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

// --- 23. FR2 memory: the store round-trip, the cap, the digest, and the window ride.
{
  const realMemoryHref = MEMORY_DIR_URL.href;
  const storeDir = join(tmpRoot, "memory-store");
  resetMemoryWarnOnceForTest();
  rmSync(storeDir, { recursive: true, force: true });
  MEMORY_DIR_URL.href = `${pathToFileURL(storeDir).href}/`;
  try {
    // The key is stable per cwd and distinct per directory.
    const key = projectKeyFor("C:\\repo a");
    assert(key === projectKeyFor("C:\\repo a"), "t23: the same cwd maps to the same store key");
    assert(
      projectKeyFor("C:\\repo a") !== projectKeyFor("C:\\repo  a"),
      "t23: a different cwd maps to a different store key",
    );
    assert(
      /^[A-Za-z0-9._-]+$/.test(projectKeyFor("C:\\repo a/\\*?:")),
      "t23: the key is filename-safe for a hostile cwd",
    );

    // Round-trip: two appends read back in order.
    recordAdvice("proj", "note one", 5, 1);
    recordAdvice("proj", "note two", 5, 2);
    const entries = readEntries("proj");
    assert(entries.length === 2, "t23: two appends store two entries");
    assert(
      entries[0].text === "note one" && entries[1].text === "note two",
      "t23: entries read back oldest first",
    );
    assert(entries[0].timestamp === 1, "t23: the seam's timestamp is stored");

    // The write-time cap keeps the newest.
    recordAdvice("proj", "note three", 2, 3);
    const capped = readEntries("proj");
    assert(
      capped.length === 2 && capped[0].text === "note two" && capped[1].text === "note three",
      "t23: the cap keeps the newest entries",
    );

    // Blank advice is skipped, not stored.
    recordAdvice("proj", "   ", 2, 4);
    assert(readEntries("proj").length === 2, "t23: blank advice is skipped");

    // An unknown key reads as the empty store, silently.
    const silent = captureWarn(() => readEntries("unknown"));
    assert(readEntries("unknown").length === 0, "t23: an unknown key reads as empty");
    assert(silent.length === 0, "t23: the ENOENT read warns nothing");

    // A corrupt store warns once with the pinned reason and reads as empty (the latch).
    rmSync(storeDir, { recursive: true, force: true });
    recordAdvice("proj", "seed", 5, 1);
    writeFileSync(join(storeDir, "proj.json"), "{ not json");
    const corruptWarns = captureWarn(() => {
      assert(readEntries("proj").length === 0, "t23: a corrupt store reads as empty");
      assert(readEntries("proj").length === 0, "t23: the corrupt store still reads as empty");
    });
    assert(
      corruptWarns.length === 1 && corruptWarns[0].includes("ignoring unreadable advisor memory"),
      "t23: a corrupt store warns once with the pinned reason",
    );

    // capEntries: the pure cap arithmetic.
    const seeded = [
      { timestamp: 1, text: "a" },
      { timestamp: 2, text: "b" },
      { timestamp: 3, text: "c" },
    ];
    assert(capEntries(seeded, 0).length === 0, "t23: cap 0 is the empty store");
    assert(capEntries(seeded, -1).length === 0, "t23: a negative cap is the empty store");
    assert(capEntries(seeded, 5) === seeded, "t23: an over-cap cap is the identity");
    assert(capEntries(seeded, 3) === seeded, "t23: an at-cap cap is the identity");
    const two = capEntries(seeded, 2);
    assert(
      two.length === 2 && two[0].text === "b" && two[1].text === "c",
      "t23: an over-cap cap keeps the newest two",
    );

    // A write into a hostile path never throws; the warn carries the pinned reason.
    // The pre-read is silent, so the write's warn is deterministic on every platform.
    resetMemoryWarnOnceForTest();
    writeFileSync(join(tmpRoot, "memory-blocker"), "not a directory");
    const blockedHref = MEMORY_DIR_URL.href;
    MEMORY_DIR_URL.href = `${pathToFileURL(join(tmpRoot, "memory-blocker")).href}/`;
    let threw = false;
    const hostileWarns = captureWarn(() => {
      try {
        recordAdvice("proj", "lost advice", 5, 1);
      } catch {
        threw = true;
      }
    });
    MEMORY_DIR_URL.href = blockedHref;
    assert(!threw, "t23: a hostile store path never throws");
    assert(
      hostileWarns.length === 1 && hostileWarns[0].includes("advisor memory write failed"),
      "t23: a failed write warns once with the pinned reason",
    );

    // The digest builder: exact text, singular and plural, empty -> undefined.
    assert(digestMessage([], 1) === undefined, "t23: an empty store builds no digest");
    const one = digestMessage([{ timestamp: 1, text: "only advice" }], 7);
    assert(
      one.role === "system" &&
        one.content === "Advisor memory from earlier fires (1 entry):\n- only advice" &&
        one.timestamp === 7,
      "t23: the singular digest is exact",
    );
    const twoEntry = digestMessage(
      [
        { timestamp: 1, text: "first advice" },
        { timestamp: 2, text: "second advice" },
      ],
      7,
    );
    assert(
      twoEntry.content ===
        "Advisor memory from earlier fires (2 entries):\n- first advice\n- second advice",
      "t23: the plural digest is exact and reads oldest first",
    );

    // The window ride: base ends on an assistant, so the nudge rides and the digest
    // is inserted in front of it — the nudge stays terminal.
    const base = [
      { role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 },
    ];
    const digest = digestMessage([{ timestamp: 1, text: "prior fire" }], 5);
    const shaped = buildAdvisorMessages(base, 0, digest);
    assert(shaped.length === 4, "t23: the digest adds exactly one message");
    assert(shaped[2] === digest, "t23: the digest sits after the transcript");
    assert(shaped[2].role === "system", "t23: the digest is a system message");
    assert(shaped[3].content[0].text === ADVISOR_NUDGE, "t23: the nudge stays terminal");

    // The digest never folds and keeps the recency slot, even over a starved budget.
    const starved = buildAdvisorMessages(base, 1, digest);
    assert(
      starved.includes(digest) && starved[starved.length - 2] === digest,
      "t23: the digest survives a starved budget at the recency end",
    );
    assert(
      starved[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
      "t23: the transcript itself still folds under the budget",
    );

    // A transcript with its own user tail: the digest goes in front of it, the tail
    // stays terminal, and no nudge rides (ensureUserTail is untouched).
    const userTailed = buildAdvisorMessages([base[0]], 0, digest);
    assert(
      userTailed.length === 2 && userTailed[0] === digest && userTailed[1] === base[0],
      "t23: the digest is inserted in front of the transcript's own user tail",
    );

    // An empty transcript degrades to the digest alone; no nudge is invented.
    const empty = buildAdvisorMessages([], 0, digest);
    assert(
      empty.length === 1 && empty[0] === digest,
      "t23: an empty context yields the digest alone",
    );

    // Default-off: no digest is byte-identical to the pre-FR2 two-arg call. The
    // comparison normalizes timestamps: each call stamps its own nudge with an
    // independent Date.now(), so a millisecond boundary between the two calls is
    // legal, not a divergence (the shapeJson helper above).
    const noDigest = buildAdvisorMessages(base);
    const undefinedDigest = buildAdvisorMessages(base, 0, undefined);
    assert(
      noDigest.length === undefinedDigest.length &&
        shapeJson(noDigest) === shapeJson(undefinedDigest),
      "t23: the absent digest is byte-identical to the pre-FR2 shape",
    );
  } finally {
    MEMORY_DIR_URL.href = realMemoryHref;
    rmSync(storeDir, { recursive: true, force: true });
  }
}

// --- 23c. the memoryCap field rides the same clamp/narrowing doors (extends t5/t7/t21c/t22c).
{
  const clamped = withConfig(JSON.stringify({ memoryCap: -3 }), () => loadConfig());
  assert(clamped.memoryCap === MIN_MEMORY_CAP, "t23c: a negative memoryCap clamps to 0 (off)");
  const high = withConfig(JSON.stringify({ memoryCap: 99999 }), () => loadConfig());
  assert(
    high.memoryCap === MAX_MEMORY_CAP,
    "t23c: an over-max memoryCap clamps down to the maximum",
  );
  const wrong = withConfig(JSON.stringify({ memoryCap: "many", interval: 4 }), () => loadConfig());
  assert(
    wrong.memoryCap === DEFAULT_CONFIG.memoryCap && wrong.interval === 4,
    "t23c: a string memoryCap falls back, leaving neighbors intact",
  );
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ memoryCap: "many" }), () => loadConfig()),
  );
  assert(silent.length === 0, "t23c: a wrong-typed memoryCap never reaches the clamp");
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"memoryCap": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.memoryCap === MIN_MEMORY_CAP && cfg.interval === 1,
        "t23c: an infinite memoryCap clamps to 0 next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t23c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.memoryCap === 0, "t23c: the code default is 0 (memory off)");
}

// --- 24. FR1 dialogue: the stamp core, the commit passthrough, and the key-less default.
{
  // stampDetails: the stable keys, exact and ordered.
  const stamp = stampDetails(3, 11);
  assert(
    stamp.fire === "3" && stamp.turn === "11",
    "t24: the stamp is the exact { fire, turn } string pair",
  );
  assert(
    JSON.stringify(Object.keys(stamp)) === JSON.stringify(["fire", "turn"]),
    "t24: the keys are stable and fire comes first",
  );
  assert(
    stampDetails(1, 0).fire === "1" && stampDetails(1, 0).turn === "0",
    "t24: the first fire stamps ordinal 1 on turn 0",
  );
}
{
  // buildCorrection: the stamp rides the draft; an absent stamp leaves NO key.
  const stamped = buildCorrection("advisor-turn-gate", "text", true, [], stampDetails(2, 7));
  const draft = stamped.entries[0];
  assert(draft.type === "custom_message", "t24: the stamped draft is a custom_message");
  assert(
    draft.details !== undefined && draft.details.fire === "2" && draft.details.turn === "7",
    "t24: the stamp rides the committed draft",
  );
  const unstamped = buildCorrection("advisor-turn-gate", "text", true, []);
  assert(
    unstamped.entries.length === 1 && !("details" in unstamped.entries[0]),
    "t24: an absent stamp leaves the draft key-less (the pre-FR1 byte shape)",
  );
  const peers = [{ type: "custom", customType: "peer-a" }];
  const withPeers = buildCorrection("ct", "t", true, peers, stampDetails(1, 1));
  assert(
    withPeers.entries.length === 2 &&
      withPeers.entries[0].customType === "peer-a" &&
      withPeers.entries[1].details?.fire === "1",
    "t24: stamping keeps the peer spread and the draft rides last",
  );
  assert(withPeers.continue === true, "t24: continue survives stamping");
}
{
  // planCommit: the passthrough reaches the committed draft; the notify arms stay
  // unchanged in format and carry no details anywhere.
  const committed = planCommit({
    outcome: { ok: true, text: "guidance" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(4, 12),
  });
  assert(
    committed.action === "commit" && committed.result.entries[0].details?.fire === "4",
    "t24: planCommit stamps the commit",
  );
  const failed = planCommit({
    outcome: { ok: false, reason: "advisor stopped with error" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(4, 12),
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t24: a failure notifies in the exact format, stamp or no stamp",
  );
}

// --- 25. FR4 read-only tools: the pure path bound, the sandbox I/O, the loop, and
//         the shared deadline.
{
  // planRead: the pure prefix bound. Cases ride join()/resolve() so they hold on
  // win32 and POSIX alike; planRead does no fs, so no fixture files are needed.
  const root = join(tmpRoot, "sandbox-plan-root");
  assert(planRead(root, "src/a.ts").action === "allow", "t25: a project-relative path is allowed");
  assert(
    planRead(root, join(root, "src", "a.ts")).action === "allow",
    "t25: an absolute path inside the root is allowed",
  );
  const parentEscape = planRead(root, join("..", "evil.ts"));
  assert(
    parentEscape.action === "refuse" &&
      parentEscape.reason.includes("outside the project directory"),
    "t25: a parent escape is refused with the pinned wording",
  );
  assert(
    planRead(root, join(root, "..", "evil.ts")).action === "refuse",
    "t25: an in-root-relative escape sequence is refused",
  );
  assert(
    planRead(root, join(tmpdir(), "elsewhere", "x.ts")).action === "refuse",
    "t25: an absolute path outside the root is refused",
  );
  assert(planRead(root, "").action === "refuse", "t25: an empty path is refused");
  assert(planRead(root, undefined).action === "refuse", "t25: a missing path is refused");
  assert(planRead(root, 42).action === "refuse", "t25: a non-string path is refused");
}

{
  // The real sandbox over real files in tmpRoot: the happy path and the shape
  // refusals node itself produces. The escape and read-error shapes ride stub fs
  // in the next block, so this block stays platform-stable.
  const root = join(tmpRoot, "sandbox-live");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "note.txt"), "hello advice");
  const sandbox = createSandbox(root);
  const okRead = sandbox("read_file", { path: "note.txt" });
  assert(okRead.ok && okRead.text === "hello advice", "t25: a real read returns the file text");
  const wrongName = sandbox("write_file", { path: "note.txt" });
  assert(
    !wrongName.ok && wrongName.reason === sandboxRefusalFor("write_file"),
    "t25: a non-allowlisted name is refused with the pinned string",
  );
  const outside = sandbox("read_file", { path: join("..", "config-under-test.json") });
  assert(
    !outside.ok && outside.reason.includes("outside the project directory"),
    "t25: the sandbox refuses a parent escape",
  );
  const missing = sandbox("read_file", { path: "nope.txt" });
  assert(!missing.ok && missing.reason.includes("no such file"), "t25: a missing file refuses");
  const dirRead = sandbox("read_file", { path: "." });
  assert(!dirRead.ok && dirRead.reason.includes("not a file"), "t25: a directory read refuses");
  const capped = createSandbox(root, 4);
  const overCap = capped("read_file", { path: "note.txt" });
  assert(
    !overCap.ok && overCap.reason.includes("byte cap"),
    "t25: an over-cap read refuses with the byte-cap wording",
  );
  assert(createSandbox(root)("read_file", null).ok === false, "t25: null args refuse");
  assert(createSandbox(root)("read_file", {}).ok === false, "t25: path-less args refuse");
  assert(
    createSandbox(root)("read_file", { path: 42 }).ok === false,
    "t25: a numeric path refuses",
  );
}

{
  // The FsLike seam: a stub realpath escaping the root and a stub read throwing
  // are pinned deterministically — no real symlinks, no platform guards.
  const root = join(tmpRoot, "sandbox-stub");
  const escapeFs = {
    readFileSync: () => Buffer.alloc(0),
    realpathSync: () => join(tmpdir(), "outside", "secret.txt"),
  };
  const escaped = createSandbox(
    root,
    SANDBOX_MAX_BYTES,
    escapeFs,
  )("read_file", {
    path: "note.txt",
  });
  assert(
    !escaped.ok && escaped.reason.includes("outside the project directory"),
    "t25: a realpath escaping the root is refused (stub fs)",
  );
  const boomFs = {
    readFileSync: () => {
      const err = new Error("disk gone");
      err.code = "EACCES";
      throw err;
    },
    realpathSync: (p) => p,
  };
  const denied = createSandbox(root, SANDBOX_MAX_BYTES, boomFs)("read_file", { path: "note.txt" });
  assert(
    !denied.ok && denied.reason.includes("disk gone"),
    "t25: a read error surfaces through the injected fs with its message",
  );
}

{
  // The loop: a toolUse round is consumed, the result replays, the terminal stop commits.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.ts" } },
            ],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "final guidance" }],
        });
      },
    },
  };
  const executed = [];
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: (name, args) => {
      executed.push([name, args]);
      return { ok: true, text: "file body" };
    },
    maxToolRounds: 3,
  });
  assert(
    outcome.ok && outcome.text === "final guidance",
    "t25: the loop resolves to the final text",
  );
  assert(calls === 2, "t25: a consumed toolUse costs exactly one extra call");
  assert(
    executed.length === 1 && executed[0][0] === "read_file" && executed[0][1].path === "a.ts",
    "t25: the executor receives the call name and arguments",
  );
  assert(secondContext !== null, "t25: the second call carries the replayed conversation");
  assert(secondContext.messages.length === 3, "t25: the replay appends assistant + toolResult");
  assert(secondContext.messages[1].role === "assistant", "t25: the assistant turn is replayed");
  const result = secondContext.messages[2];
  assert(
    result.role === "toolResult" &&
      result.toolCallId === "c1" &&
      result.isError === false &&
      result.content[0].text === "file body",
    "t25: a successful execution replays as a non-error toolResult",
  );
  assert(
    secondContext.tools.length === 1 && secondContext.tools[0].name === "read_file",
    "t25: the declared tool rides every round's request",
  );
}

{
  // A refusal replays as isError and the advisor still gets its turn.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c2", name: "write_file", arguments: { path: "x" } }],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "adapted guidance" }],
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
    tools: [READ_FILE_TOOL],
    executeTool: (name) => ({ ok: false, reason: sandboxRefusalFor(name) }),
    maxToolRounds: 3,
  });
  assert(
    outcome.ok && outcome.text === "adapted guidance",
    "t25: a refusal does not fail the fire",
  );
  // This block starts from an empty context, so the replay is [assistant, toolResult]
  // and the toolResult is the LAST message (the seeded block above pins index 2).
  const replayed = secondContext.messages.at(-1);
  assert(
    replayed.isError === true && replayed.content[0].text === sandboxRefusalFor("write_file"),
    "t25: a refusal replays as an errored toolResult carrying the pinned reason",
  );
}

{
  // The rounds cap: a tool-happy advisor hits the terminal gate with the SAME
  // pinned reason the single-call path always produced, after exactly
  // maxRounds + 1 calls and no grace call.
  let calls = 0;
  const toolUse = () => {
    calls += 1;
    return Promise.resolve({
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: `c${calls}`, name: "read_file", arguments: {} }],
    });
  };
  const capped = await runAdvisor({
    registry: { runtime: { completeSimple: toolUse } },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 1,
  });
  assert(
    !capped.ok && capped.reason === "advisor stopped with toolUse",
    "t25: an exhausted round budget rejects with the pinned toolUse reason",
  );
  assert(calls === 2, "t25: maxToolRounds 1 spends exactly one loop round");
  calls = 0;
  const defaulted = await runAdvisor({
    registry: { runtime: { completeSimple: toolUse } },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
  });
  assert(
    !defaulted.ok && defaulted.reason === "advisor stopped with toolUse",
    "t25: the default cap rejects too",
  );
  assert(calls === 4, "t25: the omitted maxToolRounds defaults to 3 rounds (config parity)");
}

{
  // Unarmed runAdvisor with a toolUse response keeps the single-call rejection —
  // the t16 pin re-run through the new gate order.
  let calls = 0;
  const outcome = await runAdvisor({
    registry: {
      runtime: {
        completeSimple: () => {
          calls += 1;
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c", name: "read_file", arguments: {} }],
          });
        },
      },
    },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(
    !outcome.ok && outcome.reason === "advisor stopped with toolUse",
    "t25: an unarmed call still rejects a toolUse outright",
  );
  assert(calls === 1, "t25: an unarmed toolUse never loops");
}

{
  // Integration: the REAL sandbox refuses through the loop, by name, with the pinned string.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c3", name: "write_file", arguments: { path: "x" } }],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "guidance after refusal" }],
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
    tools: [READ_FILE_TOOL],
    executeTool: createSandbox(tmpRoot),
    maxToolRounds: 3,
  });
  assert(outcome.ok, "t25: a refused non-allowlisted call still lands guidance");
  // Empty start like the refusal block above: the toolResult is the last replayed message.
  const replayedRefusal = secondContext.messages.at(-1);
  assert(
    replayedRefusal.content[0].text === sandboxRefusalFor("write_file"),
    "t25: the real sandbox's refusal text reaches the advisor verbatim",
  );
}

{
  // The shared deadline: a fast toolUse round then a hung round dies at the
  // ORIGINAL budget, not budget-plus-round.
  const keep = setInterval(() => {}, 500);
  let calls = 0;
  const registry = {
    runtime: {
      completeSimple: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c", name: "read_file", arguments: { path: "a" } }],
          });
        }
        return new Promise(() => {});
      },
    },
  };
  const t0 = Date.now();
  const hung = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: MIN_TIMEOUT_MS,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 3,
  });
  const dt = Date.now() - t0;
  clearInterval(keep);
  assert(
    !hung.ok && /timed out/.test(hung.reason),
    "t25: a hung second round fails open at the deadline",
  );
  assert(
    dt >= MIN_TIMEOUT_MS - 50 && dt < MIN_TIMEOUT_MS + 2000,
    `t25: the shared deadline fires on time for a ${MIN_TIMEOUT_MS}ms budget`,
  );
}

{
  // F023 strip discipline (Step 4 coverage fix; design follow-up: the design's
  // Verification Note 4 demands the byte-identity guard discipline for every new
  // refusal vocabulary, and t25 pins none of it): the sandbox refusal strings
  // pass stripAdvisorMarkup byte-identical, so no strip tier can ever rewrite one.
  for (const name of ["read_file", "write_file", "consult_specialist"]) {
    const refusal = sandboxRefusalFor(name);
    assert(
      stripAdvisorMarkup(refusal) === refusal,
      "t25: the allowlist refusal survives the strip byte-identical",
    );
  }
  const pathProbe = planRead(join(tmpRoot), join("..", "x.ts"));
  const pathRefusal = pathProbe.action === "refuse" ? pathProbe.reason : "";
  assert(
    pathRefusal.length > 0 && stripAdvisorMarkup(pathRefusal) === pathRefusal,
    "t25: the outside-project refusal survives the strip byte-identical",
  );
}

// --- 25c. the toolsEnabled and maxToolRounds fields ride the same clamp/narrowing
//          doors (extends t5/t7/t21c/t22c/t23c).
{
  const clamped = withConfig(JSON.stringify({ maxToolRounds: 0 }), () => loadConfig());
  assert(
    clamped.maxToolRounds === MIN_TOOL_ROUNDS,
    "t25c: a zero maxToolRounds clamps up to the minimum",
  );
  const high = withConfig(JSON.stringify({ maxToolRounds: 999 }), () => loadConfig());
  assert(
    high.maxToolRounds === MAX_TOOL_ROUNDS,
    "t25c: an over-max maxToolRounds clamps down to the maximum",
  );
  const wrong = withConfig(
    JSON.stringify({ toolsEnabled: "yes", maxToolRounds: "three", interval: 5 }),
    () => loadConfig(),
  );
  assert(
    wrong.toolsEnabled === DEFAULT_CONFIG.toolsEnabled &&
      wrong.maxToolRounds === DEFAULT_CONFIG.maxToolRounds &&
      wrong.interval === 5,
    "t25c: wrong-typed tool fields fall back, leaving neighbors intact",
  );
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ maxToolRounds: "three" }), () => loadConfig()),
  );
  assert(silent.length === 0, "t25c: a wrong-typed maxToolRounds never reaches the clamp");
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"maxToolRounds": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.maxToolRounds === MIN_TOOL_ROUNDS && cfg.interval === 1,
        "t25c: an infinite maxToolRounds clamps up next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t25c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.toolsEnabled === false, "t25c: the code default is tools OFF");
  assert(DEFAULT_CONFIG.maxToolRounds === 3, "t25c: the code default is 3 rounds");
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

// --- 27. FR8 async fire: the settle core — abstain, the two notify arms, the
//         once-only commit shape, and the never-wake pin.
{
  // Abstain first: an empty slot decides nothing.
  const quiet = planSettle({
    held: undefined,
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(1, 0),
  });
  assert(quiet.action === "abstain", "t27: an empty slot abstains");
  // Commit: peers spread first, the draft rides last, the stamp carries the
  // FIRE-TIME turn index, and the result carries NO continue key — the settle
  // path never wakes an idle agent (FR8).
  const peers = [{ type: "custom", customType: "peer-a" }];
  const settle = planSettle({
    held: { outcome: { ok: true, text: "async advice" }, turnIndex: 7 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: peers,
    strip: (text) => text,
    details: stampDetails(2, 7),
  });
  assert(settle.action === "commit", "t27: held advice commits");
  assert(
    settle.result.entries.length === 2 && settle.result.entries[0].customType === "peer-a",
    "t27: the settle commit keeps the settle event's peer spread",
  );
  const draft = settle.result.entries[1];
  assert(
    draft.type === "custom_message" &&
      draft.content === "async advice" &&
      draft.details?.fire === "2" &&
      draft.details?.turn === "7",
    "t27: the draft rides the stamp with the fire-time turn index",
  );
  assert(
    !("continue" in settle.result),
    "t27: the settle result carries NO continue key (never wakes an idle agent)",
  );
  const blocking = buildCorrection(
    "advisor-turn-gate",
    "async advice",
    true,
    peers,
    stampDetails(2, 7),
  );
  assert(
    JSON.stringify(draft) === JSON.stringify(blocking.entries[1]),
    "t27: the settle draft is byte-equal to the blocking draft",
  );
}
{
  // The strip thunk runs on the held text before the commit.
  const marked = planSettle({
    held: { outcome: { ok: true, text: "advice" }, turnIndex: 1 },
    customType: "ct",
    display: true,
    peerEntries: [],
    strip: (text) => `<${text}>`,
    details: stampDetails(1, 1),
  });
  assert(
    marked.action === "commit" && marked.result.entries[0].content === "<advice>",
    "t27: the strip runs on the held text",
  );
}
{
  // The failure arm notifies in the exact reportFailure format.
  const failed = planSettle({
    held: { outcome: { ok: false, reason: "advisor stopped with error" }, turnIndex: 3 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(1, 3),
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t27: a failed held call notifies in the exact format",
  );
  // The husk arm: markup-only advice fails open exactly like the blocking path
  // (the real strip's husk behavior is pinned at t15b/t9; a thunk isolates this arm).
  const husk = planSettle({
    held: { outcome: { ok: true, text: "markup husk" }, turnIndex: 4 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: () => "",
    details: stampDetails(1, 4),
  });
  assert(
    husk.action === "notify" && husk.message === "advisor-turn-gate: advisor reply was markup only",
    "t27: a markup-only held reply notifies the husk message",
  );
}

// --- 27c. the asyncMode field rides the same narrowing doors (extends
//          t5/t7/t21c/t22c/t23c/t25c/t26c).
{
  const wrong = withConfig(JSON.stringify({ asyncMode: "yes", interval: 7 }), () => loadConfig());
  assert(
    wrong.asyncMode === false && wrong.interval === 7,
    "t27c: a wrong-typed asyncMode falls back, leaving neighbors intact",
  );
  const on = withConfig(JSON.stringify({ asyncMode: true }), () => loadConfig());
  assert(on.asyncMode === true, "t27c: asyncMode true survives");
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ asyncMode: 1 }), () => loadConfig()),
  );
  assert(silent.length === 0, "t27c: a wrong-typed asyncMode never warns");
  assert(DEFAULT_CONFIG.asyncMode === false, "t27c: the code default is blocking (async off)");
}
