// tests/suites/config.mjs — F030 suite: banners 1b through 8 of the former
// tests/test.mjs monolith — cadence folding and the config load/clamp doors.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
} from "../../config.ts";
import { planGate } from "../../plan-turn.ts";
import { assert, captureWarn, realHref, tmpRoot, withConfig } from "../helpers.mjs";

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
