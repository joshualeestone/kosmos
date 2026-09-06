'use strict';
/**
 * #2238: route-level coverage for the world-switch RESTART arms of
 * POST /api/worlds/active. These are the arms that ride Josh's fresh-install
 * re-test BLIND -- on the shared/from-source box canSelfRestart is always false,
 * so the restarting:true FIRED-restart arm can never be exercised there, and the
 * no-op / manual-banner arms only ever take one branch. This mocks
 * boardrestart.canSelfRestart + selfRestart (the route calls them via require, so
 * patching the cached module works) to drive all three arms WITHOUT ever issuing a
 * real `launchctl stop`. It is the insurance for exactly what no e2e on this box can
 * cover; the fail-safe branches of canSelfRestart itself are in
 * engine/boardrestart-2238.test.js, and the booted-world capture in
 * engine/worldenv.booted-2238.test.js.
 *
 *   node --test server.switch-arms-2238.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-switch-arms-2238-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
// Tracked so test.after removes them too (not just SANDBOX).
const TEMP_ROOTS = [];
const rootTemp = (p) => { const d = mkTemp(p); TEMP_ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_WORKERS = rootTemp('aw-sa-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = rootTemp('aw-sa-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = rootTemp('aw-sa-launch-');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const boardrestart = require('./engine/boardrestart');
const { start, server } = require('./server');

// The route reads canSelfRestart/selfRestart off the required module at call time,
// so these patches take effect. selfRestart is a SPY that never touches launchctl.
// Originals are saved + restored in test.after -- that restore is what contains the
// patch to this file. (Node's default test isolation also runs each file in its own
// process, but the runner does not pass --test-isolation explicitly, so the restore,
// not the runner flag, is the guarantee.)
const _origCanSelfRestart = boardrestart.canSelfRestart;
const _origSelfRestart = boardrestart.selfRestart;
let canRestart = false;
let selfRestartCalls = 0;
boardrestart.canSelfRestart = () => ({ canRestart, because: canRestart ? 'mock: self-restartable' : 'mock: not self-restartable' });
boardrestart.selfRestart = () => { selfRestartCalls += 1; return { ok: true }; };

let base;
const jpost = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const post = (p, obj) => jpost(p, obj).then(async (r) => ({ status: r.status, body: await r.json() }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll until pred() or a generous deadline -- robust to a loaded event loop delaying
// the route's 500ms deferred restart (no fixed-margin flake).
async function waitUntil(pred, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) return false; await wait(20); }
  return true;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // The board booted into 'default' (sandbox with no registry). Create named worlds
  // to switch INTO (real, non-no-op switches).
  await jpost('/api/worlds', { name: 'Alpha World' });
  await jpost('/api/worlds', { name: 'Beta World' });
});
test.after(() => {
  boardrestart.canSelfRestart = _origCanSelfRestart;
  boardrestart.selfRestart = _origSelfRestart;
  try { server.close(); } catch { /* best effort */ }
  for (const d of [SANDBOX, ...TEMP_ROOTS]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

test('canSelfRestart TRUE + a real switch -> restarting:true, restartRequired:true, and the restart FIRES after the response (the arm nobody can e2e here)', async () => {
  canRestart = true; selfRestartCalls = 0;
  const r = await post('/api/worlds/active', { id: 'alphaworld' });
  assert.equal(r.status, 200);
  assert.equal(r.body.world.id, 'alphaworld', 'the response reports the switched-to world');
  assert.equal(r.body.restartRequired, true, 'a real switch needs a restart');
  assert.equal(r.body.restarting, true, 'a self-restartable board reports it is restarting now');
  // The restart is deferred 500ms so the response flushes first; it must NOT have
  // fired synchronously (the response would have been killed), and it MUST fire after.
  assert.equal(selfRestartCalls, 0, 'the restart is fired AFTER the response, never before it flushes');
  assert.equal(await waitUntil(() => selfRestartCalls === 1), true, 'the deferred self-restart actually fired');
  assert.equal(selfRestartCalls, 1, 'fired exactly once');
});

test('canSelfRestart FALSE + a real switch -> restarting:false, restartRequired:true, and NO restart fires (the manual-banner arm a from-source board takes)', async () => {
  canRestart = false; selfRestartCalls = 0;
  const r = await post('/api/worlds/active', { id: 'betaworld' });
  assert.equal(r.status, 200);
  assert.equal(r.body.restartRequired, true, 'the switch still needs a restart -- a MANUAL one');
  assert.equal(r.body.restarting, false, 'a board that cannot self-restart never claims it is');
  await wait(700);
  assert.equal(selfRestartCalls, 0, 'a non-self-restartable board never issues a stop -- it cannot be bricked');
});

test('a NO-OP switch to the already-booted world -> restartRequired:false, restarting:false, no restart, even with canSelfRestart TRUE', async () => {
  canRestart = true; selfRestartCalls = 0;
  // The board booted into 'default'; switching to 'default' is a no-op regardless of
  // what the registry pointer currently is (isNoop keys on the BOOTED world).
  const r = await post('/api/worlds/active', { id: 'default' });
  assert.equal(r.status, 200);
  assert.equal(r.body.restartRequired, false, 'already serving this world -- no restart needed');
  assert.equal(r.body.restarting, false, 'a no-op never self-restarts');
  await wait(700);
  assert.equal(selfRestartCalls, 0, 'a no-op switch never restarts the board (no pointless ~10s cycle)');
});
