'use strict';

/**
 * GET /api/project/:id/task/:n/activity (#768/#992): a task's recorded
 * lifecycle events, read-only, so the person can get to the transcript IN the
 * app. Read-side only -- the events are RECORDED by engine/tasks.js
 * (covered by taskchat's own tests); this proves the HTTP surface reads them
 * back with the same (id, number) key, oldest-first, count-consistent, and
 * fail-soft (a task with no transcript is 200 + [], not an error).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE. HOME included, per the sibling
 * server.tasks-all-1382.test.js -- an unsandboxed run reads the operator's real
 * config, which is not hypothetical on this machine.
 *
 *   node --test server.task-activity-768.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskact-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const fleet = require('./test-support/fleet');

let base;
let projectId;
let taskNum;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const a = projects.create({ name: 'Alpha' });
  projects.addAgent(a.id, 'mona', roster);
  // create -> records 'created' (with the assignee it is born with), then
  // close -> 'closed', reopen -> 'reopened': three lifecycle events, in order.
  const made = tasks.create(a.id, { sentence: 'Write the copy', who: 'mona' }, roster);
  tasks.close(a.id, made.number);
  tasks.reopen(a.id, made.number);
  projectId = a.id;
  taskNum = made.number;
});

const activity = async (id, n) =>
  (await fetch(`${base}/api/project/${encodeURIComponent(id)}/task/${n}/activity`));

test('GET activity returns the recorded lifecycle, oldest first', async () => {
  const body = await (await activity(projectId, taskNum)).json();
  const kinds = body.events.map((e) => e.kind);
  assert.ok(body.events.length >= 3, 'too few events returned, so nothing below is a test');
  assert.equal(kinds[0], 'created', 'the first event is not the creation -- oldest-first is broken');
  assert.ok(kinds.includes('closed'), 'the close was not recorded/read');
  assert.ok(kinds.includes('reopened'), 'the reopen was not recorded/read');
  const created = body.events.find((e) => e.kind === 'created');
  assert.equal(created.who, 'mona', 'the created event lost the assignee it was born with (#992)');
  assert.ok(created.at && Number.isFinite(Date.parse(created.at)), 'the event has no usable timestamp');
});

test('count equals the number of events (the non-empty arm is the test)', async () => {
  const body = await (await activity(projectId, taskNum)).json();
  assert.ok(body.count > 0, 'zero events, so the equality below is vacuous');
  assert.equal(body.count, body.events.length, 'count and events disagree');
});

test('a task with no recorded events returns 200 + [] (fail-soft control), not an error', async () => {
  const res = await activity(projectId, 99999);
  assert.equal(res.status, 200, 'a missing transcript must be 200 + [], never an error');
  const body = await res.json();
  assert.deepEqual(body.events, [], 'a task with no transcript should read as no events');
  assert.equal(body.count, 0);
});

test.after(() => { try { server.close(); } catch { /* already down */ } });
