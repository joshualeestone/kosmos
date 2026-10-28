'use strict';
/* kosmos#7406: the Settings > Automation route for the per-account cap (GET/PUT /api/workcap-setting) at the HTTP
 * boundary, the twin of server.agycap-4588.test.js. engine/workcap-7406.test.js proves read/set and the gate; this
 * proves the route wires them, that only the screen may change it (an agent must not lift the cap on itself), that a
 * refused write leaves the stored value unchanged, and that the two caps are separate settings. */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-workcap-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-workcap-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-workcap-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-workcap-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-workcap-launch-'));

const { start, server } = require('./server');
const capSetting = require('./engine/workcap-setting');
const agycapSetting = require('./engine/agycap-setting');

let base;
test('boot the board, with the setting file inside the sandbox', async () => {
  assert.ok(path.resolve(capSetting.FILE).startsWith(path.resolve(process.env.AGENT_WORKFORCE_DATA) + path.sep), capSetting.FILE);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

const getJson = async (p) => { const res = await fetch(`${base}${p}`); return { status: res.status, json: await res.json() }; };
const put = async (body, screen = true) => {
  const headers = { 'content-type': 'application/json' };
  if (screen) headers['sec-fetch-site'] = 'same-origin';   // a browser caller; anything else is a process
  const res = await fetch(`${base}/api/workcap-setting`, { method: 'PUT', headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

test('GET: no limit by default, the choices published, ok', async () => {
  const r = await getJson('/api/workcap-setting');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { maxWorking: 0, choices: [0, 2, 4, 6, 8, 12, 16], ok: true });
});

test('PUT from the screen saves a choice and it is read back', async () => {
  const w = await put({ maxWorking: 2 });
  assert.equal(w.status, 200);
  assert.equal(w.json.maxWorking, 2);
  assert.equal((await getJson('/api/workcap-setting')).json.maxWorking, 2);
});

test('PUT from a process (no browser header) is refused 403 and the stored value stays', async () => {
  await put({ maxWorking: 2 });
  const w = await put({ maxWorking: 0 }, false);
  assert.equal(w.status, 403);
  assert.match(w.json.error, /only you can change this/);
  assert.equal((await getJson('/api/workcap-setting')).json.maxWorking, 2, 'an agent could not lift the cap');
  const ok = await put({ maxWorking: 0 });
  assert.equal(ok.status, 200, 'CONTROL: the same body from the screen is accepted');
});

test('PUT a value outside the set is a 400 and the stored value stays', async () => {
  await put({ maxWorking: 6 });
  const w = await put({ maxWorking: 3 });   // a Gemini cap value, not this one's
  assert.equal(w.status, 400);
  assert.ok(w.json.error);
  assert.equal((await getJson('/api/workcap-setting')).json.maxWorking, 6);
});

test('the two caps are separate settings: saving this one leaves the Gemini cap as it was', async () => {
  await put({ maxWorking: 8 });
  assert.equal(agycapSetting.read().maxWorking, 0);
  assert.equal((await getJson('/api/agycap-setting')).json.maxWorking, 0);
});

test.after(() => { server.closeAllConnections(); server.close(); });
