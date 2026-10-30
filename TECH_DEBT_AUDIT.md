# Tech Debt Audit — advisor-turn-gate

Generated: 2026-10-29 · HEAD: 829c948 · Repo age: 2 commits, both 2026-10-29 · Audited size: ~1,900 LOC (excluding lockfile)

Tooling results at audit time: `tsc --noEmit` clean · `biome check .` clean · `npm test` all green · `npm audit`: 0 production vulnerabilities, 2 dev-only (undici via pi-coding-agent, no fix without a downgrade).

Note on finding count: the protocol calls for 30-80 findings on a mature repo. This repo is two commits old. Twenty findings is what the code supports; padding past that would be fiction.

## Executive summary

- 0 Critical, 0 High, 7 Medium, 13 Low. The codebase is disciplined for its age: strict tsc, clean lint, ~150 offline assertions, fail-open on every path.
- **Best bug found (F001):** `callWithDeadline` puts `const pending = call(...)` outside its `try`. A synchronous throw from the completion facade leaks the deadline timer, and the timer's later rejection has no handler — an unhandled rejection that can kill the host process 60s after the throw.
- **Deepest structural debt (F002):** the `configWarned` module latch has no reset, so the test suite's correctness depends on block execution order (t2 before t3, t4 expecting 0 because t3 tripped the latch). Any new test that touches a broken config silently loses its warning assertion.
- **Largest testability gap (F006):** the wiring in `index.ts` (config gate → cadence → outcome → veto order) has no direct test. t9 re-implements `buildCorrection` inline instead of exercising it.
- **Portability debt (F003):** the ALS probe walks a hardcoded relative path into the global `npm/node_modules` layout of a specific pi install. Any other machine layout degrades to marker-veto-only, silently.
- **Duplication (F005):** the 90-word system prompt lives twice (code default + shipped `config.json`), aligned only by substring assertions.
- **Observability hygiene (F004):** `guard.ts:110` console.logs on every extension load, in every session, forever, with no opt-out.
- Guard hooks (t19) are a blocklist: they correctly stop 18 catastrophic forms, but `git push origin +main` bypasses the force-push rule.
- CI installs with `npm install` instead of `npm ci` (F012), and `package.json` declares no `engines` despite a hard Node 22.6+ requirement (F013).

## Architectural mental model

A Pi coding-agent extension. The runtime loads `index.ts` through its per-extension jiti loader and calls the registered `turn_end` handler after each agent turn. The handler re-reads `config.json` per dispatch (so tuning needs no reload), gates on a modulo cadence over `turnIndex`, skips aborted or errored turns, and runs a two-layer child-session veto: a regex scan of system messages for the pi-subagents `<active_agent/>` marker (authoritative), plus an advisory AsyncLocalStorage probe loaded through a relative shim into the host install (degrades to undefined when unreachable). It resolves the advisor model from the host registry, requires a credential-backed entry, calls the model through the auth-aware `completeSimple` facade (reached via the registry `runtime` slot) with `tools: []` and tool deltas stripped from the projected context, accepts only `stopReason: "stop"`, strips four tiers of fake tool-call markup, and commits the result as a `custom_message` entry that spreads peer entries first. Every failure path reports to the TUI when one exists and fails open.

The mental model matches the README and AGENTS.md; no contradiction found. `scripts/hooks/*.mjs` are a separate system: Claude Code hooks, not Pi code, sharing nothing with the extension at runtime. The offline test suite imports the five sibling modules directly because plain Node cannot load the extensionless imports in `index.ts` — a documented, deliberate limitation.

## Findings

