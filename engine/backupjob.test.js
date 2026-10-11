'use strict';
// kosmos#5744 slice 3: the backup run's member-key duties (engine/backupjob.js).
const test = require('node:test');
const assert = require('node:assert');
const job = require('./backupjob');

const PK = Buffer.alloc(32, 7);
const HOUR = 60 * 60 * 1000;

/* An ensureMemberKey stand-in answering from a list, recording what it was asked. */
function ensurer(...answers) {
  const calls = [];
  const fn = async (opts) => { calls.push(opts); const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return a; };
  fn.calls = calls;
  return fn;
}
function snapper(answer) {
  const calls = [];
  const fn = async (input) => { calls.push(input); if (answer instanceof Error) throw answer; return answer; };
  fn.calls = calls;
  return fn;
}

test('an ok key is sealed under: the snapshot gets its public key and its epoch as a context id', async () => {
  const ensure = ensurer({ ok: true, epoch: 2, publicKey: PK });
  const snapshot = snapper({ ok: true, manifestKey: 'm' });
  const r = await job.runOnce({}, { ensureMemberKey: ensure, snapshot });
  assert.deepStrictEqual(snapshot.calls, [{ memberPk: PK, epoch: '2' }]);
  assert.deepStrictEqual(ensure.calls, [{}], 'no lostEpoch when none is kept');
  assert.deepStrictEqual(r.state, {});
  assert.strictEqual(r.result.ok, true);
});

test('no snapshot unless the key step answered ok, with a usable key', async () => {
  for (const [what, answer] of [
    ['a refusal', { ok: false, because: 'Kosmos+ did not answer' }],
    ['ok without an epoch', { ok: true, publicKey: PK }],
    ['ok with epoch 0', { ok: true, epoch: 0, publicKey: PK }],
    ['ok with a short key', { ok: true, epoch: 1, publicKey: Buffer.alloc(31) }],
    ['ok with a string key', { ok: true, epoch: 1, publicKey: 'x'.repeat(32) }],
    ['nothing', undefined],
    ['a throw', new Error('/Users/someone/secret path')],
  ]) {
    const snapshot = snapper({ ok: true });
    const r = await job.runOnce({}, { ensureMemberKey: ensurer(answer), snapshot });
    assert.strictEqual(snapshot.calls.length, 0, what);
    assert.strictEqual(r.result.ok, false, what);
    assert.doesNotMatch(r.result.because, /Users/, `${what}: a thrown message is never passed on`);
    assert.doesNotMatch(r.result.because, /snapshot/, `${what}: the key step's reason, not a snapshot failure`);
    if (what === 'a refusal') assert.strictEqual(r.result.because, 'Kosmos+ did not answer');
  }
  // Control: the same stand-ins with a good answer do snapshot.
  const snapshot = snapper({ ok: true });
  await job.runOnce({}, { ensureMemberKey: ensurer({ ok: true, epoch: 1, publicKey: PK }), snapshot });
  assert.strictEqual(snapshot.calls.length, 1);
});

test('a refused grant for a LATER epoch marks the key lost, and the next run sends lostEpoch until a newer key answers', async () => {
  const ensure = ensurer({ ok: true, epoch: 2, publicKey: PK }, { ok: true, epoch: 3, publicKey: PK });
  const snapshot = snapper({ ok: false, otherEpoch: 3, because: 'the grant names key epoch 3, not 2' });
  const r1 = await job.runOnce({}, { ensureMemberKey: ensure, snapshot });
  assert.deepStrictEqual(r1.state, { lostEpoch: 2 });
  const r2 = await job.runOnce(r1.state, { ensureMemberKey: ensure, snapshot: snapper({ ok: true }) });
  assert.deepStrictEqual(ensure.calls[1], { lostEpoch: 2 });
  assert.deepStrictEqual(r2.state, {}, 'a key above the lost epoch clears it');
  assert.strictEqual(r2.key.epoch, 3);
});

