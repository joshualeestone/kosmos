'use strict';

/**
 * GET /api/tasks: every open task across every project (#1382).
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
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const a = projects.create({ name: 'Alpha' });
  const b = projects.create({ name: 'Beta' });
  projects.addAgent(a.id, 'mona', roster);
  tasks.create(a.id, { sentence: 'Write the copy', who: 'mona' }, roster);
  tasks.create(b.id, { sentence: 'Nobody has this yet' });
  projects.addAgent(b.id, 'mona', roster);
  const done = tasks.create(b.id, { sentence: 'Finished', who: 'mona' }, roster);
  tasks.close(b.id, done.number);
});

test('#1382: the route returns open tasks from every project', async () => {
  const body = await (await fetch(base + '/api/tasks')).json();
  const names = body.tasks.map((t) => t.sentence).sort();
  assert.ok(body.tasks.length >= 2, 'the route returned nothing, so nothing below is a test');
  assert.ok(names.includes('Write the copy'), 'an assigned task is missing');
  assert.ok(names.includes('Nobody has this yet'), 'an UNASSIGNED task is missing: this is the column, not the door');
  assert.ok(!names.includes('Finished'), 'a closed task came through');
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

test.after(() => { try { server.close(); } catch { /* already down */ } });
