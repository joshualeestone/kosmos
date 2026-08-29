'use strict';

/**
 * #1494: log what a ping would have been, ping nobody.
 *
 *   node --test engine/wouldping.test.js
 *
 * 🛑 THE MEASUREMENT THIS EXISTS FOR. The phone seam has one live trigger and it
 * is an agent choosing to TYPE `kosmos report needs_you`: 23 times in 31,266
 * self-report entries, and ZERO of those written automatically. The automatic
 * trigger cannot fire, because it hangs off `PermissionRequest` and every
 * supervisor launch path passes `--dangerously-skip-permissions`.
 *
 * ⇒ Whether a scraped red should reach a phone is a product decision, and it
 * cannot be made without knowing how often that would happen. Nothing wrote that
 * down, because a scraped verdict is recomputed per read and never stored.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 🛑 SANDBOXED BEFORE THE MODULE IS REQUIRED, AND I NEEDED THIS. My first smoke
   test of this module ran unsandboxed and wrote a real line into the operator's
   Application Support directory, which is exactly the defect #1443 was filed
   for, committed by me an hour after fixing it. */
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wouldping-'));
process.env.AGENT_WORKFORCE_DATA = SB;
const wouldping = require('./wouldping');

test.beforeEach(() => { wouldping.reset(); try { fs.rmSync(wouldping.dirFor(), { recursive: true, force: true }); } catch { /* fresh */ } });
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

test('a scraped needs_you TRANSITION is logged', () => {
  assert.equal(wouldping.saw('a', 'idle', {}), false, 'idle should not log');
  assert.equal(wouldping.saw('a', 'needs_you', { reported: false, confidence: 'scraped' }), true,
    'moving into a scraped needs_you was not logged, so the number this exists for stays unmeasurable');
  const rows = wouldping.read().filter((r) => r.wouldHavePinged);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent, 'a');
  assert.equal(rows[0].from, 'idle');
  assert.equal(rows[0].wouldHavePinged, true);
});

