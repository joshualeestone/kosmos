'use strict';

/**
 * kosmos#7116 step 2, the caller (Splinter 14:26: step 2 is Mona Lisa's end to end; #7892's roster-change and reviewer
 * screens stay with Kitty). What this Mac's admin needs to approve a member's computer, minus the screen and minus the
 * coordinator routes (step 1, not built when this was; asked on #7116 comment 7021307518):
 *   - the kosmos-se helper, found in THIS app's own bundle (app/bin/kosmos-se beside app/engine), never a path a page
 *     or the coordinator supplies (#7892 gate);
 *   - the inviting admin's join codes, kept on this computer from the invite until the member's enrolment is signed,
 *     owner-only, keyed by company and member: never by the code_hash a coordinator puts in the bytes, so a coordinator
 *     cannot point this computer at a code of its choosing;
 *   - approve(): prepare one enrolment's bytes (with the stored code when this computer holds one) and sign them with
 *     this Mac's Enclave admin key, returning what seadmin.sign returns ({ adminId, sig }).
 *
 * Not here: the screen; fetching the waiting enrolments and posting the signature (step 1's routes); making the admin
 * key (a person at the screen, #7892 gate 6); shipping kosmos-se in the bundle (the release build, with Baron).
 */

const fs = require('node:fs');
const path = require('node:path');
const se = require('./seadmin');

const CODES_FILE = 'devkey-join-codes.json';
// A code past this age is dropped when read: an invite that sat this long is re-sent with a new code, not trusted.
const CODE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
function readCodes(dataRoot) {
  let raw;
  try { raw = fs.readFileSync(codesFile(dataRoot), 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw new Error('the saved invite codes could not be read');
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('the saved invite codes are not readable'); }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}
function writeCodes(codes, dataRoot) {
  const file = codesFile(dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  require('./securewrite').writeSecret(file, JSON.stringify(codes), 0o600, { atomicOnly: true });
}
function text(v, what) {
  if (typeof v !== 'string' || !v) throw new Error('an invite names its ' + what);
  return v;
}

/** Keep the code the inviting admin's app made for (org, member). Replaces an earlier one for the same pair. */
function keepJoinCode(org, member, code, { dataRoot, now = Date.now() } = {}) {
  text(org, 'company'); text(member, 'member');
  if (!(code instanceof Uint8Array) || code.length !== require('./devkeyenrol').CODE_LEN) throw new Error('a join code is 16 bytes');
  const codes = readCodes(dataRoot);
  codes[keyOf(org, member)] = { code: Buffer.from(code).toString('hex'), at: now };
  writeCodes(codes, dataRoot);
}

/** The kept code for (org, member), or null: none kept, or one older than CODE_MAX_AGE_MS. */
function joinCodeFor(org, member, { dataRoot, now = Date.now() } = {}) {
  const hit = readCodes(dataRoot)[keyOf(org, member)];
  if (!hit || typeof hit.code !== 'string' || !/^[0-9a-f]{32}$/.test(hit.code) || !Number.isFinite(hit.at)) return null;
  if (now - hit.at > CODE_MAX_AGE_MS || hit.at > now + 60000) return null;
  return Buffer.from(hit.code, 'hex');
}

/** Drop the kept code for (org, member), once its enrolment is signed (or the invite withdrawn). */
function forgetJoinCode(org, member, { dataRoot } = {}) {
  const codes = readCodes(dataRoot);
  const k = keyOf(org, member);
  if (!(k in codes)) return false;
  delete codes[k];
  writeCodes(codes, dataRoot);
  return true;
}

/**
 * What the screen shows before asking: the decoded enrolment (seadmin.prepare), with the kept code when this computer
 * holds one for the decoded company and member. A kept code that does not match refuses (prepare's own refusal).
 */
function review(bytes, { dataRoot, now } = {}) {
  const decoded = se.decodeDevkeyEnrol(bytes);
  const code = joinCodeFor(decoded.org, decoded.member, { dataRoot, now });
  return se.prepare('devkeyEnrol', bytes, code ? { joinCode: code } : {});
}

/**
 * Sign a reviewed enrolment as this Mac's admin. `adminId` and `expectedKey` are this Mac's enrolled admin id and
 * Enclave public key, `keyFile` its key file; the helper is this app's own. seadmin.sign refuses the inviter unless
 * the code checked. On success the kept code is dropped. Returns { adminId, sig }.
 */
async function approve(prepared, { adminId, expectedKey, keyFile, dataRoot, appDir } = {}) {
  const helper = helperPath(appDir);
  if (!helper) throw new Error('this Kosmos cannot sign as an admin: its admin key helper is not installed');
  const signed = await se.sign(prepared, { helper, keyFile, expectedKey, adminId });
  if (prepared.inviterChecked === true) {
    try { forgetJoinCode(prepared.decoded.org, prepared.decoded.member, { dataRoot }); } catch { /* signed either way */ }
  }
  return signed;
}

/* ---- the coordinator routes (Renet Tilley's pinned interface, #7116 comment 7021733967) ----
   Every call is a signed Mac request (remote.macRequest); the org is always the calling Mac's own, never in a body.
   `send` is that function, injectable for tests. Bytes the coordinator returns are decoded here before anything uses
   them, and a signature leaves only for bytes that decode as an enrolment. */
const ROUTE = '/v1/org/devkey-enrol';
const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (t, what) => {
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]+$/.test(t)) throw new Error('the coordinator sent ' + what + ' we cannot read');
  return Buffer.from(t, 'base64url');
};
const sendOf = (send) => send || ((...a) => require('./remote').macRequest(...a));
const answerOf = (r, doing) => {
  if (!r || r.ok !== true) throw new Error('could not ' + doing + ': ' + ((r && r.because) || 'no answer'));
  return r.data;
};
const idOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

