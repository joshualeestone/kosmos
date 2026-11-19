'use strict';

/**
 * kosmos#8734 (feedback 11-19): three small Tasks CLI defects, each run here against a real board on a sandbox:
 *   1. `kosmos task show` did not print an active timed wake: the list the CLIs read never carried the wake's words.
 *   2. `kosmos task close <p> <n> --not-run <extra>` blamed the valid --not-run instead of the extra word.
 *   3. `kosmos task close --not-run` was taken on a task with a check reported on it (or marked built). It is refused.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-8734.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-task8734-cli-'));
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
const cli = require('./tools/windows/kosmos-cli');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');

let base;
let pid;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  pid = projects.create({ name: 'Wakes' }).id;
  projects.mutate(pid, (p) => ({ ...p, agents: ['mara'] }));
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const newTask = (sentence) => tasks.create(pid, { sentence, who: 'mara' }).number;

async function win(argv) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.mkdirSync(path.join(MAC_HOME, 'app'), { recursive: true });
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'app', 'engine'));   // the installed layout's engine/tasklist.js, as #8202's test
function mac(args) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
const wakeLine = (out) => out.split('\n').find((l) => l.startsWith('Wake: ')) || '';

/* ---- 1. task show prints an active wake ---- */

test('#8734 item 1: the list the CLIs read carries an open task\'s wake words, and a closed or wakeless row carries none', async () => {
  const n = newTask('Waits two hours');
  tasks.setWake(pid, n, { kind: 'at', at: Date.now() + 2 * 3600 * 1000 });
  const none = newTask('No wake');   // CONTROL: no wake, no words
  const rows = (await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(pid)}`)).json()).tasks;
  const row = rows.find((t) => t.number === n);
  assert.match(String(row.wakeWords), /^waits until /, JSON.stringify(row));
  assert.equal(rows.find((t) => t.number === none).wakeWords, undefined);
  // CONTROL: a closed task's wake is not shown (the Tasks view's rule too).
  const shut = newTask('Closed with a wake');
  tasks.setWake(pid, shut, { kind: 'at', at: Date.now() + 2 * 3600 * 1000 });
  tasks.close(pid, shut);
  const after = (await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(pid)}`)).json()).tasks;
  assert.equal(after.find((t) => t.number === shut).wakeWords, undefined);
  // The grouped list (`kosmos task list` sends order=state) carries it too.
  const grouped = (await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(pid)}&order=state`)).json()).tasks;
  assert.match(String(grouped.find((t) => t.number === n).wakeWords), /^waits until /);
});

/* The wake is set as `task wake --at 2h` sets it (tasks.setWake with an at, by the agent): the CLI's own set needs an
   agent token this sandbox does not have, and the set is not what this card is about; the show is. */
const wakeIn2h = (n) => tasks.setWake(pid, n, { kind: 'at', at: Date.now() + 2 * 3600 * 1000 }, { by: 'mara' });
test('#8734 item 1: Mac task show prints an active timed wake, and none once it is cleared', { skip: SKIP_POSIX_SHELL }, async () => {
  const n = newTask('Mac wake');
  wakeIn2h(n);
  const shown = await mac(['task', 'show', pid, String(n)]);
  assert.equal(shown.code, 0, shown.out);
  assert.match(wakeLine(shown.out), /^Wake: waits until /, shown.out);
  // kosmos task list prints its [waits ...] mark too, now that the list carries the words.
  const list = await mac(['task', 'list', pid]);
  assert.match(list.out.split('\n').find((l) => l.includes('Mac wake')) || '', /\[waits until /, list.out);
  tasks.setWake(pid, n, null, { by: 'mara' });
  const after = await mac(['task', 'show', pid, String(n)]);
  assert.equal(wakeLine(after.out), '', 'CONTROL: a cleared wake is not shown: ' + after.out);
});

test('#8734 item 1: Windows task show prints an active timed wake', async () => {
  const n = newTask('Windows wake');
  wakeIn2h(n);
  const shown = await win(['task', 'show', pid, String(n)]);
  assert.equal(shown.code, 0, shown.err);
  assert.match(wakeLine(shown.out), /^Wake: waits until /, shown.out);
  const list = await win(['task', 'list', pid]);
  assert.match(list.out.split('\n').find((l) => l.includes('Windows wake')) || '', /\[waits until /, list.out);
});

/* ---- 2. an extra word after a valid option is the one named ---- */

const EXTRA = [
  [['--not-run', '--bogus'], /^\s*--bogus is not an option of kosmos task close/m],
  [['--with-built', '--bogus'], /^\s*--bogus is not an option of kosmos task close/m],
  [['--not-run', 'oops'], /^\s*kosmos task close takes no more words than its usage shows/m],
  [['oops', '--bogus'], /^\s*--bogus is not an option of kosmos task close/m],   // review 8: an option after a plain word is still named
];
test('#8734 item 2: Mac task close names the extra word, never the valid option before it', { skip: SKIP_POSIX_SHELL }, async () => {
  const n = newTask('Mac extra word');
  for (const [tail, want] of EXTRA) {
    const r = await mac(['task', 'close', pid, String(n), ...tail]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, want, tail.join(' ') + ': ' + r.out);
    assert.doesNotMatch(r.out, /--(not-run|with-built) is not an option/, tail.join(' ') + ' blamed a valid option: ' + r.out);
  }
  assert.equal(tasks.progressOf(tasks.byNumber(projects.readAll().find((p) => p.id === pid), n)).closed, false, 'a refused close closed it');
});
test('#8734 item 2: Windows task close names the extra word, never the valid option before it', async () => {
  const n = newTask('Windows extra word');
  for (const [tail, want] of EXTRA) {
    const r = await win(['task', 'close', pid, String(n), ...tail]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, want, tail.join(' ') + ': ' + r.err);
    assert.doesNotMatch(r.err, /--(not-run|with-built) is not an option/, tail.join(' ') + ' blamed a valid option: ' + r.err);
  }
  assert.equal(tasks.progressOf(tasks.byNumber(projects.readAll().find((p) => p.id === pid), n)).closed, false, 'a refused close closed it');
});

/* ---- 3. never-run is refused over a record that says it ran ---- */

const isClosed = (n) => tasks.progressOf(tasks.byNumber(projects.readAll().find((p) => p.id === pid), n)).closed;
test('#8734 item 3: the board refuses closing as never run a task with a check reported, or marked built', async () => {
  const checked = newTask('Checked');
  tasks.setDoneWhen(pid, checked, ['the page loads']);
  tasks.setCheckResult(pid, checked, 1, true, 'it loads, measured', { by: 'mara' });
  const built = newTask('Built');
  assert.ok(tasks.setBuilt(pid, built, { by: 'mara' }).ok);
  const plain = newTask('Never started');
  const close = (n, body) => fetch(`${base}/api/project/${encodeURIComponent(pid)}/task/${n}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let r = await close(checked, { notRun: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has a check reported met, so it ran: it cannot be closed as never run/);
  assert.equal(isClosed(checked), false);
  r = await close(built, { notRun: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /was marked built, so it ran/);
  assert.equal(isClosed(built), false);
  // Review 2: a close takes the built mark away; marking it never run afterwards is still refused.
  r = await close(built, {});
  assert.equal(r.status, 200, await r.text());
  r = await close(built, { notRun: true });
  assert.equal(r.status, 400, 'a built task, closed, was then marked never run');
  // Review 4: a closed task is not told to close it again.
  assert.match((await r.json()).error, /was marked built, so it ran: it cannot be marked never run\. It stays closed as it is/);
  // Review 4: a closed task carrying only a landed commit (what task built --commit leaves through the close).
  const landed = newTask('Landed');
  tasks.close(pid, landed);
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === landed ? { ...t, landedCommit: 'a'.repeat(40) } : t)) }));
  r = await close(landed, { notRun: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /was marked built/);
  // Review 4: two met checks are counted in the words.
  const two = newTask('Two checks');
  tasks.setDoneWhen(pid, two, ['one', 'two']);
  tasks.setCheckResult(pid, two, 1, true, 'yes', { by: 'mara' });
  tasks.setCheckResult(pid, two, 2, true, 'yes', { by: 'mara' });
  r = await close(two, { notRun: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has 2 checks reported met/);
  // Review 3: a recorded run (kosmos task ran) is refused too.
  const ranTask = newTask('Ran once');
  // As kosmos task ran leaves it (recordRun needs a repeat rule; a close keeps lastRunAt after taking the rule away).
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === ranTask ? { ...t, lastRunAt: new Date().toISOString(), lastRunBy: 'mara' } : t)) }));
  r = await close(ranTask, { notRun: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has a run recorded on it, so it ran/);
  // Review 3, CONTROL: an unmet check is no proof it ran (nothing done here, or the part moved on): it closes as never run.
  const unmet = newTask('Looked, nothing there');
  tasks.setDoneWhen(pid, unmet, ['the page loads']);
  tasks.setCheckResult(pid, unmet, 1, false, 'not started', { by: 'mara' });
  r = await close(unmet, { notRun: true });
  assert.equal(r.status, 200, await r.text());
  // Review 6, CONTROL: the common path, a plain close then marking it never run, is still allowed (closedHow 'unbuilt').
  const plainFirst = newTask('Closed, then marked never run');
  tasks.close(pid, plainFirst);
  r = await close(plainFirst, { notRun: true });
  assert.equal(r.status, 200, await r.text());
  // CONTROL: a task with no record of running still closes as never run, and the checked one still closes plainly.
  r = await close(plain, { notRun: true });
  assert.equal(r.status, 200, await r.text());
  assert.equal(isClosed(plain), true);
  r = await close(checked, {});
  assert.equal(r.status, 200, await r.text());
  assert.equal(isClosed(checked), true);
  // Marking it never run afterwards is refused too: the check is still on record after the close.
  r = await close(checked, { notRun: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has a check reported met, so it ran: it cannot be marked never run\. It stays closed as it is/);
});
const checkedTask = (name) => {
  const n = newTask(name);
  tasks.setDoneWhen(pid, n, ['it works']);
  tasks.setCheckResult(pid, n, 1, true, 'ran it, it works', { by: 'mara' });
  return n;
};
test('#8734 item 3: the Mac CLI says the refusal in the board\'s words', { skip: SKIP_POSIX_SHELL }, async () => {
  const n = checkedTask('Checked for the Mac CLI');
  const m = await mac(['task', 'close', pid, String(n), '--not-run']);
  assert.notEqual(m.code, 0, m.out);
  assert.match(m.out, /cannot be closed as never run/, m.out);
  assert.equal(isClosed(n), false);
});
test('#8734 item 3: closing several as never run, one refused: it stays open, the others close, and the refused one is named', async () => {
  const a = checkedTask('Bulk checked');
  const b = newTask('Bulk never started');
  const w = await win(['task', 'close', pid, String(a), String(b), '--not-run']);
  assert.match(w.err + w.out, new RegExp('task ' + a + '[^\\n]*cannot be closed as never run'), w.err + w.out);
  assert.equal(isClosed(a), false, 'the refused task closed');
  assert.equal(isClosed(b), true, 'the others did not close: ' + w.err + w.out);
});
test('#8734 item 3: the Mac CLI closes the others when one of several is refused never run', { skip: SKIP_POSIX_SHELL }, async () => {
  const a = checkedTask('Mac bulk checked');
  const b = newTask('Mac bulk never started');
  const m = await mac(['task', 'close', pid, String(a), String(b), '--not-run']);
  assert.match(m.out, new RegExp('task ' + a + '[^\\n]*cannot be closed as never run'), m.out);
  assert.equal(isClosed(a), false, 'the refused task closed');
  assert.equal(isClosed(b), true, 'the others did not close: ' + m.out);
});
test('#8734 item 3: the Windows CLI says the refusal in the board\'s words', async () => {
  const n = checkedTask('Checked for the Windows CLI');
  const w = await win(['task', 'close', pid, String(n), '--not-run']);
  assert.notEqual(w.code, 0, w.err);
  assert.match(w.err + w.out, /cannot be closed as never run/);
  assert.equal(isClosed(n), false);
});
