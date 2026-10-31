---
date: 2026-10-30T09:11:32+0700
author: Yogiswara Utama
commit: 829c948
branch: main
repository: advisor-turn-gate
topic: "F001-F020 tech-debt fix series (commits A-J)"
tags: [plan, tech-debt, commit-series, advisor-turn-gate]
status: ready
parent: ".rpiv/artifacts/designs/2026-10-29_13-41-09_tech-debt-series-slices.md"
phase_count: 10
phases:
  - { n: 1, title: "config.json de-personalization (A — F005+F015)", files: ["config.json", "tests/test.mjs"], depends_on: [] }
  - { n: 2, title: "config group (B — F002+F014+F016)", files: ["config.ts", "tests/test.mjs", "AGENTS.md", ".agents/rules/main.md"], depends_on: [1] }
  - { n: 3, title: "deadline hole (C — F001+F008 comment)", files: ["advisor.ts", "tests/test.mjs"], depends_on: [2] }
  - { n: 4, title: "probe deletion (D — F003/F004)", files: ["guard.ts", "index.ts", "tests/test.mjs", "AGENTS.md", ".agents/rules/main.md"], depends_on: [3] }
  - { n: 5, title: "plan-turn extraction (E — F006)", files: ["plan-turn.ts", "index.ts", "tests/test.mjs", "AGENTS.md", ".agents/rules/main.md"], depends_on: [4] }
  - { n: 6, title: "cadence slide (F — F007)", files: ["config.ts", "plan-turn.ts", "index.ts", "tests/test.mjs"], depends_on: [5] }
  - { n: 7, title: "refspec hole + shared parser (G — F009+F017)", files: ["scripts/hooks/lib.mjs", "scripts/hooks/gate.mjs", "scripts/hooks/feedback.mjs", "tests/test.mjs", "AGENTS.md"], depends_on: [6] }
  - { n: 8, title: "timeout reporting (H — F018)", files: ["scripts/hooks/lib.mjs", "scripts/hooks/feedback.mjs", "tests/test.mjs"], depends_on: [7] }
  - { n: 9, title: "CI/tooling (I — F012+F013)", files: ["package.json", ".npmrc", ".github/workflows/ci.yml", "scripts/hooks/gate.mjs", "scripts/hooks/feedback.mjs"], depends_on: [8] }
  - { n: 10, title: "prose docs pass (J — F010/F011/F019)", files: ["README.md", "AGENTS.md", ".agents/rules/main.md", ".agents/skills/advisor-turn-gate/SKILL.md", "TECH_DEBT_AUDIT.md"], depends_on: [9] }
last_updated: 2026-10-30T09:11:32+0700
last_updated_by: Yogiswara Utama
last_updated_note: "Step 5 triage: all 5 code-review findings applied (blocker re-wrap plan-local; main.md:26 twin hunk; interval 3; captureWarn wrap; lib.mjs twin line + criterion 3). Coverage review: full coverage."
---

# F001-F020 tech-debt fix series (commits A-J) Implementation Plan

## Overview

Ten serial phases fix the 20 verified findings F001-F020 at HEAD 829c948 as commits A-J. Each phase is one vertical slice — production change, test change, and doc change together — landing as one gate-green commit. Phase boundaries inherit 1:1 from the design's Slices section (slice boundaries equal commit boundaries); Success Criteria pass through unchanged. Nothing runs in parallel; worktrees are explicitly rejected by the upstream shape. One session, serial, stop-and-handoff only if fidelity degrades.

## Desired End State

A cloner runs `npm install && npm test` green on Node 22.6 or 24. The gate is disabled until they set `model` in config.json (ship-empty); README's table documents all seven fields. `git push origin +main` is blocked by the gate hook with the reason "forced push to a protected branch". The suite imports plan-turn.ts directly under plain node; its zero-sibling-import invariant comment names every sibling including report.ts. TECH_DEBT_AUDIT.md is tracked, formatted, and its quick-win boxes stamped. CI runs the quoted matrix on 22.6.0 and 24 with npm ci.

## What We're NOT Doing

- Handoff notes (the escalation rule only fires on observed fidelity decay).
- Timer-unref / fire-and-forget turn_end redesign (deferred decision stands; blocking call stays).
- .claude/settings.json user-scoped migration (recorded no-fix).
- Any change to shouldGate, the t1 pin, or the raw "node --experimental-strip-types test.mjs" script form (package.json:9, tests/test.mjs:3).
- F020 local action (undici advisory is dev-only; caret + npm ci + lockfile discipline is the accepted posture).

## Phase 1: config.json de-personalization (A — F005+F015)

