'use strict';
/* #5636 F4: engine/readjobs.js answers a read within a short wait, the result or "still reading", keeps the finished
   answer for the next ask of the same question, and hands it out once. No board, no network.

     node --test engine/readjobs.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const readjobs = require('./readjobs');

test.beforeEach(() => readjobs._reset());
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

test('#5636 F4: a quick read is answered on the first ask', async () => {
  const keep = { resend: () => true };
  const a = await readjobs.ask('k', () => later(5, 'answer'), 200, Date.now(), keep);
  assert.deepEqual(a, { done: true, value: 'answer' });
  // Review 3: kept RESEND_MS for the same question (a lost response can be asked for again), then dropped.
  assert.equal(readjobs._size(), 1);
  await readjobs.ask('other', () => 'x', 50, Date.now() + readjobs.RESEND_MS + 1000);   // 'other' is not kept (no resend)
  assert.equal(readjobs._size(), 0, 'a delivered answer outlived RESEND_MS');
});

test('#5636 F4: a slow read says "still reading", carries on, and the next ask gets it without reading again', async () => {
  let runs = 0;
  const run = () => { runs += 1; return later(80, 'slow answer'); };
  const first = await readjobs.ask('k', run, 10);
  assert.deepEqual(first, { done: false });
  const keep = { resend: () => true };
  const second = await readjobs.ask('k', run, 200, Date.now(), keep);
  assert.deepEqual(second, { done: true, value: 'slow answer' });
  assert.equal(runs, 1, 'the second ask started a second read');
  // Review 3: asked again within RESEND_MS, the same answer, no new read; after it, a fresh read.
  assert.deepEqual(await readjobs.ask('k', run, 200, Date.now(), keep), { done: true, value: 'slow answer' });
  assert.equal(runs, 1, 'a re-ask within RESEND_MS read again');
  await readjobs.ask('k', run, 200, Date.now() + readjobs.RESEND_MS + 1000);
  assert.equal(runs, 2, 'a later ask did not read afresh');
});

test('#5636 F4: a finished answer nobody collected waits for the next ask, then goes', async () => {
  let runs = 0;
  const run = () => { runs += 1; return later(20, 'kept'); };
  assert.deepEqual(await readjobs.ask('k', run, 1), { done: false });
  await later(40);
  assert.deepEqual(await readjobs.ask('k', run, 1), { done: true, value: 'kept' }, 'the finished answer was not kept');
  assert.equal(runs, 1);
});

test('#5636 F4: an answer kept longer than KEEP_MS is dropped, so a much later ask reads afresh', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve('x' + runs); };
  assert.deepEqual(await readjobs.ask('k', () => later(10, 'old').then((v) => { runs += 1; return v; }), 1), { done: false });
  await later(30);
  const a = await readjobs.ask('k', run, 50, Date.now() + readjobs.KEEP_MS + 1000);
  assert.equal(a.value, 'x2', 'a stale kept answer was handed out');
});

test('#5636 F4: different questions, or different readers, never share an answer', async () => {
  const a = await readjobs.ask('ava\nfollowing=1', () => later(1, 'ava'), 100);
  const b = await readjobs.ask('rex\nfollowing=1', () => later(1, 'rex'), 100);
  assert.equal(a.value, 'ava');
  assert.equal(b.value, 'rex');
});

test('#5636 F4: two asks at once of the same question share one read', async () => {
  let runs = 0;
  const run = () => { runs += 1; return later(30, 'shared'); };
  const [x, y] = await Promise.all([readjobs.ask('k', run, 200), readjobs.ask('k', run, 200)]);
  assert.equal(runs, 1);
  assert.equal(x.value, 'shared');
  assert.equal(y.value, 'shared');
});

test('#5636 F4 review 1: a read that fails is finished (null), so the next ask is not "still reading" for good', async () => {
  const a = await readjobs.ask('k', () => Promise.reject(new Error('down')), 100);
  assert.deepEqual(a, { done: true, value: null });
});

test('#5636 F4 review 2: a read that never settles is dropped after KEEP_MS, so the next ask reads afresh', async () => {
  let runs = 0;
  const never = () => { runs += 1; return new Promise(() => {}); };
  assert.deepEqual(await readjobs.ask('k', never, 1), { done: false });
  assert.deepEqual(await readjobs.ask('k', never, 1), { done: false });
  assert.equal(runs, 1, 'CONTROL: while young, the same read is kept');
  await readjobs.ask('k', never, 1, Date.now() + readjobs.KEEP_MS + 1000);
  assert.equal(runs, 2, 'a stuck read was never dropped');
});

test('#5636 F4 review 4: an answer the caller does not mark for resending, a failure above all, is read afresh next time', async () => {
  let runs = 0;
  const run = () => { runs += 1; return Promise.resolve({ status: 502 }); };
  const resend = (v) => v && v.status === 200;
  assert.equal((await readjobs.ask('k', run, 100, Date.now(), { resend })).value.status, 502);
  assert.equal(readjobs._size(), 0, 'a failure was kept for a re-ask');
  await readjobs.ask('k', run, 100, Date.now(), { resend });
  assert.equal(runs, 2, 'a failure was replayed instead of read again');
  // CONTROL: a good answer under the same rule is kept.
  await readjobs.ask('g', () => Promise.resolve({ status: 200 }), 100, Date.now(), { resend });
  assert.equal(readjobs._size(), 1);
});
