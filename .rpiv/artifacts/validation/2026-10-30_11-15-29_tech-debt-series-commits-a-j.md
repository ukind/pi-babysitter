---
template_version: 1
date: 2026-10-30T11:15:29+0700
author: Yogiswara Utama
commit: dfa82f8
branch: main
repository: advisor-turn-gate
topic: "Validation of F001-F020 tech-debt fix series (commits A-J)"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-10-30_09-11-32_tech-debt-series-commits-a-j.md"
tags: [validation, tech-debt, commit-series, advisor-turn-gate]
last_updated: 2026-10-30T11:15:29+0700
---

## Validation Report: F001-F020 tech-debt fix series (commits A-J)

Validated the working tree and the commit range 829c948..dfa82f8 (commits A-J). The diff touches exactly the union of the plan's declared phase files. No unrelated file changed.

### Implementation Status

- ✓ Phase 1: config.json de-personalization (A — F005+F015) — Fully implemented
- ✓ Phase 2: config group (B — F002+F014+F016) — Fully implemented
- ✓ Phase 3: deadline hole (C — F001+F008 comment) — Fully implemented
- ✓ Phase 4: probe deletion (D — F003/F004) — Fully implemented
- ✓ Phase 5: plan-turn extraction (E — F006) — Fully implemented
- ✓ Phase 6: cadence slide (F — F007) — Fully implemented
- ✓ Phase 7: refspec hole + shared parser (G — F009+F017) — Fully implemented
- ✓ Phase 8: timeout reporting (H — F018) — Fully implemented
- ✓ Phase 9: CI/tooling (I — F012+F013) — Fully implemented
- ✓ Phase 10: prose docs pass (J — F010/F011/F019) — Fully implemented

### Automated Verification Results

- ✓ npm test — exit 0, "test.mjs: all green". The suite carries every planned battery: t1b, t16b, t19b, t19c, and t20 all PASS.
- ✓ npm run lint (tracked-file scope) — exit 0. Biome checked 23 tracked files with no findings. The whole-tree `npm run lint` exits 1 only on the untracked .rpiv artifacts. The plan records tracked-file scope as the accepted criterion.
- ✓ npm run typecheck — exit 0. `tsc --noEmit` under strict reports no errors.
- ✓ Per-phase grep criteria — every criterion from all ten phases was re-run agent-side and matched. Highlights: probe symbols return zero stray hits across guard.ts, index.ts, tests, and docs. `modelKey` is fully deleted. `buildCorrection` is gone from index.ts. plan-turn.ts carries exactly three type-only imports. The latch write `lastFiredTurn = turnIndex` exists only in index.ts. scripts/hooks/lib.mjs exports four functions and imports nothing. Both hooks consume the shared plumbing and define no local copy. engines declares ">=22.6.0". ci.yml runs `npm ci` with the quoted ["22.6.0", "24"] matrix.
- ✓ .npmrc criterion — the environment bars reads of the file (the same safety net the plan documents). Verified by commit stat instead: the diff adds .npmrc as a new file with exactly one line. This matches the plan's accepted verification route.
- ✓ No regressions detected. Banners 17, 18, and 19 keep their file order after the t16b insert. The t12 deletion removed banner 12 without renumbering.

### Code Review Findings

#### Matches Plan:

- advisor.ts:233-245 — the pending assignment and its .catch sit inside the try. The finally clears the timer on every path. The F001 fix shape matches the plan byte for byte.
- advisor.ts (facade guard) — the "fail-fast precondition" comment pins the guard above runAdvisor's try. t16 pins the reason string.
- config.ts:152 — `shouldFire` exported beside `shouldGate`. The `shouldGate` body is untouched. The doc narrows the anti-latch claim to the stateless form as planned.
- index.ts — the handler is a dumb dispatcher. It passes `shouldFire`, `lastFiredTurn`, and the single `markFired` write through the seam. No `shouldGate` reference remains.
- plan-turn.ts — born state matches Phase 5, and the eight F007 elements (lastFiredTurn field, markFired thunk, slide comments) match Phase 6.
- scripts/hooks/gate.mjs — the refspec matcher normalizes a leading + before the branch match. Ten forced-refspec forms block. The force-with-lease allowance survives for unmarked refspecs. Both behaviors re-verified live: a "git push origin +main" stdin round-trip exits 2 with the reason "forced push to a protected branch". A "git push --force-with-lease origin main" round-trip exits 0.
- scripts/hooks/feedback.mjs — syntaxCheck rides describeSpawnResult. The old inline chain is gone. The t20 battery pins the timeout, kill, stderr, and bare-exit shapes.
- README.md — seven-row Config table present. Activation-first setup present ("The gate ships disabled").
- .agents/rules/main.md — valid frontmatter with the five corrected globs. No dead `glob:` key. `Run with \`npm test\`` present. The bare `test.mjs` name is gone.
- TECH_DEBT_AUDIT.md — tracked at HEAD. `npx biome check` exits 0. Exactly four stamps (F011, F010, F015, F019) and six open boxes.
- package.json — engines added. The test script keeps the raw "node --experimental-strip-types tests/test.mjs" form as the plan requires.

#### Deviations from Plan:

- TECH_DEBT_AUDIT.md:81-90 — the four stamped lines carry slightly different wording from the plan's verbatim hunk text ("command" vs "command", "frontmatter" vs "frontmatter"). Comment-only drift in a ledger file. The governing criterion ("the stamped four are the docs pass") passes. Non-blocking.
- None of the deviations require action.

#### Pattern Conformance:

- ✓ plan-turn.ts uses type-only imports. This follows the prompt.ts and advisor.ts precedent.
- ✓ scripts/hooks/lib.mjs documents the plain-node-only contract. Each hook keeps its own exit dispatch, as the plan requires.
- ✓ New tests follow the numbered-banner convention (t1b, t16b, t19b, t19c, t20). No banner was renumbered.

#### Potential Issues:

- config.json (working tree, uncommitted) — "model" reads "stepfun/step-5-preview" instead of the shipped "". This is the maintainer opt-in that Phase 1's manual note anticipates: the local gate is disabled after commit A until model is set again, and it is now set again locally. The committed state at HEAD satisfies the ship-empty criterion. Keep this file out of the /skill:commit run.

### Manual Testing Required:

Deferred items from the plan. Each needs a live environment this validation cannot reach:

1. Live pi session (Phase 4):
   - [ ] Load the extension. No "[advisor-turn-gate] ALS inChildSessionContext=" line appears.
   - [ ] A subagent session stays inert with the marker veto alone.
2. Live Claude Code session (Phases 7, 8, and 10):
   - [ ] A "git push origin +main" attempt is blocked in the session.
   - [ ] Feedback reports node --check failures after an edit.
3. CI matrix (Phase 9):
   - [ ] Push to GitHub. Two jobs render (Node 22.6.0 and 24). Both go green.

Executable manual items re-verified during this validation: the gate stdin round-trips (both directions), the Node floor (v24.14.0), and the main.md frontmatter structure (valid YAML list with the five corrected patterns).

### Recommendations:

- Ready to commit — the series is already committed (77da952..dfa82f8) and validated.
- Exclude the working-tree config.json from any future commit run. It is a personal opt-in.
- Push to confirm the CI matrix. That is the only automated criterion that still needs a remote.
