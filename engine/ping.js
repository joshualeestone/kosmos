'use strict';

/**
 * This install's random id, and the under-test guard. This file SENDS nothing itself
 * (#2623); other files send and keep the id it makes: see "Where it goes" below.
 *
 * 🛑 #2623: THE CREATE-AGENT TELEMETRY WAS DELETED. Josh, 2026-09-09, called the
 * two "let the Kosmos team know..." phone-home toggles an invasion of privacy and
 * asked for them gone. So the send is gone: `agentCreated`, the on/off setting
 * (`setOn`), the endpoint, and the outbound `payload` were all removed, together
 * with engine/notify.js and the Settings toggles. This file no longer sends
 * anything anywhere.
 *
 * ⚠️ #3038 (2026-09-14): the create-agent BEACON is BACK, but NOT here -- Josh
 * ruled the #2623 removal was an AGENT's, not his ("always wanted" it). It lives
 * in a new module, engine/createdbeacon.js, which reads `installId()` below to
 * build its payload. So "this file sends nothing" is still true; "no create-agent
 * telemetry exists anywhere" is NOT -- see createdbeacon.js for the restored send.
 *
 * What this file keeps:
 *
 *   installId   a random per-install id, made once and kept in a local file
 *   installedAt when that id was made (kosmos#6829: Token Usage counts days from it; engine/usage.js reads only
 *               this, never the id, and it never leaves the computer)
 *   underTest   whether we are inside node's test runner
 *
 * ⚠️ `installId` IS RANDOM, never derived from anything about the machine. A hash
 * of a hostname or a MAC address would be a fingerprint that identifies the
 * computer across reinstalls and across products. Random means it identifies an
 * INSTALL and nothing else.
 *
 * Where it goes (kosmos#5995; engine/installid-senders-5995.test.js holds this list of files to the source). Each
 * file says for itself when and how; this is only who:
 *   ping.json                 kept here, in this Kosmos's data root
 *   engine/createdbeacon.js   sends it to the install endpoint
 *   engine/feedbacksend.js    sends it with the daily feedback report
 *   engine/feedback.js        writes it into the report file on this computer
 *   engine/store.js           keeps it in each agent's profile as `idInstall`, and hands a profile on without it
 *                             (what it reads out and what a save answers are copies less that key)
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
  const out = { installId: typeof parsed.installId === 'string' && parsed.installId ? parsed.installId : null };
  /* #6829: kept through read() because write() merges over it; dropping it here would erase it on the next write. */
  if (typeof parsed.installedAt === 'string' && Number.isFinite(Date.parse(parsed.installedAt))) out.installedAt = parsed.installedAt;
  return out;
}

function write(patch) {
  const next = { ...read(), ...patch };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    store.saveFlushed(FILE, JSON.stringify(next) + '\n');   // #5434 slice 19: flushed before the rename (a unique temp; the folder after on POSIX)
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
  write({ installId: made, installedAt: new Date().toISOString() });   // #6829: when the id is first minted
  return made;
}

/**
 * #6829: when this install began, as an ISO time, or null when it cannot be told.
 * The time recorded when the id was minted. An install that predates that field
 * takes ping.json's mtime once and records it, so a later copy that does not keep
 * mtimes cannot move it. Never mints an id.
 */
function installedAt() {
  const had = read();
  if (had.installedAt) return had.installedAt;
  if (!had.installId) return null;
  let at;
  try { at = new Date(fs.statSync(FILE).mtimeMs).toISOString(); } catch { return null; }
  write({ installedAt: at });
  return at;
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

module.exports = { FILE, read, installId, installedAt, underTest };
