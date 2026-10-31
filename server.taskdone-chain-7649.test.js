'use strict';

/**
 * kosmos#7649: the board's task-done prompts run one at a time, in the order the marks came (server.js
 * promptCommunityOnTaskDone, TASK_DONE_CHAIN), and a prompt that fails does not stop the ones after it. Each prompt
 * reads the dedup book, delivers and writes the whole book back, so two at once could both pass the dedup
 * (engine/communitytaskdone.test.js shows that race). The engine's sender is stood in for, so nothing is typed.
 *
 *   node --test server.taskdone-chain-7649.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7649chain-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.writeFileSync(path.join(SANDBOX, 'panes.txt'), '');

const server = require('./server');
const td = require('./engine/communitytaskdone');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const prompt = server._promptCommunityOnTaskDoneForTest;
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (n) => ({ projectId: 'p', taskNumber: n, session: 'ann', name: 'Ann', trigger: 'built', roster: [] });

test('kosmos#7649: two marks in a row: the second prompt starts only once the first has finished', async () => {
  const real = td.promptOnTaskDoneAsync;
  const order = [];
  try {
    td.promptOnTaskDoneAsync = async (o) => { order.push('start ' + o.taskNumber); await later(30); order.push('end ' + o.taskNumber); return { act: 'prompted', recorded: false, session: o.session, name: o.name }; };
    prompt(mark(1));
    await prompt(mark(2));
    assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2']);
  } finally { td.promptOnTaskDoneAsync = real; }
});

test('kosmos#7649: a prompt that fails does not stop the next one', async () => {
  const real = td.promptOnTaskDoneAsync;
  const ran = [];
  try {
    td.promptOnTaskDoneAsync = async (o) => { ran.push(o.taskNumber); if (o.taskNumber === 1) throw new Error('first fails'); return { act: 'prompted', recorded: false }; };
    prompt(mark(1));
    await prompt(mark(2));
    assert.deepEqual(ran, [1, 2]);
  } finally { td.promptOnTaskDoneAsync = real; }
});
