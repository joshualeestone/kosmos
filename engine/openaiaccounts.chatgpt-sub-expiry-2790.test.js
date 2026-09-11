'use strict';
/**
 * kosmos#2790 Phase 2 -- the OFFLINE signal that a ChatGPT-subscription sign-in is DEAD.
 *
 * checkLive cannot test a chatgpt id_token against /v1/models (it is an identity claim,
 * not a bearer key), and the pane cannot separate a dead 401 from a transient reconnect
 * 401. But the id_token payload carries `chatgpt_subscription_active_until` -- the
 * subscription's own validity end, written and refreshed by OpenAI. A value in the PAST
 * is a lapsed subscription with no ambiguity, so checkLive reds it (STATE.NONE). Everything
 * uncertain -- an absent/unparseable window, or one still open -- stays UNKNOWN (grey),
 * NEVER red: a false red telling a working sub it is broken is the inverted #874 harm.
 *
 * No spawn, no network: reads a fixture CODEX_HOME exactly as the real one is read.
 *
 *   node --test engine/openaiaccounts.chatgpt-sub-expiry-2790.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-sub-expiry-2790-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;

const openai = require('./openaiaccounts');
const subscription = require('./subscription');

// A ChatGPT id_token JWT (`header.payload.`); its base64url payload carries the email and,
// under the `https://api.openai.com/auth` claim, the subscription window. Signature omitted
// (identityFromData decodes, never verifies). `activeUntil` null -> no window claim at all.
function idToken(email, activeUntil) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = { email };
  if (activeUntil !== undefined) {
    payload['https://api.openai.com/auth'] = { chatgpt_plan_type: 'plus', chatgpt_subscription_active_until: activeUntil };
  }
  return `${b64({ alg: 'none' })}.${b64(payload)}.`;
}
function fixtureDir(label, auth) {
  const dir = nodePath.join(SANDBOX, `.codex-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify(auth));
  return dir;
}
const chatgptAuth = (activeUntil) => ({ auth_mode: 'chatgpt', tokens: { id_token: idToken('pete@example.com', activeUntil) } });

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// ---- checkLive integration: the badge-facing behaviour ----

test('checkLive REDS (NONE) a chatgpt sub whose active-until is in the PAST', async () => {
  const dir = fixtureDir('lapsed', chatgptAuth('2020-01-01T00:00:00.000Z'));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.NONE,
    'a lapsed ChatGPT subscription (active-until in the past) must red, not stay grey: ' + JSON.stringify(r));
  assert.match(r.because, /lapsed/i);
});

test('checkLive stays UNKNOWN (grey, no false red) for a FUTURE active-until', async () => {
  const dir = fixtureDir('active', chatgptAuth('2099-01-01T00:00:00.000Z'));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN,
    'a still-active subscription must NOT be reported dead -- the inverted #874 false red: ' + JSON.stringify(r));
});

test('checkLive stays UNKNOWN when the subscription claim is ABSENT (fail-open)', async () => {
  const dir = fixtureDir('noclaim', chatgptAuth(undefined)); // id_token has an email but no auth-window claim
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN,
    'an absent active-until must fail open to grey, never red: ' + JSON.stringify(r));
});

test('checkLive stays UNKNOWN for an UNPARSEABLE active-until (fail-open)', async () => {
  const dir = fixtureDir('garbage', chatgptAuth('not-a-date'));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN,
    'an unparseable date must fail open to grey, never red: ' + JSON.stringify(r));
});

// ---- the pure helper: parsing edge cases ----

test('chatgptSubscriptionActiveUntil parses a past and a future window, and fails null on doubt', () => {
  const f = openai.chatgptSubscriptionActiveUntil;
  const past = { auth_mode: 'chatgpt', tokens: { id_token: idToken('a@b.co', '2020-01-01T00:00:00.000Z') } };
  const future = { auth_mode: 'chatgpt', tokens: { id_token: idToken('a@b.co', '2099-01-01T00:00:00.000Z') } };
  assert.equal(f(past), Date.parse('2020-01-01T00:00:00.000Z'));
  assert.equal(f(future), Date.parse('2099-01-01T00:00:00.000Z'));
  assert.ok(f(past) < Date.now() && f(future) > Date.now(), 'past is before now and future is after, so the checkLive gate is real');
  // Fail-null cases (each must leave the caller UNKNOWN, never red):
  assert.equal(f(null), null, 'null parsed data');
  assert.equal(f({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x' }), null, 'not a chatgpt sign-in');
  assert.equal(f({ auth_mode: 'chatgpt', tokens: {} }), null, 'no id_token');
  assert.equal(f({ auth_mode: 'chatgpt', tokens: { id_token: 'not.a.jwt' } }), null, 'undecodable payload');
  assert.equal(f(chatgptAuth(undefined)), null, 'no subscription claim in the payload');
  assert.equal(f(chatgptAuth('not-a-date')), null, 'unparseable date string');
  assert.equal(f(chatgptAuth('')), null, 'empty date string');
});
