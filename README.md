# advisor-turn-gate

A Pi coding-agent extension that runs a senior-engineer advisor on every N turns.
It reads the projected transcript, calls a model with `tools: []`, and commits the
advice as a `custom_message` entry in the durable transcript.

## Setup

The gate ships disabled: `model` is empty by default, and an empty model skips the
advisor call entirely. To activate the gate:

1. Copy `config.example.json` to `config.json`.
2. Set `model` in `config.json` to `provider/modelId`.
3. Set `interval` to the number of turns between advisor calls.

## Config

`config.json` is read on every turn, so changes apply without a reload. A field that
is absent or wrong-typed falls back to the default below. Out-of-range numbers are
clamped into range, with a one-time warning.

| Field                    | Default               | Meaning                                                                                                                                                         |
| ------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `true`                | Master switch. `false` skips the advisor call and the continuation entirely.                                                                                    |
| `interval`               | `2`                   | Advisor runs on the first completed turn at or past each N-turn boundary. Clamped 1-100.                                                                        |
| `model`                  | `""` (disabled)       | `provider/modelId` of the advisor model. Empty or unparseable disables the gate.                                                                                |
| `timeoutMs`              | `60000`               | Advisor call budget in milliseconds. Clamped 1000-60000.                                                                                                        |
| `systemPrompt`           | code default          | Optional override, not shipped — the code default is the single source.                                                                                         |
| `customType`             | `"advisor-turn-gate"` | The committed guidance entry's custom type.                                                                                                                     |
| `display`                | `true`                | Whether the committed entry renders in the TUI transcript.                                                                                                      |
| `triggerMinNewTokens`    | `0` (disabled)        | Fire before the next boundary when a finished turn grew by this many tokens. Clamped 0-100000.                                                                  |
| `triggerContextPercent`  | `0` (disabled)        | Fire before the next boundary when the context window is at least this percent full. Clamped 0-100.                                                             |
| `triggerOnError`         | `false`               | Fire on a turn that ended in an error. Aborted turns never fire.                                                                                                |
| `triggerRiskyTools`      | `""` (disabled)       | Comma-separated tool names. Any exact match on this turn's tool results fires early.                                                                            |
| `tokenBudget`            | `0` (disabled)        | Soft cap for the advisor payload in estimated tokens (JSON characters / 4). System messages and the verbatim tail always survive the fold. Clamped 0-1000000.   |
| `memoryCap`              | `0` (disabled)        | Advisor entries kept per project in the local `.advisor-memory/` store. Each fire appends its advice; the next fire's prompt carries the digest. Clamped 0-200. |
| `toolsEnabled`           | `false`               | Let the advisor read project files through a read-only sandbox during a fire.                                                                                   |
| `maxToolRounds`          | `3`                   | Read rounds per fire when `toolsEnabled` is on.                                                                                                                 |
| `specialistModel`        | `""` (disabled)       | `provider/modelId` of an on-demand specialist the advisor can consult. Empty disables the consult leg.                                                          |
| `specialistSystemPrompt` | code default          | Optional system prompt for the specialist. The code default is the single source.                                                                               |
| `asyncMode`              | `false` (blocking)    | Commit the advisor's reply at the next agent settlement instead of blocking turn_end. The advisor never wakes an idle agent.                                    |

## Verify

```
npm install
npm test
npm run lint
npm run typecheck
npm run eval
```

`eval/` replays golden fixtures per pillar through the real gate pipeline and
prints a score table. CI runs the same checks — test, lint, typecheck, and the
eval score gate — on every push. Activate the pre-commit checks with
`git config core.hooksPath .githooks`.

## License

MIT.
