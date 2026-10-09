'use strict';

/**
 * #5534 (Enterprise E0.5): an enrolled board applies the company policy its status answer carries. engine/orgenroll.js
 * refresh (run on start and daily) writes the signed bundle where engine/orgpolicy.js reads it and applies it there,
 * which verifies it against the pinned coordinator key. Done when (the card): a policy that disallows a provider stops
 * a new agent on it on an enrolled board, and a tampered bundle is refused. The coordinator is a fake that answers the
 * status call; nothing touches the network or the real data root.
 *
 *   node --test engine/orgpolicy-apply-5534.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOTS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('aw-polapply-data-');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('aw-polapply-tunnel-');
process.env.HOME = tmp('aw-polapply-home-');
test.after(() => { for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true }); });

const orgpolicy = require('./orgpolicy');
const org = require('./orgenroll');
const create = require('./create');

const coordinator = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const pub = (kp) => kp.publicKey.export({ format: 'jwk' }).x;
fs.writeFileSync(orgpolicy.PINNED(), pub(coordinator));
const now = () => Math.floor(Date.now() / 1000);
function sign(payload, kp = coordinator) {
  const body = 'KST1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), kp.privateKey).toString('base64url');
}
const POLICY = { providers_allowed: ['anthropic'], models_allowed: null, backup: null, telemetry: null, ai_policy: null };
const bundle = (over = {}) => ({ typ: 'org_policy', v: 1, org: 'org_1', version: 1, iat: now() - 10, exp: now() + 86400, policy: POLICY, ...over });
const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/* A fake coordinator that confirms THIS world on this computer and serves `policy` on the status answer. */
function coordinatorServing(root, policy, company = ORG) {
  org.worldId({ root });   // this Kosmos's id exists before the refresh asks about it, as on an enrolled board
  return { macRequest: async (m, route) => (route === org.ROUTES.status
    ? { ok: true, data: { member: true, org: company, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root }), thisComputer: true }, ...(policy === undefined ? {} : { policy }) } }
    : { ok: false, because: 'unexpected ' + route }) };
}
const appliedVersion = () => { try { return JSON.parse(fs.readFileSync(orgpolicy.APPLIED(), 'utf8')).version; } catch { return null; } };
function reset() { for (const f of [orgpolicy.BUNDLE(), orgpolicy.APPLIED()]) fs.rmSync(f, { force: true }); }

test('#5534: the policy on the status answer is applied, and a disallowed provider then stops a new agent', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  assert.equal(create.policyAllows('openai', null).ok !== false, true, 'CONTROL: with no policy, any provider is allowed');
  const r = await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.policy, { version: 1, refused: null });
  assert.equal(appliedVersion(), 1);
  const refusedAgent = create.policyAllows('openai', null);
  assert.equal(refusedAgent.ok, false, 'a provider the policy does not allow was allowed');
  assert.equal(create.policyAllows('anthropic', null).ok !== false, true, 'CONTROL: the allowed provider is still allowed');
});

test('#5534: a tampered or foreign-signed bundle is refused, and the last good policy stays in force', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(appliedVersion(), 1, 'premise: version 1 is in force');
  // Tampered: the payload changed after signing (version 2 allowing everything), the signature kept.
  const good = sign(bundle({ version: 2 })).split('.');
  const forged = [good[0], Buffer.from(JSON.stringify(bundle({ version: 2, policy: { ...POLICY, providers_allowed: null } }))).toString('base64url'), good[2]].join('.');
  const t = await org.refresh({ root, remote: coordinatorServing(root, forged) });
  assert.equal(t.policy.version, 1);
  assert.ok(t.policy.refused, 'a tampered bundle was not refused');
  assert.equal(create.policyAllows('openai', null).ok, false, 'a tampered bundle loosened the policy');
  // Signed by a key that is not the pinned coordinator's.
  const s = await org.refresh({ root, remote: coordinatorServing(root, sign(bundle({ version: 3, policy: { ...POLICY, providers_allowed: null } }), stranger)) });
  assert.ok(s.policy.refused, 'a bundle signed by another key was not refused');
  assert.equal(appliedVersion(), 1);
  // CONTROL: the next real version from the coordinator is applied.
  const next = await org.refresh({ root, remote: coordinatorServing(root, sign(bundle({ version: 2, policy: { ...POLICY, providers_allowed: null } }))) });
  assert.deepEqual(next.policy, { version: 2, refused: null });
  assert.equal(create.policyAllows('openai', null).ok !== false, true);
});

