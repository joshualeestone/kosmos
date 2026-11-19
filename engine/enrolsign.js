'use strict';

/**
 * kosmos#7116 step 2, the caller (Splinter 14:26: step 2 is Mona Lisa's end to end; #7892's roster-change and reviewer
 * screens stay with Kitty). What this Mac does for a device-key enrolment, minus the screen itself:
 *   - finds the kosmos-se helper in THIS app's own bundle (app/bin/kosmos-se), never a path a page or the coordinator gives;
 *   - keeps the inviting admin's join code, owner-only, keyed by company and member (never by a code_hash a coordinator
 *     sends). approve() ties it to one computer's key BEFORE signing (the tie lasts one hour, an entry's 30 minutes with
 *     margin), and approveAndSend() drops it when escrowd accepts THIS Mac's post (an accept that lands on another
 *     admin's Mac leaves it, and it then expires). One invite enrols one computer;
 *   - review() decodes an enrolment and checks it with the kept code when this Mac holds one; approve() signs the
 *     reviewed bytes with this Mac's Enclave admin key;
 *   - talks to the coordinator's three routes (Renet Tilley's pinned interface, #7116 comment 7021733967): the member's
 *     Mac starts and signs (startAndSign), an admin lists (pending, adminQueue) and posts an approval (postAdminSig).
 * Not here: the screen (it waits on where invites are made, #7116 comment 7021307518); making the admin key (a person at
 * the screen, #7892 gate 6); shipping kosmos-se (sebundle-7116, with Baron). */

const fs = require('node:fs');
const path = require('node:path');
const se = require('./seadmin');

const CODES_FILE = 'devkey-join-codes.json';
// A code past this age is dropped when read: an invite that sat this long is re-sent with a new code, not trusted.
const CODE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Review 4: once tied to a computer, a code lives only as long as an enrolment entry can (escrowd's nonce: 30 minutes),
// with margin; after that this Mac never checks with it again, so a later re-enrolment of that computer is re-invited.
const BOUND_MAX_AGE_MS = 60 * 60 * 1000;

/** The helper this app ships, or null when this install has none (an older bundle, or a source checkout). */
function helperPath(appDir = path.join(__dirname, '..')) {
  const p = path.join(appDir, 'bin', 'kosmos-se');
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) return null;   // a link or anything else is not the bundle's own binary
    fs.accessSync(p, fs.constants.X_OK);
    return p;
  } catch { return null; }
}

function codesFile(dataRoot) { return path.join(dataRoot || require('./store').root(), CODES_FILE); }
const keyOf = (org, member) => JSON.stringify([org, member]);   // no separator a name can contain can collide
const DAMAGED = 'the saved invite codes are not readable';   // the one state a new code may set aside (review 2)
function readCodes(dataRoot) {
  const file = codesFile(dataRoot);
  let raw;
  try {
    // Review 2: a link or anything but a plain file is damage, never followed.
    const st = fs.lstatSync(file);
    if (!st.isFile()) throw Object.assign(new Error(DAMAGED), { damaged: true });
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    if (err && err.damaged) throw err;
    throw new Error('the saved invite codes could not be read');
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw Object.assign(new Error(DAMAGED), { damaged: true }); }
  // Review 4: valid JSON of the wrong shape is damage too (set aside by a new code, never silently overwritten).
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error(DAMAGED), { damaged: true });
  return parsed;
}
function writeCodes(codes, dataRoot) {
  const file = codesFile(dataRoot);
  // Review 1: a write error's message carries the data root's path; a person is shown a fixed sentence instead.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });   // review 3: owner-only when made here
    require('./securewrite').writeSecret(file, JSON.stringify(codes), 0o600, { atomicOnly: true });
  } catch { throw new Error('the invite code could not be saved on this computer'); }
}
/* Review 1: a store that cannot be read is set aside (renamed, never deleted: it may hold a code a person wants back)
   when a NEW code is kept, so one damaged file does not stop every later invite. Reading still refuses it, so a
   check never treats a damaged store as "no code". */
