'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-accounts-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
const openai = require('./openaiaccounts');

const writeAuth = (rel, obj) => {
  const p = nodePath.join(SANDBOX, rel, 'auth.json');
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
};

/* A stand-in for codex's `login --with-api-key`: reads stdin, writes the same
   auth.json shape codex writes (probed 2026-08-24), into CODEX_HOME. It
   refuses a key that says "bad", so the failure arm is exercised too. */
const FAKE_CODEX = nodePath.join(SANDBOX, 'fake-codex');
fs.writeFileSync(FAKE_CODEX, `#!/bin/bash
[ "$1" = login ] && [ "$2" = --with-api-key ] || exit 2
key=$(cat)
case "$key" in *bad*) exit 1;; esac
mkdir -p "$CODEX_HOME"
printf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}' "$key" > "$CODEX_HOME/auth.json"
`, { mode: 0o755 });

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('the default codex home and every ~/.codex-* with a sign-in are listed, default first, identity from what codex wrote', () => {
  writeAuth('.codex', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-abcdefghijklmnop1EW8A' });
  writeAuth('.codex-team', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-zzzzzzzzzzzzzzzzzzTAIL' });
  fs.mkdirSync(nodePath.join(SANDBOX, '.codex-empty'), { recursive: true }); // no auth.json: not an account
  const rows = openai.list();
  assert.deepEqual(rows.map((r) => [r.label, r.isDefault, r.keyTail, r.provider]), [
    [null, true, 'EW8A', 'openai'],
    ['team', false, 'TAIL', 'openai'],
  ]);
  for (const r of rows) assert.ok(!JSON.stringify(r).includes('sk-proj'), 'a row must never carry the key');
});

test('a ChatGPT sign-in is labelled by the email in its id token, decoded not verified', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'her@example.com' })).toString('base64url');
  writeAuth('.codex-chat', { auth_mode: 'chatgpt', tokens: { id_token: `x.${payload}.y` } });
  const row = openai.list().find((r) => r.label === 'chat');
  assert.equal(row.email, 'her@example.com');
  assert.equal(row.authMode, 'chatgpt');
});

test('adding by key goes through codex\'s own login into a fresh spot, and answers the row, never the key', () => {
  const out = openai.addWithKey({ key: 'sk-proj-newkeynewkeynewkeyNEW1', codexBin: FAKE_CODEX });
  assert.equal(out.ok, true, out.because);
  assert.equal(out.account.label, 'work1');
  assert.equal(out.account.keyTail, 'NEW1');
  assert.ok(!JSON.stringify(out).includes('newkey'), 'the answer must never carry the key');
  const auth = JSON.parse(fs.readFileSync(nodePath.join(SANDBOX, '.codex-work1', 'auth.json'), 'utf8'));
  assert.equal(auth.auth_mode, 'apikey');
  // The key was trimmed on the way in: a pasted key with a trailing newline is the common case.
  const out2 = openai.addWithKey({ key: '  sk-proj-secondkeysecondkeyTWO2\n', label: 'Team Two', codexBin: FAKE_CODEX });
  assert.equal(out2.ok, true, out2.because);
  assert.equal(out2.account.label, 'team-two');
  assert.equal(out2.account.keyTail, 'TWO2');
});

test('a refused key leaves no half-made account behind, and a taken label is refused in words', () => {
  const before = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-')).sort();
  const out = openai.addWithKey({ key: 'sk-proj-this-is-a-bad-key-for-sure', codexBin: FAKE_CODEX });
  assert.equal(out.ok, false);
  assert.match(out.because, /did not accept that key/);
  assert.deepEqual(fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-')).sort(), before, 'a failed add littered a directory');
  const dup = openai.addWithKey({ key: 'sk-proj-anotherkeyanotherkeyDUP0', label: 'team-two', codexBin: FAKE_CODEX });
  assert.equal(dup.ok, false);
  assert.match(dup.because, /already an OpenAI account by that name/);
});

test('what is not a key is refused before anything runs', () => {
  assert.equal(openai.addWithKey({ key: '', codexBin: FAKE_CODEX }).because, 'paste the key first');
  assert.match(openai.addWithKey({ key: 'sk-proj-abc def ghijklmnopqrstuv', codexBin: FAKE_CODEX }).because, /no spaces/);
  assert.match(openai.addWithKey({ key: 'sk-short', codexBin: FAKE_CODEX }).because, /too short/);
  assert.match(openai.addWithKey({ key: 'sk-proj-fineleng-thkeyhereeeee', codexBin: nodePath.join(SANDBOX, 'no-such-codex') }).because, /could not find the OpenAI runner/);
});
