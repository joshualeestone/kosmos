'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isClass1,
  planClass1Handle,
  runClass1Handle,
  sweepClass1,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_MS,
} = require('./class1-autohandle');

// A standing report shaped like selfreport.read()'s return, class-1 by default.
const class1 = (over) => ({ found: true, state: 'needs_you', by: 'auto', because: 'asking permission to use Bash: cd', ...(over || {}) });

// ---------------------------------------------------------------------------
// isClass1 - the class-1 vs class-2 line. The CONTROLS are the point: a
// class-2 (by:'agent') real question, an operator clear, a legacy null line,
// and any non-needs_you state must all read as NOT class-1, or the auto-handle
// would silently drop a real request.
// ---------------------------------------------------------------------------
test('isClass1: a standing by:auto needs_you IS class-1', () => {
  assert.equal(isClass1(class1()), true);
});
test('CONTROL isClass1: by:agent (class 2, the agent\'s own question) is NOT class-1', () => {
  assert.equal(isClass1(class1({ by: 'agent' })), false);
});
test('CONTROL isClass1: by:operator is NOT class-1', () => {
  assert.equal(isClass1(class1({ by: 'operator' })), false);
});
test('CONTROL isClass1: by:null (legacy, provenance unknown) is NOT class-1', () => {
  assert.equal(isClass1(class1({ by: null })), false);
});
test('CONTROL isClass1: a by:auto but non-needs_you state (blocked) is NOT class-1', () => {
  assert.equal(isClass1(class1({ state: 'blocked' })), false);
});
test('CONTROL isClass1: found:false is NOT class-1', () => {
  assert.equal(isClass1({ found: false }), false);
  assert.equal(isClass1(null), false);
});

// ---------------------------------------------------------------------------
// planClass1Handle - the decision. Controls prove each branch and prove the
// dangerous ones (handling class-2, looping) cannot happen.
// ---------------------------------------------------------------------------
test('plan: class-1, no prior attempts -> trust-and-restart', () => {
  const p = planClass1Handle(class1(), [], 1_000_000);
  assert.equal(p.act, 'trust-and-restart');
  assert.equal(p.recentAttempts, 0);
});
test('CONTROL plan: a class-2 real question -> none (never auto-handled)', () => {
  const p = planClass1Handle(class1({ by: 'agent' }), [], 1_000_000);
  assert.equal(p.act, 'none');
});
test('CONTROL plan: operator/legacy/blocked all -> none', () => {
  assert.equal(planClass1Handle(class1({ by: 'operator' }), [], 1e6).act, 'none');
  assert.equal(planClass1Handle(class1({ by: null }), [], 1e6).act, 'none');
  assert.equal(planClass1Handle(class1({ state: 'blocked' }), [], 1e6).act, 'none');
  assert.equal(planClass1Handle({ found: false }, [], 1e6).act, 'none');
});
test('plan loop-guard: at maxAttempts within the window -> escalate, NOT another restart', () => {
  const now = 10_000_000;
  const attempts = [now - 1000, now - 2000]; // 2 == DEFAULT_MAX_ATTEMPTS, both recent
  const p = planClass1Handle(class1(), attempts, now);
  assert.equal(p.act, 'escalate');
  assert.equal(p.recentAttempts, DEFAULT_MAX_ATTEMPTS);
});
test('CONTROL loop-guard: attempts OUTSIDE the window do not count -> trust-and-restart', () => {
  const now = 10_000_000;
  const attempts = [now - (DEFAULT_WINDOW_MS + 1), now - (DEFAULT_WINDOW_MS + 2)]; // both expired
  const p = planClass1Handle(class1(), attempts, now);
  assert.equal(p.act, 'trust-and-restart');
  assert.equal(p.recentAttempts, 0);
});
test('CONTROL loop-guard: one recent attempt (under cap) -> still trust-and-restart', () => {
  const now = 10_000_000;
  const p = planClass1Handle(class1(), [now - 1000], now);
  assert.equal(p.act, 'trust-and-restart');
  assert.equal(p.recentAttempts, 1);
});
test('plan: a custom maxAttempts of 1 escalates on the first recent prior attempt', () => {
  const now = 10_000_000;
  const p = planClass1Handle(class1(), [now - 1000], now, { maxAttempts: 1 });
  assert.equal(p.act, 'escalate');
});
test('CONTROL plan: maxAttempts of 0 (or negative) falls back to the default, NOT never-restart', () => {
  // A literal 0 would otherwise escalate on the first wait (0 >= 0) and never try a
  // restart - the ambiguous "0 = unlimited?" footgun. It must clamp to the default.
  assert.equal(planClass1Handle(class1(), [], 1e6, { maxAttempts: 0 }).act, 'trust-and-restart');
  assert.equal(planClass1Handle(class1(), [], 1e6, { maxAttempts: -3 }).act, 'trust-and-restart');
  // and at the default cap it still escalates, proving the fallback is the default (2), not infinity
  const now = 1e6;
  assert.equal(planClass1Handle(class1(), [now - 1, now - 2], now, { maxAttempts: 0 }).act, 'escalate');
});

