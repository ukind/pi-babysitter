# advisor-turn-gate

A Pi coding-agent extension that runs a senior-engineer advisor on every N turns.
It reads the projected transcript, calls a model with `tools: []`, and commits the
advice as a `custom_message` entry in the durable transcript.

## What it does

- Fires on `turn_end` when the turn completed and the cadence modulo matches.
- Skips child sessions via the `<active_agent name="..."/>` marker veto.
- Calls the advisor model through Pi's auth-aware `completeSimple` facade.
- Strips fake tool-call markup from the reply before committing.
- Fails open on every error: no entry, no continuation, the loop keeps scheduling.

## Files

- `index.ts` — the wiring. The only file the runtime loads.
- `config.ts` — every tunable field, clamping, and the model-key codec.
- `guard.ts` — child-session inertness (marker veto + ALS probe).
- `prompt.ts` — context shaping for the advisor call.
- `advisor.ts` — the model call, deadline, and markup stripping.
- `report.ts` — failure reporting to the TUI.
- `tests/test.mjs` — offline unit tests. Run with `npm test`.
- `scripts/hooks/gate.mjs` — PreToolUse gate hook. Blocks catastrophic Bash commands.
- `scripts/hooks/feedback.mjs` — PostToolUse hook. Runs `node --check` on edited JS and TS files.

## Conventions

- No live model calls in tests. Every advisor test stubs the completion facade.
- Fail-open on error. A handler must never throw.
- Sibling imports are extensionless under Pi's jiti. Plain node cannot load `index.ts`.
- One instruction per sentence in prose. No contractions.
- Biome lints and formats. `npm run lint` checks, `npm run format` rewrites.
- `npm run typecheck` runs `tsc --noEmit` under `strict`. Keep it green.
- CI runs in `.github/workflows/ci.yml`. It runs the tests, Biome, and tsc.
- Local pre-commit checks live in `.githooks/pre-commit`. Activate them with `git config core.hooksPath .githooks`.

## Build and test

```
node --experimental-strip-types test.mjs
```

## License

MIT. See LICENSE.
