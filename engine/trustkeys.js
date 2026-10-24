'use strict';
/* kosmos#6596 step 8: the coordinator keys this computer trusts, read the way the tunnel reads them
   (kosmos-relay crates/tunnel/src/trust.rs trusted_keys), so the board checks what Kosmos+ sends against the same
   keys the connector does. Without it, the first service key rotation leaves the connector working and the board
   refusing every company policy.

   The tunnel keeps the service key set it took in service-keys.json in its state folder, as {document, signature},
   the document's exact text and the recovery key's signature over it. This file only READS it: the tunnel takes a
   set, forgets it at a new registration and keeps the floor (service-keys.floor) that stops a forgotten set coming
   back. The board must never remove those files (KEEP below), or a forgotten set could be replayed.

   🛑 Off while engine/manifest-verify.js RECOVERY_KEYS is empty (as shipped): the pin alone, exactly as before. It is
   turned on together with the tunnel's SERVICE_KEY_ROOTS, the same value in both, in one paired change: with only
   one side on, the board and the connector trust different keys. */
const fs = require('node:fs');
const path = require('node:path');
const servicekeys = require('./servicekeys');
const { RECOVERY_KEYS } = require('./manifest-verify');

const STORE_FILE = 'service-keys.json';
const FLOOR_FILE = 'service-keys.floor';
const LOCK_FILE = 'service-keys.lock';
/** The tunnel's trust files, which the board's wipes of the state folder leave alone. */
const KEEP = Object.freeze([STORE_FILE, FLOOR_FILE, LOCK_FILE]);

/* A set's key (SPKI base64, as a set lists it) in the pin's spelling (base64url of the raw 32 bytes), which kst1
   reads. servicekeys.verifyServiceKeySet already refused any key that is not one. */
const pinSpelling = (spki) => {
  const raw = servicekeys.rawKey(spki);
  return raw ? raw.toString('base64url') : null;
};

/**
 * The keys a token from the coordinator may be signed by: { keys: [<pin spelling>, ...], fault: null } or, when the
 * store is there and cannot be used, { keys: [], fault: 'unreadable' | 'unusable', why }. `pinned` is the pin's text
 * (coordinator_pubkey) or null. `opts.recoveryKeys` is for tests. Never throws.
 */
function trustedKeys(stateDir, pinned, opts = {}) {
  const recoveryKeys = opts && opts.recoveryKeys !== undefined ? opts.recoveryKeys : RECOVERY_KEYS;
  const pin = pinned == null ? [] : [String(pinned)];
  // Off: as the tunnel with no root, nothing is read.
  if (Array.isArray(recoveryKeys) && recoveryKeys.length === 0) return { keys: pin, fault: null };
  const file = path.join(stateDir, STORE_FILE);
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { keys: pin, fault: null };
    return { keys: [], fault: 'unreadable', why: 'the service key set this computer holds cannot be read' };
  }
  // The reason names the file by what it is, never by its path: it can reach the page.
  const unusable = (why) => ({ keys: [], fault: 'unusable', why: 'the service key set this computer holds ' + why });
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return unusable('is not text'); }
  let stored;
  try { stored = JSON.parse(text); } catch { return unusable('does not parse'); }
  // serde reads it as a struct: two members of one name, or a field that is not text, is refused there too.
  try { servicekeys.scan(text); } catch (e) { return unusable(e.message); }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || typeof stored.document !== 'string' || typeof stored.signature !== 'string') {
    return unusable('does not parse');
  }
  const v = servicekeys.verifyServiceKeySet({ bytes: stored.document, sig: stored.signature, recoveryKeys, held: null });
  if (!v.ok) return unusable('no longer verifies: ' + v.why);
  const keys = v.keys.map((k) => pinSpelling(k.pub)).filter(Boolean);
  return { keys, fault: null };
}

module.exports = { trustedKeys, KEEP, STORE_FILE, FLOOR_FILE, LOCK_FILE };
