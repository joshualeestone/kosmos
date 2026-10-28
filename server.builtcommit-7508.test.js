'use strict';

/**
 * #7508: a code fix's built mark can name the commit it landed as. The CLI resolves the ref in the agent's own checkout
 * (full sha, the repository's shared git directory, whether a remote branch has it); the board checks the shape and
 * keeps it in its own fields, which closing keeps and a clear or a reopen drops. The person's screen mark sends none.
 * Both CLIs run against real git repositories made here, so a commit that IS in history is the control.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builtcommit-7508.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtcommit-')));
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
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const winCli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install(['mona', 'zed'].map((a) => fleet.agent(a, { state: 'idle' }))).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const a of ['mona', 'zed']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const newTask = (s) => tasks.create(projectId, { sentence: s, who: 'mona' }).number;
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = '/work/kosmos/.git';

/* A real repository: one commit, the shared git directory as the CLI reports it, and optionally a remote holding it. */
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(name, { pushed = false } = {}) {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'fix.txt'), 'the fix\n');
  git(dir, 'add', 'fix.txt');
  git(dir, 'commit', '-q', '-m', 'the fix');
  if (pushed) {
    const bare = path.join(SANDBOX, name + '-remote.git');
    git(SANDBOX, 'init', '-q', '--bare', bare);
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'fetch', '-q', 'origin');
  }
  return { dir, sha: git(dir, 'rev-parse', 'HEAD'), repo: git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir') };
}

test('engine: a commit is stored in its own fields, a bad shape is refused, and a mark without one keeps it', () => {
  const n = newTask('Fix the export');
  const bad = [{ sha: 'abc', repo: REPO, onRemote: true }, { sha: SHA, repo: 'relative/.git', onRemote: true },
    { sha: SHA, repo: REPO, onRemote: 'yes' }, { sha: SHA.toUpperCase(), repo: REPO, onRemote: true }, 'aaaa', [SHA]];
  for (const commit of bad) {
    const r = tasks.setBuilt(projectId, n, { by: 'mona', commit });
    assert.equal(r.ok, false, 'a commit of the wrong shape was taken: ' + JSON.stringify(commit));
    assert.equal(stored(n).builtAt, undefined, 'a refused commit still marked the task');
  }
  const ok = tasks.setBuilt(projectId, n, { by: 'mona', note: 'fixed', commit: { sha: SHA, repo: REPO, onRemote: false } });
  assert.equal(ok.ok, true, ok.because);
  const t = stored(n);
  assert.equal(t.landedCommit, SHA);
  assert.equal(t.landedRepo, REPO);
  assert.equal(t.landedOnRemote, false);
  assert.equal(t.landedBy, 'mona');
  assert.ok(t.landedAt, 'no time for the commit');
  // A checker's mark without --commit keeps it (it is not new work).
  assert.equal(tasks.setBuilt(projectId, n, { by: 'zed', note: 'checked' }).ok, true);
  assert.equal(stored(n).landedCommit, SHA, 'a mark without a commit dropped the recorded one');
  // Naming the commit already recorded, with the same note, is the same mark: nothing is written.
  const again = tasks.setBuilt(projectId, n, { by: 'zed', note: 'checked', commit: { sha: SHA, repo: REPO, onRemote: false } });
  assert.equal(again.changed, false, 'the same mark again wrote the store');
  // Pushed since: the same sha with a remote is a change.
  const pushed = tasks.setBuilt(projectId, n, { by: 'zed', note: 'checked', commit: { sha: SHA, repo: REPO, onRemote: true } });
  assert.equal(pushed.changed, true, 'a commit that reached a remote was not recorded as such');
  assert.equal(stored(n).landedOnRemote, true);
});

