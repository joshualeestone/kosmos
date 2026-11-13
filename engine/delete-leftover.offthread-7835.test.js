'use strict';
/**
 * kosmos#7835: on Windows the drive probe and the Recycle Bin move (Windows PowerShell) held the whole board while they
 * ran. planAsync and delAsync give the answers plan and del give, with those waits off the board. Driven from any
 * platform like the #7820 tests: the win32 arm is injected and PowerShell is a stub behind the run() seam (here one that
 * answers LATER, as a promise, so a held board shows as a timer that stops ticking). Sandboxed: this MOVES FOLDERS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-7835-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const win32job = require('./win32job');
const leftover = require('./delete-leftover');

remove.setRunner(() => ({ ok: true, stdout: '' }));

/* What the stubbed PowerShell was asked, and how it answers. `drive` is the DriveType it reports (UNKNOWN and '' are
   printed raw, as the script does when it cannot look), `bin` the volume's Recycle Bin settings; `recycle` acts on the
   folder (or not) and returns the script's word. */
const calls = [];
let drive = 'Fixed';
let bin = {};
const driveAnswer = () => (drive === 'UNKNOWN' || drive === ''
  ? drive
  : JSON.stringify({ type: drive, total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000, ...bin }));
let recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'RECYCLED'; };
function stub(file, args, opts) {
  calls.push({ file, args, env: (opts && opts.env) || {}, opts: opts || {} });
  const script = args[args.length - 1];
  const p = opts && opts.env && opts.env.KOSMOS_RECYCLE_PATH;
  if (script === leftover.DRIVE_SCRIPT) return { ok: true, stdout: driveAnswer() + '\r\n' };
  if (script === leftover.RECYCLE_SCRIPT) return { ok: true, stdout: recycle(p) + '\r\n' };
  return { ok: true, stdout: '' };
}
leftover.setRunner(stub);

function leftoverFolder(name) {
  const dir = create.workerDir(name);
  fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
  fs.writeFileSync(nodePath.join(dir, 'notes', '1.md'), 'more\n');
  fs.writeFileSync(nodePath.join(dir, 'notes', '2.md'), 'more\n');
  return dir;
}
const win = {
  plan: (name) => leftover.plan(name, { platform: 'win32' }),
  del: (name, o) => leftover.del(name, { unchecked: true, platform: 'win32', ...(o || {}) }),
};
const trashEntries = () => { try { return fs.readdirSync(process.env.AGENT_WORKFORCE_TRASH); } catch { return []; } };

test.beforeEach(() => {
  leftover.setRunner(stub);   // also forgets the cached drive answers
  calls.length = 0;
  drive = 'Fixed';
  bin = {};
  recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'RECYCLED'; };
  status.setPaneSource(() => '');
  /* Task Scheduler answers "no such task": a folder-only Windows leftover. */
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
});
test.afterEach(() => { status.setPaneSource(null); win32job.setRunner(null); });


/* A stub whose PowerShell answers after `ms`, as a promise. Called synchronously (plan, del), it returns that promise,
   which run()'s callers read as no answer: so a plan that offers the Recycle Bin read a kept probe, and a move that
   lands went through recycleAsync. */
// Answers as a promise: the async drivers wait for it. A SYNCHRONOUS plan or del handed this gets a promise from run(),
// reads it as no answer, and keeps that failed drive answer for 5 s (setRunner clears it).
const later = (ms) => (file, args, opts) => new Promise((resolve) => setTimeout(() => resolve(stub(file, args, opts)), ms));
/* Ticks of a 20 ms timer while `fn` runs: a board held by a synchronous wait shows none. */
async function ticksDuring(fn) {
  let ticks = 0;
  const t = setInterval(() => { ticks += 1; }, 20);
  try { return { value: await fn(), ticks }; } finally { clearInterval(t); }
}
const asyncWin = {
  plan: (name) => leftover.planAsync(name, { platform: 'win32' }),
  del: (name, o) => leftover.delAsync(name, { unchecked: true, platform: 'win32', ...(o || {}) }),
};
const probes = () => calls.filter((c) => c.args.includes(leftover.DRIVE_SCRIPT)).length;
const moves = () => calls.filter((c) => c.args.includes(leftover.RECYCLE_SCRIPT)).length;

