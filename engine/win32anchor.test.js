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

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-anchor-')); }

test('#570 the runtime anchors in LOCAL AppData, never Roaming', () => {
  /* 🛑 A deliberate split from store.dataRootFor, which roams on purpose so a
     person's config follows them to another machine on a domain. node.exe is
     92 MB and architecture-specific: roaming it would push 92 MB through a
     domain profile and could land an x64 binary on a machine that cannot run it.
     Config roams; the runtime does not. */
  const dir = anchor.anchorDir('win32', 'C:\\Users\\jo', { LOCALAPPDATA: 'C:\\Users\\jo\\AppData\\Local' });
  assert.match(dir, /AppData\\Local\\AgentWorkforce\\runtime$/);
  assert.ok(!/Roaming/.test(dir), 'a 92 MB machine-specific binary must not roam: ' + dir);
});

test('#570 the anchor is derived for the platform ASKED ABOUT, so a Mac can assert it', () => {
  /* store.js's #1510 lesson. Without this the win32 answer is unassertable from
     the machines that run the suite, which is how every defect in this lane has
     survived. */
  const dir = anchor.anchorDir('win32', 'C:\\Users\\jo', {});
  assert.match(dir, /^C:\\Users\\jo\\AppData\\Local\\AgentWorkforce\\runtime$/,
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
  const dir = tmp();
  const runtime = path.join(dir, 'AgentWorkforce', 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const self = path.join(runtime, 'node.exe');
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