test('engine: closing keeps the commit; a reopen and a clear drop it', () => {
  const n = newTask('Fix the import');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', commit: { sha: SHA, repo: REPO, onRemote: true } }).ok, true);
  tasks.close(projectId, n);
  const closed = stored(n);
  assert.equal(closed.builtAt, undefined, 'CONTROL: closing clears the built mark');
  assert.equal(closed.landedCommit, SHA, 'closing dropped the commit, so a closed task cannot say what it landed as');
  tasks.reopen(projectId, n);
  assert.equal(stored(n).landedCommit, undefined, 'a reopen kept the old commit for new work');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', commit: { sha: OTHER, repo: REPO, onRemote: true } }).ok, true);
  assert.equal(tasks.clearBuilt(projectId, n, { by: 'mona' }).ok, true);
  assert.equal(stored(n).landedCommit, undefined, 'taking the mark off kept the commit');
});

test('route: an agent\'s mark records the commit; the screen\'s mark ignores one', async () => {
  const n = newTask('Fix the report');
  const r = await post(`/api/project/${projectId}/task/${n}/built`, { note: 'fixed', commit: { sha: SHA, repo: REPO, onRemote: true } }, asAgent('mona'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).landedCommit, SHA);
  // The Tasks page reads it from /api/tasks, where a row rides as stored.
  const list = await (await fetch(base + '/api/tasks', { headers: { origin: base } })).json();
  const rows = JSON.stringify(list);
  assert.ok(rows.includes('"landedCommit":"' + SHA + '"'), 'the Tasks page is not sent the commit');
  const bad = await post(`/api/project/${projectId}/task/${n}/built`, { note: 'fixed', commit: { sha: 'nope', repo: REPO, onRemote: true } }, asAgent('mona'));
  assert.equal(bad.status, 400, 'a commit of the wrong shape was not refused');
  const m = newTask('Fix the screen');
  const screen = await post(`/api/project/${projectId}/task/${m}/built`, { commit: { sha: SHA, repo: REPO, onRemote: true } }, { origin: base });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(stored(m).landedCommit, undefined, 'the screen\'s mark recorded a commit it cannot have resolved');
});

const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, extra = {}, cwd = undefined) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '', ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000, cwd }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `kosmos task built --commit`: a commit only here is recorded and said to be unpushed; a pushed one is not', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const tok = sendertoken.mint('mona').token;
  const local = makeRepo('mac-local');
  const n = newTask('Fix the header');
  const r = await mac(['task', 'built', projectId, String(n), 'fixed', '--commit', 'HEAD'], { KOSMOS_AGENT_TOKEN: tok }, local.dir);
  assert.equal(r.code, 0, r.out);
  assert.equal(stored(n).landedCommit, local.sha, 'the CLI sent another commit: ' + r.out);
  assert.equal(stored(n).landedRepo, local.repo);
  assert.equal(stored(n).landedOnRemote, false);
  assert.equal(stored(n).builtNote, 'fixed', 'the ref leaked into the note');
  assert.ok(r.out.includes('Recorded commit ' + local.sha.slice(0, 7) + '. It is not pushed yet: push it so it is not only on this computer.'), r.out);
  const pushed = makeRepo('mac-pushed', { pushed: true });
  const m = newTask('Fix the footer');
  const p = await mac(['task', 'built', projectId, String(m), '--commit', pushed.sha], { KOSMOS_AGENT_TOKEN: tok }, pushed.dir);
  assert.equal(p.code, 0, p.out);
  assert.equal(stored(m).landedOnRemote, true, 'a commit a remote has was recorded as local only');
  assert.ok(p.out.includes('Recorded commit ' + pushed.sha.slice(0, 7) + '.') && !p.out.includes('not pushed'), p.out);
});

