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
  assert.equal(first.sent[0].text, 'Kosmos: task #' + n + ', "Check the supplier price" (put on hold 3 hours ago) in ' + only(id)[0].name + ' is still on hold, but you have posted 3 times in its project room since then. If its work is going on, take it off hold: kosmos task unhold ' + id + ' ' + n + '. If it should stay on hold, say why on the task.');
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
  assert.match(sent[0].text, /\(the person put it on hold 30 hours ago\)/);
  assert.match(sent[0].text, /If its work is going on, ask the person to take it off hold \(only they can lift their own hold, on the screen\)\./);
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

test('#6209 part 3: held, not spent, while the owner has only just gone idle or Kosmos may not type into agents', () => {
  const { id, n } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  let r = pass(id, rows, holdAt(3 * HOUR), { allowed: false });
  assert.equal(r.sent.length, 0);
  assert.equal(r.out.results[0].act, 'held');
  r = pass(id, rows, holdAt(3 * HOUR), { idleSeen: new Map([[REX, { since: NOW - 10000, at: NOW }]]) });
  assert.equal(r.sent.length, 0, 'typed into an owner that had only just gone idle');
  assert.equal(stored(id, n).holdStaleTold, undefined, 'a held line was marked told');
  // A busy (working) owner is held, nothing typed and nothing marked.
  const busyRoster = BASE.map((c) => (c.sessionName === REX ? { ...c, state: 'working' } : c));
  r = pass(id, rows, holdAt(3 * HOUR), { roster: busyRoster });
  assert.equal(r.sent.length, 0, 'typed into a working owner');
  assert.match(r.out.results[0].because, /not idle/);
  assert.equal(stored(id, n).holdStaleTold, undefined, 'a busy owner was marked told');
});

test('#6209 part 3: the board runs the sweep on its own minute timer, with the room log and the nudge\'s gates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const holdStaleTick = setInterval(');
  assert.notEqual(at, -1, 'server.js has no hold-stale timer');
  const body = src.slice(at, src.indexOf('}, 60000);', at));
  assert.match(body, /const rec = messages\.record\(\);\s*if \(rec\.stampsUnknown\) return;\s*const rows = rec\.rows;/, 'the sweep is not given the room log, or not with the stamps it was filtered by (#7367)');
  assert.match(body, /holdstale\.sweep\(\{/, 'the timer does not run the sweep');
  assert.match(body, /agentnudge\.nudgeEnabled\(liveExecution\.liveExecutionAllowed\(\), process\.env\)/, 'not gated like the other tells');
  assert.match(body, /sent: AGENT_NUDGE_SENT/, 'not counted against Agent Communication\'s hour');
  assert.match(body, /if \(!allowed \|\| heartbeatSetting\.read\(\)\.on !== true\) return;\s*(?:\/\*[\s\S]*?\*\/\s*)?const rec = messages\.record\(\);/, 'the log is read before the typing and Prompter gates are checked');
  assert.match(body, /\ballowed,\s/, 'the gate is not handed to the sweep');
  assert.match(body, /book: HOLD_STALE_BOOK, idleSeen: HOLD_STALE_IDLE/, 'the sweep does not keep its own tries and idle record');
});

test('#6209 part 3 review 4: Kosmos\'s hold-stale note does not count as the task\'s last activity', () => {
  const { id, n } = fixture();
  const t0 = tasks.lastActivityOf ? tasks.lastActivityOf(id, stored(id, n)) : null;
  assert.equal(typeof tasks.lastActivityOf, 'function', 'fixture: lastActivityOf is not exported');
  assert.ok(taskchat.record(id, n, { kind: 'hold-stale', hold: iso(NOW - 3 * HOUR), told: REX, posts: 3, reached: true }));
  assert.equal(tasks.lastActivityOf(id, stored(id, n)), t0, 'the note moved the task\'s last activity');
  // CONTROL: a real event does move it.
  assert.ok(taskchat.record(id, n, { kind: 'said', who: REX, text: 'still on it' }));
  assert.notEqual(tasks.lastActivityOf(id, stored(id, n)), t0, 'control: a message did not move the last activity');
});

