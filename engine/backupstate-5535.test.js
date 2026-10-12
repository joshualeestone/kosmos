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
  assert.deepEqual(r0, { ok: true, state: { job: {}, periods: [] } });
  const nk = crypto.randomBytes(32);
  const state = { job: { lostEpoch: 2, waitUntilMs: 1800000000000, waits: 3 }, periods: [{ label: '2026-W41', namingKey: nk, bucket: 'bucket/', index: new Map([entry(1), entry(2)]) }] };
  bs.writeState(org, member, state);
  const r = bs.readState(org, member);
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(r.state.job, state.job);
  assert.ok(r.state.periods[0].namingKey.equals(nk));
  assert.equal(r.state.periods[0].bucket, 'bucket/');
  assert.deepEqual([...r.state.periods[0].index], [...state.periods[0].index]);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(bs.fileFor(org, member)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(bs.fileFor(org, member))).mode & 0o777, 0o700);
  }
  // The file is under the board's own store, not the member key's folder.
  assert.ok(bs.fileFor(org, member).startsWith(path.join(store.ROOT, 'backupstate')));
});

test('a file that is not ours is refused, never read as empty (so nothing overwrites it)', () => {
  const [org, member] = ids();
  const good = { job: {}, periods: [{ label: '2026-W41', namingKey: crypto.randomBytes(32), bucket: 'b/', index: new Map([entry(1)]) }] };
  bs.writeState(org, member, good);
  const f = bs.fileFor(org, member);
  const ok = JSON.parse(fs.readFileSync(f, 'utf8'));
  const variants = {
    'not JSON': '{',
    'another member': JSON.stringify(Object.assign({}, ok, { member: 'someone' })),
    'another version': JSON.stringify(Object.assign({}, ok, { v: 2 })),
    'a naming key id that is not its key\'s': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { namingKeyId: 'cd'.repeat(16) })] })),
    'a non-canonical naming key': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { namingKey: ok.periods[0].namingKey + 'A' })] })),
    'a chunk from another period': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { index: [[name(9), 'o1/acct1/1/2026-W40/k9', 1800000000000, 'ab'.repeat(16)]] })] })),
    'an index with no bucket': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { bucket: null })] })),
    'a bad chunk name': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { index: [['XYZ', ok.periods[0].index[0][1], 1, 'ab'.repeat(16)]] })] })),
    'a duplicated chunk': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { index: [ok.periods[0].index[0], ok.periods[0].index[0]] })] })),
    'a bad period label': JSON.stringify(Object.assign({}, ok, { periods: [Object.assign({}, ok.periods[0], { label: 'week 41' })] })),
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
  bs.writeState(org, member, { job: {}, periods: [] });
  const f = bs.fileFor(org, member);
  const elsewhere = f + '.real';
  fs.renameSync(f, elsewhere);
  fs.symlinkSync(elsewhere, f);
  const r = bs.readState(org, member);
  assert.equal(r.ok, false); assert.match(r.because, /link/);
});

test('job fields that are not engine/backupjob.js state are dropped on write and read', () => {
  const [org, member] = ids();
  bs.writeState(org, member, { job: { lostEpoch: '2', waitUntilMs: -1, waits: 1.5, other: 'x' }, periods: [] });
  assert.deepEqual(bs.readState(org, member).state.job, {});
});

test('writeState refuses a period it would not read back (a bad label, a short key)', () => {
  const [org, member] = ids();
  assert.throws(() => bs.writeState(org, member, { job: {}, periods: [{ label: 'x', namingKey: crypto.randomBytes(32), bucket: null, index: new Map() }] }), /would not read back/);
  // A malformed index row (no bucket) reaches the read-back refusal itself (a 31-byte key would throw earlier, in namingKeyId).
  assert.throws(() => bs.writeState(org, member, { job: {}, periods: [{ label: '2026-W41', namingKey: crypto.randomBytes(32), bucket: null, index: new Map([entry(1)]) }] }), /would not read back/);
  assert.deepEqual(bs.readState(org, member), { ok: true, state: { job: {}, periods: [] } }, 'nothing was written');
});

