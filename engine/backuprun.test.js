'use strict';
/**
 * kosmos#5535 E0.6 slice (c), second half: engine/backuprun.js composes one backup run. The key step and the snapshot
 * are stand-ins that record what they were given; the state file, the pointer and the period logic are the real
 * modules, in a sandboxed data root.
 *   node --test engine/backuprun.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backuprun-5535-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const backupstate = require('./backupstate');
const snap = require('./backupsnapshot');
const run = require('./backuprun');

const A = { org: 'org1', member: 'acct1' };
const B = { org: 'org2', member: 'acct1' };
const PK = crypto.randomBytes(32);
const MKID = snap.memberKeyIdOf(PK);
const NOW = Date.parse('2026-10-08T12:00:00Z');
const WEEK = snap.periodOf(NOW);   // 2026-W41
const NEXT = snap.periodOf(NOW + 7 * 24 * 3600 * 1000);
const DEV = { ok: true, privateKey: crypto.generateKeyPairSync('ed25519').privateKey };

/* ensureMemberKey answering from a list (the last repeats), recording each call's options. */
function ensurer(...answers) {
  const calls = [];
  const fn = async (opts) => { calls.push(opts); return answers.length > 1 ? answers.shift() : answers[0]; };
  fn.calls = calls;
  return fn;
}
const okKey = (pair, epoch = 1) => ({ ok: true, epoch, publicKey: PK, ...pair });
/* takeSnapshot answering from a list, recording each input and what the state file held when it was called. */
function taker(...answers) {
  const calls = [];
  const fn = async (input) => {
    const onDisk = backupstate.readState(input.ctx.org, input.ctx.member);
    calls.push({ input, onDisk });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    return typeof a === 'function' ? a(input) : a;
  };
  fn.calls = calls;
  return fn;
}
/* A chunk row as the snapshot reports it in `added`. */
function added(label, n = 2, pair = A) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    m.set(crypto.randomBytes(32).toString('hex'), { key: `${pair.org}/${pair.member}/1/${label}/${crypto.randomBytes(8).toString('hex')}`, lockedUntilMs: NOW + 40 * 24 * 3600 * 1000, memberKeyId: MKID });
  }
  return m;
}
const deps = (over) => Object.assign({ now: () => NOW, deviceKey: () => DEV, macRequest: async () => ({ ok: false }) }, over);
const pointer = () => JSON.parse(fs.readFileSync(path.join(store.ROOT, 'backupstate', 'current.json'), 'utf8'));
const wipe = () => fs.rmSync(path.join(store.ROOT, 'backupstate'), { recursive: true, force: true });

test.beforeEach(wipe);
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('a first run learns its pair before any snapshot, then runs under it: the naming key is on disk before the snapshot', async () => {
  const ensure = ensurer(okKey(A));
  const take = taker((input) => ({ ok: true, manifestKey: 'm1', added: added(WEEK), bucket: 'b1', files: 3 }));
  const r = await run.runBackup({ roots: [{ name: 'work', path: SANDBOX }] }, deps({ ensureMemberKey: ensure, takeSnapshot: take }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal('added' in r, false, 'the chunk map is the state\'s, not the caller\'s');
  assert.equal(ensure.calls.length, 2, 'learned, then ran under the pair');
  assert.deepEqual(pointer(), { v: 1, ...A });
  assert.equal(take.calls.length, 1);
  const { input, onDisk } = take.calls[0];
  assert.deepEqual(input.ctx, Object.assign({}, A, { epoch: '1', period: WEEK, snapshot: input.ctx.snapshot }));
  assert.match(input.ctx.snapshot, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  assert.equal(input.deviceKey, DEV.privateKey);
  assert.deepEqual(input.roots, [{ name: 'work', path: SANDBOX }]);
  // Written BEFORE the snapshot: a run that dies keeps the key.
  assert.equal(onDisk.ok, true);
  assert.equal(onDisk.state.periods[0].label, WEEK);
  assert.ok(onDisk.state.periods[0].namingKey.equals(input.namingKey), 'the snapshot\'s naming key was not on disk first');
  // And after: the chunks are in the index under the bucket.
  const after = backupstate.readState(A.org, A.member);
  assert.equal(after.state.periods[0].index.size, 2);
  assert.equal(after.state.periods[0].bucket, 'b1');
});

test('the next run in the same week reuses the naming key and deduplicates against the kept index', async () => {
  const first = taker({ ok: true, added: added(WEEK, 3), bucket: 'b1' });
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: first }));
  const second = taker({ ok: true, added: new Map(), bucket: 'b1' });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: second }));
  assert.equal(r.ok, true);
  assert.ok(second.calls[0].input.namingKey.equals(first.calls[0].input.namingKey));
  assert.equal(second.calls[0].input.index.size, 3);
  assert.equal(second.calls[0].input.bucket, 'b1');
});

