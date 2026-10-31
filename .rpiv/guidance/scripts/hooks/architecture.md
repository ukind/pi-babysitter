# Hook Scripts (`scripts/hooks/`)

## Responsibility
Process-boundary defense for agent tool calls. `gate.mjs` (PreToolUse, Bash) blocks catastrophic commands by exiting 2. `feedback.mjs` (PostToolUse, Write|Edit) reports syntax errors on stderr and always exits 0.

Registration lives in `.claude/settings.json`. Any harness that speaks the Claude Code hook protocol runs these scripts; the scripts are harness-agnostic and share no code with the TS extension runtime.

## Dependencies
- **Node >= 22.6 builtins only**: zero npm packages. Hooks must run in arbitrary checkouts where `node_modules` lookups fail.
- **Claude Code hook protocol**: stdin JSON in, stderr out, exit code as the verdict. Shapes every file.
- **Biome (lint only)**: `.mjs` files sit outside `tsc`'s `include` — JS forever, no typecheck.

## Consumers
- **The harness**: spawns `node scripts/hooks/gate.mjs` on Bash calls and `node scripts/hooks/feedback.mjs` on Write/Edit calls, per the `.claude/settings.json` matchers.
- **tests/test.mjs**: imports `evaluate`, `syntaxCheck`, and all lib helpers directly — decision cores run without spawning processes.

## Module Structure
```
scripts/hooks/
├── gate.mjs        # PROCESS SHELL + POLICY CORE: rule helpers + evaluate() + the only exit-2 writer
├── feedback.mjs    # PROCESS SHELL + OBSERVER CORE: node --check via process.execPath, always exit 0
└── lib.mjs         # SHARED KERNEL: stdin codec + argv guard + spawn verdict table; imports NOTHING
```

## Dual-Mode Script (importable module + executable)
```javascript
// gate.mjs — shell + core in one file, split by an argv guard.
export function evaluate(command) {          // PURE core: string in, reason | null out
  if (typeof command !== "string" || command.length === 0) return null; // guard, not throw
  if (blocksRecursiveRemove(command)) return "rm -r[f] on a root-like target";
  return null;
}

if (isHookInvocation(process.argv, "gate.mjs")) {  // suffix check, backslash-safe (Windows)
  // ALL process I/O lives below this guard — importing the file runs nothing.
  const payload = parseHookStdin(readFileSync(0, "utf8")); // one JSON object on fd 0
  if (!payload) process.exit(0);                           // fail open
  const verdict = evaluate(readHookField(payload, "command"));
  if (verdict !== null) { process.stderr.write(`Blocked: ${verdict}\n`); process.exit(2); }
  process.exit(0);
}
```

## Hook Protocol Boundary (both sides)
```json
// .claude/settings.json (caller side) — matchers decide which tool calls spawn which hook
{ "hooks": {
    "PreToolUse":  [{ "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node scripts/hooks/gate.mjs" }] }],
    "PostToolUse": [{ "matcher": "Write|Edit",
      "hooks": [{ "type": "command", "command": "node scripts/hooks/feedback.mjs" }] }] } }
```
```
Verdict contract (callee side):
  stdin  : one JSON object { tool_input | toolInput: { command | file_path, ... } }
  stdout : never written
  stderr : exit 2 -> refusal text fed back to the agent; exit 0 -> log-only feedback
  exit 0 : allow / observe and continue        exit 2: BLOCK (gate only — feedback has no exit-2 path)
```

## Fail-Open Error Policy (CRITICAL: malformed input can never block)
```javascript
// lib.mjs — every failure mode collapses to "allow"; the gate must never DoS itself.
export function parseHookStdin(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch { return undefined; }        // caller: if (!payload) process.exit(0)
}
export function readHookField(payload, key) {
  // Dual dialect: snake_case AND camelCase payload spellings.
  return payload?.tool_input?.[key] ?? payload?.toolInput?.[key]; // dual dialect; caller owns type check
}
```

## Shared Kernel (`lib.mjs`)
```javascript
// lib.mjs header contract: plain node only; no project imports, no node_modules lookups.
export function isHookInvocation(argv, scriptName) {
  const entry = argv?.[1] ?? "";
  return entry.replace(/\\/g, "/").endsWith(scriptName);  // Windows-safe suffix check
}
// One literal for the spawnSync budget (F026): the timeout option and the
// message wording both derive from it.
export const SYNTAX_CHECK_BUDGET_MS = 10_000;
export function describeSpawnResult(result) {  // branch order mirrors real spawnSync shapes
  if (result.error) {
    if (result.status === null && result.signal) {
      return { ok: false, detail: `timed out after ${SYNTAX_CHECK_BUDGET_MS / 1000}s (signal ${result.signal})` };
    }
    return { ok: false, detail: result.error.message };
  }
  if (result.status === 0) return { ok: true, detail: "syntax ok" };
  if (result.status === null && result.signal) return { ok: false, detail: `killed by ${result.signal} before exit` };
  const stderr = result.stderr?.toString().trim() ?? "";
  return { ok: false, detail: stderr.length > 0 ? stderr : `exit code ${result.status}` };
}
```

## Architectural Boundaries
- **NO npm imports**: hooks run in arbitrary checkouts; only node builtins and `./lib.mjs`.
- **NO stdout writes**: the protocol is stderr + exit code.
- **NO logic in the exit dispatch**: declared untested on purpose — faking argv/stdin buys less than the dispatch costs.
- **NO process spawning in the gate**: cheap string work only; feedback's single `node --check` spawn is capped at 10s.
- **NO typecheck surface**: `.mjs` is outside `tsc`'s include; Biome lints only.

<important if="you are adding a blocked-command rule to gate.mjs">
## Adding a Blocked-Command Rule
1. Write a pure helper `blocks<X>(command): boolean` — cheap regex pre-filter first, then tokenize.
2. Add one branch in `evaluate()` above `return null`; first match wins, so keep order cost-to-cost.
3. Detect the tool's own force/ danger markers, not just flags (git's `+refspec` carries force with no `--force`).
4. Whitelist dangerous semantics, blacklist nothing broad; keep near-miss allowances (`--force-with-lease`, `rm -rf node_modules`).
5. Add both table rows in tests/test.mjs: a blocked case pinning the exact reason string, and an allowed near-miss.
</important>

<important if="you are adding a new hook script">
## Adding a New Hook Script
1. Create `scripts/hooks/<name>.mjs` with a contract header: protocol, fail-open stance, Node floor.
2. Import helpers from `./lib.mjs` — never add npm dependencies.
3. Export the pure decision core; keep all process I/O below the `isHookInvocation` guard.
4. Register in `.claude/settings.json` under the event, with a tool matcher.
5. Pick the exit policy up front: gate (exit 2 on match) or observer (always exit 0).
6. Extend tests/test.mjs with table tests for the core.
</important>
