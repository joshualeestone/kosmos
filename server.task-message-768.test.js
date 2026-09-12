'use strict';

/**
 * POST /api/project/:id/task/:n/message (#768): record a free-text message on a
 * task's conversation -- the WRITE half of #992's transcript (the read half is
 * the /activity route, covered by server.task-activity-768.test.js). This proves
 * the HTTP surface: a valid message records and reads back as a 'said' event with
 * its text AND is delivered to the agents assigned to the task (named in `delivered`);
 * an empty/over-length message is refused (400); a missing project/task is a 404
 * rather than a stray transcript file. The rate valve is covered separately in
 * server.task-msg-valve-768.test.js.
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
let monaTarget;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  monaTarget = (roster.find((c) => c.sessionName === 'mona') || {}).target;
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

test('a message is DELIVERED to the agents assigned to the task (Josh 2026-09-12)', async () => {
  // The task has mona assigned (whoOf -> [mona]), so a message must be delivered to
  // her and the response must name her in `delivered`. Delivery goes through chat.deliver
  // against the fake-tmux fixture (no live pane is touched). The point pinned here is
  // that the response is now the two-way shape (ok + delivered naming the assignee), not
  // the earlier record-only {ok:true}.
  const res = await say(projectId, taskNum, { text: 'please review the draft' });
  assert.equal(res.status, 200, 'a valid message should be accepted');
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.delivered), 'the response must carry a delivered list of who was notified');
  const monaDelivered = out.delivered.find((r) => r && r.agent === 'mona');
  assert.ok(monaDelivered, 'the task assignee (mona) was not among those delivered to: ' + JSON.stringify(out.delivered));
  // Assert the RAIL actually fired, not just that routing picked the right agent: the
  // state must be a real chat.DELIVERY verdict, which is only produced by chat.deliver
  // itself. Under the sandbox's DRY_RUN=1 that verdict is `could_not` ("without
  // permission to touch agents") -- deliberately, so a test never types into a real
  // pane -- so we cannot assert a live `placed` here; asserting the outcome is one of
  // chat.deliver's own states (with a `because`) proves the route invoked the rail
  // rather than fabricating a delivered entry.
  assert.ok(['placed', 'unconfirmed', 'could_not'].includes(monaDelivered.state),
    'the assignee got something other than a real chat.deliver verdict: ' + JSON.stringify(monaDelivered));
  assert.equal(typeof monaDelivered.because === 'string' || monaDelivered.because === undefined, true);
});

test('the sender is excluded: an assignee posting via its own pane is not notified about its own message', async () => {
  // mona is the sole assignee. When the post carries from_pane = mona's pane, mona
  // resolves as the sender and is filtered out, so delivered is empty (nobody else is
  // on the task) -- the same self-exclusion the room does. The message still records.
  assert.ok(monaTarget, 'the fixture did not give mona a pane target');
  const res = await say(projectId, taskNum, { text: 'a note from mona herself', from_pane: monaTarget });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.delivered, [], 'the sender (mona) was notified about her own message: ' + JSON.stringify(out.delivered));
  const body = await activity(projectId, taskNum);
  assert.ok(body.events.some((e) => e.kind === 'said' && e.text === 'a note from mona herself'), 'the sender\'s own message was not recorded');
});

test('a message to a task with NO assignees delivers to nobody (empty delivered), still records', async () => {
  // whoOf is empty -> no delivery, but the message is still recorded on the task.
  const made = tasks.create(projectId, { sentence: 'unassigned task' });
  const res = await say(projectId, made.number, { text: 'nobody is on this one' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.deepEqual(out.delivered, [], 'a task with no assignees should notify nobody');
  const body = await activity(projectId, made.number);
  assert.ok(body.events.some((e) => e.kind === 'said' && e.text === 'nobody is on this one'), 'the message was not recorded');
});

test('an empty (or whitespace) message is refused with 400 and records nothing', async () => {
  const before = (await activity(projectId, taskNum)).events.filter((e) => e.kind === 'said').length;
  const res = await say(projectId, taskNum, { text: '   ' });
  assert.equal(res.status, 400, 'an empty message must be refused, never stored');
  const after = (await activity(projectId, taskNum)).events.filter((e) => e.kind === 'said').length;
  assert.equal(after, before, 'a refused message must not have been recorded');
});

test('an over-length message is refused (400) rather than silently truncated on the way to disk', async () => {
  // The engine caps at MESSAGE_MAX and taskchat would otherwise silently truncate
  // at its generic 4000-char field cap. A caller past the client's maxlength (a
  // scripted POST) must be REFUSED, not accepted-then-truncated, or it believes it
  // saved text it did not. So a message over the cap is a 400 and records nothing.
  const before = (await activity(projectId, taskNum)).events.filter((e) => e.kind === 'said').length;
  const res = await say(projectId, taskNum, { text: 'x'.repeat(tasks.MESSAGE_MAX + 1) });
  assert.equal(res.status, 400, 'an over-length message must be refused, never truncated silently');
  const after = (await activity(projectId, taskNum)).events.filter((e) => e.kind === 'said').length;
  assert.equal(after, before, 'a refused over-length message must not have been recorded');
});

test('a message exactly at the cap is accepted (the boundary is not off by one)', async () => {
  const res = await say(projectId, taskNum, { text: 'y'.repeat(tasks.MESSAGE_MAX) });
  assert.equal(res.status, 200, 'a message exactly at MESSAGE_MAX should be accepted');
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
