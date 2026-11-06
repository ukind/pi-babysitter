// tests/suites/gate.mjs — F030 suite: banners 9, 11, and 19 through 20 of the
// former monolith — the plan-turn cores, the child veto, and the hook layer.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHILD_MARKER_PATTERN, isChildSession } from "../../guard.ts";
import { buildCorrection, planCommit, planGate } from "../../plan-turn.ts";
import { syntaxCheck } from "../../scripts/hooks/feedback.mjs";
import { evaluate } from "../../scripts/hooks/gate.mjs";
import {
  describeSpawnResult,
  isHookInvocation,
  parseHookStdin,
  readHookField,
} from "../../scripts/hooks/lib.mjs";
import { assert, gateArgs, marker, tmpRoot } from "../helpers.mjs";

// --- 9. plan-turn.ts: the extracted decision cores. The early-outs must keep the exact
//        order and laziness of the pre-extraction index.ts — an off-cadence turn invokes
//        no thunk beyond the trigger (t21 pins the trigger's cadence-miss-only
//        economics) — and the notify arms must carry the exact reportFailure
//        formats, so the seam can stay a dumb dispatcher.
{
  // Laziness. The cadence thunk runs; nothing behind it does.
  const calls = {
    gates: 0,
    markFired: 0,
    isChild: 0,
    parseModel: 0,
    resolve: 0,
    buildMessages: 0,
  };
  const decision = planGate(
    gateArgs({
      gates: () => {
        calls.gates++;
        return false;
      },
      markFired: () => {
        calls.markFired++;
      },
      isChild: () => {
        calls.isChild++;
        return true;
      },
      parseModel: () => {
        calls.parseModel++;
        return undefined;
      },
      resolve: () => {
        calls.resolve++;
        return { ok: false, reason: "unused" };
      },
      buildMessages: (messages) => {
        calls.buildMessages++;
        return messages;
      },
    }),
  );
  assert(decision.action === "skip", "t9: an off-cadence turn skips");
  assert(calls.gates === 1, "t9: the cadence thunk runs exactly once");
  const behind =
    calls.markFired + calls.isChild + calls.parseModel + calls.resolve + calls.buildMessages;
  assert(behind === 0, "t9: an off-cadence turn invokes no other thunk (laziness preserved)");
}
{
  // The silent top early-outs, and the order: cadence precedes the outcome check, the
  // outcome check precedes the child veto, and the veto precedes parse and resolve.
  assert(planGate(gateArgs({ enabled: false })).action === "skip", "t9: a disabled gate skips");
  assert(
    planGate(gateArgs({ model: "" })).action === "skip",
    "t9: an empty model skips before any thunk",
  );
  const calls = { gates: 0, markFired: 0, isChild: 0 };
  const errored = planGate(
    gateArgs({
      outcome: "error",
      gates: () => {
        calls.gates++;
        return true;
      },
      markFired: () => {
        calls.markFired++;
      },
      isChild: () => {
        calls.isChild++;
        return true;
      },
    }),
  );
  assert(errored.action === "skip", "t9: an errored boundary skips");
  assert(calls.gates === 1 && calls.isChild === 0, "t9: cadence precedes the outcome check");
  assert(calls.markFired === 0, "t9: an errored boundary does not spend its slot (the F007 slide)");
  const marks = [];
  const vetoed = planGate(
    gateArgs({
      isChild: () => true,
      parseModel: () => {
        throw new Error("parse must not run past the veto");
      },
      markFired: (i) => {
        marks.push(i);
      },
    }),
  );
  assert(vetoed.action === "skip", "t9: a child session skips before parse and resolve");
  assert(
    marks.join(",") === "1",
    "t9: the mark runs before the veto — a vetoed boundary spends its slot",
  );
}
{
  // The parse arm fails open SILENTLY — a skip, never a notify (pins index.ts:65-66).
  const decision = planGate(gateArgs({ parseModel: () => undefined }));
  assert(decision.action === "skip", "t9: an unparseable model skips");
  assert(!("message" in decision), "t9: the parse arm reports nothing");
}
{
  // The one notify arm in planGate: the exact reportFailure format the old :70 built.
  const decision = planGate(
    gateArgs({
      resolve: () => ({ ok: false, reason: 'provider "anthropic" has no credentials' }),
    }),
  );
  assert(
    decision.action === "notify" &&
      decision.message === 'advisor-turn-gate: provider "anthropic" has no credentials',
    "t9: a resolution failure notifies in the exact report format",
  );
}
{
  // The consult arm: the complete request shape, built inside the core, exactly once.
  const llm = [{ role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 }];
  const shaped = [{ role: "user", content: [{ type: "text", text: "shaped" }], timestamp: 2 }];
  const model = { provider: "anthropic", id: "claude-sonnet-4-5" };
  let built = 0;
  const decision = planGate(
    gateArgs({
      llmMessages: llm,
      systemPrompt: "the prompt",
      timeoutMs: 4321,
      resolve: () => ({ ok: true, model }),
      buildMessages: (messages) => {
        built++;
        assert(messages === llm, "t9: buildMessages receives the raw context");
        return shaped;
      },
    }),
  );
  assert(decision.action === "consult", "t9: the happy path consults");
  assert(decision.model === model, "t9: the resolved model rides through");
  assert(decision.systemPrompt === "the prompt", "t9: the system prompt rides through");
  assert(decision.messages === shaped, "t9: the messages are the shaped context");
  assert(decision.timeoutMs === 4321, "t9: the timeout rides through");
  assert(built === 1, "t9: buildMessages runs exactly once, inside the core");
}
// No lone block around the real-cadence asserts: they declare nothing, and biome rejects
// a declaration-free lone block (noUselessLoneBlockStatements).
// The real cadence predicate rides the seam: t1b's modulo interval sets, replayed
// through the core against shouldFire, so a seam that drops or inverts turnIndex or
// lastFiredTurn cannot pass silently.
assert(
  planGate(gateArgs({ interval: 0 })).action === "skip",
  "t9: interval 0 never consults through the real cadence",
);
assert(
  planGate(gateArgs({ turnIndex: 1, interval: 2 })).action === "consult",
  "t9: interval 2 consults on turnIndex 1 through the real cadence",
);
assert(
  planGate(gateArgs({ turnIndex: 0, interval: 2 })).action === "skip",
  "t9: interval 2 skips turnIndex 0 through the real cadence",
);
{
  // planCommit: both failure arms notify in the exact old formats (:84 and :93).
  const failed = planCommit({
    outcome: { ok: false, reason: "advisor stopped with error" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t9: an advisor error notifies in the exact report format",
  );
  const husk = planCommit({
    outcome: { ok: true, text: "<tool_call>x</tool_call>" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: () => "",
  });
  assert(
    husk.action === "notify" && husk.message === "advisor-turn-gate: advisor reply was markup only",
    "t9: a markup-only reply notifies in the exact husk format",
  );
}
{
  // The commit arm: the accumulator spread, asserted against the REAL buildCorrection
  // instead of the inline re-implementation this banner used to carry.
  const peers = [
    { type: "custom", customType: "peer-a" },
    { type: "custom", customType: "peer-b" },
  ];
  const committed = planCommit({
    outcome: { ok: true, text: "guidance" },
    customType: "advisor-turn-gate",
    display: false,
    peerEntries: peers,
    strip: (text) => text,
  });
  assert(committed.action === "commit", "t9: a clean reply commits");
  assert(committed.result.entries.length === 3, "t9: the spread keeps both peer drafts");
  assert(committed.result.entries[0].customType === "peer-a", "t9: peer order is preserved");
  assert(
    committed.result.entries[2].type === "custom_message",
    "t9: the guidance draft rides last",
  );
  assert(committed.result.continue === true, "t9: continue survives the spread");
  // The never-tested branch: undefined peerEntries degrades to a lone draft, not a crash.
  const noPeers = buildCorrection("advisor-turn-gate", "text", true, undefined);
  assert(noPeers.entries.length === 1, "t9: undefined peerEntries degrades to a lone draft");
  // The rejected alternative, kept as documentation: a bare array drops every peer draft.
  const bare = { entries: [{ type: "custom_message" }], continue: true };
  assert(
    bare.entries.length === 1,
    "t9: a bare array would drop both peers — the bug the spread prevents",
  );
}

// --- 11. the child-session veto. The first case is the regression test for the bug where
//         reading SystemMessage.content alone could never fire.
assert(
  isChildSession([
    { role: "system", content: "", sections: { preamble: marker("codebase-locator") } },
  ]),
  "t11: the marker in sections.preamble with empty content is caught",
);
assert(
  isChildSession([{ role: "system", content: marker("x"), sections: {} }]),
  "t11: the marker in content is caught",
);
assert(
  isChildSession([
    { role: "system", content: "", sections: { preamble: `intro${marker("x")}tail` } },
  ]),
  "t11: the marker anywhere in a section is caught",
);
assert(
  !isChildSession([
    {
      role: "system",
      content: "You are an expert coding assistant",
      sections: { preamble: "You are an expert coding assistant" },
    },
  ]),
  "t11: a main-session prompt is not caught",
);
assert(
  !isChildSession([{ role: "user", content: marker("x") }]),
  "t11: a user message quoting the marker is not caught — only system messages are scanned",
);
assert(!isChildSession([]), "t11: an empty context is not a child session");
assert(
  CHILD_MARKER_PATTERN.test(marker("anything")),
  "t11: the pattern matches the live prompts.ts:62 literal",
);
assert(
  !CHILD_MARKER_PATTERN.test("You are a child subagent"),
  "t11: the stale settings.json:84-90 pattern is rejected",
);
assert(
  !CHILD_MARKER_PATTERN.test("<active_agent>"),
  "t11: a tag with no name attribute is rejected",
);
assert(
  !CHILD_MARKER_PATTERN.test('<active_agent name="..."/>'),
  "t11: the AGENTS.md prose placeholder (dots, no alphanumeric) is rejected",
);
assert(
  !isChildSession([
    {
      role: "system",
      content: "Skips child sessions via the <active_agent name='...'/> marker veto.",
    },
  ]),
  "t11: gate documentation riding the system prompt stays inert",
);
assert(
  CHILD_MARKER_PATTERN.test(marker("aop.worker")),
  "t11: a legitimate child marker with a dotted agent name is caught",
);
assert(
  isChildSession([{ role: "system", content: "", sections: { preamble: marker("aop.worker") } }]),
  "t11: a dotted-name child marker vetoes the session",
);

// --- 19. the gate hook decision core: catastrophic commands block, ordinary ones pass.
{
  const blocked = [
    ["rm -rf /", "root"],
    ["rm -fr ~", "home"],
    ["rm -r -f /", "split flags"],
    ["rm -rf .", "dot"],
    ["rm -rf ..", "dotdot"],
    ["rm -rf '~'", "quoted home"],
    ["rm -rf ~/*", "home wildcard"],
    ["rm -rf C:\\", "drive root"],
    ["sudo rm -rf /", "sudo"],
    ["git push --force origin main", "long force"],
    ["git push -f main", "short force"],
    ["git push --force HEAD:master", "HEAD ref"],
    ["git reset --hard origin/main", "hard reset"],
    ["git clean -fd", "git clean"],
    ["DROP TABLE users;", "sql"],
    ["mkfs.ext4 /dev/sda1", "mkfs"],
    ["dd if=zero of=/dev/sda", "dd"],
    ["chmod -R 777 /", "chmod"],
    ["rm -rf C:/", "drive root forward slash"],
    ["rm -rf ../", "parent escape"],
    ["rm -rf ../*", "parent glob"],
    ["rm -rf ~/..", "home parent"],
  ];
  for (const [command] of blocked) {
    assert(evaluate(command) !== null, `t19: blocked: ${command}`);
  }
  const allowed = [
    "rm -rf node_modules",
    "rm -rf ./build",
    "rm -rf /var/log/app",
    "rm -rf ~/projects/*",
    "rm -r src",
    "rm file.txt",
    "git push origin feature/x",
    "git push --force-with-lease origin main",
    "git push origin main",
    "git reset --soft HEAD~1",
    "git clean -n",
    "DROP a hint",
    "npm test",
    "ls -la",
    "rm -rf build",
  ];
  for (const command of allowed) {
    assert(evaluate(command) === null, `t19: allowed: ${command}`);
  }
  assert(evaluate("") === null, "t19: empty command is allowed");
  assert(evaluate(undefined) === null, "t19: non-string is allowed");
  assert(evaluate("DROP TABLE users;") === "SQL drop statement", "t19: the reason names the rule");
}

// --- 19b. the refspec force markers (F009, F021, F022): a leading + on a refspec is
//          git's own force signal, and every refspec token is matched individually
//          against the protected-branch shape.
{
  const blocked = [
    "git push origin +main",
    "git push origin +master",
    "git push +main",
    "git push origin +HEAD:main",
    "git push origin +HEAD~1:main",
    "git push --force origin +main",
    "git push -f origin +main",
    "git push --force-with-lease origin +main",
    "git push origin main +main",
    "git push origin +main:main",
    "git push --force origin refs/heads/main",
    "git push origin +refs/heads/main",
    "git push -f origin HEAD:refs/heads/main",
    "git push origin --force refs/heads/main",
    "git push origin +:main",
  ];
  for (const command of blocked) {
    assert(evaluate(command) !== null, `t19b: blocked: ${command}`);
  }
  assert(blocked.length === 15, "t19b: 15 forced-refspec forms block");
  assert(
    evaluate("git push origin +main") === "forced push to a protected branch",
    "t19b: the + form reports the same reason as the flag form",
  );
  // The force-with-lease allowance survives, scoped to UNMARKED refspecs; a +
  // on an unprotected branch is still an ordinary push; and a forced push of
  // an UNPROTECTED branch alongside a plain protected one no longer convicts
  // the whole command (F022's false positive).
  const allowed = [
    "git push --force-with-lease origin main",
    "git push origin +feature/x",
    "git push origin feature/x",
    "git push origin main +feature/x",
  ];
  for (const command of allowed) {
    assert(evaluate(command) === null, `t19b: allowed: ${command}`);
  }
}

// --- 19c. the shared hook plumbing (F017): invocation detection, stdin parse, field
//          read. Only each hook's exit dispatch stays untested.
{
  assert(
    isHookInvocation(["node", "/repo/scripts/hooks/gate.mjs"], "gate.mjs"),
    "t19c: the gate path matches gate.mjs",
  );
  assert(
    isHookInvocation(["node", "\\repo\\scripts\\hooks\\gate.mjs"], "gate.mjs"),
    "t19c: a Windows path matches gate.mjs",
  );
  assert(
    !isHookInvocation(["node", "/repo/scripts/hooks/feedback.mjs"], "gate.mjs"),
    "t19c: the feedback hook does not match gate.mjs",
  );
  assert(!isHookInvocation(["node"], "gate.mjs"), "t19c: a missing entry arg never matches");
  const object = parseHookStdin('{"tool_input":{"command":"ls"}}');
  assert(object?.tool_input?.command === "ls", "t19c: an object body parses");
  assert(parseHookStdin("{ not json") === undefined, "t19c: a parse error returns undefined");
  assert(parseHookStdin("42") === undefined, "t19c: a non-object body returns undefined");
  assert(parseHookStdin("null") === undefined, "t19c: a null body returns undefined");
  const payload = { tool_input: { command: "ls" }, toolInput: { file_path: "a.ts" } };
  assert(readHookField(payload, "command") === "ls", "t19c: the snake_case carrier reads");
  assert(
    readHookField(payload, "file_path") === "a.ts",
    "t19c: the camelCase carrier is the fallback",
  );
  assert(readHookField({}, "command") === undefined, "t19c: a missing field returns undefined");
  assert(
    readHookField(undefined, "command") === undefined,
    "t19c: a missing payload returns undefined",
  );
}

// --- 20. the feedback hook's syntax check (F018): the spawnSync decision table, with the
//         timeout named. Node 22+ sets error=ETIMEDOUT alongside status=null and signal on
//         a spawnSync timeout (verified live on v24.14.0), so the timeout shape rides the
//         error branch — not the audit's traced "exit code null" fall-through.
{
  // A real valid file: the ok branch, through syntaxCheck itself.
  const valid = join(tmpRoot, "syntax-valid.mjs");
  writeFileSync(valid, "export const ok = 1;\n");
  const okResult = syntaxCheck(valid);
  assert(okResult.ok && okResult.detail === "syntax ok", "t20: a valid file reports syntax ok");

  // A real broken file: the stderr branch carries node's own syntax error text.
  const broken = join(tmpRoot, "syntax-broken.mjs");
  writeFileSync(broken, "const = ;\n");
  const badResult = syntaxCheck(broken);
  assert(
    !badResult.ok && badResult.detail.length > 0,
    "t20: a broken file carries the stderr text",
  );
  assert(
    !/exit code/.test(badResult.detail),
    "t20: a syntax error reports stderr, never the bare exit code",
  );

  // The F018 crux, constructed: the spawnSync timeout shape on Node 22+ — error set
  // (ETIMEDOUT), status null, signal SIGTERM.
  const timedOut = describeSpawnResult({
    error: new Error("spawnSync node.exe ETIMEDOUT"),
    status: null,
    signal: "SIGTERM",
  });
  assert(
    !timedOut.ok && timedOut.detail === "timed out after 10s (signal SIGTERM)",
    "t20: the timeout shape reports the timeout, not the ETIMEDOUT noise",
  );

  // A spawn error without the timeout shape (spawn failure, no signal): the raw message.
  const spawnedError = describeSpawnResult({ error: new Error("spawn failed"), status: null });
  assert(
    !spawnedError.ok && spawnedError.detail === "spawn failed",
    "t20: a plain spawn error surfaces its message",
  );

  // The no-error kill shape (external SIGTERM): reported as a kill, never as a timeout.
  const killed = describeSpawnResult({ status: null, signal: "SIGTERM" });
  assert(
    !killed.ok && killed.detail === "killed by SIGTERM before exit",
    "t20: a signal kill without an error is not claimed as a timeout",
  );

  // A non-zero exit with no stderr names the exit code.
  const silentFail = describeSpawnResult({ status: 1, stderr: null });
  assert(
    !silentFail.ok && silentFail.detail === "exit code 1",
    "t20: a non-zero exit with no stderr names the exit code",
  );
}
