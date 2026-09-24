'use strict';
/* #2619: the Settings > Automation Recommender and Assigner setting routes at the
 * HTTP boundary. The module layer (engine/recommender-setting.test.js,
 * engine/assigner-setting.test.js) proves read/write/setOn/setGuard; this proves
 * the routes wire them correctly - in particular the Recommender PUT's one-field-
 * per-request dispatch (an {on} vs a {guard,value}, guard taking precedence), the
 * fail-safe guard direction seen through the route, and that a rejected write is a
 * 400 that leaves the stored value unchanged. In-process harness, same shape as
 * server.heartbeat-1722.test.js, with a sandboxed data root so the setting files
 * never touch the operator's real store. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-home-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rec-launch-'));

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

/* ---- Recommender ---- */

test('GET recommender defaults: OFF (behaviour pending), all three guards ON, guardKeys published, ok', async () => {
  const r = await getJson('/api/recommender-setting');
  assert.equal(r.on, false, 'an unwired automation must not read as on');
  assert.deepEqual(r.guards, { money: true, public: true, delete: true }, 'a never-configured install is maximally guarded');
  assert.deepEqual(r.guardKeys, ['money', 'public', 'delete'], 'the route publishes the guard order the engine owns (the behaviour PR live UI renders from it; the current disabled UI does not consume it yet)');
  assert.equal(r.ok, true);
});

test('PUT on:true enables the Recommender and is read back', async () => {
  const w = await put('/api/recommender-setting', { on: true });
  assert.equal(w.status, 200);
  assert.equal(w.json.on, true);
  assert.equal((await getJson('/api/recommender-setting')).on, true);
});

test('PUT {guard,value} flips ONE guard and leaves the other two ON (one-field-per-PUT)', async () => {
  const w = await put('/api/recommender-setting', { guard: 'money', value: false });
  assert.equal(w.status, 200);
  assert.deepEqual(w.json.guards, { money: false, public: true, delete: true },
    'flipping money must not reset public/delete - the whole reason the route dispatches one field');
  // and a second single-guard flip is likewise isolated
  const w2 = await put('/api/recommender-setting', { guard: 'delete', value: false });
  assert.deepEqual(w2.json.guards, { money: false, public: true, delete: false });
});

test('PUT an unknown guard name is a 400 and changes nothing', async () => {
  const before = (await getJson('/api/recommender-setting')).guards;
  const w = await put('/api/recommender-setting', { guard: 'wire-money', value: false });
  assert.equal(w.status, 400);
  assert.ok(w.json.error);
  assert.deepEqual((await getJson('/api/recommender-setting')).guards, before, 'a typo guard must not silently no-op AND must not disturb the real guards');
});

test('PUT a non-boolean guard value is a 400 (fail-safe: a guard never falls to a truthy string)', async () => {
  const w = await put('/api/recommender-setting', { guard: 'public', value: 'off' });
  assert.equal(w.status, 400);
  assert.ok(w.json.error);
  assert.equal((await getJson('/api/recommender-setting')).guards.public, true, 'public stayed at its safe ON');
});

test('PUT dispatches ONE field: a body carrying both a guard and on applies the guard, not on', async () => {
  await put('/api/recommender-setting', { on: false }); // baseline off
  const w = await put('/api/recommender-setting', { guard: 'public', value: false, on: true });
  assert.equal(w.status, 200);
  assert.equal(w.json.guards.public, false, 'the guard was applied');
  assert.equal(w.json.on, false, 'on was NOT applied in the same request - guard takes precedence, one field per PUT');
});

test('PUT with neither {on} nor {guard} is a 400 (nothing to set)', async () => {
  const w = await put('/api/recommender-setting', { nonsense: 1 });
  assert.equal(w.status, 400);
  assert.ok(w.json.error);
});

/* ---- Assigner ---- */

test('GET assigner defaults: OFF (behaviour pending), ok', async () => {
  const r = await getJson('/api/assigner-setting');
  assert.equal(r.on, false, 'an unwired automation must not read as on');
  assert.equal(r.ok, true);
});

test('PUT assigner on:true enables it and is read back; on:false turns it off', async () => {
  const w = await put('/api/assigner-setting', { on: true });
  assert.equal(w.status, 200);
  assert.equal(w.json.on, true);
  assert.equal((await getJson('/api/assigner-setting')).on, true);
  const w2 = await put('/api/assigner-setting', { on: false });
  assert.equal(w2.json.on, false);
});

test('PUT assigner a non-boolean on is a 400 and does not change the stored value', async () => {
  await put('/api/assigner-setting', { on: true }); // known baseline
  const w = await put('/api/assigner-setting', { on: 'yes' });
  assert.equal(w.status, 400);
  assert.ok(w.json.error);
  assert.equal((await getJson('/api/assigner-setting')).on, true, 'a rejected write left the in-force value unchanged');
});

test.after(() => { server.closeAllConnections(); server.close(); });
