---

description: Non-negotiables for the advisor-turn-gate extension.
applyTo:
- "*.ts"
- "*.mjs"
- "*.md"
  glob:
- "src/**"
- "test/**"

---

# advisor-turn-gate rules

## Code

- One instruction per sentence in prose. No contractions.
- Fail-open on error. A handler must never throw.
- Sibling imports are extensionless under Pi's jiti. Plain node cannot load `index.ts`.
- No live model calls in tests. Every advisor test stubs the completion facade.

## Files

- `index.ts` — the wiring. The only file the runtime loads.
- `config.ts` — every tunable field, clamping, and the model-key parser.
- `guard.ts` — child-session inertness (marker veto + ALS probe).
- `prompt.ts` — context shaping for the advisor call.
- `advisor.ts` — the model call, deadline, and markup stripping.
- `report.ts` — failure reporting to the TUI.
- `test.mjs` — offline unit tests.

## Tests

- Run with `node --experimental-strip-types test.mjs`.
- Every test must be deterministic. No timestamps in output.