test('newPeriod with a granted week runs once more in that week, and never a third time', async () => {
  const take = taker({ ok: false, newPeriod: true, grantedPeriod: NEXT, because: 'a new week' });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: take }));
  assert.equal(take.calls.length, 2);
  assert.deepEqual(take.calls.map((c) => c.input.ctx.period), [WEEK, NEXT]);
  assert.equal(r.newPeriod, true);
  // Review 1: the granted week's naming key was on disk before ITS snapshot too, and both weeks are kept.
  const second = take.calls[1];
  assert.equal(second.onDisk.state.periods[0].label, NEXT);
  assert.ok(second.onDisk.state.periods[0].namingKey.equals(second.input.namingKey));
  assert.deepEqual(backupstate.readState(A.org, A.member).state.periods.map((x) => x.label), [NEXT, WEEK]);
  // Without grantedPeriod (or the same week), it stops after one.
  for (const answer of [{ ok: false, newPeriod: true }, { ok: false, newPeriod: true, grantedPeriod: WEEK }]) {
    wipe();
    const t = taker(answer);
    await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: t }));
    assert.equal(t.calls.length, 1, JSON.stringify(answer));
  }
  // A granted week that does not parse: the first answer stands.
  wipe();
  const bad = taker({ ok: false, newPeriod: true, grantedPeriod: 'next week', because: 'a new week' });
  const rb = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: bad }));
  assert.deepEqual([bad.calls.length, rb.because], [1, 'a new week']);
});

test('another pair named: the pointer moves and the run goes on under that pair; twice in one run stops with no snapshot', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true, added: added(WEEK), bucket: 'b1' }) }));
  const ensure = ensurer(okKey(B));
  const take = taker({ ok: true, added: new Map(), bucket: 'b2' });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensure, takeSnapshot: take }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(pointer(), { v: 1, ...B });
  assert.deepEqual([take.calls.length, take.calls[0].input.ctx.org], [1, 'org2']);
  assert.equal(take.calls[0].input.index.size, 0, 'org2 ran against org1\'s index');
  // A's state is left as it was.
  assert.equal(backupstate.readState(A.org, A.member).state.periods[0].index.size, 2);
  // Flapping: B is current, the answers name A then B.
  const flap = taker({ ok: true });
  const f = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A), okKey(B)), takeSnapshot: flap }));
  assert.deepEqual([f.ok, f.pairChanged, flap.calls.length], [false, true, 0]);
});

test('a state file that is not this computer\'s stops the run before any request, and is left as it is', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  const f = backupstate.fileFor(A.org, A.member);
  fs.writeFileSync(f, '{"v":1,"org":"someone else"}');
  const ensure = ensurer(okKey(A));
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensure, takeSnapshot: taker({ ok: true }) }));
  assert.deepEqual([r.ok, r.refusedState, ensure.calls.length], [false, true, 0]);
  assert.equal(fs.readFileSync(f, 'utf8'), '{"v":1,"org":"someone else"}');
});

test('the job\'s state is kept between runs: a wait is not asked again until it ends', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  const wait = ensurer({ ok: false, waiting: true, because: 'once a day', ...A });
  const r1 = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: wait }));
  assert.equal(r1.waiting, true);
  assert.ok(backupstate.readState(A.org, A.member).state.job.waitUntilMs > NOW);
  const again = ensurer(okKey(A));
  const r2 = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: again, now: () => NOW + 60 * 1000 }));
  assert.deepEqual([r2.waiting, again.calls.length], [true, 0]);
});

