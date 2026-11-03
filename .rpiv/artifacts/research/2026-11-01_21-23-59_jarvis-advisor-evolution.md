---
date: 2026-11-01T21:23:59+0700
author: Yogiswara Utama
commit: faae538
branch: main
repository: advisor-turn-gate
topic: "jarvis-advisor-evolution"
tags: [research, codebase, advisor, dialogue, memory, triggers, tools, specialists, async, eval]
status: ready
last_updated: 2026-11-01T21:23:59+0700
last_updated_by: Yogiswara Utama
---

# Research: jarvis-advisor-evolution

## Research Question
Evolve the one-shot, blind, stateless advisor gate (chained from `.rpiv/artifacts/discover/2026-11-01_21-07-45_jarvis-advisor-evolution.md`) into a JARVIS-grade advisory system: dialogue across fires, local memory, multi-signal triggers, read-only advisor tools, on-demand specialist consults, a prompt budget, an optional async fire mode, and an offline eval harness — without breaking the never-throw/fail-open contract, the star topology, or backward compatibility.

## Summary
Every FRD pillar is buildable on the verified 1.4.0 host surface. The turn_end event already carries per-turn tokens and cost (`message.usage`), error/abort outcome, and per-tool results, so the trigger set needs no new host capability — only new planGate arms ahead of the cadence arm and clamp-guarded config fields. The advisor tool loop is unlocked by `completeSimple`'s existing `tools?: Tool[]` parameter and the `toolUse` stop reason; because the host exposes no extension file-read API, the sandbox must execute reads itself via node:fs and feed results back as `ToolResultMessage` entries. Dialogue rehydration is cheaper than assumed: committed advice entries are `custom_message` entries that the host already re-projects into LLM context as user messages. Memory follows the CONFIG_URL beside-module pattern, untracked in git. Specialists ride a declared consult tool (developer decision). Async fire lands at the next `agent_before_settle`, which returns the same BoundaryResult contract. One load-bearing risk: the runtime that actually loads the extension must be 1.4.x — the global npm dir holds 0.79.9, whose turn_end is a bare emit under which the gate silently never fires. The developer chose a hard 1.4.x requirement with a startup check.

## Detailed Findings

### Current pipeline (the thing being evolved)
- Hub owns I/O only: config read per dispatch (index.ts:41), registry-bound thunks, the single advisor await (index.ts:67-75), the one latch write through markFired (index.ts:63-66).
- planGate arm order is pinned semantics (plan-turn.ts:93-121): disabled -> no model -> cadence -> outcome !== "completed" -> markFired -> child veto -> parse -> resolve. New signal arms must slot BEFORE the cadence arm to fire early, and must not disturb the markFired position (plan-turn.ts:104) — a late commit cannot double-fire because the latch spends at gate-pass.
- planCommit strips, then commits exactly one custom_message draft with the mandatory peer spread (plan-turn.ts:23-38, :145-160).
- The advisor call is one site (advisor.ts:305-309), passes `tools: []` (advisor.ts:21-26), and admits only stopReason "stop" (advisor.ts:311-317). Provider errors RESOLVE with stopReason "error" + errorMessage (advisor.ts:299-304 doc, verified against pi-ai shapes).
- callWithDeadline is the shared budget (advisor.ts:212-247): AbortController + timer, external signal forwarded, timer cleared in finally.
- stripAdvisorMarkup is four tiers behind a byte-identical guard (advisor.ts:114-160, F023 discipline); its whitespace repair collapses 3+ newlines to one (advisor.ts:186-190) — aggregation separators must survive that.
- config.ts narrows each field against DEFAULT_CONFIG (:28-46), clamps via clampWithWarn with MIN/MAX constants (:49-52, :81-93), and warns once per process (:59-66). CONFIG_URL = beside-module config.json (:55). loadConfig re-reads per fire (:166-204).
- The child veto reads the <active_agent/> marker from content AND sections (guard.ts:42, :58-96); per-extension jiti loads with moduleCache:false (guard.ts:23-27 doc), so each session gets a fresh factory closure — the latch is per-session.
- reportFailure is hasUI-gated and never throws (report.ts:12-15, :30-37).
- Test contract: one file, plain node:assert, .ts-specifier imports of the pure cores, stubbed facade, withConfig swapping CONFIG_URL.href, exit-code summary (tests/test.mjs:19-45, :67-80, :57-61).

