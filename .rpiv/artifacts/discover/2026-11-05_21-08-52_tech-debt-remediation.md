---
date: 2026-11-05T21:08:52+0700
author: Yogiswara Utama
commit: d2cd108
branch: main
repository: advisor-turn-gate
topic: "Resolve all open tech-debt findings (F020, F029-F037)"
tags: [intent, frd, tech-debt, gate-hook, sandbox, memory, docs, tests]
status: ready
last_updated: 2026-11-05T21:08:52+0700
last_updated_by: Yogiswara Utama
---

# FRD: Resolve all open tech-debt findings (F020, F029-F037)

## Summary

Fix every open finding in `TECH_DEBT_AUDIT.md` (F020, F029-F037) by adopting the audit's own probe-verified recommendations as written, with three explicit method choices: split `tests/test.mjs` per module, use a strict sandbox secret denylist, and take the minimal path on F033/F037. The work closes the security holes (F035, F031), the documentation drift (F029, F034), the test-file rule breach (F030), the dead surface (F032), and the remaining Low findings, leaving the next audit run starting from zero open findings.

## Problem & Intent

Developer's words: "fix all" — every open finding in the audit. Cost framing, in the developer's words: "Next feature commit" — every new slice lands on a 3,343-line test file and docs describing a six-spoke hub; the tax compounds per commit. The audit itself is the problem statement: 9 open findings, 4 Medium, 5 Low, each with a verified `file:line` seam at HEAD `d2cd108`.

## Goals

- Close F035: `rm -rf C:/`, `rm -rf ../`, `rm -rf ../*`, `rm -rf ~/..` all block; `rm -rf node_modules` and `rm -rf build` stay legal.
- Close F031: the advisor sandbox refuses secret-shaped files (`.env*`, `.npmrc`, `.git/`, `*.pem`, `id_rsa*`) before any read, including the symlink arm.
- Close F029: `.rpiv/guidance/architecture.md` and `AGENTS.md` name all nine spokes plus `eval/`, and the "single await" narrative matches the two-handler async shape.
- Close F030: `tests/test.mjs` split per module behind a thin runner, pins byte-identical, `npm test` green.
- Close F020: `npm audit` clean, with F008's contract re-recorded at the bumped host version in the same commit.
- Close F032, F033, F034, F036, F037 per their audit recommendations.
- Leave zero open findings for the next audit run.

## Non-Goals

- Widening the gate hook's blocklist philosophy (F035 extends the root-like rule only; `TRUNCATE`, `find -delete`, `xargs rm` stay out of scope).
- Re-deriving or redesigning any fix the audit already recommends — method is "adopt as written" except where a pick-one was surfaced.
- Touching the fold's invariants (F037's thorough path is explicitly not chosen).
- Resolving the audit's carried open questions (child-session `lastFiredTurn`, hook launch points, stale user-global rule, global-vs-per-project config asymmetry).
- Any feature work beyond debt removal.

## Functional Requirements

