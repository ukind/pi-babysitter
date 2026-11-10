---
date: 2026-11-10T10:35:12+0700
author: Yogiswara Utama
commit: 4af3ccb
branch: main
repository: advisor-turn-gate
topic: "Reasoning effort config for the advisor and specialist calls"
tags: [research, codebase, config, advisor, specialist, reasoning-effort, eval, warn-latch]
status: ready
last_updated: 2026-11-10T10:35:12+0700
last_updated_by: Yogiswara Utama
---

# Research: Reasoning effort config for the advisor and specialist calls

## Research Question

Add two config.json fields that set the reasoning effort of the advisor call and the specialist consult call. The host library already accepts the option. The extension never passes it. Absent or invalid values omit the key entirely, so today's behavior stays the default.

## Summary

The feature is a four-file vertical slice: `config.ts` (two fields, one validator, one per-field latch), `index.ts` (two forwarding sites), `advisor.ts` (two options objects, one type narrowing), plus docs and tests. Nothing exists in the tree today — `reasoningEffort` appears only in the two FRD artifacts.

Five findings change the shape of the work:

1. **The shared warn latch cannot be re-keyed.** Five existing pins assert that two clamped fields produce exactly one warning. The per-field latch must be a second, separate structure.
2. **The accepted-level list must be duplicated, not imported.** `THINKING_LEVELS` is not re-exported from the pi-ai root barrel. Only the `./providers/*` subpath reaches it, and the repo contract is `import type` only. The `ThinkingLevel` *type* is re-exported, so the type may be imported.
3. **The host clamp lives one layer lower than the FRD says.** `ModelRuntime.completeSimple` does not clamp. The API adapter clamps at `openai-completions.js:508`. The net effect holds, but the guarantee is owned by the adapter.
4. **The eval harness is a second, untyped forwarding site.** `eval/runner.mjs:279` rebuilds the specialist object independently. The FRD never names it.
5. **No existing test can see the options object.** Every stub ignores the third argument. The key-absence contract needs a new pin that captures it.

## Detailed Findings

### Config layer — the two fields and the latch split

`AdvisorGateConfig` (`config.ts:6-43`) holds 18 fields. `DEFAULT_CONFIG` (`config.ts:45-80`) holds their defaults. `loadConfig` (`config.ts:204`) narrows each field with a one-line `typeof parsed.X === "T" ? ... : DEFAULT_CONFIG.X` arm inside the return literal (`config.ts:216-297`). The catch arm returns `{ ...DEFAULT_CONFIG }` (`config.ts:304`).

The nearest precedents for the new arms are `specialistModel` (`config.ts:287-290`) and `specialistSystemPrompt` (`config.ts:291-294`). Both use `""` as the valid unset state. `model` (`config.ts:48`) and `specialistModel` (`config.ts:73`) both trim.

The latch is one module-level boolean. `configWarned` sits at `config.ts:101`. `warnOnce` sits at `config.ts:103-107`. `resetWarnOnceForTest` sits at `config.ts:114-116` and is the only re-arm surface. `withConfig` calls it at entry (`tests/helpers.mjs:41`).

Three callers ride that boolean: `clampWithWarn` (`config.ts:132-141`), the model-format warning (`config.ts:211-215`), and the broken-config catch (`config.ts:302`).

Five pins assert the shared-latch behavior. Each asserts `warns.length === 1` for two clamped fields in one read: `tests/suites/config.mjs:169-171` (t5), `tests/suites/triggers.mjs:210` (t21c), `tests/suites/prompt.mjs:443` (t22c), `tests/suites/memory.mjs:250` (t23c), `tests/suites/tools.mjs:515` (t25c).

**Consequence.** Re-keying `warnOnce` to `warnOnce(key, message)` breaks all five. `clampWithWarn` would have to pass one shared key to keep them green, which reproduces the same two-tier structure with a changed signature at three call sites. A separate `Set<string>` consulted only by the two new validators is the minimal change. `resetWarnOnceForTest` must clear both the boolean and the set, or a warning tripped in one fixture window suppresses the same field in the next.

The `memory.ts` precedent supports a second private latch in the same module family. `TECH_DEBT_AUDIT.md:138` records duplicated latches as the accepted price of plain-node loadability.