function readCodesForWrite(dataRoot) {
  try { return readCodes(dataRoot); } catch (err) {
    if (!err || !err.damaged) throw new Error('the invite code could not be saved on this computer');   // review 2: a read error is not damage
    const file = codesFile(dataRoot);
    try { fs.renameSync(file, file + '.unreadable-' + Date.now()); } catch { throw new Error('the invite code could not be saved on this computer'); }
    return {};
  }
}
function text(v, what) {
  if (typeof v !== 'string' || !v) throw new Error('an invite names its ' + what);
  return v;
}

/** Keep the code the inviting admin's app made for (org, member). Replaces an earlier one for the same pair. */
function keepJoinCode(org, member, code, { dataRoot, now = Date.now() } = {}) {
  text(org, 'company'); text(member, 'member');
  if (!(code instanceof Uint8Array) || code.length !== require('./devkeyenrol').CODE_LEN) throw new Error('a join code is 16 bytes');
  const codes = readCodesForWrite(dataRoot);
  codes[keyOf(org, member)] = { code: Buffer.from(code).toString('hex'), at: now };
  writeCodes(codes, dataRoot);
}

/** The kept code for (org, member), or null: none kept, or one older than CODE_MAX_AGE_MS. With `forKey`, a code
 * already used for ANOTHER computer's key (bindJoinCode) is refused: one invite enrols one computer (review 2). */
function joinCodeFor(org, member, { dataRoot, now = Date.now(), forKey } = {}) {
  const hit = readCodes(dataRoot)[keyOf(org, member)];
  if (!hit || typeof hit.code !== 'string' || !/^[0-9a-f]{32}$/.test(hit.code) || !Number.isFinite(hit.at)) return null;
  if (now - hit.at > CODE_MAX_AGE_MS || hit.at > now + 60000) return null;
  // Review 7: a tie past its hour is checked first, so it refuses other computers for that hour only, as BOUND_MAX_AGE_MS says.
  if (typeof hit.key === 'string' && (!Number.isFinite(hit.boundAt) || now - hit.boundAt > BOUND_MAX_AGE_MS || hit.boundAt > now + 60000)) return null;   // review 4, 5
  if (forKey && typeof hit.key === 'string' && hit.key !== Buffer.from(forKey).toString('hex')) {
    throw new Error('this invite was already used for another computer');
  }
  return Buffer.from(hit.code, 'hex');
}
/** Before the inviter signs (approve): the kept code is tied to that computer's key from then on. */
function bindJoinCode(org, member, key, { dataRoot } = {}) {
  const codes = readCodes(dataRoot);
  const hit = codes[keyOf(org, member)];
  if (!hit) return false;
  const want = Buffer.from(key).toString('hex');
  // Review 3: never re-tie a code to a second computer.
  if (typeof hit.key === 'string' && hit.key !== want) throw new Error('this invite was already used for another computer');
  if (hit.key === want) return true;
  hit.key = want;
  hit.boundAt = Date.now();
  writeCodes(codes, dataRoot);
  return true;
}

/** Drop the kept code for (org, member), once escrowd accepts its enrolment (or the invite is withdrawn). */
function forgetJoinCode(org, member, { dataRoot } = {}) {
  const codes = readCodes(dataRoot);
  const k = keyOf(org, member);
  if (!(k in codes)) return false;
  delete codes[k];
  writeCodes(codes, dataRoot);
  return true;
}

/* Review 7: a kept code is this entry's invite only when its hash is the entry's codeHash. Another admin's invite for
   the same member carries another code, and this Mac reviews it as a second admin (seadmin.sign and adminQueue still
   refuse this Mac signing as an inviter it did not check). Same hash, wrong tag: prepare's own refusal. `keptOther`
   says this Mac holds a code for that member that is not this entry's. */
/* Review 8: the hash is compared with the code ON DISK, before the age and tie filters. Otherwise a code past its
   30 days or its tie's hour read as "no code", and an entry carrying this Mac's own invite was offered to it as
   another admin's. A match on a stale code refuses (send a new invite). After escrowd accepts, the record is gone and
   this Mac is like any admin without the code: the inviter's own check is then what escrowd relies on. */
