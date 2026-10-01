'use strict';
/* #4588 part 3: an Antigravity agent whose own quota reset has passed, while its Google account's shared quota
   is still paused (one account, one quota), reads Paused with the pool's reset, not "the quota reset at". */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const agyquota = require('./agyquota');

const RESET = '2026-09-28T22:11:54.000Z';
const OWN = Date.parse(RESET);
const UNKNOWN = { state: status.STATE.UNKNOWN, confidence: status.CONFIDENCE.NONE, because: 'cannot read agy' };
// A colleague's pause in the pool memory, first seen at `seen` (heldBackBy counts only a pause seen inside this
// agent's own six hours).
const colleague = (at, seen) => { agyquota.POOL_MEMO.bySession.set('colleague', at); agyquota.POOL_MEMO.seen.set('colleague', seen); };
const quota = () => ({ found: true, state: 'idle', by: 'auto', until: RESET, because: status.QUOTA_REPORT_PREFIX + ' Google said: ...' });
// Review 12: a shell that exports the PR B brake would red the held cases as if the product had regressed. Each test
// starts with it unset (the brake test sets its own), and the shell's value is put back after the file.
const BRAKE = 'AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF';
const shellBrake = process.env[BRAKE];
test.beforeEach(() => { agyquota.POOL_MEMO.bySession.clear(); agyquota.POOL_MEMO.seen.clear(); delete process.env[BRAKE]; });
test.after(() => { if (shellBrake === undefined) delete process.env[BRAKE]; else process.env[BRAKE] = shellBrake; });

test('#4588 part 3: own reset passed, pool still paused by a colleague: Paused, with poolUntil and NOT quotaUntil', () => {
  const later = OWN + 3600e3;
  colleague(later, OWN - 10 * 60e3);
  const r = status.reconcileReport(quota(), UNKNOWN, OWN + 60e3);
  assert.equal(r.state, status.STATE.RATE_LIMITED);
  assert.equal(r.poolUntil, new Date(later).toISOString());
  assert.equal(r.quotaUntil, undefined, 'the pool time must not ride in quotaUntil, which feeds the pool memory');
  assert.match(r.because, /its Google account's shared quota was reported paused until /);
  assert.doesNotMatch(r.because, /holds its automatic messages until/, 'the hold runs by its own rule; the card does not claim its length');
  assert.doesNotMatch(r.because, /another agent/, 'it cannot know the pause is another agent\'s (its own entry may be the newer one)');
  assert.doesNotMatch(r.because, /has not picked up again/);
});

test('#4588 part 3 + PR B brake: with AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF=1 nothing is held, so the card does not say the pool holds it', () => {
  const later = OWN + 3600e3;
  colleague(later, OWN - 10 * 60e3);
  process.env.AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF = '1';
  try {
    const r = status.reconcileReport(quota(), UNKNOWN, OWN + 60e3);
    assert.equal(r.poolUntil == null, true, 'the brake is on, yet the card says the shared pool holds it');
    assert.doesNotMatch(r.because, /shared quota was reported paused until/);
  } finally { delete process.env.AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF; }
});

test('#4588 part 3 + PR B: a STOPPED agy agent never says it waits for the shared quota (nothing can be typed to it; PR B refuses, not holds)', () => {
  colleague(OWN + 3600e3, OWN - 10 * 60e3);
  const STOPPED = { state: status.STATE.STOPPED, confidence: status.CONFIDENCE.STRUCTURED, because: 'its pane is a shell' };
  const r = status.reconcileReport(quota(), STOPPED, OWN + 60e3);
  assert.equal(r.state, status.STATE.STOPPED);
  assert.equal(r.poolUntil == null, true, 'a stopped agent was given the pool line');
  assert.doesNotMatch(String(r.because || ''), /shared quota/);
});

test('#4588 part 3 CONTROLS: an empty memory, or a pool reset no later than its own, keeps the post-reset wording', () => {
  const after = OWN + 60e3;
  let r = status.reconcileReport(quota(), UNKNOWN, after);
  assert.equal(r.state, status.STATE.IDLE);
  assert.match(r.because, /its turn stopped when its Google quota ran out and has not picked up again/);
  colleague(OWN + 60e3, OWN - 3600e3);                            // the colleague's reset came after its own, but has passed too
  r = status.reconcileReport(quota(), UNKNOWN, OWN + 120e3);
  assert.equal(r.state, status.STATE.IDLE, 'the pool has refilled, yet the card still says paused (the poolAt > now half)');
  colleague(OWN - 60e3, OWN - 3600e3);                            // the colleague's reset came first (already passed)
  r = status.reconcileReport(quota(), UNKNOWN, after);
  assert.equal(r.state, status.STATE.IDLE, 'a colleague whose reset is not after its own is not holding it');
  // And before its own reset it is the ordinary pause (PR A), whatever the pool says.
  colleague(OWN + 3600e3, OWN - 3600e3);
  r = status.reconcileReport(quota(), UNKNOWN, OWN - 60e3);
  assert.equal(r.quotaUntil, RESET);
  assert.equal(r.poolUntil, undefined);
});

test('#4588 part 3: the card copies poolUntil to the board (snapshot field)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'status.js'), 'utf8');
  assert.match(src, /^\s*poolUntil: typeof status\.poolUntil === 'string' \? status\.poolUntil : null,$/m);
});

test('#4588 part 3: an OLD quota stop (the resume will never pick it up) does not turn Paused when a colleague pauses now; CONTROL: a recent one does', () => {
  const now = OWN + 3 * 86400e3;                                   // its own stop is three days old
  colleague(now + 3600e3, now - 60e3);                             // a colleague paused a minute ago
  const old = status.reconcileReport(quota(), UNKNOWN, now);
  assert.equal(old.state, status.STATE.IDLE, 'a three-day-old stop was shown Paused for a pause the resume will not wait for');
  assert.equal(old.poolUntil, undefined);
  agyquota.POOL_MEMO.bySession.clear(); agyquota.POOL_MEMO.seen.clear();
  colleague(OWN + 3600e3, OWN + 60e3);                             // CONTROL: first seen inside its six hours
  assert.equal(status.reconcileReport(quota(), UNKNOWN, OWN + 120e3).state, status.STATE.RATE_LIMITED);
});