const MK = 'ab'.repeat(16), NOW = Date.parse('2026-10-07T12:00:00Z');   // a Wednesday in 2026-W41
test('forPeriod keeps the same period (its key and index) and starts a new one fresh', () => {
  const nk = crypto.randomBytes(32);
  const state = { job: {}, periods: [{ label: '2026-W41', namingKey: nk, bucket: 'b/', index: new Map([entry(1)]) }] };
  const same = bs.forPeriod(state, '2026-W41', { memberKeyId: MK, nowMs: NOW });
  assert.ok(same.namingKey.equals(nk)); assert.equal(same.bucket, 'b/'); assert.deepEqual([...same.index], [...state.periods[0].index]);
  const fresh = crypto.randomBytes(32);
  const next = bs.forPeriod(state, '2026-W42', { memberKeyId: MK, nowMs: NOW, newKey: () => fresh });
  assert.deepEqual({ label: next.label, bucket: next.bucket, size: next.index.size }, { label: '2026-W42', bucket: null, size: 0 });
  assert.ok(next.namingKey.equals(fresh));
  const none = bs.forPeriod({ job: {}, periods: [] }, '2026-W41', { memberKeyId: MK, nowMs: NOW });
  assert.equal(none.namingKey.length, 32); assert.ok(!none.namingKey.equals(nk));
  assert.throws(() => bs.forPeriod(state, 'W41', { memberKeyId: MK, nowMs: NOW }));
  assert.throws(() => bs.forPeriod(state, '2026-W41', {}), /member key id and the time/);
  // Review 6: any OTHER label, earlier or later, starts fresh: which week to run is the caller's call (it sees
  // takeSnapshot's grantedPeriod); a kept earlier week could never deduplicate after Monday anyway.
  const earlier = bs.forPeriod(state, '2026-W40', { memberKeyId: MK, nowMs: NOW });
  assert.equal(earlier.label, '2026-W40'); assert.ok(!earlier.namingKey.equals(nk)); assert.equal(earlier.index.size, 0);
  // Resuming prunes what takeSnapshot would refuse: another member key (a #5744 rotation), a lock that has ended.
  const mixed = { job: {}, periods: [{ label: '2026-W41', namingKey: nk, bucket: 'b/', index: new Map([
    entry(1), [name(2), { key: 'o1/acct1/1/2026-W41/k2', lockedUntilMs: 1800000000002, memberKeyId: 'cd'.repeat(16) }],
    [name(3), { key: 'o1/acct1/1/2026-W41/k3', lockedUntilMs: NOW, memberKeyId: MK }]]) }] };
  // (The ended lock is a defensive case: withRun only keeps rows takeSnapshot already checked against the manifest lock.)
  assert.deepEqual([...bs.forPeriod(mixed, '2026-W41', { memberKeyId: MK, nowMs: NOW }).index.keys()], [name(1)]);
  assert.equal(mixed.periods[0].index.size, 3, 'the input is not changed');
});

