'use strict';
/**
 * "A scraped `needs_you` appeared, and nobody was told."
 *
 * 🛑 WHY THIS EXISTS INSTEAD OF A NOTIFICATION (#1494). The phone seam has one
 * live trigger and it is an agent choosing to TYPE `kosmos report needs_you`:
 * 23 times in 31,266 self-report entries. The automatic trigger cannot fire,
 * because it hangs off `PermissionRequest` and every supervisor launch path
 * passes `--dangerously-skip-permissions`. A Kosmos agent never asks permission.
 *
 * ⇒ So the board's red state runs almost entirely on the PANE SCRAPE, and the
 * scrape reaches the seam not at all.
 *
 * 🔑 AND THE DECISION ABOUT THAT IS NOT OURS TO MAKE HERE. Pinging a phone on a
 * scraped verdict is a weaker claim than the seam currently makes: a scrape is
 * an inference about what a screen looked like, it has no natural event moment,
 * and duplicate suppression becomes a real problem a discrete report never had.
 *
 * ⇒ THIS LOGS WHAT A PING WOULD HAVE BEEN AND PINGS NOBODY. It needs no
 * endpoint, no receiver and no switch, it cannot wake anybody at 3am, and it
 * produces the ONE number that makes the product question answerable: how often
 * would this fire?
 *
 * ⚠️ TRANSITIONS ONLY, NEVER STATES. `snapshot()` is called from 44 sites in
 * `server.js` and runs on every board poll. A line per read would be a log
 * nobody could use and a disk nobody wanted. This writes only when an agent
 * moves INTO a scraped `needs_you`, which is the same shape a notification
 * would have.
 *
 * ⚠️ AND "SINCE THIS BOARD STARTED", NOT "EVER". The previous state lives in
 * memory, so a restart re-arms every agent and the first read after one can log
 * a transition that is really a continuation. That is honest for a RATE and
 * wrong for a TOTAL, and the log says so in every line via `sinceBoot`.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* Resolved per call, never frozen at require time (#1443): a fixture that
   sandboxes late must get the sandbox, and this module is required by
   `status.js`, which half the suite pulls in transitively. */
const dirFor = () => path.join(store.ROOT, 'wouldping');
const fileFor = () => path.join(dirFor(), 'needs-you.jsonl');

/* The last state we saw per agent, for this process only. */
const last = new Map();
/* 🛑 A TIMESTAMP IS NOT AN IDENTITY, AND MY FIRST VERSION USED ONE. Two boots
   inside the same millisecond produced the SAME `sinceBoot`, which defeats the
   entire purpose of the field: telling lines from different boots apart. A
   flaky test found it, and the flakiness was the defect rather than noise.
   ⇒ Time for a human reading it, random for the machine comparing it. */
const bootId = () => new Date().toISOString() + '-' + crypto.randomBytes(4).toString('hex');
let bootAt = bootId();

/**
 * Record that an agent is in `state` right now.
 *
 * Returns true when this call LOGGED a transition, so a test can assert the
 * decision rather than read the file.
 */
function saw(key, state, opts) {
  const o = opts || {};
  let logged = false;
  try {
    if (!key) return false;
    const was = last.get(key);
    last.set(key, state);
    /* 🛑 ONLY THE SCRAPED ONES. A REPORTED `needs_you` already reaches the seam,
       and logging it here would inflate the very number this exists to measure
       with events that are already covered. */
    if (state !== 'needs_you' || o.reported === true) return false;
    if (was === 'needs_you') return false;
    const line = JSON.stringify({
      at: new Date().toISOString(),
      agent: key,
      from: was === undefined ? null : was,
      confidence: o.confidence || null,
      because: typeof o.because === 'string' ? o.because.slice(0, 200) : null,
      /* ⚠️ SO NOBODY SUMS THESE INTO A TOTAL. Every line carries the boot it
         belongs to; two lines from different boots are not comparable as a
         count of real events. */
      sinceBoot: bootAt,
      wouldHavePinged: true,
    }) + '\n';
    fs.mkdirSync(dirFor(), { recursive: true });
    fs.appendFileSync(fileFor(), line, { mode: 0o600 });
    logged = true;
  } catch { /* a measurement must never break a read of the board */ }
  return logged;
}

/** Every line, newest last. For a person asking "how often would this fire?". */
function read() {
  let raw;
  try { raw = fs.readFileSync(fileFor(), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Test seam: forget what we have seen, as a fresh board would. */
function reset() { last.clear(); bootAt = bootId(); }

module.exports = { saw, read, reset, fileFor, dirFor };