test('#6209 part 3 review 1: only holders of an OPEN part are asked; one whose part is done is not', () => {
  const { id, n } = fixture();
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, who: undefined,
    parts: [{ id: 1, sentence: 'Check it', who: REX }, { id: 2, sentence: 'Draft the note', who: ADA, closedAt: iso(NOW - 4 * HOUR) }] } : t)) }));
  const rows = [post(id, ADA, 2 * HOUR), post(id, ADA, HOUR), post(id, ADA, 0.5 * HOUR)];
  assert.equal(pass(id, rows, holdAt(3 * HOUR)).sent.length, 0, 'an agent whose part is done was asked to unhold the task');
  // CONTROL: the open part's holder, with the same posts, is asked.
  const r = pass(id, [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)], holdAt(3 * HOUR));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].s, REX);
});

test('#6209 part 3 review 1: two held tasks of one owner in one room are named in ONE line, both marked', () => {
  const a = fixture();
  const n2 = tasks.create(a.id, { sentence: 'Order the samples' }).number;
  projects.mutate(a.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n2 ? { ...t, who: REX, onHold: true } : t)) }));
  const rows = [post(a.id, REX, 2 * HOUR), post(a.id, REX, HOUR), post(a.id, REX, 0.5 * HOUR)];
  const r = pass(a.id, rows, holdAt(3 * HOUR));
  assert.equal(r.sent.length, 1, 'one line per held task on the same evidence: ' + r.sent.length);
  assert.match(r.sent[0].text, new RegExp('task #' + a.n + ', .* and task #' + n2 + ', .* are still on hold, but you have posted 3 times in their project room since then\\. If their work is going on, take them off hold: kosmos task unhold ' + a.id + ' ' + a.n + ', then kosmos task unhold ' + a.id + ' ' + n2 + '\\.'));
  assert.ok(stored(a.id, a.n).holdStaleTold[REX] && stored(a.id, n2).holdStaleTold[REX], 'not both marked told');
  assert.equal(pass(a.id, rows, holdAt(3 * HOUR)).sent.length, 0, 'told again');
});

test('#6209 part 3 review 1: the real hold history (tasks.setOnHold, taskchat) is what it reads', () => {
  const p = projects.create({ name: 'Real ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Real hold' }).number;
  projects.mutate(p.id, (x) => ({ ...x, agents: [ADA, REX], tasks: x.tasks.map((t) => (t.number === n ? { ...t, who: REX } : t)) }));
  tasks.setOnHold(p.id, n, true);   // an agent's hold, recorded by the real history
  const real = Date.now();
  const later = real + 3 * HOUR;
  const rows = [1, 2, 2.5].map((h) => ({ kind: 'post', id: 'r' + h, project: p.id, from: REX, to: [ADA], text: 'x', at: iso(real + h * HOUR) }));
  const sent = [];
  hs.sweep({ projects: projects.readAll().filter((x) => x.id === p.id), rows, roster: BASE, now: later, allowed: true, limit: { on: false }, sent: [], book: new Map(),
    idleSeen: new Map([[REX, { since: later - 120000, at: later - 60000 }]]), deliver: (s, text) => { sent.push(text); return { state: 'placed' }; }, DELIVERY });
  assert.equal(sent.length, 1, 'the real hold-set event was not read');
  assert.match(sent[0], /\(put on hold 3 hours ago\)/);
});

test('#6209 part 3 review 1: the person taking over an agent\'s hold is read from the history alone, and a later clear tells nobody', () => {
  const { id, n } = fixture();   // onHoldByPerson NOT set: only the history's `via` says it is the person's
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  // Told first about the agent's hold (posts after it), then again once the person takes it over.
  const agentHold = () => [{ kind: 'hold-set', at: iso(NOW - 5 * HOUR), via: 'agent' }];
  assert.equal(pass(id, rows, agentHold).sent.length, 1, 'fixture: the agent\'s hold was not told about');
  const takeover = () => [{ kind: 'hold-set', at: iso(NOW - 5 * HOUR), via: 'agent' }, { kind: 'hold-set', at: iso(NOW - 3 * HOUR), via: 'screen' }];
  const r = pass(id, rows, takeover);
  assert.equal(r.sent.length, 1, 'the person\'s takeover was not told about again');
  assert.match(r.sent[0].text, /\(the person put it on hold 3 hours ago\)/, 'the takeover was not read as the person\'s hold');
  assert.equal(stored(id, n).holdStaleTold[REX], iso(NOW - 3 * HOUR), 'the takeover\'s time is not the one stored');
  const b = fixture();
  const clearedAfter = () => [{ kind: 'hold-set', at: iso(NOW - 5 * HOUR), via: 'agent' }, { kind: 'hold-cleared', at: iso(NOW - 4 * HOUR), via: 'agent' }];
  assert.equal(pass(b.id, [post(b.id, REX, 3.5 * HOUR), post(b.id, REX, 2 * HOUR), post(b.id, REX, HOUR)], clearedAfter).sent.length, 0, 'a hold cleared after its last set was told about');
});

