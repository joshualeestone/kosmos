'use strict';
/* test-support/tmpscope.js (kosmos#4273): one require contains a test process's
   temp dirs, including its children's, and removes them at exit and on a signal.
   Each case runs a REAL child node process against a fresh base directory, with a
   control that does not require the scope and must leave its directory behind. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const SCOPE = path.join(__dirname, 'test-support', 'tmpscope.js');

function freshBase(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tsc-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}
const entries = (d) => fs.readdirSync(d);

const MAKE = `const fs=require('fs'),os=require('os'),path=require('path');
fs.mkdtempSync(path.join(os.tmpdir(),'fixture-'));`;

test('a raw mkdtemp is removed when the process exits; without the scope it stays (control)', (t) => {
  const base = freshBase(t);
  const scoped = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCOPE)});${MAKE}`], { env: { ...process.env, TMPDIR: base } });
  assert.equal(scoped.status, 0, String(scoped.stderr));
  assert.deepEqual(entries(base), [], 'the scoped process left something behind');
  const bare = spawnSync(process.execPath, ['-e', MAKE], { env: { ...process.env, TMPDIR: base } });
  assert.equal(bare.status, 0, String(bare.stderr));
  assert.equal(entries(base).filter((n) => n.startsWith('fixture-')).length, 1, 'the control did not leak, so this test cannot see a leak');
});

test("a child process's mkdtemp is contained too (it inherits the scoped TMPDIR)", (t) => {
  const base = freshBase(t);
  const child = `require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(MAKE)}]);`;
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCOPE)});${child}`], { env: { ...process.env, TMPDIR: base } });
  assert.equal(r.status, 0, String(r.stderr));
  assert.deepEqual(entries(base), [], 'the grandchild left something behind');
});

test('SIGTERM removes the scope and the process still dies by SIGTERM', { timeout: 15000 }, async (t) => {
  const base = freshBase(t);
  const code = `require(${JSON.stringify(SCOPE)});${MAKE}console.log('ready');setInterval(()=>{},1000);`;
  const c = spawn(process.execPath, ['-e', code], { env: { ...process.env, TMPDIR: base }, stdio: ['ignore', 'pipe', 'pipe'] });
  /* A failed assertion must not leave the child running (it would hold the file open). */
  t.after(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((res, rej) => {
    c.stdout.on('data', (b) => { if (String(b).includes('ready')) res(); });
    c.on('exit', () => rej(new Error('the child exited before it was ready')));
  });
  assert.equal(entries(base).length, 1, 'the scope dir should exist while the process runs');
  const ended = new Promise((res) => c.on('exit', (code2, sig) => res({ code: code2, sig })));
  c.kill('SIGTERM');
  const { sig } = await ended;
  assert.equal(sig, 'SIGTERM', 'the process should still end by the signal it was sent');
  assert.deepEqual(entries(base), [], 'a SIGTERM left the scope dir behind');
});

test('the scope name is short, so a tmux socket path under it still fits', () => {
  // `kts-` plus six characters: under ten added, as run-tests.sh budgets for.
  assert.match(fs.readFileSync(SCOPE, 'utf8'), /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'kts-'\)\)/);
});
