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
 *     index.ts at all, so this suite imports the six sibling modules directly.
 *   - the real advisor call. Every advisor test stubs the completion facade.
 *
 * config.ts, guard.ts, prompt.ts, advisor.ts, report.ts, and plan-turn.ts import no
 * sibling at runtime, so this file resolves nothing from @earendil-works/* — a
 * MODULE_NOT_FOUND here means a runtime import leaked into one of them.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  parseModelKey,
  resetWarnOnceForTest,
  shouldFire,
  shouldGate,
} from "../config.ts";
import { CHILD_MARKER_PATTERN, isChildSession } from "../guard.ts";
import { buildCorrection, planCommit, planGate } from "../plan-turn.ts";
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

const Q = String.fromCharCode(34);
const marker = (name) => `<active_agent name=${Q}${name}${Q}/>`;

// --- 1. cadence: the modulo form gates once per interval; the STATELESS threshold form
//        latches. Runs first because it is pure arithmetic with no module-level latch.
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
  // The rejected alternative, asserted so a refactor cannot silently adopt it. The
  // anti-latch argument covers only this STATELESS form: F007's shouldFire is the
  // stateful form, which cannot latch because lastFiredTurn advances on every fire
  // (t1b pins that parity and the slide).
  const latched = seq.filter((i) => i >= 2);
  assert(
    latched.length === 6,
    "t1: the stateless threshold form would latch to 6 calls, which is why it is rejected",
  );
}

// --- 1b. the stateful threshold (F007): shouldFire folds to shouldGate's exact sets,
//         slides past an errored boundary, and cannot latch.
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
  assert(fold(seq, 2).join(",") === "1,3,5,7", "t1b: interval 2 folds to t1's exact set");
  assert(fold(seq, 3).join(",") === "2,5", "t1b: interval 3 folds to t1's exact set");
  assert(fold(seq, 1).join(",") === "0,1,2,3,4,5,6,7", "t1b: interval 1 folds to every turn");
  assert(!shouldFire(0, 0, -1), "t1b: interval 0 never fires");
  assert(!shouldFire(0, -1, -1), "t1b: a negative interval never fires");
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
//        no thunk at all — and the notify arms must carry the exact reportFailure
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
// The real cadence predicate rides the seam: t1's interval sets, replayed through
// the core against shouldFire, so a seam that drops or inverts turnIndex or
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