test('no device key: nothing is asked of Kosmos+ and nothing is written; missing is said apart from a retry', async () => {
  for (const dk of [{ ok: false, retry: true, because: 'the device key could not be read just now' }, { ok: false, missing: true, because: 'remote access is not set up on this computer' }]) {
    wipe();
    const ensure = ensurer(okKey(A));
    const take = taker({ ok: true });
    const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensure, takeSnapshot: take, deviceKey: () => dk }));
    assert.deepEqual([r.ok, r.retry === true, r.missing === true, ensure.calls.length, take.calls.length], [false, !!dk.retry, !!dk.missing, 0, 0], JSON.stringify(r));
    assert.equal(fs.existsSync(path.join(store.ROOT, 'backupstate')), false, 'state was written with no device key');
  }
  // A key that goes away between the first read and the snapshot: no snapshot, and the period's naming key is kept.
  let reads = 0;
  const take = taker({ ok: true });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: take, deviceKey: () => (++reads === 1 ? DEV : { ok: false, retry: true, because: 'gone' }) }));
  assert.deepEqual([r.ok, r.retry, take.calls.length], [false, true, 0]);
  assert.equal(backupstate.readState(A.org, A.member).state.periods[0].label, WEEK);
});

test('a state that cannot be written before the snapshot: no snapshot, and the answer never claims the backup ran', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  // Between the run's read and its first write, the file stops being this computer's (the key step stands in for
  // whatever changed it): writeState refuses to replace it.
  const f = backupstate.fileFor(A.org, A.member);
  const ensure = async () => { fs.writeFileSync(f, 'not ours'); return okKey(A); };
  const take = taker({ ok: true });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensure, takeSnapshot: take }));
  assert.equal(take.calls.length, 0);
  assert.deepEqual([r.ok, r.refusedState], [false, true], JSON.stringify(r));
  assert.match(r.because, /no backup was taken/);
  assert.doesNotMatch(r.because, /ran/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'not ours', 'the file was replaced');
});

test('runs are one at a time', async () => {
  let inside = 0, most = 0;
  const take = taker(async () => { inside++; most = Math.max(most, inside); await new Promise((res) => setTimeout(res, 20)); inside--; return { ok: true }; });
  await Promise.all([1, 2, 3].map(() => run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: take }))));
  assert.deepEqual([take.calls.length, most], [3, 1]);
});

test('a pointer that cannot be written: the run stops with its own sentence, and no snapshot', async () => {
  // The pointer path is a folder: reading it gives none, writing the learned pair fails.
  fs.mkdirSync(path.join(store.ROOT, 'backupstate', 'current.json'), { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'backupstate', 'current.json', 'x'), '');
  const take = taker({ ok: true });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: take }));
  assert.deepEqual([r.ok, take.calls.length], [false, 0]);
  assert.match(r.because, /could not note which company/);
  r.because = 'changed by the caller';   // a copy: the next refusal is unchanged
  const again = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: take }));
  assert.match(again.because, /could not note which company/);
});

test('never throws: an error inside the run itself is a fixed sentence, never its message', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer({ ok: false, waiting: true, because: 'once a day', ...A }) }));
  // A wait is held, so the key step reads the clock outside any guard of its own: the throw reaches runNow's.
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), now: () => { throw new Error('/Users/someone/secret path'); } }));
  assert.equal(r.ok, false);
  assert.match(r.because, /^the backup could not run on this computer/);
  assert.doesNotMatch(JSON.stringify(r), /someone|secret/);
});

test('review 1: a lost pointer over a live state file reuses that pair\'s naming key and index', async () => {
  const first = taker({ ok: true, added: added(WEEK, 3), bucket: 'b1' });
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: first }));
  fs.rmSync(path.join(store.ROOT, 'backupstate', 'current.json'));
  const second = taker({ ok: true, added: new Map(), bucket: 'b1' });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: second }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(second.calls[0].input.namingKey.equals(first.calls[0].input.namingKey), 'a fresh naming key replaced the kept one');
  assert.equal(second.calls[0].input.index.size, 3, 'the kept index was dropped');
});

