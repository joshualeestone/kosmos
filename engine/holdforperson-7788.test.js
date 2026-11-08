'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#7788: an agent's hold can say it waits on the person.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdforperson-7788.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hfp-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hfp-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hfp-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

function fresh(name) {
  const p = projects.create({ name });
  const t = tasks.create(p.id, { sentence: 'a held task', made: { via: 'screen' } }, []);
  return { id: p.id, n: t.number };
}


const read = (id, n) => tasks.byNumber(projects.get(id), n);

test('an agent\'s hold can wait on the person; the stored task says so', () => {
  const { id, n } = fresh('hfp one');
  assert.equal(tasks.setOnHold(id, n, true, { forPerson: true, because: 'needs your yes on the price' }).onHoldForPerson, true);
  assert.equal(read(id, n).onHoldForPerson, true);
});

test('control: a hold without it does not wait on the person', () => {
  const { id, n } = fresh('hfp two');
  assert.equal('onHoldForPerson' in tasks.setOnHold(id, n, true), false);
});

test('an agent re-holding without it keeps it; false clears it', () => {
  const { id, n } = fresh('hfp three');
  tasks.setOnHold(id, n, true, { forPerson: true });
  assert.equal(tasks.setOnHold(id, n, true, { because: 'still waiting' }).onHoldForPerson, true);
  assert.equal('onHoldForPerson' in tasks.setOnHold(id, n, true, { forPerson: false }), false);
});

test('taking the hold off, or the person holding it on the screen, ends it', () => {
  const a = fresh('hfp four');
  tasks.setOnHold(a.id, a.n, true, { forPerson: true });
  assert.equal('onHoldForPerson' in tasks.setOnHold(a.id, a.n, false), false);
  const b = fresh('hfp five');
  tasks.setOnHold(b.id, b.n, true, { forPerson: true });
  const t = tasks.setOnHold(b.id, b.n, true, { viaScreen: true });
  assert.equal(t.onHoldByPerson, true);
  assert.equal('onHoldForPerson' in t, false, 'the person\'s own hold never waits on them');
});

test('refused: the person\'s own hold, a screen hold, taking a hold off, or not a boolean', () => {
  const p = fresh('hfp six');
  tasks.setOnHold(p.id, p.n, true, { viaScreen: true });
  assert.throws(() => tasks.setOnHold(p.id, p.n, true, { forPerson: true }), (e) => e.status === 403);
  assert.equal('onHoldForPerson' in read(p.id, p.n), false);
  const q = fresh('hfp seven');
  assert.throws(() => tasks.setOnHold(q.id, q.n, true, { viaScreen: true, forPerson: true }), (e) => e.status === 400);
  assert.throws(() => tasks.setOnHold(q.id, q.n, false, { forPerson: true }), (e) => e.status === 400);
  assert.throws(() => tasks.setOnHold(q.id, q.n, true, { forPerson: 'yes' }), (e) => e.status === 400);
  assert.equal('onHold' in read(q.id, q.n), false, 'nothing was held by a refused call');
});

test('closing the task drops it with the hold', () => {
  const { id, n } = fresh('hfp eight');
  tasks.setOnHold(id, n, true, { forPerson: true });
  assert.ok(tasks.close(id, n), 'fixture: close refused');
  assert.equal('onHoldForPerson' in read(id, n), false);
  assert.equal('onHold' in read(id, n), false, 'control: the hold itself went too');
});

test('the wiring: the hold route passes forPerson from the body', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /tasks\.setOnHold\(id, taskHold\[2\], body\.onHold, \{[^}]*forPerson: body\.forPerson[,\s}]/);
  // kosmos#7797 review 1: and it says whether a --not-for-you took the mark off.
  assert.match(src, /forPersonCleared: holdOut\.forPersonCleared === true/);
});

test('step 4: a hold for the person reads decision, so the red tile counts it', () => {
  const { id, n } = fresh('hfp nine');
  tasks.setOnHold(id, n, true, { forPerson: true, because: 'needs your yes' });
  assert.equal(tasks.taskState(read(id, n)), 'decision');
  assert.equal(tasks.isOnHold(read(id, n)), true, 'the hold itself stays: the Assigner and nudger read this');
});

test('step 4 control: a plain agent hold, and the person\'s own hold, stay held', () => {
  const a = fresh('hfp ten');
  tasks.setOnHold(a.id, a.n, true, { because: 'waiting on the build' });
  assert.equal(tasks.taskState(read(a.id, a.n)), 'held');
  const b = fresh('hfp eleven');
  tasks.setOnHold(b.id, b.n, true, { viaScreen: true });
  assert.equal(tasks.taskState(read(b.id, b.n)), 'held');
});

