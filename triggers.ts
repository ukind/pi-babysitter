/**
 * triggers.ts — multi-signal fire triggers for the advisor gate (FR3).
 *
 * Cadence asks "is it time?". Triggers ask "did something just happen that is
 * worth reviewing now?". A triggered turn fires AHEAD of cadence: it passes the
 * same gate-pass (outcome check, markFired, vetoes), so the latch spends exactly
 * once per fire no matter which arm passed.
 *
 * This module imports nothing, so the offline test resolves no package at all.
 * Signals arrive as plain data; the seam (index.ts) builds them defensively from
 * the event, so a host with missing fields degrades to nulls, never to a throw.
 */

/** One fire-worthy signal, named for pins and eval scoring. */
type TriggerSignal = "error" | "tokens" | "pressure" | "risky-tool";

/** What planTrigger tells planGate to do. */
export type TriggerDecision =
  | { action: "none"; reason: string }
  | { action: "fire"; signal: TriggerSignal; detail?: string };

/** The per-turn signals the seam extracts. Every field tolerates absence. */
export interface TriggerSignals {
  /** Output tokens of the just-finished turn's message usage, or null when absent. */
  turnTokens: number | null;
  /** Context-window percent from ctx.getContextUsage(), or null when absent. */
  contextPercent: number | null;
  /** The boundary outcome: "completed" | "aborted" | "error" ("" when unknown). */
  outcome: string;
  /** toolName of every tool result this turn, in order. */
  toolNames: string[];
}

/** The clamp-guarded thresholds, pre-shaped by the seam from config. */
export interface TriggerThresholds {
  /** Fire when turnTokens >= this. 0 disables the signal. */
  minNewTokens: number;
  /** Fire when contextPercent >= this. 0 disables the signal. */
  contextPercent: number;
  /** Fire when the turn errored. Aborted turns never fire. */
  onError: boolean;
  /** Allowlisted tool names; a match on any tool result fires. Empty disables. */
  riskyTools: string[];
}

/**
 * Parse the config string "git push, rm" into a name list.
 *
 * Split on commas, trim each entry, drop empties. Names compare exactly
 * (case-sensitive, whole string) against toolResult toolName values, so the
 * user writes the tool's literal name.
 */
export function parseRiskyTools(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** True when at least one signal is armed. The seam passes no thunk otherwise. */
export function triggersArmed(thresholds: TriggerThresholds): boolean {
  return (
    thresholds.onError ||
    thresholds.minNewTokens > 0 ||
    thresholds.contextPercent > 0 ||
    thresholds.riskyTools.length > 0
  );
}

/**
 * Evaluate the four signals in a fixed order; the first armed hit fires.
 *
 * The order is load-bearing: trouble outcome first (the strongest look-now
 * signal), then token growth, then context pressure, then risky tools.
 * planGate bypasses the outcome veto only for the "error" signal, so that arm
 * must stay first for an errored turn to ever reach consult.
 */
export function planTrigger(
  signals: TriggerSignals,
  thresholds: TriggerThresholds,
): TriggerDecision {
  if (thresholds.onError && signals.outcome === "error") {
    return { action: "fire", signal: "error", detail: signals.outcome };
  }
  if (
    thresholds.minNewTokens > 0 &&
    signals.turnTokens !== null &&
    signals.turnTokens >= thresholds.minNewTokens
  ) {
    return { action: "fire", signal: "tokens", detail: String(signals.turnTokens) };
  }
  if (
    thresholds.contextPercent > 0 &&
    signals.contextPercent !== null &&
    signals.contextPercent >= thresholds.contextPercent
  ) {
    return { action: "fire", signal: "pressure", detail: String(signals.contextPercent) };
  }
  const risky = signals.toolNames.find((name) => thresholds.riskyTools.includes(name));
  if (risky !== undefined) {
    return { action: "fire", signal: "risky-tool", detail: risky };
  }
  return { action: "none", reason: "no signal" };
}

/**
 * The starved-trigger message (F036): an armed threshold whose host data is
 * null can never fire, so the seam warns once per signal. The bindings are
 * fixed pairs — the config field that armed the threshold, and the signal it
 * starves. Pure: no I/O, no latch, no console — the seam owns those,
 * mirroring the hostChecked precedent (index.ts).
 */
export function starvedTriggerWarn(
  field: "triggerMinNewTokens" | "triggerContextPercent",
  signal: "tokens" | "pressure",
): string {
  return `[advisor-turn-gate] trigger ${field} is armed but this host provides no ${signal} data`;
}
