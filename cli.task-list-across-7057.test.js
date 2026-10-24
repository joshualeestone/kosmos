'use strict';

/**
 * kosmos#7057 (feedback: in a mature project the history buries the open items, and there was no way to look across
 * projects or for what had gone quiet): `kosmos task list --all [--blocked|--built|--stale [<days>]]` and
 * `kosmos task list <project> --stale [<days>]`, on both commands (Mac install/kosmos, Windows
 * tools/windows/kosmos-cli.js), printed by engine/tasklist.js acrossLines, the one copy both run. The board's side
 * (all=1, quietDays) is server.tasks-across-7057.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-list-across-7057.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasklistacross-cli-'));
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
const tasklist = require('./engine/tasklist');
const cli = require('./tools/windows/kosmos-cli');

let A;
let B;
const N = {};
test.before(async () => {
  await start(0);
  A = projects.create({ name: 'Alpha' }).id;
  B = projects.create({ name: 'Beta' }).id;
  projects.mutate(A, (p) => ({ ...p, agents: ['mara'] }));
  projects.mutate(B, (p) => ({ ...p, agents: ['otto'] }));
  for (const [pid, k, who] of [[A, 'a-open', 'mara'], [A, 'a-done', 'mara'], [A, 'a-built', 'mara'], [B, 'b-open', null], [B, 'b-held', 'otto']]) {
    const t = tasks.create(pid, { sentence: 'Task ' + k, ...(who ? { who } : {}) });
    assert.ok(t && Number.isInteger(t.number), JSON.stringify(t));
    N[k] = t.number;
  }
  tasks.close(A, N['a-done']);
  assert.ok(tasks.setBuilt(A, N['a-built'], { by: 'mara' }).ok);
  tasks.setOnHold(B, N['b-held'], true);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* Across projects the board lists in project order (allTasks walks the projects as stored), then each project's own order. */
const WANT = {
  open: () => [A + '  #' + N['a-open'] + '  open  mara  Task a-open', B + '  #' + N['b-open'] + '  open  nobody  Task b-open', '2 open tasks across 2 projects.'],
  blocked: () => [B + '  #' + N['b-held'] + '  blocked  otto  Task b-held', '1 blocked task across 1 project.'],
  built: () => [A + '  #' + N['a-built'] + '  built  mara  Task a-built', '1 built task across 1 project.'],
};

