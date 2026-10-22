'use strict';

/**
 * #6923: a task a later task replaced can be closed as "replaced by #N" from both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js) against a real board and the real task engine, and from the route itself.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-replaced-6923.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskreplaced-cli-'));
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
  projectId = projects.create({ name: 'Replaced' }).id;
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
  return { code, text: out.join('\n') + err.join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '', port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];

function openTwo(label) {
  const a = tasks.create(projectId, { sentence: 'First try ' + label, who: 'mara' }).number;
  const b = tasks.create(projectId, { sentence: 'Second try ' + label, who: 'mara' }).number;
  return [a, b];
}

test('#6923: either command closes a task as replaced by another, and the history says so', async () => {
  for (const [label, run] of BOTH) {
    const [a, b] = openTwo(label);
    const r = await run(['task', 'close', projectId, String(a), '--replaced-by', String(b)], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('Closed task ' + a + ' on ' + projectId + ' as replaced by task ' + b + '\\.'), label);
    assert.equal(isDone(a), true, label + ': not closed');
    assert.equal(taskOf(a).replacedBy, b, label + ': no link stored');
    assert.equal(taskOf(b).closedAt, null, label + ': the replacing task was touched');
    assert.ok(taskchat.read(projectId, a).some((x) => x.kind === 'closed' && x.replacedBy === b), label + ': history has no replaced line');
  }
});

test('#6923: CONTROL, a plain close from either command stores no link and says only closed', async () => {
  for (const [label, run] of BOTH) {
    const [a] = openTwo('plain ' + label);
    const r = await run(['task', 'close', projectId, String(a)], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('Closed task ' + a + ' on ' + projectId + '\\.$', 'm'), label);
    assert.equal('replacedBy' in taskOf(a), false, label);
  }
});

test('#6923: both commands refuse a missing or non-number --replaced-by, and extra words, with a usage error', async () => {
  for (const [label, run] of BOTH) {
    const [a] = openTwo('bad ' + label);
    for (const argv of [['--replaced-by'], ['--replaced-by', 'two'], ['--replaced-by', '3', 'extra'], ['--replacedby', '3']]) {
      const r = await run(['task', 'close', projectId, String(a), ...argv], token('mara'));
      assert.equal(r.code, 2, label + ' ' + argv.join(' ') + ': ' + r.text);
      assert.equal(isDone(a), false, label + ' ' + argv.join(' ') + ': it closed anyway');
    }
  }
});

test('#6923: a replacing task number with a leading zero is the same task, from either command', async () => {
  for (const [label, run] of BOTH) {
    const [a, b] = openTwo('zero ' + label);
    const r = await run(['task', 'close', projectId, String(a), '--replaced-by', '0' + b], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.equal(taskOf(a).replacedBy, b, label + ': the link is the task, not a plain close');
  }
});

test('#6923: the board refuses a replacing task that does not exist, or the task itself, and says why', async () => {
  for (const [label, run] of BOTH) {
    const [a] = openTwo('missing ' + label);
    const r = await run(['task', 'close', projectId, String(a), '--replaced-by', '999'], token('mara'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.match(r.text, /no task 999 on this project/, label);
    const self = await run(['task', 'close', projectId, String(a), '--replaced-by', String(a)], token('mara'));
    assert.match(self.text, /cannot be replaced by itself/, label);
    assert.equal(isDone(a), false, label + ': a refusal closed it');
  }
});

test('#6923: the route: no body is a plain close (older callers); a body it cannot read is refused and closes nothing', async () => {
  const [a] = openTwo('route');
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${a}/close`, { method: 'POST' });
  assert.equal(res.status, 200, await res.text());
  assert.equal(isDone(a), true);
  assert.equal('replacedBy' in taskOf(a), false);
  const [g] = openTwo('route-garbled');
  const garbled = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${g}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"replacedBy":02}' });
  assert.equal(garbled.status, 400);
  assert.match(await garbled.text(), /could not read that request, so the task was not closed/);
  assert.equal(isDone(g), false, 'a garbled replace must not close the task as done');
  for (const body of ['{"replacedby":2}', '{"replaced_by":2}', '[2]', '"2"', '2', '{"replacedBy":2,"x":1}']) {
    const r = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${g}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(r.status, 400, body);
    // #6936: a well-formed object with a key other than replacedBy is told which key a close takes.
    assert.match(await r.text(), body.startsWith('{') ? /a close takes only replacedBy/ : /could not read that request/, body);
    assert.equal(isDone(g), false, body + ': closed it anyway');
  }
  const [b, c] = openTwo('route-bad');
  const bad = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${b}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ replacedBy: true }) });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /has to be a task number/);
  assert.equal(isDone(b), false);
  void c;
});

test('#6923: kosmos task list shows a replaced task as replaced, not done, from either command', async () => {
  const [a, b] = openTwo('list');
  tasks.close(projectId, a, { replacedBy: b });
  const [c] = openTwo('list-control');
  tasks.close(projectId, c);
  for (const [label, run] of BOTH) {
    const r = await run(['task', 'list', projectId, '--state', 'done'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\[' + a + '\\] \\[replaced by ' + b + '\\] ', 'm'), label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\[' + c + '\\] \\[done\\] ', 'm'), label + ': CONTROL, a plain close still reads done');
  }
});

test('#6923: against an older board that ignores replacedBy, the command says the link was not recorded (Windows)', async () => {
  const http = require('node:http');
  const old = http.createServer((req, res) => {   // an older board: closes as done, never mentions replacedBy
    req.resume();
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ task: { number: 4, closedAt: new Date().toISOString() }, told: [] })); });
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  const oldBase = 'http://127.0.0.1:' + old.address().port;
  try {
    const out = []; const err = [];
    const code = await cli.main(['task', 'close', projectId, '4', '--replaced-by', '5'], {
      env: {}, url: oldBase,
      hook: { resolveUrl: () => oldBase, readBoardToken: () => null, agentToken: () => null },
      out: (s) => out.push(s), err: (s) => err.push(s),
    });
    assert.equal(code, 1, out.concat(err).join('\n'));
    assert.match(err.join('\n'), /did not record what replaced it/);
    assert.match(err.join('\n'), new RegExp('To undo that: kosmos task reopen ' + projectId + ' 4'), 'says how to undo the plain close');
    assert.doesNotMatch(out.join('\n'), /as replaced by task/, 'never claims a link the board did not record');
  } finally {
    old.close();
  }
});

test('#6923: against an older board that ignores replacedBy, the Mac command says the link was not recorded and how to undo it', async () => {
  const http = require('node:http');
  const [a, b] = openTwo('older-mac');
  // An older board: every request passes through to the real one, except the close, which it answers as a plain close.
  const old = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/task\/\d+\/close$/.test(req.url)) {
      req.resume();
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ task: { number: a, closedAt: new Date().toISOString() }, told: [] })); });
      return;
    }
    const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  try {
    const r = await mac(['task', 'close', projectId, String(a), '--replaced-by', String(b)], token('mara'), old.address().port);
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /did not record what replaced it/);
    assert.match(r.text, new RegExp('To undo that: kosmos task reopen ' + projectId + ' ' + a), 'says how to undo the plain close');
    assert.doesNotMatch(r.text, /as replaced by task/, 'never claims a link the board did not record');
  } finally {
    old.close();
  }
});
