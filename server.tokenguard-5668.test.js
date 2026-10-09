'use strict';
/*
 * #5668: /api/status carries a token-only agent's last guard run (tokenGuard), read from the record every guard run
 * writes, so the agent's page can say when its protection is not complete or its shell may not run. Only an agent on
 * the token-only list carries it, and only once a run has recorded it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenguard-5668-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenguard-5668-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenguard-5668-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenguard-5668-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenguard-5668-launch-'));
process.on('exit', () => {
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const store = require('./engine/store');
const sendertoken = require('./engine/sendertoken');
const setup = require('./engine/setup-assistant');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

async function cards() {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
  assert.equal(r.status, 200);
  const by = {};
  for (const a of (await r.json()).agents || []) by[a.sessionName] = a;
  return by;
}
function record(agents) {
  const d = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  for (const [name, line] of Object.entries(agents)) fs.writeFileSync(path.join(d, encodeURIComponent(name) + '.json'), JSON.stringify(line));
}

test('#5668: the route carries tokenGuard for a listed agent with a record, and nothing for one not listed', async (t) => {
  const b = fleet.install([fleet.agent('Tok', { state: 'idle' }), fleet.agent('Warned', { state: 'idle' }), fleet.agent('Good', { state: 'idle' }), fleet.agent('NoRec', { state: 'idle' }), fleet.agent('Plain', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(sendertoken.tokenOnlyFile(), { force: true }); fs.rmSync(path.join(store.ROOT, setup.GUARD_STATE_DIR), { recursive: true, force: true }); });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['Tok', 'Warned', 'Good', 'NoRec'] }));
  const at = '2026-10-09T11:00:00.000Z';
  record({
    Tok: { ok: false, because: 'the PATH this agent starts with has an entry Kosmos could not cover (x)', at },
    Warned: { ok: false, because: 'why', warning: 'past the sandbox size', at },
    Good: { ok: true, at },
    Plain: { ok: false, because: 'a record for an agent not on the list', at },
  });
  const c = await cards();
  assert.ok(c.Tok && c.Plain, 'CONTROL: the fixture agents are on the route: ' + Object.keys(c).join(','));
  assert.deepEqual(c.Tok.tokenGuard, { state: 'notWhole', because: 'the PATH this agent starts with has an entry Kosmos could not cover (x)', at });
  assert.deepEqual(c.Warned.tokenGuard, { state: 'notWhole', because: 'why', warning: 'past the sandbox size', at }, 'not whole outranks the warning, and both are carried');
  assert.deepEqual(c.Good.tokenGuard, { state: 'guarded', at });
  assert.equal(c.NoRec.tokenGuard, undefined, 'a listed agent with no record yet carried a state');
  assert.equal(c.Plain.tokenGuard, undefined, 'an agent not on the token-only list carried the guard state');
});

test('#5668: a whole guard past the size is state warning on the route', async (t) => {
  const b = fleet.install([fleet.agent('Big', { state: 'idle' })]);
  t.after(() => { b.restore(); fs.rmSync(sendertoken.tokenOnlyFile(), { force: true }); fs.rmSync(path.join(store.ROOT, setup.GUARD_STATE_DIR), { recursive: true, force: true }); });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['Big'] }));
  record({ Big: { ok: true, warning: 'past', at: 't' } });
  assert.deepEqual((await cards()).Big.tokenGuard, { state: 'warning', warning: 'past', at: 't' });
  // No list at all: nothing is carried, even with a record.
  fs.rmSync(sendertoken.tokenOnlyFile(), { force: true });
  assert.equal((await cards()).Big.tokenGuard, undefined);
});