test('review 1: a first run whose key step refuses keeps the pair and that answer, and sends nothing more', async () => {
  const ensure = ensurer({ ok: false, waiting: true, pendingEpoch: 2, because: 'once a day', ...A });
  const take = taker({ ok: true });
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensure, takeSnapshot: take }));
  assert.deepEqual([r.ok, r.waiting, ensure.calls.length, take.calls.length], [false, true, 1, 0]);
  assert.deepEqual(pointer(), { v: 1, ...A });
  assert.ok(backupstate.readState(A.org, A.member).state.job.waitUntilMs > NOW, 'the wait was not kept');
  // The next run waits it out without asking.
  const again = ensurer(okKey(A));
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: again, now: () => NOW + 60 * 1000 }));
  assert.equal(again.calls.length, 0);
});

test('review 1: a state that cannot be written AFTER the run keeps the run\'s own answer; "ran" only when a snapshot was taken', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  const f = backupstate.fileFor(A.org, A.member);
  // A snapshot taken, then the file stops being ours before the final write.
  const took = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker(() => { fs.writeFileSync(f, 'not ours'); return { ok: true, manifestKey: 'm9' }; }) }));
  assert.deepEqual([took.ok, took.manifestKey, took.stateNotKept, took.refusedState], [true, 'm9', true, true], JSON.stringify(took));
  assert.match(took.stateBecause, /the backup ran/);
  // No snapshot (a wait), and the file stops being ours during the key step: the wait's flags stand, and no "ran".
  backupstate.discardState(A.org, A.member);
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  const waited = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: async () => { fs.writeFileSync(f, 'not ours'); return { ok: false, waiting: true, pendingEpoch: 2, because: 'once a day', ...A }; } }));
  assert.deepEqual([waited.ok, waited.waiting, waited.pendingEpoch, waited.stateNotKept], [false, true, 2, true], JSON.stringify(waited));
  assert.doesNotMatch(waited.stateBecause, /ran/);
});

test('review 2: an ok key whose answer names no pair is said as that; learnPair never reaches the caller', async () => {
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer({ ok: true, epoch: 1, publicKey: PK }), takeSnapshot: taker({ ok: true }) }));
  assert.deepEqual([r.ok, 'learnPair' in r], [false, false], JSON.stringify(r));
  assert.match(r.because, /did not name the company/);
});

test('review 2: lostEpochIgnored and leftOut reach the caller', async () => {
  const bad = new Map([['not-a-name', { key: 'x', lockedUntilMs: 1, memberKeyId: MKID }]]);
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(Object.assign(okKey(A), { lostEpochIgnored: true })), takeSnapshot: taker({ ok: true, added: bad, bucket: 'b1' }) }));
  assert.deepEqual([r.ok, r.lostEpochIgnored, r.leftOut], [true, true, 1], JSON.stringify(r));
});