// ---------------------------------------------------------------------------
// runClass1Handle - the executor. Injected deps; assert it calls the SAME
// path the manual route uses, in order, and keys `handled` on the restart.
// ---------------------------------------------------------------------------
const RESTARTED = 'restarted';

test('run: trust write + restart both succeed -> handled, both called in order', () => {
  const calls = [];
  const deps = {
    trustAgentFolder: (n) => { calls.push(['trust', n]); return { wrote: true }; },
    restart: (n, cause) => { calls.push(['restart', n, cause]); return { outcome: RESTARTED }; },
    RESTARTED,
  };
  const r = runClass1Handle('angel', deps);
  assert.equal(r.handled, true);
  assert.deepEqual(calls, [['trust', 'angel'], ['restart', 'angel', 'restart']]);
});
test('CONTROL run: restart REFUSED -> handled:false with a reason', () => {
  const deps = {
    trustAgentFolder: () => ({ wrote: true }),
    restart: () => ({ outcome: 'refused', because: 'agent is busy' }),
    RESTARTED,
  };
  const r = runClass1Handle('angel', deps);
  assert.equal(r.handled, false);
  assert.match(r.because, /did not complete/);
});
test('run: a soft-failed trust write but a good restart is still handled (relaunch shim re-writes trust)', () => {
  const deps = {
    trustAgentFolder: () => ({ wrote: false, because: 'symlinked config' }),
    restart: () => ({ outcome: RESTARTED }),
    RESTARTED,
  };
  const r = runClass1Handle('angel', deps);
  assert.equal(r.handled, true);
  assert.equal(r.trusted.wrote, false); // surfaced, not swallowed
});
test('CONTROL run: a throwing restart is caught, handled:false (never throws out)', () => {
  const deps = {
    trustAgentFolder: () => ({ wrote: true }),
    restart: () => { throw new Error('boom'); },
    RESTARTED,
  };
  const r = runClass1Handle('angel', deps);
  assert.equal(r.handled, false);
  assert.match(r.because, /boom/);
});
test('CONTROL run: missing deps -> handled:false, does not throw', () => {
  assert.equal(runClass1Handle('angel', {}).handled, false);
  assert.equal(runClass1Handle('angel').handled, false);
});

// ---------------------------------------------------------------------------
// sweepClass1 - the dry-run surface. Maps names to plans, no action.
// ---------------------------------------------------------------------------
test('sweep: maps each agent to its plan, reading per-agent standing + attempts', () => {
  const now = 10_000_000;
  const store = {
    angel: class1(),                                   // class-1 -> trust-and-restart
    mona: class1({ by: 'agent' }),                     // class-2 -> none
    ice: class1(),                                     // class-1 but looping -> escalate
  };
  const attempts = { ice: [now - 1000, now - 2000] };
  const out = sweepClass1(['angel', 'mona', 'ice'], {
    read: (n) => store[n],
    attemptsFor: (n) => attempts[n] || [],
  }, now);
  assert.deepEqual(out.map((e) => [e.name, e.plan.act]), [
    ['angel', 'trust-and-restart'],
    ['mona', 'none'],
    ['ice', 'escalate'],
  ]);
});
test('CONTROL sweep: a read() that throws is caught and planned as none, not a crash', () => {
  const out = sweepClass1(['boom'], { read: () => { throw new Error('store gone'); } }, 1e6);
  assert.equal(out[0].plan.act, 'none');
});
test('sweep: no action is taken (read-only) - deps carry no writer', () => {
  // The sweep only takes `read`/`attemptsFor`; there is no way for it to restart
  // anything. This is the dry-run guarantee, asserted structurally.
  let restartCalled = false;
  const deps = { read: () => class1(), attemptsFor: () => [], restart: () => { restartCalled = true; } };
  sweepClass1(['angel'], deps, 1e6);
  assert.equal(restartCalled, false);
});

