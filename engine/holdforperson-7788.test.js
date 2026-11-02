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
  assert.match(src, /tasks\.setOnHold\(id, taskHold\[2\], body\.onHold, \{[^}]*forPerson: body\.forPerson \}/);
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
