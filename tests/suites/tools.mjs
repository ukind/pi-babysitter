// tests/suites/tools.mjs — F030 suite: banners 25 and 25c of the former
// monolith — the read_file sandbox, the tool loop, and the tool fields.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdvisor, stripAdvisorMarkup } from "../../advisor.ts";
import {
  DEFAULT_CONFIG,
  loadConfig,
  MAX_TOOL_ROUNDS,
  MIN_TIMEOUT_MS,
  MIN_TOOL_ROUNDS,
} from "../../config.ts";
import {
  createSandbox,
  planRead,
  READ_FILE_TOOL,
  SANDBOX_MAX_BYTES,
  sandboxRefusalFor,
} from "../../sandbox.ts";
import { assert, captureWarn, tmpRoot, withConfig } from "../helpers.mjs";

// --- 25. FR4 read-only tools: the pure path bound, the sandbox I/O, the loop, and
//         the shared deadline.
{
  // planRead: the pure prefix bound. Cases ride join()/resolve() so they hold on
  // win32 and POSIX alike; planRead does no fs, so no fixture files are needed.
  const root = join(tmpRoot, "sandbox-plan-root");
  assert(planRead(root, "src/a.ts").action === "allow", "t25: a project-relative path is allowed");
  assert(
    planRead(root, join(root, "src", "a.ts")).action === "allow",
    "t25: an absolute path inside the root is allowed",
  );
  const parentEscape = planRead(root, join("..", "evil.ts"));
  assert(
    parentEscape.action === "refuse" &&
      parentEscape.reason.includes("outside the project directory"),
    "t25: a parent escape is refused with the pinned wording",
  );
  assert(
    planRead(root, join(root, "..", "evil.ts")).action === "refuse",
    "t25: an in-root-relative escape sequence is refused",
  );
  assert(
    planRead(root, join(tmpdir(), "elsewhere", "x.ts")).action === "refuse",
    "t25: an absolute path outside the root is refused",
  );
  assert(planRead(root, "").action === "refuse", "t25: an empty path is refused");
  assert(planRead(root, undefined).action === "refuse", "t25: a missing path is refused");
  assert(planRead(root, 42).action === "refuse", "t25: a non-string path is refused");
  // F031: the secret denylist. Site 1 runs on the requested path before any
  // resolution, so these refuse even though planRead does no fs.
  assert(
    planRead(root, "src/.env.example").action === "refuse" &&
      planRead(root, "src/.env.example").reason.includes("a secret file"),
    "t25: an example env file refuses too — the denylist is strict",
  );
  assert(
    planRead(root, join("src", ".env")).action === "refuse",
    "t25: a nested env path refuses (the join() spelling holds on win32)",
  );
  assert(
    planRead(root, join(root, ".npmrc")).action === "refuse",
    "t25: an absolute secret path refuses",
  );
  assert(
    planRead(root, join("keys", "server.pem")).action === "refuse",
    "t25: a key file refuses by its .pem extension",
  );
  assert(planRead(root, ".ENV").action === "refuse", "t25: the denylist is case-insensitive");
  assert(
    planRead(root, join("..", ".env")).reason.includes("a secret file"),
    "t25: the denylist outranks the escape check",
  );
}

