'use strict';

/**
 * kosmos#9090 (the follow-up to #9087): on Windows, while `claude agents --json` cannot be read, the routes that type
 * one command into an agent (compact, clear, handoff-restart ask and pickup) send it through the agent's supervisor
 * pipe, as the DM send does since #9087 Part B, on the same evidence (server.js outageChannelCard). The handoff
 * dialog's freshness poll (handoff-restart/status) reads the handoff file through the same card, so a handoff written
 * during the outage is seen. Everything without that evidence keeps the 409 to retry, and a missing name is still a
 * 404. The roster is fed through status.setPaneSource, the Windows evidence through server's outage seam, and the pipe
 * is chat's channel seam. Runs on every platform.
 *
 *   node --test server.command-outage-9090.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cmd-outage-9090-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./server');
const { start, server } = app;
const status = require('./engine/status');
const create = require('./engine/create');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');

let source = () => null;
let base;
let logged = [];
let said = [];
const realError = console.error;
const SUPERVISED = { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '', at: '2026-11-25T00:00:00Z' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => true, streamToken: () => 'idle' };

test.before(async () => {
  status.setPaneSource(() => source());
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  source = () => null;
  logged = [];
  said = [];
  console.error = (...a) => { logged.push(a.join(' ')); };
  app._setStartWaitForTest({ maxMs: 0 });
  app._setClaudeReadProblemForTest(() => null);   // a healthy Claude read unless a test says otherwise, on every platform
  fs.mkdirSync(create.workerDir('raph'), { recursive: true });
  chat.setChannel((session, wire) => { said.push({ session, wire }); return { ok: true }; });
  app._setOutageChannelForTest(SUPERVISED);
});
test.afterEach(() => { console.error = realError; chat.setChannel(null); app._setOutageChannelForTest(null); });
test.after(() => {
  console.error = realError;
  app._setClaudeReadProblemForTest(null);
  app._setStartWaitForTest(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function post(name, route) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function poll(name, baseline) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/handoff-restart/status?baseline=${encodeURIComponent(baseline)}`);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const ROUTES = [
  { path: 'compact', what: 'a /compact', wire: /^\/compact$/ },
  { path: 'clear', what: 'a /clear', wire: /^\/clear$/ },
  { path: 'handoff-restart/ask', what: 'a handoff request', wire: /handoff/i },
  { path: 'handoff-restart/pickup', what: 'a handoff pickup', wire: /handoff/i },
];

for (const { path: route, what, wire } of ROUTES) {
  test(`#9090 ${route}: an unreadable roster on Windows hands the command to a supervised agent's pipe`, async () => {
    assert.throws(() => status.paneRoster(), 'CONTROL: the roster really refuses');
    const r = await post('raph', route);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.state, chat.DELIVERY.PLACED, JSON.stringify(r.json));
    assert.equal(said.length, 1, 'handed over once');
    assert.equal(said[0].session, 'raph');
    assert.match(String(said[0].wire), wire);
    const escaped = what.replace(/[/]/g, '\\/');
    assert.ok(logged.some((l) => /kosmos#9090/.test(l) && new RegExp(escaped + ' to "raph" is checked against its supervisor').test(l)),
      'the board log names what and who: ' + JSON.stringify(logged));
    assert.throws(() => status.paneRoster(), 'the roster is never padded: it still refuses after the send');
  });

  test(`#9090 ${route} CONTROL: no supervisor evidence keeps #9087's 409 unreadable, and nothing is handed over`, async () => {
    app._setOutageChannelForTest({ ...SUPERVISED, liveNames: () => new Set() });
    const r = await post('raph', route);
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.because, 'unreadable');
    assert.equal(r.json.retry, true);
    assert.equal(said.length, 0);
  });

  test(`#9090 ${route} CONTROL: a name with no agent folder here is a 404 even with a supervisor and a row`, async () => {
    app._setOutageChannelForTest({ ...SUPERVISED, liveNames: () => new Set(['nobody']), owned: () => ({ s1: { name: 'nobody', runner: '' } }) });
    const r = await post('nobody', route);
    assert.equal(r.status, 404, JSON.stringify(r.json));
    assert.equal(said.length, 0);
  });

  test(`#9090 ${route}: the Windows arm behind a readable roster (a codex agent up, the Claude read failing) goes through the pipe`, async () => {
    source = () => fleet.line({ session: 'cody', claim: 'cody' }) + '\n';
    app._setClaudeReadProblemForTest(() => 'the status read exited with code 3');
    const r = await post('raph', route);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(said.length, 1);
    assert.equal(said[0].session, 'raph');
  });
}

/* The evidence is outageChannelCard's, unchanged; each way it refuses is a 409 on every command route. */
const REFUSED = [
  ['not Windows', { ...SUPERVISED, win32: false }],
  ['a per-turn runner', { ...SUPERVISED, owned: () => ({ s1: { name: 'raph', runner: 'codex' } }) }],
  ['its state file reads a usage limit', { ...SUPERVISED, streamToken: () => 'limit 2026-11-26T00:00:00.000Z - - weekly' }],
  ['the process its state file names is not alive', { ...SUPERVISED, isAlive: () => false }],
];
for (const [why, seam] of REFUSED) {
  test(`#9090 CONTROL: ${why}: every command route keeps the 409 unreadable`, async () => {
    app._setOutageChannelForTest(seam);
    for (const { path: route } of ROUTES) {
      const r = await post('raph', route);
      assert.equal(r.status, 409, route + ' ' + JSON.stringify(r.json));
      assert.equal(r.json.because, 'unreadable', route);
    }
    assert.equal(said.length, 0);
  });
}

