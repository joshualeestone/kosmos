'use strict';
// #5727: the shared wall-clock poll helper test-support/eventually.js and the scale
// it reads from KOSMOS_TEST_TIME_SCALE. These assertions are deterministic -- they turn
// on the predicate and a call COUNT, never on measured wall time -- so this test does
// not itself join the flaky class it guards. (The one deadline test uses a predicate
// that is never satisfiable, so load can only change WHEN it times out, never WHETHER.)
const test = require('node:test');
const assert = require('node:assert/strict');

const MODULE = './test-support/eventually';

// Reload the helper with a chosen KOSMOS_TEST_TIME_SCALE, since it reads the env ONCE at
// module load. Restores the ambient value (the suite runner sets one) afterwards.
function loadWithScale(value) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'KOSMOS_TEST_TIME_SCALE');
  const prev = process.env.KOSMOS_TEST_TIME_SCALE;
  if (value === undefined) delete process.env.KOSMOS_TEST_TIME_SCALE;
  else process.env.KOSMOS_TEST_TIME_SCALE = value;
  delete require.cache[require.resolve(MODULE)];
  const mod = require(MODULE);
  if (had) process.env.KOSMOS_TEST_TIME_SCALE = prev;
  else delete process.env.KOSMOS_TEST_TIME_SCALE;
  delete require.cache[require.resolve(MODULE)];
  return mod;
}

test('scale is pinned to 1 when KOSMOS_TEST_TIME_SCALE is unset (budgets identical to today)', () => {
  const { SCALE, scaleBudget } = loadWithScale(undefined);
  assert.equal(SCALE, 1);
  assert.equal(scaleBudget(4000), 4000);
  assert.equal(scaleBudget(1), 1);
});

test('scale is floored at 1 and never shortens a budget', () => {
  for (const bad of ['0', '0.5', '-3', 'abc', '']) {
    const { SCALE, scaleBudget } = loadWithScale(bad);
    assert.equal(SCALE, 1, `scale for ${JSON.stringify(bad)} should floor to 1`);
    assert.equal(scaleBudget(1000), 1000, `budget for ${JSON.stringify(bad)} must not shrink`);
  }
});

test('a scale above 1 stretches budgets (ceil), leaving the literal as the floor', () => {
  const two = loadWithScale('2');
  assert.equal(two.SCALE, 2);
  assert.equal(two.scaleBudget(1000), 2000);

  const half = loadWithScale('2.5');
  assert.equal(half.SCALE, 2.5);
  assert.equal(half.scaleBudget(1000), 2500);
  assert.equal(half.scaleBudget(3), 8); // ceil(3 * 2.5) = 8, never below 3
});

test('eventually returns the value once the predicate holds (by call count, not clock)', async () => {
  const { eventually } = loadWithScale('1');
  let calls = 0;
  const v = await eventually(() => ++calls, (n) => n >= 3, { timeoutMs: 1000, stepMs: 1 });
  assert.equal(v, 3);
  assert.equal(calls, 3);
});

test('eventually returns on the FIRST probe when the predicate already holds', async () => {
  const { eventually } = loadWithScale('1');
  let calls = 0;
  const v = await eventually(() => { calls++; return 'ready'; }, (x) => x === 'ready', { timeoutMs: 0, stepMs: 1 });
  assert.equal(v, 'ready');
  assert.equal(calls, 1);
});

test('eventually throws past the deadline, naming the scale and the last value', async () => {
  const { eventually } = loadWithScale('3');
  await assert.rejects(
    () => eventually(() => 'stuck', (x) => x === 'done', {
      timeoutMs: 5,
      stepMs: 1,
      describe: (x) => `last=${x}`,
    }),
    (err) => {
      assert.match(err.message, /KOSMOS_TEST_TIME_SCALE 3x/);
      assert.match(err.message, /last=stuck/);
      // budget = ceil(5 * 3) = 15 ms, surfaced so a reader sees the stretched deadline.
      assert.match(err.message, /within 15ms/);
      return true;
    }
  );
});

test('eventually awaits an async probe', async () => {
  const { eventually } = loadWithScale('1');
  let calls = 0;
  const v = await eventually(
    async () => { calls++; return calls; },
    (n) => n >= 2,
    { timeoutMs: 1000, stepMs: 1 }
  );
  assert.equal(v, 2);
});
