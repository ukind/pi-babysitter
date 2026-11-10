/**
 * eval/runner.mjs — the offline eval harness (FR9), the sanctioned second runner.
 *
 * TECH_DEBT_AUDIT.md sets the split rule ("~1,500 lines or when a second runner
 * appears"); this directory is that second runner. The unit suite runs beside it:
 * eight suites under tests/suites/ through the tests/test.mjs bare-import runner.
 * Each fixture under eval/fixtures/
 * seeds one pillar's scenario as pure JSON: a projected llmMessages context, the gate
 * config, per-turn trigger signals, a scripted completion facade, and optional sandbox
 * or memory state. The runner replays the REAL pipeline — planGate, buildAdvisorMessages,
 * runAdvisor over the scripted facade, planCommit — binding the same seam thunks
 * index.ts binds (Region D triggers, Region G digest, Region S6-B specialist), then
 * scores the committed entries.
 *
 * The scores are the CI gate: the exit code is 1 when any fixture errors or any score
 * fails. A gate that cannot fail is not a gate, so the runner self-tests the scorer on
 * startup: a deliberately false expectation must register as a failure before any
 * fixture runs.
 *
 * Offline by construction: no live model, no auth, no network. The completion facade is
 * a queue of scripted responses; the model registry is a two-line stub that resolves any
 * "stub/..." key. Memory I/O lands in a per-fixture temp dir behind the MEMORY_DIR_URL
 * affordance (the withConfig pattern), so no real store is ever touched.
 *
 * Run: npm run eval   (node --experimental-strip-types eval/runner.mjs)
 * Score names and reason strings are contract, same as the unit suite: a rename here is
 * a CI-visible change, not a refactor.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONSULT_ANSWER_HEADER,
  CONSULT_SECTION_SEPARATOR,
  resolveAdvisorModel,
  runAdvisor,
  stripAdvisorMarkup,
} from "../advisor.ts";
import { DEFAULT_CONFIG, parseModelKey, shouldFire } from "../config.ts";
import {
  DIGEST_HEADER_PREFIX,
  digestMessage,
  MEMORY_DIR_URL,
  projectKeyFor,
  readEntries,
  recordAdvice,
} from "../memory.ts";
import { planCommit, planGate, stampDetails } from "../plan-turn.ts";
import {
  BUDGET_FOLD_MARKER_PREFIX,
  buildAdvisorMessages,
  estimateMessageTokens,
} from "../prompt.ts";
import { createSandbox, READ_FILE_TOOL, SANDBOX_MAX_BYTES } from "../sandbox.ts";
import { parseRiskyTools, planTrigger, triggersArmed } from "../triggers.ts";

/**
 * One fixed clock for every replay (FR2 timestamps and digest stamps). Dates never
 * print, so a constant keeps the output byte-stable across runs and machines.
 */
const CLOCK = 1751500000000;

/**
 * The fold marker's estimated cost, re-declared at the value of prompt.ts's unexported
 * MARKER_TOKEN_ALLOWANCE (the DEFAULT_MAX_TOOL_ROUNDS parity pattern). The
 * budget-respected score bounds the built payload at budget + this slack, which is
 * exactly the guarantee the fold's own exit condition provides.
 */
const MARKER_SLACK = 64;

