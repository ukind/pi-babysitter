---
date: 2026-11-02T12:23:18+0700
author: Yogiswara Utama
commit: faae538
branch: main
repository: advisor-turn-gate
topic: "jarvis-advisor-evolution design resume - Slice 3 (Project memory)"
tags: [design, advisor-turn-gate, memory, slice3, rpiv-design, handoff]
status: complete
last_updated: 2026-11-02T12:23:18+0700
last_updated_by: Yogiswara Utama
type: feature_development
---

# Handoff: resume jarvis-advisor-evolution design at Slice 3 (Project memory)

## Task(s)

- Active (in progress): /skill:design --resume .rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md. The design artifact has 8 config-gated slices. Slices 1 (Trigger arms + 1.4.x guard) and 2 (Prompt budget) are approved/locked (see artifact Design History). The session resumed and entered Step 6.1 for Slice 3 (Project memory).
- Slice 3 status: code for all six files (memory.ts NEW; config.ts, index.ts, .gitignore, README.md, tests/test.mjs MODIFY) and its Success Criteria were fully generated in-session but NOT persisted anywhere - the artifact fence for memory.ts is still the placeholder, and the draft lives only in the ended session's context. Summarized precisely in Learnings below so it can be regenerated deterministically.
- Not yet done for Slice 3: Step 6.2 slice-verifier dispatch, Step 6.3 developer micro-checkpoint, Step 6.4 artifact edit + Design History flip, then the mandatory session-boundary stop (Slice 3 is non-final).
- Planned: Slices 4 (Dialogue) through 8 (Eval harness) remain pending.
- No source files were modified (design skill never edits source). Disk is still the pre-slice baseline at faae538.

## Critical References

- .rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md - THE authoritative artifact. Locked Slice 1-2 code lives in its Architecture fences; Slice 3 must extend those shapes, not disk.
- .rpiv/guidance/architecture.md - star topology, boundary/config/test contracts, hub-and-spoke rules.
- AGENTS.md and TECH_DEBT_AUDIT.md at the repo root (C:/Users/utama/.pi/agent/extensions/advisor-turn-gate) - never-throw/fail-open with pinned strings; pure spokes zero runtime imports; single test file until FR9.

## Recent changes

- None to the codebase (read-only session). Only reads of the design artifact, source baseline (config.ts, index.ts, prompt.ts, tests/test.mjs, .gitignore, README.md), and two failed verifier dispatch attempts.
- The design artifact was NOT edited this session (edits happen only on Slice approval at Step 6.4).

## Learnings

**Resume mechanics**

- The artifact's Design History section (near the end, around line 1290): Slices 1-2 approved, Slice 3 pending. Resume enters Step 6 directly at the first pending slice; Steps 2-5 are skipped.
- Disk is NOT the target: the repo at faae538 is the pre-Slice-1 baseline. Implement has not run. Locked post-Slice-2 shapes live only in the artifact's Architecture fences (triggers.ts full; index.ts Regions A-E; plan-turn.ts regions incl. planHostSupport; prompt.ts applyTokenBudget/estimateMessageTokens/buildAdvisorMessages(messages, tokenBudget=0); config.ts Regions A-H; tests t21/t21c/t22/t22c).
- Slice 3 merges must rewrite whole fences (not append): config.ts fence header becomes 'Slices 1, 2, 3 regions', index.ts Region E is rewritten in final form, tests imports are unions.

**Harness learnings (this session)**

- The Agent tool (slice-verifier) must be called directly as a top-level tool call - it is not reachable inside codemode's sandbox ('Agent is not defined'). Two dispatch attempts failed this way; the verifier never ran.
- codemode's noop-guard fires after about 3 calls that make no nested tool calls (e.g. only store/load); include a real nested call (tools.read) when just parsing stored strings.

**Slice 3 draft (regenerate from this)**

File memory.ts - NEW, pure spoke, zero runtime imports, only 'import type { Message } from "@earendil-works/pi-ai"':
- ADVISOR_MEMORY_PREFIX = "[advisor memory]" (pinned); MEMORY_DIR_URL = new URL(".advisor-memory/", import.meta.url).
- MemoryEntry { timestamp: number; text: string }; MemoryRead = { ok: true; entries } | { ok: false; reason }; MemoryWriteDecision = { action: "off" | "skip" | "write"; ... }.
- Pinned warn templates (user-facing, test-pinned): memoryStoreFailureReason(detail) returns '[advisor-turn-gate] ignoring unreadable memory store (<detail>); memory starts fresh'; memoryWriteFailureReason(detail) returns '[advisor-turn-gate] memory store write failed (<detail>); this fire is not remembered'.
- projectKey(cwd): FNV-1a 32-bit hash + sanitized stem (chars outside [A-Za-z0-9._-] become '-', collapse runs, trim leading/trailing '-.', cap 48, fallback 'project') + 8-hex suffix + '.json'. Deterministic per project.
- parseMemoryStore(raw): undefined returns empty ok (silent, like config ENOENT); broken JSON returns ok:false via template; non-object body / missing entries array return ok:false with exact reasons 'store body is not a JSON object' / 'entries is not an array'; per-entry narrowing keeps only finite numeric timestamp + non-blank string text.
- planMemoryWrite(entries, incoming, cap): cap<=0 or non-finite returns off ('memoryCap is 0; the memory store is off'); blank text returns skip ('blank advice text; nothing remembered'); else append then slice(-cap) (newest-kept); non-finite incoming timestamp coerces to 0.
- buildMemoryDigest(entries): empty returns undefined; else a synthetic SYSTEM message: content = prefix + ' Advice from earlier fires on this project, oldest first (N):' + '- <ISO> <text>' lines; timestamp = newest entry's (deterministic, no clock).

