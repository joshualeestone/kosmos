'use strict';
/* kosmos#8669: both CLIs' `kosmos task wake`: one of --pr, --branch, --file, --at or --clear goes to the board as the
   field of that name (the board reads GitHub or the file and checks it), a relative file is sent as its full path, and
   two conditions, none, a missing value or an unknown option are refused before the board is asked. The Mac CLI against
   a stub board that records every request, the Windows CLI through its main() with a fake fetch (as
   cli.task-repeat-minutes-6893.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-task-wake-'));
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-task-wake-cwd-'));
test.after(() => { for (const d of [DATA, HERE]) fs.rmSync(d, { recursive: true, force: true }); });
const AGENT = 'cd'.repeat(16);
/* A Kosmos home whose bundled node is this test's own, so the Mac CLI's node-printed answers (task list, a reply's
   words read as JSON) run as installed (as cli.agent-token-verbs-4491.test.js makes one). */
const NODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-task-wake-home-'));
fs.mkdirSync(path.join(NODE_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(NODE_HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(NODE_HOME, { recursive: true, force: true }));

function runCli(args, env, cwd) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000, cwd }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
async function withBoard(answer, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce'); return; }
      if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ app: 'kosmos' })); return; }
      hits.push({ method: req.method, url: req.url, body: raw, agentToken: req.headers['x-kosmos-agent-token'] || null });
      const [status, body] = answer(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT };
  try { return await fn(env, hits); } finally { await new Promise((r) => server.close(r)); }
}

const win = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
async function runWin(argv, answer, cwd = HERE) {
  const calls = []; const out = []; const err = [];
  const code = await win.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    cwd: () => cwd,
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'B8669', agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => { calls.push({ route: url.replace('http://127.0.0.1:1', ''), body: init.body }); const a = answer(); return { status: a.status || 200, text: async () => a.body }; },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const OK = { task: { number: 3 }, changed: true, words: 'waits for PR #12 in octo/hello to merge or close' };

test('#8669 Mac CLI: each condition goes to the board as its own field, with the agent token', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => [200, OK], async (env, hits) => {
    for (const [flag, value, field] of [['--pr', 'octo/hello#12', 'pr'], ['--branch', 'octo/hello:main', 'branch'], ['--at', '2h', 'at'], ['--file', '/tmp/x.md', 'file']]) {
      const r = await runCli(['task', 'wake', 'p1', '3', flag, value], env);
      assert.equal(r.code, 0, flag + ': ' + r.stdout + r.stderr);
      const h = hits[hits.length - 1];
      assert.equal(h.method, 'POST');
      assert.equal(h.url, '/api/project/p1/task/3/wake');
      assert.equal(h.agentToken, AGENT);
      const sent = JSON.parse(h.body);
      assert.equal(sent[field], value, flag);
      assert.deepEqual(Object.keys(sent).sort(), [field, 'from_pane'].sort(), 'only that field: ' + h.body);
    }
    const said = await runCli(['task', 'wake', 'p1', '3', '--pr', 'octo/hello#12'], env);
    assert.match(said.stdout + said.stderr, /Task 3 on p1 now waits for PR #12 in octo\/hello to merge or close\. Kosmos looks once a minute and tells its holder once when it happens\./);
    const clear = await runCli(['task', 'wake', 'p1', '3', '--clear'], env);
    assert.equal(clear.code, 0);
    assert.deepEqual(JSON.parse(hits[hits.length - 1].body), { clear: true, from_pane: '%42' });
    assert.match(clear.stdout + clear.stderr, /no longer waits for anything/);
  }));

test('#8669 Mac CLI: a relative file is sent as its full path', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => [200, OK], async (env, hits) => {
    const r = await runCli(['task', 'wake', 'p1', '3', '--file', 'notes.md'], env, HERE);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    // macOS may spell the temp folder through /private; the CLI sends the folder it is in, so compare real paths.
    assert.equal(fs.realpathSync(path.dirname(JSON.parse(hits[hits.length - 1].body).file)), fs.realpathSync(HERE));
    assert.equal(path.basename(JSON.parse(hits[hits.length - 1].body).file), 'notes.md');
  }));

test('#8669 Mac CLI: two conditions, none, a missing value and an unknown option are refused before the board', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => [200, OK], async (env, hits) => {
    const cases = [
      [['--pr', 'a/b#1', '--at', '2h'], /Say one thing to wake on/],
      [['--pr', 'a/b#1', '--clear'], /Say one thing to wake on/],
      [['--pr'], /--pr needs a value/],
      [['--pr', '--at'], /--pr needs a value, not --at/],
      [['soon'], /Say what to wake on with --pr, --branch, --file or --at/],
      [['--when', 'x'], /--when/],
    ];
    for (const [args, re] of cases) {
      const r = await runCli(['task', 'wake', 'p1', '3', ...args], env);
      assert.equal(r.code, 2, args.join(' ') + ': ' + r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, re, args.join(' '));
    }
    const tab = await runCli(['task', 'wake', 'p1', '3', '--file', '/tmp/a\tb.md'], env);
    assert.equal(tab.code, 2, 'a tab in a file name would name another file');
    assert.match(tab.stdout + tab.stderr, /Kosmos cannot watch a file whose name holds a tab or a line break/);
    const nan = await runCli(['task', 'wake', 'p1', 'three', '--at', '2h'], env);
    assert.equal(nan.code, 2);
    assert.equal(hits.filter((h) => h.url.includes('/wake')).length, 0, 'the board was never asked');
  }));

