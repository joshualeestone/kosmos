'use strict';

/**
 * This install's random id, and the under-test guard. This file SENDS nothing itself
 * (#2623); the random id it makes can still leave the Mac via the default-on feedback
 * report, which reads it -- see the installId note below.
 *
 * 🛑 #2623: THE CREATE-AGENT TELEMETRY WAS DELETED. Josh, 2026-09-09, called the
 * two "let the Kosmos team know..." phone-home toggles an invasion of privacy and
 * asked for them gone. So the send is gone: `agentCreated`, the on/off setting
 * (`setOn`), the endpoint, and the outbound `payload` were all removed, together
 * with engine/notify.js and the Settings toggles. This file no longer sends
 * anything anywhere.
 *
 * What stays is the one piece other features need and that never leaves the
 * machine on its own:
 *
 *   installId   a random per-install id, made once and kept in a local file
 *   underTest   whether we are inside node's test runner
 *
 * ⚠️ `installId` IS RANDOM, never derived from anything about the machine. A hash
 * of a hostname or a MAC address would be a fingerprint that identifies the
 * computer across reinstalls and across products. Random means it identifies an
 * INSTALL and nothing else. It is stored locally. It stays on the Mac EXCEPT for
 * the daily product-feedback report, which is DEFAULT-ON (opt-out, #2013/#2957) and
 * sends installId to installkosmos.com until the person opts out:
 *   engine/feedback.js, engine/feedbacksend.js   the SendFeedback path -- DEFAULT-ON / opt-out
 *   engine/store.js                              local pointer de-duplication -- never leaves the Mac
 * So installId leaves the Mac BY DEFAULT via the feedback report; opting out in
 * Settings > Automation stops it. The store use never leaves the Mac. (This block
 * used to call the feedback path "opt-in", which was wrong: it is default-on. #2957.)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');

// #1856: route through the one data-root derivation (store.ROOT = dataRootFor), not the raw
// AGENT_WORKFORCE_DATA switch -- prod-inert when it is unset (byte-identical), and under a
// multi-Kosmos switcher (#1704) it inherits the Kosmos leaf + #1820's isAbsolute guard.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'ping.json');

/**
 * Read the stored install id. Absent, unreadable, or corrupt all read as "none
 * yet" -- installId() then mints one. There is no on/off preference any more.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch { return { installId: null }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { installId: null }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { installId: null };
  return { installId: typeof parsed.installId === 'string' && parsed.installId ? parsed.installId : null };
}

function write(patch) {
  const next = { ...read(), ...patch };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

/**
 * This install's id, made once and kept.
 *
 * ⚠️ RANDOM, never derived from anything about the machine (see the header).
 * If the write fails the id is still returned: one un-remembered install is a
 * small local hiccup, not a reason to fail a caller that only wanted an id.
 */
function installId() {
  const had = read();
  if (had.installId) return had.installId;
  const made = crypto.randomUUID();
  write({ installId: made });
  return made;
}

/**
 * Whether we are inside node's test runner. `NODE_TEST_CONTEXT` is set by node's
 * own test runner in every test process and by nothing else, so it cannot be
 * true for a real install and cannot be false for a test. Kept because
 * engine/updating.js reads it to stay inert under test.
 */
function underTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

module.exports = { FILE, read, installId, underTest };
