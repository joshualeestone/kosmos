'use strict';
/* kosmos#8287: the restart-note route answers what was checked, from the roster now, and the page never gets the list. */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartnote-8287-' + p + '-'));
process.env.HOME = tmp('home');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = tmp('data');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('proj');
process.env.AGENT_WORKFORCE_WORKERS = tmp('work');
process.env.AGENT_WORKFORCE_LAUNCH = tmp('launch');

const rn = require('./engine/restartnote');
const now = Date.now();
fs.mkdirSync(path.dirname(rn._files.noteFile()), { recursive: true });
fs.writeFileSync(rn._files.noteFile(), JSON.stringify({
  lastAliveAt: new Date(now - 9 * 60000).toISOString(), bootAt: new Date(now - 7 * 60000).toISOString(), upAt: new Date(now - 60000).toISOString(),
  dismissed: false, wereRunning: [{ session: 'nobodyhere', name: 'Nobody Here' }], files: { damaged: 2 },
}));
let atStartGot = null;
const realAtStart = rn.atStart;
rn.atStart = (deps) => { atStartGot = deps || null; return realAtStart(deps); };
const realStartBeating = rn.startBeating;
rn.startBeating = (...a) => { const t = realStartBeating(...a); if (t && t.unref) t.unref(); return t; };
const { start, server } = require('./server');
require('./engine/storecheck').scan({ base: null });

test('#8287: the route says what was checked, names who is not back, and keeps the list to itself', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/board/restart-note`;
  const before = await (await fetch(url)).json();
  assert.deepEqual(before.note.checks, { files: { damaged: 2 } }, 'agents were reported before any roster was read');
  rn.noteRunning([]);
  const got = await (await fetch(url)).json();
  assert.ok(got.note, 'the note was not served');
  assert.deepEqual(got.note.checks, { agents: { was: 1, back: 0, notBack: ['Nobody Here'] }, files: { damaged: 2 } });
  assert.equal('wereRunning' in got.note, false, 'the page was sent the recorded list');
  assert.equal('files' in got.note, false, 'the raw record reached the page beside checks');

  // A removed agent is not "not back", through the route's own read of the removals.
  const removedFile = path.join(require('./engine/store').ROOT, 'removed.json');
  fs.writeFileSync(removedFile, JSON.stringify([{ name: 'nobodyhere', stopped: true, removedAt: new Date().toISOString() }]));
  const after = await (await fetch(url)).json();
  fs.rmSync(removedFile);
  assert.deepEqual(after.note.checks.agents, { was: 0, back: 0, notBack: [] }, 'a removed agent read as not back');

  // A damaged removals file: who was removed is unknown, so the agents are left out, and the files clause stays.
  fs.writeFileSync(removedFile, Buffer.alloc(16));
  const damaged = await (await fetch(url)).json();
  fs.rmSync(removedFile);
  assert.deepEqual(damaged.note.checks, { files: { damaged: 2 } }, 'an unreadable removals file still named agents as not back');
});

test('#8287: start() hands atStart the result of the file check', () => {
  assert.ok(atStartGot, 'start() never called atStart');
  assert.deepEqual(atStartGot.files, { checked: true, damaged: 0, unread: 0 }, 'atStart was not given the file check');   // kosmos#8297: unread too
});

test('#8287: the minute tick feeds the note its roster, and the route takes no roster read of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const tick = src.indexOf('const crashLoopTick = setInterval(');
  const feed = src.indexOf("require('./engine/restartnote').noteRunning(roster)");
  assert.ok(tick > 0 && feed > tick && feed < src.indexOf('crashLoopTick.unref', tick), 'the once-a-minute read no longer tells the note who is up');
  const route = src.slice(src.indexOf("pathname === '/api/board/restart-note' &&"), src.indexOf("pathname === '/api/board/restart-note/dismiss'"));
  assert.ok(route.includes('rn.lastRoster()'), 'CONTROL: the route is not the one read here');
  assert.ok(!/sweepRoster\(|safeRoster\(|snapshot\(/.test(route), 'a page route took a blocking roster read');
});

test('#8287: the file check runs before the board starts, or every note loses its files clause', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const scan = src.indexOf("require('./engine/storecheck').atStart({ base })");
  const boot = src.indexOf('\n    start().then(');
  assert.ok(scan > 0 && boot > 0, 'CONTROL: one of the two anchors is gone');
  assert.ok(scan < boot, 'the board starts before the file check runs');
});
