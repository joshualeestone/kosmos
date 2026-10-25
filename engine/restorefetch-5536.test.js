/**
 * kosmos#5536 (E0.7) slice 2: engine/restorefetch.js fetches one recorded manifest's objects through read grants
 * (kosmos#5686 c) for engine/restorerun.js. The snapshot is a real one with the coordinator's own key shape
 * (<org>/<member>/<epoch>/<period>/<64 hex>); the coordinator is a fake that applies the read route's rules (at most 500
 * distinct keys, each of the request's epoch and the manifest's period) and the store is a fake that serves presigned
 * URLs and lets them expire.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hpkeKeyPair } = require('./hpke');
const { namingKeyId } = require('./backupkeys');
const devkeyhist = require('./devkeyhist');
const snap = require('./backupsnapshot');
const rr = require('./restorerun');
const rf = require('./restorefetch');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const PERIOD = '2026-W41';
const LOCK = Date.parse('2026-11-11T00:15:00Z');
const SNAP_ID = '20261008T115500Z-0a1b2c3d';
const GRANTED = Math.floor(NOW / 1000);
const escrow = crypto.generateKeyPairSync('ed25519');
devkeyhist.setVerifyingKeyForTests(escrow.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));

const rawPub = (k) => k.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const hex64 = () => crypto.randomBytes(32).toString('hex');
const keyOf = (epoch = '1', period = PERIOD) => `o1/m1/${epoch}/${period}/${hex64()}`;

function history(org, member, entries, issuedAt) {
  const msg = devkeyhist.encodeHead(org, member, entries, issuedAt);
  return { org, member, entries, issuedAt, signature: crypto.sign(null, msg, escrow.privateKey).toString('base64url') };
}

/* A store and a coordinator in front of it. objects: key -> bytes. records: the manifests the coordinator recorded.
   The grant applies the read route's rules and refuses as it does; every URL lives 5 minutes on the clock `t`. */
function world(objects, records, t) {
  const calls = [];
  const issued = new Map();   // url -> { key, expiresAtMs }
  const w = {
    calls, issued, refuse: null, mutate: null, gets: [],
    grant: async (body) => {
      calls.push(JSON.parse(JSON.stringify(body)));
      if (w.refuse) return w.refuse;
      const rec = records.find((r) => r.key === body.manifest);
      if (!rec) return { ok: false, because: 'manifest_unknown' };
      const keys = body.keys;
      const re = new RegExp(`^o1/${body.member}/${body.epoch}/${rec.period}/[0-9a-f]{64}$`);
      if (!Array.isArray(keys) || keys.length > 500 || new Set(keys).size !== keys.length || !keys.every((k) => re.test(k))) {
        return { ok: false, because: 'bad_content_key' };
      }
      const expiresAt = Math.floor(t.now / 1000) + 300;
      const url = (k) => { const u = `https://store.test/${k}?sig=${calls.length}`; issued.set(u, { key: k, expiresAtMs: expiresAt * 1000 }); return u; };
      const answer = { member: body.member, epoch: body.epoch, expires_at: expiresAt,
        manifest: { key: rec.key, sha256: rec.sha256, size: rec.size, url: url(rec.key) },
        objects: keys.map((k) => ({ key: k, url: url(k) })) };
      return { ok: true, answer: w.mutate ? w.mutate(answer) : answer };
    },
    fetch: async (u, init) => {
      w.gets.push(u);
      assert.equal(init.redirect, 'manual', 'a redirect is never followed');
      const i = issued.get(u);
      if (!i) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
      if (t.now > i.expiresAtMs) return new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>', { status: 403 });
      const b = objects.get(i.key);
      return b ? new Response(b, { status: 200 }) : new Response('', { status: 404 });
    },
  };
  return w;
}

async function oneSnapshot() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'krestorefetch-')));
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
  let manifestKey = null;
  const deps = {
    now: () => NOW,
    uploadChunks: async (d, batch) => {
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) { const k = keyOf(); objects.set(k, Buffer.from(object)); keys.set(name, k); lockedUntil.set(name, LOCK); }
      return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
    },
    uploadManifest: async (d, bytes) => { manifestKey = keyOf(); objects.set(manifestKey, Buffer.from(bytes)); return { ok: true, key: manifestKey, lockedUntilMs: LOCK }; },
  };
  const r = await snap.takeSnapshot({ root, memberPk: member.pk, namingKey: nk, namingKeyId: namingKeyId(nk), deviceKey: dev.privateKey, ctx }, deps);
  assert.equal(r.ok, true, r.because);
  const mb = objects.get(manifestKey);
  const record = { key: manifestKey, period: PERIOD, snapshot: SNAP_ID, sha256: crypto.createHash('sha256').update(mb).digest('hex'), size: mb.length, granted_at: GRANTED };
  return { base, files, member, dev, objects, record };
}

