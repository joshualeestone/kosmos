'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#7180: a held task can record a checkable reopening condition (another task closed, or a time passed). The
 * stale-hold check tests it: nobody is told while it is unmet, and the owner is told once when it is met
 * (engine/tasks.js holdUntilOf / holdUntilState / setOnHold, engine/holdstale.js, engine/projects.js's held mark).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdcond-7180.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hc-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hc-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hc-fleet-'));
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

const HOUR = 3600000;
const iso = (t) => new Date(t).toISOString();
const project = () => projects.readAll().find((x) => x.id === project.id);
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

/* A project with three tasks owned by REX: #a (to hold), #b (what it may wait for), #c (closed already). */
function fixture() {
  const p = projects.create({ name: 'Supplier ' + Math.random().toString(36).slice(2) });
  const a = tasks.create(p.id, { sentence: 'Order the parts' }).number;
  const b = tasks.create(p.id, { sentence: 'Get the price approved' }).number;
  const c = tasks.create(p.id, { sentence: 'Already done' }).number;
  projects.mutate(p.id, (x) => ({
    ...x, agents: [ADA, REX],
    tasks: x.tasks.map((t) => (t.number === c ? { ...t, who: REX, closedAt: iso(Date.now() - HOUR) } : { ...t, who: REX })),
  }));
  return { id: p.id, a, b, c };
}
const status = (fn) => { try { fn(); return null; } catch (e) { return { status: e.status, message: e.message }; } };

test('#7180 setOnHold: a hold can wait for another task or a time; the condition is checked before it is stored', () => {
  const f = fixture();
  const t = tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  assert.deepEqual(t.onHoldUntil, { task: f.b });
  assert.deepEqual(stored(f.id, f.a).onHoldUntil, { task: f.b }, 'the condition was not stored on the task');
  const later = new Date(Date.now() + 48 * HOUR).toISOString();
  assert.deepEqual(tasks.setOnHold(f.id, f.a, true, { until: { at: later } }).onHoldUntil, { at: later }, 'a changed condition was not stored');
  // Refusals, each with its reason and status; none changes what is stored.
  const cases = [
    [{ task: f.a }, 400, /cannot wait for itself/],
    [{ task: 999 }, 400, /no task #999/],
    [{ task: f.c }, 409, /already closed/],
    [{ task: 0 }, 400, /task number/],
    [{ at: 'next week' }, 400, /date or time/],
    [{ at: new Date(Date.now() - HOUR).toISOString() }, 409, /already passed/],
    [{ at: new Date(Date.now() + 400 * 24 * HOUR).toISOString() }, 400, /a year ahead/],
    [{ task: f.b, at: later }, 400, /one thing/],
    [{ at: new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10) + 'T09:00' }, 400, /must say its zone/],
    ['task 3', 400, /waits for a task/],
    [{ at: new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10) + ' 09:00' }, 400, /date or time/],
    [{ at: 'Nov 2 2026' }, 400, /date or time/],
  ];
  for (const [until, code, why] of cases) {
    const r = status(() => tasks.setOnHold(f.id, f.a, true, { until }));
    assert.ok(r, 'accepted ' + JSON.stringify(until));
    assert.equal(r.status, code, JSON.stringify(until) + ': ' + r.message);
    assert.match(r.message, why);
  }
  assert.deepEqual(stored(f.id, f.a).onHoldUntil, { at: later }, 'a refused condition changed the stored one');
  const off = status(() => tasks.setOnHold(f.id, f.a, false, { until: { task: f.b } }));
  assert.equal(off && off.status, 400, 'a condition was accepted with taking a hold off');
});

test('#7180 setOnHold: a date or a zoned time is accepted; a bare date is midnight UTC', () => {
  const f = fixture();
  const d = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10);   // two days out
  assert.deepEqual(tasks.setOnHold(f.id, f.a, true, { until: { at: d } }).onHoldUntil, { at: d + 'T00:00:00.000Z' });
  assert.deepEqual(tasks.setOnHold(f.id, f.a, true, { until: { at: d + 'T09:00-05:00' } }).onHoldUntil, { at: d + 'T14:00:00.000Z' });
  assert.deepEqual(tasks.setOnHold(f.id, f.a, true, { until: { at: d + 'T09:00Z' } }).onHoldUntil, { at: d + 'T09:00:00.000Z' });
});

test('#7180 setOnHold: a bare hold clears the condition, as do taking it off and closing the task; a change is a new hold', () => {
  const f = fixture();
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  tasks.setOnHold(f.id, f.a, true);
  assert.equal(stored(f.id, f.a).onHoldUntil, undefined, 'holding again without a condition kept the old one');
  assert.equal(stored(f.id, f.a).onHold, true);
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  tasks.setOnHold(f.id, f.a, false);
  assert.equal(stored(f.id, f.a).onHoldUntil, undefined, 'taking the hold off kept the condition');
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  tasks.close(f.id, f.a);
  assert.equal(stored(f.id, f.a).onHoldUntil, undefined, 'closing the task kept the condition');
  // Each change of condition is recorded as a hold, so the stale check reads it as a new hold.
  const g = fixture();
  tasks.setOnHold(g.id, g.a, true);
  tasks.setOnHold(g.id, g.a, true, { until: { task: g.b } });
  tasks.setOnHold(g.id, g.a, true, { until: { task: g.b } });   // the same condition again: no new record
  const sets = taskchat.read(g.id, g.a).filter((e) => e && e.kind === 'hold-set');
  assert.equal(sets.length, 2, 'not one hold record per change: ' + JSON.stringify(sets));
  assert.equal(sets[1].until, 'task #' + g.b, 'the hold record does not name its condition');
});

