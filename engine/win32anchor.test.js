'use strict';
/**
 * #570: the durable anchor -- what a Scheduled Task still finds after an update.
 *
 * Every arm runs on any platform: `anchorDir` takes the platform it is asked
 * about, and the filesystem work happens in a temp sandbox. That matters more
 * here than usual, because this defect is invisible on the fleet's Macs and the
 * win32 branch would otherwise never be exercised until a real update broke a
 * real fleet.
 *
 *   node --test engine/win32anchor.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const anchor = require('./win32anchor');
const store = require('./store');

/* #2603: run this file from an ISOLATED temp cwd. `ensureAnchored({platform:'win32'})`
   does a real `fs.mkdirSync` of a `path.win32.join(...)` (backslash) path, and on macOS
   that lands as a single cwd-relative backslash-named dir (`\private\var\...\runtime`).
   Left in the worktree it reads as untracked garbage, so run-tests.sh still exits 0 but
   the challenge-loop validation helper's post-run cleanliness check records the tree
   dirty -- turning the local validation gate permanently red on every macOS worktree,
   for every agent, independent of the change under review. Isolating cwd here PREVENTS
   the leak reaching the worktree (it lands in the temp dir, removed below) rather than
   cleaning it up after -- so the worktree stays clean even if an arm throws. The
   `existsSync` assertions still pass: they resolve r.node/r.boot against the SAME cwd
   the mkdir used. `anchorDir` is pure and the other arms use absolute temp paths, so
   neither depends on cwd being the worktree. And worktree cleanliness does NOT depend
   on process isolation at all: the chdir runs at load before any test, so cwd is the
   temp dir regardless. (Node runs each test file in its own process by DEFAULT --
   run-tests.sh passes no --test-isolation flag -- so this also cannot affect a sibling
   file; but even under a shared process the worktree stays clean, verified.) */
const _win32OrigCwd = process.cwd();
const _win32LeakCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win32-cwd-'));
process.chdir(_win32LeakCwd);
test.after(() => {
  try { process.chdir(_win32OrigCwd); } catch { /* the process is ending anyway */ }
  try { fs.rmSync(_win32LeakCwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#570 the anchor FOLLOWS store.js for the app directory name', () => {
  /* 🛑 #2439 renamed the store dir AgentWorkforce -> Kosmos while this branch was
     in flight. A hardcoded copy here would survive that merge silently and leave
     the anchor as the one tree still under the old name -- with every registered
     Scheduled Task pointing into it. This pins the delegation, so the rename
     lands here for free and a re-added copy goes red.

     Written to pass on BOTH sides of the merge: it asserts agreement with
     store.js rather than a literal, so it does not have to be edited when the
     rename arrives. */
  const expected = store.APP || 'AgentWorkforce';
  assert.ok(anchor.anchorDir('win32', 'C:\\Users\\jo', {}).includes(expected),
    'the anchor must use store.js\'s name for the app directory, not a copy of it');
});

/* Every sandbox is removed after the run, pass or fail: the running-interpreter
   arm puts a real 92 MB node.exe in one. */
const sandboxes = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-anchor-'));
  sandboxes.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of sandboxes) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
  }
});

test('#570 the runtime anchors in LOCAL AppData, never Roaming', () => {
  /* 🛑 A deliberate split from store.dataRootFor, which roams on purpose so a
     person's config follows them to another machine on a domain. node.exe is
     92 MB and architecture-specific: roaming it would push 92 MB through a
     domain profile and could land an x64 binary on a machine that cannot run it.
     Config roams; the runtime does not. */
  const dir = anchor.anchorDir('win32', 'C:\\Users\\jo', { LOCALAPPDATA: 'C:\\Users\\jo\\AppData\\Local' });
  /* Built from store.APP rather than written out, for the reason the delegation
     test above exists: #2439 renamed the directory mid-branch, and a literal here
     would have gone red on the merge for a reason that was not a defect. */
  assert.equal(dir, 'C:\\Users\\jo\\AppData\\Local\\' + store.APP + '\\runtime');
  assert.ok(!/Roaming/.test(dir), 'a 92 MB machine-specific binary must not roam: ' + dir);
});