| ID   | Category                 | File:Line                                     | Severity | Effort | Description                                                                                                                                                                                                                                                                                                 | Recommendation                                                                                                                                                         |
| ---- | ------------------------ | --------------------------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | Error handling           | advisor.ts:235-241                            | Medium   | S      | `const pending = call(controller.signal)` sits outside the `try`. A synchronous throw skips `pending.catch`, skips the `finally`, leaks the deadline timer, and the timer rejection at timeout has no handler → unhandledRejection → default process crash. Contradicts the module contract "never throws". | Move the `pending` assignment and its `.catch` inside the `try`, or wrap `call(...)` so a sync throw becomes a rejected promise.                                       |
| F002 | Test debt                | config.ts:50-56, tests/test.mjs:150-171       | Medium   | S      | The `configWarned` latch has no reset. Test correctness depends on execution order (t2 must precede t3; t4 asserts 0 warnings _because_ t3 tripped the latch). A future test that touches broken config gets a silently vacuous assertion.                                                                  | Export a `resetWarnOnceForTest()` (or inject the warn function through `loadConfig`) and call it in `withConfig`. Deletes the ordering constraints and their comments. |
| F003 | Architectural decay      | guard.ts:61                                   | Medium   | M      | `CHILD_CONTEXT_SHIM` hardcodes a relative walk into one machine global install layout (`../../npm/node_modules/@tintinweb/...`). The target only exists because pi-subagents is globally installed _here_. Another machine or layout silently degrades to marker-veto-only.                                 | Attempt `import("@tintinweb/pi-subagents/src/child-context.js")` first; keep the relative shim as the documented fallback. Log which path won at load.                 |
| F004 | Observability            | guard.ts:94-111                               | Medium   | S      | `logProbeReading` console.logs in every session at extension load, forever, including the normal `false` main-session case. It is a one-time diagnostic that never turns off.                                                                                                                               | Gate behind an env var (for example `ADVISOR_TURN_GATE_DEBUG=1`), or remove after the scope question is answered.                                                      |
| F005 | Consistency rot          | config.json:6, config.ts:28-43                | Medium   | S      | The 90-word system prompt exists twice. t7b keeps them aligned via substring bands — drift is caught only partially by design, and every wording change is a two-file edit plus test edit.                                                                                                                  | Ship `config.json` without `systemPrompt`; let the code default be the single source. Delete the t7b shipped-config assertions.                                        |
| F006 | Test debt                | index.ts:24-47, 49-96; tests/test.mjs:272-290 | Medium   | M      | The handler decision core (config → cadence → outcome → probe → marker → resolve) has no direct test. t9 re-implements `buildCorrection` inline rather than calling it; the peer-spread regression tests a copy, not the code.                                                                              | Extract a pure `planTurn(config, event, probe)` into a zero-import sibling (the repo already uses this pattern in gate.mjs `evaluate`), and test that.                 |
| F007 | Architectural decay      | index.ts:55-58, config.ts:101-105             | Low      | S      | An aborted or errored turn still consumes its cadence slot: with interval 5, an error at turn 5 postpones the next advisory to turn 10. Drift during the errored stretch goes unreviewed for up to a full interval.                                                                                         | If unintentional: fire on the first _completed_ turn at or past each boundary (track last-fired turn). If intentional, document it at index.ts:58.                     |
| F008 | Type & contract debt     | advisor.ts:80-99, package.json:15             | Low      | S      | `getRuntimeCompleteSimple` reads the private `runtime` slot, pinned by comments to 1.4.0, while `package.json` allows `^1.4.0`. A minor-version host update that moves the slot fails the facade lookup — gracefully, but the advisor silently stops reviewing.                                             | Pin `"@earendil-works/pi-coding-agent": "1.4.0"` exactly, or add a warning note next to the caret.                                                                     |
| F009 | Security hygiene         | scripts/hooks/gate.mjs:52-57                  | Low      | S      | The force-push rule misses the refspec form: `git push origin +main` force-pushes main and passes `evaluate`. Same class: the hook is a blocklist and cannot be exhaustive (for example `find / -delete`).                                                                                                  | Add the `+main`/`+master` refspec form to `blocksProtectedForcePush`. State the blocklist limitation in the hook header comment.                                       |
| F010 | Documentation drift      | .agents/rules/main.md:4-10                    | Low      | S      | Frontmatter is malformed YAML: `glob:` nests inside the `"*.md"` list item, and its patterns `src/**`, `test/**` match nothing (source is at repo root, tests at `tests/`).                                                                                                                                 | Rewrite as `applyTo: ["*.ts", "*.mjs", "*.md", "tests/**"]` with correct indentation; drop the dead globs.                                                             |
| F011 | Documentation drift      | AGENTS.md:41, .agents/rules/main.md:35        | Low      | S      | Both state the test command as `node --experimental-strip-types test.mjs`. The file is `tests/test.mjs`; the documented command fails from the repo root.                                                                                                                                                   | Change both to `npm test`.                                                                                                                                             |
| F012 | Dependency & config debt | .github/workflows/ci.yml:15                   | Low      | S      | CI runs `npm install`, so a broken range resolution lands in CI before any local machine. A lockfile exists.                                                                                                                                                                                                | `npm ci`.                                                                                                                                                              |
| F013 | Dependency & config debt | package.json:1-21                             | Low      | S      | No `engines` field. The code requires Node 22.6+ (`--experimental-strip-types`; both hooks state it in prose), CI uses 24. A Node 20 user gets a cryptic flag error instead of an engine message.                                                                                                           | Add `"engines": { "node": ">=22.6" }`.                                                                                                                                 |
| F014 | Dependency & config debt | config.ts:45-46, 58-63                        | Low      | S      | Clamping is silent and the timeout ceiling equals the default: `timeoutMs: 120000` becomes 60000 with no signal. User intent is halved invisibly.                                                                                                                                                           | Warn once when a configured value is clamped, naming the original and the clamp result.                                                                                |
| F015 | Documentation drift      | tests/test.mjs:6                              | Low      | S      | Header cites `.rpiv/artifacts/plans/2026-10-27_21-34-09_advisor-turn-gate-extension.md`, which is not in the repo. The provenance for the Verification Notes is unreachable.                                                                                                                                | Commit the plan artifact, or reword the reference as historical.                                                                                                       |
| F016 | Dead code                | config.ts:107-109                             | Low      | S      | `modelKey()` has no production caller; only t8 imports it.                                                                                                                                                                                                                                                  | Delete it and its test block, or mark it as the intentional inverse codec.                                                                                             |
| F017 | Consistency rot          | gate.mjs:77-89, feedback.mjs:26-38            | Low      | S      | Both hooks re-implement `isHookInvocation`, stdin JSON parsing, and the `tool_input`/`toolInput` fallback. Drift risk in a security-adjacent parser.                                                                                                                                                        | Extract `scripts/hooks/lib.mjs` with one `readHookCommand(argv)` helper.                                                                                               |
| F018 | Error handling           | feedback.mjs:19-23                            | Low      | S      | A spawnSync timeout returns `status: null` with no `error`, so the report reads "exit code null" instead of "timed out after 10s".                                                                                                                                                                          | Check `result.signal` first and report a timeout explicitly.                                                                                                           |
| F019 | Documentation drift      | README.md:7-10                                | Low      | S      | README documents 2 of 7 config fields (`model`, `interval`). `enabled`, `timeoutMs`, `systemPrompt`, `customType`, `display` are undocumented outside source comments.                                                                                                                                      | Add a one-line table of all seven fields.                                                                                                                              |
| F020 | Dependency & config debt | package-lock.json (undici)                    | Low      | S      | `npm audit`: 1 high + 1 moderate in undici via `@earendil-works/pi-coding-agent@^1.4.0` — dev-only here (type-only imports). The only fix audit offers is a downgrade to 0.75.3. Runtime exposure belongs to the host app, not this package.                                                                | Track for a pi-coding-agent release that bumps undici; re-run `npm audit` on dependency updates. No local action available.                                            |