test('#5534: an answer with no policy (the company saved none) changes nothing and says nothing about one', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  const r = await org.refresh({ root, remote: coordinatorServing(root, null) });
  assert.equal(r.ok, true, r.because);
  assert.equal('policy' in r, false);
  assert.equal(orgpolicy.current(), null);
  assert.equal(fs.existsSync(orgpolicy.BUNDLE()), false, 'a bundle file was written with no policy served');
});

test('#5534 review 1: when this Kosmos stops being enrolled, the company policy ends with it', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(create.policyAllows('openai', null).ok, false, 'premise: the policy is in force');
  // The company stops naming this Kosmos (member:false), the policy still on the answer: nothing may re-apply it.
  const gone = { macRequest: async (m, route) => (route === org.ROUTES.status ? { ok: true, data: { member: false, policy: sign(bundle({ version: 5 })) } } : { ok: false }) };
  const r = await org.refresh({ root, remote: gone });
  assert.equal(r.enrolled, false);
  assert.equal(orgpolicy.current(), null, 'the applied policy outlived the enrollment');
  assert.equal(fs.existsSync(orgpolicy.BUNDLE()), false, 'the bundle outlived the enrollment');
  assert.equal(create.policyAllows('openai', null).ok !== false, true, 'a former member is still held to the policy');
});

test('#5534 review 1: a policy naming another company than the answer is not saved', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  const r = await org.refresh({ root, remote: coordinatorServing(root, sign(bundle({ org: 'org_2' }))) });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.policy.refused, 'the policy names another company than this answer');
  assert.equal(fs.existsSync(orgpolicy.BUNDLE()), false, 'another company\'s bundle was saved');
  assert.equal(create.policyAllows('openai', null).ok !== false, true);
});

test('#5534 review 5: an answer with no bundle (null, or no field) never lifts a policy: only a signed one can', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(create.policyAllows('openai', null).ok, false, 'premise: in force');
  await org.refresh({ root, remote: coordinatorServing(root, undefined) });   // an older coordinator: no field at all
  assert.equal(create.policyAllows('openai', null).ok, false, 'CONTROL: an answer without the field dropped the policy');
  await org.refresh({ root, remote: coordinatorServing(root, null) });
  assert.equal(create.policyAllows('openai', null).ok, false, 'an unsigned null lifted the policy');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle({ version: 2, policy: { ...POLICY, providers_allowed: null } }))) });
  assert.equal(create.policyAllows('openai', null).ok !== false, true, 'CONTROL: an open policy, signed, lifts it');
});

test('#5534 review 2: a leave the company refuses (last admin) keeps this Kosmos enrolled, and its policy with it', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(create.policyAllows('openai', null).ok, false, 'premise: in force');
  const serving = coordinatorServing(root, sign(bundle()));
  const lastAdmin = { macRequest: async (m, route, body) => (route === org.ROUTES.leave
    ? { ok: false, because: '409 {"because":"org_last_admin"}' }
    : serving.macRequest(m, route, body)) };
  const r = await org.leave({ root, remote: lastAdmin });
  assert.equal(r.still, true, JSON.stringify(r));
  assert.ok(org.readEnrollment({ root }), 'premise: the record came back');
  assert.equal(create.policyAllows('openai', null).ok, false, 'a refused leave dropped the policy of a Kosmos still enrolled');
});

test('#5534 review 3: another company with a refused bundle leaves no policy, not the old company\'s', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(create.policyAllows('openai', null).ok, false, 'premise: org_1 policy in force');
  const org2 = { id: 'org_2', name: 'Beta', slug: 'beta' };
  const r = await org.refresh({ root, remote: coordinatorServing(root, sign(bundle({ org: 'org_2' }), stranger), org2) });
  assert.equal(r.ok, true, r.because);
  assert.ok(r.policy && r.policy.refused, 'premise: the new company\'s bundle was refused');
  assert.equal(orgpolicy.current(), null, 'the old company\'s policy stayed in force under the new company');
});

