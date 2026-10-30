import { readFileSync } from "node:fs";

/**
 * Every tunable field of the advisor gate.
 */
export interface AdvisorGateConfig {
  /** Master switch. False skips the advisor call and the continuation entirely. */
  enabled: boolean;
  /** Fire the gate every N turns. 1 gates every turn. */
  interval: number;
  /** "provider/modelId" of the advisor model. Empty disables the gate. */
  model: string;
  /** In-handler budget for the advisor call, in milliseconds. */
  timeoutMs: number;
  /** System prompt handed to the advisor model. */
  systemPrompt: string;
  /** customType of the committed entry. Deliberately equal to the extension's canonical name, which pi derives from the entry path — one identifier for both the reload filter and the exclude_extensions denylist. */
  customType: string;
  /** Whether the committed entry renders in the TUI transcript. */
  display: boolean;
}

export const DEFAULT_CONFIG: AdvisorGateConfig = {
  enabled: true,
  interval: 2,
  model: "",
  timeoutMs: 60000,
  systemPrompt:
    "You are a senior engineer reviewing another agent's work in progress. " +
    "Read the transcript, find what is going wrong or about to go wrong, and say so " +
    "in a few direct sentences. Name the file and the line when you can. " +
    "Do not restate the task. Do not praise. If the work is on track, say so briefly " +
    "and stop. " +
    "You have no tools and cannot call any. Reply in text only: never write " +
    "tool-call markup, angle-bracket tool syntax, or anything that imitates a " +
    "tool call. Supervise the main agent's thinking in plain prose.",
  customType: "advisor-turn-gate",
  display: true,
};

/** Hard bounds. A value outside these is clamped, never rejected. */
export const MIN_INTERVAL = 1;
export const MAX_INTERVAL = 100;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 60000;

export const CONFIG_URL = new URL("config.json", import.meta.url);

/** Warn at most once per process — the handler calls loadConfig() on every turn. */
let configWarned = false;

function warnOnce(message: string): void {
  if (configWarned) return;
  configWarned = true;
  console.warn(message);
}

/**
 * Re-arm the warn-once latch. Test-only surface: the suite's withConfig() calls this at
 * entry, so every fixture window starts fresh and the config tests carry no ordering
 * constraint. Production never re-arms a warning: one notice per process is the contract.
 */
