# Project Overview

advisor-turn-gate is a pi coding-agent extension. Every N completed turns it sends the transcript's user and assistant turns to an advisor model (`tools: []`) and commits the answer as a `custom_message` entry with a forced continuation. TypeScript strict, zero runtime npm dependencies, Node >= 22.6.

Status: further tech-debt commits are expected after `236cc25`. Treat the code as canonical; re-check details against source.

# Architecture

Single package, hub-and-spoke. `index.ts` is the only file the runtime loads; every other module is a spoke with one role. The hub registers two handlers: `turn_end` (the blocking commit, or in async mode a detached call held for settle) and `agent_before_settle` (the once-only async commit, with no continuation request). Strict star topology: the hub imports every spoke extensionless (`./advisor`); no spoke imports a sibling at runtime (type-only imports are erased). Pure spokes import nothing at all, so plain node can load them offline.

```
[pi host] ──loads─> index.ts  (two handlers: turn_end commit, agent_before_settle async
                    │           commit; cadence latch, fire counter, two async slots;
                    │           one blocking await — async mode detaches instead)
                    ├─ config.ts     # config.json read/clamp/parse per dispatch (only node:fs import)
                    ├─ plan-turn.ts  # PURE cores planGate/planCommit/planSettle/planHostSupport/stampDetails; thunk-injected (zero runtime imports)
                    ├─ prompt.ts     # context shaper: inline tool evidence, filter roles, strip tool deltas, fold to budget, ensure user tail (zero imports)
                    ├─ advisor.ts    # model adapter: duck-typed completeSimple, shared deadline, tool loop + consult leg, markup strip
                    ├─ guard.ts      # child-session veto: marker regex over system msgs (zero imports)
                    ├─ report.ts     # hasUI-gated ui.notify failure reporting (zero imports)
                    ├─ memory.ts     # per-project advice store + digest builder (node:fs, never throws)
                    ├─ sandbox.ts    # read_file-only tool sandbox: pure planRead bound + I/O closure (node:fs)
                    └─ triggers.ts   # PURE multi-signal fire triggers (zero imports)
scripts/hooks/      # separate defense layer, registered via .claude/settings.json
                    # see .rpiv/guidance/scripts/hooks/architecture.md
eval/               # the sanctioned second runner: golden fixtures replayed through the
                    # real pipeline; CI gates on the score table (npm run eval)
```

Host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`) are `import type` only. Runtime host access is duck-typed through structural `-Like` interfaces and a bound `runtime.completeSimple` slot.

# Commands

| Task | Repo-wide | Path-scoped |
|---|---|---|
| Test | `npm test` | `node --experimental-strip-types tests/test.mjs` (one suite, no filter) |
| Lint + format check | `npm run lint` | `npx biome check <paths>` |
| Format (rewrite) | `npm run format` | `npx biome format --write <paths>` |
| Typecheck | `npm run typecheck` | `npx tsc --noEmit` (project-only; `.mjs` not covered) |
| Eval | `npm run eval` | `node --experimental-strip-types eval/runner.mjs` |

CI runs test, lint, typecheck, and eval on every push.

# Business Context

The gate ships disabled: an empty `model` skips the advisor call entirely. `config.json` is re-read on every turn, so edits apply without a reload. `customType` equals the package name, giving the reload filter and the `exclude_extensions` denylist one identifier.

<important if="you are modifying how the advisor call can fail">
- Never throw. Return `{ ok: true, text } | { ok: false, reason }`; the `reason` string is user-facing and test-pinned.
- Admit only `stopReason === "stop"`. Provider errors RESOLVE with `stopReason: "error"` — check `errorMessage` first.
- Preconditions (missing facade) sit before the `try`; transport failures sit inside it.
- The host swallows handler throws, so surface diagnostics through `reportFailure(ctx, msg)` — never rely on exceptions escaping.
</important>

<important if="you are returning a BoundaryResult from turn_end">
- Spread peer drafts first: `entries: [...(event.entries ?? []), draft]`. The host REPLACES the accumulator, so omitting `event.entries` drops every other extension's draft.
- Commit shape: `{ type: "custom_message", customType, content, display }` plus `continue: true`.
</important>

<important if="you are adding or changing a config.json field">
- One line per field with per-type narrowing against `DEFAULT_CONFIG`; never blind-spread `parsed` — a wrong-typed field must not poison its neighbors.
- Numbers go through `clampWithWarn` with named MIN/MAX constants; every clamp warns once per process.
- Missing file (ENOENT) is silent defaults; broken JSON warns once. Pin both paths in tests.
</important>

<important if="you are adding a new root module">
- Pure/decision modules: ZERO runtime imports — `import type` for pi types, no RUNTIME sibling imports; type-only sibling imports are permitted (erased under strip-types); accept capabilities as injected thunks.
- Runtime modules import siblings extensionless (`./advisor` — the jiti-proven form).
- Name pure decision functions with the `plan*` verb and return `*Decision` discriminated unions on `action`.
</important>

<important if="you are writing or modifying tests">
- Single file `tests/test.mjs`, plain `node:assert`, no framework, runs under `--experimental-strip-types`.
- No live model calls — stub the completion facade. Import pure cores directly (no process spawn, no jiti).
- Pin exact strings: failure reasons, rule reasons, and warn-once messages are contract.
</important>
