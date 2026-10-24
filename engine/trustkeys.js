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

/* The top-level member names of a JSON object's text, in order (called only on text JSON.parse accepted). */
function topNames(text) {
  const names = [];
  let i = text.indexOf('{') + 1;
  const ws = () => { while (' \t\n\r'.includes(text[i]) && i < text.length) i += 1; };
  const str = () => { const s = i; i += 1; while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1; i += 1; return JSON.parse(text.slice(s, i)); };
  for (ws(); i < text.length && text[i] !== '}';) {
    names.push(str());
    ws(); i += 1; ws();   // the colon
    for (let depth = 0; i < text.length;) {
      const c = text[i];
      if (c === '"') { str(); continue; }
      if (depth === 0 && (c === ',' || c === '}')) break;
      if (c === '{' || c === '[') depth += 1;
      if (c === '}' || c === ']') depth -= 1;
      i += 1;
    }
    if (text[i] === ',') { i += 1; ws(); }
  }
  return names;
}

// A lone surrogate (only an escape makes one: the bytes were strict UTF-8), as servicekeys.scan refuses it.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;

/* service-keys.json as the tunnel's serde reads StoredKeySet: an object with `document` and `signature` text (any
   other member ignored, even one named twice; `document` or `signature` twice refused), or the two as a list of
   exactly two strings. null otherwise. serde refuses a lone surrogate in either text, so this does too: JSON.parse keeps
   it, and the signature check would then read it as U+FFFD and trust a set the tunnel refuses. */
function readStored(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  let document; let signature;
  if (Array.isArray(v)) {
    if (v.length !== 2) return null;
    [document, signature] = v;
  } else if (v && typeof v === 'object') {
    const names = topNames(text);
    if (names.filter((n) => n === 'document').length > 1 || names.filter((n) => n === 'signature').length > 1) return null;
    ({ document, signature } = v);
  } else return null;
  if (typeof document !== 'string' || typeof signature !== 'string') return null;
  if (LONE_SURROGATE.test(document) || LONE_SURROGATE.test(signature)) return null;
  return { document, signature };
}

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
  // As the tunnel (proxy.rs trusted_keys over trust::roots): one root that does not decode trusts no key at all.
  if (!Array.isArray(recoveryKeys) || !recoveryKeys.every((k) => servicekeys.rawKey(k))) {
    return { keys: [], fault: 'unusable', why: 'a recovery key built into this Kosmos does not decode' };
  }
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
  const stored = readStored(text);
  if (!stored) return unusable('does not parse');
  const v = servicekeys.verifyServiceKeySet({ bytes: stored.document, sig: stored.signature, recoveryKeys, held: null });
  // Fixed text: a check's reason can quote a member name from the document, and this can reach the page.
  if (!v.ok) return unusable('no longer verifies');
  const keys = v.keys.map((k) => pinSpelling(k.pub)).filter(Boolean);
  return { keys, fault: null };
}

module.exports = { trustedKeys, readStored, KEEP, STORE_FILE, FLOOR_FILE, LOCK_FILE };
