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
 *      (member), and the company's public key, all from one answer to a device-signed request. The answer itself is
 *      not signed: the tunnel's TLS to Kosmos+ is what keeps the private key from being wrapped to someone else's;
 *   2. with a key here that Kosmos+ already took, answers it;
 *   3. otherwise keeps a key on disk BEFORE sending it (an answer lost after Kosmos+ kept it must not lose the key),
 *      wraps it to the company's key for (org, member, epoch), and registers it: epoch 1 first; a different key
 *      already at that epoch (409 member_key_exists) or a later current epoch (400 member_key_wrong_epoch with
 *      currentEpoch) means this computer lost its key, so it tries the next epoch once; currentEpoch 0 (no key at
 *      all) means epoch 1. A kept key Kosmos+ already holds for another epoch (409 member_key_reused) is replaced
 *      by a fresh one, once.
 * A 429 member_key_rotation_wait keeps the new key and answers `waiting`; the next call sends the same key.
 * It does NOT ask whether a key Kosmos+ took is still the member's current one: the backup job compares the epoch
 * it answers with each grant's `epoch` (the uploader refuses a grant for another epoch), and a mismatch is the sign
 * the member moved on elsewhere. Calls run one at a time in this process; ONE board process per data root is
 * assumed (the board's own lock), and ONE computer per member: Kosmos+ answers backup-key only to the member's
 * enrolled computer (403 backup_not_member otherwise), so "another key holds this epoch" means this computer lost its
 * key, not that a second computer of the member registered one. That needs one key file per tunnel identity too: two
 * data roots sharing one tunnel state (AGENT_WORKFORCE_TUNNEL_STATE, a test or development setup) would each read the
 * other's key as lost. A rotation or a fresh key re-reads the file first, so a key another process
 * REGISTERED meanwhile is answered, never replaced (an unregistered one it kept is not protected).
 *
 * The keys are kept in one 0600 file per (org, member) under the store, in a 0700 folder: the raw X25519 halves,
 * base64url. This code keeps one unregistered entry at most, the newest: a move deletes the epoch it left (never a
 * registered one), a fresh key replaces its slot; a registered key the job called stale (lostEpoch) stays. A call
 * answers the newest registered key. On Windows the file modes do nothing; the profile's ACLs are what protect it.
 * The backup job must seal ONLY under a key answered ok here: an unregistered key may be replaced by a fresh one
 * (member_key_reused), and its private half is then deleted. Under that rule nothing this computer sealed is under it
 * (a key Kosmos+ holds at an epoch this file never recorded was never answered ok here).
 * Every call asks backup-key first, so with Kosmos+ unreachable it answers ok: false even with a key on disk; a backup
 * needs a grant from Kosmos+ anyway.
 * Never throws: answers { ok, epoch, publicKey } or { ok: false, because, ... }. Every answer given after Kosmos+ named
 * the company also carries its { org, member }, ok or not (kosmos#5535); an answer before that (no answer, an unreadable
 * one) carries neither.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const backupkeys = require('./backupkeys');

const BACKUP_KEY_ROUTE = '/v1/org/backup-key';
const MEMBER_KEY_ROUTE = '/v1/org/backup/member-key';
/* The key file is there but cannot be read (malformed, a mismatched pair, another company's): never overwritten, so it
   stays this way until a person moves it aside; `unreadableKeyFile` lets the caller say so, not retry quietly. */
const UNREADABLE = Object.freeze({ ok: false, unreadableKeyFile: true, because: 'the backup key file on this computer could not be read; it was left as it is' });
// The context id rule the wrap itself checks (engine/backupkeys.js, as the coordinator's keywrap valid_id).
const ID = backupkeys.ID_RE;
const EPOCH_MAX = Number.MAX_SAFE_INTEGER;

function dir() { return path.join(store.ROOT, 'backupkeys'); }
function fileFor(org, member) {
  const h = crypto.createHash('sha256').update(String(org) + '\u0000' + String(member)).digest('hex').slice(0, 24);
  return path.join(dir(), h + '.json');
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
// Canonical base64url only: Node's decoder skips characters it does not know, so the bytes must encode back to s.
const unb64 = (s) => { try { const b = Buffer.from(String(s), 'base64url'); return b.length === 32 && b64(b) === String(s) ? b : null; } catch { return null; } };

/* The keys kept for (org, member): { ok, keys } with keys { "<epoch>": { sk, pk, registered } } (Buffers). A missing
   file is ok and empty; an unreadable or malformed one is NOT ok, so nothing overwrites it. */
function readKeys(org, member) {
  let raw;
  // A symlinked key file is not ours: the folder is 0700, so only this user could have put it there, but it is refused.
  try { if (fs.lstatSync(fileFor(org, member)).isSymbolicLink()) return { ok: false, keys: {} }; } catch { /* missing: read decides */ }
  try { raw = fs.readFileSync(fileFor(org, member), 'utf8'); }
  catch (err) { return { ok: err.code === 'ENOENT', keys: {} }; }
  let got;
  try { got = JSON.parse(raw); } catch { return { ok: false, keys: {} }; }
  if (!got || got.org !== org || got.member !== member || !got.keys || typeof got.keys !== 'object') return { ok: false, keys: {} };
  const keys = {};
  for (const [e, k] of Object.entries(got.keys)) {
    const sk = unb64(k && k.sk), pk = unb64(k && k.pk);
    if (!/^[1-9][0-9]*$/.test(e) || !Number.isSafeInteger(Number(e)) || !sk || !pk) return { ok: false, keys: {} };
    // The pair must be a pair: a public half that is not the private half's would be sealed to and never opened.
    if (!backupkeys.publicKeyOf(sk).equals(pk)) return { ok: false, keys: {} };
    keys[e] = { sk, pk, registered: k.registered === true };
  }
  // The file invariant (header): at most one unregistered entry, and it is the newest. A file breaking it is not ours.
  const es = Object.keys(keys).map(Number).sort((a, b) => b - a);
  const pendings = es.filter((e) => !keys[e].registered);
  if (pendings.length > 1 || (pendings.length === 1 && pendings[0] !== es[0])) return { ok: false, keys: {} };
  // A file left looser (an older build, a copy, a restore) is made owner-only once it has read as ours, best effort.
  try { fs.chmodSync(fileFor(org, member), 0o600); } catch { /* the read stands */ }
  return { ok: true, keys };
}
function writeKeys(org, member, keys) {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir(), 0o700); } catch { /* the file itself is 0600 either way */ }
  const out = {};
  for (const [e, k] of Object.entries(keys)) out[e] = { sk: b64(k.sk), pk: b64(k.pk), registered: k.registered === true };
  require('./securewrite').writeSecret(fileFor(org, member), JSON.stringify({ org, member, keys: out }), 0o600, { atomicOnly: true });
}