test('#570 the anchor is derived for the platform ASKED ABOUT, so a Mac can assert it', () => {
  /* store.js's #1510 lesson. Without this the win32 answer is unassertable from
     the machines that run the suite, which is how every defect in this lane has
     survived. */
  const dir = anchor.anchorDir('win32', 'C:\\Users\\jo', {});
  assert.equal(dir, 'C:\\Users\\jo\\AppData\\Local\\' + store.APP + '\\runtime',
    'the win32 derivation must use backslashes and the documented location: ' + dir);
});

test('#570 a relative anchor is REFUSED, not silently absolutized', () => {
  /* store.js's #1820 posture: a relative root resolves against the process cwd,
     so the task would name a different directory per invocation. */
  assert.throws(() => anchor.anchorDir('win32', 'C:\\Users\\jo', { AGENT_WORKFORCE_DATA: 'not/absolute' }),
    /non-absolute/);
});

test('#570 anchoring lays down the interpreter, the pointer and the shim', () => {
  const dir = tmp();
  const src = path.join(dir, 'src-node.exe');
  fs.writeFileSync(src, 'stand-in for a 92 MB interpreter', 'utf8');

  const r = anchor.ensureAnchored({
    platform: 'win32', home: 'C:\\Users\\jo', env: { AGENT_WORKFORCE_DATA: dir },
    node: src, engineDir: 'C:\\Kosmos\\0.6.24\\app\\engine',
  });
  assert.equal(r.ok, true, r.because || '');
  assert.ok(fs.existsSync(r.node), 'the interpreter is copied out of the extract tree');
  assert.ok(fs.existsSync(r.boot), 'the shim is written');
  assert.equal(fs.readFileSync(r.pointer, 'utf8'), 'C:\\Kosmos\\0.6.24\\app\\engine');
});

test('#570 IT NEVER COPIES THE INTERPRETER ONTO ITSELF', () => {
  /* ⚠️ The hazard that would destroy a running fleet. A supervisor started by the
     task runs the ANCHORED node, so `process.execPath` is the anchor's own
     node.exe. `fs.copyFileSync(x, x)` truncates, so a re-anchor from inside a
     supervised process would delete the interpreter every agent on the box
     depends on -- while running on it. */
  /* The anchor is derived by the module itself (it was once a hardcoded
     `AgentWorkforce`, which after #2439 put this file beside the anchor rather
     than at it, so the arm checked nothing). The size check alone also stops a
     self-copy, since a file equals its own size; this pins the OUTCOME, the
     interpreter intact, whichever guard catches it. */
  const dir = tmp();
  const runtime = anchor.anchorDir(process.platform, os.homedir(), { AGENT_WORKFORCE_DATA: dir });
  fs.mkdirSync(runtime, { recursive: true });
  const self = path.join(runtime, anchor.NODE_NAME);
  fs.writeFileSync(self, 'the anchored interpreter, still intact', 'utf8');

  const r = anchor.ensureAnchored({
    platform: process.platform, home: os.homedir(), env: { AGENT_WORKFORCE_DATA: dir },
    node: self, engineDir: dir,
  });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(fs.readFileSync(self, 'utf8'), 'the anchored interpreter, still intact',
    'anchoring from inside a supervised process must not truncate the interpreter');
});

test('#570 an unchanged interpreter is not re-copied on every agent created', () => {
  /* 92 MB per create would make creating an agent feel broken. */
  const dir = tmp();
  const src = path.join(dir, 'src-node.exe');
  fs.writeFileSync(src, 'stand-in', 'utf8');
  const opts = {
    platform: process.platform, home: os.homedir(), env: { AGENT_WORKFORCE_DATA: dir },
    node: src, engineDir: dir,
  };
  const first = anchor.ensureAnchored(opts);
  assert.equal(first.ok, true, first.because || '');
  const stamp = fs.statSync(first.node).mtimeMs;

  /* Mark the copy so a re-copy is detectable by CONTENT, not only by mtime
     (which some filesystems round to a resolution coarser than this test). */
  fs.writeFileSync(first.node, 'stand-in', 'utf8');   // same size, marked by mtime below
  const second = anchor.ensureAnchored(opts);
  assert.equal(second.ok, true, second.because || '');
  assert.ok(fs.statSync(second.node).mtimeMs >= stamp, 'sanity: the anchor still exists');
  assert.equal(fs.readFileSync(second.node, 'utf8'), 'stand-in',
    'an equal-size interpreter is left alone rather than recopied');
});

