'use strict';

/**
 * kosmos#7404 step 3, END TO END: a personal backup's member key, on this computer.
 *
 * A personal account's backup is an org of one (step 2). Its member key is kept by Kosmos+ only wrapped to a RECOVERY
 * key made from a code the person keeps (KBR1, engine/backupkeys.js), so Kosmos+ cannot read the backup. Three calls:
 *
 *   setUpPersonalKey():   read this account's context (org, member) from POST /v1/org/backup/member-key/mine (the
 *       company backup-key read is refused for a personal org by design), make a recovery code, a member key and the
 *       code's keys, KEEP the key and the code on disk first, then register: the KBR1 wrap, the recovery PUBLIC key
 *       and the binding tag. Answers the code for the screen to show.
 *   confirmRecoveryCodeSaved(): the screen calls it once the person says they saved the code; only then is the code's
 *       copy on this computer deleted.
 *   restorePersonalKey(code): on a computer that took the backup over (the codeless enroll), read every epoch's row,
 *       and open each with the code: its recovery_public must be the code's, and its wrap must open with the code AND
 *       carry the code holder's binding tag (unwrapMemberKeyFromRecovery). One row that fails refuses the WHOLE
 *       restore, so a backup is never half-restored with a key Kosmos+ could have chosen.
 *
 * WHY THE CODE IS KEPT UNTIL CONFIRMED (review 1, a BLOCKER before it): an answer lost AFTER Kosmos+ kept the key, or a
 * crash before the screen shows the code, would otherwise leave Kosmos+ holding a wrap that only a code nobody saw
 * opens, and setUp refusing ever after ("already has a code"). So the pending code's 16 bytes sit in a 0600 file beside
 * the member key (which this disk already holds in the clear), a retry re-sends the IDENTICAL registration (the
 * coordinator answers a repeat naming the same recovery key and tag as registered) and answers the SAME code, and a row
 * that is our own pending registration is recognised as ours. The file goes when the screen confirms.
 *
 * The keys are kept in the company path's 0600 key file (backupmemberkey readKeys/writeKeys), under its invariant (at
 * most one unregistered entry, the newest; a registered key is never replaced): setUp refuses unless that file holds
 * nothing, or exactly its own pending epoch 1.
 *
 * EPOCHS (decided here, for the slice that adds them): every epoch of a personal backup is wrapped to the SAME
 * recovery key. restore requires each row's recovery_public to be the code's, so a new epoch under a new code would
 * leave no single code that restores everything. A new code means re-wrapping every epoch to it, not a new epoch.
 *
 * Not here: turning personal backup on and showing its words (POST /v1/mac/personal-backup, then the codeless
 * enroll), the backup job choosing this path over ensureMemberKey, a new epoch, and the screens. All of it stays behind
 * KOSMOS_PERSONAL_BACKUP on the coordinator (off).
 *
 * Calls run one at a time in this process. Never throws: answers { ok: true, ... } or { ok: false, because, code? },
 * where code is the coordinator's refusal code, or one of not_a_code, no_keys, wrong_code, not_bound.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const backupkeys = require('./backupkeys');
const memberkeys = require('./backupmemberkey');

const MINE_ROUTE = '/v1/org/backup/member-key/mine';
const MEMBER_KEY_ROUTE = memberkeys.MEMBER_KEY_ROUTE;
const ID = backupkeys.ID_RE;
const b64 = (buf) => Buffer.from(buf).toString('base64url');
// Canonical base64url only: Node's decoder skips characters it does not know, so the bytes must encode back to s.
const unb64 = (s, len) => {
  try { const b = Buffer.from(String(s), 'base64url'); return (len === undefined || b.length === len) && b64(b) === String(s) ? b : null; } catch { return null; }
};

const macRequestOf = (opts) => opts.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
const refused = (because, code) => (code ? { ok: false, because, code } : { ok: false, because });

/* The coordinator's refusal code, if it gave one. remote.macRequest answers { ok: true, data } or
   { ok: false, because, refusal: { status, code, currentEpoch } } (as backupmemberkey.js reads it). */
function codeOf(res) { return res && res.refusal && typeof res.refusal.code === 'string' ? res.refusal.code : undefined; }

