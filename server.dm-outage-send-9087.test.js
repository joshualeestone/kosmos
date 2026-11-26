'use strict';

/**
 * kosmos#9087 Part B: on Windows, while `claude agents --json` cannot be read, a message to an agent of ours whose
 * supervisor is up, whose ownership rows are all Claude, and whose supervisor's state file reads busy or idle goes
 * through its pipe (chat's channel seam here). Everything else keeps #9085's 409 unreadable. The roster is fed
 * through status.setPaneSource, and the Windows evidence through server's outage seam. Runs on every platform.
 *
 *   node --test server.dm-outage-send-9087.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-outage-send-9087-'));
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
const win32roster = require('./engine/win32roster');

let source = () => null;
let base;
let logged = [];
const realError = console.error;
test.before(async () => {
  status.setPaneSource(() => source());
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  source = () => null;
  logged = [];
  console.error = (...a) => { logged.push(a.join(' ')); };
  app._setStartWaitForTest({ maxMs: 0 });
  app._setClaudeReadProblemForTest(() => null);   // a healthy Claude read unless a test says otherwise, on every platform
  fs.mkdirSync(create.workerDir('raph'), { recursive: true });
});
test.afterEach(() => { console.error = realError; });
test.after(() => {
  console.error = realError;
  app._setClaudeReadProblemForTest(null);
  app._setStartWaitForTest(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* kosmos#9087 Part B: on Windows, while `claude agents --json` cannot be read, a message to a supervised agent of ours
   goes through its supervisor's pipe. The pipe is chat's channel seam; the evidence is the outage seam. */
let said = [];
test.beforeEach(() => {
  said = [];
  chat.setChannel((session, wire) => { said.push({ session, wire }); return { ok: true }; });
  app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '', at: '2026-11-25T00:00:00Z' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => true, streamToken: () => 'idle' });
});
test.afterEach(() => { chat.setChannel(null); app._setOutageChannelForTest(null); });

