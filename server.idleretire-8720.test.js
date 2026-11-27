'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#8720 through the real server (in-process, every root sandboxed, dry run): the idle-retire route. It reads
 * off and 30 days when never set; its PUT takes only a screen (an Origin the board serves), only true or false for
 * on and only a listed number of days, and answers with the same view GET gives (setting, verdicts, recent).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-idleretire-route-')));
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
const store = require('./engine/store');

let port = 0;
test.before(async () => { await start(0); port = server.address().port; });
test.after(() => {
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
const settingOf = (r) => r.json && r.json.setting;

test('#8720: the setting reads off and 30 days when never set, with the verdict list and the recent retirements', async () => {
  const first = await call('GET', '/api/idle-retire');
  assert.equal(first.status, 200);
  assert.deepEqual(settingOf(first), { on: false, days: 30, ok: true }, 'a person who never set it did not get it off');
  assert.deepEqual(first.json.choices, [14, 30, 60, 90]);
  assert.ok(Array.isArray(first.json.verdicts), 'Settings was not given the verdicts');
  assert.ok(Array.isArray(first.json.recent), 'Settings was not given the recent retirements');
});

test('#8720: only a screen may change it, and only to a real value; a refused change is not saved', async () => {
  const noScreen = await call('PUT', '/api/idle-retire', { on: true });
  assert.equal(noScreen.status, 403, 'a caller that is not the screen turned it on');
  const notBool = await call('PUT', '/api/idle-retire', { on: 'yes' }, screen());
  assert.equal(notBool.status, 400, 'a value that is not true or false was taken');
  const badDays = await call('PUT', '/api/idle-retire', { days: 7 }, screen());
  assert.equal(badDays.status, 400, 'a number of days that is not offered was taken');
  const nothing = await call('PUT', '/api/idle-retire', {}, screen());
  assert.equal(nothing.status, 400, 'an empty change answered as if it saved something');
  assert.deepEqual(settingOf(await call('GET', '/api/idle-retire')), { on: false, days: 30, ok: true }, 'a refused change was saved anyway');
  assert.equal(fs.existsSync(path.join(store.ROOT, 'idleretire.json')), false, 'a refused change wrote the setting file');

  const on = await call('PUT', '/api/idle-retire', { on: true }, screen());
  assert.equal(on.status, 200, 'CONTROL: the screen can turn it on');
  assert.deepEqual(settingOf(on), { on: true, days: 30, ok: true });
  const days = await call('PUT', '/api/idle-retire', { days: 60 }, screen());
  assert.equal(days.status, 200);
  assert.deepEqual(settingOf(days), { on: true, days: 60, ok: true }, 'changing the days turned it off or lost the days');
  assert.deepEqual(settingOf(await call('GET', '/api/idle-retire')), { on: true, days: 60, ok: true }, 'the change did not stick');
  const off = await call('PUT', '/api/idle-retire', { on: false }, screen());
  assert.deepEqual(settingOf(off), { on: false, days: 60, ok: true }, 'turning it off lost the chosen days');
});
