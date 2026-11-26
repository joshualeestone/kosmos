'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

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
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378

let A;
let B;
const N = {};
/* kosmos#8577 nit: the tasks are made at setup, so a run that crosses local midnight sees them as yesterday's. The
   expected word follows the calendar day the setup ran on, never a fixed "today". */
let SET_AT = Date.now();
const ACT = () => (new Date(SET_AT).toDateString() === new Date().toDateString() ? 'last activity today' : 'last activity yesterday');
test.before(async () => {
  SET_AT = Date.now();
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
  // kosmos#8576: a board this new sends lastActivityAt on every all=1 row, so each row says when it last moved.
  open: () => [A + '  #' + N['a-open'] + '  open  mara  Task a-open  (' + ACT() + ')', B + '  #' + N['b-open'] + '  open  nobody  Task b-open  (' + ACT() + ')', '2 open tasks across 2 projects.'],
  blocked: () => [B + '  #' + N['b-held'] + '  blocked  otto  Task b-held  (' + ACT() + ')', '1 blocked task across 1 project.'],
  built: () => [A + '  #' + N['a-built'] + '  built  mara  Task a-built  (' + ACT() + '; waits on a review and close)  (not seen by the person since built)', '1 built task across 1 project.'],
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
/* kosmos#8917 (feedback): `--all --state <group>` was refused although the per-project form takes it. It now lists what
   --open, --built and --blocked list, on both CLIs, from the real board. */
test('kosmos#8917: --all --state open|built|held lists what --open, --built and --blocked list, on both CLIs', async () => {
  for (const [group, want] of [['open', WANT.open], ['built', WANT.built], ['held', WANT.blocked]]) {
    const w = await win(['task', 'list', '--all', '--state', group]);
    assert.equal(w.code, 0, w.err);
    assert.deepEqual(w.out, want(), 'Windows --all --state ' + group);
    if (!SKIP_POSIX_SHELL) {
      const m = await mac(['task', 'list', '--all', '--state', group]);
      assert.equal(m.code, 0, m.out);
      assert.deepEqual(m.out.trimEnd().split('\n'), want(), 'Mac --all --state ' + group);
    }
  }
});

test('Mac: the same forms print the same lines as Windows, from the real board', { skip: SKIP_POSIX_SHELL }, async () => {
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
    // kosmos#8917: --all reads --state open|built|held; done has no --all group, and says where a project's done tasks are.
    [['--all', '--state', 'done'], /--all lists the work still to be closed, so it has no done group\. A project's done tasks: kosmos task list <project-id> --state done/],
    [['--all', '--state', 'later'], /--state after --all takes one of: open, built, held\./],
    // #8917 review 1: words after the group are refused in the words typed, never as --blocked; and with --mine and no
    // agent token both CLIs refuse the token first, so the same input gets the same words.
    [['--all', '--state', 'held', '--stale', '3'], /--state held takes nothing after it: kosmos task list --all --state held/],
    [['--mine', '--state', 'done'], /--mine lists an agent's own tasks, so it needs an agent's token/],
    [[A, '--stale', '-3'], /--stale takes a whole number of days, 1 to 3650/],
    [['--all', '', 'x'], /After --all: nothing \(open tasks\), --blocked, --built, --state open\|built\|held, or --stale/],   // review 1 (nit 4); #8917
  ];
  for (const [args, re] of cases) {
    const w = await win(['task', 'list', ...args], 'http://127.0.0.1:9');   // nothing listens: a refusal must come first
    assert.equal(w.code, 2, args.join(' ') + ': ' + w.err);
    assert.match(w.err, re, args.join(' '));
    // kosmos#8378: on Windows the Mac CLI runs by its shebang line, which Windows cannot do, so only the Windows CLI is read there.
    if (!SKIP_POSIX_SHELL) {
      const m = await mac(['task', 'list', ...args], 9);
      assert.equal(m.code, 2, args.join(' ') + ': ' + m.out);
      assert.match(m.out, re, args.join(' '));
      assert.equal(w.err.trim(), m.out.trim(), 'the two CLIs said different things for ' + args.join(' '));
    }
  }
});

/* #8917 review 1: with an agent's token, the --state refusals name the form the agent typed (--mine, <project> --mine),
   never --all, on both CLIs. Nothing listens at the URL: each is refused before the board is asked. */
test('kosmos#8917: with an agent token, --state refusals name the form typed, the same on both CLIs', async () => {
  const TOKEN = 'ab'.repeat(16);
  const winTok = async (argv) => {
    const out = []; const err = []; const url = 'http://127.0.0.1:9';
    const code = await cli.main(argv, { env: {}, url, hook: { resolveUrl: () => url, readBoardToken: () => null, agentToken: () => TOKEN },
      out: (x) => out.push(x), err: (x) => err.push(x) });
    return { code, err: err.join('\n') };
  };
  const macTok = (args) => new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: '9', TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: TOKEN };
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (e, so, se) => {
      if (e && typeof e.code !== 'number') { reject(new Error(se || String(e.signal))); return; }
      resolve({ code: e ? e.code : 0, out: (so || '') + (se || '') });
    });
  });
  for (const [args, re] of [
    [['--mine', '--state', 'done'], /^--mine lists the work still to be closed, so it has no done group/],
    [['--all', '--mine', '--state', 'later'], /^--state after --all --mine takes one of: open, built, held\./],
    [['p1', '--mine', '--state', 'done'], /^<project-id> --mine lists the work still to be closed/],
  ]) {
    const w = await winTok(['task', 'list', ...args]);
    assert.equal(w.code, 2, args.join(' ') + ': ' + w.err);
    assert.match(w.err.trim(), re, args.join(' '));
    if (!SKIP_POSIX_SHELL) {
      const m = await macTok(['task', 'list', ...args]);
      assert.equal(m.code, 2, args.join(' ') + ': ' + m.out);
      assert.equal(m.out.trim(), w.err.trim(), 'the two CLIs said different things for ' + args.join(' '));
    }
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
      assert.equal(w.code, 1, w.err);
      assert.match(w.err, re);
      assert.deepEqual(w.out, [], 'Windows printed an older board\'s list');
      // kosmos#8378: on Windows the Mac CLI runs by its shebang line, which Windows cannot do, so only the Windows CLI is read there.
      if (!SKIP_POSIX_SHELL) {
        const m = await mac(['task', 'list', ...args], port);
        assert.equal(m.code, 1, m.out);
        assert.match(m.out, re);
        assert.doesNotMatch(m.out, /Task from one project/);
      }
    }
  } finally { old.close(); }
});