/* ---- the pending code: one 0600 file per (org, member), beside the key file, deleted on confirm ---- */
function pendingFile(org, member) {
  const h = crypto.createHash('sha256').update('personal-code\u0000' + org + '\u0000' + member).digest('hex').slice(0, 24);
  return path.join(store.ROOT, 'backupkeys', 'pending-code-' + h + '.json');
}
function readPending(org, member) {
  try {
    const got = JSON.parse(fs.readFileSync(pendingFile(org, member), 'utf8'));
    const bytes = unb64(got && got.code, 16), pk = unb64(got && got.pk, 32);
    if (got.org !== org || got.member !== member || !bytes || !pk) return null;
    return { code: backupkeys.formatRecoveryCode(bytes), pk };
  } catch { return null; }
}
function writePending(org, member, code, pk) {
  fs.mkdirSync(path.dirname(pendingFile(org, member)), { recursive: true, mode: 0o700 });
  require('./securewrite').writeSecret(pendingFile(org, member),
    JSON.stringify({ org, member, code: b64(backupkeys.recoveryCodeBytes(code)), pk: b64(pk) }), 0o600, { atomicOnly: true });
}

/* The context and rows from member-key/mine, checked: { org, member, rows } or null. Each row:
   { epoch, memberPk, wrap, recoveryPk, tag } (tag null when Kosmos+ holds none: restore refuses that row as unbound).
   Any other mis-shaped row makes the WHOLE answer null. */
function contextOf(data) {
  if (!data || typeof data !== 'object' || typeof data.org !== 'string' || !ID.test(data.org)
    || typeof data.member !== 'string' || !ID.test(data.member) || !Array.isArray(data.keys)) return null;
  const rows = [];
  for (const k of data.keys) {
    const epoch = k && k.epoch;
    const memberPk = unb64(k && k.member_public, 32), wrap = unb64(k && k.wrap), recoveryPk = unb64(k && k.recovery_public, 32);
    if (!Number.isSafeInteger(epoch) || epoch < 1 || !memberPk || !wrap || !recoveryPk) return null;
    if (k.recovery_tag !== null && k.recovery_tag !== undefined && typeof k.recovery_tag !== 'string') return null;
    rows.push({ epoch, memberPk, wrap, recoveryPk, tag: typeof k.recovery_tag === 'string' ? k.recovery_tag : null });
  }
  return { org: data.org, member: data.member, rows };
}

async function readContext(macRequest) {
  let res;
  try { res = await macRequest('POST', MINE_ROUTE, {}); } catch { return refused('Kosmos+ could not be reached'); }
  if (!res || !res.ok) return refused('Kosmos+ did not give this computer its backup keys', codeOf(res));
  const ctx = contextOf(res.data);
  return ctx ? { ok: true, ctx } : refused('Kosmos+ answered in a form this computer does not read');
}

/* One at a time in this process (setUp, confirm and restore share the key file). */
let chain = Promise.resolve();
const serial = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

/** Set up a personal backup's key on this computer. Answers { ok: true, code, epoch, resumed? } with the recovery code
    to show (resumed: this answers a registration an earlier call made but could not confirm), or { ok: false, ... }. */