/* The backup-key answer, checked: { org, member, orgPublic } or null. Its `epoch` is the COMPANY key's epoch (1; the
   coordinator wraps every member epoch to it, memberkey.rs), not the member's, so it is not read. */
function companyOf(data) {
  if (!data || typeof data !== 'object') return null;
  const orgPublic = unb64(data.public_key);
  if (typeof data.org !== 'string' || !ID.test(data.org) || typeof data.member !== 'string' || !ID.test(data.member) || !orgPublic) return null;
  return { org: data.org, member: data.member, orgPublic };
}

/* The newest epoch in a key map that Kosmos+ took, or undefined. */
function newestRegistered(keys) {
  return Object.keys(keys).map(Number).sort((a, b) => b - a).find((e) => keys[e].registered);
}

async function register(macRequest, company, epoch, key) {
  const wrap = backupkeys.wrapMemberKey(key.sk, company.orgPublic, { org: company.org, member: company.member, epoch: String(epoch) });
  return macRequest('POST', MEMBER_KEY_ROUTE, { epoch, member_public: b64(key.pk), wrap: b64(wrap) });
}

/* One at a time, in this process only (the header assumes one board process per data root). Today reading the file
   and writing a new key have no await between them, so a second call sees the first call's key anyway; the chain
   keeps that true if the store ever gains one. */