test('withRun merges added chunks under the bucket; staleIndex or another bucket drops the old index', () => {
  const nk = crypto.randomBytes(32);
  const period = { label: '2026-W41', namingKey: nk, bucket: 'b/', index: new Map([entry(1)]) };
  const state = { job: { waits: 1 }, periods: [period] };
  const merged = bs.withRun(state, period, { ok: true, added: new Map([entry(2)]), bucket: 'b/' });
  assert.deepEqual([...merged.periods[0].index.keys()], [name(1), name(2)]);
  assert.deepEqual(merged.job, { waits: 1 });
  assert.equal(period.index.size, 1, 'the input period is not changed');
  const stale = bs.withRun(state, period, { ok: false, staleIndex: true, added: new Map([entry(3)]), bucket: 'b/' });
  assert.deepEqual([...stale.periods[0].index.keys()], [name(3)]);
  const moved = bs.withRun(state, period, { ok: false, added: new Map([entry(4)]), bucket: 'c/' });
  assert.deepEqual([...moved.periods[0].index.keys()], [name(4)]); assert.equal(moved.periods[0].bucket, 'c/');
  // Review 1 BLOCKER: a run that failed before reading the index returns bucket null; it touched nothing. Kept.
  const early = bs.withRun(state, period, { ok: false, because: 'a root could not be read', added: new Map(), bucket: null });
  assert.deepEqual([...early.periods[0].index.keys()], [name(1)]); assert.equal(early.periods[0].bucket, 'b/');
  // otherBucket with an index comes with staleIndex: then it is dropped.
  const gone = bs.withRun(state, period, { ok: false, staleIndex: true, added: new Map(), bucket: null });
  assert.equal(gone.periods[0].index.size, 0);
  // A first run (no bucket yet) takes the run's bucket and its chunks.
  const first = bs.withRun(state, { label: '2026-W41', namingKey: nk, bucket: null, index: new Map() }, { ok: true, added: new Map([entry(5)]), bucket: 'b/' });
  assert.deepEqual([...first.periods[0].index.keys()], [name(5)]); assert.equal(first.periods[0].bucket, 'b/');
  // And it all writes and reads back.
  const [org, member] = ids();
  bs.writeState(org, member, merged);
  assert.deepEqual([...bs.readState(org, member).state.periods[0].index.keys()], [name(1), name(2)]);
  assert.equal(backupkeys.namingKeyId(bs.readState(org, member).state.periods[0].namingKey), backupkeys.namingKeyId(nk));
});

test('round 1: withRun leaves out a malformed added row and caps the index, so writeState never throws after a run', () => {
  const nk = crypto.randomBytes(32);
  const period = { label: '2026-W41', namingKey: nk, bucket: 'b/', index: new Map([entry(1)]) };
  const bad = [name(7), { key: 'o1/acct1/1/2026-W41/k7', lockedUntilMs: 1, memberKeyId: 'short' }];
  const other = [name(8), { key: 'o1/acct1/1/2026-W40/k8', lockedUntilMs: 1800000000008, memberKeyId: MK }];
  const r = bs.withRun({ job: {}, periods: [period] }, period, { ok: true, added: new Map([entry(2), bad, other]), bucket: 'b/' });
  assert.deepEqual([...r.periods[0].index.keys()], [name(1), name(2)]);
  const [org, member] = ids();
  bs.writeState(org, member, r);
  assert.equal(bs.readState(org, member).ok, true);
  // The cap: an index already at MAX (200000) takes nothing more, and still writes.
  const full = new Map();
  for (let i = 0; i < 200000; i++) full.set(name('f' + i), { key: `o1/acct1/1/2026-W41/f${i}`, lockedUntilMs: 1800000000000, memberKeyId: MK });
  const big = { label: '2026-W41', namingKey: nk, bucket: 'b/', index: full };
  const capped = bs.withRun({ job: {}, periods: [big] }, big, { ok: true, added: new Map([entry(3)]), bucket: 'b/' });
  assert.equal(capped.periods[0].index.size, 200000);
  assert.equal(capped.periods[0].index.has(name(3)), false);
  assert.equal(capped.leftOut, 1);
  // And a full slot writes and reads back (the read-back bound is MAX_INDEX inclusive).
  const [o2, m2] = ids();
  bs.writeState(o2, m2, capped);
  assert.equal(bs.readState(o2, m2).state.periods[0].index.size, 200000);
});