test('🛑 NOBODY IS PINGED, and that is the whole design', () => {
  /* The module must not be able to notify. A future edit that "helpfully" wires
     it to the seam turns a measurement into a 3am phone call nobody decided on. */
  const src = fs.readFileSync(require.resolve('./wouldping'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]\.\/notify['"]\)/, 'it now requires the notify module');
  assert.doesNotMatch(src, /\bfetch\s*\(|https?:\/\//, 'it now reaches the network');
  assert.doesNotMatch(src, /happened\s*\(/, 'it now calls the phone seam');
});

test('a REPORTED needs_you is not counted, because it already reaches the seam', () => {
  /* Counting it would inflate the very number this exists to measure with events
     that are already covered. */
  assert.equal(wouldping.saw('b', 'needs_you', { reported: true }), false);
  assert.equal(wouldping.read().filter((r) => r.wouldHavePinged).length, 0);
});

test('staying in needs_you logs once, not once per read', () => {
  /* `snapshot()` is called from 44 sites in server.js and runs on every board
     poll. A line per READ would be a log nobody could use. */
  wouldping.saw('c', 'idle', {});
  assert.equal(wouldping.saw('c', 'needs_you', { reported: false }), true);
  for (let i = 0; i < 20; i += 1) wouldping.saw('c', 'needs_you', { reported: false });
  assert.equal(wouldping.read().filter((r) => r.wouldHavePinged).length, 1, 'a held state logged more than once');
});

test('leaving and returning logs again, because that is a second event', () => {
  wouldping.saw('d', 'needs_you', { reported: false });
  wouldping.saw('d', 'working', {});
  wouldping.saw('d', 'needs_you', { reported: false });
  assert.equal(wouldping.read().filter((r) => r.wouldHavePinged).length, 2);
});

test('every line carries the boot it belongs to, so nobody sums across restarts', () => {
  /* ⚠️ The previous state lives in memory, so a restart re-arms every agent and
     the first read after one can log a continuation as a transition. Honest for
     a RATE, wrong for a TOTAL, and the field is how a reader knows. */
  wouldping.saw('e', 'needs_you', { reported: false });
  const first = wouldping.read().filter((r) => r.wouldHavePinged)[0].sinceBoot;
  wouldping.reset();
  wouldping.saw('e', 'needs_you', { reported: false });
  const rows = wouldping.read().filter((r) => r.wouldHavePinged);
  assert.equal(rows.length, 2, 'a restart did not re-arm the agent');
  assert.notEqual(rows[1].sinceBoot, first, 'both lines claim the same boot, so they look summable and are not');
});

test('🛑 the log says "I RAN" before it says anything else', () => {
  /* Without this, an empty result has two meanings and no way to tell them
     apart: the code is not deployed, or it ran and saw nothing. Both look like
     no directory.
     ⚠️ AND THE FIRST ONE ALREADY HAPPENED. #1518 merged, the board restarted,
     and the served checkout did not carry the file. Anybody reading the absent
     directory as "the scrape never fires" would have been reading a check that
     never ran. */
  wouldping.saw('z', 'idle', {});
  const rows = wouldping.read();
  assert.equal(rows.length, 1, 'a first call that logged no transition left no trace that it ran');
  assert.equal(rows[0].kind, 'boot');
  assert.match(rows[0].note, /RAN/, 'the boot line does not say what it means');
});

test('🛑 the boot line says WHICH process, because "something ran" is not the claim', () => {
  /* I shipped this line claiming a boot proved the BOARD had run. It does not:
     any process reaching snapshot() against the real store announces, including
     a one-off `node -e`. Six boots appeared in five minutes on this machine and
     most were my own throwaway checks.
     ⇒ Recorded rather than FILTERED. Filtering restores the ambiguity for
     everything that is not the board, which is the defect this line exists to
     remove. */
  wouldping.saw('w', 'idle', {});
  const boot = wouldping.read().find((r) => r.kind === 'boot');
  assert.ok('script' in boot, 'a reader cannot tell a board boot from a diagnostic');
  assert.equal(typeof boot.script, 'string');
  assert.equal(typeof boot.pid, 'number');
  assert.match(boot.note, /which process/i, 'the note does not tell a reader what `script` is for');
});

test('🛑 the boot line carries the BASENAME, never the arguments', () => {
  /* A full command line can carry a path, a token or a key, and this file is
     written to disk and read by people. `server.js` is the whole of what a
     reader needs. */
  wouldping.saw('w2', 'idle', {});
  const boot = wouldping.read().find((r) => r.kind === 'boot');
  assert.doesNotMatch(boot.script, /[/\\]/, 'the boot line carries a PATH: ' + boot.script);
  const src = fs.readFileSync(require.resolve('./wouldping'), 'utf8');
  assert.doesNotMatch(src, /argv\.join|argv\.slice\(1\)\.join|process\.argv\)/,
    'it now records more of the command line than the script name');
});

test('the boot line is written ONCE per process, not per call', () => {
  for (let i = 0; i < 30; i += 1) wouldping.saw('z' + i, 'idle', {});
  assert.equal(wouldping.read().filter((r) => r.kind === 'boot').length, 1,
    'it announces on every call, which makes the log a heartbeat nobody asked for');
});

test('the boot line comes even when the card has no name', () => {
  /* ⚠️ ANNOUNCED BEFORE THE KEY CHECK, deliberately. A board whose every card
     lacks a name still RAN, and that is exactly the case somebody would
     otherwise read as "not deployed". */
  wouldping.saw(null, 'needs_you', { reported: false });
  assert.equal(wouldping.read().filter((r) => r.kind === 'boot').length, 1,
    'a nameless card skipped the announcement, so a board full of them reads as never deployed');
});

test('the three states a reader must tell apart are all distinguishable', () => {
  /* This is the whole point, stated as the reader would ask it. */
  const dir = wouldping.dirFor();
  fs.rmSync(dir, { recursive: true, force: true });
  wouldping.reset();
  assert.equal(fs.existsSync(dir), false, 'STATE 1, the code is not there: no directory');

  wouldping.saw('a', 'working', {});
  assert.equal(wouldping.read().filter((r) => r.kind === 'boot').length, 1);
  assert.equal(wouldping.read().filter((r) => r.wouldHavePinged).length, 0,
    'STATE 2, it ran and saw nothing: a boot line and no transitions');

  wouldping.saw('a', 'needs_you', { reported: false });
  assert.equal(wouldping.read().filter((r) => r.wouldHavePinged).length, 1,
    'STATE 3, it ran and saw something: a transition');
});

test('CONTROL: it never throws, whatever it is handed', () => {
  /* A measurement must never break a read of the board. */
  for (const bad of [undefined, null, '', 0, {}, []]) {
    assert.doesNotThrow(() => wouldping.saw(bad, 'needs_you', { reported: false }));
    assert.doesNotThrow(() => wouldping.saw('f', bad, undefined));
  }
});

test('CONTROL: the real store is never touched by this file', () => {
  /* The arm that would have caught my own unsandboxed smoke test. */
  assert.ok(wouldping.fileFor().startsWith(SB),
    'the log would land outside the sandbox, at ' + wouldping.fileFor());
});

test('a production path calls it, or this is a measurement nobody takes', () => {
  /* The merged-and-inert class, twice mine this week. */
  const status = fs.readFileSync(require.resolve('./status'), 'utf8');
  assert.match(status, /wouldping\.saw\(/, 'nothing in status.js records a would-be ping');
  assert.match(status, /require\('\.\/wouldping'\)/, 'status.js does not reach this module at all');
  /* 🛑 AND NOT BEHIND A DEAD BRANCH. Perturbing the call to `if (false)
     wouldping.saw(...)` left this test GREEN, because the text is still there.
     A guard that cannot tell a live call from a dead one is not a reachability
     check, which is the exact class this test exists for.
     ⚠️ ITS LIMIT, STATED: this catches the obvious dead-branch spellings and it
     is still a TEXT check. It cannot see a call made unreachable by a condition
     that is false for another reason. The honest claim is "not trivially
     disabled", not "reached". */
  const at = status.indexOf('wouldping.saw(');
  const before = status.slice(Math.max(0, at - 160), at);
  assert.doesNotMatch(before, /if \(false\)|if \(0\)|\/\/\s*$/,
    'the call is behind a dead branch, so it records nothing while reading as wired');
});