let chain = Promise.resolve();
function ensureMemberKey(opts = {}) {
  // kosmos#5535: every answer given once the company is known names the company and member it is for, so the backup
  // job can keep its state per (org, member) and scope the lostEpoch it sends (lostFor, below).
  const seen = {};
  const run = chain.then(() => ensureNow(opts, seen)).then((r) => (seen.company ? Object.assign(r, { org: seen.company.org, member: seen.company.member }) : r));
  chain = run.catch(() => {});
  return run;
}
async function ensureNow(opts, seen) {
  const macRequest = opts.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
  try {
    const bk = await macRequest('POST', BACKUP_KEY_ROUTE, {});
    if (!bk || !bk.ok) return { ok: false, because: (bk && bk.because) || 'Kosmos+ did not answer', ...(bk && bk.refusal ? { refusal: bk.refusal } : {}) };
    const company = companyOf(bk.data);
    if (!company) return { ok: false, because: 'the company backup key Kosmos+ sent could not be read' };
    seen.company = company;
    const read = readKeys(company.org, company.member);
    if (!read.ok) return { ...UNREADABLE };
    const keys = read.keys;
    const epochs = Object.keys(keys).map(Number).sort((a, b) => b - a);
    /* opts.lostEpoch: the backup job saw a grant for another epoch than this registered key's (one computer per member,
       so this file is stale, e.g. a restored data root). That key is treated as lost: a new key goes the same way a
       lost key's does (one move, the day respected). The stale key stays in the file, so this computer still opens
       its own backups from that epoch; nothing is deleted on the job's word. The job passes lostEpoch on EVERY call
       until a newer key is registered: without it, a call answers the stale key from disk. lostEpochIgnored and
       pendingEpoch ride only an answer from disk; a first registration answers neither.
       opts.lostFor { org, member }: the company and member the job recorded lostEpoch under (kosmos#5535). An epoch is a
       number per member, so a lostEpoch is honoured ONLY for that pair: one recorded under another company or member
       (this Kosmos moved, or a restored data root) would otherwise retire this member's key whenever the numbers
       agreed. Without lostFor, or for another pair, it is ignored, and an answer from disk says so. */
    let lost = null;
    const lostFor = opts.lostFor;
    const scoped = !!(lostFor && typeof lostFor === 'object' && lostFor.org === company.org && lostFor.member === company.member);
    if (scoped && Number.isSafeInteger(opts.lostEpoch) && opts.lostEpoch >= 1 && opts.lostEpoch < EPOCH_MAX && newestRegistered(keys) === opts.lostEpoch) {
      lost = opts.lostEpoch;
    }
    const done = lost === null ? newestRegistered(keys) : undefined;
    // A lostEpoch that is not this file's newest registered epoch is ignored; an answer from disk says so, and names a
    // newer key still pending (the job forgot lostEpoch, or restarted), so falling back is never silent.
    const ignored = opts.lostEpoch != null && lost === null ? { lostEpochIgnored: true } : {};
    const above = done !== undefined && epochs.length && epochs[0] > done && !keys[epochs[0]].registered ? { pendingEpoch: epochs[0] } : {};
    if (done !== undefined) return { ok: true, epoch: done, publicKey: keys[done].pk, ...ignored, ...above };
    // The newest key not yet taken (kept before an earlier send), else a new one for epoch 1.
    // A stale registered key is KEPT (it still opens its own epoch's backups); the new key starts one past it, and the
    // move path takes it to the member's current epoch + 1 if that is later.
    // A pending key already kept above the stale one (an earlier call that waited out the day) is the one to send again.
    // This relies on the file invariant in the header: at most one unregistered entry, and it is the newest.
    const pending = epochs.length && !keys[epochs[0]].registered ? epochs[0] : null;
    let epoch = lost !== null ? (pending !== null && pending > lost ? pending : lost + 1) : (epochs.length ? epochs[0] : 1);
    if (!keys[epoch]) {
      keys[epoch] = { ...backupkeys.newMemberKey(), registered: false };
      writeKeys(company.org, company.member, keys);
    }
    // At most one move to a next epoch and one fresh key: each new epoch is audited and limited to one a day.
    let moved = false, refreshed = false;
    for (;;) {
      const r = await register(macRequest, company, epoch, keys[epoch]);
      // The answer must name what was sent, so a changed coordinator or tunnel shape is not taken as registered.
      // Compared as bytes (a lenient decode: padding, and characters Node's decoder skips), so only a different key
      // refuses.
      const echoed = r && r.ok && r.data && typeof r.data.member_public === 'string' ? Buffer.from(r.data.member_public, 'base64url') : null;
      if (r && r.ok && !(r.data && r.data.epoch === epoch && echoed && echoed.equals(keys[epoch].pk))) {
        return { ok: false, because: 'Kosmos+ answered the backup key registration in a shape this computer does not know' };
      }
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
        return { ok: false, waiting: true, pendingEpoch: epoch, because: 'Kosmos+ takes a new backup key at most once a day; this computer tries again later' };
      }
      // A kept key Kosmos+ already holds for another epoch (an answer lost, then the epoch moved): a fresh key, once.
      if (code === 'member_key_reused' && !refreshed) {
        refreshed = true;
        const now = readKeys(company.org, company.member);
        if (!now.ok) return { ...UNREADABLE };
        const theirsNow = newestRegistered(now.keys);
        if (theirsNow !== undefined && theirsNow !== lost) return { ok: true, epoch: theirsNow, publicKey: now.keys[theirsNow].pk };
        keys[epoch] = { ...backupkeys.newMemberKey(), registered: false };
        writeKeys(company.org, company.member, keys);
        continue;
      }
      // This computer lost its key: another key holds this epoch, or a later one is current. Try the next, once.
      let next = null;
      if (code === 'member_key_exists') next = epoch + 1;
      else if (code === 'member_key_wrong_epoch' && Number.isSafeInteger(r.refusal.currentEpoch) && r.refusal.currentEpoch >= 0) {
        // 0: no key is registered for this member at all (a kept key from an earlier epoch), so start at 1; if this send
        // was already epoch 1, there is nothing to move to and the refusal is answered.
        // currentEpoch equal to the epoch just sent: the coordinator never answers this (it reads the current epoch
        // once); handled so an unexpected answer cannot start an epoch.
        next = r.refusal.currentEpoch === epoch ? null
          : r.refusal.currentEpoch === 0 ? (epoch === 1 ? null : 1) : r.refusal.currentEpoch + 1;
      }
      // Never onto a registered key, and on the lost path never at or below the stale epoch (an answer like that is what
      // a coordinator rollback looks like): moving there would delete a key Kosmos+ took.
      if (next !== null && ((keys[next] && keys[next].registered) || (lost !== null && next <= lost))) next = null;
      if (moved || next === null || next > EPOCH_MAX) {
        return { ok: false, because: (r && r.because) || 'Kosmos+ did not answer', ...(r && r.refusal ? { refusal: r.refusal } : {}) };
      }
      // Another process may have registered a key meanwhile: re-read, and answer that one rather than replace it.
      const fresh = readKeys(company.org, company.member);
      if (!fresh.ok) return { ...UNREADABLE };
      const theirs = newestRegistered(fresh.keys);
      if (theirs !== undefined && theirs !== lost) return { ok: true, epoch: theirs, publicKey: fresh.keys[theirs].pk };
      // The write below comes before the next send, so the key is on disk before Kosmos+ can take it at `next`.
      // The lost epoch's key is not this computer's; the new epoch gets the same unregistered key, kept before it is sent.
      // next equal to epoch: the coordinator never answers this either; handled so an unexpected answer cannot delete
      // the stored key (it is the same key again, nothing moved).
      if (next !== epoch) {
        keys[next] = { sk: keys[epoch].sk, pk: keys[epoch].pk, registered: false };
        delete keys[epoch];
      }
      writeKeys(company.org, company.member, keys);
      epoch = next;
      moved = true;
    }
  } catch (err) {
    // A fixed sentence and the error code only: a file error's message carries the full path, home folder included.
    return { ok: false, because: 'the backup key could not be set up on this computer' + (err && typeof err.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(err.code) ? ' (' + err.code + ')' : '') };
  }
}

module.exports = { ensureMemberKey, BACKUP_KEY_ROUTE, MEMBER_KEY_ROUTE };