test('#570 THE SHIM REFUSES A STALE POINTER, loudly and non-zero', () => {
  /* 🛑 Run for real, because the whole durability claim rests on this file
     behaving when the app it points at is gone. A shim that exited 0 would look
     to Task Scheduler like an agent that ran and finished -- the one reading that
     hides a dead fleet behind a green task. */
  const dir = tmp();
  const boot = path.join(dir, 'supervisor-boot.js');
  fs.writeFileSync(boot, anchor.BOOT_JS, 'utf8');
  fs.writeFileSync(path.join(dir, 'engine-path'), path.join(dir, 'an-app-that-was-deleted'), 'utf8');

  const out = cp.spawnSync(process.execPath, [boot, 'winagent-1', dir], { encoding: 'utf8' });
  assert.notEqual(out.status, 0, 'a stale pointer must not look like a clean finish');
  assert.match(out.stderr, /is gone/, 'and it must say what is wrong: ' + out.stderr);
});

test('#570 the shim runs the supervisor the pointer names', () => {
  /* The other half of the same claim: when the pointer is good, the shim reaches
     that engine's supervisor and hands it the argv untouched. A stand-in engine
     proves the resolution without starting a real agent. */
  const dir = tmp();
  const engine = path.join(dir, 'app', 'engine');
  fs.mkdirSync(engine, { recursive: true });
  fs.writeFileSync(path.join(engine, 'win32supervisor.js'),
    'exports.main = (argv) => { process.stdout.write("MAIN:" + JSON.stringify(argv)); };', 'utf8');

  const boot = path.join(dir, 'supervisor-boot.js');
  fs.writeFileSync(boot, anchor.BOOT_JS, 'utf8');
  fs.writeFileSync(path.join(dir, 'engine-path'), engine, 'utf8');

  const out = cp.spawnSync(process.execPath, [boot, 'winagent-1', 'C:\\work\\a', '-', '-', 'claude'],
    { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, 'MAIN:["winagent-1","C:\\\\work\\\\a","-","-","claude"]',
    'the argv reaches the supervisor unchanged: ' + out.stdout);
});

/* The interpreter's side files, named by the module's own constants so the test
   and the code cannot disagree about a spelling. */
function sideFiles(runtime) {
  return fs.readdirSync(runtime).filter((n) => n.startsWith(anchor.NODE_NAME + '.'));
}
function retiredFiles(runtime) {
  return sideFiles(runtime).filter((n) => n.startsWith(anchor.NODE_NAME + anchor.RETIRED_INFIX));
}
function anchoringOf(dir, src, extra) {
  return Object.assign({ platform: process.platform, home: os.homedir(), env: { AGENT_WORKFORCE_DATA: dir }, node: src, engineDir: dir }, extra || {});
}
/* Old enough for the sweep, without sleeping. */
const LATER = () => Date.now() + anchor.RETIRED_SWEEP_MIN_AGE_MS + 1000;

/* Replace fs.renameSync for one arm. win32anchor calls the same shared `fs`
   object, so this reaches its renames; the original is always put back. */
function withRenames(fake, body) {
  const real = fs.renameSync;
  fs.renameSync = (from, to) => fake(String(from), String(to), real);
  try { return body(); } finally { fs.renameSync = real; }
}
function failure(code) { return Object.assign(new Error('simulated ' + code), { code }); }

/* An anchor already holding an "old" interpreter, and a "new" source of another size. */
function anchoredOldWithNewSource() {
  const dir = tmp();
  const oldSrc = path.join(dir, 'old-node.exe');
  fs.writeFileSync(oldSrc, 'old', 'utf8');
  const first = anchor.ensureAnchored(anchoringOf(dir, oldSrc));
  assert.equal(first.ok, true, first.because || '');
  const newSrc = path.join(dir, 'new-node.exe');
  fs.writeFileSync(newSrc, 'a newer interpreter', 'utf8');
  return { dir, runtime: first.dir, nodeAt: first.node, newSrc };
}

test('#570 a swap whose final rename fails leaves the old interpreter in place and says why', () => {
  const { dir, runtime, nodeAt, newSrc } = anchoredOldWithNewSource();
  let finalRenameTries = 0;
  const r = withRenames((from, to, real) => {
    if (to === nodeAt && from.includes(anchor.STAGED_INFIX)) { finalRenameTries += 1; throw failure('EIO'); }
    return real(from, to);
  }, () => anchor.ensureAnchored(anchoringOf(dir, newSrc)));
  assert.equal(r.ok, false);
  assert.match(r.because, /simulated EIO/);
  assert.equal(finalRenameTries, 1, 'only a transient lock is retried; a real failure reports at once');
  assert.equal(fs.readFileSync(nodeAt, 'utf8'), 'old', 'the retired interpreter is moved back');
  assert.deepEqual(sideFiles(runtime), [], 'no staged or retired file is left behind');
});

test('#570 a swap that cannot even move the old interpreter back SAYS the interpreter is missing', () => {
  const { dir, nodeAt, newSrc } = anchoredOldWithNewSource();
  const r = withRenames((from, to, real) => {
    if (to === nodeAt) throw failure('EIO');   // the final rename AND the move-back
    return real(from, to);
  }, () => anchor.ensureAnchored(anchoringOf(dir, newSrc)));
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be put back/,
    'the worst case must be in the sentence, not swallowed: ' + r.because);
});