### Host event fields for the trigger set (FR3) — all verified on 1.4.0
- TurnEndEvent extends BoundaryState (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:845-852): `turnIndex`, `message: AgentMessage`, `toolResults: ToolResultMessage[]`, `messageEntryId`, `toolResultEntryIds`.
- BoundaryState (types.d.ts:775-782): `entries`, `continue`, `context: BoundaryContextPreview`, `outcome: AgentActivityOutcome` ("completed" | "aborted" | "error", types.d.ts:749). BoundaryContextPreview carries llmMessages, pendingMessages, canContinue (types.d.ts:764-773).
- Token growth + per-turn cost: `event.message.usage` — Usage has input/output/cacheRead/cacheWrite/totalTokens and cost.total (node_modules/@earendil-works/pi-ai/dist/types.d.ts:284-306). Derivable purely from the event.
- Cumulative session cost: NOT on the event. Two derivations: scan ctx.sessionManager.getEntries() (session-manager.d.ts:178, :334) for UsageEntry records (SessionEntry union, session-manager.d.ts:128), or accumulate in the memory spoke across fires. Event-scan is stateless and restart-safe; accumulation is cheaper per fire.
- Context pressure: ctx.getContextUsage(): ContextUsage | undefined — { tokens | null, contextWindow, percent | null } (types.d.ts:197-204, :248). Null right after compaction.
- Error/abort signal: `event.outcome`. Current semantics SKIP errored turns without spending the slot (plan-turn.ts:108-110); a new "fire on trouble" trigger changes the arm, not the latch rule.
- Risky-tool signal: `event.toolResults[]` — ToolResultMessage carries toolName, isError, optional usage (pi-ai types.d.ts:420-437). Allowlist matching is a pure predicate.
- Every new numeric threshold rides clampWithWarn with named MIN/MAX constants (config.ts:81-93); per-field narrowing keeps a wrong-typed field from poisoning neighbors (config.ts:166-204).

### Advisor tool loop (FR4) — verified shapes, no host change needed
- Request: ModelRuntime.completeSimple(model, context: Context, options) (node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts:101-107). Context accepts `tools?: Tool[]` (pi-ai types.d.ts:543-547); Tool = { name, description, parameters: TSchema } (pi-ai types.d.ts:528-533).
- Response: AssistantMessage.content carries ToolCall blocks { type: "toolCall", id, name, arguments: JsonObject } (pi-ai types.d.ts:267-283); StopReason union includes "toolUse" (pi-ai types.d.ts:307).
- Follow-up: append the assistant message plus a ToolResultMessage { role: "toolResult", toolCallId, toolName, content, isError, timestamp } (pi-ai types.d.ts:420-437) and re-call completeSimple, inside the same callWithDeadline budget.
- CRITICAL replay fact: Context.systemPrompt and Context.tools are shorthand for a leading system message; normalizeContext folds them in, and the transcript replay of every system message yields the current prompt AND tools (pi-ai types.d.ts:336-358). Consequence: stripToolDeclarations (prompt.ts:32-49) must keep stripping executor toolsAdded/toolsRemoved from llmMessages even after the advisor declares its own tools, or the executor's loadout comes back callable. The advisor's own tools enter via the request shorthand, not via llmMessages.
- No extension file-read API exists: ExtensionAPI offers registerTool (executor loop only), exec (shell), no read/grep/glob (types.d.ts:1229-1300, verified). ExtensionToolContext.executeTool exists but only inside a tool's execute() (types.d.ts:266-279), unreachable from turn_end. Therefore sandbox.ts self-executes allowlisted reads via node:fs behind a structural *-Like interface, turns results into ToolResultMessage entries, and refuses non-allowlisted names with a pinned reason string. The markup strip stays the backstop (advisor.ts:114-160); the refusal string and any new vocabulary follow the F023 byte-identity discipline.
- Bounded loop: max tool rounds and per-fire token budget need their own clamp-guarded fields; deadline stays shared (advisor.ts:212-247).

