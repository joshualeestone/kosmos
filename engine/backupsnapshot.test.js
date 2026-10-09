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
// What the coordinator sets for a 2026-W41 chunk grant: the period's end (2026-10-12) + 30 days + 15 minutes.
const LOCK = Date.parse('2026-11-11T00:15:00Z');

function keys() {
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const nkId = require('./backupkeys').namingKeyId(nk);   // the real id (review 21: a made-up one hid a missing check)
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
function store({ period = PERIOD, failChunksAfter, failManifest, bucket = 'bucket/', manifestAnswer, longKeys, org = 'o1', epoch = '1', keyFor, manifestPeriod } = {}) {
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
        const key = longKeys ? `${org}/acct-${'b'.repeat(68)}/${epoch}/${period}/${crypto.randomBytes(32).toString('hex')}` : `${org}/acct1/${epoch}/${period}/k${++n}`;
        const k2 = keyFor ? keyFor(key, n) : key;
        objects.set(k2, Buffer.from(object)); keys.set(name, k2); lockedUntil.set(name, LOCK);
      }
      return { ok: true, keys, lockedUntil, bucket };
    },
    uploadManifest: async (deps, bytes, opts) => {
      manifests.push({ bytes, opts });
      if (manifestAnswer) return manifestAnswer;
      if (failManifest) return { ok: false, retryLater: true, because: 'manifest grant ran out' };
      // The coordinator files a manifest under the same <org>/<account> as the chunks.
      return { ok: true, key: `${org}/${longKeys ? 'acct-' + 'b'.repeat(68) : 'acct1'}/${epoch}/${manifestPeriod || PERIOD}/m${manifests.length}`, lockedUntilMs: LOCK };
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
    assert.equal(r.ok, false); assert.match(r.because, /failed unexpectedly/); assert.doesNotMatch(r.because, /boom/, 'an error\'s own message (which can carry paths) is not passed on');
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
  for (const n of ['readdirSync', 'lstatSync', 'realpathSync', 'fstatSync', 'statSync', 'readSync', 'closeSync']) {
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
    // Its own key names: two test stores both count from k1, and real keys never repeat across grants.
    const st2 = store({ bucket: 'bucket2/', keyFor: (key) => key.replace(/\/k(\d+)$/, '/b2k$1') });
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

test('a manifest refused for outlasting its chunks: a stale index only when there is one; newPeriod when Monday passed', async () => {
  const w = workKosmos(), k = keys();
  try {
    const ans = { ok: false, outlastsChunks: true, grantSpent: false, because: 'outlasts' };
    const r0 = await take(k, w.root, store({ manifestAnswer: ans }));
    assert.equal(r0.ok, false); assert.equal(r0.staleIndex, undefined, 'no index: nothing to drop'); assert.equal(r0.grantSpent, false);
    const first = await take(k, w.root, store());
    assert.equal(first.ok, true, first.because);
    const k2 = Object.assign({}, k, { ctx: Object.assign({}, k.ctx, { snapshot: 's2' }) });
    const r1 = await take(k2, w.root, store({ manifestAnswer: ans }), { input: { index: first.added, bucket: first.bucket } });
    assert.equal(r1.staleIndex, true, 'with an index, that is what to drop'); assert.equal(r1.newPeriod, undefined);
    // Monday passed between the last check and the grant: the fresh reading says newPeriod.
    const st = store({ manifestAnswer: ans });
    const real = st.uploadManifest;
    let manifestAsked = false;
    const r2 = await take(k, w.root, st, { deps: { now: () => (manifestAsked ? Date.parse('2026-10-12T00:00:01Z') : NOW), uploadManifest: async (d, b, o) => { manifestAsked = true; return real(d, b, o); } } });
    assert.equal(r2.newPeriod, true); assert.equal(r2.staleIndex, undefined);
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

test('a granted key under another org, or over-long, fails the run, and every usable chunk is still kept', async () => {
  const w = workKosmos(), k = keys();
  try {
    // (The epoch segment is not checked: the coordinator writes a constant there; the member key is bound per index entry.)
    for (const [what, opts] of [['org', { org: 'o9' }]]) {
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

test('an index entry sealed to another member key (a rotation within the period) is stale before anything is read', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const other = hpkeKeyPair();
    const r = await take(k, w.root, st, { input: { index: new Map([['a'.repeat(64), { key: `o1/acct1/1/${PERIOD}/k1`, lockedUntilMs: LOCK, memberKeyId: snap.memberKeyIdOf(other.pk) }]]), bucket: 'bucket/' } });
    assert.equal(r.ok, false); assert.equal(r.staleIndex, true); assert.match(r.because, /another member key/);
    assert.equal(st.batches.length, 0);
    // An entry from before memberKeyId was recorded is stale too: nothing says which key sealed it.
    const r2 = await take(k, w.root, store(), { input: { index: new Map([['a'.repeat(64), { key: `o1/acct1/1/${PERIOD}/k1`, lockedUntilMs: LOCK }]]), bucket: 'bucket/' } });
    assert.equal(r2.staleIndex, true);
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

test('a file that grew after the walk is skipped as changed, not as a redaction problem', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f } = spyFs({ lstatSync: (real, p, o) => { const s2 = real(p, o); return String(p).endsWith('readme.txt') ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { size: 2n }) : s2; } });
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'readme.txt' && /grew/.test(x.why)), JSON.stringify(m.skipped));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file over the cap at walk time is never read, even if it shrank since', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f, opened } = spyFs({ lstatSync: (real, p2, o) => { const s2 = real(p2, o); return String(p2).endsWith('notes.md') ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { size: BigInt(2 * 1024 * 1024) }) : s2; } });
    const r = await take(k, w.root, st, { deps: { fs: f, maxFile: 1024 * 1024 } });
    assert.equal(r.ok, true, r.because);
    assert.ok(!opened.some((p2) => p2.endsWith('notes.md')), 'not opened');
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/notes.md' && /too large/.test(x.why)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an index under two accounts, or with a lock end no grant could set, is stale before anything is read', async () => {
  const w = workKosmos(), k = keys();
  try {
    const idx = (entries) => new Map(entries.map((e, i) => [String(i).repeat(64).slice(0, 64).replace(/[^0-9]/g, '0'), e]));
    for (const [what, entries] of [
      ['two accounts', [{ key: `o1/acct1/1/${PERIOD}/k1`, lockedUntilMs: LOCK }, { key: `o1/acct2/1/${PERIOD}/k2`, lockedUntilMs: LOCK }]],
      ['seconds, not ms', [{ key: `o1/acct1/1/${PERIOD}/k1`, lockedUntilMs: Math.floor(LOCK / 1000) }]],
      ['a lock too far ahead', [{ key: `o1/acct1/1/${PERIOD}/k1`, lockedUntilMs: NOW + 90 * 86400 * 1000 }]],
      ['a key with a quote', [{ key: `o1/acct1/1/${PERIOD}/k"1`, lockedUntilMs: LOCK }]],
    ]) {
      const st = store();
      const { f, opened } = spyFs();
      const r = await take(k, w.root, st, { input: { index: idx(entries), bucket: 'bucket/' }, deps: { fs: f } });
      assert.equal(r.ok, false, what); assert.equal(r.staleIndex, true, what);
      assert.equal(st.batches.length, 0, what); assert.equal(opened.length, 0, what);
    }
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a grant under another account than the run\'s first fails the run before the manifest', async () => {
  const w = workKosmos(), k = keys();
  try {
    let i = 0;
    const st = store({ keyFor: (key) => (++i === 2 ? key.replace('acct1', 'acct9') : key) });
    const r = await take(k, w.root, st, { deps: { batchBytes: 1 } });
    assert.equal(r.ok, false); assert.match(r.because, /account path/);
    assert.equal(st.manifests.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('folders nested past the depth cap are skipped by name, not a stack overflow', () => {
  const w = workKosmos();
  try {
    let p = w.root;
    for (let i = 0; i < 260; i++) p = path.join(p, 'd');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'deep.md'), 'x');
    const l = snap.listFiles(w.root);
    assert.ok(l.skipped.some((x) => /nested more than 256 deep/.test(x.why)), 'the deep folder is named');
    assert.ok(!l.files.some((f) => f.path.endsWith('deep.md')));
    assert.ok(l.files.some((f) => f.path === 'readme.txt'), 'control: the rest is listed');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a clock that gives no usable time is a plain failure, not a new period', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { now: () => NaN } });
    assert.equal(r.ok, false); assert.match(r.because, /clock/); assert.equal(r.newPeriod, undefined);
    assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('the real path checked must be the file opened: an inode that differs at the real path is skipped', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f } = spyFs({ statSync: (real, p2, o) => { const s2 = real(p2, o); return String(p2).endsWith('notes.md') ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { ino: s2.ino + 1n }) : s2; } });
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/notes.md' && /replaced/.test(x.why)));
    assert.ok(m.files.some((x) => x.path === 'readme.txt'), 'control');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file that grows during the read is skipped as grown, not as too large', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f } = spyFs({ fstatSync: (real, fd, o) => { const s2 = real(fd, o); return Number(s2.size) === w.files['agents/a/notes.md'].length ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { size: 3n }) : s2; } });
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/notes.md' && /grew/.test(x.why)), JSON.stringify(m.skipped.filter((x) => x.path.endsWith('notes.md'))));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a snapshot that could pass the week\'s allowance is refused before anything is spent; backup_quota is not a retry', async () => {
  const w = workKosmos(), k = keys();
  try {
    const big = new Map(Array.from({ length: 199990 }, (_, i) => [i.toString(16).padStart(64, '0'), { key: `o1/acct1/1/${PERIOD}/k${i}`, lockedUntilMs: LOCK, memberKeyId: snap.memberKeyIdOf(k.member.pk) }]));
    const st = store();
    const r = await take(k, w.root, st, { input: { index: big, bucket: 'bucket/' } });
    assert.equal(r.ok, false); assert.equal(r.overAllowance, true); assert.equal(st.batches.length, 0);
    const st2 = store();
    const r2 = await take(k, w.root, st2, { deps: { uploadChunks: async () => ({ ok: false, code: 'backup_quota', because: 'refused (HTTP 429)', keys: new Map(), lockedUntil: new Map(), bucket: null }) } });
    assert.equal(r2.ok, false); assert.equal(r2.overAllowance, true); assert.equal(r2.retryLater, undefined);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an index chunk whose lock ends before this snapshot\'s manifest would is stale before anything is read', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { input: { index: new Map([['a'.repeat(64), { key: `o1/acct1/1/${PERIOD}/k1`, lockedUntilMs: NOW + 10 * 86400 * 1000, memberKeyId: snap.memberKeyIdOf(k.member.pk) }]]), bucket: 'bucket/' } });
    assert.equal(r.ok, false); assert.equal(r.staleIndex, true); assert.match(r.because, /ends before/);
    assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a second run in the period, reusing what the first stored, is not refused by the allowance check', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const first = await take(k, w.root, st);
    assert.equal(first.ok, true, first.because);
    // Pad the index to a realistic period's worth (15,000 earlier chunks, about 15 GB at 1 MiB average): the check must still pass.
    const idx = new Map(first.added);
    for (let i = 0; idx.size < 15000; i++) idx.set(i.toString(16).padStart(64, '0'), { key: `o1/acct1/1/${PERIOD}/x${i}`, lockedUntilMs: LOCK, memberKeyId: snap.memberKeyIdOf(k.member.pk) });
    const k2 = Object.assign({}, k, { ctx: Object.assign({}, k.ctx, { snapshot: 's2' }) });
    const r = await take(k2, w.root, st, { input: { index: idx, bucket: first.bucket } });
    assert.equal(r.ok, true, r.because);
    assert.equal(r.uploaded, 0, 'nothing changed, nothing uploaded');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a device key that cannot sign is refused before anything is read or uploaded', async () => {
  const w = workKosmos(), k = keys();
  try {
    for (const bad of [null, crypto.generateKeyPairSync('ed25519').publicKey, crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey]) {
      const st = store();
      const r = await snap.takeSnapshot({ root: w.root, memberPk: k.member.pk, namingKey: k.nk, namingKeyId: k.nkId, deviceKey: bad, ctx: k.ctx },
        { now: () => NOW, uploadChunks: st.uploadChunks, uploadManifest: st.uploadManifest });
      assert.equal(r.ok, false); assert.match(r.because, /device key/); assert.equal(st.batches.length, 0);
    }
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a folder on another volume is not crossed, and is named', () => {
  const w = workKosmos();
  try {
    const { f } = spyFs({ lstatSync: (real, p2, o) => { const s2 = real(p2, o); return String(p2).endsWith(path.join('agents', 'a', 'memory')) ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { dev: s2.dev + 1n }) : s2; } });
    const l = snap.listFiles(w.root, f);
    assert.ok(l.skipped.some((x) => x.path === 'agents/a/memory' && /another volume/.test(x.why)));
    assert.ok(!l.files.some((x) => x.path.startsWith('agents/a/memory/')));
    assert.ok(l.files.some((x) => x.path === 'agents/a/notes.md'), 'control');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file swapped for another file of the work Kosmos between the walk and the open is skipped', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    // The walk saw another inode than the one now at that name (a rename over it): the open finds a different file.
    const { f } = spyFs({ lstatSync: (real, p2, o) => { const s2 = real(p2, o); return String(p2).endsWith('notes.md') ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { ino: s2.ino + 1n }) : s2; } });
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/notes.md' && /replaced/.test(x.why)));
    assert.ok(m.files.some((x) => x.path === 'readme.txt'), 'control');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('every folder rule in the deny-list ends in "/", so a denied folder is pruned whole (the walk relies on it)', () => {
  const { pathDecision } = require('./backupscan');
  for (const dir of ['.git', 'agents/a/.ssh', 'agents/a/.aws', 'x/.config/gh', 'secrets', 'agents/a/.gnupg', 'agents/a/.kube']) {
    assert.equal(pathDecision(`${dir}/x`).include, false, `${dir} is denied as a folder`);
  }
  assert.equal(pathDecision('agents/a/notes/x').include, true, 'control: an ordinary folder is walked');
});

test('a folder that changes identity between its first look and its listing is skipped, not walked', () => {
  const w = workKosmos();
  try {
    let n = 0;
    const { f } = spyFs({ lstatSync: (real, p2, o) => { const s2 = real(p2, o); return String(p2).endsWith(path.join('agents', 'a', 'memory')) && ++n === 2 ? Object.assign(Object.create(Object.getPrototypeOf(s2)), s2, { ino: s2.ino + 1n }) : s2; } });
    const l = snap.listFiles(w.root, f);
    assert.ok(l.skipped.some((x) => x.path === 'agents/a/memory' && /replaced/.test(x.why)), JSON.stringify(l.skipped));
    assert.ok(!l.files.some((x) => x.path.startsWith('agents/a/memory/')));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('stored chunks answered without a bucket are a failure, not recorded under an unknown bucket', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const real = st.uploadChunks;
    const r = await take(k, w.root, st, { deps: { uploadChunks: async (d, batch) => { const res = await real(d, batch); res.bucket = null; res.grantSpent = true; return res; } } });
    assert.equal(r.ok, false); assert.match(r.because, /without naming their bucket/);
    assert.equal(r.added.size, 0); assert.equal(r.grantSpent, true);
    assert.equal(st.manifests.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a Mac name with a backslash is judged as restore will write it: ".ssh\\id_rsa" is a credential path, never stored', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    for (const n of ['.ssh\\id_rsa', 'secrets\\db.txt', 'x\\.npmrc']) fs.writeFileSync(path.join(w.root, n), 'PLAIN-SECRET-BYTES');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    for (const n of ['.ssh\\id_rsa', 'secrets\\db.txt', 'x\\.npmrc']) {
      assert.ok(!m.files.some((x) => x.path === n), `${JSON.stringify(n)} was stored`);
      assert.ok(m.skipped.some((x) => x.path === n), `${JSON.stringify(n)} is named as skipped`);
    }
    for (const [name, key] of Object.entries(m.objects)) assert.ok(!bf.openVerifiedChunk(k.member.sk, k.nk, name, st.objects.get(key)).includes('PLAIN-SECRET-BYTES'));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a period boundary passed between the chunks and the manifest stops the run as newPeriod before the manifest grant', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    // The clock reads inside the period until the chunks are stored, then just past Monday 00:00 UTC.
    let stored = false;
    const real = st.uploadChunks;
    const r = await take(k, w.root, st, { deps: {
      now: () => (stored ? Date.parse('2026-10-12T00:00:05Z') : NOW),
      uploadChunks: async (d, batch) => { const res = await real(d, batch); stored = true; return res; },
    } });
    assert.equal(r.ok, false); assert.equal(r.newPeriod, true); assert.match(r.because, /period boundary/);
    assert.equal(st.manifests.length, 0, 'no manifest grant asked for');
    assert.ok(r.added.size > 0, 'the stored chunks are still returned');
    const ok = await take(k, w.root, store());
    assert.equal(ok.ok, true, `control: the same run inside the period stores its manifest (${ok.because})`);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('an index key longer than the walker accepts is stale before anything is read', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const long = `o1/acct-${'b'.repeat(300)}/1/${PERIOD}/k1`;
    const r = await take(k, w.root, st, { input: { index: new Map([['a'.repeat(64), { key: long, lockedUntilMs: LOCK, memberKeyId: snap.memberKeyIdOf(k.member.pk) }]]), bucket: 'bucket/' } });
    assert.equal(r.ok, false); assert.equal(r.staleIndex, true); assert.match(r.because, /longer than 256/);
    assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('the open works where the platform has no O_NOFOLLOW, O_NONBLOCK or O_NOCTTY (the identity checks hold)', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const { f } = spyFs();
    f.constants = { O_RDONLY: fs.constants.O_RDONLY };
    const r = await take(k, w.root, st, { deps: { fs: f } });
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(m.files.some((x) => x.path === 'readme.txt'));
    assert.ok(m.skipped.some((x) => x.path === 'agents/a/link.txt' && /link/.test(x.why)), 'links are still never followed (the walk)');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a run that crosses into the next period never asks for a manifest grant, even with chunks locked long enough', async () => {
  const w = workKosmos(), k = keys();
  try {
    // Last-day grants: the coordinator locks them to the NEXT period's date (2026-10-19 + 30 days + 15 minutes).
    const longLock = Date.parse('2026-11-18T00:15:00Z');
    const st = store();
    const real = st.uploadChunks;
    let stored = false;
    const r = await take(k, w.root, st, { deps: {
      now: () => (stored ? Date.parse('2026-10-12T00:00:05Z') : Date.parse('2026-10-11T23:00:00Z')),
      uploadChunks: async (d, batch) => { const res = await real(d, batch); for (const n of res.lockedUntil.keys()) res.lockedUntil.set(n, longLock); stored = true; return res; },
    } });
    assert.equal(r.ok, false); assert.equal(r.newPeriod, true);
    assert.equal(st.manifests.length, 0, 'the manifest\'s key and record would name another period than its sealed context');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a denied folder or file spelled with an invisible character is denied: restore treats it as the plain name', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.mkdirSync(path.join(w.root, '.git\u200b'));
    fs.writeFileSync(path.join(w.root, '.git\u200b', 'config'), 'url = https://x:TOKENISH@host/');
    fs.writeFileSync(path.join(w.root, 'agents', 'a', '.env\u00ad'), 'SECRET=1');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(!m.files.some((x) => x.path.startsWith('.git\u200b')), 'the invisible-.git folder was stored');
    assert.ok(!m.files.some((x) => x.path === 'agents/a/.env\u00ad'), 'the invisible-.env file was stored');
    assert.ok(m.files.some((x) => x.path === 'readme.txt'), 'control');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a file or folder named with something shaped like a credential is skipped, and recorded under a masked name', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    fs.writeFileSync(path.join(w.root, 'agents', 'a', `${TOKEN}.md`), 'notes about it');
    fs.mkdirSync(path.join(w.root, 'agents', 'a', `dir-${TOKEN}`));
    fs.writeFileSync(path.join(w.root, 'agents', 'a', `dir-${TOKEN}`, 'x.md'), 'x');
    fs.writeFileSync(path.join(w.root, 'agents', 'a', 'setprovider-plan-long-ordinary-name-for-a-file.md'), 'kept');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    const json = JSON.stringify(m);
    assert.ok(!json.includes(TOKEN), 'the token appears nowhere in the manifest');
    assert.equal(m.skipped.filter((x) => /shaped like a credential/.test(x.why)).length, 2);
    assert.ok(m.files.some((x) => x.path === 'agents/a/setprovider-plan-long-ordinary-name-for-a-file.md'), 'control: an ordinary long name is kept');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a manifest filed under another period than its context (Monday passed as it was granted) is not reported as success', async () => {
  const w = workKosmos(), k = keys(), st = store({ manifestPeriod: '2026-W42' });
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, false); assert.equal(r.newPeriod, true); assert.equal(r.grantSpent, true);
    assert.ok(r.added.size > 0, 'the stored chunks are returned');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a clock reading no Date can hold is a plain failure', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const r = await take(k, w.root, st, { deps: { now: () => 9e15 } });
    assert.equal(r.ok, false); assert.match(r.because, /clock/); assert.equal(st.batches.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a naming key id that is not this naming key\'s is refused before anything is read', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const stale = require('./backupkeys').namingKeyId(crypto.randomBytes(32));   // last period's, say
    const { f, opened } = spyFs();
    const r = await take(k, w.root, st, { input: { namingKeyId: stale }, deps: { fs: f } });
    assert.equal(r.ok, false); assert.match(r.because, /naming key id/);
    assert.equal(st.batches.length, 0); assert.equal(opened.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('two grants in one run naming different buckets, with no index, fail without staleIndex (there is none to drop)', async () => {
  const w = workKosmos(), k = keys();
  try {
    let i = 0;
    const st = store();
    const real = st.uploadChunks;
    const r = await take(k, w.root, st, { deps: { batchBytes: 1, uploadChunks: async (d, batch) => { const res = await real(d, batch); if (++i === 2) res.bucket = 'bucket2/'; return res; } } });
    assert.equal(r.ok, false); assert.match(r.because, /two grants in one snapshot/); assert.equal(r.staleIndex, undefined);
    assert.equal(r.bucket, 'bucket2/');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('with every chunk reused, a manifest grant in another bucket is a stale index (nothing uploaded to show it)', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const first = await take(k, w.root, st);
    assert.equal(first.ok, true, first.because);
    const k2 = Object.assign({}, k, { ctx: Object.assign({}, k.ctx, { snapshot: 's2' }) });
    const st2 = store({ manifestAnswer: { ok: false, otherBucket: true, grantSpent: true, because: 'the manifest grant names another bucket' } });
    const r = await take(k2, w.root, st2, { input: { index: first.added, bucket: first.bucket } });
    assert.equal(r.ok, false); assert.equal(st2.batches.length, 0, 'every chunk was reused');
    assert.equal(r.staleIndex, true); assert.equal(r.grantSpent, true);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a token split across a folder and a file name is caught on the whole path, and recorded masked', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const head = TOKEN.slice(0, 20), tail = TOKEN.slice(20);
    fs.mkdirSync(path.join(w.root, 'agents', 'a', head));
    fs.writeFileSync(path.join(w.root, 'agents', 'a', head, tail), 'x');
    const r = await take(k, w.root, st);
    assert.equal(r.ok, true, r.because);
    const m = bf.openManifest(k.member.sk, k.dev.publicKey, k.ctx, st.manifests[0].bytes);
    assert.ok(!JSON.stringify(m).includes(TOKEN), 'the joined token appears nowhere in the manifest');
    assert.ok(m.skipped.some((x) => /path holding something shaped like a credential/.test(x.why)));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a chunk granted a lock shorter than this snapshot\'s manifest would get fails the run before the manifest', async () => {
  const w = workKosmos(), k = keys(), st = store();
  try {
    const real = st.uploadChunks;
    const r = await take(k, w.root, st, { deps: { uploadChunks: async (d, b) => { const res = await real(d, b); for (const n of res.lockedUntil.keys()) res.lockedUntil.set(n, NOW + 29 * 86400 * 1000); return res; } } });
    assert.equal(r.ok, false); assert.match(r.because, /locked for less time/); assert.equal(st.manifests.length, 0);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('a manifest grant in another bucket on a run with no index hands back no chunks to keep (they are in the abandoned bucket)', async () => {
  const w = workKosmos(), k = keys(), st = store({ manifestAnswer: { ok: false, otherBucket: true, grantSpent: true, because: 'another bucket' } });
  try {
    const r = await take(k, w.root, st);
    assert.equal(r.ok, false); assert.equal(r.added.size, 0); assert.equal(r.grantSpent, true);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});