{
  // The real sandbox over real files in tmpRoot: the happy path and the shape
  // refusals node itself produces. The escape and read-error shapes ride stub fs
  // in the next block, so this block stays platform-stable.
  const root = join(tmpRoot, "sandbox-live");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "note.txt"), "hello advice");
  const sandbox = createSandbox(root);
  const okRead = sandbox("read_file", { path: "note.txt" });
  assert(okRead.ok && okRead.text === "hello advice", "t25: a real read returns the file text");
  const wrongName = sandbox("write_file", { path: "note.txt" });
  assert(
    !wrongName.ok && wrongName.reason === sandboxRefusalFor("write_file"),
    "t25: a non-allowlisted name is refused with the pinned string",
  );
  const outside = sandbox("read_file", { path: join("..", "config-under-test.json") });
  assert(
    !outside.ok && outside.reason.includes("outside the project directory"),
    "t25: the sandbox refuses a parent escape",
  );
  const missing = sandbox("read_file", { path: "nope.txt" });
  assert(!missing.ok && missing.reason.includes("no such file"), "t25: a missing file refuses");
  const dirRead = sandbox("read_file", { path: "." });
  assert(!dirRead.ok && dirRead.reason.includes("not a file"), "t25: a directory read refuses");
  // F031 site 1 through the live sandbox: a secret-named path refuses before
  // any fs work — no fixture file needed — while a non-secret neighbor still
  // reads end-to-end through realpath, read, and return.
  const envRead = sandbox("read_file", { path: ".env" });
  assert(
    !envRead.ok && envRead.reason.includes("a secret file"),
    "t25: a .env read refuses through the live sandbox",
  );
  const envExampleRead = sandbox("read_file", { path: join("src", ".env.example") });
  assert(
    !envExampleRead.ok && envExampleRead.reason.includes("a secret file"),
    "t25: a nested example env read refuses through the live sandbox",
  );
  writeFileSync(join(root, "README.md"), "# not a secret");
  const readmeRead = sandbox("read_file", { path: "README.md" });
  assert(
    readmeRead.ok && readmeRead.text === "# not a secret",
    "t25: a non-secret file still reads end-to-end",
  );
  const capped = createSandbox(root, 4);
  const overCap = capped("read_file", { path: "note.txt" });
  assert(
    !overCap.ok && overCap.reason.includes("byte cap"),
    "t25: an over-cap read refuses with the byte-cap wording",
  );
  assert(createSandbox(root)("read_file", null).ok === false, "t25: null args refuse");
  assert(createSandbox(root)("read_file", {}).ok === false, "t25: path-less args refuse");
  assert(
    createSandbox(root)("read_file", { path: 42 }).ok === false,
    "t25: a numeric path refuses",
  );
}

{
  // The FsLike seam: a stub realpath escaping the root and a stub read throwing
  // are pinned deterministically — no real symlinks, no platform guards.
  const root = join(tmpRoot, "sandbox-stub");
  const escapeFs = {
    readFileSync: () => Buffer.alloc(0),
    realpathSync: () => join(tmpdir(), "outside", "secret.txt"),
  };
  const escaped = createSandbox(
    root,
    SANDBOX_MAX_BYTES,
    escapeFs,
  )("read_file", {
    path: "note.txt",
  });
  assert(
    !escaped.ok && escaped.reason.includes("outside the project directory"),
    "t25: a realpath escaping the root is refused (stub fs)",
  );
  const boomFs = {
    readFileSync: () => {
      const err = new Error("disk gone");
      err.code = "EACCES";
      throw err;
    },
    realpathSync: (p) => p,
  };
  const denied = createSandbox(root, SANDBOX_MAX_BYTES, boomFs)("read_file", { path: "note.txt" });
  assert(
    !denied.ok && denied.reason.includes("disk gone"),
    "t25: a read error surfaces through the injected fs with its message",
  );
  // F031 site 2: the realpath side re-checks the denylist. The stub resolves an
  // innocent request to a secret INSIDE the root, so the prefix re-check passes
  // and only the denylist can refuse — this pin proves the second site fires.
  const secretFs = {
    readFileSync: () => Buffer.from("leaked"),
    realpathSync: () => join(root, ".npmrc"),
  };
  const secretReal = createSandbox(
    root,
    SANDBOX_MAX_BYTES,
    secretFs,
  )("read_file", {
    path: "note.txt",
  });
  assert(
    !secretReal.ok && secretReal.reason.includes("a secret file"),
    "t25: a realpath landing on a secret refuses (stub fs)",
  );
}

