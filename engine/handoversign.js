'use strict';

/**
 * kosmos#8819 (#8764): an admin's own computer signs the start of a hand-over, so escrowd signs the record the leaving
 * computer seals under. The coordinator's route is kosmos-relay handover.rs `mac_sign`
 * (POST /v1/mac/org/handover/sign, docs/coordinator-api.md):
 *   - `{id}` answers `{signed: false, bytes, nonce, generation, expiresAt}`, or `{signed: true}` when already signed;
 *   - `{id, sig, nonce}` relays the signature to escrowd, which checks it against its own roster and signs the record.
 *
 * What this file holds the coordinator to, because a breached coordinator is the case it exists for:
 *   - the bytes are DECODED here (seadmin.decodeHandoverStart) and must name exactly the hand-over the admin is
 *     approving: the company, the hand-over id, the leaving member, the successor and the agents IN THE ORDER SHOWN,
 *     with the nonce and generation the same answer gave. Anything else is refused before the Enclave is asked;
 *   - the signature is over those decoded bytes only (seadmin.prepare / sign), and is posted with the nonce they hold.
 * What it cannot hold the coordinator to (stated, #8764 weakest premise 2): `from` and `to` are account ids, and the
 * names a screen shows for them come from the coordinator. The screen (#8710 slice 5) must show what it can attest.
 *
 * Not here: the screen, making the admin key, shipping kosmos-se (as engine/enrolsign.js).
 */

const se = require('./seadmin');

const ROUTE = '/v1/mac/org/handover/sign';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const sendOf = (send) => send || ((...a) => require('./remote').macRequest(...a));
const b64 = (b) => Buffer.from(b).toString('base64url');
function unb64(t, what) {
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]+$/.test(t)) throw new Error('the coordinator sent ' + what + ' we cannot read');
  const b = Buffer.from(t, 'base64url');
  if (b.toString('base64url') !== t) throw new Error('the coordinator sent ' + what + ' we cannot read');
  return b;
}
/* A person sees only fixed sentences: a route's own `because` can carry a tunnel's line or a spawn error. */
function answerOf(r, doing) {
  if (r && r.ok === true) return r.data;
  throw new Error(`Kosmos+ did not ${doing}; try again in a moment`);
}

/* What the admin is approving, as the screen showed it: { org, id, from, to, agents }. Checked for shape here so a
   caller's mistake is said as one, not as a coordinator's. */
function expectOf(e) {
  const x = e || {};
  for (const k of ['org', 'id', 'from', 'to']) if (typeof x[k] !== 'string' || !x[k]) throw new Error('say which hand-over is being approved');
  if (!Array.isArray(x.agents) || x.agents.length < 1 || !x.agents.every((a) => typeof a === 'string' && a)) throw new Error('say which agents are being handed over');
  return { org: x.org, id: x.id, from: x.from, to: x.to, agents: x.agents.slice() };
}

/**
 * Ask for the bytes of hand-over `expect.id` and review them against `expect`. Returns `{ signed: true }` when an admin
 * already signed it, or `{ signed: false, prepared, nonce, expiresAt }`, where `prepared` is what approveAndSend takes.
 * Throws a fixed sentence when the bytes name anything other than `expect`.
 */
async function review(expect, { send } = {}) {
  const want = expectOf(expect);
  if (!ID.test(want.id)) throw new Error('not a hand-over id');
  const data = answerOf(await sendOf(send)('POST', ROUTE, { id: want.id }), 'give the hand-over to sign');
  if (data && data.signed === true) return { signed: true };
  const bytes = unb64(data && data.bytes, 'hand-over bytes');
  const nonceText = data && data.nonce;
  const nonce = unb64(nonceText, 'a nonce');
  let prepared;
  try { prepared = se.prepare('handoverStart', bytes); } catch { throw new Error('Kosmos+ sent something to sign that is not a hand-over'); }
  const d = prepared.decoded;
  // Every field the admin approved, the agents in the order shown; and the nonce the bytes hold is the one answered.
  const same = d.org === want.org && d.id === want.id && d.from === want.from && d.to === want.to
    && d.agents.length === want.agents.length && d.agents.every((a, i) => a === want.agents[i]);
  if (!same) throw new Error('Kosmos+ asked you to sign a different hand-over from the one shown, so nothing was signed');
  if (!d.nonce.equals(nonce)) throw new Error('Kosmos+ sent a hand-over whose parts do not agree, so nothing was signed');
  if (data.generation !== undefined && String(data.generation) !== String(d.generation)) throw new Error('Kosmos+ sent a hand-over whose parts do not agree, so nothing was signed');
  return { signed: false, prepared, nonce: nonceText, expiresAt: Number.isFinite(data.expiresAt) ? data.expiresAt : null };
}

/**
 * Sign a reviewed hand-over start with this Mac's Enclave admin key and post it with its nonce. `opts`: adminId,
 * expectedKey, keyFile (this Mac's enrolled admin), appDir (whose bin/kosmos-se is used), send. Returns the route's
 * answer; `signed: true` there means escrowd's record is kept.
 */
async function approveAndSend(reviewed, opts = {}) {
  if (!reviewed || reviewed.signed !== false || !reviewed.prepared) throw new Error('approve only what review returned');
  const helper = require('./enrolsign').helperPath(opts.appDir);
  if (!helper) throw new Error('this Kosmos cannot sign as an admin: its admin key helper is not installed');
  const signed = await se.sign(reviewed.prepared, { helper, keyFile: opts.keyFile, expectedKey: opts.expectedKey, adminId: opts.adminId });
  const id = reviewed.prepared.decoded.id;
  return answerOf(await sendOf(opts.send)('POST', ROUTE, { id, sig: { adminId: signed.adminId, se: b64(signed.sig) }, nonce: reviewed.nonce }),
    'take the signature');
}

module.exports = { ROUTE, review, approveAndSend };
