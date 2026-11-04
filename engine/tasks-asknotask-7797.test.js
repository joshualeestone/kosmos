'use strict';

/**
 * kosmos#7797 item 1: tasks.askingWithoutTask lists an agent's question that no task row carries, so Needs your
 * decision on Tasks shows it. The cards are real fleet cards (test-support/fleet), with only the state a real agent
 * would be in changed; the rows come from the route's own rule (waitingOnOf).
 *
 *   node --test engine/tasks-asknotask-7797.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-asknotask-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-asknotask-data-'));
process.on('exit', () => {
  for (const d of [process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const projects = require('./projects');
const tasks = require('./tasks');
const fleet = require('../test-support/fleet');

function realCards() {
  const board = fleet.install([fleet.agent('ann'), fleet.agent('bo'), fleet.agent('cy')], { strict: false });
  try { return ['ann', 'bo', 'cy'].map((n) => ({ ...board.card(n) })); } finally { board.restore(); }
}
/* The route's rows: each open task with waitingOn from the same roster. */
function rowsFor(p, roster) {
  const fresh = projects.readAll().find((x) => x.id === p.id);
  return (fresh.tasks || []).map((t) => {
    const row = { ...t, projectId: p.id };
    return { ...row, waitingOn: tasks.waitingOnOf(row, roster, fresh.agents) };
  });
}

test('#7797: a question about a project where the agent holds no task is listed; one a task carries is not', () => {
  const p = projects.create({ name: 'Asking' });
  for (const a of ['ann', 'bo']) projects.addAgent(p.id, a);
  tasks.create(p.id, { sentence: 'Ann holds this', who: 'ann' });
  const [ann, bo] = realCards();
  const roster = [
    { ...ann, state: 'needs_you', stateProject: p.id, waitingSince: '2026-11-02T10:00:00Z' },
    { ...bo, state: 'needs_you', stateProject: p.id, waitingSince: '2026-11-02T09:00:00Z' },
  ];
  const rows = rowsFor(p, roster);
  assert.deepEqual(rows[0].waitingOn, [{ who: 'ann', reason: 'question' }], 'CONTROL: the task carries ann');
  assert.deepEqual(tasks.askingWithoutTask(rows, roster), [
    { who: 'bo', projectId: p.id, waitingSince: '2026-11-02T09:00:00.000Z' },
  ]);
  assert.deepEqual(tasks.askingWithoutTask(rows, roster, null, projects.readAll()), [
    { who: 'bo', projectId: p.id, waitingSince: '2026-11-02T09:00:00.000Z', projectName: 'Asking', projectPath: [] },
  ], 'with the project list, the project is named as a task row names it');
});

test('#7797: a question about no project is listed with a null project; oldest first, unknown starts last', () => {
  const [ann, bo, cy] = realCards();
  const roster = [
    { ...ann, state: 'needs_you', stateProject: null },
    { ...bo, state: 'needs_you', stateProject: null, waitingSince: '2026-11-02T12:00:00Z' },
    { ...cy, state: 'needs_you', stateProject: null, waitingSince: '2026-11-01T12:00:00Z' },
  ];
  assert.deepEqual(tasks.askingWithoutTask([], roster).map((x) => [x.who, x.projectId]), [['cy', null], ['bo', null], ['ann', null]]);
});

test('#7797: not a question (trust wait, working), not ours, and no roster are not listed', () => {
  const [ann, bo, cy] = realCards();
  const roster = [
    { ...ann, state: 'needs_trust' },
    { ...bo, state: 'working' },
    { ...cy, state: 'needs_you', stateProject: null, isNamedOurs: false },
  ];
  assert.deepEqual(tasks.askingWithoutTask([], roster), []);
  assert.deepEqual(tasks.askingWithoutTask([], null), []);
  assert.equal(tasks.askingWithoutTask([], [{ ...cy, state: 'needs_you', stateProject: null }]).length, 1,
    'CONTROL: the same card, ours, is listed');
});

test('#7797: a scope keeps only questions about that project', () => {
  const [ann, bo] = realCards();
  const roster = [{ ...ann, state: 'needs_you', stateProject: 'here' }, { ...bo, state: 'needs_you', stateProject: null }];
  assert.deepEqual(tasks.askingWithoutTask([], roster, 'here').map((x) => x.who), ['ann']);
});

test('#7797 final review: a question about an archived project is left out, unless that project is the one a door opened', () => {
  const [ann] = realCards();
  const roster = [{ ...ann, state: 'needs_you', stateProject: 'old' }];
  const list = [{ id: 'old', name: 'Old', archived: true, tasks: [] }];
  assert.deepEqual(tasks.askingWithoutTask([], roster, null, list), []);
  assert.equal(tasks.askingWithoutTask([], roster, null, list, 'old').length, 1, 'the door keeps it');
  assert.equal(tasks.askingWithoutTask([], roster, null, [{ ...list[0], archived: false }]).length, 1, 'CONTROL: not archived');
});

test('#7916: a held question is listed with held:true; an asked one carries no held field', () => {
  const [ann, bo] = realCards();
  const roster = [
    { ...ann, state: 'needs_you', stateProject: null, waitingSince: '2026-11-02T09:00:00Z', stateHeld: true },
    { ...bo, state: 'needs_you', stateProject: null, waitingSince: '2026-11-02T10:00:00Z', stateHeld: false },
  ];
  assert.deepEqual(tasks.askingWithoutTask([], roster), [
    { who: 'ann', projectId: null, waitingSince: '2026-11-02T09:00:00.000Z', held: true },
    { who: 'bo', projectId: null, waitingSince: '2026-11-02T10:00:00.000Z' },
  ]);
});
