/**
 * kosmos#5536 (E0.7) slice 1: engine/restorerun.js restores ONE snapshot through the real parts. The snapshot is a real
 * one (engine/backupsnapshot.js takeSnapshot into a store that keeps every object), the device-key history is really
 * signed by a test escrowd key (engine/devkeyhist.js), and the member key reaches the destination as a real wrap.
 * Only the store and the clock are fakes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hpkeKeyPair } = require('./hpke');
const { wrapMemberKey, namingKeyId } = require('./backupkeys');
const devkeyhist = require('./devkeyhist');
const snap = require('./backupsnapshot');
const rr = require('./restorerun');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const PERIOD = '2026-W41';
const LOCK = Date.parse('2026-11-11T00:15:00Z');
const SNAP_ID = '20261008T115500Z-0a1b2c3d';   // newSnapshotId's shape: taken five minutes before the grant
const GRANTED = Math.floor(NOW / 1000);
const escrow = crypto.generateKeyPairSync('ed25519');
devkeyhist.setVerifyingKeyForTests(escrow.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));

const rawPub = (k) => k.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

/* A signed history: entries as devkeyhist reads them, signed by the test escrowd key at issuedAt. */
function history(org, member, entries, issuedAt) {
  const msg = devkeyhist.encodeHead(org, member, entries, issuedAt);
  return { org, member, entries, issuedAt, signature: crypto.sign(null, msg, escrow.privateKey).toString('base64url') };
}

/* One real snapshot of a small work Kosmos, kept in memory: the manifest record the coordinator would answer, and a
   fetchObject over every stored object (chunks and the manifest). */
async function oneSnapshot() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'krestore-')));
  const root = path.join(base, 'kosmos');
  fs.mkdirSync(path.join(root, 'agents', 'a'), { recursive: true });
  const files = {
    'agents/a/notes.md': Buffer.from('plain notes\n'),
    'agents/a/memory.md': Buffer.from(Array.from({ length: 20000 }, (_, i) => `line ${i} of a memory file\n`).join('')),
    'readme.txt': Buffer.from('hello'),
  };
  for (const [rel, b] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), b);
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o1', member: 'm1', epoch: '1', period: PERIOD, snapshot: SNAP_ID };
  const objects = new Map();
  let n = 0, manifestKey = null;
  const deps = {
    now: () => NOW,
    uploadChunks: async (d, batch) => {
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) { const k = `o1/m1/1/${PERIOD}/c${++n}`; objects.set(k, Buffer.from(object)); keys.set(name, k); lockedUntil.set(name, LOCK); }
      return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
    },
    uploadManifest: async (d, bytes) => { manifestKey = `o1/m1/1/${PERIOD}/m1`; objects.set(manifestKey, Buffer.from(bytes)); return { ok: true, key: manifestKey, lockedUntilMs: LOCK }; },
  };
  const r = await snap.takeSnapshot({ root, memberPk: member.pk, namingKey: nk, namingKeyId: namingKeyId(nk), deviceKey: dev.privateKey, ctx }, deps);
  assert.equal(r.ok, true, r.because);
  const record = { key: manifestKey, period: PERIOD, snapshot: SNAP_ID, sha256: crypto.createHash('sha256').update(objects.get(manifestKey)).digest('hex'), granted_at: GRANTED };
  return { base, files, member, dev, objects, record, fetchObject: async (k) => objects.get(k) || null };
}

function memorySink() {
  const committed = new Map();
  return { committed, begin(p) { const parts = []; return { write(b) { parts.push(Buffer.from(b)); }, commit() { committed.set(p, Buffer.concat(parts)); }, abort() {} }; } };
}

const enrolled = (dev, at = GRANTED - 86400) => [{ kind: 'enrol', key: rawPub(dev.publicKey), at, backfill: false }];

