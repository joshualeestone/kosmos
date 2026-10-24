'use strict';
/* kosmos#6587 (S-7a slice 2a): is the coordinator key this computer pinned on the signed service key set that
   came with this version of Kosmos?

   The set ships beside this file (service-keys.json and its .sig, under app/engine, so the signed release manifest
   covers both). engine/servicekeys.js checks it against the recovery keys in engine/manifest-verify.js; the pin is
   the tunnel's `coordinator_pubkey` in the state dir. Only a state is passed on, never a key or a reason: the page
   shows a fixed sentence for `mismatch` and nothing for the rest.

   States:
   - `off`: no recovery key is pinned, or no set ships with this version (both true as shipped today).
   - `refused`: a set ships but does not verify. The manifest covers it, so this is a broken build, not news for the
     person; the page says nothing.
   - `none`: no pin yet (before setup).
   - `elsewhere`: this board is set to a coordinator other than Kosmos+'s own (self-hosted, staging, tests). Its pin is
     that coordinator's key, which is never on Kosmos+'s set, so a mismatch would be a false alarm. Weakest premise: the
     setting can change after setup; only the tunnel knows which coordinator a pin came from (slice 3).
   - `unknown`: the pin file is there but cannot be read as text. The tunnel reads it with read_to_string, which
     fails the same way, so it cannot sign in with that pin either: not a mismatch.
   - `listed`: the pinned key is on the set.
   - `mismatch`: a pinned key that is not on the set.

   🛑 This is turned on by COMMITTING engine/service-keys.json (a recovery key in manifest-verify belongs to #6609 and
   may be pinned for that alone). Do not commit a set until S-7a slice 3 (the tunnel trust store) ships: the tunnel
   rewrites the pin only at setup and sign-in, so after a key rotation drops the old key, every computer that has not
   signed in since would read `mismatch` and be told something may be posing as the service. The rotation plan already
   requires slice 3 before any key is promoted. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const servicekeys = require('./servicekeys');
const { RECOVERY_KEYS } = require('./manifest-verify');

const SET_FILE = 'service-keys.json';
const SIG_FILE = 'service-keys.json.sig';
const PIN_FILE = 'coordinator_pubkey';

const readOr = (file) => { try { return fs.readFileSync(file); } catch { return null; } };

/* The shipped set is verified once per distinct content: the page polls, and the set only changes with a new
   version (which restarts the board). */
let cached = { tag: null, result: null };
function verifiedSet(appDir, recoveryKeys) {
  const bytes = readOr(path.join(appDir, SET_FILE));
  const sig = readOr(path.join(appDir, SIG_FILE));
  if (!bytes || !sig) return null;
  const tag = crypto.createHash('sha256').update(bytes).update('\0').update(sig).update('\0')
    .update(JSON.stringify(recoveryKeys)).digest('hex');
  if (cached.tag !== tag) cached = { tag, result: servicekeys.verifyServiceKeySet({ bytes, sig, recoveryKeys }) };
  return cached.result;
}

/** The state, from the tunnel's state dir. `opts.production` is false when the board is set to another coordinator.
 *  `opts.appDir` and `opts.recoveryKeys` are for tests. Never throws. */
function serviceKeyCheck(stateDir, opts = {}) {
  try {
    const appDir = opts.appDir || __dirname;
    const recoveryKeys = opts.recoveryKeys || RECOVERY_KEYS;
    if (!Array.isArray(recoveryKeys) || recoveryKeys.length === 0) return { state: 'off' };
    const set = verifiedSet(appDir, recoveryKeys);
    if (!set || set.off === true) return { state: 'off' };
    if (set.ok !== true) return { state: 'refused' };
    if (opts.production === false) return { state: 'elsewhere' };
    const pin = readOr(path.join(stateDir, PIN_FILE));
    if (!pin) return { state: 'none' };
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(pin); } catch { return { state: 'unknown' }; }
    const listed = servicekeys.pinnedIsListed(text, set);
    if (listed === null) return { state: 'none' };
    return { state: listed ? 'listed' : 'mismatch' };
  } catch {
    return { state: 'unknown' };
  }
}

/** kosmos#6587 (S-7a slice 3): the coordinator keys the connector must hold its registration to, as the comma-separated
 * value of KOSMOS_EXPECT_COORDINATOR_KEYS (the set's own SPKI spelling, which the connector takes as listed), or null
 * for no check: off, no set shipped, a set that does not verify (a broken build, which the staging check refuses),
 * or a board set to another coordinator (its key is never on Kosmos+'s set). Never throws (null). */
function expectedCoordinatorKeys(opts = {}) {
  try {
    const appDir = opts.appDir || __dirname;
    const recoveryKeys = opts.recoveryKeys || RECOVERY_KEYS;
    if (!Array.isArray(recoveryKeys) || recoveryKeys.length === 0) return null;
    if (opts.production === false) return null;
    const set = verifiedSet(appDir, recoveryKeys);
    if (!set || set.ok !== true || !Array.isArray(set.keys) || !set.keys.length) return null;
    return set.keys.map((k) => k.pub).join(',');
  } catch {
    return null;
  }
}

module.exports = { serviceKeyCheck, expectedCoordinatorKeys, SET_FILE, SIG_FILE, PIN_FILE };
