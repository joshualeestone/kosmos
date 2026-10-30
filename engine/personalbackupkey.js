'use strict';

/**
 * kosmos#7404 step 3, END TO END: a personal backup's member key, on this computer.
 *
 * A personal account's backup is an org of one (step 2). Its member key is kept by Kosmos+ only wrapped to a RECOVERY
 * key made from a code the person keeps (KBR1, engine/backupkeys.js), so Kosmos+ cannot read the backup. Two calls:
 *
 *   setUp():   read this account's context (org, member) from POST /v1/org/backup/member-key/mine (the company
 *              backup-key read is refused for a personal org by design), make a recovery code, a member key and the
 *              code's keys, KEEP the member key on disk first (an answer lost after Kosmos+ kept it must not lose the
 *              key), then register: the KBR1 wrap, the recovery PUBLIC key and the binding tag. Answers the code ONCE,
 *              for the screen to show. The code is never written anywhere by this module.
 *   restore(code): on a computer that took the backup over (the codeless enroll), read every epoch's row, and open
 *              each with the code: its recovery_public must be the code's, and its wrap must open with the code AND
 *              carry the code holder's binding tag (unwrapMemberKeyFromRecovery). One row that fails refuses the WHOLE
 *              restore, so a backup is never half-restored with a key Kosmos+ could have chosen. The opened keys are
 *              kept in the same 0600 file the company path uses (backupmemberkey readKeys/writeKeys), registered.
 *
 * Not here: turning personal backup on and showing its words (POST /v1/mac/personal-backup, then the codeless
 * enroll), the backup job choosing this path over ensureMemberKey, a new epoch, and the screens. All of it stays behind
 * KOSMOS_PERSONAL_BACKUP on the coordinator (off).
 *
 * Never throws: answers { ok: true, ... } or { ok: false, because, code? }, where code is the coordinator's refusal code
 * when it gave one.
 */

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

/* The context and rows from member-key/mine, checked: { org, member, rows } or null. Each row:
   { epoch, memberPk, wrap, recoveryPk, tag }. A row that is not shaped right makes the WHOLE answer null. */
function contextOf(data) {
  if (!data || typeof data !== 'object' || typeof data.org !== 'string' || !ID.test(data.org)
    || typeof data.member !== 'string' || !ID.test(data.member) || !Array.isArray(data.keys)) return null;
  const rows = [];
  for (const k of data.keys) {
    const epoch = k && k.epoch;
    const memberPk = unb64(k && k.member_public, 32), wrap = unb64(k && k.wrap), recoveryPk = unb64(k && k.recovery_public, 32);
    if (!Number.isSafeInteger(epoch) || epoch < 1 || !memberPk || !wrap || !recoveryPk || typeof k.recovery_tag !== 'string') return null;
    rows.push({ epoch, memberPk, wrap, recoveryPk, tag: k.recovery_tag });
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

/** Set up a personal backup's key on this computer. Answers { ok: true, code, epoch } with the recovery code to show
    ONCE, or { ok: false, because, code? }. */
async function setUp(opts = {}) {
  try {
    const macRequest = macRequestOf(opts);
    const read = await readContext(macRequest);
    if (!read.ok) return read;
    const { org, member, rows } = read.ctx;
    // Kosmos+ already holds a key for this backup: setting up again would make a second code for a backup the first
    // one opens. A computer that holds the code restores instead; a new code is a new epoch (not here).
    if (rows.length) return refused('this backup already has a recovery code; restore it with that code');
    const kept = memberkeys.readKeys(org, member);
    if (!kept.ok) return refused('the backup key file on this computer could not be read; it was left as it is');
    const epoch = 1;
    // A key this computer kept but Kosmos+ never confirmed is reused, so a retry after a lost answer sends the SAME
    // key; its code is gone with the screen that showed it, so the wrap is to a NEW code (Kosmos+ has none yet).
    const pending = kept.keys[String(epoch)];
    const member_ = pending && !pending.registered ? { sk: pending.sk, pk: pending.pk } : backupkeys.newMemberKey();
    memberkeys.writeKeys(org, member, { ...kept.keys, [String(epoch)]: { sk: member_.sk, pk: member_.pk, registered: false } });
    const code = backupkeys.newRecoveryCode();
    const rk = backupkeys.recoveryKeysFromCode(code);
    const ctx = { org, member, epoch: String(epoch) };
    const wrap = backupkeys.wrapMemberKeyToRecovery(member_.sk, rk.pk, ctx);
    const tag = backupkeys.recoveryBindingTag(rk.authKey, ctx, member_.pk);
    // The computer proves its own wrap opens with its own code before sending it (the coordinator cannot check).
    if (!backupkeys.unwrapMemberKeyFromRecovery(rk, wrap, ctx, member_.pk, tag)) return refused('the backup key could not be wrapped to the recovery code');
    let res;
    try {
      res = await macRequest('POST', MEMBER_KEY_ROUTE, {
        epoch, member_public: b64(member_.pk), wrap: b64(wrap), recovery_public: b64(rk.pk), recovery_tag: tag,
      });
    } catch { return refused('Kosmos+ could not be reached; nothing was set up'); }
    if (!res || !res.ok) return refused('Kosmos+ did not keep the backup key', codeOf(res));
    const now = memberkeys.readKeys(org, member);
    if (now.ok) memberkeys.writeKeys(org, member, { ...now.keys, [String(epoch)]: { sk: member_.sk, pk: member_.pk, registered: true } });
    return { ok: true, code, epoch };
  } catch { return refused('setting up the backup key failed on this computer'); }
}

/** Restore a personal backup's keys on this computer with the person's recovery code. Answers
    { ok: true, epochs } or { ok: false, because, code? }. */
async function restore(code, opts = {}) {
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
      const sk = backupkeys.unwrapMemberKeyFromRecovery(rk, row.wrap, ctx, row.memberPk, row.tag);
      // The code is right, so a row that does not open with its tag was not made by the code holder: refuse it all.
      if (!sk) return refused('a backup key from Kosmos+ is not one this recovery code made; nothing was restored', 'not_bound');
      opened[String(row.epoch)] = { sk, pk: row.memberPk, registered: true };
    }
    const kept = memberkeys.readKeys(org, member);
    if (!kept.ok) return refused('the backup key file on this computer could not be read; it was left as it is');
    memberkeys.writeKeys(org, member, { ...kept.keys, ...opened });
    return { ok: true, epochs: rows.map((r) => r.epoch) };
  } catch { return refused('restoring the backup keys failed on this computer'); }
}

module.exports = { setUp, restore, MINE_ROUTE };
