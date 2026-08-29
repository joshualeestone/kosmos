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

/* Whether this process has announced itself in the log yet. */
let announced = false;

/**
 * 🛑 THE LOG SAYS "I RAN" BEFORE IT SAYS ANYTHING ELSE, AND THAT IS THE WHOLE
 * POINT OF THIS FUNCTION.
 *
 * Without it, an empty result has two meanings and no way to tell them apart:
 *
 *     the code is not deployed          -> no directory
 *     the code ran and saw nothing      -> no directory
 *
 * Both look identical, and the first one HAS ALREADY HAPPENED: #1518 merged,
 * the board restarted, and the served checkout did not carry the file. Anybody
 * reading the absent directory as "the scrape never fires" would have been
 * reading a check that never ran.
 *
 * ⇒ A boot line on the FIRST call, whatever the outcome, makes the three states
 * distinguishable WITHOUT ANY CONTEXT:
 *
 *     directory absent                  the code is not there
 *     boot line, no transitions         it ran and saw nothing
 *     transitions                       it ran and saw things
 *
 * ⚠️ It is not a heartbeat. One line per process, ever.
 */
function announce() {
  if (announced) return;
  announced = true;
  fs.mkdirSync(dirFor(), { recursive: true });
  fs.appendFileSync(fileFor(), JSON.stringify({
    at: new Date().toISOString(),
    kind: 'boot',
    sinceBoot: bootAt,
    note: 'this line means the reader RAN. No transition lines after it means it ran and saw none.',
  }) + '\n', { mode: 0o600 });
}

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
    /* ⚠️ BEFORE THE KEY CHECK, DELIBERATELY. A board whose every card lacks a
       name still RAN, and that is exactly the case somebody would otherwise read
       as "not deployed". */
    announce();
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

/** Every line, newest last. Boot lines included: they are how a reader knows
 *  the difference between "saw nothing" and "never ran". */
function read() {
  let raw;
  try { raw = fs.readFileSync(fileFor(), 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Test seam: forget what we have seen, as a fresh board would. */
function reset() { last.clear(); bootAt = bootId(); announced = false; }

module.exports = { saw, read, reset, fileFor, dirFor };