### The accepted-level list and the star topology

The canonical tuple is `THINKING_LEVELS` at `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:2` — `readonly ["minimal","low","medium","high","xhigh","max"]`. The runtime value sits at `dist/providers/model-schema.js:3`. The type alias `ThinkingLevel` sits at `model-schema.d.ts:79`. A seven-value sibling `MODEL_THINKING_LEVELS` adds `"off"` at `model-schema.d.ts:3`.

The type is re-exported from the package root (`dist/types.d.ts:18`). The value is not. `dist/index.js` re-exports `./models.js` and `./types.js` but never `./providers/model-schema.js`. `dist/types.js:1` is `export {};`. The only runtime route is the `"./providers/*"` subpath declared at `node_modules/@earendil-works/pi-ai/package.json:26-29`.

That subpath is closed to this repo for two reasons. `advisor.ts:1` is `import type` only, and the banner at `advisor.ts:3-15` states the rule. `package.json:20-25` lists pi-ai under `devDependencies` only, and the project ships zero runtime npm dependencies.

**Consequence.** The list is declared twice: once in `config.ts` as the validator's accepted set, once in `advisor.ts` for the type and the parity pin. Only a validated member crosses the boundary, and it crosses through the hub `index.ts`, the one module allowed to import both spokes.

The precedent is `DEFAULT_MAX_TOOL_ROUNDS` at `advisor.ts:47-53`. It is private, and its comment names the pin. The pin is two independent literal assertions, not a cross-module comparison: `tests/suites/tools.mjs:337` (behavioural) and `tests/suites/tools.mjs:517` (literal).

One refinement is available. `advisor.ts` does not need a runtime array to satisfy the type requirement. `import type { ThinkingLevel } from "@earendil-works/pi-ai"` is legal under the existing contract and resolves through `types.d.ts:18`. In that shape the only duplicated runtime list is `config.ts`'s.

The type narrowing is load-bearing beyond tidiness. `getRuntimeCompleteSimple` casts the bound host method with `as CompleteSimpleFn` (`advisor.ts:194`). The local options type declares `reasoning?: string` (`advisor.ts:26`), which is wider than the host's `reasoning?: ThinkingLevel` (`dist/types.d.ts:236`). The cast therefore launders an out-of-union value past `tsc` today.

### The advisor call site and the omit-key contract

`index.ts:202-219` builds one `advisorArgs` literal. It serves both fire modes: the async branch at `index.ts:236` and the blocking branch at `index.ts:266`. The comment at `index.ts:197-201` states the invariant — the branch decides how the call runs, never what it sends.

`runAdvisor` declares its params at `advisor.ts:457-478`. No `reasoning` field exists there today. The loop starts at `advisor.ts:504`. The options object is rebuilt every round inside the `callWithDeadline` closure at `advisor.ts:514-522`, and the literal is `{ signal }` at `advisor.ts:519`.

**The omit-key idiom.** `{ signal, reasoning: params.reasoning }` always creates an own key, even when the value is `undefined`. Requirement 4 forbids that. The correct form is a conditional spread. The precedent already exists in this repo: `plan-turn.ts:26-30` uses `...(details === undefined ? {} : { details })` with a comment that a literal `details: undefined` would still create the key, and t24 pins its absence.

The predicate should be `!== undefined` rather than truthiness, because the config layer normalizes empty to the unset sentinel. Both work; `!== undefined` keeps the type honest.

**Why the t16 pins stay green.** The stub at `tests/suites/advisor.mjs:226` is `() => Promise.resolve(response)`. It takes no parameters. The call at `tests/suites/advisor.mjs:227-233` passes no `reasoning`. With the conditional spread the options object is exactly `{ signal }`, and the assert at `tests/suites/advisor.mjs:234` checks only the outcome.

**Why no existing pin can catch a regression.** Every stub ignores the third argument: `tests/suites/advisor.mjs:226`, `:424`, `:505`, `:565`, and `eval/runner.mjs:190`. A grep for `options` across `tests/suites/advisor.mjs` returns zero matches. A regressed `{ signal, reasoning: undefined }` would leave every outcome unchanged.

