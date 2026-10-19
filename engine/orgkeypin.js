'use strict';

/**
 * kosmos#5686 (b1-mac): whether this computer may wrap its member backup key to the company key Kosmos+ just named.
 *
 * Kosmos+ (the coordinator) names the company's backup PUBLIC key; a breached coordinator could name one whose private
 * half it holds, and every member key wrapped to it would be open to it. escrowd, which holds the escrow key and not
 * the coordinator, signs the key it made (kosmos-relay docs/coordinator-api.md, the backup-key answer's `signature`),
 * and this computer checks that signature against a verification key SHIPPED with the app (VERIFYING_KEY below),
 * never one fetched from Kosmos+.
 *
 * Rules, once a verification key ships:
 *   - a missing or bad signature is a refusal (a breached coordinator could simply leave it out);
 *   - the FIRST verified (org, public key) is pinned in this computer's store, and only for the company the person
 *     joined (an expectation written at their Join; for a Mac that joined before this code, the enrollment record's
 *     org, a weaker anchor the coordinator can rewrite); any later answer naming another org or key is refused, signed
 *     or not (escrowd signs only the key it recorded for that org and epoch, but the
 *     pin also stops a coordinator naming a different org with a key of its own);
 *   - only a final end of this computer's enrollment (orgenroll.js retireWorldId: a confirmed Leave, or a removal; not
 *     a Leave the company refused) or a person's Join to ANOTHER company (or a person's move of the enrollment here) clears the pin, so the next pin is taken after
 *     a person's act. The pin is for the current org epoch (1 today); an
 *     org-key rotation, when it exists, must move it deliberately.
 * WHAT THIS PROVES, AND WHAT IT DOES NOT (review 3). escrowd makes every org key and keeps its private half sealed under
 * the escrow key, so a key that carries escrowd's signature is one the coordinator cannot open: wrapping a member key
 * to it gives a breached coordinator nothing. escrowd makes a key for any org id the coordinator asks for, though, so
 * WHICH company a computer belongs to is the coordinator's word at first contact: the company a person's code resolves
 * to at their Join, and for a computer that joined before this code, its enrollment record (which the hourly refresh
 * rewrites from Kosmos+) at its first pin. A coordinator breached before that moment could file this computer's key
 * under an org it controls; that org's recovery role could reach it only through escrow's release, which escrowd
 * refuses today. The pin's job is the rest: once taken, no later answer moves this computer to another org or key.
 *
 * Until a verification key ships (VERIFYING_KEY null), check() answers ok and pins nothing; a person's Join still
 * writes "expect <org>" (joined()), so a Join made while dormant is anchored once a key ships. Nothing else changes.
 *
 * check() and clear() never throw; joined() throws on a failed write and its callers (orgenroll.js) catch it. The pin file is 0600 under <root>/backupkeys (the member key's own folder).
 */

const fs = require('node:fs');
const path = require('node:path');
const orgkeysig = require('./orgkeysig');

// escrowd's org-key verification key (32 raw bytes, hex), from `kosmos-escrowd` on the production escrow box. null
// until it ships: nothing is checked or pinned.
const VERIFYING_KEY = null;
// Not .json: the member key files there are <hash>.json, and nothing should mistake the pin for one.
const PIN_FILE = 'orgkey.pin';

function pinPath(root) { return path.join(root, 'backupkeys', PIN_FILE); }

// Canonical base64url only (as backupmemberkey.js): Node's decoder skips characters it does not know.
function unb64(s) {
  if (typeof s !== 'string') return null;
  const b = Buffer.from(s, 'base64url');
  return b.toString('base64url') === s ? b : null;
}

/* The pin: { org, public (hex) }, or { org, public: null } (a person joined `org`; its first verified key is pinned
   next); null when there is none; 'unreadable' when a file is there but cannot be read. */