test('#7835 planAsync: the drive probe runs while the board keeps answering, and the plan offers the Recycle Bin from it', async () => {
  leftoverFolder('ot7835a');
  leftover.setRunner(later(200));
  const { value: p, ticks } = await ticksDuring(() => asyncWin.plan('ot7835a'));
  assert.equal(p.ok, true, p.because);
  assert.equal(p.toTrash, true, 'the plan did not read the probe run before it');
  assert.ok(ticks >= 5, `the board was held while the drive was probed (${ticks} ticks in 200 ms)`);
  assert.equal(probes(), 1, 'the drive was probed again inside the plan, holding the board');
  // CONTROL: the synchronous plan with the same late PowerShell cannot read it, so the Recycle Bin is not offered.
  leftover.setRunner(later(200));
  assert.equal(win.plan('ot7835a').toTrash, false, 'CONTROL: a synchronous plan read a late answer');
  fs.rmSync(create.workerDir('ot7835a'), { recursive: true, force: true });
});

test('#7835 delAsync: the Recycle Bin move runs while the board keeps answering, and says what del says', async () => {
  leftoverFolder('ot7835b');
  leftover.setRunner(later(300));
  const { value: done, ticks } = await ticksDuring(() => asyncWin.del('ot7835b'));
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.ok(ticks >= 10, `the board was held while the folder was moved (${ticks} ticks in at least 300 ms)`);
  assert.equal(moves(), 1);
  assert.equal(fs.existsSync(create.workerDir('ot7835b')), false, 'the folder is still there');
  // The same answer as the synchronous delete of an identical leftover.
  leftover.setRunner(stub);
  leftoverFolder('ot7835b');
  const same = win.del('ot7835b');
  assert.equal(done.said, same.said);
  assert.deepEqual(done.steps.map((s) => [s.step, s.ok]), same.steps.map((s) => [s.step, s.ok]));
  assert.equal(done.toTrash, same.toTrash);
});

test('#7835 a second delete of the same agent while one runs is refused, and the first finishes', async () => {
  leftoverFolder('ot7835c');
  leftover.setRunner(later(200));
  const first = asyncWin.del('ot7835c');
  const second = await asyncWin.del('OT7835C');
  assert.equal(second.outcome, leftover.OUTCOME.REFUSED);
  assert.match(second.because, /is running now/);
  assert.equal((await first).outcome, leftover.OUTCOME.DELETED);
  assert.equal(moves(), 1, 'the second delete moved something too');
  // After it ends, the name is not held: a new leftover of the same name can be deleted.
  leftoverFolder('ot7835c');
  assert.equal((await asyncWin.del('ot7835c')).outcome, leftover.OUTCOME.DELETED);
});

test('#7835 item 2: a probe with no answer is kept 5 s, a good answer a minute', () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    leftoverFolder('ot7835d');
    drive = 'UNKNOWN';
    assert.equal(win.plan('ot7835d').toTrash, false);
    assert.equal(probes(), 1);
    drive = 'Fixed';
    now += 3000;
    assert.equal(win.plan('ot7835d').toTrash, false, 'a no-answer was not kept for its 5 s');
    assert.equal(probes(), 1);
    now += 3000;
    assert.equal(win.plan('ot7835d').toTrash, true, 'a no-answer was kept past 5 s');
    assert.equal(probes(), 2);
    now += 30000;
    assert.equal(win.plan('ot7835d').toTrash, true);
    assert.equal(probes(), 2, 'a good answer was not kept for its minute');
    now += 31000;
    win.plan('ot7835d');
    assert.equal(probes(), 3, 'a good answer was kept past a minute');
  } finally {
    Date.now = realNow;
    fs.rmSync(create.workerDir('ot7835d'), { recursive: true, force: true });
  }
});

test('#7835 item 4: an error Windows raised after the folder was gone is kept on the step, in del and delAsync', async () => {
  for (const go of [(n) => win.del(n), (n) => asyncWin.del(n)]) {
    leftover.setRunner(stub);
    recycle = (p) => { fs.rmSync(p, { recursive: true, force: true }); return 'FAILED Access to the path is denied.'; };
    leftoverFolder('ot7835e');
    const done = await go('ot7835e');
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
    assert.match(done.said, /could not check that Windows put its files in the Recycle Bin/);
    const step = done.steps.find((s) => s.step === 'its folder');
    assert.equal(step.note, 'Windows said: Access to the path is denied.', 'the late error was dropped');
  }
});