### The specialist leg

`SpecialistConfig` is `{ model: Model<Api>; systemPrompt: string }` at `advisor.ts:119-122`. `runConsultLeg` (`advisor.ts:379`) builds its options as `{ signal }` at `advisor.ts:405`. It has one call site (`advisor.ts:556`) and is not exported.

`index.ts:180-195` builds the `SpecialistConfig` at fire time, behind an `if (config.specialistModel)` gate, then `parseModelKey` and `resolveAdvisorModel`. The object literal is at `index.ts:189-192`. A failed parse or resolution passes no specialist, so the fire commits base-only advice.

The t26 pins at `tests/suites/advisor.mjs:471-480` assert the leg's model, system prompt, single user message, and `tools === undefined`. They never touch the options object.

**Consequence.** Adding `reasoning` to `SpecialistConfig` requires four runtime edits, and the FRD names two. The other two are `runAdvisor`'s params type (`advisor.ts:457-478`, which has no `reasoning` field, so TS excess-property checking rejects the `advisorArgs` literal) and `CompleteSimpleFn` (`advisor.ts:26`).

The specialist level is inert without `specialistModel`. The live `config.json` on disk carries no specialist keys at all.

### The host clamp — what actually happens to an unsupported level

`clampThinkingLevel` sits at `node_modules/@earendil-works/pi-ai/dist/models.js:706-724`. It calls `getSupportedThinkingLevels` (`:694-705`), which returns `["off"]` outright when `model.reasoning` is false (`:695-696`), filters `EXTENDED_THINKING_LEVELS` (`:693`) against `model.thinkingLevelMap`, rejects any level mapped to `null` (`:699-700`), and requires an explicit mapping for `xhigh` and `max` (`:701-702`). The clamp then walks forward (`:713-717`), backward (`:718-722`), and falls back to `availableLevels[0] ?? "off"` (`:723`).

**The clamp is not in the runtime facade.** `ModelRuntime.completeSimple` (`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:524-525`) delegates to `streamSimple`. The physical-model branch (`:516-521`) calls `prepareRequest` (`:452-484`), which spreads the caller's options through untouched. The clamp runs in the API adapter at `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:508` — `options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined` — before `buildParams` builds the body.

The net effect the FRD relies on holds. The guarantee is owned by the adapter, not by the facade the extension reaches.

The live model `stepfun/step-5-preview` maps `off`, `minimal`, `xhigh`, and `max` to `null` in `node_modules/@earendil-works/pi-ai/dist/providers/data/openrouter.json`. Its supported set is `["low","medium","high"]`. So `minimal` clamps to `low`, and `xhigh` and `max` both clamp to `high`. Three of the six accepted levels are no-ops on that model.

**The unset case answers the developer's original question.** With no `reasoning` option, `openai-completions.js:508` short-circuits to `undefined`, `:509` keeps it `undefined`, and the OpenRouter branch at `:666-677` falls to `:674` — where `thinkingLevelMap.off` is `null`, so the condition is false and no `reasoning` field is sent. Today the extension sends nothing and OpenRouter applies its own default.

**The failure mode if the clamp did not run.** The mapper at `openai-completions.js:671` is `model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort`. A `null` map entry falls back to the requested string, so an unclamped `minimal` would be sent verbatim to a model that marks it unsupported.

**The config set is six, the clamp domain is seven.** `clampThinkingLevel` takes `ModelThinkingLevel` (`dist/models.d.ts:272`), which includes `"off"`. The config must validate against the six. Accepting `"off"` would be indistinguishable from an absent field, because `:509` converts `"off"` to `undefined`.

### The eval harness as a second forwarding site

`eval/runner.mjs` never calls `loadConfig`. It builds the config at `eval/runner.mjs:261` with `{ ...DEFAULT_CONFIG, ...fixture.config }` — a blind spread, the exact pattern `config.ts:196-197` forbids for `loadConfig`.

It then mirrors the `index.ts` seam independently. The specialist build is at `eval/runner.mjs:272-281`, with the object literal at `:279`. The `runAdvisor` args are at `eval/runner.mjs:318-330`. The runner's own contract claims the mirror is exact (`eval/runner.mjs:9-13`).