test('#8669 Mac CLI: the board\'s refusal is said in its words', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => [400, { error: 'that pull request is already merged' }], async (env) => {
    const r = await runCli(['task', 'wake', 'p1', '3', '--pr', 'octo/hello#12'], env);
    assert.equal(r.code, 1);
    assert.match(r.stdout + r.stderr, /Kosmos could not change that task: that pull request is already merged\./);
  }));

test('#8669 Windows CLI: the same fields and refusals, and a relative file sent as its full path', async () => {
  const ok = () => ({ body: JSON.stringify(OK) });
  let r = await runWin(['task', 'wake', 'p1', '3', '--pr', 'octo/hello#12'], ok);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.at(-1).route, '/api/project/p1/task/3/wake');
  assert.deepEqual(JSON.parse(r.calls.at(-1).body), { pr: 'octo/hello#12', from_pane: '' });
  assert.match(r.out, /Task 3 on p1 now waits for PR #12 in octo\/hello to merge or close\./);
  r = await runWin(['task', 'wake', 'p1', '3', '--file', 'notes.md'], ok);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.calls.at(-1).body).file, path.resolve(HERE, 'notes.md'));
  r = await runWin(['task', 'wake', 'p1', '3', '--clear'], ok);
  assert.deepEqual(JSON.parse(r.calls.at(-1).body), { clear: true, from_pane: '' });
  for (const args of [['--pr', 'a/b#1', '--at', '2h'], ['--pr'], ['soon'], ['--when', 'x']]) {
    r = await runWin(['task', 'wake', 'p1', '3', ...args], ok);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.calls.filter((c) => c.route.endsWith('/wake')).length, 0, 'never asked: ' + args.join(' '));
  }
  r = await runWin(['task', 'wake', 'p1', '3', '--pr', 'octo/hello#12'], () => ({ status: 400, body: JSON.stringify({ error: 'that pull request is already merged' }) }));
  assert.equal(r.code, 1);
  assert.match(r.err, /Kosmos could not change that task: that pull request is already merged\./);
});

test('#8669 Mac CLI: words holding a quote are said whole', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => [200, { task: { number: 3 }, changed: true, words: 'waits for say "hi".md to change' }], async (env) => {
    const r = await runCli(['task', 'wake', 'p1', '3', '--file', '/tmp/x.md'], { ...env, KOSMOS_HOME: NODE_HOME });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Task 3 on p1 now waits for say "hi"\.md to change\./, 'read as JSON with the bundled node');
    // A bare checkout has no bundled node: the plain form is used, which cannot hold the quote, so it says less.
    const bare = await runCli(['task', 'wake', 'p1', '3', '--file', '/tmp/x.md'], env);
    assert.match(bare.stdout + bare.stderr, /Task 3 on p1 now (waits for that|waits for say "hi"\.md to change)\./);
    assert.doesNotMatch(r.stdout + r.stderr, /\\"/, 'never the raw escape');
  }));

/* The list line says what a task waits for, and that it woke only until its holder has been told. */
const LIST = { tasks: [
  { number: 1, sentence: 'Waiting one', whoNames: ['ada'], wakeWords: 'waits for PR #12 in octo/hello to merge or close' },
  { number: 2, sentence: 'Woke, not told', whoNames: ['ada'], wakeMetWords: 'PR #13 in octo/hello: it was merged' },
  { number: 3, sentence: 'Woke and told', whoNames: ['ada'], wakeMetWords: 'PR #14 in octo/hello: it was merged', wakeToldAt: '2026-11-17T10:00:00Z' },
  { number: 4, sentence: 'Odd [name]', whoNames: ['ada'], wakeWords: 'waits for a] [done.md to change' },
], count: 4 };
const lineOf = (text, n) => text.split('\n').find((l) => l.startsWith('[' + n + '] ')) || '';
test('#8669 Mac CLI: task list shows the wake, and the woke mark only until the holder is told', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(() => [200, LIST], async (env) => {
    const r = await runCli(['task', 'list', 'p1'], { ...env, KOSMOS_HOME: NODE_HOME });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(lineOf(r.stdout, 1), /\[waits for PR #12 in octo\/hello to merge or close\]$/);
    assert.match(lineOf(r.stdout, 2), /\[woke: PR #13 in octo\/hello: it was merged\]$/);
    assert.doesNotMatch(lineOf(r.stdout, 3), /woke|waits/, 'told: no mark any more');
    assert.match(lineOf(r.stdout, 4), /\[waits for a done\.md to change\]$/, 'a name\'s own brackets are dropped');
  }));
test('#8669 Windows CLI: task list says the same', async () => {
  const r = await runWin(['task', 'list', 'p1'], () => ({ body: JSON.stringify(LIST) }));
  assert.equal(r.code, 0, r.err);
  assert.match(lineOf(r.out, 1), /\[waits for PR #12 in octo\/hello to merge or close\]$/);
  assert.match(lineOf(r.out, 2), /\[woke: PR #13 in octo\/hello: it was merged\]$/);
  assert.doesNotMatch(lineOf(r.out, 3), /woke|waits/);
  assert.match(lineOf(r.out, 4), /\[waits for a done\.md to change\]$/);
});