test('#7835 off Windows, delAsync and planAsync are del and plan', async () => {
  leftover.setRunner(stub);
  const dir = leftoverFolder('ot7835f');
  const p = await leftover.planAsync('ot7835f', { platform: 'darwin' });
  assert.equal(p.ok, true, p.because);
  assert.equal(probes(), 0, 'a Mac plan ran PowerShell');
  const done = await leftover.delAsync('ot7835f', { unchecked: true, platform: 'darwin', typed: p.typeToConfirm || undefined });
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.equal(moves(), 0);
  assert.equal(fs.existsSync(dir), false);
});

test('#7835 while a delete runs: the agent page hears it is running, a new agent of that name is refused; after, both clear', async () => {
  leftoverFolder('ot7835g');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7835g');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(leftover.deletingName('ot7835g'), true);
  assert.equal(leftover.deletingName('OT7835G'), true, 'the name is held whatever its case');
  const midway = await asyncWin.plan('ot7835g');
  assert.equal(midway.ok, false);
  assert.match(midway.because, /is running now/);
  const made = create.createAgent({ name: 'ot7835g', role: 'test', kind: 'agent' });
  assert.equal(made.outcome, create.OUTCOME.REFUSED, JSON.stringify(made));
  assert.match(made.because, /still being deleted/);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
  assert.equal(leftover.deletingName('ot7835g'), false, 'the name stayed held after the delete ended');
});

test('#7835 a move that throws still lets go of the name', async () => {
  leftoverFolder('ot7835h');
  leftover.setRunner(async (file, args, opts) => {
    if (args.includes(leftover.RECYCLE_SCRIPT)) throw new Error('PowerShell would not start');
    return stub(file, args, opts);
  });
  const done = await asyncWin.del('ot7835h');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  const step = done.steps.find((s) => s.step === 'its folder');
  assert.equal(step.ok, false);
  assert.equal(leftover.deletingName('ot7835h'), false, 'a failed move kept the name held');
  leftover.setRunner(stub);
  assert.equal((await asyncWin.del('ot7835h')).outcome, leftover.OUTCOME.DELETED, 'the retry was refused as running');
});

test('#7835 the live runner closes stdin, and answers at its limit with no exit code', async () => {
  // A process that reads stdin to its end: with stdin closed it ends at once.
  const cat = await leftover.execAsync('/bin/cat', [], { timeout: 3000 });
  assert.equal(cat.ok, true, 'stdin was left open: ' + JSON.stringify(cat));
  // A process past its limit is killed and answered, with no exit code to read as a real answer.
  const t0 = Date.now();
  const slow = await leftover.execAsync('/bin/sleep', ['5'], { timeout: 200 });
  assert.equal(slow.ok, false);
  assert.equal(slow.code, null, 'a process killed at its limit carried an exit code');
  assert.ok(Date.now() - t0 < 3000, 'it was not killed at its limit');
});

test('#7835 the hold meets any spelling of the same agent, and a restore of it is refused while the delete runs', async () => {
  leftoverFolder('ot7835-k');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7835-k');
  await new Promise((r) => setTimeout(r, 50));
  for (const spelled of ['ot7835-k', 'OT7835-K', 'Ot7835 K', '  ot7835 k  ']) {
    assert.equal(leftover.deletingName(spelled), true, `"${spelled}" is the same agent but did not meet the hold`);
  }
  assert.equal(leftover.deletingName('ot7835-kk'), false, 'CONTROL: another name met the hold');
  const second = await asyncWin.del('Ot7835 K');
  assert.equal(second.outcome, leftover.OUTCOME.REFUSED, 'a second delete under another spelling ran');
  const back = remove.restore('Ot7835 K');
  assert.equal(back.outcome, remove.OUTCOME.REFUSED, JSON.stringify(back));
  assert.match(back.because, /still being deleted/);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
  assert.equal(leftover.deletingName('Ot7835 K'), false);
});