test('step 4: lifting the hold takes it out of decision', () => {
  const { id, n } = fresh('hfp twelve');
  tasks.setOnHold(id, n, true, { forPerson: true });
  tasks.setOnHold(id, n, false);
  assert.notEqual(tasks.taskState(read(id, n)), 'decision');
});

test('review 1: marking or unmarking an existing hold records a hold-set event, which says forPerson when set', () => {
  const { id, n } = fresh('hfp thirteen');
  tasks.setOnHold(id, n, true, { because: 'plain' });
  const count = () => taskchat.read(id, n).filter((e) => e.kind === 'hold-set').length;
  assert.equal(count(), 1, 'fixture: the first hold records one event');
  tasks.setOnHold(id, n, true, { because: 'plain' });
  assert.equal(count(), 1, 'CONTROL: a bare re-hold records nothing');
  tasks.setOnHold(id, n, true, { forPerson: true });
  const evs = taskchat.read(id, n).filter((e) => e.kind === 'hold-set');
  assert.equal(evs.length, 2, 'marking it waits on the person was not recorded');
  assert.equal(evs[1].forPerson, true);
  tasks.setOnHold(id, n, true, { forPerson: false });
  const after = taskchat.read(id, n).filter((e) => e.kind === 'hold-set');
  assert.equal(after.length, 3, 'unmarking it was not recorded');
  assert.equal('forPerson' in after[2], false);
});

test('review 3: the history says a hold waits on you, and when it stopped waiting on you', () => {
  const phrase = require('../engine/taskactphrase').phrase;
  const { id, n } = fresh('hfp fourteen');
  tasks.setOnHold(id, n, true, { forPerson: true });
  tasks.setOnHold(id, n, true, { forPerson: false });
  const evs = taskchat.read(id, n).filter((e) => e.kind === 'hold-set');
  assert.equal(evs.length, 2);
  assert.equal(phrase(evs[0]), 'Put on hold by an agent, waiting on you');
  assert.equal(phrase(evs[1]), 'Put on hold by an agent, no longer waiting on you');
  assert.equal(phrase(evs[0], null, { forAgent: true }), 'Put on hold by an agent, waiting on the person');
  const plain = fresh('hfp fifteen');
  tasks.setOnHold(plain.id, plain.n, true);
  assert.equal(phrase(taskchat.read(plain.id, plain.n).find((e) => e.kind === 'hold-set')), 'Put on hold by an agent', 'CONTROL: a plain hold');
});

test('review 4: an agent restating the person\'s hold with forPerson false is no change, not a refusal; true is still refused', () => {
  const p = fresh('hfp sixteen');
  tasks.setOnHold(p.id, p.n, true, { viaScreen: true });
  assert.equal('onHoldForPerson' in tasks.setOnHold(p.id, p.n, true, { forPerson: false }), false);
  assert.equal(read(p.id, p.n).onHoldByPerson, true, 'the person\'s hold stayed theirs');
  assert.throws(() => tasks.setOnHold(p.id, p.n, true, { forPerson: true }), (e) => e.status === 403, 'CONTROL: marking it is still refused');
});

test('review 4: the agent\'s own list says a hold waits on its person; a plain hold keeps its mark (control)', () => {
  const task = (number, extra) => Object.assign({ number, sentence: 'task ' + number, who: 'ada' }, extra);
  const body = projects.blockBody([
    { id: 'w', name: 'Waits', folder: '/tmp/waits', tasks: [task(1, { onHold: true, onHoldForPerson: true }), task(2, { onHold: true })] },
  ], 'ada');
  const line = (n) => body.split('\n').find((l) => l.includes('task ' + n + ' of Waits:')) || '';
  // kosmos#8259: and it says to name the task when asking, so the person's Tasks row can show it was asked.
  assert.match(line(1), /\[on hold, waiting on your person: do not start it until they answer and it is taken off hold\. When you ask them, name task 1, so Kosmos shows them you asked\]/, body);
  assert.match(line(2), /\[on hold: do not start it until it is taken off hold\]/, 'CONTROL: a plain hold');
});

