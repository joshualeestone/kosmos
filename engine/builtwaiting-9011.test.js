'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#9011 part 2: a project whose queue is built and waiting on the person's review no longer reads as idle. The
 * project summary counts its built open tasks (builtWaiting), and the project card's pill says "Built but waiting"
 * (Josh's own words for the task state, #3951) when nothing outranks it.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/builtwaiting-9011.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bw-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bw-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bw-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');

function project(name, n) {
  const p = projects.create({ name });
  const nums = [];
  for (let i = 0; i < n; i += 1) nums.push(tasks.create(p.id, { sentence: 'task ' + i, made: { via: 'screen' } }, []).number);
  return { id: p.id, nums };
}
const summary = (id) => projects.list([]).find((p) => p.id === id).summary;

test('#9011 the summary counts open tasks marked built; held, closed, unbuilt and archived ones are not counted', () => {
  const a = project('bw one', 4);
  assert.equal(summary(a.id).builtWaiting, 0, 'CONTROL: nothing built yet');
  for (const n of a.nums) assert.ok(tasks.setBuilt(a.id, n, { by: 'ada' }), 'fixture: setBuilt refused');
  assert.equal(summary(a.id).builtWaiting, 4);
  tasks.setOnHold(a.id, a.nums[0], true);
  assert.equal(summary(a.id).builtWaiting, 3, 'a task the person put on hold is held, not waiting');
  assert.ok(tasks.close(a.id, a.nums[1]), 'fixture: close refused');
  assert.equal(summary(a.id).builtWaiting, 2, 'a closed task is done');
  projects.edit(a.id, { archived: true });
  assert.equal(summary(a.id).builtWaiting, 0, 'none on an archived project');
});

test('#9011 built work in a paused project still counts (#5864); a task an agent held for the person does not', () => {
  const p = project('bw two', 2);
  for (const n of p.nums) assert.ok(tasks.setBuilt(p.id, n, { by: 'ada' }), 'fixture: setBuilt refused');
  projects.edit(p.id, { paused: true });
  assert.equal(summary(p.id).builtWaiting, 2, 'a paused project\'s built work is waiting, not stalled');
  tasks.setOnHold(p.id, p.nums[0], true, { forPerson: true });
  assert.equal(summary(p.id).builtWaiting, 1, 'a hold for the person is its own Question (heldForYou), not counted twice');
});

test('#9011 the project card says "Built but waiting" only when nothing outranks it', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = PAGE.indexOf('function pjPillOf(p, unreadable) {');
  assert.notEqual(at, -1, 'pjPillOf is gone');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  const GLYPH = { question: '?', paused: 'P', restarting: 'R' };
  // eslint-disable-next-line no-new-func
  const pill = new Function('GLYPH', 'return (' + src.replace('function pjPillOf', 'function') + ');')(GLYPH);
  const label = (s, extra, unreadable) => pill({ summary: { total: 2, ...s }, ...extra }, unreadable === true).label;

  assert.equal(label({ builtWaiting: 3 }), 'Built but waiting');
  assert.equal(label({ builtWaiting: 3 }, {}, true), 'Built but waiting', 'no roster needed, as #7797\'s held-for-you Question');
  /* Everything that is running or needs the person leads. */
  assert.equal(label({ builtWaiting: 3, needsYou: 1 }), 'Issue');
  assert.equal(label({ builtWaiting: 3, needsYou: 1, needsYouQuestions: 1 }), 'Question');
  assert.equal(label({ builtWaiting: 3, heldForYou: 1 }), 'Question');
  assert.equal(label({ builtWaiting: 3 }, { paused: true }), 'Paused');
  assert.equal(label({ builtWaiting: 3, working: 1 }), 'Working');
  assert.equal(label({ builtWaiting: 3, restarting: 1 }), 'Restarting');
  /* CONTROLS: #4730 (Josh): no badge when nothing is running; and an older board with no count says nothing new. */
  assert.equal(label({ builtWaiting: 0 }), '');
  assert.equal(label({}), '');
});