async function send(name, text) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/thread`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('#9087 an unreadable roster on Windows: a supervised agent of ours is handed the message through its pipe', async () => {
  assert.throws(() => status.paneRoster(), 'CONTROL: the roster really refuses');
  const r = await send('raph', 'hello during the outage');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.delivery.state, chat.DELIVERY.PLACED, JSON.stringify(r.json));
  assert.equal(said.length, 1, 'handed over once');
  assert.equal(said[0].session, 'raph');
  assert.match(String(said[0].wire), /hello during the outage/);
  assert.ok(logged.some((l) => /kosmos#9087/.test(l) && /"raph" is checked against its supervisor/.test(l)), JSON.stringify(logged));
  assert.throws(() => status.paneRoster(), 'the roster is never padded: it still refuses after the send');
});

test('#9087 a busy state file is sent through the pipe too (a message to a working agent queues there)', async () => {
  app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => true, streamToken: () => 'busy' });
  const r = await send('raph', 'hello');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(said.length, 1);
});

test('#9087 CONTROL: a button press during the outage is never sent through the pipe (it answers a question the board saw)', async () => {
  for (const extra of [{ chose: 'Yes' }, { asked: 'Proceed?' }, { request: 'a'.repeat(64) }]) {
    const res = await fetch(`${base}/api/agent/raph/thread`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '1', ...extra }),
    });
    const json = await res.json().catch(() => null);
    assert.equal(res.status, 409, JSON.stringify(extra) + ' ' + JSON.stringify(json));
    assert.equal(json.because, 'unreadable', JSON.stringify(json));
  }
  assert.equal(said.length, 0);
});

test('#9087 the real state file decides: a busy file for the recorded session sends; another session\'s file does not', async () => {
  const store = require('./engine/store');
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, store.safeKey('raph') + '.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, pid: 4242, sessionId: 's1', state: 'busy', at: new Date().toISOString() }));
  try {
    app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), isAlive: (pid) => pid === 4242 });
    const r = await send('raph', 'hello');
    assert.equal(r.status, 200, 'the real file, read through liveIdentity and stateFor: ' + JSON.stringify(r.json));
    assert.equal(said.length, 1);
    app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s2: { name: 'raph', runner: '' } }), isAlive: (pid) => pid === 4242 });
    const other = await send('raph', 'hello');
    assert.equal(other.status, 409, 'CONTROL: a file for a session the record does not file under the name: ' + JSON.stringify(other.json));
    assert.equal(said.length, 1);
    fs.writeFileSync(file, JSON.stringify({ v: 1, pid: 4242, sessionId: 's1', state: 'busy', at: new Date().toISOString(),
      limit: { until: new Date(Date.now() + 3600000).toISOString(), kind: 'weekly' } }));
    app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), isAlive: (pid) => pid === 4242 });
    const limited = await send('raph', 'hello');
    assert.equal(limited.status, 409, 'CONTROL: the real file read as a usage limit: ' + JSON.stringify(limited.json));
    assert.equal(said.length, 1);
    fs.writeFileSync(file, JSON.stringify({ v: 1, pid: 4242, sessionId: 's1', state: 'busy', at: new Date().toISOString() }));
    app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), isAlive: (pid) => pid === 4242, bootMs: Date.now() + 60000 });
    const lastBoot = await send('raph', 'hello');
    assert.equal(lastBoot.status, 409, 'CONTROL: a file written before this boot: ' + JSON.stringify(lastBoot.json));
    assert.equal(said.length, 1);
  } finally { fs.rmSync(file, { force: true }); }
});

test('#9087 CONTROL: a removed agent whose folder is still here is never sent through the pipe or told to retry', async () => {
  const removal = require('./engine/remove');
  const realIsRemoved = removal.isRemoved;
  removal.isRemoved = (n) => n === 'raph' || realIsRemoved(n);
  try {
    assert.ok(fs.existsSync(create.workerDir('raph')), 'CONTROL: the folder is here');
    const r = await send('raph', 'hello');
    assert.equal(r.status, 404, JSON.stringify(r.json));
    assert.equal(r.json.retry, undefined);
    assert.equal(said.length, 0);
  } finally { removal.isRemoved = realIsRemoved; }
});

test('#9087 the Windows arm behind a readable roster (a codex agent up, the Claude read failing) sends through the pipe too', async () => {
  source = () => fleet.line({ session: 'cody', claim: 'cody' }) + '\n';
  app._setClaudeReadProblemForTest(() => 'the status read exited with code 3');
  const r = await send('raph', 'hello');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(said.length, 1);
});

const REFUSED = [
  ['not Windows', { win32: false, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }) }],
  ['its supervisor is not up', { win32: true, liveNames: () => new Set(), owned: () => ({ s1: { name: 'raph', runner: '' } }) }],
  ['no ownership row under the name', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'someone', runner: '' } }) }],
  ['a per-turn runner', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: 'codex' } }) }],
  ['one of two rows per-turn', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' }, s2: { name: 'raph', runner: 'gemini' } }) }],
  ['its state file reads a usage limit', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => true, streamToken: () => 'limit 2026-11-26T00:00:00.000Z - - weekly' }],
  ['its state file reads a refused sign-in', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => true, streamToken: () => 'auth 2026-11-25T00:00:00.000Z idle' }],
  ['the process its state file names is not alive', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => false, streamToken: () => 'idle' }],
  ['its state file does not read', { win32: true, liveNames: () => new Set(['raph']), owned: () => ({ s1: { name: 'raph', runner: '' } }), identity: () => ({ pid: 4242, sessionId: 's1' }), isAlive: () => true, streamToken: () => null }],
];
for (const [why, seam] of REFUSED) {
  test(`#9087 CONTROL: ${why}: still #9085's 409 unreadable, nothing handed over`, async () => {
    app._setOutageChannelForTest(seam);
    const r = await send('raph', 'hello');
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.because, 'unreadable');
    assert.equal(said.length, 0);
  });
}

test('#9087 CONTROL: a name with no agent folder here is a 404 even with a supervisor and a row', async () => {
  app._setOutageChannelForTest({ win32: true, liveNames: () => new Set(['nobody']), owned: () => ({ s1: { name: 'nobody', runner: '' } }) });
  const r = await send('nobody', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.equal(said.length, 0);
});

test('#9087 CONTROL: a roster that READS and does not list the name is a 404, never sent through the pipe', async () => {
  source = () => '';
  const r = await send('raph', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.equal(said.length, 0);
});

test('#9087 the channel card agrees with snapshot\'s card for the same Windows row on every field a delivery reads', () => {
  source = () => win32roster.rowLine('raph', '') + '\n';
  const fromSnapshot = status.snapshot().agents.find((a) => a.sessionName === 'raph');
  assert.ok(fromSnapshot, 'CONTROL: snapshot builds a card for the row');
  const built = status.channelCardFor('raph', '');
  for (const k of ['name', 'sessionName', 'session', 'target', 'isAgentPane', 'isAgentSession', 'isFleetSession', 'isNamedOurs', 'paneless', 'reachedByChannel', 'runner', 'swarm']) {   // swarm: kosmos#9090 review 1
    assert.deepEqual(built[k], fromSnapshot[k], k);
  }
  assert.equal(built.state, status.STATE.UNKNOWN, 'nobody looked, so its state is not claimed');
  assert.equal(built.outageCard, true);
});

test('#9087 win32roster.make emits rowLine\'s bytes for a recorded Claude session', () => {
  const src = win32roster.make({ run: () => [{ sessionId: 'abc12345-0000-4000-8000-000000000001', name: 'raph' }],
    record: { read: () => ({ 'abc12345-0000-4000-8000-000000000001': { name: 'raph', runner: '' } }) }, codexLive: () => [] });
  assert.equal(src(), win32roster.rowLine('raph', '') + '\n');
});
