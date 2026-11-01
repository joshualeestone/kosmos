'use strict';
/**
 * kosmos#7404 slice D: a personal manifest proves itself to the member key. The snapshot is a real one
 * (engine/backupsnapshot.js into a store that keeps every object) and the restore is the real engine/restorerun.js;
 * only the store and the clock are fakes. The attacker here is a coordinator: it has the member PUBLIC key, a device
 * key of its own, and can answer any record it likes.
 *
 *   node --test engine/memberproof-7404.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hpkeKeyPair } = require('./hpke');
const { namingKeyId } = require('./backupkeys');
const fmt = require('./backupformat');
const snap = require('./backupsnapshot');
const job = require('./backupjob');
const rr = require('./restorerun');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const PERIOD = '2026-W41';
const LOCK = Date.parse('2026-11-11T00:15:00Z');
const SNAP_ID = '20261008T115500Z-0a1b2c3d';
const CTX = { org: 'o1', member: 'm1', epoch: '1', period: PERIOD, snapshot: SNAP_ID };
const GRANTED = Math.floor(NOW / 1000);
const KEY = `o1/m1/1/${PERIOD}/${'a'.repeat(64)}`;

async function oneSnapshot(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kmemberproof-'));
  fs.writeFileSync(path.join(root, 'notes.md'), 'plain notes\n');
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const objects = new Map();
  let n = 0;
  const deps = {
    now: () => NOW,
    uploadChunks: async (d, batch) => {
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) { const k = `o1/m1/1/${PERIOD}/c${++n}`; objects.set(k, Buffer.from(object)); keys.set(name, k); lockedUntil.set(name, LOCK); }
      return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
    },
    uploadManifest: async (d, bytes) => { objects.set(KEY, Buffer.from(bytes)); return { ok: true, key: KEY, lockedUntilMs: LOCK }; },
  };
  const proofKey = extra.noProof ? {} : { proofKey: fmt.memberProofKey(member.sk) };
  const r = await snap.takeSnapshot(Object.assign({ root, memberPk: member.pk, namingKey: nk, namingKeyId: namingKeyId(nk), deviceKey: dev.privateKey, ctx: CTX }, proofKey), deps);
  assert.equal(r.ok, true, r.because);
  return { member, dev, objects, record: recordOf(objects.get(KEY)), fetchObject: async (k) => objects.get(k) || null };
}
const recordOf = (bytes) => ({ key: KEY, period: PERIOD, snapshot: SNAP_ID, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), granted_at: GRANTED });
function memorySink() {
  const committed = new Map();
  return { committed, begin(p) { const parts = []; return { write(b) { parts.push(Buffer.from(b)); }, commit() { committed.set(p, Buffer.concat(parts)); }, abort() {} }; } };
}
const restore = (s, over = {}) => rr.runRestore(Object.assign({ org: 'o1', member: 'm1', epoch: 1, manifest: s.record, memberSk: s.member.sk, trust: 'member-proof',
  fetchObject: s.fetchObject, sink: memorySink(), maxTotalBytes: 2 ** 30 }, over));

test('a personal snapshot restores byte for byte with no device-key history, and its signer is the key that signed', async () => {
  const s = await oneSnapshot();
  const sink = memorySink();
  const r = await restore(s, { sink });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sink.committed.get('notes.md').toString(), 'plain notes\n');
  assert.equal(r.deviceKey, s.dev.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'));
});

test('a coordinator that seals to the public key and signs with its own key is refused, however it dresses the proof', async () => {
  const s = await oneSnapshot();
  const evil = crypto.generateKeyPairSync('ed25519');
  const device = evil.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const forge = (body) => {
    const object = fmt.sealManifest(s.member.pk, evil.privateKey, CTX, Object.assign({ format: 1, takenAt: 'x', namingKeyId: 'x', namingKey: 'eA==', files: [], objects: {}, redacted: [], skipped: [], skippedNotListed: 0 }, body));
    s.objects.set(KEY, object);
    return restore(Object.assign({}, s, { record: recordOf(object) }));
  };
  const publicKeyAsProofKey = crypto.createHash('sha256').update(s.member.pk).digest();
  for (const [what, body] of [
    ['no proof', {}],
    ['a random proof', { memberProof: { device, proof: crypto.randomBytes(32).toString('hex') } }],
    ['a proof keyed on the public key', { memberProof: fmt.memberProof(publicKeyAsProofKey, CTX, evil.publicKey) }],
    ['a proof of the wrong shape', { memberProof: { device: 'zz', proof: 1 } }],
  ]) {
    const r = await forge(body);
    assert.equal(r.ok, false, what);
    assert.match(r.because, /proof only your own key can make/, what);
  }
});

test('a real proof does not move: not to another signer, and not to another snapshot of the same member', async () => {
  const s = await oneSnapshot();
  const opened = fmt.openManifestByProof(s.member.sk, CTX, s.objects.get(KEY));
  assert.ok(opened, 'control: the genuine manifest opens');
  const evil = crypto.generateKeyPairSync('ed25519');
  const reused = fmt.sealManifest(s.member.pk, evil.privateKey, CTX, opened.manifest);
  assert.equal(fmt.openManifestByProof(s.member.sk, CTX, reused), null, 'the proof names the real device, whose signature this object lacks');
  const reusedDevice = fmt.sealManifest(s.member.pk, evil.privateKey, CTX, Object.assign({}, opened.manifest, { memberProof: { device: evil.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), proof: opened.manifest.memberProof.proof } }));
  assert.equal(fmt.openManifestByProof(s.member.sk, CTX, reusedDevice), null, 'the proof covers the device key');
  const other = Object.assign({}, CTX, { snapshot: '20261008T115600Z-0a1b2c3e' });
  const replayed = fmt.sealManifest(s.member.pk, s.dev.privateKey, other, opened.manifest);
  assert.equal(fmt.openManifestByProof(s.member.sk, other, replayed), null, 'the proof covers the context');
  const pk = fmt.memberProofKey(s.member.sk);
  const genuine = fmt.sealManifest(s.member.pk, s.dev.privateKey, other, Object.assign({}, opened.manifest, { memberProof: fmt.memberProof(pk, other, s.dev.publicKey) }));
  assert.ok(fmt.openManifestByProof(s.member.sk, other, genuine), 'control: the same body with a proof for that context opens');
});

test('a proofless personal snapshot is refused; a company restore still needs its history and is not offered the proof path', async () => {
  const s = await oneSnapshot({ noProof: true });
  const r = await restore(s);
  assert.equal(r.ok, false);
  assert.match(r.because, /proof only your own key can make/);
  const withProof = await oneSnapshot();
  for (const trust of [undefined, 'Member-Proof', true, 'history']) {
    const c = await restore(withProof, { trust });
    assert.equal(c.ok, false, String(trust));
    assert.doesNotMatch(c.because, /proof only/, 'anything but the exact word stays on the history path');
  }
});

test('two spellings of one X25519 secret make one proof key, and another secret another', () => {
  const { sk } = hpkeKeyPair();
  const low = Buffer.from(sk); low[0] &= 248; low[31] &= 127; low[31] |= 64;
  const high = Buffer.from(low); high[0] |= 7; high[31] |= 128;
  assert.notDeepEqual(low, high, 'control: the spellings differ');
  const pub = (raw) => crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).toString('hex');
  assert.equal(pub(low), pub(high), 'control: X25519 reads them as one key');
  assert.ok(fmt.memberProofKey(low).equals(fmt.memberProofKey(high)));
  assert.ok(!fmt.memberProofKey(low).equals(fmt.memberProofKey(hpkeKeyPair().sk)));
  assert.throws(() => fmt.memberProofKey(Buffer.alloc(31)), /32 bytes/);
});

test('the proof key reaches the snapshot and never the run\'s own answer', async () => {
  const proofKey = crypto.randomBytes(32), publicKey = crypto.randomBytes(32);
  const seen = [];
  const ensureMemberKey = async () => ({ ok: true, epoch: 1, publicKey, proofKey, org: 'o', member: 'm' });
  const r = await job.runOnce({}, { ensureMemberKey, pair: { org: 'o', member: 'm' }, snapshot: async (k) => { seen.push(k); return { ok: true }; } });
  assert.ok(seen[0].proofKey.equals(proofKey));
  assert.equal(r.key.epoch, 1, 'control: the key is answered');
  assert.equal(r.key.proofKey, undefined);
  assert.ok(!Object.values(r.state).some((v) => Buffer.isBuffer(v)));
  const company = [];
  await job.runOnce({}, { ensureMemberKey: async () => ({ ok: true, epoch: 1, publicKey }), snapshot: async (k) => { company.push(k); return { ok: true }; } });
  assert.equal('proofKey' in company[0], false, 'a company run has none');
});
