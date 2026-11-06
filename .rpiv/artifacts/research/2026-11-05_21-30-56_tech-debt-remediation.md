---
date: 2026-11-05T21:30:56+0700
author: Yogiswara Utama
commit: d2cd108
branch: main
repository: advisor-turn-gate
topic: "Resolve all open tech-debt findings (F020, F029-F037)"
tags: [research, codebase, gate-hook, sandbox, memory, docs, tests, host-bump]
status: ready
last_updated: 2026-11-05T21:30:56+0700
last_updated_by: Yogiswara Utama
---

# Research: Resolve all open tech-debt findings (F020, F029-F037)

## Research Question

Chained from the discover FRD (`.rpiv/artifacts/discover/2026-11-05_21-08-52_tech-debt-remediation.md`): how to implement the nine open TECH_DEBT_AUDIT.md findings (F020, F029-F037) by adopting the audit's probe-verified recommendations as written — security pair first (F035, F031), then docs (F029, F034), then the test split (F030), then the dependency bump with its F008 re-record (F020), then the four Low quick wins (F032, F033, F036, F037) — one commit per finding group, each naming its finding ID.

## Summary

All nine seams were traced at HEAD `d2cd108` and every fix is mechanically specified. The audit's own `file:line` citations drifted in four places; this doc carries the corrected coordinates throughout. The fixes decompose cleanly: F035 is 3 Set members + 1 widened regex character class with append-only t19 pins; F031 is one `SECRET_SEGMENT` regex applied at TWO sites (pure `planRead` before `resolve`, and the symlink realpath arm with its own backslash normalization); F029/F034 are enumerated stale-line edits across THREE docs (guidance architecture.md, AGENTS.md, and a discovered twin `.agents/rules/main.md`) plus one plan-turn.ts banner; F030's 3,174 movable lines map exhaustively onto the eight mandated suites behind a 12-line runner, with helpers decided into `tests/helpers.mjs`; F020 is a lockfile-only move (carets stay) whose F008 re-record must land in four greppable locations and whose only real verification is the manual `runtime` reach check (t14/t16 duck-type and are provably blind to slot relocation); F032 is a 7-character-per-line un-export with a four-layer proof stack; F036 is a seam-side per-signal latch mirroring the `hostChecked` precedent with a pure message builder in triggers.ts (the only pinnable home); F033 is a one-line JSDoc reword; F037 is a silent `Buffer.byteLength` cap at `recordAdvice` with the digest's post-fold insertion as the reason the cap is the right arm. The precedent sweep shows this repo's fix commits are individually sound — every past residue was NEARBY PROSE (stale citations, twin doc lists, count pins), so each commit below budgets its own prose sweep.

## Detailed Findings

### F035 — root-like rm matcher (scripts/hooks/gate.mjs)

