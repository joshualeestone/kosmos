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
