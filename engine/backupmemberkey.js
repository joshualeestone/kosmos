'use strict';

/**
 * kosmos#5744 slice 2b: this computer's member backup key for its company, registered with Kosmos+.
 *
 * The coordinator (POST /v1/org/backup/member-key, docs/coordinator-api.md in kosmos-relay) keeps one member key per
 * epoch and never swaps one inside an epoch. The first registration is epoch 1. A member whose computer lost its key
 * starts the NEXT epoch with a new key, at most once a day; the old epoch's key stays there, wrapped to the company's
 * key, so the backups sealed under it stay readable by the company (escrow), not by this computer.
 *
 * ensureMemberKey():
 *   1. asks POST /v1/org/backup-key for the company (org), this computer's account as the coordinator names it
 *      (member), and the company's public key, all from one signed answer;
 *   2. with a key here that Kosmos+ already took, answers it;
 *   3. otherwise keeps a key on disk BEFORE sending it (an answer lost after Kosmos+ kept it must not lose the key),
 *      wraps it to the company's key for (org, member, epoch), and registers it: epoch 1 first; a different key
 *      already at that epoch (409 member_key_exists) or a later current epoch (400 member_key_wrong_epoch with
 *      currentEpoch) means this computer lost its key, so it tries the next epoch once.
 * A 429 member_key_rotation_wait keeps the new key and answers `waiting`; the next call sends the same key.
 * It does NOT ask whether a key Kosmos+ took is still the member's current one: the backup job compares the epoch
 * it answers with each grant's `epoch` (the uploader refuses a grant for another epoch), and a mismatch is the sign
 * the member moved on elsewhere. Calls run one at a time in this process, so two at once cannot each make a key.
 *
 * The keys are kept in one 0600 file per (org, member) under the store, in a 0700 folder: the raw X25519 halves,
 * base64url. Never throws: answers { ok, epoch, publicKey } or { ok: false, because, ... }.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const backupkeys = require('./backupkeys');

const BACKUP_KEY_ROUTE = '/v1/org/backup-key';
const MEMBER_KEY_ROUTE = '/v1/org/backup/member-key';
// The context id rule engine/backupkeys.js and the coordinator's keywrap share: 1 to 128 of letters, digits, . _ : -
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const EPOCH_MAX = Number.MAX_SAFE_INTEGER;

function dir() { return path.join(store.ROOT, 'backupkeys'); }
function fileFor(org, member) {
  const h = crypto.createHash('sha256').update(String(org) + '\u0000' + String(member)).digest('hex').slice(0, 24);
  return path.join(dir(), h + '.json');
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => { try { const b = Buffer.from(String(s), 'base64url'); return b.length === 32 ? b : null; } catch { return null; } };

/* The keys kept for (org, member): { ok, keys } with keys { "<epoch>": { sk, pk, registered } } (Buffers). A missing
   file is ok and empty; an unreadable or malformed one is NOT ok, so nothing overwrites it. */
function readKeys(org, member) {
  let raw;
  try { raw = fs.readFileSync(fileFor(org, member), 'utf8'); }
  catch (err) { return { ok: !!err && err.code === 'ENOENT', keys: {} }; }
  let got;
  try { got = JSON.parse(raw); } catch { return { ok: false, keys: {} }; }
  if (!got || got.org !== org || got.member !== member || !got.keys || typeof got.keys !== 'object') return { ok: false, keys: {} };
  const keys = {};
  for (const [e, k] of Object.entries(got.keys)) {
    const sk = unb64(k && k.sk), pk = unb64(k && k.pk);
    if (!/^[1-9][0-9]*$/.test(e) || !sk || !pk) return { ok: false, keys: {} };
    keys[e] = { sk, pk, registered: k.registered === true };
  }
  return { ok: true, keys };
}
function writeKeys(org, member, keys) {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir(), 0o700); } catch { /* the file itself is 0600 either way */ }
  const out = {};
  for (const [e, k] of Object.entries(keys)) out[e] = { sk: b64(k.sk), pk: b64(k.pk), registered: k.registered === true };
  require('./securewrite').writeSecret(fileFor(org, member), JSON.stringify({ org, member, keys: out }), 0o600, { atomicOnly: true });
}