function setUpPersonalKey(opts = {}) { return serial(() => setUpNow(opts)); }
async function setUpNow(opts) {
  try {
    const macRequest = macRequestOf(opts);
    const read = await readContext(macRequest);
    if (!read.ok) return read;
    const { org, member, rows } = read.ctx;
    const kept = memberkeys.readKeys(org, member);
    if (!kept.ok) return refused('the backup key file on this computer could not be read; it was left as it is');
    const epochs = Object.keys(kept.keys);
    const own = kept.keys['1'];
    // Only an empty file, or exactly our own pending epoch 1: a registered key is never replaced, and nothing may sit
    // below another epoch (the file's invariant), so anything else is refused, never overwritten.
    if (epochs.length > 1 || (epochs.length === 1 && (epochs[0] !== '1' || own.registered))) {
      return refused('this computer already holds backup keys for this account; restore them instead of setting up again');
    }
    const pending = readPending(org, member);
    if (rows.length) {
      // Our own registration whose answer was lost: the row is our pending key, wrapped to our pending code.
      const row = rows.length === 1 && rows[0].epoch === 1 ? rows[0] : null;
      if (row && own && !own.registered && pending && row.memberPk.equals(own.pk) && pending.pk.equals(own.pk)
        && row.recoveryPk.equals(backupkeys.recoveryKeysFromCode(pending.code).pk)) {
        memberkeys.writeKeys(org, member, { 1: { sk: own.sk, pk: own.pk, registered: true } });
        return { ok: true, code: pending.code, epoch: 1, resumed: true };
      }
      return refused('this backup already has a recovery code; restore it with that code');
    }
    const epoch = 1;
    const key = own ? { sk: own.sk, pk: own.pk } : backupkeys.newMemberKey();
    // The same code for the same pending key, so a retry re-sends the IDENTICAL registration.
    const code = pending && pending.pk.equals(key.pk) ? pending.code : backupkeys.newRecoveryCode();
    // Kept BEFORE sending: the key, then the code (an answer lost after Kosmos+ kept them must lose neither).
    memberkeys.writeKeys(org, member, { [String(epoch)]: { sk: key.sk, pk: key.pk, registered: false } });
    writePending(org, member, code, key.pk);
    const rk = backupkeys.recoveryKeysFromCode(code);
    const ctx = { org, member, epoch: String(epoch) };
    const wrap = backupkeys.wrapMemberKeyToRecovery(key.sk, rk.pk, ctx);
    const tag = backupkeys.recoveryBindingTag(rk.authKey, ctx, key.pk);
    // The computer proves its own wrap opens with its own code before sending it (the coordinator cannot check).
    if (!backupkeys.unwrapMemberKeyFromRecovery(rk, wrap, ctx, key.pk, tag)) return refused('the backup key could not be wrapped to the recovery code');
    let res;
    try {
      res = await macRequest('POST', MEMBER_KEY_ROUTE, {
        epoch, member_public: b64(key.pk), wrap: b64(wrap), recovery_public: b64(rk.pk), recovery_tag: tag,
      });
    } catch { return refused('Kosmos+ could not be reached; try again (the same key and code are kept for it)'); }
    if (!res || !res.ok) return refused('Kosmos+ did not keep the backup key', codeOf(res));
    memberkeys.writeKeys(org, member, { [String(epoch)]: { sk: key.sk, pk: key.pk, registered: true } });
    return { ok: true, code, epoch };
  } catch { return refused('setting up the backup key failed on this computer'); }
}

/** The person saved the code: delete this computer's copy of it. Answers { ok: true } (also when there was none). */
function confirmRecoveryCodeSaved(opts = {}) {
  return serial(async () => {
    try {
      const read = await readContext(macRequestOf(opts));
      if (!read.ok) return read;
      fs.rmSync(pendingFile(read.ctx.org, read.ctx.member), { force: true });
      return { ok: true };
    } catch { return refused('the recovery code\'s copy on this computer could not be deleted'); }
  });
}

/** Restore a personal backup's keys on this computer with the person's recovery code. Answers
    { ok: true, epochs } or { ok: false, because, code? }. */
function restorePersonalKey(code, opts = {}) { return serial(() => restoreNow(code, opts)); }
async function restoreNow(code, opts) {
  try {
    const rk = backupkeys.recoveryKeysFromCode(code);
    if (!rk) return refused('that is not a recovery code (26 letters and digits)', 'not_a_code');
    const read = await readContext(macRequestOf(opts));
    if (!read.ok) return read;
    const { org, member, rows } = read.ctx;
    if (!rows.length) return refused('this backup has no keys yet: there is nothing to restore', 'no_keys');
    const opened = {};
    for (const row of rows) {
      // Not this backup's code (or a row made with another one): said as that, before trying to open anything.
      if (!row.recoveryPk.equals(rk.pk)) return refused('that recovery code is not the one for this backup', 'wrong_code');
      const ctx = { org, member, epoch: String(row.epoch) };
      const sk = row.tag ? backupkeys.unwrapMemberKeyFromRecovery(rk, row.wrap, ctx, row.memberPk, row.tag) : null;
      // The code is right, so a row that does not open with its tag (or has none) was not made by the code holder.
      if (!sk) return refused('a backup key from Kosmos+ is not one this recovery code made; nothing was restored', 'not_bound');
      opened[String(row.epoch)] = { sk, pk: row.memberPk, registered: true };
    }
    const kept = memberkeys.readKeys(org, member);
    if (!kept.ok) return refused('the backup key file on this computer could not be read; it was left as it is');
    // Registered keys from Kosmos+ replace only this computer's unregistered ones; a registered key here that Kosmos+
    // does not list is kept (the file never loses a registered key).
    const merged = {};
    for (const [e, k] of Object.entries(kept.keys)) if (k.registered) merged[e] = k;
    memberkeys.writeKeys(org, member, { ...merged, ...opened });
    return { ok: true, epochs: rows.map((r) => r.epoch) };
  } catch { return refused('restoring the backup keys failed on this computer'); }
}

module.exports = { setUpPersonalKey, confirmRecoveryCodeSaved, restorePersonalKey, MINE_ROUTE };
