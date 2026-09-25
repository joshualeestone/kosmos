'use strict';

/**
 * #3703: the project View-all door opens the Tasks view scoped to its project. The view's read
 * leaves archived projects out (#3559), so an ARCHIVED project's own door names it
 * (`withArchived=<id>`) and gets that one project's tasks, and only that one.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.tasks-door-3703.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksdoor-'));
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

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const view = async (q) => (await fetch(`${base}/api/tasks?view=tasks${q || ''}`)).json();

test('withArchived keeps exactly the named archived project in the Tasks view read; others stay out', async () => {
  const live = projects.create({ name: 'Live one' });
  tasks.create(live.id, { sentence: 'A live task' });
  const a = projects.create({ name: 'Set aside A' });
  tasks.create(a.id, { sentence: 'A archived task' });
  tasks.create(a.id, { sentence: 'A finished task' });
  tasks.close(a.id, 2);
  const b = projects.create({ name: 'Set aside B' });
  tasks.create(b.id, { sentence: 'B archived task' });
  projects.setArchived(a.id, true);
  projects.setArchived(b.id, true);

  // Control: without the name, neither archived project is in the read.
  const plain = await view();
  assert.ok(plain.tasks.some((t) => t.projectId === live.id), 'the live project is missing (control)');
  assert.ok(!plain.tasks.some((t) => t.projectId === a.id || t.projectId === b.id), 'an archived project is in the plain Tasks view read');

  const withA = await view(`&withArchived=${encodeURIComponent(a.id)}`);
  const aRows = withA.tasks.filter((t) => t.projectId === a.id);
  assert.deepEqual(aRows.map((t) => t.sentence).sort(), ['A archived task', 'A finished task'], 'the named archived project\'s tasks, closed included');
  assert.ok(aRows.every((t) => t.projectArchived === true && typeof t.state === 'string'), 'its rows carry the view fields and say they are archived');
  assert.ok(!withA.tasks.some((t) => t.projectId === b.id), 'naming one archived project let another in');
  assert.ok(withA.tasks.some((t) => t.projectId === live.id), 'naming an archived project dropped the live ones');
});

test('withArchived naming a live or unknown project changes nothing', async () => {
  const p = projects.create({ name: 'Live two' });
  tasks.create(p.id, { sentence: 'Still here' });
  const plain = await view();
  const named = await view(`&withArchived=${encodeURIComponent(p.id)}`);
  const unknown = await view('&withArchived=no-such-project');
  const ids = (b) => b.tasks.map((t) => t.projectId + '#' + t.number).sort();
  assert.deepEqual(ids(named), ids(plain));
  assert.deepEqual(ids(unknown), ids(plain));
});