test('round 1: discardState sets a refused file aside (never deletes it), and the next read is a fresh start', () => {
  const [org, member] = ids();
  bs.writeState(org, member, { job: {}, periods: [] });
  const f = bs.fileFor(org, member);
  fs.writeFileSync(f, '{ not ours');
  assert.equal(bs.readState(org, member).ok, false);
  assert.deepEqual(bs.discardState(org, member), { ok: true });
  assert.deepEqual(bs.readState(org, member), { ok: true, state: { job: {}, periods: [] } });
  const aside = fs.readdirSync(path.dirname(f)).filter((x) => x.startsWith(path.basename(f) + '.bad-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(f), aside[0]), 'utf8'), '{ not ours');
  assert.deepEqual(bs.discardState(org, member), { ok: true }, 'nothing there is fine');
});

test('round 2: withRun says how many added rows it left out', () => {
  const period = { label: '2026-W41', namingKey: crypto.randomBytes(32), bucket: 'b/', index: new Map() };
  const r = bs.withRun({ job: {}, periods: [period] }, period, { ok: true, added: new Map([entry(1), entry(2, '2026-W40')]), bucket: 'b/' });
  assert.equal(r.leftOut, 1); assert.equal(r.periods[0].index.size, 1);
  const [org, member] = ids();
  bs.writeState(org, member, r);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(bs.fileFor(org, member), 'utf8'))).sort(), ['job', 'member', 'org', 'periods', 'v'], 'leftOut is not persisted');
});

test('round 3: org and member must be strings; week labels are 01 to 53; a passing read error is retry', () => {
  assert.throws(() => bs.readState(5, 'm'), /non-empty strings/);
  assert.throws(() => bs.writeState('o', '', { job: {}, periods: [] }), /non-empty strings/);
  assert.throws(() => bs.discardState(undefined, 'm'), /non-empty strings/);
  for (const bad of ['2026-W00', '2026-W54', '2026-W99']) assert.throws(() => bs.forPeriod({ job: {}, periods: [] }, bad, { memberKeyId: MK, nowMs: NOW }), String(bad));
  const [org, member] = ids();
  bs.writeState(org, member, { job: {}, periods: [] });
  const realRead = fs.readFileSync;
  try {
    fs.readFileSync = function (file, ...rest) {
      if (String(file) === bs.fileFor(org, member)) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
      return realRead.call(fs, file, ...rest);
    };
    const r = bs.readState(org, member);
    assert.equal(r.ok, false); assert.equal(r.retry, true);
  } finally { fs.readFileSync = realRead; }
  // A not-ours file is NOT retry (it is the discard case).
  fs.writeFileSync(bs.fileFor(org, member), '{');
  assert.equal(bs.readState(org, member).retry, undefined);
});