test('an EARLIER or equal epoch, an ok result, or no otherEpoch never marks the key lost', async () => {
  const key = { epoch: 3, publicKey: PK };
  for (const [what, result] of [
    ['earlier', { ok: false, otherEpoch: 2 }],
    ['equal', { ok: false, otherEpoch: 3 }],
    ['a string', { ok: false, otherEpoch: '4' }],
    ['ok', { ok: true, otherEpoch: 4 }],
    ['none', { ok: false, because: 'no' }],
    ['nothing', null],
  ]) assert.deepStrictEqual(job.afterSnapshot({}, key, result), {}, what);
  assert.deepStrictEqual(job.afterSnapshot({}, key, { ok: false, otherEpoch: 4 }), { lostEpoch: 3 }, 'control: later marks it');
});

test('lostEpoch is kept through a refusal and a wait, and is never sealed under when the key answered is not above it', async () => {
  const r1 = await job.memberKeyFor({ lostEpoch: 2 }, { ensureMemberKey: ensurer({ ok: false, because: 'no answer' }) });
  assert.deepStrictEqual(r1.state, { lostEpoch: 2 });
  const r2 = await job.memberKeyFor({ lostEpoch: 2 }, { ensureMemberKey: ensurer({ ok: false, waiting: true, because: 'wait' }), now: () => 1000 });
  assert.deepStrictEqual(r2.state, { lostEpoch: 2, waitUntilMs: 1000 + HOUR, waits: 1 });
  // ensureMemberKey ignored lostEpoch (it was not the file's newest) and answered an older key: replace THAT one next.
  const snapshot = snapper({ ok: true });
  const r3 = await job.runOnce({ lostEpoch: 3 }, { ensureMemberKey: ensurer({ ok: true, epoch: 2, publicKey: PK, lostEpochIgnored: true }), snapshot });
  assert.strictEqual(snapshot.calls.length, 0);
  assert.deepStrictEqual(r3.state, { lostEpoch: 2 });
  const r4 = await job.runOnce({ lostEpoch: 3 }, { ensureMemberKey: ensurer({ ok: true, epoch: 3, publicKey: PK }), snapshot });
  assert.strictEqual(snapshot.calls.length, 0, 'equal is not above');
  assert.deepStrictEqual(r4.state, { lostEpoch: 3 });
});

test('waiting backs off 1 hour doubling to 24, asks nothing meanwhile, and an ok key clears it', async () => {
  let t = 0;
  const now = () => t;
  const ensure = ensurer({ ok: false, waiting: true, because: 'once a day' });
  let st = {};
  const delays = [];
  for (let i = 0; i < 8; i++) {
    const r = await job.memberKeyFor(st, { ensureMemberKey: ensure, now });
    assert.strictEqual(r.waiting, true);
    delays.push(r.state.waitUntilMs - t);
    st = r.state;
    // Just before the wait ends: nothing is asked.
    t = st.waitUntilMs - 1;
    const before = ensure.calls.length;
    const q = await job.memberKeyFor(st, { ensureMemberKey: ensure, now });
    assert.strictEqual(q.waiting, true); assert.strictEqual(ensure.calls.length, before, 'asked during the wait');
    assert.deepStrictEqual(q.state, st);
    t = st.waitUntilMs;
  }
  assert.deepStrictEqual(delays.map((d) => d / HOUR), [1, 2, 4, 8, 16, 24, 24, 24]);
  const ok = await job.memberKeyFor(st, { ensureMemberKey: ensurer({ ok: true, epoch: 1, publicKey: PK }), now });
  assert.strictEqual(ok.ok, true); assert.deepStrictEqual(ok.state, {});
});

test('a snapshot that throws or answers nothing is a failed run, and a malformed state is read as empty', async () => {
  for (const bad of [new Error('/Users/x'), undefined, 'yes']) {
    const r = await job.runOnce({}, { ensureMemberKey: ensurer({ ok: true, epoch: 1, publicKey: PK }), snapshot: snapper(bad) });
    assert.strictEqual(r.result.ok, false); assert.doesNotMatch(r.result.because, /Users/);
  }
  const ensure = ensurer({ ok: true, epoch: 1, publicKey: PK });
  await job.memberKeyFor({ lostEpoch: '2', waitUntilMs: -5, waits: 'x' }, { ensureMemberKey: ensure });
  assert.deepStrictEqual(ensure.calls, [{}]);
  assert.strictEqual(job.backoffMs(1000), job.BACKOFF_MAX_MS);
});

