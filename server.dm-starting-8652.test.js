'use strict';

/**
 * kosmos#8652: on Windows the first message to a just-created or just-restored agent was refused 404 "no agent by
 * that name" while its card read Running. Its session is in the ownership record (win32-sessions/record.json) at once,
 * but the roster sees it only a few seconds later. The DM send now waits briefly for the roster row of an agent that
 * is starting, then sends, or answers 409 "still starting"; a name that is really missing still 404s at once.
 *
 * The roster is fed through status.setPaneSource (the seam the Windows board itself uses), with a source that changes
 * between reads, so "the row appears after N looks" is arranged directly. Runs on every platform.
 *
 *   node --test server.dm-starting-8652.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-starting-8652-'));
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
const fleet = require('./test-support/fleet');

const RECORD = path.join(store.ROOT, 'win32-sessions', 'record.json');
const REMOVED = path.join(store.ROOT, 'removed.json');

/* The roster: '' (nobody) for the first `hiddenFor` looks at `name`'s row, then its tied row. `looks` counts reads. */
let roster = { name: null, hiddenFor: Infinity, looks: 0, stranger: null };
function rosterSource() {
  roster.looks += 1;
  const lines = [];
  if (roster.name && roster.looks > roster.hiddenFor) lines.push(fleet.line({ session: roster.name, claim: roster.name }));
  if (roster.stranger) lines.push(fleet.line({ session: roster.stranger, claim: '' }));
  return lines.join('\n') + (lines.length ? '\n' : '');
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
test.before(async () => {
  status.setPaneSource(rosterSource);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  roster = { name: null, hiddenFor: Infinity, looks: 0, stranger: null };
  app._setStartWaitForTest({ maxMs: 3000, stepMs: 100 });
  fs.rmSync(RECORD, { force: true });
});
test.after(() => {
  app._setStartWaitForTest(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function send(name, text) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/thread`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  });
  return { status: res.status, json: await res.json().catch(() => null), ms: Date.now() - t0 };
}

test('#8652 a starting agent whose row appears a few looks later is waited for and not refused', async () => {
  worker('newbie'); recordRow('newbie', 1000);
  roster.name = 'newbie'; roster.hiddenFor = 3;
  const r = await send('newbie', 'hello');
  assert.notEqual(r.status, 404, 'the first message to a starting agent was refused as missing: ' + JSON.stringify(r.json));
  assert.notEqual(r.status, 409, 'the row appeared inside the wait, yet the send gave up: ' + JSON.stringify(r.json));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(roster.looks > 3, 'premise: the roster was read again until the row showed');
});

test('#8652 CONTROL: with the wait off, the same starting agent is not reached (the race this file must be able to see)', async () => {
  app._setStartWaitForTest({ maxMs: 0 });
  worker('newbie2'); recordRow('newbie2', 1000);
  roster.name = 'newbie2'; roster.hiddenFor = 3;
  const r = await send('newbie2', 'hello');
  assert.ok(r.status === 404 || r.status === 409, 'the control cannot see the race: ' + r.status);
  assert.equal(r.json && r.json.error && /no agent by that name|still starting/.test(r.json.error), true, JSON.stringify(r.json));
  assert.notEqual(r.status, 200, 'with no wait the send must not reach the agent, or this file cannot show the bug');
});

test('#8652 a starting agent that never appears is refused as starting (409), not as missing, within the wait', async () => {
  worker('slowpoke'); recordRow('slowpoke', 1000);
  const r = await send('slowpoke', 'hello');
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.because, 'starting');
  assert.match(r.json.error, /slowpoke is still starting, so nothing was sent/);
  assert.ok(r.ms >= 2900, 'it answered before the wait ran out: ' + r.ms + ' ms');
  assert.ok(r.ms < 6000, 'it waited far past the bound: ' + r.ms + ' ms');
});

test('#8652 a really missing name is 404 at once and never waits', async () => {
  const r = await send('nobodyhere', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.equal(r.json.error, 'no agent by that name');
  assert.ok(r.ms < 1500, 'a missing name paid the wait: ' + r.ms + ' ms');
});

test('#8652 an agent folder with no recent record row (stopped, never restarted) is 404 at once', async () => {
  worker('stale'); recordRow('stale', 10 * 60 * 1000);
  const r = await send('stale', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'an old record row made the send wait: ' + r.ms + ' ms');
});

test('#8652 a removed agent is 404 at once even with a fresh record row', async () => {
  worker('gone'); recordRow('gone', 1000);
  const before = fs.existsSync(REMOVED) ? fs.readFileSync(REMOVED, 'utf8') : null;
  fs.mkdirSync(path.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify([{ name: 'gone', at: new Date().toISOString() }]));
  try {
    assert.equal(require('./engine/remove').isRemoved('gone'), true, 'premise: the agent reads as removed');
    const r = await send('gone', 'hello');
    assert.equal(r.status, 404, JSON.stringify(r.json));
    assert.ok(r.ms < 1500, 'a removed agent made the send wait: ' + r.ms + ' ms');
  } finally {
    if (before === null) fs.rmSync(REMOVED, { force: true }); else fs.writeFileSync(REMOVED, before);
  }
});

test('#8652 a stranger\'s pane holding the name is refused as today and never waits', async () => {
  worker('zeta'); recordRow('zeta', 1000);
  roster.stranger = 'zeta';
  const r = await send('zeta', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.ok(r.ms < 1500, 'a borrowed name made the send wait: ' + r.ms + ' ms');
});
