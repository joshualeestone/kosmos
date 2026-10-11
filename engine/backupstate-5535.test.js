'use strict';
// kosmos#5535 E0.6 slice (c), first half: what one backup run keeps for the next (engine/backupstate.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backupstate-5535-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const backupkeys = require('./backupkeys');
const bs = require('./backupstate');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const name = (i) => crypto.createHash('sha256').update(String(i)).digest('hex');
const entry = (i, label = '2026-W41') => [name(i), { key: `o1/acct1/1/${label}/k${i}`, lockedUntilMs: 1800000000000 + i, memberKeyId: 'ab'.repeat(16) }];
let n = 0;
const ids = () => { n += 1; return [`o${n}`, `m${n}`]; };

test('a missing file is an empty state; a written state reads back exactly, owner-only', () => {
  const [org, member] = ids();
  const r0 = bs.readState(org, member);
  assert.deepEqual(r0, { ok: true, state: { job: {}, period: null } });
  const nk = crypto.randomBytes(32);
  const state = { job: { lostEpoch: 2, waitUntilMs: 1800000000000, waits: 3 }, period: { label: '2026-W41', namingKey: nk, bucket: 'bucket/', index: new Map([entry(1), entry(2)]) } };
  bs.writeState(org, member, state);
  const r = bs.readState(org, member);
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.state.job, state.job);
  assert.ok(r.state.period.namingKey.equals(nk));
  assert.equal(r.state.period.bucket, 'bucket/');
  assert.deepEqual([...r.state.period.index], [...state.period.index]);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(bs.fileFor(org, member)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(bs.fileFor(org, member))).mode & 0o777, 0o700);
  }
  // The file is under the board's own store, not the member key's folder.
  assert.ok(bs.fileFor(org, member).startsWith(path.join(store.ROOT, 'backupstate')));
});

test('a file that is not ours is refused, never read as empty (so nothing overwrites it)', () => {
  const [org, member] = ids();
  const good = { job: {}, period: { label: '2026-W41', namingKey: crypto.randomBytes(32), bucket: 'b/', index: new Map([entry(1)]) } };
  bs.writeState(org, member, good);
  const f = bs.fileFor(org, member);
  const ok = JSON.parse(fs.readFileSync(f, 'utf8'));
  const variants = {
    'not JSON': '{',
    'another member': JSON.stringify(Object.assign({}, ok, { member: 'someone' })),
    'another version': JSON.stringify(Object.assign({}, ok, { v: 2 })),
    'a naming key id that is not its key\'s': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { namingKeyId: 'cd'.repeat(16) }) })),
    'a non-canonical naming key': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { namingKey: ok.period.namingKey + 'A' }) })),
    'a chunk from another period': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { index: [[name(9), 'o1/acct1/1/2026-W40/k9', 1800000000000, 'ab'.repeat(16)]] }) })),
    'an index with no bucket': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { bucket: null }) })),
    'a bad chunk name': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { index: [['XYZ', ok.period.index[0][1], 1, 'ab'.repeat(16)]] }) })),
    'a duplicated chunk': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { index: [ok.period.index[0], ok.period.index[0]] }) })),
    'a bad period label': JSON.stringify(Object.assign({}, ok, { period: Object.assign({}, ok.period, { label: 'week 41' }) })),
  };
  for (const [what, body] of Object.entries(variants)) {
    fs.writeFileSync(f, body);
    const r = bs.readState(org, member);
    assert.equal(r.ok, false, what);
    assert.ok(!r.because.includes(SANDBOX), `${what}: no path`);
  }
  // Control: the original bytes read.
  fs.writeFileSync(f, JSON.stringify(ok));
  assert.equal(bs.readState(org, member).ok, true);
});

test('a link in place of the file is refused', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const [org, member] = ids();
  bs.writeState(org, member, { job: {}, period: null });
  const f = bs.fileFor(org, member);
  const elsewhere = f + '.real';
  fs.renameSync(f, elsewhere);
  fs.symlinkSync(elsewhere, f);
  const r = bs.readState(org, member);
  assert.equal(r.ok, false); assert.match(r.because, /link/);
});

