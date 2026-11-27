'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#7992 item 1 (feedback: to find its own tasks an agent listed every project's and scanned past everyone else's):
 * `kosmos task list --mine [--blocked|--built|--stale [<days>]]` (also `--all --mine ...`) is the --all list kept to
 * the tasks the calling agent holds, in every project it is on. The board does the keeping (GET /api/tasks?all=1&mine=1,
 * keyed on the agent's OWN token even when the board token is sent too, as GET /api/tasks/mine is) and says so
 * (`mine: true`), so an older board that ignores mine=1 is refused rather than its whole list passed off as yours.
 * Both commands (Mac install/kosmos, Windows tools/windows/kosmos-cli.js) print through engine/tasklist.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-list-mine-7992.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasklistmine-7992-'));
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
const sendertoken = require('./engine/sendertoken');
const cli = require('./tools/windows/kosmos-cli');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378

let A; let B; let C; let D;
const N = {};
const TOK = {};
/* kosmos#8577 nit: the tasks are made at setup, so a run that crosses local midnight sees them as yesterday's. The
   expected word follows the calendar day the setup ran on, never a fixed "today". */
let SET_AT = Date.now();
const ACT = () => (new Date(SET_AT).toDateString() === new Date().toDateString() ? 'last activity today' : 'last activity yesterday');
test.before(async () => {
  SET_AT = Date.now();
  await start(0);
  A = projects.create({ name: 'Alpha' }).id;
  B = projects.create({ name: 'Beta' }).id;
  C = projects.create({ name: 'Gamma' }).id;
  D = projects.create({ name: 'Delta' }).id;   // review 1: mara's, archived below
  projects.mutate(A, (p) => ({ ...p, agents: ['mara', 'otto'] }));
  projects.mutate(B, (p) => ({ ...p, agents: ['mara'] }));
  projects.mutate(C, (p) => ({ ...p, agents: ['otto', 'mara'] }));   // mara is taken off Gamma below, keeping a task there
  projects.mutate(D, (p) => ({ ...p, agents: ['mara'] }));
  for (const [pid, k, who] of [[A, 'a-mara', 'mara'], [A, 'a-otto', 'otto'], [A, 'a-mara-ready', 'mara'], [B, 'b-mara', 'mara'], [B, 'b-nobody', null], [C, 'c-otto', 'otto'],
    [C, 'c-mara-not-on', 'mara'], [D, 'd-mara-archived', 'mara']]) {
    const t = tasks.create(pid, { sentence: 'Task ' + k, ...(who ? { who } : {}) });
    assert.ok(t && Number.isInteger(t.number), JSON.stringify(t));
    N[k] = t.number;
  }
  assert.ok(tasks.setBuilt(A, N['a-mara-ready'], { by: 'mara' }).ok);
  projects.mutate(D, (p) => ({ ...p, archived: true }));
  projects.mutate(C, (p) => ({ ...p, agents: ['otto'] }));
  for (const who of ['mara', 'otto']) {
    const m = sendertoken.mint(who);
    assert.ok(m.ok, 'could not mint ' + who + "'s token");
    TOK[who] = m.token;
  }
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const MARA_OPEN = () => [A + '  #' + N['a-mara'] + '  open  mara  Task a-mara  (' + ACT() + ')', B + '  #' + N['b-mara'] + '  open  mara  Task b-mara  (' + ACT() + ')', '2 open tasks of yours across 2 projects.'];   // kosmos#8576

// ── the renderer, on its own ────────────────────────────────────────────────
test('engine: --mine says "of yours", and an older board that ignored mine=1 is refused, never printed as yours', () => {
  const ok = tasklist.acrossLines({ all: true, mine: true, listState: 'open', count: 1, tasks: [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'] }] }, 'open', { mine: true });
  assert.equal(ok.rc, 0);
  assert.deepEqual(ok.lines, ['web  #4  open  ada  Fix it', '1 open task of yours across 1 project.']);
  assert.deepEqual(tasklist.acrossLines({ all: true, mine: true, listState: 'built', count: 0, tasks: [] }, 'built', { mine: true }).lines, ['No built tasks of yours in any project.']);
  assert.deepEqual(tasklist.acrossLines({ all: true, mine: true, listState: 'open', quietDays: 7, count: 0, tasks: [] }, 'stale', { mine: true, days: 7 }).lines, ['No open task of yours has been quiet for 7 days or more.']);
  const older = tasklist.acrossLines({ all: true, listState: 'open', count: 1, tasks: [{ projectId: 'web', number: 1, sentence: 'someone else\'s' }] }, 'open', { mine: true });
  assert.equal(older.rc, 1);
  assert.match(older.lines[0], /older than --mine/);
  // Control: the same answer without --mine is printed as the --all list it is.
  assert.equal(tasklist.acrossLines({ all: true, listState: 'open', count: 1, tasks: [{ projectId: 'web', number: 1, sentence: 'x' }] }, 'open', {}).rc, 0);
});

// ── the board ───────────────────────────────────────────────────────────────
async function get(q, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tasks?${q}`, { headers });
  return { code: res.status, json: await res.json().catch(() => null) };
}
const asAgent = (who) => ({ 'x-kosmos-agent-token': TOK[who] });
const ids = (r) => (r.json && r.json.tasks || []).map((t) => t.projectId + '#' + t.number).sort();
test('board: all=1&mine=1 keeps the calling agent\'s own tasks, in every project it is on, and says so', async () => {
  const mara = await get('all=1&order=state&state=open&mine=1', asAgent('mara'));
  assert.equal(mara.code, 200, JSON.stringify(mara.json));
  /* Review 1: a task mara holds in Gamma (a project she is not on) and one in an archived project of hers are left out:
     only the projects she is on, and never an archived one. */
  const all = (await get('order=state&state=open&project=' + C)).json;
  assert.ok((all.tasks || []).some((t) => t.number === N['c-mara-not-on']), 'premise: the task she holds in Gamma exists');
  assert.equal(mara.json.mine, true);
  assert.equal(mara.json.all, true);
  assert.deepEqual(ids(mara), [A + '#' + N['a-mara'], B + '#' + N['b-mara']].sort());
  const otto = await get('all=1&order=state&state=open&mine=1', asAgent('otto'));
  assert.deepEqual(ids(otto), [A + '#' + N['a-otto'], C + '#' + N['c-otto']].sort(), 'one agent\'s token never returns another\'s tasks');
  const built = await get('all=1&order=state&state=built&mine=1', asAgent('mara'));
  assert.deepEqual(ids(built), [A + '#' + N['a-mara-ready']]);
  // Control: all=1 on the same token, without mine, lists everyone's tasks in mara's projects (otto's and nobody's too).
  const every = await get('all=1&order=state&state=open', asAgent('mara'));
  assert.ok(ids(every).includes(A + '#' + N['a-otto']) && ids(every).includes(B + '#' + N['b-nobody']), JSON.stringify(ids(every)));
  assert.equal(every.json.mine, undefined, 'a list that is not kept to the caller does not say mine');
});
test('board: mine=1 is refused with neither all=1 nor one project, and without a token that names an agent', async () => {
  // kosmos#8867: mine=1 goes with one project= now too (next test); with neither it is still refused, never ignored.
  const neither = await get('order=state&state=open&mine=1', asAgent('mara'));
  assert.equal(neither.code, 400);
  assert.match(neither.json.error, /mine goes with all, or with one project/);
  const nobody = await get('all=1&order=state&state=open&mine=1');
  assert.equal(nobody.code, 403);
  assert.match(nobody.json.error, /could not tell which agent/);
  const unknown = await get('all=1&order=state&state=open&mine=1', { 'x-kosmos-agent-token': 'ab'.repeat(32) });
  assert.equal(unknown.code, 403);
});

// ── kosmos#8867: <project-id> --mine ───────────────────────────────────────
test('#8867 engine: one project with --mine says "of yours in" that project; none says so too', () => {
  const one = tasklist.acrossLines({ mine: true, listState: 'open', count: 1, tasks: [{ projectId: 'web', number: 4, sentence: 'Fix it', whoNames: ['ada'] }] }, 'open', { project: 'web', mine: true });
  assert.equal(one.rc, 0);
  assert.deepEqual(one.lines, ['#4  open  ada  Fix it', '1 open task of yours in web.']);
  assert.deepEqual(tasklist.acrossLines({ mine: true, listState: 'built', count: 0, tasks: [] }, 'built', { project: 'web', mine: true }).lines, ['No built tasks of yours in web.']);
  assert.deepEqual(tasklist.acrossLines({ mine: true, listState: 'open', quietDays: 3, count: 0, tasks: [] }, 'stale', { project: 'web', mine: true, days: 3 }).lines, ['No open task of yours in web has been quiet for 3 days or more.']);
  // An older board that ignored mine=1 sends everyone's: refused, never printed as yours.
  assert.match(tasklist.acrossLines({ listState: 'open', count: 1, tasks: [{ projectId: 'web', number: 1, sentence: 'x' }] }, 'open', { project: 'web', mine: true }).lines[0], /older than --mine/);
  // CONTROL: one project without --mine and without --stale is still compactLines' job here.
  assert.throws(() => tasklist.acrossLines({ listState: 'open', tasks: [] }, 'open', { project: 'web' }), /one project/);
});
test('#8867 board: project=&mine=1 keeps the caller\'s own tasks in that project, and says so', async () => {
  const mara = await get('project=' + A + '&order=state&state=open&mine=1', asAgent('mara'));
  assert.equal(mara.code, 200, JSON.stringify(mara.json));
  assert.equal(mara.json.mine, true);
  assert.deepEqual(ids(mara), [A + '#' + N['a-mara']]);
  const otto = await get('project=' + A + '&order=state&state=open&mine=1', asAgent('otto'));
  assert.deepEqual(ids(otto), [A + '#' + N['a-otto']], 'one agent\'s token never returns another\'s tasks');
  // CONTROL: the same project without mine lists everyone's open tasks there, and does not say mine.
  const every = await get('project=' + A + '&order=state&state=open', asAgent('mara'));
  assert.deepEqual(ids(every), [A + '#' + N['a-mara'], A + '#' + N['a-otto']].sort());
  assert.equal(every.json.mine, undefined);
});
test('#8867 Windows: <project> --mine lists only this agent\'s tasks there; the plain list still lists all; --mine elsewhere is refused', async () => {
  const r = await win(['task', 'list', A, '--mine'], 'mara');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out, ['#' + N['a-mara'] + '  open  mara  Task a-mara  (' + ACT() + ')', '1 open task of yours in ' + A + '.']);   // round 2: the row's note, as --mine's
  const built = await win(['task', 'list', A, '--mine', '--built'], 'mara');
  assert.equal(built.code, 0, built.err);
  assert.equal(built.out.length, 2, built.out.join('|'));
  assert.equal(built.out[1], '1 built task of yours in ' + A + '.');
  // CONTROL: the plain project list still lists otto's task too.
  const plain = await win(['task', 'list', A], 'mara');
  assert.equal(plain.code, 0, plain.err);
  assert.ok(plain.out.join('\n').includes('Task a-otto'), 'the unfiltered list lost a task: ' + plain.out.join('|'));
  for (const args of [[A, '--state', 'open', '--mine'], [A, '--stale', '--mine'], [A, '--mine', '--mine']]) {
    const bad = await win(['task', 'list', ...args], 'mara');
    assert.equal(bad.code, 2, args.join(' ') + ': ' + bad.out.join('|'));
    assert.match(bad.err, /Put --mine right after the project/, args.join(' '));
  }
  const after = await win(['task', 'list', A, '--mine', '--nope'], 'mara');
  assert.equal(after.code, 2);
  assert.match(after.err, /After <project-id> --mine: nothing/);
  const none = await win(['task', 'list', A, '--mine'], null);
  assert.equal(none.code, 2);
  assert.match(none.err, /needs an agent's token/);
  // Round 1: the forms after --mine, each filtered and said.
  const blocked = await win(['task', 'list', A, '--mine', '--blocked'], 'mara');
  assert.equal(blocked.code, 0, blocked.err);
  assert.deepEqual(blocked.out, ['No blocked tasks of yours in ' + A + '.']);
  const stale = await win(['task', 'list', A, '--mine', '--stale', '3'], 'mara');
  assert.equal(stale.code, 0, stale.err);
  assert.deepEqual(stale.out, ['No open task of yours in ' + A + ' has been quiet for 3 days or more.']);
  const order = await win(['task', 'list', '--open', '--mine'], 'mara');
  assert.equal(order.code, 2);
  assert.match(order.err, /Put --mine right after the project/, 'a flag in the project slot is the words out of order');
  const allBlocked = await win(['task', 'list', '--all', '--blocked', '--mine'], 'mara');
  assert.equal(allBlocked.code, 2);
  assert.match(allBlocked.err, /Put --mine right after the project/);
  const mineBad = await win(['task', 'list', '--mine', '--nope'], 'mara');
  assert.match(mineBad.err, /After --mine: nothing/, 'the refusal names the form typed');
  const empty = await win(['task', 'list', '', '--mine'], 'mara');
  assert.equal(empty.code, 2, 'an empty project word is refused, never read as every project');
});
test('#8867 board: an agent asking for its own tasks in a project it is not on gets none of them, and no one else\'s', async () => {
  // Mara holds a task in Gamma but is not on it (fixture). This test board answers a local call as the board itself, so
  // the token-only 403 ("not on this project") does not apply here; the mine filter (projects she is on) still keeps
  // every Gamma task out: hers and otto's alike.
  const notOn = await get('project=' + C + '&order=state&state=open&mine=1', asAgent('mara'));
  assert.equal(notOn.code, 200, JSON.stringify(notOn.json));
  assert.equal(notOn.json.mine, true);
  assert.deepEqual(ids(notOn), [], 'a task in a project she is not on was listed as hers');
  // CONTROL: the same project without mine lists Gamma's tasks, so the empty list above is the filter's doing.
  const every = await get('project=' + C + '&order=state&state=open', asAgent('mara'));
  assert.ok(ids(every).includes(C + '#' + N['c-mara-not-on']) && ids(every).includes(C + '#' + N['c-otto']), JSON.stringify(ids(every)));
});
test('#8867: against an older board, which refuses mine with one project, both CLIs say the board is older', async () => {
  const http = require('node:http');
  const OLD = 'mine goes with all: the tasks you hold in every project you are on';   // the 0.8.13 board's words
  const stub = http.createServer((req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/api/tasks')) return json(400, { error: OLD });
    return json(200, { ok: true, app: 'kosmos' });   // the health answer install/kosmos looks for
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${stub.address().port}`;
    const out = []; const err = [];
    const code = await cli.main(['task', 'list', 'alpha', '--mine'], { env: {}, url,
      hook: { resolveUrl: () => url, readBoardToken: () => null, agentToken: () => TOK.mara }, out: (x) => out.push(x), err: (x) => err.push(x) });
    assert.equal(code, 1, out.join('|'));
    assert.match(err.join('\n'), /This board is older than --mine in one project/);
    assert.deepEqual(out, [], 'nothing is printed as yours');
    if (!SKIP_POSIX_SHELL) {
      /* The Mac CLI first checks the answering board is this Kosmos and knows the token, which a stub cannot honestly
         pass; so its older-board line is run as it stands in install/kosmos (that one case line, read from the file,
         not a copy), fed the 0.8.13 board's exact words. */
      const src = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8').split('\n');
      const line = src.find((l) => l.includes('case "$_tmproj:$_xwhy" in'));
      assert.ok(line, 'FIXTURE: the older-board case line is not in install/kosmos');
      const run = (proj) => require('node:child_process').spawnSync('/bin/bash', ['-c', 'say() { printf "%s\\n" "$*"; }; ' + line.trim() + '\necho fell-through'],
        { env: { ...process.env, _tmproj: proj, _xwhy: OLD }, encoding: 'utf8' });
      const hit = run('alpha');
      assert.equal(hit.status, 1, hit.stdout + hit.stderr);
      assert.match(hit.stdout, /This board is older than --mine in one project/);
      // CONTROL: without a project (plain --mine) the same refusal is not taken for this line.
      assert.match(run('').stdout, /fell-through/);
    }
  } finally { await new Promise((r) => stub.close(r)); }
});

// ── Windows ─────────────────────────────────────────────────────────────────
async function win(argv, who) {
  const url = `http://127.0.0.1:${server.address().port}`;
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url,
    hook: { resolveUrl: () => url, readBoardToken: () => null, agentToken: () => (who ? TOK[who] : null) },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out, err: err.join('\n') };
}
test('Windows: --mine and --all --mine list only this agent\'s tasks; without an agent token it refuses before asking', async () => {
  for (const args of [['--mine'], ['--all', '--mine']]) {
    const r = await win(['task', 'list', ...args], 'mara');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out, MARA_OPEN(), args.join(' '));
  }
  const built = await win(['task', 'list', '--mine', '--built'], 'mara');
  assert.equal(built.code, 0, built.err);
  assert.deepEqual(built.out, [A + '  #' + N['a-mara-ready'] + '  built  mara  Task a-mara-ready  (' + ACT() + '; waits on a review and close)  (not seen by the person since built)', '1 built task of yours across 1 project.']);
  const none = await win(['task', 'list', '--mine'], null);
  assert.equal(none.code, 2);
  assert.match(none.err, /needs an agent's token/);
  const bad = await win(['task', 'list', '--mine', '--nope'], 'mara');
  assert.equal(bad.code, 2, 'what follows --mine is checked as what follows --all');
});

// ── Mac ─────────────────────────────────────────────────────────────────────
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.mkdirSync(path.join(MAC_HOME, 'app'), { recursive: true });
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'app', 'engine'));
function mac(args, who) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: who ? TOK[who] : '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
test('Mac: the same forms print the same lines as Windows; without an agent token it refuses before asking', async () => {
  // kosmos#8378: on Windows the Mac CLI runs by its shebang line, which Windows cannot do, so only the Windows CLI is read there.
  if (!SKIP_POSIX_SHELL) {
    for (const args of [['--mine'], ['--all', '--mine']]) {
      const r = await mac(['task', 'list', ...args], 'otto');
      assert.equal(r.code, 0, r.out);
      assert.deepEqual(r.out.trimEnd().split('\n'), [A + '  #' + N['a-otto'] + '  open  otto  Task a-otto  (' + ACT() + ')', C + '  #' + N['c-otto'] + '  open  otto  Task c-otto  (' + ACT() + ')', '2 open tasks of yours across 2 projects.'], args.join(' '));
    }
    const stale = await mac(['task', 'list', '--mine', '--stale', '3'], 'mara');
    assert.equal(stale.code, 0, stale.out);
    assert.deepEqual(stale.out.trimEnd().split('\n'), ['No open task of yours has been quiet for 3 days or more.']);
    const none = await mac(['task', 'list', '--mine'], null);
    assert.equal(none.code, 2, none.out);
    assert.match(none.out, /needs an agent's token/);
    const help = await mac(['task', 'help'], null);
    assert.match(help.out, /kosmos task list --mine/, 'the help names --mine');
    assert.match(help.out, /kosmos task list <project-id> --mine/, 'the help names the one-project form (kosmos#8867)');
  }
  if (!SKIP_POSIX_SHELL) {   // kosmos#8867: <project> --mine, as the Windows test above
    const r = await mac(['task', 'list', A, '--mine'], 'mara');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.out.trimEnd().split('\n'), ['#' + N['a-mara'] + '  open  mara  Task a-mara  (' + ACT() + ')', '1 open task of yours in ' + A + '.']);
    const mbuilt = await mac(['task', 'list', A, '--mine', '--built'], 'mara');
    assert.equal(mbuilt.code, 0, mbuilt.out);
    assert.equal(mbuilt.out.trimEnd().split('\n').pop(), '1 built task of yours in ' + A + '.');
    const order = await mac(['task', 'list', '--open', '--mine'], 'mara');
    assert.equal(order.code, 2, order.out);
    assert.match(order.out, /Put --mine right after the project/, 'a flag in the project slot is the words out of order');
    const plain = await mac(['task', 'list', A], 'mara');
    assert.equal(plain.code, 0, plain.out);
    assert.ok(plain.out.includes('Task a-otto'), 'CONTROL: the unfiltered list lost a task: ' + plain.out);
    for (const args of [[A, '--state', 'open', '--mine'], [A, '--stale', '--mine'], [A, '--mine', '--mine'], ['--all', '--blocked', '--mine']]) {
      const bad = await mac(['task', 'list', ...args], 'mara');
      assert.equal(bad.code, 2, args.join(' ') + ': ' + bad.out);
      assert.match(bad.out, /Put --mine right after the project/, args.join(' '));
    }
    const after = await mac(['task', 'list', A, '--mine', '--nope'], 'mara');
    assert.equal(after.code, 2, after.out);
    assert.match(after.out, /After <project-id> --mine: nothing/);
    const stale = await mac(['task', 'list', A, '--mine', '--stale', '3'], 'mara');
    assert.equal(stale.code, 0, stale.out);
    assert.deepEqual(stale.out.trimEnd().split('\n'), ['No open task of yours in ' + A + ' has been quiet for 3 days or more.']);
    const noTok = await mac(['task', 'list', A, '--mine'], null);
    assert.equal(noTok.code, 2, noTok.out);
    assert.match(noTok.out, /needs an agent's token/);
    const empty = await mac(['task', 'list', '', '--mine'], 'mara');
    assert.equal(empty.code, 2, 'an empty project word is refused, never read as every project: ' + empty.out);
  }
  const winHelp = await win(['task', 'help'], null);
  assert.match(winHelp.out.join('\n') + winHelp.err, /kosmos task list --mine/, 'the Windows help names --mine too');
  assert.match(winHelp.out.join('\n') + winHelp.err, /kosmos task list <project-id> --mine/, 'and the one-project form (kosmos#8867)');
});