function storedCode(org, member, dataRoot) {
  const hit = readCodes(dataRoot)[keyOf(org, member)];
  if (hit === undefined) return null;
  // Kitty's read of review 8: a record that is there but not a code is damage, refused, never "no code" (which would
  // put this Mac back in the second admin's seat for what may be its own invite).
  if (!hit || typeof hit.code !== 'string' || !/^[0-9a-f]{32}$/.test(hit.code)) throw Object.assign(new Error(DAMAGED), { damaged: true });
  return Buffer.from(hit.code, 'hex');
}
function keptFor(decoded, { dataRoot, now } = {}) {
  const stored = storedCode(decoded.org, decoded.member, dataRoot);
  if (!stored) return { code: null, keptOther: false };
  const dk = require('./devkeyenrol');
  if (!require('node:crypto').timingSafeEqual(dk.joinCodeHash(stored), Buffer.from(decoded.codeHash))) {
    return { code: null, keptOther: !!joinCodeFor(decoded.org, decoded.member, { dataRoot, now }) };
  }
  // This entry's own invite: refused when it is already tied to another computer (one invite enrols one computer),
  // and when it is past its age or its tie's hour.
  const code = joinCodeFor(decoded.org, decoded.member, { dataRoot, now, forKey: decoded.key });
  if (!code) throw new Error('this invite has expired: send a new one');
  return { code, keptOther: false };
}
function reviewOf(bytes, opts = {}) {
  const decoded = se.decodeDevkeyEnrol(bytes);
  const { code, keptOther } = keptFor(decoded, opts);
  return { prepared: se.prepare('devkeyEnrol', bytes, code ? { joinCode: code } : {}), keptOther };
}
/**
 * What the screen shows before asking: the decoded enrolment (seadmin.prepare), with the kept code when this computer
 * holds this entry's invite code for the decoded company and member (keptFor). A kept code with the entry's hash that
 * does not match refuses (prepare's own refusal).
 */
function review(bytes, opts = {}) { return reviewOf(bytes, opts).prepared; }

/**
 * Sign a reviewed enrolment as this Mac's admin. `adminId` and `expectedKey` are this Mac's enrolled admin id and
 * Enclave public key, `keyFile` its key file; the helper is this app's own. seadmin.sign refuses the inviter unless
 * the code checked. The kept code is tied to this computer here, never dropped (approveAndSend drops it once escrowd accepts). Returns { adminId, sig }.
 */
async function approve(prepared, { adminId, expectedKey, keyFile, appDir, dataRoot } = {}) {
  const helper = helperPath(appDir);
  if (!helper) throw new Error('this Kosmos cannot sign as an admin: its admin key helper is not installed');
  /* Review 1: this computer holds the invite's code, so it IS the inviter, whatever admin the bytes name; signing as a
     "second admin" would put the inviter's signature on bytes that name someone else. (seadmin.sign's review 4 note.) */
  if (prepared && prepared.inviterChecked === true && adminId !== prepared.decoded.inviterAdminId) {
    throw new Error('you sent this invite, but the enrolment names another admin as the one who sent it');
  }
  /* Review 3: the inviter's code is tied to THIS computer's key BEFORE the signature exists (re-checked here, not only
     in review, so a stale list or a second entry cannot get it for another key). A lost answer then leaves it tied, never
     free. The code is NOT dropped here (review 1): a refusal or a restarted entry for the same computer needs it again. */
  if (prepared && prepared.inviterChecked === true) {
    const { org, member, key } = prepared.decoded;
    const kept = joinCodeFor(org, member, { dataRoot, forKey: key });
    if (!kept) throw new Error('you sent this invite, but its join code is no longer on this computer');
    // Review 4: and it is still the code this enrolment was checked with (a re-invite since then keeps a new one).
    if (!require('./devkeyenrol').matchesJoinCode(kept, prepared.decoded)) throw new Error('you sent a new invite since this one: review it again');
    bindJoinCode(org, member, key, { dataRoot });
  } else if (prepared && prepared.decoded) {
    // Review 7: reviewed without this entry's code, but this computer holds it now (kept since): review it again.
    if (keptFor(prepared.decoded, { dataRoot }).code) throw new Error('you sent this invite: review it again');
  }
  return se.sign(prepared, { helper, keyFile, expectedKey, adminId });
}

