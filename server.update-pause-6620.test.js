'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#6620 (O04-5), through the REAL /api/update route (review 6: a source pin cannot see a refusal that is present
 * but broken): an Install press during the fleet's update pause is refused 409 with the pause sentence; not paused, it
 * goes past the pause; with nothing on offer it is "no update" without asking the coordinator at all. A local server
 * stands in for the coordinator's /v1/meta; the installer runner is a stub, so nothing is installed.
 *
 *   node --test server.update-pause-6620.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-updpause-6620-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const update = require('./engine/update');
const { start, server } = require('./server');

let base; let meta; let metaBase; let answer = { updates_paused: false }; let asked = 0;
const before = process.env.KOSMOS_UPDATE_PAUSE_URL;
test.before(async () => {
  meta = http.createServer((req, res) => {
    asked += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer));
  });
  await new Promise((r) => meta.listen(0, '127.0.0.1', r));
  metaBase = `http://127.0.0.1:${meta.address().port}`;
  process.env.KOSMOS_UPDATE_PAUSE_URL = metaBase + '/v1/meta';
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  if (before === undefined) delete process.env.KOSMOS_UPDATE_PAUSE_URL; else process.env.KOSMOS_UPDATE_PAUSE_URL = before;
  update.setFetcher(null); update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null); update.resetCache();
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  try { meta.close(); } catch { /* best effort */ }
});

/** A board offered `version`, installed (a stub root), automatic updates off, and an installer that runs nothing. */
async function offer(version) {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version }) }));
  update.setInstalledRoot(() => path.join(SANDBOX, 'kosmos-install-root'));
  update.setAutoPref(() => ({ on: false, ok: true }));
  update.setInstallRunner(() => ({ on() {}, unref() {} }));
  await update.refresh();
}
async function press() {
  const res = await fetch(`${base}/api/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { status: res.status, out: await res.json().catch(() => null) };
}
const SENTENCE = () => update.PAUSED_SENTENCE.charAt(0).toUpperCase() + update.PAUSED_SENTENCE.slice(1) + '.';

test('an Install press during a pause is refused 409 with the pause sentence; CONTROL: not paused, it goes past the pause', async () => {
  await offer('99.0.0');
  assert.ok(update.available(), 'PRECONDITION: a newer version is on offer');
  answer = { updates_paused: true };
  const n = asked;
  const held = await press();
  assert.equal(held.status, 409, JSON.stringify(held.out));
  assert.equal(held.out && held.out.error, SENTENCE());
  assert.equal(asked, n + 1, 'the press asked the coordinator once');

  answer = { updates_paused: false };
  const free = await press();
  assert.notEqual(free.out && free.out.error, SENTENCE(), 'CONTROL: not paused, the pause refused it: ' + JSON.stringify(free.out));
  // Review 7: the control reaches the install itself, so a refusal for another reason cannot pass as it.
  assert.equal(free.status, 200, JSON.stringify(free.out));
  assert.equal(free.out && free.out.updating, '99.0.0');
  answer = { updates_paused: false };
});

test('with nothing on offer, the press is "no update" and the coordinator is not asked', async () => {
  await offer('0.0.1');
  assert.equal(update.available(), null, 'PRECONDITION: nothing newer on offer');
  answer = { updates_paused: true };
  const n = asked;
  const r = await press();
  assert.equal(r.status, 409);
  assert.match(String(r.out && r.out.error), /there is no update to install right now/);
  assert.equal(asked, n, 'a press with nothing on offer asked the coordinator');
  answer = { updates_paused: false };
});