{
  // The loop: a toolUse round is consumed, the result replays, the terminal stop commits.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.ts" } },
            ],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "final guidance" }],
        });
      },
    },
  };
  const executed = [];
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [{ role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 }],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: (name, args) => {
      executed.push([name, args]);
      return { ok: true, text: "file body" };
    },
    maxToolRounds: 3,
  });
  assert(
    outcome.ok && outcome.text === "final guidance",
    "t25: the loop resolves to the final text",
  );
  assert(calls === 2, "t25: a consumed toolUse costs exactly one extra call");
  assert(
    executed.length === 1 && executed[0][0] === "read_file" && executed[0][1].path === "a.ts",
    "t25: the executor receives the call name and arguments",
  );
  assert(secondContext !== null, "t25: the second call carries the replayed conversation");
  assert(secondContext.messages.length === 3, "t25: the replay appends assistant + toolResult");
  assert(secondContext.messages[1].role === "assistant", "t25: the assistant turn is replayed");
  const result = secondContext.messages[2];
  assert(
    result.role === "toolResult" &&
      result.toolCallId === "c1" &&
      result.isError === false &&
      result.content[0].text === "file body",
    "t25: a successful execution replays as a non-error toolResult",
  );
  assert(
    secondContext.tools.length === 1 && secondContext.tools[0].name === "read_file",
    "t25: the declared tool rides every round's request",
  );
}

{
  // A refusal replays as isError and the advisor still gets its turn.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c2", name: "write_file", arguments: { path: "x" } }],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "adapted guidance" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: (name) => ({ ok: false, reason: sandboxRefusalFor(name) }),
    maxToolRounds: 3,
  });
  assert(
    outcome.ok && outcome.text === "adapted guidance",
    "t25: a refusal does not fail the fire",
  );
  // This block starts from an empty context, so the replay is [assistant, toolResult]
  // and the toolResult is the LAST message (the seeded block above pins index 2).
  const replayed = secondContext.messages.at(-1);
  assert(
    replayed.isError === true && replayed.content[0].text === sandboxRefusalFor("write_file"),
    "t25: a refusal replays as an errored toolResult carrying the pinned reason",
  );
}

{
  // The rounds cap: a tool-happy advisor hits the terminal gate with the SAME
  // pinned reason the single-call path always produced, after exactly
  // maxRounds + 1 calls and no grace call.
  let calls = 0;
  const toolUse = () => {
    calls += 1;
    return Promise.resolve({
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: `c${calls}`, name: "read_file", arguments: {} }],
    });
  };
  const capped = await runAdvisor({
    registry: { runtime: { completeSimple: toolUse } },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 1,
  });
  assert(
    !capped.ok && capped.reason === "advisor stopped with toolUse",
    "t25: an exhausted round budget rejects with the pinned toolUse reason",
  );
  assert(calls === 2, "t25: maxToolRounds 1 spends exactly one loop round");
  calls = 0;
  const defaulted = await runAdvisor({
    registry: { runtime: { completeSimple: toolUse } },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
  });
  assert(
    !defaulted.ok && defaulted.reason === "advisor stopped with toolUse",
    "t25: the default cap rejects too",
  );
  assert(calls === 4, "t25: the omitted maxToolRounds defaults to 3 rounds (config parity)");
}

{
  // Unarmed runAdvisor with a toolUse response keeps the single-call rejection —
  // the t16 pin re-run through the new gate order.
  let calls = 0;
  const outcome = await runAdvisor({
    registry: {
      runtime: {
        completeSimple: () => {
          calls += 1;
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c", name: "read_file", arguments: {} }],
          });
        },
      },
    },
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
  });
  assert(
    !outcome.ok && outcome.reason === "advisor stopped with toolUse",
    "t25: an unarmed call still rejects a toolUse outright",
  );
  assert(calls === 1, "t25: an unarmed toolUse never loops");
}

{
  // Integration: the REAL sandbox refuses through the loop, by name, with the pinned string.
  let calls = 0;
  let secondContext = null;
  const registry = {
    runtime: {
      completeSimple: (_model, context) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c3", name: "write_file", arguments: { path: "x" } }],
          });
        }
        secondContext = context;
        return Promise.resolve({
          stopReason: "stop",
          content: [{ type: "text", text: "guidance after refusal" }],
        });
      },
    },
  };
  const outcome = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: 5000,
    tools: [READ_FILE_TOOL],
    executeTool: createSandbox(tmpRoot),
    maxToolRounds: 3,
  });
  assert(outcome.ok, "t25: a refused non-allowlisted call still lands guidance");
  // Empty start like the refusal block above: the toolResult is the last replayed message.
  const replayedRefusal = secondContext.messages.at(-1);
  assert(
    replayedRefusal.content[0].text === sandboxRefusalFor("write_file"),
    "t25: the real sandbox's refusal text reaches the advisor verbatim",
  );
}

