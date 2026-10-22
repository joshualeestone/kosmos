'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)
/* #6895: a Tasks row names who holds an OPEN part of the task without being one of the project's agents (offProject),
 * so the screen can say "(not on this project)". Absent when every open holder is a member.
 *
 *   node --test engine/tasks.offproject-6895.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-offp-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-offp-data-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-offp-workers-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-offp-launch-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const tasks = require('./tasks');

const open = (n, who) => ({ number: n, sentence: 'task ' + n, createdAt: '2026-10-01T00:00:00Z', closedAt: null, who });
const row = (rows, n) => rows.find((r) => r.number === n);

test('#6895: a holder who left the project is named in offProject; a member is not (the control)', () => {
  const rows = tasks.allTasks([{ id: 'p', name: 'P', agents: ['ada'], tasks: [open(1, 'rex'), open(2, 'ada')] }]);
  assert.deepEqual(row(rows, 1).offProject, ['rex']);
  assert.equal(row(rows, 2).offProject, undefined, 'a member holding a task is not marked');
  assert.deepEqual(row(rows, 1).whoNames, ['rex'], 'the holder is still named on the row');
});

test('#6895: only OPEN parts count; a finished part held by a former member is history, not a mismatch', () => {
  const parts = [
    { id: 1, who: 'rex', sentence: 'a', closedAt: '2026-10-02T00:00:00Z' },
    { id: 2, who: 'ada', sentence: 'b', closedAt: null },
  ];
  const rows = tasks.allTasks([{ id: 'p', name: 'P', agents: ['ada'], tasks: [{ number: 3, sentence: 's', createdAt: '2026-10-01T00:00:00Z', closedAt: null, parts }] }]);
  assert.equal(row(rows, 3).offProject, undefined);
  const openParts = parts.map((x) => (x.who === 'rex' ? { ...x, closedAt: null } : x));
  const rows2 = tasks.allTasks([{ id: 'p', name: 'P', agents: ['ada'], tasks: [{ number: 3, sentence: 's', createdAt: '2026-10-01T00:00:00Z', closedAt: null, parts: openParts }] }]);
  assert.deepEqual(row(rows2, 3).offProject, ['rex'], 'CONTROL: the same part, open, is marked');
});

test('#6895: a FINISHED task is history: no offProject even when its part was left open (closing leaves parts open)', () => {
  const closed = { number: 5, sentence: 's', createdAt: '2026-10-01T00:00:00Z', closedAt: '2026-10-21T00:00:00Z',
    parts: [{ id: 1, who: 'rex', sentence: 's', closedAt: null }] };
  const rows = tasks.allTasks([{ id: 'p', name: 'P', agents: ['ada'], tasks: [closed, open(6, 'rex')] }]);
  assert.equal(row(rows, 5).offProject, undefined);
  assert.deepEqual(row(rows, 6).offProject, ['rex'], 'CONTROL: the same holder on an open task is marked');
});
