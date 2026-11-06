import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Message } from "@earendil-works/pi-ai";

/**
 * memory.ts — per-project advisor memory (FR2).
 *
 * The store lives beside this module in .advisor-memory/, one JSON file per project
 * key. Each fire appends its advice; the cap keeps the newest entries; the next
 * fire's digest is a synthetic system message the seam injects at the recency end
 * of the advisor payload. The directory is gitignored from day one — deleting it
 * is a full reset.
 *
 * The I/O shape is cloned from config.ts: a beside-module URL whose href the test
 * suite swaps per window, ENOENT read as the normal empty state, every other read
 * or write failure warned once per process and degraded, never thrown. The gate's
 * never-throw contract covers this module: a failed memory write costs the next
 * fire its digest, never the current entry.
 *
 * The pi-ai import is TYPE-only, so the offline test resolves no package.
 */

/** One recorded piece of advice, in store order (oldest first, newest last). */
export interface MemoryEntry {
  /** Date.now() at the fire that recorded the entry, injected by the seam. */
  timestamp: number;
  /** The advisor's reply text, trimmed by recordAdvice. */
  text: string;
}

/**
 * The beside-module store directory. A mutable URL object on purpose — the same
 * affordance CONFIG_URL gives withConfig: the suite rewrites href per window and
 * restores it in a finally, with no restart and no production surface.
 */
export const MEMORY_DIR_URL = new URL(".advisor-memory/", import.meta.url);

/** Exact digest header prefix; the tests pin the full assembled text. */
export const DIGEST_HEADER_PREFIX = "Advisor memory from earlier fires";

/** Warn at most once per process — memory I/O runs on every fire while enabled. */
let memoryWarned = false;

function warnOnce(message: string): void {
  if (memoryWarned) return;
  memoryWarned = true;
  console.warn(message);
}

/**
 * Re-arm the warn-once latch. Test-only surface, the F002 affordance: the suite's
 * memory windows start fresh, so the memory tests carry no ordering constraint.
 */
export function resetMemoryWarnOnceForTest(): void {
  memoryWarned = false;
}

/** Slug cap for a store filename, leaving headroom under Windows path limits. */
const KEY_SLUG_MAX = 80;

/**
 * FNV-1a over the raw cwd, as a fixed-width hex suffix.
 *
 * The slug is truncated to keep store paths short beside an already-deep module
 * path; the hash distinguishes two long cwds whose truncated slugs collide.
 */
function hashKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A stable per-project store key for a working directory.
 *
 * Filename-safe slug of the cwd plus a hash of the untruncated cwd, so the same
 * directory always maps to the same file and different directories never share
 * one file's name.
 */
export function projectKeyFor(cwd: string): string {
  const slug = cwd.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, KEY_SLUG_MAX);
  return `${slug}-${hashKey(cwd)}`;
}

function storeUrl(key: string): URL {
  return new URL(`${key}.json`, MEMORY_DIR_URL);
}

/**
 * Keep the newest `cap` entries.
 *
 * A cap of 0 (memory off) or any non-finite cap yields the empty store shape;
 * at or under the cap the input array is returned as-is.
 */
export function capEntries(entries: MemoryEntry[], cap: number): MemoryEntry[] {
  if (!Number.isFinite(cap) || cap <= 0) return [];
  if (entries.length <= cap) return entries;
  return entries.slice(entries.length - cap);
}

/** Structural guard: one parsed element is a well-formed MemoryEntry. */
function isEntry(value: unknown): value is MemoryEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as { timestamp?: unknown; text?: unknown };
  return typeof entry.timestamp === "number" && typeof entry.text === "string";
}

/**
 * Parse one store file: the entries, or the reason a read failed.
 *
 * ENOENT is the normal first-fire state and comes back as ok with no entries.
 * Every other failure — corrupt JSON, a non-array body, a hostile store path —
 * comes back as not-ok with the reason for the caller to report.
 */
function parseStore(
  key: string,
): { ok: true; entries: MemoryEntry[] } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(storeUrl(key), "utf-8")) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, reason: "memory store is not a JSON array" };
    }
    return { ok: true, entries: parsed.filter(isEntry) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: true, entries: [] };
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read one project's entries, newest last.
 *
 * ENOENT is the normal first-fire state and stays silent. Every other read
 * failure warns once and reads as empty, so the next successful write rebuilds
 * a valid file from scratch. Wrong-shaped elements inside an otherwise valid
 * array are dropped silently by the structural guard.
 */
export function readEntries(key: string): MemoryEntry[] {
  const read = parseStore(key);
  if (read.ok) return read.entries;
  warnOnce(
    `[advisor-turn-gate] ignoring unreadable advisor memory (${read.reason}); treating as empty`,
  );
  return [];
}

/**
 * The write path's silent pre-read: a failed read is subsumed by the whole-file
 * write that follows, so only the write's own failure is ever reported.
 */
function readEntriesQuiet(key: string): MemoryEntry[] {
  const read = parseStore(key);
  return read.ok ? read.entries : [];
}

/**
 * Append one fire's advice to a project's store, keeping only the newest cap.
 *
 * Never throws: this is the gate's fail-open contract applied to memory. Blank
 * advice is skipped rather than stored. The pre-read is silent, so a corrupt
 * store is overwritten whole and self-heals without a warning; a failed WRITE
 * warns once, and the entries already on disk stay untouched because the new
 * file is a self-healing whole-file rewrite (one writeFileSync per fire).
 */
export function recordAdvice(key: string, text: string, cap: number, timestamp: number): void {
  const trimmed = text.trim();
  if (!trimmed || !Number.isFinite(cap) || cap <= 0) return;
  try {
    const entries = capEntries([...readEntriesQuiet(key), { timestamp, text: trimmed }], cap);
    mkdirSync(MEMORY_DIR_URL, { recursive: true });
    writeFileSync(storeUrl(key), `${JSON.stringify(entries, null, 2)}\n`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnOnce(`[advisor-turn-gate] advisor memory write failed (${reason}); continuing without it`);
  }
}

/**
 * Build the digest as a synthetic system message, or undefined for an empty store.
 *
 * Entries appear oldest first, so the digest reads chronologically and the newest
 * advice sits closest to the tail of the advisor payload. The timestamp is
 * injected by the seam; the builder stays pure.
 */
export function digestMessage(entries: MemoryEntry[], timestamp: number): Message | undefined {
  if (entries.length === 0) return undefined;
  const lines = entries.map((entry) => `- ${entry.text}`);
  const noun = entries.length === 1 ? "entry" : "entries";
  return {
    role: "system",
    content: `${DIGEST_HEADER_PREFIX} (${entries.length} ${noun}):\n${lines.join("\n")}`,
    timestamp,
  };
}
