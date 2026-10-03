'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5153 slice 1: GET /api/project/:id/task/:n/receipt, against the real server. Sandboxed as server.usage.test.js is.
 *   node --test server.receipt-5153.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-receipt-route-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('an open task has none yet; a closed one has a receipt; an agent\'s token is refused; no such task is a 404', async () => {
  const made = await post('/api/projects', { name: 'Receipt route ' + Date.now() });
  const id = made.body && made.body.project && made.body.project.id;
  assert.ok(id, 'fixture: no project ' + JSON.stringify(made));
  const task = await post('/api/project/' + encodeURIComponent(id) + '/tasks', { sentence: 'Write the release notes' });
  assert.ok(task.status < 300, 'fixture: no task ' + JSON.stringify(task));
  const url = base + '/api/project/' + encodeURIComponent(id) + '/task/1/receipt';

  let res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: false, because: 'open' });

  const closed = await post('/api/project/' + encodeURIComponent(id) + '/task/1/close');
  assert.ok(closed.status < 300, 'fixture: the task did not close ' + JSON.stringify(closed));
  res = await fetch(url);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(typeof r.closedAt, 'string', JSON.stringify(r));
  assert.deepEqual(r.retries, { reopened: 0, handoffs: 0 });
  assert.deepEqual(r.agents, [], 'nobody held it');

  res = await fetch(url, { headers: { 'x-kosmos-agent-token': 'any-agent-token' } });
  assert.equal(res.status, 403, 'an agent read every holder\'s files and folder');

  res = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/task/99/receipt');
  assert.equal(res.status, 404);
});