The mirror already diverges once: `signal` is present at `index.ts:208` and absent from `eval/runner.mjs:318-330`. That omission is justified — a replay has no `ctx.signal`. A `reasoning` omission would not be, because the value is available as `config.reasoningEffort`.

**Why the fixtures stay byte-identical regardless.** `makeFacade` at `eval/runner.mjs:190` declares `(_model, context)` and captures only `context.messages`. It never reads the third argument. A `reasoning` option changes neither the call count nor the call order, so `outcome.text` and every committed entry are unchanged.

**Consequence for `DEFAULT_CONFIG`.** The blind spread means the default's value flows straight into `runAdvisor` in the eval. It must be the unset sentinel, not a real level. A real level would make every eval fixture send a level that production never sends for an absent field.

**The eval cannot exercise validation.** A fixture declaring `"reasoningEffort": "ultra"` would forward `"ultra"` straight to the facade, because `replayFixture` has no validator. The validation path lives only in `tests/suites/config.mjs` through `withConfig` and `captureWarn`.

**The residual gap.** `index.ts` is imported by nothing. Its extensionless sibling imports do not resolve under plain node (`config.ts:190-193` documents the same constraint). So the two forwarding lines the FRD names have zero executable coverage. The eval mirror is the only executable stand-in, and it is untyped `.mjs`.

### The seam question — planGate or the advisorArgs literal

Two seams already exist in `index.ts`, and the split is chronological rather than principled.

`systemPrompt` and `timeoutMs` predate the `plan-turn.ts` extraction, so they ride the core: `index.ts:93-97` → `PlanGateArgs` (`plan-turn.ts:84-112`) → the consult arm of `GateDecision` (`plan-turn.ts:72-81`) → `plan-turn.ts:162-168` → `index.ts:204-207`. `planGate` never reads either value for a decision. It copies them through.

Every field added after the extraction reads `config.*` at the I/O layer: `toolsEnabled` (`index.ts:212-215`), `maxToolRounds` (`index.ts:216`), `specialist` (`index.ts:180-195`, consumed at `:218`), `asyncMode` (`index.ts:226`), `customType` and `display` (`index.ts:284-285`), `memoryCap` (`index.ts:245`, `:273`).

**Determination: the literal.** `reasoningEffort` is a call option of the `maxToolRounds` class. Threading it through the core adds two hops that read it zero times, and requires seven edits: `PlanGateArgs`, the `GateDecision` consult arm, the `planGate` return, `tests/helpers.mjs:73-90`, the inline duplicate at `tests/suites/config.mjs:64-82`, the third copy at `eval/runner.mjs:285-310`, and a new `tests/suites/gate.mjs` assertion. The literal needs one line.

The counter-argument is recorded: the literal is untestable offline, while a core field would get a free pin in the consult-arm test at `tests/suites/gate.mjs:138-156`. That is equally true of `maxToolRounds` and `specialist` today, and the suite covers those by calling `runAdvisor` directly.

**Fire-time versus re-read.** `loadConfig()` runs once per dispatch at `index.ts:70`. The literal is built at `index.ts:202`, before the `if (config.asyncMode)` test at `:226`, so the async branch sends the fire-time level. The settle handler re-reads config at `index.ts:313` but consumes only `customType` and `display` (`:316-317`). No settle-handler change is needed.

### Documentation surface

The README config table spans `README.md:23-42`: a header, a separator, and 18 rows in interface declaration order. Column widths are 24 / 21 / 159 content characters.

Column 1 is sized to `\`specialistSystemPrompt\`` (22 chars plus 2 backticks = 24). Column 2 is sized to `\`"advisor-turn-gate"\`` (21). Column 3 is sized to the `memoryCap` meaning cell (159).

**Consequence.** `specialistReasoningEffort` is 25 chars plus 2 backticks = 27, which exceeds 24. Column 1 must grow to 27, so all 20 table lines re-pad. `reasoningEffort` (17 with backticks) is not the driver.