test('#7180 holdUntilState: met once the task is closed (or gone) or the time has passed; null without a condition', () => {
  const f = fixture();
  const p = () => projects.readAll().find((x) => x.id === f.id);
  assert.equal(tasks.holdUntilState(p(), stored(f.id, f.a)), null, 'a task not on hold has a condition');
  tasks.setOnHold(f.id, f.a, true);
  assert.equal(tasks.holdUntilState(p(), stored(f.id, f.a)), null, 'a bare hold has a condition');
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  assert.deepEqual(tasks.holdUntilState(p(), stored(f.id, f.a)), { words: 'task #' + f.b + ' is closed', met: false });
  tasks.close(f.id, f.b);
  assert.equal(tasks.holdUntilState(p(), stored(f.id, f.a)).met, true, 'a closed task did not meet the condition');
  const when = Date.now() + 2 * HOUR;
  tasks.setOnHold(f.id, f.a, true, { until: { at: iso(when) } });
  assert.deepEqual(tasks.holdUntilState(p(), stored(f.id, f.a), when - 1), { words: iso(when), met: false });
  assert.equal(tasks.holdUntilState(p(), stored(f.id, f.a), when).met, true, 'the time did not meet the condition');
  // A waited-for task that is no longer on the project leaves nothing to wait for.
  const g = fixture();
  tasks.setOnHold(g.id, g.a, true, { until: { task: g.b } });
  projects.mutate(g.id, (x) => ({ ...x, tasks: x.tasks.filter((t) => t.number !== g.b) }));
  assert.equal(tasks.holdUntilState(projects.readAll().find((x) => x.id === g.id), stored(g.id, g.a)).met, true);
});

test('#7180 holdstale: an unmet condition parks the hold (nobody told, whatever the posts); a met one is told once, at any age', () => {
  const f = fixture();
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  const holdAt = Date.now() - 5 * HOUR;
  const read = () => [{ kind: 'hold-set', at: iso(holdAt), via: 'agent' }];
  const posts = Array.from({ length: 5 }, (_, i) => ({ kind: 'post', id: 'm' + i, project: f.id, from: REX, to: [ADA], text: 'working', at: iso(holdAt + (i + 1) * 60000) }));
  const only = () => projects.readAll().filter((x) => x.id === f.id);
  assert.deepEqual(hs.owed(only(), posts, Date.now(), { read }), [], 'an unmet condition was told about, as a stale hold');
  // CONTROL: the same hold with no condition IS owed a stale line (five posts, five hours), so the skip above is the condition's.
  tasks.setOnHold(f.id, f.a, true);
  const stale = hs.owed(only(), posts, Date.now(), { read });
  assert.equal(stale.length, 1, 'CONTROL: the plain hold was not owed a line');
  assert.equal(stale[0].met, undefined);
  // Met: owed with no posts at all and a hold only a minute old.
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  tasks.close(f.id, f.b);
  const freshAt = iso(Date.now() - 60000);
  const fresh = () => [{ kind: 'hold-set', at: freshAt, via: 'agent' }];
  const met = hs.owed(only(), [], Date.now(), { read: fresh });
  assert.equal(met.length, 1, 'a met condition was not owed a line');
  assert.equal(met[0].owner, REX);
  assert.equal(met[0].met, 'task #' + f.b + ' is closed');
  // Told once: the mark for this hold stops a second line.
  hs.markTold(met[0], 'reached');
  assert.deepEqual(hs.owed(only(), [], Date.now(), { read: fresh }), [], 'a met condition was told twice');
  // After the met line the hold is like any other: an owner that keeps working in the room, hours on, is told by the
  // posts rule (the met line's own mark does not silence it).
  const oldHold = iso(Date.now() - 5 * HOUR);
  const older = () => [{ kind: 'hold-set', at: oldHold, via: 'agent' }];
  hs.markTold({ ...met[0], holdAt: Date.parse(oldHold) }, 'reached');
  const after = hs.owed(only(), posts.map((r) => ({ ...r, at: iso(Date.parse(oldHold) + 60000) })), Date.now(), { read: older });
  assert.equal(after.length, 1, 'a met-and-told hold was never told about again, though its owner kept posting');
  assert.equal(after[0].met, undefined, 'the met line was told twice');
});

