'use strict';
/**
 * kosmos#6506: `kosmos handoff`, an agent's read of the FACTS for its handoff (its live
 * self-report state, a sha256 for each artifact path it names, when its instruction file
 * last changed, and whether the folder is a git repository). Facts only: it writes nothing
 * and changes no state. Three facts are local; the open-tasks fact (ruling 3) is one board call to
 * GET /api/tasks/mine, and an unreachable board reads "the board did not answer", never an empty
 * list. The engine that does the measuring is
 * engine/handoff.js (unit tests in engine/handoff.test.js); this holds the Mac CLI
 * plumbing. The Windows twin is held to the same verb by tools.windows-kosmos-cli-verbs-parity.
 *
 * ASYNC child processes and the 20s wall-clock kill, as cli.accounts-5359.test.js.
 */
require('./test-support/tmpscope');   // #4273: first, so every temp dir here is contained and removed
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

/* A stub board for the one board call the handoff makes (GET /api/tasks/mine). In a source checkout
   the #1765 board-proof is skipped (not the installed layout), so kosmos_curl reaches this directly.
   The default health page contains "Kosmos" like the other CLI test stubs. */
function withStub(answers, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const a = answers[req.method + ' ' + req.url.split('?')[0]];
      if (a) { res.writeHead(a.status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(a.json)); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-handoff-data-'));
const WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-handoff-workers-'));
process.on('exit', () => { for (const d of [DATA, WORKERS]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;

const instructions = require('./engine/instructions');
const selfreport = require('./engine/selfreport');

const CLI = path.join(__dirname, 'install', 'kosmos');
const SESSION = 'handoffcli';

/* A concrete self-report and instruction file, so the facts are deterministic. */
selfreport.record(SESSION, { state: 'working', because: 'writing the handoff' });
const INSTR = instructions.fileFor(SESSION);
assert.ok(INSTR && INSTR.startsWith(WORKERS + path.sep), 'the instruction file must resolve inside the sandbox, got ' + INSTR);
fs.mkdirSync(path.dirname(INSTR), { recursive: true });
fs.writeFileSync(INSTR, '# ' + SESSION + '\n\ninstructions\n');

/* A git repo and a non-git folder to point the command's cwd at. */
function git(dir, args) { execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'ignore', 'ignore'] }); }
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-handoff-repo-'));
git(REPO, ['init', '-q', '-b', 'main']);
git(REPO, ['config', 'user.email', 't@example.com']);
git(REPO, ['config', 'user.name', 'Tester']);
git(REPO, ['config', 'commit.gpgsign', 'false']);
fs.writeFileSync(path.join(REPO, 'f.txt'), 'x');
git(REPO, ['add', '.']);
git(REPO, ['commit', '-q', '-m', 'first']);
const NONGIT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-handoff-nongit-'));

function cli(args, { cwd = REPO, env: extra = {}, keepToken = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, AGENT_WORKFORCE_WORKERS: WORKERS, KOSMOS_AGENT_SESSION: SESSION, KOSMOS_PORT: '9', ...extra };
    if (!keepToken) delete env.KOSMOS_AGENT_TOKEN;   // keepToken: a test that sets KOSMOS_AGENT_TOKEN to check it is sent as a header
    // Force the CLI to resolve its engine from this repo, not a real install that might be on this box
    // and not yet carry engine/handoff.js: with KOSMOS_HOME unset, install/kosmos derives it from its own path.
    if (!('KOSMOS_HOME' in extra)) delete env.KOSMOS_HOME;
    const child = spawn(CLI, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out };
      /* #3628: a killed CLI has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '): killed by the 20s limit. ' + out)); return; }
      resolve(r);
    });
  });
}

test('#6506: kosmos handoff prints the shared contract and all four facts, and exits 0', async () => {
  const r = await cli(['handoff']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /## What a handoff must cover/, r.out);
  assert.match(r.out, /- current branch and sha/, 'the shared contract bullets must be printed');
  assert.match(r.out, /## Prefilled facts/, r.out);
  assert.match(r.out, /branch `main` at `[0-9a-f]{40}`/, 'git fact (cwd is a repo)');
  assert.match(r.out, /Live state \(self-report\): working/, 'state fact');
  assert.match(r.out, /Instruction file .*: last changed /, 'instruction fact');
  assert.match(r.out, /Paste into: .*[/\\]handoffs[/\\]handoffcli\.md/, 'names the per-agent handoff file');
});

test('#6506: a cwd that is not a repo reads "not a git repository"', async () => {
  const r = await cli(['handoff'], { cwd: NONGIT });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Branch and sha .*: not a git repository/, r.out);
});

test('#6506: named artifacts are fingerprinted, with a missing one and a path with spaces both honest', async () => {
  const spaced = path.join(NONGIT, 'a file with spaces.txt');
  fs.writeFileSync(spaced, 'payload');
  const r = await cli(['handoff', spaced, path.join(NONGIT, 'gone.bin')]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /a file with spaces\.txt`: sha256:[0-9a-f]{64}/, 'a path with spaces must fingerprint, not split');
  assert.match(r.out, /gone\.bin`: missing \(no such file\)/, 'a missing path is said as missing');
});

test('#6506: kosmos handoff --help prints its usage and does not gather the facts', async () => {
  const r = await cli(['handoff', '--help']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Usage: kosmos handoff /m);
  assert.doesNotMatch(r.out, /## Prefilled facts/, '--help must not gather the facts');
});

test('#6506: an install missing its handoff reader says so, with no stack trace, and never pretends', async () => {
  const HOME_NO_ENGINE = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-handoff-noengine-'));
  try {
    const r = await cli(['handoff'], { env: { KOSMOS_HOME: HOME_NO_ENGINE } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /could not find its own handoff reader; this install looks incomplete\./);
    assert.doesNotMatch(r.out, /at Module|Error:|kosmos-handoff-noengine-/, 'no stack trace or path leaked');
  } finally { fs.rmSync(HOME_NO_ENGINE, { recursive: true, force: true }); }
});

test('#6506: with no session (a fresh pane) the facts say so rather than guessing, and no handoff path is named', async () => {
  const r = await cli(['handoff'], { env: { KOSMOS_AGENT_SESSION: '' } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Live state \(self-report\): cannot tell which agent this is \(no session\)/, r.out);
  assert.match(r.out, /Instruction file: cannot tell which agent this is \(no session\)/, r.out);
  assert.doesNotMatch(r.out, /Paste into:/, 'no session means no handoff path to name');
});

test('#6506: a directory named as an artifact is said as a directory, not hashed', async () => {
  const r = await cli(['handoff', NONGIT], { cwd: NONGIT });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /`: is a directory, not a file/, r.out);
});

test('#6506 ruling 3: a reachable board makes the handoff list the agent\'s open tasks', async () => {
  await withStub({
    'GET /api/tasks/mine': { status: 200, json: { tasks: [{ project: 'Kosmos Inside Out', number: 4, title: 'ship the thing' }], count: 1 } },
  }, async (port) => {
    const r = await cli(['handoff'], { env: { KOSMOS_PORT: String(port) } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Open tasks assigned to you/, r.out);
    assert.match(r.out, /Kosmos Inside Out #4: ship the thing/, r.out);
  });
});

test('#6506 ruling 3: the agent token is sent to the board as a header, never on the command line', async () => {
  await withStub({
    'GET /api/tasks/mine': { status: 200, json: { tasks: [], count: 0 } },
  }, async (port, seen) => {
    const r = await cli(['handoff'], { env: { KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: 'a'.repeat(64) }, keepToken: true });
    assert.equal(r.code, 0, r.out);
    const q = seen.find((x) => x.url.split('?')[0] === '/api/tasks/mine');
    assert.ok(q, 'the board was not asked for the agent\'s tasks');
    assert.equal(q.headers['x-kosmos-agent-token'], 'a'.repeat(64), 'the agent token did not reach the board as a header (kosmos_curl keeps it off argv in a mode-600 header file)');
  });
});

test('#6506 ruling 3: an unreachable board makes the task line say so, never an empty list', async () => {
  // A port nothing listens on: taken from a stub that is then closed (as cli.accounts does).
  const port = await new Promise((resolve) => { const sv = http.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
  const r = await cli(['handoff'], { env: { KOSMOS_PORT: String(port) } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Open tasks assigned to you.*: the board did not answer/, r.out);
  assert.doesNotMatch(r.out, /Open tasks assigned to you.*: none open/, 'unreachable must not read as none open');
});
