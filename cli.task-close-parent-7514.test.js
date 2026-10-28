'use strict';

/**
 * kosmos#7514: a close asked withBuilt also closes the built subtasks; a plain close names those left; both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js) print them. Harness copied from cli.task-close-many-7412.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-close-parent-7514.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-closeparent-cli-'));
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
const taskchat = require('./engine/taskchat');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: "CloseParent" }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));   // kai is NOT on it
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const taskOf = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n);
const isDone = (n) => tasks.progressOf(taskOf(n)).closed;
const token = (name) => sendertoken.mint(name).token;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, text: out.concat(err).join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '', port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 45000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];


function round(label) {
  const top = tasks.create(projectId, { sentence: label + ' round' });
  const kid = tasks.create(projectId, { sentence: label + ' seat one', parent: top.number, who: 'mara' });
  const open = tasks.create(projectId, { sentence: label + ' seat two', parent: top.number, who: 'otto' });
  assert.equal(tasks.setBuilt(projectId, kid.number, { by: 'mara' }).ok, true);
  return { top: top.number, kid: kid.number, open: open.number };
}
const post = (n, body) => fetch(`${base}/api/project/${projectId}/task/${n}/close`, { method: 'POST',
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

test('kosmos#7514: a plain close of a parent takes nothing and names the built subtasks left', async () => {
  const r = round('Plain');
  const res = await post(r.top);
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.task.closedWith, undefined);
  assert.deepEqual(j.task.builtLeft, [r.kid]);
  assert.equal(isDone(r.kid), false, 'a plain close took a built subtask');
});

test('kosmos#7514: a close with withBuilt takes the built subtasks, tells their agent, and leaves the open one', async () => {
  const r = round('With');
  const told = [];
  const real = projects.syncAgent;
  projects.syncAgent = (name, roster) => { told.push(name); return real(name, roster); };
  let j;
  try {
    const res = await post(r.top, { withBuilt: true });
    j = await res.json();
    assert.equal(res.status, 200, JSON.stringify(j));
  } finally { projects.syncAgent = real; }
  assert.deepEqual(j.task.closedWith, [r.kid]);
  assert.equal(isDone(r.kid), true);
  assert.equal(isDone(r.open), false, 'an open subtask was closed');
  assert.ok(told.includes('mara'), 'the closed subtask\'s agent was not told: ' + JSON.stringify(told));
  assert.equal(told.filter((x) => x === 'mara').length, 1, 'an agent was told more than once');
});

test('kosmos#7514: withBuilt must be true or false, and is refused beside replacedBy; nothing closes', async () => {
  const r = round('Refuse');
  for (const body of [{ withBuilt: 'yes' }, { withBuilt: 1 }, { withBuilt: true, replacedBy: r.open }]) {
    const res = await post(r.top, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(isDone(r.top), false, 'a refused close closed the parent: ' + JSON.stringify(body));
  }
});

test('kosmos#7514: the Tasks screen\'s bulk close takes no subtasks', async () => {
  const r = round('Bulk');
  const res = await fetch(`${base}/api/tasks/close`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ tasks: [{ projectId, number: r.top }] }) });
  assert.equal(res.status, 200);
  assert.equal(isDone(r.kid), false, 'the screen\'s bulk close took a built subtask');
});

for (const [name, run] of [['Windows', (a) => win(a)], ['Mac', (a) => mac(a)]]) {
  test(`kosmos#7514: the ${name} command offers --with-built, and says what it closed`, async () => {
    const a = round(name + 'Hint');
    const plain = await run(['task', 'close', projectId, String(a.top)]);
    assert.equal(plain.code, 0, plain.text);
    assert.match(plain.text, new RegExp('Its built subtasks are still open: ' + a.kid + '\\. To close them: kosmos task close \\S+ ' + a.kid + '\\b'));
    assert.equal(isDone(a.kid), false);
    const b = round(name + 'One');
    const one = await run(['task', 'close', projectId, String(b.top), '--with-built']);
    assert.equal(one.code, 0, one.text);
    assert.match(one.text, new RegExp('Its built subtasks closed with it: ' + b.kid + '\\.'));
    assert.equal(isDone(b.kid), true);
    const c = round(name + 'Many');
    const d = round(name + 'Many2');
    const many = await run(['task', 'close', projectId, String(c.top), String(d.open), '--with-built']);
    assert.equal(many.code, 0, many.text);
    assert.match(many.text, new RegExp('Task ' + c.top + "'s built subtasks closed with it: " + c.kid + '\\.'));
    const e = round(name + 'ManyPlain');
    const f = round(name + 'ManyPlain2');
    const manyPlain = await run(['task', 'close', projectId, String(e.top), String(f.open)]);
    assert.match(manyPlain.text, new RegExp('Task ' + e.top + ' still has built subtasks open: ' + e.kid + '\\. To close them: kosmos task close \\S+ ' + e.kid + '\\b'));
    assert.equal(isDone(e.kid), false);
    const g = round(name + 'Lone');
    const lone = await run(['task', 'close', projectId, String(g.open)]);
    assert.doesNotMatch(lone.text, /built subtasks/, 'a task with no subtasks spoke of some');
    const refused = await run(['task', 'close', projectId, String(g.top), '--replaced-by', String(g.open), '--with-built']);
    assert.notEqual(refused.code, 0, 'replaced and --with-built together were accepted: ' + refused.text);
  });
}

for (const [name, run] of [['Windows', (a) => win(a)], ['Mac', (a) => mac(a)]]) {
  test(`kosmos#7514: the ${name} command takes --with-built anywhere after the numbers, and refuses it with --replaced-by either way round`, async () => {
    const a = round(name + 'Mid');
    const b = round(name + 'Mid2');
    const mid = await run(['task', 'close', projectId, String(a.top), '--with-built', '0' + String(b.top)]);
    assert.equal(mid.code, 0, mid.text);
    assert.equal(isDone(a.kid), true, 'the flag before a later number was not applied to the first: ' + mid.text);
    assert.equal(isDone(b.kid), true, 'the flag was not applied to a zero-padded number after it: ' + mid.text);
    const c = round(name + 'Order');
    const refused = await run(['task', 'close', projectId, String(c.top), '--with-built', '--replaced-by', String(c.open)]);
    assert.notEqual(refused.code, 0, refused.text);
    assert.match(refused.text, /--with-built and --replaced-by do not go together/);
    assert.equal(isDone(c.top), false, 'a refused close closed the task');
    const other = await run(['task', 'close', projectId, String(c.top), '--replaced-by', String(c.open), '--with-built']);
    assert.match(other.text, /--with-built and --replaced-by do not go together/, 'the other order: ' + other.text);
  });
}

const http = require('node:http');
/* A board older than --with-built: it refuses any close body with more than replacedBy, as the route did before #7514. */
async function olderBoard(refusal = 'a close takes only replacedBy (the number of the task that replaced it), so the task was not closed') {
  const proxy = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/task\/\d+\/close$/.test(req.url)) {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (refusal && raw.trim() && /withBuilt/.test(raw)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: refusal })); return; }
        // refusal null: a board older than #6923, which never read the body (sent on without it, so closed as done).
        const headers = { ...req.headers }; if (refusal === null) { delete headers['content-length']; delete headers['content-type']; }
        const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        up.end(refusal === null ? '' : raw);
      });
      return;
    }
    const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return proxy;
}
async function viaPort(label, port, argv) {
  if (label === 'Mac') return mac(argv, '', port);
  const pbase = 'http://127.0.0.1:' + port;
  const out = []; const err = [];
  const code = await cli.main(argv, { env: {}, url: pbase, hook: { resolveUrl: () => pbase, readBoardToken: () => null, agentToken: () => null }, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, text: out.concat(err).join('\n') };
}

for (const label of ['Windows', 'Mac']) {
  test(`kosmos#7514: on a board older than --with-built the ${label} command says so, and nothing closed`, async () => {
    const a = round(label + 'Old');
    const b = round(label + 'Old2');
    const proxy = await olderBoard();
    try {
      const one = await viaPort(label, proxy.address().port, ['task', 'close', projectId, String(a.top), '--with-built']);
      assert.notEqual(one.code, 0, one.text);
      assert.match(one.text, new RegExp('This Kosmos is older than --with-built, so task ' + a.top + ' was not closed'), one.text);
      const many = await viaPort(label, proxy.address().port, ['task', 'close', projectId, String(a.top), String(b.top), '--with-built']);
      assert.match(many.text, new RegExp('Could not close task ' + a.top + ': this Kosmos is older than --with-built'), many.text);
    } finally { proxy.close(); }
    assert.equal(isDone(a.top), false);
  });

  /* Round 6: a board between #6923 and its round-8 notes refused an unknown key in its first words, and nothing closed. */
  test(`kosmos#7514: on a board from #6923's first days the ${label} command says it is older, and nothing closed`, async () => {
    const a = round(label + 'Mid');
    const b = round(label + 'Mid2');
    const proxy = await olderBoard('we could not read that request, so the task was not closed');
    try {
      const one = await viaPort(label, proxy.address().port, ['task', 'close', projectId, String(a.top), '--with-built']);
      assert.notEqual(one.code, 0, one.text);
      assert.match(one.text, new RegExp('This Kosmos is older than --with-built, so task ' + a.top + ' was not closed'), one.text);
      const many = await viaPort(label, proxy.address().port, ['task', 'close', projectId, String(a.top), String(b.top), '--with-built']);
      assert.match(many.text, new RegExp('Could not close task ' + a.top + ': this Kosmos is older than --with-built'), many.text);
    } finally { proxy.close(); }
    assert.equal(isDone(a.top), false);
  });

  /* Round 6: a board older than #6923 never read the body, so it closed the parent as done and took nothing. */
  for (const many of [false, true]) {
    test(`kosmos#7514: on a board that ignores the body the ${label} command says the subtasks were not closed (${many ? 'several' : 'one'})`, async () => {
      const a = round(label + 'Ign' + many);
      const b = round(label + 'Ign2' + many);
      const proxy = await olderBoard(null);
      let r;
      try {
        r = await viaPort(label, proxy.address().port, ['task', 'close', projectId, String(a.top), ...(many ? [String(b.top)] : []), '--with-built']);
      } finally { proxy.close(); }
      assert.notEqual(r.code, 0, 'an ignored --with-built read as success: ' + r.text);
      assert.match(r.text, /older than --with-built, so its built subtasks were not closed/, r.text);
      assert.equal(isDone(a.top), true, 'premise: the older board closed the parent');
      assert.equal(isDone(a.kid), false, 'premise: the older board took no subtask');
    });
  }

  test(`kosmos#7514: CONTROL: on a current board the ${label} command says nothing about an older board when none were built`, async () => {
    const top = tasks.create(projectId, { sentence: label + ' lone' });
    const r = await (label === 'Mac' ? mac : win)(['task', 'close', projectId, String(top.number), '--with-built']);
    assert.equal(r.code, 0, r.text);
    assert.doesNotMatch(r.text, /older/, r.text);
  });

  test(`kosmos#7514: the ${label} command says why Kosmos stopped closing the subtasks part way`, async () => {
    const top = tasks.create(projectId, { sentence: label + ' partial' });
    const k1 = tasks.create(projectId, { sentence: label + ' p1', parent: top.number, who: 'mara' });
    const k2 = tasks.create(projectId, { sentence: label + ' p2', parent: top.number, who: 'mara' });
    assert.equal(tasks.setBuilt(projectId, k1.number, { by: 'mara' }).ok, true);
    assert.equal(tasks.setBuilt(projectId, k2.number, { by: 'mara' }).ok, true);
    const real = projects.mutate;
    let calls = 0;
    projects.mutate = (...args) => { calls += 1; if (calls === 3) throw new Error('the disk is full'); return real(...args); };
    let r;
    try { r = await (label === 'Mac' ? mac : win)(['task', 'close', projectId, String(top.number), '--with-built']); } finally { projects.mutate = real; }
    assert.match(r.text, new RegExp('Its built subtasks closed with it: ' + k1.number + '\\.'), r.text);
    assert.match(r.text, new RegExp('Its built subtasks are still open: ' + k2.number + '\\.'), r.text);
    assert.match(r.text, /Kosmos stopped closing them: the disk is full\./, r.text);
  });
}

test('kosmos#7514: an agent on the parent and on a closed subtask is told once', async () => {
  const top = tasks.create(projectId, { sentence: 'Both round', who: 'mara' });
  const kid = tasks.create(projectId, { sentence: 'Both seat', parent: top.number, who: 'mara' });
  assert.equal(tasks.setBuilt(projectId, kid.number, { by: 'mara' }).ok, true);
  const told = [];
  const real = projects.syncAgent;
  projects.syncAgent = (name, roster) => { told.push(name); return real(name, roster); };
  try { await post(top.number, { withBuilt: true }); } finally { projects.syncAgent = real; }
  assert.equal(told.filter((x) => x === 'mara').length, 1, 'told ' + JSON.stringify(told));
});

for (const [name, run] of [['Windows', (a) => win(a)], ['Mac', (a) => mac(a)]]) {
  test(`kosmos#7514: the ${name} command does not hint at a subtask the same command closes`, async () => {
    const r = round(name + 'Same');
    const res = await run(['task', 'close', projectId, String(r.top), String(r.kid)]);
    assert.equal(res.code, 0, res.text);
    assert.doesNotMatch(res.text, /still has built subtasks open/, 'hinted at a subtask closed in the same command: ' + res.text);
    assert.equal(isDone(r.kid), true);
  });
}
