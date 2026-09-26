'use strict';
/*
 * #3410: /api/status tells the page where a connection_lost agent's automatic reconnect stands,
 * read from the SAME book the self-heal sweep writes (server.js CONNLOST_BOOK). Proves the route
 * emits null when the sweep is not running (live execution off, or the operator brake on), so
 * the page never promises a retry nobody will send, and follows the book otherwise. An idle
 * agent always gets null (the control that the field is keyed on the state).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-reconnect-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-reconnect-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-reconnect-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-reconnect-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connlost-reconnect-launch-'));
process.on('exit', () => {
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const app = require('./server');
const { start, server, CONNLOST_BOOK } = app;
const fleet = require('./test-support/fleet');
const liveExecution = require('./engine/live-execution');

test.before(async () => { await start(0); });
test.after(() => {
  liveExecution.resetForTests();
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

async function cards() {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
  assert.equal(r.status, 200);
  const body = await r.json();
  const by = {};
  for (const a of body.agents || []) by[a.name] = a;
  return by;
}

test('the route reports the reconnect phase from the sweep\'s own book, and null whenever nothing will retry', async (t) => {
  const b = fleet.install([fleet.agent('Nettie', { state: 'connection_lost' }), fleet.agent('Ida', { state: 'idle' })]);
  t.after(() => { b.restore(); CONNLOST_BOOK.clear(); delete process.env.AGENT_WORKFORCE_CONNLOST_HEAL_OFF; liveExecution.resetForTests(); });

  // Live execution off (as under every test): the sweep is inert, so no promise.
  let c = await cards();
  assert.equal(c.Nettie.state, 'connection_lost', 'fixture did not produce a connection_lost card');
  assert.equal(c.Nettie.reconnect, null, 'promised a reconnect while the sweep cannot run');
  assert.equal(c.Ida.reconnect, null);

  liveExecution.allowLiveExecution();
  c = await cards();
  assert.deepEqual(c.Nettie.reconnect, { phase: 'waiting', tries: 0 }, 'before any retry the phase is waiting');
  assert.equal(c.Ida.reconnect, null, 'an agent that has not lost its connection carries no reconnect');

  // The route reads the SAME Map the sweep writes (keyed by sessionName).
  CONNLOST_BOOK.set(c.Nettie.sessionName, { evidence: 'x', sweeps: 3, nudges: [Date.now()] });
  assert.deepEqual((await cards()).Nettie.reconnect, { phase: 'retried', tries: 1 });
  CONNLOST_BOOK.set(c.Nettie.sessionName, { evidence: 'x', sweeps: 3, nudges: [1], escalated: true });
  assert.equal((await cards()).Nettie.reconnect.phase, 'gave_up');

  // The operator brake stops the sweep, so the promise goes too.
  process.env.AGENT_WORKFORCE_CONNLOST_HEAL_OFF = '1';
  assert.equal(app.connlostHealEnabled(), false);
  assert.equal((await cards()).Nettie.reconnect, null, 'promised a reconnect with the operator brake on');
});

/* #3726: the project routes read the roster through safeRoster, which now carries the same
   reconnect, so a connection Kosmos has given up on lights the project's Issue count as it lights
   the board's. Control: a reconnect still waiting does not. */
test('#3726: /api/projects counts a given-up connection as needing the person, from the same book', async (t) => {
  const b = fleet.install([fleet.agent('Nettie', { state: 'connection_lost' })]);
  t.after(() => { b.restore(); CONNLOST_BOOK.clear(); liveExecution.resetForTests(); });
  liveExecution.allowLiveExecution();
  const nettie = (await cards()).Nettie;
  const projectsEngine = require('./engine/projects');
  const dir = fs.mkdtempSync(path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'pj-3726-'));
  const made = projectsEngine.create({ name: 'Issue 3726', folder: dir, agents: [nettie.sessionName] });
  const row = async () => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/projects`);
    assert.equal(r.status, 200);
    return ((await r.json()).projects || []).find((p) => p.id === made.id);
  };
  let p = await row();
  assert.equal(p.agents[0].reconnect.phase, 'waiting', 'the project member does not carry the board\'s reconnect');
  assert.equal(p.summary.needsYou, 0, 'a reconnect still waiting was counted as needing the person');
  CONNLOST_BOOK.set(nettie.sessionName, { evidence: 'x', sweeps: 3, nudges: [1], escalated: true });
  p = await row();
  assert.equal(p.agents[0].reconnect.phase, 'gave_up');
  assert.equal(p.summary.needsYou, 1, 'a given-up connection did not light the project (#3726)');
});
