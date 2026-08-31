'use strict';

/**
 * #1645: a minimum interval between connection sweeps that ANSWERS with the
 * previous sweep and its age, instead of refusing.
 *
 * Every arm here is asserted with a COUNTING STUB at the door rather than by
 * reading the response body. The card is about how many times the expensive
 * thing RAN, and a body can look right while the subprocess ran twice.
 *
 * The clock is injected rather than slept on. A guard keyed on time is exactly
 * the shape where a sleeping test is both slow and flaky, and where a test that
 * cannot move the clock quietly stops testing the boundary.
 */

const test = require('node:test');
const assert = require('node:assert');
const { minInterval } = require('./inflight');

/* A movable clock, so "inside the interval" and "outside it" are stated rather
   than waited for. */
function clock(start) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/* Counts how many times the expensive thing actually ran. */
function counter(value) {
  const c = { runs: 0 };
  c.fn = () => { c.runs += 1; return Promise.resolve(typeof value === 'function' ? value(c.runs) : value); };
  return c;
}

test('#1645: two calls INSIDE the interval run the sweep ONCE', async () => {
  const c = counter({ '/api/github': { connected: true } });
  const k = clock(1000);
  const guarded = minInterval(c.fn, 10000, { now: k.now });

  await guarded();
  k.advance(3000);
  await guarded();

  assert.strictEqual(c.runs, 1, 'the second call inside the interval must not sweep again');
});

test('#1645 NEGATIVE ARM: without the guard the same stub reaches 2, so the counter CAN see a second run', async () => {
  /* This is the control for the test above. Without it, "runs === 1" is equally
     consistent with a stub that cannot count, and the assertion would pass for
     the wrong reason. */
  const c = counter({ '/api/github': { connected: true } });

  await c.fn();
  await c.fn();

  assert.strictEqual(c.runs, 2, 'the unguarded stub must reach 2, or the guarded assertion proves nothing');
});

test('#1645: the answer inside the interval carries an AGE a consumer can read', async () => {
  const c = counter({ '/api/github': { connected: true } });
  const k = clock(1000);
  const guarded = minInterval(c.fn, 10000, { now: k.now });

  const first = await guarded();
  assert.strictEqual(first.fresh, true, 'the first call is a fresh sweep');
  assert.strictEqual(first.ageMs, 0, 'a fresh sweep is zero old');

  k.advance(4000);
  const second = await guarded();
  assert.strictEqual(second.fresh, false, 'the second call inside the interval is not fresh');
  assert.strictEqual(second.ageMs, 4000, 'the age must be the real elapsed time, not a flag');
});

test('#1645: a call OUTSIDE the interval sweeps fresh', async () => {
  const c = counter({ '/api/github': { connected: true } });
  const k = clock(1000);
  const guarded = minInterval(c.fn, 10000, { now: k.now });

  await guarded();
  k.advance(10000);           // exactly the interval: no longer inside it
  const out = await guarded();

  assert.strictEqual(c.runs, 2, 'past the interval the sweep must run again');
  assert.strictEqual(out.fresh, true, 'and it must say it is fresh');
  assert.strictEqual(out.ageMs, 0);
});

test('#1645 THE INVARIANT: an unreadable door stays unknown on BOTH paths, never a confident none', async () => {
  /* This is the assertion the whole card family exists to protect, and it is
     the one an age-bearing answer could quietly break. `connected: null` means
     "could not check". If either path turned it into `false`, the product would
     tell somebody they are not connected when we simply could not look. */
  const unreadable = { '/api/github': { connected: null, because: 'could not check: boom' } };
  const c = counter(unreadable);
  const k = clock(1000);
  const guarded = minInterval(c.fn, 10000, { now: k.now });

  const fresh = await guarded();
  assert.strictEqual(fresh.value['/api/github'].connected, null, 'FRESH path must stay unknown');
  assert.notStrictEqual(fresh.value['/api/github'].connected, false, 'and must never be a confident none');

  k.advance(2000);
  const held = await guarded();
  assert.strictEqual(held.value['/api/github'].connected, null, 'WITHIN-INTERVAL path must stay unknown');
  assert.notStrictEqual(held.value['/api/github'].connected, false, 'and must never be a confident none');

  assert.strictEqual(c.runs, 1, 'and it did so without a second sweep');
});

test('#1645: the remembered value is returned unchanged, not re-derived', async () => {
  const doors = { '/api/github': { connected: true, who: 'someone' } };
  const c = counter(doors);
  const k = clock(1000);
  const guarded = minInterval(c.fn, 10000, { now: k.now });

  const first = await guarded();
  k.advance(1000);
  const second = await guarded();

  assert.strictEqual(second.value, first.value, 'the same object, so no second definition of the answer can drift');
  assert.strictEqual(second.value, doors);
});

test('#1645: a REJECTED run is not remembered, and the rejection reaches the caller', async () => {
  /* Same rule as collapse: holding a failure would turn one unreachable moment
     into a stretch of them. */
  let calls = 0;
  const run = () => { calls += 1; return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok'); };
  const k = clock(1000);
  const guarded = minInterval(run, 10000, { now: k.now });

  await assert.rejects(() => guarded(), /boom/, 'the rejection must reach the caller');

  const next = await guarded();
  assert.strictEqual(next.fresh, true, 'a failed run leaves nothing remembered, so the next call is fresh');
  assert.strictEqual(next.value, 'ok');
  assert.strictEqual(calls, 2);
});

test('#1645: a failure is never answered from the remembered value', async () => {
  /* The tempting alternative - fall back to the last good sweep when the new
     one fails - would present a stale reading as the current state with no way
     for the caller to tell. It is refused on purpose. */
  let calls = 0;
  const run = () => { calls += 1; return calls === 1 ? Promise.resolve('good') : Promise.reject(new Error('later boom')); };
  const k = clock(1000);
  const guarded = minInterval(run, 10000, { now: k.now });

  await guarded();
  k.advance(20000);
  await assert.rejects(() => guarded(), /later boom/, 'the failure must propagate, not be papered over with the old value');
});

test('#1645: a synchronous throw becomes a rejection rather than escaping', async () => {
  const guarded = minInterval(() => { throw new Error('sync boom'); }, 10000);
  await assert.rejects(() => guarded(), /sync boom/);
});

test('#1645: arguments are refused loudly, like collapse', () => {
  const guarded = minInterval(() => 'x', 10000);
  assert.throws(() => guarded('a'), /cannot take arguments/);
});

test('#1645: the interval is validated, so a typo cannot silently disable the guard', () => {
  assert.throws(() => minInterval(() => 'x', undefined), /finite number/);
  assert.throws(() => minInterval(() => 'x', -1), /finite number/);
  assert.throws(() => minInterval(() => 'x', NaN), /finite number/);
  assert.throws(() => minInterval('not a function', 10), /must be a function/);
});