- `ROOT_LIKE_TARGETS` is the 11-member Set at `scripts/hooks/gate.mjs:29-42`; `isRootLikeTarget` at `scripts/hooks/gate.mjs:44-47`; the drive-root regex `/^[a-zA-Z]:\\?$/` at `scripts/hooks/gate.mjs:46` accepts `C:` and `C:\` but not `C:/`. (Note: `evaluate()` sits at `scripts/hooks/gate.mjs:95-106`, not :73 as the audit premise said; :73 is inside the F021 comment block.)
- Full path: `evaluate` (:95, exported pure core, imported by the suite at `tests/test.mjs:106`) → `blocksRecursiveRemove` (`scripts/hooks/gate.mjs:53-60`; prefilter `/\brm\s/` at :54, whitespace-only tokenization at :55, flag collection via `isFlag` :49-51, targets = `tokens.slice(1)` minus flags) → per-token quote-strip `token.replace(/^["']|["']$/g, "")` at `scripts/hooks/gate.mjs:45` (strips at most one leading + one trailing quote).
- Tokenization is whitespace-only: quotes survive the split, so `rm -rf "C:/"` tokenizes to `"C:/"` with quotes attached and reaches the regex only via the quote-strip. `../*` tokenizes as ONE token (no whitespace in a glob). The space-separated spelling `rm -rf ../ *` is already covered: `..` (:40) and `*` (:38) are existing Set members.
- Glob expansion is genuinely out of scope, audit reasoning confirmed: `readHookField` (`scripts/hooks/lib.mjs:28-32`) hands the literal command string and the exit-2 verdict (`scripts/hooks/gate.mjs:125`) happens BEFORE the shell runs. The matcher must key on the literal `../*`.
- Fix as written (`TECH_DEBT_AUDIT.md:78-89`): append `"../"`, `"../*"`, `"~/.."` to the Set (11 → 14 members, one per line matching on-disk style) and widen the regex to `/^[a-zA-Z]:[\\\/]?$/` — `C:` and `C:\` keep matching; `C:/` joins them. The condensed one-line Set presentation in the audit is presentation, not prescription.
- Post-fix reach: `rm -rf C:/` blocked (regex), `rm -rf "C:/"` blocked (quote-strip delivers it), `rm -rf ../`, `rm -rf ../*`, `rm -rf ~/..` blocked (Set); `rm -rf node_modules` still allowed (already pinned byte-exactly at `tests/test.mjs:1410` as the allowed array's first member — the audit's "add node_modules" is already satisfied; do NOT duplicate); `rm -rf build` is the ONE net-new allowed pin (deliberately distinct from the existing `"rm -rf ./build"` at `tests/test.mjs:1411`).
- Pin placement (byte-identical contract = append-only; loops and assert templates untouched): the four new blocked entries append into the `blocked` array after `["chmod -R 777 /", "chmod"],` (`tests/test.mjs:1404`) before the closing `];` (:1405); the one new allowed entry appends after `"ls -la",` (:1423) before `];` (:1424). The blocked loop's assert is at `tests/test.mjs:1407`, allowed loop's at :1426 — both derive their message wholly from `${command}`, so appended members render correct pins for free. Trailing standalone asserts :1428-1430 untouched.
- Cross-suite collision check: t19b's force-push pins (`tests/test.mjs:1433-1476`) are protected from the widening by the `/\brm\s/` prefilter; `eval/runner.mjs` has zero `rm -rf` fixtures (its `evaluateScore` at `eval/runner.mjs:156` is unrelated). No reason string changes — the rule still reports `"rm -r[f] on a root-like target"`.

### F031 — sandbox secret denylist (sandbox.ts, two sites)

- Site 1 — `planRead` (`sandbox.ts:74-91`): shape guard 75-79, `resolve` 81-83, the ONLY current refusal is the escape check 83-88 (pinned reason at :87: `advisor sandbox refused "${requested}": outside the project directory`), allow at :90. The denylist inserts between the shape guard's close (:79) and `resolve` (:81), so it sees the RAW `requested` string and OUTRANKS the escape check — `../.env` refuses with `"a secret file"`, not `"outside the project directory"`. No existing pin requests a secret-named path, so no existing pin observes the reordering.
- Site 2 — the symlink realpath arm inside `createSandbox`'s closure: `fs.realpathSync(plan.absolute)` at `sandbox.ts:164`, prefix re-check 165-172 (the corrected coordinates — the research premise's 184-199 is the catch arms), escape refusal 169-171, `readFileSync(real)` :175, byte cap 178-181, catch arms 182-190 (ENOENT :186, EISDIR :189, generic :190).
- The audit's verbatim regex: `/(^|\/)(\.env[^/]*|\.npmrc|\.git|id_rsa[^/]*|[^/]*\.pem)$/i` run on `requested.replace(/\\/g, "/")`. The realpath side receives a RESOLVED ABSOLUTE path in the platform's native separator — on win32 that is backslashes, and the verbatim regex run un-normalized systematically misses (the `(^|\/)` arm can never reach the final segment past `\`). The realpath-side re-check is therefore the SAME regex on `real.replace(/\\/g, "/")` — same normalization, different input regime.
- Both sites are required, not redundant: a symlink named `docs/api.md` whose target is `<root>\.env` passes Site 1 (innocent name) and is caught only at Site 2 (containment check alone misses the secret name); a secret-NAMED path is refused at Site 1 before any fs I/O. Each site covers exactly the case the other cannot see.
- Regex reach semantics (adopt-as-written consequences): `.env`, `.env.local`, `.envrc`, and `.env.example` all match (`[^/]*` eats `.example`) — the strict no-example-exception decision is IN the pattern; `foo.env` does NOT match; `.npmrc` exact; `.git` matches only as a whole final segment — `.gitignore` does NOT match and `.git/config` does NOT match (its final segment is `config`); the audit's narrative lists `.git/config` as readable today but the verbatim regex's reach is narrower — adopting as written pins the narrower behavior; `id_rsa`/`id_rsa.pub` match from segment start; anything ending `.pem` matches; case-insensitive throughout.
- Wiring and blast radius: `index.ts:184-187` — `tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined` + `executeTool: createSandbox(process.cwd(), SANDBOX_MAX_BYTES)` (the corrected second site; the audit's 129-134 points at the trigger thunk tail). Downstream, `advisor.ts:558-560` calls the executor and `advisor.ts:566-571` replays the result — file contents go verbatim to the provider and (memoryCap > 0) onward into the digest store. Post-fix, a secret read sends the one-line refusal instead.
- New refusal reuses the established prefix shape verbatim (audit's exact wording, `TECH_DEBT_AUDIT.md:96`): `advisor sandbox refused "${requested}": a secret file`. For the realpath arm, every existing `createSandbox` refusal interpolates the REQUESTED name (`sandbox.ts:170, 179, 186, 189`) — that shape is the consistent choice there. NO existing pinned reason string changes; the denylist is purely additive to the refusal vocabulary. The strip-tier guarantee extends for free (refusal strings carry no angle-bracket vocabulary per the module banner `sandbox.ts:24-27`; t25 strip pins at `tests/test.mjs:2598-2610`).
- Fixture placement (live-sandbox block `tests/test.mjs:2257-2292`): the audit says "reading" fixtures, so they belong where real files are written (:2262-2263) and the real `createSandbox(root)` drives (:2264). Insert the three asserts between the not-a-file pin (:2280) and `const capped = createSandbox(root, 4);` (:2281), or immediately after the happy read (:2266). Write `.env`, `src/.env.example` (via `mkdirSync` + `writeFileSync`), and `README.md` beside :2263 — README MUST exist because its pass path exercises realpathSync → readFileSync → cap end-to-end. The two secret refusals need no files on disk (Site 1 fires before `resolve`) but writing them keeps the fixture honest; assert with `.includes("a secret file")` to distinguish the denylist refusal from an accidental `no such file`.
- Stub-fs block (`tests/test.mjs:2295-2313`): the existing escape pin (:2301 returns `<tmpdir>/outside/secret.txt`, asserted :2311-2312) survives untouched — `secret.txt` matches no alternative. A deterministic realpath-side pin (stub whose `realpathSync` returns a secret-final-segment path, asserting the secret refusal) fits the block's own no-real-symlinks convention (:2296-2297); no audit-mandated fixture exists for it, so it is optional-but-recommended.
- Pure `planRead` block (`tests/test.mjs:2229-2255`): `join()`-built fixtures are platform-proof because the in-guard `.replace(/\\/g, "/")` normalizes every spelling — literal `"src/.env.example"`, `join("src", ".env.example")` on win32, and absolute `join(root, ...)` forms all match; `README.md` passes under all spellings.
- README's one security sentence goes under the `toolsEnabled` row (`README.md:38`).

### F029 — documentation drift (three docs, not two)

- The actual two-handler shape: `pi.on("turn_end")` registered `index.ts:59`, spans :59-274 — FR8 async detach branch at :198-235 (BOTH-slot guard :205, latch set :207, detached `void runAdvisor` :208, `heldAdvice` write :211), blocking await at :238, `planCommit` at :254; `pi.on("agent_before_settle")` registered `index.ts:281`, spans :281-301, slot-clear 282-284, `planSettle` at :286. Factory closure: `lastFiredTurn` :37, `hostChecked`/`hostSupported` :42-43, `fireCount` :49, `advisorInFlight`/`heldAdvice` declared together `index.ts:56-57` (slot-invariant comment :51-55). (The research premise's :160-186/:228-252 drifted; these are the verified ranges.)
- Stale lines in `.rpiv/guidance/architecture.md` (F029 scope): :9 ("no spoke imports a sibling at runtime. Pure spokes import nothing at all" — double drift: memory.ts/sandbox.ts import node builtins, and the sentence narrates six spokes); :12 ("THE single await"); :13-18 (six spoke rows → nine: advisor, config, guard, memory, plan-turn, prompt, report, sandbox, triggers); :14 (plan-turn annotation — core enumeration misses planSettle/planHostSupport/stampDetails); :19-20 (add an `eval/` line naming the second runner); :34 ("CI runs test, lint, and typecheck" — DISCOVERED: CI runs FOUR steps, `.github/workflows/ci.yml:22-24` plus the eval score gate at :27); :47-50 (optional: settle path deliberately omits `continue`, `plan-turn.ts:298-300`); :5 (status refresh, optional).
- Stale lines in `AGENTS.md`: :10 (the second carrier of the single-handler narrative — commits land at `agent_before_settle` under FR8, triggers fire ahead of cadence under FR3); :16-28 (`## Files` lists 11 entries, missing `memory.ts`, `sandbox.ts`, `triggers.ts`, `eval/runner.mjs`); :19 ("pure turn_end decision cores" undersells planSettle); :38 (CI sentence, same eval gap).
- DISCOVERED third doc: `.agents/rules/main.md:24-34` mirrors AGENTS.md's Files list and misses the same four entries; :25 repeats the "pure turn_end decision cores" phrasing; :31 is the F030-window test row. The F011 precedent (both AGENTS.md and main.md fixed together) says the docs commit includes it.
- In-code siblings of the await narrative (outside FR3's mandated two-doc scope — fix or consciously leave): `index.ts:22` (hub banner "the single advisor await") and `index.ts:144-145` ("The single await splits the decision"). `index.ts:237` already scopes "THE single await" to blocking mode; `index.ts:44-45` ("The single lastFiredTurn write") remains true.
- Sequencing (answered mechanically): F029's docs commit precedes F030 and must NOT anticipate the `suites/` layout — FR3's edit list contains no test-layout edit; writing docs for code that does not exist violates the guidance's own "treat the code as canonical" rule; between the commits nothing is false (test.mjs is still one file). The SPLIT commit amends the test rule itself in the same commit that creates `tests/suites/` — no falsity window opens. Canonical homes after the series: RULE = the guidance's tests `<important>` block (`architecture.md:64-68`); MECHANISM = the rewritten runner banner; INVENTORY = AGENTS.md Files + main.md mirror.
- F029's own commit then carries the small F030 doc delta it cannot avoid OR F030 absorbs its own blast radius (guidance :29 + :65, runner banner, `eval/runner.mjs:4-5`, `AGENTS.md:25`, `main.md:31`). The FRD order works with F030 absorbing its own radius; reordering is permissible but not forced.

### F034 — pure-module rule amendment + plan-turn.ts banner

- The rule lives at `.rpiv/guidance/architecture.md:59` ("ZERO runtime imports — `import type` for pi types, no sibling imports"). The convicting imports are `plan-turn.ts:1-4`: two host types (:1-2) and two TYPE-ONLY sibling imports (:3 `./advisor`, :4 `./triggers`) — erased under `--experimental-strip-types`. Loadability proofs: the suite imports plan-turn directly at `tests/test.mjs:77-84` (not :60-67 as premised; :76 is the memory close) and the eval runner at `eval/runner.mjs:48`, both plain node. The module already CLAIMS the contract: `plan-turn.ts:111-112` says "would break the zero-runtime-import contract this module documents" — pointing at a banner that does not exist. F034's banner makes that sentence true.
- Amendment wording (audit/FR8 verbatim): "no RUNTIME sibling imports; type-only sibling imports are permitted (erased under strip-types)". Both imported sibling symbols survive F032 (`AdvisorOutcome`/`AdvisorResolution` stay exported at `advisor.ts:29,31`; `TriggerDecision` at `triggers.ts:15-19` — F032 un-exports `TriggerSignal`, not `TriggerDecision`).
- Banner house style (measured from all eight existing banners): `advisor.ts:3-14`, `guard.ts:1-31`, `index.ts:14-28`, `memory.ts:5-21`, `prompt.ts:3-17`, `report.ts:1-15`, `sandbox.ts:4-31`, `triggers.ts:1-12`. Pattern: (1) `X.ts — <role>` title with optional FR tag; (2) semantics paragraph(s); (3) an explicit import-contract sentence in one of three canonical forms — "imports nothing" (guard/report/triggers), "type-only host imports erased" (advisor/prompt/memory), "no sibling, only node builtins" (sandbox); (4) banner placed after imports when imports exist, at line 1 when none. The bannerless set is {config.ts, plan-turn.ts} — config.ts is classified as an I/O spoke (diagram `architecture.md:13`), so "plan-turn is the only PURE module without a banner" holds.
- Banner content obligations: the four type-only imports and the no-runtime-sibling contract (F034-amended wording); the thunk-injection pattern (PlanGateArgs' injected thunks at `plan-turn.ts:64-102`, consumed in planGate :103-150; `strip` thunks in PlanCommitArgs :157-173 and PlanSettleArgs :258-277); the `plan*`/`*Decision` naming — with the precision trap that `HostSupport` (`plan-turn.ts:200`) is NOT a `*Decision` type and keys on `supported`, so the banner mirrors reality rather than overclaiming. Placement: after the import block, at `plan-turn.ts:6`. Length: 10-16 lines fits house style.
- Commit placement: same commit as the `:59` amendment (one compound act per audit/FR8); its own commit between F029 and F030. The diagram's `:14` parenthetical "(zero runtime imports)" is the same claim as `:59` — its reword rides F034 — but the row itself and the fence are F029's edit surface (F029 rewrites the fence first, F034 touches `:14`'s parenthetical second).
- Citation hygiene (load-bearing): F034 lands BEFORE F030, so the banner must cite by symbol/module ("the suite imports plan-turn.ts directly"), never by line number — otherwise the split commit must chase F034's wording. The suite-header sentence that IS the loadability evidence ("config.ts, guard.ts, memory.ts, prompt.ts, advisor.ts, report.ts, plan-turn.ts, triggers.ts, and sandbox.ts import no sibling at runtime…" at `tests/test.mjs:19-22`) must survive the split into the thin-runner banner.
- No tooling reacts to wording-only changes: tsc skips comments; biome excludes `.rpiv` (`biome.json:20-25`) and does not reflow comment text (`guard.ts:19` carries a ~120-char path line and `biome check .` is green).

### F030 — test-file split (tests/test.mjs → tests/suites/)

- Monolith structure: header 1-29, import block 30-113 (16 statements, 84 lines), helper block `tests/test.mjs:115-168` (54 lines: `assert` 115-120 setting `process.exitCode = 1` and never throwing; `tmpRoot` 122-123; the exit handler 124-129 with cleanup + `"test.mjs: FAILURES"`/`"test.mjs: all green"` summary; `withConfig` 131-148 calling `resetWarnOnceForTest` at :139, restoring `CONFIG_URL.href` in `finally` :143-147; `captureWarn` 150-160; `shapeJson` 162-165; `Q`/`marker` 167-168), then 39 banner sections from `// --- 1b.` (:170) through `// --- 27c.` ending :3343. No `--- 1` (deleted by F025, comment :171-173) and no `--- 12` (:927 ends §11, :994 opens §13).
- Exhaustive suite map (3,174 movable lines = exactly 170-3343):
  - `tests/suites/config.mjs` (263): banners 1b 170-250, 2, 3, 4, 4b, 5, 6, 7, 7b, 8 (170-432) — shouldFire cadence, loadConfig, clamp table, parseModelKey.
  - `tests/suites/gate.mjs` (485): 9 433-665, 11 927-993 (guard veto), 19 1384-1432, 19b 1433-1476, 19c 1477-1510, 20 1511-1568 (syntaxCheck writes fixtures via `writeFileSync` at :1518, :1524).
  - `tests/suites/prompt.mjs` (428): 10 666-707, 10b 708-735, 10c 736-926, 22 1780-1914, 22c 1915-1946.
  - `tests/suites/advisor.mjs` (962): 13 994-1018, 14 1019-1037, 15 1038-1053, 15b 1054-1141, 16 1142-1298, 17 1299-1336, 18 1337-1383 (reportFailure — `report.ts` rides here), 26 2656-3201, 26c 3202-3227.
  - `tests/suites/triggers.mjs` (211): 21 1569-1736, 21c 1737-1779.
  - `tests/suites/memory.mjs` (209): 23 1947-2122, 23c 2123-2155 (needs a 3-name prompt subset: buildAdvisorMessages, ADVISOR_NUDGE, BUDGET_FOLD_MARKER_PREFIX — used at :2074-2114).
  - `tests/suites/dialogue.mjs` (187): 24 2156-2226 (FR1 stamp core), 27 3228-3327 (FR8 settle core), 27c 3328-3343 (asyncMode door).
  - `tests/suites/tools.mjs` (429): 25 2227-2612 (planRead pure bound 2232-2260, live I/O from :2261, `createSandbox(tmpRoot)` :2539, escape probe :2605), 25c 2613-2655.
- Judgment calls to state in the F030 commit message: §18 (`reportFailure`) rides `advisor` (thematic: the advisor failure surface); §11 (guard veto) rides `gate` (it IS the gate's veto).
- The `*c` clamp-door sections follow the module they extend, NOT config.mjs: 21c→triggers, 22c→prompt, 23c→memory, 25c→tools, 26c→advisor, 27c→dialogue. Rationale: each is a chain-extension of its parent section (banners literally say "extends t…" at :1915, :2123, :2613-2614, :3202-3203, :3328-3329), each asserts the module-facing consequence (25c pins `DEFAULT_CONFIG.toolsEnabled === false` AND `maxToolRounds === 3` at :2652-2654), and the raw-string `1e999` idiom comment is duplicated per door (:1764-1765, :1932-1933, :2141-2142, :2640-2641) so it stays greppable per suite. The config names each door needs (`MIN/MAX_TOKEN_BUDGET` :1919/:1924, `MIN/MAX_MEMORY_CAP` :2126/:2130, `MIN/MAX_TOOL_ROUNDS` :2618/:2623, `DEFAULT_CONFIG` everywhere) ride per-suite config subsets.
- Helper placement — DECIDED (developer checkpoint, this session): **`tests/helpers.mjs`**, sibling of the runner, outside `suites/`. Exports `assert`, `tmpRoot`, the exit handler, `withConfig`, `captureWarn`, `shapeJson`, `marker`; `Q` stays private. Helpers imports 4 node builtins plus `import { CONFIG_URL, resetWarnOnceForTest } from "../../config.ts";` (one line, biome-collapsible). Keeps `ls tests/suites/` at exactly 8 entries (FRD acceptance); the one-file deviation from "no new modules" is named in the F030 commit message (the F008 accept-in-writing pattern is the precedent). Runner-exports was ruled out by arithmetic (54 helper lines + 8 imports cannot fit under 30) and would create the repo's first import cycle (`madge --circular` is green today); per-suite duplication was rejected as the exact drift F017 (74d3cec) already remediated for scripts/hooks.
- Load-bearing detail: the exit handler MUST live in `tests/helpers.mjs`, not the runner. With static imports the runner's body executes LAST; a throw in suite 1 would skip a body-registered handler and lose cleanup/summary. Helpers is suite 1's first dependency, so its handler registers before any suite body runs. Summary string stays `"test.mjs: all green"` — still accurate because the runner IS `tests/test.mjs`.
- Runner shape: 12-line static bare side-effect imports, NO try/catch, NO wrapping:

  ```
  import "./suites/config.mjs";   // 1b-8
  import "./suites/gate.mjs";     // 9, 11, 19-20
  import "./suites/prompt.mjs";   // 10-10c, 22-22c
  import "./suites/advisor.mjs";  // 13-18, 26-26c
  import "./suites/triggers.mjs"; // 21-21c
  import "./suites/memory.mjs";   // 23-23c
  import "./suites/dialogue.mjs"; // 24, 27-27c
  import "./suites/tools.mjs";    // 25-25c
  ```

  Import order = each suite's FIRST banner (config 170 → gate 433 → prompt 666 → advisor 994 → triggers 1569 → memory 1947 → dialogue 2156 → tools 2227). The FRD's brace list `{config,prompt,advisor,gate,…}` is the SET of names, not a sequence — importing it literally would scramble ranges.
- Fail-fast preserved BY CONSTRUCTION: `assert` never throws (sets `process.exitCode = 1`), so the halt scenario is an unexpected throw; in the monolith it aborts the file body while the exit handler cleans up. In the split, ESM evaluates the static import graph depth-first in statement order — a throw during suite N aborts graph evaluation, later suites never evaluate, the process exits non-zero. Wrapping suites in try/catch would be a semantic CHANGE, not a safety improvement. Escape hatch if Biome objects to non-alphabetical bare imports: a dynamic-import loop (`for (const s of […]) await import(…)`) preserves fail-fast identically and hides order from sorters.
- The interleaving reality: modules interleave in banner order (gate owns 433/927/1384; prompt 666/1780; advisor 994/2656), so exact global PASS-line order is mathematically unattainable with one import per suite. "Byte-identical pins" therefore means every assert call and message string moves byte-for-byte; the log sequence reorders at suite granularity. Safe because there is no cross-section state: `withConfig` restores in `finally` (:143-147), the memory window swap is block-local (:1949-1956, second swap :2027-2031), and both latches re-arm at each use (:139, :1951).
- Import specifiers: 12 monolith specifier lines change; they re-emerge as 21 deepened lines across 9 files (config.ts ×9 — helpers `{CONFIG_URL, resetWarnOnceForTest}` + gate `{shouldFire}` + prompt `{DEFAULT_CONFIG, MAX_TOKEN_BUDGET, MIN_TOKEN_BUDGET, loadConfig}` + advisor/triggers/dialogue `{DEFAULT_CONFIG, loadConfig}` + memory `{DEFAULT_CONFIG, MAX_MEMORY_CAP, MIN_MEMORY_CAP, loadConfig}` + tools `{DEFAULT_CONFIG, MAX_TOOL_ROUNDS, MIN_TOOL_ROUNDS, loadConfig}` + the full 16-name block in config.mjs; plan-turn.ts ×3 — gate `{planGate, planCommit, planHostSupport, buildCorrection}`, triggers `{planGate, planHostSupport}`, dialogue `{buildCorrection, planCommit, planSettle, stampDetails}`; prompt.ts ×2 — full block in prompt.mjs + the memory subset; everything else ×1). Node-builtin statements replicate where suites touch fs/path/url directly (helpers, config, gate, memory, tools; os only in helpers). Totals: ~53 statements / ~75 lines across 10 files.
- `eval/runner.mjs` stays byte-untouched: its banner (:1-15) is self-contained, cites the split rule (:2-4), and never references `tests/test.mjs` by path. The FRD confirms the split does not fold it back.
- Biome interactions: suites/helpers/runner are linted+formatted from the moment they exist (`biome.json:20-25` includes `**` minus node_modules/.git/.rpiv). The audit attests `biome check .` clean at 35 files — every movable line is already in Biome's canonical output, so a verbatim move cannot reflow a pin. The one real trap: per-suite import SUBSETS that fit 100 columns must be written COLLAPSED (Biome collapses multi-line braced imports when they fit); a wholesale copy of the 84-line import block fails unused-import lint — each suite takes its exact binding subset. Verify `npx biome check tests/test.mjs` once on the first written runner; the dynamic-import fallback or a scoped `tests/suites/` assist-off in biome.json are the documented outs.

### F020 — dependency bump + F008 re-record

- Mechanics: `package.json:24-25` declare `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` at `^1.4.0`. 1.5.0 satisfies `^1.4.0`, so `npm audit fix` (non-force) resolves within-range and rewrites `package-lock.json` ONLY — the caret ranges need NO edit. `undici` and `minimatch` are not declared at all (`package.json:22-28`: biome, pi-ai, pi-coding-agent, @types/node, typescript) — both ride the lockfile with zero manifest surface. F008's "the caret stays" survives mechanically, not just by decision.
- The F008 contract lives in TWO places needing re-record, plus two more for greppability:
  - The reach-site JSDoc on `getRuntimeCompleteSimple`, now `advisor.ts:155-179` (premise's 141-175 drifted ~14 lines; verified anchors: model-registry citation `advisor.ts:161`, "stable on 1.4.0" :162, F008 paragraph opening :166, function :180). :166's "`^1.4.0`" stays byte-identical (still true after a lockfile-only bump) — the re-record APPENDS the re-verification fact. :161's version-prefixed anchor must be re-verified against 1.5.0's dist and rewritten (1.4.0 baseline verified locally: `dist/core/model-registry.js:6` class, :7 bare `runtime;` field, :9 ctor assignment — the cited 5-9 span lands on field+ctor).
  - `TECH_DEBT_AUDIT.md:41` (F008 row): `ACCEPTED 2026-10-30` → `RE-RECORDED <fix-commit> · re-verified at 1.5.0`; :53 (F020 row) flips `OPEN · UPDATED 2026-11-05` → `RESOLVED` naming the resolved versions.
  - The F020 COMMIT MESSAGE must name 1.5.0.
  - The versions themselves: `package.json:20-21` → `^1.5.0` (if the resolver rewrites the range — verify; else lockfile-only) + `package-lock.json:13-14, 694`.
  - Acceptance greppability: `grep -n "1.5.0" advisor.ts TECH_DEBT_AUDIT.md package.json` plus the commit body.
- DISCOVERED drift inside the F008 paragraph itself: `advisor.ts:171` cites `index.ts:60-61` for the cadence-latch spend — today that is the host-support block; the latch spend is the `markFired` thunk at `index.ts:135-137` invoked at planGate's gate-pass (`plan-turn.ts:157-159`). The F020 commit edits this paragraph and should repair this anchor in the same breath (the F023 precedent: fold adjacent stale citations INTO the fix that makes them stale).
- What t14/t16 prove and what they'd MISS: t14 (`tests/test.mjs:1019-1037`) pins `getRuntimeCompleteSimple` over five synthetic objects — passes against ANY host forever. Blind spots: slot rename/privatization (`#runtime`), slot relocation (getter/WeakMap — the structural read at `advisor.ts:184-188` returns undefined on the real registry while stubs pass), `completeSimple` moving off the runtime object (1.4.0's registry already carries its own public `complete` wrapper at `model-registry.js:77-79`), signature drift (every stub is zero-arg; reordered context/options would pass while breaking deadline-abort forwarding `advisor.ts:394-401`). t16 (`tests/test.mjs:1142-1296`; stub registry at :1196) pins the FAILURE SHAPE at :1207/:1215-1216 (`/no auth-aware completion facade/` over `registry: {}`) — if the slot relocates, t16 still passes while every real fire fails open into exactly that string.
- The observable failure shape: guard at `advisor.ts:471-474` (premise's 448-452 drifted; `getRuntimeCompleteSimple` :471, the pinned reason :473), position documented :466-470. Downstream: planCommit's notify arm (`plan-turn.ts:176-178`) → `reportFailure` (`index.ts:139-141`) — and `reportFailure` is hasUI-gated (`report.ts:30-34`) and swallowed in `--print`/child sessions (`report.ts:4-8`), so on a headless host a relocated slot means PERMANENTLY SILENT advisory loss. That is why the manual reach check gates the merge (audit Top-5 #5; the FRD's Open Question).
- Host-anchor census (comments are compiled by nothing; a 1.5.0 bump silently invalidates them): version-prefixed anchors that name 1.4.0 and MUST be re-verified in the F020 commit — `advisor.ts:161` (model-registry.js:5-9, load-bearing), `advisor.ts:425` (pi-ai lazy.js:57-64), `advisor.ts:427` (event-stream.js:52-58), `guard.ts:18` (loader.js:480-483, load-bearing — the moduleCache:false identity argument), `guard.ts:84` (text.js:11-18), `guard.ts:89` (system-prompt.js:126-130, load-bearing). Bare-filename dist anchors to sweep in the same commit — `advisor.ts:307` (runner.js:774), `:435-436`/`:468` (model-runtime.js:452-470), `:440` (types.d.ts:307 — correctness-relevant: the closed 7-member union claim behind the stop-only gate; an eighth member still fails open via `advisor.ts:514-519` but the count claim goes stale), `config.ts:171` (agent-session.js:918), `guard.ts:11,12-13,20,38,92-93,99`, `index.ts:18` (package-manager.js/loader.js), `:25` (loader.js:37-88), `plan-turn.ts:29` (session-manager.d.ts:103), `:44` (runner.js:775-776 — LOAD-BEARING: emitBoundary-replaces-accumulator behind the mandatory spread), `:206` (agent-session.js:375-384), `:275` (agent-session.js:1578-1584), `prompt.ts:132` (transform-messages.js caret note), `report.ts:4,5,10-11,27`. `memory.ts`, `sandbox.ts`, `triggers.ts` carry ZERO host anchors. Lesson applied: prefer files + symbols over line spans wherever the claim survives without the span.
- knip is NOT a devDependency — the audit ran it "installed locally"; the definitive zero-dead-export proof stays a manual `npx knip@6.44.1`. The run-#3 audit content is UNCOMMITTED at HEAD (`git status`: `M TECH_DEBT_AUDIT.md`) — the remediation series must commit it.

### F032 — dead exports (eight, zero consumers)

- Ledger (declaration → in-file uses that must keep working; the un-export is a 7-char deletion of the `export ` prefix):
  - `MIN_TRIGGER_TOKENS` / `MAX_TRIGGER_TOKENS` — `config.ts:87-88`; used at `config.ts:244-245` (clampWithWarn for triggerMinNewTokens).
  - `MIN_TRIGGER_PERCENT` / `MAX_TRIGGER_PERCENT` — `config.ts:89-90`; used at `config.ts:253-254`.
  - `READ_FILE_TOOL_NAME` — `sandbox.ts:34`; used at `sandbox.ts:123` (READ_FILE_TOOL.name) and `sandbox.ts:153` (allowlist gate).
  - `ToolExecutionResult` — `advisor.ts:41`; used at `advisor.ts:44` (ToolExecutor — STAYS exported), `:378` (runConsultLeg return), `:539` (loop). Becomes `type ToolExecutionResult = …`.
  - `SandboxResult` — `sandbox.ts:46`; used at `sandbox.ts:49` (AdvisorSandbox — stays exported).
  - `TriggerSignal` — `triggers.ts:15`; used at `triggers.ts:20` (TriggerDecision fire arm — stays exported; `plan-turn.ts:4` imports TriggerDecision, never TriggerSignal).
- Zero-consumer proof: the suite import block omits all eight (types could never be consumed by plain .mjs anyway); `eval/runner.mjs:31-55` omits them; `index.ts:5-12` omits them; repo-wide grep shows the names only in declaring files plus docs/artifacts quoting code (TECH_DEBT_AUDIT.md:65 — safe, lacks the `export ` prefix — the FRD (:49, :80), and historical plans/designs at `.rpiv/artifacts/plans/2026-11-03…:312-315/:1940/:1952/:2122` and `designs/2026-11-02…:2571-2574/:481/:493/:2240`).
- Proof stack: (1) `tsc --noEmit` catches any dangling named import as TS2305 (scope caveat: `tsconfig.json:17` `include: ["*.ts"]` covers root only); (2) `npm test` / `npm run eval` are link-time checks — a removed-but-imported export throws `SyntaxError: … does not provide an export named 'X'` before any assertion; (3) the FRD acceptance grep as literally written FALSE-POSITIVES on the historical artifacts — gate it with `--exclude-dir=.rpiv --exclude-dir=node_modules --exclude-dir=.git`; (4) knip re-run, manual (above).
- Biome: every touched line SHRINKS by 7 characters; all land well under 100 columns; no re-wrap; no JSDoc on any of the eight becomes false (`triggers.ts:14` "named for pins and eval scoring" stays true — t21 pins the string VALUES at `test.mjs:1602`/`:1610`, not the type export). Reference precedent for citing an un-exported constant: `eval/runner.mjs:64-66` (MARKER_SLACK parity comment) and `advisor.ts:50-56` (DEFAULT_MAX_TOOL_ROUNDS parity).
- F032 and F036 collide harmlessly in triggers.ts's top region (the TriggerSignal un-export and F036's new builder export); a post-both knip run must show the builder USED (index.ts imports it).

### F036 — warn-once for starved trigger signals

- The starvation: signal extraction at `index.ts:114-134` (armed check :114; thresholds shaped :77-82; `turnTokens: … usage?.output ?? null` :120-122; `contextPercent: ctx.getContextUsage?.()?.percent ?? null` :123); the thunk runs ONLY on a cadence miss (`plan-turn.ts:128-130`); `planTrigger` silently no-ops the tokens arm (`triggers.ts:85-89`) and pressure arm (:92-96) on null — an armed-but-starved trigger never fires and never says so. Only TWO arms can starve: `outcome` and `toolNames` extract unconditionally (`index.ts:124-125`), so error and risky-tool are structurally un-starvable. Today's coverage gap: t21 (`tests/test.mjs:1569-1735`) never pins armed-but-null (its "sub-threshold" case at :1621-1623 uses `turnTokens: 10` vs 1000, not null).
- Message template: audit `TECH_DEBT_AUDIT.md:69` and FRD FR9 carry the IDENTICAL template — `[advisor-turn-gate] trigger <name> is armed but this host provides no <signal> data`. Bindings resolved: `<name>` = the CONFIG FIELD (`triggerMinNewTokens` / `triggerContextPercent`) — "armed" is a config property in this codebase's vocabulary and the field name is greppable to the config surface; `<signal>` = the pin/eval-facing signal name (`tokens` / `pressure` — the `TriggerSignal` members, "named for pins and eval scoring" `triggers.ts:14`).
- Placement (Option C, matches the audit letter): DETECTION seam-side in the thunk right where null-ness is decidable; the ONCE-LATCH in the factory closure alongside its four siblings (`lastFiredTurn` :37, `hostChecked`/`hostSupported` :42-43, `fireCount` :49, slots :56-57). The `hostChecked` block (`index.ts:64-71`) is the exact precedent — once-latch + pure decision + seam-side report — and its pure decision's message is pinned offline (`tests/test.mjs:1719-1733` region) while the seam latch is deliberately un-pinned. F036 mirrors it one-for-one.
- The STRING must NOT live in index.ts: the suite cannot load the seam (`tests/test.mjs:13-15`), the F030 suite list has no seam suite, and `index.ts` today contains ZERO user-facing string literals (every notify message originates in a pure core). So `triggers.ts` grows a small PURE builder export (e.g. `starvedTriggerWarn(field, signal)` returning the instantiated template) — hub-imports-spoke is topology-legal — and the pin lives in `tests/suites/triggers.mjs`. Option A (warn inside planTrigger) rejected: breaks the purity contract `triggers.ts:7-8` declares and would make eval replays order-dependent. Option B (warn-payload decision through GateDecision's skip arm) viable but over-coupled for a Low finding.
- Latch granularity: PER-SIGNAL, not global — the two extraction sites (`event.message.usage` vs `ctx.getContextUsage()`) fail independently, and a single global latch would silently swallow the second distinct starvation. No `resetForTest` affordance needed in this shape: a closure latch in index.ts is unreachable from the suite — the same accepted gap as `hostChecked` — and is per-factory rather than per-process (a pi reload re-arms it). The alternative (module latch in triggers.ts) would REQUIRE the F002-pattern reset twin and eval fixture calls — strictly more surface.
- Channel: `console.warn` (the `config.ts:106` style), NOT `reportFailure` — reportFailure is hasUI-gated and swallowed in `--print`/child sessions, precisely the headless environments where a starved diagnostic must still land.
- Pin plan (all NEW pins — additive under F030's byte-identical rule, which governs moved pins only): (1) the builder's exact bytes for both crosswalk instantiations; (2) the previously-missing behavior pins — armed + `turnTokens: null` → `{ action: "none" }` and armed + `contextPercent: null` → `{ action: "none" }`. Eval cannot catch the seam latch either way: `eval/fixtures/trigger-arms.json:34-37` supplies present signals and `SCORES` (`eval/runner.mjs:71-151`) inspect committed entries, never stderr.

### F033 + F037 — memory banner reword and per-entry byte cap

- F033: the false claim is inside `recordAdvice`'s JSDoc (`memory.ts:160-168`), at `memory.ts:167`: "written atomically-whole (one writeFileSync per fire)". The parenthetical is TRUE (exactly one `writeFileSync` call site, `memory.ts:175`, once per invocation); "atomically-whole" is FALSE (writeFileSync truncates-then-writes). The reword to "self-healing whole-file rewrite" is justified by the quiet pre-read chain: `readEntriesQuiet` (`memory.ts:155-158`) → `parseStore` (:118-132, corrupt JSON → not-ok) → collapsed to `[]` at :157 → `capEntries` append :173 → whole-file rewrite :174-175 — the corrupt store's contents are dropped, no warning fires on this path (the loud `readEntries` :142-149 warns only at :145-147 if a corrupt file ever survives to a READ). The body (:169-180: trim → guard → capEntries → mkdirSync → writeFileSync → catch/warnOnce) is untouched. `memory.ts:167` is the ONLY "atomically-whole" occurrence in any .ts file (acceptance grep is clean-able).
- F037 — where: the cap lands inside `recordAdvice` between the trim (`memory.ts:170`) and the append (:173), measuring `Buffer.byteLength(trimmed, "utf8")` — true bytes, the audit's unit verbatim, matching the house's only other byte measurement (the sandbox's buffer-length cap, `sandbox.ts:179`). `Buffer` is a Node global — no new import (`memory.ts:1` imports only mkdirSync/readFileSync/writeFileSync). The byte cap and the count cap compose at the single seam: text capped per-entry first, then `capEntries` (`memory.ts:98-102`) newest-wins — orthogonal knobs at one call site.
- F037 — why recordAdvice is the right site: the digest re-enters prompts AFTER the fold. `digestMessage` (`memory.ts:189-198`: per-entry `- ${entry.text}` lines :191, `DIGEST_HEADER_PREFIX` :39, header :195, role "system" :194) is injected by the seam (`index.ts:104-109`) into `buildAdvisorMessages` (`prompt.ts:368-383`) — pipeline runs 373-378, digest joins 379-382 in front of the terminal tail, "never a fold candidate" (claim pinned `prompt.ts:363-367`). `applyTokenBudget` (`prompt.ts:283-332`) never sees it: accounting :286-288 runs pre-digest, the loop :292-300 would skip system roles anyway (:294), and the tail bound protects the last message. The estimator is chars/4 over UTF-16 units (`prompt.ts:263-264`, `CHARS_PER_TOKEN = 4` :239) — deliberately a different unit from the byte cap. The unbounded vector today: `MAX_MEMORY_CAP = 200` entries (`config.ts:94`) × unbounded text lines. The FRD's timing contract: truncate at RECORD time, not read time — the store only ever holds capped entries, so readEntries/digestMessage need no changes.
- F037 — constant shape: neither audit nor FRD prescribes name, value, or export status. In-file precedent: `KEY_SLUG_MAX` (`memory.ts:59`) — module-local, UN-exported, doc-commented, consumed at one site (:84). The F032 disposition (no exports without consumers) forward-applies: an un-exported `const MAX_…_BYTES` beside `KEY_SLUG_MAX` is the F032-consistent shape. Counter-precedent noted: config's `MIN/MAX_MEMORY_CAP` (`config.ts:93-94`) are exported-but-test-consumed, so exporting for t23 would equally not be knip-dead — either is defensible; un-exported mirrors KEY_SLUG_MAX.
- F037 — silent truncation (recommended, three args): the texts prescribe no warn while F036's text DOES prescribe one (they specify warns when they want them); `KEY_SLUG_MAX` truncates silently (:84); and the latch coupling — `memoryWarned` is ONE module-level latch (`memory.ts:42`, warnOnce :44-48) shared by the corrupt-read warn (:145-147) and the write-failure warn (:178), so a truncation warn would consume it and break the corrupt-store pin (`tests/test.mjs:1999-2006`, asserting `corruptWarns.length === 1` at :2003-2006) without reset orchestration (:2026 resets only before the hostile-write pin :2040-2043). Fail-open is honored by construction: a capped entry is still recorded (bounded, not lost).
- F037 — fixture: t23 spans `tests/test.mjs:1947-2121` (23c :2123-2155). The over-cap case belongs in the recordAdvice round-trip subsection — insert right after the write-time count-cap pin (:1978-1984) or the blank-skip pin (:1986-1988): a `recordAdvice(key, <over-cap string>, cap, ts)` call, then assert `readEntries(key).at(-1).text` is byte-capped to the constant's value. The exact-string digest pins (:2046-2065) hand-construct entries and call `digestMessage` directly — untouched. All other t23 texts are ≤11 bytes. Eval is unaffected: `makeEnv` seeds `fixture.priorEntries` directly to disk (`eval/runner.mjs:221-226`), bypassing recordAdvice; the only eval-side recordAdvice is the stub-outcome write (:346, short texts).
- F037 — consumer census (nothing is surprised by truncation): `digestMessage` (:191) and the `isEntry` string guard (:108) — a truncated text is still a string; the eval scorer (`eval/runner.mjs:131`) reads the FIXTURE's own seeded entry; docs (`README.md:37`, `config.ts:32`) describe memoryCap as entry-count only; memory.ts is absent from the guidance docs entirely (F029's grep); the `MemoryEntry.text` field doc (`memory.ts:27`) stays true and is the natural place to note the bound.
- memoryCap distinction: exclusively the entry-COUNT cap (`config.ts:32` doc, `:70` default 0, `:93-94` bounds, clamp at :269-272, delivered via `index.ts:220`/`:249`). The byte cap is per-entry and UN-configured — a config field would contradict both texts ("a small MAX constant") and the ~20-min estimate.

### Cross-cutting tooling (all nine commits must survive)

- `biome.json:20-25` covers everything except node_modules/.git/.rpiv — markdown edits (README, TECH_DEBT_AUDIT.md, guidance) are biome-invisible; new code must be width-clean (F031's regex line ≈81 chars; F036's message template is an unbreakable template literal — Biome cannot improve it, produces no diff; F037's constant trivially clean; F035's Set entries ≤9 chars).
- `tsconfig.json:17` `include: ["*.ts"]` — root only: sandbox.ts/memory.ts/index.ts IS typechecked (F031's regex, F037's cap, F036's seam); gate.mjs and all .mjs suites/runners/helpers are NOT (matching the guidance's ".mjs not covered" note). The security logic is in tsc scope; the hooks' matcher and the test layer rely on the suite + probe gates.
- Acceptance gate: `package.json:10-14` scripts; `engines >= 22.6.0` + `.npmrc` engine-strict; `npm test` exit 0, `npm run eval` 6/6 fixtures (exactly six files in `eval/fixtures/`: allowlist-refusal, budget-window, consult-aggregation, dialogue-keys, tool-use-script, trigger-arms), `tsc --noEmit` + `biome check .` clean, `npm audit` 0.
- Commit discipline: one commit per finding naming its ID (F001→81a8748, F021→4be01eb, F024→1690b9e per the audit's Status column); the FRD order (F035, F031, F029, F034, F030, F020+F008, F032, F033, F036, F037) needs NO reorder — the two overlaps impose content obligations, not sequencing: F030 carries its own doc delta (guidance :29/:65, AGENTS.md :25, main.md :31, runner banners, eval/runner.mjs:4-5), and F020's t14/t16 live in `tests/suites/advisor.mjs` by then (the F020 commit's verification narrative should cite the new path). The uncommitted `M TECH_DEBT_AUDIT.md` rides the series.

## Code References

- `scripts/hooks/gate.mjs:29-42` — ROOT_LIKE_TARGETS Set (11 members today; 14 after F035)
- `scripts/hooks/gate.mjs:44-47` — isRootLikeTarget: quote-strip + Set membership + drive-root regex
- `scripts/hooks/gate.mjs:46` — the regex `/^[a-zA-Z]:\\?$/` widened to `[\\\/]`
- `scripts/hooks/gate.mjs:53-60` — blocksRecursiveRemove: prefilter, tokenize, flag scan
- `scripts/hooks/gate.mjs:95-106` — evaluate(): the exported pure core (rm rule first at :97)
- `scripts/hooks/lib.mjs:28-32` — readHookField: raw tool_input.command, dual dialect
- `sandbox.ts:74-91` — planRead: shape guard, resolve, escape refusal; F031 Site 1 inserts at :79-81
- `sandbox.ts:146-193` — createSandbox closure; realpath arm at :164-172; F031 Site 2
- `sandbox.ts:34,46` — READ_FILE_TOOL_NAME and SandboxResult declarations (F032 un-exports)
- `sandbox.ts:111-130` — READ_FILE_TOOL declared tool surface
- `index.ts:37,42-43,49,56-57` — factory closure state (latch, host check, fire count, FR8 slots)
- `index.ts:59-274` — turn_end handler (register :59; async detach :198-235; blocking await :238; planCommit :254)
- `index.ts:64-71` — the hostChecked once-latch: F036's placement precedent
- `index.ts:104-109` — buildMessages thunk: digest read + buildAdvisorMessages call
- `index.ts:114-134` — trigger thunk + defensive signal extraction (F036 detection site)
- `index.ts:135-137` — markFired thunk (the real latch-spend seam; repairs advisor.ts:171's stale cite)
- `index.ts:184-187` — sandbox wiring (tools + executeTool when toolsEnabled)
- `index.ts:215-222` — async path recordAdvice call (strip → text → cap)
- `index.ts:242-252` — blocking path recordAdvice call
- `index.ts:281-301` — agent_before_settle handler (planSettle at :286)
- `memory.ts:42-53` — the memory warnOnce latch + reset twin
- `memory.ts:59` — KEY_SLUG_MAX: the F037 constant-shape precedent
- `memory.ts:155-175` — readEntriesQuiet → recordAdvice write path (F033 claim at :167; F037 cap at :170-173)
- `memory.ts:189-198` — digestMessage (per-entry lines :191; header :195)
- `triggers.ts:15-20` — TriggerSignal (un-export) + TriggerDecision (stays exported)
- `triggers.ts:52-56,60-80` — triggersArmed + planTrigger (starvation guards :85-89, :92-96)
- `plan-turn.ts:1-4` — the type-only sibling imports F034's banner documents
- `plan-turn.ts:111-112` — the sentence already promising the banner
- `prompt.ts:363-383` — buildAdvisorMessages: post-fold digest insert (:379-382), claim :363-367
- `prompt.ts:283-332` — applyTokenBudget: the fold the digest bypasses
- `advisor.ts:29,31,41,44,378,539` — surviving exports + ToolExecutionResult uses (F032)
- `advisor.ts:155-179` — getRuntimeCompleteSimple JSDoc: F008 re-record target (:161, :162, :166, :171)
- `advisor.ts:471-474` — the fail-fast facade guard (observable 1.5.0 failure shape)
- `config.ts:87-94` — the six dead MIN/MAX constants + MIN/MAX_MEMORY_CAP
- `tests/test.mjs:13-15,18-22` — suite header: seam unloadability + the no-sibling sentence (survives into the runner banner)
- `tests/test.mjs:30-113` — import block (16 statements; the split's source of truth for subsets)
- `tests/test.mjs:115-168` — the 54 helper lines (moving to tests/helpers.mjs — DECIDED)
- `tests/test.mjs:1384-1431` — t19: blocked array to :1404/:1405, allowed to :1423/:1424 (F035 pins append)
- `tests/test.mjs:1569-1735` — t21 triggers (gains F036's armed-but-null pins)
- `tests/test.mjs:1947-2121` — t23 memory (gains F037's over-cap fixture; latch pins :1999-2006)
- `tests/test.mjs:2229-2255` — t25 pure planRead block
- `tests/test.mjs:2257-2292` — t25 live-sandbox block (F031's three reading fixtures)
- `tests/test.mjs:2295-2313` — t25 stub-fs block (existing escape pin survives)
- `tests/test.mjs:2598-2610` — refusal strip-survival pins
- `package.json:10-14,20-25` — scripts, engines, the two host carets
- `tsconfig.json:17` — include: ["*.ts"] (the tsc scope boundary)
- `biome.json:20-25` — file coverage (suites/helpers covered day one; .rpiv excluded)
- `.github/workflows/ci.yml:22-27` — four steps incl. the eval score gate (:27; F029's doc drift)
- `eval/runner.mjs:1-15,31-55,48,64-66,156,221-226,346` — second runner: banner, imports, plan-turn import, parity-comment precedent, evaluateScore, disk seeding, stub write
- `README.md:37-38` — memoryCap row; the toolsEnabled row for F031's sentence
- `TECH_DEBT_AUDIT.md:41,53,78-100` — F008 row, F020 row, the verbatim fix blocks
- `.rpiv/guidance/architecture.md:9,12-20,29,34,59,64-68` — the stale/owning doc lines (F029/F034/F030)
- `AGENTS.md:10,16-28,38` — F029's AGENTS.md edits
- `.agents/rules/main.md:24-34` — the discovered twin Files list

## Integration Points

### Inbound References

- `tests/test.mjs:30-113` — the monolith import block: the ONLY consumer surface for every export F032 touches; omits all eight dead names (link-time proof on split).
- `tests/test.mjs:106` — imports `evaluate` from gate.mjs (t19's pure-core path); :77-84 imports six plan-turn cores; :107-113 sandbox names; :120-124 triggers names.
- `eval/runner.mjs:31-55` — second runner imports (config/sandbox/triggers subsets; plan-turn at :48) — omits all eight F032 names.
- `index.ts:5-12` — the hub imports every spoke (none of the eight).
- `.claude/settings.json` — registers `node scripts/hooks/gate.mjs` (PreToolUse/Bash) and `node scripts/hooks/feedback.mjs` (PostToolUse/Write|Edit); the harness spawns the hook per matcher.

### Outbound Dependencies

- `index.ts` → advisor, config, guard, memory, plan-turn, prompt, report, sandbox, triggers (extensionless sibling imports, the jiti-proven form).
- `advisor.ts:184-188` — the duck-typed `runtime.completeSimple` reach (F008/F020's verification surface); `advisor.ts:1` type-only pi-ai import.
- `sandbox.ts:1-2`, `memory.ts:1`, `config.ts:1` — the node-builtin trio (the only spokes with runtime imports).
- `scripts/hooks/gate.mjs` → `./lib.mjs` only (zero npm).
- `tests/test.mjs` (post-split: suites + helpers) → `../<module>.ts` and `../scripts/hooks/*.mjs` — deepened to `../../` under suites/.

### Infrastructure Wiring

- `package.json:9-10` — `"test"` and `"eval"` both keep their paths (the runner IS tests/test.mjs; eval/ untouched).
- `.npmrc` — engine-strict (F013); Node floor `>=22.6.0`.
- `.github/workflows/ci.yml:22-27` — test, lint, typecheck, eval-gate; `npm ci` lockfile contract.
- `tsconfig.json` — `include: ["*.ts"]`, strict, noUncheckedIndexedAccess, moduleResolution bundler.
- `biome.json` — lineWidth 100, double quotes, space indent; covers tests/suites + helpers day one.
- `.claude/settings.json` — the hook registration (repo-relative paths; the carried open question about launch points is out of scope).

## Architecture Insights

- Hub-and-spoke star topology: the hub imports every spoke; no spoke imports a sibling at runtime; pure spokes import nothing (or type-only) so plain node loads them offline — every fix above respects it (F036's builder lives in triggers.ts precisely because index.ts cannot be pinned).
- Pure cores return `*Decision` discriminated unions on `action`; the seam owns I/O; every failure is data (`{ ok, reason }` / notify decisions), never a throw. F036's Option C is this pattern applied to a diagnostic.
- The byte-identical pin contract is APPEND-ONLY in practice: arrays/loops derive assert messages from data, so new members slot between untouched lines (t19) and new asserts insert between untouched pins (t25, t23).
- Warn-once latches are per-module and deliberately duplicated (config.ts:100-107, memory.ts:41-53); the audit ratifies the duplication because the star topology forbids a shared sibling import. F036 adds the third instance in a NEW form (factory-closure latch + pure builder) because index.ts is unpinnable.
- Decision cores are lazy: thunks are injected pre-bound and run past no early-out; the trigger thunk runs only on a cadence miss.
- The digest is deliberately inserted AFTER the fold — the design choice that makes F037's write-time cap the correct and sufficient arm.
- Host-anchor citations decay silently (four drifts found this session, one inside F008's own paragraph; three of them the FRD already corrected). New/edited prose should cite files + symbols over line spans wherever the claim survives.
- Docs are twin-structured: AGENTS.md ↔ `.agents/rules/main.md` ↔ guidance architecture.md must move together or drift recurs (F011 precedent; the A-J series needed two plan amendments for exactly this).
- Count pins travel with the fixtures that make them true, in the same commit (t19b's 10→15 precedent) — revert restores both.

## Precedents & Lessons

5 similar past changes analyzed (precedent sweep retried successfully after an initial 429 rate-limit failure).

### Precedent: gate.mjs matcher widening with fixture pins (F021/F022) — the direct template for F035
**Commit(s)**: `74d3cec` — "Block forced-refspec pushes; share the hook plumbing (F009, F017)" (2026-10-30 10:58) → `4be01eb` — "Match refspecs per token in the force-push gate (F021, F022)" (2026-10-30 18:24)
**Blast radius**: 2 files, 2 layers — gate.mjs ~29 lines, tests/test.mjs ~17 lines
- Replaced a rejoin-and-regex matcher with per-token refspec matching; pins grew 10→15 blocked forms with the count pin (`blocked.length === 15`) bumped in the SAME commit; 1 new allowed form; band header renamed to cite all three finding IDs.
**Follow-up fixes**: `74d3cec` fixed F009's `+main` at 10:58; audit run #2 (recorded at `236cc25`, 11:27) found the fully-qualified `refs/heads/main` bypass hours later; `4be01eb` fixed it same-day. F009's row reads "Superseded by F021". The same hole class recurred at audit #3 as F035 (the `C:/` regex gap). gate.mjs has not been touched since `4be01eb` (apart from `3b9853a` in the same series).
**Lessons from docs**: `.rpiv/artifacts/plans/2026-10-30_14-20-04_f021-f028-f008-commit-series.md:875` — "four of nine findings are residues of a fully-validated series — fixtures must enumerate the full input grammar"; the validation doc (2026-10-30_19-29-59) flagged a residual boundary: bare `git push origin :main` still evaluates allowed — "a candidate finding for the next audit" (still unaddressed; F035's rm scope does not cover it).
**Takeaway**: Hook matchers have needed widening three times (F009→F021→F035) — enumerate the FULL input grammar including platform-native forms, add blocked AND allowed pins, bump the count pin in-commit, and probe `evaluate()` live.

### Precedent: audit-ledger stamping + F008 acceptance format (`c663ac1`)
**Commit(s)**: `c663ac1` — "Accept the caret in writing, reword the stale citation, stamp the ledger (F008, F027)" (2026-10-30 18:36); initial tracking `dfa82f8` (11:10)
**Blast radius**: 3 files — TECH_DEBT_AUDIT.md (~161 lines), advisor.ts (+9 banner), guard.ts (reword)
- Status flips cite real short SHAs (`RESOLVED 4be01eb`); same-commit flips read `RESOLVED (this commit)`. F008 acceptance recorded at TWO coordinates (advisor.ts reach-site banner + audit row). A SHA-existence grep loop verified every cited hash. Quick-win boxes flip as `- [x] F011: …`. Post-hoc amendment format (from `86062e4`): append `REVERSED for … (date): …` to the Description cell + update Recommendation — the template for F008's 1.5.0 re-record.
**Follow-up fixes**: header prose was knowingly left stale ("Regenerate at the next audit" — run #3 did). The current run-#3 audit content is UNCOMMITTED (`M TECH_DEBT_AUDIT.md` at HEAD) — the series must commit it.
**Takeaway**: Re-record F008 in the same commit as the bump, naming 1.5.0 at both coordinates; verify cited SHAs with the grep loop; commit the audit file itself.

### Precedent: dependency/lockfile discipline (no bump precedent exists)
**Commit(s)**: `e7eb376` — "Declare the Node floor and install-time enforcement (F012, F013)" (2026-10-30 11:05); `e7db205` — merge "On main: npm install lockfile drift (not part of the fix series)" (11:11); `06f3552` — eval script line (2026-11-03)
**Blast radius**: e7eb376: package.json +3, .npmrc +1, ci.yml, both hook headers (the floor documented in THREE places). e7db205: package-lock.json +3 only.
- The ONLY package.json/lockfile changes ever: birth (`b1f3a16`), engines declaration, a merge-carried 3-line lockfile drift explicitly labeled "not part of the fix series", and a script line. No version bump has ever landed — F020 is unprecedented.
**Lessons from docs**: the caret "never affects the runtime module graph" (type-only imports) — the risk is only the duck-typed reach; house citation style for host internals is `install/releases/<semver>/node_modules/<pkg>/dist/<path>.js:<range>`; e7eb376's message records the CI-matrix YAML gotcha (node versions must reach setup-node as strings) and the A-J validation listed the CI matrix as the only remote-only criterion.
**Takeaway**: Carry package.json AND package-lock.json together (CI is `npm ci` — the lockfile is the contract); keep working-tree config.json out of every commit (the A-J validation rule); expect the CI matrix to be the only criterion unverifiable locally.

### Precedent: mechanical test-suite surgery (`829c948`, `b11a144`, `06f3552`)
**Commit(s)**: `829c948` — "Clean up lone block statements in tests" (2026-10-29); `b11a144` — "Delete dead shouldGate and fold t1 into t1b (F025)" (2026-10-30 18:30); `06f3552` — +1,846 lines to tests/test.mjs in one slice (2026-11-03)
**Blast radius**: b11a144: config.ts ~−43, tests −51/+30; fold rule: every t1 assertion already had a t1b counterpart → reword strings citing t1/shouldGate, migrate unique content verbatim, never duplicate pins.
**Follow-up fixes**: validation found `plan-turn.ts:92` still cited the DELETED shouldGate — "the plan's Phase 4 migration inventory missed this cross-module citation" (comment-only, deferred). No precedent split of test.mjs exists; the file grew 1,234→3,343 while the audit's "1,234-line flat file" bullet stayed stale as late as `86062e4`.
**Lessons from docs**: the F025 research built a reference map of every string citing the moved/deleted symbol across THREE files before deleting ("Sibling sweep (house lesson from F016)").
**Takeaway**: When restructuring tests, grep repo-wide for every citation of moved/deleted symbols (band names, function names) — cross-module comment citations were missed twice — and keep pins byte-identical with banner numbering unchanged (never renumbered from `b1f3a16` to today).

### Precedent: docs-drift fixes and the twin-list divergence (`dfa82f8`; root cause `06f3552`)
**Commit(s)**: `06f3552` — the feature slice that CAUSED F029: 4,057 insertions across 22 files with a 2-line AGENTS.md touch and ZERO guidance edits; `dfa82f8` — "Fix the prose docs; track the tech-debt audit (F010, F011, F015, F019)" (2026-10-30 11:10), 5 doc files in one commit
**Blast radius**: dfa82f8: main.md, SKILL.md, AGENTS.md, README, TECH_DEBT_AUDIT.md (first tracked). `.rpiv/guidance/architecture.md` was born in `e19445e`, touched once since (`2514358`) — it never received the 06f3552 spoke updates; its :12 still reads "THE single await" (verified).
**Follow-up fixes**: the A-J plan required TWO amendments for the same gap class ("the twin Files lists diverge: A4 adds the lib.mjs line to AGENTS.md but main.md's list ends at gate.mjs/feedback.mjs"); the F026 fix knowingly left `.rpiv/guidance/scripts/hooks/architecture.md:85` stale.
**Takeaway**: F029's edits land in a twin-structured doc system — add the spokes/eval to BOTH Files lists (AGENTS.md + main.md) in one docs-only commit, and update the audit's "Things that look bad" bullets that F030/F031 make stale in the same passes.

### Recurrence inventory (fix commits were sound; residues were nearby prose)
- `74d3cec`→`4be01eb`: first-pass matcher fix missed a sibling input form (same day).
- `b11a144` (F025): stale cross-module citation survived validation.
- `0a8ef09` (F023): a stale advisor.ts citation inside the edited region was folded INTO the fix commit ("fold this one-line comment fix into the F023 edit") — the fold-adjacent-stale-citations rule.
- `3b9853a` (F026): guidance mirror knowingly left stale.
- `1690b9e` (F024): the tracked config it removed had just been edited by `236cc25` — working-tree config.json exclusion rule.
- No committed regression was ever found IN a fix-series commit (audit #3: "this run found no regression in any of them"), but every residue class above surfaced at the NEXT audit or validation.

### Composite Lessons
- **Match/fixture grammar recurrence**: gate.mjs rules widened three times for the same reason — written matcher shapes miss real invocation forms. For F035: full grammar including platform-native `C:/`, blocked + allowed pins, count-pin bump in-commit, live probe of `evaluate()`.
- **Nearby prose goes stale after every fix**: stale citations found after/during F023, F025, F026, F008 — sweep for citations to touched symbols/versions in comments, banners, guidance mirrors, and the audit header in the same or a bundled docs commit. Budget one prose sweep per fix.
- **Docs are twin-structured**: AGENTS.md ↔ main.md ↔ guidance must move together; audit "Things that look bad" bullets must be updated by F030/F031.
- **Pins are contract and travel with the change**: counts, byte-exact strings, banner numbering unchanged; behavior edit + its pin in one commit; F030's split moves pins byte-identically or it does not land.
- **Dependency work is unprecedented; keep it atomic**: package.json + lockfile + F008 re-record in ONE commit, gated on t14/t16 + the manual reach check + the full gate; the CI matrix is the remote-only criterion; mind biome lineWidth 100 when pasting byte-exact code (it broke an A-J plan fence).
- **Follow the established commit pattern**: one commit per finding group, ID in the subject, security pair first, ledger stamped at series end — the FRD prescribes exactly this; the uncommitted run-#3 audit file rides the series.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-11-05_21-08-52_tech-debt-remediation.md` — the FRD chaining this research (decisions, FRs, acceptance criteria)
- `.rpiv/artifacts/plans/2026-10-30_14-20-04_f021-f028-f008-commit-series.md` — the prior remediation series plan (fixture-grammar lesson at :875)
- `.rpiv/artifacts/` validation doc 2026-10-30_19-29-59 — F021 series validation (count-pin move, `:main` residual boundary)
- `.rpiv/artifacts/plans/2026-11-03…` and `designs/2026-11-02…` — historical artifacts quoting the F032 export declarations verbatim (grep false-positive source)

## Developer Context

**Q (discover: Scope of the work): The audit carries 9 open findings and a ranked top 5. What problem does fixing this debt actually solve for you, and who hits that problem today?**
A: "fix all" — Developer's own words; the audit enumerates exact seams, so scope is fully bounded by the report.

**Q (discover: Who pays the debt): Re-asking the cost question: who hits this debt, and when?**
A: "Next feature commit" — Every new slice lands on a 3,343-line test file and docs describing a six-spoke hub; the tax compounds per commit.

**Q (discover: Fix method): Pre-resolved from codebase evidence — every finding has a verified recommendation in `TECH_DEBT_AUDIT.md`. Does "fix all" mean adopt them as written, or pick the method per finding?**
A: Adopt as written — Probe re-verified all nine recommendations at HEAD `d2cd108`; adopting avoids re-deriving each fix. Pick-one findings were still surfaced individually. `evidence: TECH_DEBT_AUDIT.md + probe report, 2026-11-05 + confirmed`

**Q (discover: F020 dependency bump): Pre-resolved from codebase evidence — F020's fix crosses the 1.4.0 line (`pi-coding-agent` 1.4.0 => 1.5.0), and F008's accepted contract is written against `^1.4.0`. Include F020 in this work, or defer it?**
A: Include, re-record F008 — Closes the last open finding; the facade pins (t14, t16) and the `runtime` reach check gate the merge. `evidence: npm audit fix --dry-run output, 2026-11-05 + confirmed`

**Q (discover: F030 test-file split): F030: the repo's own split rule says ~1,500 lines; `tests/test.mjs` is 3,343. Split the file, or amend the rule?**
A: Split per module — Optimizes navigability; costs a one-time mechanical move of ~3,300 lines with pins kept byte-identical. Amending the rule would leave a documented rule that permits a 3,300-line file. `evidence: tests/test.mjs = 3,343 lines (probe, EOF-verified)`

**Q (discover: F031 denylist strictness): F031: the sandbox secret denylist — strict as audited (`src/.env.example` also refuses), or with an example-file exception?**
A: Strict denylist — No secret-shaped file ever reaches the provider. An `*.example` exception gives a real secret with a benign name a precedent to hide behind. `evidence: sandbox.ts:74-91 has no denylist (probe grep, zero matches)`

**Q (discover: F033 + F037 fix depth): F033 and F037 both offer a minimal and a thorough path. Pick one pair.**
A: Both minimal fixes — F033 reword to "self-healing whole-file rewrite"; F037 per-entry byte cap at `recordAdvice`. Minimal diff, fold invariants untouched. `evidence: memory.ts:169-180 recordAdvice, prompt.ts:368-383 post-fold digest insert (probe)`

**Q (`tests/test.mjs:115-168`): The shared helpers (54 lines) are used by 7 of 8 suites, but the FRD caps the runner under 30 lines and mandates exactly eight files in `tests/suites/`. Where do the helpers live?**
A: `tests/helpers.mjs` — one shared file beside the runner, OUTSIDE `suites/`, so `ls tests/suites/` stays at exactly 8 entries per the FRD acceptance criterion. The one-file deviation from "no new modules" is named in the F030 commit message (F008 accept-in-writing precedent). Runner-exports was ruled out by arithmetic and would create the repo's first import cycle; per-suite duplication was rejected as the drift F017 already remediated. `evidence: helper census (assert/withConfig/captureWarn used by 7 of 8 suites), research checkpoint 2026-11-05 + confirmed`

## Related Research

- (none — first research artifact for this topic)

## Open Questions

- Does the duck-typed `completeSimple` facade and `advisor.ts`'s `runtime` reach survive the 1.4.0 => 1.5.0 host bump? Not deferred — answered by t14/t16 plus a manual reach check before the F020 commit merges. Carried as a verification step. (Research sharpened it: t14/t16 are provably blind to slot relocation/renaming/signature drift — the manual reach check is the ONLY real gate; the failure shape if missed is the pinned `no auth-aware completion facade` string, silently swallowed on headless hosts.)
- F037's constant NAME and numeric VALUE are unprescribed by audit and FRD (both say only "a small named MAX constant"). Research recommends: un-exported module-local beside `KEY_SLUG_MAX`, `Buffer.byteLength` measurement, silent truncation. Design/blueprint picks the name and value.
- F036's builder export NAME in triggers.ts is unprescribed (research uses `starvedTriggerWarn(field, signal)` as the working shape). Design/blueprint confirms.
- F030's two suite-ownership judgment calls (§18 reportFailure → advisor suite; §11 guard veto → gate suite) are recommendations to state explicitly in the F030 commit message, not developer decisions — unless the developer prefers different homes.
