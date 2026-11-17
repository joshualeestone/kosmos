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

/* The roster: `name`'s tied row is listed only from `visibleAt` on (a time, not a count of reads, so a read added
   anywhere on the route cannot move it). `looks` counts reads. */
let roster = { name: null, visibleAt: Infinity, looks: 0, stranger: null };
function rosterSource() {
  roster.looks += 1;
  const lines = [];
  if (roster.name && Date.now() >= roster.visibleAt) lines.push(fleet.line({ session: roster.name, claim: roster.name }));
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
  roster = { name: null, visibleAt: Infinity, looks: 0, stranger: null };
  status.setPaneSource(rosterSource);
  app._setStartWaitForTest(null);
  app._setStartWaitForTest({ maxMs: 3000, stepMs: 100, refresh: null });
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

test('#8652 a starting agent whose row appears a moment later is waited for and not refused', async () => {
  worker('newbie'); recordRow('newbie', 1000);
  roster.name = 'newbie'; roster.visibleAt = Date.now() + 300;
  const r = await send('newbie', 'hello');
  assert.notEqual(r.status, 404, 'the first message to a starting agent was refused as missing: ' + JSON.stringify(r.json));
  assert.notEqual(r.status, 409, 'the row appeared inside the wait, yet the send gave up: ' + JSON.stringify(r.json));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.ms >= 250, 'premise: the row was not there when the send arrived, yet it took ' + r.ms + ' ms');
});

test('#8652 CONTROL: with the wait off, the same starting agent is not reached (the race this file must be able to see)', async () => {
  app._setStartWaitForTest({ maxMs: 0 });
  worker('newbie2'); recordRow('newbie2', 1000);
  roster.name = 'newbie2'; roster.visibleAt = Date.now() + 300;
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

/* The Windows path end to end, on any platform: the board's roster is win32roster.make() over a cached
   `claude agents --json` reader (stubbed), filtered by the sandboxed ownership record, exactly as the Windows board
   wires it. The session is registered with the stub 300 ms after the send; until then the cache holds the list
   from before. Only the wait's fresh read (refreshAsync) can show it inside the 1.5 s bound, because the cache
   serves its first answer unchanged for a minute here. */
const win32roster = require('./engine/win32roster');
function windowsRoster(name, sessionId) {
  let registered = false;
  const liveNow = () => (registered ? [{ pid: 4242, cwd: 'x', kind: 'interactive', startedAt: 1, sessionId, name, status: 'idle' }] : []);
  const cached = win32roster.makeCachedRun({ run: liveNow, runAsync: (cb) => setTimeout(() => cb(liveNow()), 20), freshMs: 60000, staleMs: 120000 });
  status.setPaneSource(win32roster.make({ run: cached, codexLive: () => [] }));
  setTimeout(() => { registered = true; }, 300);
  return cached;
}
function recordedId(name) {
  const cur = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  return Object.keys(cur).find((id) => cur[id].name === name);
}

test('#8652 Windows roster: the wait reads the roster afresh and finds the session the cache did not have yet', async () => {
  worker('winnew'); recordRow('winnew', 1000);
  const cached = windowsRoster('winnew', recordedId('winnew'));
  app._setStartWaitForTest({ maxMs: 1500, stepMs: 100, refresh: () => cached.refreshAsync() });
  const r = await send('winnew', 'hello');
  assert.equal(r.status, 200, 'the fresh read did not reach the gate: ' + JSON.stringify(r.json));
  assert.ok(r.ms >= 250 && r.ms < 1500, 'premise: delivered after the session registered and inside the bound: ' + r.ms + ' ms');
});

test('#8652 Windows roster CONTROL: without the fresh read, the cached roster hides the session for the whole wait', async () => {
  worker('winold'); recordRow('winold', 1000);
  windowsRoster('winold', recordedId('winold'));
  app._setStartWaitForTest({ maxMs: 1500, stepMs: 100, refresh: null });
  const r = await send('winold', 'hello');
  assert.equal(r.status, 409, 'the cache showed the session without a fresh read, so the arm above proves nothing: ' + JSON.stringify(r.json));
});

test('#8652 a roster read slower than the time left does not stretch the wait', async () => {
  worker('slowread'); recordRow('slowread', 1000);
  app._setStartWaitForTest({ maxMs: 800, stepMs: 100, refresh: () => new Promise((res) => setTimeout(res, 5000).unref()) });
  const r = await send('slowread', 'hello');
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.ok(r.ms < 2000, 'a slow roster read held the send past its bound: ' + r.ms + ' ms');
});

test('#8652 two quick sends to a starting agent pass the gate in the order they were sent', async () => {
  worker('quick'); recordRow('quick', 1000);
  app._setStartWaitForTest({ maxMs: 3000, stepMs: 1000, refresh: null });
  const t0 = Date.now();
  roster.name = 'quick'; roster.visibleAt = t0 + 1100;
  /* First looks at 1000 ms (hidden) and 2000 ms; second, sent 150 ms later, would look at 1150 ms (shown) and pass
     first if each waited on its own. */
  const first = send('quick', 'line one');
  await new Promise((r) => setTimeout(r, 150));
  const second = send('quick', 'line two');
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(b.status, 200, JSON.stringify(b.json));
  const res = await fetch(`${base}/api/agent/quick/thread`);
  const msgs = ((await res.json()).messages || []).map((m) => m.text).filter((x) => /^line /.test(x));
  assert.deepEqual(msgs, ['line one', 'line two'], 'the later line was kept ahead of the earlier one');
});