### Dialogue (FR1) — the transcript already carries prior advice
- CustomMessageEntry "DOES participate in LLM context. The content is converted to a user message in buildSessionContext()" (session-manager.d.ts:78-80, :109-117). Every committed advice entry therefore re-enters the executor context, and the projected llmMessages handed to the next fire already contain prior advice as user messages.
- What rehydration must add: the advisor's OWN prior exchange framing (what it said, what the executor did next) is derivable by filtering ctx.sessionManager.getEntries() (session-manager.d.ts:178, :334) by customType, or from llmMessages directly. Storing details (fire id, turn index, fault class) in the entry's details field (session-manager.d.ts:113) gives the digest a stable key without new state files.
- Latch scope stays per-session (fresh closure per jiti load, guard.ts:23-27). Whether a child session re-discovers extensions remains runtime-observable only (TECH_DEBT_AUDIT open question) — the marker veto keeps children inert regardless (guard.ts:87-96).

### Memory (FR2) — beside-module, per-project, count-capped (developer decision)
- Layout precedent: CONFIG_URL = new URL(..., import.meta.url) read per dispatch with ENOENT-silent / broken-JSON-warns-once semantics (config.ts:55, :166-204). Memory store: a beside-module directory with one file per project, keyed by ctx.cwd (types.d.ts:221). Session-scope alternative — pi.appendEntry(customType, data), "for state persistence (not sent to LLM)" (types.d.ts:1272) — covers only session scope; project scope needs files.
- Per fire, the memory spoke writes: advice text, fault-class label, turn index, session id, timestamp. The digest (recent entries, fault classes, one-line outcomes) is assembled in the pre-await phase (index.ts:44-66) and injected as a synthetic system message built AFTER stripToolDeclarations so it carries no toolsAdded, or appended to the advisor systemPrompt — both keep prompt.ts pure.
- Retention: count cap with newest kept, cap is a clampWithWarn-guarded field (developer decision). Deterministic and offline-testable.
- Files stay untracked in git — F024 precedent (commit 1690b9e untracked config.json and shipped config.example.json).

### Prompt budget (FR7) — window after strip, before tail
- Today: buildAdvisorMessages = ensureUserTail(stripToolDeclarations(llmMessages)) ships everything (prompt.ts:77-84); TECH_DEBT_AUDIT records the full-transcript choice as deliberate drift detection ("Things that look bad but are actually fine").
- Insertion order: strip -> budget window (deterministic fold over the dropped prefix) -> ensureUserTail. The tail must stay a user message (prompt.ts:52-62); windowing before it preserves that.
- Summary author: a pure fold (per-message one-line rollup), NOT an extra completeSimple — the single-call-site design (advisor.ts:305-309) and the offline test philosophy both argue against a second model call.
- tokenBudget field: clampWithWarn + MIN_/MAX_ constants (config.ts:49-52, :81-93). Estimation must be comparable to pi-ai Usage accounting (pi-ai types.d.ts:284-306); calibrate against last turn's usage.input (available on event.message.usage) or use a chars/4 heuristic — blueprint decides.
- Window hazard: system messages carry sections chains (guard.ts:58-80 renders content + sections; pi-ai documents section replay, types.d.ts:336-341). The window should never drop a later system delta whose section it references — either keep all system messages or fold their replay before cutting.

### Specialists (FR6) — declared consult tool (developer decision)
- Base advisor flags by calling a declared consult_specialist tool: the domain and question arrive as structured toolUse arguments (ToolCall shape, pi-ai types.d.ts:267-283) — no prose sentinel, no markup-dialect risk against stripAdvisorMarkup.
- Orchestration: at most one extra completeSimple with a specialist system prompt, inside the SAME callWithDeadline (advisor.ts:212-247); the loop resolves the consult tool in-session by running the specialist leg and returning its text as the ToolResultMessage; the base advisor's final text then carries the synthesis.
- Aggregation: whatever text shape results goes through planCommit once -> ONE custom_message entry (plan-turn.ts:23-38, :145-160). Separator between base and specialist sections must survive the strip's blank-line collapse (advisor.ts:186-190).
- Config: specialist model key + specialist system prompt as new fields, per-field narrowing + parseModelKey reuse (config.ts:120-138, :166-204).
- Failure arm: specialist leg fails -> commit base-only text, notify via reportFailure (report.ts:30-37), never throw — matches the fail-open contract.