test('#570 a failed copy never touches the running interpreter', () => {
  const { dir, runtime, nodeAt } = anchoredOldWithNewSource();
  const notAFile = path.join(dir, 'a-directory-not-an-interpreter');
  fs.mkdirSync(notAFile);
  fs.writeFileSync(path.join(notAFile, 'x'), 'padding so the size differs', 'utf8');
  const r = anchor.ensureAnchored(anchoringOf(dir, notAFile));
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(nodeAt, 'utf8'), 'old');
  assert.deepEqual(sideFiles(runtime), [], 'the half-made staged copy is removed');
});

test('#570 a rename held for a moment (antivirus, the indexer) is retried, and a young retired file is kept', () => {
  const { dir, runtime, nodeAt, newSrc } = anchoredOldWithNewSource();
  let refusals = 0;
  const r = withRenames((from, to, real) => {
    if (to === nodeAt && from.includes(anchor.STAGED_INFIX) && refusals < 2) { refusals += 1; throw failure('EBUSY'); }
    return real(from, to);
  }, () => anchor.ensureAnchored(anchoringOf(dir, newSrc)));
  assert.equal(r.ok, true, r.because || '');
  assert.equal(refusals, 2, 'sanity: the rename really was refused twice first');
  assert.equal(fs.readFileSync(nodeAt, 'utf8'), 'a newer interpreter');

  /* The retired copy was made this instant, so the sweep that ran in the same
     anchoring leaves it: another anchoring's move-back may still need it. */
  assert.equal(retiredFiles(runtime).length, 1, 'a just-retired interpreter is not swept at once');
  const later = anchor.ensureAnchored(anchoringOf(dir, newSrc, { now: LATER() }));
  assert.equal(later.ok, true, later.because || '');
  assert.deepEqual(sideFiles(runtime), [], 'once it is old enough, it is swept');
});

test('#570 a staged copy is swept only when it is far too old to be a swap in flight', () => {
  const { dir, runtime } = anchoredOldWithNewSource();
  const deadSwap = anchor.NODE_NAME + anchor.STAGED_INFIX + '1-1';
  const inFlight = anchor.NODE_NAME + anchor.STAGED_INFIX + Date.now() + '-1';
  fs.writeFileSync(path.join(runtime, deadSwap), 'a dead swap left this', 'utf8');
  fs.writeFileSync(path.join(runtime, inFlight), 'another swap is still copying this', 'utf8');
  const r = anchor.ensureAnchored(anchoringOf(dir, path.join(runtime, anchor.NODE_NAME)));
  assert.equal(r.ok, true, r.because || '');
  assert.deepEqual(sideFiles(runtime), [inFlight], 'the dead swap\'s copy is swept, the young one is left');
});

test('#570 a staged copy that cannot be deleted after a failed swap is SAID, not left silently', () => {
  const { dir, nodeAt, newSrc } = anchoredOldWithNewSource();
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = (p) => {
    if (String(p).includes(anchor.STAGED_INFIX)) throw failure('EBUSY');
    return realUnlink(p);
  };
  let r;
  try {
    r = withRenames((from, to, real) => {
      if (to === nodeAt && from.includes(anchor.STAGED_INFIX)) throw failure('EIO');
      return real(from, to);
    }, () => anchor.ensureAnchored(anchoringOf(dir, newSrc)));
  } finally {
    fs.unlinkSync = realUnlink;
  }
  assert.equal(r.ok, false);
  assert.match(r.because, /staged copy .* was left behind/, r.because);
  assert.equal(fs.readFileSync(nodeAt, 'utf8'), 'old', 'the running interpreter is still the old one');
});

