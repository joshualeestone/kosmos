/**
 * kosmos#5536 (E0.7) step 3, pure part: engine/backuprestore.js restores a snapshot byte for byte, and refuses
 * every way a restore could be fooled. Each refusal has a working control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');
const br = require('./backuprestore');

function backup(files) {
  const member = hpkeKeyPair(), other = hpkeKeyPair(), nk = crypto.randomBytes(32);
  const dev = crypto.generateKeyPairSync('ed25519'), dev2 = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e1', period: 'p1', snapshot: 's1' };
  const store = new Map();
  const entries = files.map(({ path, data }) => {
    const names = bf.chunkBuffer(data, { min: 512, avg: 2048, max: 8192 }).map((c) => { const { name, object } = bf.sealNamedChunk(member.pk, nk, c); store.set(name, object); return name; });
    return { path, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), chunks: names };
  });
  const manifestObject = bf.sealManifest(member.pk, dev.privateKey, ctx, { files: entries, skipped: [{ path: '.env', why: 'environment file' }] });
  return { member, other, nk, dev, dev2, ctx, store, entries, manifestObject };
}
const rand = (n) => crypto.randomBytes(n);

test('#5536 a snapshot restores byte for byte, with what the backup skipped reported', () => {
  const a = rand(30000), b = Buffer.from('notes\n');
  const k = backup([{ path: 'agents/a/memory.md', data: a }, { path: 'agents/a/notes.md', data: b }]);
  const r = br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: (n) => k.store.get(n) });
  assert.deepEqual(r.failed, []);
  assert.ok(r.files.find((f) => f.path === 'agents/a/memory.md').data.equals(a));
  assert.ok(r.files.find((f) => f.path === 'agents/a/notes.md').data.equals(b));
  assert.deepEqual(r.skippedAtBackup, [{ path: '.env', why: 'environment file' }]);
});

test('#5536 restore refuses: another device key, another context, another member key (control: the right ones open)', () => {
  const k = backup([{ path: 'a.md', data: rand(5000) }]);
  const go = (o) => br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: (n) => k.store.get(n), ...o });
  assert.ok(go({}), 'CONTROL');
  assert.equal(go({ devicePubAtSnapshot: k.dev2.publicKey }), null, 'a device key not enrolled at the snapshot time');
  assert.equal(go({ ctx: { ...k.ctx, member: 'someone-else' } }), null, 'replayed into another member');
  assert.equal(go({ memberSk: k.other.sk }), null, 'another member\'s key reads nothing');
});

test('#5536 per file, fail closed: a missing, forged or swapped chunk, or a hash mismatch, fails that file only', () => {
  const k = backup([{ path: 'good.md', data: rand(3000) }, { path: 'bad.md', data: rand(3000) }]);
  const badNames = k.entries.find((e) => e.path === 'bad.md').chunks;
  const run = (fetch) => br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: k.manifestObject, fetchChunk: fetch });
  const missing = run((n) => (badNames.includes(n) ? null : k.store.get(n)));
  assert.deepEqual(missing.failed, [{ path: 'bad.md', why: 'a chunk is missing' }]);
  assert.deepEqual(missing.files.map((f) => f.path), ['good.md'], 'the good file still restores');
  const forged = run((n) => (badNames.includes(n) ? bf.sealNamedChunk(k.member.pk, crypto.randomBytes(32), Buffer.from('evil')).object : k.store.get(n)));
  assert.equal(forged.failed[0].why, 'a chunk did not verify (forged, swapped or damaged)');
  const goodName = k.entries.find((e) => e.path === 'good.md').chunks[0];
  const swapped = run((n) => (badNames.includes(n) ? k.store.get(goodName) : k.store.get(n)));
  assert.equal(swapped.failed[0].why, 'a chunk did not verify (forged, swapped or damaged)', 'a real chunk stored under another name');
  const throws = run((n) => { if (badNames.includes(n)) throw new Error('network'); return k.store.get(n); });
  assert.equal(throws.failed[0].why, 'a chunk is missing', 'a fetch that throws counts as missing');
});

test('#5536 a manifest entry with an unsafe path, or a recorded hash that does not match, is refused', () => {
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  const data = Buffer.from('x'.repeat(100));
  const { name, object } = bf.sealNamedChunk(member.pk, nk, data);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const entries = [{ path: '../escape.md', chunks: [name], sha256: sha }, { path: '/etc/x', chunks: [name], sha256: sha }, { path: 'C:/x', chunks: [name], sha256: sha },
    { path: 'a//b', chunks: [name], sha256: sha }, { path: 'wrong-hash.md', chunks: [name], sha256: '0'.repeat(64) }, { path: 'ok.md', chunks: [name], sha256: sha }];
  const m = bf.sealManifest(member.pk, dev.privateKey, ctx, { files: entries });
  const r = br.restoreSnapshot({ memberSk: member.sk, namingKey: nk, devicePubAtSnapshot: dev.publicKey, ctx, manifestObject: m, fetchChunk: () => object });
  assert.deepEqual(r.files.map((f) => f.path), ['ok.md'], 'CONTROL: only the safe, matching entry restores');
  assert.equal(r.failed.length, 5);
  assert.equal(r.failed.find((f) => f.path === 'wrong-hash.md').why, 'the file does not match the hash recorded at upload');
});

test('#5536 shrinkWarning flags a sudden shrink and stays quiet otherwise', () => {
  const m = (n, size) => ({ files: Array.from({ length: n }, () => ({ size })) });
  assert.match(br.shrinkWarning(m(100, 10), m(10, 10)), /files fell from 100 to 10/);
  assert.match(br.shrinkWarning(m(10, 1000), m(10, 10)), /size fell/);
  assert.equal(br.shrinkWarning(m(100, 10), m(95, 10)), null, 'CONTROL: a small change is not a warning');
  assert.equal(br.shrinkWarning(m(0, 0), m(5, 5)), null, 'growth from nothing is not a warning');
});
