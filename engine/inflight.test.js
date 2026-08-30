'use strict';
/**
 * #1618: concurrent callers share one run, and NOTHING is shared once it settles.
 *
 * 🛑 THE POINT OF THIS FILE IS THE SECOND HALF. Proving that two concurrent calls
 * run once is easy and is not the risk. The risk is that the thing quietly becomes
 * a cache, because #1618 records a 5s TTL cache being built and killed by the
 * accounts suite in one run: a window converts `cannot tell` back into a confident
 * `not connected`, which is the one answer that sweep exists never to give.
 *
 * So every test below that shows sharing is paired with one showing NON-sharing
 * after settle. A helper that shared correctly and never released would pass the
 * first half of this file and be the bug.
 *
 *   node --test engine/inflight.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { collapse } = require('./inflight');

const tick = () => new Promise((r) => setImmediate(r));

test('#1618: callers arriving while a run is in flight share it, and it runs once', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const collapsed = collapse(async () => { runs += 1; await gate; return runs; });

  const a = collapsed();
  const b = collapsed();
  const c = collapsed();
  /* 🛑 THE RUN STARTS SYNCHRONOUSLY, AND THIS ASSERTION IS LOAD-BEARING RATHER THAN
     INCIDENTAL. My first version of `collapse` scheduled through
     `Promise.resolve().then(run)`, which deferred the start by one microtask.
     `engine/openaiaccounts.test.js` went red with `'none' !== 'unknown'` - the exact
     assertion #1618 records killing the TTL cache - because those tests restore a
     monkey-patched reader in a synchronous `finally` beside a returned promise, and
     a deferred start moved the read to after the restore.
     ⇒ A wrapper that changes WHEN a function starts is not transparent. Pinned here
     so nobody tidies the scheduling back. */
  assert.equal(runs, 1, 'the run did not start synchronously, so a caller that swaps a collaborator around the call will see the wrong one');

  release();
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(runs, 1, 'a second run started after the sharers attached');
  assert.deepEqual([ra, rb, rc], [1, 1, 1], 'the sharers did not all receive the one run\'s answer');
});

test('#1618: a call after the run settles runs AGAIN - this is not a cache', async () => {
  let runs = 0;
  const collapsed = collapse(async () => { runs += 1; return runs; });

  assert.equal(await collapsed(), 1);
  assert.equal(await collapsed(), 2, 'the second call was served the first call\'s answer, so this is a cache and it will convert cannot-tell into a confident none');
  assert.equal(await collapsed(), 3);
  assert.equal(runs, 3);
});

test('#1618: a REJECTED run is not held - the next caller runs a fresh one', async () => {
  let runs = 0;
  const collapsed = collapse(async () => {
    runs += 1;
    if (runs === 1) throw new Error('unreachable this time');
    return 'ok';
  });

  await assert.rejects(collapsed(), /unreachable this time/);
  assert.equal(await collapsed(), 'ok', 'the failure was held, so one unreachable moment became a stretch of them');
  assert.equal(runs, 2);
});

test('#1618: concurrent callers on a run that REJECTS all see the rejection, and it still clears', async () => {
  let runs = 0;
  let boom;
  const gate = new Promise((_, rej) => { boom = rej; });
  const collapsed = collapse(async () => { runs += 1; await gate; return 'never'; });

  const a = collapsed();
  const b = collapsed();
  boom(new Error('down'));
  await assert.rejects(a, /down/);
  await assert.rejects(b, /down/, 'a sharer did not receive the run\'s rejection');
  assert.equal(runs, 1);

  await tick();
  const c = collapse(async () => 'fresh')();
  assert.equal(await c, 'fresh');
});

test('#1618: a SYNCHRONOUS throw becomes a rejection and leaves no filled slot behind', async () => {
  let runs = 0;
  const collapsed = collapse(() => {
    runs += 1;
    if (runs === 1) throw new Error('sync boom');
    return Promise.resolve('recovered');
  });

  await assert.rejects(collapsed(), /sync boom/);
  assert.equal(await collapsed(), 'recovered',
    'a synchronous throw left the slot filled, so the next caller awaited a run that had already died');
});

test('#1618: arguments are REFUSED loudly, because one slot cannot answer two questions', () => {
  const collapsed = collapse(async () => 'x');
  assert.throws(() => collapsed('a'), /cannot take arguments/,
    'an argument was accepted, so a second caller can silently receive the first caller\'s answer');
});

test('#1618: collapse refuses a non-function', () => {
  assert.throws(() => collapse(null), /must be a function/);
  assert.throws(() => collapse(42), /must be a function/);
});

/* 🛑 THE CONTROL, AND IT IS AIMED AT THE ASSERTION THAT COULD PASS FOR THE WRONG
   REASON. "It ran once" is also what a helper that never runs at all produces, and
   `runs === 1` cannot tell those apart on its own. An UNWRAPPED function under the
   identical concurrent shape must run three times; if this arm ever goes quiet, the
   sharing tests above are measuring nothing. */
test('control: the same shape WITHOUT collapse runs three times', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const bare = async () => { runs += 1; await gate; return runs; };

  const a = bare(); const b = bare(); const c = bare();
  /* Ticked before reading, exactly like the subject above, so the two differ ONLY
     in the collapse and not in when they are measured. */
  await tick();
  assert.equal(runs, 3, 'the unwrapped control did not run three times, so the sharing assertions prove nothing');
  release();
  await Promise.all([a, b, c]);
});