/**
 * Approve and send: sign (approve), post the signature (postAdminSig), and only when escrowd has ACCEPTED the
 * enrolment (the answer is escrowd's ok, not "waiting") drop the kept code. Returns the route's answer.
 */
async function approveAndSend(id, prepared, opts = {}) {
  const signed = await approve(prepared, opts);
  const answer = await postAdminSig(id, signed, opts);
  if (prepared.inviterChecked === true) {
    const { org, member, key } = prepared.decoded;
    // Bound in approve (review 3); dropped once escrowd accepts.
    void key;
    try {
      // Review 5: only the code this entry was checked with; a re-invite kept meanwhile stays.
      const kept = joinCodeFor(org, member, { dataRoot: opts.dataRoot });
      if (answer && answer.ok === true && answer.waiting !== true && kept && require('./devkeyenrol').matchesJoinCode(kept, prepared.decoded)) {
        forgetJoinCode(org, member, { dataRoot: opts.dataRoot });
      }
    } catch { /* posted either way */ }
  }
  return answer;
}

/* ---- the coordinator routes (Renet Tilley's pinned interface, #7116 comment 7021733967, as corrected 14:45) ----
   Every call is a signed Mac request (remote.macRequest); the org is always the calling Mac's own, never in a body.
   All three are POST on fixed paths (a signed request signs its path, so the entry's id goes in the body).
   `send` is that function, injectable for tests. Bytes the coordinator returns are decoded here before anything uses
   them, and a signature leaves only for bytes that decode as an enrolment. */
const ROUTE = '/v1/org/devkey-enrol';
const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (t, what) => {
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]+$/.test(t)) throw new Error('the coordinator sent ' + what + ' we cannot read');
  return Buffer.from(t, 'base64url');
};
const BUSY = new Set(['this computer is being forgotten; try again in a moment', 'this computer is still signing in; give it a minute']);
const sendOf = (send) => send || ((...a) => require('./remote').macRequest(...a));
/* Review 2: a person sees only fixed sentences; macRequest's `because` can carry a tunnel's line or a spawn error. A
   coordinator refusal's public code (letters, digits, _) is kept on the error for the screen.
   Review 6: `entry` is given only for a sign call, whose refusal is a relayed submission that either ends the entry or
   leaves it open; then the error also carries `ended` and the entry's `id` and `expiresAt`, so a Mac told it stays can
   post a fresh signature to it. `ended` is true, false, or left undefined when no readable code came back (a timeout,
   an outage, an older tunnel): undefined means "not known", and the caller reads the pending list again. */
const answerOf = (r, doing, entry) => {
  if (!r || r.ok !== true) {
    // Review 7: remote.busy()'s two sentences are fixed and say what is true; any other `because` stays hidden.
    const why = r && r.notSent && BUSY.has(r.because) ? r.because
      : r && r.notSent ? 'this computer is not connected to Kosmos+' : 'Kosmos+ did not answer';
    const err = new Error('could not ' + doing + ': ' + why);
    if (r && r.refusal && typeof r.refusal.code === 'string') err.code = r.refusal.code;
    if (entry) {
      err.id = entry.id; err.expiresAt = entry.expiresAt === undefined ? null : entry.expiresAt;
      if (err.code) err.ended = endsEntry(err.code);
    }
    throw err;
  }
  return r.data;
};
/* Renet's correction 2 (from Kitty's rosterops::devkey_enrol): a refused submission leaves the entry open, for a fresh
   signature, only on these codes, which spend nothing; every other code ends it (devkey_already_enrolled too: that key
   is already enrolled, so there is nothing to start again; any other ended entry is started again by the member's Mac).
   The tunnel keeps a refusal's code but not its `ended` field, so the board works it out from the code; a 2xx answer
   that carries `ended` is read as it says (endedOf). */
