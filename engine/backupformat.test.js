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
// What anyone holding the member's public key can do: seal any content under any name, bypassing sealNamedChunk.
const forgeChunk = (pk, name, pt) => {
  const f = Buffer.alloc(Math.max(4096, bf.padme(4 + pt.length))); f.writeUInt32BE(pt.length, 0); pt.copy(f, 4);
  const { enc, ct } = require('./hpke').hpkeSeal(pk, Buffer.from('kosmos-backup v1 chunk'), Buffer.from(name), f);
  return Buffer.concat([Buffer.from('KBC1'), enc, ct]);
};
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
  assert.throws(() => bf.chunkBuffer(big, { min: 1, avg: 2 ** 30, max: 2 ** 31 }), /2\^28/, 'an average that would push the mask out of range');
  assert.throws(() => bf.chunkBuffer(big, { min: 1.5, avg: 2048, max: 8192 }), /integers/, 'non-integer sizes');
  // GOLDEN: format 1's boundaries, fixed forever. Changing the gear table, the masks or the hard/easy switch keeps
  // every property above green but silently ends dedup against every existing backup; this catches it.
  assert.deepEqual(c.map((x) => x.length), [286742, 1078049, 1781820, 1480926, 1131483, 441857, 90579], 'format-1 chunk boundaries moved: that needs a format bump');
});

test('#5535 padme matches an independent float reference at every power-of-two edge it can meet', () => {
  const ref = (L) => { const E = Math.floor(Math.log2(L)), S = Math.floor(Math.log2(E)) + 1, m = 2 ** (E - S); return Math.ceil(L / m) * m; };
  for (let k = 2; k <= 31; k++) for (const L of [2 ** k - 1, 2 ** k, 2 ** k + 1]) assert.equal(bf.padme(L), ref(L), `padme(${L})`);
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
  const pt = rand(5000, 'd');
  const { name, object: obj } = bf.sealNamedChunk(k.pk, nk, pt);
  assert.equal(name, bf.chunkName(nk, pt), 'sealNamedChunk derives the name from the content');
  assert.deepEqual(bf.openVerifiedChunk(k.sk, nk, name, obj), pt, 'round trip');
  const other = bf.chunkName(nk, Buffer.from('other'));
  assert.equal(bf.openVerifiedChunk(k.sk, nk, other, obj), null, 'a chunk stored under the wrong name does not open');
  assert.equal(bf.openVerifiedChunk(k.sk, crypto.randomBytes(32), name, obj), null, 'another period\'s naming key does not vouch for it');
  // A FORGED chunk: anyone with the public key can seal any content under a real name. The name check refuses it.
  const forged = forgeChunk(k.pk, name, Buffer.from('evil'));
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name, forged), null, 'a forged chunk under a real name is refused');
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name.toUpperCase(), obj), null, 'a non-canonical (uppercase) name is refused');
  assert.equal(bf.openVerifiedChunk(k.sk, nk, name + 'zz', obj), null, 'a name with trailing junk is refused');
  // Two plaintexts of different exact sizes in one padme bucket seal to objects of the same size.
  const a = bf.sealNamedChunk(k.pk, nk, rand(5000, 'e')).object, b = bf.sealNamedChunk(k.pk, nk, rand(5100, 'f')).object;  // padme(5004) = padme(5104) = 5120
  assert.equal(a.length, b.length, 'neighbouring sizes share a bucket');
  assert.notEqual(bf.sealNamedChunk(k.pk, nk, rand(9000, 'g')).object.length, a.length, 'CONTROL: a much larger chunk is a larger object');
  const tiny = [1, 20, 300, 4000].map((n) => bf.sealNamedChunk(k.pk, nk, rand(n, 't' + n)).object.length);
  assert.equal(new Set(tiny).size, 1, `small chunks must all be one size (the 4 KiB floor), got ${tiny}`);
});

