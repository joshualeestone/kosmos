'use strict';

/**
 * GET /api/tasks: tasks open and finished - every project by default (#1382),
 * or a single project when `?project=<id>` is given (#2498, the per-project
 * "view all tasks" door). Both modes are exercised below.
 *
 * A separate file from `server.test.js` for the reason that file's own
 * siblings give: its blocks are a standing merge hazard, and a feature can add
 * a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE. HOME included: an unsandboxed run
 * reads and can write the operator's real config, which is not hypothetical on
 * this machine today.
 *
 *   node --test server.tasks-all-1382.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-alltasks-'));
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
let aId, bId; // #2498: project ids, so the scoped-route arms can filter by one
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const a = projects.create({ name: 'Alpha' });
  const b = projects.create({ name: 'Beta' });
  aId = a.id; bId = b.id;
  projects.addAgent(a.id, 'mona', roster);
  tasks.create(a.id, { sentence: 'Write the copy', who: 'mona' }, roster);
  tasks.create(b.id, { sentence: 'Nobody has this yet' });
  projects.addAgent(b.id, 'mona', roster);
  const done = tasks.create(b.id, { sentence: 'Finished', who: 'mona' }, roster);
  tasks.close(b.id, done.number);
});

test('#1382: the route returns every task from every project, and says which are finished', async () => {
  const body = await (await fetch(base + '/api/tasks')).json();
  const names = body.tasks.map((t) => t.sentence).sort();
  assert.ok(body.tasks.length >= 3, 'the route returned too little, so nothing below is a test');
  assert.ok(names.includes('Write the copy'), 'an assigned task is missing');
  assert.ok(names.includes('Nobody has this yet'), 'an UNASSIGNED task is missing: this is the column, not the door');
  /* 🔑 The screen inherits `#pj-alltasks`, whose only remaining job is
     revealing FINISHED work. Dropping closed tasks here would make that work
     unreachable anywhere in the product. */
  assert.ok(names.includes('Finished'), 'closed work vanished: the door this screen replaces was its only way in');
  const done = body.tasks.find((t) => t.sentence === 'Finished');
  assert.equal(done.isClosed, true, 'the finished task does not say so, so the screen cannot show it differently');
  assert.ok(body.tasks.some((t) => t.isClosed === false), 'every task reads as closed, so isClosed is not discriminating');
});

test('#1382: count is the length of the list it ships with, on a NON-EMPTY list', async () => {
  const body = await (await fetch(base + '/api/tasks')).json();
  /* 🔑 THE NON-ZERO ARM IS THE TEST. `0 === 0` passes for a route that ships
     nothing and counts nothing, which is exactly the disagreement #1346 was
     about wearing a green. */
  assert.ok(body.count > 0, 'the count is zero, so the equality below is vacuous');
  assert.equal(body.count, body.tasks.length,
    'the count and the rows disagree, which is the defect this screen exists not to repeat');
});

test('#1382: every row can say which project it belongs to', async () => {
  const body = await (await fetch(base + '/api/tasks')).json();
  assert.ok(body.tasks.length > 0, 'no rows, so this proves nothing');
  for (const t of body.tasks) {
    assert.ok(t.projectName, `a row has no project name: ${JSON.stringify(t.sentence)}`);
    assert.ok(t.projectId, `a row has no project id to link back to: ${JSON.stringify(t.sentence)}`);
  }
});

// ---------------------------------------------------------------------------
// #2498: the project view's "view all tasks" door scopes to the project it was
// opened from. `?project=<id>` filters to that project (open AND closed, so the
// #1382 finished-work purpose survives per project); no param stays global.
// ---------------------------------------------------------------------------

test('#2498: ?project=<id> returns ONLY that project\'s tasks, not every project\'s', async () => {
  const body = await (await fetch(base + '/api/tasks?project=' + encodeURIComponent(aId))).json();
  const names = body.tasks.map((t) => t.sentence).sort();
  assert.ok(names.includes('Write the copy'), 'the scoped project\'s own task is missing');
  assert.ok(!names.includes('Nobody has this yet'), 'another project\'s task leaked into the scoped view');
  assert.ok(!names.includes('Finished'), 'another project\'s finished task leaked into the scoped view');
  assert.ok(body.tasks.every((t) => t.projectId === aId), 'a row belongs to a different project than the scope');
  assert.equal(body.project, aId, 'the route does not echo the project it scoped to');
});

test('#2498: a scoped view still includes that project\'s CLOSED tasks (the #1382 purpose, per project)', async () => {
  const body = await (await fetch(base + '/api/tasks?project=' + encodeURIComponent(bId))).json();
  const names = body.tasks.map((t) => t.sentence).sort();
  assert.ok(names.includes('Nobody has this yet'), 'the scoped project\'s open task is missing');
  assert.ok(names.includes('Finished'), 'scoping dropped the project\'s finished work: the reachability #1382 guards');
  const done = body.tasks.find((t) => t.sentence === 'Finished');
  assert.equal(done.isClosed, true, 'the finished task does not say so');
  assert.ok(!names.includes('Write the copy'), 'another project\'s task leaked into the scoped view');
});

test('#2498: no ?project= still returns the global set (backward-compatible)', async () => {
  const body = await (await fetch(base + '/api/tasks')).json();
  const names = body.tasks.map((t) => t.sentence);
  assert.ok(names.includes('Write the copy') && names.includes('Nobody has this yet'),
    'the unscoped route must still return every project\'s tasks, so a future global view is not broken');
  assert.equal(body.project, null, 'the unscoped route reports no project scope');
});

test('#2498: ?project=<unknown> returns an empty list, not the global set', async () => {
  const body = await (await fetch(base + '/api/tasks?project=' + encodeURIComponent('no-such-project'))).json();
  assert.equal(body.tasks.length, 0, 'an unknown project scope must return nothing, never fall back to every task');
  assert.equal(body.count, 0, 'the count disagrees with the empty list');
  assert.equal(body.project, 'no-such-project', 'the route does not echo the scope it was asked for');
});

test.after(() => { try { server.close(); } catch { /* already down */ } });