test('review 5: heldForPersonCount counts open held-for-you tasks in live projects only', () => {
  const t = (number, extra) => Object.assign({ number, sentence: 's' }, extra);
  const list = [
    { id: 'a', tasks: [t(1, { onHold: true, onHoldForPerson: true }), t(2, { onHold: true }), t(3, { onHoldForPerson: true })] },
    { id: 'b', archived: true, tasks: [t(1, { onHold: true, onHoldForPerson: true })] },
  ];
  assert.equal(tasks.heldForPersonCount(list), 1, 'a plain hold, a mark with no hold, and an archived project are not counted');
  assert.equal(tasks.heldForPersonCount(null), 0);
  const { id, n } = fresh('hfp seventeen');
  tasks.setOnHold(id, n, true, { forPerson: true });
  const live = projects.readAll().filter((p) => p.id === id);
  assert.equal(tasks.heldForPersonCount(live), 1, 'a real hold for you is counted');
  assert.ok(tasks.close(id, n), 'fixture: close refused');
  assert.equal(tasks.heldForPersonCount(projects.readAll().filter((p) => p.id === id)), 0, 'a closed task is not');
});

test('review 5 wiring: the status route adds held-for-you tasks to the icon count before it sums it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /r\.state === STATE\.NEEDS_YOU \? r\.stateProject : '\*'\]\)\);\n\s*counts\.heldForYou = tasks\.heldForPersonCount\(projectList, asking\);\n\s*\} catch \{ counts\.heldForYou = 0; \}\n\s*counts\.waiting = waitingBadgeOn\(badgeSettings\) \? waitingTotal\(counts, rows\)/);
});

test('review 6: a held-for-you task whose holder already asks the person is not counted again', () => {
  const t = (number, who, extra) => Object.assign({ number, sentence: 's', who }, extra);
  const list = [{ id: 'a', tasks: [t(1, 'ada', { onHold: true, onHoldForPerson: true }), t(2, 'rex', { onHold: true, onHoldForPerson: true })] }];
  assert.equal(tasks.heldForPersonCount(list, new Map([['ada', 'a']])), 1, 'ada asks about this project, so only rex\'s is added');
  assert.equal(tasks.heldForPersonCount(list, new Map([['ada', '*']])), 1, 'ada needs the person for itself (a trust wait): the same');
  assert.equal(tasks.heldForPersonCount(list, new Map([['ada', 'elsewhere']])), 2, 'review 7: a question about another project does not carry this hold');
  assert.equal(tasks.heldForPersonCount(list, new Map()), 2, 'CONTROL: nobody asking, both');
});

test('kosmos#7797: the project summary counts its open holds for the person (no roster needed); a plain hold is not one', () => {
  const a = fresh('hfp eighteen');
  tasks.setOnHold(a.id, a.n, true, { forPerson: true });
  const b = fresh('hfp nineteen');
  tasks.setOnHold(b.id, b.n, true);
  const row = (id) => projects.list([]).find((p) => p.id === id);
  assert.equal(row(a.id).summary.heldForYou, 1);
  assert.equal(row(b.id).summary.heldForYou, 0, 'CONTROL: a plain hold');
  assert.ok(tasks.close(a.id, a.n), 'fixture: close refused');
  assert.equal(row(a.id).summary.heldForYou, 0, 'a closed task is not waiting');
});

test('kosmos#7797 review 1: --not-for-you keeps the hold\'s condition and reason, and the history does not say its condition was cleared', () => {
  const { id, n } = fresh('hfp nfy one');
  const other = tasks.create(id, { sentence: 'the thing it waits for', made: { via: 'screen' } }, []);
  tasks.setOnHold(id, n, true, { forPerson: true, until: { task: other.number }, because: 'price?' });
  const out = {};
  const t = tasks.setOnHold(id, n, true, { forPerson: false, until: null, out });
  assert.deepEqual(t.onHoldUntil, { task: other.number }, 'the condition went with the mark');
  assert.equal(t.onHoldBecause, 'price?');
  assert.equal('onHoldForPerson' in t, false);
  assert.equal(out.forPersonCleared, true);
  const last = taskchat.read(id, n).filter((e) => e.kind === 'hold-set').pop();
  assert.equal('untilCleared' in last, false, 'the history says the condition was cleared');
  // CONTROL: an agent's ordinary re-hold with no condition still sets exactly what it is given (no condition).
  assert.equal('onHoldUntil' in tasks.setOnHold(id, n, true, { until: null }), false);
});

test('kosmos#7797 review 1: --not-for-you on a task that is not on hold is refused, and the task stays as it was', () => {
  const { id, n } = fresh('hfp nfy two');
  assert.throws(() => tasks.setOnHold(id, n, true, { forPerson: false }), (e) => e.status === 409 && /not on hold/.test(e.message));
  assert.equal(tasks.isOnHold(read(id, n)), false);
  assert.equal(tasks.isOnHold(tasks.setOnHold(id, n, true)), true, 'CONTROL: an ordinary hold still holds it');
});