### Async fire (FR8) — land at the next natural boundary (developer decision)
- Mechanism: on async mode, turn_end returns undefined — emitBoundary only replaces the accumulator when a handler returns entries !== undefined (runner.js:774-777, verified), so no slot is spent and no continuation is forced.
- The advisor call runs detached under the same callWithDeadline; the result is held in the factory closure. A registered agent_before_settle handler (same BoundaryState/BoundaryResult contract, types.d.ts:783-786, :1084-1085; dispatch at agent-session.js:1567-1581) commits the held result at the next natural settlement and clears it. No sendMessage/triggerTurn — the advisor never wakes an idle agent.
- Race safety: the latch already spent at gate-pass (plan-turn.ts:104), so a late commit cannot double-fire; a held result commits exactly once (cleared on commit); emitBoundary swallows handler throws into emitError (runner.js:779-787), so the settle handler must also fail-open.
- Failure surfacing: capture ctx at fire time; reportFailure(ctx, ...) stays hasUI-gated (report.ts:30-37).
- Boundary validity: emitBoundary returns { entries: [], continue: false, valid: false } when context rebuilding throws (runner.js:795-801) — keep committed entries shape-valid to protect peers.

### Eval harness (FR9) — second runner, offline, score-gated
- Precedent runner contract (tests/test.mjs:19-45, :67-80): plain node:assert, .ts-specifier imports of pure cores, stubbed completion facade, withConfig swapping CONFIG_URL.href, exit code via process.exitCode.
- package.json scripts today: test/lint/format/typecheck only (package.json:10-15) — `eval` script to add.
- TECH_DEBT_AUDIT sets the split rule: split tests when "~1,500 lines or when a second runner appears" — eval/ becomes that second runner (verified wording).
- Fixture shape: seed a projected llmMessages context + config -> planGate -> scripted completeSimple stub (stopReason, usage, optionally toolUse turns for sandbox and consult fixtures) -> planCommit -> assert on the committed entry. Scores: drift caught (advice references the seeded fault), repeats avoided (memory digest present, advice differs from prior entry), budget respected (windowed message size), allowlist refusal (pinned reason string), single-entry aggregation.
- Adoption-on-continuation is only partially observable offline — what counts as "adopted" needs a definition (see Open Questions).
- Reason strings are contract in score output, same as tests (architecture guidance).

### Version skew — the load-bearing risk (developer decision: require 1.4.x)
- Repo devDependency: @earendil-works/pi-coding-agent ^1.4.0, pi-ai ^1.4.0 — type-only imports (package.json:16-21; advisor.ts:1; plan-turn.ts:1-2).
- The global npm dir runtime is 0.79.9: its turn_end dispatch is a bare `emit({ type, turnIndex, message, toolResults })` with no entries/continue/context/outcome (C:/Users/utama/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:375-384, verified) — under that host the handler reads event.outcome as undefined and planGate skips every fire (plan-turn.ts:110) with no diagnostic.
- The 1.4.0 runtime exists on this machine: install/releases/1.3.0 and 1.4.0 (verified by directory listing); the repo's own 1.4.0 dispatch validates continue against canContinue (agent-session.js:491-516) and increments turnIndex after the dispatch (agent-session.js:918, matching config.ts's F025 note).
- Decision: a startup version check notifies once and disables the gate below 1.4.0. Implementation note: the host version is not on ExtensionContext — derive it defensively (feature-detect event fields on first turn_end, e.g. outcome === undefined -> notify once + disable) since a hardcoded npm-version read would be another fragile reach like F008 (advisor.ts:66-104).

