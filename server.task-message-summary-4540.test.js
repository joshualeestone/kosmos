'use strict';
/**
 * #4540: after `kosmos task message` both CLIs used to print "any agents assigned to it were notified", which was
 * false for a switched-off swarm and for an assignee no longer on the project. The board now returns one plain
 * sentence (`summary`) built from `delivered`, and the CLIs print that. The Mac CLI reads it with sed, so it must
 * carry no double quote or backslash.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-summary-4540-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { taskMessageSummary } = require('./server');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('each delivery state is said as it is: told, may have been told, not told with the reason', () => {
  const s = taskMessageSummary([
    { agent: 'mara', state: 'placed' },
    { agent: 'zed', state: 'unconfirmed' },
    { agent: 'gone-agent', state: 'could_not', because: 'gone-agent is not on this project any more, so it was not told' },
  ], 3);
  assert.equal(s, 'Told mara. zed may have been told (Kosmos could not confirm it). Not told: gone-agent is not on this project any more, so it was not told.');
  assert.doesNotMatch(s, /were notified/);
});

test('an unconfirmed delivery is never reported as told', () => {
  assert.doesNotMatch(taskMessageSummary([{ agent: 'zed', state: 'unconfirmed' }], 1), /^Told/);
});

test('nobody assigned, and only the sender assigned, each say no agent was told', () => {
  assert.equal(taskMessageSummary([], 0), 'Nobody is assigned to it, so no agent was told.');
  assert.equal(taskMessageSummary([], 1), 'Nobody else is assigned to it, so no agent was told.');
});

test('the sentence carries no double quote, backslash or newline, whatever the reason says (the Mac CLI reads it with sed)', () => {
  const s = taskMessageSummary([{ agent: 'a"b', state: 'could_not', because: 'it said "no"\\ and\nstopped' }], 1);
  assert.doesNotMatch(s, /["\\\r\n]/, s);
  assert.match(s, /^Not told: it said no/);
});

test('control characters are stripped too, so JSON never puts a backslash back into the sentence', () => {
  const s = taskMessageSummary([{ agent: 'zed', state: 'could_not', because: 'bell\u0007 and escape\u001b[31m red\u007f' }], 1);
  assert.doesNotMatch(JSON.stringify(s), /\\/, JSON.stringify(s));
});

test('a could-not with no reason still names the agent', () => {
  assert.equal(taskMessageSummary([{ agent: 'zed', state: 'could_not' }], 1), 'Not told: zed could not be reached.');
});
