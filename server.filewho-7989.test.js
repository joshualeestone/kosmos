'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#7989 slice 2: GET /api/project-file/who answers for one project file from the record the hook's keep call
 * makes (server.filewho-5812.test.js's sandbox): the agent last seen, its display name, the owner, and the last change.
 *   node --test server.filewho-7989.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filewho-7989-route-'));
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

const who = async (p) => {
  const res = await fetch(base + '/api/project-file/who' + (p === undefined ? '' : '?path=' + encodeURIComponent(p)));
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('kosmos#7989 slice 2: the route names the agent the keep call recorded, by its display name, and the owner', async () => {
  const projects = require('./engine/projects');
  const agentDir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'uri');
  fs.mkdirSync(agentDir, { recursive: true });
  require('./engine/store').writeProfile('uri', { displayName: 'Uri' });
  require('./engine/undo').resetForTests();
  const folder = path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'lease');
  fs.mkdirSync(folder, { recursive: true });
  projects.writeAll([...projects.readAll(), { id: 'fw-w', name: 'Lease', folder, agents: ['uri'], tasks: [] }]);
  require('./engine/filewriters').resetForTests();
  const mine = path.join(folder, 'terms.md');
  const theirs = path.join(folder, 'notes.md');
  const res = await fetch(base + '/api/undo/keep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: mine, cwd: fs.realpathSync(agentDir), session: 's' }) });
  assert.equal(res.status < 500, true);
  fs.writeFileSync(mine, 'the agent wrote this');
  fs.writeFileSync(theirs, 'nobody recorded this');

  const a = await who(mine);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.ok, true);
  assert.equal(a.body.projectId, 'fw-w');
  assert.equal(a.body.projectName, 'Lease');
  assert.equal(a.body.name, 'terms.md');
  assert.equal(a.body.lastSeen.agent, 'uri');
  assert.equal(a.body.lastSeen.shown, 'Uri');
  assert.deepEqual(a.body.owner, { agent: 'uri', shown: 'Uri' });
  assert.equal(a.body.lastChange, 'seen');

  const b = await who(theirs);
  assert.equal(b.body.ok, true);
  assert.equal(b.body.lastSeen, null, 'a change nobody recorded was attributed');
  assert.equal(b.body.exists, true);
});

test('kosmos#7989 slice 2 review 4: on an enforcing board a token-only agent is admitted, and a caller with neither token is not', async () => {
  const { boardAuthState } = require('./server');
  const sendertoken = require('./engine/sendertoken');
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'vee'), { recursive: true });
  require('./engine/store').writeProfile('vee', { displayName: 'Vee' });
  const tok = sendertoken.mint('vee').token;
  const target = path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'lease', 'terms.md');
  const url = base + '/api/project-file/who?path=' + encodeURIComponent(target);
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = 'BOARD_TOKEN_7989_review_0123456789abcdef';
  try {
    const bare = await fetch(url);
    assert.notEqual(bare.status, 200, 'CONTROL: the board is enforcing, so a caller with no token is refused');
    const agent = await fetch(url, { headers: { 'x-kosmos-agent-token': tok } });
    assert.equal(agent.status, 200, 'a token-only agent was refused');
    assert.equal((await agent.json()).ok, true);
    const head = await fetch(url, { method: 'HEAD', headers: { 'x-kosmos-agent-token': tok } });
    // This pins the gate (it admits the agent token for GET only), not the route's own GET-only test, which a
    // mutation admitting HEAD leaves green: the gate refuses first.
    assert.notEqual(head.status, 200, 'a HEAD answered on the agent token, which the gate admits only for GET');
  } finally {
    boardAuthState.on = was.on;
    boardAuthState.token = was.token;
  }
});

test('kosmos#7989 slice 2: outside every project, no path, and a relative path are answered without a record', async () => {
  const outside = await who(path.join(SANDBOX, 'home', 'private.md'));
  assert.equal(outside.status, 200);
  assert.deepEqual(outside.body, { ok: false, because: 'outside' }, 'a path outside the projects said more than that');
  const none = await who();
  assert.equal(none.status, 400);
  const cross = await fetch(base + '/api/project-file/who?path=' + encodeURIComponent(path.join(SANDBOX, 'projects', 'lease', 'terms.md')), { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403, 'a page on another site read a file\'s record');
  const sibling = await fetch(base + '/api/project-file/who?path=' + encodeURIComponent(path.join(SANDBOX, 'projects', 'lease', 'terms.md')), { headers: { 'sec-fetch-site': 'same-site' } });
  assert.equal(sibling.status, 403, 'another computer\'s page read a file\'s record');
  const bad = await fetch(base + '/api/project-file/who?path=%2Ftmp%2F%FF.md');
  assert.equal(bad.status, 400, 'review 5: a path that is not UTF-8 was answered about another path');
  const rel = await who('lease/terms.md');
  assert.equal(rel.status, 400);
  assert.equal(rel.body.ok, false);
});
