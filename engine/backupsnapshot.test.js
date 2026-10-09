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
function store({ period = PERIOD, failChunksAfter, failManifest, bucket = 'bucket/', manifestAnswer, longKeys, org = 'o1', epoch = '1', keyFor } = {}) {
  const objects = new Map(), batches = [], manifests = [];
  let n = 0;
  return {
    objects, batches, manifests,
    uploadChunks: async (deps, batch) => {
      batches.push(batch.length);
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) {
        if (failChunksAfter !== undefined && n >= failChunksAfter) return { ok: false, retryLater: true, because: 'grant ran out', keys, lockedUntil, bucket };
        // longKeys: the coordinator's real shape, two ids then two 32-hex ids (about 140 characters).
        const key = longKeys ? `o1/acct-${'b'.repeat(68)}/1/${period}/${crypto.randomBytes(32).toString('hex')}` : `${org}/acct1/${epoch}/${period}/k${++n}`;
        const k2 = keyFor ? keyFor(key, n) : key;
        objects.set(k2, Buffer.from(object)); keys.set(name, k2); lockedUntil.set(name, LOCK);
      }
      return { ok: true, keys, lockedUntil, bucket };
    },
    uploadManifest: async (deps, bytes, opts) => {
      manifests.push({ bytes, opts });
      if (manifestAnswer) return manifestAnswer;
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
    assert.equal(r.ok, false); assert.equal(r.newPeriod, true); assert.equal(r.retryLater, undefined); assert.match(r.because, /2026-W42/);
    assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a chunk granted in another period stops the run before the manifest (a boundary between naming and granting)', async () => {
  const w = workKosmos(), k = keys(), st = store({ period: '2026-W42' });
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, false); assert.equal(r.newPeriod, true); assert.equal(r.retryLater, undefined); assert.match(r.because, /period/);
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

/* The real fs, with every open recorded and any call overridable by name: (realFn, ...args) => result. */
function spyFs(over = {}) {
  const opened = [];
  const f = Object.create(fs);
  f.constants = fs.constants;
  for (const n of ['readdirSync', 'lstatSync', 'realpathSync', 'fstatSync', 'readSync', 'closeSync']) {
    const real = fs[n].bind(fs);
    f[n] = over[n] ? (...a) => over[n](real, ...a) : real;
  }
  const realOpen = fs.openSync.bind(fs);
  f.openSync = (p, fl) => { opened.push(p); return over.openSync ? over.openSync(realOpen, p, fl) : realOpen(p, fl); };
  return { f, opened };
}

test('a denied folder is pruned during the walk and recorded once; nothing in it, and no denied file, is ever opened', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.mkdirSync(path.join(w.root, '.git', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(w.root, '.git', 'config'), '[remote] url = https://x:tok@host/');
    fs.writeFileSync(path.join(w.root, '.git', 'objects', 'aa'), 'pack');
    fs.mkdirSync(path.join(w.root, 'agents', 'a', '.ssh'));
    fs.writeFileSync(path.join(w.root, 'agents', 'a', '.ssh', 'id_ed25519'), 'PRIVATE');
    const { f, opened } = spyFs();
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    assert.ok(opened.length > 0, 'the spy sees opens (control)');
    assert.deepEqual(opened.filter((p) => /[\\/](\.git|\.ssh)([\\/]|$)|\.env$/.test(p)), [], 'nothing denied was opened');
    const opened2 = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    const sk = opened2.skipped.map((x) => x.path);
    assert.ok(sk.includes('.git') && sk.includes('agents/a/.ssh') && sk.includes('agents/a/.env'));
    assert.ok(!sk.some((p) => p.startsWith('.git/') || p.startsWith('agents/a/.ssh/')), 'a pruned folder is recorded once, not per file');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file replaced after the walk (another inode) is skipped, not read', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f } = spyFs({ fstatSync: (real, fd, o) => { const s2 = real(fd, o); return Number(s2.size) === w.files['agents/a/notes.md'].length ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { ino: s2.ino + 1n }) : s2; } });
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/notes.md' && /replaced/.test(x.why)));
    assert.ok(!m.files.some((x) => x.path === 'agents/a/notes.md'));
    assert.ok(m.files.some((x) => x.path === 'readme.txt'), 'control: the others are stored');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file whose real path resolves outside the work Kosmos is skipped', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f } = spyFs({ realpathSync: (real, p) => (String(p).endsWith('notes.md') ? path.join(w.base, 'outside', 'secret.txt') : real(p)) });
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/notes.md' && /outside/.test(x.why)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a FIFO in the work Kosmos is skipped, never opened, and does not hang the snapshot', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    require('child_process').execFileSync('mkfifo', [path.join(w.root, 'agents', 'a', 'pipe')]);
    const { f, opened } = spyFs();
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    assert.ok(!opened.some((p) => p.endsWith('pipe')));
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/pipe' && /not a regular file/.test(x.why)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a grant in another bucket than the index\'s is a stale index: drop it, keep what was stored under the new bucket', async () => {
  const w = workKosmos(), k = keys(), st1 = store();
  try {
    const first = await take(k, w.root, st1);
    assert.equal(first.ok, true, first.because);
    fs.writeFileSync(path.join(w.root, 'agents', 'a', 'notes.md'), 'changed\n');
    const st2 = store({ bucket: 'bucket2/' });
    const r = await take(k, w.root, st2, { input: { index: first.added, bucket: first.bucket } });
    assert.equal(r.ok, false); assert.equal(r.staleIndex, true); assert.equal(r.retryLater, undefined, 'not a retry: the same index fails again');
    assert.equal(r.bucket, 'bucket2/');
    assert.equal(r.added.size, st2.objects.size, 'what the new bucket stored is kept');
    assert.equal(st2.manifests.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an index entry from another period, or malformed, is refused before anything is read or uploaded', async () => {
  const w = workKosmos(), k = keys();
  try {
    for (const entry of [{ key: 'o1/acct1/1/2026-W40/k1', lockedUntilMs: LOCK }, { key: `o1/acct1/1/${PERIOD}/k1` }, null]) {
      const st = store();
      const { f, opened } = spyFs();
      const r = await take(k, w.root, st, { input: { index: new Map([['a'.repeat(64), entry]]), bucket: 'bucket/' }, deps: { fs: f } });
      assert.equal(r.ok, false); assert.equal(r.staleIndex, true, JSON.stringify(entry));
      assert.equal(st.batches.length, 0); assert.equal(opened.length, 0);
    }
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a manifest that would pass its ceiling stops the run before any chunk is uploaded', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { maxManifestJson: 600 } });
    assert.equal(r.ok, false); assert.equal(r.tooLarge, true); assert.equal(r.retryLater, undefined);
    assert.equal(st.batches.length, 0, 'nothing locked in storage for a manifest that could never be stored');
    const ok = await take(k, w.root, store(), { deps: { maxManifestJson: 1024 * 1024 } });
    assert.equal(ok.ok, true, `control: a sufficient ceiling passes (${ok.because})`);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a manifest refused for outlasting the index\'s chunks is a stale index, with the grant reported spent', async () => {
  const w = workKosmos(), k = keys(), st = store({ manifestAnswer: { ok: false, outlastsChunks: true, grantSpent: false, because: 'outlasts' } });
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, false); assert.equal(r.staleIndex, true); assert.equal(r.grantSpent, false);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a hard link is skipped: another name for it may be outside the work Kosmos', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.linkSync(path.join(w.base, 'outside', 'secret.txt'), path.join(w.root, 'agents', 'a', 'hard.txt'));
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/hard.txt' && /hard link/.test(x.why)));
    assert.ok(m.files.some((x) => x.path === 'readme.txt'), 'control: a file with one link is stored');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a path restore would refuse, or two names restore treats as one, is skipped at backup time and named', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    for (const n of ['aux.c', 'a:b.txt', 'trailing.txt ', 'Icon\r']) fs.writeFileSync(path.join(w.root, 'agents', 'a', n), 'x');
    fs.mkdirSync(path.join(w.root, 'q'));
    fs.writeFileSync(path.join(w.root, 'q', 'r.txt'), 'folder form');
    fs.writeFileSync(path.join(w.root, 'q\\r.txt'), 'backslash form');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    const why = Object.fromEntries(m.skipped.map((x) => [x.path, x.why]));
    for (const n of ['aux.c', 'a:b.txt', 'trailing.txt ', 'Icon\r']) assert.match(why[`agents/a/${n}`] || '', /restore cannot write it/, JSON.stringify(n));
    const qs = ['q/r.txt', 'q\\r.txt'];
    assert.equal(qs.filter((p) => m.files.some((x) => x.path === p)).length, 1, 'exactly one of two colliding names is stored');
    assert.ok(qs.some((p) => /restore would refuse it beside/.test(why[p] || '')), 'the other is named');
    const { r: rr } = await restoreFrom(k, st, st.manifests[0].bytes);
    assert.equal(rr.failed.length, 0, `restore refuses nothing the walker stored: ${JSON.stringify(rr.failed)}`);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a skipped list that would push the manifest over its ceiling stops the run before the last batch is uploaded', async () => {
  const w = workKosmos(), k = keys();
  try {
    // Control: the same work Kosmos without the extra skipped files fits the same ceiling.
    const control = await take(k, w.root, store(), { deps: { maxManifestJson: 64 * 1024, batchBytes: 1 } });
    assert.equal(control.ok, true, `control: ${control.because}`);
    for (let i = 0; i < 1200; i++) fs.writeFileSync(path.join(w.root, 'agents', 'a', `k${String(i).padStart(4, '0')}.env`), 'X=1');
    const st = store();
    // batchBytes 1: every chunk is its own batch, so a skip charged late would let batches go up mid-walk.
    const r = await take(k, w.root, st, { deps: { maxManifestJson: 64 * 1024, batchBytes: 1 } });
    assert.equal(r.ok, false); assert.equal(r.tooLarge, true);
    assert.equal(st.batches.length, 0, 'nothing was locked for a manifest that could not be stored');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('chunks stored in a batch are all kept for the index even when one comes back without its lock end', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const realUpload = st.uploadChunks;
    let first = true;
    const r = await take(k, w.root, st, { deps: { batchBytes: 1024 * 1024 * 1024, uploadChunks: async (d, batch) => {
      const res = await realUpload(d, batch);
      if (first) { first = false; res.lockedUntil.delete(batch[0].name); }
      return res;
    } } });
    assert.equal(r.ok, false); assert.match(r.because, /lock end/);
    assert.equal(r.added.size, st.objects.size - 1, 'every chunk with its lock end is kept, not only those before the bad one');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('whatever the ceiling, a run either stores a manifest that fits or uploads nothing at all (real-length keys)', async () => {
  const k = keys();
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kbsnap-')));
  const root = path.join(base, 'kosmos');
  try {
    fs.mkdirSync(path.join(root, 'agents', 'a'), { recursive: true });
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(root, 'agents', 'a', `f${String(i).padStart(2, '0')}.md`), `file ${i} ${crypto.randomBytes(8).toString('hex')}\n`);
    let fits = 0, refused = 0;
    for (let budget = 8000; budget <= 200000; budget += 8000) {
      const st = store({ longKeys: true });
      const r = await take(k, root, st, { deps: { maxManifestJson: budget, batchBytes: 1 } });
      if (r.ok) {
        fits++;
        const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
        assert.ok(Buffer.byteLength(bf.canonicalJson(m)) <= budget, `budget ${budget}: the stored manifest is over its ceiling`);
      } else {
        refused++;
        assert.equal(r.tooLarge, true, `budget ${budget}: ${r.because}`);
        assert.equal(st.objects.size, 0, `budget ${budget}: ${st.objects.size} chunks locked for a manifest that was never stored`);
      }
    }
    assert.ok(fits > 0 && refused > 0, `the range must cover both outcomes (fits ${fits}, refused ${refused})`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a file whose name is another entry\'s folder, to restore, is skipped: restore would refuse both', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.writeFileSync(path.join(w.root, 'q'), 'a file named q');
    fs.writeFileSync(path.join(w.root, 'q\\s.txt'), 'backslash under q');
    fs.mkdirSync(path.join(w.root, 'q\u200b'));
    fs.writeFileSync(path.join(w.root, 'q\u200b', 'r.txt'), 'under an invisible q');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    const stored = m.files.map((x) => x.path).filter((p) => p.startsWith('q'));
    assert.deepEqual(stored, ['q'], 'the first in sorted order is kept, the two under it skipped');
    const { r: rr } = await restoreFrom(k, st, st.manifests[0].bytes);
    assert.equal(rr.failed.length, 0, `restore refuses nothing the walker stored: ${JSON.stringify(rr.failed)}`);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a granted key under another org or key epoch, or over-long, fails the run, and every usable chunk is still kept', async () => {
  const w = workKosmos(), k = keys();
  try {
    for (const [what, opts] of [['epoch', { epoch: '2' }], ['org', { org: 'o9' }]]) {
      const st = store(opts);
      const r = await take(k, w.root, st);
      assert.equal(r.ok, false); assert.match(r.because, new RegExp(what), what);
      assert.equal(st.manifests.length, 0); assert.equal(r.added.size, 0, `${what}: none of these can be named`);
    }
    let i = 0;
    const st = store({ keyFor: (key) => (++i === 2 ? key + 'x'.repeat(300) : key) });
    const r = await take(k, w.root, st, { deps: { batchBytes: 1024 * 1024 * 1024 } });
    assert.equal(r.ok, false); assert.match(r.because, /longer than 256/);
    assert.equal(r.added.size, st.objects.size - 1, 'every usable chunk in the batch is kept, before and after the long one');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an index entry under another key epoch is a stale index (sealed to another member key)', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { input: { index: new Map([['a'.repeat(64), { key: `o1/acct1/2/${PERIOD}/k1`, lockedUntilMs: LOCK }]]), bucket: 'bucket/' } });
    assert.equal(r.ok, false); assert.equal(r.staleIndex, true); assert.match(r.because, /epoch/);
    assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('the walk stops past maxFiles and only counts skips past maxSkipped', () => {
  const w = workKosmos();
  try {
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(w.root, `n${String(i).padStart(2, '0')}.md`), 'x');
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(w.root, `s${String(i).padStart(2, '0')}.env`), 'x');
    const all = snap.listFiles(w.root);
    assert.equal(all.over, false); assert.ok(all.files.length > 30); assert.equal(all.skippedExtra, 0);
    const capped = snap.listFiles(w.root, fs, { maxFiles: 10 });
    assert.equal(capped.over, true); assert.ok(capped.files.length <= 11, `stopped early (${capped.files.length})`);
    const few = snap.listFiles(w.root, fs, { maxSkipped: 5 });
    assert.equal(few.over, false); assert.equal(few.skipped.length, 5);
    assert.equal(few.skippedExtra, all.skipped.length - 5, 'every skip past the cap is counted');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an empty file round-trips as an entry with no chunks', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.writeFileSync(path.join(w.root, 'agents', 'a', 'empty.md'), '');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const { opened, sink } = await restoreFrom(k, st, st.manifests[0].bytes);
    assert.deepEqual(opened.files.find((x) => x.path === 'agents/a/empty.md').chunks, []);
    assert.equal(sink.committed.get('agents/a/empty.md').length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('one file far over the size cap is a skip entry, not a reason to refuse the whole snapshot', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const img = path.join(w.root, 'vm.img');
    const fd = fs.openSync(img, 'w'); fs.ftruncateSync(fd, 20 * 1024 ** 3); fs.closeSync(fd);   // sparse: no disk used
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'vm.img' && /too large/.test(x.why)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a key granted twice, or for a chunk this run did not ask to store, fails the run before the manifest', async () => {
  const w = workKosmos(), k = keys();
  try {
    let first = null;
    const st = store({ keyFor: (key) => { if (!first) { first = key; return key; } return first; } });
    const r = await take(k, w.root, st, { deps: { batchBytes: 1 } });
    assert.equal(r.ok, false); assert.match(r.because, /repeats a key/);
    assert.equal(st.manifests.length, 0);
    assert.equal(r.added.size, 1, 'the first use of the key is kept, the repeat is not');
    const st2 = store();
    const real = st2.uploadChunks;
    const r2 = await take(k, w.root, st2, { deps: { uploadChunks: async (d, batch) => {
      const res = await real(d, batch);
      res.keys.set('f'.repeat(64), `o1/acct1/1/${PERIOD}/foreign`); res.lockedUntil.set('f'.repeat(64), LOCK);
      return res;
    } } });
    assert.equal(r2.ok, false); assert.match(r2.because, /did not ask/);
    assert.ok(!r2.added.has('f'.repeat(64)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});