test('#6209 part 3 review 2: the line reads right for mixed, plural and three-task holds, and never types an unsafe id', () => {
  const it = (n, byPerson, projectId = 'proj-a') => ({ projectId, project: 'Shop', n, sentence: 'Task ' + n, owner: REX, holdAt: NOW - 3 * HOUR, byPerson, posts: 4 });
  assert.equal(hs.tellText([it(1, false), it(2, true)], NOW),
    'Kosmos: task #1, "Task 1" (put on hold 3 hours ago) and task #2, "Task 2" (the person put it on hold 3 hours ago) in Shop are still on hold, but you have posted 4 times in their project room since then. If their work is going on, take #1 off hold: kosmos task unhold proj-a 1; for #2, ask the person to take it off hold (only they can lift their own hold, on the screen). If one should stay on hold, say why on the task.');
  assert.match(hs.tellText([it(1, true), it(2, true)], NOW), /If their work is going on, ask the person to take them off hold \(only they can lift their own hold, on the screen\)\./);
  assert.match(hs.tellText([it(1, false), it(2, false), it(3, false)], NOW), /task #1, "Task 1" \(put on hold 3 hours ago\), task #2, .* and task #3, /);
  const unsafe = hs.tellText([it(1, false, 'x; rm -rf ~')], NOW);
  assert.match(unsafe, /kosmos task unhold <project-id> 1\./);
  assert.doesNotMatch(unsafe, /rm -rf/);
});

test('#6209 part 3 review 2: an owner off the project or switched off is recorded as not reached; MAX_TRIES failures give up', () => {
  const rows = (id) => [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const gone = fixture();
  projects.mutate(gone.id, (x) => ({ ...x, agents: [ADA] }));
  let r = pass(gone.id, rows(gone.id), holdAt(3 * HOUR));
  assert.equal(r.sent.length, 0);
  assert.equal(r.out.results[0].act, 'unreachable');
  assert.ok(taskchat.read(gone.id, gone.n).some((e) => e.kind === 'hold-stale' && e.reached === false), 'not recorded as not reached');
  const off = fixture();
  projects.setSwarmOn(off.id, REX, false);
  r = pass(off.id, rows(off.id), holdAt(3 * HOUR));
  assert.equal(r.sent.length, 0, 'typed into an owner switched off in the project');
  assert.equal(r.out.results[0].act, 'unreachable');
  assert.ok(taskchat.read(off.id, off.n).some((e) => e.kind === 'hold-stale' && e.reached === false), 'the switched-off owner was not recorded as not reached');
  const failing = fixture();
  const book = new Map();
  const tries = [];
  for (let i = 0; i < hs.MAX_TRIES + 1; i += 1) {
    tries.push(pass(failing.id, rows(failing.id), holdAt(3 * HOUR), { book, deliver: () => ({ state: 'not-found' }) }).out.results[0]);
  }
  assert.deepEqual(tries.slice(0, hs.MAX_TRIES).map((x) => x.act), Array(hs.MAX_TRIES).fill('tell'));
  assert.ok(stored(failing.id, failing.n).holdStaleTold[REX], 'not marked after MAX_TRIES failures');
  assert.equal(tries[hs.MAX_TRIES], undefined, 'tried again after giving up');
});

test('#6209 part 3 review 7: a hold older than any window still gives up after MAX_TRIES, and a told group is not retyped', () => {
  const rows = (id) => [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const old = fixture();
  const book = new Map();
  const acts = [];
  for (let i = 0; i < hs.MAX_TRIES + 2; i += 1) {
    const res = pass(old.id, rows(old.id), holdAt(31 * 24 * HOUR), { book, deliver: () => ({ state: 'not-found' }) }).out.results[0];
    acts.push(res ? res.act + ':' + (res.tries || '') : 'none');
  }
  assert.deepEqual(acts.slice(0, hs.MAX_TRIES), Array.from({ length: hs.MAX_TRIES }, (_, i) => 'tell:' + (i + 1)), 'tries restarted: ' + acts.join(' '));
  assert.ok(stored(old.id, old.n).holdStaleTold[REX], 'a 31-day hold never gave up');
  // A group the book holds as told is never typed again, even if its mark on the task was lost.
  const lost = fixture();
  const b2 = new Map();
  pass(lost.id, rows(lost.id), holdAt(31 * 24 * HOUR), { book: b2 });
  projects.mutate(lost.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === lost.n ? { ...t, holdStaleTold: undefined } : t)) }));
  assert.equal(pass(lost.id, rows(lost.id), holdAt(31 * 24 * HOUR), { book: b2 }).sent.length, 0, 'retyped a told group whose mark was lost');
});