test('#5535 openVerifiedChunk returns null, never throws, on every wrong input (shared control: the real object opens)', () => {
  const k = hpkeKeyPair(), other = hpkeKeyPair(), nk = crypto.randomBytes(32);
  const pt = Buffer.from('agent file'); const { name, object: obj } = bf.sealNamedChunk(k.pk, nk, pt);
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
  for (const [what, m] of [['undefined', { size: undefined }], ['undefined inside an array', { a: [undefined] }], ['a Date', { at: new Date(0) }],
    ['a Map', { m: new Map() }], ['a function', { f() {} }], ['a bigint', { n: 10n }], ['-0', { z: -0 }], ['an unsafe integer', { n: 2 ** 60 }], ['NaN', { x: NaN }],
    ['a one-hole array', { a: [,] }], ['an array with an extra property', { a: Object.assign([1], { x: 2 }) }],
    ['a symbol key', { [Symbol('s')]: 1, ok: 1 }], ['a hidden property', Object.defineProperty({ ok: 1 }, 'h', { value: 1, enumerable: false })],
    ['a top-level null', null], ['a top-level array', [1, 2]]]) {
    assert.throws(() => bf.sealManifest(k.pk, dev.privateKey, ctx, m), /manifest/, what);
  }
  const obj = bf.sealManifest(k.pk, dev.privateKey, ctx, { ok: [1, 'two', { three: true }], n: null });
  assert.deepEqual(bf.openManifest(k.sk, dev.publicKey, ctx, obj), { n: null, ok: [1, 'two', { three: true }] }, 'CONTROL: a plain manifest round-trips');
  assert.equal(bf.verifyManifestSignature(dev.publicKey, { org: 'o' }, obj), false, 'a context missing fields verifies nothing');
  for (const [kind, opts] of [['ec', { namedCurve: 'P-256' }], ['ed448', {}], ['rsa', { modulusLength: 2048 }]]) {
    const kp = crypto.generateKeyPairSync(kind, opts);
    assert.throws(() => bf.sealManifest(k.pk, kp.privateKey, ctx, { ok: 1 }), /Ed25519/, `a ${kind} device key would seal an unverifiable manifest`);
    assert.equal(bf.verifyManifestSignature(kp.publicKey, ctx, obj), false, `a ${kind} public key verifies nothing`);
  }
  assert.equal(bf.verifyManifestSignature(dev.privateKey, ctx, obj), false, 'a PRIVATE key passed as devicePub is refused');
  assert.throws(() => bf.sealManifest(k.pk, dev.privateKey, { ...ctx, org: '\ud800' }, { ok: 1 }), /letters, digits/, 'a lone surrogate id is refused');
  assert.throws(() => bf.sealManifest(k.pk, dev.privateKey, { ...ctx, org: 'a b' }, { ok: 1 }), /letters, digits/, 'a space in an id is refused');
  assert.ok(bf.sealManifest(k.pk, dev.privateKey, { ...ctx, period: '2026-W41', snapshot: 's.1:a_b' }, { ok: 1 }), 'CONTROL: ordinary ids seal');
  assert.deepEqual(bf.openManifest(k.sk, dev.publicKey, ctx, bf.sealManifest(k.pk, dev.privateKey, ctx, Object.create(null))), {}, 'CONTROL: a null-prototype empty object seals and opens');
});

test('#5535 manifests are padded: very different file counts in one bucket seal to one size', () => {
  const k = hpkeKeyPair(), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  const m = (n) => ({ files: Array.from({ length: n }, (_, i) => ({ path: 'a/' + i, size: i })) });
  assert.equal(bf.sealManifest(k.pk, dev.privateKey, ctx, m(1)).length, bf.sealManifest(k.pk, dev.privateKey, ctx, m(40)).length, 'small manifests all sit at the 4 KiB floor');
});

