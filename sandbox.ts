import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * sandbox.ts — the advisor's read_file-only tool sandbox (FR4).
 *
 * The host exposes no extension file-read API from turn_end (research, verified):
 * ExtensionToolContext.executeTool exists only inside a tool's execute(), so this
 * module self-executes the one allowlisted read through node:fs and hands the
 * result back as plain data for the tool loop in advisor.ts to replay as a
 * ToolResultMessage entry.
 *
 * Two layers:
 *   - planRead is the PURE path bound: resolve against the root, refuse escapes.
 *     No fs, so the offline suite pins it with zero I/O.
 *   - createSandbox is the I/O closure behind a structural FsLike seam: the
 *     allowlist gate, the realpath escape re-check (symlinks), the byte cap, and
 *     the read itself. The seam defaults to node:fs; the suite injects stubs, so
 *     every failure shape is deterministic on every platform. It NEVER throws —
 *     every failure comes back as { ok: false, reason } for the loop to feed the
 *     advisor as an errored tool result, the same fail-open shape as everywhere
 *     else in the gate.
 *
 * The refusal strings are contract (pinned by t25) and carry no angle-bracket
 * markup vocabulary, so they cannot interact with stripAdvisorMarkup's tiers:
 * the strip stays the last filter on the COMMITTED text, and nothing this module
 * produces reaches the commit without passing through it.
 *
 * This module imports no sibling, so the offline test resolves nothing beyond
 * node builtins.
 */

/** The only tool name this sandbox executes. Everything else is refused. */
export const READ_FILE_TOOL_NAME = "read_file";

/**
 * Hard byte cap on one sandboxed read. A module constant, not a config field:
 * the decomposition scopes Slice 5 to toolsEnabled + maxToolRounds, and a cap
 * that only ever protects the payload size does not need per-project tuning.
 * 64 KiB is ample for a source file and small enough that it cannot flood the
 * advisor payload.
 */
export const SANDBOX_MAX_BYTES = 65536;

/**
 * The secret denylist (F031): final path segments whose reads must never
 * return content. Strict by decision — an example env file can carry real
 * values, so the example spelling refuses too. The check runs at two sites: the
 * requested path in planRead (before any fs work) and the realpath in
 * createSandbox (an innocent link name can resolve to a secret target).
 */
const SECRET_SEGMENT = /(^|\/)(\.env[^/]*|\.npmrc|\.git|id_rsa[^/]*|[^/]*\.pem)$/i;

/** One sandbox execution: the text to feed the advisor, or why it refused. */
export type SandboxResult = { ok: true; text: string } | { ok: false; reason: string };

/** The seam-facing executor shape; advisor.ts calls this once per ToolCall block. */
export type AdvisorSandbox = (name: string, args: unknown) => SandboxResult;

/**
 * The pinned refusal for any tool name other than read_file.
 *
 * One function so the string has exactly one source: the loop's tests pin it
 * through this export, so a wording change fails the suite instead of drifting.
 */
export function sandboxRefusalFor(name: string): string {
  return `advisor sandbox refused "${name}": only read_file is allowed`;
}

/** What planRead decided about one requested path. */
export type ReadDecision =
  | { action: "allow"; absolute: string }
  | { action: "refuse"; reason: string };

/**
 * The pure path bound: resolve the request against the root, refuse escapes.
 *
 * No fs here — the prefix check runs on the RESOLVED path only. The symlink
 * case (a path that resolves inside but points outside) is the I/O closure's
 * job: createSandbox re-checks the prefix against the injected realpath's
 * answer.
 */
export function planRead(root: string, requested: unknown): ReadDecision {
  if (typeof requested !== "string" || requested.trim() === "") {
    return {
      action: "refuse",
      reason: 'advisor sandbox refused the read: "path" must be a non-empty string',
    };
  }
  // F031 site 1: a secret-named path refuses before any resolution or fs work,
  // even when the same path would also escape — the denylist outranks the
  // prefix check.
  if (SECRET_SEGMENT.test(requested.replace(/\\/g, "/"))) {
    return {
      action: "refuse",
      reason: `advisor sandbox refused "${requested}": a secret file`,
    };
  }
  const normalizedRoot = resolve(root);
  const absolute = resolve(normalizedRoot, requested);
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  if (absolute !== normalizedRoot && !absolute.startsWith(rootWithSep)) {
    return {
      action: "refuse",
      reason: `advisor sandbox refused "${requested}": outside the project directory`,
    };
  }
  return { action: "allow", absolute };
}

