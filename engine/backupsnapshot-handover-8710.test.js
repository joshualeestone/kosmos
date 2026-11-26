'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8710 slice 3: a hand-over pack, end to end. engine/backupsnapshot.js takes it with input.handover through the
 * REAL uploaders (engine/backupupload.js, hand-over layout) to a local bucket, behind a coordinator stub in the shape of
 * kosmos-relay's /v1/mac/org/handover/grant and /manifest (slice 2). Then the successor's side opens it through the
 * real restore (engine/backuprestore.js) with only what it holds: its one-time secret key, the leaving computer's
 * device public key (the coordinator's sender_pubkey), the hand-over's own context, and the bucket's bytes.
 * Nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');
const br = require('./backuprestore');
const snap = require('./backupsnapshot');
const up = require('./backupupload');
up.allowHttpForTests(true);

const HO = { id: 'ho1', prefix: 'handover/org1/ho1/' };
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const amzDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const md5 = (b) => crypto.createHash('md5').update(b).digest('base64');
const sha256b = (b) => crypto.createHash('sha256').update(b).digest('base64');

async function bucket() {
  const stored = new Map();
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/bucket\//, '');
      const body = Buffer.concat(parts);
      const sha = req.headers['x-amz-checksum-sha256'];
      if (sha !== undefined ? sha !== sha256b(body) : req.headers['content-md5'] !== md5(body)) { res.statusCode = 400; return res.end(''); }
      if (stored.has(key)) { res.statusCode = 412; return res.end(''); }
      stored.set(key, { body, lock: req.headers['x-amz-object-lock-mode'] }); res.statusCode = 200; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { stored, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}

function coordinator(b) {
  let n = 0;
  const calls = [];
  const urlOf = (key, signedAt, signed) => `${b.base}/bucket/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDTEST%2F20261119%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=${amzDate(signedAt)}&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(signed)}&X-Amz-Signature=00`;
  const macRequest = async (method, route, body) => {
    calls.push(route);
    const expMs = Date.now() + 15 * 60 * 1000, signedAt = Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000;
    if (route === up.HANDOVER_GRANT_ROUTE) {
      return { ok: true, data: { expires_at: iso(expMs), uploads: body.chunks.map((c) => { const key = `${HO.prefix}c${++n}`; return { key, url: urlOf(key, signedAt, 'content-length;content-md5;host;if-none-match'), headers: { 'content-md5': c.md5, 'if-none-match': '*' } }; }) } };
    }
    if (route === up.HANDOVER_MANIFEST_ROUTE) {
      const key = `${HO.prefix}manifest`;
      return { ok: true, data: { expires_at: iso(expMs), upload: { key, url: urlOf(key, signedAt, 'content-length;host;if-none-match;x-amz-checksum-sha256'), headers: { 'x-amz-checksum-sha256': body.sha256, 'if-none-match': '*' } } } };
    }
    return { ok: false, because: `refused (HTTP 404 on ${route})` };
  };
  return { macRequest, calls };
}

/* An agent's folder on disk, as a pack would carry it. */
function agentFolder() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'khandover-')));
  const files = {
    'agent.json': Buffer.from(JSON.stringify({ name: 'Permit Intake Assistant', role: 'document-review-coordinator' })),
    'memory/notes.md': Buffer.from('the permit queue is checked every morning\n'),
    'memory/long.md': Buffer.from(Array.from({ length: 40000 }, (_, i) => `line ${i} of the history, ${i % 89} more\n`).join('')),
    'Files/report.txt': Buffer.from('quarterly report'),
  };
  for (const [rel, bytes] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), bytes); }
  return { root: base, files };
}

function keys() {
  const seal = hpkeKeyPair();   // the successor's one-time key: its public half reaches the sender as seal_pub
  const nk = crypto.randomBytes(32);
  return { seal, nk, nkId: require('./backupkeys').namingKeyId(nk), dev: crypto.generateKeyPairSync('ed25519'), ctx: snap.handoverContext('org1', HO.id) };
}
const packInput = (k, root, extra) => Object.assign({ root, memberPk: k.seal.pk, namingKey: k.nk, namingKeyId: k.nkId, deviceKey: k.dev.privateKey, ctx: k.ctx, handover: HO }, extra || {});
const memorySink = () => { const committed = new Map(); return { committed, begin(p) { const parts = []; return { write(b) { parts.push(Buffer.from(b)); }, commit() { committed.set(p, Buffer.concat(parts)); }, abort() {} }; } }; };

async function openAs(memberSk, devicePub, ctx, b, manifestKey) {
  const mo = b.stored.get(manifestKey).body;
  const opened = bf.openManifest(memberSk, devicePub, ctx, mo);
  if (!opened) return { opened: null };
  const sink = memorySink();
  const r = await br.restoreSnapshot({ memberSk, devicePubAtSnapshot: devicePub, ctx, manifestObject: mo,
    fetchChunk: (name) => (b.stored.get(opened.objects[name]) || {}).body || null, sink, maxTotalBytes: 2 ** 40 });
  return { opened, r, sink };
}