test('#5535 openManifest: a validly signed manifest whose content is not a plain object, or whose bytes are malformed, opens to null', () => {
  const { hpkeSeal } = require('./hpke');
  const k = hpkeKeyPair(), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  const ctxBytes = Buffer.from('kosmos-backup v1 manifest\n' + ['org', 'member', 'epoch', 'period', 'snapshot'].map((f) => `${f}=${ctx[f]}`).join('\n'));
  // Built by hand, as a compromised-but-enrolled signer could: a correct signature over arbitrary content.
  const craft = (json) => {
    const f = Buffer.alloc(4096); f.writeUInt32BE(Buffer.byteLength(json), 0); f.write(json, 4);
    const { enc, ct } = hpkeSeal(k.pk, Buffer.from('kosmos-backup v1 manifest'), ctxBytes, f);
    const sealed = Buffer.concat([Buffer.from('KBM1'), enc, ct]);
    const sig = crypto.sign(null, Buffer.concat([Buffer.from('kosmos-backup v1 manifest-signature\0'), crypto.createHash('sha256').update(sealed).digest(), ctxBytes]), dev.privateKey);
    return Buffer.concat([Buffer.from('KBM1'), sig, enc, ct]);
  };
  assert.deepEqual(bf.openManifest(k.sk, dev.publicKey, ctx, craft('{"ok":1}')), { ok: 1 }, 'CONTROL: the hand-built object opens, so the builder is right');
  for (const json of ['null', '[1]', '5', '"s"']) assert.equal(bf.openManifest(k.sk, dev.publicKey, ctx, craft(json)), null, `content ${json}`);
  const good = craft('{"ok":1}');
  const flipMagic = Buffer.from(good); flipMagic[0] ^= 1;
  assert.equal(bf.openManifest(k.sk, dev.publicKey, ctx, flipMagic), null, 'wrong magic');
  assert.equal(bf.openManifest(k.sk, dev.publicKey, ctx, good.subarray(0, 50)), null, 'truncated');
  assert.equal(bf.openManifest(k.sk, dev.publicKey, ctx, 'not a buffer'), null, 'not a Buffer');
});

test('#5535 the naming key must be exactly 32 bytes (a short or empty key would let anyone forge valid names)', () => {
  const k = hpkeKeyPair(), nk = crypto.randomBytes(32), pt = Buffer.from('agent file');
  const { name, object } = bf.sealNamedChunk(k.pk, nk, pt);
  assert.deepEqual(bf.openVerifiedChunk(k.sk, nk, name, object), pt, 'CONTROL: a 32-byte key seals and opens');
  for (const [what, bad] of [['empty', Buffer.alloc(0)], ['16 bytes', crypto.randomBytes(16)], ['33 bytes', crypto.randomBytes(33)], ['a 32-character string', 'x'.repeat(32)]]) {
    assert.throws(() => bf.sealNamedChunk(k.pk, bad, pt), /32 bytes/, `seal with a ${what} naming key`);
    assert.equal(bf.openVerifiedChunk(k.sk, bad, name, object), null, `open with a ${what} naming key`);
  }
  // The attack the check stops: with an EMPTY key anyone can compute the name, so a forged chunk would verify.
  const emptyName = crypto.createHmac('sha256', Buffer.alloc(0)).update(Buffer.from('evil')).digest('hex');
  assert.equal(bf.openVerifiedChunk(k.sk, Buffer.alloc(0), emptyName, forgeChunk(k.pk, emptyName, Buffer.from('evil'))), null, 'a forgery under an empty-key name is refused');
});