1. **F035 — root-like rm bypasses.** `scripts/hooks/gate.mjs` SHALL block `rm -rf C:/`, `rm -rf C:\`, `rm -rf ../`, `rm -rf ../*`, `rm -rf ~/..` and SHALL continue to allow `rm -rf node_modules`, `rm -rf build`. The drive-root regex SHALL accept both `/` and `\` separators. t19 SHALL pin the four new blocked forms and the two allowed forms.
2. **F031 — sandbox secret denylist.** `planRead` in `sandbox.ts` SHALL refuse, with the existing reason shape, any requested path whose final segment matches `.env*`, `.npmrc`, `.git`, `*.pem`, or `id_rsa*` — including `src/.env.example`. The same check SHALL be applied to the `realpath` result in `createSandbox`'s symlink arm. t25 SHALL pin: `.env` refuses, `src/.env.example` refuses, `README.md` passes. README's `toolsEnabled` row SHALL carry one security sentence.
3. **F029 — documentation drift.** `.rpiv/guidance/architecture.md` SHALL list `memory.ts`, `sandbox.ts`, `triggers.ts` in the spoke diagram and name `eval/` as the second runner; the "THE single await" phrase SHALL be rewritten to the two-handler async shape (`turn_end` blocking commit + `agent_before_settle` async commit). `AGENTS.md` `## Files` SHALL gain the three spokes and `eval/runner.mjs`.
4. **F030 — test-file split.** `tests/test.mjs` SHALL be split into `tests/suites/{config,prompt,advisor,gate,memory,tools,triggers,dialogue}.mjs` behind a thin runner that imports them in banner order. Every pinned string SHALL remain byte-identical. `npm test` SHALL exit 0.
5. **F020 — dependency vulnerabilities.** `npm audit fix` SHALL be run on a branch; the resulting `package.json`/`package-lock.json` SHALL leave `npm audit` reporting 0 vulnerabilities. F008's accepted contract SHALL be re-recorded against the bumped host version in the same commit.
6. **F032 — dead exports.** The eight dead surfaces (`MIN_TRIGGER_TOKENS`, `MAX_TRIGGER_TOKENS`, `MIN_TRIGGER_PERCENT`, `MAX_TRIGGER_PERCENT`, `READ_FILE_TOOL_NAME`, `ToolExecutionResult`, `SandboxResult`, `TriggerSignal`) SHALL be un-exported; in-file uses SHALL remain intact.
7. **F033 — memory banner claim.** `memory.ts:167` SHALL stop claiming "written atomically-whole"; the banner SHALL read "self-healing whole-file rewrite" (the minimal path — no tmp+rename).
8. **F034 — pure-module rule.** `.rpiv/guidance/architecture.md`'s pure-module rule SHALL be amended to permit type-only sibling imports (erased under strip-types), and `plan-turn.ts` SHALL gain the standard module banner documenting its import contract.
9. **F036 — silent signal degradation.** `index.ts` SHALL warn once, via the existing `warnOnce` pattern, when an armed trigger signal reads null at its first evaluation: `[advisor-turn-gate] trigger <name> is armed but this host provides no <signal> data`.
10. **F037 — digest vs token budget.** `recordAdvice` in `memory.ts` SHALL cap per-entry text bytes at a small named MAX constant (the minimal path — the fold's accounting is untouched).

## Non-Functional Requirements

- **Performance**: no new hot-path cost. The F031 denylist is one regex test per read; the F036 warn is once per process.
- **Security**: the two security findings (F035, F031) are the priority pair. F031's denylist is strict by decision — no `*.example` exception.
- **UX / Accessibility**: no user-visible surface change. F036 adds a diagnostic line only.
- **Reliability**: fail-open everywhere is preserved. F033's reword does not change write behavior; F037's cap truncates at record time, not at read time.

## Constraints & Assumptions

- Windows / Git Bash is the repo's own platform — F035's `C:/` form is the native invocation, not a hypothetical.
- The host bump crosses the `^1.4.0` line: `@earendil-works/pi-coding-agent` 1.4.0 => 1.5.0 (dry-run verified), plus `pi-ai`, `pi-tui`, `pi-mcp`, `pi-codemode`, `pi-telemetry`, `pi-agent-core`, `pi-schema`, `undici` 8.10.2 => 8.12.3, `minimatch` 10.2.6 => 11.0.3. Assumption: the duck-typed `completeSimple` facade and `runtime` reach in `advisor.ts` survive the bump — t14 and t16 plus a manual reach check verify this before merge.
- Test pins are contract: the F030 split is a mechanical move, not a rewrite. Any pin that cannot move byte-identically is a blocker, not a judgment call.
- `eval/` remains the sanctioned second runner; the F030 split does not fold it back into `tests/`.
- Citation drift found by the probe and assumed corrected in the work: F031's second site is `index.ts:184-187` (audit says 129-134); F034's sibling imports are `plan-turn.ts:3-4` (audit says 3-5); F035's function ends at `gate.mjs:47` (audit says 30-46).

## Acceptance Criteria

- [ ] `npm test` exits 0, and `npm run eval` reports 6/6 fixtures.
- [ ] `npx tsc --noEmit` and `npx biome check .` both clean.
- [ ] `npm audit` reports 0 vulnerabilities.
- [ ] A probe against `evaluate()` in `scripts/hooks/gate.mjs` shows `rm -rf C:/`, `rm -rf ../`, `rm -rf ../*`, `rm -rf ~/..` blocked and `rm -rf node_modules`, `rm -rf build` allowed.
- [ ] `planRead(root, ".env")` and `planRead(root, "src/.env.example")` return `{ action: "refuse" }`; `planRead(root, "README.md")` returns `{ action: "allow" }`.
- [ ] `.rpiv/guidance/architecture.md` and `AGENTS.md` each mention `memory.ts`, `sandbox.ts`, `triggers.ts`, and `eval/`.
- [ ] `wc -l tests/test.mjs` reports a thin runner under 30 lines; `ls tests/suites/` lists the eight module suites.
- [ ] `grep -n "atomically-whole" memory.ts` returns nothing.
- [ ] `grep -rn "export const MIN_TRIGGER_TOKENS\|export type TriggerSignal\|export const READ_FILE_TOOL_NAME" .` returns nothing.
- [ ] The F020 commit message and the F008 acceptance record name the new host version (1.5.0).

## Recommended Approach

Nine independent fixes, one commit per finding group, each naming its finding ID in the commit message (the repo's established remediation pattern). Security pair first (F035, F031), then docs (F029, F034), then the test split (F030), then the dependency bump with its F008 re-record (F020), then the four Low quick wins (F032, F033, F036, F037). No new modules; no architectural change.

## Decisions

### Scope of the work
**Question**: The audit carries 9 open findings and a ranked top 5. What problem does fixing this debt actually solve for you, and who hits that problem today?
**Recommended**: n/a — `intent` question
**Chosen**: "fix all"
**Rationale**: Developer's own words; the audit enumerates exact seams, so scope is fully bounded by the report.

### Who pays the debt
**Question**: Re-asking the cost question: who hits this debt, and when?
**Recommended**: n/a — `intent` question
**Chosen**: "Next feature commit"
**Rationale**: Every new slice lands on a 3,343-line test file and docs describing a six-spoke hub; the tax compounds per commit.

### Fix method
**Question**: Pre-resolved from codebase evidence — every finding has a verified recommendation in `TECH_DEBT_AUDIT.md`. Does "fix all" mean adopt them as written, or pick the method per finding?
**Recommended**: Adopt as written
**Chosen**: Adopt as written
**Rationale**: Probe re-verified all nine recommendations at HEAD `d2cd108`; adopting avoids re-deriving each fix. Pick-one findings were still surfaced individually. `evidence: TECH_DEBT_AUDIT.md + probe report, 2026-11-05 + confirmed`

### F020 dependency bump
**Question**: Pre-resolved from codebase evidence — F020's fix crosses the 1.4.0 line (`pi-coding-agent` 1.4.0 => 1.5.0), and F008's accepted contract is written against `^1.4.0`. Include F020 in this work, or defer it?
**Recommended**: Include, re-record F008
**Chosen**: Include, re-record F008
**Rationale**: Closes the last open finding; the facade pins (t14, t16) and the `runtime` reach check gate the merge. `evidence: npm audit fix --dry-run output, 2026-11-05 + confirmed`

### F030 test-file split
**Question**: F030: the repo's own split rule says ~1,500 lines; `tests/test.mjs` is 3,343. Split the file, or amend the rule?
**Recommended**: Split per module
**Chosen**: Split per module
**Rationale**: Optimizes navigability; costs a one-time mechanical move of ~3,300 lines with pins kept byte-identical. Amending the rule would leave a documented rule that permits a 3,300-line file. `evidence: tests/test.mjs = 3,343 lines (probe, EOF-verified)`

### F031 denylist strictness
**Question**: F031: the sandbox secret denylist — strict as audited (`src/.env.example` also refuses), or with an example-file exception?
**Recommended**: Strict denylist
**Chosen**: Strict denylist
**Rationale**: No secret-shaped file ever reaches the provider. An `*.example` exception gives a real secret with a benign name a precedent to hide behind. `evidence: sandbox.ts:74-91 has no denylist (probe grep, zero matches)`

### F033 + F037 fix depth
**Question**: F033 and F037 both offer a minimal and a thorough path. Pick one pair.
**Recommended**: Both minimal fixes
**Chosen**: Both minimal fixes
**Rationale**: F033 reword to "self-healing whole-file rewrite"; F037 per-entry byte cap at `recordAdvice`. Minimal diff, fold invariants untouched. The thorough pair (tmp+rename, digest tokens in fold accounting) touches more surface to pin for a bounded gain. `evidence: memory.ts:169-180 recordAdvice, prompt.ts:368-383 post-fold digest insert (probe)`

## Open Questions

- Does the duck-typed `completeSimple` facade and `advisor.ts`'s `runtime` reach survive the 1.4.0 => 1.5.0 host bump? Not deferred — answered by t14/t16 plus a manual reach check before the F020 commit merges. Carried as a verification step.

## Suggested Follow-ups

- Carried from the audit, out of scope here: does a child session share this factory's `lastFiredTurn`, or does each session load a fresh module? Not determinable statically.
- Carried: `.claude/settings.json` hooks use repo-relative paths — is this directory the only Claude Code launch point that should run them?
- Carried: is the stale `"You are a child subagent"` rule still configured in user-global host settings?
- Carried: `config.json` is global while the memory store is per-project — is one global gate config for every project intentional?

## References

- `TECH_DEBT_AUDIT.md` — the audit under remediation (input, read in full)
- `.rpiv/guidance/architecture.md` — F029 and F034 target
- `AGENTS.md` — F029 target
- `scripts/hooks/gate.mjs` — F035 target (`ROOT_LIKE_TARGETS` at lines 29-42, `isRootLikeTarget` at 44-47)
- `sandbox.ts`, `index.ts:184-187` — F031 targets
- `tests/test.mjs` (3,343 lines), `eval/runner.mjs` (424 lines) — F030 targets
- `package.json`, `package-lock.json` — F020 targets
- Probe report (codebase-analyzer agent, 2026-11-05): verbatim quotes for all nine finding sites at HEAD `d2cd108`