File config.ts - Regions I-L after tokenBudget: interface field 'memoryCap: number' (doc: 'Advice entries kept per project in .advisor-memory/. 0 disables memory.'); DEFAULT_CONFIG.memoryCap = 20; MIN_MEMORY_CAP = 0, MAX_MEMORY_CAP = 100; loadConfig narrowing via clampWithWarn('memoryCap', ...).

File index.ts - merged onto the locked Slices 1-2 fence:
- Region A gains 'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";' plus memory imports (buildMemoryDigest, memoryStoreFailureReason, memoryWriteFailureReason, MEMORY_DIR_URL, parseMemoryStore, planMemoryWrite, projectKey, and 'import type { MemoryEntry } from "./memory";').
- Factory closure: 'let memoryWarned = false' + warnMemoryOnce(msg) (warn-once latch discipline); readMemoryEntries(cap) (cap<=0 returns []; fs read of new URL(projectKey(process.cwd()), MEMORY_DIR_URL); ENOENT silent; !ok warns pinned reason; catch non-ENOENT warns template); rememberAdvice(cap, entry) (planMemoryWrite, then mkdirSync recursive + writeFileSync JSON.stringify({entries}, null, 2); fail-open warn).
- Region E REWRITTEN: buildMessages becomes a thunk that calls buildMemoryDigest(readMemoryEntries(config.memoryCap)) and returns buildAdvisorMessages(digest ? [digest, ...messages] : messages, config.tokenBudget). The read rides the buildMessages thunk so it runs ONLY on the consult path (gate-pass fires only); the digest as a system message survives the strip (no deltas) and the FR7 fold (systems never fold); tail untouched (digest enters at head).
- Handler tail after the planCommit notify arm: 'if (commit.action === "commit") rememberAdvice(config.memoryCap, { timestamp: Date.now(), text: outcome.text });' then 'return commit.result;' (write sits after the commit decision; a memory failure cannot touch the commit).

File .gitignore - append '.advisor-memory/' (full merged file is 10 lines).

File README.md - one config table row: memoryCap / 20 / 'Advice entries kept per project in .advisor-memory/. 0 disables memory. Clamped 0-100.'; one paragraph: each fire's advice appends to .advisor-memory/<project>.json, the next fire injects a digest as a synthetic system message ahead of the transcript, the directory is local untracked state and deleting it resets memory. (Slice 8 later adds the eval command to Verify.)

