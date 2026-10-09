/**
 * kosmos#5535 (E0.6) step 3: engine/backupsnapshot.js takes one snapshot of a work Kosmos. The round trip goes through
 * the real format, scanner and restore (engine/backuprestore.js); only the two uploaders are stubbed, as a store that
 * keeps every object it is handed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');
const br = require('./backuprestore');
const snap = require('./backupsnapshot');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const PERIOD = '2026-W41';
const TOKEN = 'ghp_' + 'Zq8vT2mLp4Rx9Kc1Nw7Hy3Bd6Fg0Js5Ua2Ve';
const LOCK = Date.parse('2026-11-12T00:15:00Z');

function keys() {
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const nkId = crypto.createHash('sha256').update('id').update(nk).digest().subarray(0, 16).toString('hex');
  return { member, nk, nkId, dev, ctx: { org: 'o1', member: 'm1', epoch: '1', period: PERIOD, snapshot: 's-' + crypto.randomBytes(4).toString('hex') } };
}

/* A work Kosmos on disk: nested files, one big enough for several chunks, a planted token, a .env, a link out. */
function workKosmos() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kbsnap-')));
  const root = path.join(base, 'kosmos');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'agents', 'a', 'memory'), { recursive: true });
  fs.mkdirSync(outside);
  const files = {
    'agents/a/notes.md': Buffer.from('plain notes\n'),
    // Text, not random bytes: the scanner skips most random binaries (key-shaped runs turn up by chance), so a random
    // file would make this round trip flaky.
    'agents/a/memory/big.bin': Buffer.from(Array.from({ length: 120000 }, (_, i) => `line ${i} of a long memory file, ${i % 97} more words here\n`).join('')),
    'agents/a/token.md': Buffer.from(`my token is ${TOKEN} ok\n`),
    'agents/a/.env': Buffer.from('SECRET=1\n'),
    'readme.txt': Buffer.from('hello'),
  };
  for (const [rel, b] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), b);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside the work Kosmos');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'agents', 'a', 'link.txt'));
  fs.symlinkSync(outside, path.join(root, 'agents', 'outdir'));
  return { base, root, files };
}

/* A store standing in for both uploaders: keeps every object, hands out keys in the given period. */
function store({ period = PERIOD, failChunksAfter, failManifest } = {}) {
  const objects = new Map(), batches = [], manifests = [];
  let n = 0;
  return {
    objects, batches, manifests,
    uploadChunks: async (deps, batch) => {
      batches.push(batch.length);
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) {
        if (failChunksAfter !== undefined && n >= failChunksAfter) return { ok: false, retryLater: true, because: 'grant ran out', keys, lockedUntil, bucket: 'bucket/' };
        const key = `o1/acct1/1/${period}/k${++n}`;
        objects.set(key, Buffer.from(object)); keys.set(name, key); lockedUntil.set(name, LOCK);
      }
      return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
    },
    uploadManifest: async (deps, bytes, opts) => {
      manifests.push({ bytes, opts });
      if (failManifest) return { ok: false, retryLater: true, because: 'manifest grant ran out' };
      return { ok: true, key: `o1/acct1/1/${PERIOD}/m${manifests.length}`, lockedUntilMs: LOCK };
    },
  };
}

function memorySink() {
  const committed = new Map();
  return { committed, begin(p) { const parts = []; return { write(b) { parts.push(Buffer.from(b)); }, commit() { committed.set(p, Buffer.concat(parts)); }, abort() {} }; } };
}

const take = (k, root, st, extra = {}) => snap.takeSnapshot(Object.assign({ root, memberPk: k.member.pk, namingKey: k.nk, namingKeyId: k.nkId, deviceKey: k.dev.privateKey, ctx: k.ctx }, extra.input || {}),
  Object.assign({ now: () => NOW, uploadChunks: st.uploadChunks, uploadManifest: st.uploadManifest }, extra.deps || {}));

