'use strict';
/* kosmos#8736: a close with --replaced-by marks a task "closed without running" (closedUnrun, which #8301's done-count
   reads) only when the task's own record does not say it ran. A task with a check reported met, a run recorded, or a
   built mark (or what its close kept of one) is "done, then superseded": replaced, with the link kept, and counted as
   done without counting as never run. Replacing finished work stays allowed: this is not a refusal.

     node --test engine/tasks.replacedran-8736.test.js */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-8736-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-8736-data-'));
const projects = require('./projects');
const tasks = require('./tasks');

function board() {
  const id = projects.create({ name: 'Replaced ' + Math.random().toString(36).slice(2), agents: ['rex'] }).id;
  const top = tasks.create(id, { sentence: 'Parent' }).number;
  const kid = (s) => tasks.create(id, { sentence: s, parent: top }).number;
  const instead = tasks.create(id, { sentence: 'instead' }).number;
  const stored = (n) => projects.readAll().find((p) => p.id === id).tasks.find((t) => t.number === n);
  const count = () => tasks.treeOf(projects.readAll().find((p) => p.id === id)).progress(top);
  return { id, kid, instead, stored, count };
}

test('#8736 replaced with nothing on record is still never run (CONTROL: the #8301 behaviour stands)', () => {
  const b = board();
  const n = b.kid('nothing done');
  tasks.close(b.id, n, { replacedBy: b.instead });
  assert.equal(b.stored(n).replacedBy, b.instead);
  assert.equal(b.stored(n).closedUnrun, true);
  assert.deepEqual(b.count(), { done: 1, built: 0, held: 0, unrun: 1, total: 1 });
});

test('#8736 replaced after a check was reported met: replaced and done, never "never run"', () => {
  const b = board();
  const n = b.kid('checked');
  tasks.setDoneWhen(b.id, n, ['The page loads'], { by: 'rex' });
  tasks.setCheckResult(b.id, n, 1, true, 'opened it', { by: 'rex' });
  tasks.close(b.id, n, { replacedBy: b.instead });
  assert.equal(b.stored(n).replacedBy, b.instead, 'the link is kept: replacing finished work is allowed');
  assert.equal(b.stored(n).closedUnrun, false, 'replaced, and its record says it ran');
  assert.deepEqual(b.count(), { done: 1, built: 0, held: 0, unrun: 0, total: 1 });
});

test('#8736 an unmet check is not a sign it ran (it may have moved on): replaced is still never run', () => {
  const b = board();
  const n = b.kid('unmet');
  tasks.setDoneWhen(b.id, n, ['The page loads'], { by: 'rex' });
  tasks.setCheckResult(b.id, n, 1, false, 'it does not', { by: 'rex' });
  tasks.close(b.id, n, { replacedBy: b.instead });
  assert.equal(b.stored(n).closedUnrun, true);
});

test('#8736 replaced after a built mark, or after a run recorded: not never run', () => {
  const b = board();
  const built = b.kid('built');
  tasks.setBuilt(b.id, built, { by: 'rex' });
  tasks.close(b.id, built, { replacedBy: b.instead });
  assert.equal(b.stored(built).closedUnrun, false, 'built, then replaced');
  assert.ok(!b.stored(built).builtAt, 'the close still takes the built mark away (#6923)');
  const ran = b.kid('ran');
  /* A run recorded (kosmos task ran, on a repeating task) leaves lastRunAt, which a close keeps; set as it leaves it. */
  projects.mutate(b.id, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === ran ? { ...t, lastRunAt: '2026-11-19T15:00:00.000Z' } : t)) }));
  assert.ok(b.stored(ran).lastRunAt, 'a run was recorded');
  tasks.close(b.id, ran, { replacedBy: b.instead });
  assert.equal(b.stored(ran).closedUnrun, false, 'a run recorded, then replaced');
  assert.deepEqual(b.count(), { done: 2, built: 0, held: 0, unrun: 0, total: 2 });
});

test('#8736 a task closed as built earlier, then marked replaced: what the close kept still says it ran', () => {
  const b = board();
  const n = b.kid('closed built, replaced later');
  tasks.setBuilt(b.id, n, { by: 'rex' });
  tasks.close(b.id, n);
  assert.ok(b.stored(n).closedHow, 'the close recorded how it finished: ' + JSON.stringify(b.stored(n)));
  tasks.close(b.id, n, { replacedBy: b.instead });
  assert.equal(b.stored(n).replacedBy, b.instead);
  assert.equal(b.stored(n).closedUnrun, false);
});

test('#8736 a task replaced before #8301 (no closedUnrun at all) still counts as unrun by its link', () => {
  const b = board();
  const n = b.kid('old replaced');
  tasks.close(b.id, n, { replacedBy: b.instead });
  projects.mutate(b.id, (p) => ({ ...p, tasks: p.tasks.map((t) => { if (t.number !== n) return t; const c = { ...t }; delete c.closedUnrun; return c; }) }));
  assert.equal(b.stored(n).closedUnrun, undefined);
  assert.deepEqual(b.count(), { done: 1, built: 0, held: 0, unrun: 1, total: 1 });
});

test('#8736 a reopen clears the false as it clears true; --not-run on a ran-then-replaced task is the closer saying so', () => {
  const b = board();
  const n = b.kid('reopened');
  tasks.setBuilt(b.id, n, { by: 'rex' });
  tasks.close(b.id, n, { replacedBy: b.instead });
  assert.equal(b.stored(n).closedUnrun, false);
  tasks.reopen(b.id, n, {});
  assert.equal(b.stored(n).closedUnrun, undefined, 'a reopen clears it');
});

test('#8736 ranOnRecord reads only the task\'s own record', () => {
  assert.deepEqual(tasks.ranOnRecord({}), { met: 0, ran: false, built: false, any: false });
  assert.equal(tasks.ranOnRecord({ builtAt: '2026-11-19T00:00:00Z' }).any, true);
  assert.equal(tasks.ranOnRecord({ closedHow: 'note' }).any, true);
  assert.equal(tasks.ranOnRecord({ closedHow: 'unbuilt' }).any, false);
  assert.equal(tasks.ranOnRecord({ landedCommit: 'abc123' }).any, true);
  assert.equal(tasks.ranOnRecord({ lastRunAt: '2026-11-19T00:00:00Z' }).any, true);
  const checked = { doneWhen: ['a', 'b'], doneWhenResults: [{ met: false, how: 'no', by: 'rex', at: 'x' }, { met: true, how: 'yes', by: 'rex', at: 'x' }] };
  assert.deepEqual(tasks.ranOnRecord(checked), { met: 1, ran: false, built: false, any: true });
  assert.equal(tasks.ranOnRecord(null).any, false);
});
