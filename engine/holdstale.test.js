'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#6209 part 3: an owner of a task left on hold while it keeps posting in the task's project room is told once
 * per hold (engine/holdstale.js).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdstale.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hs-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hs-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hs-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');
const hs = require('../engine/holdstale');
const fleet = require('../test-support/fleet');
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(FLEET_ROOT, { recursive: true, force: true }); });
const BASE = fleet.install(['ada', 'rex'].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
const sessionOf = (name) => (BASE.find((c) => (c.sessionName || '').startsWith(name)) || {}).sessionName;
const ADA = sessionOf('ada');
const REX = sessionOf('rex');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const HOUR = 3600000;
const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', NOT_FOUND: 'not-found' };
const iso = (t) => new Date(t).toISOString();

/* A project whose task (owned by REX) is on hold. The hold's own time comes from `holds` (the history setOnHold
   writes), given to holdstale through its `read` seam so the fixture sets it at a known moment. */
function fixture({ byPerson = false, paused = false, closed = false } = {}) {
  const p = projects.create({ name: 'Supplier ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Check the supplier price' }).number;
  projects.mutate(p.id, (x) => ({
    ...x, agents: [ADA, REX], ...(paused ? { paused: true } : {}),
    tasks: x.tasks.map((t) => (t.number === n ? { ...t, who: REX, onHold: true, ...(byPerson ? { onHoldByPerson: true } : {}),
      ...(closed ? { closedAt: iso(NOW - HOUR) } : {}) } : t)),
  }));
  return { id: p.id, n };
}
const post = (projectId, from, ago) => ({ kind: 'post', id: 'm' + Math.random(), project: projectId, from, to: [ADA], text: 'working on it', at: iso(NOW - ago) });
const holdAt = (ago, via = 'agent') => () => [{ kind: 'hold-set', at: iso(NOW - ago), via }];
const only = (id) => projects.readAll().filter((x) => x.id === id);
const settled = () => new Map([[ADA, { since: NOW - 120000, at: NOW - 60000 }], [REX, { since: NOW - 120000, at: NOW - 60000 }]]);
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

function pass(id, rows, read, extra = {}) {
  const sent = [];
  const out = hs.sweep({ projects: only(id), rows, roster: BASE, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(),
    idleSeen: settled(), deliver: (s, text) => { sent.push({ s, text }); return { state: 'placed' }; }, DELIVERY, read, ...extra });
  return { sent, out };
}

test('#6209 part 3: an owner posting in the room while its task is on hold is told once, with the task, the hold and the way off it', () => {
  const { id, n } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const read = holdAt(3 * HOUR);
  const first = pass(id, rows, read);
  assert.equal(first.sent.length, 1, JSON.stringify(first.out.results));
  assert.equal(first.sent[0].s, REX);
  assert.match(first.sent[0].text, new RegExp('task #' + n + ' in Supplier \\w+, "Check the supplier price", is still on hold \\(it was put on hold 3 hours ago\\), but you have posted 3 times in its project room since then\\. If its work is going on, take it off hold: kosmos task unhold ' + id + ' ' + n + '\\. If it should stay on hold, say why on the task\\.'));
  assert.equal(stored(id, n).holdStaleTold[REX], iso(NOW - 3 * HOUR), 'the hold it was told about was not stored');
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'hold-stale' && e.told === REX && e.reached === true), 'the history does not say it was told');
  // Once: the same hold is not told again.
  assert.equal(pass(id, rows, read).sent.length, 0, 'told twice about one hold');
});