function memorySink() {
  const committed = new Map();
  return { committed, begin(p) { const parts = []; return { write(b) { parts.push(Buffer.from(b)); }, commit() { committed.set(p, Buffer.concat(parts)); }, abort() {} }; } };
}

const enrolled = (dev, at = GRANTED - 86400) => [{ kind: 'enrol', key: rawPub(dev.publicKey), at, backfill: false }];

function restoreWith(s, f, extra = {}) {
  return rr.runRestore(Object.assign({ org: 'o1', member: 'm1', epoch: 1, manifest: s.record, memberSk: s.member.sk,
    history: history('o1', 'm1', enrolled(s.dev), GRANTED + 60), now: GRANTED + 120,
    fetchObject: f.fetchObject, plan: f.plan, planned: f.planned, sink: memorySink(), maxTotalBytes: 2 ** 30 }, extra));
}

const fetcherFor = (s, w, t, extra = {}) => rf.readGrantFetcher(Object.assign({ grant: w.grant, fetch: w.fetch, now: () => t.now,
  org: 'o1', member: 'm1', epoch: 1, manifest: s.record }, extra));

test('#5536 slice 2: a real snapshot is restored byte for byte through read grants, in two grant calls', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const f = fetcherFor(s, w, t);
    const sink = memorySink();
    const r = await restoreWith(s, f, { sink });
    assert.equal(r.ok, true, r.because);
    for (const [p, b] of Object.entries(s.files)) assert.ok(sink.committed.get(p) && sink.committed.get(p).equals(b), p);
    assert.equal(r.result.failed.length, 0);
    assert.deepEqual(r.fetchProblems, []);
    // One call for the manifest alone, then one for every chunk the opened manifest names: never one per chunk.
    assert.equal(w.calls.length, 2, JSON.stringify(w.calls.map((c) => c.keys.length)));
    assert.deepEqual(w.calls[0], { member: 'm1', epoch: 1, manifest: s.record.key, keys: [] });
    const chunks = [...s.objects.keys()].filter((k) => k !== s.record.key).sort();
    assert.deepEqual([...w.calls[1].keys].sort(), chunks, 'every chunk, and only chunks, in the batch');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: keys are granted in batches of at most 500, each batch once, in plan order', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'a'.repeat(64), size: 1 };
  const objects = new Map([[rec.key, Buffer.from('m')]]);
  const keys = Array.from({ length: 1201 }, () => { const k = keyOf(); objects.set(k, Buffer.from(k.slice(-4))); return k; });
  const t = { now: NOW }, w = world(objects, [rec], t);
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  assert.deepEqual(f.plan(keys.concat(keys.slice(0, 3), [rec.key])), { ok: true, because: undefined, unreadable: [], unreadableBecause: [] }, 'repeats and the manifest are not planned twice');
  for (const k of keys) assert.deepEqual(await f.fetchObject(k, { maxBytes: 10 }), Buffer.from(k.slice(-4)));
  assert.deepEqual(w.calls.map((c) => c.keys.length), [500, 500, 201]);
  assert.deepEqual(w.calls[0].keys, keys.slice(0, 500));
  assert.equal(await f.fetchObject(keyOf(), { maxBytes: 10 }), null, 'a key never planned is not fetched');
  assert.equal(w.calls.length, 3, 'and costs no grant');
});

