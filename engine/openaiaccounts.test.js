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
const sub = require('./subscription');

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

/* ── add-time live validation (#1315) ────────────────────────────────────
   addWithKeyLive = the local add (addWithKey) plus the SAME live check the
   badge uses, so a dead key is refused at ENTRY rather than accepted and shown
   not-connected later. The fetcher seam stands in for /v1/models; the walk
   through addWithKey still uses FAKE_CODEX, so the key genuinely lands in
   auth.json and checkLive reads it back. */

test('#1315: a key OpenAI positively rejects (invalid_api_key) is refused at add, and no account is left behind', async () => {
  const before = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-')).sort();
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-deadkeydeadkeydeadDEAD', label: 'dead-add', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    assert.equal(out.because, 'OpenAI did not accept this key');
    assert.deepEqual(fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-')).sort(), before,
      'a live-rejected add littered a directory');
    assert.ok(!JSON.stringify(out).includes('deadkey'), 'the answer must never carry the key');
  } finally { openai.setFetcher(null); }
});

test('#1315: a key OpenAI accepts (200) is added, and the account stands with its sign-in file', async () => {
  openai.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [{ id: 'gpt-4o' }] } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-goodkeygoodkeygoodGOOD', label: 'good-add', codexBin: FAKE_CODEX });
    assert.equal(out.ok, true, out.because);
    assert.equal(out.account.label, 'good-add');
    assert.equal(out.account.keyTail, 'GOOD');
    assert.ok(fs.existsSync(nodePath.join(SANDBOX, '.codex-good-add', 'auth.json')), 'an accepted add left no sign-in file');
    assert.ok(!JSON.stringify(out).includes('goodkey'), 'the answer must never carry the key');
  } finally { openai.setFetcher(null); }
});

test('#1315: a key we cannot confirm bad is ACCEPTED, never blocked (a scope-restricted 401)', async () => {
  /* Same asymmetry checkLive enforces: only invalid_api_key is a positive
     rejection. A project key restricted from listing models 401s here for a
     permissions reason while working fine for the agent, so refusing it at add
     would be exactly the false negative this whole path exists to avoid. */
  openai.setFetcher(async () => ({ status: 403, body: { error: { code: 'insufficient_permissions' } } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-scopedkeyscopedSCOP', label: 'scoped-add', codexBin: FAKE_CODEX });
    assert.equal(out.ok, true, out.because);
    assert.ok(fs.existsSync(nodePath.join(SANDBOX, '.codex-scoped-add', 'auth.json')), 'a scope-restricted key was wrongly discarded at add');
  } finally { openai.setFetcher(null); }
});

test('#1315: an unreachable OpenAI at add time ACCEPTS the key, never a false rejection', async () => {
  openai.setFetcher(async () => { throw new Error('getaddrinfo ENOTFOUND api.openai.com'); });
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-offlinekeyofflOFFL', label: 'offline-add', codexBin: FAKE_CODEX });
    assert.equal(out.ok, true, out.because);
    assert.ok(fs.existsSync(nodePath.join(SANDBOX, '.codex-offline-add', 'auth.json')), 'an unreachable check wrongly discarded the account');
  } finally { openai.setFetcher(null); }
});

/* ── #2140 accountModels error matrix (Astra's spec) ──────────────────────
   A non-200 from /v1/models is NOT one undifferentiated "no models" state:
   each status maps to a distinct, honest `because`. writeAuth is idempotent, so
   arranging the apikey account inside the helper removes any test-order coupling. */
const ERR_DIR = '.codex-errmatrix';
const errModels = async (fetcher) => {
  writeAuth(ERR_DIR, { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-errmatrixKEYtail01' });
  openai.setFetcher(fetcher);
  try { return await openai.accountModels(nodePath.join(SANDBOX, ERR_DIR)); }
  finally { openai.setFetcher(null); }
};

test('#2140 accountModels: a 401 is a distinct "key rejected", never no-models/unreachable', async () => {
  const out = await errModels(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  assert.equal(out.ok, false);
  assert.match(out.because, /rejected by OpenAI \(401\)/);
  assert.doesNotMatch(out.because, /no chat models|did not return|reach/i, 'a rejected key must not read as no-models or unreachable');
  assert.ok(!JSON.stringify(out).includes('sk-proj'), 'the answer must never carry the key');
});

test('#2140 accountModels: a 401 WITHOUT invalid_api_key is a scope answer (works, cannot list), never "reconnect"', async () => {
  /* #1315's asymmetry applied to model-listing: only OpenAI's own
     `invalid_api_key` is a positive rejection of the key. A scope-restricted
     project key 401s on /v1/models while running inference fine, so it must NOT
     be told to reconnect -- the account works, it just cannot enumerate models. */
  const scoped = await errModels(async () => ({ status: 401, body: { error: { code: 'insufficient_permissions' } } }));
  assert.equal(scoped.ok, false);
  assert.match(scoped.because, /cannot list models, though the key itself works \(401\)/);
  assert.doesNotMatch(scoped.because, /rejected by OpenAI/i, 'a scope-restricted 401 must not read as a rejected key');
  // A bodyless 401 (no error code at all) is the same scope answer, not a rejection.
  const bodyless = await errModels(async () => ({ status: 401, body: null }));
  assert.match(bodyless.because, /cannot list models, though the key itself works \(401\)/);
  assert.doesNotMatch(bodyless.because, /rejected by OpenAI/i);
});

test('#2140 accountModels: a 403 names the denied operation, never "no models"', async () => {
  const out = await errModels(async () => ({ status: 403, body: { error: { code: 'insufficient_permissions' } } }));
  assert.equal(out.ok, false);
  assert.match(out.because, /not allowed to list models \(403\)/);
  assert.doesNotMatch(out.because, /no chat models/i);
});

test('#2140 accountModels: a 429 quota/billing code is a billing state, distinct from a rate limit', async () => {
  const billing = await errModels(async () => ({ status: 429, body: { error: { code: 'insufficient_quota' } } }));
  assert.match(billing.because, /usage or billing limit \(429\)/);
  const rate = await errModels(async () => ({ status: 429, body: { error: { code: 'rate_limit_exceeded' } } }));
  assert.match(rate.because, /rate-limiting this account/);
  assert.notEqual(billing.because, rate.because, 'billing and rate-limit 429s must be told apart');
});

test('#2140 accountModels: a 5xx is a distinct retryable "OpenAI is having trouble"', async () => {
  const out = await errModels(async () => ({ status: 503, body: null }));
  assert.equal(out.ok, false);
  assert.match(out.because, /having trouble right now \(503\)/);
});

test('#2140 accountModels CONTROL: a 200 with a chat model still returns ok (the matrix did not swallow the good path)', async () => {
  const out = await errModels(async () => ({ status: 200, body: { object: 'list', data: [{ id: 'gpt-4o' }] } }));
  assert.equal(out.ok, true, out.because);
  assert.ok(out.models.some((m) => /gpt-4o/i.test((m && (m.label || m.arg || m.key)) || '')), 'the good path must still list the account model');
});

test('#1315: a locally-invalid add (bad shape) passes straight through and never asks OpenAI', async () => {
  let asked = false;
  openai.setFetcher(async () => { asked = true; return { status: 200, body: { data: [] } }; });
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-short', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    assert.match(out.because, /too short/);
    assert.equal(asked, false, 'the live check ran on an input addWithKey already refused');
  } finally { openai.setFetcher(null); }
});

test('#1315: a key codex itself refuses locally is refused, and OpenAI is never asked', async () => {
  let asked = false;
  openai.setFetcher(async () => { asked = true; return { status: 200, body: { data: [] } }; });
  try {
    // FAKE_CODEX exits non-zero on any key containing "bad".
    const out = await openai.addWithKeyLive({ key: 'sk-proj-this-is-a-bad-key-for-sure', label: 'localbad-add', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    assert.match(out.because, /did not accept that key/);
    assert.equal(asked, false, 'the live check ran after the local add already failed');
  } finally { openai.setFetcher(null); }
});

test('#1315: a live-rejected add into a PRE-EXISTING dir removes only its own auth.json, never the dir or its other contents', async () => {
  /* 🛑 THE CLEANUP MUST HONOUR addWithKey's OWN GUARD. addWithKey removes the
     whole directory on failure only when it CREATED it (madeDir); it can succeed
     into a pre-existing `.codex-<label>` that merely lacked an auth.json and holds
     other files. A live rejection must not recursively delete that directory.
     Here: seed a pre-existing labelled dir with a decoy file (no auth.json), add
     with a key OpenAI rejects, and assert the decoy + the dir survive and only the
     auth.json this add wrote is gone. */
  const preDir = nodePath.join(SANDBOX, '.codex-preexisting');
  fs.mkdirSync(preDir, { recursive: true });
  const decoy = nodePath.join(preDir, 'keep-me.txt');
  fs.writeFileSync(decoy, 'a user file that predates the add', 'utf8');
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-deadintopreexistDEAD', label: 'preexisting', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    assert.equal(out.because, 'OpenAI did not accept this key');
    assert.ok(fs.existsSync(preDir), 'a pre-existing directory was recursively deleted on a live rejection');
    assert.ok(fs.existsSync(decoy), 'a pre-existing file in that directory was deleted on a live rejection');
    assert.ok(!fs.existsSync(nodePath.join(preDir, 'auth.json')), 'the rejected add left its own auth.json behind');
  } finally { openai.setFetcher(null); }
});

test('#1315: a live-rejected add into a NEWLY-created dir leaves no directory behind (matches addWithKey anti-litter)', async () => {
  const before = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-')).sort();
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-deadfreshslotDEAD1', label: 'fresh-reject', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    assert.deepEqual(fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-')).sort(), before,
      'a live-rejected add into a dir we created left the directory behind');
  } finally { openai.setFetcher(null); }
});

