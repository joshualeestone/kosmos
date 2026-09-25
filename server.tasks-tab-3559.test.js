'use strict';

/**
 * #3559, the Tasks view's supply side: GET /api/tasks carries each task's
 * derived `state`, its `claim` and `lastActivityAt`; POST /api/tasks/close
 * closes many tasks with one note, each standing alone.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.tasks-tab-3559.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskstab-'));
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
const commitments = require('./engine/commitments');
const taskchat = require('./engine/taskchat');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const all = async (q) => (await fetch(`${base}/api/tasks${q || ''}`)).json();
const bulk = async (body, headers) => {
  const res = await fetch(`${base}/api/tasks/close`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, headers || {}),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('GET /api/tasks: every row carries state, claim and lastActivityAt, derived by the engine', async () => {
  const p = projects.create({ name: 'Groups' });
  projects.addAgent(p.id, 'grpagent', null);
  tasks.create(p.id, { sentence: 'Nobody on it' });
  tasks.create(p.id, { sentence: 'Given, not named', who: 'grpagent' });
  tasks.create(p.id, { sentence: 'Given and named', who: 'grpagent' });
  tasks.create(p.id, { sentence: 'Finished', who: 'grpagent' });
  tasks.close(p.id, 4);
  commitments.report('grpagent', [{ what: 'on task 3 of Groups' }]);
  const body = await all(`?project=${encodeURIComponent(p.id)}`);
  const by = Object.fromEntries(body.tasks.map((t) => [t.sentence, t]));
  assert.equal(by['Nobody on it'].state, 'nobody');
  assert.equal(by['Given, not named'].state, 'assigned');
  assert.equal(by['Given, not named'].claim.claimed, false);
  assert.equal(by['Given and named'].state, 'working');
  assert.equal(by['Given and named'].claim.claimed, true);
  assert.equal(by['Finished'].state, 'closed');
  for (const t of body.tasks) {
    assert.ok(Number.isFinite(Date.parse(t.lastActivityAt)), `no last activity on ${t.sentence}`);
  }
  // The pre-existing fields are untouched (the project View-all door reads them).
  assert.equal(body.count, body.tasks.length);
  assert.ok(body.tasks.every((t) => t.projectId === p.id && typeof t.isClosed === 'boolean'));
});

test('GET /api/tasks: the global list carries the same fields across projects', async () => {
  const body = await all();
  assert.ok(body.tasks.length >= 4);
  assert.ok(body.tasks.every((t) => ['nobody', 'assigned', 'working', 'closed'].includes(t.state)), 'a state outside the provable four');
});

test('POST /api/tasks/close: closes each task, writes the note to each history first, tells the assignees', async () => {
  const p = projects.create({ name: 'Bulk' });
  projects.addAgent(p.id, 'bulkagent', null);
  tasks.create(p.id, { sentence: 'One', who: 'bulkagent' });
  tasks.create(p.id, { sentence: 'Two' });
  const r = await bulk({ tasks: [{ projectId: p.id, number: 1 }, { projectId: p.id, number: 2 }], note: 'no longer needed' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.closed, 2);
  const stored = projects.readAll().find((x) => x.id === p.id);
  assert.ok(stored.tasks.every((t) => t.closedAt), 'a task was left open');
  for (const n of [1, 2]) {
    const said = taskchat.read(p.id, n).filter((e) => e.kind === 'said').map((e) => e.text);
    assert.deepEqual(said, ['no longer needed'], `the note is not on task ${n}'s history`);
  }
});

test('POST /api/tasks/close: one bad item does not stop the others, and the answer says which failed', async () => {
  const p = projects.create({ name: 'Partial' });
  tasks.create(p.id, { sentence: 'Real' });
  const r = await bulk({ tasks: [{ projectId: p.id, number: 1 }, { projectId: p.id, number: 99 }, { projectId: 7, number: 'x' }] });
  assert.equal(r.status, 207);
  assert.equal(r.json.closed, 1);
  assert.equal(r.json.failed, 2);
  const bad = r.json.results.filter((x) => !x.ok);
  assert.ok(bad.every((x) => typeof x.error === 'string' && x.error.length), 'a failure without a reason');
  assert.ok(projects.readAll().find((x) => x.id === p.id).tasks[0].closedAt, 'the good task was not closed');
});

test('POST /api/tasks/close: an agent token, or no screen at all, is refused; nothing closes', async () => {
  const p = projects.create({ name: 'Refused' });
  tasks.create(p.id, { sentence: 'Stays open' });
  // Both ways an agent presents its token (presentedAgentToken): the body and the header.
  const bodyToken = await bulk({ tasks: [{ projectId: p.id, number: 1 }], token: 'kt_anything' });
  assert.equal(bodyToken.status, 403, 'an agent token in the body closed tasks in bulk');
  const headerToken = await bulk({ tasks: [{ projectId: p.id, number: 1 }] }, { 'x-kosmos-agent-token': 'kt_anything' });
  assert.equal(headerToken.status, 403, 'an agent token in the header closed tasks in bulk');
  const noScreen = await fetch(`${base}/api/tasks/close`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tasks: [{ projectId: p.id, number: 1 }] }),
  });
  assert.equal(noScreen.status, 403, 'a caller with no screen headers closed tasks in bulk');
  assert.equal(projects.readAll().find((x) => x.id === p.id).tasks[0].closedAt, null);
});

test('POST /api/tasks/close: empty, too many, an over-long note and junk are 400s', async () => {
  assert.equal((await bulk({ tasks: [] })).status, 400);
  assert.equal((await bulk({ tasks: Array.from({ length: 201 }, (_, i) => ({ projectId: 'x', number: i + 1 })) })).status, 400);
  assert.equal((await bulk({ tasks: [{ projectId: 'x', number: 1 }], note: 'n'.repeat(tasks.MESSAGE_MAX + 1) })).status, 400);
  assert.equal((await bulk({ nope: true })).status, 400);
});
