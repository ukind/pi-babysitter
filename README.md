# advisor-turn-gate

A Pi coding-agent extension that runs a senior-engineer advisor on every N turns.
It reads the projected transcript, calls a model with `tools: []`, and commits the
advice as a `custom_message` entry in the durable transcript.

## Setup

1. Set `model` in `config.json` to `provider/modelId`.
2. Set `interval` to the number of turns between advisor calls.

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