Lands as commit A. Ships the gate de-personalized: config.json carries neither the systemPrompt duplicate nor a personal model — model: '' (empty) disables the gate until the cloner opts in (the ship-empty decision; the gap fix that makes Phase 10's README wording true). The test band t7b shrinks to the code default and the header stops citing the uncommitted plan path.

### Changes Required:

#### 1. config.json

Full new content. Behavior is bit-identical via the config.ts defaults and the :145-148 fallback — except model, now empty.

````
Drops the shipped systemPrompt duplicate and the personal model default; the code defaults (config.ts:23-39) and the :145-148 fallback make behavior identical for every field except model (now empty: gate disabled by default). Filled by Slice 1.

```json
{
  "enabled": true,
  "interval": 3,
  "model": "",
  "timeoutMs": 60000,
  "customType": "advisor-turn-gate",
  "display": true
}
```
````

#### 2. tests/test.mjs

Slice 1 hunks H1-H3: header reword (F015), readFileSync import shrink, t7b shrink (F005). Apply in order; anchor by banner and neighbor text, never by line number.

````
Heaviest file: 8 of 10 slices touch it. Hunks accumulate here per slice, keyed by test banner. Invariant comment (:22-24) gains plan-turn.ts and repairs the report.ts omission in Slice 5.

```
Slice 1 hunks (apply in order; anchor by banner and neighbor text, never by line number).

H1 — header reword (F015). In the file header comment, replace:
    * Covers the offline-checkable Verification Notes in
    * .rpiv/artifacts/plans/2026-10-27_21-34-09_advisor-turn-gate-extension.md:
with:
    * Covers the offline-checkable Verification Notes of the original extension plan
    * (the plan artifact is not committed; the path stays as a historical label only):

H2 — import shrink (F005 knock-on). Replace:
    import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
with:
    import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

H3 — t7b shrink (F005). Replace the whole t7b block:
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
with:
    // --- 7b. the no-tools instruction rides the code default, and the display default is true.
    //         Stable marker substrings only — never full-string equality, so a wording
    //         tweak does not fail the band. The shipped systemPrompt copy was removed
    //         (F005): the config.ts fallback makes the behavior bit-identical, and no
    //         shipped model exists to band against (the ship-empty decision).
    {
      assert(/no tools/.test(DEFAULT_CONFIG.systemPrompt), "t7b: the code default forbids tools");
      assert(/text only/.test(DEFAULT_CONFIG.systemPrompt), "t7b: the code default demands text only");
      assert(DEFAULT_CONFIG.display === true, "t7b: the display code default is true");
    }
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope, per user decision on the untracked .rpiv artifact failures), `npm run typecheck` all pass
- [x] t7b passes without any config.json read: `grep -n "readFileSync" tests/test.mjs` returns no hits
- [x] config.json ships neither prompt nor personal model: no `systemPrompt` key; `"model": ""`
- [x] Header marks the plan citation historical: `grep -n "the plan artifact is not committed" tests/test.mjs` matches
- [x] No other repo file depends on the shipped systemPrompt or a non-empty shipped model (grep `config.json` across *.ts, tests/, scripts/, .github/, *.md — only loadConfig consumes it)
- [x] t1 cadence pin and shouldGate untouched: the diff shows no change outside the three hunks (plus the user-approved t7b brace unwrap)

#### Manual Verification:
- [x] `config.ts:145-148` fallback confirmed intact, so prompt behavior is bit-identical
- [x] Accepted consequence: the maintainer local gate is disabled until `model` is set again

---

## Phase 2: config group (B — F002+F014+F016)

Lands as commit B. The config group. The warn-once latch becomes resettable so tests carry no ordering constraint (F002), clamps and truncations warn once through the shared latch with the timeoutMs-default crux observable (F014), and modelKey dies (F016). t3-t6 restructure around withConfig re-arming the latch.

### Changes Required:

#### 1. config.ts

C1-C4: resetWarnOnceForTest export, clampWithWarn helper, the two loadConfig call-site swaps, modelKey deletion.

````
Slice 2: resetWarnOnceForTest export, clampWithWarn sites, modelKey deletion. Slice 6: shouldFire beside shouldGate (:101-105 stays verbatim).

```
Slice 2 hunks (anchors are verbatim 829c948 text; Slice 6 appends beside shouldGate later):

C1 — resetWarnOnceForTest export (F002). Insert directly after the warnOnce body:
    /**
     * Re-arm the warn-once latch. Test-only surface: the suite's withConfig() calls this at
     * entry, so every fixture window starts fresh and the config tests carry no ordering
     * constraint. Production never re-arms a warning: one notice per process is the contract.
     */
    export function resetWarnOnceForTest(): void {
      configWarned = false;
    }

C2 — clampWithWarn (F014). Insert directly after the clampInt body:
    /**
     * Clamp a config field and warn once when the value moved.
     *
     * Range clamping (9999 -> 100) and truncation (2.7 -> 2) arrive through the same door,
     * so the wording names both. The shared latch caps a multi-field read at one warning.
     * The warning is load-bearing even when the clamped value equals the default: the
     * default timeoutMs equals MAX_TIMEOUT_MS, so for that field the warning is the only
     * observable difference between "field absent" and "field clamped to the default".
     */
    function clampWithWarn(fieldName: string, value: number, min: number, max: number): number {
      const clamped = clampInt(value, min, max);
      if (clamped !== value) {
        warnOnce(
          `[advisor-turn-gate] config.json ${fieldName} ${value} was clamped or truncated to ${clamped} (allowed ${min} to ${max})`,
        );
      }
      return clamped;
    }

C3 — loadConfig call-site swap (F014). In the return object, replace:
        interval:
          typeof parsed.interval === "number"
            ? clampInt(parsed.interval, MIN_INTERVAL, MAX_INTERVAL)
            : DEFAULT_CONFIG.interval,
and:
        timeoutMs:
          typeof parsed.timeoutMs === "number"
            ? clampInt(parsed.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
            : DEFAULT_CONFIG.timeoutMs,
with (wrong-typed branches untouched):
        interval:
          typeof parsed.interval === "number"
            ? clampWithWarn("interval", parsed.interval, MIN_INTERVAL, MAX_INTERVAL)
            : DEFAULT_CONFIG.interval,
and:
        timeoutMs:
          typeof parsed.timeoutMs === "number"
            ? clampWithWarn("timeoutMs", parsed.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
            : DEFAULT_CONFIG.timeoutMs,

C4 — modelKey deletion (F016). Delete:
    /** Compose the canonical "provider/modelId" string. */
    export function modelKey(model: { provider: string; id: string }): string {
      return `${model.provider}/${model.id}`;
    }

Slice 6 hunk (the shouldGate region is untouched by the Slice 2 hunks above):
````

#### 2. tests/test.mjs

Slice 2 hunks S2-H1..S2-H9 (import block, withConfig re-arm, t2 comments, t3 one-window restructure, t4 flip, t4b, t5 F014 battery, t6 merge, t8 banner reword + modelKey assert deletion).

````
Slice 2 hunks (apply after Slice 1's; anchors are verbatim 829c948 text in regions Slice 1 does not touch).

S2-H1 — import block (F002 + F016). Replace:
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
with:
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
      shouldGate,
    } from "../config.ts";

S2-H2 — withConfig re-arms the latch at entry (F002). Replace:
    const realHref = CONFIG_URL.href;
    function withConfig(text, fn) {
      const file = join(tmpRoot, "config-under-test.json");
with:
    const realHref = CONFIG_URL.href;
    function withConfig(text, fn) {
      // F002: re-arm the warn-once latch so every fixture window starts fresh and the
      // config tests carry no cross-test ordering constraint.
      resetWarnOnceForTest();
      const file = join(tmpRoot, "config-under-test.json");

S2-H3 — t2 ordering comments deleted (F002). Replace:
    // --- 2. missing config file: silent, defaults. Runs BEFORE t3 because configWarned is a
    //        module-level latch — a warn here would make t3 vacuous.
with:
    // --- 2. missing config file: silent, defaults. The ENOENT path never reaches the
    //        warn-once latch, so no ordering constraint applies (F002).
and delete the comment block (leaving the two statements below it in place):
    // Deliberately NO second loadConfig() here. configWarned is a module-level latch with no
    // reset, so an unguarded call against a broken shipped config.json would latch it and
    // make t3, t4, and t6 vacuous. The defaults path is covered by t3 and t5 instead.

S2-H4 — t3 restructures into one withConfig window (F002). Replace the whole t3 block:
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
with:
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

S2-H5 — t4 flips from 0 to 1 (F002). Replace the whole t4 block:
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
with:
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

S2-H6 — new t4b block (F002). Insert between t4's last assert and the t5 banner:
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

S2-H7 — t5 becomes the F014 battery. Replace the whole t5 block:
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
with:
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
        assert(
          infinite.interval === MIN_INTERVAL,
          "t5: an infinite interval clamps to the minimum",
        );
      });
      assert(
        infiniteWarns.length === 1,
        "t5: an infinite interval warns like a clamp",
      );
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

S2-H8 — t6 flips from 0 to 1, merged into one window (F002). Replace the whole t6 block:
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
with:
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

S2-H9 — t8 banner reword + modelKey assert deletion (F016). Replace:
    // --- 8. the model-key codec: slash wins, colon is legacy, neither is undefined.
with:
    // --- 8. the model-key parser: slash wins, colon is legacy, neither is undefined.
and delete exactly this line (the parseModelKey asserts around it stay):
    assert(modelKey({ provider: "a", id: "b" }) === "a/b", "t8: modelKey composes the canonical form");
````

#### 3. AGENTS.md

A1: codec wording becomes the model-key parser.

````
A1 — codec wording (F016). In the Files list, replace:
    - `config.ts` — every tunable field, clamping, and the model-key codec.
with:
    - `config.ts` — every tunable field, clamping, and the model-key parser.
````

#### 4. .agents/rules/main.md

Plan-level amendment (design follow-up; no design hunk owns this twin line): the twin of A1.

````
A1-twin — the main.md mirror of A1 (F016). Replace:
    - `config.ts` — every tunable field, clamping, and the model-key codec.
with:
    - `config.ts` — every tunable field, clamping, and the model-key parser.
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] t4 flips to 1: `grep -n "a JSON array warns once in a fresh window" tests/test.mjs` matches
- [x] t6 flips to 1: `grep -n "two reads in one window" tests/test.mjs` matches (plus t3's reworded message)
- [x] t3 asserts one warn with both reads inside one withConfig window
- [x] t4b proves the reset export: reset → 1 warn, no reset → 0, reset → 1
- [x] t5 asserts clamp warns (1 per window), truncation warns, the timeoutMs-default crux, Infinity → MIN_INTERVAL, and wrong-type silence (S2-H7's Infinity/wrong-type asserts re-wrapped to biome's single-line form, matching the Phase 1 formatting decision)
- [x] modelKey fully deleted: `grep -n "modelKey" config.ts tests/test.mjs | grep -v parseModelKey` returns nothing
- [x] Ordering comments gone: `grep -n "Runs BEFORE t3" tests/test.mjs` and `grep -n "Deliberately NO second" tests/test.mjs` return nothing
- [x] t1 and shouldGate untouched (no diff hunks touch them)

#### Manual Verification:
- [x] The clamp warn fires for timeoutMs 9999999 even though the clamped value equals the shipped default (the F014 crux)
- [x] A wrong-typed interval field produces no console warn

---

## Phase 3: deadline hole (C — F001+F008 comment)

Lands as commit C. The deadline hole. The pending assignment and its .catch move inside callWithDeadline's try so a synchronously throwing call cannot leak the deliberately-not-unref'd timer (F001); a facade-guard position comment pins the fail-fast precondition outside the future try (F008). The new t16b test is RED-FIRST: land it, watch it fail against the unfixed advisor.ts, then apply AD1.

### Changes Required:

#### 1. advisor.ts

AD1 (pending+catch into the try — makes the existing doc comment's claim true) and AD2 (facade-guard position comment).

````
Slice 3 only: the pending assignment and .catch move inside the try (:235-237 region); one comment pins the facade guard (:286-289) outside the future try.

```
Slice 3 hunks (anchors are verbatim 829c948 text; extent-exact — each anchor spans the full replaced region):

AD1 — pending+catch into the try (F001). Replace the whole block (:233-242), extent-exact:
      // The losing branch must not produce an unhandled rejection: a call that fails after
      // the deadline already won would otherwise crash the process.
      const pending = call(controller.signal);
      pending.catch(() => {});
      try {
        return await Promise.race([pending, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
      }
with:
      try {
        // The pending assignment sits INSIDE the try: a call implementation that throws
        // synchronously must reach the finally below, or the deliberately-not-unref'd timer
        // stays alive and rejects at +timeoutMs with no handler — a process crash up to a
        // full budget after the throw (F001). A throwing call creates no pending, so there
        // is no second failure path: the throw propagates to runAdvisor's backstop and the
        // turn still fails open, now with the timer cleared on the way out.
        const pending = call(controller.signal);
        // The losing branch must not produce an unhandled rejection: a call that fails after
        // the deadline already won would otherwise crash the process.
        pending.catch(() => {});
        return await Promise.race([pending, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
      }
(The callWithDeadline doc comment above this code already claims the timer is "cleared in
`finally` on every path" — the research flagged that claim as falsified on the sync-throw
path today; this hunk makes it true. No doc edit needed.)

AD2 — facade-guard position comment (F008). Replace (:286-289), extent-exact:
      const completeSimple = getRuntimeCompleteSimple(params.registry);
      if (!completeSimple) {
        return { ok: false, reason: "no auth-aware completion facade on this host" };
      }
with:
      // This guard stays BEFORE the try: it is a fail-fast precondition, not a transport
      // failure for the deadline machinery to own. t16 pins the exact reason string, and the
      // host reports it only when a session has a UI (report.ts:30-37), so the guard's
      // position is load-bearing documentation: a refactor that pulls it inside the try
      // couples a missing facade to a catch widened for transport failures (F008).
      const completeSimple = getRuntimeCompleteSimple(params.registry);
      if (!completeSimple) {
        return { ok: false, reason: "no auth-aware completion facade on this host" };
      }
```
````

#### 2. tests/test.mjs

Slice 3 hunk S3-H1: the t16b block, inserted between t16's late-rejection guard and banner 17.

````
Slice 3 hunks (apply after Slice 2's; anchors are verbatim 829c948 text in regions Slices 1-2 do not touch — the t16 region is untouched by all locked hunks).

S3-H1 — new t16b block (F001). Insert between the t16 late-rejection guard's closing brace (after the assert "t16: a rejection after the deadline does not produce an unhandled rejection") and the banner line:
    // --- 17. callWithDeadline forwards an external abort and clears its timer.
with the block:
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
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] Both t16b asserts pass: `grep -n "t16b" tests/test.mjs` matches exactly the two assert messages, and `npm test` prints PASS for both
- [x] No banner renumbering: `grep -n "^// --- 1[789]\." tests/test.mjs` matches banners 17, 18, 19 in file order
- [x] Fix shape in place: in `advisor.ts`, `grep -n "const pending = call(controller.signal);" advisor.ts` shows the assignment inside the try whose finally clears the timer (read the hunk, not just the line)
- [x] Facade guard pinned: `grep -n "fail-fast precondition" advisor.ts` matches immediately above the `getRuntimeCompleteSimple` guard, and the guard remains before runAdvisor's try
- [x] Untouched regions: no diff hunk touches config.ts, guard.ts, index.ts, or any test banner outside the t16/t16b region

#### Manual Verification:
- [x] Red-first run observed during implement: with the test landed and advisor.ts still unfixed, `npm test` fails with exactly `FAIL: t16b: a synchronous throw leaks no timer and produces no unhandled rejection` and ends via the exit handler (`test.mjs: FAILURES`), not a mid-suite crash
- [x] Suite wall-clock stays near the ~1.5s baseline; the new block adds one bounded 250ms wait, well under the ~5s ceiling (npm test: 2.9s wall, dominated by t16's existing 1000ms deadline waits)

---

## Phase 4: probe deletion (D — F003/F004)

Lands as commit D. Probe deletion. guard.ts loses the ALS shim, probe type, loader, and logger; the rewritten header keeps SCOPE/IDENTITY as the rationale for having no probe. index.ts keeps only the marker veto. t12 and captureLog die; banner numbering stays stable. The docs twin line in .agents/rules/main.md is amended here (ratified at the Slice 4 checkpoint).

### Changes Required:

#### 1. guard.ts

S4-G1 (header rewrite) and S4-G2 (contiguous shim/probe/logger deletion; the veto exports stay byte-identical).

````
Slice 4 hunks (anchors are verbatim 829c948 text; no locked slice touches guard.ts).

S4-G1 — header rewrite: two mechanisms -> one mechanism, SCOPE/IDENTITY kept as the no-probe rationale. Replace the ENTIRE header doc comment (:1-34), extent-exact, with:

/**
 * guard.ts — subagent inertness for the advisor gate.
 *
 * One mechanism: `isChildSession` — the handler-time marker veto. AUTHORITATIVE.
 *
 * There is deliberately NO AsyncLocalStorage probe. Two independent reasons, either of
 * which alone is enough:
 *
 *   - SCOPE. `childSessionContext` is documented as marking "resource loading/session
 *     construction performed for a subagent"
 *     (npm/node_modules/@tintinweb/pi-subagents/src/child-context.ts:4-6).
 *     `runInChildSessionContext` wraps `createAgentSession` (src/agent-runner.ts:1106)
 *     and `loader.reload()` (src/agent-runner.ts:859), not the agent run. Whether a
 *     `turn_end` handler ever executes inside that scope is not determinable
 *     statically.
 *   - IDENTITY. `loadExtensionModule` builds a fresh jiti per extension with
 *     `moduleCache: false`
 *     (install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:480-483).
 *     The pi-subagents package declares `./src/index.ts` as its entry
 *     (npm/node_modules/@tintinweb/pi-subagents/package.json:62-64), so the runtime
 *     loads `src/child-context.ts` inside ITS jiti. This extension's jiti imports the
 *     same FILE but builds a second module object with a second `AsyncLocalStorage`,
 *     distinct from the one `src/agent-runner.ts:859` and `:1106` write. A probe
 *     imported here reads a storage nobody writes, so it reports `false` in every
 *     session, including a real child.
 *
 * The cost of a missed child is a billed advisor call and a committed entry in a session
 * that must stay inert, so the veto errs toward switching the gate off.
 *
 * This module imports nothing, so the offline test resolves no package at all.
 */

(The SCOPE bullet drops its old tail clause "which is why the probe is called per turn rather than cached as a factory-time constant" — dead text once the probe is gone. The IDENTITY bullet gains the closing sentence that turns the identity argument into the deletion rationale.)

S4-G2 — shim + probe type + loader + logger deleted (contiguous block). Replace, extent-exact, from the shim doc through the SystemMessageLike doc's first line:

/**
 * Relative shim to the subagents package's AsyncLocalStorage.
 *
 * A bare `@tintinweb/pi-subagents/src/child-context.js` does not resolve: there is no
 * node_modules on the walk-up from `extensions/`, and the jiti alias map at
 * loader.js:37-88 holds no `@tintinweb` entry. The shim depends on the `npm/` layout,
 * which is why every read of it is wrapped — a moved package degrades to
 * marker-veto-only rather than a load failure.
 */
const CHILD_CONTEXT_SHIM = "../../npm/node_modules/@tintinweb/pi-subagents/src/child-context.js";

/** A callable `inChildSessionContext`, or undefined when the shim did not load. */
export type ChildSessionProbe = () => boolean;

/**
 * Load the subagents AsyncLocalStorage reader through the relative shim.
 *
 * Returns undefined when the shim is missing, the package moved, or the module does not
 * export `inChildSessionContext`. Never throws.
 *
 * The returned function is called once per gated turn, not cached as a boolean: the ALS
 * scope is session construction, so a factory-time reading says nothing about the turn
 * the handler is judging.
 */
export async function loadChildSessionProbe(): Promise<ChildSessionProbe | undefined> {
  try {
    const mod = (await import(CHILD_CONTEXT_SHIM)) as { inChildSessionContext?: () => boolean };
    if (typeof mod.inChildSessionContext !== "function") return undefined;
    return mod.inChildSessionContext.bind(mod);
  } catch {
    return undefined;
  }
}

/**
 * Log the probe's reading at factory time.
 *
 * This is the assertion that answers the scope and identity questions at once: run pi
 * once in a main session and once inside a spawned subagent, then compare the two lines.
 * A reading of `false` inside the child means the ALS is not carrying the guard — which
 * the design already assumes — and the marker veto is doing the work alone.
 */
export function logProbeReading(probe: ChildSessionProbe | undefined): void {
  if (!probe) {
    console.warn(
      "[advisor-turn-gate] child-context shim unreachable; the marker veto is the only guard",
    );
    return;
  }
  let inChild = false;
  try {
    inChild = probe() === true;
  } catch {
    console.warn(
      "[advisor-turn-gate] child-context probe threw; the marker veto is the only guard",
    );
    return;
  }
  console.log(`[advisor-turn-gate] ALS inChildSessionContext=${inChild} at factory time`);
}

/** The slice of a system message the veto needs. Structural, so this module imports nothing. */

with:

/** The slice of a system message the veto needs. Structural, so this module imports nothing. */

(Net effect: the CHILD_MARKER_PATTERN block, SystemMessageLike, contentText, systemMessageText, and isChildSession stay byte-identical.)
```
````

#### 2. index.ts

S4-I1..S4-I3: guard import shrinks to the veto, factory-time probe load/log deleted, probe half of the veto deleted.

````
Slice 4 hunks (anchors are verbatim 829c948 text; no locked slice touches index.ts. Slice 5 and Slice 6 hunks accumulate below later).

S4-I1 — guard imports shrink. Replace, extent-exact:
import type { ChildSessionProbe } from "./guard";
import { isChildSession, loadChildSessionProbe, logProbeReading } from "./guard";
with:
import { isChildSession } from "./guard";

S4-I2 — factory-time probe load/log deleted (:43-45). Replace, extent-exact:
export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
  // Advisory only. See guard.ts for why this is not the guard.
  const probe: ChildSessionProbe | undefined = await loadChildSessionProbe();
  logProbeReading(probe);

  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
with:
export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {

S4-I3 — the probe half of the veto deleted (:60-61). Replace, extent-exact:
    // Advisory early-out, then the authoritative veto.
    if (probe?.()) return;
    if (isChildSession(event.context.llmMessages)) return;
with:
    // The authoritative veto.
    if (isChildSession(event.context.llmMessages)) return;

(Net effect: buildCorrection and the turn_end body are otherwise untouched — Slice 5 replaces the decision logic, not this slice.)
````

#### 3. tests/test.mjs

Slice 4 hunks S4-T1..S4-T5: covered-topics enumeration, Three-things to Two-things, guard import shrink, captureLog deletion, t12 deletion.

````
Slice 4 hunks (apply after Slice 3's; anchors are verbatim 829c948 text in regions no locked hunk touches).

S4-T1 — covered-topics enumeration drops the ALS. Replace, extent-exact:
 * cadence arithmetic, the accumulator spread, fail-open, the fact that completeSimple
 * never rejects, the ALS scope, the marker living in sections, marker drift, and model
 * resolution. Config clamping and prompt assembly are covered as well, but they are
with:
 * cadence arithmetic, the accumulator spread, fail-open, the fact that completeSimple
 * never rejects, the marker living in sections, marker drift, and model resolution.
 * Config clamping and prompt assembly are covered as well, but they are

S4-T2 — "Three things" -> "Two things", shim bullet deleted. Replace, extent-exact:
 * Three things are deliberately NOT asserted, because no offline assertion can
 * distinguish them:
 *   - whether pi's jiti resolves the extensionless sibling imports index.ts uses. The
 *     form is proven live by simple-english/index.ts:16, but plain node cannot load
 *     index.ts at all, so this suite imports the four sibling modules directly.
 *   - whether the child-context shim resolves under jiti. Under plain node the .js
 *     specifier has no .ts fallback, so loadChildSessionProbe() always returns undefined
 *     here. The runtime assertion is the pair of factory-time log lines.
 *   - the real advisor call. Every advisor test stubs the completion facade.
with:
 * Two things are deliberately NOT asserted, because no offline assertion can
 * distinguish them:
 *   - whether pi's jiti resolves the extensionless sibling imports index.ts uses. The
 *     form is proven live by simple-english/index.ts:16, but plain node cannot load
 *     index.ts at all, so this suite imports the four sibling modules directly.
 *   - the real advisor call. Every advisor test stubs the completion facade.

S4-T3 — guard import shrink. Replace, extent-exact:
import {
  CHILD_MARKER_PATTERN,
  isChildSession,
  loadChildSessionProbe,
  logProbeReading,
} from "../guard.ts";
with:
import { CHILD_MARKER_PATTERN, isChildSession } from "../guard.ts";

S4-T4 — captureLog helper deleted (its only caller is t12). Replace, extent-exact:
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
with:
const Q = String.fromCharCode(34);

S4-T5 — t12 block deleted, banner numbers stable (12 is not reused; 13 follows 11). Replace, extent-exact:
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
with:
// --- 13. model resolution: an uncredentialed provider is skipped, not thrown.
````

#### 4. AGENTS.md

A2: the Files line drops the ALS probe.

````
A2 — probe wording (F003/F004). In the Files list, replace:
    - `guard.ts` — child-session inertness (marker veto + ALS probe).
with:
    - `guard.ts` — child-session inertness (marker veto).
```
````

#### 5. .agents/rules/main.md

M1: the twin Files line drops the ALS probe.

````
Slice 4 hunk (anchor is verbatim 829c948 text; amendment ratified at the Slice 4 checkpoint):

M1 — probe wording (F003/F004). In the Files list, replace:
    - `guard.ts` — child-session inertness (marker veto + ALS probe).
with:
    - `guard.ts` — child-session inertness (marker veto).
```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] Probe symbols fully deleted: `grep -rn "loadChildSessionProbe\|logProbeReading\|ChildSessionProbe\|CHILD_CONTEXT_SHIM\|inChildSessionContext" guard.ts index.ts tests/ AGENTS.md` returns nothing
- [x] t12 gone, banners stable: `grep -n "^// --- 11\.\|^// --- 13\." tests/test.mjs` matches banners 11 and 13 in file order, and `grep -c "t12" tests/test.mjs` returns 0
- [x] captureLog deleted with its only caller: `grep -n "captureLog" tests/test.mjs` returns nothing
- [x] guard.ts keeps the veto exports: `grep -n "export const CHILD_MARKER_PATTERN\|export function isChildSession" guard.ts` matches both
- [x] index.ts imports only the veto: the single guard import line reads `import { isChildSession } from "./guard";`
- [x] Header names one mechanism: `grep -n "Two mechanisms" guard.ts` returns nothing, `grep -n "One mechanism" guard.ts` matches, and the SCOPE and IDENTITY bullets survive: `grep -c "   - SCOPE\.\|   - IDENTITY\." guard.ts` returns 2
- [x] No docs claim a probe remains: `grep -rn "ALS probe" AGENTS.md .agents/rules/main.md` returns nothing
- [x] Untouched regions: no hunk touches config.ts, advisor.ts, prompt.ts, report.ts, config.json, or any test banner other than the deleted t12 block

#### Manual Verification:
- [x] `npm test` output: the four t12 PASS lines are gone; t11's marker-veto asserts still PASS
- [x] Suite wall-clock stays near the ~1.5s baseline (npm test: ~2.9s wall)
- [ ] Live pi session: no `[advisor-turn-gate] ALS inChildSessionContext=` line appears at load; a subagent session stays inert with the marker veto alone (deferred: needs a live pi session; the ALS log call no longer exists in guard.ts)

---

## Phase 5: plan-turn extraction (E — F006)

Lands as commit E. plan-turn.ts is born: the pure planGate/planCommit/buildCorrection decision cores with zero runtime imports and injected thunks. index.ts becomes a dumb dispatcher around one await. t9 is replaced by the battery against the real cores. The t1 invariant comment names all six siblings (report.ts repair included).

> **Born-state reconciliation (plan-level; flagged for Step 5 review).** The design's plan-turn.ts section carries ONE block — the post-Slice-6 final state (it contains the F007 lastFiredTurn/markFired elements) — with the design's own note "Slice 6 adds the shouldFire parameter to planGate's shape." Phase 5's Success Criteria cannot pass against that final state: the t9 battery and the S5-I4 seam pass no latch fields, so planGate would invoke an undefined markFired at gate-pass and tsc strict would flag the missing required properties. The block below is therefore the design's block minus exactly the eight F007 elements that Phase 6's P6-PT hunks re-add verbatim; every other byte is the design's. If this reading is wrong, correct the design and re-run /skill:plan.

### Changes Required:

#### 1. plan-turn.ts

NEW — born state: the design's final block minus the eight F007 elements (P6-PT1..P6-PT8 invert these removals). Zero runtime imports; three type-only imports.

````
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { BoundaryResult } from "@earendil-works/pi-coding-agent";
import type { AdvisorOutcome, AdvisorResolution } from "./advisor";

/**
 * plan-turn.ts — the advisor gate's decision cores, extracted from index.ts.
 *
 * The turn_end decision splits around the single await: everything before runAdvisor is
 * planGate, everything after it is planCommit. Both are pure, and every sibling
 * capability arrives as an injected thunk, so this module has ZERO runtime imports —
 * no package resolves at runtime and no sibling is imported at runtime. The three
 * imports above are TYPE-only, so they are erased before the module runs under plain
 * node and under pi's jiti alike (precedents: index.ts:1, prompt.ts:1). The offline
 * suite imports this file directly, which is the point of the extraction: the decision
 * logic of index.ts becomes testable without loading index.ts.
 *
 * Laziness is part of the contract. Every early-out returns BEFORE any thunk runs, so
 * an off-cadence turn pays for no child scan, no parse, no resolve — the exact
 * short-circuit economics of the pre-extraction index.ts.
 */

/** One committed guidance entry plus the forced continuation. */
export function buildCorrection(
  customType: string,
  text: string,
  display: boolean,
  peerEntries: BoundaryResult["entries"],
): BoundaryResult {
  return {
    // The spread is mandatory. emitBoundary REPLACES the accumulator
    // (runner.js:775-776), so a returned array that omits event.entries discards
    // every peer draft — five other packages already register turn_end.
    entries: [
      ...(peerEntries ?? []),
      { type: "custom_message", customType, content: text, display },
    ],
    continue: true,
  };
}

/** What planGate tells the seam to do. */
export type GateDecision =
  | { action: "skip"; reason: string }
  | { action: "notify"; message: string }
  | {
      action: "consult";
      model: Model<Api>;
      systemPrompt: string;
      messages: Message[];
      timeoutMs: number;
    };

/** The plain boundary data plus the injected sibling thunks planGate reads. */
export interface PlanGateArgs {
  // Plain data: read once per dispatch at the seam, no I/O in here.
  enabled: boolean;
  model: string;
  interval: number;
  systemPrompt: string;
  timeoutMs: number;
  turnIndex: number;
  outcome: string;
  llmMessages: Message[];
  // Injected siblings, pre-bound at the seam. None runs past an early-out.
  gates: (turnIndex: number, interval: number) => boolean;
  isChild: () => boolean;
  parseModel: () => { provider: string; modelId: string } | undefined;
  resolve: (provider: string, modelId: string) => AdvisorResolution;
  buildMessages: (messages: Message[]) => Message[];
}

/**
 * Decide whether the just-finished turn owes the advisor a call.
 *
 * The arm order pins the pre-extraction semantics: disabled, no model, off cadence,
 * errored turn, child session, unparseable model — every arm silent except the
 * resolution failure, which reports through the notify arm in the exact reportFailure
 * format the old index.ts:70 produced.
 */
export function planGate(args: PlanGateArgs): GateDecision {
  if (!args.enabled) return { action: "skip", reason: "the gate is disabled" };
  if (!args.model) return { action: "skip", reason: "no model configured" };
  // Cadence. The modulo form is required: a threshold form such as
  // `turnIndex >= interval` latches and fires on every later turn.
  if (!args.gates(args.turnIndex, args.interval)) {
    return { action: "skip", reason: "off cadence" };
  }
  // An aborted or errored turn has no work worth reviewing.
  if (args.outcome !== "completed") return { action: "skip", reason: `turn ${args.outcome}` };
  // The authoritative veto.
  if (args.isChild()) return { action: "skip", reason: "child session" };
  const parsed = args.parseModel();
  // config.ts already dropped an unparseable model (with a warn) at load, so this is a
  // safety net: fail-open SILENTLY, reporting nothing (pins index.ts:65-66).
  if (!parsed) return { action: "skip", reason: "unparseable model" };
  const resolution = args.resolve(parsed.provider, parsed.modelId);
  if (!resolution.ok) {
    return { action: "notify", message: `advisor-turn-gate: ${resolution.reason}` };
  }
  return {
    action: "consult",
    model: resolution.model,
    systemPrompt: args.systemPrompt,
    messages: args.buildMessages(args.llmMessages),
    timeoutMs: args.timeoutMs,
  };
}

/** What planCommit tells the seam to do. */
export type CommitDecision =
  | { action: "notify"; message: string }
  | { action: "commit"; result: BoundaryResult };

/** The advisor outcome plus the injected shaper planCommit reads. */
export interface PlanCommitArgs {
  outcome: AdvisorOutcome;
  customType: string;
  display: boolean;
  peerEntries: BoundaryResult["entries"];
  strip: (text: string) => string;
}

/**
 * Turn the advisor outcome into either a report or the committed correction.
 *
 * Both failure arms notify in the exact reportFailure formats the pre-extraction
 * index.ts used (:84 and :93); the commit arm assembles the accumulator spread through
 * buildCorrection.
 */
export function planCommit(args: PlanCommitArgs): CommitDecision {
  if (!args.outcome.ok) {
    // Fail-open: no entries, no continuation. The loop still schedules.
    return { action: "notify", message: `advisor-turn-gate: ${args.outcome.reason}` };
  }
  // The strip is the last filter before the durable transcript. A reply that is
  // nothing but markup strips to "" — committing an empty entry would be worse
  // than committing nothing, so the husk fails open like every other path.
  const stripped = args.strip(args.outcome.text);
  if (!stripped) {
    return { action: "notify", message: "advisor-turn-gate: advisor reply was markup only" };
  }
  return {
    action: "commit",
    result: buildCorrection(args.customType, stripped, args.display, args.peerEntries),
  };
}
````

#### 2. index.ts

S5-I1..S5-I4: plan-turn import, module comment, buildCorrection deleted, the handler body becomes the seam (anchor is the post-Phase-4 body).

````
Slice 5 hunks (apply after Slice 4's; anchors are 829c948 text in regions no locked hunk touches, except S5-I4 whose anchor is the post-Slice-4 body).

S5-I1 — plan-turn import, biome order. Replace, extent-exact:
    import { buildAdvisorMessages } from "./prompt";
    import { reportFailure } from "./report";
with:
    import { planCommit, planGate } from "./plan-turn";
    import { buildAdvisorMessages } from "./prompt";
    import { reportFailure } from "./report";

S5-I2 — module comment notes where the decision logic lives. Replace, extent-exact:
    * package.json manifest, then index.ts, then index.js). No settings.json edit.
    *
    * Sibling imports are extensionless, the form `simple-english/index.ts:16` proves under
with:
    * package.json manifest, then index.ts, then index.js). No settings.json edit.
    *
    * The decision logic is pure and lives in plan-turn.ts; this file owns I/O only: the
    * config read, the registry-bound thunks, the single advisor await, and reporting.
    *
    * Sibling imports are extensionless, the form `simple-english/index.ts:16` proves under

S5-I3 — buildCorrection deleted (relocated to plan-turn.ts, exported there). Replace, extent-exact:
    /** One committed guidance entry plus the forced continuation. */
    function buildCorrection(
      customType: string,
      text: string,
      display: boolean,
      peerEntries: BoundaryResult["entries"],
    ): BoundaryResult {
      return {
        // The spread is mandatory. emitBoundary REPLACES the accumulator
        // (runner.js:775-776), so a returned array that omits event.entries discards
        // every peer draft — five other packages already register turn_end.
        entries: [
          ...(peerEntries ?? []),
          { type: "custom_message", customType, content: text, display },
        ],
        continue: true,
      };
    }

    export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
with:
    export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {

S5-I4 — the handler body becomes the seam. Replace, extent-exact. The anchor is the POST-Slice-4 body (S4-I2 removed the probe load; S4-I3 reduced the veto to its authoritative half — both sit inside this region):
    const config = loadConfig();
    if (!config.enabled || !config.model) return;

    // Cadence. The modulo form is required: a threshold form such as
    // `turnIndex >= interval` latches and fires on every later turn.
    if (!shouldGate(event.turnIndex, config.interval)) return;

    // An aborted or errored turn has no work worth reviewing.
    if (event.outcome !== "completed") return;

    // The authoritative veto.
    if (isChildSession(event.context.llmMessages)) return;

    // config.ts already dropped an unparseable model, so this is a safety net.
    const parsed = parseModelKey(config.model);
    if (!parsed) return;

    const resolution = resolveAdvisorModel(ctx.modelRegistry, parsed.provider, parsed.modelId);
    if (!resolution.ok) {
      reportFailure(ctx, `advisor-turn-gate: ${resolution.reason}`);
      return;
    }

    const outcome = await runAdvisor({
      registry: ctx.modelRegistry,
      model: resolution.model,
      systemPrompt: config.systemPrompt,
      messages: buildAdvisorMessages(event.context.llmMessages),
      timeoutMs: config.timeoutMs,
      signal: ctx.signal,
    });
    if (!outcome.ok) {
      // Fail-open: no entries, no continuation. The loop still schedules.
      reportFailure(ctx, `advisor-turn-gate: ${outcome.reason}`);
      return;
    }

    // The strip is the last filter before the durable transcript. A reply that is
    // nothing but markup strips to "" — committing an empty entry would be worse
    // than committing nothing, so the husk fails open like every other path.
    const stripped = stripAdvisorMarkup(outcome.text);
    if (!stripped) {
      reportFailure(ctx, "advisor-turn-gate: advisor reply was markup only");
      return;
    }
    return buildCorrection(config.customType, stripped, config.display, event.entries);
  });
}
with:
    const config = loadConfig();

    // The decision cores are pure (plan-turn.ts); this handler owns I/O only. The
    // thunks keep the pre-extraction laziness: planGate runs none of them past an
    // early-out, so an off-cadence turn pays for no scan, parse, or resolve.
    const gate = planGate({
      enabled: config.enabled,
      model: config.model,
      interval: config.interval,
      systemPrompt: config.systemPrompt,
      timeoutMs: config.timeoutMs,
      turnIndex: event.turnIndex,
      outcome: event.outcome,
      llmMessages: event.context.llmMessages,
      gates: shouldGate,
      isChild: () => isChildSession(event.context.llmMessages),
      parseModel: () => parseModelKey(config.model),
      resolve: (provider, modelId) => resolveAdvisorModel(ctx.modelRegistry, provider, modelId),
      buildMessages: buildAdvisorMessages,
    });
    if (gate.action === "skip") return;
    if (gate.action === "notify") {
      reportFailure(ctx, gate.message);
      return;
    }

    // The single await splits the decision: everything before it is planGate, the
    // advisor call is I/O, everything after it is planCommit.
    const outcome = await runAdvisor({
      registry: ctx.modelRegistry,
      model: gate.model,
      systemPrompt: gate.systemPrompt,
      messages: gate.messages,
      timeoutMs: gate.timeoutMs,
      signal: ctx.signal,
    });

    const commit = planCommit({
      outcome,
      customType: config.customType,
      display: config.display,
      peerEntries: event.entries,
      strip: stripAdvisorMarkup,
    });
    if (commit.action === "notify") {
      reportFailure(ctx, commit.message);
      return;
    }
    return commit.result;
  });
}
````

#### 3. tests/test.mjs

Slice 5 hunks S5-T1..S5-T4: invariant comment names six siblings, sibling count, plan-turn import, t9 replaced by the battery.

````
Slice 5 hunks (apply after Slice 4's; anchors are verbatim 829c948 text in regions no locked hunk touches).

S5-T1 — invariant comment names all six siblings and repairs the report.ts omission (report.ts:14 claims coverage the comment never granted). Replace, extent-exact:
    * config.ts, guard.ts, prompt.ts, and advisor.ts import no sibling at runtime, so this
    * file resolves nothing from @earendil-works/* — a MODULE_NOT_FOUND here means a runtime
    * import leaked into one of them.
with:
    * config.ts, guard.ts, prompt.ts, advisor.ts, report.ts, and plan-turn.ts import no
    * sibling at runtime, so this file resolves nothing from @earendil-works/* — a
    * MODULE_NOT_FOUND here means a runtime import leaked into one of them.

S5-T2 — the sibling count follows the two new imports. Replace, extent-exact:
    *     index.ts at all, so this suite imports the four sibling modules directly.
with:
    *     index.ts at all, so this suite imports the six sibling modules directly.

S5-T3 — plan-turn import, biome order (before ./prompt.ts). Replace, extent-exact:
    import {
      ADVISOR_NUDGE,
      buildAdvisorMessages,
with:
    import { buildCorrection, planCommit, planGate } from "../plan-turn.ts";
    import {
      ADVISOR_NUDGE,
      buildAdvisorMessages,

S5-T4 — the t9 block is replaced by the plan-turn battery (the old block asserted an inline re-implementation; the battery asserts the real cores and absorbs the old spread concerns). Replace, extent-exact, the whole t9 block:
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
with:
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
      gates: () => true,
      isChild: () => false,
      parseModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-4-5" }),
      resolve: () => ({ ok: true, model: { provider: "anthropic", id: "claude-sonnet-4-5" } }),
      buildMessages: (messages) => messages,
      ...overrides,
    });
    {
      // Laziness. The cadence thunk runs; nothing behind it does.
      const calls = { gates: 0, isChild: 0, parseModel: 0, resolve: 0, buildMessages: 0 };
      const decision = planGate(
        gateArgs({
          gates: () => {
            calls.gates++;
            return false;
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
      assert(
        calls.isChild + calls.parseModel + calls.resolve + calls.buildMessages === 0,
        "t9: an off-cadence turn invokes no other thunk (laziness preserved)",
      );
    }
    {
      // The silent top early-outs, and the order: cadence precedes the outcome check, the
      // outcome check precedes the child veto, and the veto precedes parse and resolve.
      assert(planGate(gateArgs({ enabled: false })).action === "skip", "t9: a disabled gate skips");
      assert(
        planGate(gateArgs({ model: "" })).action === "skip",
        "t9: an empty model skips before any thunk",
      );
      const calls = { gates: 0, isChild: 0 };
      const errored = planGate(
        gateArgs({
          outcome: "error",
          gates: () => {
            calls.gates++;
            return true;
          },
          isChild: () => {
            calls.isChild++;
            return true;
          },
        }),
      );
      assert(errored.action === "skip", "t9: an errored boundary skips");
      assert(calls.gates === 1 && calls.isChild === 0, "t9: cadence precedes the outcome check");
      const vetoed = planGate(
        gateArgs({
          isChild: () => true,
          parseModel: () => {
            throw new Error("parse must not run past the veto");
          },
        }),
      );
      assert(vetoed.action === "skip", "t9: a child session skips before parse and resolve");
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
    {
      // The real cadence predicate rides the seam: t1's interval sets, replayed through
      // the core, so a seam that drops or inverts turnIndex cannot pass silently.
      assert(
        planGate(gateArgs({ interval: 0, gates: shouldGate })).action === "skip",
        "t9: interval 0 never consults through the real cadence",
      );
      assert(
        planGate(gateArgs({ turnIndex: 1, interval: 2, gates: shouldGate })).action === "consult",
        "t9: interval 2 consults on turnIndex 1 through the real cadence",
      );
      assert(
        planGate(gateArgs({ turnIndex: 0, interval: 2, gates: shouldGate })).action === "skip",
        "t9: interval 2 skips turnIndex 0 through the real cadence",
      );
    }
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
        husk.action === "notify" &&
          husk.message === "advisor-turn-gate: advisor reply was markup only",
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
````

#### 4. AGENTS.md

A3: the plan-turn.ts Files line.

````
A3 — plan-turn.ts Files line (F006). In the Files list, replace:
    - `index.ts` — the wiring. The only file the runtime loads.
with:
    - `index.ts` — the wiring. The only file the runtime loads.
    - `plan-turn.ts` — the pure turn_end decision cores. No runtime imports.
```
````

#### 5. .agents/rules/main.md

M2: the plan-turn.ts Files line.

````
M2 — plan-turn.ts Files line (F006). In the Files list, replace:
    - `index.ts` — the wiring. The only file the runtime loads.
with:
    - `index.ts` — the wiring. The only file the runtime loads.
    - `plan-turn.ts` — the pure turn_end decision cores. No runtime imports.
```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] plan-turn.ts has zero runtime imports: `grep -nE "^import" plan-turn.ts` returns exactly three lines, all `import type` (two from @earendil-works/*, one type-only from ./advisor)
- [x] index.ts no longer defines or imports buildCorrection: `grep -n "buildCorrection" index.ts` returns nothing
- [x] The seam imports and calls the cores: `grep -cE "planGate|planCommit" index.ts` returns >= 4 (import line, two call sites, comment lines)
- [x] The battery replaced the inline t9: `grep -c "t9:" tests/test.mjs` returns >= 30, and `grep -c "plan-turn.ts" tests/test.mjs` returns >= 2 (import + banner)
- [x] Laziness pinned: `grep -n "invokes no other thunk" tests/test.mjs` matches
- [x] Exact formats pinned against the real cores: `grep -c "advisor-turn-gate: advisor reply was markup only" tests/test.mjs` returns 1
- [x] The parse arm stays silent: `grep -n "the parse arm reports nothing" tests/test.mjs` matches
- [x] Invariant comment repaired: `grep -n "report.ts, and plan-turn.ts import no" tests/test.mjs` matches, and `grep -n "six sibling modules" tests/test.mjs` matches
- [x] Real cadence parity: `grep -c "through the real cadence" tests/test.mjs` returns 3
- [x] Untouched regions: no hunk touches config.ts, advisor.ts, guard.ts, prompt.ts, report.ts, config.json, scripts/hooks/*, or any test banner outside the t9 region, the import block, and the two header-comment lines (the real-cadence block's braces were unwrapped per the Phase 1 biome decision; its banner comment and all three asserts are intact)

#### Manual Verification:
- [x] t1's interval-2 set replays through planGate with the real shouldGate (consult on turnIndex 1, skip on 0) — the seam passes turnIndex and interval faithfully
- [x] Suite wall-clock stays near the ~1.5s baseline: the battery adds pure-function calls and no waits
- [x] index.ts reads as a dumb dispatcher: config read, thunk wiring, one await, notify dispatches — no decision branching left in the handler

---

## Phase 6: cadence slide (F — F007)

Lands as commit F. The cadence slide. shouldFire — the stateful threshold form — lands beside shouldGate (whose doc narrows the anti-latch claim to the stateless form); the lastFiredTurn latch lives in index.ts's factory closure with the single write at the seam; an errored boundary does not spend its slot and the next completed turn at or past the boundary fires. t1b pins fold parity; t9 rides the new shape. plan-turn.ts absorbs the eight F007 elements.

### Changes Required:

#### 1. config.ts

C5: shouldGate doc narrows to the STATELESS form; shouldFire lands beside it, verbatim.

````
C5 — shouldGate doc narrows the anti-latch claim to the STATELESS form; shouldFire lands beside it (F007). Replace, extent-exact (anchor is 829c948 text; no locked slice touches this region):

```
/**
 * Whether the gate fires on the turn that just ended.
 *
 * The modulo form is required. A threshold form such as `turnIndex >= interval` latches:
 * once turnIndex reaches the interval it fires on EVERY later turn, so interval 2 over
 * five turns yields four advisor calls instead of two.
 *
 * `turnIndex` is 0-based for the just-finished turn (agent-session.js:918 increments it
 * after the dispatch), so turn 1 reports 0 and the +1 makes the first gate land on turn
 * `interval`.
 *
 * Lives here rather than in index.ts because index.ts's extensionless sibling imports do
 * not resolve under plain node, and this predicate is the one piece of cadence logic the
 * offline suite must assert.
 */
export function shouldGate(turnIndex: number, interval: number): boolean {
  if (!Number.isInteger(interval) || interval < 1) return false;
  return (turnIndex + 1) % interval === 0;
}
```

with:

```
/**
 * Whether the gate fires on the turn that just ended.
 *
 * The modulo form is required. A STATELESS threshold form such as
 * `turnIndex >= interval` latches: once turnIndex reaches the interval it fires on EVERY
 * later turn, so interval 2 over five turns yields four advisor calls instead of two.
 * The qualifier matters since F007: the stateful threshold form beside this function
 * cannot latch, because its lastFiredTurn advances on every fire.
 *
 * `turnIndex` is 0-based for the just-finished turn (agent-session.js:918 increments it
 * after the dispatch), so turn 1 reports 0 and the +1 makes the first gate land on turn
 * `interval`.
 *
 * Lives here rather than in index.ts because index.ts's extensionless sibling imports do
 * not resolve under plain node, and this predicate is the one piece of cadence logic the
 * offline suite must assert.
 */
export function shouldGate(turnIndex: number, interval: number): boolean {
  if (!Number.isInteger(interval) || interval < 1) return false;
  return (turnIndex + 1) % interval === 0;
}

/**
 * Whether the gate fires on this turn, given the turn it last fired on (F007).
 *
 * The stateful threshold form: fire on the first COMPLETED turn at or past each
 * boundary. lastFiredTurn starts at -1, so the first fire lands at turn interval - 1
 * (0-based) — exact parity with shouldGate's modulo sequence. An errored boundary does
 * not spend its slot because the seam updates lastFiredTurn only after the completed
 * check passes, so the next completed turn at or past the boundary fires — which the
 * modulo form would not do (the slide).
 *
 * It does not latch: lastFiredTurn advances only when the gate fires, so after a quiet
 * stretch the stale threshold produces exactly one fire and cadence re-locks.
 *
 * Lives beside shouldGate, which stays: t1 pins the modulo sequence verbatim and t1b
 * pins the fold parity between the two forms, so a regression in either cannot pass.
 */
export function shouldFire(turnIndex: number, interval: number, lastFiredTurn: number): boolean {
  if (!Number.isInteger(interval) || interval < 1) return false;
  return turnIndex >= lastFiredTurn + interval;
}
```
```
````

#### 2. plan-turn.ts

The F007 delta — P6-PT1..P6-PT8. Every NEW text below is byte-identical to the design's final plan-turn.ts block; the OLD texts are Phase 5's born state. Derived at plan level (see the Phase 5 reconciliation note); flagged for Step 5 review.

````
P6-PT1 — module docstring gains the mark clause (F007). Replace:
     * an off-cadence turn pays for no child scan, no parse, no resolve — the exact
     * short-circuit economics of the pre-extraction index.ts.
with:
     * an off-cadence turn pays for no child scan, no parse, no resolve, and no mark — the
     * exact short-circuit economics of the pre-extraction index.ts.

P6-PT2 — PlanGateArgs gains the latch field (F007). Insert after the llmMessages field:
      // The turn the gate last fired on (F007). The factory starts it at -1, so the first
      // fire lands on turn interval - 1 (0-based) — exact parity with the modulo sequence.
      lastFiredTurn: number;

P6-PT3 — the gates signature grows its third parameter (F007). Replace:
      gates: (turnIndex: number, interval: number) => boolean;
with:
      gates: (turnIndex: number, interval: number, lastFiredTurn: number) => boolean;

P6-PT4 — PlanGateArgs gains the mark thunk (F007). Insert after the buildMessages field, before the interface closes:
      // Invoked exactly once per gate-pass: after the completed check, before the vetoes.
      // The seam owns the single lastFiredTurn write; this core stays pure.
      markFired: (turnIndex: number) => void;

P6-PT5 — the planGate docstring gains the mark sentence (F007). Replace:
     * format the old index.ts:70 produced.
with:
     * format the old index.ts:70 produced. The F007 mark runs at gate-pass, after the
     * completed check and before the vetoes: an errored boundary does not spend its slot,
     * a vetoed one does.

P6-PT6 — the cadence comment and the predicate call ride the stateful form (F007). Replace:
      // Cadence. The modulo form is required: a threshold form such as
      // `turnIndex >= interval` latches and fires on every later turn.
      if (!args.gates(args.turnIndex, args.interval)) {
with:
      // Cadence. shouldFire is the STATEFUL threshold form: it cannot latch, because
      // lastFiredTurn advances on every fire. The anti-latch argument on shouldGate
      // (config.ts) covers only the stateless form; t1 pins that form, t1b pins this one.
      if (!args.gates(args.turnIndex, args.interval, args.lastFiredTurn)) {

P6-PT7 — the errored-turn comment gains the slide clause (F007). Replace:
      // An aborted or errored turn has no work worth reviewing.
with:
      // An aborted or errored turn has no work worth reviewing — and does not spend its
      // slot: markFired below runs only past this check, so the next completed turn at or
      // past the boundary fires (the F007 slide, which the modulo form would not do).

P6-PT8 — the gate-pass mark lands between the completed check and the veto (F007). Insert directly after the completed-check return line:
      // Gate-pass. Record the fire BEFORE the vetoes, so a vetoed boundary spends its slot
      // and retries stay bounded to one per interval — a commit-time update would
      // re-attempt a broken registry on every later turn.
      args.markFired(args.turnIndex);

````

#### 3. index.ts

S6-I1..S6-I4: shouldFire import, the factory-closure latch, the seam comment, the seam passes the latch and the mark thunk.

````
Slice 6 hunks (anchors are the POST-Slice-4/5 text — S6-I2 re-anchors the S4-I2 factory opening; S6-I3 and S6-I4 anchor the S5-I4 seam comment and planGate call):

S6-I1 — import swap: the seam rides shouldFire now; shouldGate stays in config.ts only for t1. Replace, extent-exact (anchor is 829c948 text; no locked slice touches this line):

```
import { loadConfig, parseModelKey, shouldGate } from "./config";
```

with:

```
import { loadConfig, parseModelKey, shouldFire } from "./config";
```

S6-I2 — the F007 latch in the factory closure. Replace, extent-exact (anchor is the POST-Slice-4 factory opening; S4-I2 removed the probe load):

```
export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
```

with:

```
export default async function advisorTurnGate(pi: ExtensionAPI): Promise<void> {
  // F007: the cadence latch lives in the factory closure, so the seam owns the single
  // write and the pure core stays pure. A pi reload re-runs this factory while
  // turnIndex keeps climbing: the reset latch puts the threshold in the past, so the
  // next completed turn fires EARLY (up to interval-1 turns) and cadence re-locks
  // after that one fire. Reload may fire early; it never skips.
  let lastFiredTurn = -1;

  pi.on("turn_end", async (event, ctx): Promise<BoundaryResult | undefined> => {
```

S6-I3 — seam comment gains the mark. Replace, extent-exact (anchor is the POST-Slice-5 comment above the planGate call):

```
    // The decision cores are pure (plan-turn.ts); this handler owns I/O only. The
    // thunks keep the pre-extraction laziness: planGate runs none of them past an
    // early-out, so an off-cadence turn pays for no scan, parse, or resolve.
```

with:

```
    // The decision cores are pure (plan-turn.ts); this handler owns I/O only. The
    // thunks keep the pre-extraction laziness: planGate runs none of them past an
    // early-out, so an off-cadence turn pays for no scan, parse, resolve, or mark.
```

S6-I4 — the seam passes the latch and the mark thunk. Replace, extent-exact (anchor is the POST-Slice-5 planGate call):

```
    const gate = planGate({
      enabled: config.enabled,
      model: config.model,
      interval: config.interval,
      systemPrompt: config.systemPrompt,
      timeoutMs: config.timeoutMs,
      turnIndex: event.turnIndex,
      outcome: event.outcome,
      llmMessages: event.context.llmMessages,
      gates: shouldGate,
      isChild: () => isChildSession(event.context.llmMessages),
      parseModel: () => parseModelKey(config.model),
      resolve: (provider, modelId) => resolveAdvisorModel(ctx.modelRegistry, provider, modelId),
      buildMessages: buildAdvisorMessages,
    });
```

with:

```
    const gate = planGate({
      enabled: config.enabled,
      model: config.model,
      interval: config.interval,
      systemPrompt: config.systemPrompt,
      timeoutMs: config.timeoutMs,
      turnIndex: event.turnIndex,
      outcome: event.outcome,
      llmMessages: event.context.llmMessages,
      lastFiredTurn,
      gates: shouldFire,
      isChild: () => isChildSession(event.context.llmMessages),
      parseModel: () => parseModelKey(config.model),
      resolve: (provider, modelId) => resolveAdvisorModel(ctx.modelRegistry, provider, modelId),
      buildMessages: buildAdvisorMessages,
      // The single lastFiredTurn write in the codebase. planGate invokes this at
      // gate-pass — after the completed check, before the vetoes — so an errored
      // boundary does not spend its slot and a vetoed one does.
      markFired: (turnIndex) => {
        lastFiredTurn = turnIndex;
      },
    });
```
```
````

#### 4. tests/test.mjs

Slice 6 hunks S6-T1..S6-T4 (import block, t1 wording narrowed + banner reword, the t1b battery, five t9 edits). Anchors are the post-Phase-5 regions.

````
Slice 6 hunks (S6-T1..T4; anchors are the POST-locked-slice regions — S6-T1 re-anchors the S2-H1 import block, S6-T3 anchors the S2-H3 t2 banner, S6-T4 anchors the S5 t9 battery text):

S6-T1 — import block (F007). Replace the POST-Slice-2 import block, extent-exact:

```
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
  shouldGate,
} from "../config.ts";
```

with:

```
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
```

S6-T2 — t1 narrows the anti-latch claim to the STATELESS form (the research's t1-conflict reconciliation). Two edits.

S6-T2a — the banner. Replace, extent-exact (anchor is 829c948 text; no locked slice touches t1):

```
// --- 1. cadence: the modulo form gates once per interval; the threshold form latches.
//        Runs first because it is pure arithmetic with no module-level latch.
```

with:

```
// --- 1. cadence: the modulo form gates once per interval; the STATELESS threshold form
//        latches. Runs first because it is pure arithmetic with no module-level latch.
```

S6-T2b — the latched-alternative assert. Replace, extent-exact:

```
  // The rejected alternative, asserted so a refactor cannot silently adopt it.
  const latched = seq.filter((i) => i >= 2);
  assert(
    latched.length === 6,
    "t1: the threshold form would latch to 6 calls, which is why it is rejected",
  );
}
```

with:

```
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
```

S6-T3 — the t1b F007 battery, inserted between t1's closing brace and the t2 banner. Insert before (anchor is the POST-Slice-2 t2 banner):

```
// --- 2. missing config file: silent, defaults. The ENOENT path never reaches the
//        warn-once latch, so no ordering constraint applies (F002).
```

this block:

```
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
```

S6-T4 — the t9 battery rides the new planGate shape (F007). Five edits, all against the POST-Slice-5 battery text.

S6-T4a — gateArgs factory: the default predicate becomes the real shouldFire, and the two new fields get defaults. Replace, extent-exact:

```
      llmMessages: [{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 }],
      gates: () => true,
      isChild: () => false,
      parseModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-4-5" }),
      resolve: () => ({ ok: true, model: { provider: "anthropic", id: "claude-sonnet-4-5" } }),
      buildMessages: (messages) => messages,
      ...overrides,
```

with:

```
      llmMessages: [{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 }],
      lastFiredTurn: -1,
      gates: shouldFire,
      isChild: () => false,
      parseModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-4-5" }),
      resolve: () => ({ ok: true, model: { provider: "anthropic", id: "claude-sonnet-4-5" } }),
      buildMessages: (messages) => messages,
      markFired: () => {},
      ...overrides,
```

S6-T4b — laziness ledger gains the mark spy. Replace, extent-exact:

```
      const calls = { gates: 0, isChild: 0, parseModel: 0, resolve: 0, buildMessages: 0 };
```

with:

```
      const calls = {
        gates: 0,
        markFired: 0,
        isChild: 0,
        parseModel: 0,
        resolve: 0,
        buildMessages: 0,
      };
```

S6-T4c — laziness overrides and the preserved assertion. Replace, extent-exact:

```
          gates: () => {
            calls.gates++;
            return false;
          },
          isChild: () => {
            calls.isChild++;
            return true;
          },
```

with:

```
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
```

and replace, extent-exact:

```
      assert(decision.action === "skip", "t9: an off-cadence turn skips");
      assert(calls.gates === 1, "t9: the cadence thunk runs exactly once");
      assert(
        calls.isChild + calls.parseModel + calls.resolve + calls.buildMessages === 0,
        "t9: an off-cadence turn invokes no other thunk (laziness preserved)",
      );
```

with:

```
      assert(decision.action === "skip", "t9: an off-cadence turn skips");
      assert(calls.gates === 1, "t9: the cadence thunk runs exactly once");
      const behind =
        calls.markFired + calls.isChild + calls.parseModel + calls.resolve + calls.buildMessages;
      assert(behind === 0, "t9: an off-cadence turn invokes no other thunk (laziness preserved)");
```

S6-T4d — the order block pins the slide: gates runs on an errored boundary, markFired does not. Replace, extent-exact:

```
      const calls = { gates: 0, isChild: 0 };
      const errored = planGate(
        gateArgs({
          outcome: "error",
          gates: () => {
            calls.gates++;
            return true;
          },
          isChild: () => {
            calls.isChild++;
            return true;
          },
        }),
      );
      assert(errored.action === "skip", "t9: an errored boundary skips");
      assert(calls.gates === 1 && calls.isChild === 0, "t9: cadence precedes the outcome check");
```

with:

```
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
      assert(
        calls.markFired === 0,
        "t9: an errored boundary does not spend its slot (the F007 slide)",
      );
```

S6-T4e — the veto block pins mark-before-veto, and the real-cadence block drops its explicit shouldGate (the default is shouldFire now). Replace, extent-exact:

```
      const vetoed = planGate(
        gateArgs({
          isChild: () => true,
          parseModel: () => {
            throw new Error("parse must not run past the veto");
          },
        }),
      );
      assert(vetoed.action === "skip", "t9: a child session skips before parse and resolve");
```

with:

```
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
```

and replace, extent-exact:

```
      // The real cadence predicate rides the seam: t1's interval sets, replayed through
      // the core, so a seam that drops or inverts turnIndex cannot pass silently.
      assert(
        planGate(gateArgs({ interval: 0, gates: shouldGate })).action === "skip",
        "t9: interval 0 never consults through the real cadence",
      );
      assert(
        planGate(gateArgs({ turnIndex: 1, interval: 2, gates: shouldGate })).action === "consult",
        "t9: interval 2 consults on turnIndex 1 through the real cadence",
      );
      assert(
        planGate(gateArgs({ turnIndex: 0, interval: 2, gates: shouldGate })).action === "skip",
        "t9: interval 2 skips turnIndex 0 through the real cadence",
      );
```

with:

```
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
```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] Fold parity pinned: `grep -c "folds to t1's exact set" tests/test.mjs` returns 2
- [x] Slide pinned through the core: `grep -c "does not spend its slot" tests/test.mjs` returns 2 (t1b errored boundary and t9 order block)
- [x] Mark-before-veto pinned: `grep -n "the mark runs before the veto" tests/test.mjs` matches
- [x] No-latch pinned: `grep -n "a gap fires once and re-locks" tests/test.mjs` matches
- [x] Reload-early-fire pinned: `grep -n "fires early on the next completed turn" tests/test.mjs` matches
- [x] t9 real-cadence parity intact: `grep -c "through the real cadence" tests/test.mjs` returns 3
- [x] shouldGate body untouched: `grep -c "return (turnIndex + 1) % interval === 0;" config.ts` returns 1
- [x] shouldFire exported beside it and ridden by the seam: `grep -n "export function shouldFire" config.ts` matches; `grep -c "shouldFire" index.ts` returns 2 (import + seam)
- [x] index.ts drops shouldGate: `grep -n "shouldGate" index.ts` returns nothing
- [x] The latch write stays at the seam: `grep -c "lastFiredTurn = turnIndex" index.ts` returns 1; `grep -n "lastFiredTurn = " plan-turn.ts config.ts` returns nothing
- [x] plan-turn.ts keeps zero runtime imports: `grep -nE "^import" plan-turn.ts` returns exactly three lines, all `import type`
- [x] t1 arithmetic intact, wording narrowed: `grep -n "the stateless threshold form would latch to 6 calls" tests/test.mjs` matches, and no t1 line other than the S6-T2a banner reword, that one message, and its comment changed

#### Manual Verification:
- [x] Trace the slide by hand: interval 2, turnIndex 3 errors, turnIndex 4 completes → consult at 4 (modulo would wait for 5) — t1b's slide section drives exactly this sequence through the core and passes
- [x] Suite wall-clock stays near the ~1.5s baseline: t1b is pure-function calls and adds no waits

---

## Phase 7: refspec hole + shared parser (G — F009+F017)

Lands as commit G. The refspec hole and the shared parser. scripts/hooks/lib.mjs is born with exactly three exports (isHookInvocation, parseHookStdin, readHookField); gate.mjs blocks every +-forced protected refspec (+ normalization inside the core); both hooks consume the shared plumbing and lose their local copies. t19b and t19c land.

> **Born-state reconciliation.** The design's lib.mjs block is the post-Slice-8 final state (four exports). Slice 7's Success Criteria pin the born state at exactly three exports and Slice 8 pins describeSpawnResult as the fourth, so the block below is the design's block truncated before the describeSpawnResult doc comment — zero other changes. Phase 8 appends the function verbatim.

### Changes Required:

#### 1. scripts/hooks/lib.mjs

NEW — born state: three exports, no imports.

````
/**
 * Shared plumbing for the Claude Code hook scripts.
 *
 * Plain node only: no project imports, no node_modules lookups. The hooks run
 * before git operations in arbitrary checkouts, where the extension's
 * extensionless sibling imports do not resolve. Biome lints this file; tsc
 * never sees it (all of .mjs is outside the typecheck surface).
 *
 * Only the pure helpers live here. Each hook keeps its own exit dispatch —
 * the process.exit boundaries are the one piece of these scripts that ships
 * untested, because faking argv and stdin buys less than the dispatch costs.
 */

/**
 * Whether node was started as the named hook script. Path-separator safe:
 * Claude Code invokes the hooks with absolute paths, and Windows uses
 * backslashes.
 */
export function isHookInvocation(argv, scriptName) {
  const entry = argv?.[1] ?? "";
  return entry.replace(/\\/g, "/").endsWith(scriptName);
}

/**
 * Parse one hook stdin payload. Returns the parsed object, or undefined on
 * any parse failure or non-object body: the caller's `if (!payload)
 * exit(0)` is then the fail-open gate, and a hostile body can never block.
 */
export function parseHookStdin(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read one tool-input field across both payload spellings Claude Code ships:
 * snake_case `tool_input` and camelCase `toolInput`. Returns the raw value
 * (possibly undefined); the caller owns the type check, because the gate and
 * the feedback hook reject different shapes.
 */
export function readHookField(payload, key) {
  return payload?.tool_input?.[key] ?? payload?.toolInput?.[key];
}
````

#### 2. scripts/hooks/gate.mjs

G1-G4: header blocklist note, shared plumbing import, blocksProtectedForcePush rewrite (+ normalization + force signal), the local isHookInvocation dies and the dispatch rides lib.mjs (G4's anchor is the FULL extent, def through the field read).

````
Slice 7 hunks (anchors are verbatim 829c948 text; no locked slice touches gate.mjs; extent-exact — each anchor spans the full replaced region):

G1 — header blocklist note (F009). Insert after the first header paragraph ("Reads one JSON object on stdin ... a denial-of-service on itself."), before the `evaluate` paragraph:

```
 * The blocklist is deliberately narrow, and every rule is cheap string work:
 * recursive rm on root-like targets, forced pushes to a protected branch (a
 * leading + on a refspec is git's own force marker), git reset --hard,
 * destructive git clean, SQL drops, mkfs, raw disk writes, and a
 * world-writable chmod from root. Everything else passes untouched.
```

G2 — import the shared plumbing (F017). Replace, extent-exact:

```
import { readFileSync } from "node:fs";
```

with:

```
import { readFileSync } from "node:fs";
import { isHookInvocation, parseHookStdin, readHookField } from "./lib.mjs";
```

G3 — blocksProtectedForcePush rewrite (F009): a leading + on a refspec is a force signal AND something the branch matcher must see normalized. Replace, extent-exact:

```
function blocksProtectedForcePush(command) {
  if (!/\bgit\s+push\b/.test(command)) return false;
  const forced = /\s--force(?!-with-lease)\b|\s-f\b/.test(command);
  const protectedBranch = /\s(?:origin\s+)?(?:(?:HEAD|HEAD~\d+):)?(?:main|master)\b/.test(command);
  return forced && protectedBranch;
}
```

with:

```
function blocksProtectedForcePush(command) {
  if (!/\bgit\s+push\b/.test(command)) return false;
  const tokens = command.trim().split(/\s+/);
  // Two force signals: the explicit flag (unchanged), and a leading + on a
  // refspec — git's own force marker (git-push(1)). The flag scan cannot see
  // the +: `git push origin +main` and `git push --force-with-lease origin
  // +main` carry no --force or -f at all.
  const flagForced = /\s--force(?!-with-lease)\b|\s-f\b/.test(command);
  const plusForced = tokens.some((token) => token.startsWith("+"));
  if (!flagForced && !plusForced) return false;
  // Normalize the + away BEFORE the branch match, or +main, +HEAD:main, and
  // mixed refspecs (`git push origin main +main`) slip past the matcher.
  const normalized = tokens
    .map((token) => (token.startsWith("+") ? token.slice(1) : token))
    .join(" ");
  const protectedBranch = /\s(?:origin\s+)?(?:(?:HEAD|HEAD~\d+):)?(?:main|master)\b/.test(
    normalized,
  );
  return protectedBranch;
}
```

G4 — the local isHookInvocation dies and the dispatch rides the shared plumbing (F017). Replace, extent-exact — the FULL extent, def through the field read, or the surviving local def collides with the G2 import (duplicate binding, round-1 verifier finding):

```
function isHookInvocation(argv) {
  const entry = argv[1] ?? "";
  return /gate\.mjs$/.test(entry.replace(/\\/g, "/"));
}

if (isHookInvocation(process.argv)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0); // fail open: unreadable input never blocks the agent
  }
  const command = payload?.tool_input?.command ?? payload?.toolInput?.command;
```

with:

```
if (isHookInvocation(process.argv, "gate.mjs")) {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    process.exit(0); // fail open: unreadable input never blocks the agent
  }
  const payload = parseHookStdin(raw);
  if (!payload) process.exit(0); // fail open: an unusable body never blocks the agent
  const command = readHookField(payload, "command");
```

(Everything from `if (typeof command !== "string") process.exit(0);` down is untouched. Slice 9 adds its Node-floor note at the header's "Requires Node.js 22.6 or newer." line by text anchor — G1 shifts that line from :14, which is expected drift.)

Slice 9 hunk (anchors the POST-Slice-7 header by text; comment-only — the dispatch below stays untouched):
````

#### 3. scripts/hooks/feedback.mjs

FB1-FB2: shared plumbing import; the local isHookInvocation dies and the dispatch rides lib.mjs (FULL extent).

````
Slice 7 hunks (anchors are verbatim 829c948 text; no locked slice touches feedback.mjs; syntaxCheck stays byte-identical — Slice 8 reorders it):

FB1 — import the shared plumbing (F017). Replace, extent-exact:

```
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
```

with:

```
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isHookInvocation, parseHookStdin, readHookField } from "./lib.mjs";
```

FB2 — the local isHookInvocation dies and the dispatch rides the shared plumbing (F017). Replace, extent-exact — the FULL extent, def through the field read:

```
function isHookInvocation(argv) {
  const entry = argv[1] ?? "";
  return /feedback\.mjs$/.test(entry.replace(/\\/g, "/"));
}

if (isHookInvocation(process.argv)) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const file = payload?.tool_input?.file_path ?? payload?.toolInput?.file_path;
```

with:

```
if (isHookInvocation(process.argv, "feedback.mjs")) {
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  const payload = parseHookStdin(raw);
  if (!payload) process.exit(0);
  const file = readHookField(payload, "file_path");
```

(Everything from `if (typeof file !== "string" || file.length === 0) process.exit(0);` down is untouched. Slice 9 adds its Node-floor note at the header's "Requires Node.js 22.6 or newer." line by text anchor.)
````

#### 4. tests/test.mjs

Slice 7 hunks T1-T2: lib import; the t19b and t19c batteries appended after t19.

````
Slice 7 hunks (T1-T2; T1's anchor is verbatim text no locked slice touches; T2 anchors the on-disk file tail — t19b/t19c are pure appends, and Slice 8 appends after them):

T1 — lib import (F017). Replace, extent-exact:

```
import { reportFailure } from "../report.ts";
import { evaluate } from "../scripts/hooks/gate.mjs";
```

with:

```
import { reportFailure } from "../report.ts";
import { evaluate } from "../scripts/hooks/gate.mjs";
import { isHookInvocation, parseHookStdin, readHookField } from "../scripts/hooks/lib.mjs";
```

T2 — the F009 battery and the F017 plumbing battery, appended after t19 (the F009/F018-appends convention; Slice 8 appends after this). Replace, extent-exact:

```
  assert(evaluate("") === null, "t19: empty command is allowed");
  assert(evaluate(undefined) === null, "t19: non-string is allowed");
  assert(evaluate("DROP TABLE users;") === "SQL drop statement", "t19: the reason names the rule");
}
```

with:

```
  assert(evaluate("") === null, "t19: empty command is allowed");
  assert(evaluate(undefined) === null, "t19: non-string is allowed");
  assert(evaluate("DROP TABLE users;") === "SQL drop statement", "t19: the reason names the rule");
}

// --- 19b. the refspec force marker (F009): a leading + on a refspec is git's own force
//          signal, and the branch matcher sees it with the + normalized away.
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
  ];
  for (const command of blocked) {
    assert(evaluate(command) !== null, `t19b: blocked: ${command}`);
  }
  assert(blocked.length === 10, "t19b: 10 forced-refspec forms block");
  assert(
    evaluate("git push origin +main") === "forced push to a protected branch",
    "t19b: the + form reports the same reason as the flag form",
  );
  // The force-with-lease allowance survives, scoped to UNMARKED refspecs; a +
  // on an unprotected branch is still an ordinary push.
  const allowed = [
    "git push --force-with-lease origin main",
    "git push origin +feature/x",
    "git push origin feature/x",
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
```
````

#### 5. AGENTS.md

A4: the lib.mjs Files line.

````
A4 — lib.mjs Files line (F017). In the Files list, after the gate.mjs line, insert:
    - `scripts/hooks/lib.mjs` — shared hook plumbing: invocation detection, stdin parse, field read.
```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] Refspec hole closed: `grep -n "10 forced-refspec forms block" tests/test.mjs` matches, and `npm test` prints PASS for each `t19b: blocked:` form
- [x] Reason string pinned: `grep -n "the + form reports the same reason" tests/test.mjs` matches
- [x] The force-with-lease allowance survives unmarked: `git push --force-with-lease origin main` stays null in t19 AND t19b, and `grep -n "t19b: allowed" tests/test.mjs` matches
- [x] lib.mjs born with exactly three exports: `grep -c "^export" scripts/hooks/lib.mjs` returns 3, and `grep -nE "^import" scripts/hooks/lib.mjs` returns nothing (no imports needed — node builtins only)
- [x] Both hooks consume the shared plumbing and define no local copy: `grep -n "function isHookInvocation" scripts/hooks/gate.mjs scripts/hooks/feedback.mjs` returns nothing, and `grep -n "from \"./lib.mjs\"" scripts/hooks/gate.mjs scripts/hooks/feedback.mjs` matches both
- [x] The + normalization lives in the core: `grep -n "startsWith(\"+\")" scripts/hooks/gate.mjs` matches
- [x] t19c pins the plumbing: `grep -c "t19c:" tests/test.mjs` returns 12
- [x] Header carries the blocklist note: `grep -n "leading +" scripts/hooks/gate.mjs` matches inside the header doc block
- [x] AGENTS.md lists lib.mjs: `grep -n "scripts/hooks/lib.mjs" AGENTS.md` matches
- [x] Untouched regions: no hunk touches config.ts, advisor.ts, guard.ts, index.ts, plan-turn.ts, prompt.ts, report.ts, config.json, README.md, .agents/*, or any existing test banner; every t19 verdict is unchanged

#### Manual Verification:
- [x] Stdin round-trip: piping `{"tool_input":{"command":"git push origin +main"}}` into `node scripts/hooks/gate.mjs` exits 2 with the blocked message; the same with `git push --force-with-lease origin main` exits 0 (both verified live in the shell)
- [ ] One live Claude Code session: a `git push origin +main` attempt is blocked; feedback still reports node --check failures after an edit (deferred: needs a live Claude Code session)
- [x] Suite wall-clock stays near the ~1.5s baseline: t19b/t19c are pure-function calls and add no waits

---

## Phase 8: timeout reporting (H — F018)

Lands as commit H. Timeout reporting. describeSpawnResult lands in lib.mjs as the fourth export with the F018 decision table (the spawnSync timeout shape rides the error branch on Node 22+ — verified live on v24.14.0); syntaxCheck rides it; the t20 battery pins the table with real files plus constructed shapes.

### Changes Required:

#### 1. scripts/hooks/lib.mjs

Append describeSpawnResult — byte-identical to the design's block.

````
/**
 * Turn one spawnSync result into the { ok, detail } verdict the feedback hook reports.
 *
 * Branch order is the F018 fix, and it follows Node's real spawnSync shapes: a timeout
 * sets error (ETIMEDOUT) alongside status=null and a signal, so the timeout shape is
 * checked inside the error branch first — the timeout reports as a timeout, and a plain
 * spawn failure still surfaces its own message. Then a clean exit, then a signal kill
 * without an error (reported as a kill, never claimed as a timeout), then the ordinary
 * non-zero exit with its stderr, and the bare exit code only when stderr is empty.
 * The "after 10s" wording mirrors syntaxCheck's 10s budget — the only caller.
 */
export function describeSpawnResult(result) {
  if (result.error) {
    if (result.status === null && result.signal) {
      return { ok: false, detail: `timed out after 10s (signal ${result.signal})` };
    }
    return { ok: false, detail: result.error.message };
  }
  if (result.status === 0) return { ok: true, detail: "syntax ok" };
  if (result.status === null && result.signal) {
    return { ok: false, detail: `killed by ${result.signal} before exit` };
  }
  const stderr = result.stderr?.toString().trim() ?? "";
  return { ok: false, detail: stderr.length > 0 ? stderr : `exit code ${result.status}` };
}
```
````

#### 2. scripts/hooks/feedback.mjs

FB8-1, FB8-2: the lib import grows describeSpawnResult; syntaxCheck rides the helper.

````
Slice 8 hunks (anchors are POST-Slice-7 regions — FB8-1 anchors the FB1 import line, FB8-2 anchors syntaxCheck, byte-identical from 829c948 through Slice 7):

FB8-1 — the lib import grows describeSpawnResult (F018). Replace, extent-exact:

```
import { isHookInvocation, parseHookStdin, readHookField } from "./lib.mjs";
```

with:

```
import { describeSpawnResult, isHookInvocation, parseHookStdin, readHookField } from "./lib.mjs";
```

FB8-2 — syntaxCheck rides the helper (F018). Replace, extent-exact:

```
export function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], { timeout: 10_000 });
  if (result.error) return { ok: false, detail: result.error.message };
  if (result.status === 0) return { ok: true, detail: "syntax ok" };
  const stderr = result.stderr?.toString().trim() ?? "";
  return { ok: false, detail: stderr.length > 0 ? stderr : `exit code ${result.status}` };
}
```

with:

```
export function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], { timeout: 10_000 });
  // The spawnSync decision table lives in describeSpawnResult (lib.mjs): the timeout is
  // named as a timeout there instead of surfacing raw ETIMEDOUT noise (F018).
  return describeSpawnResult(result);
}
```
````

#### 3. tests/test.mjs

Slice 8 hunks T8-1, T8-2: imports grow; the t20 battery appended after t19c (appends end here).

````
Slice 8 hunks (T8-T2; anchors are the POST-Slice-7 regions — T8-1 anchors the Slice 7 T1 import tail, T8-2 anchors the T2 t19c tail, both verbatim as emitted above):

T8-1 — imports (F018). Replace, extent-exact:

```
import { reportFailure } from "../report.ts";
import { evaluate } from "../scripts/hooks/gate.mjs";
import { isHookInvocation, parseHookStdin, readHookField } from "../scripts/hooks/lib.mjs";
```

with:

```
import { reportFailure } from "../report.ts";
import { syntaxCheck } from "../scripts/hooks/feedback.mjs";
import { evaluate } from "../scripts/hooks/gate.mjs";
import {
  describeSpawnResult,
  isHookInvocation,
  parseHookStdin,
  readHookField,
} from "../scripts/hooks/lib.mjs";
```

T8-2 — the t20 battery, appended after t19c (the file tail; Slice 9 adds no tests — appends end here). Replace, extent-exact:

```
  assert(
    readHookField(undefined, "command") === undefined,
    "t19c: a missing payload returns undefined",
  );
}
```

with:

```
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
```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] The t20 battery lands: `grep -c "t20:" tests/test.mjs` returns 7
- [x] The timeout shape is pinned: `grep -n "timed out after 10s (signal SIGTERM)" tests/test.mjs` matches, and `grep -n "killed by SIGTERM before exit" tests/test.mjs` matches
- [x] syntaxCheck rides the helper: `grep -n "describeSpawnResult(result)" scripts/hooks/feedback.mjs` matches, and the old inline chain is gone: `grep -n "result.error) return" scripts/hooks/feedback.mjs` returns nothing
- [x] describeSpawnResult is lib.mjs's fourth export: `grep -c "^export" scripts/hooks/lib.mjs` returns 4, and `grep -nE "^import" scripts/hooks/lib.mjs` returns nothing
- [x] All four names ride both consumer imports: `grep -c "describeSpawnResult" scripts/hooks/feedback.mjs` returns 3 (import, pointer comment, call), and `grep -c "describeSpawnResult({` tests/test.mjs` returns 4 (the battery's four constructed-object calls)
- [x] Real-file checks ride spawnSync: `grep -n "syntaxCheck(" tests/test.mjs` matches exactly 2 call sites (valid + broken)
- [x] Untouched regions: no hunk touches config.ts, advisor.ts, guard.ts, index.ts, plan-turn.ts, prompt.ts, report.ts, config.json, gate.mjs, README.md, .agents/*, or any existing test banner; every t19/t19b/t19c verdict is unchanged

#### Manual Verification:
- [x] Timeout shape sanity: a spawnSync probe with a tiny timeout shows error=ETIMEDOUT + status=null + signal=SIGTERM on Node 22+ (the shape the error branch expects) — verified live on v24.14.0 during implement
- [ ] One live Claude Code session: feedback still reports node --check failures after an edit (the Slice 7 dispatch shape is unchanged) (deferred: needs a live Claude Code session)
- [x] Suite wall-clock stays near the ~1.5s baseline: t20 adds two fast node --check spawns and no waits

---

## Phase 9: CI/tooling (I — F012+F013)

Lands as commit I. CI and tooling. package.json declares engines node >=22.6.0 (test script form untouched); .npmrc is born with engine-strict; CI installs from the lockfile with the QUOTED ["22.6.0", "24"] matrix; both hook headers gain the Node-floor note (anchored on text — G1 shifted gate.mjs's header lines).

### Changes Required:

#### 1. package.json

Final content: engines added; nothing else changes.

````
Slice 9 only: engines node ">=22.6.0". Test script form unchanged. Final content:

```json
{
  "name": "advisor-turn-gate",
  "version": "1.0.0",
  "description": "Pi coding-agent extension: a senior-engineer advisor reviews the transcript every N turns.",
  "type": "module",
  "private": true,
  "license": "MIT",
  "engines": {
    "node": ">=22.6.0"
  },
  "scripts": {
    "test": "node --experimental-strip-types tests/test.mjs",
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.6.4",
    "@earendil-works/pi-ai": "^1.4.0",
    "@earendil-works/pi-coding-agent": "^1.4.0",
    "@types/node": "^26.6.6",
    "typescript": "^7.0.2"
  }
}
```
````

#### 2. .npmrc

NEW — one line.

````
Slice 9 only: engine-strict=true. Final content:

```
engine-strict=true
```
````

#### 3. .github/workflows/ci.yml

Final content: npm ci; quoted matrix.

````
Slice 9 only: npm ci; matrix ["22.6.0", "24"] quoted. Final content:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        # Quoted on purpose: YAML types bare scalars (24 -> integer, 22.6 ->
        # float), and node versions must reach setup-node as strings.
        node: ["22.6.0", "24"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      # npm ci, not install: the lockfile is the contract (F012).
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - run: npm run typecheck
```
````

#### 4. scripts/hooks/gate.mjs

G9-1: the Node-floor note, anchored on the header text.

````
G9-1 — Node-floor note (F013). Replace, extent-exact:

```
 * `evaluate` is exported so tests can exercise the decision core without
 * spawning this process.
 *
 * Requires Node.js 22.6 or newer.
 */
