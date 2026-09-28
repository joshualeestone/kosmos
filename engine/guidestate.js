'use strict';
/**
 * kosmos#4350: what happened, last time, when this install tried to create its setup
 * guide, so the question "did this person get the guide, and if not, which gate stopped
 * them" can be answered without their machine.
 *
 * Two readers, two shapes:
 *   - the install ping (createdbeacon.js) sends ONLY the state, one word from STATES.
 *     It is a state, not a name, a role or content, so it adds nothing identifying to a
 *     ping Josh already ruled in (09-14, #3038).
 *   - the file keeps the REASON too, the sentence ensureGuide gave, for anyone reading
 *     this install locally (the sweep used to drop it). The reason never leaves the Mac.
 *
 * Kept free of setup-assistant.js's requires so the beacon can read it cheaply.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const STATES = Object.freeze(['seeded', 'not-armed', 'off', 'no-model', 'refused', 'names-taken', 'disabled']);

function file() { return path.join(store.ROOT, 'setup-guide-state.json'); }

/** The last recorded state, or null when none was recorded or the file is unreadable. */
function read() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return j && STATES.includes(j.state) ? j : null;
  } catch { return null; }
}

/** Just the state word for the ping, or null. */
function current() {
  const r = read();
  return r ? r.state : null;
}

/**
 * Record an outcome `{ state, reason }`. A missing or unknown state (a result that says
 * nothing new, like a retry wait) records nothing. Returns `{ changed }`: true only when
 * the STATE differs from the one on disk, which is when the caller should tell the
 * collector. A new reason under the same state is written but is not a change. Never throws.
 */
function record(outcome) {
  const state = outcome && outcome.state;
  if (!STATES.includes(state)) return { changed: false };
  const before = current();
  try {
    fs.writeFileSync(file(), JSON.stringify({
      state,
      reason: String((outcome && outcome.reason) || '').slice(0, 300),
      at: new Date().toISOString(),
    }) + '\n', 'utf8');
  } catch { return { changed: false }; }
  return { changed: before !== state };
}

module.exports = { STATES, read, current, record, file };
