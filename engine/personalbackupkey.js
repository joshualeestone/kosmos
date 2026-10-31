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
 * the member key (which this disk already holds in the clear), a retry re-sends the same member key, recovery key and
 * tag (the wrap is HPKE-randomised; the coordinator answers a repeat naming the same key, recovery key and tag as
 * registered, keeping its first wrap) and answers the SAME code, and a row that is our own (our key, our code's
 * recovery key, and it opens with our code and its tag) is answered as ours, before AND after this computer marked it
 * registered (review 2: a crash after a successful setUp, before the screen showed the code). The file goes only when
 * the screen confirms AND the key is registered here, found locally (no network needed to delete a secret).
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
 * enroll), and a new epoch. All of it stays behind
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
/* The pending code: { code, pk }, null when there is none, or { unreadable: true } when a file is there but cannot be
   read (review 3: a passing read error must never look like "none", or a retry would overwrite a code Kosmos+ holds). */
function readPending(org, member) {
  let raw;
  try { raw = fs.readFileSync(pendingFile(org, member), 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? null : { unreadable: true }; }
  try {
    const got = JSON.parse(raw);
    const bytes = unb64(got && got.code, 16), pk = unb64(got && got.pk, 32);
    if (got.org !== org || got.member !== member || !bytes || !pk) return { unreadable: true };
    return { code: backupkeys.formatRecoveryCode(bytes), pk };
  } catch { return { unreadable: true }; }
}

/* The full check that a kept epoch-1 row is OURS (review 3: one helper for the success and resume paths): our key,
   our code's recovery key, and it opens with the code and its tag. */
function rowIsOurs(row, key, code, org, member) {
  if (!row || row.epoch !== 1 || !row.memberPk.equals(key.pk) || !row.tag) return false;
  const rk = backupkeys.recoveryKeysFromCode(code);
  return row.recoveryPk.equals(rk.pk) && Boolean(backupkeys.unwrapMemberKeyFromRecovery(rk, row.wrap, { org, member, epoch: '1' }, key.pk, row.tag));
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
    const pending = readPending(org, member);
    if (pending && pending.unreadable) return refused('the recovery code kept on this computer could not be read, so setup stops rather than replace it. If Kosmos+ lists no backup key for this account, the file ' + path.basename(pendingFile(org, member)) + ' in the backup keys folder can be removed and setup run again');
    // Our own registration (its answer lost, or a crash before the screen showed the code, review 2): the one epoch-1
    // row is our key, our pending code's recovery key, and it OPENS with that code and its tag. Answered with the same
    // code, registered here if it was not yet, until the screen confirms. Checked in full, so a row the code could not
    // restore (no tag, a bad wrap) is never answered as set up.
    if (rows.length && own && pending && pending.pk.equals(own.pk)) {
      if (rows.length === 1 && rowIsOurs(rows[0], own, pending.code, org, member)) {
        if (!own.registered) memberkeys.writeKeys(org, member, { 1: { sk: own.sk, pk: own.pk, registered: true } });
        return { ok: true, code: pending.code, epoch: 1, resumed: true, org, member };
      }
      return refused('Kosmos+ holds a backup key this computer\'s recovery code does not open; nothing was changed');
    }
    // Only an empty file, or exactly our own pending epoch 1: a registered key is never replaced, and nothing may sit
    // below another epoch (the file's invariant), so anything else is refused, never overwritten.
    // (Review 3: a registered epoch 1 with ITS pending code, and Kosmos+ listing nothing, re-sends the same
    // registration: Kosmos+ lost it while this computer still holds the key and the code.)
    const healing = own && own.registered && pending && pending.pk.equals(own.pk) && epochs.length === 1 && !rows.length;
    if (!healing && (epochs.length > 1 || (epochs.length === 1 && (epochs[0] !== '1' || own.registered)))) {
      return refused('this computer already holds backup keys for this account; restore them instead of setting up again', 'already_here');
    }
    if (rows.length) return refused('this backup already has a recovery code; restore it with that code', 'already_set_up');
    const epoch = 1;
    const key = own ? { sk: own.sk, pk: own.pk } : backupkeys.newMemberKey();
    // The same code for the same pending key, so a retry re-sends the same key, recovery key and tag.
    const code = pending && pending.pk.equals(key.pk) ? pending.code : backupkeys.newRecoveryCode();
    // Kept BEFORE sending: the key, then the code (an answer lost after Kosmos+ kept them must lose neither).
    if (!healing) memberkeys.writeKeys(org, member, { [String(epoch)]: { sk: key.sk, pk: key.pk, registered: false } });
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
    // Review 2: as the company path (backupmemberkey.js), registered only when the answer names THIS key and epoch, so
    // a changed coordinator or tunnel shape is not taken as registered (it would strand setUp and restore both).
    if (!res.data || res.data.epoch !== epoch || res.data.member_public !== b64(key.pk)) {
      return refused('Kosmos+ answered in a form this computer does not read; try again (the same key and code are kept for it)');
    }
    // Review 3: the success path checks the row Kosmos+ STORED, as the resume path does, while this computer still has
    // the key and the code (a benign coordinator bug that dropped the tag is found now, not at the first restore).
    const back = await readContext(macRequest);
    const stored = back.ok && back.ctx.rows.length === 1 ? back.ctx.rows[0] : null;
    if (!stored) return refused('Kosmos+ took the backup key, but what it kept could not be checked; try again (the key and code are kept for it)');
    if (!rowIsOurs(stored, key, code, org, member)) {
      return refused('Kosmos+ kept the backup key in a form this recovery code does not open; the key and code are kept on this computer');
    }
    memberkeys.writeKeys(org, member, { [String(epoch)]: { sk: key.sk, pk: key.pk, registered: true } });
    return { ok: true, code, epoch, org, member };
  } catch { return refused('setting up the backup key failed on this computer'); }
}