## Code References
- index.ts:30-87 — hub: latch (:32), planGate thunk wiring (:46-68), single await (:67-75), planCommit + return (:77-87)
- index.ts:63-66 — markFired, the single latch write
- plan-turn.ts:23-38 — buildCorrection, mandatory peer spread + continue: true
- plan-turn.ts:93-121 — planGate arm order (cadence :99-102, outcome :108-110, markFired :104, child veto :112)
- plan-turn.ts:145-160 — planCommit failure arms + strip + commit
- prompt.ts:21 — ADVISOR_NUDGE; prompt.ts:32-49 — stripToolDeclarations; prompt.ts:52-62 — ensureUserTail; prompt.ts:77-84 — buildAdvisorMessages
- advisor.ts:21-26 — CompleteSimpleFn type (tools: []); advisor.ts:66-104 — getRuntimeCompleteSimple reach (F008)
- advisor.ts:114-160 — markup tiers + byte-identical guard (F023); advisor.ts:165-198 — stripAdvisorMarkup + whitespace repair
- advisor.ts:212-247 — callWithDeadline; advisor.ts:283-333 — runAdvisor (facade guard :301-305, call :305-309, stop-only gate :311-317)
- config.ts:28-46 — DEFAULT_CONFIG; config.ts:49-52 — MIN/MAX; config.ts:55 — CONFIG_URL; config.ts:81-93 — clampWithWarn; config.ts:131-138 — shouldFire; config.ts:166-204 — loadConfig per-field narrowing
- guard.ts:42 — CHILD_MARKER_PATTERN; guard.ts:58-96 — systemMessageText + isChildSession
- report.ts:30-37 — reportFailure (hasUI-gated, try/catch)
- tests/test.mjs:19-45 — .ts imports; tests/test.mjs:67-80 — withConfig; tests/test.mjs:57-61 — exit handler
- package.json:10-15 — scripts; package.json:16-21 — devDependencies ^1.4.0
- TECH_DEBT_AUDIT.md — F-table, split threshold ("~1,500 lines or when a second runner appears"), maintainer open questions
- node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:197-204 — ContextUsage; :212-260 — ExtensionContext (sessionManager :221, getContextUsage :248); :266-279 — ExtensionToolContext.executeTool; :735-741 — BeforeAgentStartCustomEvent; :749 — AgentActivityOutcome; :755-762 — CustomMessageEntryDraft; :764-782 — BoundaryContextPreview/BoundaryState/BoundaryResult; :783-786 — AgentBeforeSettleEvent; :845-852 — TurnEndEvent; :1083-1085 — TurnEndEventResult/AgentBeforeSettleEventResult = BoundaryResult; :1229-1300 — ExtensionAPI (registerTool :1229, sendMessage :1258, appendEntry :1272, exec :1280)
- node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts:101-107 — completeSimple(model, context, options)
- node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:78-80 — custom_message participates in LLM context; :109-117 — CustomMessageEntry; :128 — SessionEntry union (UsageEntry); :178 — ReadonlySessionManager pick; :286 — appendCustomMessageEntry; :334 — getEntries
- node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:759-802 — emitBoundary (accumulator replace :774-777, emitError swallow :779-787, invalid -> empty result :795-801)
- node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:491-516 — 1.4.0 turn_end dispatch + canContinue validation (:515-516); :918 — turnIndex++; :1567-1581 — agent_before_settle
- node_modules/@earendil-works/pi-ai/dist/types.d.ts:267-283 — ToolCall; :284-306 — Usage; :307 — StopReason; :336-358 — SystemMessage replay/toolsAdded; :360-395 — AssistantMessage; :420-437 — ToolResultMessage; :528-533 — Tool; :543-547 — Context
- C:/Users/utama/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:375-384 — 0.79.9 bare turn_end emit (version-skew evidence)

## Integration Points

### Inbound References
- pi host loads index.ts as the folder entry (index.ts:7-9 doc; no settings.json edit) — the only runtime-loaded file
- tests/test.mjs imports config, guard, plan-turn, prompt, advisor, report, and scripts/hooks modules directly (tests/test.mjs:19-45)
- .github/workflows/ci.yml runs test + lint + typecheck (TECH_DEBT_AUDIT F012/F013 rows)
- .claude/settings.json registers scripts/hooks — separate defense layer, no runtime coupling to the extension

### Outbound Dependencies
- node:fs readFileSync — config.ts:1 (the only runtime import in the package)
- ModelRegistry.runtime.completeSimple — duck-typed reach, advisor.ts:66-104 (F008 accepted caret risk)
- ctx.modelRegistry / ctx.sessionManager / ctx.signal / ctx.hasUI / ctx.ui.notify — ExtensionContext surface (types.d.ts:212-260)
- pi.appendEntry / pi.sendMessage / pi.exec — ExtensionAPI (types.d.ts:1272, :1258, :1280), candidates for async and memory state

