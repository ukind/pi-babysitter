// tests/suites/triggers.mjs — F030 suite: banners 21 and 21c of the former
// monolith — trigger arms, planGate integration, and the trigger fields.
// (Pre-F036 state: banner 21d and the starvedTriggerWarn import arrive at Phase 9.)

import { loadConfig } from "../../config.ts";
import { planGate, planHostSupport } from "../../plan-turn.ts";
import { parseRiskyTools, planTrigger, triggersArmed } from "../../triggers.ts";
import { assert, captureWarn, gateArgs, withConfig } from "../helpers.mjs";

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
