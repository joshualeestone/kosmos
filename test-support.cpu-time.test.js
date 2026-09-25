'use strict';
// #3715: the shared CPU-time helper the backtracking guards use. Two controls: the units
// (milliseconds, not seconds or microseconds) and the kind (CPU, not wall).
const test = require('node:test');
const assert = require('node:assert/strict');
const { cpuMillisecondsOf } = require('./test-support/cpu-time');

test('#3715 cpuMillisecondsOf reads milliseconds: a ~40ms busy loop reads between 1 and 3000', () => {
  const ms = cpuMillisecondsOf(() => { const end = Date.now() + 40; while (Date.now() < end) { /* spin */ } });
  // A seconds result would be a fraction of 1; a microseconds one tens of thousands.
  assert.ok(ms >= 1 && ms < 3000, 'a 40ms spin read ' + ms + 'ms of CPU');
});

test('#3715 cpuMillisecondsOf refuses an async function instead of timing it up to its first await', () => {
  assert.throws(() => cpuMillisecondsOf(async () => { await null; }), /synchronous work only/);
  assert.equal(typeof cpuMillisecondsOf(() => 1), 'number', 'CONTROL: a plain function that returns a value is measured');
});

test('#3715 cpuMillisecondsOf reads CPU, not wall: 200ms asleep reads well under 200', () => {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  const wallStart = Date.now();
  const ms = cpuMillisecondsOf(() => { Atomics.wait(sab, 0, 0, 200); });
  assert.ok(Date.now() - wallStart >= 190, 'CONTROL: the sleep really took about 200ms of wall time');
  assert.ok(ms < 100, 'a 200ms sleep read ' + ms + 'ms of CPU, so this measures wall time');
});
