'use strict';
/**
 * kosmos#8718: the census of raw in-place writes, as a ratchet.
 *
 * A raw fs.writeFileSync onto a store is the write a crash can leave empty or all zero bytes (#5431). #5434 moved about
 * 80 stores to a flushed temp-then-rename save (store.saveFlushed, securewrite.writeSecret). What was missing is a
 * guard that notices a NEW one, so the class cannot grow back. This counts the raw writeFileSync( calls in server.js and
 * each engine/*.js (tests aside) and compares each file to the number below.
 *
 * A count that went UP: a new raw write. Save it with store.saveFlushed (or securewrite.writeSecret) instead. If it
 * truly must be raw (a pid file, a marker whose bytes do not matter, a temp that is flushed by hand before its rename),
 * raise the number here, in the same change, with a line in the commit saying why.
 * A count that went DOWN: thank you; lower the number to match, so the ratchet holds there.
 *
 * Not every counted write is a hazard: many already write a temp and rename it, or write a file nobody parses. The
 * ratchet does not judge them one by one (141 calls in 79 files on 11-18); it stops the number growing unseen. The
 * start-up check (engine/tornstores.js) covers what a crash does to the ones still here.
 *
 *   node --test engine/rawwrites-8718.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PATTERN = /writeFileSync\(/g;

const BASELINE = {
  "engine/activity.js": 1,
  "engine/agentbrowser.js": 2,
  "engine/agentevents.js": 2,
  "engine/agysignin.js": 1,
  "engine/agystatus.js": 1,
  "engine/agyusage.js": 1,
  "engine/attachments.js": 2,
  "engine/attachtext.js": 1,
  "engine/autobalance-sweep.js": 1,
  "engine/blockedmembers.js": 1,
  "engine/boardauth.js": 2,
  "engine/cert-watch.js": 2,
  "engine/chat.js": 1,
  "engine/codexlimits.js": 1,
  "engine/codexupdate.js": 1,
  "engine/communitysend.js": 1,
  "engine/create.js": 3,
  "engine/dailylog.js": 1,
  "engine/delete-leftover.js": 1,
  "engine/discover.js": 2,
  "engine/disruption.js": 2,
  "engine/feedbacknudge.js": 1,
  "engine/filelock.js": 1,
  "engine/filepreview.js": 2,
  "engine/geminiaccounts.js": 1,
  "engine/githubdevice.js": 1,
  "engine/grokaccounts.js": 1,
  "engine/groklimits.js": 1,
  "engine/instructions.js": 2,
  "engine/invitestep.js": 1,
  "engine/kosmos-report-hook.js": 6,
  "engine/kosmos-statusline.js": 1,
  "engine/linuxboard.js": 3,
  "engine/linuxjob.js": 1,
  "engine/liveness.js": 1,
  "engine/messages.js": 1,
  "engine/musefront.js": 2,
  "engine/needsyouack.js": 1,
  "engine/openaiaccounts.js": 1,
  "engine/orgchartcodex.js": 3,
  "engine/orgenroll.js": 1,
  "engine/orgpolicy.js": 1,
  "engine/personalbackup.js": 4,
  "engine/projects.js": 3,
  "engine/promptrequest.js": 1,
  "engine/qwenaccounts.js": 1,
  "engine/receipt.js": 1,
  "engine/register.js": 1,
  "engine/restoresink.js": 1,
  "engine/restoreworld.js": 5,
  "engine/runners.js": 8,
  "engine/securewrite.js": 7,
  "engine/sendertoken.js": 3,
  "engine/setup-assistant.js": 7,
  "engine/skills.js": 1,
  "engine/stalereport-nudge.js": 1,
  "engine/store.js": 1,
  "engine/summarydue-nudge.js": 1,
  "engine/taskseen.js": 1,
  "engine/undo.js": 2,
  "engine/unsentdrafts.js": 1,
  "engine/update.js": 2,
  "engine/usagecap.js": 1,
  "engine/usagepoll.js": 1,
  "engine/win32agy.js": 1,
  "engine/win32board.js": 4,
  "engine/win32boardwatch.js": 2,
  "engine/win32channel.js": 1,
  "engine/win32connectupdate.js": 1,
  "engine/win32handoff.js": 1,
  "engine/win32job.js": 1,
  "engine/win32keyed.js": 1,
  "engine/win32relocate.js": 1,
  "engine/win32uninstall.js": 1,
  "engine/win32update.js": 3,
  "engine/win32zip.js": 1,
  "engine/worldimport.js": 4,
  "engine/worlds.js": 1,
  "engine/you.js": 1,
};

function census() {
  const files = ["server.js", ...fs.readdirSync(path.join(ROOT, "engine")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => "engine/" + f)];
  const out = {};
  for (const f of files) {
    const n = (fs.readFileSync(path.join(ROOT, f), "utf8").match(PATTERN) || []).length;
    if (n) out[f] = n;
  }
  return out;
}

test("no file gained a raw writeFileSync, and every fall is recorded", () => {
  const now = census();
  const rose = [];
  const fell = [];
  for (const f of new Set([...Object.keys(now), ...Object.keys(BASELINE)])) {
    const was = BASELINE[f] || 0;
    const is = now[f] || 0;
    if (is > was) rose.push(f + ": " + was + " -> " + is);
    else if (is < was) fell.push(f + ": " + was + " -> " + is);
  }
  assert.deepEqual(rose, [], "a new raw in-place write; save it with store.saveFlushed, or raise its number here with the reason");
  assert.deepEqual(fell, [], "fewer raw writes than recorded; lower the number in BASELINE to match");
});

test("control: the census sees a raw write when one is there", () => {
  assert.ok(census()["engine/activity.js"] >= 1, "engine/activity.js writes raw today; a census that cannot see it is blind");
  assert.equal(("x fs.writeFileSync(a, b); fs.writeFileSync(c, d)".match(PATTERN) || []).length, 2);
});