test('#5536: a snapshot is restored byte for byte through the release, the signed device-key history and the recorded manifest', async () => {
  const s = await oneSnapshot();
  try {
    // The release: the member key wrapped to THIS computer's destination key, opened only with it.
    const dest = rr.newDestination();
    assert.match(dest.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(dest.fingerprint, crypto.createHash('sha256').update(dest.publicKey).digest('hex'), 'the fingerprint restorerequest.js names');
    const wrap = wrapMemberKey(s.member.sk, dest.publicKey, { org: 'o1', member: 'm1', epoch: '1' });
    const memberSk = dest.open(wrap, { org: 'o1', member: 'm1', epoch: '1' }, s.member.pk);
    assert.ok(memberSk && Buffer.from(memberSk).equals(Buffer.from(s.member.sk)), 'the destination opens the release');
    assert.equal(rr.newDestination().open(wrap, { org: 'o1', member: 'm1', epoch: '1' }, s.member.pk), null, 'another destination cannot');
    const sink = memorySink();
    const r = await rr.runRestore({ org: 'o1', member: 'm1', epoch: 1, manifest: s.record, memberSk, history: history('o1', 'm1', enrolled(s.dev), GRANTED + 60),
      now: GRANTED + 120, fetchObject: s.fetchObject, sink, maxTotalBytes: 2 ** 30 });
    assert.equal(r.ok, true, r.because);
    assert.equal(r.deviceKey, rawPub(s.dev.publicKey));
    assert.equal(r.takenAt, Math.floor(Date.parse('2026-10-08T11:55:00Z') / 1000));
    for (const [p, b] of Object.entries(s.files)) assert.ok(sink.committed.get(p) && sink.committed.get(p).equals(b), p);
    assert.equal(r.result.failed.length, 0);
    dest.forget();
    assert.equal(dest.open(wrap, { org: 'o1', member: 'm1', epoch: '1' }, s.member.pk), null, 'forgotten: nothing opens');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536: the device key is the one valid when Kosmos+ RECORDED the grant, never one picked by the snapshot\'s own time', async () => {
  const s = await oneSnapshot();
  try {
    const run = (h, extra = {}) => rr.runRestore(Object.assign({ org: 'o1', member: 'm1', epoch: '1', manifest: s.record, memberSk: s.member.sk,
      history: h, now: GRANTED + 120, fetchObject: s.fetchObject, sink: memorySink(), maxTotalBytes: 2 ** 30 }, extra));
    // The signing key was revoked BEFORE the grant (it was valid at the id's claimed time only): refused, by the grant time.
    const k = rawPub(s.dev.publicKey);
    let r = await run(history('o1', 'm1', [{ kind: 'enrol', key: k, at: GRANTED - 86400, backfill: false }, { kind: 'revoke', key: k, at: GRANTED - 60 }], GRANTED + 60));
    assert.equal(r.ok, false); assert.match(r.because, /no device key of this member was valid when this backup was recorded/);
    // Another key valid at the grant, not the one that signed: the manifest does not open.
    const other = crypto.generateKeyPairSync('ed25519');
    r = await run(history('o1', 'm1', enrolled(other), GRANTED + 60));
    assert.equal(r.ok, false); assert.match(r.because, /does not open under this member's device key/);
    // A history for another member, or one escrowd did not sign: refused before anything is fetched.
    let fetched = 0;
    r = await run(history('o1', 'm2', enrolled(s.dev), GRANTED + 60), { fetchObject: async (key) => { fetched++; return s.objects.get(key); } });
    assert.equal(r.ok, false); assert.match(r.because, /different member/); assert.equal(fetched, 0);
    const forged = history('o1', 'm1', enrolled(s.dev), GRANTED + 60); forged.signature = crypto.sign(null, Buffer.from('x'), crypto.generateKeyPairSync('ed25519').privateKey).toString('base64url');
    r = await run(forged);
    assert.equal(r.ok, false); assert.match(r.because, /signature/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536: the snapshot\'s own time must agree with the recorded grant, inside the manifest\'s week; each refusal names why', async () => {
  const s = await oneSnapshot();
  try {
    const h = history('o1', 'm1', enrolled(s.dev), GRANTED + 60);
    const run = (manifest) => rr.runRestore({ org: 'o1', member: 'm1', epoch: '1', manifest, memberSk: s.member.sk, history: h, now: GRANTED + 120,
      fetchObject: s.fetchObject, sink: memorySink(), maxTotalBytes: 2 ** 30 });
    const cases = [
      [{ snapshot: undefined }, /no snapshot id/],
      [{ snapshot: 's-0a1b2c3d' }, /no readable time/],
      [{ snapshot: '20261340T115500Z-0a1b2c3d' }, /no readable time/],
      [{ granted_at: GRANTED - 600 }, /taken after Kosmos\+ recorded it/],
      [{ granted_at: GRANTED + rr.SNAPSHOT_TO_GRANT_SECS + 600 }, /long before/],
      [{ period: '2026-W40' }, /not in the week/],
      [{ sha256: 'ab'.repeat(32) }, /not the one Kosmos\+ recorded/],
    ];
    for (const [change, why] of cases) {
      const r = await run(Object.assign({}, s.record, change));
      assert.equal(r.ok, false, JSON.stringify(change)); assert.match(r.because, why, JSON.stringify(change));
    }
    // CONTROL: the unchanged record restores, so each refusal above was its own.
    assert.equal((await run(s.record)).ok, true);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536: snapshots are listed oldest first by the time inside their id, never by the coordinator\'s grant time, with problems shown', () => {
  const rows = rr.listSnapshots([
    { key: 'b', snapshot: '20261008T100000Z-00000002', granted_at: Math.floor(Date.parse('2026-10-08T10:05:00Z') / 1000), period: PERIOD },
    { key: 'a', snapshot: '20261007T090000Z-00000001', granted_at: Math.floor(Date.parse('2026-10-08T23:00:00Z') / 1000), period: PERIOD },
    { key: 'c', snapshot: null, granted_at: GRANTED, period: PERIOD },
    { key: 'd', snapshot: '20261008T110000Z-00000004', granted_at: GRANTED, period: PERIOD, readable: false },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['a', 'b', 'd', 'c'], 'ordered by the id\'s own time; one with no time last');
  assert.match(rows[0].problem, /long before/, 'a granted_at far from its own time is shown with why');
  assert.equal(rows[1].problem, null);
  assert.match(rows[2].problem, /own bucket/);
  assert.match(rows[3].problem, /no snapshot id/);
});

test('#5536: snapshotTimeOf reads only newSnapshotId\'s shape', () => {
  assert.equal(rr.snapshotTimeOf('20261008T115500Z-0a1b2c3d'), Date.parse('2026-10-08T11:55:00Z') / 1000);
  for (const bad of ['s-0a1b2c3d', '20261008T115500Z', '20261008T115500Z-0A1B2C3D', '20261008T256000Z-0a1b2c3d', '20260230T000000Z-0a1b2c3d', 7, null]) {
    assert.equal(rr.snapshotTimeOf(bad), null, String(bad));
  }
});