{
  // The shared deadline: a fast toolUse round then a hung round dies at the
  // ORIGINAL budget, not budget-plus-round.
  const keep = setInterval(() => {}, 500);
  let calls = 0;
  const registry = {
    runtime: {
      completeSimple: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "c", name: "read_file", arguments: { path: "a" } }],
          });
        }
        return new Promise(() => {});
      },
    },
  };
  const t0 = Date.now();
  const hung = await runAdvisor({
    registry,
    model: { provider: "a", id: "b" },
    systemPrompt: "sp",
    messages: [],
    timeoutMs: MIN_TIMEOUT_MS,
    tools: [READ_FILE_TOOL],
    executeTool: () => ({ ok: true, text: "x" }),
    maxToolRounds: 3,
  });
  const dt = Date.now() - t0;
  clearInterval(keep);
  assert(
    !hung.ok && /timed out/.test(hung.reason),
    "t25: a hung second round fails open at the deadline",
  );
  assert(
    dt >= MIN_TIMEOUT_MS - 50 && dt < MIN_TIMEOUT_MS + 2000,
    `t25: the shared deadline fires on time for a ${MIN_TIMEOUT_MS}ms budget`,
  );
}

{
  // F023 strip discipline (Step 4 coverage fix; design follow-up: the design's
  // Verification Note 4 demands the byte-identity guard discipline for every new
  // refusal vocabulary, and t25 pins none of it): the sandbox refusal strings
  // pass stripAdvisorMarkup byte-identical, so no strip tier can ever rewrite one.
  for (const name of ["read_file", "write_file", "consult_specialist"]) {
    const refusal = sandboxRefusalFor(name);
    assert(
      stripAdvisorMarkup(refusal) === refusal,
      "t25: the allowlist refusal survives the strip byte-identical",
    );
  }
  const pathProbe = planRead(join(tmpRoot), join("..", "x.ts"));
  const pathRefusal = pathProbe.action === "refuse" ? pathProbe.reason : "";
  assert(
    pathRefusal.length > 0 && stripAdvisorMarkup(pathRefusal) === pathRefusal,
    "t25: the outside-project refusal survives the strip byte-identical",
  );
  const secretProbe = planRead(join(tmpRoot), ".env");
  const secretRefusal = secretProbe.action === "refuse" ? secretProbe.reason : "";
  assert(
    secretRefusal.includes("a secret file") && stripAdvisorMarkup(secretRefusal) === secretRefusal,
    "t25: the secret-file refusal survives the strip byte-identical",
  );
}

// --- 25c. the toolsEnabled and maxToolRounds fields ride the same clamp/narrowing
//          doors (extends t5/t7/t21c/t22c/t23c).
{
  const clamped = withConfig(JSON.stringify({ maxToolRounds: 0 }), () => loadConfig());
  assert(
    clamped.maxToolRounds === MIN_TOOL_ROUNDS,
    "t25c: a zero maxToolRounds clamps up to the minimum",
  );
  const high = withConfig(JSON.stringify({ maxToolRounds: 999 }), () => loadConfig());
  assert(
    high.maxToolRounds === MAX_TOOL_ROUNDS,
    "t25c: an over-max maxToolRounds clamps down to the maximum",
  );
  const wrong = withConfig(
    JSON.stringify({ toolsEnabled: "yes", maxToolRounds: "three", interval: 5 }),
    () => loadConfig(),
  );
  assert(
    wrong.toolsEnabled === DEFAULT_CONFIG.toolsEnabled &&
      wrong.maxToolRounds === DEFAULT_CONFIG.maxToolRounds &&
      wrong.interval === 5,
    "t25c: wrong-typed tool fields fall back, leaving neighbors intact",
  );
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ maxToolRounds: "three" }), () => loadConfig()),
  );
  assert(silent.length === 0, "t25c: a wrong-typed maxToolRounds never reaches the clamp");
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"maxToolRounds": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.maxToolRounds === MIN_TOOL_ROUNDS && cfg.interval === 1,
        "t25c: an infinite maxToolRounds clamps up next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t25c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.toolsEnabled === false, "t25c: the code default is tools OFF");
  assert(DEFAULT_CONFIG.maxToolRounds === 3, "t25c: the code default is 3 rounds");
}