test('#5536 slice 2: a URL near its expiry, or one S3 says has expired, is granted again for its batch only', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'b'.repeat(64), size: 1 };
  const objects = new Map([[rec.key, Buffer.from('m')]]);
  const keys = Array.from({ length: 3 }, () => { const k = keyOf(); objects.set(k, Buffer.from('x')); return k; });
  const t = { now: NOW }, w = world(objects, [rec], t);
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  f.plan(keys);
  assert.ok(await f.fetchObject(keys[0], { maxBytes: 1 }));
  assert.equal(w.calls.length, 1);
  // Literal times, not EXPIRY_MARGIN_MS, so a changed margin cannot move the test with it.
  t.now = NOW + 300000 - 31000;   // 31 s left: still used
  assert.ok(await f.fetchObject(keys[1], { maxBytes: 1 }));
  assert.equal(w.calls.length, 1, 'a URL with time left is not granted again');
  t.now = NOW + 300000 - 29000;   // 29 s left, still valid at the store: granted again before use
  assert.ok(await f.fetchObject(keys[1], { maxBytes: 1 }));
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.calls[1].keys, keys, 'the whole batch, not one chunk');
  // A Mac clock behind the store's: the URL looks fresh here, but S3 answers that it expired. One more grant, then bytes.
  const w2 = world(objects, [rec], t);
  let n = 0, expireAfter = 1;
  const real = w2.grant;
  w2.grant = async (b) => {
    n += 1;
    const g = await real(b);
    if (n <= expireAfter) for (const [u, v] of w2.issued) w2.issued.set(u, Object.assign({}, v, { expiresAtMs: 0 }));
    return g;
  };
  const f2 = rf.readGrantFetcher({ grant: w2.grant, fetch: w2.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  f2.plan(keys);
  assert.ok(await f2.fetchObject(keys[2], { maxBytes: 1 }), 'granted again once after an S3 expiry');
  assert.equal(n, 2);
  // Always expired: two tries, then nothing (never a loop).
  n = 0; expireAfter = Infinity;
  const f3 = rf.readGrantFetcher({ grant: w2.grant, fetch: w2.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  f3.plan(keys);
  assert.equal(await f3.fetchObject(keys[0], { maxBytes: 1 }), null);
  assert.equal(n, 2);
});

test('#5536 slice 2: a refused grant stops the restore with its reason, a 429 with its wait, and is not asked again', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    w.refuse = { ok: false, because: 'Kosmos+ is limiting reads of this backup', retryAfterSecs: 600 };
    const f = fetcherFor(s, w, t);
    const r = await restoreWith(s, f);
    assert.equal(r.ok, false);
    assert.equal(r.because, 'Kosmos+ is limiting reads of this backup (try again in 10 min)');
    assert.equal(w.calls.length, 1);
    assert.equal(await f.fetchObject(s.record.key, { maxBytes: 2 ** 20 }), null);
    assert.equal(w.calls.length, 1, 'a stopped fetcher asks for nothing more');
    // Refused only for the chunks' batch: the manifest opened, so the restore stops at the plan with the reason.
    const w2 = world(s.objects, [s.record], t);
    const grant = w2.grant;
    w2.grant = async (b) => (b.keys.length ? { ok: false, because: 'no release' } : grant(b));
    const f2 = fetcherFor(s, w2, t);
    const r2 = await restoreWith(s, f2);
    assert.equal(r2.ok, true, 'the plan itself grants nothing, so the files fail one by one');
    assert.equal(r2.result.restored.length, 0);
    assert.deepEqual(r2.fetchProblems, ['no release'], 'and the person is told why');
    // A plan that answers not ok stops the restore before any chunk.
    const r3 = await restoreWith(s, Object.assign({}, f, { plan: () => ({ ok: false, because: 'stopped here' }), fetchObject: fetcherFor(s, world(s.objects, [s.record], t), t).fetchObject }));
    assert.deepEqual(r3, { ok: false, because: 'stopped here' });
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: an answer that does not echo the request is refused by name and nothing is fetched', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW };
    const cases = [
      ['another member', (a) => Object.assign(a, { member: 'm2' }), 'Kosmos+ answered the read grant for another member or key'],
      ['another epoch', (a) => Object.assign(a, { epoch: 2 }), 'Kosmos+ answered the read grant for another member or key'],
      ['another manifest', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { key: keyOf() }) }), 'Kosmos+ answered the read grant for another backup'],
      ['another sha256', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { sha256: 'c'.repeat(64) }) }), 'Kosmos+ answered the read grant for another backup'],
      ['another size', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { size: a.manifest.size + 1 }) }), 'Kosmos+ answered the read grant for another backup'],
      ['an http url', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('https:', 'http:') }) }), 'Kosmos+ answered the read grant with an address restore will not use'],
      ['no expiry', (a) => Object.assign(a, { expires_at: '1' }), 'Kosmos+ answered the read grant with no expiry'],
      ['an object not asked for', (a) => Object.assign(a, { objects: [{ key: keyOf(), url: 'https://store.test/x' }] }), 'Kosmos+ answered the read grant for other files than were asked'],
      ['nothing', () => null, 'Kosmos+ answered the read grant with nothing usable'],
    ];
    for (const [label, mutate, because] of cases) {
      const w = world(s.objects, [s.record], t);
      w.mutate = mutate;
      const r = await restoreWith(s, fetcherFor(s, w, t));
      assert.deepEqual(r, { ok: false, because }, label);
      assert.deepEqual(w.gets, [], `${label}: nothing fetched`);
    }
    // In the chunks' batch: an object named twice, one left out, one not asked for, an http url.
    const chunkCases = [
      ['named twice', (a) => Object.assign(a, { objects: a.objects.length ? a.objects.slice(0, -1).concat([a.objects[0]]) : a.objects })],
      ['left out', (a) => Object.assign(a, { objects: a.objects.slice(1) })],
      ['http', (a) => Object.assign(a, { objects: a.objects.map((o) => Object.assign({}, o, { url: o.url.replace('https:', 'http:') })) })],
    ];
    for (const [label, mutate] of chunkCases) {
      const w = world(s.objects, [s.record], t);
      w.mutate = (a) => (a.objects.length ? mutate(a) : a);
      const r = await restoreWith(s, fetcherFor(s, w, t));
      assert.equal(r.ok, true, label);
      assert.equal(r.result.restored.length, 0, label);
      assert.deepEqual(r.fetchProblems, ['Kosmos+ answered the read grant for other files than were asked'], label);
    }
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: a chunk under an earlier key epoch is not asked for, its file fails, the rest restore, and the person is told why', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const f = fetcherFor(s, w, t);
    const plan = f.plan;
    // The opened manifest names one chunk under epoch 0 of the same period (an index entry from before a rotation).
    const old = keyOf('2');
    let planned = null;
    const sink = memorySink();
    const r = await restoreWith(s, Object.assign({}, f, { plan: (keys) => { planned = keys; return plan(keys.concat([old])); } }), { sink });
    assert.equal(r.ok, true, r.because);
    assert.ok(planned.length > 0);
    assert.ok(!w.calls.some((c) => c.keys.includes(old)), 'never sent: the route would refuse the whole batch');
    assert.deepEqual(r.fetchProblems, [rf.ANOTHER_EPOCH]);
    assert.deepEqual(f.planned().unreadable, [old]);
    assert.equal(rf.keyProblem(old, { org: 'o1', member: 'm1', epoch: '1', period: PERIOD }), rf.ANOTHER_EPOCH);
    assert.equal(rf.keyProblem(keyOf('1', '2026-W40'), { org: 'o1', member: 'm1', epoch: '1', period: PERIOD }), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem('o1/m1/1/2026-W41/c1', { org: 'o1', member: 'm1', epoch: '1', period: PERIOD }), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem(keyOf('01'), { org: 'o1', member: 'm1', epoch: '1', period: PERIOD }), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem(keyOf(), { org: 'o1', member: 'm1', epoch: '1', period: PERIOD }), null);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: a GET is never redirected, never read past maxBytes, and never hangs', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'd'.repeat(64), size: 4 };
  const objects = new Map([[rec.key, Buffer.from('mmmm')]]);
  const t = { now: NOW }, w = world(objects, [rec], t);
  const make = (fetch, extra = {}) => rf.readGrantFetcher(Object.assign({ grant: w.grant, fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec }, extra));
  assert.deepEqual(await make(w.fetch).fetchObject(rec.key, { maxBytes: 4 }), Buffer.from('mmmm'));
  assert.equal(await make(w.fetch).fetchObject(rec.key, { maxBytes: 3 }), null, 'one byte past maxBytes');
  // A streamed body with no length is cut off as it arrives.
  const streamed = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); } }), { status: 200 });
  assert.equal(await make(streamed).fetchObject(rec.key, { maxBytes: 4096 }), null, 'an endless body ends at the cap');
  const redirected = async (u, init) => { assert.equal(init.redirect, 'manual'); return new Response('', { status: 307, headers: { location: 'https://elsewhere.test/' } }); };
  assert.equal(await make(redirected).fetchObject(rec.key, { maxBytes: 4 }), null);
  const hung = (u, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const started = Date.now();
  assert.equal(await make(hung, { getTimeoutMs: 50 }).fetchObject(rec.key, { maxBytes: 4 }), null);
  assert.ok(Date.now() - started < 5000, 'the GET is aborted, not left running');
  assert.equal(await make(async () => { throw new Error('offline'); }).fetchObject(rec.key, { maxBytes: 4 }), null);
  assert.equal(await rf.readGrantFetcher({ fetch: w.fetch, org: 'o1', member: 'm1', epoch: '1', manifest: rec }).fetchObject(rec.key, { maxBytes: 4 }), null, 'no grant');
});