The prose above the table (`README.md:19-21`) covers two doors: absent or wrong-typed falls back silently, and out-of-range numbers clamp with a one-time warning. The new enum-reject door is a third case — present, correctly typed, not in the accepted set. Neither sentence describes it. The "one-time warning" phrase also becomes ambiguous, because the clamp latch is process-wide while the new latch is per field.

`config.example.json` carries 7 keys (`config.example.json:2-8`), a strict prefix of the 18-field interface order. It omits all four trigger fields, `tokenBudget`, `memoryCap`, `toolsEnabled`, `maxToolRounds`, `specialistModel`, `specialistSystemPrompt`, and `asyncMode`. No test reads it. Biome formats it (`biome.json:20-24`). The `systemPrompt` value is a byte-identical copy of `DEFAULT_CONFIG.systemPrompt`.

The declaration-order convention is recorded at `.rpiv/artifacts/research/2026-11-05_13-47-22_advisor-tool-evidence.md:69`.

**Existing drift, four artifacts.** `.agents/skills/advisor-turn-gate/SKILL.md:26` says "All seven config fields" — stale by 11. `TECH_DEBT_AUDIT.md:28` and `:52` say 17 fields — stale by one, because `asyncMode` landed after the audit. `config.example.json` carries 7 of 18. `README.md:29` mentions the example copy for `systemPrompt` while `README.md:41` does not for `specialistSystemPrompt`, because the example has no specialist keys.

## Code References

- `config.ts:6-43` — `AdvisorGateConfig`, 18 fields
- `config.ts:45-80` — `DEFAULT_CONFIG`
- `config.ts:101` — `configWarned`, the single shared latch
- `config.ts:103-107` — `warnOnce`
- `config.ts:114-116` — `resetWarnOnceForTest`, the only re-arm surface
- `config.ts:132-141` — `clampWithWarn` and its message format
- `config.ts:196-197` — the doc comment forbidding a blind spread
- `config.ts:204` — `loadConfig`
- `config.ts:211-215` — the model-format warning
- `config.ts:216-297` — the per-field narrowing return literal
- `config.ts:287-294` — the `specialistModel` and `specialistSystemPrompt` arms
- `config.ts:304` — the catch arm returning `{ ...DEFAULT_CONFIG }`
- `advisor.ts:1` — the type-only pi-ai import
- `advisor.ts:3-15` — the no-sibling-import banner
- `advisor.ts:23-27` — `CompleteSimpleFn`; `reasoning?: string` at `:26`
- `advisor.ts:47-53` — `DEFAULT_MAX_TOOL_ROUNDS` and its parity comment
- `advisor.ts:119-122` — `SpecialistConfig`
- `advisor.ts:187-199` — `getRuntimeCompleteSimple`; the `as CompleteSimpleFn` cast at `:194`
- `advisor.ts:379-421` — `runConsultLeg`; the options literal at `:405`
- `advisor.ts:457-478` — `runAdvisor` params
- `advisor.ts:504` — the `for(;;)` loop
- `advisor.ts:514-522` — the per-round `callWithDeadline` closure; the options literal at `:519`
- `advisor.ts:556` — the single `runConsultLeg` call site
- `index.ts:70` — the single `loadConfig()` per dispatch
- `index.ts:93-97` — the core-threaded fields
- `index.ts:180-195` — the specialist build; the object literal at `:189-192`
- `index.ts:197-201` — the one-literal-two-modes comment
- `index.ts:202-219` — the `advisorArgs` literal
- `index.ts:226` — the `asyncMode` branch
- `index.ts:236` / `:266` — the async and blocking `runAdvisor` calls
- `index.ts:313-317` — the settle handler's re-read, consuming only `customType` and `display`
- `plan-turn.ts:26-30` — the conditional-spread precedent for key absence
- `plan-turn.ts:72-81` — `GateDecision`; the consult arm at `:77-80`
- `plan-turn.ts:84-112` — `PlanGateArgs`
- `plan-turn.ts:162-168` — the pass-through of `systemPrompt` and `timeoutMs`
- `tests/helpers.mjs:41` — `withConfig` re-arms the latch
- `tests/helpers.mjs:52-63` — `captureWarn`
- `tests/helpers.mjs:73-90` — `gateArgs`
- `tests/suites/config.mjs:64-82` — the inline `gateArgs` duplicate
- `tests/suites/config.mjs:169-171` — t5, the shared-latch pin
- `tests/suites/advisor.mjs:226-235` — t16, the outcome-only single-call pin
- `tests/suites/advisor.mjs:471-480` — t26, the consult-leg pins
- `tests/suites/tools.mjs:337` / `:517` — the `DEFAULT_MAX_TOOL_ROUNDS` parity pins
- `tests/suites/gate.mjs:138-156` — the core pass-through pin
- `eval/runner.mjs:190` — `makeFacade`, blind to the third argument
- `eval/runner.mjs:261` — the blind `DEFAULT_CONFIG` spread
- `eval/runner.mjs:272-281` — the specialist mirror; the literal at `:279`
- `eval/runner.mjs:318-330` — the `runAdvisor` args mirror
- `README.md:19-21` — the prose covering two doors
- `README.md:23-42` — the config table, 18 rows
- `config.example.json:2-8` — the 7-key example
- `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:2` — `THINKING_LEVELS`
- `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:3` — `MODEL_THINKING_LEVELS`
- `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:79` — `ThinkingLevel`
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:18` — the type re-export
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:236` — `SimpleStreamOptions.reasoning`
- `node_modules/@earendil-works/pi-ai/dist/models.js:693-724` — `EXTENDED_THINKING_LEVELS`, `getSupportedThinkingLevels`, `clampThinkingLevel`
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:508` — the actual clamp site
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:666-677` — the OpenRouter reasoning branch
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:524-525` — `completeSimple`, no clamp
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:452-484` — `prepareRequest`, options passed through
- `node_modules/@earendil-works/pi-ai/package.json:26-29` — the `./providers/*` subpath