// ---------------------------------------------------------------------------
// Convention #5 pin: isClass1 must agree with selfreport's ONE definition of an
// auto permission wait across shared fixtures, so the auto-handle's class-1 line
// and the store's class-1 line (record()'s #2456 clobber-guard) cannot diverge.
// ---------------------------------------------------------------------------
const selfreport = require('./selfreport');
// isClass1 delegates to selfreport.isAutoPermissionWait today, so this comparison is
// trivially true NOW. Its value is as a regression pin: if a future edit re-inlines
// isClass1 with its own (possibly divergent) predicate, this fails - catching the
// two-derivations drift before it ships. The behavioral coverage of the class-1 line
// itself is the control tests above.
test('isClass1 must stay equal to selfreport.isAutoPermissionWait (re-inline drift pin)', () => {
  const fixtures = [
    class1(),
    class1({ by: 'agent' }),
    class1({ by: 'operator' }),
    class1({ by: null }),
    class1({ state: 'blocked' }),
    class1({ state: 'working' }),
    { found: false },
    null,
  ];
  for (const f of fixtures) {
    assert.equal(isClass1(f), selfreport.isAutoPermissionWait(f), `disagreement on ${JSON.stringify(f)}`);
  }
});

// ---------------------------------------------------------------------------
// Loop-guard, corrupt-timestamp direction: a NON-FINITE attempt must count as
// recent (bias to escalate), never be dropped (which would bias to restart).
// ---------------------------------------------------------------------------
test('loop-guard: non-finite timestamps (NaN/undefined) count as recent -> escalate at cap, never drop', () => {
  const now = 10_000_000;
  // maxAttempts default 2; two NaN entries must count as 2 recent -> escalate.
  const p = planClass1Handle(class1(), [NaN, undefined], now);
  assert.equal(p.act, 'escalate');
  assert.equal(p.recentAttempts, 2);
});
test('CONTROL loop-guard: a single non-finite attempt (under cap) still plans trust-and-restart', () => {
  const p = planClass1Handle(class1(), [NaN], 10_000_000);
  assert.equal(p.act, 'trust-and-restart');
  assert.equal(p.recentAttempts, 1); // counted, not dropped
});
test('loop-guard: a non-finite `now` (corrupt clock) counts all attempts recent -> escalate, never restart', () => {
  // With a NaN now, a finite attempt would be dropped by (now - t) and bias to
  // restart; the guard must instead count everything recent and escalate at cap.
  const p = planClass1Handle(class1(), [1000, 2000], NaN);
  assert.equal(p.act, 'escalate');
  assert.equal(p.recentAttempts, 2);
});

// ---------------------------------------------------------------------------
// Executor: a THROWING trustAgentFolder is caught and, with a good restart,
// still handled (red-capable for the trust-write try/catch).
// ---------------------------------------------------------------------------
test('run: a THROWING trustAgentFolder is caught; a good restart still handles it', () => {
  const deps = {
    trustAgentFolder: () => { throw new Error('trust write blew up'); },
    restart: () => ({ outcome: RESTARTED }),
    RESTARTED,
  };
  const r = runClass1Handle('angel', deps);
  assert.equal(r.handled, true);
  assert.equal(r.trusted.wrote, false);
  assert.match(r.trusted.because, /trust write blew up/);
});

// ---------------------------------------------------------------------------
// Sweep: a THROWING attemptsFor degrades THAT agent to no-history, does not
// crash the whole sweep (symmetric with the read() guard).
// ---------------------------------------------------------------------------
test('CONTROL sweep: a throwing attemptsFor does not crash the sweep; the agent still gets a plan', () => {
  const out = sweepClass1(['angel', 'mona'], {
    read: (n) => (n === 'angel' ? class1() : class1({ by: 'agent' })),
    attemptsFor: () => { throw new Error('attempts store unavailable'); },
  }, 1e6);
  assert.deepEqual(out.map((e) => [e.name, e.plan.act]), [
    ['angel', 'trust-and-restart'], // no history -> fresh decision, not a crash
    ['mona', 'none'],
  ]);
});