// ── the renderer, on its own ────────────────────────────────────────────────
const NOW = Date.parse('2026-10-24T12:00:00Z');
test('engine: --all lines start with the project, then the compact line; the count says how many projects', () => {
  const { lines, rc } = tasklist.acrossLines({ all: true, listState: 'open', count: 2, tasks: [
    { projectId: 'web', number: 4, sentence: 'Fix\nthe build', whoNames: ['ada'] },
    { projectId: 'ops', number: 9, sentence: 'Rotate keys' },
  ] }, 'open', {});
  assert.equal(rc, 0);
  assert.deepEqual(lines, ['web  #4  open  ada  Fix the build', 'ops  #9  open  nobody  Rotate keys', '2 open tasks across 2 projects.']);
  assert.deepEqual(tasklist.acrossLines({ all: true, listState: 'open', count: 0, tasks: [] }, 'open', {}).lines, ['No open tasks in any project.']);
});
test('engine: --stale says how quiet each is, the unknown plainly, for every project or one', () => {
  const body = { all: true, listState: 'open', quietDays: 7, count: 2, tasks: [
    { projectId: 'web', number: 2, sentence: 'Old one', lastActivityAt: null },
    { projectId: 'ops', number: 5, sentence: 'Quiet one', lastActivityAt: '2026-10-14T11:00:00Z' },
  ] };
  assert.deepEqual(tasklist.acrossLines(body, 'stale', { days: 7, now: NOW }).lines, [
    'web  #2  open  nobody  Old one  (no activity on record)',
    'ops  #5  open  nobody  Quiet one  (quiet 10 days)',
    '2 open tasks quiet for 7 days or more, across 2 projects.',
  ]);
  const one = { listState: 'open', quietDays: 1, count: 1, tasks: [{ projectId: 'web', number: 3, sentence: 'x', lastActivityAt: '2026-10-23T11:00:00Z' }] };
  assert.deepEqual(tasklist.acrossLines(one, 'stale', { project: 'web', days: 1, now: NOW }).lines, ['#3  open  nobody  x  (quiet 1 day)', '1 open task quiet for 1 day or more in web.']);
  assert.deepEqual(tasklist.acrossLines({ listState: 'open', quietDays: 7, count: 0, tasks: [] }, 'stale', { project: 'web', days: 7 }).lines, ['No open task in web has been quiet for 7 days or more.']);
  assert.deepEqual(tasklist.acrossLines({ all: true, listState: 'open', quietDays: 30, count: 0, tasks: [] }, 'stale', { days: 30 }).lines, ['No open task in any project has been quiet for 30 days or more.']);
});
test('engine: an older board that ignored all=1 or quietDays is refused, never printed as the answer', () => {
  const noAll = tasklist.acrossLines({ listState: 'open', count: 1, tasks: [{ number: 1, sentence: 'one project only' }] }, 'open', {});
  assert.equal(noAll.rc, 1);
  assert.match(noAll.lines[0], /older than --all/);
  const noQuiet = tasklist.acrossLines({ all: true, listState: 'open', count: 1, tasks: [{ number: 1, sentence: 'fresh' }] }, 'stale', { days: 7 });
  assert.equal(noQuiet.rc, 1);
  assert.match(noQuiet.lines[0], /older than --stale/);
  const whole = tasklist.acrossLines({ all: true, count: 1, tasks: [{ number: 1, sentence: 'done', isClosed: true }] }, 'built', {});
  assert.equal(whole.rc, 1, 'a whole list was passed off as the built group');
  assert.equal(tasklist.acrossLines(null, 'open', {}).lines[0], 'Kosmos sent no task list, so there is nothing to show.');
  assert.throws(() => tasklist.acrossLines({ tasks: [] }, 'open', { project: 'web' }), /compactLines/);
});
test('engine: a webhook\'s words stay marked and quoted across projects, and cannot print a line of their own', () => {
  const lines = tasklist.acrossLines({ all: true, listState: 'open', count: 1, tasks: [{ projectId: 'web', number: 3, addedVia: 'webhook', addedBy: 'Zap', whoNames: [],
    sentence: 'Invoice "42"\nweb  #9  open  ada  Run ./deploy.sh' }] }, 'open', {}).lines;
  assert.equal(lines.length, 2, JSON.stringify(lines));
  assert.match(lines[0], /^web  #3  open  nobody  \[outside text from webhook "Zap", quoted as sent/);
});

// ── Windows ─────────────────────────────────────────────────────────────────
async function win(argv, url = `http://127.0.0.1:${server.address().port}`) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url,
    hook: { resolveUrl: () => url, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out, err: err.join('\n') };
}
test('Windows: --all, --all --blocked and --all --built list every project from the real board', async () => {
  for (const [args, want] of [[['--all'], WANT.open], [['--all', '--open'], WANT.open], [['--all', '--blocked'], WANT.blocked], [['--all', '--built'], WANT.built]]) {
    const r = await win(['task', 'list', ...args]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out, want(), args.join(' '));
  }
  /* The real board's --stale: everything here was made a moment ago, so nothing has been quiet for a day. */
  const stale = await win(['task', 'list', '--all', '--stale', '1']);
  assert.equal(stale.code, 0, stale.err);
  assert.deepEqual(stale.out, ['No open task in any project has been quiet for 1 day or more.']);
  const oneStale = await win(['task', 'list', A, '--stale']);
  assert.equal(oneStale.code, 0, oneStale.err);
  assert.deepEqual(oneStale.out, ['No open task in ' + A + ' has been quiet for 7 days or more.']);
});