```

with:

```
 * `evaluate` is exported so tests can exercise the decision core without
 * spawning this process.
 *
 * Requires Node.js 22.6 or newer. The floor is enforced at install time:
 * package.json declares engines ">=22.6.0" and .npmrc sets engine-strict,
 * so an older Node fails npm install instead of failing at first hook run
 * (F013).
 */
```
```
````

#### 5. scripts/hooks/feedback.mjs

FB9-1: the Node-floor note, anchored on the header text.

````
Slice 9 hunk (the header is untouched by Slices 7/8, so the anchor is byte-identical to on-disk; comment-only — syntaxCheck and the dispatch stay untouched):

FB9-1 — Node-floor note (F013). Replace, extent-exact:

```
 * mode, so .ts files get real syntax feedback.
 *
 * Requires Node.js 22.6 or newer.
 */
```

with:

```
 * mode, so .ts files get real syntax feedback.
 *
 * Requires Node.js 22.6 or newer. The floor is enforced at install time:
 * package.json declares engines ">=22.6.0" and .npmrc sets engine-strict,
 * so an older Node fails npm install instead of failing at first hook run
 * (F013).
 */
```
```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] engines declared exactly: `grep -c '"node": ">=22.6.0"' package.json` returns 1
- [x] Test script form untouched: `grep -n "node --experimental-strip-types tests/test.mjs" package.json` matches
- [x] .npmrc is born with exactly one line: `grep -c "engine-strict=true" .npmrc` returns 1 and `wc -l < .npmrc` returns 1 (the environment's safety net bars every tool from reading or writing the file; verified instead by the maintainer's own command and the commit stat: 1 insertion, content engine-strict=true)
- [x] CI installs from the lockfile: `grep -n "npm ci" .github/workflows/ci.yml` matches, and the old form is gone: `grep -n "npm install" .github/workflows/ci.yml` returns nothing
- [x] The matrix is quoted and complete: `grep -nF '"22.6.0", "24"' .github/workflows/ci.yml` matches, and `grep -nF 'node-version: ${{ matrix.node }}' .github/workflows/ci.yml` matches
- [x] Node-floor notes land in both hook headers: `grep -c "Requires Node.js 22.6 or newer" scripts/hooks/gate.mjs scripts/hooks/feedback.mjs` returns 1 for each file, and `grep -n "enforced at install time" scripts/hooks/gate.mjs scripts/hooks/feedback.mjs` matches both
- [x] Hook behavior is untouched: tests/test.mjs carries no Slice 9 hunks (this slice adds no tests), and the t19/t19b/t19c/t20 batteries pass unchanged
- [x] Untouched regions: no hunk touches config.ts, advisor.ts, guard.ts, index.ts, plan-turn.ts, prompt.ts, report.ts, config.json, scripts/hooks/lib.mjs, tests/test.mjs, README.md, AGENTS.md, .agents/*, or any existing test banner; every t1-t20 verdict is unchanged

#### Manual Verification:
- [x] Clean strict install: `rm -rf node_modules && npm ci` succeeds with engine-strict active (the lockfile is the only input) — run during implement, exit 0
- [x] Local floor holds: `node --version` reports 22.6.0 or newer (v24.14.0)
- [ ] Matrix reality: the next push renders two CI jobs (Node 22.6.0 and 24), both green (deferred: needs a push; the quoted matrix is in place at ci.yml:14)
- [x] Gate still blocks: `echo '{"tool_input":{"command":"git push origin +main"}}' | node scripts/hooks/gate.mjs` exits 2 with the blocked message — re-verified after npm ci

---

## Phase 10: prose docs pass (J — F010/F011/F019)

Lands as commit J. The prose docs pass. main.md gets valid frontmatter (corrected five-pattern glob set), the real test path plus both hooks entries, and npm test; AGENTS.md's fence runs npm test; README grows the seven-field Config table and activation-first setup; SKILL.md matches the seven-field reality; TECH_DEBT_AUDIT.md is formatted, stamped (four boxes), and committed.

### Changes Required:

#### 1. README.md

R1: activation framing + the seven-field table (pre-aligned to biome output — paste verbatim).

````
R1 — Setup activation framing + the seven-field Config table (F019). Replace, extent-exact:

    ## Setup

    1. Set `model` in `config.json` to `provider/modelId`.
    2. Set `interval` to the number of turns between advisor calls.

with:

    ## Setup

    The gate ships disabled: `model` is empty by default, and an empty model skips the
    advisor call entirely. To activate the gate:

    1. Set `model` in `config.json` to `provider/modelId`.
    2. Set `interval` to the number of turns between advisor calls.

    ## Config

    `config.json` is read on every turn, so changes apply without a reload. A field that
    is absent or wrong-typed falls back to the default below. Out-of-range numbers are
    clamped into range, with a one-time warning.

    | Field          | Default               | Meaning                                                                                  |
    | -------------- | --------------------- | ---------------------------------------------------------------------------------------- |
    | `enabled`      | `true`                | Master switch. `false` skips the advisor call and the continuation entirely.             |
    | `interval`     | `2`                   | Advisor runs on the first completed turn at or past each N-turn boundary. Clamped 1-100. |
    | `model`        | `""` (disabled)       | `provider/modelId` of the advisor model. Empty or unparseable disables the gate.         |
    | `timeoutMs`    | `60000`               | Advisor call budget in milliseconds. Clamped 1000-60000.                                 |
    | `systemPrompt` | code default          | Optional override, not shipped — the code default is the single source.                  |
    | `customType`   | `"advisor-turn-gate"` | The committed guidance entry's custom type.                                              |
    | `display`      | `true`                | Whether the committed entry renders in the TUI transcript.                               |

(The Verify and License sections stay byte-identical. The table above is pre-aligned
to `npx biome format --stdin-file-path=README.md` output — paste it verbatim and
`npm run lint` stays green.)

```
````

