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
// Review 1 (Mona Lisa): what review() returned, and only that, may be signed, once. A hand-built object holding
// se.prepare() of other bytes is not in here, so it is never signed.
const REVIEWED = new WeakSet();
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
  // Review 2 (April): a repeat in what the screen shows is the screen's mistake, said as one.
  if (new Set(x.agents).size !== x.agents.length) throw new Error('the same agent is listed twice');
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
  // Kosmos+'s word, not escrowd's: a screen says it as "Kosmos+ says" (review 1). Nothing is signed either way.
  if (data && data.signed === true) return { signed: true, kosmosSays: true };
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
  // Review 1: the route always answers the generation; an answer without it is refused, not trusted by default.
  if (data.generation === undefined || String(data.generation) !== String(d.generation)) throw new Error('Kosmos+ sent a hand-over whose parts do not agree, so nothing was signed');
  const reviewed = Object.freeze({ signed: false, prepared, nonce: nonceText, expiresAt: Number.isFinite(data.expiresAt) ? data.expiresAt : null });
  REVIEWED.add(reviewed);
  return reviewed;
}

/**
 * Sign a reviewed hand-over start with this Mac's Enclave admin key and post it with its nonce. `opts`: adminId,
 * expectedKey, keyFile (this Mac's enrolled admin), appDir (whose bin/kosmos-se is used), send. Returns the route's
 * answer; `signed: true` there means escrowd's record is kept.
 */
async function approveAndSend(reviewed, opts = {}) {
  if (!REVIEWED.has(reviewed)) throw new Error('approve only what review returned');
  // Spent before the Enclave is asked, so one review signs at most once. A cancelled Touch ID therefore needs a new
  // review (review 2, April): the error says so, and the screen asks again (a new review takes a fresh nonce).
  REVIEWED.delete(reviewed);
  const helper = require('./enrolsign').helperPath(opts.appDir);
  if (!helper) throw new Error('this Kosmos cannot sign as an admin: its admin key helper is not installed');
  let signed;
  try {
    signed = await se.sign(reviewed.prepared, { helper, keyFile: opts.keyFile, expectedKey: opts.expectedKey, adminId: opts.adminId });
  } catch (err) {
    throw Object.assign(new Error(`${err && err.message ? err.message : 'it was not signed'}; ask again to sign it`), { askAgain: true });
  }
  const id = reviewed.prepared.decoded.id;
  return answerOf(await sendOf(opts.send)('POST', ROUTE, { id, sig: { adminId: signed.adminId, se: b64(signed.sig) }, nonce: reviewed.nonce }),
    'take the signature');
}

module.exports = { ROUTE, review, approveAndSend };