export function resetWarnOnceForTest(): void {
  configWarned = false;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Clamp a config field and warn once when the value moved.
 *
 * Range clamping (9999 -> 100) and truncation (2.7 -> 2) arrive through the same door,
 * so the wording names both. The shared latch caps a multi-field read at one warning.
 * The warning is load-bearing even when the clamped value equals the default: the
 * default timeoutMs equals MAX_TIMEOUT_MS, so for that field the warning is the only
 * observable difference between "field absent" and "field clamped to the default".
 */
function clampWithWarn(fieldName: string, value: number, min: number, max: number): number {
  const clamped = clampInt(value, min, max);
  if (clamped !== value) {
    warnOnce(
      `[advisor-turn-gate] config.json ${fieldName} ${value} was clamped or truncated to ${clamped} (allowed ${min} to ${max})`,
    );
  }
  return clamped;
}

/**
 * Parse a model key string into its components.
 *
 * Accepts EITHER separator on read:
 *   - "provider/modelId" — canonical form.
 *   - "provider:modelId" — legacy form.
 *
 * Slash is preferred when present, so "provider:foo/bar" splits on "/" and the modelId
 * is "bar". No current model id contains a "/", so the asymmetry has no real-world
 * ambiguity. Returns undefined when neither separator is present.
 *
 * Lives here rather than in advisor.ts because the `model` config field's format is a
 * config concern: loadConfig() validates it, so the offline test can assert the
 * rejection without importing the advisor call.
 */
export function parseModelKey(key: string): { provider: string; modelId: string } | undefined {
  const slashIdx = key.indexOf("/");
  if (slashIdx >= 1) return { provider: key.slice(0, slashIdx), modelId: key.slice(slashIdx + 1) };
  const colonIdx = key.indexOf(":");
  if (colonIdx >= 1) return { provider: key.slice(0, colonIdx), modelId: key.slice(colonIdx + 1) };
  return undefined;
}

/**
 * Whether the gate fires on this turn, given the turn it last fired on (F007).
 *
 * The stateful threshold form: fire on the first COMPLETED turn at or past each
 * boundary. lastFiredTurn starts at -1, so the first fire lands at turn interval - 1
 * (0-based) — the same boundary sequence the deleted modulo form produced (F025:
 * `turnIndex` is 0-based for the just-finished turn, agent-session.js:918 increments
 * it after the dispatch). An errored boundary does not spend its slot because the
 * seam updates lastFiredTurn only after the completed check passes, so the next
 * completed turn at or past the boundary fires — which a modulo form would not do
 * (the slide).
 *
 * It does not latch: lastFiredTurn advances only when the gate fires, so after a quiet
 * stretch the stale threshold produces exactly one fire and cadence re-locks. The
 * STATELESS threshold form `turnIndex >= interval` WOULD latch — once turnIndex
 * reaches the interval it fires on every later turn — which is why the threshold
 * always rides lastFiredTurn.
 *
 * Lives here rather than in index.ts because index.ts's extensionless sibling imports do
 * not resolve under plain node, and this predicate is the one piece of cadence logic the
 * offline suite must assert. t1b pins the interval sets and the fold parity, so a
 * regression cannot pass.
 */
export function shouldFire(turnIndex: number, interval: number, lastFiredTurn: number): boolean {
  if (!Number.isInteger(interval) || interval < 1) return false;
  return turnIndex >= lastFiredTurn + interval;
}

/**
 * Read config.json beside this module.
 *
 * Per-field type narrowing with DEFAULT_CONFIG.<field> as the fallback — never a blind
 * spread, so a wrong-typed field cannot poison the whole config. The catch
 * discriminates ENOENT (a missing file is the normal case and stays silent) from
 * everything else (broken JSON warns once per process).
 *
 * Called on every turn_end dispatch, not once at factory time, so interval and model
 * can be retuned without a reload.
 */
export function loadConfig(): AdvisorGateConfig {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_URL, "utf-8")) as Partial<AdvisorGateConfig>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    const model = typeof parsed.model === "string" ? parsed.model.trim() : DEFAULT_CONFIG.model;
    if (model && !parseModelKey(model)) {
      warnOnce(
        `[advisor-turn-gate] config.json model "${model}" has no provider separator; the gate is disabled`,
      );
    }
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
      interval:
        typeof parsed.interval === "number"
          ? clampWithWarn("interval", parsed.interval, MIN_INTERVAL, MAX_INTERVAL)
          : DEFAULT_CONFIG.interval,
      model: model && parseModelKey(model) ? model : "",
      timeoutMs:
        typeof parsed.timeoutMs === "number"
          ? clampWithWarn("timeoutMs", parsed.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
          : DEFAULT_CONFIG.timeoutMs,
      systemPrompt:
        typeof parsed.systemPrompt === "string" && parsed.systemPrompt.trim()
          ? parsed.systemPrompt
          : DEFAULT_CONFIG.systemPrompt,
      customType:
        typeof parsed.customType === "string" && parsed.customType.trim()
          ? parsed.customType.trim()
          : DEFAULT_CONFIG.customType,
      display: typeof parsed.display === "boolean" ? parsed.display : DEFAULT_CONFIG.display,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason = err instanceof Error ? err.message : String(err);
    if (code !== "ENOENT") {
      warnOnce(`[advisor-turn-gate] ignoring broken config.json (${reason}); using defaults`);
    }
    return { ...DEFAULT_CONFIG };
  }
}