test('kosmos#7797 review 1: --not-for-you on a hold that was not for the person reports nothing cleared', () => {
  const { id, n } = fresh('hfp nfy three');
  tasks.setOnHold(id, n, true);
  const out = {};
  tasks.setOnHold(id, n, true, { forPerson: false, out });
  assert.equal(out.forPersonCleared, false);
});

test('kosmos#7797 review 2: marking or unmarking a hold is recorded as mark-only, so the stale-hold clock keeps the hold\'s own start', () => {
  const hs = require('./holdstale');
  const { id, n } = fresh('hfp clock');
  tasks.setOnHold(id, n, true);
  const first = taskchat.read(id, n).filter((e) => e.kind === 'hold-set');
  assert.equal(first.length, 1);
  assert.equal('markOnly' in first[0], false, 'a new hold is not mark-only');
  const start = hs.holdSet(id, n, taskchat.read);
  tasks.setOnHold(id, n, true, { forPerson: true });
  tasks.setOnHold(id, n, true, { forPerson: false });
  const evs = taskchat.read(id, n).filter((e) => e.kind === 'hold-set');
  assert.equal(evs.length, 3, 'the mark changes are still in the history');
  assert.deepEqual(evs.slice(1).map((e) => e.markOnly), [true, true]);
  assert.deepEqual(hs.holdSet(id, n, taskchat.read), start, 'the clock restarted on a mark change');
  // CONTROL: a changed condition IS a new hold, and the clock moves to it.
  const other = tasks.create(id, { sentence: 'later', made: { via: 'screen' } }, []);
  tasks.setOnHold(id, n, true, { until: { task: other.number }, forPerson: true });
  const last = taskchat.read(id, n).filter((e) => e.kind === 'hold-set').pop();
  assert.equal('markOnly' in last, false, 'a new condition with the mark is a new hold');
});

test('kosmos#7797 review 2: an archived project counts no hold for the person, so it wears no Question pill', () => {
  const a = fresh('hfp archived');
  tasks.setOnHold(a.id, a.n, true, { forPerson: true });
  const row = (id) => projects.list([]).find((p) => p.id === id);
  assert.equal(row(a.id).summary.heldForYou, 1, 'CONTROL: before archiving');
  projects.edit(a.id, { archived: true });
  assert.equal(row(a.id).summary.heldForYou, 0);
});

test('kosmos#7797 review 3: the person taking over an agent\'s hold for them on the screen is a new hold, so the clock restarts', () => {
  const hs = require('./holdstale');
  const { id, n } = fresh('hfp takeover');
  tasks.setOnHold(id, n, true, { forPerson: true });
  const before = hs.holdSet(id, n, taskchat.read);
  tasks.setOnHold(id, n, true, { viaScreen: true });
  const last = taskchat.read(id, n).filter((e) => e.kind === 'hold-set').pop();
  assert.equal(last.via, 'screen');
  assert.equal('markOnly' in last, false, 'the takeover was recorded as a mark change');
  const after = hs.holdSet(id, n, taskchat.read);
  assert.equal(after.byPerson, true, 'the clock still reads the agent\'s hold');
  assert.ok(after.at >= before.at);
  // CONTROL: the same takeover of an unmarked agent hold.
  const c = fresh('hfp takeover control');
  tasks.setOnHold(c.id, c.n, true);
  tasks.setOnHold(c.id, c.n, true, { viaScreen: true });
  assert.equal(hs.holdSet(c.id, c.n, taskchat.read).byPerson, true);
});

test('kosmos#7797 final review: --for-you on an existing hold keeps its condition, as --not-for-you does; a bare re-hold still does not', () => {
  const { id, n } = fresh('hfp for keeps');
  const other = tasks.create(id, { sentence: 'the thing it waits for', made: { via: 'screen' } }, []);
  tasks.setOnHold(id, n, true, { until: { task: other.number } });
  const t = tasks.setOnHold(id, n, true, { forPerson: true, until: null });
  assert.deepEqual(t.onHoldUntil, { task: other.number }, '--for-you dropped the condition');
  assert.equal(t.onHoldForPerson, true);
  const last = taskchat.read(id, n).filter((e) => e.kind === 'hold-set').pop();
  assert.equal(last.markOnly, true, 'marking it is not a new hold');
  assert.equal('untilCleared' in last, false);
  // CONTROL: a bare re-hold sets exactly what it is given (no condition), as before.
  assert.equal('onHoldUntil' in tasks.setOnHold(id, n, true, { until: null }), false);
  // CONTROL: --for-you that puts a NEW hold on starts with no condition.
  const fresh2 = fresh('hfp for new');
  assert.equal('onHoldUntil' in tasks.setOnHold(fresh2.id, fresh2.n, true, { forPerson: true }), false);
});
