'use strict';
require('../test-support/tmpscope'); // required first in every suite file (#9104)
/* kosmos#9176: an agent's own instructions list a built task (done, waiting on a release or a check) marked as built,
 * as `kosmos task list --mine` groups it, not as plain work to do. A hold or a paused project is still named first.
 *
 *   node --test engine/builtmark-9176.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'builtmark-9176-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const tasks = require('./tasks');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const BUILT = { builtAt: '2026-11-26T12:00:00Z', builtBy: 'ada', builtNote: 'waiting on the release' };
const task = (number, extra) => Object.assign({ number, sentence: 'task ' + number, who: 'ada' }, extra);
const lineOf = (body, proj, n) => body.split('\n').find((l) => l.includes(`task ${n} of ${proj}:`)) || '';

test('#9176: a built task is listed, marked built; an open task beside it is not marked (control)', () => {
  const body = projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: [task(1, BUILT), task(2)] }], 'ada');
  assert.match(lineOf(body, 'Live', 1), /\[built: waiting on a release or a check; nothing to do on it unless it is reopened\]$/, body);
  assert.ok(lineOf(body, 'Live', 2), 'control: the open task is missing: ' + body);
  assert.doesNotMatch(lineOf(body, 'Live', 2), /\[built|\[on hold/, 'control: an open task was marked');
});

test('#9176: a built task on hold reads on hold, not built (the hold is what stops it)', () => {
  const body = projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: [task(1, { ...BUILT, onHold: true })] }], 'ada');
  const line = lineOf(body, 'Live', 1);
  assert.match(line, /\[on hold:[^\]]*do not start it/, body);
  assert.doesNotMatch(line, /\[built/, 'two marks on one task');
});

test('#9176: the mark follows kosmos task list --mine: a task is marked built exactly when listGroup calls it built', () => {
  const list = [task(1), task(2, BUILT), task(3, { onHold: true }), task(4, { ...BUILT, onHold: true })];
  const body = projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: list }], 'ada');
  for (const t of list) {
    assert.equal(/\[built:/.test(lineOf(body, 'Live', t.number)), tasks.listGroup(t) === 'built', `task ${t.number}: ${body}`);
  }
});

test('#9176: a built task in a paused project reads on hold only, not also built (the pause is what stops it)', () => {
  const body = projects.blockBody([{ id: 'parked', name: 'Parked', folder: '/tmp/parked', paused: true, tasks: [task(1, BUILT)] }], 'ada');
  const line = lineOf(body, 'Parked', 1);
  assert.match(line, /\[on hold:[^\]]*do not start it/, body);
  assert.doesNotMatch(line, /\[built/, 'two marks on one task: ' + line);
});
