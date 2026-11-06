# advisor-turn-gate

A Pi coding-agent extension that runs a senior-engineer advisor on every N turns.
It reads the projected transcript, inlines the executor's tool calls and their
outputs as plain prose, calls a model with no tools by default (an optional
`read_file` sandbox and specialist consult arm per config), and commits the advice
as a `custom_message` entry in the durable transcript.

## What it does

- Fires on `turn_end` when the turn completed and the cadence latch is due (`turnIndex >= lastFiredTurn + interval`), or earlier when a trigger arm fires (error, token growth, context pressure, risky tool).
- Skips child sessions via the `<active_agent name="..."/>` marker veto.
- Calls the advisor model through Pi's auth-aware `completeSimple` facade.
- Optionally arms the read_file sandbox and a specialist consult for the call.
- Strips fake tool-call markup from the reply before committing.
- With `memoryCap` set, records each advice text in a per-project store; the next fire's payload carries a digest of the newest entries.
- In async mode the call detaches, and the held outcome commits at the next `agent_before_settle` with no continuation request.
- Fails open on every error: no entry, no continuation, the loop keeps scheduling.

## Files

- `index.ts` — the wiring. The only file the runtime loads.
- `plan-turn.ts` — the pure turn_end decision cores. No runtime imports.
- `config.ts` — every tunable field, clamping, and the model-key parser.
- `guard.ts` — child-session inertness (marker veto).
- `prompt.ts` — context shaping for the advisor call.
- `advisor.ts` — the model call, deadline, tool loop, and markup stripping.
- `report.ts` — failure reporting to the TUI.
- `memory.ts` — the per-project advice store and digest builder. Never throws.
- `sandbox.ts` — the advisor's read_file-only tool sandbox. Never throws.
- `triggers.ts` — pure multi-signal fire triggers. No runtime imports.
- `tests/test.mjs` — offline unit tests. Run with `npm test`.
- `eval/runner.mjs` — offline eval harness, the sanctioned second runner. Run with `npm run eval`.
- `scripts/hooks/gate.mjs` — PreToolUse gate hook. Blocks catastrophic Bash commands.
- `scripts/hooks/lib.mjs` — shared hook plumbing: invocation detection, stdin parse, field read.
- `scripts/hooks/feedback.mjs` — PostToolUse hook. Runs `node --check` on edited JS and TS files.

## Conventions

- No live model calls in tests. Every advisor test stubs the completion facade.
- Fail-open on error. A handler must never throw.
- Sibling imports are extensionless under Pi's jiti. Plain node cannot load `index.ts`.
- One instruction per sentence in prose. No contractions.
- Biome lints and formats. `npm run lint` checks, `npm run format` rewrites.
- `npm run typecheck` runs `tsc --noEmit` under `strict`. Keep it green.
- CI runs in `.github/workflows/ci.yml`. It runs the tests, Biome, tsc, and the eval score gate.
- Local pre-commit checks live in `.githooks/pre-commit`. Activate them with `git config core.hooksPath .githooks`.

## Build and test

```
npm test
```

## License

MIT. See LICENSE.
