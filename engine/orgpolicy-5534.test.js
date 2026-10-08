'use strict';

/**
 * #5534 (Enterprise E0.5): the board verifies the coordinator-signed company policy bundle, refuses a tampered, foreign,
 * expired or older one (keeping the last good one in force), and says whether a provider and model are allowed.
 * Every refusal has a control: the same bundle with the one thing that matters changed, accepted.
 *
 *   node --test engine/orgpolicy-5534.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOTS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('aw-orgpol-data-');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('aw-orgpol-tunnel-');
process.env.HOME = tmp('aw-orgpol-home-');
test.after(() => { for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true }); });

const kst1 = require('./kst1');
const orgpolicy = require('./orgpolicy');

const NOW = 1_800_000_000;
const coordinator = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const pub = (kp) => kp.publicKey.export({ format: 'jwk' }).x;   // base64url of the raw 32 bytes, as /v1/meta's
const PINNED = pub(coordinator);

function sign(payload, kp = coordinator) {
  const body = 'KST1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), kp.privateKey).toString('base64url');
}
const POLICY = { providers_allowed: ['anthropic', 'openai'], models_allowed: { anthropic: ['opus', 'sonnet'] }, backup: { required: true, max_age_hours: 24 },
  telemetry: { required: true }, ai_policy: { name: 'Company', text: 'Be careful with customer data.' } };
const bundle = (over = {}) => ({ typ: 'org_policy', v: 1, org: 'org-1', version: 1, iat: NOW - 10, exp: NOW + 86400, policy: POLICY, ...over });

function place(token) { fs.writeFileSync(orgpolicy.BUNDLE(), token); }
function reset() {
  for (const f of [orgpolicy.BUNDLE(), orgpolicy.APPLIED()]) fs.rmSync(f, { force: true });
}

test('kst1: a good token verifies; each broken part is refused for its own reason', () => {
  const good = sign(bundle());
  assert.equal(kst1.verify(good, PINNED, 'org_policy', NOW).ok, true, 'CONTROL: the good token');
  const [h, p, s] = good.split('.');
  const flipped = p.slice(0, -2) + (p.at(-2) === 'A' ? 'B' : 'A') + p.at(-1);
  const cases = [
    [h + '.' + flipped + '.' + s, 'the signature does not verify'],          // one byte of the payload changed
    [sign(bundle(), stranger), 'the signature does not verify'],             // signed by a key nobody pinned
    ['KST2.' + p + '.' + s, 'not a KST1 token'],
    [h + '.' + p, 'not a KST1 token'],
    [h + '.' + p + '.' + s.slice(0, 20), 'the signature is malformed'],
    [sign(bundle({ typ: 'relay_ticket' })), 'the token is not a org_policy'],
    [sign(bundle({ exp: NOW - 1 })), 'the token has expired'],
  ];
  for (const [t, why] of cases) assert.equal(kst1.verify(t, PINNED, 'org_policy', NOW).why, why, t.slice(0, 40));
  assert.equal(kst1.verify(good, '', 'org_policy', NOW).why, 'no pinned coordinator key');
  assert.equal(kst1.verify(good, pub(stranger), 'org_policy', NOW).why, 'the signature does not verify', 'a different pinned key');
});

test('a verified bundle is applied; a tampered one is refused and the last good one stays in force', () => {
  reset();
  place(sign(bundle()));
  let r = orgpolicy.refresh({ now: NOW, pinned: PINNED });
  assert.equal(r.refused, null);
  assert.equal(r.applied.version, 1);
  assert.deepEqual(orgpolicy.current(), POLICY);
  const good2 = sign(bundle({ version: 2, policy: { ...POLICY, providers_allowed: ['anthropic'] } }));
  const [h, p, s] = good2.split('.');
  place(h + '.' + p.slice(0, -2) + (p.at(-2) === 'A' ? 'B' : 'A') + p.at(-1) + '.' + s);
  r = orgpolicy.refresh({ now: NOW, pinned: PINNED });
  assert.equal(r.refused, 'the signature does not verify');
  assert.equal(r.applied.version, 1, 'a tampered bundle replaced the one in force');
  assert.deepEqual(orgpolicy.current().providers_allowed, ['anthropic', 'openai']);
  place(good2);
  assert.equal(orgpolicy.refresh({ now: NOW, pinned: PINNED }).applied.version, 2, 'CONTROL: the untampered version 2 applies');
});

test('an older version is refused (no rollback by replaying an old bundle); a same-version change too', () => {
  reset();
  place(sign(bundle({ version: 5 })));
  assert.equal(orgpolicy.refresh({ now: NOW, pinned: PINNED }).applied.version, 5);
  place(sign(bundle({ version: 4, policy: { ...POLICY, providers_allowed: null } })));
  let r = orgpolicy.refresh({ now: NOW, pinned: PINNED });
  assert.match(r.refused, /older policy \(version 4\)/);
  assert.equal(r.applied.version, 5);
  place(sign(bundle({ version: 5, policy: { ...POLICY, providers_allowed: null } })));
  r = orgpolicy.refresh({ now: NOW, pinned: PINNED });
  assert.match(r.refused, /different policy under the same version/);
  place(sign(bundle({ version: 5 })));
  assert.equal(orgpolicy.refresh({ now: NOW, pinned: PINNED }).refused, null, 'CONTROL: the same bundle again is fine');
  place(sign(bundle({ version: 1, org: 'org-2' })));
  assert.equal(orgpolicy.refresh({ now: NOW, pinned: PINNED }).applied.org, 'org-2', 'a move to another org starts its own count');
  // Review 1: the first org's mark survives the move, so its older bundle is still refused afterwards.
  place(sign(bundle({ version: 4, policy: { ...POLICY, providers_allowed: null } })));
  r = orgpolicy.refresh({ now: NOW, pinned: PINNED });
  assert.match(String(r.refused), /older policy \(version 4\)/, 'an older bundle of the first org applied after another org came in between');
  assert.equal(r.applied.org, 'org-2');
  place(sign(bundle({ version: 6 })));
  assert.equal(orgpolicy.refresh({ now: NOW, pinned: PINNED }).applied.version, 6, 'CONTROL: a newer bundle of the first org applies');
});

test('a malformed policy is refused rather than half-applied; no bundle means no policy', () => {
  reset();
  for (const policy of [null, [], { providers_allowed: 'anthropic' }, { providers_allowed: ['anthropic'], models_allowed: { anthropic: 'opus' } }]) {
    place(sign(bundle({ policy })));
    assert.match(orgpolicy.refresh({ now: NOW, pinned: PINNED }).refused, /not one this Kosmos understands/, JSON.stringify(policy));
  }
  place(sign(bundle({ v: 2 })));
  assert.match(orgpolicy.refresh({ now: NOW, pinned: PINNED }).refused, /not one this Kosmos understands/);
  assert.equal(orgpolicy.current(), null);
  reset();
  assert.deepEqual(orgpolicy.refresh({ now: NOW, pinned: PINNED }), { applied: null, refused: null });
  assert.deepEqual(orgpolicy.allows({ provider: 'gemini', model: 'x' }), { ok: true }, 'no policy: anything goes');
});

test('allows: providers and models outside the policy are refused with a sentence; null lists do not restrict', () => {
  assert.equal(orgpolicy.allows({ provider: 'anthropic', model: 'opus' }, POLICY).ok, true, 'CONTROL');
  assert.match(orgpolicy.allows({ provider: 'google' }, POLICY).because, /does not allow google/);
  assert.match(orgpolicy.allows({ provider: 'anthropic', model: 'haiku' }, POLICY).because, /does not allow the model haiku on anthropic/);
  assert.equal(orgpolicy.allows({ provider: 'openai', model: 'anything' }, POLICY).ok, true, 'no model list for openai: any model');
  assert.equal(orgpolicy.allows({ provider: 'google' }, { ...POLICY, providers_allowed: null }).ok, true);
});

test('allows: a model given by several names is allowed when any one is listed, refused when none is', () => {
  const byId = { ...POLICY, models_allowed: { anthropic: ['claude-opus-4-5'] } };
  assert.equal(orgpolicy.allows({ provider: 'anthropic', model: ['opus', 'claude-opus-4-5'] }, byId).ok, true, 'the full id is listed');
  assert.equal(orgpolicy.allows({ provider: 'anthropic', model: ['opus', 'claude-opus-4-5'] }, POLICY).ok, true, 'the key is listed');
  assert.match(orgpolicy.allows({ provider: 'anthropic', model: ['haiku', 'claude-haiku-4-5'] }, byId).because, /does not allow the model haiku/);
  assert.match(String(orgpolicy.allows({ provider: 'anthropic', model: ['', ''] }, POLICY).because), /allows only some models on anthropic/,
    'no model named under a model list: refused (create.policyAllows names the default when it knows it)');
  assert.equal(orgpolicy.allows({ provider: 'openai', model: [''] }, POLICY).ok, true, 'CONTROL: no list for openai, no model needed');
});

test('allows applies a bundle the tunnel wrote since, with no refresh call (nothing else calls one)', () => {
  reset();
  fs.writeFileSync(orgpolicy.PINNED(), PINNED);
  try {
    assert.equal(orgpolicy.allows({ provider: 'google' }).ok, true, 'CONTROL: no bundle, no policy');
    place(sign(bundle({ exp: Math.floor(Date.now() / 1000) + 3600 })));
    assert.match(String(orgpolicy.allows({ provider: 'google' }).because), /does not allow google/, 'a fresh bundle was not applied');
    assert.equal(orgpolicy.allows({ provider: 'anthropic', model: 'opus' }).ok, true, 'CONTROL: an allowed provider and model');
  } finally {
    fs.rmSync(orgpolicy.PINNED(), { force: true });
    reset();
  }
});