test('#9090 a busy supervised agent is sent /compact through the pipe too (it queues there, as it does on a good read)', async () => {
  app._setOutageChannelForTest({ ...SUPERVISED, streamToken: () => 'busy' });
  const r = await post('raph', 'compact');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(said.length, 1);
});

test('#9090 a Meta Muse agent is still refused compact during the outage (its own memory), before anything is typed', async () => {
  const realRunner = create.recordedRunner;
  create.recordedRunner = (n) => (n === 'raph' ? 'muse' : realRunner(n));
  try {
    const r = await post('raph', 'compact');
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(String(r.json.delivery && r.json.delivery.because), /Meta Muse keeps its own memory/);
    assert.equal(said.length, 0);
  } finally { create.recordedRunner = realRunner; }
});

/* The handoff dialog: ask, the agent writes its handoff, the dialog polls status until fresh. During the outage the
   poll answered 404, which the dialog reads as "not written yet" until it gives up. */
test('#9090 handoff-restart/status sees a handoff written during the outage', async () => {
  const ask = await post('raph', 'handoff-restart/ask');
  assert.equal(ask.status, 200, JSON.stringify(ask.json));
  assert.ok(ask.json.handoffPath, 'the ask names the handoff file');
  const before = await poll('raph', ask.json.baseline);
  assert.equal(before.status, 200, JSON.stringify(before.json));
  assert.equal(before.json.fresh, false, 'CONTROL: not fresh before the agent writes it');
  fs.mkdirSync(path.dirname(ask.json.handoffPath), { recursive: true });
  fs.writeFileSync(ask.json.handoffPath, '# handoff\n');
  const after = await poll('raph', ask.json.baseline);
  assert.equal(after.status, 200, JSON.stringify(after.json));
  assert.equal(after.json.fresh, true, 'the poll sees the write: ' + JSON.stringify(after.json));
  fs.rmSync(ask.json.handoffPath, { force: true });
});

test('#9090 handoff-restart/status CONTROL: without the evidence an unreadable roster is a 409 to retry, never the 404 the dialog cannot tell from missing', async () => {
  app._setOutageChannelForTest({ ...SUPERVISED, liveNames: () => new Set() });
  const r = await poll('raph', '');
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.because, 'unreadable');
  assert.equal(r.json.retry, true);
  assert.doesNotMatch(String(r.json.error), /nothing was sent/, 'a read, so not the send sentence');
});

test('#9090 handoff-restart/status CONTROL: a name with no agent here is still a 404, and a roster that reads and lists the agent answers from it', async () => {
  const gone = await poll('nobody', '');
  assert.equal(gone.status, 404, JSON.stringify(gone.json));
  source = () => fleet.line({ session: 'raph', claim: 'raph' }) + '\n';
  app._setOutageChannelForTest(null);
  const ok = await poll('raph', '');
  assert.equal(ok.status, 200, 'a good read, no outage path: ' + JSON.stringify(ok.json));
  assert.equal(ok.json.fresh, false);
  source = () => '';
  const missing = await poll('raph', '');
  assert.equal(missing.status, 404, 'a roster that reads and does not list the name: ' + JSON.stringify(missing.json));
});
