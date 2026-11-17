'use strict';

/**
 * kosmos#8658: an agent's message (`kosmos msg`, POST /api/msg) to an agent that has only just started on Windows
 * was answered "we cannot see an agent by exactly this name" and not kept, the same race #8652 closed for a person's
 * message. It now waits for the roster row the same way (server.js startingAgent / awaitRosterRow), then sends, or
 * answers that the agent is still starting. A name that is really missing answers as before, at once.
 *
 * The sender is identified by its agent token (the header form `kosmos msg` uses), and the roster comes through
 * status.setPaneSource, so this runs on every platform.
 *
 *   node --test server.msg-starting-8658.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-msg-starting-8658-'));
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
const store = require('./engine/store');
const create = require('./engine/create');
const chat = require('./engine/chat');
const messagesEngine = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

const RECORD = path.join(store.ROOT, 'win32-sessions', 'record.json');
const STATE_DIR = path.join(store.ROOT, 'win32-state');   // the supervisors' state files (engine/win32streamstate.js)
const SENDER = 'writer';

/* The roster: the sender is always there; `name`'s tied row is listed only from `visibleAt` on. */
let roster = { name: null, visibleAt: Infinity };
function rosterSource() {
  const lines = [fleet.line({ session: SENDER, claim: SENDER })];
  if (roster.name && Date.now() >= roster.visibleAt) lines.push(fleet.line({ session: roster.name, claim: roster.name }));
  return lines.join('\n') + '\n';
}

function worker(name) { fs.mkdirSync(create.workerDir(name), { recursive: true }); }
function recordRow(name, agoMs) {
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(RECORD, 'utf8')); } catch { cur = {}; }
  const id = '00000000-0000-4000-8000-' + String(Object.keys(cur).length + 1).padStart(12, '0');
  cur[id] = { name, runner: 'claude', at: new Date(Date.now() - agoMs).toISOString() };
  fs.writeFileSync(RECORD, JSON.stringify(cur));
}

let base;
let token;
test.before(async () => {
  status.setPaneSource(rosterSource);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  worker(SENDER);
  const minted = sendertoken.mint(SENDER);
  assert.ok(minted.ok, 'could not mint the sender\'s token: ' + minted.because);
  token = minted.token;
  /* Delivery itself is the tmux runner: the check just before typing (chat.js verifyAtSend) is answered as the
     agent's own live Claude pane, its claim being the session it was asked about, so a message that gets past the
     name reads as placed. */
  chat.setRunner((args) => {
    if (args[0] !== 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    const target = String(args[args.indexOf('-t') + 1] || '');
    const session = target.split(':')[0].replace(/^=/, '');
    return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t' + session + '\t0\n', err: '' };
  });
  chat.setDryRun(false);
});
test.beforeEach(() => {
  roster = { name: null, visibleAt: Infinity };
  app._setStartWaitForTest(null);
  app._setStartWaitForTest({ maxMs: 2000, stepMs: 100, refresh: null });
  fs.rmSync(RECORD, { force: true });
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  messagesEngine.resetForTests();
});
test.after(() => {
  chat.setRunner(null);
  chat.setDryRun(true);
  app._setStartWaitForTest(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function msg(to, text) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/msg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': token },
    body: JSON.stringify({ to, text }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, delivery: (json && json.delivery) || {}, json, ms: Date.now() - t0 };
}

test('#8658 a message to an agent whose row appears a moment later is waited for and placed', async () => {
  worker('fresh'); recordRow('fresh', 1000);
  roster.name = 'fresh'; roster.visibleAt = Date.now() + 300;
  const r = await msg('fresh', 'welcome aboard');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.delivery.state, 'placed', 'the message to a starting agent was not delivered: ' + JSON.stringify(r.json));
  assert.ok(r.ms >= 250, 'premise: the row was not there when the message arrived, yet it took ' + r.ms + ' ms');
});

test('#8658 CONTROL: with the wait off, the same message is not delivered (the race this file must see)', async () => {
  app._setStartWaitForTest({ maxMs: 0 });
  worker('fresh2'); recordRow('fresh2', 1000);
  roster.name = 'fresh2'; roster.visibleAt = Date.now() + 300;
  const r = await msg('fresh2', 'welcome aboard');
  assert.equal(r.delivery.state, 'could_not', 'with no wait the message reached the agent, so this file cannot show the bug: ' + JSON.stringify(r.json));
});

test('#8658 a starting agent that never appears: not delivered, and said to be starting, within the wait', async () => {
  worker('slow'); recordRow('slow', 1000);
  const r = await msg('slow', 'welcome aboard');
  assert.equal(r.delivery.state, 'could_not', JSON.stringify(r.json));
  assert.match(r.delivery.because, /slow is still starting, so nothing was sent/);
  assert.ok(r.ms >= 1900 && r.ms < 5000, 'the wait was not bounded as set: ' + r.ms + ' ms');
});

test('#8658 a name that is really missing answers as before, at once', async () => {
  const r = await msg('nobodyhere', 'hello');
  assert.equal(r.delivery.state, 'could_not', JSON.stringify(r.json));
  assert.doesNotMatch(String(r.delivery.because), /still starting/);
  assert.ok(r.ms < 1500, 'a missing name paid the wait: ' + r.ms + ' ms');
});

test('#8658 a message to a running agent is unchanged: placed at once', async () => {
  worker('steady'); roster.name = 'steady'; roster.visibleAt = 0;
  const r = await msg('steady', 'hello');
  assert.equal(r.delivery.state, 'placed', JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'a running agent paid the wait: ' + r.ms + ' ms');
});

/* A supervisor state file whose run began `startedAgoMs` ago and was last written `writtenAgoMs` ago. */
function stateFile(name, startedAgoMs, writtenAgoMs = startedAgoMs) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, store.safeKey(name) + '.json'), JSON.stringify({ v: 1, state: 'idle', sessionId: 'x', pid: 1,
    startedAt: new Date(Date.now() - startedAgoMs).toISOString(), at: new Date(Date.now() - writtenAgoMs).toISOString() }));
}

