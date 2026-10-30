'use strict';

/**
 * kosmos#7416 slice 3 through the real server (in-process, every root sandboxed, dry run): the keep-awake switch's
 * route and its place on /api/machine's sleep row. Off when never set; the PUT takes only a screen and only true or
 * false. On a Mac the sleep row carries the switch; anywhere else the route refuses and the row has none. The board
 * runs under AGENT_WORKFORCE_DRY_RUN, so the hold is decided and reported and no caffeinate is started.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-keepawake-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const fleet = require('./test-support/fleet');

let port = 0;
test.before(async () => { await start(0); port = server.address().port; });
test.after(() => {
  fleet.restore();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* node:http, so the Origin header is sent as written (fetch controls some request headers itself). */
function call(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch { j = null; } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const screen = () => ({ origin: `http://127.0.0.1:${port}` });
const MAC = process.platform === 'darwin';

test('#7416 slice 3: the switch reads off when never set, and only a screen may change it, to true or false', async () => {
  const first = await call('GET', '/api/keepawake-setting');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { on: false, ok: true, supported: MAC, holding: false, because: '' }, 'a person who never chose it got it on');
  const noScreen = await call('PUT', '/api/keepawake-setting', { on: true });
  assert.equal(noScreen.status, 403, 'a caller that is not the screen changed it');
  const notBool = await call('PUT', '/api/keepawake-setting', { on: 'yes' }, screen());
  assert.equal(notBool.status, 400, 'a value that is not true or false was taken');
  assert.equal((await call('GET', '/api/keepawake-setting')).json.on, false, 'a refused change was saved anyway');
  const on = await call('PUT', '/api/keepawake-setting', { on: true }, screen());
  if (!MAC) {
    assert.equal(on.status, 409, 'a computer Kosmos cannot keep awake took the setting');
    assert.equal((await call('GET', '/api/keepawake-setting')).json.on, false);
    return;
  }
  assert.equal(on.status, 200, 'CONTROL: the screen can change it');
  assert.deepEqual(on.json, { on: true, ok: true, supported: true, holding: false, because: '' }, 'it held with no agent working');
  const off = await call('PUT', '/api/keepawake-setting', { on: false }, screen());
  assert.deepEqual(off.json, { on: false, ok: true, supported: true, holding: false, because: '' });
});

test('#7416 slice 3: the sleep row carries the switch on a Mac, only with the setting read, and nowhere else', async () => {
  const read = async () => {
    const m = await call('GET', '/api/machine');
    assert.equal(m.status, 200);
    return (m.json.checks || []).find((c) => c && c.key === 'sleep');
  };
  const row = await read();
  assert.ok(row, 'CONTROL: /api/machine has a sleep row');
  if (!MAC) { assert.equal('keepAwake' in row, false, 'a switch was drawn where nothing can hold the computer awake'); return; }
  assert.deepEqual(row.keepAwake, { on: false, holding: false, because: '' });
  await call('PUT', '/api/keepawake-setting', { on: true }, screen());
  assert.deepEqual((await read()).keepAwake, { on: true, holding: false, because: '' }, 'the row did not follow the saved setting');
  /* An unreadable setting draws no switch: a position nobody checked is never shown. */
  const file = require('./engine/keepawake-setting').FILE;
  fs.writeFileSync(file, '{not json');
  assert.equal('keepAwake' in (await read()), false, 'a switch was drawn from a setting that could not be read');
  fs.rmSync(file);
});

test('#7416 slice 3: with the switch on, a working card holds the computer, and switching off lets it go', { skip: !MAC && 'Mac only' }, async () => {
  const board = fleet.install([fleet.agent('busy', { state: 'working' })]);
  assert.equal(board.card('busy').state, 'working', 'CONTROL: the board reads the agent as working');
  const on = await call('PUT', '/api/keepawake-setting', { on: true }, screen());
  assert.equal(on.status, 200);
  assert.equal(on.json.holding, true, 'a working agent did not hold the computer awake');
  const row = (await call('GET', '/api/machine')).json.checks.find((c) => c && c.key === 'sleep');
  assert.deepEqual(row.keepAwake, { on: true, holding: true, because: '' }, 'the sleep row did not say it is holding');
  const off = await call('PUT', '/api/keepawake-setting', { on: false }, screen());
  assert.equal(off.json.holding, false, 'switching it off kept the hold');
  fleet.restore();
});
