'use strict';
/*
 * #4326: the door's status probe must ALWAYS end. execFile's `timeout` sent SIGTERM and nothing
 * after it, so a CLI that ignored SIGTERM kept running with its callback never called (a
 * `vercel whoami` orphan ran 2h39m at ~600 MB on 2026-09-28). runBounded answers at the timeout
 * and then kills the child's whole process group, SIGTERM then SIGKILL.
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

test('#4326 a child that IGNORES SIGTERM is answered at the timeout and then killed, with its children', async () => {
  // It records its own background child's pid, so the test can see the whole GROUP go.
  const kidFile = path.join(DIR, 'kid.pid');
  const stub = script('stubborn.sh', `trap '' TERM\nsleep 300 &\necho $! > '${kidFile}'\nwhile :; do sleep 1; done`);
  const r = await run(stub, [], { timeoutMs: 400, graceMs: 300 });
  let kid = 0;
  try { kid = Number(fs.readFileSync(kidFile, 'utf8').trim()); } catch { kid = 0; }
  try {
    assert.equal(r.code, -1, 'a timed-out probe must answer -1 (not connected), as execFile did');
    assert.ok(r.ms >= 350 && r.ms < 2000, `the answer must come at the timeout, not before or long after: ${r.ms} ms`);
    assert.ok(r.pid > 0, 'no child pid (premise)');
    assert.ok(kid > 0, 'the stub never started its own child (premise)');
    await wait(1500);   // past the grace: SIGKILL has gone to the group
    assert.equal(alive(r.pid), false, 'the SIGTERM-ignoring child outlived timeout + grace (the #4326 orphan)');
    assert.equal(alive(kid), false, 'the child\'s own child outlived the group kill');
  } finally {
    // If the fix regresses, the stub loops forever and its open pipes would keep THIS test
    // process alive: the test would hang and leak the very orphan it guards against (a
    // mutant without the SIGKILL did exactly that). Kill it here so a regression FAILS.
    for (const target of [-r.pid, r.pid, kid]) { if (target) { try { process.kill(target, 'SIGKILL'); } catch { /* gone */ } } }
  }
});

test('#4326 control: a probe that finishes answers its real exit code and output, untouched', async () => {
  const ok = script('ok.sh', 'echo "Logged in to github.com account octo"; exit 0');
  const r = await run(ok, [], { timeoutMs: 5000 });
  assert.equal(r.code, 0);
  assert.match(r.text, /Logged in to github\.com account octo/);
  const no = script('no.sh', 'echo "not logged in" >&2; exit 1');
  const r2 = await run(no, [], { timeoutMs: 5000 });
  assert.equal(r2.code, 1, 'a non-zero exit must pass through, as execFile\'s err.code did');
  assert.match(r2.text, /not logged in/, 'stderr must reach the answer, as before');
});

test('#4326 a binary that cannot be spawned answers -1 once, never hangs', async () => {
  const r = await run(path.join(DIR, 'does-not-exist'), [], { timeoutMs: 5000 });
  assert.equal(r.code, -1);
  assert.ok(r.ms < 2000, `a spawn failure must answer at once: ${r.ms} ms`);
});
