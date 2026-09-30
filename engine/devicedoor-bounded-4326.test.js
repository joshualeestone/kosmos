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
/* #4656: `ms` counts from when the child has been spawned, not from before the spawn: a saturated box can take
   seconds to spawn a shell, and that time is the box's, not the probe's. (Only a spawn that THROWS answers inside
   runBounded, before the clock restarts; a missing binary answers later, through the child's error event.) */
const run = (bin, args, opts) => new Promise((resolve) => {
  let t0 = Date.now();
  let child = null;
  let answered = false;
  child = runBounded(bin, args, opts, (code, text) => { answered = true; resolve({ code, text, ms: Date.now() - t0, pid: child && child.pid }); });
  if (!answered) t0 = Date.now();
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* #4656: wait until `pid` is gone, for as long as a saturated box could need, and answer whether it went. A fixed
   wait passed on an idle box and failed a correct kill on a busy one. */
async function gone(pid, ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (!alive(pid)) return true;
  return !alive(pid);
}

test('#4326 a child that IGNORES SIGTERM is answered at the timeout and then SIGKILLed', async () => {
  const stub = script('stubborn.sh', "trap '' TERM\nwhile :; do sleep 1; done");
  const r = await run(stub, [], { timeoutMs: 400, graceMs: 300 });
  try {
    assert.equal(r.code, -1, 'a timed-out probe must answer -1 (not connected), as execFile did');
    // #4656: "not before" is the claim (350 ms); the upper bound only has to tell "at the timeout" from "never",
    // with room for a stalled event loop.
    assert.ok(r.ms >= 350 && r.ms < 400 + 5000, `the answer must come at the timeout, not before or long after: ${r.ms} ms`);
    assert.ok(r.pid > 0, 'no child pid (premise)');
    assert.equal(await gone(r.pid), true, 'the SIGTERM-ignoring child outlived timeout + grace (the #4326 orphan)');
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
    // #4656: up to 30 s for the board to start its probe (a node start plus a require), not 5.
    for (let i = 0; i < 300 && !probe; i += 1) { await wait(100); try { probe = Number(fs.readFileSync(pidFile, 'utf8')); } catch { probe = 0; } }
    assert.ok(probe > 0 && alive(probe), 'the board never started its probe (premise)');
    process.kill(-board.pid, 'SIGKILL');   // the board's whole group, as launchd reaps a job
    assert.equal(await gone(probe), true, 'the probe outlived its board: it is not in the board\'s process group (detached?)');
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
/* Runs `bin` until the stream `want` was SEEN to arrive first (at most 20 tries), checking the answer on every try. */
async function answerWhenFirst(bin, want) {
  let r = null;
  // 20 tries (about 0.2 s each): a child stalled across its 0.2 s sleep hands both writes over in one poll, in
  // libuv's order, so a few tries in a row can miss on a saturated box (review 2).
  for (let tries = 0; tries < 20 && !(r && r.first === want); tries += 1) {
    r = await runSeen(bin, { timeoutMs: NOT_A_SPEED_TEST });
    assert.equal(r.code, 0);
    assert.equal(r.text, 'octo\nwarning\n', 'stdout must come before stderr in the answer (first to arrive: ' + r.first + ')');
  }
  assert.equal(r.first, want, 'PREMISE: in 20 runs ' + want + ' never arrived first, so that order was never tested');
}

test('#4326 the answer is stdout THEN stderr, as execFile gave it, whatever order they arrive in', async () => {
  // The Vercel door's loginRe takes the first single-token line; interleaving by arrival would
  // let a one-word stderr line that came first become the "login".
  // #4656: the order is checked both ways round, and the case that matters (stderr ARRIVING first) is repeated
  // until it was seen to arrive first, so neither a slow box nor a lucky order can make this pass without testing it.
  // Both halves are checked the same way: an answer that puts the LAST stream to arrive first passes the
  // stderr-first half and is caught only by the stdout-first one (review 1).
  await answerWhenFirst(script('both.sh', 'echo warning >&2; sleep 0.2; echo octo; exit 0'), 'stderr');
  await answerWhenFirst(script('both-out-first.sh', 'echo octo; sleep 0.2; echo warning >&2; exit 0'), 'stdout');
});

test('#4326 a probe that floods past 1 MB is stopped at once, as execFile\'s maxBuffer did', async () => {
  // Prints ~2 MB (of NUL bytes: the tr only maps backslash and 0, which is fine, the size is what
  // counts), then would hang: it must be answered and killed long before the timeout.
  const flood = script('flood.sh', "trap '' TERM\nhead -c 2200000 /dev/zero | tr '\\\\0' 'x'\nwhile :; do sleep 1; done");
  // #4656: the claim is "stopped by the overflow, well before the timeout", so the bound is a third of a long
  // timeout rather than a fixed speed a saturated box could miss.
  const r = await run(flood, [], { timeoutMs: NOT_A_SPEED_TEST, graceMs: 300 });
  try {
    assert.equal(r.code, -1, 'an overflow must answer -1');
    assert.ok(r.ms < NOT_A_SPEED_TEST / 3, `an overflow must stop the probe at once, not at the timeout: ${r.ms} ms`);
    assert.ok(r.text.length <= 1024 * 1024, `the answer must be capped at 1 MB: ${r.text.length}`);
    await wait(1000);
    assert.equal(alive(r.pid), false, 'the flooding child was not killed');
  } finally {
    if (r.pid) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});

test('#4326 a binary that cannot be spawned answers -1 once, never hangs', async () => {
  const r = await run(path.join(DIR, 'does-not-exist'), [], { timeoutMs: NOT_A_SPEED_TEST });
  assert.equal(r.code, -1);
  // A regression net, not a speed check: only an answer that waits for the timeout (a hang) fails it.
  assert.ok(r.ms < NOT_A_SPEED_TEST / 3, `a spawn failure must answer, not wait for the timeout: ${r.ms} ms`);
});
