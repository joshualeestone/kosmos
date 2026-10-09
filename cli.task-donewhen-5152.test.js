'use strict';
/**
 * #5152 slice 1: both CLIs carry a task's "done when". `kosmos task add ... --done "<check>"` (up to three) sends the
 * checks as `doneWhen`; `kosmos task done-when <project> <n> "<check>" ...` sets them and `--clear` takes them off;
 * `kosmos task list` prints them so an agent can read its checks back. install/kosmos runs against a stub board (the
 * cli.agent-token-verbs-4491.test.js pattern); tools/windows/kosmos-cli.js gets an injected fetch (its writes-4491
 * test's harness). Each refusal is checked to happen BEFORE any request, with a control that does reach the board.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const wincli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');

const CLI = path.join(__dirname, 'install', 'kosmos');
const BOARD = 'boardtoken5152donewhen';
const TOKEN = 'ab'.repeat(32);
const LISTED = { tasks: [
  { number: 1, projectId: 'p5152', sentence: 'Ship the page', doneWhen: ['it is live', 'the  person\nhas seen it'] },
  { number: 2, projectId: 'p5152', sentence: 'No checks yet', doneWhen: null },
] };

const homes = [];
test.after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5152-cli-'));
  homes.push(home);
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), BOARD);
  return home;
}

/* A stub board: `/` answers as Kosmos so healthy() passes, GET /api/tasks the list above, and every POST is recorded
   with its parsed body and answered as the board answers a task write. */
function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (req.method === 'GET' && route === '/api/tasks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(LISTED));
    }
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body; try { body = JSON.parse(raw); } catch { body = { unparseable: raw }; }
        seen.push({ route, body, agent: req.headers['x-kosmos-agent-token'] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ task: { number: 1, sentence: 'x', who: null } }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}
function sh(port, home, args) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: TOKEN };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(stdout) + String(stderr) });
  }));
}

async function win(argv) {
  const calls = []; const out = []; const err = [];
  const code = await wincli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '').split('?')[0];
      calls.push({ route, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, agent: init.headers['x-kosmos-agent-token'] });
      const body = init.method === 'GET' ? LISTED : { task: { number: 1, sentence: 'x', who: null } };
      return { status: 200, text: async () => JSON.stringify(body) };
    },
  });
  return { code, calls, out: out.join('\n') + '\n' + err.join('\n') };
}

/* What each CLI sends (both must agree), and the refusals each makes before any request. */
const SENDS = [
  [['task', 'add', 'p5152', 'Ship the page', '--done', 'it is live', 'more detail', '--done', 'say "it" \\ twice'],
    '/api/project/p5152/tasks', (b) => {
      assert.deepEqual(b.doneWhen, ['it is live', 'say "it" \\ twice'], 'the checks, in order, with quotes and a backslash intact');
      assert.equal(b.detail, 'more detail', 'a check leaked into the detail, or the detail was lost');
    }],
  [['task', 'add', 'p5152', 'No checks'], '/api/project/p5152/tasks', (b) => assert.equal(b.doneWhen, undefined, 'an add with no --done sent doneWhen')],
  [['task', 'done-when', 'p5152', '3', 'it is live', 'two\nlines'], '/api/project/p5152/task/3/done-when',
    (b) => assert.deepEqual(b.doneWhen, ['it is live', 'two lines'], 'a newline inside a check must become a space')],
  [['task', 'done-when', 'p5152', '3', '--', '--looks like a flag'], '/api/project/p5152/task/3/done-when',
    (b) => assert.deepEqual(b.doneWhen, ['--looks like a flag'])],
  [['task', 'done-when', 'p5152', '3', '--clear'], '/api/project/p5152/task/3/done-when', (b) => assert.equal(b.doneWhen, null)],
];
const REFUSED = [
  [['task', 'add', 'p5152', 'x', '--done', 'a', '--done', 'b', '--done', 'c', '--done', 'd'], /up to 3/],
  [['task', 'add', 'p5152', 'x', '--done'], /--done needs a check/],
  [['task', 'add', 'p5152', 'x', '--done', '--who', 'me'], /--done needs a check/],
  [['task', 'add', 'p5152', 'x', '--done=it is live'], /with a space/],
  [['task', 'done-when', 'p5152', '3'], /Usage: kosmos task done-when/],
  [['task', 'done-when', 'p5152', 'three', 'x'], /must be a number/],
  [['task', 'done-when', 'p5152', '3', 'a', 'b', 'c', 'd'], /up to 3/],
  [['task', 'done-when', 'p5152', '3', '--clear', 'a'], /takes no checks/],
  [['task', 'done-when', 'p5152', '3', ' '], /has to say something/],
  [['task', 'done-when', 'p5152', '3', 'a', '--force'], /--force/],
];