test('#7835 its settings go to the Recycle Bin off the board too, and the answer is what del gives', async () => {
  const store = require('./store');
  const withSettings = (name) => {
    leftoverFolder(name);
    fs.mkdirSync(nodePath.dirname(store.profilePath(name)), { recursive: true });
    fs.writeFileSync(store.profilePath(name), '{}');
  };
  withSettings('ot7835m');
  const profile = fs.realpathSync.native(store.profilePath('ot7835m'));
  leftover.setRunner(later(150));
  const { value: done, ticks } = await ticksDuring(() => asyncWin.del('ot7835m'));
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.ok(moves() >= 2, 'the settings were not moved through the Recycle Bin call');
  assert.ok(calls.some((c) => c.args.includes(leftover.RECYCLE_SCRIPT) && c.env.KOSMOS_RECYCLE_PATH === profile), 'its settings file was not sent');
  assert.ok(ticks >= 10, `the board was held while the folder and its settings were moved (${ticks} ticks)`);
  assert.equal(fs.existsSync(store.profilePath('ot7835m')), false);
  leftover.setRunner(stub);
  withSettings('ot7835m');
  const same = win.del('ot7835m');
  assert.equal(done.said, same.said);
  assert.deepEqual(done.steps.map((s) => [s.step, s.ok]), same.steps.map((s) => [s.step, s.ok]));
});

test('#7835 while a delete runs, Start, Restart and Remove of that agent are refused', async () => {
  leftoverFolder('ot7835n');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7835n');
  await new Promise((r) => setTimeout(r, 50));
  const started = remove.restart('ot7835n', 'restart', { startIfDead: true });
  assert.equal(started.outcome, remove.OUTCOME.REFUSED, JSON.stringify(started));
  assert.match(started.because, /being deleted now/);
  const startedAsync = await remove.restartAsync('ot7835n', 'restart', { startIfDead: true });
  assert.equal(startedAsync.outcome, remove.OUTCOME.REFUSED, JSON.stringify(startedAsync));
  assert.match(startedAsync.because, /being deleted now/);   // refused BY the delete, not for want of a job
  const removed = remove.remove('ot7835n');
  assert.equal(removed.outcome, remove.OUTCOME.REFUSED, JSON.stringify(removed));
  assert.match(removed.because, /being deleted now/);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
});

test('#7835 a delete whose probe gave no answer does not probe again on the board when that short keep runs out', async () => {
  const realNow = Date.now;
  let now = realNow();
  try {
    leftoverFolder('ot7835p');
    drive = 'UNKNOWN';
    // Counted when asked, so a probe started synchronously is seen too.
    let asked = 0;
    leftover.setRunner((file, args, opts) => {
      if (args.includes(leftover.DRIVE_SCRIPT)) asked += 1;
      return new Promise((resolve) => setTimeout(() => resolve(stub(file, args, opts)), 50));
    });
    // A slow disk: every look at the clock is 3 s later, so a no-answer's 5 s keep runs out between the warm and the
    // delete's own re-plan, as a long folder measure would make it.
    Date.now = () => (now += 3000);
    const done = await asyncWin.del('ot7835p', { typed: 'ot7835p' });
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
    assert.equal(asked, 1, 'the drive was probed again inside the delete, on the board');
    // After it, the keep is ordinary again: an expired no-answer is asked afresh.
    leftoverFolder('ot7835p');
    win.plan('ot7835p');
    assert.equal(asked, 2, 'the delete left its drive pinned');
  } finally {
    Date.now = realNow;
    fs.rmSync(create.workerDir('ot7835p'), { recursive: true, force: true });
  }
});

test('#7835 the pin is the delete\'s own: another plan on the same drive keeps the ordinary minute keep', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    leftoverFolder('ot7835r');
    leftoverFolder('ot7835s');
    let asked = 0;
    let release = null;
    leftover.setRunner((file, args, opts) => {
      if (args.includes(leftover.DRIVE_SCRIPT)) asked += 1;
      // The move waits until the test lets it go, so the delete is running while the other plan is made.
      if (args.includes(leftover.RECYCLE_SCRIPT)) return new Promise((resolve) => { release = () => resolve(stub(file, args, opts)); });
      return Promise.resolve(stub(file, args, opts));
    });
    const going = asyncWin.del('ot7835r');
    for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.ok(release, 'the delete never reached its move');
    assert.equal(asked, 1);
    now += 61000;
    win.plan('ot7835s');
    assert.equal(asked, 2, 'another agent\'s plan read the running delete\'s pinned answer past its minute keep');
    release();
    assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
  } finally {
    Date.now = realNow;
    fs.rmSync(create.workerDir('ot7835s'), { recursive: true, force: true });
  }
});