test('Mac: a ref that is not a commit here, --commit with nothing, and --commit with --clear are refused before the board', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const tok = sendertoken.mint('mona').token;
  const local = makeRepo('mac-refuse');
  const n = newTask('Fix the menu');
  const missing = await mac(['task', 'built', projectId, String(n), '--commit', 'no-such-branch'], { KOSMOS_AGENT_TOKEN: tok }, local.dir);
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /cannot find that commit here: no-such-branch/);
  const outside = await mac(['task', 'built', projectId, String(n), '--commit', 'HEAD'], { KOSMOS_AGENT_TOKEN: tok }, SANDBOX);
  assert.equal(outside.code, 2, 'a folder that is no repository recorded a commit: ' + outside.out);
  const empty = await mac(['task', 'built', projectId, String(n), '--commit'], { KOSMOS_AGENT_TOKEN: tok }, local.dir);
  assert.equal(empty.code, 2, empty.out);
  assert.match(empty.out, /--commit needs the commit the fix landed as/);   // not the unknown-option refusal
  const option = await mac(['task', 'built', projectId, String(n), '--commit', '--clear'], { KOSMOS_AGENT_TOKEN: tok }, local.dir);
  assert.equal(option.code, 2, option.out);
  assert.match(option.out, /--commit needs the commit the fix landed as, for example --commit HEAD \(got --clear\)/, 'an option was read as the commit');
  const both = await mac(['task', 'built', projectId, String(n), '--clear', '--commit', 'HEAD'], { KOSMOS_AGENT_TOKEN: tok }, local.dir);
  assert.equal(both.code, 2, both.out);
  assert.match(both.out, /takes no commit/);
  assert.equal(stored(n).builtAt, undefined, 'a refused --commit still marked the task');
});

/* The Windows CLI, through its own entry point against this board, with real git run in the repository given. */
async function win(argv, cwd, gitSeam) {
  const out = [];
  const err = [];
  const code = await winCli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, KOSMOS_PORT: String(server.address().port) },
    out: (s) => out.push(s), err: (s) => err.push(s),
    git: gitSeam || ((args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
    fetch: async (url, init) => {
      const u = new URL(url);
      const res = await fetch(base + u.pathname + u.search, { method: init.method, headers: init.headers, body: init.body });
      return { status: res.status, text: async () => res.text() };
    },
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows `kosmos task built --commit`: the same commit, the same words, and the same refusals as the Mac', async () => {
  const local = makeRepo('win-local');
  const n = newTask('Fix the toolbar');
  const r = await win(['task', 'built', projectId, String(n), 'fixed', '--commit', 'HEAD'], local.dir);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(stored(n).landedCommit, local.sha);
  assert.equal(stored(n).landedOnRemote, false);
  assert.ok(r.out.includes('Recorded commit ' + local.sha.slice(0, 7) + '. It is not pushed yet: push it so it is not only on this computer.'), r.out);
  const pushed = makeRepo('win-pushed', { pushed: true });
  const m = newTask('Fix the status bar');
  const p = await win(['task', 'built', projectId, String(m), '--commit', 'HEAD'], pushed.dir);
  assert.equal(p.code, 0, p.out + p.err);
  assert.equal(stored(m).landedOnRemote, true);
  const k = newTask('Fix the dialog');
  const missing = await win(['task', 'built', projectId, String(k), '--commit', 'no-such-branch'], local.dir);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /cannot find that commit here: no-such-branch/);
  const empty = await win(['task', 'built', projectId, String(k), '--commit'], local.dir);
  assert.equal(empty.code, 2);
  assert.match(empty.err, /--commit needs the commit the fix landed as/);
  const option = await win(['task', 'built', projectId, String(k), '--commit', '--clear'], local.dir);
  assert.equal(option.code, 2);
  assert.match(option.err, /\(got --clear\)/, 'an option was read as the commit');
  const both = await win(['task', 'built', projectId, String(k), '--clear', '--commit', 'HEAD'], local.dir);
  assert.equal(both.code, 2);
  assert.match(both.err, /takes no commit/);
  assert.equal(stored(k).builtAt, undefined, 'a refused --commit still marked the task');
});

