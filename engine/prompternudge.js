'use strict';
/**
 * #3508: the Prompter's IN-APP nudge store -- the delivery half #2623 removed,
 * rebuilt LOCAL.
 *
 * 🛑 WHAT #2623 REMOVED, AND WHY THIS IS NOT THAT. The heartbeat's `check_in`
 * nudge used to ride engine/notify.js, a PHONE-HOME POST, deleted as telemetry
 * (Josh, 2026-09-09, "invasion of privacy"). #2631's own commit message said "A
 * future in-app delivery channel is a separate build." This is that build, and it
 * is a LOCAL 0600 file with NO endpoint and NO switch: nothing leaves the Mac, so
 * it is not the telemetry Josh ruled out and needs no opt-out. The web UI reads
 * this file through an API on the same machine and renders the question.
 *
 * 🔑 THE STORE IS THE CURRENT PENDING SET, REPLACED EACH TICK. engine/heartbeat.js
 * `step()` already computes `toAsk` -- the agents in an open stall worth a
 * check-in -- fresh every tick from the board's classified states. This holds the
 * latest such list. When a stall resolves, the next tick's toAsk drops that agent
 * and `write` replaces the set, so the nudge clears on its own; there is no
 * separate "dismiss" bookkeeping to drift. The runner calls `write` every tick
 * (best-effort); the API calls `read`.
 *
 * 🔑 WHO + WHEN, NEVER THE WORDS. Each entry carries only `session`, `from` (the
 * state it was in) and `to` (the stall state now). The app composes the question
 * ("mid-something, finished, or stopped?") from those; this store never holds a
 * sentence, matching the removed payload's own rule and the heartbeat header.
 *
 * Never throws: a write or read failure degrades to "no nudges", because a missed
 * nudge is a missed nudge (the board's own status surfaces still show the truth)
 * and must never take down the tick or the poll.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

// #1848/#1856: route through the ONE data-root derivation (store.ROOT = dataRootFor),
// NOT the raw AGENT_WORKFORCE_DATA switch. store.ROOT already reads that env var and
// appends the `Kosmos` app leaf (#2439), so the raw switch skipped the leaf and wrote
// this file to `$DATA/prompter-nudges.json` -- a stray sibling of a named world's
// `Kosmos/` dir, outside where the rest of that world's state lives and surviving a
// reset that only clears `$DATA/Kosmos/`. Mirrors engine/commitments.js.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'prompter-nudges.json');

/** Replace the pending nudge set with this tick's `toAsk`. Accepts the heartbeat
 *  `toAsk` shape ([{ session, from, to }]); anything malformed is coerced or
 *  dropped rather than trusted. Returns { ok }. */
function write(toAsk) {
  const list = Array.isArray(toAsk) ? toAsk : [];
  const nudges = [];
  for (const n of list) {
    const session = n && typeof n.session === 'string' ? n.session.slice(0, 120) : '';
    if (!session) continue; // a nudge with no agent cannot be rendered or acted on
    nudges.push({
      session,
      from: n.from != null ? String(n.from).slice(0, 40) : null,
      to: n.to != null ? String(n.to).slice(0, 40) : null,
    });
  }
  const payload = { v: 1, at: new Date().toISOString(), nudges };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** The current pending nudges, or an empty set on any read/parse failure. */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch { return { at: null, nudges: [] }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { at: null, nudges: [] }; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nudges)) {
    return { at: null, nudges: [] };
  }
  // Re-shape defensively: a hand-edited or older file must not hand the API a
  // sentence or an object it did not expect.
  const nudges = [];
  for (const n of parsed.nudges) {
    // Apply the SAME length caps write() applies (session 120, from/to 40), so a
    // hand-edited or older file cannot hand the API uncapped fields -- the store's
    // shape is single-sourced across both ends rather than trusting the file.
    const session = n && typeof n.session === 'string' ? n.session.slice(0, 120) : '';
    if (!session) continue;
    nudges.push({
      session,
      from: n.from != null ? String(n.from).slice(0, 40) : null,
      to: n.to != null ? String(n.to).slice(0, 40) : null,
    });
  }
  return { at: parsed.at || null, nudges };
}

/** Whether the runner should REPLACE the store this tick. heartbeat.step() returns
 *  toAsk:[] BOTH when nothing is stalled AND when the roster read FAILED
 *  (`roster === null` while the Prompter is on -- a transient tmux read failure it
 *  deliberately treats as "skip this tick, keep the prev memory", NOT "the fleet
 *  emptied"). Writing [] on that failure would wipe an already-open check-in from
 *  the panel for a full interval, the exact "fail toward silence" that
 *  engine/heartbeat.js forbids. So skip only the on-but-unreadable case: write when
 *  the Prompter is OFF (roster null by choice; [] correctly clears the store) or
 *  when the roster read SUCCEEDED (an array -- even empty, "no agents", correctly
 *  clears it). `roster === null` while ON is the one skip. */
function shouldWrite(settingOn, roster) {
  return !settingOn || roster !== null;
}

module.exports = { write, read, shouldWrite, FILE };