test('#7835 connecting a folder under the name of an agent whose delete runs is refused', async () => {
  const discover = require('./discover');
  leftoverFolder('ot7835t');
  const outside = fs.mkdtempSync(nodePath.join(SANDBOX, 'outside-'));
  fs.writeFileSync(nodePath.join(outside, 'CLAUDE.md'), 'You are Ot7835t, a worker.\n');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7835t');
  await new Promise((r) => setTimeout(r, 50));
  const joined = discover.connect(outside, { name: 'ot7835t' });
  assert.equal(joined.ok, false, JSON.stringify(joined));
  assert.match(joined.because, /still being deleted/);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
});

test('#7835 item 5: the warm off the board waits for a cold PowerShell start; a probe on the board keeps its short limit', async () => {
  leftoverFolder('ot7835w');
  leftover.setRunner(stub);   // forgets the kept drive answers, so both plans below probe
  calls.length = 0;
  const p = await asyncWin.plan('ot7835w');
  assert.equal(p.ok, true, p.because);
  const warm = calls.filter((c) => c.args.includes(leftover.DRIVE_SCRIPT));
  assert.equal(warm.length, 1, 'the async plan did not probe once');
  assert.equal(warm[0].opts.timeout, leftover.DRIVE_WARM_TIMEOUT_MS);
  assert.ok(leftover.DRIVE_WARM_TIMEOUT_MS > leftover.DRIVE_TIMEOUT_MS, 'the warm has no more time than the board probe');
  leftover.setRunner(stub);
  calls.length = 0;
  win.plan('ot7835w');
  const onBoard = calls.filter((c) => c.args.includes(leftover.DRIVE_SCRIPT));
  assert.equal(onBoard.length, 1, 'the plan on the board did not probe once');
  assert.equal(onBoard[0].opts.timeout, leftover.DRIVE_TIMEOUT_MS);
});

test('#7835 adding a folder with no instructions under the name of an agent whose delete runs is refused', async () => {
  const discover = require('./discover');
  leftoverFolder('ot7835u');
  const outside = fs.mkdtempSync(nodePath.join(SANDBOX, 'outside-'));
  fs.writeFileSync(nodePath.join(outside, 'notes.md'), 'no instructions here\n');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7835u');
  await new Promise((r) => setTimeout(r, 50));
  const joined = discover.connect(outside, { name: 'ot7835u' });
  assert.equal(joined.ok, false, JSON.stringify(joined));
  assert.match(joined.because, /still being deleted/);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
});