## Integration Points

### Inbound References

- `index.ts:70` — the only `loadConfig()` call per dispatch; every downstream value is a snapshot of it
- `index.ts:202-219` — the `advisorArgs` literal, consumed by both fire modes
- `index.ts:189-192` — the `SpecialistConfig` construction, gated on `config.specialistModel`
- `eval/runner.mjs:261` — the blind `DEFAULT_CONFIG` spread, a second consumer of the defaults
- `eval/runner.mjs:279` — the independent specialist mirror
- `tests/helpers.mjs:41` — `withConfig`, the single latch re-arm point for every config fixture
- `tests/suites/config.mjs:64-82` — the inline `gateArgs` duplicate
- `eval/runner.mjs:285-310` — the third copy of the `planGate` args literal

### Outbound Dependencies

- `config.ts:1` — `node:fs`, the module's only import
- `advisor.ts:1` — `@earendil-works/pi-ai`, type-only
- `index.ts:2-5` — the hub's extensionless sibling imports, the only place both spokes meet
- `node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts:2` — the canonical level list, unreachable at runtime from the root barrel
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:508` — the clamp the FRD relies on

### Infrastructure Wiring

- `package.json:12` — `--experimental-strip-types`, which erases the type-only imports
- `package.json:16` — `npm run typecheck`, the gate that catches a missing `runAdvisor` params field
- `package.json:20-25` — pi-ai under `devDependencies` only, which forbids a runtime import
- `biome.json:20-24` — JSON is formatted, so `config.example.json` key order must survive `npm run lint`
- `.github/workflows/ci.yml` — runs test, lint, typecheck, and eval on every push

## Architecture Insights

**Star topology with hub-only fan-in.** `index.ts` is the only module that imports both `./config` and `./advisor`. Every cross-spoke agreement is either duplicated or routed through the hub. `TECH_DEBT_AUDIT.md:138` records the duplication as the accepted price of plain-node loadability.

**Duplicated constant plus parity pin.** `DEFAULT_MAX_TOOL_ROUNDS` is the template: a private constant with a comment naming the pin, and two independent literal assertions rather than a cross-module comparison. The advisor-side value is observable only through behaviour, because the constant is not exported.

**Structural typing over host imports.** `ModelRegistryLike` and `CompleteSimpleFn` duck-type the host. The `as CompleteSimpleFn` cast at `advisor.ts:194` is the single seam where the local type can drift wider than the host's, and it currently does.

**Empty-string sentinel.** `model`, `specialistModel`, and `triggerRiskyTools` all use `""` as the valid disabled state. The call site tests truthiness and omits the key. The sentinel is the same value in three surfaces: the README default cell, `DEFAULT_CONFIG`, and the conditional spread.

**Chronological seam split.** Fields that predate the `plan-turn.ts` extraction ride the core. Fields added after it read `config.*` at the I/O layer. The split is not a design principle, and the test suite records the asymmetry.

**Mirror-not-import eval.** `eval/runner.mjs` re-implements the `index.ts` seam rather than importing it, because `index.ts` cannot load under plain node. The mirror is untyped `.mjs`, so a divergence produces no typecheck failure and no test failure.

## Precedents & Lessons

3 similar past changes analyzed.

### Precedent: the config warn latch made resettable and observable
**Commit(s)**: `faa98a5` — "Make the config warn latch resettable and clamp warnings observable (F002, F014, F016)"
**Blast radius**: 4 files across 2 layers
  config.ts — +37 lines, the latch, `resetWarnOnceForTest`, `clampWithWarn`
  tests/test.mjs — +124 lines, the shared-latch and reset pins
  AGENTS.md, .agents/rules/main.md — the rule text

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-11-05_21-30-56_tech-debt-remediation.md` — the latch work was test-heavy, not code-heavy

