'use strict';
/**
 * #3568 on Windows, the board's own routes against the REAL agy on a computer that is signed in:
 * GET /api/antigravity says it is offered and installed, POST /api/antigravity/check answers signed in
 * (through `agy models`, no prompt spent), and POST /api/antigravity/win32signin finds it already
 * signed in and ends at once, without opening Google's page. A sandboxed board on port 0.
 *
 * SKIPS off-win32, without agy at KOSMOS_TEST_AGY_BIN (or the default below), or when not signed in.
 *
 *   node -r <no-schtasks-preload> --test engine/win32agysignin.e2e.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-routes-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_WINDOWS;

const test = require('node:test');
const assert = require('node:assert/strict');

const AGY_BIN = process.env.KOSMOS_TEST_AGY_BIN || 'C:\\Users\\joshu\\work\\agy-e2e\\runners\\antigravity\\agy.exe';

test('#3568 Windows board routes, real agy, signed in: offered, checked without a prompt, sign-in done without a page', { timeout: 120000 }, async (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(AGY_BIN)) { t.skip('needs Windows and agy at ' + AGY_BIN); return; }
  const w = require('./win32agy');
  if ((await w.modelsCheck(AGY_BIN, path.join(SANDBOX, 'probe', '.gemini'), { tmp: path.join(SANDBOX, 'probe', 'tmp') })).signedIn !== true) {
    t.skip('needs a Google sign-in on this computer'); return;
  }
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = AGY_BIN;
  const opened = [];
  require('./win32agysignin').setOpener((link) => opened.push(link));
  const { start, server } = require('../server');
  await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const j = async (p, method, body) => {
    const r = await fetch(base + p, { method: method || 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.deepEqual((await j('/api/antigravity')).body, { installed: true, enabled: true, supported: true }, 'offered on Windows by default');
    assert.deepEqual((await j('/api/antigravity/check', 'POST')).body, { installed: true, signedIn: true });
    const s = await j('/api/antigravity/win32signin', 'POST');
    assert.equal(s.status, 200);
    assert.equal(s.body.ok, true);
    let st = null;
    for (let i = 0; i < 100; i++) { st = (await j('/api/antigravity/win32signin')).body; if (st.state !== 'starting') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(st.state, 'signed-in', JSON.stringify(st));
    assert.equal(st.id, s.body.id);
    assert.deepEqual(opened, [], 'already signed in: Google\'s page is never opened');
    const wrong = await j('/api/antigravity/win32signin/code', 'POST', { id: 'not-it', code: '4/0AXl-whatever' });
    assert.equal(wrong.status, 409, 'a code for a sign-in that is not the current one is a conflict');
  } finally {
    delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
    require('./win32agysignin').resetForTests();
    await new Promise((res) => server.close(res));
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
