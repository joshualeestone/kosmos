'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5812: the hook's keep call records which agent is about to write a project file (with the undo switch off), and
 * the project's documents list names that agent for a change that follows it. Sandboxed as server.undo-5153.test.js is.
 *   node --test server.filewho-5812.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filewho-route-'));
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

test('#5812: the keep call names the writer with undo off; the documents list says "changed by" only for a change that follows it', async () => {
  const r = await fetch(base + '/api/undo-setting');
  assert.equal((await r.json()).on, false, 'CONTROL: the undo switch is off, so nothing below depends on it');
  const projects = require('./engine/projects');
  const agentDir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'uri');
  fs.mkdirSync(agentDir, { recursive: true });
  require('./engine/store').writeProfile('uri', { displayName: 'Uri' });
  require('./engine/undo').resetForTests();
  const folder = path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'lease');
  fs.mkdirSync(path.join(folder, 'drafts'), { recursive: true });
  projects.writeAll([...projects.readAll(), { id: 'fw-p', name: 'Lease', folder, agents: ['uri'], tasks: [] }]);

  const mine = path.join(folder, 'drafts', 'terms.md');
  const theirs = path.join(folder, 'notes.md');
  const late = path.join(folder, 'late.md');
  const kept = await post('/api/undo/keep', { path: mine, cwd: fs.realpathSync(agentDir), session: 's' });
  assert.equal(kept.body.because, 'off', 'the route\'s answer changed');
  await post('/api/undo/keep', { path: late, cwd: fs.realpathSync(agentDir), session: 's' });
  fs.writeFileSync(mine, 'the agent wrote this');
  fs.writeFileSync(theirs, 'nobody recorded this');   // the person, or an agent with no hook
  fs.writeFileSync(late, 'changed long after its record');
  const later = new Date(Date.now() + 20 * 60e3); fs.utimesSync(late, later, later);

  const docs = await (await fetch(base + '/api/project/fw-p/documents?limit=50')).json();
  const by = Object.fromEntries(docs.files.map((f) => [f.name, f.changedBy || null]));
  assert.equal(by['drafts/terms.md'], 'Uri', 'the writer was not named: ' + JSON.stringify(docs.files));
  assert.equal(by['notes.md'], null, 'a change nobody recorded was attributed');
  assert.equal(by['late.md'], null, 'a change twenty minutes after the record was attributed');
});