#### 2. AGENTS.md

A5: the Build-and-test fence runs npm test.

````
A5 — fence command (F011). In the Build-and-test fence, replace the content line, extent-exact:
    node --experimental-strip-types test.mjs
with:
    npm test
````

#### 3. .agents/rules/main.md

M3-M5: corrected frontmatter globs, real test path + hooks entries, npm test.

````
M3 — valid frontmatter, corrected glob set (F010). Replace, extent-exact:
    applyTo:
    - "*.ts"
    - "*.mjs"
    - "*.md"
      glob:
    - "src/**"
    - "test/**"
with:
    applyTo:
    - "*.ts"
    - "*.mjs"
    - "*.md"
    - "tests/**"
    - "scripts/hooks/*.mjs"

M4 — real test path + the hooks entries AGENTS.md already carries (F011). Replace, extent-exact:
    - `test.mjs` — offline unit tests.
with:
    - `tests/test.mjs` — offline unit tests.
    - `scripts/hooks/gate.mjs` — PreToolUse gate hook. Blocks catastrophic Bash commands.
    - `scripts/hooks/lib.mjs` — shared hook plumbing: invocation detection, stdin parse, field read.
    - `scripts/hooks/feedback.mjs` — PostToolUse hook. Runs `node --check` on edited JS and TS files.