test('install/kosmos: task add --done and task done-when send the checks, with the agent token', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    for (const [args, route, check] of SENDS) {
      const before = seen.length;
      const r = await sh(port, home, args);
      assert.equal(r.code, 0, `kosmos ${args.join(' ')} failed: ${r.out}`);
      assert.equal(seen.length, before + 1, `kosmos ${args.join(' ')} did not reach the board`);
      const got = seen[seen.length - 1];
      assert.equal(got.route, route);
      assert.equal(got.body.unparseable, undefined, 'the CLI sent JSON the board cannot read: ' + got.body.unparseable);
      assert.equal(got.agent, TOKEN, 'the agent token was not presented');
      check(got.body);
    }
  });
});

test('install/kosmos: bad --done and done-when arguments are refused before any request (control: the sends above reach it)', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    for (const [args, why] of REFUSED) {
      const r = await sh(port, home, args);
      assert.equal(r.code, 2, `kosmos ${args.join(' ')} was not refused: ${r.out}`);
      assert.match(r.out, why, `kosmos ${args.join(' ')} said the wrong thing`);
    }
    assert.equal(seen.length, 0, 'a refused command still reached the board');
  });
});

test('install/kosmos: task list prints each task\'s checks on its one line, and nothing for a task with none', async () => {
  const home = makeHome();
  await withStub(async (port) => {
    const r = await sh(port, home, ['task', 'list', 'p5152']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^\[1\] Ship the page \[done when: 1\) it is live 2\) the person has seen it\]$/m);
    assert.match(r.out, /^\[2\] No checks yet$/m, 'a task with no checks printed a done-when, or the list changed shape');
  });
});

test('Windows CLI: task add --done and task done-when send the same bodies as install/kosmos', async () => {
  for (const [args, route, check] of SENDS) {
    const r = await win(args);
    assert.equal(r.code, 0, `kosmos ${args.join(' ')} failed: ${r.out}`);
    assert.equal(r.calls.length, 1, `kosmos ${args.join(' ')} did not make exactly one request`);
    assert.equal(r.calls[0].route, route);
    assert.equal(r.calls[0].method, 'POST');
    assert.equal(r.calls[0].agent, TOKEN, 'the agent token was not presented');
    check(r.calls[0].body);
  }
});

test('Windows CLI: the same arguments are refused before any request', async () => {
  for (const [args, why] of REFUSED) {
    const r = await win(args);
    assert.equal(r.code, 2, `kosmos ${args.join(' ')} was not refused: ${r.out}`);
    assert.match(r.out, why, `kosmos ${args.join(' ')} said the wrong thing`);
    assert.equal(r.calls.length, 0, `kosmos ${args.join(' ')} still reached the board`);
  }
});

test('Windows CLI: task list prints the checks as install/kosmos does', async () => {
  const r = await win(['task', 'list', 'p5152']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\[1\] Ship the page \[done when: 1\) it is live 2\) the person has seen it\]$/m);
  assert.match(r.out, /^\[2\] No checks yet$/m);
});

test('both help texts name the new verb and option', async () => {
  const shHelp = await new Promise((resolve, reject) => execFile(CLI, ['task', 'help'], { env: { ...process.env, KOSMOS_HOME: makeHome() }, timeout: 20000 }, (e, so, se) => {
    if (e && typeof e.code !== 'number') { reject(e); return; }   // #3628: a run that never ended is a failure
    resolve(String(so) + String(se));
  }));
  const winHelp = (await win(['task', 'help'])).out;
  for (const help of [shHelp, winHelp]) {
    assert.match(help, /kosmos task done-when <project-id> <task-number>/);
    assert.match(help, /--done "<check>"/);
  }
});