test('round 1: a refusal between waits keeps the wait count, so the backoff does not restart at an hour', async () => {
  let t = 0;
  const now = () => t;
  let st = { waits: 4, waitUntilMs: 10 };
  t = 10;
  const r1 = await job.memberKeyFor(st, { ensureMemberKey: ensurer({ ok: false, because: 'Kosmos+ did not answer' }), now });
  assert.deepStrictEqual(r1.state, { waits: 4 }, 'the passed wait time is dropped, the count kept');
  const r2 = await job.memberKeyFor(r1.state, { ensureMemberKey: ensurer({ ok: false, waiting: true, because: 'wait' }), now });
  assert.strictEqual(r2.state.waitUntilMs - t, 16 * HOUR);
  assert.strictEqual(r2.state.waits, 5);
});

test('round 1: a stored wait further ahead than the longest backoff is read as over, and asks', async () => {
  const ensure = ensurer({ ok: true, epoch: 1, publicKey: PK });
  const r = await job.memberKeyFor({ waitUntilMs: 1000 + job.BACKOFF_MAX_MS + 1, waits: 9 }, { ensureMemberKey: ensure, now: () => 1000 });
  assert.strictEqual(ensure.calls.length, 1); assert.strictEqual(r.ok, true);
  // Control: exactly the longest backoff ahead still waits.
  const e2 = ensurer({ ok: true, epoch: 1, publicKey: PK });
  const q = await job.memberKeyFor({ waitUntilMs: 1000 + job.BACKOFF_MAX_MS, waits: 9 }, { ensureMemberKey: e2, now: () => 1000 });
  assert.strictEqual(e2.calls.length, 0); assert.strictEqual(q.waiting, true);
});

test('round 1: ensureMemberKey\'s structured answers reach the run result (unreadable file, refusal) and the key (pending, ignored)', async () => {
  const snapshot = snapper({ ok: true });
  const u = await job.runOnce({}, { ensureMemberKey: ensurer({ ok: false, unreadableKeyFile: true, because: 'the backup key file on this computer could not be read' }), snapshot });
  assert.strictEqual(u.result.unreadableKeyFile, true); assert.strictEqual(u.result.ok, false);
  const refusal = { status: 404, code: 'backup_off', currentEpoch: null };
  const f = await job.runOnce({}, { ensureMemberKey: ensurer({ ok: false, because: 'backups are off', refusal }), snapshot });
  assert.deepStrictEqual(f.result.refusal, refusal); assert.strictEqual('state' in f.result, false);
  const w = await job.runOnce({}, { ensureMemberKey: ensurer({ ok: false, waiting: true, because: 'wait' }), snapshot, now: () => 0 });
  assert.strictEqual(w.result.waiting, true);
  assert.strictEqual(snapshot.calls.length, 0);
  // A pending newer key: sealed under the answered (registered) one, and said.
  const p = await job.runOnce({}, { ensureMemberKey: ensurer({ ok: true, epoch: 2, publicKey: PK, pendingEpoch: 3 }), snapshot });
  assert.deepStrictEqual(snapshot.calls, [{ memberPk: PK, epoch: '2' }]);
  assert.strictEqual(p.key.pendingEpoch, 3);
  // lostEpoch ignored because the newest registered key is ABOVE it: that key is current, sealed under, state cleared.
  const s2 = snapper({ ok: true });
  const i = await job.runOnce({ lostEpoch: 2 }, { ensureMemberKey: ensurer({ ok: true, epoch: 4, publicKey: PK, lostEpochIgnored: true }), snapshot: s2 });
  assert.deepStrictEqual(s2.calls, [{ memberPk: PK, epoch: '4' }]);
  assert.strictEqual(i.key.lostEpochIgnored, true); assert.deepStrictEqual(i.state, {});
});
