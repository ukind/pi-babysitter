---

name: advisor-turn-gate
description: Run a senior-engineer advisor review on the current agent session transcript. Use when the session is drifting or stuck.
---

# advisor-turn-gate skill

Run a senior-engineer advisor review on the current agent session transcript.

## When to use

- The session is drifting from the task.
- The session is stuck on a failure for more than three turns.
- You want a second opinion before a big change.

## What it does

1. Read the projected LLM context.
2. Call the advisor model with `tools: []`.
3. Strip fake tool-call markup from the reply.
4. Commit the advice as a `custom_message` entry.

## Config

All seven config fields live in `config.json`. The README documents each field with
its default. The gate ships disabled: set `model` to `provider/modelId` to activate it.