test('a hand-over pack goes up unlocked under its prefix and opens on the successor with its one-time key (kosmos#8710)', async () => {
  const b = await bucket();
  const w = agentFolder();
  try {
    const k = keys();
    const c = coordinator(b);
    const r = await snap.takeSnapshot(packInput(k, w.root), { macRequest: c.macRequest, fetch, sleep: async () => {} });
    assert.equal(r.ok, true, r.because);
    assert.equal(r.manifestKey, `${HO.prefix}manifest`);
    assert.ok(b.stored.size >= 3);
    for (const [key, v] of b.stored) { assert.ok(key.startsWith(HO.prefix), key); assert.equal(v.lock, undefined, key); }
    assert.ok(c.calls.every((x) => x === up.HANDOVER_GRANT_ROUTE || x === up.HANDOVER_MANIFEST_ROUTE), c.calls.join());

    const { opened, r: rr, sink } = await openAs(k.seal.sk, k.dev.publicKey, snap.handoverContext('org1', HO.id), b, r.manifestKey);
    assert.ok(opened, 'the successor could not open the manifest');
    assert.equal(rr.failed.length, 0, JSON.stringify(rr.failed));
    for (const [rel, bytes] of Object.entries(w.files)) assert.ok(sink.committed.get(rel) && sink.committed.get(rel).equals(bytes), rel);

    // Only the successor's key opens it, and only as THIS hand-over: another hand-over's context, or another one-time
    // key, opens nothing. The leaving computer's signature is checked against the key the coordinator names.
    assert.equal(bf.openManifest(hpkeKeyPair().sk, k.dev.publicKey, k.ctx, b.stored.get(r.manifestKey).body), null);
    assert.equal(bf.openManifest(k.seal.sk, k.dev.publicKey, snap.handoverContext('org1', 'ho2'), b.stored.get(r.manifestKey).body), null);
    assert.equal(bf.openManifest(k.seal.sk, k.dev.publicKey, snap.handoverContext('org2', HO.id), b.stored.get(r.manifestKey).body), null);
    assert.equal(bf.openManifest(k.seal.sk, crypto.generateKeyPairSync('ed25519').publicKey, k.ctx, b.stored.get(r.manifestKey).body), null);
  } finally { await b.close(); fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a hand-over pack takes only its own context, and a backup takes no hand-over context', async () => {
  const w = agentFolder();
  try {
    const k = keys();
    const asked = [];
    const deps = { macRequest: async (m, route) => { asked.push(route); return { ok: false, because: `refused (HTTP 403 on ${route})` }; }, fetch, sleep: async () => {} };
    const cases = [
      [packInput(k, w.root, { ctx: Object.assign({}, k.ctx, { member: 'someone' }) }), /context must be its own \(member\)/],
      [packInput(k, w.root, { ctx: snap.handoverContext('org2', HO.id) }), /context must be its own \(org\)/],
      [packInput(k, w.root, { ctx: { org: 'org1', member: 'ho1', epoch: '1', period: '2026-W47', snapshot: 'ho1' } }), /context must be its own \(epoch\)/],
      [packInput(k, w.root, { handover: { id: 'ho1', prefix: 'handover/org1/ho2/' } }), /is not \{ id, prefix \}/],
      [packInput(k, w.root, { handover: { id: 'ho1', prefix: 'org1/acct1/1/2026-W47/' } }), /is not \{ id, prefix \}/],
      // The control: a hand-over's context without input.handover is a backup with no usable key epoch.
      [packInput(k, w.root, { handover: undefined }), /is not one a grant can name/],
      [packInput(k, w.root, { index: new Map([['a'.repeat(64), { key: `${HO.prefix}c1`, lockedUntilMs: null, memberKeyId: 'x' }]]), bucket: 'b/' }), /taken whole, with no index/],
    ];
    for (const [input, re] of cases) {
      const r = await snap.takeSnapshot(input, deps);
      assert.equal(r.ok, false, String(re));
      assert.match(r.because, re);
    }
    assert.deepEqual(asked, []);
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});

test('a hand-over chunk that comes back locked, or outside the prefix, is not named', async () => {
  const w = agentFolder();
  try {
    for (const [why, answer] of [
      ['locked', (key) => ({ key: `${HO.prefix}${key}`, lock: Date.now() + 33 * 86400 * 1000 })],
      ['outside', (key) => ({ key: `handover/org1/ho2/${key}`, lock: null })],
    ]) {
      const k = keys();
      let n = 0;
      const uploadChunks = async (deps, batch) => {
        const keys = new Map(), lockedUntil = new Map();
        for (const c of batch) { const a = answer(`c${++n}`); keys.set(c.name, a.key); lockedUntil.set(c.name, a.lock); }
        return { ok: true, keys, lockedUntil, bucket: '127.0.0.1/bucket/' };
      };
      const uploadManifest = async () => assert.fail('no manifest may be asked for');
      const r = await snap.takeSnapshot(packInput(k, w.root), { uploadChunks, uploadManifest });
      assert.equal(r.ok, false, why);
      assert.match(r.because, why === 'locked' ? /locked, which no hand-over chunk is/ : /not under this hand-over/);
    }
  } finally { fs.rmSync(w.root, { recursive: true, force: true }); }
});