**Takeaway**: a latch change costs roughly three test lines per code line. Budget the suite work first.

### Precedent: the FR6 specialist and eval harness
**Commit(s)**: `06f3552` — "Land the jarvis-advisor-evolution slices: triggers, budget, memory, dialogue, tools, consult, async, eval"
**Blast radius**: 22 files across 6 layers
  advisor.ts — +298, `SpecialistConfig`, `runConsultLeg`, the tool loop
  config.ts — +108, the specialist and trigger fields
  index.ts — +216, the fire-time specialist build and the async slots
  eval/ — 6 fixtures plus a 412-line runner, the mirror
  tests/test.mjs — +1846

**Follow-up fixes**:
- `2fc522c` — "Split the test monolith into eight suites (F030)" — the 1846-line monolith became eight suites
- `8962f97` — "Un-export the eight dead names (F032)" — the slice landed eight exports with no consumer

**Takeaway**: the eval mirror was born in this commit and has drifted once already (`signal`). Every new forwarding line needs the mirror edit in the same change.

### Precedent: config.example.json untracked and shipped
**Commit(s)**: `1690b9e` — "Untrack config.json and ship config.example.json (F024)"
**Blast radius**: 3 files
  .gitignore — one line
  README.md — 5 lines
  config.json → config.example.json — 4 lines

**Takeaway**: the example is a discovery surface, not a defaults surface. It ships disabled and carries a strict prefix of the interface order.