const STAYS = new Set(['roster_signers', 'devkey_inviter_not_signer', 'roster_bad_signature', 'roster_bad_assertion',
  'roster_admin_synced_passkey', 'roster_new_key_signature', 'bad_request']);
const endsEntry = (code) => !STAYS.has(code);
/* Review 7: true when the entry is gone (refused for good); false while it waits, once it is accepted, or when a refusal
   leaves it open; undefined for a refusal with no readable code (not known, as answerOf's). */
const endedOf = (data) => {
  if (data && typeof data.ended === 'boolean') return data.ended;
  if (data && typeof data.code === 'string') return endsEntry(data.code);
  return data && data.ok === false ? undefined : false;
};
const idOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

/**
 * The member's Mac starts its enrolment: K (this Mac's key), and the code hash and join tag from the join code it was
 * invited with. The coordinator answers the exact bytes to sign; they are decoded, and must enrol THIS key with the
 * inviter and code asked for. Then this Mac signs them (devkeyenrol.deviceSign) and posts keySig.
 * Returns { id, decoded, expiresAt, answer, ended } (answer: the sign route's, waiting or escrowd's; ended: endedOf). A refused sign throws an error carrying code, ended, id and expiresAt (answerOf).
 */
async function startAndSign({ org, member, joinCode, inviterAdminId, deviceKey, send } = {}) {
  text(org, 'company'); text(member, 'member'); text(inviterAdminId, 'inviting admin');
  const dk = require('./devkeyenrol');
  const key = deviceKey || require('./backupdevicekey').deviceKey();
  if (!key || key.ok !== true) throw new Error('this computer\'s device key could not be read');   // review 2: fixed
  const k = dk.rawPublic(key.publicKey);
  const go = sendOf(send);
  // The body never names the org (the coordinator uses the caller's own), but the join tag binds it, so a Mac that
  // computed it for another org makes bytes deviceSign then refuses (it checks the decoded org is the one given).
  const started = answerOf(await go('POST', ROUTE, { key: b64(k), codeHash: b64(dk.joinCodeHash(joinCode)),
    joinTag: b64(dk.joinTag(joinCode, org, member, k)), inviterAdminId }), 'start the enrolment');
  if (!started || !idOk(started.id)) throw new Error('the coordinator did not name the enrolment');
  const bytes = unb64(started.bytes, 'enrolment bytes');
  const decoded = se.decodeDevkeyEnrol(bytes);
  if (decoded.inviterAdminId !== inviterAdminId) throw new Error('the enrolment names a different inviting admin from the one asked');
  const { signature } = dk.deviceSign(bytes, { org, member, deviceKey: key, joinCode });
  const exp = (typeof started.expiresAt === 'string' && started.expiresAt.length <= 64) || Number.isFinite(started.expiresAt) ? started.expiresAt : null;
  const answer = answerOf(await go('POST', ROUTE + '/sign', { id: started.id, keySig: b64(signature) }), 'send this computer\'s signature',
    { id: started.id, expiresAt: exp });
  return { id: started.id, decoded, expiresAt: exp, answer, ended: endedOf(answer) };
}

/** An admin's list of what waits: [{ id, bytes, signedBy, keySigned, expiresAt }], each entry's bytes decoded later. */
async function pending({ send } = {}) {
  const data = answerOf(await sendOf(send)('POST', ROUTE + '/pending', {}), 'read the computers waiting for approval');
  const list = data && Array.isArray(data.pending) ? data.pending : null;
  if (!list) throw new Error('the coordinator answered without a list');
  // Review 1: one entry's unreadable bytes make THAT entry refused (bytes null), never the whole list unreadable.
  const bytesOf = (t) => { try { return unb64(t, 'enrolment bytes'); } catch { return null; } };
  return list.filter((e) => e && idOk(e.id)).map((e) => ({ id: e.id, bytes: bytesOf(e.bytes),
    signedBy: Array.isArray(e.signedBy) ? e.signedBy.filter((x) => typeof x === 'string') : [], keySigned: e.keySigned === true,
    expiresAt: (typeof e.expiresAt === 'string' && e.expiresAt.length <= 64) || Number.isFinite(e.expiresAt) ? e.expiresAt : null }));
}