test('slice 2 route: the Tasks view checks a closed task\'s commit now: kept while the repository has it (even once its branch is gone), missing when it never did', async () => {
  const landedcheck = require('./engine/landedcheck');
  landedcheck.resetForTests();
  const r = makeRepo('route-check');
  git(r.dir, 'checkout', '-q', '-b', 'fix');
  fs.writeFileSync(path.join(r.dir, 'fix.txt'), 'fixed again\n');
  git(r.dir, 'commit', '-q', '-am', 'the real fix');
  const sha = git(r.dir, 'rev-parse', 'HEAD');
  git(r.dir, 'checkout', '-q', 'main');
  const n = newTask('Fix the search');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', commit: { sha, repo: r.repo, onRemote: false } }).ok, true);
  const rowOf = async () => {
    const list = await (await fetch(base + '/api/tasks?view=tasks', { headers: { origin: base } })).json();
    return (list.tasks || []).find((x) => x.projectId === projectId && x.number === n);
  };
  assert.equal((await rowOf()).landedCheck, undefined, 'an open task was checked');
  tasks.close(projectId, n);
  assert.equal((await rowOf()).landedCheck, 'kept', 'CONTROL: a commit the repository has did not read as kept');
  // Review 3: its branch deleted after a merge, the object remains: still kept.
  git(r.dir, 'branch', '-q', '-D', 'fix');
  landedcheck.resetForTests();
  assert.equal((await rowOf()).landedCheck, 'kept', 'a fix whose branch was cleaned up after its merge read as lost');
  // A commit this repository never had is what missing means.
  const m = newTask('Fix the toolbar again');
  assert.equal(tasks.setBuilt(projectId, m, { by: 'mona', commit: { sha: 'd'.repeat(40), repo: r.repo, onRemote: false } }).ok, true);
  tasks.close(projectId, m);
  const list = await (await fetch(base + '/api/tasks?view=tasks', { headers: { origin: base } })).json();
  assert.equal(list.tasks.find((x) => x.projectId === projectId && x.number === m).landedCheck, 'missing');
});

test('review 3: a task closed more than two weeks ago is not checked (git may have cleaned the object away)', async () => {
  const landedcheck = require('./engine/landedcheck');
  landedcheck.resetForTests();
  const r = makeRepo('route-old');
  const n = newTask('Fix from long ago');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', commit: { sha: 'c'.repeat(40), repo: r.repo, onRemote: true } }).ok, true);
  tasks.close(projectId, n);
  projects.mutate(projectId, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === n ? { ...t, closedAt: new Date(Date.now() - landedcheck.CHECK_WINDOW_MS - 60000).toISOString() } : t)) }));
  const list = await (await fetch(base + '/api/tasks?view=tasks', { headers: { origin: base } })).json();
  const row = list.tasks.find((x) => x.projectId === projectId && x.number === n);
  assert.equal(row.state, 'closed', 'CONTROL: the task is closed');
  assert.equal(row.landedCheck, undefined, 'a task closed weeks ago was flagged');
  assert.equal(row.landedCommit, 'c'.repeat(40), 'CONTROL: it still names its commit');
});


test('review 1: the page is never sent the repository path; an open row says a remote has the commit once one does', async () => {
  const landedcheck = require('./engine/landedcheck');
  landedcheck.resetForTests();
  const r = makeRepo('route-remote');
  const n = newTask('Fix the sidebar');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', commit: { sha: r.sha, repo: r.repo, onRemote: false } }).ok, true);
  const rowOf = async () => ((await (await fetch(base + '/api/tasks?view=tasks', { headers: { origin: base } })).json()).tasks || [])
    .find((x) => x.projectId === projectId && x.number === n);
  const before = await rowOf();
  assert.equal(before.landedRepo, undefined, 'the page was sent a path on this computer');
  assert.equal(before.landedOnRemote, false, 'CONTROL: a commit no remote has');
  assert.equal(before.landedCheck, undefined, 'an open task carried a closed task\'s check');
  const bare = path.join(SANDBOX, 'route-remote.git');
  git(SANDBOX, 'init', '-q', '--bare', bare);
  git(r.dir, 'remote', 'add', 'origin', bare);
  git(r.dir, 'push', '-q', 'origin', 'main');
  git(r.dir, 'fetch', '-q', 'origin');
  landedcheck.resetForTests();
  assert.equal((await rowOf()).landedOnRemote, true, 'a fix pushed after its mark still said it is only on this computer');
});

