'use strict';
/* kosmos#6596 step 8, slice 2: the route a person uses to accept a changed Kosmos+ key, against the real server with
   the engine's call replaced so a call that got through is seen. As the typed-code Allow: made on this computer
   (loopback Host and Origin, no forwarder), with its own board session, by a person at the screen. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acceptkey-srv-6596-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, REMOTE_NOT_ALLOWED, boardAuthState } = require('./server');
const remote = require('./engine/remote');

let base;
let origin;
const calls = [];
const real = { acceptOfferedKey: remote.acceptOfferedKey };
remote.acceptOfferedKey = (k) => { calls.push(k); return k === 'good' ? { ok: true, because: null } : { ok: false, because: 'that is not a key Kosmos+ offered' }; };
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  origin = base;
});
test.after(() => {
  Object.assign(remote, real);
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const SCREEN = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = { 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' };
const post = async (headers, body) => {
  const res = await fetch(base + '/api/remote/accept-key', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('accepting a changed key: only on this computer, by a person at the screen', async () => {
  calls.length = 0;
  let r = await post({ ...SCREEN, origin, ...VIA_PLUS }, { key: 'good' });
  assert.equal(r.status, 403, 'through Kosmos+');
  assert.deepEqual(r.body, { ...REMOTE_NOT_ALLOWED.acceptKey });
  r = await post(SCREEN, { key: 'good' });
  assert.equal(r.status, 403, 'with no Origin it is not shown to be made on this computer');
  r = await post({ ...SCREEN, origin: 'https://evil.example' }, { key: 'good' });
  assert.equal(r.status, 403, 'from a page on another origin');
  r = await post({ ...SCREEN, origin, 'x-kosmos-agent-token': 'an-agent' }, { key: 'good' });
  assert.equal(r.status, 403, 'an agent, whatever browser headers it also sends');
  assert.deepEqual(calls, [], 'a refused request reached the engine');
  r = await post({ ...SCREEN, origin }, { key: 'good' });
  assert.equal(r.status, 200, 'CONTROL: from the screen on this computer: ' + JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(calls, ['good']);
  r = await post({ ...SCREEN, origin }, { key: 'bad' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'that is not a key Kosmos+ offered');
});

test('with the board token enforced, only the app window\'s own session may accept', async () => {
  const TOK = 'BOARDTOKEN_acceptkey_0123456789ab';
  assert.equal(boardAuthState.on, false, 'CONTROL: the sandboxed board started unenforced');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  try {
    const boot = await fetch(base + '/?token=' + TOK, { redirect: 'manual' });
    await boot.text().catch(() => {});
    const m = (boot.headers.get('set-cookie') || '').match(/kosmos_board=([0-9a-f]{64});/);
    assert.ok(m, 'CONTROL: the bootstrap sets a session cookie');
    calls.length = 0;
    let r = await post({ ...SCREEN, origin, 'x-kosmos-board-token': TOK }, { key: 'good' });
    assert.equal(r.status, 403, 'the token in a header is not the app window');
    assert.deepEqual(calls, [], 'a refused request reached the engine');
    r = await post({ ...SCREEN, origin, cookie: 'kosmos_board=' + m[1] }, { key: 'good' });
    assert.equal(r.status, 200, 'CONTROL: the session cookie: ' + JSON.stringify(r.body));
    assert.deepEqual(calls, ['good']);
  } finally { boardAuthState.on = false; boardAuthState.token = null; }
});