test('#6209 part 3 CONTROLS: nothing is told without enough of the owner\'s own posts in that room since a hold old enough', () => {
  const cases = {
    'two posts': (id) => [post(id, REX, 2 * HOUR), post(id, REX, HOUR)],
    'posts from before the hold': (id) => [post(id, REX, 5 * HOUR), post(id, REX, 4.5 * HOUR), post(id, REX, 4 * HOUR)],
    'another room': () => [post('elsewhere', REX, 2 * HOUR), post('elsewhere', REX, HOUR), post('elsewhere', REX, 0.5 * HOUR)],
    'a member who does not own it': (id) => [post(id, ADA, 2 * HOUR), post(id, ADA, HOUR), post(id, ADA, 0.5 * HOUR)],
  };
  for (const [name, rowsOf] of Object.entries(cases)) {
    const { id } = fixture();
    assert.equal(pass(id, rowsOf(id), holdAt(3 * HOUR)).sent.length, 0, name + ' told the owner');
  }
  const young = fixture();
  assert.equal(pass(young.id, [post(young.id, REX, 0.6 * HOUR), post(young.id, REX, 0.4 * HOUR), post(young.id, REX, 0.2 * HOUR)], holdAt(HOUR)).sent.length, 0, 'a hold under two hours old was told about');
  for (const flags of [{ paused: true }, { closed: true }]) {
    const { id } = fixture(flags);
    assert.equal(pass(id, [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)], holdAt(3 * HOUR)).sent.length, 0, JSON.stringify(flags) + ' told the owner');
  }
});

test('#6209 part 3: the person\'s own hold asks the owner to ask the person, and names no command it cannot run', () => {
  const { id } = fixture({ byPerson: true });
  const { sent } = pass(id, [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)], holdAt(30 * HOUR, 'screen'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /the person put it on hold 30 hours ago/);
  assert.match(sent[0].text, /ask the person to take it off hold \(only they can lift their own hold, on the screen\)/);
  assert.doesNotMatch(sent[0].text, /kosmos task unhold/);
});

test('#6209 part 3: a new hold (taken off and put back) is told about again', () => {
  const { id } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  assert.equal(pass(id, rows, holdAt(3 * HOUR)).sent.length, 1);
  assert.equal(pass(id, rows, holdAt(3 * HOUR)).sent.length, 0, 'control: the same hold is not told again');
  // Put on hold again 2.5 hours ago, with the owner's three posts after it.
  const again = () => [{ kind: 'hold-set', at: iso(NOW - 3 * HOUR), via: 'agent' }, { kind: 'hold-cleared', at: iso(NOW - 2.8 * HOUR), via: 'agent' }, { kind: 'hold-set', at: iso(NOW - 2.5 * HOUR), via: 'agent' }];
  assert.equal(pass(id, rows, again).sent.length, 1, 'a new hold was not told about');
});

test('#6209 part 3: held, not spent, while the owner is busy or Kosmos may not type into agents', () => {
  const { id, n } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  let r = pass(id, rows, holdAt(3 * HOUR), { allowed: false });
  assert.equal(r.sent.length, 0);
  assert.equal(r.out.results[0].act, 'held');
  r = pass(id, rows, holdAt(3 * HOUR), { idleSeen: new Map([[REX, { since: NOW - 10000, at: NOW }]]) });
  assert.equal(r.sent.length, 0, 'typed into an owner that had only just gone idle');
  assert.equal(stored(id, n).holdStaleTold, undefined, 'a held line was marked told');
});

test('#6209 part 3: the board runs the sweep on its own minute timer, with the room log and the nudge\'s gates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const holdStaleTick = setInterval(');
  assert.notEqual(at, -1, 'server.js has no hold-stale timer');
  const body = src.slice(at, src.indexOf('}, 60000);', at));
  assert.match(body, /const rows = messages\.readLog\(\);/, 'the sweep is not given the room log');
  assert.match(body, /holdstale\.sweep\(\{/, 'the timer does not run the sweep');
  assert.match(body, /agentnudge\.nudgeEnabled\(liveExecution\.liveExecutionAllowed\(\), process\.env\)/, 'not gated like the other tells');
  assert.match(body, /sent: AGENT_NUDGE_SENT/, 'not counted against Agent Communication\'s hour');
});