test('review 1: a task its parts closed, then reopened by a new part, drops the old commit', () => {
  const n = newTask('Fix in two steps');
  tasks.addPart(projectId, n, { sentence: 'step one', who: 'mona' });
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', commit: { sha: SHA, repo: REPO, onRemote: true } }).ok, true);
  for (const part of tasks.partsOf(stored(n))) tasks.setPartClosed(projectId, n, part.id, new Date().toISOString());
  assert.equal(tasks.progressOf(stored(n)).closed, true, 'CONTROL: closing its one part closed the task');
  assert.equal(stored(n).landedCommit, SHA, 'closing by parts dropped the commit');
  tasks.addPart(projectId, n, { sentence: 'step two', who: 'mona' });
  assert.equal(tasks.progressOf(stored(n)).closed, false, 'CONTROL: a new part reopened it');
  assert.equal(stored(n).landedCommit, undefined, 'new work kept the old commit');
});

test('review 5: a checkout with uncommitted changes is refused by both CLIs (HEAD would be the commit before the fix)', async () => {
  const tok = sendertoken.mint('mona').token;
  const r = makeRepo('dirty');
  fs.writeFileSync(path.join(r.dir, 'fix.txt'), 'the fix, not committed yet\n');
  const n = newTask('Fix not committed yet');
  if (process.platform !== 'win32') {
    const mr = await mac(['task', 'built', projectId, String(n), '--commit', 'HEAD'], { KOSMOS_AGENT_TOKEN: tok }, r.dir);
    assert.equal(mr.code, 2, mr.out);
    assert.match(mr.out, /changes that are not committed\. Commit the fix first/);
  }
  const wr = await win(['task', 'built', projectId, String(n), '--commit', 'HEAD'], r.dir);
  assert.equal(wr.code, 2, wr.out + wr.err);
  assert.match(wr.err, /changes that are not committed\. Commit the fix first/);
  assert.equal(stored(n).builtAt, undefined, 'a dirty checkout still marked the task');
  // CONTROL: an untracked file is not an uncommitted fix, and committing makes it clean.
  git(r.dir, 'commit', '-q', '-am', 'the fix');
  fs.writeFileSync(path.join(r.dir, 'notes.txt'), 'scratch\n');
  const ok = await win(['task', 'built', projectId, String(n), '--commit', 'HEAD'], r.dir);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.equal(stored(n).landedCommit, git(r.dir, 'rev-parse', 'HEAD'));
});

test('review 5: the Windows CLI says the commit was recorded only when the board\'s answer carries it', async () => {
  const r = makeRepo('older-board');
  const out = [];
  const err = [];
  const code = await winCli.main(['task', 'built', projectId, '1', '--commit', 'HEAD'], {
    env: { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, KOSMOS_PORT: '1' },
    out: (s) => out.push(s), err: (s) => err.push(s),
    git: (args) => execFileSync('git', args, { cwd: r.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    fetch: async () => ({ status: 200, text: async () => JSON.stringify({ task: { number: 1 }, changed: true }) }),   // an older board
  });
  assert.equal(code, 0, err.join('\n'));
  assert.ok(out.join('\n').includes('This Kosmos did not record the commit'), out.join('\n'));
  assert.equal(out.join('\n').includes('Recorded commit'), false, 'it said recorded when the board dropped it');
});
