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
  const rows = wouldping.read();
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
  assert.equal(wouldping.read().length, 0);
});

test('staying in needs_you logs once, not once per read', () => {
  /* `snapshot()` is called from 44 sites in server.js and runs on every board
     poll. A line per READ would be a log nobody could use. */
  wouldping.saw('c', 'idle', {});
  assert.equal(wouldping.saw('c', 'needs_you', { reported: false }), true);
  for (let i = 0; i < 20; i += 1) wouldping.saw('c', 'needs_you', { reported: false });
  assert.equal(wouldping.read().length, 1, 'a held state logged more than once');
});

test('leaving and returning logs again, because that is a second event', () => {
  wouldping.saw('d', 'needs_you', { reported: false });
  wouldping.saw('d', 'working', {});
  wouldping.saw('d', 'needs_you', { reported: false });
  assert.equal(wouldping.read().length, 2);
});

test('every line carries the boot it belongs to, so nobody sums across restarts', () => {
  /* ⚠️ The previous state lives in memory, so a restart re-arms every agent and
     the first read after one can log a continuation as a transition. Honest for
     a RATE, wrong for a TOTAL, and the field is how a reader knows. */
  wouldping.saw('e', 'needs_you', { reported: false });
  const first = wouldping.read()[0].sinceBoot;
  wouldping.reset();
  wouldping.saw('e', 'needs_you', { reported: false });
  const rows = wouldping.read();
  assert.equal(rows.length, 2, 'a restart did not re-arm the agent');
  assert.notEqual(rows[1].sinceBoot, first, 'both lines claim the same boot, so they look summable and are not');
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