test('#5535 the streaming chunker cuts exactly where chunkBuffer does, whatever the piece sizes (golden vector too)', () => {
  const lens = (cs) => cs.map((c) => c.length);
  const stream = (buf, opts, pieceOf) => {
    const ch = bf.createChunker(opts); const out = [];
    for (let i = 0; i < buf.length;) { const n = pieceOf(i); out.push(...ch.push(buf.subarray(i, i + n))); i += n; }
    return [...out, ...ch.finish()];
  };
  const big = rand(3 * 1024 * 1024 + 777, 's');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (const [what, pieceOf] of [['1 byte at a time over the first 20k, then large', (i) => (i < 20000 ? 1 : 65536)], ['random sizes', () => 1 + (rnd() % 50000)], ['one piece', () => big.length]]) {
    const s1 = stream(big, SMALL, pieceOf);
    assert.deepEqual(lens(s1), lens(bf.chunkBuffer(big, SMALL)), `${what}: same boundaries`);
    assert.ok(Buffer.concat(s1).equals(big), `${what}: reassembles`);
  }
  const golden = rand(6 * 1024 * 1024, 'c');
  assert.deepEqual(lens(stream(golden, bf.CDC, () => 1 << 20)), [286742, 1078049, 1781820, 1480926, 1131483, 441857, 90579], 'format-1 golden vector, streamed');
  const ch = bf.createChunker(SMALL); ch.finish();
  assert.throws(() => ch.push(Buffer.from('x')), /after finish/);
  assert.throws(() => ch.finish(), /finish twice/, 'a second finish would return the tail again (duplicated data)');
  assert.throws(() => bf.createChunker({ min: 0, avg: 1024, max: 4096 }), /chunk sizes/, 'createChunker validates its sizes');
  assert.throws(() => bf.createChunker({ min: 5, avg: 3, max: 9 }), /chunk sizes/);
  assert.throws(() => bf.createChunker(SMALL).push('not a buffer'), /Buffer/);
  assert.deepEqual(bf.createChunker(SMALL).finish(), [], 'an empty stream gives no chunks');
});

test('#5535 streaming: forced cuts at max on low-entropy input, a tail under min, and pieces the caller reuses', () => {
  const lens = (cs) => cs.map((c) => c.length);
  const stream = (buf, pieceOf) => {
    const ch = bf.createChunker(SMALL); const out = [];
    for (let i = 0; i < buf.length;) { const n = pieceOf(i); out.push(...ch.push(buf.subarray(i, i + n))); i += n; }
    return [...out, ...ch.finish()];
  };
  const zeros = Buffer.alloc(5 * SMALL.max + 100);   // no cut point anywhere: every chunk is forced at max, a 100-byte tail
  const whole = bf.chunkBuffer(zeros, SMALL);
  assert.ok(whole.slice(0, -1).every((c) => c.length === SMALL.max) && whole[whole.length - 1].length === 100, 'PRECONDITION: forced cuts and a tail under min');
  for (const [what, pieceOf] of [['one piece', () => zeros.length], ['pieces crossing several max windows', () => 3 * SMALL.max + 7], ['small pieces', () => 1000]]) {
    const st = stream(zeros, pieceOf);
    assert.deepEqual(lens(st), lens(whole), `${what}: same forced boundaries and tail`);
    assert.ok(st.every((c) => c.length <= SMALL.max), `${what}: no chunk over max`);
  }
  // A walker reuses its read buffer: chunks already returned, and the tail still held, must not change with it.
  const data = rand(3 * SMALL.max, 'r');
  const reused = Buffer.from(data.subarray(0, 2 * SMALL.max));
  const ch = bf.createChunker(SMALL);
  const out = [...ch.push(reused)];
  reused.fill(0x55);
  out.push(...ch.push(Buffer.from(data.subarray(2 * SMALL.max))), ...ch.finish());
  assert.ok(Buffer.concat(out).equals(data), 'overwriting a pushed piece does not change the output');
  // The same while the piece is still only HELD (smaller than max, not yet joined), as a 64 KiB read would be.
  const small = Buffer.from(data.subarray(0, 1000));
  const ch2 = bf.createChunker(SMALL);
  const out2 = [...ch2.push(small)];
  small.fill(0x55);
  out2.push(...ch2.push(Buffer.from(data.subarray(1000))), ...ch2.finish());
  assert.ok(Buffer.concat(out2).equals(data), 'overwriting a held (not yet joined) piece does not change the output');
});