/* The signed backup-key answer, checked: { org, member, orgPublic } or null. */
function companyOf(data) {
  if (!data || typeof data !== 'object') return null;
  const orgPublic = unb64(data.public_key);
  if (typeof data.org !== 'string' || !ID.test(data.org) || typeof data.member !== 'string' || !ID.test(data.member) || !orgPublic) return null;
  return { org: data.org, member: data.member, orgPublic };
}

async function register(macRequest, company, epoch, key) {
  const wrap = backupkeys.wrapMemberKey(key.sk, company.orgPublic, { org: company.org, member: company.member, epoch: String(epoch) });
  return macRequest('POST', MEMBER_KEY_ROUTE, { epoch, member_public: b64(key.pk), wrap: b64(wrap) });
}

/* One at a time: two calls that each read "no key" would each make one, and the later write could replace a key
   Kosmos+ had already taken. */
let chain = Promise.resolve();
function ensureMemberKey(opts = {}) {
  const run = chain.then(() => ensureNow(opts));
  chain = run.catch(() => {});
  return run;
}
async function ensureNow(opts) {
  const macRequest = opts.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
  try {
    const bk = await macRequest('POST', BACKUP_KEY_ROUTE, {});
    if (!bk || !bk.ok) return { ok: false, because: (bk && bk.because) || 'Kosmos+ did not answer', ...(bk && bk.refusal ? { refusal: bk.refusal } : {}) };
    const company = companyOf(bk.data);
    if (!company) return { ok: false, because: 'the company backup key Kosmos+ sent could not be read' };
    const read = readKeys(company.org, company.member);
    if (!read.ok) return { ok: false, because: 'the backup key file on this computer could not be read; it was left as it is' };
    const keys = read.keys;
    const epochs = Object.keys(keys).map(Number).sort((a, b) => b - a);
    const done = epochs.find((e) => keys[e].registered);
    if (done !== undefined) return { ok: true, epoch: done, publicKey: keys[done].pk };
    // The newest key not yet taken (kept before an earlier send), else a new one for epoch 1.
    let epoch = epochs.length ? epochs[0] : 1;
    if (!keys[epoch]) {
      keys[epoch] = { ...backupkeys.newMemberKey(), registered: false };
      writeKeys(company.org, company.member, keys);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await register(macRequest, company, epoch, keys[epoch]);
      if (r && r.ok) {
        keys[epoch].registered = true;
        try { writeKeys(company.org, company.member, keys); } catch {
          // Kosmos+ has it; the next call sends the same kept key and gets a repeat.
          return { ok: false, because: 'Kosmos+ took the backup key, but this computer could not note that; it will confirm it next time' };
        }
        return { ok: true, epoch, publicKey: keys[epoch].pk };
      }
      const code = r && r.refusal && r.refusal.code;
      if (code === 'member_key_rotation_wait') {
        return { ok: false, waiting: true, epoch, because: 'Kosmos+ takes a new backup key at most once a day; this computer tries again later' };
      }
      // This computer lost its key: another key holds this epoch, or a later one is current. Try the next, once.
      let next = null;
      if (code === 'member_key_exists') next = epoch + 1;
      else if (code === 'member_key_wrong_epoch' && Number.isSafeInteger(r.refusal.currentEpoch) && r.refusal.currentEpoch >= 0) {
        // 0: no key is registered for this member at all (a kept key from an earlier epoch), so start at 1.
        next = r.refusal.currentEpoch === 0 ? (epoch === 1 ? null : 1) : r.refusal.currentEpoch + 1;
      }
      if (attempt === 1 || next === null || next > EPOCH_MAX) {
        return { ok: false, because: (r && r.because) || 'Kosmos+ did not answer', ...(r && r.refusal ? { refusal: r.refusal } : {}) };
      }
      // The lost epoch's key is not this computer's; the new epoch gets the same new key, kept before it is sent.
      keys[next] = { sk: keys[epoch].sk, pk: keys[epoch].pk, registered: false };
      delete keys[epoch];
      writeKeys(company.org, company.member, keys);
      epoch = next;
    }
    return { ok: false, because: 'the backup key could not be registered' };
  } catch (err) {
    return { ok: false, because: 'the backup key could not be set up: ' + String((err && err.message) || err) };
  }
}

module.exports = { ensureMemberKey, BACKUP_KEY_ROUTE, MEMBER_KEY_ROUTE };
