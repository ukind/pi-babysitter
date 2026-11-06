// tests/suites/dialogue.mjs — F030 suite: banners 24, 27, and 27c of the
// former monolith — the details stamp, the settle core, and asyncMode.

import { DEFAULT_CONFIG, loadConfig } from "../../config.ts";
import { buildCorrection, planCommit, planSettle, stampDetails } from "../../plan-turn.ts";
import { assert, captureWarn, withConfig } from "../helpers.mjs";

// --- 24. FR1 dialogue: the stamp core, the commit passthrough, and the key-less default.
{
  // stampDetails: the stable keys, exact and ordered.
  const stamp = stampDetails(3, 11);
  assert(
    stamp.fire === "3" && stamp.turn === "11",
    "t24: the stamp is the exact { fire, turn } string pair",
  );
  assert(
    JSON.stringify(Object.keys(stamp)) === JSON.stringify(["fire", "turn"]),
    "t24: the keys are stable and fire comes first",
  );
  assert(
    stampDetails(1, 0).fire === "1" && stampDetails(1, 0).turn === "0",
    "t24: the first fire stamps ordinal 1 on turn 0",
  );
}
{
  // buildCorrection: the stamp rides the draft; an absent stamp leaves NO key.
  const stamped = buildCorrection("advisor-turn-gate", "text", true, [], stampDetails(2, 7));
  const draft = stamped.entries[0];
  assert(draft.type === "custom_message", "t24: the stamped draft is a custom_message");
  assert(
    draft.details !== undefined && draft.details.fire === "2" && draft.details.turn === "7",
    "t24: the stamp rides the committed draft",
  );
  const unstamped = buildCorrection("advisor-turn-gate", "text", true, []);
  assert(
    unstamped.entries.length === 1 && !("details" in unstamped.entries[0]),
    "t24: an absent stamp leaves the draft key-less (the pre-FR1 byte shape)",
  );
  const peers = [{ type: "custom", customType: "peer-a" }];
  const withPeers = buildCorrection("ct", "t", true, peers, stampDetails(1, 1));
  assert(
    withPeers.entries.length === 2 &&
      withPeers.entries[0].customType === "peer-a" &&
      withPeers.entries[1].details?.fire === "1",
    "t24: stamping keeps the peer spread and the draft rides last",
  );
  assert(withPeers.continue === true, "t24: continue survives stamping");
}
{
  // planCommit: the passthrough reaches the committed draft; the notify arms stay
  // unchanged in format and carry no details anywhere.
  const committed = planCommit({
    outcome: { ok: true, text: "guidance" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(4, 12),
  });
  assert(
    committed.action === "commit" && committed.result.entries[0].details?.fire === "4",
    "t24: planCommit stamps the commit",
  );
  const failed = planCommit({
    outcome: { ok: false, reason: "advisor stopped with error" },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(4, 12),
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t24: a failure notifies in the exact format, stamp or no stamp",
  );
}

// --- 27. FR8 async fire: the settle core — abstain, the two notify arms, the
//         once-only commit shape, and the never-wake pin.
{
  // Abstain first: an empty slot decides nothing.
  const quiet = planSettle({
    held: undefined,
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(1, 0),
  });
  assert(quiet.action === "abstain", "t27: an empty slot abstains");
  // Commit: peers spread first, the draft rides last, the stamp carries the
  // FIRE-TIME turn index, and the result carries NO continue key — the settle
  // path never wakes an idle agent (FR8).
  const peers = [{ type: "custom", customType: "peer-a" }];
  const settle = planSettle({
    held: { outcome: { ok: true, text: "async advice" }, turnIndex: 7 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: peers,
    strip: (text) => text,
    details: stampDetails(2, 7),
  });
  assert(settle.action === "commit", "t27: held advice commits");
  assert(
    settle.result.entries.length === 2 && settle.result.entries[0].customType === "peer-a",
    "t27: the settle commit keeps the settle event's peer spread",
  );
  const draft = settle.result.entries[1];
  assert(
    draft.type === "custom_message" &&
      draft.content === "async advice" &&
      draft.details?.fire === "2" &&
      draft.details?.turn === "7",
    "t27: the draft rides the stamp with the fire-time turn index",
  );
  assert(
    !("continue" in settle.result),
    "t27: the settle result carries NO continue key (never wakes an idle agent)",
  );
  const blocking = buildCorrection(
    "advisor-turn-gate",
    "async advice",
    true,
    peers,
    stampDetails(2, 7),
  );
  assert(
    JSON.stringify(draft) === JSON.stringify(blocking.entries[1]),
    "t27: the settle draft is byte-equal to the blocking draft",
  );
}
{
  // The strip thunk runs on the held text before the commit.
  const marked = planSettle({
    held: { outcome: { ok: true, text: "advice" }, turnIndex: 1 },
    customType: "ct",
    display: true,
    peerEntries: [],
    strip: (text) => `<${text}>`,
    details: stampDetails(1, 1),
  });
  assert(
    marked.action === "commit" && marked.result.entries[0].content === "<advice>",
    "t27: the strip runs on the held text",
  );
}
{
  // The failure arm notifies in the exact reportFailure format.
  const failed = planSettle({
    held: { outcome: { ok: false, reason: "advisor stopped with error" }, turnIndex: 3 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: (text) => text,
    details: stampDetails(1, 3),
  });
  assert(
    failed.action === "notify" &&
      failed.message === "advisor-turn-gate: advisor stopped with error",
    "t27: a failed held call notifies in the exact format",
  );
  // The husk arm: markup-only advice fails open exactly like the blocking path
  // (the real strip's husk behavior is pinned at t15b/t9; a thunk isolates this arm).
  const husk = planSettle({
    held: { outcome: { ok: true, text: "markup husk" }, turnIndex: 4 },
    customType: "advisor-turn-gate",
    display: true,
    peerEntries: [],
    strip: () => "",
    details: stampDetails(1, 4),
  });
  assert(
    husk.action === "notify" && husk.message === "advisor-turn-gate: advisor reply was markup only",
    "t27: a markup-only held reply notifies the husk message",
  );
}

// --- 27c. the asyncMode field rides the same narrowing doors (extends
//          t5/t7/t21c/t22c/t23c/t25c/t26c).
{
  const wrong = withConfig(JSON.stringify({ asyncMode: "yes", interval: 7 }), () => loadConfig());
  assert(
    wrong.asyncMode === false && wrong.interval === 7,
    "t27c: a wrong-typed asyncMode falls back, leaving neighbors intact",
  );
  const on = withConfig(JSON.stringify({ asyncMode: true }), () => loadConfig());
  assert(on.asyncMode === true, "t27c: asyncMode true survives");
  const silent = captureWarn(() =>
    withConfig(JSON.stringify({ asyncMode: 1 }), () => loadConfig()),
  );
  assert(silent.length === 0, "t27c: a wrong-typed asyncMode never warns");
  assert(DEFAULT_CONFIG.asyncMode === false, "t27c: the code default is blocking (async off)");
}
