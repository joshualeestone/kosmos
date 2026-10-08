/**
 * kosmos#5535 (E0.6) slice 2: engine/backupformat.js, the bytes a backup is made of.
 * Each property the design (#5535 v2 / v2.1) relies on has a test that can fail, with a control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');

const SMALL = { min: 512, avg: 2048, max: 8192 };
const rand = (n, seed) => {  // deterministic bytes, so a failure reproduces
  const out = Buffer.alloc(n); let off = 0, ctr = 0;
  while (off < n) { const b = crypto.createHash('sha256').update(seed + ':' + ctr++).digest(); off += b.copy(out, off); }
  return out;
};

test('#5535 chunking: chunks reassemble to the input, respect min and max, and are deterministic', () => {
  const buf = rand(200000, 'a');
  const c = bf.chunkBuffer(buf, SMALL);
  assert.deepEqual(Buffer.concat(c), buf, 'reassembly');
  c.slice(0, -1).forEach((x, i) => assert.ok(x.length >= SMALL.min && x.length <= SMALL.max, `chunk ${i} size ${x.length}`));
  assert.ok(c[c.length - 1].length <= SMALL.max);
  assert.ok(c.length > 10, 'CONTROL: this input splits into many chunks');
  assert.deepEqual(bf.chunkBuffer(buf, SMALL).map((x) => x.length), c.map((x) => x.length), 'same input, same cuts');
});

test('#5535 chunking is content-defined: a byte inserted near the start leaves most later chunks identical', () => {
  const buf = rand(400000, 'b');
  const ins = Buffer.concat([buf.subarray(0, 1000), Buffer.from([0x42]), buf.subarray(1000)]);
  const name = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const a = new Set(bf.chunkBuffer(buf, SMALL).map(name));
  const b = bf.chunkBuffer(ins, SMALL).map(name);
  const shared = b.filter((h) => a.has(h)).length;
  assert.ok(shared >= b.length - 3, `only ${shared} of ${b.length} chunks survived a 1-byte insert`);
  // CONTROL: fixed-size slicing (what content-defined chunking replaces) keeps almost nothing after the insert.
  const fixed = (x) => { const o = []; for (let i = 0; i < x.length; i += 2048) o.push(name(x.subarray(i, i + 2048))); return o; };
  const fa = new Set(fixed(buf));
  assert.ok(fixed(ins).filter((h) => fa.has(h)).length <= 1, 'CONTROL: fixed slicing should lose its chunks');
});

test('#5535 chunking: tiny and empty inputs, and the real format-1 sizes on a few MB', () => {
  assert.deepEqual(bf.chunkBuffer(Buffer.alloc(0), SMALL), []);
  assert.equal(bf.chunkBuffer(Buffer.from('hi'), SMALL).length, 1);
  const big = rand(6 * 1024 * 1024, 'c');
  const c = bf.chunkBuffer(big);
  assert.deepEqual(Buffer.concat(c), big);
  c.slice(0, -1).forEach((x) => assert.ok(x.length >= bf.CDC.min && x.length <= bf.CDC.max));
  assert.throws(() => bf.chunkBuffer(big, { min: 10, avg: 5, max: 20 }), /min < avg < max/);
});

test('#5535 padme: never smaller, overhead at most about 12%, and sizes collapse into buckets', () => {
  for (const L of [2, 3, 100, 1000, 4096, 4097, 65537, 1048576, 1048577, 4194304]) {
    const p = bf.padme(L);
    assert.ok(p >= L, `padme(${L}) = ${p}`);
    assert.ok((p - L) / L <= 0.125, `padme(${L}) overhead ${(p - L) / L}`);
  }
  const distinct = new Set(); for (let L = 1000000; L < 1001000; L++) distinct.add(bf.padme(L));
  assert.ok(distinct.size < 10, `1000 neighbouring sizes gave ${distinct.size} buckets`);
});

test('#5535 chunk objects: seal and open, the name binds, the size is bucketed', () => {
  const k = hpkeKeyPair(), nk = crypto.randomBytes(32);
  const pt = rand(5000, 'd'), name = bf.chunkName(nk, pt);
  const obj = bf.sealChunk(k.pk, name, pt);
  assert.deepEqual(bf.openVerifiedChunk(k.sk, nk, name, obj), pt, 'round trip');
  const other = bf.chunkName(nk, Buffer.from('other'));
  assert.equal(bf.openVerifiedChunk(k.sk, nk, other, obj), null, 'a chunk stored under the wrong name does not open');
  assert.equal(bf.openVerifiedChunk(k.sk, crypto.randomBytes(32), name, obj), null, 'another period\'s naming key does not vouch for it');
  // A FORGED chunk: anyone with the public key can seal any content under a real name. The name check refuses it.
  const forged = bf.sealChunk(k.pk, name, Buffer.from('evil'));
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name, forged), null, 'a forged chunk under a real name is refused');
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name.toUpperCase(), obj), null, 'a non-canonical (uppercase) name is refused');
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name + 'zz', obj), null, 'a name with trailing junk is refused');
  // Two plaintexts of different exact sizes in one padme bucket seal to objects of the same size.
  const a = bf.sealChunk(k.pk, name, rand(5000, 'e')), b = bf.sealChunk(k.pk, name, rand(5100, 'f'));  // padme(5004) = padme(5104) = 5120
  assert.equal(a.length, b.length, 'neighbouring sizes share a bucket');
  assert.notEqual(bf.sealChunk(k.pk, name, rand(9000, 'g')).length, a.length, 'CONTROL: a much larger chunk is a larger object');
  const tiny = [1, 20, 300, 4000].map((n) => bf.sealChunk(k.pk, name, rand(n, 't' + n)).length);
  assert.equal(new Set(tiny).size, 1, `small chunks must all be one size (the 4 KiB floor), got ${tiny}`);
});

test('#5535 openVerifiedChunk returns null, never throws, on every wrong input (shared control: the real object opens)', () => {
  const k = hpkeKeyPair(), other = hpkeKeyPair(), nk = crypto.randomBytes(32);
  const pt = Buffer.from('agent file'), name = bf.chunkName(nk, pt), obj = bf.sealChunk(k.pk, name, pt);
  assert.deepEqual(bf.openVerifiedChunk(k.sk, nk, name, obj), pt, 'CONTROL');
  const flip = (b, i) => { const c = Buffer.from(b); c[i] ^= 1; return c; };
  const cases = {
    'another member\'s key': () => bf.openVerifiedChunk(other.sk, nk, name, obj),
    'magic changed': () => bf.openVerifiedChunk(k.sk, nk, name, flip(obj, 0)),
    'enc bit flipped': () => bf.openVerifiedChunk(k.sk, nk, name, flip(obj, 10)),
    'ciphertext bit flipped': () => bf.openVerifiedChunk(k.sk, nk, name, flip(obj, 40)),
    'truncated': () => bf.openVerifiedChunk(k.sk, nk, name, obj.subarray(0, obj.length - 1)),
    'not a Buffer': () => bf.openVerifiedChunk(k.sk, nk, name, 'nope'),
    'name not a string': () => bf.openVerifiedChunk(k.sk, nk, 42, obj),
  };
  for (const [n, fn] of Object.entries(cases)) { let r; assert.doesNotThrow(() => { r = fn(); }, n); assert.equal(r, null, n); }
});

test('#5535 manifests: signed by the device, bound to the snapshot context, sealed to the member', () => {
  const k = hpkeKeyPair();
  const dev = crypto.generateKeyPairSync('ed25519'), dev2 = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o1', member: 'm1', epoch: 'e1', period: '2026-W41', snapshot: 's1' };
  const manifest = { files: [{ path: 'agents/a/notes.md', chunks: ['ab'.repeat(32)], size: 5 }], skipped: [{ path: '.env', why: 'credentials' }] };
  const obj = bf.sealManifest(k.pk, dev.privateKey, ctx, manifest);
  assert.ok(bf.verifyManifestSignature(dev.publicKey, ctx, obj), 'the coordinator can check it without the member key');
  assert.deepEqual(bf.openManifest(k.sk, dev.publicKey, ctx, obj), JSON.parse(bf.canonicalJson(manifest)));
  assert.equal(bf.verifyManifestSignature(dev2.publicKey, ctx, obj), false, 'another device did not sign it');
  assert.equal(bf.openManifest(k.sk, dev2.publicKey, ctx, obj), null, 'and it does not open under another device');
  for (const f of ['org', 'member', 'epoch', 'period', 'snapshot']) {
    const moved = { ...ctx, [f]: ctx[f] + 'x' };
    assert.equal(bf.verifyManifestSignature(dev.publicKey, moved, obj), false, `replayed into another ${f}`);
    assert.equal(bf.openManifest(k.sk, dev.publicKey, moved, obj), null, `opened in another ${f}`);
  }
  const t = Buffer.from(obj); t[t.length - 1] ^= 1;
  assert.equal(bf.verifyManifestSignature(dev.publicKey, ctx, t), false, 'a tampered byte breaks the signature');
  assert.equal(bf.openManifest(hpkeKeyPair().sk, dev.publicKey, ctx, obj), null, 'another member key cannot read it');
  assert.throws(() => bf.sealManifest(k.pk, dev.privateKey, { ...ctx, period: '' }, manifest), /non-empty period/);
  assert.throws(() => bf.sealManifest(k.pk, dev.privateKey, { ...ctx, member: 'a\nb' }, manifest), /non-empty member/, 'a newline cannot forge a field');
});

test('#5535 canonicalJson: key order never changes the bytes; arrays keep order; NaN refused', () => {
  assert.equal(bf.canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
  assert.equal(bf.canonicalJson({ a: { c: null, d: [3, 1] }, b: 1 }), bf.canonicalJson({ b: 1, a: { d: [3, 1], c: null } }));
  assert.notEqual(bf.canonicalJson([1, 2]), bf.canonicalJson([2, 1]), 'CONTROL: array order matters');
  assert.throws(() => bf.canonicalJson({ x: NaN }), /NaN/);
});

test('#5535 frames: crafted bad frames never open (non-zero padding, oversized length, wrong frame size)', () => {
  const { hpkeSeal } = require('./hpke');
  const k = hpkeKeyPair(), nk = crypto.randomBytes(32), pt = Buffer.from('real');
  const name = bf.chunkName(nk, pt);
  const raw = (f) => { const { enc, ct } = hpkeSeal(k.pk, Buffer.from('kosmos-backup v1 chunk'), Buffer.from(name), f); return Buffer.concat([Buffer.from('KBC1'), enc, ct]); };
  const good = Buffer.alloc(4096); good.writeUInt32BE(4, 0); pt.copy(good, 4);
  assert.deepEqual(bf.openVerifiedChunk(k.sk, nk, name, raw(good)), pt, 'CONTROL: a well-formed frame opens');
  const dirty = Buffer.from(good); dirty[100] = 1;
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name, raw(dirty)), null, 'non-zero padding');
  const big = Buffer.from(good); big.writeUInt32BE(5000, 0);
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name, raw(big)), null, 'a length past the frame');
  const odd = Buffer.alloc(4100); odd.writeUInt32BE(4, 0); pt.copy(odd, 4);
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name, raw(odd)), null, 'a frame not exactly its padded size');
});

test('#5535 chunking boundaries: exactly min, min + 1, and a tail shorter than max', () => {
  assert.equal(bf.chunkBuffer(rand(512, 'm'), SMALL).length, 1, 'exactly min is one chunk');
  const c = bf.chunkBuffer(rand(513, 'n'), SMALL);
  assert.deepEqual(Buffer.concat(c), rand(513, 'n'));
  const t = bf.chunkBuffer(rand(8192 + 700, 'o'), SMALL);
  assert.deepEqual(Buffer.concat(t), rand(8192 + 700, 'o'), 'a short tail reassembles');
});

test('#5535 manifests: anything that would not read back is refused before sealing (it would never restore)', () => {
  const k = hpkeKeyPair(), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  for (const [what, m] of [['undefined', { size: undefined }], ['an array hole', [undefined]], ['a Date', { at: new Date(0) }],
    ['a Map', { m: new Map() }], ['a function', { f() {} }], ['a bigint', { n: 10n }], ['-0', { z: -0 }], ['an unsafe integer', { n: 2 ** 60 }], ['NaN', { x: NaN }]]) {
    assert.throws(() => bf.sealManifest(k.pk, dev.privateKey, ctx, m), /manifest/, what);
  }
  const obj = bf.sealManifest(k.pk, dev.privateKey, ctx, { ok: [1, 'two', { three: true }], n: null });
  assert.deepEqual(bf.openManifest(k.sk, dev.publicKey, ctx, obj), { n: null, ok: [1, 'two', { three: true }] }, 'CONTROL: a plain manifest round-trips');
  assert.equal(bf.verifyManifestSignature(dev.publicKey, { org: 'o' }, obj), false, 'a context missing fields verifies nothing');
});

test('#5535 manifests are padded: very different file counts in one bucket seal to one size', () => {
  const k = hpkeKeyPair(), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  const m = (n) => ({ files: Array.from({ length: n }, (_, i) => ({ path: 'a/' + i, size: i })) });
  assert.equal(bf.sealManifest(k.pk, dev.privateKey, ctx, m(1)).length, bf.sealManifest(k.pk, dev.privateKey, ctx, m(40)).length, 'small manifests all sit at the 4 KiB floor');
});
