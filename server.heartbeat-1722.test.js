'use strict';
/* #1722: the Settings > Automation heartbeat setting routes. GET returns the
 * in-force value (the setting file the runner reads, no second copy) plus the
 * closed interval choices; PUT takes an on/off change, an interval change, or
 * both, and a rejected interval leaves the stored value unchanged. In-process
 * harness, same shape as server.gate-log-off.test.js, with a sandboxed data root
 * so the setting file never touches the operator's real store. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hb-launch-'));

const { start, server } = require('./server');

let base;
test('boot the board', async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

const getJson = async (p) => (await fetch(`${base}${p}`)).json();
const put = async (p, body) => {
  const res = await fetch(`${base}${p}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

test('GET defaults: off, interval 17, and the closed interval choices', async () => {
  const r = await getJson('/api/heartbeat-setting');
  assert.equal(r.on, false);
  assert.equal(r.intervalMinutes, 17);
  assert.deepEqual(r.intervals, [5, 10, 17, 60]);
  assert.equal(r.ok, true);
});

test('PUT on:true turns it on and is read back', async () => {
  const w = await put('/api/heartbeat-setting', { on: true });
  assert.equal(w.status, 200);
  assert.equal(w.json.on, true);
  const r = await getJson('/api/heartbeat-setting');
  assert.equal(r.on, true);
});

test('PUT intervalMinutes:60 sets the interval', async () => {
  const w = await put('/api/heartbeat-setting', { intervalMinutes: 60 });
  assert.equal(w.status, 200);
  assert.equal(w.json.intervalMinutes, 60);
});

test('PUT a non-choice interval is a 400 and does NOT change the stored value', async () => {
  const before = (await getJson('/api/heartbeat-setting')).intervalMinutes;
  const w = await put('/api/heartbeat-setting', { intervalMinutes: 7 });
  assert.equal(w.status, 400);
  assert.ok(w.json.error);
  const after = (await getJson('/api/heartbeat-setting')).intervalMinutes;
  assert.equal(after, before, 'a rejected interval left the in-force value unchanged, so a failed write is visible');
});

test('PUT can set on and interval together', async () => {
  await put('/api/heartbeat-setting', { on: false, intervalMinutes: 5 });
  const r = await getJson('/api/heartbeat-setting');
  assert.equal(r.on, false);
  assert.equal(r.intervalMinutes, 5);
});

test.after(() => { server.closeAllConnections(); server.close(); });
