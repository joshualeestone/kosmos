'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#8395: an agent that holds a task for the person can store a suggested answer beside its question.
 *
 * It belongs to the question: kept by a bare re-hold, gone when the hold, the for-you mark or the reason goes, and only
 * an agent's for-you hold can have one. Every arm that removes it has an arm beside it that must keep it.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdsuggest-8395.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hsg-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hsg-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hsg-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const tasklist = require('../engine/tasklist');

let seq = 0;
function fresh() {
  const p = projects.create({ name: 'hsg ' + (++seq) });
  const t = tasks.create(p.id, { sentence: 'a held task', made: { via: 'screen' } }, []);
  return { id: p.id, n: t.number };
}
const read = (id, n) => tasks.byNumber(projects.get(id), n);
const ask = (id, n, extra = {}) => tasks.setOnHold(id, n, true, { forPerson: true, because: 'which price do you want', ...extra });
const status = (fn) => { try { fn(); return 0; } catch (e) { return e.status || -1; } };

test('a for-you hold stores the suggested answer, tidied to one line', () => {
  const { id, n } = fresh();
  ask(id, n, { suggest: '  the lower one,\n  9 dollars ' });
  assert.equal(read(id, n).onHoldSuggest, 'the lower one, 9 dollars');
});

test('a bare re-hold keeps it; restating the same reason keeps it', () => {
  const { id, n } = fresh();
  ask(id, n, { suggest: 'yes' });
  tasks.setOnHold(id, n, true);                               // a bare re-hold (keeps the mark and the reason)
  assert.equal(read(id, n).onHoldSuggest, 'yes', 'a bare re-hold dropped the suggestion');
  ask(id, n);                                                 // the same question again, no suggestion given
  assert.equal(read(id, n).onHoldSuggest, 'yes', 'restating the same question dropped the suggestion');
});

test('a new suggestion for the same question replaces the old one', () => {
  const { id, n } = fresh();
  ask(id, n, { suggest: 'yes' });
  ask(id, n, { suggest: 'no, the other one' });
  assert.equal(read(id, n).onHoldSuggest, 'no, the other one');
});

test('a new question drops the old suggestion; one sent with it is kept', () => {
  const { id, n } = fresh();
  ask(id, n, { suggest: 'yes' });
  ask(id, n, { because: 'which colour' });
  assert.equal('onHoldSuggest' in read(id, n), false, 'a suggestion outlived the question it answered');
  ask(id, n, { because: 'which size', suggest: 'medium' });
  assert.equal(read(id, n).onHoldSuggest, 'medium', 'a suggestion sent with a new question was dropped');
});

test('it goes with the for-you mark, the hold, and a close', () => {
  const a = fresh();
  ask(a.id, a.n, { suggest: 'yes' });
  tasks.setOnHold(a.id, a.n, true, { forPerson: false });
  assert.equal(read(a.id, a.n).onHold, true, 'control: unmarking keeps the hold');
  assert.equal('onHoldSuggest' in read(a.id, a.n), false, 'the suggestion stayed after the mark came off');

  const b = fresh();
  ask(b.id, b.n, { suggest: 'yes' });
  tasks.setOnHold(b.id, b.n, false);
  assert.equal('onHoldSuggest' in read(b.id, b.n), false, 'the suggestion stayed after the hold came off');

  const c = fresh();
  ask(c.id, c.n, { suggest: 'yes' });
  tasks.close(c.id, c.n);
  assert.equal('onHoldSuggest' in read(c.id, c.n), false, 'the suggestion stayed on a closed task');
});

test('empty clears it; too long, not words, or with an unhold is refused', () => {
  const { id, n } = fresh();
  ask(id, n, { suggest: 'yes' });
  ask(id, n, { suggest: '' });
  assert.equal('onHoldSuggest' in read(id, n), false, 'an empty suggestion did not clear it');
  assert.equal(status(() => ask(id, n, { suggest: 'x'.repeat(201) })), 400);
  assert.equal(status(() => ask(id, n, { suggest: 7 })), 400);
  assert.equal(status(() => tasks.setOnHold(id, n, false, { suggest: 'yes' })), 400);
  ask(id, n, { suggest: 'x'.repeat(200) });
  assert.equal(read(id, n).onHoldSuggest.length, 200, 'control: the limit itself is accepted');
});

test('only an agent\'s for-you hold can carry one', () => {
  const a = fresh();
  assert.equal(status(() => tasks.setOnHold(a.id, a.n, true, { because: 'parked', suggest: 'yes' })), 400, 'a hold not for the person took one');
  assert.equal('onHoldSuggest' in read(a.id, a.n), false);

  const b = fresh();
  tasks.setOnHold(b.id, b.n, true, { viaScreen: true, because: 'mine' });
  assert.equal(status(() => tasks.setOnHold(b.id, b.n, true, { suggest: 'yes' })), 403, 'an agent put one on the person\'s hold');
  assert.equal(status(() => tasks.setOnHold(b.id, b.n, true, { viaScreen: true, suggest: 'yes' })), 400, 'the person\'s own hold took one');
});

test('task show prints it under its own heading, after the question, and only on a for-you hold', () => {
  const { id, n } = fresh();
  ask(id, n, { suggest: 'the lower one' });
  const show = (row) => tasklist.showLines({ tasks: [{ ...row, projectId: id, isClosed: false }] }, n, id).lines.join('\n');
  const text = show(read(id, n));
  assert.match(text, /Why on hold:\n {4}which price do you want\nSuggested answer:\n {4}the lower one/, text);
  // A stored suggestion on a hold no longer marked for the person (as an older row could carry) is not shown.
  assert.doesNotMatch(show({ ...read(id, n), onHoldForPerson: false }), /Suggested answer/);
});