test('review 7: two periods are kept (this clock\'s week and the granted one), each resumed with its own key and index', () => {
  const k41 = crypto.randomBytes(32), k42 = crypto.randomBytes(32), k43 = crypto.randomBytes(32);
  const p41 = { label: '2026-W41', namingKey: k41, bucket: 'b/', index: new Map([entry(1)]) };
  const p42 = { label: '2026-W42', namingKey: k42, bucket: 'b/', index: new Map([entry(2, '2026-W42')]) };
  let state = bs.withPeriod(bs.withPeriod({ job: {}, periods: [] }, p41), p42);
  assert.deepEqual(state.periods.map((p) => p.label), ['2026-W42', '2026-W41'], 'most recently used first');
  // Asking for the OTHER kept week resumes it (the clock's week, then the granted week, alternately near Monday).
  const r41 = bs.forPeriod(state, '2026-W41', { memberKeyId: MK, nowMs: NOW });
  assert.ok(r41.namingKey.equals(k41)); assert.equal(r41.index.size, 1);
  state = bs.withRun(state, r41, { ok: true, added: new Map([entry(3)]), bucket: 'b/' });
  assert.deepEqual(state.periods.map((p) => p.label), ['2026-W41', '2026-W42']);
  const r42 = bs.forPeriod(state, '2026-W42', { memberKeyId: MK, nowMs: NOW });
  assert.ok(r42.namingKey.equals(k42), 'the granted week kept its key across the other week\'s run');
  // A third week drops the least recently used (W42 here, since W41 was used last).
  state = bs.withPeriod(state, { label: '2026-W43', namingKey: k43, bucket: null, index: new Map() });
  assert.deepEqual(state.periods.map((p) => p.label), ['2026-W43', '2026-W41']);
  // Round trip with two slots.
  const [org, member] = ids();
  bs.writeState(org, member, state);
  const back = bs.readState(org, member);
  assert.equal(back.ok, true, back.because);
  assert.deepEqual(back.state.periods.map((p) => p.label), ['2026-W43', '2026-W41']);
  assert.ok(back.state.periods[1].namingKey.equals(k41));
  // A file with three periods, or two of one label, is not one this module wrote.
  const f = bs.fileFor(org, member), ok = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [what, periods] of [['three', [ok.periods[0], ok.periods[1], ok.periods[1]]], ['a repeated label', [ok.periods[1], ok.periods[1]]], ['not a list', ok.periods[0]]]) {
    fs.writeFileSync(f, JSON.stringify(Object.assign({}, ok, { periods })));
    assert.equal(bs.readState(org, member).ok, false, what);
  }
  assert.throws(() => bs.writeState(org, member, { job: {}, periods: [p41, p41] }), /would not read back/);
  // Three distinct periods are refused on write too (withPeriod never makes them; a caller building a state by hand could).
  assert.throws(() => bs.writeState(org, member, { job: {}, periods: [p41, p42, { label: '2026-W43', namingKey: k43, bucket: null, index: new Map() }] }), /would not read back/);
});

test('review 7: added rows with no bucket are counted in leftOut', () => {
  const period = { label: '2026-W41', namingKey: crypto.randomBytes(32), bucket: null, index: new Map() };
  const r = bs.withRun({ job: {}, periods: [] }, period, { ok: false, added: new Map([entry(1), entry(2)]), bucket: null });
  assert.equal(r.leftOut, 2); assert.equal(r.periods[0].index.size, 0);
});

test('review 9: writeState never replaces a file that is not plainly this member\'s; discardState first, then it writes', () => {
  const [org, member] = ids();
  const f = bs.fileFor(org, member);
  bs.writeState(org, member, { job: {}, periods: [] });
  const fresh = { job: {}, periods: [] };
  // A corrupt or foreign file: refused, and left exactly as it was.
  for (const junk of ['{ not ours', JSON.stringify({ v: 1, org, member: 'someone else', job: {}, periods: [] })]) {
    fs.writeFileSync(f, junk);
    assert.throws(() => bs.writeState(org, member, fresh), (err) => /discardState it first/.test(err.message) && err.code === 'refused' && err.retry === false);
    assert.equal(fs.readFileSync(f, 'utf8'), junk);
  }
  // discardState, then the write goes through.
  bs.discardState(org, member);
  bs.writeState(org, member, fresh);
  assert.equal(bs.readState(org, member).ok, true);
  // A file another program holds: refused with retry, untouched (the guard reads it as readState does).
  const realRead = fs.readFileSync;
  try {
    fs.readFileSync = function (file, ...rest) {
      if (String(file) === f) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
      return realRead.call(fs, file, ...rest);
    };
    let caught;
    try { bs.writeState(org, member, fresh); } catch (err) { caught = err; }
    assert.ok(caught); assert.equal(caught.retry, true); assert.match(caught.message, /try again/);
  } finally { fs.readFileSync = realRead; }
  // Control: our own file is replaced normally.
  bs.writeState(org, member, { job: { waits: 2 }, periods: [] });
  assert.deepEqual(bs.readState(org, member).state.job, { waits: 2 });
});

test('review 9: a link in place of the file is not replaced', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const [org, member] = ids();
  bs.writeState(org, member, { job: {}, periods: [] });
  const f = bs.fileFor(org, member), elsewhere = f + '.target';
  fs.renameSync(f, elsewhere);
  fs.symlinkSync(elsewhere, f);
  assert.throws(() => bs.writeState(org, member, { job: {}, periods: [] }), /discardState it first/);
  assert.ok(fs.lstatSync(f).isSymbolicLink(), 'the link is still there');
});