test('#7180 holdUntilOf: a wait that leads back to the held task is refused', () => {
  const f = fixture();
  tasks.setOnHold(f.id, f.b, true, { until: { task: f.a } });   // b waits for a
  const r = status(() => tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } }));   // a would wait for b
  assert.ok(r, 'a two-task cycle was accepted');
  assert.equal(r.status, 400);
  assert.match(r.message, /neither would ever be met/);
  // Longer: d waits for b, b waits for a; a waiting for d closes the loop.
  const d = tasks.create(f.id, { sentence: 'Book the courier' }).number;
  tasks.setOnHold(f.id, d, true, { until: { task: f.b } });
  assert.match(status(() => tasks.setOnHold(f.id, f.a, true, { until: { task: d } })).message, /neither would ever be met/);
  // CONTROL: once b is off hold the chain from d ends at b, so a waiting for d is accepted.
  tasks.setOnHold(f.id, f.b, false);
  assert.deepEqual(tasks.setOnHold(f.id, f.a, true, { until: { task: d } }).onHoldUntil, { task: d }, 'CONTROL: a chain with no loop was refused');
});

test('#7180 holdstale: the met line names the condition and the one way off; a person\'s hold asks the person', () => {
  const now = Date.now();
  const item = { projectId: 'supplier', project: 'Supplier', n: 4, sentence: 'Order the parts', owner: REX, holdAt: now - 3 * HOUR, byPerson: false, posts: 0, met: 'task #5 is closed' };
  const line = hs.tellText([item], now);
  assert.match(line, /task #4, "Order the parts", was put on hold 3 hours ago until task #5 is closed, and that has now happened/);
  assert.match(line, /take #4 off hold: kosmos task unhold supplier 4/);
  assert.doesNotMatch(line, /posted/, 'the met line counted posts');
  const theirs = hs.tellText([{ ...item, byPerson: true }], now);
  assert.match(theirs, /ask the person to take #4 off hold/);
  assert.doesNotMatch(theirs, /kosmos task unhold/, 'an agent was told to lift the person\'s hold');
  // A met item and a posts item for one owner and project are never told in one line.
  const f = fixture();
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  tasks.close(f.id, f.b);
  const d = tasks.create(f.id, { sentence: 'Book the courier' }).number;
  projects.mutate(f.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === d ? { ...t, who: REX } : t)) }));
  tasks.setOnHold(f.id, d, true);
  const holdAt = now - 5 * HOUR;
  const read = () => [{ kind: 'hold-set', at: iso(holdAt), via: 'agent' }];
  const posts = Array.from({ length: 3 }, (_, i) => ({ kind: 'post', id: 'q' + i, project: f.id, from: REX, to: [ADA], text: 'on it', at: iso(holdAt + (i + 1) * 60000) }));
  const lines = [];
  hs.sweep({
    projects: projects.readAll().filter((x) => x.id === f.id), rows: posts, now, read, roster: BASE, allowed: true, limit: { on: false },
    idleSince: () => now - 10 * 60000, DELIVERY: { PLACED: 'placed' },
    deliver: (who, text) => { lines.push(text); return { state: 'placed' }; },
  });
  assert.equal(lines.length, 1, 'one line per owner per pass');
  const names = (n) => new RegExp('task #' + n + ', "').test(lines[0]);
  assert.ok(names(f.a) !== names(d), 'a met task and a stale task were told in one line: ' + lines[0]);
});

test('#7180 the assignees\' instructions say what an agent\'s hold waits for', () => {
  const f = fixture();
  tasks.setOnHold(f.id, f.a, true, { until: { task: f.b } });
  assert.equal(typeof projects.blockBody, 'function', 'projects.blockBody is not exported');
  const text = projects.blockBody(projects.readAll().filter((x) => x.id === f.id), REX);
  assert.match(String(text), new RegExp('task ' + f.a + ' of [^\\n]*\\[on hold until task #' + f.b + ' is closed: do not start it until it is taken off hold\\]'));
});

test('#7180 task activity says what a hold waits for, and that it was met', () => {
  const phrase = require('../engine/taskactphrase');
  const fn = typeof phrase.phrase === 'function' ? phrase.phrase : phrase.phraseEvent;
  assert.equal(typeof fn, 'function', 'taskactphrase exports no phrasing function');
  assert.match(fn({ kind: 'hold-set', via: 'agent', until: 'task #5' }), /^Put on hold by an agent until .*task #5 is closed/);
  assert.match(fn({ kind: 'hold-set', via: 'screen', until: '2026-11-02T09:00:00.000Z' }), /^Put on hold until .*2026-11-02T09:00:00\.000Z/);
  assert.equal(fn({ kind: 'hold-set', via: 'agent' }), 'Put on hold by an agent', 'CONTROL: a bare hold');
  assert.match(fn({ kind: 'hold-stale', told: 'rex', met: 'task #5 is closed', reached: true }), /What its hold waited for happened .*task #5 is closed.*was told it can come off hold/);
  assert.match(fn({ kind: 'hold-stale', told: 'rex', posts: 4, reached: true }), /worked in its project room/, 'CONTROL: a posts line');
});