function readPin(root) {
  let text;
  try { text = fs.readFileSync(pinPath(root), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? null : 'unreadable'; }
  try {
    const p = JSON.parse(text);
    if (p && typeof p.org === 'string' && p.org && (p.public === null || (typeof p.public === 'string' && /^[0-9a-f]{64}$/.test(p.public)))) return { org: p.org, public: p.public };
  } catch { /* falls through */ }
  return 'unreadable';
}

// The house secure writer (as backupmemberkey.js writeKeys): an exclusive temp, 0600, renamed, the folder synced.
function writePin(root, pin) {
  fs.mkdirSync(path.join(root, 'backupkeys'), { recursive: true, mode: 0o700 });
  require('./securewrite').writeSecret(pinPath(root), JSON.stringify(pin), 0o600, { atomicOnly: true });
}

/* The end of this computer's enrollment: the pin goes with it. */
function clear(root) {
  try { fs.rmSync(pinPath(root), { force: true }); } catch { /* best effort: a left pin refuses, never trusts */ }
}

/* A person's Join to `org`: the same company's pin stays; anything else (no pin, another company's, an unreadable one)
   becomes "expect `org`", so the first key pinned must be the joined company's, not one Kosmos+ names later (review 2). */
function joined(root, org) {
  if (typeof org !== 'string' || !org) return;
  const pin = readPin(root);
  if (pin !== null && pin !== 'unreadable' && pin.org === org) return;
  // An unreadable pin is left as it is (check() refuses it, as for the member key file): a Join never re-pins over
  // something this computer cannot read, even for the same company (review 3).
  if (pin === 'unreadable') return;
  writePin(root, { org, public: null });
}

/**
 * check(root, data, company, opts): data is the backup-key answer's data; company is { org, orgPublic } as read from
 * it. Answers { ok: true } or { ok: false, because }. opts.verifyingKey (a Buffer) stands in for VERIFYING_KEY in tests.
 */
function check(root, data, company, opts = {}) {
  try {
    // Only a real 32-byte key overrides the shipped one (tests): null or anything else can never switch checking off.
    const vk = Buffer.isBuffer(opts.verifyingKey) && opts.verifyingKey.length === 32 ? opts.verifyingKey : VERIFYING_KEY == null ? null : Buffer.from(VERIFYING_KEY, 'hex');
    if (vk == null) return { ok: true };
    const epoch = data && data.epoch;
    const sig = unb64(data && data.signature);
    if (!sig) return { ok: false, because: 'Kosmos+ sent the company backup key without the escrow\'s signature, so it was not used' };
    if (!orgkeysig.verify(vk, company.org, epoch, company.orgPublic, sig)) {
      return { ok: false, because: 'the escrow\'s signature on the company backup key did not check, so the key was not used' };
    }
    const pin = readPin(root);
    if (pin === 'unreadable') return { ok: false, because: 'the company key this computer recorded could not be read; it was left as it is' };
    const here = { org: company.org, public: company.orgPublic.toString('hex') };
    /* The first key pinned must be the company the person joined: the expectation written at their Join, else (a Mac
       that joined before this code) the enrollment record's org, opts.recordOrg. The record is the weaker anchor: the
       hourly refresh rewrites it from Kosmos+, so a breach between that join and the first answer here is not caught. */
    const expected = pin ? pin.org : typeof opts.recordOrg === 'function' ? opts.recordOrg() : opts.recordOrg;
    if (!pin || pin.public === null) {
      if (typeof expected !== 'string' || expected !== here.org) {
        return { ok: false, because: 'Kosmos+ named a company backup key for a different company from the one this computer joined, so it was not used' };
      }
      // Only a second process on this root could interleave a Join here (both paths are synchronous): pin only over the
      // state that was read, else answer not-yet and let the next run decide (review 3).
      if (JSON.stringify(readPin(root)) !== JSON.stringify(pin)) return { ok: false, because: 'the company backup key changed while it was being checked; it is checked again on the next run' };
      writePin(root, here);
      return { ok: true, pinned: true };
    }
    if (pin.org !== here.org || pin.public !== here.public) {
      return { ok: false, because: 'Kosmos+ named a different company backup key from the one this computer accepted first, so it was not used. Ask your company admin before leaving and joining again, which resets it' };
    }
    return { ok: true };
  } catch {
    return { ok: false, because: 'the company backup key could not be checked' };
  }
}

module.exports = { check, clear, joined, readPin, VERIFYING_KEY, PIN_FILE };