test('job fields that are not engine/backupjob.js state are dropped on write and read', () => {
  const [org, member] = ids();
  bs.writeState(org, member, { job: { lostEpoch: '2', waitUntilMs: -1, waits: 1.5, other: 'x' }, period: null });
  assert.deepEqual(bs.readState(org, member).state.job, {});
});

test('writeState refuses a period it would not read back (a bad label, a short key)', () => {
  const [org, member] = ids();
  assert.throws(() => bs.writeState(org, member, { job: {}, period: { label: 'x', namingKey: crypto.randomBytes(32), bucket: null, index: new Map() } }), /would not read back/);
  assert.throws(() => bs.writeState(org, member, { job: {}, period: { label: '2026-W41', namingKey: Buffer.alloc(31), bucket: null, index: new Map() } }));
  assert.deepEqual(bs.readState(org, member), { ok: true, state: { job: {}, period: null } }, 'nothing was written');
});

test('forPeriod keeps the same period (its key and index) and starts a new one fresh', () => {
  const nk = crypto.randomBytes(32);
  const state = { job: {}, period: { label: '2026-W41', namingKey: nk, bucket: 'b/', index: new Map([entry(1)]) } };
  assert.equal(bs.forPeriod(state, '2026-W41'), state.period);
  const fresh = crypto.randomBytes(32);
  const next = bs.forPeriod(state, '2026-W42', () => fresh);
  assert.deepEqual({ label: next.label, bucket: next.bucket, size: next.index.size }, { label: '2026-W42', bucket: null, size: 0 });
  assert.ok(next.namingKey.equals(fresh));
  const none = bs.forPeriod({ job: {}, period: null }, '2026-W41');
  assert.equal(none.namingKey.length, 32); assert.ok(!none.namingKey.equals(nk));
  assert.throws(() => bs.forPeriod(state, 'W41'));
});

test('withRun merges added chunks under the bucket; staleIndex or another bucket drops the old index', () => {
  const nk = crypto.randomBytes(32);
  const period = { label: '2026-W41', namingKey: nk, bucket: 'b/', index: new Map([entry(1)]) };
  const state = { job: { waits: 1 }, period };
  const merged = bs.withRun(state, period, { ok: true, added: new Map([entry(2)]), bucket: 'b/' });
  assert.deepEqual([...merged.period.index.keys()], [name(1), name(2)]);
  assert.deepEqual(merged.job, { waits: 1 });
  assert.equal(period.index.size, 1, 'the input period is not changed');
  const stale = bs.withRun(state, period, { ok: false, staleIndex: true, added: new Map([entry(3)]), bucket: 'b/' });
  assert.deepEqual([...stale.period.index.keys()], [name(3)]);
  const moved = bs.withRun(state, period, { ok: false, added: new Map([entry(4)]), bucket: 'c/' });
  assert.deepEqual([...moved.period.index.keys()], [name(4)]); assert.equal(moved.period.bucket, 'c/');
  const gone = bs.withRun(state, period, { ok: false, added: new Map(), bucket: null });
  assert.equal(gone.period.index.size, 0); assert.equal(gone.period.bucket, null);
  // A first run (no bucket yet) takes the run's bucket and its chunks.
  const first = bs.withRun(state, { label: '2026-W41', namingKey: nk, bucket: null, index: new Map() }, { ok: true, added: new Map([entry(5)]), bucket: 'b/' });
  assert.deepEqual([...first.period.index.keys()], [name(5)]); assert.equal(first.period.bucket, 'b/');
  // And it all writes and reads back.
  const [org, member] = ids();
  bs.writeState(org, member, merged);
  assert.deepEqual([...bs.readState(org, member).state.period.index.keys()], [name(1), name(2)]);
  assert.equal(backupkeys.namingKeyId(bs.readState(org, member).state.period.namingKey), backupkeys.namingKeyId(nk));
});