### Infrastructure Wiring
- config.json beside module (untracked since 1690b9e), config.example.json shipped with model: ""
- Memory files (planned) — beside-module directory, must stay untracked; keyed per ctx.cwd
- customType "advisor-turn-gate" doubles as reload filter and denylist identifier (config.ts:39-41)

## Architecture Insights
- Star topology with thunk injection is the extension's core discipline: pure spokes import nothing at runtime, so the offline suite imports them directly (tests/test.mjs:14-17 banner). New spokes (memory, triggers, dialogue, sandbox, specialists) must follow it — plan* verbs, *Decision unions on action (plan-turn.ts:41-67, :122-132).
- The single await at index.ts:67-75 splits decision from I/O; multi-signal planning extends planGate's arms without breaking that shape.
- Fail-open is structural: never throw, { ok, reason } results, hasUI-gated reporting, warn-once latches, accumulator spreads. Every new path (tool loop, specialist leg, async settle commit) must re-prove it.
- Guard/backstop byte-identity (F023): any new refusal vocabulary must keep the guard pattern and the tier patterns in lockstep.
- Boundary semantics: handlers that return entries REPLACE the accumulator; returning undefined is the correct "I abstain" — the async mode is built on that exact fact (runner.js:774-777).
- custom_message entries are both output channel AND durable dialogue memory — the host re-projects them into LLM context for free (session-manager.d.ts:78-80).