/** The pinned score names. The fixtures declare a subset; unknown names fail their fixture. */
const SCORES = {
  "drift-caught": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    return entry?.content.includes(fixture.expect.adviceIncludes);
  },
  "budget-respected": (replay, fixture) => {
    const built = replay.builtMessages ?? [];
    const total = built.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    const markerRan = built.some((message) =>
      messageText(message).startsWith(BUDGET_FOLD_MARKER_PREFIX),
    );
    const narrowed = built.every(
      (message) => message.role === "user" || message.role === "assistant",
    );
    const survivorsKept = fixture.keptTexts.every((text) =>
      built.some((message) => messageText(message).includes(text)),
    );
    const systemsDropped = fixture.systemTexts.every(
      (text) => !built.some((message) => messageText(message).includes(text)),
    );
    return (
      markerRan &&
      narrowed &&
      survivorsKept &&
      systemsDropped &&
      total <= fixture.config.tokenBudget + MARKER_SLACK
    );
  },
  "sandbox-read-applied": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    return (
      entry !== undefined &&
      replay.facadeCalls === fixture.expect.facadeCalls &&
      entry.content.includes(fixture.expect.adviceIncludes)
    );
  },
  "single-entry-aggregation": (replay) => {
    if (replay.commits.length !== 1) return false;
    const text = replay.commits[0]?.content;
    if (typeof text !== "string" || text.includes("\n\n\n")) return false;
    const parts = text.split(CONSULT_SECTION_SEPARATOR);
    return parts.length === 2 && parts[1].startsWith(CONSULT_ANSWER_HEADER);
  },
  "allowlist-refused": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    if (entry === undefined || entry.content.includes(fixture.expect.adviceExcludes)) return false;
    const toolResults = (replay.lastFacadeMessages ?? []).filter((m) => m.role === "toolResult");
    return toolResults.some(
      (m) => m.isError === true && messageText(m).includes(fixture.expect.toolResultIncludes),
    );
  },
  "repeats-avoided": (replay, fixture) => {
    const digest = (replay.builtMessages ?? []).find(
      (message) =>
        message.role === "system" && messageText(message).startsWith(DIGEST_HEADER_PREFIX),
    );
    if (digest === undefined || !messageText(digest).includes(fixture.expect.digestIncludes)) {
      return false;
    }
    const prior = fixture.priorEntries.at(-1)?.text;
    const entry = replay.commits.at(-1);
    return entry !== undefined && entry.content !== prior;
  },
  "dialogue-keys": (replay, fixture) => {
    const entry = replay.commits.at(-1);
    const details = entry?.details;
    return (
      details !== undefined &&
      details.fire === fixture.expect.details.fire &&
      details.turn === fixture.expect.details.turn
    );
  },
  "advice-adopted": (replay, fixture) => {
    return replay.lastResult?.continue === true && fixture.continuation?.outcome === "completed";
  },
};

/** Flatten one Message to text: system content is a string, the rest are block arrays. */
function messageText(message) {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => block.text ?? "").join("\n");
}

/** The score evaluation primitive. Only literal true passes; the self-test pins both arms. */
function evaluateScore(name, pass) {
  return { name, pass: pass === true };
}

/**
 * The gate self-test: a known-true expectation passes and a known-false one fails.
 * If the scorer could not register a failure, every later PASS row would be noise —
 * the runner must prove its own gate before gating anything else.
 */
function selfTestGate() {
  return evaluateScore("gate-self-test", true).pass && !evaluateScore("gate-self-test", false).pass;
}

/** A registry stub that resolves any "stub/..." key (find + the credential snapshot). */
function makeRegistry() {
  const model = { provider: "stub", id: "stub-model" };
  return {
    find: () => model,
    getAvailable: () => [{ provider: "stub", id: "stub-model" }],
    runtime: { completeSimple: undefined },
  };
}

/**
 * The scripted completion facade: the replay re-points state.currentScript at each
 * turn's facade before its calls, and the queue shifts per call — advisor rounds and
 * consult legs draw from the same turn script. The captured context of the LAST call
 * carries the replayed toolResult messages the allowlist-refused score inspects. An
 * exhausted queue yields a deterministic no-text stop response, so the fire fails open
 * instead of hanging.
 */
function makeFacade(state) {
  return (_model, context) => {
    state.facadeCalls += 1;
    state.lastFacadeMessages = context.messages;
    const script = state.currentScript ?? [];
    const next =
      script.length > 0
        ? script.shift()
        : { stopReason: "stop", content: [{ type: "text", text: "" }] };
    return Promise.resolve(next);
  };
}

/**
 * Per-fixture isolation: a temp project root for the sandbox (fixture sandboxFiles
 * written inside, the optional outsideFile written beside it but OUTSIDE the root) and
 * a temp memory dir swapped in behind MEMORY_DIR_URL, seeded from priorEntries.
 * Cleanup restores the real href and removes both temp trees even on a throwing replay.
 */