async function restoreFrom(k, st, manifestBytes) {
  const opened = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, manifestBytes);
  const sink = memorySink();
  const r = await br.restoreSnapshot({ memberSk: k.member.sk, namingKey: k.nk, devicePubAtSnapshot: k.dev.publicKey, ctx: k.ctx, manifestObject: manifestBytes,
    fetchChunk: (name) => st.objects.get(opened.objects[name]) || null, sink, maxTotalBytes: 2 ** 40 });
  return { opened, r, sink };
}

test('periodOf is the coordinator\'s ISO week label, across week and year boundaries', () => {
  for (const [at, want] of [
    ['2026-10-08T12:00:00Z', '2026-W41'], ['2026-10-11T23:59:59Z', '2026-W41'], ['2026-10-12T00:00:00Z', '2026-W42'],
    ['2021-01-03T12:00:00Z', '2020-W53'], ['2021-01-04T00:00:00Z', '2021-W01'], ['2026-12-28T00:00:00Z', '2026-W53'],
    ['2027-01-03T23:00:00Z', '2026-W53'], ['2027-01-04T00:00:00Z', '2027-W01'], ['2025-12-29T00:00:00Z', '2026-W01'],
  ]) assert.equal(snap.periodOf(Date.parse(at)), want, at);
});

test('a snapshot round-trips through the real restore byte for byte; the token, the .env and the links never leave', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    assert.equal(st.manifests.length, 1, 'one manifest, uploaded after the chunks');
    const { opened, r: rr, sink } = await restoreFrom(k, st, st.manifests[0].bytes);
    assert.ok(opened, 'the manifest opens with the device key and context');
    assert.deepEqual([...sink.committed.keys()].sort(), ['agents/a/memory/big.bin', 'agents/a/notes.md', 'agents/a/token.md', 'readme.txt']);
    for (const p of ['agents/a/memory/big.bin', 'agents/a/notes.md', 'readme.txt']) assert.ok(sink.committed.get(p).equals(w.files[p]), p);
    assert.equal(rr.failed.length, 0);
    // The token file restores as what was UPLOADED: redacted, its kinds recorded, never its value.
    assert.ok(!sink.committed.get('agents/a/token.md').includes(TOKEN));
    assert.deepEqual(opened.redacted, [{ path: 'agents/a/token.md', kinds: [{ kind: 'github_token', count: 1 }] }]);
    const why = Object.fromEntries(opened.skipped.map((x) => [x.path, x.why]));
    assert.equal(why['agents/a/.env'], 'environment file');
    assert.match(why['agents/a/link.txt'], /link/); assert.match(why['agents/outdir'], /link/);
    // Nothing anywhere in storage holds the token or the outside file's text, decrypted.
    for (const [name, key] of Object.entries(opened.objects)) {
      const plain = bf.openVerifiedChunk(k.member.sk, k.nk, name, st.objects.get(key));
      assert.ok(plain, `chunk ${name} opens`);
      assert.ok(!plain.includes(TOKEN) && !plain.includes('outside the work Kosmos'));
    }
    assert.ok(Object.keys(opened.objects).length >= 4, 'the big file took several chunks');
    assert.equal(opened.namingKeyId, k.nkId);
    // The manifest uploader was handed the bucket and every chunk's key and lock end.
    assert.equal(st.manifests[0].opts.bucket, 'bucket/');
    assert.deepEqual(st.manifests[0].opts.chunks.map((c) => c.key).sort(), Object.values(opened.objects).sort());
    assert.ok(st.manifests[0].opts.chunks.every((c) => c.lockedUntilMs === LOCK));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a second snapshot in the period uploads only what changed, and still restores whole', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const first = await take(k, w.root, st);
    assert.equal(first.ok, true, first.because);
    const before = st.objects.size;
    fs.writeFileSync(path.join(w.root, 'agents', 'a', 'notes.md'), 'changed notes\n');
    const second = await take(Object.assign({}, k, { ctx: Object.assign({}, k.ctx, { snapshot: 's2' }) }), w.root, st, { input: { index: first.added, bucket: first.bucket } });
    assert.equal(second.ok, true, second.because);
    assert.equal(second.uploaded, 1, 'only the changed file\'s chunk is new');
    assert.equal(st.objects.size, before + 1);
    assert.ok(second.reused >= 4);
    const k2 = Object.assign({}, k, { ctx: Object.assign({}, k.ctx, { snapshot: 's2' }) });
    const { sink } = await restoreFrom(k2, st, st.manifests[1].bytes);
    assert.equal(sink.committed.get('agents/a/notes.md').toString(), 'changed notes\n');
    assert.ok(sink.committed.get('agents/a/memory/big.bin').equals(w.files['agents/a/memory/big.bin']), 'reused chunks restore');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('chunks are uploaded in bounded batches, never the whole snapshot at once', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { batchBytes: 1 } });
    assert.equal(r.ok, true, r.because);
    assert.ok(st.batches.length > 1 && st.batches.every((n) => n === 1), `batches: ${st.batches}`);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a context for another period than this clock\'s is refused before anything is uploaded', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { now: () => Date.parse('2026-10-12T00:00:01Z') } });
    assert.equal(r.ok, false); assert.equal(r.retryLater, true); assert.match(r.because, /2026-W42/);
    assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a chunk granted in another period stops the run before the manifest (a boundary between naming and granting)', async () => {
  const w = workKosmos(), k = keys(), st = store({ period: '2026-W42' });
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, false); assert.equal(r.retryLater, true); assert.match(r.because, /period/);
    assert.equal(st.manifests.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a failed chunk upload stops the run with no manifest, and returns what was stored for the index', async () => {
  const w = workKosmos(), k = keys(), st = store({ failChunksAfter: 2 });
  try {
    const r = await take(k, w.root, st, { deps: { batchBytes: 1 } });
    assert.equal(r.ok, false); assert.equal(r.retryLater, true);
    assert.equal(st.manifests.length, 0);
    assert.equal(r.added.size, 2, 'the two stored chunks are kept for the next run');
    assert.ok([...r.added.values()].every((e) => e.lockedUntilMs === LOCK && e.key.includes(PERIOD)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a failed manifest upload is a failed snapshot, with every stored chunk returned', async () => {
  const w = workKosmos(), k = keys(), st = store({ failManifest: true });
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, false); assert.equal(r.retryLater, true); assert.match(r.because, /manifest/);
    assert.equal(r.added.size, st.objects.size);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file over the size cap is skipped and named, not read', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { maxFile: 1024 * 1024 } });
    assert.equal(r.ok, true, r.because);
    const opened = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(opened.skipped.some((x) => x.path === 'agents/a/memory/big.bin' && /too large/.test(x.why)));
    assert.ok(!opened.files.some((f) => f.path === 'agents/a/memory/big.bin'));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an index of earlier chunks without their bucket is refused', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { input: { index: new Map([['a'.repeat(64), { key: `o1/acct1/1/${PERIOD}/k9`, lockedUntilMs: LOCK }]]) } });
    assert.equal(r.ok, false); assert.match(r.because, /bucket/);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('never throws: an uploader that throws is a failed snapshot', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { uploadChunks: async () => { throw new Error('boom'); } } });
    assert.equal(r.ok, false); assert.match(r.because, /boom/);
    assert.ok(r.added instanceof Map);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a chunk two files share is uploaded once, even when a batch boundary falls between them', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.writeFileSync(path.join(w.root, 'agents', 'a', 'copy-of-notes.md'), w.files['agents/a/notes.md']);
    const r = await take(k, w.root, st, { deps: { batchBytes: 1 } });
    assert.equal(r.ok, true, r.because);
    const opened = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    const byPath = Object.fromEntries(opened.files.map((f) => [f.path, f.chunks]));
    assert.deepEqual(byPath['agents/a/copy-of-notes.md'], byPath['agents/a/notes.md'], 'same content, same chunk name');
    assert.equal(st.objects.size, Object.keys(opened.objects).length, 'one stored object per chunk name, none twice');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});
