'use strict';

/**
 * POST /api/project/:id/task/:n/message (#768): record a free-text message on a
 * task's conversation -- the WRITE half of #992's transcript (the read half is
 * the /activity route, covered by server.task-activity-768.test.js). This proves
 * the HTTP surface: a valid message records and reads back as a 'said' event with
 * its text; an empty message is refused (400); a missing project/task is a 404
 * rather than a stray transcript file. It is record-only -- no agent delivery.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE. HOME included, per the sibling
 * server.task-activity-768.test.js.
 *
 *   node --test server.task-message-768.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskmsg-'));
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
  const made = tasks.create(a.id, { sentence: 'Write the copy', who: 'mona' }, roster);
  projectId = a.id;
  taskNum = made.number;
});

const say = async (id, n, body) =>
  fetch(`${base}/api/project/${encodeURIComponent(id)}/task/${n}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const activity = async (id, n) =>
  (await fetch(`${base}/api/project/${encodeURIComponent(id)}/task/${n}/activity`)).json();

test('a message records and reads back as a said event with its text', async () => {
  const res = await say(projectId, taskNum, { text: 'checked the draft with the client' });
  assert.equal(res.status, 200, 'a valid message should be accepted');
  const out = await res.json();
  assert.equal(out.ok, true);
  const body = await activity(projectId, taskNum);
  const said = body.events.filter((e) => e.kind === 'said');
  assert.equal(said.length, 1, 'exactly one said event should be recorded');
  assert.equal(said[0].text, 'checked the draft with the client', 'the message text did not round-trip');
});

test('the response is the record-only shape -- no delivery fields (pins the decision)', async () => {
  // The defining decision of this change is record-only: a message is NOT delivered
  // to any agent. The delivering task routes (close/reopen/parts) return a `told`
  // field naming who was notified; `say` must not. This pins the record-only HTTP
  // contract: a future edit that wires delivery the way those routes do (surfacing
  // `told`) breaks this. It does not by itself prove no side-channel delivery, but
  // it guards the contract against the most likely regression.
  const res = await say(projectId, taskNum, { text: 'a note, delivered to nobody' });
  const out = await res.json();
  assert.deepEqual(out, { ok: true }, 'the message response carried more than the record-only {ok:true} (a told/heard/task field would mean delivery leaked in)');
});

test('an empty (or whitespace) message is refused with 400 and records nothing', async () => {
  const before = (await activity(projectId, taskNum)).events.filter((e) => e.kind === 'said').length;
  const res = await say(projectId, taskNum, { text: '   ' });
  assert.equal(res.status, 400, 'an empty message must be refused, never stored');
  const after = (await activity(projectId, taskNum)).events.filter((e) => e.kind === 'said').length;
  assert.equal(after, before, 'a refused message must not have been recorded');
});

test('a message to a missing task is a 404, not a stray transcript', async () => {
  const res = await say(projectId, 99999, { text: 'into the void' });
  assert.equal(res.status, 404, 'a message to a nonexistent task must 404');
  const body = await activity(projectId, 99999);
  assert.deepEqual(body.events, [], 'no transcript should have been created for a missing task');
});

test('a message to a missing project is a 404', async () => {
  const res = await say('no-such-project', taskNum, { text: 'nobody home' });
  assert.equal(res.status, 404, 'a message to a nonexistent project must 404');
});

test.after(() => { try { server.close(); } catch { /* already down */ } });