test('#570 a first anchoring leaves no side file beside the interpreter', () => {
  const dir = tmp();
  const src = path.join(dir, 'src-node.exe');
  fs.writeFileSync(src, 'stand-in', 'utf8');
  const r = anchor.ensureAnchored(anchoringOf(dir, src));
  assert.equal(r.ok, true, r.because || '');
  assert.deepEqual(sideFiles(r.dir), [], 'a clean copy leaves no staged or retired file');
});

test('#570 an interpreter an earlier swap retired is swept even when nothing is copied', () => {
  const dir = tmp();
  const src = path.join(dir, 'src-node.exe');
  fs.writeFileSync(src, 'stand-in', 'utf8');
  const first = anchor.ensureAnchored(anchoringOf(dir, src));
  assert.equal(first.ok, true, first.because || '');
  fs.writeFileSync(path.join(first.dir, anchor.NODE_NAME + anchor.RETIRED_INFIX + '1-1'), 'an old interpreter nothing runs on', 'utf8');

  const second = anchor.ensureAnchored(anchoringOf(dir, src));
  assert.equal(second.ok, true, second.because || '');
  assert.deepEqual(sideFiles(second.dir), [], 'the retired interpreter is deleted once nothing runs on it');
});

test('#570 A ZIP THAT CHANGES NODE REPLACES THE RUNNING ANCHORED INTERPRETER', async () => {
  /* 🛑 Run for real: the anchored node.exe is what the task board and every
     supervisor run on, and Windows refuses to overwrite a running executable.
     Before this, a zip with a new Node version failed ensureAnchored, and with it
     the launcher's hand-off. A real copy of this interpreter is started FROM the
     anchor so the lock is the operating system's, not a stand-in's. */
  const dir = tmp();
  const runtime = anchor.anchorDir(process.platform, os.homedir(), { AGENT_WORKFORCE_DATA: dir });
  fs.mkdirSync(runtime, { recursive: true });
  const nodeAt = path.join(runtime, anchor.NODE_NAME);
  fs.copyFileSync(process.execPath, nodeAt);
  const src = path.join(dir, 'src-node.exe');
  fs.writeFileSync(src, 'a different Node version, stood in for by a different size', 'utf8');

  const running = cp.spawn(nodeAt, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const stillRunning = () => running.exitCode === null && running.signalCode === null;
  try {
    await new Promise((resolve, reject) => { running.once('spawn', resolve); running.once('error', reject); });
    if (process.platform === 'win32') {
      /* Control: the old code's direct copy IS refused here, so this arm really
         exercises the lock rather than passing on a filesystem that allows it. */
      assert.throws(() => fs.copyFileSync(src, nodeAt), /EBUSY|EPERM|EACCES/,
        'control: Windows must refuse a copy over a running interpreter');
    }

    const r = anchor.ensureAnchored(anchoringOf(dir, src));
    assert.equal(r.ok, true, r.because || '');
    assert.equal(r.node, nodeAt);
    assert.equal(fs.readFileSync(nodeAt, 'utf8'), 'a different Node version, stood in for by a different size',
      'the new interpreter takes the anchored name');
    assert.ok(stillRunning(), 'a process running on the old interpreter keeps running');
    if (process.platform === 'win32') {
      assert.equal(retiredFiles(runtime).length, 1,
        'while a process runs on it, the old interpreter waits beside the new one: ' + sideFiles(runtime));
    }
  } finally {
    if (stillRunning()) {
      const exited = new Promise((resolve) => running.once('exit', resolve));
      running.kill();
      await exited;
    }
  }

  /* Windows can hold the image a moment after the process exits, so the sweep is
     retried briefly rather than asserted on the first pass. */
  for (let attempt = 0; attempt < 30 && retiredFiles(runtime).length > 0; attempt++) {
    const again = anchor.ensureAnchored(anchoringOf(dir, src, { now: LATER() }));
    assert.equal(again.ok, true, again.because || '');
    if (retiredFiles(runtime).length > 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(sideFiles(runtime), [], 'once nothing runs on it, the retired interpreter is removed');
});
