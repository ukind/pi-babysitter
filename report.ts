/**
 * report.ts — failure reporting for the advisor gate.
 *
 * `emitError` (runner.js:497-501) only notifies registered listeners, and
 * `noOpUIContext.notify` (runner.js:132-140) is a no-op. In `pi --print` and in every
 * child session `ctx.hasUI` is false, so a notify there is swallowed. The gate therefore
 * reports only when there is a UI, and never treats a reporting failure as a gate
 * failure.
 *
 * `ctx.hasUI` is a boolean getter on the extension context (runner.js:626-629 calls the
 * Runner's `hasUI()` method; extensions/types.d.ts:219 and :547 declare it `boolean`),
 * so this module takes a plain boolean rather than a function.
 *
 * This module imports nothing, so the offline test resolves no package at all.
 */

/** The slice of the extension context this module needs. Exported so callers can name it. */
export interface ReportContext {
  hasUI: boolean;
  ui: { notify(message: string, level: "info" | "warning" | "error"): void };
}

/**
 * Report a skipped advisor cycle, when there is anyone to tell.
 *
 * A closing or stale UI is advisory: it must never turn a skipped cycle into a thrown
 * handler, because a throw inside the handler is swallowed by `runner.js:780-787` and
 * would silently drop the gate's own diagnostics.
 */
export function reportFailure(ctx: ReportContext, message: string): void {
  if (!ctx.hasUI) return;
  try {
    ctx.ui.notify(message, "warning");
  } catch {
    // Advisory only. See the module comment.
  }
}
