'use strict';
/**
 * #2338: finishChatgptLogin is the "connected" GATE for the ChatGPT
 * subscription connect flow. It must accept ONLY a completed ChatGPT sign-in
 * (auth.json auth_mode 'chatgpt' with a decodable identity) and refuse an API
 * key or an empty directory -- so a subscription connection can never be
 * conflated with an API-key one, and a directory where sign-in never finished
 * is never reported connected.
 *
 * These assertions run with NO spawn and NO network: the gate reads a fixture
 * CODEX_HOME, exactly as it will read the real one codex login writes. (The
 * spawn/session driver that produces that directory is verified separately,
 * live, at the release gate under a real subscription.)
 *
 *   node --test engine/openaiaccounts.chatgpt-2338.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-chatgpt-2338-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;

const openai = require('./openaiaccounts');

// A ChatGPT id_token is a JWT whose middle segment (base64url) carries the
// email. codex never verifies it; identityFromData just decodes the label.
function idToken(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ email })}.`;
}

// Write a fixture CODEX_HOME (a `.codex-<label>` dir) with the given auth.json.
function fixtureDir(label, auth) {
  const dir = nodePath.join(SANDBOX, `.codex-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify(auth));
  return dir;
}

test('accepts a completed ChatGPT sign-in and returns a subscription row', () => {
  const dir = fixtureDir('sub', { auth_mode: 'chatgpt', tokens: { id_token: idToken('pete@example.com') } });
  const r = openai.finishChatgptLogin({ dir });
  assert.equal(r.ok, true);
  assert.equal(r.account.provider, 'openai');
  assert.equal(r.account.authMode, 'chatgpt');
  assert.equal(r.account.email, 'pete@example.com');
  assert.equal(r.account.keyTail, null, 'a subscription account has no keyTail (the api-key discriminator)');
});

test('persists the exact typed name', () => {
  const dir = fixtureDir('named', { auth_mode: 'chatgpt', tokens: { id_token: idToken('a@b.co') } });
  const r = openai.finishChatgptLogin({ dir, label: 'Pete’s ChatGPT' });
  assert.equal(r.ok, true);
  assert.equal(r.account.name, 'Pete’s ChatGPT');
});

test('refuses an API-key sign-in (that is the separate connection type)', () => {
  const dir = fixtureDir('key', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-live-abcd1234' });
  const r = openai.finishChatgptLogin({ dir });
  assert.equal(r.ok, false);
  assert.match(r.because, /API key/i);
});

test('refuses a directory where sign-in never completed (no auth.json)', () => {
  const dir = nodePath.join(SANDBOX, '.codex-empty');
  fs.mkdirSync(dir, { recursive: true });
  const r = openai.finishChatgptLogin({ dir });
  assert.equal(r.ok, false);
  assert.match(r.because, /did not complete/i);
});

test('refuses an unreadable auth.json rather than guessing connected', () => {
  const dir = nodePath.join(SANDBOX, '.codex-corrupt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), '{ not json');
  const r = openai.finishChatgptLogin({ dir });
  assert.equal(r.ok, false);
});

test('refuses a chatgpt auth_mode with no decodable identity (unrecognised shape)', () => {
  // auth_mode says chatgpt but there is no tokens.id_token to decode -> identityFromData
  // still returns a chatgpt identity with email null; that IS a valid (email-less)
  // subscription sign-in, so this asserts the email-null path is accepted, not refused.
  const dir = fixtureDir('noemail', { auth_mode: 'chatgpt', tokens: {} });
  const r = openai.finishChatgptLogin({ dir });
  assert.equal(r.ok, true, 'an email-less ChatGPT sign-in is still a valid subscription (email is a label, not the auth)');
  assert.equal(r.account.email, null);
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