/** The person saved the code: delete this computer's copy of it, found locally (no network: a secret must be
    deletable offline). Only a code whose key is REGISTERED here is deleted; one still pending is kept, so a retry can
    finish (review 2). Answers { ok: true, deleted } or { ok: false, because } when a code is still pending. */
function confirmRecoveryCodeSaved(who = {}) {
  return serial(async () => {
    try {
      // Review 3: scoped to the (org, member) setUp answered, so another account's file never decides this answer.
      if (typeof who.org !== 'string' || typeof who.member !== 'string') return refused('confirm needs the org and member setUp answered');
      const p = readPending(who.org, who.member);
      if (!p) return { ok: true, deleted: 0 };
      if (p.unreadable) return refused('the recovery code kept on this computer could not be read; it was left as it is');
      const k = memberkeys.readKeys(who.org, who.member);
      const one = k.ok && k.keys['1'];
      // Registered with this code: delete. Registered with ANOTHER key (a restore under another code, or another
      // computer's setup): this code can never be registered, so it is dead: delete. Not registered: keep it.
      if (one && one.registered) { fs.rmSync(pendingFile(who.org, who.member), { force: true }); return { ok: true, deleted: 1 }; }
      return refused('the recovery code is not registered with Kosmos+ yet; finish setting up first, then confirm');
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
    /* #7681 review: readContext reads the account's CURRENT membership, whatever org that is. A caller that knows which
       backup it means (personalbackup.restore) passes it, so a turn-off and a turn-on to another org during the read
       restores nothing rather than that org's keys. */
    if (typeof opts.expectOrg === 'string' && org !== opts.expectOrg) return refused('personal backup changed on this computer while restoring, so nothing was restored', 'not_on');
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
    // A registered key here is never replaced (review 2): a different key at the same epoch refuses the restore and
    // writes nothing. Registered keys Kosmos+ does not list are kept; unregistered ones give way to what Kosmos+ holds.
    const merged = {};
    for (const [e, k] of Object.entries(kept.keys)) {
      if (!k.registered) continue;
      if (opened[e] && !opened[e].pk.equals(k.pk)) return refused('this computer holds a different backup key for that epoch; nothing was restored', 'key_conflict');
      merged[e] = k;
    }
    // #7681 review: the last moment before anything is written, with no await between this and the write, so a
    // turn-off cannot land in between. A caller that passes stillOurs is asked once more.
    if (typeof opts.stillOurs === 'function' && !opts.stillOurs()) return refused('personal backup changed on this computer while restoring, so nothing was restored', 'not_on');
    memberkeys.writeKeys(org, member, { ...merged, ...opened });
    // Review 3: ANY pending code goes once a restore succeeds: every epoch is wrapped to the code that just restored,
    // so another pending code restores nothing and could never be registered.
    fs.rmSync(pendingFile(org, member), { force: true });
    return { ok: true, epochs: rows.map((r) => r.epoch) };
  } catch { return refused('restoring the backup keys failed on this computer'); }
}

/** kosmos#7404 (pbjob-7404): the backup job's key step, in place of ensureMemberKey (whose company-key read Kosmos+ refuses
    for a personal org for good). It only reads: the newest epoch Kosmos+ lists for `orgId`, answered when this computer
    holds that same registered key. It never registers and never starts an epoch, because a new epoch has to be wrapped
    to the person's recovery code, which this computer does not keep. Sealing needs the public key alone.
    { ok: true, epoch, publicKey, org, member }, or { ok: false, because, personActs?, unreadableKeyFile?, refusal? }. */
function personalKeyForJob(orgId, opts = {}) { return serial(() => jobKeyNow(orgId, opts)); }
const actOn = (because, named) => Object.assign({ ok: false, personActs: true, because }, named);
async function jobKeyNow(orgId, opts) {
  try {
    const read = await readContext(macRequestOf(opts));
    if (!read.ok) return Object.assign({ ok: false, because: read.because }, read.code ? { refusal: { code: read.code } } : {});
    const { org, member, rows } = read.ctx;
    const named = { org, member };
    if (typeof orgId !== 'string' || org !== orgId) return actOn('this account is no longer in the personal backup on this computer, so nothing was backed up');
    const row = rows.reduce((a, b) => (!a || b.epoch > a.epoch ? b : a), null);
    if (!row) return actOn('this backup has no key on Kosmos+ yet, so nothing was backed up', named);
    const kept = memberkeys.readKeys(org, member);
    if (!kept.ok) return Object.assign(actOn('the backup key file on this computer could not be read; it was left as it is', named), { unreadableKeyFile: true });
    const k = kept.keys[String(row.epoch)];
    if (!Object.keys(kept.keys).length) return actOn('this computer does not hold the key Kosmos+ lists for this backup, so nothing was backed up. Turn personal backup off here, then on again, and enter your recovery code', named);
    if (!k || !k.registered || !k.pk.equals(row.memberPk)) return actOn('this computer holds a different key from the one Kosmos+ lists for this backup, so nothing was backed up; its key file was left as it is', named);
    // Only a lostEpoch recorded for this pair, as ensureMemberKey's lostFor.
    const lostHere = opts.lostFor && opts.lostFor.org === org && opts.lostFor.member === member && Number.isSafeInteger(opts.lostEpoch);
    if (lostHere && opts.lostEpoch >= row.epoch) return actOn('Kosmos+ asked for a newer key than this backup lists, so nothing was backed up', named);
    return { ok: true, epoch: row.epoch, publicKey: row.memberPk, org, member };
  } catch { return refused('the backup key could not be read on this computer'); }
}

/** kosmos#7404 (personalswitch-7404 review 5): whether a recovery code is still waiting to be confirmed for (org,
    member), read locally. True for an unreadable file too: setup then stops and says so rather than look finished. */
function hasPendingCode(org, member) {
  if (typeof org !== 'string' || typeof member !== 'string') return false;
  return readPending(org, member) !== null;
}

module.exports = { setUpPersonalKey, confirmRecoveryCodeSaved, restorePersonalKey, personalKeyForJob, hasPendingCode, MINE_ROUTE };
