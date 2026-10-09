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
function coordinatorServing(root, policy) {
  org.worldId({ root });   // this Kosmos's id exists before the refresh asks about it, as on an enrolled board
  return { macRequest: async (m, route) => (route === org.ROUTES.status
    ? { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: org.worldId({ root }), thisComputer: true }, ...(policy === undefined ? {} : { policy }) } }
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
