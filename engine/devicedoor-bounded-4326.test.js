'use strict';
/*
 * #4326: the door's status probe must ALWAYS end. execFile's `timeout` sent SIGTERM and nothing
 * after it, so a CLI that ignored SIGTERM kept running with its callback never called (a
 * `vercel whoami` orphan ran 2h39m at ~600 MB on 2026-09-28). runBounded answers at the timeout
 * and then kills the child, SIGTERM then SIGKILL; the child stays in the board's process group so
 * it also dies with the board.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBounded } = require('./devicedoor');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-door-4326-'));
test.after(() => { fs.rmSync(DIR, { recursive: true, force: true }); });

function script(name, body) {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, '#!/bin/sh\n' + body + '\n');
  fs.chmodSync(p, 0o755);
  return p;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const run = (bin, args, opts) => new Promise((resolve) => {
  const t0 = Date.now();
  let child = null;
  child = runBounded(bin, args, opts, (code, text) => resolve({ code, text, ms: Date.now() - t0, pid: child && child.pid }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('#4326 a child that IGNORES SIGTERM is answered at the timeout and then SIGKILLed', async () => {
  const stub = script('stubborn.sh', "trap '' TERM\nwhile :; do sleep 1; done");
  const r = await run(stub, [], { timeoutMs: 400, graceMs: 300 });
  try {
    assert.equal(r.code, -1, 'a timed-out probe must answer -1 (not connected), as execFile did');
    assert.ok(r.ms >= 350 && r.ms < 2000, `the answer must come at the timeout, not before or long after: ${r.ms} ms`);
    assert.ok(r.pid > 0, 'no child pid (premise)');
    await wait(1500);   // past the grace: SIGKILL has gone
    assert.equal(alive(r.pid), false, 'the SIGTERM-ignoring child outlived timeout + grace (the #4326 orphan)');
  } finally {
    // If the fix regresses, the stub loops forever and its open pipes would keep THIS test
    // process alive: the test would hang and leak the very orphan it guards against (a
    // mutant without the SIGKILL did exactly that). Kill it here so a regression FAILS.
    if (r.pid) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});

test('#4326 the probe dies WITH the board: it stays in the board\'s process group', async () => {
  // A "board" in its own process group starts a probe that ignores SIGTERM and never ends, then
  // its whole group is killed, as launchd does to a job that exits. A detached probe (its own
  // group) would survive that, and with the board gone nothing would ever kill it.
  const { spawn } = require('node:child_process');
  const stub = script('forever.sh', "trap '' TERM\nwhile :; do sleep 1; done");
  const pidFile = path.join(DIR, 'probe.pid');
  const board = spawn(process.execPath, ['-e',
    `const { runBounded } = require(${JSON.stringify(require.resolve('./devicedoor'))});
     const c = runBounded(${JSON.stringify(stub)}, [], { timeoutMs: 60000 }, () => {});
     require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
     setInterval(() => {}, 1000);`], { detached: true, stdio: 'ignore' });
  let probe = 0;
  try {
    for (let i = 0; i < 50 && !probe; i += 1) { await wait(100); try { probe = Number(fs.readFileSync(pidFile, 'utf8')); } catch { probe = 0; } }
    assert.ok(probe > 0 && alive(probe), 'the board never started its probe (premise)');
    process.kill(-board.pid, 'SIGKILL');   // the board's whole group, as launchd reaps a job
    await wait(500);
    assert.equal(alive(probe), false, 'the probe outlived its board: it is not in the board\'s process group (detached?)');
  } finally {
    for (const target of [-board.pid, board.pid, probe]) { if (target) { try { process.kill(target, 'SIGKILL'); } catch { /* gone */ } } }
  }
});

/* #4656: the arms below test WHAT the answer is, not how fast it comes, so their budget is one a saturated box
   cannot reach (a 0.2s script hit a 5s budget once, at load 9.7 on 10 cores with the disk full). Only the flood
   and spawn-failure arms keep short bounds, because there the time IS the claim. */
const NOT_A_SPEED_TEST = 30000;

