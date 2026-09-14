'use strict';
/**
 * kosmos#2790 Phase 2 -- the OFFLINE signal that a ChatGPT-subscription sign-in is DEAD.
 *
 * checkLive cannot test a chatgpt id_token against /v1/models (it is an identity claim, not a
 * bearer key), and the pane cannot separate a dead 401 from a transient reconnect 401. But the
 * id_token payload carries `chatgpt_subscription_active_until` -- the subscription's own validity
 * end, written and refreshed by OpenAI. A PAST value ON A STILL-VALID TOKEN (`exp` in the future)
 * is a lapsed subscription with no ambiguity, so checkLive reds it (STATE.NONE).
 *
 * 🛑 THE SAFETY PROPERTY (inverted #874): a false red -- a WORKING sub told it is dead -- must
 * never happen. Two guards: (1) fail-null on any parse doubt -> UNKNOWN; (2) the token's own `exp`
 * must be in the FUTURE, so an idle-but-working sub whose short token merely EXPIRED (and thus
 * carries a stale past `active_until`) stays grey rather than red.
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
const codexsigninlive = require('./codexsigninlive');

// These are OFFLINE-signal tests: they exercise the subscription-window path of checkLive alone.
// Since #2790 gave that chatgpt branch a SECOND, live signal (the `codex doctor` handshake that
// runs when the offline window does not fire), neutralize the live check to 'unknown' so a verdict
// here reflects the offline logic and never races a real subprocess. 'unknown' is the faithful
// neutral: it makes checkLive fall through to its shared UNKNOWN return exactly as when no live
// signal is available -- which is what every "stays UNKNOWN" assertion below means. The lapsed-sub
// test still reds, because the offline window fires and returns NONE before the live check is reached.
test.beforeEach(() => { codexsigninlive.resetForTest(); codexsigninlive.setRunner(() => Promise.resolve({ ok: false })); });
test.after(() => { codexsigninlive.resetForTest(); });

const FUTURE_ISO = '2099-01-01T00:00:00.000Z';
const PAST_ISO = '2020-01-01T00:00:00.000Z';
const nowSec = () => Math.floor(Date.now() / 1000);
const FUTURE_EXP = nowSec() + 3600;   // token valid for another hour
const PAST_EXP = nowSec() - 3600;     // token expired an hour ago (stale/unrefreshed)

// A ChatGPT id_token JWT (`header.payload.`). Its base64url payload carries email, the JWT `exp`
// (seconds), and -- under `https://api.openai.com/auth` -- the subscription window. Signature
// omitted (decoded, never verified). `activeUntil`/`exp` undefined -> that claim is absent.
function idToken({ email = 'pete@example.com', activeUntil, exp } = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = { email };
  if (exp !== undefined) payload.exp = exp;
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
const chatgptAuth = (opts) => ({ auth_mode: 'chatgpt', tokens: { id_token: idToken(opts) } });

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// ---- checkLive integration: the badge-facing behaviour ----

test('checkLive REDS (NONE) a lapsed sub: PAST active-until on a STILL-VALID (future-exp) token', async () => {
  const dir = fixtureDir('lapsed', chatgptAuth({ activeUntil: PAST_ISO, exp: FUTURE_EXP }));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.NONE,
    'a lapsed ChatGPT subscription (past window, valid token) must red, not stay grey: ' + JSON.stringify(r));
  assert.match(r.because, /lapsed/i);
});

test('SAFETY: a STALE-token working sub (PAST exp) with a past active-until stays UNKNOWN, never red', async () => {
  // The inverted-#874 case iteration 1 flagged: an idle-but-working sub whose short token expired
  // carries a stale past window. The exp gate must keep it grey.
  const dir = fixtureDir('stale', chatgptAuth({ activeUntil: PAST_ISO, exp: PAST_EXP }));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN,
    'a stale/expired token must NOT red on its past window -- the inverted #874 false red: ' + JSON.stringify(r));
});

test('checkLive stays UNKNOWN (no false red) for a FUTURE active-until on a valid token', async () => {
  const dir = fixtureDir('active', chatgptAuth({ activeUntil: FUTURE_ISO, exp: FUTURE_EXP }));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN,
    'a still-active subscription must NOT be reported dead: ' + JSON.stringify(r));
});

test('checkLive stays UNKNOWN when the subscription claim is ABSENT (fail-open)', async () => {
  const dir = fixtureDir('noclaim', chatgptAuth({ exp: FUTURE_EXP })); // valid token, no window claim
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN, 'an absent window must fail open to grey: ' + JSON.stringify(r));
});

test('checkLive stays UNKNOWN when the token has NO exp (cannot confirm freshness -> fail-open)', async () => {
  const dir = fixtureDir('noexp', chatgptAuth({ activeUntil: PAST_ISO })); // past window but no exp to trust it
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN,
    'without an exp we cannot tell a lapsed sub from a stale token -- must stay grey: ' + JSON.stringify(r));
});

test('checkLive stays UNKNOWN for an UNPARSEABLE active-until (fail-open)', async () => {
  const dir = fixtureDir('garbage', chatgptAuth({ activeUntil: 'not-a-date', exp: FUTURE_EXP }));
  const r = await openai.checkLive(dir);
  assert.equal(r.state, subscription.STATE.UNKNOWN, 'an unparseable date must fail open to grey: ' + JSON.stringify(r));
});

// ---- the pure helpers: parsing edge cases ----

test('chatgptSubscriptionWindow returns {activeUntil, exp} in ms, and null on non-chatgpt / undecodable', () => {
  const f = openai.chatgptSubscriptionWindow;
  const w = f(chatgptAuth({ activeUntil: PAST_ISO, exp: FUTURE_EXP }));
  assert.equal(w.activeUntil, Date.parse(PAST_ISO));
  assert.equal(w.exp, FUTURE_EXP * 1000, 'JWT exp is seconds, must be converted to ms');
  // null (not a chatgpt sign-in or no decodable token):
  assert.equal(f(null), null, 'null parsed data');
  assert.equal(f({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x' }), null, 'not a chatgpt sign-in');
  assert.equal(f({ auth_mode: 'chatgpt', tokens: {} }), null, 'no id_token');
  assert.equal(f({ auth_mode: 'chatgpt', tokens: { id_token: 'not.a.jwt' } }), null, 'undecodable payload');
  // present-but-partial: each field null independently, the object still returned
  assert.deepEqual(f(chatgptAuth({ exp: FUTURE_EXP })), { activeUntil: null, exp: FUTURE_EXP * 1000 }, 'no window claim -> activeUntil null');
  assert.deepEqual(f(chatgptAuth({ activeUntil: PAST_ISO })), { activeUntil: Date.parse(PAST_ISO), exp: null }, 'no exp -> exp null');
  assert.deepEqual(f(chatgptAuth({ activeUntil: 'not-a-date', exp: FUTURE_EXP })), { activeUntil: null, exp: FUTURE_EXP * 1000 }, 'unparseable date -> activeUntil null');
  assert.deepEqual(f(chatgptAuth({ activeUntil: '', exp: FUTURE_EXP })), { activeUntil: null, exp: FUTURE_EXP * 1000 }, 'empty date -> activeUntil null');
});

// Inject an ARBITRARY id_token payload so the hostile-shape fail-open of each field is pinned
// (a future refactor of chatgptSubscriptionWindow that broke fail-open would red here).
function parsedWithPayload(payloadObj) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return { auth_mode: 'chatgpt', tokens: { id_token: `${b64({ alg: 'none' })}.${b64(payloadObj)}.` } };
}

test('chatgptSubscriptionWindow fails each field safe on hostile CLAIM shapes', () => {
  const f = openai.chatgptSubscriptionWindow;
  const AUTH = 'https://api.openai.com/auth';
  // auth claim is a STRING, not an object -> activeUntil null (never reds)
  assert.equal(f(parsedWithPayload({ [AUTH]: 'not-an-object', exp: FUTURE_EXP })).activeUntil, null);
  // auth claim is an ARRAY -> activeUntil null
  assert.equal(f(parsedWithPayload({ [AUTH]: [PAST_ISO], exp: FUTURE_EXP })).activeUntil, null);
  // active_until is a NUMBER, not the confirmed ISO string -> activeUntil null (feature inert, never a false red)
  assert.equal(f(parsedWithPayload({ [AUTH]: { chatgpt_subscription_active_until: 1700000000000 }, exp: FUTURE_EXP })).activeUntil, null);
  // exp is a STRING, not the standard numeric epoch -> exp null (the red then cannot fire)
  assert.equal(f(parsedWithPayload({ [AUTH]: { chatgpt_subscription_active_until: PAST_ISO }, exp: '1700000000' })).exp, null);
  // exp fractional seconds -> a finite number, kept (a more precise timestamp, still valid)
  assert.equal(f(parsedWithPayload({ exp: 1700000000.5 })).exp, 1700000000.5 * 1000);
  // exp non-finite: Infinity/NaN serialize to JSON `null` (not a number) -> exp null; a missing exp -> null.
  assert.equal(f(parsedWithPayload({ exp: Infinity })).exp, null, 'Infinity exp -> JSON null -> exp null');
  assert.equal(f(parsedWithPayload({ exp: NaN })).exp, null, 'NaN exp -> JSON null -> exp null');
  assert.equal(f(parsedWithPayload({ [AUTH]: { chatgpt_subscription_active_until: PAST_ISO } })).exp, null, 'missing exp -> exp null');
});

test('decodeIdTokenPayload fails null on every hostile shape, decodes a real payload', () => {
  const d = openai.decodeIdTokenPayload;
  assert.equal(d(null), null);
  assert.equal(d(''), null);
  assert.equal(d(123), null, 'non-string');
  assert.equal(d('onlyoneseg'), null, 'no second segment');
  assert.equal(d('a..c'), null, 'empty middle segment');
  assert.equal(d('a.' + Buffer.from('42').toString('base64url') + '.c'), null, 'payload is a number, not an object');
  const ok = d(idToken({ email: 'x@y.z', exp: FUTURE_EXP }));
  assert.equal(ok.email, 'x@y.z');
  assert.equal(ok.exp, FUTURE_EXP);
});
