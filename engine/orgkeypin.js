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
 *   - the FIRST verified (org, public key) is pinned in this computer's store, and any later answer naming another org
 *     or another key is refused, signed or not (escrowd signs only the key it recorded for that org and epoch, but the
 *     pin also stops a coordinator naming a different org with a key of its own);
 *   - only a final end of this computer's enrollment (orgenroll.js retireWorldId: a confirmed Leave, or a removal; not
 *     a Leave the company refused) or a person's Join to ANOTHER company clears the pin, so the next pin is taken after
 *     a person's act. The pin is for the current org epoch (1 today); an
 *     org-key rotation, when it exists, must move it deliberately.
 * Until a verification key ships (VERIFYING_KEY null), check() answers ok and pins nothing: today's behaviour exactly.
 *
 * Never throws. The pin file is 0600 under <root>/backupkeys (the member key's own folder).
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

/* The pin, { org, public (hex) }; null when there is none; 'unreadable' when a file is there but cannot be read. */
function readPin(root) {
  let text;
  try { text = fs.readFileSync(pinPath(root), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? null : 'unreadable'; }
  try {
    const p = JSON.parse(text);
    if (p && typeof p.org === 'string' && typeof p.public === 'string' && /^[0-9a-f]{64}$/.test(p.public)) return { org: p.org, public: p.public };
  } catch { /* falls through */ }
  return 'unreadable';
}

function writePin(root, pin) {
  const dir = path.join(root, 'backupkeys');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = pinPath(root) + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(pin)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, pinPath(root));
}

/* The end of this computer's enrollment: the pin goes with it. */
function clear(root) {
  try { fs.rmSync(pinPath(root), { force: true }); } catch { /* best effort: a left pin refuses, never trusts */ }
}

/* A person's Join to `org`: a pin for ANOTHER company (or one that cannot be read) goes; the same company's stays. */
function clearUnlessFor(root, org) {
  const pin = readPin(root);
  if (pin !== null && (pin === 'unreadable' || pin.org !== org)) clear(root);
}

/**
 * check(root, data, company, opts): data is the backup-key answer's data; company is { org, orgPublic } as read from
 * it. Answers { ok: true } or { ok: false, because }. opts.verifyingKey (a Buffer) stands in for VERIFYING_KEY in tests.
 */
function check(root, data, company, opts = {}) {
  try {
    const vkHex = opts.verifyingKey !== undefined ? opts.verifyingKey : VERIFYING_KEY;
    if (vkHex == null) return { ok: true };
    const vk = Buffer.isBuffer(vkHex) ? vkHex : Buffer.from(String(vkHex), 'hex');
    const epoch = data && data.epoch;
    const sig = unb64(data && data.signature);
    if (!sig) return { ok: false, because: 'Kosmos+ sent the company backup key without the escrow\'s signature, so it was not used' };
    if (!orgkeysig.verify(vk, company.org, epoch, company.orgPublic, sig)) {
      return { ok: false, because: 'the escrow\'s signature on the company backup key did not check, so the key was not used' };
    }
    const pin = readPin(root);
    if (pin === 'unreadable') return { ok: false, because: 'the company key this computer recorded could not be read; it was left as it is' };
    const here = { org: company.org, public: company.orgPublic.toString('hex') };
    if (pin === null) { writePin(root, here); return { ok: true, pinned: true }; }
    if (pin.org !== here.org || pin.public !== here.public) {
      return { ok: false, because: 'Kosmos+ named a different company backup key from the one this computer recorded when it joined, so it was not used' };
    }
    return { ok: true };
  } catch {
    return { ok: false, because: 'the company backup key could not be checked' };
  }
}

module.exports = { check, clear, clearUnlessFor, readPin, VERIFYING_KEY, PIN_FILE };