test('end to end: a run through the REAL snapshot is restored by the real restore with nothing but the member key and the device key', async () => {
  const bf = require('./backupformat');
  const br = require('./backuprestore');
  const { hpkeKeyPair } = require('./hpke');
  const member = hpkeKeyPair();
  const dev = crypto.generateKeyPairSync('ed25519');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backuprun-e2e-')));
  const root = path.join(base, 'kosmos');
  fs.mkdirSync(path.join(root, 'agents', 'a'), { recursive: true });
  const files = { 'agents/a/notes.md': Buffer.from('plain notes\n'), 'readme.txt': Buffer.from('hello'),
    'agents/a/long.md': Buffer.from(Array.from({ length: 20000 }, (_, i) => `line ${i} of a long file\n`).join('')) };
  for (const [rel, b] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), b);
  // A store standing in for both uploaders, handing out keys in the run's week, under the run's pair and epoch.
  const objects = new Map(), manifests = [];
  let n = 0;
  const LOCKED = Date.parse('2026-11-11T00:15:00Z');
  const uploadChunks = async (d, batch) => {
    const keys = new Map(), lockedUntil = new Map();
    for (const { name, object } of batch) { const key = `${A.org}/${A.member}/1/${WEEK}/k${++n}`; objects.set(key, Buffer.from(object)); keys.set(name, key); lockedUntil.set(name, LOCKED); }
    return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
  };
  const uploadManifest = async (d, bytes) => { manifests.push(bytes); return { ok: true, key: `${A.org}/${A.member}/1/${WEEK}/m${manifests.length}`, lockedUntilMs: LOCKED }; };
  let sealedCtx;   // the context the run gave the snapshot (the snapshot id is the run's own)
  const takeSnapshot = (input) => { sealedCtx = input.ctx; return snap.takeSnapshot(input, { now: () => NOW, uploadChunks, uploadManifest }); };
  try {
    const ensure = ensurer({ ok: true, epoch: 1, publicKey: member.pk, ...A });
    const r = await run.runBackup({ roots: [{ name: 'work', path: root }] }, deps({ ensureMemberKey: ensure, takeSnapshot, deviceKey: () => ({ ok: true, privateKey: dev.privateKey }) }));
    assert.equal(r.ok, true, r.because);
    assert.equal(manifests.length, 1);
    // The restore side knows its member key, the device's public key and the context. It is given NO naming key: the
    // manifest carries it (slice (a)), and nothing else stores one.
    const kept = backupstate.readState(A.org, A.member).state;
    const committed = new Map();
    const sink = { begin(p) { const parts = []; return { write(b) { parts.push(Buffer.from(b)); }, commit() { committed.set(p, Buffer.concat(parts)); }, abort() {} }; } };
    const opened = bf.openManifest(member.sk, dev.publicKey, sealedCtx, manifests[0]);
    assert.ok(opened, 'the manifest opens with the device key and the run\'s context');
    const rr = await br.restoreSnapshot({ memberSk: member.sk, devicePubAtSnapshot: dev.publicKey, ctx: sealedCtx, manifestObject: manifests[0],
      fetchChunk: (name) => objects.get(opened.objects[name]) || null, sink, maxTotalBytes: 2 ** 40 });
    assert.equal(rr.failed.length, 0, JSON.stringify(rr.failed));
    for (const [rel, b] of Object.entries(files)) assert.ok(committed.get('work/' + rel) && committed.get('work/' + rel).equals(b), rel);
    assert.equal(kept.periods[0].index.size, Object.keys(opened.objects).length, 'every stored chunk is in the kept index');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('review 4: a refused or failed snapshot is never called a backup that ran, even when the final write fails', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  const f = backupstate.fileFor(A.org, A.member);
  for (const answer of [{ ok: false, overAllowance: true, because: 'the week is used up' }, new Error('boom')]) {
    backupstate.discardState(A.org, A.member);
    await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
    const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: async () => { fs.writeFileSync(f, 'not ours'); if (answer instanceof Error) throw answer; return answer; } }));
    assert.deepEqual([r.ok, r.stateNotKept], [false, true], JSON.stringify(r));
    assert.doesNotMatch(r.stateBecause, /ran/, JSON.stringify(answer));
  }
});

test('review 6: every result names the pair the run worked under, so a refused file can be set aside by its pair', async () => {
  await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(A)), takeSnapshot: taker({ ok: true }) }));
  // Kosmos+ now names B, whose file is not this computer's: the refusal is about B, and says so.
  fs.mkdirSync(path.dirname(backupstate.fileFor(B.org, B.member)), { recursive: true });
  fs.writeFileSync(backupstate.fileFor(B.org, B.member), 'not ours');
  const r = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(B)), takeSnapshot: taker({ ok: true }) }));
  assert.deepEqual([r.ok, r.refusedState, r.pair], [false, true, B], JSON.stringify(r));
  // The caller can act on it: set B's file aside, and the next run goes on under B.
  assert.equal(backupstate.discardState(r.pair.org, r.pair.member).ok, true);
  const take = taker({ ok: true, manifestKey: 'm' });
  const next = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer(okKey(B)), takeSnapshot: take }));
  assert.deepEqual([next.ok, next.pair, take.calls[0].input.ctx.org], [true, B, 'org2'], JSON.stringify(next));
  // A run that never learned a pair names none.
  wipe();
  const none = await run.runBackup({ roots: [] }, deps({ ensureMemberKey: ensurer({ ok: false, because: 'no answer' }) }));
  assert.equal('pair' in none, false);
});