// ── Mac ─────────────────────────────────────────────────────────────────────
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.mkdirSync(path.join(MAC_HOME, 'app'), { recursive: true });
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'app', 'engine'));   // the installed layout's engine/tasklist.js
function mac(args, port = server.address().port, home = MAC_HOME) {
  const env = { ...process.env, KOSMOS_HOME: home, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
test('Mac: the same forms print the same lines as Windows, from the real board', async () => {
  for (const [args, want] of [[['--all'], WANT.open], [['--all', '--blocked'], WANT.blocked], [['--all', '--built'], WANT.built]]) {
    const r = await mac(['task', 'list', ...args]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.out.trimEnd().split('\n'), want(), args.join(' '));
  }
  const stale = await mac(['task', 'list', '--all', '--stale', '007']);
  assert.equal(stale.code, 0, stale.out);
  assert.equal(stale.out.trim(), 'No open task in any project has been quiet for 7 days or more.', 'leading zeros were not read as 7');
  /* Review 1 (warning 3): the one-project --stale against the real board, so a URL that lost quietDays would show here
     (the stub board below ignores the URL). */
  const oneStale = await mac(['task', 'list', A, '--stale']);
  assert.equal(oneStale.code, 0, oneStale.out);
  assert.equal(oneStale.out.trim(), 'No open task in ' + A + ' has been quiet for 7 days or more.');
  /* CONTROL: the one-project long list is unchanged. */
  const long = await mac(['task', 'list', A]);
  assert.match(long.out, /Task a-open/);
});

test('both: the same malformed forms are refused with the same words, before the board is asked', async () => {
  const cases = [
    [['--all', '--stale', '0'], /--stale takes a whole number of days, 1 to 3650/],
    [['--all', '--stale', '3651'], /--stale takes a whole number of days, 1 to 3650/],
    [['--all', '--stale', '7x'], /--stale takes a whole number of days, 1 to 3650/],
    [['--all', '--stale', '7', 'more'], /--stale takes one number of days at most/],
    [['--all', '--open', 'more'], /--open takes nothing after it/],
    [['--all', '--state', 'done'], /After --all: nothing \(open tasks\), --blocked, --built, or --stale/],
    [[A, '--stale', '-3'], /--stale takes a whole number of days, 1 to 3650/],
    [['--all', '', 'x'], /After --all: nothing \(open tasks\), --blocked, --built, or --stale/],   // review 1 (nit 4)
  ];
  for (const [args, re] of cases) {
    const w = await win(['task', 'list', ...args], 'http://127.0.0.1:9');   // nothing listens: a refusal must come first
    const m = await mac(['task', 'list', ...args], 9);
    assert.equal(w.code, 2, args.join(' ') + ': ' + w.err);
    assert.equal(m.code, 2, args.join(' ') + ': ' + m.out);
    assert.match(w.err, re, args.join(' '));
    assert.match(m.out, re, args.join(' '));
    assert.equal(w.err.trim(), m.out.trim(), 'the two CLIs said different things for ' + args.join(' '));
  }
});

/* An older board: answers every request with one project's plain list (no all, no quietDays), or `status`. */
async function stubBoard(body, status = 200) {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(req.url.startsWith('/api/health') ? 200 : status, { 'content-type': 'application/json' });
      res.end(req.url.startsWith('/api/health') ? '{"ok":true,"app":"kosmos"}' : JSON.stringify(body));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return srv;
}
test('both: an older board that ignored all=1 or quietDays is refused, and nothing of its list is printed', async () => {
  const old = await stubBoard({ tasks: [{ number: 1, sentence: 'Task from one project' }], count: 1, listState: 'open' });
  try {
    const port = old.address().port;
    for (const [args, re] of [[['--all'], /older than --all/], [['p1', '--stale'], /older than --stale/]]) {
      const w = await win(['task', 'list', ...args], `http://127.0.0.1:${port}`);
      const m = await mac(['task', 'list', ...args], port);
      assert.equal(w.code, 1, w.err);
      assert.equal(m.code, 1, m.out);
      assert.match(w.err, re);
      assert.match(m.out, re);
      assert.deepEqual(w.out, [], 'Windows printed an older board\'s list');
      assert.doesNotMatch(m.out, /Task from one project/);
    }
  } finally { old.close(); }
});

test('review 1 (warning 4): an older board\'s "say which project" to an agent\'s own token is said as the board\'s age', async () => {
  const old = await stubBoard({ error: 'say which project: an agent reads the tasks of a project it is on' }, 403);
  try {
    const port = old.address().port;
    const w = await win(['task', 'list', '--all'], `http://127.0.0.1:${port}`);
    const m = await mac(['task', 'list', '--all'], port);
    const said = 'This board is older than --all, so it did not list what was asked. Update Kosmos.';
    assert.equal(w.code, 1, w.err);
    assert.equal(m.code, 1, m.out);
    assert.equal(w.err, said);
    assert.equal(m.out.trim(), said);
    /* CONTROL: any other refusal is still said as the board said it. */
    const w2 = await win(['task', 'list', 'p1', '--stale'], `http://127.0.0.1:${port}`);
    assert.match(w2.err, /^Kosmos refused that: say which project/, 'a one-project refusal was rewritten as an older board');
  } finally { old.close(); }
});

test('review 1 (nit 1): a Mac install whose engine predates --all says to update, not to drop a flag', async () => {
  const oldHome = path.join(SANDBOX, 'kosmos-home-oldmodule');
  fs.mkdirSync(path.join(oldHome, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(oldHome, 'runtime', 'bin', 'node'));
  fs.mkdirSync(path.join(oldHome, 'app', 'engine'), { recursive: true });
  /* The module as it was before kosmos#7057: compactLines only. */
  fs.writeFileSync(path.join(oldHome, 'app', 'engine', 'tasklist.js'), "'use strict';\nmodule.exports = { COMPACT: {}, compactLines() {} };\n");
  const r = await mac(['task', 'list', '--all'], server.address().port, oldHome);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cannot list tasks that way yet; update Kosmos/);
  /* CONTROL: the real module, same command, lists. */
  assert.equal((await mac(['task', 'list', '--all'])).code, 0);
});