test('#5534 review 3: a refused last-admin leave from a coordinator without the policy field puts the policy back', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  const older = coordinatorServing(root, undefined);
  const lastAdmin = { macRequest: async (m, route, body) => (route === org.ROUTES.leave
    ? { ok: false, because: '409 {"because":"org_last_admin"}' }
    : older.macRequest(m, route, body)) };
  const r = await org.leave({ root, remote: lastAdmin });
  assert.equal(r.still, true, JSON.stringify(r));
  assert.equal(create.policyAllows('openai', null).ok, false, 'the policy was not put back on a Kosmos still enrolled');
});

test('#5534 review 3: the highest version seen survives a clear, so an older bundle replayed after a rejoin is refused', () => {
  reset();
  fs.writeFileSync(orgpolicy.BUNDLE(), sign(bundle({ version: 3 })));
  assert.equal(orgpolicy.refresh().applied.version, 3, 'premise');
  orgpolicy.clear();
  assert.equal(orgpolicy.current(), null, 'premise: nothing in force after the clear');
  fs.writeFileSync(orgpolicy.BUNDLE(), sign(bundle({ version: 2 })));
  const r = orgpolicy.refresh();
  assert.ok(r.refused, 'an older bundle was accepted after a clear');
  assert.equal(orgpolicy.current(), null);
  fs.writeFileSync(orgpolicy.BUNDLE(), sign(bundle({ version: 3 })));
  assert.equal(orgpolicy.refresh().applied.version, 3, 'CONTROL: the same version is accepted again after a rejoin');
});

test('#5534 review 3: joining another company by code ends the old company\'s policy even before any refresh', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  assert.equal(create.policyAllows('openai', null).ok, false, 'premise: org_1 policy in force');
  const org2 = { id: 'org_2', name: 'Beta', slug: 'beta' };
  const moving = { macRequest: async (m, route, body) => (route === org.ROUTES.enroll
    ? { ok: true, data: { ok: true, org: org2, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } }
    : { ok: false, because: 'unreachable' }) };
  const r = await org.enroll('BETA-JOIN-1234', true, { root, remote: moving });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(org.readEnrollment({ root }).org.id, 'org_2', 'premise: the record is the new company\'s');
  assert.equal(orgpolicy.current(), null, 'the old company\'s policy stayed in force after a move to another company');
});

test('#5534 review 4: a refused last-admin leave whose answer carries an unusable bundle keeps the policy in force', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  await org.refresh({ root, remote: coordinatorServing(root, sign(bundle())) });
  const expired = coordinatorServing(root, sign(bundle({ version: 2, exp: now() - 5, policy: { ...POLICY, providers_allowed: null } })));
  const lastAdmin = { macRequest: async (m, route, body) => (route === org.ROUTES.leave
    ? { ok: false, because: '409 {"because":"org_last_admin"}' }
    : expired.macRequest(m, route, body)) };
  const r = await org.leave({ root, remote: lastAdmin });
  assert.equal(r.still, true, JSON.stringify(r));
  assert.equal(create.policyAllows('openai', null).ok, false, 'an unusable bundle on a refused leave dropped the policy');
});

test('#5534 review 5: a bundle of another company waiting on disk is ended on a company change, not applied later', async () => {
  reset();
  const root = tmp('aw-polapply-world-');
  fs.writeFileSync(orgpolicy.BUNDLE(), sign(bundle({ org: 'org_9' })));   // never applied (nothing read it yet)
  const r = await org.refresh({ root, remote: coordinatorServing(root, undefined) });
  assert.equal(r.ok, true, r.because);
  assert.equal(fs.existsSync(orgpolicy.BUNDLE()), false, 'another company\'s bundle stayed on disk');
  assert.equal(create.policyAllows('openai', null).ok !== false, true, 'another company\'s bundle applied on this board');
});