test('review 1 (warning 4): an older board\'s "say which project" to an agent\'s own token is said as the board\'s age', async () => {
  const old = await stubBoard({ error: 'say which project: an agent reads the tasks of a project it is on' }, 403);
  try {
    const port = old.address().port;
    const w = await win(['task', 'list', '--all'], `http://127.0.0.1:${port}`);
    const said = 'This board is older than --all, so it did not list what was asked. Update Kosmos.';
    assert.equal(w.code, 1, w.err);
    assert.equal(w.err, said);
    // kosmos#8378: on Windows the Mac CLI runs by its shebang line, which Windows cannot do, so only the Windows CLI is read there.
    if (!SKIP_POSIX_SHELL) {
      const m = await mac(['task', 'list', '--all'], port);
      assert.equal(m.code, 1, m.out);
      assert.equal(m.out.trim(), said);
    }
    /* CONTROL: any other refusal is still said as the board said it. */
    const w2 = await win(['task', 'list', 'p1', '--stale'], `http://127.0.0.1:${port}`);
    assert.match(w2.err, /^Kosmos refused that: say which project/, 'a one-project refusal was rewritten as an older board');
  } finally { old.close(); }
});

test('review 1 (nit 1): a Mac install whose engine predates --all says to update, not to drop a flag', { skip: SKIP_POSIX_SHELL }, async () => {
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

/* kosmos#8576: a hold whose reopening condition is already met says so on --all --blocked, from the real board's
   holdUntilMet. Its own project, made last, so the shared WANT lists above are untouched. */
test('kosmos#8576: a hold until a task that has since closed says its condition is met, from the real board', async () => {
  const C = projects.create({ name: 'Gamma 8576' }).id;
  projects.mutate(C, (p) => ({ ...p, agents: ['otto'] }));
  const first = tasks.create(C, { sentence: 'First', who: 'otto' });
  const held = tasks.create(C, { sentence: 'After first', who: 'otto' });
  tasks.setOnHold(C, held.number, true, { until: { task: first.number } });
  const rowOf = async () => (await win(['task', 'list', '--all', '--blocked'])).out.find((l) => l.startsWith(C + '  #' + held.number + ' '));
  assert.match(await rowOf(), new RegExp('waits on task ' + first.number + ' to close\\)$'), 'CONTROL: the task it waits on is open');
  tasks.close(C, first.number);
  assert.match(await rowOf(), /its hold's condition is met, but it is still on hold\)$/, 'the board did not say the hold\'s task had closed');
});

/* kosmos#8576: the activity read is paid only by the list (all=1 with order=state); kosmos task files --all asks with
   all=1&state=built and no order, prints none of it, and so is sent none. */
test('kosmos#8576: only the list across every project is sent lastActivityAt; the files form is not', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (q) => (await (await fetch(base + '/api/tasks?' + q, { headers: { origin: base } })).json()).tasks || [];
  const listed = await get('all=1&order=state&state=built');
  assert.ok(listed.length > 0 && listed.every((t) => Object.prototype.hasOwnProperty.call(t, 'lastActivityAt')), 'CONTROL: the list form carries it');
  const files = await get('all=1&state=built');
  assert.ok(files.length > 0, 'the files form listed nothing, so this proves nothing');
  assert.ok(files.every((t) => !Object.prototype.hasOwnProperty.call(t, 'lastActivityAt')), 'the files form paid for a read it does not print');
});

/* kosmos#8577 item 1: a registry that stores one project id twice. The rows come from every record, but the board's
   lookup for holdUntilMet keeps only the last, so a held row from the earlier record could be checked against a record
   where the task it waits on is missing (read as met). Such an id gets no answer, and the row says it waits. Last in the
   file, and the store is put back, so no other test sees the repeated id. */
test('kosmos#8577: a project id stored twice never makes a hold\'s condition read as met', async () => {
  const D = projects.create({ name: 'Delta 8577' }).id;
  projects.mutate(D, (p) => ({ ...p, agents: ['otto'] }));
  const first = tasks.create(D, { sentence: 'First', who: 'otto' });
  const held = tasks.create(D, { sentence: 'After first', who: 'otto' });
  tasks.setOnHold(D, held.number, true, { until: { task: first.number } });
  const rowOf = async () => (await win(['task', 'list', '--all', '--blocked'])).out.find((l) => l.startsWith(D + '  #' + held.number + ' '));
  assert.match(await rowOf(), new RegExp('waits on task ' + first.number + ' to close\\)$'), 'CONTROL: one record, the task it waits on is open');
  const before = projects.readAll();
  const rec = before.find((p) => p && p.id === D);
  assert.ok(rec, 'CONTROL: the project record is stored');
  try {
    // A later record with the same id, without the task the hold waits on.
    projects.writeAll([...before, { ...rec, tasks: (rec.tasks || []).filter((t) => t.number !== first.number) }]);
    assert.equal(projects.readAll().filter((p) => p && p.id === D).length, 2, 'CONTROL: the id is stored twice');
    assert.match(await rowOf(), new RegExp('waits on task ' + first.number + ' to close\\)$'), 'a repeated project id made the hold read as met');
  } finally {
    projects.writeAll(projects.readAll().filter((p, i, all) => !(p && p.id === D && all.findIndex((q) => q && q.id === D) !== i)));
  }
});
