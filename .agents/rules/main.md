---

description: Non-negotiables for the advisor-turn-gate extension.
applyTo:
- "*.ts"
- "*.mjs"
- "*.md"
- "tests/**"
- "scripts/hooks/*.mjs"

---

# advisor-turn-gate rules

## Code

- One instruction per sentence in prose. No contractions.
- Fail-open on error. A handler must never throw.
- Sibling imports are extensionless under Pi's jiti. Plain node cannot load `index.ts`.
- No live model calls in tests. Every advisor test stubs the completion facade.

## Files

- `index.ts` — the wiring. The only file the runtime loads.
- `plan-turn.ts` — the pure turn_end decision cores. No runtime imports.
- `config.ts` — every tunable field, clamping, and the model-key parser.
- `guard.ts` — child-session inertness (marker veto).
- `prompt.ts` — context shaping for the advisor call.
- `advisor.ts` — the model call, deadline, and markup stripping.
- `report.ts` — failure reporting to the TUI.
- `tests/test.mjs` — offline unit tests.
- `scripts/hooks/gate.mjs` — PreToolUse gate hook. Blocks catastrophic Bash commands.
- `scripts/hooks/lib.mjs` — shared hook plumbing: invocation detection, stdin parse, field read.
- `scripts/hooks/feedback.mjs` — PostToolUse hook. Runs `node --check` on edited JS and TS files.

## Tests

- Run with `npm test`.
- Every test must be deterministic. No timestamps in output.
