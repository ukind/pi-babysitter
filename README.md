# advisor-turn-gate

A Pi coding-agent extension that runs a senior-engineer advisor on every N turns.
It reads the projected transcript, calls a model with `tools: []`, and commits the
advice as a `custom_message` entry in the durable transcript.

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

## Verify

```
npm install
npm test
npm run lint
npm run typecheck
```

CI runs the same checks on every push. Activate the pre-commit checks with
`git config core.hooksPath .githooks`.

## License

MIT.