test('#7835 a running delete holds the board: its restarts wait, with their own sentence, and a delete under a restart is refused', async () => {
  leftoverFolder('ot7835v');
  leftover.setRunner(later(300));
  assert.equal(leftover.deletingNow(), false, 'a delete is said to run before one started');
  const going = asyncWin.del('ot7835v');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(leftover.deletingNow(), true, 'the running delete is not seen, so a board restart could cut it off');
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
  assert.equal(leftover.deletingNow(), false, 'the delete is still said to run after it finished');
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /function moveHoldsBoard\(\) \{ return [^}]*\|\| leftover\.deletingNow\(\); \}/);
  assert.equal((server.match(/moveHoldsBoard\(\)\) \{ (?:sendJson\(res, 409, \{ ok: false, because|say\(409, \{ error): accountmove\.boardBusyBecause\(\)/g) || []).length, 0,
    'a restart refused for a running delete would say an account move holds it');
  assert.equal((server.match(/moveHoldsBoard\(\)\) \{ (?:sendJson\(res, 409, \{ ok: false, because|say\(409, \{ error): boardHoldBecause\(\)/g) || []).length, 4);
  const route = server.slice(server.indexOf("if (lo && req.method === 'DELETE') {"));
  const guard = route.indexOf("boardRestartingSoon()) { sendJson(res, 409, { outcome: leftover.OUTCOME.REFUSED"), act = route.indexOf('leftover.delAsync(');
  assert.ok(guard > 0 && act > guard, 'a delete can start under a board restart, which would cut it off');
});

test('#7835 planAsync with every drive already answered plans once, and says what a second plan would', async () => {
  leftoverFolder('ot7835x');
  leftover.setRunner(stub);
  const warmed = await asyncWin.plan('ot7835x');   // asks the drive, so the next one has nothing to ask
  assert.equal(warmed.ok, true, warmed.because);
  let asked = 0;
  status.setPaneSource(() => { asked += 1; return ''; });
  const again = await asyncWin.plan('ot7835x');
  const plansRun = asked;
  assert.ok(plansRun >= 1, 'the plan did not read the running panes, so this count proves nothing');
  asked = 0;
  const direct = win.plan('ot7835x');
  assert.equal(plansRun, asked, 'planAsync planned twice with nothing left to ask the drive');
  assert.deepEqual(again, direct);
});

test('#7835 an account move does not start while a Windows delete runs, and says why', async () => {
  const accountmove = require('./accountmove');
  leftoverFolder('ot7835z');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7835z');
  await new Promise((r) => setTimeout(r, 50));
  // No deps about the delete at all: the move asks the delete module itself, so no caller can leave it out.
  const r = await Promise.resolve(accountmove.start({ dir: '/nowhere', names: ['someone'] }, {}));
  assert.equal(r.status, 409, JSON.stringify(r));
  assert.equal(r.body.because, leftover.DELETING_MOVE_BECAUSE);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
  assert.equal(leftover.deletingNow(), false, 'the delete still holds moves after it ended');
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  const one = server.slice(server.indexOf("if (boardRestartingSoon()) { sendJson(res, 409, { outcome: 'refused', because: accountmove.boardGoingBecause() }); return; }"));
  assert.match(one.slice(0, 400), /if \(leftover\.deletingNow\(\)\) \{ sendJson\(res, 409, \{ outcome: 'refused', because: leftover\.DELETING_MOVE_BECAUSE \}\); return; \}/, 'the one-agent Move can start under a running delete');
});

test('#7835 a warm that stored no answer does not pin an older one: the delete re-plans from a fresh look', async () => {
  const realNow = Date.now;
  let now = realNow();
  try {
    leftoverFolder('ot7835y');
    // One runner throughout (setRunner forgets every kept answer, and the old one must stay kept).
    let dryDrive = false;
    let dry = 0;
    leftover.setRunner((file, args, opts) => {
      if (dryDrive && args.includes(leftover.DRIVE_SCRIPT)) { dry += 1; return { ok: true, stdout: '', dryRun: true }; }
      return stub(file, args, opts);
    });
    assert.equal((await asyncWin.plan('ot7835y')).toTrash, true, 'the first look did not offer the Recycle Bin');
    // A minute later that answer is stale, and the next warm keeps nothing (a dry run is never kept).
    Date.now = () => now + 61000;
    dryDrive = true;
    const done = await asyncWin.del('ot7835y');
    assert.ok(dry >= 1, 'the stale answer was never looked past');
    // Read pinned, the old answer would have moved it to the Recycle Bin with no name typed; from a fresh look with no
    // answer the delete is for good, so it asks for the name.
    assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  } finally {
    Date.now = realNow;
    fs.rmSync(create.workerDir('ot7835y'), { recursive: true, force: true });
  }
});

test('#7852 the plan asked while a delete runs says running, so a reloaded page can show it; other refusals do not', async () => {
  leftoverFolder('ot7852r');
  leftover.setRunner(later(300));
  const going = asyncWin.del('ot7852r');
  await new Promise((r) => setTimeout(r, 50));
  const during = await asyncWin.plan('ot7852r');
  assert.equal(during.ok, false);
  assert.equal(during.running, true, 'a plan asked during the delete does not say it is running');
  assert.match(during.because, /running now/);
  assert.equal((await going).outcome, leftover.OUTCOME.DELETED);
  const after = await asyncWin.plan('ot7852r');
  assert.notEqual(after.running, true, 'a plan asked after the delete still says it is running');
});