Per-category gaps: type debt — nothing material (strict tsc plus `noUncheckedIndexedAccess`; casts are documented structural narrowing). Performance — nothing material. Security — nothing beyond F009. Consistency — nothing beyond F005 and F017.

## Top 5 — if you fix nothing else

**1. F001 — guard `callWithDeadline` against a synchronous throw.**

```ts
try {
  const pending = call(controller.signal);
  pending.catch(() => {});
  return await Promise.race([pending, timeout]);
} finally {
  if (timer) clearTimeout(timer);
  if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
}
```

Keeps the existing unhandled-rejection comment true for every failure shape, not only async ones.

**2. F002 — make the warn-once latch resettable.** One exported reset, called in `withConfig`, deletes three ordering-dependent comment blocks (tests/test.mjs:128, 150-158, 168-171) and makes every future config test order-independent.

**3. F006 — extract the turn-decision core.** `planTurn(config, event, probe)` in a zero-import sibling, following the repo own `evaluate` pattern from gate.mjs. `index.ts` keeps only the await and the commit seam. t9 then calls the real `buildCorrection` instead of its copy.

**4. F005 — single-source the system prompt.** Remove `systemPrompt` from the shipped `config.json`, keep the code default, delete the t7b band for the shipped copy. One 90-word string maintained in one place.