## Precedents & Lessons
22 commits analyzed (b1f3a16 initial -> faae538 merge PR #1).

### Precedent: pure-core extraction with thunk injection
**Commit(s)**: 084b1f8 — "Extract the turn decision into plan-turn.ts (F006)" (2026-10-30)
**Blast radius**: 3 files (index.ts, plan-turn.ts, tests/test.mjs)
  plan-turn.ts — new pure module, zero runtime imports
  index.ts — reduced to I/O + thunks
  tests/test.mjs — imports the core directly, no spawn/jiti
**Lesson**: when adding decision logic, extract first, then wire; tests import the spoke, never the hub.
**Takeaway**: memory/triggers/dialogue/sandbox/specialists each get their own pure spoke with injected capabilities.

### Precedent: cadence slide past errored turns
**Commit(s)**: ad697e5 — "Slide cadence past errored turns with shouldFire (F007)" (2026-10-30)
**Blast radius**: config.ts + tests (t1b pins the fold parity)
**Lesson**: firing semantics changes are pinned by exact interval-set folds; the latch spends only past the completed check.
**Takeaway**: new trigger arms must specify their interaction with markFired and pin it the same way.

### Precedent: markup vocabulary widen
**Commit(s)**: 0a8ef09 — "Widen markup stripping to function_calls and invoke (F023)" (2026-10-30)
**Blast radius**: advisor.ts tiers + guard, tests/fixtures
**Lesson**: guard pattern and tier patterns must stay byte-identical; missed dialects reached the durable transcript.
**Takeaway**: the sandbox refusal path and the consult-tool channel must not introduce new fake-tool dialects; the strip stays the last filter.

### Precedent: untrack personal state
**Commit(s)**: 1690b9e — "Untrack config.json and ship config.example.json (F024)" (2026-10-30)
**Blast radius**: config.json (untracked), config.example.json (new), README
**Lesson**: personal/local state must not leak into clones.
**Takeaway**: memory files are personal state — gitignore them from day one.

### Precedent: fail-open hardening series
**Commit(s)**: 81a8748 (F001 sync-throw timer leak), faa98a5 (F002/F014 warn latch + clamp observability), 779c589 (F028 empty errorMessage), 43900c2 (F018 timeout shape)
**Lesson**: every failure path got an exact-string pin; error-shape drift (empty string vs absent) is a real bug class here.
**Takeaway**: pin reason strings for: non-allowlisted tool refusal, specialist leg failure, async commit failure, budget truncation.

### Composite Lessons
- Every fix commit names its finding ID and ships a regression test (audit executive summary; verified across git log) — new features should land the same way.
- Config growth follows one pattern: per-field narrowing + clampWithWarn + MIN/MAX + pin both the ENOENT and broken-JSON paths. Five new numeric fields (token budget, trigger thresholds, memory cap, tool-round cap) all ride it.
- The host is reached only through structural *-Like interfaces after one documented exception (F008); feature-detect before reaching further (the version check should detect event fields, not npm versions).
- Test debt has a stated split threshold — eval/ is the sanctioned second runner.

## Historical Context (from .rpiv/artifacts/)
- .rpiv/artifacts/discover/2026-11-01_21-07-45_jarvis-advisor-evolution.md — FRD: goals, FR1-FR10, acceptance fixtures, delegated decisions
- .rpiv/guidance/architecture.md — star-topology rules, boundary/config/test contracts (loaded at session start)
- TECH_DEBT_AUDIT.md — 28-finding ledger, F008/F020 open, maintainer questions

## Developer Context
**Q (discover: Persona and framing delegated): After 12 months of unlimited work, who should feel the biggest improvement, and what should be better for them?**
A: "you decide" + JARVIS framing: "i want the advisor have higher quality and features. kinda like JARVIS in ironman"

**Q (discover: JARVIS baseline pillars): Which upgrades become the 12-month baseline — dialogue, persistent memory, multi-signal triggers?**
A: All three

**Q (discover: Advisor tool access): Today the advisor is blind (advisor.ts:322, prompt.ts:33-56). How much tool access?**
A: Read-only tools

**Q (discover: Output channel): Should the advisor get a channel directly to the user?**
A: Transcript only

**Q (discover: Brain architecture): One advisor with capability modules, or a specialist team?**
A: Hybrid on-demand — base advisor consults a specialist only when it flags a domain

**Q (discover: Autonomy): Should the advisor ever apply changes itself?**
A: Suggest-only, always

**Q (discover: Quality proof): How should quality gains be proven?**
A: Eval harness — golden fixtures plus adoption scoring, CI-gated

**Q (discover: Prompt budget design): full transcript ships every fire (prompt.ts:77-84); keep or change?**
A: Rolling summary of old turns + verbatim recent tail + per-fire token budget field

**Q (discover: Memory design): only state is the cadence latch (index.ts:32); add memory?**
A: Local-only memory, session and project scopes, digest injected per fire

**Q (discover: Async fire mode): Blocking advisor call inside turn_end with 60s ceiling — keep?**
A: Async mode optional, blocking stays default

**Q (discover: Specialist transport): How do on-demand specialists reach the commit?**
A: Extra completeSimple call, aggregated single entry

**Q (global agent-session.js:375-384 vs plan-turn.ts:110): The runtime that loads the extension may predate 1.4.x — on 0.79.9 the gate silently never fires (event.outcome undefined). Which policy?**
A: Require 1.4.x — startup check notifies once and disables the gate below 1.4; new features assume the verified event fields.

**Q (pi-ai types.d.ts:267-283, :543-547): How does the base advisor flag a specialist, given stripAdvisorMarkup deletes markup-shaped text (advisor.ts:165-198)?**
A: Declared consult_specialist tool — flag and question arrive as structured toolUse arguments, resolved in-session.

**Q (config.ts:55, FR2 delegated): What memory retention default?**
A: Count cap, newest kept — clampWithWarn-guarded field, deterministic and offline-testable.

**Q (agent-session.js:1567-1581, types.d.ts:1258): Where does an async fire result land?**
A: Next natural boundary — hold the result, commit at the next agent_before_settle; the advisor never triggers a run.

## Related Research
- (none yet — first research artifact in this repo)

## Open Questions
- Does a child session share the factory's lastFiredTurn latch cross-session (index.ts:32)? Undeterminable statically (per-extension jiti, moduleCache:false — guard.ts:23-27); matters more once dialogue state exists. Runtime probe or accept per-session isolation.
- What offline-observable signal defines "advice adopted on the forced continuation" for the eval harness (FR9)? Candidates: a later turn whose outcome flips to completed after the advice entry, an executor custom_message referencing it, or a fixture-scripted executor response. Needs a definition before eval scoring can pin.
