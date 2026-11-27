'use strict';
require('../test-support/tmpscope'); // required first in every suite file (#9104)
/* kosmos#9176: an agent's own instructions list a built task (marked built for it) marked as built,
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

const BUILT = { builtAt: '2026-11-26T12:00:00Z', builtBy: 'ada', builtWho: ['ada'], builtNote: 'waiting on the release' };
const task = (number, extra) => Object.assign({ number, sentence: 'task ' + number, who: 'ada' }, extra);
const lineOf = (body, proj, n) => body.split('\n').find((l) => l.includes(`task ${n} of ${proj}:`)) || '';

test('#9176: a built task is listed, marked built; an open task beside it is not marked (control)', () => {
  const body = projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: [task(1, BUILT), task(2)] }], 'ada');
  assert.match(lineOf(body, 'Live', 1), /\[built: done and waiting; its note says what is left\]$/, body);
  assert.ok(lineOf(body, 'Live', 2), 'control: the open task is missing: ' + body);
  assert.doesNotMatch(lineOf(body, 'Live', 2), /\[built|\[on hold/, 'control: an open task was marked');
});

test('#9176: a mark by an unnamed caller (no builtWho, not the person\'s) frees nobody, so the task is listed unmarked', () => {
  const body = projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: [task(1, { builtAt: '2026-11-26T12:00:00Z', builtWho: [] })] }], 'ada');
  assert.ok(lineOf(body, 'Live', 1), body);
  assert.doesNotMatch(lineOf(body, 'Live', 1), /\[built:/, body);
});

test('#9176: a built task on hold reads on hold, not built (the hold is what stops it)', () => {
  const body = projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: [task(1, { ...BUILT, onHold: true })] }], 'ada');
  const line = lineOf(body, 'Live', 1);
  assert.match(line, /\[on hold:[^\]]*do not start it/, body);
  assert.doesNotMatch(line, /\[built/, 'two marks on one task');
});

test('#9176 review 1: on a task with two holders, one holder\'s mark marks only that holder; the other still has its part', () => {
  const shared = (extra) => ({ number: 7, sentence: 'shared', parts: [{ id: 1, who: 'ada' }, { id: 2, who: 'bo' }], ...extra });
  const bodyFor = (who, t) => projects.blockBody([{ id: 'live', name: 'Live', folder: '/tmp/live', tasks: [t] }], who);
  const byAda = shared({ builtAt: '2026-11-26T12:00:00Z', builtBy: 'ada', builtWho: ['ada'] });
  assert.match(lineOf(bodyFor('ada', byAda), 'Live', 7), /\[built:/, 'ada marked it, so it is built for ada');
  const bo = lineOf(bodyFor('bo', byAda), 'Live', 7);
  assert.ok(bo, 'bo still holds a part, so the task is on its list');
  assert.doesNotMatch(bo, /\[built:/, 'bo was told there is nothing to do on its open part: ' + bo);
  // The person's mark frees everyone on it: both are marked.
  const byPerson = shared({ builtAt: '2026-11-26T12:00:00Z', builtByPerson: true, builtFreesAll: true });
  for (const who of ['ada', 'bo']) assert.match(lineOf(bodyFor(who, byPerson), 'Live', 7), /\[built:/, who + ' after the person marked it');
});

test('#9176: a built task in a paused project reads on hold only, not also built (the pause is what stops it)', () => {
  const body = projects.blockBody([{ id: 'parked', name: 'Parked', folder: '/tmp/parked', paused: true, tasks: [task(1, BUILT)] }], 'ada');
  const line = lineOf(body, 'Parked', 1);
  assert.match(line, /\[on hold:[^\]]*do not start it/, body);
  assert.doesNotMatch(line, /\[built/, 'two marks on one task: ' + line);
});
