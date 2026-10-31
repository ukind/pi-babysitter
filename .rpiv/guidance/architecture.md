# Project Overview

advisor-turn-gate is a pi coding-agent extension. Every N completed turns it sends the projected transcript to an advisor model (`tools: []`) and commits the answer as a `custom_message` entry with a forced continuation. TypeScript strict, zero runtime npm dependencies, Node >= 22.6.

Status: further tech-debt commits are expected after `236cc25`. Treat the code as canonical; re-check details against source.

# Architecture

Single package, hub-and-spoke. `index.ts` is the only file the runtime loads; every other module is a spoke with one role. Strict star topology: the hub imports every spoke extensionless (`./advisor`); no spoke imports a sibling at runtime. Pure spokes import nothing at all, so plain node can load them offline.

```
[pi host] ──loads─> index.ts  (factory closure: turn_end hook, cadence latch, THE single await)
                    ├─ config.ts     # config.json read/clamp/parse per dispatch (only node:fs import)
                    ├─ plan-turn.ts  # PURE cores planGate/planCommit; thunk-injected (zero runtime imports)
                    ├─ prompt.ts     # context shaper: strip tool deltas, ensure user tail (zero imports)
                    ├─ advisor.ts    # model adapter: duck-typed completeSimple, deadline, markup strip
                    ├─ guard.ts      # child-session veto: marker regex over system msgs (zero imports)
                    └─ report.ts     # hasUI-gated ui.notify failure reporting (zero imports)
scripts/hooks/      # separate defense layer, registered via .claude/settings.json
                    # see .rpiv/guidance/scripts/hooks/architecture.md
```

Host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`) are `import type` only. Runtime host access is duck-typed through structural `-Like` interfaces and a bound `runtime.completeSimple` slot.

# Commands

| Task | Repo-wide | Path-scoped |
|---|---|---|
| Test | `npm test` | `node --experimental-strip-types tests/test.mjs` (one suite, no filter) |
| Lint + format check | `npm run lint` | `npx biome check <paths>` |
| Format (rewrite) | `npm run format` | `npx biome format --write <paths>` |
| Typecheck | `npm run typecheck` | `npx tsc --noEmit` (project-only; `.mjs` not covered) |

CI runs test, lint, and typecheck on every push.

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
- Pure/decision modules: ZERO runtime imports — `import type` for pi types, no sibling imports; accept capabilities as injected thunks.
- Runtime modules import siblings extensionless (`./advisor` — the jiti-proven form).
- Name pure decision functions with the `plan*` verb and return `*Decision` discriminated unions on `action`.
</important>

<important if="you are writing or modifying tests">
- Single file `tests/test.mjs`, plain `node:assert`, no framework, runs under `--experimental-strip-types`.
- No live model calls — stub the completion facade. Import pure cores directly (no process spawn, no jiti).
- Pin exact strings: failure reasons, rule reasons, and warn-once messages are contract.
</important>