test('review 10: the write guard is readState itself: a body-corrupt file is refused, a reformatted good one is replaceable, odd ids round-trip', () => {
  const [org, member] = ids();
  const f = bs.fileFor(org, member);
  bs.writeState(org, member, { job: { waits: 1 }, periods: [] });
  const good = fs.readFileSync(f, 'utf8');
  // Our own first bytes, then garbage: readState refuses it, so writeState must not overwrite it.
  const corrupt = good.slice(0, 40) + 'GARBAGE';
  fs.writeFileSync(f, corrupt);
  assert.equal(bs.readState(org, member).ok, false);
  assert.throws(() => bs.writeState(org, member, { job: {}, periods: [] }), /discardState it first/);
  assert.equal(fs.readFileSync(f, 'utf8'), corrupt, 'left as it was');
  // The same good state pretty-printed (a person or a tool reformatted it): reads ok, so it may be replaced.
  fs.writeFileSync(f, JSON.stringify(JSON.parse(good), null, 1));
  assert.equal(bs.readState(org, member).ok, true);
  bs.writeState(org, member, { job: { waits: 3 }, periods: [] });
  assert.deepEqual(bs.readState(org, member).state.job, { waits: 3 });
  // Ids with a quote, a backslash, a line separator, an emoji and a lone surrogate: written, read, replaced.
  // A lone surrogate is refused (it would share a file with U+FFFD, review 11).
  assert.throws(() => bs.writeState('o\ud800', 'm', { job: {}, periods: [] }), /well-formed/);
  assert.throws(() => bs.readState('o\ufffd', 'm\udc00'), /well-formed/);
  for (const odd of ['o"q', 'o\\b', 'o\u2028x', 'o\u{1F600}', 'o\ufffd']) {
    bs.writeState(odd, 'm', { job: {}, periods: [] });
    assert.equal(bs.readState(odd, 'm').ok, true, JSON.stringify(odd));
    bs.writeState(odd, 'm', { job: { waits: 2 }, periods: [] });
    assert.deepEqual(bs.readState(odd, 'm').state.job, { waits: 2 }, JSON.stringify(odd));
  }
});

test('review 11: a failed write says why (code, cause) and is retry only for a passing reason', () => {
  const [org, member] = ids();
  bs.writeState(org, member, { job: { waits: 1 }, periods: [] });
  const before = fs.readFileSync(bs.fileFor(org, member), 'utf8');
  const realRename = fs.renameSync;
  try {
    for (const [code, retry] of [['EBUSY', true], ['ENOSPC', false], ['EROFS', false]]) {
      fs.renameSync = function () { const e = new Error('refused'); e.code = code; throw e; };
      let caught;
      try { bs.writeState(org, member, { job: { waits: 2 }, periods: [] }); } catch (err) { caught = err; }
      assert.ok(caught, code);
      assert.equal(caught.retry, retry, code); assert.equal(caught.code, code, code);
      assert.ok(caught.cause, `${code}: the underlying error is kept`);
      assert.match(caught.message, new RegExp(`\\(${code}\\)`));
    }
  } finally { fs.renameSync = realRename; }
  assert.equal(fs.readFileSync(bs.fileFor(org, member), 'utf8'), before, 'a refused write leaves the old file');
  bs.writeState(org, member, { job: { waits: 2 }, periods: [] });
  assert.deepEqual(bs.readState(org, member).state.job, { waits: 2 }, 'control: unstubbed it writes');
});

test('round 12: fileFor applies the same id check', () => {
  assert.throws(() => bs.fileFor(1, 'x'), /non-empty strings/);
  assert.throws(() => bs.fileFor('o\ud800', 'x'), /well-formed/);
});