/** Post one admin's signature (approve()'s { adminId, sig }) for entry `id`, as escrowd's Wire object. */
async function postAdminSig(id, signed, { send } = {}) {
  if (!idOk(id)) throw new Error('not an enrolment id');
  if (!signed || typeof signed.adminId !== 'string' || !(signed.sig instanceof Uint8Array)) throw new Error('post only what approve returned');
  const answer = answerOf(await sendOf(send)('POST', ROUTE + '/sign', { id, sig: { adminId: signed.adminId, se: b64(signed.sig) } }),
    'send the approval', { id });
  // Review 6: as startAndSign's, a 2xx answer says whether the entry ended.
  return answer && typeof answer === 'object' ? { ...answer, ended: endedOf(answer) } : answer;
}

/**
 * What the admin screen lists: each waiting enrolment, reviewed here (decoded, with this Mac's kept code when it is the
 * inviter), as { id, prepared, member, fingerprint, inviterChecked, unusual, signedBy, keySigned, expiresAt, refused }.
 * `prepared` is what approve() takes. An entry whose bytes do not decode, or whose kept code does not match, is listed
 * with `refused` (the reason, a fixed sentence) and no `prepared`, so the screen can say so and never offer to sign it.
 * Entries this admin already signed are left out (signedBy names them).
 */
async function adminQueue({ adminId, send, dataRoot, now } = {}) {
  text(adminId, 'admin');
  const out = [];
  for (const e of await pending({ send })) {
    if (e.signedBy.includes(adminId)) continue;
    const row = { id: e.id, signedBy: e.signedBy, keySigned: e.keySigned, expiresAt: e.expiresAt };
    try {
      if (!e.bytes) throw new Error('unreadable');
      const { prepared, keptOther } = reviewOf(e.bytes, { dataRoot, now });
      Object.assign(row, { prepared, member: prepared.shown.member, fingerprint: prepared.fingerprint,
        inviterChecked: prepared.inviterChecked, unusual: prepared.unusual, refused: null });
      // The inviter whose code is not on this computer cannot sign (seadmin.sign refuses); say so before asking.
      if (prepared.decoded.inviterAdminId === adminId && !prepared.inviterChecked) {
        Object.assign(row, { prepared: null, refused: keptOther ? 'this enrolment does not match the invite you sent'   // review 7: re-invited since
          : 'you sent this invite, but its join code is not on this computer' });
      }
      if (prepared.inviterChecked && prepared.decoded.inviterAdminId !== adminId) {   // review 1: approve() refuses it
        Object.assign(row, { prepared: null, refused: 'you sent this invite, but it names another admin as the one who sent it' });
      }
    } catch (err) {
      const m = String(err && err.message);
      const why = /does not match that enrolment/.test(m) ? 'this enrolment does not match the invite you sent'
        : /saved invite codes/.test(m) ? 'the invite codes saved on this computer could not be read'   // review 1: the store, not the entry
        : /already used for another computer/.test(m) ? 'your invite was already used for another computer'   // review 2
        : /invite has expired/.test(m) ? 'your invite has expired: send a new one'   // review 8
        : 'this enrolment could not be read';
      Object.assign(row, { prepared: null, member: null, fingerprint: null, inviterChecked: false, unusual: false, refused: why });
    }
    out.push(row);
  }
  return out;
}

module.exports = { CODE_MAX_AGE_MS, helperPath, keepJoinCode, joinCodeFor, forgetJoinCode, review, approve,
  startAndSign, pending, postAdminSig, adminQueue, approveAndSend, endsEntry, endedOf };