test('#6209 part 3 review 8: the book keeps a told entry for good and drops a stale tries entry', () => {
  const { id } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const book = new Map([['x:old-told@1/1', { told: true, at: NOW - 400 * 24 * HOUR }], ['x:old-tries@1/1', { tries: 1, at: NOW - 31 * 24 * HOUR }], ['x:fresh-tries@1/1', { tries: 1, at: NOW - HOUR }]]);
  pass(id, rows, holdAt(3 * HOUR), { book });
  assert.ok(book.has('x:old-told@1/1'), 'a told entry was pruned');
  assert.ok(!book.has('x:old-tries@1/1'), 'a tries entry 31 days old was kept');
  assert.ok(book.has('x:fresh-tries@1/1'), 'control: a fresh tries entry was pruned');
});

test('#7367: in the few seconds a passing read error is kept, the sweep tells nobody (old rows show then); after, it tells as before', () => {
  const { id } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const read = holdAt(3 * HOUR);
  const realReadAll = projects.readAll;
  projects.readAll = () => { const e = new Error('held by a scanner'); e.code = 'UNREADABLE'; throw e; };
  try {
    assert.equal(require('../engine/projectborn').snapshot().ok, false, 'CONTROL: the one failed read is seen');
  } finally {
    projects.readAll = realReadAll;
  }
  // The projects file itself reads again (the sweep's own projects come from it), but the stamps are still unknown.
  assert.equal(pass(id, rows, read).sent.length, 0, 'inside the window: nothing typed');
  const realNow = Date.now;
  Date.now = () => realNow() + 6000;
  try {
    assert.equal(pass(id, rows, read).sent.length, 1, 'CONTROL: after the window the same hold is told');
  } finally {
    Date.now = realNow;
  }
});

test('#7367: the stamps going unknown DURING the history reads is caught by owed()\'s check after them', () => {
  const { id } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const list = only(id);
  assert.equal(hs.owed(list, rows, NOW, { read: holdAt(3 * HOUR) }).length, 1, 'CONTROL: with the stamps known one owner is owed');
  const f = projects.file();
  const good = fs.readFileSync(f);
  const midRead = (...a) => { fs.writeFileSync(f, Buffer.alloc(good.length + 7, 0)); return holdAt(3 * HOUR)(...a); };
  let out;
  try { out = hs.owed(list, rows, NOW, { read: midRead }); } finally { fs.writeFileSync(f, good); }
  assert.deepEqual(out, [], 'damaged mid-read: owed nobody');
});

test('#7367: stamps unknown at entry and the file repaired DURING the reads is caught by owed()\'s check before them', () => {
  const { id } = fixture();
  const rows = [post(id, REX, 2 * HOUR), post(id, REX, HOUR), post(id, REX, 0.5 * HOUR)];
  const list = only(id);
  const f = projects.file();
  const good = fs.readFileSync(f);
  fs.writeFileSync(f, Buffer.alloc(good.length + 7, 0));
  const repairMidRead = (...a) => { fs.writeFileSync(f, good); return holdAt(3 * HOUR)(...a); };
  let out;
  try { out = hs.owed(list, rows, NOW, { read: repairMidRead }); } finally { fs.writeFileSync(f, good); }
  assert.deepEqual(out, [], 'unknown at entry: owed nobody, even though the stamps are known again by the end');
});