File tests/test.mjs - appended after the t22c block:
- Imports: config import gains MAX_MEMORY_CAP and MIN_MEMORY_CAP (biome alpha slots: after MAX_INTERVAL / after MIN_INTERVAL); new import { ADVISOR_MEMORY_PREFIX, buildMemoryDigest, memoryStoreFailureReason, memoryWriteFailureReason, parseMemoryStore, planMemoryWrite, projectKey } from '../memory.ts' (after guard, before plan-turn).
- Header carry-alongs: sibling list gains memory.ts ('config.ts, guard.ts, prompt.ts, advisor.ts, report.ts, plan-turn.ts, triggers.ts, and memory.ts import no sibling at runtime'); 'six sibling modules' count becomes 'eight' (updates Slice 1's 'seven').
- t23 pins: projectKey (deterministic; different paths differ; hostile path 'C:/repo a/beta: quoted-char' matches /^[A-Za-z0-9._-]+[.]json$/; projectKey('') startsWith 'project-'); parseMemoryStore (undefined gives empty; broken JSON via startsWith '[advisor-turn-gate] ignoring unreadable memory store ('; exact reasons for non-object and missing-entries via the template fns; 7-item narrowing keeps only {timestamp:1,'keep'} and {timestamp:4,'also keep'}); planMemoryWrite (cap 0 off; '   ' skips; 3 entries plus e4 at cap 2 yields [{3,e3},{4,e4}]; NaN timestamp yields write with ts 0); buildMemoryDigest ([] returns undefined; role system; pinned prefix; contains both texts; oldest first; timestamp 2); fold composition: applyTokenBudget([digest, fatUser, fatAssistant], 100)[0] === digest.
- t23c pins: memoryCap -1 clamps to MIN(0); 999 clamps to MAX(100); 'many' falls back to default with neighbor interval 4 intact; {memoryCap:1e999, interval:0} shares one warn (warns.length === 1); DEFAULT_CONFIG.memoryCap === 20; both warn templates pinned exact.

**Slice 3 Success Criteria (drafted; write at 6.4)** - Automated: suite green incl. new t23/t23c; projectKey 4 pins; parseMemoryStore fail-open + narrowing pins; planMemoryWrite off/skip/newest-kept/coerce pins; buildMemoryDigest undefined/system/prefix/oldest-first/newest-ts + survives the FR7 fold; both warn templates exact; memoryCap clamp/narrow/latch + default 20; 'npx biome check memory.ts config.ts index.ts tests/test.mjs'; 'npx tsc --noEmit'. Manual: two live fires - the second opens with the '[advisor memory]' digest and .advisor-memory/<key>.json exists; memoryCap 0 creates no directory; deleting the directory resets silently; a corrupted store warns once and the fire still commits.

## Artifacts

- .rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md - in-progress design (Slices 1-2 locked; Slice 3 fence pending). Resume entry point.
- .rpiv/artifacts/solutions/2026-11-02_08-36-12_jarvis-advisor-evolution.md - selected approach + slice order.
- .rpiv/artifacts/research/2026-11-01_21-23-59_jarvis-advisor-evolution.md - verified host surface (1.4 boundary, completeSimple tools param, custom_message replay).
- .rpiv/artifacts/discover/2026-11-01_21-07-45_jarvis-advisor-evolution.md - FRD (FR1-FR9).
- This handoff: .rpiv/artifacts/handoffs/2026-11-02_12-23-18_jarvis-advisor-design-slice3.md

## Action Items & Next Steps

1. Start a fresh session (/new), then run /skill:design --resume .rpiv/artifacts/designs/2026-11-02_08-55-26_jarvis-advisor-evolution.md - it re-enters Step 6 at pending Slice 3 (Project memory).
2. Step 6.1: regenerate the Slice 3 code from the Learnings section above (all names, bounds, defaults, and pinned strings are contract) plus the artifact's locked Slices 1-2 fences.
3. Step 6.2: dispatch slice-verifier via a direct top-level Agent tool call (run_in_background: false), passing artifact_path, slice_id 'Slice 3', the verbatim slice code + Success Criteria, and target files. Tell the verifier that disk is the pre-slice baseline and the artifact is authoritative.
4. Step 6.3: present the condensed micro-checkpoint (per-file summary/signatures/key blocks + mandatory Fit line) and confirm via ask_user_question.
5. Step 6.4 on approval: Edit the artifact - fill the memory.ts fence; extend the config.ts fence to 'Slices 1, 2, 3 regions' (Regions I-L); rewrite the index.ts fence (Region E final form + Regions F/G); fill the .gitignore and README fences; extend the tests fence (imports union, header 'eight', t23/t23c); fill the Slice 3 Slices entry's Verification subsections; Design History becomes 'approved as generated'. Byte-check, then STOP with the resume instruction (Slice 3 is non-final - the next slice requires a fresh session).
6. Later sessions: Slices 4-8 in order via --resume.

## Other Notes

- House contracts that gate every slice: never throw / fail-open with exact-string pins; pure spokes have ZERO runtime imports (type-only pi imports OK); only index.ts imports siblings extensionless ('./memory'); config fields narrowed per type against DEFAULT_CONFIG, numbers via clampWithWarn with named MIN/MAX and a shared warn-once latch; ENOENT silent, broken JSON warns once; single test file (plain node:assert, runs under 'node --experimental-strip-types'); test sections numbered t1b...t22c, Slice 3 continues t23/t23c; customType stays 'advisor-turn-gate'.
- Key baseline line references: plan-turn.ts planGate arms (cadence/outcome/markFired around :89-119); prompt.ts stripToolDeclarations :48-66, ensureUserTail :68-85, buildAdvisorMessages :87+; config.ts loadConfig :130-190, clampWithWarn :76-90; index.ts handler :37-95; tests/test.mjs withConfig :86-99, captureWarn :101-112, gateArgs factory around :305.
- Ordering constraint to respect: Slice 3's digest composes with Slice 2's window (strip, fold, tail; the digest survives); Slice 4 will add details keys (fire id / turn index) in plan-turn.ts - memory.ts deliberately does NOT pre-add them.
- The skill pipeline's metadata echo failed again this session (PowerShell echo errors gave branch 'no-branch' / commit 'no-commit'); real repo state is main at faae538 (used in the frontmatter above).
- Communication: the user runs with ADHD mode - keep replies action-first, numbered, groups of 5 items max, one concrete next action at the end.