### Composite Lessons
- **Latch changes are test-heavy.** `faa98a5` spent 124 test lines on 37 code lines. The five shared-latch pins are the constraint that decides the design.
- **The eval mirror drifts silently.** `06f3552` created it, and it already omits `signal`. It is untyped `.mjs`, so nothing catches a divergence.
- **Duplicated constants need two pins, not one.** `DEFAULT_MAX_TOOL_ROUNDS` is pinned behaviourally (`tools.mjs:337`) and literally (`tools.mjs:517`). A single pin lets one side drift.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-11-10_10-33-59_reasoning-effort-config.md` — the ready FRD this research answers
- `.rpiv/artifacts/discover/2026-11-10_10-22-22_reasoning-effort-config.md` — the superseded earlier draft, broader scope including a catch-all OpenAI-compatible params object
- `.rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md` — the FR6 design that introduced `SpecialistConfig` and `runConsultLeg`
- `.rpiv/artifacts/designs/2026-11-06_07-08-54_tech-debt-remediation.md` — the F030 suite split that produced `tests/suites/`
- `.rpiv/artifacts/research/2026-11-05_13-47-22_advisor-tool-evidence.md` — the declaration-order convention for `config.example.json`
- `.rpiv/artifacts/research/2026-11-05_21-30-56_tech-debt-remediation.md` — the audit pass that produced the F-series ledger

## Developer Context

**Q (discover: Who hits the problem): What problem are you solving, and who hits it today when the config has no reasoning-effort or common OpenAI-compatible params?**
A: The person maintaining the extension.

**Q (discover: The actual symptom): What actually goes wrong today? Describe the symptom you hit when the advisor call has no reasoning effort set.**
A: "im not sure with current behaviour is using reasoning or not"

**Q (discover: Pass-through or translation layer): Today the advisor call sends only a stop signal. The host library already accepts those. Do you want config values sent as-is, or a translation step that reshapes them per provider?**
A: Send them as-is

**Q (discover: Catch-all object or named fields): The host library has one catch-all field for extra OpenAI-compatible settings. Do you want one catch-all config object, or a separate config field for each setting?**
A: Neither. Scope narrowed to reasoning effort only.

**Q (discover: Local reasoning type): `advisor.ts` declares `reasoning?: string` but the host wants `ThinkingLevel`. Fix the local type and validate the config value against the level list?**
A: Fix to ThinkingLevel

**Q (discover: Which calls get a level): The extension makes two kinds of model calls: the advisor, and the on-demand specialist consult. Which ones should get a reasoning effort setting?**
A: Both, separate fields

**Q (discover: Behavior when unset): When config.json has no reasoning effort set for a call, what should that call send?**
A: Send nothing

**Q (discover: Behavior on an invalid value): Valid levels are minimal, low, medium, high, xhigh, max. What should happen when config.json holds something else?**
A: Warn once, send nothing

**Q (discover: Two invalid fields at once): `config.ts` has one shared warn-once latch. If both `reasoningEffort` and `specialistReasoningEffort` are invalid, only the first warns today. What should happen?**
A: One warning per field

**Q (discover: Unsupported level on the live model): Your model only honors low, medium, high. If config says `xhigh`, the host silently clamps it to `high`. What should the extension do?**
A: Let the host clamp it

**Q (discover: Field names): What should the two config.json fields be called?**
A: `reasoningEffort` and `specialistReasoningEffort`

**Q (discover: Documentation surface): Should the README and config.example.json document the two new fields?**
A: Both files

**Q (`config.ts:1`): `AdvisorGateConfig` types every field as its post-parse shape, and `config.ts:1` imports only `node:fs` — no pi-ai type today. How should `reasoningEffort` be typed?**
A: Plain string, empty means unset. Matches `model` at `config.ts:48` and `specialistModel` at `config.ts:73`. `runAdvisor` narrows before sending.

**Q (`eval/runner.mjs:279`): `eval/runner.mjs:279` is a second copy of the specialist wiring in `index.ts:189-192`. Add the same reasoning line to both, or leave the eval copy alone?**
A: Add the line to both. The eval copy stays faithful to `index.ts`. Fixtures stay byte-identical because the eval facade ignores the options argument.

**Q (`config.example.json:2-8`): `config.example.json` carries 7 of 18 keys. Adding `specialistReasoningEffort` alone gives the example the specialist's level but not its model or prompt — and the level is inert without `specialistModel` (`index.ts:180`).**
A: Add all three specialist keys. The example becomes 10 keys and the specialist block works when copied.

## Related Research

- `.rpiv/artifacts/research/2026-11-05_13-47-22_advisor-tool-evidence.md` — the payload-inlining work that established the `config.example.json` declaration-order convention
- `.rpiv/artifacts/research/2026-11-05_21-30-56_tech-debt-remediation.md` — the audit that produced the F-series ledger and the shared-latch pins

## Open Questions

- `.agents/skills/advisor-turn-gate/SKILL.md:26` says "All seven config fields live in `config.json`" — stale by 11 today, by 13 after this change. Requirements 9 and 10 do not name this file. Fix it in the same change, or leave it?
- `TECH_DEBT_AUDIT.md:28` and `:52` say the README documents 17 config fields. The table has 18 rows today, because `asyncMode` landed after the audit. Out of scope for this FRD, or corrected alongside?
- The live `config.json` on disk carries no specialist keys and sets `"customType": "Opinionated AI Advisor"`. Adding `specialistReasoningEffort` there is inert until a `specialistModel` is configured. Optional, and not covered by requirement 10.