/* ── live check (#960) ──────────────────────────────────────────────────
   `codex login status` was measured LOCAL ONLY (a fabricated key still
   reads "Logged in"), so the live check has to be a real call to OpenAI's
   own API. `setFetcher` is this module's own seam for that call -- never
   the real network in a test. */

test('#960: a 200 from OpenAI means connected, and the key is never in the request as anything but the bearer token', () => {
  writeAuth('.codex-live200', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-realworkingkeyKEY1' });
  const dir = nodePath.join(SANDBOX, '.codex-live200');
  let seenUrl = null;
  let seenAuth = null;
  openai.setFetcher(async (url, init) => {
    seenUrl = url;
    seenAuth = init.headers.authorization;
    return { status: 200, body: { object: 'list', data: [{ id: 'gpt-4' }] } };
  });
  try {
    return openai.checkLive(dir).then((r) => {
      assert.equal(r.state, sub.STATE.CONNECTED);
      assert.equal(r.checkedLive, true);
      assert.equal(seenUrl, 'https://api.openai.com/v1/models');
      assert.equal(seenAuth, 'Bearer sk-proj-realworkingkeyKEY1');
    });
  } finally { openai.setFetcher(null); }
});

test('#960: a 401 with invalid_api_key means not connected, a positively confirmed negative', () => {
  writeAuth('.codex-live401', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-rejectedkeyKEY2' });
  const dir = nodePath.join(SANDBOX, '.codex-live401');
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    return openai.checkLive(dir).then((r) => {
      assert.equal(r.state, sub.STATE.NONE);
      assert.match(r.because, /did not accept/);
    });
  } finally { openai.setFetcher(null); }
});

test('#960: a 403 with invalid_api_key is also a confirmed negative, same as 401', () => {
  writeAuth('.codex-live403', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-forbiddenkeyKEY3' });
  const dir = nodePath.join(SANDBOX, '.codex-live403');
  openai.setFetcher(async () => ({ status: 403, body: { error: { code: 'invalid_api_key' } } }));
  try {
    return openai.checkLive(dir).then((r) => assert.equal(r.state, sub.STATE.NONE));
  } finally { openai.setFetcher(null); }
});

test('#960: a 401/403 WITHOUT invalid_api_key is UNKNOWN, not a guessed NONE (a scope-restricted key)', () => {
  /* Caught in challenge-loop iteration 2: an OpenAI project key can be
     restricted in the dashboard and legitimately lack permission to LIST
     models while still being fully valid for what an agent actually does
     with it. That still answers 401/403 here, but for a permissions
     reason, not a revoked-key one -- only OpenAI's own `invalid_api_key`
     code is a positive confirmation the key itself is bad. */
  writeAuth('.codex-live403scoped', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-scopedkeySCOP' });
  const dir = nodePath.join(SANDBOX, '.codex-live403scoped');
  openai.setFetcher(async () => ({ status: 403, body: { error: { code: 'insufficient_permissions' } } }));
  try {
    return openai.checkLive(dir).then((r) => {
      assert.equal(r.state, sub.STATE.UNKNOWN);
      assert.doesNotMatch(r.because, /did not accept this key/, 'a scope-restricted key was called flatly rejected, overclaiming the key itself is bad');
    });
  } finally { openai.setFetcher(null); }
});

test('#960: a 401 with no readable body at all is also UNKNOWN, not a guessed NONE', () => {
  // No error code available to confirm anything -- must not default to NONE.
  writeAuth('.codex-live401nobody', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-nobodykeyNOBO' });
  const dir = nodePath.join(SANDBOX, '.codex-live401nobody');
  openai.setFetcher(async () => ({ status: 401, body: null }));
  try {
    return openai.checkLive(dir).then((r) => assert.equal(r.state, sub.STATE.UNKNOWN));
  } finally { openai.setFetcher(null); }
});

test('#960: an unreachable OpenAI (network error) is UNKNOWN, never a false negative', () => {
  writeAuth('.codex-liveerr', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-somekeyKEY4' });
  const dir = nodePath.join(SANDBOX, '.codex-liveerr');
  openai.setFetcher(async () => { throw new Error('getaddrinfo ENOTFOUND api.openai.com'); });
  try {
    return openai.checkLive(dir).then((r) => {
      assert.equal(r.state, sub.STATE.UNKNOWN);
      assert.match(r.because, /could not reach OpenAI/);
      assert.ok(!r.because.includes('ENOTFOUND'), 'a raw network error leaked into the sentence; must be hand-written, not relayed');
    });
  } finally { openai.setFetcher(null); }
});

test('#960: an unexpected status from OpenAI is UNKNOWN, not guessed either way', () => {
  writeAuth('.codex-live500', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-somekeyKEY5' });
  const dir = nodePath.join(SANDBOX, '.codex-live500');
  openai.setFetcher(async () => ({ status: 500, body: null }));
  try {
    return openai.checkLive(dir).then((r) => assert.equal(r.state, sub.STATE.UNKNOWN));
  } finally { openai.setFetcher(null); }
});

test('#960: a ChatGPT-mode account is honestly UNKNOWN, and never even asks the network', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'chat@example.com' })).toString('base64url');
  writeAuth('.codex-livechatgpt', { auth_mode: 'chatgpt', tokens: { id_token: `x.${payload}.y` } });
  const dir = nodePath.join(SANDBOX, '.codex-livechatgpt');
  let called = false;
  openai.setFetcher(async () => { called = true; return { status: 200, body: {} }; });
  try {
    return openai.checkLive(dir).then((r) => {
      assert.equal(r.state, sub.STATE.UNKNOWN);
      assert.match(r.because, /not yet checked live/);
      assert.equal(called, false, 'a mode with no verifiable bearer credential must not attempt a network call at all');
    });
  } finally { openai.setFetcher(null); }
});

test('#960: nobody signed in at all reads as a positive NONE, not unknown', () => {
  const dir = nodePath.join(SANDBOX, '.codex-neversignedin');
  return openai.checkLive(dir).then((r) => {
    assert.equal(r.state, sub.STATE.NONE);
    assert.match(r.because, /nobody has signed in/);
  });
});

test('#960: a corrupted auth.json is UNKNOWN, not the same NONE as no file at all', () => {
  /* Caught in challenge-loop iteration 1: the first version of checkLive()
     folded "no file" and "a file that will not parse" into the same NONE,
     collapsing exactly the distinction subscription.js's own readConfig()
     draws (absent -> NONE, unreadable -> UNKNOWN). A corrupted file is not
     evidence nobody signed in; it is evidence we cannot tell. */
  const dir = nodePath.join(SANDBOX, '.codex-corrupted');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), '{not valid json at all');
  return openai.checkLive(dir).then((r) => {
    assert.equal(r.state, sub.STATE.UNKNOWN);
    assert.match(r.because, /could not read/);
  });
});