/**
 * The structural fs seam (the ModelRegistryLike pattern, applied to node:fs).
 *
 * The default wires node's own functions; the suite injects stubs so the
 * symlink-escape and read-error shapes are pinned without platform-dependent
 * fixtures. Narrow on purpose: the sandbox reads buffers and realpaths strings,
 * nothing else.
 */
export interface FsLike {
  readFileSync(path: string): Buffer;
  realpathSync(path: string): string;
}

const defaultFs: FsLike = { readFileSync, realpathSync };

/** Structural shape of a declared tool (pi-ai Tool, duck-typed; no sibling import). */
interface DeclaredTool {
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * The declared tool surface handed to completeSimple when toolsEnabled is on.
 *
 * The parameters value is a plain JSON-Schema object: the real pi-ai Tool type
 * narrows it to typebox, but every consumer on this path is structural, and a
 * plain object keeps typebox out of the offline test's module graph entirely.
 */
export const READ_FILE_TOOL: DeclaredTool = {
  name: READ_FILE_TOOL_NAME,
  description:
    "Read one file from the project directory. Returns the file text up to a hard byte " +
    "cap. Paths must stay inside the project directory.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project-relative path, or an absolute path inside the project directory.",
      },
    },
    required: ["path"],
  },
};

/**
 * Build the sandbox executor for one project root.
 *
 * maxBytes defaults to SANDBOX_MAX_BYTES and fs to node's own functions; the
 * suite passes a small explicit cap and stub fs objects to pin the size,
 * escape, and read-error refusals deterministically.
 */
export function createSandbox(
  root: string,
  maxBytes: number = SANDBOX_MAX_BYTES,
  fs: FsLike = defaultFs,
): AdvisorSandbox {
  return (name, args) => {
    // The allowlist gate comes first: one verb, everything else refused by name.
    if (name !== READ_FILE_TOOL_NAME) {
      return { ok: false, reason: sandboxRefusalFor(name) };
    }
    const path = (args as { path?: unknown } | null | undefined)?.path;
    const plan = planRead(root, path);
    if (plan.action === "refuse") return { ok: false, reason: plan.reason };
    const requested = path as string;
    try {
      // Symlink escape re-check: the REAL path must still live under the root.
      // A missing file throws ENOENT here, which the catch reports as the
      // ordinary no-such-file outcome.
      const real = fs.realpathSync(plan.absolute);
      // F031 site 2: the realpath side re-checks the denylist. The link name can
      // be innocent; this check runs before the prefix re-check so the refusal
      // names the stronger violation when both would fire.
      if (SECRET_SEGMENT.test(real.replace(/\\/g, "/"))) {
        return {
          ok: false,
          reason: `advisor sandbox refused "${requested}": a secret file`,
        };
      }
      const normalizedRoot = resolve(root);
      const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
      if (real !== normalizedRoot && !real.startsWith(rootWithSep)) {
        return {
          ok: false,
          reason: `advisor sandbox refused "${requested}": outside the project directory`,
        };
      }
      // Read the whole file and cap on the BUFFER LENGTH, not a stat: one
      // syscall fewer and no size race between stat and read.
      const bytes = fs.readFileSync(real);
      if (bytes.length > maxBytes) {
        return {
          ok: false,
          reason: `advisor sandbox refused "${requested}": ${bytes.length} bytes exceeds the ${maxBytes} byte cap`,
        };
      }
      return { ok: true, text: bytes.toString("utf-8") };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ok: false, reason: `advisor sandbox refused "${requested}": no such file` };
      }
      if (code === "EISDIR") {
        return { ok: false, reason: `advisor sandbox refused "${requested}": not a file` };
      }
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `advisor sandbox refused "${requested}": ${reason}` };
    }
  };
}