test('#4326 control: a probe that finishes answers its real exit code and output, untouched', async () => {
  const ok = script('ok.sh', 'echo "Logged in to github.com account octo"; exit 0');
  const r = await run(ok, [], { timeoutMs: NOT_A_SPEED_TEST });
  assert.equal(r.code, 0);
  assert.match(r.text, /Logged in to github\.com account octo/);
  const no = script('no.sh', 'echo "not logged in" >&2; exit 1');
  const r2 = await run(no, [], { timeoutMs: NOT_A_SPEED_TEST });
  assert.equal(r2.code, 1, 'a non-zero exit must pass through, as execFile\'s err.code did');
  assert.match(r2.text, /not logged in/, 'stderr must reach the answer, as before');
});

/* Which stream the probe's child delivered first, seen from the test's own listeners (runBounded hands back the child
   before any data can arrive). */
const runSeen = (bin, opts) => new Promise((resolve) => {
  const seen = [];
  const child = runBounded(bin, [], opts, (code, text) => resolve({ code, text, first: seen[0] }));
  if (child) for (const name of ['stdout', 'stderr']) child[name].on('data', () => { if (!seen.includes(name)) seen.push(name); });
});

test('#4326 the answer is stdout THEN stderr, as execFile gave it, whatever order they arrive in', async () => {
  // The Vercel door's loginRe takes the first single-token line; interleaving by arrival would
  // let a one-word stderr line that came first become the "login".
  // #4656: the order is checked both ways round, and the case that matters (stderr ARRIVING first) is repeated
  // until it was seen to arrive first, so neither a slow box nor a lucky order can make this pass without testing it.
  const errFirst = script('both.sh', 'echo warning >&2; sleep 0.2; echo octo; exit 0');
  let r = null;
  for (let tries = 0; tries < 5 && !(r && r.first === 'stderr'); tries += 1) {
    r = await runSeen(errFirst, { timeoutMs: NOT_A_SPEED_TEST });
    assert.equal(r.code, 0);
    assert.equal(r.text, 'octo\nwarning\n', 'stdout must come before stderr in the answer (stderr arrived ' + (r.first === 'stderr' ? 'first' : 'second') + ')');
  }
  assert.equal(r.first, 'stderr', 'PREMISE: in 5 runs stderr never arrived first, so the reordering was never tested');
  const outFirst = script('both-out-first.sh', 'echo octo; sleep 0.2; echo warning >&2; exit 0');
  const r2 = await runSeen(outFirst, { timeoutMs: NOT_A_SPEED_TEST });
  assert.equal(r2.code, 0);
  assert.equal(r2.text, 'octo\nwarning\n', 'stdout must come before stderr in the answer when stdout arrives first too');
});

test('#4326 a probe that floods past 1 MB is stopped at once, as execFile\'s maxBuffer did', async () => {
  // Prints ~2 MB (of NUL bytes: the tr only maps backslash and 0, which is fine, the size is what
  // counts), then would hang: it must be answered and killed long before the timeout.
  const flood = script('flood.sh', "trap '' TERM\nhead -c 2200000 /dev/zero | tr '\\\\0' 'x'\nwhile :; do sleep 1; done");
  const r = await run(flood, [], { timeoutMs: 20000, graceMs: 300 });
  try {
    assert.equal(r.code, -1, 'an overflow must answer -1');
    assert.ok(r.ms < 5000, `an overflow must stop the probe at once, not at the timeout: ${r.ms} ms`);
    assert.ok(r.text.length <= 1024 * 1024, `the answer must be capped at 1 MB: ${r.text.length}`);
    await wait(1000);
    assert.equal(alive(r.pid), false, 'the flooding child was not killed');
  } finally {
    if (r.pid) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});

test('#4326 a binary that cannot be spawned answers -1 once, never hangs', async () => {
  const r = await run(path.join(DIR, 'does-not-exist'), [], { timeoutMs: 5000 });
  assert.equal(r.code, -1);
  assert.ok(r.ms < 2000, `a spawn failure must answer at once: ${r.ms} ms`);
});
