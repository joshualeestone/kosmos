'use strict';
/**
 * #7247: a test run on a Windows computer is kept off its real Task Scheduler by tools/no-schtasks-preload.cjs, which
 * tools/windows-tests.js (and tools/run-tests.sh) load by themselves there, except on CI and when
 * KOSMOS_TESTS_REAL_SCHTASKS=1 asks for the real scheduler. The rule is pure and runs on every platform; the preload
 * is loaded into a real child process the way the runner loads it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const wt = require('./tools/windows-tests');

const WIN_DEV = { PATH: process.env.PATH || '' };   // a Windows computer that is not CI

test('#7247: on a Windows computer that is not CI, every test file loads the preload, with forward slashes', () => {
  const env = wt.childEnv(WIN_DEV, 'win32');
  assert.equal(env.NODE_OPTIONS, '--require "' + wt.PRELOAD.replace(/\\/g, '/') + '"');
  assert.doesNotMatch(env.NODE_OPTIONS, /\\/, 'NODE_OPTIONS reads a backslash inside quotes as an escape');
  assert.equal(env.PATH, WIN_DEV.PATH, 'the rest of the environment is kept');
});

test('#7247: an existing NODE_OPTIONS is kept, and the preload is not added twice', () => {
  const once = wt.childEnv({ NODE_OPTIONS: '--max-old-space-size=4096' }, 'win32');
  assert.match(once.NODE_OPTIONS, /^--max-old-space-size=4096 --require "/);
  assert.equal(wt.childEnv(once, 'win32').NODE_OPTIONS, once.NODE_OPTIONS);
});

test('#7247: CI, an explicit ask for the real scheduler, and every other platform are left as they were', () => {
  for (const [env, platform] of [[{ CI: 'true' }, 'win32'], [{ KOSMOS_TESTS_REAL_SCHTASKS: '1' }, 'win32'], [{}, 'darwin'], [{}, 'linux']]) {
    assert.equal(wt.childEnv(env, platform), env, JSON.stringify([env, platform]));
    assert.equal(wt.guardsScheduler(env, platform), false);
  }
  // CONTROL: the same computer without those asks is guarded
  assert.equal(wt.guardsScheduler({ KOSMOS_TESTS_REAL_SCHTASKS: '0' }, 'win32'), true);
});

test('#7247: a child started with that environment has schtasks refused, and runs everything else', () => {
  const env = { ...process.env, ...wt.childEnv(WIN_DEV, 'win32') };
  delete env.NODE_TEST_CONTEXT;   // the child is a plain script, not a test file
  const probe = 'const cp = require("node:child_process");'
    /* The name is put together inside the child: this test may itself run under the preload (the runner loads it), and
       a command line naming the program would be refused here before the child could start. */
    + 'const name = ["sch", "tasks"].join("");'
    + 'const r = cp.spawnSync(name, ["/query"]);'
    + 'let thrown = ""; try { cp.execFileSync(name + ".exe", ["/query"]); } catch (e) { thrown = e.message; }'
    + 'const other = cp.spawnSync(process.execPath, ["-e", "process.stdout.write(\\"ran\\")"], { encoding: "utf8" });'
    + 'process.stdout.write(JSON.stringify({ spawn: r.error && r.error.message, execFile: thrown, other: other.stdout }));';
  const out = cp.execFileSync(process.execPath, ['-e', probe], { env, encoding: 'utf8' });
  const got = JSON.parse(out);
  assert.match(got.spawn, /blocked by the test suite preload/);
  assert.match(got.execFile, /blocked by the test suite preload/);
  assert.equal(got.other, 'ran', 'a program that is not schtasks still runs');
});