M5 — Tests command (F011). Replace, extent-exact:
    - Run with `node --experimental-strip-types test.mjs`.
with:
    - Run with `npm test`.

```
````

#### 4. .agents/skills/advisor-turn-gate/SKILL.md

K1: the second F019 instance.

````
K1 — Config section: the second F019 instance, matching the seven-field reality and the ship-empty posture. Replace, extent-exact:

    ## Config

    Set `model` and `interval` in `config.json`. The model must be `provider/modelId`.

with:

    ## Config

    All seven config fields live in `config.json`. The README documents each field with
    its default. The gate ships disabled: set `model` to `provider/modelId` to activate it.
```
````

#### 5. TECH_DEBT_AUDIT.md

T1-T5: biome format pass first, then the four stamps, then commit (the file is untracked today).

````
T1 — format pass (the Decision's "formats it"). Mechanical command, not hand hunks:

    npx biome check --write TECH_DEBT_AUDIT.md

Verified against biome 2.6.4 at this tree: the pass changes exactly two regions —
the Findings table (:29-50) is re-aligned column by column, and :101 normalizes the
emphasis `*output*` to `_output_`. No other line changes, in particular none of the
Quick wins lines (:81-:90).

T2 — stamp (F011, fixed in this commit). Replace, extent-exact:
    - [ ] F011: fix the test command in AGENTS.md:41 and .agents/rules/main.md:35 (one-line edits)
with:
    - [x] F011: fix the test command in AGENTS.md:41 and .agents/rules/main.md:35 (one-line edits)

T3 — stamp (F010, fixed in this commit). Replace, extent-exact:
    - [ ] F010: repair the malformed frontmatter in .agents/rules/main.md:4-10
with:
    - [x] F010: repair the malformed frontmatter in .agents/rules/main.md:4-10

T4 — stamp (F015, fixed in Slice 1). Replace, extent-exact:
    - [ ] F015: fix or footnote the dangling `.rpiv/artifacts` reference
with:
    - [x] F015: fix or footnote the dangling `.rpiv/artifacts` reference

T5 — stamp (F019, fixed in this commit). Replace, extent-exact:
    - [ ] F019: document the other five config fields in the README
with:
    - [x] F019: document the other five config fields in the README

Order: format first (T1), then the stamps (T2-T5; the quick-win lines are untouched
by formatting), then commit. Implement adds the file to git in commit J (untracked
today).

```
````

### Success Criteria:

#### Automated Verification:
- [x] Boundary green: `npm test`, `npm run lint` (tracked-file scope), `npm run typecheck` all pass
- [x] Audit file formatted: `npx biome check TECH_DEBT_AUDIT.md` exits 0
- [x] Exactly four stamps: `grep -c "^- \[x\]" TECH_DEBT_AUDIT.md` returns 4, and six boxes stay open: `grep -c "^- \[ \]" TECH_DEBT_AUDIT.md` returns 6
- [x] The stamped four are the docs pass: `grep -n "^- \[x\]" TECH_DEBT_AUDIT.md` matches only the F011, F010, F015, and F019 lines
- [x] Frontmatter carries the corrected set: `grep -nF '"tests/**"' .agents/rules/main.md` and `grep -nF '"scripts/hooks/*.mjs"' .agents/rules/main.md` both match, and the dead nest is gone: `grep -n "glob:" .agents/rules/main.md` returns nothing
- [x] main.md Files list carries the real path and all three hook entries (triage-amended: lib.mjs added): `grep -c "scripts/hooks/" .agents/rules/main.md` returns 4, not the planned 3 — M3's own frontmatter glob "scripts/hooks/*.mjs" also matches the pattern, an arithmetic slip in the criterion, not a missing entry (all three Files lines verified present); the bare name is gone: `grep -nF '`test.mjs`' .agents/rules/main.md` returns nothing
- [x] main.md command fixed: `grep -nF 'Run with `npm test`' .agents/rules/main.md` matches, and the broken raw form is gone from all docs: `grep -rnF 'experimental-strip-types test.mjs' README.md AGENTS.md .agents/` returns nothing (tests/test.mjs:3 and package.json:9 keep the raw form by design and sit outside this grep set)
- [x] AGENTS.md fence runs npm test: `grep -c "npm test" AGENTS.md` returns 2 (the Files line and the fence), and `grep -n "experimental-strip-types" AGENTS.md` returns nothing
- [x] README table: `grep -c "^| \`" README.md` returns 7, and activation-first setup: `grep -n "ships disabled" README.md` matches
- [x] SKILL.md matches the seven-field reality: `grep -n "ships disabled" .agents/skills/advisor-turn-gate/SKILL.md` matches, and the old two-field line is gone: `grep -nF 'Set \`model\` and \`interval\`' .agents/skills/advisor-turn-gate/SKILL.md` returns nothing
- [x] Untouched regions: no hunk touches any .ts or .mjs source, any test banner, or the README Verify and License sections; every t1-t20 verdict is unchanged

#### Manual Verification:
- [x] Frontmatter paste-through: the main.md frontmatter block parses under a YAML parser (yaml.safe_load), and applyTo equals the five-pattern corrected set
- [x] Every documented command executes verbatim: `npm install` (exit 0 — it drifted package-lock.json under Node 24, drifted stashed, not committed), `npm test`, `npm run lint` (executes; exits 1 on the untracked .rpiv artifacts per the standing tracked-file scope decision), `npm run typecheck` (README Verify), `npm test` (AGENTS.md fence and main.md Tests)
- [ ] One live Claude Code session confirms the documented behavior at the docs SHA: the gate blocks `git push origin +main` and feedback reports node --check failures (deferred: needs a live session; both behaviors verified directly via stdin round-trips in implement)
- [x] TECH_DEBT_AUDIT.md is tracked: `git ls-files TECH_DEBT_AUDIT.md` returns the path after commit J

---
## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 5 §3 (tests/test.mjs) | biome.json:9 (lineWidth 100) | blocker | actionability | S5-T4's notify arm pastes the resolve override as one ~104-char line at 8-space indent — over biome's lineWidth 100 — so `npm run lint` fails at Phase 5's own Boundary-green criterion and the byte-exact fence cannot land as written (line measured at 104 chars in the design's S5-T4). | Re-paste the override in biome's expanded form (`gateArgs({` / `resolve: () => ({ ok: false, reason: '...' }),` / `}),`) before transplant. | applied (plan-local; design follow-up: the design's S5-T4 hunk carries the same 104-char line — Phase 5's notify arm re-wrapped to biome's expanded form in this plan) |
| code | Phase 2 (AGENTS.md A1) | .agents/rules/main.md:26 | concern | codebase-fit | A1 rewords the model-key Files line only in AGENTS.md; main.md's twin at :26 still reads "the model-key codec" after modelKey dies, and no Phase 2 or Phase 10 hunk owns it — the same unowned-twin-line gap class the design ratified an amendment for at its Slice 4 checkpoint. | Add a .agents/rules/main.md hunk to Phase 2 rewording :26 to "the model-key parser" as the twin of A1. | applied (plan-local; design follow-up: Phase 2 §4 adds the main.md:26 twin hunk — the design's Slice 2 Files list should gain .agents/rules/main.md) |
| code | Phase 1 §1 (config.json) | config.json:3 | concern | codebase-fit | The fence ships `"interval": 5` where HEAD ships `"interval": 3`, silently changing a third field while the prose claims behavior identical for every field except model — and 5 is itself a non-default personal value (the code default and the Phase 10 README table both say 2). | Set `"interval": 3` in the Phase 1 fence so the shipped config matches HEAD and the bit-identical claim holds. | applied (plan-local; design follow-up: the design's config.json fence ships interval 5 — the plan ships 3 = HEAD, so only model changes) |
| code | Phase 2 §2 (tests/test.mjs) | <n/a> | suggestion | code-quality | S2-H7's `const infinite = withConfig('{"interval": 1e999}', () => loadConfig());` runs outside captureWarn while withConfig re-arms the latch, so the clamp warning prints into suite output unlike every sibling case in the same battery. | Wrap the infinite case in captureWarn and assert `length === 1` like the lowWarns/truncWarns blocks. | applied (plan-local; design follow-up: S2-H7's Infinity case wrapped in captureWarn with a 1-warn assert) |
| code | Phase 10 §3 (.agents/rules/main.md) | .agents/rules/main.md:26-31 | suggestion | codebase-fit | After M4 the twin Files lists diverge: A4 adds the lib.mjs line to AGENTS.md but main.md's list ends at gate.mjs/feedback.mjs, and the Slice 10 criterion pins `grep -c "scripts/hooks/"` at exactly 2, baking in the omission. | Add the lib.mjs Files line to main.md in Phase 10 and bump that criterion to 3. | applied (plan-local; design follow-up: M4 gains the lib.mjs twin line, mirroring AGENTS.md order; criterion bumped 2 → 3) |

_Coverage review (artifact-coverage-reviewer): full coverage — all 7 actionable Verification Notes land; all 10 Success Criteria blocks byte-identical to their design slices; frontmatter phases match body order, files, and the strictly-serial chain; all 13 decisions and 8 ordering constraints land. No findings._
## Testing Strategy

### Automated:
- At every phase boundary run the trio: npm test, npm run lint, npm run typecheck. Commit only on green. About 31 trio invocations across the series; each takes seconds.
- Per-phase grep and behavior criteria live in each phase's Automated Verification block; implement runs them in its shell and flips the checkboxes. validate re-runs them agent-side over the whole finished plan.

### Manual Testing Steps:
1. Phase 3 is red-first: land the t16b test, run npm test, observe the expected FAIL line, confirm the exit handler (tests/test.mjs:76-79) stays clean, then apply the advisor.ts move and re-run to green.
2. Anchor every test edit by banner name (t1-t20) and section comment, never by the stale 829c948 line numbers. Two drifts are already verified (:76-79, :376-404).
3. The suite is offline and bounded near 1.5s (tests/test.mjs:621-639 wait bounds); any phase that pushes it past ~5s is wrong.
4. Phase 4 manual: one live pi session — no ALS line at load; a subagent session stays inert with the marker veto alone.
5. Phase 10 manual: paste the fixed frontmatter through a YAML parser; execute every documented command verbatim; one live Claude Code session confirms the gate blocks +main and feedback reports node --check failures.
6. Hook activation is local-only (git config core.hooksPath .githooks). The executor's explicit trio is the real gate either way.

## Performance Considerations

- Laziness is preserved: off-cadence turns invoke no thunks (no child scan, no parse, no resolve) — planGate controls evaluation order, matching today's short-circuit economics.
- The single shared warn-once latch adds no per-turn cost (one boolean read).
- No new regex hot paths: the F009 normalization runs once per gate invocation on the command string.
- Suite wall-clock stays bounded: new F001 test waits 5x a 50ms deadline; F006/F007 batteries are pure-function calls.

## Migration Notes

None. No persisted schema changes. config.json loses two fields; the code fallbacks (config.ts:145-148 and DEFAULT_CONFIG) make the removal backwards-safe for any existing checkout. Rollback strategy: each slice is one commit; `git revert <sha>` restores any boundary independently.

## Developer Context

- Plan-level reconciliation 1 (Phase 5): plan-turn.ts is written at its born state — the design's final block minus the eight F007 elements, which Phase 6 re-adds verbatim (P6-PT1..P6-PT8). The design's Architecture section presents only the final-state block; the born state is forced by Phase 5's own Success Criteria (the t9 battery passes no latch fields; tsc strict). Flagged for developer review.
- Plan-level reconciliation 2 (Phase 7): lib.mjs is born with three exports (the design's block truncated before describeSpawnResult); Phase 8 appends the function verbatim. Forced by Slice 7's three-export criterion.
- All hunks are transplanted byte-exact from the design artifact; anchors are banner- and text-based by design (the audit's line numbers drifted; the design says anchor by banner, never by line).
- Step 4 reviews: coverage reviewer returned full coverage with no findings; code reviewer returned 1 blocker, 2 concerns, 2 suggestions (see Plan Review). Phases 3, 4, 6, 7, 8, 9 clean; both born-state reconciliations audited correct and complete.
- The design carries ten slice-verifier approvals (see its Design History); plan recomposes nothing.

## References

- Design: .rpiv/artifacts/designs/2026-10-29_13-41-09_tech-debt-series-slices.md
- Execution shape: .rpiv/artifacts/solutions/2026-10-29_13-20-12_tech-debt-series-execution-shape.md
- Commit plan: .rpiv/artifacts/solutions/2026-10-29_12-55-09_tech-debt-fix-execution-strategy.md
- Research: .rpiv/artifacts/research/2026-10-29_11-16-22_tech-debt-fixes.md
- Original findings: TECH_DEBT_AUDIT.md
- Test banner map: tests/test.mjs (t1-t20 anchors every edit)
