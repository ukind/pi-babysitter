// tests/suites/memory.mjs — F030 suite: banners 23 and 23c of the former
// monolith — the advice store, the digest, and the memoryCap field.
// (Pre-F037 state: the F037 fixture block inside banner 23 arrives at Phase 10,
// inserted immediately after the blank-skip pin.)

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_CONFIG, loadConfig, MAX_MEMORY_CAP, MIN_MEMORY_CAP } from "../../config.ts";
import {
  capEntries,
  digestMessage,
  MEMORY_DIR_URL,
  projectKeyFor,
  readEntries,
  recordAdvice,
  resetMemoryWarnOnceForTest,
} from "../../memory.ts";
import { ADVISOR_NUDGE, BUDGET_FOLD_MARKER_PREFIX, buildAdvisorMessages } from "../../prompt.ts";
import { assert, captureWarn, shapeJson, tmpRoot, withConfig } from "../helpers.mjs";

// --- 23. FR2 memory: the store round-trip, the cap, the digest, and the window ride.
{
  const realMemoryHref = MEMORY_DIR_URL.href;
  const storeDir = join(tmpRoot, "memory-store");
  resetMemoryWarnOnceForTest();
  rmSync(storeDir, { recursive: true, force: true });
  MEMORY_DIR_URL.href = `${pathToFileURL(storeDir).href}/`;
  try {
    // The key is stable per cwd and distinct per directory.
    const key = projectKeyFor("C:\\repo a");
    assert(key === projectKeyFor("C:\\repo a"), "t23: the same cwd maps to the same store key");
    assert(
      projectKeyFor("C:\\repo a") !== projectKeyFor("C:\\repo  a"),
      "t23: a different cwd maps to a different store key",
    );
    assert(
      /^[A-Za-z0-9._-]+$/.test(projectKeyFor("C:\\repo a/\\*?:")),
      "t23: the key is filename-safe for a hostile cwd",
    );

    // Round-trip: two appends read back in order.
    recordAdvice("proj", "note one", 5, 1);
    recordAdvice("proj", "note two", 5, 2);
    const entries = readEntries("proj");
    assert(entries.length === 2, "t23: two appends store two entries");
    assert(
      entries[0].text === "note one" && entries[1].text === "note two",
      "t23: entries read back oldest first",
    );
    assert(entries[0].timestamp === 1, "t23: the seam's timestamp is stored");

    // The write-time cap keeps the newest.
    recordAdvice("proj", "note three", 2, 3);
    const capped = readEntries("proj");
    assert(
      capped.length === 2 && capped[0].text === "note two" && capped[1].text === "note three",
      "t23: the cap keeps the newest entries",
    );

    // Blank advice is skipped, not stored.
    recordAdvice("proj", "   ", 2, 4);
    assert(readEntries("proj").length === 2, "t23: blank advice is skipped");

    // An unknown key reads as the empty store, silently.
    const silent = captureWarn(() => readEntries("unknown"));
    assert(readEntries("unknown").length === 0, "t23: an unknown key reads as empty");
    assert(silent.length === 0, "t23: the ENOENT read warns nothing");

    // A corrupt store warns once with the pinned reason and reads as empty (the latch).
    rmSync(storeDir, { recursive: true, force: true });
    recordAdvice("proj", "seed", 5, 1);
    writeFileSync(join(storeDir, "proj.json"), "{ not json");
    const corruptWarns = captureWarn(() => {
      assert(readEntries("proj").length === 0, "t23: a corrupt store reads as empty");
      assert(readEntries("proj").length === 0, "t23: the corrupt store still reads as empty");
    });
    assert(
      corruptWarns.length === 1 && corruptWarns[0].includes("ignoring unreadable advisor memory"),
      "t23: a corrupt store warns once with the pinned reason",
    );

    // capEntries: the pure cap arithmetic.
    const seeded = [
      { timestamp: 1, text: "a" },
      { timestamp: 2, text: "b" },
      { timestamp: 3, text: "c" },
    ];
    assert(capEntries(seeded, 0).length === 0, "t23: cap 0 is the empty store");
    assert(capEntries(seeded, -1).length === 0, "t23: a negative cap is the empty store");
    assert(capEntries(seeded, 5) === seeded, "t23: an over-cap cap is the identity");
    assert(capEntries(seeded, 3) === seeded, "t23: an at-cap cap is the identity");
    const two = capEntries(seeded, 2);
    assert(
      two.length === 2 && two[0].text === "b" && two[1].text === "c",
      "t23: an over-cap cap keeps the newest two",
    );

    // A write into a hostile path never throws; the warn carries the pinned reason.
    // The pre-read is silent, so the write's warn is deterministic on every platform.
    resetMemoryWarnOnceForTest();
    writeFileSync(join(tmpRoot, "memory-blocker"), "not a directory");
    const blockedHref = MEMORY_DIR_URL.href;
    MEMORY_DIR_URL.href = `${pathToFileURL(join(tmpRoot, "memory-blocker")).href}/`;
    let threw = false;
    const hostileWarns = captureWarn(() => {
      try {
        recordAdvice("proj", "lost advice", 5, 1);
      } catch {
        threw = true;
      }
    });
    MEMORY_DIR_URL.href = blockedHref;
    assert(!threw, "t23: a hostile store path never throws");
    assert(
      hostileWarns.length === 1 && hostileWarns[0].includes("advisor memory write failed"),
      "t23: a failed write warns once with the pinned reason",
    );

    // The digest builder: exact text, singular and plural, empty -> undefined.
    assert(digestMessage([], 1) === undefined, "t23: an empty store builds no digest");
    const one = digestMessage([{ timestamp: 1, text: "only advice" }], 7);
    assert(
      one.role === "system" &&
        one.content === "Advisor memory from earlier fires (1 entry):\n- only advice" &&
        one.timestamp === 7,
      "t23: the singular digest is exact",
    );
    const twoEntry = digestMessage(
      [
        { timestamp: 1, text: "first advice" },
        { timestamp: 2, text: "second advice" },
      ],
      7,
    );
    assert(
      twoEntry.content ===
        "Advisor memory from earlier fires (2 entries):\n- first advice\n- second advice",
      "t23: the plural digest is exact and reads oldest first",
    );

    // The window ride: base ends on an assistant, so the nudge rides and the digest
    // is inserted in front of it — the nudge stays terminal.
    const base = [
      { role: "user", content: [{ type: "text", text: "work" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 },
    ];
    const digest = digestMessage([{ timestamp: 1, text: "prior fire" }], 5);
    const shaped = buildAdvisorMessages(base, 0, digest);
    assert(shaped.length === 4, "t23: the digest adds exactly one message");
    assert(shaped[2] === digest, "t23: the digest sits after the transcript");
    assert(shaped[2].role === "system", "t23: the digest is a system message");
    assert(shaped[3].content[0].text === ADVISOR_NUDGE, "t23: the nudge stays terminal");

    // The digest never folds and keeps the recency slot, even over a starved budget.
    const starved = buildAdvisorMessages(base, 1, digest);
    assert(
      starved.includes(digest) && starved[starved.length - 2] === digest,
      "t23: the digest survives a starved budget at the recency end",
    );
    assert(
      starved[0].content[0].text.startsWith(BUDGET_FOLD_MARKER_PREFIX),
      "t23: the transcript itself still folds under the budget",
    );

    // A transcript with its own user tail: the digest goes in front of it, the tail
    // stays terminal, and no nudge rides (ensureUserTail is untouched).
    const userTailed = buildAdvisorMessages([base[0]], 0, digest);
    assert(
      userTailed.length === 2 && userTailed[0] === digest && userTailed[1] === base[0],
      "t23: the digest is inserted in front of the transcript's own user tail",
    );

    // An empty transcript degrades to the digest alone; no nudge is invented.
    const empty = buildAdvisorMessages([], 0, digest);
    assert(
      empty.length === 1 && empty[0] === digest,
      "t23: an empty context yields the digest alone",
    );

    // Default-off: no digest is byte-identical to the pre-FR2 two-arg call. The
    // comparison normalizes timestamps: each call stamps its own nudge with an
    // independent Date.now(), so a millisecond boundary between the two calls is
    // legal, not a divergence (the shapeJson helper above).
    const noDigest = buildAdvisorMessages(base);
    const undefinedDigest = buildAdvisorMessages(base, 0, undefined);
    assert(
      noDigest.length === undefinedDigest.length &&
        shapeJson(noDigest) === shapeJson(undefinedDigest),
      "t23: the absent digest is byte-identical to the pre-FR2 shape",
    );
  } finally {
    MEMORY_DIR_URL.href = realMemoryHref;
    rmSync(storeDir, { recursive: true, force: true });
  }
}

// --- 23c. the memoryCap field rides the same clamp/narrowing doors (extends t5/t7/t21c/t22c).
{
  const clamped = withConfig(JSON.stringify({ memoryCap: -3 }), () => loadConfig());
  assert(clamped.memoryCap === MIN_MEMORY_CAP, "t23c: a negative memoryCap clamps to 0 (off)");
  const high = withConfig(JSON.stringify({ memoryCap: 99999 }), () => loadConfig());
  assert(
    high.memoryCap === MAX_MEMORY_CAP,
    "t23c: an over-max memoryCap clamps down to the maximum",
  );
  const wrong = withConfig(JSON.stringify({ memoryCap: "many", interval: 4 }), () => loadConfig());
  assert(
    wrong.memoryCap === DEFAULT_CONFIG.memoryCap && wrong.interval === 4,
    "t23c: a string memoryCap falls back, leaving neighbors intact",
  );
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ memoryCap: "many" }), () => loadConfig()),
  );
  assert(silent.length === 0, "t23c: a wrong-typed memoryCap never reaches the clamp");
  // Raw string, not an object literal: JSON has no Infinity, so an object literal
  // would serialize 1e999 to null and the clamp door would never see it (the t5 idiom).
  const warns = captureWarn(() =>
    withConfig('{"memoryCap": 1e999, "interval": 0}', () => {
      const cfg = loadConfig();
      assert(
        cfg.memoryCap === MIN_MEMORY_CAP && cfg.interval === 1,
        "t23c: an infinite memoryCap clamps to 0 next to the clamped interval",
      );
    }),
  );
  assert(warns.length === 1, "t23c: two clamped fields share the warn-once latch");
  assert(DEFAULT_CONFIG.memoryCap === 0, "t23c: the code default is 0 (memory off)");
}