/**
 * The member's Mac starts its enrolment: K (this Mac's key), and the code hash and join tag from the join code it was
 * invited with. The coordinator answers the exact bytes to sign; they are decoded, and must enrol THIS key with the
 * inviter and code asked for. Then this Mac signs them (devkeyenrol.deviceSign) and posts keySig.
 * Returns { id, decoded, expiresAt, answer } (answer: the sign route's, waiting or escrowd's).
 */
async function startAndSign({ org, member, joinCode, inviterAdminId, deviceKey, send } = {}) {
  text(org, 'company'); text(member, 'member'); text(inviterAdminId, 'inviting admin');
  const dk = require('./devkeyenrol');
  const key = deviceKey || require('./backupdevicekey').deviceKey();
  if (!key || key.ok !== true) throw new Error((key && key.because) || 'this computer\'s device key could not be read');
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
  const answer = answerOf(await go('POST', ROUTE + '/' + started.id + '/sign', { keySig: b64(signature) }), 'send this computer\'s signature');
  return { id: started.id, decoded, expiresAt: started.expiresAt || null, answer };
}

/** An admin's list of what waits: [{ id, bytes, signedBy, keySigned, expiresAt }], each entry's bytes decoded later. */
async function pending({ send } = {}) {
  const data = answerOf(await sendOf(send)('GET', ROUTE + '/pending'), 'read the computers waiting for approval');
  const list = data && Array.isArray(data.pending) ? data.pending : null;
  if (!list) throw new Error('the coordinator answered without a list');
  return list.filter((e) => e && idOk(e.id)).map((e) => ({ id: e.id, bytes: unb64(e.bytes, 'enrolment bytes'),
    signedBy: Array.isArray(e.signedBy) ? e.signedBy.filter((x) => typeof x === 'string') : [], keySigned: e.keySigned === true,
    expiresAt: e.expiresAt || null }));
}

/** Post one admin's signature (approve()'s { adminId, sig }) for entry `id`, as escrowd's Wire object. */
async function postAdminSig(id, signed, { send } = {}) {
  if (!idOk(id)) throw new Error('not an enrolment id');
  if (!signed || typeof signed.adminId !== 'string' || !(signed.sig instanceof Uint8Array)) throw new Error('post only what approve returned');
  return answerOf(await sendOf(send)('POST', ROUTE + '/' + id + '/sign', { sig: { adminId: signed.adminId, se: b64(signed.sig) } }),
    'send the approval');
}

module.exports = { CODE_MAX_AGE_MS, helperPath, keepJoinCode, joinCodeFor, forgetJoinCode, review, approve,
  startAndSign, pending, postAdminSig };
