'use strict';
/**
 * #570: create.js starts a Windows agent through the win32 substrate, not launchd.
 *
 * `installJob` is where a Mac agent gets its launchd job: install the supervisor
 * script, write a `.plist`, `launchctl enable`, `launchctl bootstrap`. None of
 * those exist on Windows. These arms pin that the win32 branch takes over the
 * whole of that, and -- more importantly -- that it does NOT reach any of it.
 *
 * 🛑 THE PLATFORM IS INJECTED (`opts.platform`) SO A MAC CAN DRIVE BOTH SIDES.
 * A branch that hard-read `process.platform` would be unexercised on this fleet,
 * which is exactly how the defects in this lane survived: the suite goes green
 * and says nothing at all about the platform it is about.
 *
 *   node --test engine/create.win32-launch-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'create-win32-570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));

const create = require('./create');
const launcher = require('./win32launch');

test.after(() => {
  /* ⚠️ ORDER, AND create.js WILL TELL YOU IF YOU GET IT WRONG. It refuses to
     leave dry-run with no injected runner ("this would create real agents"), so
     nulling the runner and THEN clearing dry-run throws out of the teardown --
     which surfaces as a file-level failure with every arm green, a confusing
     shape. `setRunner(null)` re-arms dry-run by itself, so that is all that is
     needed and the explicit setDryRun is simply wrong here. */
  launcher.setSpawn(null);
  create.setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const REAL_BIN = process.execPath;   // exists and is runnable on every platform

function agentFolder(name) {
  const d = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function recordingSpawn() {
  const calls = [];
  launcher.setSpawn((cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return { pid: 777, unref() {} }; });
  return calls;
}

test('#570 asked about win32, installJob launches through the substrate and NEVER touches launchd', () => {
  const calls = recordingSpawn();
  const ranMacCommands = [];
  create.setRunner((bin, args) => { ranMacCommands.push(bin + ' ' + (args || []).join(' ')); return { ok: true }; });
  create.setDryRun(false);
  agentFolder('winjob');

  const r = create.installJob('winjob', {
    platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN, model: 'haiku',
  });

  assert.equal(r.ok, true, r.because || '');
  assert.equal(r.started, true);
  assert.equal(calls.length, 1, 'the agent was spawned through win32launch');

  /* 🛑 THE LOAD-BEARING NEGATIVE. The Mac path shells `launchctl enable` and
     `launchctl bootstrap`; on Windows there is no launchd and those calls would
     fail AFTER the caller had been told the job was installed. Asserting that
     something EXPECTED is present would not catch that -- this asserts the
     unexpected is ABSENT, which is the asymmetry this lane keeps paying for. */
  assert.deepEqual(ranMacCommands.filter((c) => /launchctl/.test(c)), [],
    'no launchctl on Windows');
  assert.equal(fs.existsSync(path.join(SANDBOX, 'Library')), false,
    'and no LaunchAgents/plist tree was created');
});

test('#570 the same call on darwin still takes the launchd path', () => {
  /* The control. Without it the arm above passes for a branch that simply never
     runs anything, and this file would be asserting its own emptiness. */
  const calls = recordingSpawn();
  const ran = [];
  create.setRunner((bin, args) => { ran.push(bin + ' ' + (args || []).join(' ')); return { ok: true }; });
  create.setDryRun(false);
  agentFolder('macjob');

  const r = create.installJob('macjob', {
    platform: 'darwin', claudeBin: REAL_BIN, tmuxBin: REAL_BIN,
  });

  /* This half runs everywhere and is the one that matters: whatever darwin does,
     it must not be routed through the Windows substrate. */
  assert.equal(calls.length, 0, 'darwin does NOT go through the win32 launcher');

  /* ⚠️ THE launchctl HALF ONLY RUNS ON A MAC, and saying so is the point rather
     than an excuse. On Windows `process.getuid` is UNDEFINED, so the enable/
     bootstrap calls throw, the surrounding try/catch swallows it (by design --
     "the job stays either way"), and installJob still returns ok:true having run
     no launchctl at all. Asserting the positive here would therefore fail on
     Windows for a reason that has nothing to do with this branch. Gated on the
     HOST, not on the injected platform, because it is a fact about the machine
     running the test. */
  if (process.platform === 'darwin') {
    assert.ok(ran.some((c) => /launchctl/.test(c)) || r.ok === false,
      'on a Mac the darwin path is still the launchd one');
  }
});

test('#570 DRY_RUN spawns nothing on win32', () => {
  const calls = recordingSpawn();
  create.setDryRun(true);
  agentFolder('dry');
  const r = create.installJob('dry', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  create.setDryRun(false);
  assert.equal(r.ok, true, r.because || '');
  assert.equal(calls.length, 0, 'a dry run must not start a real agent');
});

test('#570 a refused launch is reported, not swallowed into a started agent', () => {
  launcher.setSpawn(() => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; });
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  agentFolder('failing');
  const r = create.installJob('failing', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(r.ok, false, 'a spawn that threw must not read as an installed job');
  assert.match(String(r.because), /could not start it/);
});

test('#570 the win32 sentence does not promise a durability this substrate lacks', () => {
  const calls = recordingSpawn();
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  agentFolder('sentence');
  const r = create.installJob('sentence', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(calls.length, 1);
  /* The Mac says "set up to start at every login" because launchd makes that
     true. There is no launchd job here and keep-alive is a later slice, so a
     Windows agent does NOT come back by itself -- claiming it would be a
     promise the substrate cannot keep. */
  assert.doesNotMatch(String(r.because), /login/,
    'no login-persistence claim until there is something that delivers it');
});