function makeEnv(fixture) {
  const tempRoot = mkdtempSync(join(tmpdir(), "advisor-eval-"));
  const project = join(tempRoot, "project");
  mkdirSync(project, { recursive: true });
  for (const [name, text] of Object.entries(fixture.sandboxFiles ?? {})) {
    const file = join(project, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  if (fixture.outsideFile !== undefined) {
    writeFileSync(join(tempRoot, fixture.outsideFile.name), fixture.outsideFile.text);
  }
  const memDir = mkdtempSync(join(tmpdir(), "advisor-eval-mem-"));
  const realHref = MEMORY_DIR_URL.href;
  MEMORY_DIR_URL.href = pathToFileURL(`${memDir}/`).href;
  if ((fixture.priorEntries ?? []).length > 0) {
    const key = projectKeyFor(project);
    writeFileSync(
      join(memDir, `${key}.json`),
      `${JSON.stringify(fixture.priorEntries, null, 2)}\n`,
    );
  }
  return {
    project,
    restore: () => {
      MEMORY_DIR_URL.href = realHref;
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(memDir, { recursive: true, force: true });
    },
  };
}

/**
 * Replay one fixture through the blocking-mode pipeline, mirroring the index.ts seam:
 * the Region D trigger thunk (armed only when thresholds say so), the Region G
 * buildMessages thunk (digest when memoryCap allows), the Region S6-B specialist
 * resolution, the Region H post-commit memory record, and the Region I details stamp.
 * State (latch, fire count, captures) lives across the fixture's turns in order.
 */
async function replayFixture(fixture) {
  const env = makeEnv(fixture);
  const state = {
    lastFiredTurn: -1,
    fireCount: 0,
    commits: [],
    lastResult: undefined,
    notified: [],
    facadeCalls: 0,
    builtMessages: undefined,
    lastFacadeMessages: undefined,
    currentScript: [],
  };
  try {
    const config = { ...DEFAULT_CONFIG, ...fixture.config };
    const registry = makeRegistry();
    registry.runtime.completeSimple = makeFacade(state);
    const key = projectKeyFor(env.project);
    // Region D mirror: thresholds shaped from config, the thunk armed only when armed.
    const thresholds = {
      minNewTokens: config.triggerMinNewTokens,
      contextPercent: config.triggerContextPercent,
      onError: config.triggerOnError,
      riskyTools: parseRiskyTools(config.triggerRiskyTools),
    };
    // Region S6-B mirror: the specialist resolves at fire time or stays undefined.
    let specialist;
    if (config.specialistModel) {
      const parsed = parseModelKey(config.specialistModel);
      if (parsed) {
        const resolution = resolveAdvisorModel(registry, parsed.provider, parsed.modelId);
        if (resolution.ok) {
          specialist = {
            model: resolution.model,
            systemPrompt: config.specialistSystemPrompt,
            // Mirror of index.ts:189-192 — the specialist's own level. The blind
            // DEFAULT_CONFIG spread at :261 forwards the "" sentinel, so fixtures
            // without the key stay byte-identical.
            reasoning: config.specialistReasoningEffort,
          };
        }
      }
    }
    for (const turn of fixture.turns) {
      state.currentScript = turn.facade ?? [];
      const gate = planGate({
        enabled: config.enabled,
        model: config.model,
        interval: config.interval,
        systemPrompt: config.systemPrompt,
        timeoutMs: config.timeoutMs,
        turnIndex: turn.turnIndex,
        outcome: turn.outcome,
        llmMessages: turn.llmMessages,
        lastFiredTurn: state.lastFiredTurn,
        gates: shouldFire,
        isChild: () => false,
        parseModel: () => parseModelKey(config.model),
        resolve: (provider, modelId) => resolveAdvisorModel(registry, provider, modelId),
        // Region G mirror: the digest rides the same thunk, paying only on a fire.
        buildMessages: (messages) => {
          const digest = config.memoryCap > 0 ? digestMessage(readEntries(key), CLOCK) : undefined;
          return buildAdvisorMessages(messages, config.tokenBudget, digest);
        },
        markFired: (turnIndex) => {
          state.lastFiredTurn = turnIndex;
        },
        trigger:
          triggersArmed(thresholds) && turn.signals !== undefined
            ? () => planTrigger(turn.signals, thresholds)
            : undefined,
      });
      if (gate.action === "skip") continue;
      if (gate.action === "notify") {
        state.notified.push(gate.message);
        continue;
      }
      state.builtMessages = gate.messages;
      const outcome = await runAdvisor({
        registry,
        model: gate.model,
        systemPrompt: gate.systemPrompt,
        messages: gate.messages,
        timeoutMs: gate.timeoutMs,
        tools: config.toolsEnabled ? [READ_FILE_TOOL] : undefined,
        executeTool: config.toolsEnabled
          ? createSandbox(env.project, SANDBOX_MAX_BYTES)
          : undefined,
        maxToolRounds: config.maxToolRounds,
        // Mirror of index.ts:202-219 — the advisor level. The blind DEFAULT_CONFIG
        // spread at :261 forwards the "" sentinel, so fixtures without the key stay
        // byte-identical (the facade ignores the third argument anyway).
        reasoning: config.reasoningEffort,
        specialist,
      });
      const commit = planCommit({
        outcome,
        customType: config.customType,
        display: config.display,
        peerEntries: [],
        strip: stripAdvisorMarkup,
        details: stampDetails(state.fireCount + 1, turn.turnIndex),
      });
      if (commit.action === "notify") {
        state.notified.push(commit.message);
        continue;
      }
      state.commits.push(commit.result.entries.at(-1));
      state.lastResult = commit.result;
      state.fireCount += 1;
      // Region H mirror: the commit-stripped text is what enters the digest channel.
      if (outcome.ok && config.memoryCap > 0) {
        recordAdvice(key, stripAdvisorMarkup(outcome.text), config.memoryCap, CLOCK);
      }
    }
    return { ...state, error: undefined };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ...state, error: reason };
  } finally {
    env.restore();
  }
}

/** One fixture's structural contract, checked before any score runs. */
function structuralFailure(replay, fixture) {
  if (replay.error !== undefined) return `replay threw: ${replay.error}`;
  const expectedCommits = fixture.expect?.commits ?? 0;
  if (replay.commits.length !== expectedCommits) {
    return `expected ${expectedCommits} commit(s), replay produced ${replay.commits.length}`;
  }
  return undefined;
}

async function main() {
  if (!selfTestGate()) {
    console.log("eval: gate self-test FAIL (a known-false expectation did not register)");
    process.exitCode = 1;
    return;
  }
  console.log("eval: gate self-test PASS");
  const files = readdirSync(new URL("./fixtures/", import.meta.url))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    console.log("eval: no fixtures found");
    process.exitCode = 1;
    return;
  }
  let fixturesGreen = 0;
  let totalScores = 0;
  let passedScores = 0;
  for (const file of files) {
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf-8"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`eval: ${file} ERROR (unreadable fixture: ${reason})`);
      process.exitCode = 1;
      continue;
    }
    const replay = await replayFixture(fixture);
    const failure = structuralFailure(replay, fixture);
    if (failure !== undefined) {
      console.log(`eval: ${fixture.name} ERROR (${failure})`);
      process.exitCode = 1;
      continue;
    }
    fixturesGreen += 1;
    for (const name of fixture.scores) {
      totalScores += 1;
      const check = SCORES[name];
      if (check === undefined) {
        console.log(`eval: ${fixture.name}/${name} FAIL (unknown score name)`);
        process.exitCode = 1;
        continue;
      }
      const { pass } = evaluateScore(name, check(replay, fixture));
      console.log(`eval: ${fixture.name}/${name} ${pass ? "PASS" : "FAIL"}`);
      if (pass) passedScores += 1;
      else process.exitCode = 1;
    }
  }
  console.log(
    `eval: ${fixturesGreen}/${files.length} fixture(s) replayed, ` +
      `${passedScores}/${totalScores} score(s) pass`,
  );
}

await main();