test('#960: a parsed but unrecognised auth.json shape is UNKNOWN, not NONE', () => {
  // Parses fine as JSON, but matches none of identityOf()'s recognised
  // shapes (no auth_mode, no OPENAI_API_KEY) -- unrecognised, not absent.
  writeAuth('.codex-unrecognised', { some_future_field: 'codex has not been born yet when this was written' });
  const dir = nodePath.join(SANDBOX, '.codex-unrecognised');
  return openai.checkLive(dir).then((r) => {
    assert.equal(r.state, sub.STATE.UNKNOWN);
    assert.match(r.because, /could not find a usable sign-in/);
  });
});

test('#960: listLive() attaches a real connection to every row, live-checked in parallel', () => {
  writeAuth('.codex-listlive-good', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-goodkeyGOOD' });
  writeAuth('.codex-listlive-bad', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-badkeyBAD0' });
  openai.setFetcher(async (url, init) => (init.headers.authorization.endsWith('GOOD')
    ? { status: 200, body: {} }
    : { status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    return openai.listLive().then((rows) => {
      const good = rows.find((r) => r.label === 'listlive-good');
      const bad = rows.find((r) => r.label === 'listlive-bad');
      assert.equal(good.connection.state, sub.STATE.CONNECTED);
      assert.equal(bad.connection.state, sub.STATE.NONE);
    });
  } finally { openai.setFetcher(null); }
});

test('#960: listLive() catches one row throwing so it cannot sink the others', () => {
  writeAuth('.codex-listlive-throws', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-throwskeyTHROW' });
  writeAuth('.codex-listlive-fine', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-finekeyFINE' });
  /* Monkey-patch checkLive itself, exercising listLive()'s OWN catch rather
     than checkLive()'s internal one (checkLive() never rejects by
     contract) -- the same distinction #881's accounts.test.js draws for
     its identical listLive()/checkLive() pair. */
  const realCheckLive = openai.checkLive;
  openai.checkLive = (dir) => (String(dir).includes('throws')
    ? Promise.reject(new Error('boom'))
    : realCheckLive(dir));
  openai.setFetcher(async () => ({ status: 200, body: {} }));
  try {
    return openai.listLive().then((rows) => {
      const thrown = rows.find((r) => r.label === 'listlive-throws');
      const fine = rows.find((r) => r.label === 'listlive-fine');
      assert.equal(thrown.connection.state, sub.STATE.UNKNOWN);
      assert.equal(fine.connection.state, sub.STATE.CONNECTED);
    });
  } finally { openai.checkLive = realCheckLive; openai.setFetcher(null); }
});

test('#962 harness seam: AGENT_WORKFORCE_OPENAI_MODELS_URL points the live check at a stand-in, read per call', async () => {
  const http = require('node:http');
  const srv = http.createServer((q, r) => {
    const good = q.url === '/v1/models' && q.headers.authorization === 'Bearer sk-walk';
    r.writeHead(good ? 200 : 401, { 'content-type': 'application/json', connection: 'close' });
    r.end(JSON.stringify(good ? { data: [{ id: 'gpt-4o' }] } : { error: { code: 'invalid_api_key' } }));
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const dir = nodePath.join(SANDBOX, "seam-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, "auth.json"), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-walk' }));
  const prev = process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL;
  try {
    process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL = 'http://127.0.0.1:' + srv.address().port + '/v1/models';
    openai.setFetcher(null);
    const r = await openai.checkLive(dir);
    assert.equal(r.state, sub.STATE.CONNECTED, JSON.stringify(r));
    fs.writeFileSync(nodePath.join(dir, "auth.json"), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-other' }));
    const bad = await openai.checkLive(dir);
    assert.equal(bad.state, sub.STATE.NONE, JSON.stringify(bad));
    assert.match(bad.because, /did not accept/);
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL; else process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL = prev;
    srv.closeAllConnections();
    await new Promise((res) => srv.close(res));
  }
});

/**
 * #1337: `list()` must not disagree with itself about where home is.
 *
 * 🛑 FOUND BY ANGEL REVIEWING THIS BRANCH, and it is the seam I created and
 * then missed two lines from where I fixed it. `defaultDir()` was made lazy;
 * the module-level `const HOME` feeding the `.codex-*` SCAN and `nextWorkDir`
 * was left frozen at require time. So `list()`'s DEFAULT entry resolved lazily
 * while its SCAN used the frozen value.
 *
 * ⇒ A caller that set `AGENT_WORKFORCE_HOME` AFTER requiring this module got a
 * list whose default was sandboxed and whose scan read the operator's REAL
 * home. Sandboxed and not, in one call, and the sandboxed half is the
 * reassuring one - #1412's shape exactly, which is why it is not cosmetic.
 *
 * ⭐ MEASURED both arms with a negative control against the pre-fix file:
 *   pre-fix, env set after require  -> list() = 1, .codex-alpha NOT found
 *   post-fix, same                  -> list() = 2, .codex-alpha found
 * The control is what makes the second line mean anything: the fixture CAN
 * produce the failure, so a pass is evidence rather than a fixture that only
 * ever says two.
 */
test('#1337: the .codex-* scan follows a HOME set after require, like the default entry does', () => {
  const late = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-late-'));
  fs.mkdirSync(nodePath.join(late, '.codex'), { recursive: true });
  fs.mkdirSync(nodePath.join(late, '.codex-alpha'), { recursive: true });
  fs.writeFileSync(nodePath.join(late, '.codex', 'auth.json'), '{"OPENAI_API_KEY":"sk-default"}');
  fs.writeFileSync(nodePath.join(late, '.codex-alpha', 'auth.json'), '{"OPENAI_API_KEY":"sk-alpha"}');

  const before = process.env.AGENT_WORKFORCE_HOME;
  /* Set AFTER require - the module was required at the top of this file, which
     is precisely the condition that froze the scan. */
  process.env.AGENT_WORKFORCE_HOME = late;
  try {
    const got = openai.list();
    assert.ok(got.some((a) => String(a.dir).includes('.codex-alpha')),
      'the .codex-* scan did not follow AGENT_WORKFORCE_HOME set after require: it is frozen again, and list() now reads two different homes in one call');
    assert.ok(got.some((a) => a.isDefault),
      'the default entry vanished, so this test is no longer comparing the two halves of list() and proves nothing');
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = before;
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   #1372: an OpenAI account can be forgotten, without deleting the credential.

   A person could add up to 500 and remove none; the only way out was deleting
   a dot-directory in Terminal, which is the "total dead stop in the water"
   Josh described. These drive the real function against real directories.
   ────────────────────────────────────────────────────────────────────────── */

function acct(label, key) {
  const dir = nodePath.join(SANDBOX, label === 'default' ? '.codex' : '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-FAKE-' + (key || label) }));
  return dir;
}

test('#1372: forgetting an account hides it from list() and KEEPS the credential', () => {
  const dir = acct('forgetme', 'aaaa');
  assert.ok(openai.list().some((a) => a.dir === dir), 'it must be listed first, or the removal proves nothing');

  const got = openai.forgetAccount(dir, []);
  assert.equal(got.ok, true);
  assert.equal(got.forgotten, true);

  assert.ok(!openai.list().some((a) => a.dir === dir), 'it is gone from the list');
  assert.ok(fs.existsSync(nodePath.join(got.movedTo, 'auth.json')),
    'THE CREDENTIAL SURVIVES: this forgets, it does not delete');
});

test('#1372 PRECISION: the moved directory must not be listed under its new name', () => {
  /* 🛑 THE TRAP THIS ARM EXISTS FOR. `list()` finds accounts by
     `startsWith('.codex-')`, so the obvious `~/.codex-x.removed` would STILL
     be listed and the account would appear to survive its own removal. The
     prefix has to MOVE, not gain a suffix. Without this arm the test above
     passes on a rename that changed nothing that matters. */
  const dir = acct('precision', 'bbbb');
  const got = openai.forgetAccount(dir, []);
  assert.equal(got.forgotten, true);

  assert.ok(nodePath.basename(got.movedTo).startsWith('.removed-codex-'),
    'the new name must not begin with .codex-');
  assert.ok(!nodePath.basename(got.movedTo).startsWith('.codex-'),
    'a SUFFIX would leave it listed; this is the whole point');
  assert.ok(!openai.list().some((a) => a.dir === got.movedTo),
    'and list() must not find it under the new name either');
});

test('#1372: it REFUSES while an agent is on it, and NAMES the agents', () => {
  /* A refusal that cannot be acted on is the class this card came from. The
     person needs to know WHICH agents, not that there are some. */
  const dir = acct('inuse', 'cccc');

  const one = openai.forgetAccount(dir, ['marlowe']);
  assert.equal(one.ok, false);
  assert.equal(one.forgotten, false);
  assert.match(one.because, /marlowe/, 'the refusal must name the agent');
  assert.ok(fs.existsSync(dir), 'and it must not have moved anything');

  const many = openai.forgetAccount(dir, ['marlowe', 'spade']);
  assert.match(many.because, /marlowe/);
  assert.match(many.because, /spade/, 'both agents are named, not just a count');
  assert.ok(openai.list().some((a) => a.dir === dir), 'still listed, because nothing happened');
});

test('#1372 CONTROL: the refusal can tell "in use" from "not ours"', () => {
  /* Without this, both refusals could be one always-refuse branch and the
     arm above would pass on a function that never forgets anything. */
  const outside = nodePath.join(SANDBOX, 'not-an-account');
  fs.mkdirSync(outside, { recursive: true });
  const got = openai.forgetAccount(outside, []);
  assert.equal(got.ok, false);
  assert.match(got.because, /not an OpenAI account/);
  assert.ok(fs.existsSync(outside), 'and it left the directory alone');
});

test('#1372: a second forget of the same label does not clobber the first credential', () => {
  /* The one way this function could DELETE a credential is by renaming a
     second account on top of a first. */
  const a = acct('twice', 'dddd');
  const first = openai.forgetAccount(a, []);
  assert.equal(first.forgotten, true);
  const firstKey = fs.readFileSync(nodePath.join(first.movedTo, 'auth.json'), 'utf8');

  const b = acct('twice', 'eeee');
  const second = openai.forgetAccount(b, []);
  assert.equal(second.forgotten, true);
  assert.notEqual(second.movedTo, first.movedTo, 'it must pick a free name');

  assert.equal(fs.readFileSync(nodePath.join(first.movedTo, 'auth.json'), 'utf8'), firstKey,
    'THE FIRST CREDENTIAL IS UNTOUCHED');
  assert.ok(fs.existsSync(nodePath.join(second.movedTo, 'auth.json')));
});

test('#1372: forgetting something already gone is a quiet success', () => {
  const missing = nodePath.join(SANDBOX, '.codex-neverexisted');
  const got = openai.forgetAccount(missing, []);
  assert.equal(got.ok, true);
  assert.equal(got.forgotten, false);
});

/* 🛑 THE NAME IS NOT THE ACCOUNT. Every guard in `forgetAccount` above the
   identity check keys on the NAME (inside home, called `.codex` or `.codex-*`), so
   a real directory that codex never wrote passed all of them and was renamed with
   its contents, while the answer said `forgotten: true`.
   ⚠️ MEASURED BEFORE THE GUARD WAS WRITTEN, not argued from the Claude sibling: a
   planted `~/.codex-notanaccount` holding one user file was moved to
   `.removed-codex-notanaccount`, file and all.
   📌 Three arms, because the fix has two ways to be wrong: refusing a real account
   (a regression), and answering "not an account" for a directory that is merely
   absent (the reason the guard sits AFTER the existence check). */
test('#1659: forgetAccount refuses a .codex-* directory that codex never wrote, and keeps its files', () => {
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-identity-'));
  process.env.AGENT_WORKFORCE_HOME = home;
  try {
    const notAnAccount = nodePath.join(home, '.codex-notanaccount');
    fs.mkdirSync(notAnAccount, { recursive: true });
    fs.writeFileSync(nodePath.join(notAnAccount, 'important.txt'), 'a file the person made');

    const real = nodePath.join(home, '.codex-real');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(nodePath.join(real, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test-abcdefghijklmnop' }));

    const refused = openai.forgetAccount(notAnAccount, []);
    assert.equal(refused.forgotten, false,
      'a directory codex never wrote was renamed: the name-based guards passed it and nothing checked identity');
    assert.match(String(refused.because), /not an OpenAI account/);
    assert.ok(fs.existsSync(nodePath.join(notAnAccount, 'important.txt')),
      'the file inside it moved, which is the harm this guard exists to prevent');

    /* CONTROL, and it must be able to return the dangerous answer: a REAL account
       still has to be forgettable, or the guard has traded one failure for another. */
    const ok = openai.forgetAccount(real, []);
    assert.equal(ok.forgotten, true, 'a real OpenAI account can no longer be disconnected');

    /* CONTROL on the ORDERING: absent is "already gone", not "not an account". */
    const absent = openai.forgetAccount(nodePath.join(home, '.codex-never'), []);
    assert.match(String(absent.because), /already gone/,
      'a directory that is simply missing is reported as not-an-account, so the guard runs before the existence check');
  } finally {
    process.env.AGENT_WORKFORCE_HOME = SANDBOX;
  }
});

/* #1026: the OpenAI side of the model picker, sourced from /v1/models and
   filtered to chat families. chatModelsFromList is pure, so it is driven
   directly with a fixture; accountModels wraps it with the key-read + the
   fetch seam. A wrong model name is an agent that fails to start, so the arm
   that matters most is the filter REJECTING non-chat models -- controls prove
   it can, rather than only that chat models pass. */

test('#1026 chatModelsFromList keeps chat models, drops non-chat, sorts most-capable-first, one non-lite default', () => {
  const data = [
    { id: 'text-embedding-3-large' },     // non-chat family -> dropped
    { id: 'gpt-4o-audio-preview' },        // gpt-4o by prefix but a non-chat variant -> dropped
    { id: 'gpt-4o-realtime-preview' },     // ditto -> dropped
    { id: 'gpt-4o-transcribe' },           // ditto -> dropped
    { id: 'whisper-1' },                   // non-chat -> dropped
    { id: 'gpt-4o' },                      // chat
    { id: 'gpt-4o-mini' },                 // chat, lite
    { id: 'gpt-5' },                       // chat, most capable
    { id: 'gpt-5-mini' },                  // chat, lite
    { id: 'o3' },                          // chat, reasoning
    { id: 'chatgpt-4o-latest' },           // chat
    { id: 'gpt-5' },                       // duplicate -> collapsed
  ];
  const rows = openai.chatModelsFromList(data);
  const ids = rows.map((r) => r.arg);
  assert.deepEqual(ids, ['gpt-5', 'gpt-5-mini', 'o3', 'gpt-4o', 'gpt-4o-mini', 'chatgpt-4o-latest'],
    'chat models only, ranked by capability, deduped');
  // every arg is a real id from the fixture -- never invented.
  for (const r of rows) assert.ok(data.some((d) => d.id === r.arg), `${r.arg} came from the account list`);
  assert.ok(rows.every((r) => r.provider === 'openai'), 'every row is provider openai');
  const defaults = rows.filter((r) => r.default === true);
  assert.equal(defaults.length, 1, 'exactly one default');
  assert.equal(defaults[0].arg, 'gpt-5', 'the default is the most-capable non-lite model present, not gpt-5-mini');
  assert.equal(rows.find((r) => r.arg === 'gpt-4o').label, 'GPT-4o', 'gpt- is prettified to GPT-');
  assert.equal(rows.find((r) => r.arg === 'o3').label, 'o3', 'an o-series id is left as OpenAI writes it');
  assert.ok(rows.find((r) => r.arg === 'gpt-5').why, 'every row carries a why line');
});

test('#1026 the runner\'s own codex-mini and legacy gpt-4 chat models are recognised; gpt-3.5-turbo-instruct (completions) is not', () => {
  const data = [
    { id: 'codex-mini-latest' },        // the runner is codex -> a model it can drive
    { id: 'gpt-4-turbo' },              // legacy but real chat
    { id: 'gpt-4' },                    // legacy chat
    { id: 'gpt-3.5-turbo-instruct' },   // a COMPLETIONS model, not chat -> dropped by 'instruct'
    { id: 'o3-deep-research' },         // not a standard chat-completions model -> dropped by 'search'
    { id: 'gpt-4o' },                   // current chat, ranks above the legacy ones
  ];
  const args = openai.chatModelsFromList(data).map((r) => r.arg);
  assert.ok(args.includes('codex-mini-latest'), 'the codex runner\'s own model is offered');
  assert.ok(args.includes('gpt-4-turbo') && args.includes('gpt-4'), 'legacy gpt-4 chat models are offered');
  assert.ok(!args.includes('gpt-3.5-turbo-instruct'), 'a completions (instruct) model is not offered');
  assert.ok(!args.includes('o3-deep-research'), 'a deep-research model is not offered');
  assert.equal(args[0], 'gpt-4o', 'the current gpt-4o outranks the legacy gpt-4 family');
});

test('#1026 the default is the most-capable NON-LITE model even when a lite model sorts first', () => {
  // gpt-4o-mini (family gpt-4o, rank 3) sorts ahead of gpt-4-turbo (bare gpt-4,
  // rank 6), so out[0] is the LITE one. The default must still be the non-lite
  // gpt-4-turbo. This is the arm that reverting `find(!isLite) || out[0]` to a
  // bare `out[0]` breaks -- without this fixture that branch is untested,
  // because gpt-5 already sorts ahead of gpt-5-mini in the other cases.
  const rows = openai.chatModelsFromList([{ id: 'gpt-4o-mini' }, { id: 'gpt-4-turbo' }]);
  assert.equal(rows[0].arg, 'gpt-4o-mini', 'the lite model sorts first');
  const def = rows.filter((r) => r.default === true);
  assert.equal(def.length, 1, 'exactly one default');
  assert.equal(def[0].arg, 'gpt-4-turbo', 'the default skips the lite first row for the non-lite one');
});

test('#1026 CONTROL: a list of ONLY non-chat models yields an empty menu (the filter is not vacuously passing everything)', () => {
  const data = [
    { id: 'text-embedding-3-small' }, { id: 'tts-1' }, { id: 'dall-e-3' },
    { id: 'omni-moderation-latest' }, { id: 'gpt-4o-transcribe' }, { id: 'gpt-image-1' },
  ];
  assert.deepEqual(openai.chatModelsFromList(data), [], 'nothing chat-drivable survives the filter');
});

test('#1026 chatModelsFromList tolerates garbage input without throwing', () => {
  assert.deepEqual(openai.chatModelsFromList(null), []);
  assert.deepEqual(openai.chatModelsFromList(undefined), []);
  assert.deepEqual(openai.chatModelsFromList([{ notid: 1 }, 'x', null, {}]), []);
});

/* #2191: the list OpenAI returns is huge because it carries every dated snapshot
   of each model. chatModelsFromList collapses those to one row per model. These
   arms prove the collapse cuts the noise WITHOUT losing a model, without merging
   distinct models (mini/nano/latest), and without ever inventing an id. */

test('#2191 openaiSnapshotBase strips ONLY a trailing ISO date, not mini/nano/latest/preview or a mid-id date', () => {
  assert.equal(openai.openaiSnapshotBase('gpt-4o-2024-08-06'), 'gpt-4o');
  assert.equal(openai.openaiSnapshotBase('o3-2025-04-16'), 'o3');
  assert.equal(openai.openaiSnapshotBase('gpt-4o-mini-2024-07-18'), 'gpt-4o-mini', 'the date goes, -mini stays');
  // not a trailing ISO date -> untouched
  assert.equal(openai.openaiSnapshotBase('gpt-4o'), 'gpt-4o');
  assert.equal(openai.openaiSnapshotBase('gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(openai.openaiSnapshotBase('chatgpt-4o-latest'), 'chatgpt-4o-latest', '-latest is an alias, not a snapshot');
  assert.equal(openai.openaiSnapshotBase('gpt-4-1106-preview'), 'gpt-4-1106-preview', 'a mid-id date is left intact');
  assert.equal(openai.openaiSnapshotBase('codex-mini-latest'), 'codex-mini-latest');
});

test('#2191 dated snapshots collapse to one row per model, preferring the base alias when present', () => {
  const data = [
    { id: 'gpt-4o' },
    { id: 'gpt-4o-2024-05-13' },
    { id: 'gpt-4o-2024-08-06' },
    { id: 'gpt-4o-2024-11-20' },
    { id: 'gpt-4o-mini' },
    { id: 'gpt-4o-mini-2024-07-18' },
    { id: 'o3' },
    { id: 'o3-2025-04-16' },
  ];
  const rows = openai.chatModelsFromList(data);
  const ids = rows.map((r) => r.arg);
  // one row per MODEL: gpt-4o, gpt-4o-mini, o3 -- snapshots folded in, mini kept distinct.
  assert.deepEqual(ids, ['o3', 'gpt-4o', 'gpt-4o-mini'], 'one representative per base, ranked, mini not merged into gpt-4o');
  // the representative is the ALIAS (not a dated snapshot) because the account listed it.
  assert.ok(ids.every((id) => !/-\d{4}-\d{2}-\d{2}$/.test(id)), 'no dated snapshot survives as a row when its alias is present');
  // and every arg is a real id from the account, never invented.
  for (const r of rows) assert.ok(data.some((d) => d.id === r.arg), `${r.arg} came from the account list`);
});

test('#2191 when NO base alias is listed, the NEWEST dated snapshot represents the model (a real id, never synthesized)', () => {
  // The account returns only dated snapshots of gpt-4o -- no bare "gpt-4o".
  const data = [
    { id: 'gpt-4o-2024-05-13' },
    { id: 'gpt-4o-2024-11-20' },
    { id: 'gpt-4o-2024-08-06' },
  ];
  const rows = openai.chatModelsFromList(data);
  assert.equal(rows.length, 1, 'the three snapshots collapse to one row');
  assert.equal(rows[0].arg, 'gpt-4o-2024-11-20', 'the newest snapshot represents the model');
  // CRITICAL (#1026): a synthesized bare "gpt-4o" would fail to start -- the arg
  // must be one of the ids the account actually returned.
  assert.ok(data.some((d) => d.id === rows[0].arg), 'the representative is a real returned id, not an invented alias');
  assert.notEqual(rows[0].arg, 'gpt-4o', 'the bare alias was NOT listed, so it must not be invented');
});

test('#2191 CONTROL: collapse never drops a whole model -- a snapshots-only family still yields a usable row', () => {
  // Guards the direction that would be a real regression: over-collapsing to zero.
  const data = [{ id: 'o4-mini-2025-04-16' }];
  const rows = openai.chatModelsFromList(data);
  assert.equal(rows.length, 1, 'a model present only as a dated snapshot is still offered');
  assert.equal(rows[0].arg, 'o4-mini-2025-04-16', 'as its real snapshot id');
});

test('#2191 chatRunnableIds is the FULL un-collapsed chat set (snapshots kept, non-chat dropped)', () => {
  // The validation allowlist must NOT be narrowed by the display collapse: a
  // snapshot id the account has is still runnable. This is the direct guard for
  // the change-model / create routes.
  const data = [
    { id: 'gpt-4o' },
    { id: 'gpt-4o-2024-08-06' },      // a snapshot -- collapsed OUT of the menu, but still runnable
    { id: 'gpt-4o-mini' },
    { id: 'text-embedding-3-large' }, // non-chat -- must stay out
    { id: 'gpt-4o' },                 // duplicate -- deduped
  ];
  const runnable = openai.chatRunnableIds(data);
  assert.ok(runnable.includes('gpt-4o-2024-08-06'), 'a real snapshot id is runnable even though the menu collapses it');
  assert.ok(runnable.includes('gpt-4o') && runnable.includes('gpt-4o-mini'), 'aliases are runnable too');
  assert.ok(!runnable.includes('text-embedding-3-large'), 'a non-chat id is never runnable');
  assert.equal(runnable.filter((id) => id === 'gpt-4o').length, 1, 'deduped');
  // The split is the whole point: the collapsed menu drops the snapshot, the
  // runnable set keeps it.
  const menuKeys = openai.chatModelsFromList(data).map((r) => r.key);
  assert.ok(!menuKeys.includes('gpt-4o-2024-08-06'), 'the display menu collapses the snapshot');
  assert.ok(runnable.includes('gpt-4o-2024-08-06'), 'but the runnable set does not');
});

test('#2191 chatRunnableIds tolerates garbage without throwing', () => {
  assert.deepEqual(openai.chatRunnableIds(null), []);
  assert.deepEqual(openai.chatRunnableIds([{ notid: 1 }, 'x', null]), []);
});

/* #2191: runnableAllowlist is the glue both the create and change-model routes
   use to decide what a chosen model may be validated against. Its contract is
   the load-bearing part of the fix, so it is unit-tested directly rather than
   only through the routes: null MUST mean "do not refuse" (fail open, #1916), a
   real snapshot id MUST be accepted, and a genuinely-bogus id MUST be refused. */

test('#2191 runnableAllowlist: an ok result yields the FULL runnable set, so a snapshot id validates', () => {
  const got = { ok: true, models: [{ key: 'gpt-4o' }], runnableKeys: ['gpt-4o', 'gpt-4o-2024-08-06'] };
  const allowed = openai.runnableAllowlist(got);
  assert.deepEqual(allowed, ['gpt-4o', 'gpt-4o-2024-08-06']);
  // the route decision this drives: a real snapshot id is accepted, a bogus one refused.
  assert.ok(allowed.includes('gpt-4o-2024-08-06'), 'a stored snapshot id is accepted');
  assert.ok(!allowed.includes('gpt-4o-9999-99-99'), 'a model the account never listed is refused');
});

test('#2191 runnableAllowlist: falls back to the collapsed menu keys when runnableKeys is absent (older shape)', () => {
  const got = { ok: true, models: [{ key: 'gpt-4o' }, { key: 'o3' }, { notkey: 1 }] };
  assert.deepEqual(openai.runnableAllowlist(got), ['gpt-4o', 'o3'], 'menu keys, junk filtered out');
});

test('#2191 runnableAllowlist: a NOT-ok result returns null so the routes FAIL OPEN (#1916)', () => {
  // The account could not be checked (rejected key, unreachable, non-apikey, etc.)
  // -- validation must NOT refuse a choice on an answer we could not get.
  assert.equal(openai.runnableAllowlist({ ok: false, models: [], because: 'unreachable' }), null);
  assert.equal(openai.runnableAllowlist(null), null);
  assert.equal(openai.runnableAllowlist(undefined), null);
  assert.equal(openai.runnableAllowlist({ ok: true }), null, 'ok but no lists -> nothing to check against -> fail open');
});

test('#1026 accountModels: a 200 with a real /v1/models body returns the filtered menu with a default', async () => {
  writeAuth('.codex-models200', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-modelskeyMOD1' });
  const dir = nodePath.join(SANDBOX, '.codex-models200');
  let sawAuthHeader = null;
  openai.setFetcher(async (url, init) => {
    sawAuthHeader = init && init.headers && init.headers.authorization;
    return { status: 200, body: { object: 'list', data: [
      { id: 'gpt-4o' }, { id: 'gpt-5' }, { id: 'text-embedding-3-large' }, { id: 'gpt-4o-mini' },
    ] } };
  });
  try {
    const out = await openai.accountModels(dir);
    assert.equal(out.ok, true);
    assert.deepEqual(out.models.map((m) => m.arg), ['gpt-5', 'gpt-4o', 'gpt-4o-mini']);
    assert.equal(out.models.filter((m) => m.default).length, 1);
    assert.equal(sawAuthHeader, 'Bearer sk-proj-modelskeyMOD1', 'the account key was sent to /v1/models');
  } finally { openai.setFetcher(null); }
});

test('#2191 accountModels returns a collapsed menu AND an un-collapsed runnableKeys set (validation is not narrowed)', async () => {
  writeAuth('.codex-models-runnable', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-runnableKEY1' });
  const dir = nodePath.join(SANDBOX, '.codex-models-runnable');
  openai.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [
    { id: 'gpt-4o' }, { id: 'gpt-4o-2024-05-13' }, { id: 'gpt-4o-2024-08-06' }, { id: 'gpt-4o-mini' },
  ] } }));
  try {
    const out = await openai.accountModels(dir);
    assert.equal(out.ok, true);
    // The MENU is collapsed: one row per model, no dated snapshot rows.
    assert.deepEqual(out.models.map((m) => m.key), ['gpt-4o', 'gpt-4o-mini']);
    // The RUNNABLE set is the full un-collapsed chat set -- so the change-model /
    // create routes still accept a stored snapshot id that the menu no longer shows.
    assert.ok(Array.isArray(out.runnableKeys), 'accountModels exposes runnableKeys for validation');
    assert.ok(out.runnableKeys.includes('gpt-4o-2024-08-06'),
      'a real snapshot id stays runnable even though it is collapsed out of the menu');
    assert.ok(out.runnableKeys.includes('gpt-4o') && out.runnableKeys.includes('gpt-4o-mini'));
  } finally { openai.setFetcher(null); }
});

test('#1026 accountModels: a 200 whose models are ALL non-chat answers ok:false with a plain reason, not an empty pass', async () => {
  writeAuth('.codex-modelsnochat', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-nochatkeyNOC1' });
  const dir = nodePath.join(SANDBOX, '.codex-modelsnochat');
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'tts-1' }, { id: 'whisper-1' }] } }));
  try {
    const out = await openai.accountModels(dir);
    assert.equal(out.ok, false);
    assert.deepEqual(out.models, []);
    assert.match(String(out.because), /no chat models/);
  } finally { openai.setFetcher(null); }
});

test('#1026 accountModels: a non-200 is reported as such, never as an empty menu', async () => {
  writeAuth('.codex-models500', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-fivehundredKEY5' });
  const dir = nodePath.join(SANDBOX, '.codex-models500');
  openai.setFetcher(async () => ({ status: 500, body: null }));
  try {
    const out = await openai.accountModels(dir);
    assert.equal(out.ok, false);
    assert.match(String(out.because), /500/);
  } finally { openai.setFetcher(null); }
});

test('#1026 accountModels: a network failure answers ok:false with the unreachable reason', async () => {
  writeAuth('.codex-modelsdown', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-downkeyDOWN1' });
  const dir = nodePath.join(SANDBOX, '.codex-modelsdown');
  openai.setFetcher(async () => { throw new Error('boom'); });
  try {
    const out = await openai.accountModels(dir);
    assert.equal(out.ok, false);
    assert.match(String(out.because), /could not reach OpenAI/);
  } finally { openai.setFetcher(null); }
});

test('#1026 accountModels: a ChatGPT sign-in cannot list models (no API key), answered honestly not as empty', async () => {
  const payload = Buffer.from(JSON.stringify({ email: 'x@example.com' })).toString('base64url');
  writeAuth('.codex-modelschat', { auth_mode: 'chatgpt', tokens: { id_token: `a.${payload}.b` } });
  const dir = nodePath.join(SANDBOX, '.codex-modelschat');
  const out = await openai.accountModels(dir);
  assert.equal(out.ok, false);
  assert.match(String(out.because), /not an API key/);
});

test('#1026 accountModels: an absent account says nobody signed in, never a fetch', async () => {
  const out = await openai.accountModels(nodePath.join(SANDBOX, '.codex-modelsnever'));
  assert.equal(out.ok, false);
  assert.match(String(out.because), /signed in/);
});

test('#2095: addWithKey persists the EXACT typed name (not the path slug) and serves it as `name`', () => {
  const out = openai.addWithKey({ key: 'sk-proj-namedkeynamedkeyNAM1', label: 'My Work Account', codexBin: FAKE_CODEX });
  assert.equal(out.ok, true, out.because);
  // The dir/label is slug-sanitised for a safe path...
  assert.equal(out.account.label, 'my-work-account');
  // ...but the NAME preserves exactly what the person typed. This is the whole
  // point of the card: the slug is not a display name.
  assert.equal(out.account.name, 'My Work Account');
  // and it lives verbatim in the sidecar, never carrying the key.
  const nf = nodePath.join(SANDBOX, '.codex-my-work-account', '.kosmos-name');
  assert.equal(fs.readFileSync(nf, 'utf8').trim(), 'My Work Account');
  assert.ok(!fs.readFileSync(nf, 'utf8').includes('namedkey'), 'the name file must never hold the key');
});

test('#2095: list() serves the stored name for a named account', () => {
  writeAuth('.codex-listnamed', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-listnamedkeyLST1' });
  openai.writeName(nodePath.join(SANDBOX, '.codex-listnamed'), 'Renamed On List');
  const row = openai.list().find((r) => r.label === 'listnamed');
  assert.ok(row, 'the named account is listed');
  assert.equal(row.name, 'Renamed On List');
});

test('#2095: an account with NO name file has name:null and still lists (fail-open, the dangerous answer)', () => {
  // The load-bearing control: a missing sidecar must NEVER throw or drop the
  // account -- it must read as a plain "no name" so an unnamed account still works.
  writeAuth('.codex-nameless', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-nonamekeynonaNONM' });
  const row = openai.list().find((r) => r.label === 'nameless');
  assert.ok(row, 'a nameless account still lists');
  assert.equal(row.name, null, 'no name file -> name is null, not an error');
});

test('#2095: readName/writeName are fail-open and trim; an empty name is not written', () => {
  // Missing dir -> null, never a throw.
  assert.equal(openai.readName(nodePath.join(SANDBOX, '.codex-doesnotexist')), null);
  const d = nodePath.join(SANDBOX, '.codex-rn');
  fs.mkdirSync(d, { recursive: true });
  assert.equal(openai.writeName(d, '  Spaced Name  '), true);
  assert.equal(openai.readName(d), 'Spaced Name', 'a written name round-trips, whitespace-trimmed');
  // An empty/whitespace-only name is not a name: it is not written, and reads null.
  const e = nodePath.join(SANDBOX, '.codex-empty-name');
  fs.mkdirSync(e, { recursive: true });
  assert.equal(openai.writeName(e, '   '), false);
  assert.equal(openai.readName(e), null);
});

test('#2095: addWithKey with no label leaves name null (a work-slot account is not falsely named)', () => {
  const out = openai.addWithKey({ key: 'sk-proj-nolabelkeynolabNOL1', codexBin: FAKE_CODEX });
  assert.equal(out.ok, true, out.because);
  assert.match(out.account.label, /^work\d+$/);
  assert.equal(out.account.name, null, 'an auto-slotted account has no human-chosen name');
});

test('#2095: a live-rejected add into a REUSED auth-less dir cleans up the name sidecar (no stale-name leak)', async () => {
  // Pre-create an auth-less labelled dir so addWithKey succeeds into it with
  // madeDir=false (the undo path that removes files rather than the whole dir).
  const dir = nodePath.join(SANDBOX, '.codex-reusename');
  fs.mkdirSync(dir, { recursive: true });
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-deadnamedkeyDEAD', label: 'reusename', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    // The load-bearing assertion: the name sidecar must be gone on undo. If it
    // lingered, nextWorkDir would later reuse this auth-less slot and rowFor would
    // read this dead account's typed name onto a DIFFERENT account.
    assert.equal(fs.existsSync(nodePath.join(dir, '.kosmos-name')), false, 'the orphaned name file must be cleaned up on undo');
    assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), false, 'the auth.json must be cleaned up on undo');
    assert.equal(openai.readName(dir), null);
  } finally { openai.setFetcher(null); }
});

test('#2095: writeName clamps an over-long name (a raw API call cannot bloat the served record)', () => {
  const d = nodePath.join(SANDBOX, '.codex-longname');
  fs.mkdirSync(d, { recursive: true });
  assert.equal(openai.writeName(d, 'x'.repeat(500)), true);
  assert.equal(openai.readName(d).length, 120, 'the stored name is clamped to the bounded length');
});

test('#2095: the clamp is code-point-safe (an emoji at the boundary is not split into a lone surrogate)', () => {
  const d = nodePath.join(SANDBOX, '.codex-emojiname');
  fs.mkdirSync(d, { recursive: true });
  // 119 plain chars then an astral emoji: the emoji straddles the 120th UTF-16
  // unit. A code-point-safe clamp keeps or drops it whole, never a U+FFFD half.
  openai.writeName(d, 'a'.repeat(119) + '\u{1F600}' + 'tail');
  const got = openai.readName(d);
  assert.ok(!got.includes('�'), 'no replacement char from a split surrogate');
  assert.ok(got.includes('\u{1F600}'), 'the astral char at the 120th code point survives WHOLE, not dropped or halved');
  assert.equal([...got].length, 120, 'clamped to exactly 120 code points (119 + the whole emoji)');
});

test('#2095: a made-dir live-rejection removes the whole dir including the name file (belt-and-suspenders)', async () => {
  // The higher-stakes branch: addWithKey CREATED the dir (madeDir=true), so undo
  // rmSyncs the whole dir recursively -- the name file goes with it.
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const out = await openai.addWithKeyLive({ key: 'sk-proj-madedirdeadMADE', label: 'madedirdead', codexBin: FAKE_CODEX });
    assert.equal(out.ok, false);
    const dir = nodePath.join(SANDBOX, '.codex-madedirdead');
    assert.equal(fs.existsSync(dir), false, 'the whole made dir is gone, so no orphaned name file');
    assert.equal(openai.readName(dir), null);
  } finally { openai.setFetcher(null); }
});