**5. F003 + F004 — make the probe portable and quiet.** Try the bare-specifier import before the machine-layout shim, and gate the factory-time log behind an env var. Together they remove the two things that behave differently on the next machine this extension is installed on.

## Quick wins

- [x] F011: fix the test command in AGENTS.md:41 and .agents/rules/main.md:35 (one-line edits)
- [ ] F012: `npm install` → `npm ci` in ci.yml:15
- [ ] F013: add `engines.node` to package.json
- [x] F010: repair the malformed frontmatter in .agents/rules/main.md:4-10
- [ ] F009: add the `+main` refspec form to the force-push rule
- [ ] F014: warn once when a config value is clamped
- [ ] F018: report spawnSync timeouts as timeouts in feedback.mjs
- [ ] F016: delete the unused `modelKey` export
- [x] F015: fix or footnote the dangling `.rpiv/artifacts` reference
- [x] F019: document the other five config fields in the README

## Things that look bad but are actually fine

- **`readFileSync` on every turn (config.ts:124).** Sync I/O in a handler smells like a hot-path block, but the file is 689 bytes, the read is once per agent turn (not per token), and per-dispatch reads are the deliberate hot-reload design. If it ever shows up in a profile, an mtime check is the fix — until then it is the right trade.
- **`Boolean(system.toolsAdded || system.toolsRemoved)` treats empty arrays as declarations (prompt.ts:33).** Truthy empty arrays trigger the rebuild path needlessly, but the rebuild is a pure map that strips exactly those fields — the output is correct either way.
- **The blocklist treats the token `rm` as a potential target (gate.mjs:36-40).** `targets` includes non-flag tokens from position 1, so a file literally named `rm` is checked as a target. Harmless: it can only widen the match set, never narrow it.
- **Four regex passes over the reply (advisor.ts:139-160).** Worst case is O(n²) on lazy scans, not exponential; input is a single model reply. No ReDoS shape exists in any pattern.
- **The full transcript ships to the advisor model on every gate (prompt.ts:80-84).** Deliberate and documented: the advisor exists to catch drift from early decisions, and a tail window would be blind to them. Cost is the accepted price of the feature.
- **`{ok, reason}` vs `{ok, detail}` result shapes across modules.** Different layers (model call vs syntax check), each consistent within its layer. Unifying them would be churn, not clarity.
- **`index.ts` is untestable under plain Node (extensionless sibling imports).** Looks like a design flaw; it is the pi jiti loader contract, documented at index.ts:16-23, with the suite structured around it. F006 extracts what can be pure instead.
- **`Date.now()` in `ensureUserTail` (prompt.ts:84).** The repo rule bans timestamps in test _output_, and this timestamp never reaches output — it populates the `Message` shape.

## Open questions for the maintainer

- F007: is "an errored turn consumes its cadence slot" intended? The comment explains why the modulo form exists but not why errors spend a slot.
- Is a blocking advisor call inside `turn_end` (up to the 60s ceiling, config.ts:45) the intended UX? The `orca-agent-status` precedent cited at advisor.ts:186 chose fire-and-forget instead.
- Is `.claude/settings.json` meant to be repo-scoped? Its hook commands use paths relative to the repo root, so they only resolve when Claude Code starts in this directory.
- Is `stepfun/step-5-preview` (config.json:4) the intended default for anyone who clones this repo, or a personal value that should ship empty (the code treats empty as disabled)?
- F016: is `modelKey` kept as the intentional inverse of `parseModelKey` for future callers, or is it leftover from an earlier draft?