test('#8658 a crash relaunch (old ownership row, fresh supervisor state file) is waited for and placed', async () => {
  worker('relaunched'); recordRow('relaunched', 10 * 60 * 1000); stateFile('relaunched', 500);
  roster.name = 'relaunched'; roster.visibleAt = Date.now() + 300;
  const r = await msg('relaunched', 'are you back?');
  assert.equal(r.delivery.state, 'placed', 'a message during a relaunch was not waited for: ' + JSON.stringify(r.json));
  assert.ok(r.ms >= 250, 'premise: the row was not there when the message arrived: ' + r.ms + ' ms');
});

test('#8658 CONTROL for the relaunch: an old row and an old state file is not starting, and does not wait', async () => {
  worker('stopped'); recordRow('stopped', 10 * 60 * 1000); stateFile('stopped', 10 * 60 * 1000);
  const r = await msg('stopped', 'hello');
  assert.equal(r.delivery.state, 'could_not', JSON.stringify(r.json));
  assert.doesNotMatch(String(r.delivery.because), /still starting/);
  assert.ok(r.ms < 1500, 'a stopped agent made the message wait: ' + r.ms + ' ms');
});

test('#8658 a long-running agent that just wrote its state file is not starting (the write is not the start)', async () => {
  worker('busy'); recordRow('busy', 10 * 60 * 1000); stateFile('busy', 10 * 60 * 1000, 200);
  const r = await msg('busy', 'hello');
  assert.doesNotMatch(String(r.delivery.because), /still starting/, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'a recent write by a long-running agent made the message wait: ' + r.ms + ' ms');
});

test('#8658 a fresh state file with no ownership row at all is not ours, and does not wait', async () => {
  worker('unowned'); stateFile('unowned', 500);
  const r = await msg('unowned', 'hello');
  assert.doesNotMatch(String(r.delivery.because), /still starting/, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'an agent with no ownership row made the message wait: ' + r.ms + ' ms');
});

test('#8658 a sender with no token is never made to wait, and is not told the agent is starting', async () => {
  worker('fresh3'); recordRow('fresh3', 1000);
  const t0 = Date.now();
  const res = await fetch(`${base}/api/msg`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'fresh3', text: 'hi' }),
  });
  const json = await res.json().catch(() => null);
  const ms = Date.now() - t0;
  assert.doesNotMatch(JSON.stringify(json), /still starting/, 'an unidentified caller learned the agent is starting');
  assert.ok(ms < 1500, 'an unidentified caller was held for the wait: ' + ms + ' ms');
});

test('#8658 words the send would refuse keep their own refusal and do not wait', async () => {
  worker('fresh4'); recordRow('fresh4', 1000);
  const r = await msg('fresh4', '');
  assert.doesNotMatch(String(r.delivery.because || (r.json && r.json.error)), /still starting/, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'an empty message waited: ' + r.ms + ' ms');
});

test('#8658 the still-starting refusal is kept as a refused send, like every other attributed refusal', async () => {
  worker('slow2'); recordRow('slow2', 1000);
  app._setStartWaitForTest({ maxMs: 300, stepMs: 100, refresh: null });
  const r = await msg('slow2', 'welcome aboard');
  assert.match(String(r.delivery.because), /still starting/);
  const res = await fetch(`${base}/api/messages?agent=${SENDER}`);
  const all = JSON.stringify(await res.json());
  assert.match(all, /"refused"/, 'no refused event was kept for the sender');
  assert.match(all, /slow2 is still starting/, 'the refused event does not carry the starting sentence');
});

/* The person's DM route shares startingAgent, so a relaunch changes it too: pinned here. */
async function dm(name, text) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/thread`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  });
  return { status: res.status, json: await res.json().catch(() => null), ms: Date.now() - t0 };
}

test('#8658 DM route: a relaunching agent is waited for, then refused as starting (409), not as missing', async () => {
  worker('dmrelaunch'); recordRow('dmrelaunch', 10 * 60 * 1000); stateFile('dmrelaunch', 500);
  const r = await dm('dmrelaunch', 'hello');
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.because, 'starting');
  assert.ok(r.ms >= 1900, 'it did not wait: ' + r.ms + ' ms');
});

test('#8658 DM route CONTROL: a stopped agent (old row, old run) is 404 at once, as before', async () => {
  worker('dmstopped'); recordRow('dmstopped', 10 * 60 * 1000); stateFile('dmstopped', 10 * 60 * 1000);
  const r = await dm('dmstopped', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'a stopped agent made the DM wait: ' + r.ms + ' ms');
});

test('#8658 a state file from an older supervisor (no startedAt) is not a relaunch, and does not wait', async () => {
  worker('oldsup'); recordRow('oldsup', 10 * 60 * 1000);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, store.safeKey('oldsup') + '.json'),
    JSON.stringify({ v: 1, state: 'idle', sessionId: 'x', pid: 1, at: new Date().toISOString() }));
  const r = await msg('oldsup', 'hello');
  assert.doesNotMatch(String(r.delivery.because), /still starting/, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'an older supervisor\'s file made the message wait: ' + r.ms + ' ms');
});
