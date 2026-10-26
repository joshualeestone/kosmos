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
    calls, issued, refuse: null, mutate: null, gets: [], followed: 0,
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
      // Counted, not asserted: a throw here would be swallowed by getOne's catch and read as a missing object.
      if (init.redirect !== 'manual') w.followed += 1;
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

const noWait = () => Promise.resolve();
const fetcherFor = (s, w, t, extra = {}) => rf.readGrantFetcher(Object.assign({ grant: w.grant, fetch: w.fetch, now: () => t.now, sleep: noWait,
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
    assert.equal(w.followed, 0, 'no GET may follow a redirect');
    // One call for the manifest alone, then one for every chunk the opened manifest names: never one per chunk.
    assert.equal(w.calls.length, 2, JSON.stringify(w.calls.map((c) => c.keys.length)));
    assert.deepEqual(w.calls[0], { member: 'm1', epoch: 1, manifest: s.record.key, keys: [] });
    const chunks = [...s.objects.keys()].filter((k) => k !== s.record.key).sort();
    assert.deepEqual([...w.calls[1].keys].sort(), chunks, 'every chunk, and only chunks, in the batch');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 1: chunks are planned in the order restore fetches them, file by file, not the manifest\'s objects order', async () => {
  // The opened manifest's objects map comes back ordered by chunk name, which is a keyed hash of the content: with eight
  // one-chunk files, its order matches the files' by chance once in 40,320.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'krestorefetch-order-')));
  try {
    const root = path.join(base, 'kosmos');
    fs.mkdirSync(root, { recursive: true });
    for (let i = 1; i <= 8; i += 1) fs.writeFileSync(path.join(root, `f${i}.md`), `file number ${i}\n`);
    const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
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
    const r0 = await snap.takeSnapshot({ root, memberPk: member.pk, namingKey: nk, namingKeyId: namingKeyId(nk), deviceKey: dev.privateKey,
      ctx: { org: 'o1', member: 'm1', epoch: '1', period: PERIOD, snapshot: SNAP_ID } }, deps);
    assert.equal(r0.ok, true, r0.because);
    const mb = objects.get(manifestKey);
    const record = { key: manifestKey, period: PERIOD, snapshot: SNAP_ID, sha256: crypto.createHash('sha256').update(mb).digest('hex'), size: mb.length, granted_at: GRANTED };
    const s = { member, dev, objects, record };
    const t = { now: NOW }, w = world(objects, [record], t);
    const f = fetcherFor(s, w, t);
    let planned = null;
    const sink = memorySink();
    const r = await restoreWith(s, Object.assign({}, f, { plan: (keys) => { planned = keys.slice(); return f.plan(keys); } }), { sink });
    assert.equal(r.ok, true, r.because);
    assert.equal(sink.committed.size, 8);
    const fetched = w.gets.map((u) => new URL(u).pathname.slice(1)).filter((k) => k !== manifestKey);
    assert.equal(fetched.length, 8);
    assert.deepEqual(planned, fetched, 'planned in exactly the order restore fetched');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 1: a restore that a refusal stopped part way, with nothing restored, is not ok', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const grant = w.grant;
    let chunkGrants = 0;
    // The plan's grant succeeds but its links are dead at the store; the grant asked for again is refused.
    w.grant = async (b) => {
      if (!b.keys.length) return grant(b);
      chunkGrants += 1;
      if (chunkGrants > 1) return { ok: false, because: 'no release' };
      const g = await grant(b);
      for (const [u, v] of w.issued) if (v.key !== s.record.key) w.issued.set(u, Object.assign({}, v, { expiresAtMs: 0 }));
      return g;
    };
    const r = await restoreWith(s, fetcherFor(s, w, t));
    assert.equal(r.ok, false);
    assert.equal(r.because, 'no release');
    assert.equal(r.partial, undefined, 'nothing was restored');
    assert.equal(r.result.restored.length, 0);
    assert.ok(r.result.failed.length > 0, 'review 3: the failed files are still named');
    assert.deepEqual(r.fetchProblems, ['no release']);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: keys are granted in batches of at most 500, the first at plan time, each once, in plan order', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'a'.repeat(64), size: 1 };
  const objects = new Map([[rec.key, Buffer.from('m')]]);
  const keys = Array.from({ length: 1201 }, () => { const k = keyOf(); objects.set(k, Buffer.from(k.slice(-4))); return k; });
  const t = { now: NOW }, w = world(objects, [rec], t);
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  assert.deepEqual(await f.plan(keys.concat(keys.slice(0, 3), [rec.key])), { ok: true, because: undefined, unreadable: [], unreadableBecause: [] }, 'repeats and the manifest are not planned twice');
  assert.deepEqual(w.calls.map((c) => c.keys.length), [500], 'the first batch is granted by the plan');
  for (const k of keys) assert.deepEqual(await f.fetchObject(k, { maxBytes: 10 }), Buffer.from(k.slice(-4)));
  assert.deepEqual(w.calls.map((c) => c.keys.length), [500, 500, 201]);
  assert.deepEqual(w.calls[0].keys, keys.slice(0, 500));
  assert.equal(await f.fetchObject(keyOf(), { maxBytes: 10 }), null, 'a key never planned is not fetched');
  assert.equal(w.calls.length, 3, 'and costs no grant');
});

test('#5536 slice 2 review 1: a clock five minutes off either way still restores (expiry is kept on this clock)', async () => {
  const s = await oneSnapshot();
  try {
    for (const skew of [-280000, 280000, 299000]) {
      const t = { now: NOW }, w = world(s.objects, [s.record], t);
      const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now + skew, org: 'o1', member: 'm1', epoch: 1, manifest: s.record });
      const r = await restoreWith(s, f);
      assert.equal(r.ok, true, `${skew}: ${r.because}`);
      assert.equal(r.result.failed.length, 0, String(skew));
      assert.equal(w.calls.length, 2, String(skew));
    }
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: a URL near its expiry, or one S3 says has expired, is granted again for its batch\'s unfetched keys only', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'b'.repeat(64), size: 1 };
  const objects = new Map([[rec.key, Buffer.from('m')]]);
  const keys = Array.from({ length: 3 }, () => { const k = keyOf(); objects.set(k, Buffer.from('x')); return k; });
  const t = { now: NOW }, w = world(objects, [rec], t);
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  await f.plan(keys);
  assert.ok(await f.fetchObject(keys[0], { maxBytes: 1 }));
  assert.equal(w.calls.length, 1);
  // Literal times, not EXPIRY_MARGIN_MS, so a changed margin cannot move the test with it.
  t.now = NOW + 300000 - 31000;   // 31 s left: still used
  assert.ok(await f.fetchObject(keys[1], { maxBytes: 1 }));
  assert.equal(w.calls.length, 1, 'a URL with time left is not granted again');
  t.now = NOW + 300000 - 29000;   // 29 s left, still valid at the store: granted again before use
  assert.ok(await f.fetchObject(keys[2], { maxBytes: 1 }));
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.calls[1].keys, [keys[2]], 'the batch\'s keys not yet fetched, not the ones already restored');
  // This clock behind the store's: the URL looks fresh here, but S3 answers that it expired. One more grant, then bytes.
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
  await f2.plan(keys);
  assert.ok(await f2.fetchObject(keys[2], { maxBytes: 1 }), 'granted again once after an S3 expiry');
  assert.equal(n, 2);
  // Always expired: two tries, then nothing (never a loop).
  n = 0; expireAfter = Infinity;
  const f3 = rf.readGrantFetcher({ grant: w2.grant, fetch: w2.fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  await f3.plan(keys);
  assert.equal(await f3.fetchObject(keys[0], { maxBytes: 1 }), null);
  assert.equal(n, 2, 'the plan\'s grant, then one more after S3 said expired: never a loop');
  // review 2: expired twice on arrival is the clocks, so the fetcher stops rather than spend a grant on every file.
  assert.equal(f3.planned().because, rf.LINKS_EXPIRED);
  assert.equal(await f3.fetchObject(keys[1], { maxBytes: 1 }), null);
  assert.equal(n, 2, 'nothing more is asked for');
});

test('#5536 slice 2: a refused grant stops the restore with its reason, a 429 with its wait, and is not asked again', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    w.refuse = { ok: false, because: 'Kosmos+ is limiting reads of this backup', retryAfterSecs: 600 };
    const f = fetcherFor(s, w, t);
    const r = await restoreWith(s, f);
    assert.deepEqual(r, { ok: false, because: 'Kosmos+ is limiting reads of this backup (Kosmos+ limits how much of a backup can be fetched in an hour, and a restore cannot yet continue where it stopped)' }, 'no "try again": a retry starts from the beginning');
    assert.equal(w.calls.length, 1);
    assert.equal(await f.fetchObject(s.record.key, { maxBytes: 2 ** 20 }), null);
    assert.equal(w.calls.length, 1, 'a stopped fetcher asks for nothing more');
    // Refused only for the chunks: the manifest opened, and the plan's own grant stops the restore before any file.
    const w2 = world(s.objects, [s.record], t);
    const grant = w2.grant;
    w2.grant = async (b) => (b.keys.length ? { ok: false, because: 'no release' } : grant(b));
    const r2 = await restoreWith(s, fetcherFor(s, w2, t));
    assert.deepEqual(r2, { ok: false, because: 'no release' });
    // A plan that answers not ok stops the restore before any chunk.
    const r3 = await restoreWith(s, Object.assign({}, f, { plan: () => ({ ok: false, because: 'stopped here' }), fetchObject: fetcherFor(s, world(s.objects, [s.record], t), t).fetchObject }));
    assert.deepEqual(r3, { ok: false, because: 'stopped here' });
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 1: a grant that could not be reached is tried again, and only gives up after three', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const grant = w.grant;
    let drops = 2;
    w.grant = async (b) => { if (drops > 0) { drops -= 1; throw new Error('connection reset'); } return grant(b); };
    // The manifest's fetch meets two dropped calls: the first fetch gives up (two tries), the restore says it could
    // not fetch the manifest; a second restore on the same fetcher then gets through, since two is under the limit.
    const f = fetcherFor(s, w, t);
    const r1 = await restoreWith(s, f);
    assert.deepEqual(r1, { ok: false, because: 'restore could not reach Kosmos+ to fetch this backup\'s files' }, 'review 5: named, and not "refused": nothing refused it');
    const r2 = await restoreWith(s, f);
    assert.equal(r2.ok, true, r2.because);
    // Always unreachable: the third miss stops it, with a sentence that says so.
    const w3 = world(s.objects, [s.record], t);
    w3.grant = async () => { throw new Error('offline'); };
    const f3 = fetcherFor(s, w3, t);
    await restoreWith(s, f3);
    const r3 = await restoreWith(s, f3);
    assert.deepEqual(r3, { ok: false, because: 'restore could not reach Kosmos+ to fetch this backup\'s files' });
    for (const bad of [null, undefined, 'yes', { ok: 'true' }]) {
      const w4 = world(s.objects, [s.record], t);
      w4.grant = async () => bad;
      assert.equal(await fetcherFor(s, w4, t).fetchObject(s.record.key, { maxBytes: 2 ** 20 }), null, String(bad));
    }
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: an answer that does not echo the request, or whose links point elsewhere, is refused by name and nothing is fetched', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW };
    const onManifest = (fn) => (a) => (a.objects.length ? a : fn(a));
    const cases = [
      ['another member', (a) => Object.assign(a, { member: 'm2' }), 'Kosmos+ answered for another member or key'],
      ['another epoch', (a) => Object.assign(a, { epoch: 2 }), 'Kosmos+ answered for another member or key'],
      ['another manifest', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { key: keyOf() }) }), 'Kosmos+ answered for another backup'],
      ['another sha256', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { sha256: 'c'.repeat(64) }) }), 'Kosmos+ answered for another backup'],
      ['another size', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { size: a.manifest.size + 1 }) }), 'Kosmos+ answered for another backup'],
      ['an http url', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('https:', 'http:') }) }), rf.BAD_LINK],
      ['an IP address', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('store.test', '10.0.0.5') }) }), rf.BAD_LINK],
      ['an IPv6 address', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('store.test', '[::1]') }) }), rf.BAD_LINK],
      ['localhost', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('store.test', 'localhost') }) }), rf.BAD_LINK],
      ['localhost with a trailing dot', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('store.test', 'localhost.') }) }), rf.BAD_LINK],
      ['a path for another key', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: `https://store.test/${keyOf()}` }) }), rf.BAD_LINK],
      ['a user in the url', (a) => Object.assign(a, { manifest: Object.assign({}, a.manifest, { url: a.manifest.url.replace('https://', 'https://u:p@') }) }), rf.BAD_LINK],
      ['no expiry', (a) => Object.assign(a, { expires_at: '1' }), 'Kosmos+ sent back links with no expiry'],
      ['an object not asked for', (a) => Object.assign(a, { objects: [{ key: keyOf(), url: 'https://store.test/x' }] }), rf.OTHER_FILES],
      ['nothing', () => null, 'Kosmos+ sent back nothing restore can use'],
    ];
    for (const [label, mutate, because] of cases) {
      const w = world(s.objects, [s.record], t);
      w.mutate = onManifest(mutate);
      const r = await restoreWith(s, fetcherFor(s, w, t));
      assert.deepEqual(r, { ok: false, because }, label);
      assert.deepEqual(w.gets, [], `${label}: nothing fetched`);
    }
    // In the chunks' batch (granted by the plan): named twice, one left out, http, another host than the manifest's.
    const chunkCases = [
      ['named twice', (a) => Object.assign(a, { objects: a.objects.slice(0, -1).concat([a.objects[0]]) }), rf.OTHER_FILES],
      ['left out', (a) => Object.assign(a, { objects: a.objects.slice(1) }), rf.OTHER_FILES],
      ['http', (a) => Object.assign(a, { objects: a.objects.map((o) => Object.assign({}, o, { url: o.url.replace('https:', 'http:') })) }), rf.BAD_LINK],
      ['another host', (a) => Object.assign(a, { objects: a.objects.map((o) => Object.assign({}, o, { url: o.url.replace('store.test', 'elsewhere.test') })) }), rf.BAD_LINK],
      ['another key\'s path', (a) => Object.assign(a, { objects: a.objects.map((o, i, all) => Object.assign({}, o, { url: all[(i + 1) % all.length].url })) }), rf.BAD_LINK],
    ];
    for (const [label, mutate, because] of chunkCases) {
      const w = world(s.objects, [s.record], t);
      w.mutate = (a) => (a.objects.length ? mutate(a) : a);
      const r = await restoreWith(s, fetcherFor(s, w, t));
      assert.deepEqual(r, { ok: false, because }, label);
      assert.deepEqual(w.gets.filter((u) => !u.includes(s.record.key)), [], `${label}: no chunk fetched`);
    }
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: a chunk under another key epoch is not asked for, its file fails, the rest restore, and the person is told why', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const f = fetcherFor(s, w, t);
    const plan = f.plan;
    // The opened manifest is made to name one more chunk under epoch 2 of the same period (as after a rotation, #7156).
    const other = keyOf('2');
    let planned = null;
    const sink = memorySink();
    const r = await restoreWith(s, Object.assign({}, f, { plan: (keys) => { planned = keys; return plan(keys.concat([other])); } }), { sink });
    assert.equal(r.ok, true, r.because);
    assert.ok(planned.length > 0);
    assert.ok(!w.calls.some((c) => c.keys.includes(other)), 'never sent: the route would refuse the whole batch');
    assert.deepEqual(r.fetchProblems, [rf.ANOTHER_EPOCH]);
    assert.deepEqual(f.planned().unreadable, [other]);
    const ctx = { org: 'o1', member: 'm1', epoch: '1', period: PERIOD };
    assert.equal(rf.keyProblem(other, ctx), rf.ANOTHER_EPOCH);
    assert.equal(rf.keyProblem(keyOf('1', '2026-W40'), ctx), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem('o1/m1/1/2026-W41/c1', ctx), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem(keyOf('01'), ctx), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem(keyOf('0'), ctx), 'this backup names a file Kosmos+ could not have stored');
    assert.equal(rf.keyProblem(keyOf(), ctx), null);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2: a GET is never redirected, never read past maxBytes, and never hangs', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'd'.repeat(64), size: 4 };
  const objects = new Map([[rec.key, Buffer.from('mmmm')]]);
  const t = { now: NOW }, w = world(objects, [rec], t);
  const make = (fetch, extra = {}) => rf.readGrantFetcher(Object.assign({ grant: w.grant, fetch, now: () => t.now, org: 'o1', member: 'm1', epoch: '1', manifest: rec }, extra));
  assert.deepEqual(await make(w.fetch).fetchObject(rec.key, { maxBytes: 4 }), Buffer.from('mmmm'));
  assert.equal(await make(w.fetch).fetchObject(rec.key, { maxBytes: 3 }), null, 'one byte past maxBytes');
  assert.equal(w.followed, 0);
  // A streamed body with no length is cut off as it arrives.
  const streamed = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); } }), { status: 200 });
  assert.equal(await make(streamed).fetchObject(rec.key, { maxBytes: 4096 }), null, 'an endless body ends at the cap');
  let modes = [];
  const redirected = async (u, init) => { modes.push(init.redirect); return new Response('', { status: 307, headers: { location: 'https://elsewhere.test/' } }); };
  assert.equal(await make(redirected).fetchObject(rec.key, { maxBytes: 4 }), null);
  assert.deepEqual(modes, ['manual'], 'asked not to follow, and a 3xx is not a body');
  const hung = (u, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const started = Date.now();
  assert.equal(await make(hung, { manifestTimeoutMs: 50 }).fetchObject(rec.key, { maxBytes: 4 }), null);
  assert.ok(Date.now() - started < 5000, 'the GET is aborted, not left running');
  assert.equal(await make(async () => { throw new Error('offline'); }).fetchObject(rec.key, { maxBytes: 4 }), null);
  assert.equal(await rf.readGrantFetcher({ fetch: w.fetch, org: 'o1', member: 'm1', epoch: '1', manifest: rec }).fetchObject(rec.key, { maxBytes: 4 }), null, 'no grant');
  modes = null;
});

test('#5536 slice 2 reviews 2 and 3: one fetch makes at most two grants and two GETs with one wait, inside restorerun\'s 2 minutes', async () => {
  // The budget, from the constants the code uses.
  const worst = 2 * (rf.GRANT_TIMEOUT_MS + rf.GET_TIMEOUT_MS) + rf.RETRY_WAIT_MS;
  assert.ok(rf.GRANT_TIMEOUT_MS > 0 && rf.GET_TIMEOUT_MS > 0 && worst < 120000, `worst path ${worst} ms`);
  const worstManifest = 2 * rf.GRANT_TIMEOUT_MS + rf.RETRY_WAIT_MS + rf.MANIFEST_GET_TIMEOUT_MS;
  assert.ok(rf.MANIFEST_GET_TIMEOUT_MS > rf.GET_TIMEOUT_MS && worstManifest <= 110000, `manifest worst path ${worstManifest} ms, at least 10 s inside`);
  assert.ok(worst <= 112000, `chunk worst path ${worst} ms`);
  // And the path itself, counted (review 3: a sum of constants cannot see a third grant or a second wait).
  const rec = { key: keyOf(), period: PERIOD, sha256: 'f'.repeat(64), size: 1 };
  const chunk = keyOf();
  const objects = new Map([[rec.key, Buffer.from('m')], [chunk, Buffer.from('c')]]);
  const shapes = {
    'always expired': () => new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>', { status: 403 }),
    'always 503': () => new Response('', { status: 503 }),
    'always dropped': () => { throw new Error('reset'); },
  };
  for (const [label, answer] of Object.entries(shapes)) {
    const t = { now: NOW }, w = world(objects, [rec], t);
    let grants = 0, gets = 0;
    const waits = [];
    const real = w.grant;
    const f = rf.readGrantFetcher({ grant: async (b) => { grants += 1; return real(b); }, fetch: async () => { gets += 1; return answer(); },
      now: () => t.now, sleep: async (ms) => { waits.push(ms); }, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
    await f.plan([chunk]);
    grants = 0;
    assert.equal(await f.fetchObject(chunk, { maxBytes: 1 }), null, label);
    assert.ok(grants <= 2 && gets <= 2 && waits.length <= 1, `${label}: ${grants} grants, ${gets} GETs, ${waits.length} waits`);
    assert.equal(gets, 2, `${label}: tried twice`);
    // The manifest: one GET only, whatever it answers (its own, longer, timeout).
    gets = 0; grants = 0; waits.length = 0;
    assert.equal(await f.fetchObject(rec.key, { maxBytes: 1 }), null, `${label}: manifest`);
    assert.ok(grants <= 2 && waits.length <= 1, `${label}: manifest ${grants} grants, ${waits.length} waits`);
    assert.equal(gets, 1, `${label}: the manifest is fetched once`);
  }
  const t = { now: NOW }, w = world(objects, [rec], t);
  let grants = 0;
  const waits = [];
  const f = rf.readGrantFetcher({ grant: async () => { grants += 1; throw new Error('offline'); }, fetch: w.fetch, now: () => t.now,
    sleep: async (ms) => { waits.push(ms); }, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  assert.equal(await f.fetchObject(rec.key, { maxBytes: 1 }), null);
  assert.deepEqual([grants, waits.length], [2, 1], 'two grants, one wait');
});

test('#5536 slice 2 review 3: a GET the store did not answer is tried once more, and a file lost that way says why', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const realFetch = w.fetch;
    let n = 0;
    // GET 1 is the manifest; GET 2 (a chunk's first try) is a 503 and GET 3 its second; GET 4 (the next chunk) is dropped.
    w.fetch = async (u, init) => { n += 1; if (n === 2) return new Response('', { status: 503 }); if (n === 4) throw new Error('reset'); return realFetch(u, init); };
    const sink = memorySink();
    const r = await restoreWith(s, fetcherFor(s, w, t), { sink });
    assert.equal(r.ok, true, r.because);
    assert.equal(r.result.failed.length, 0, 'a 503 on one chunk and a reset on the next: each second try got through');
    assert.ok(n >= 5);
    // A chunk that never answers: its file fails, the rest restore, and the reason reaches the person.
    const w2 = world(s.objects, [s.record], t);
    const rf2 = w2.fetch;
    let first = null;
    w2.fetch = async (u, init) => { if (!u.includes(s.record.key) && (first === null || first === u.split('?')[0])) { first = u.split('?')[0]; return new Response('', { status: 503 }); } return rf2(u, init); };
    const r2 = await restoreWith(s, fetcherFor(s, w2, t));
    assert.equal(r2.ok, true, r2.because);
    assert.equal(r2.result.failed.length, 1);
    assert.deepEqual(r2.fetchProblems, ['the storage service did not answer for some files']);
    // A 404 is not tried again.
    const w3 = world(s.objects, [s.record], t);
    const rf3 = w3.fetch;
    let gets404 = 0;
    w3.fetch = async (u, init) => { if (!u.includes(s.record.key)) { gets404 += 1; return new Response('', { status: 404 }); } return rf3(u, init); };
    const f3 = fetcherFor(s, w3, t);
    const r3 = await restoreWith(s, f3);
    assert.equal(r3.ok, false, 'review 4: nothing restored is no success');
    assert.equal(r3.because, 'the storage service does not have some files', 'review 6: the store\'s own reason');
    assert.equal(gets404, r3.result.failed.length, 'one GET per failed file: a 404 does not change');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 3: a chunk a later file reuses is asked for with the next keys still to fetch, never alone', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'a'.repeat(64), size: 1 };
  const objects = new Map([[rec.key, Buffer.from('m')]]);
  const keys = Array.from({ length: 1000 }, () => { const k = keyOf(); objects.set(k, Buffer.from('x')); return k; });
  const t = { now: NOW }, w = world(objects, [rec], t);
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now, sleep: noWait, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  await f.plan(keys);
  for (const k of keys.slice(0, 10)) assert.ok(await f.fetchObject(k, { maxBytes: 1 }));
  t.now += 400000;   // every link has lapsed
  assert.ok(await f.fetchObject(keys[3], { maxBytes: 1 }), 'a reused chunk');
  const last = w.calls[w.calls.length - 1];
  assert.equal(last.keys.length, 500, 'topped up to a full call');
  assert.equal(last.keys[0], keys[3]);
  assert.deepEqual(last.keys.slice(1), keys.slice(10, 509), 'with the next keys still to fetch, in plan order');
  const before = w.calls.length;
  for (const k of keys.slice(10, 509)) assert.ok(await f.fetchObject(k, { maxBytes: 1 }));
  assert.equal(w.calls.length, before, 'and those then cost nothing more');
});

test('#5536 slice 2 review 2: a grant that never answers is cut off, read as not reached, and the restore does not hang', { timeout: 15000 }, async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    let calls = 0;
    w.grant = () => { calls += 1; return new Promise(() => {}); };
    const f = fetcherFor(s, w, t, { grantTimeoutMs: 20 });
    const started = Date.now();
    const r = await restoreWith(s, f);
    assert.deepEqual(r, { ok: false, because: 'restore could not reach Kosmos+ to fetch this backup\'s files' });
    assert.equal(calls, 2, 'tried twice, each cut off');
    assert.ok(Date.now() - started < 5000);
    // The plan's own grant hanging (the manifest came through): cut off too, and a plan that itself never answers is
    // cut off by runRestore under its fetch deadline.
    const w2 = world(s.objects, [s.record], t);
    const real = w2.grant;
    w2.grant = (b) => (b.keys.length ? new Promise(() => {}) : real(b));
    const r2 = await restoreWith(s, fetcherFor(s, w2, t, { grantTimeoutMs: 20 }));
    // Not a refusal: the plan's miss and the first file's two tries are three in a row, and only then does it stop.
    assert.equal(r2.ok, false);
    assert.equal(r2.because, 'restore could not reach Kosmos+ to fetch this backup\'s files');
    assert.equal(r2.result.restored.length, 0);
    const f3 = fetcherFor(s, world(s.objects, [s.record], t), t);
    const r3 = await restoreWith(s, Object.assign({}, f3, { plan: () => new Promise(() => {}) }), { fetchTimeoutMs: 30 });
    assert.deepEqual(r3, { ok: false, because: 'the backup\'s files could not be fetched' });
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 2: misses spread between answered grants never add up to a stop', async () => {
  const rec = { key: keyOf(), period: PERIOD, sha256: 'e'.repeat(64), size: 1 };
  const objects = new Map([[rec.key, Buffer.from('m')]]);
  const keys = Array.from({ length: 2000 }, () => { const k = keyOf(); objects.set(k, Buffer.from('x')); return k; });
  const t = { now: NOW }, w = world(objects, [rec], t);
  const real = w.grant;
  let n = 0;
  w.grant = async (b) => { n += 1; if (n % 2 === 1) throw new Error('blip'); return real(b); };
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => t.now, sleep: noWait, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  await f.plan(keys);
  for (const k of keys) assert.ok(await f.fetchObject(k, { maxBytes: 1 }), k);
  assert.equal(f.planned().ok, true);
  assert.ok(n >= 7, `${n} grant calls, half of them dropped`);
  // The wait before a second try is real by default (RETRY_WAIT_MS), and injected here only to keep the test fast.
  let waited = [];
  const w2 = world(objects, [rec], t);
  let m = 0;
  const real2 = w2.grant;
  w2.grant = async (b) => { m += 1; if (m === 1) throw new Error('blip'); return real2(b); };
  const f2 = rf.readGrantFetcher({ grant: w2.grant, fetch: w2.fetch, now: () => t.now, sleep: async (ms) => { waited.push(ms); }, org: 'o1', member: 'm1', epoch: '1', manifest: rec });
  assert.ok(await f2.fetchObject(rec.key, { maxBytes: 1 }));
  assert.deepEqual(waited, [rf.RETRY_WAIT_MS]);
  waited = null;
});

test('#5536 slice 2 review 2: a restore stopped part way is not ok, says it is partial, and hands back what was restored', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const realFetch = w.fetch, grant = w.grant;
    let chunkGets = 0, chunkGrants = 0;
    // The first chunk GET succeeds; then every link is dead at the store, and the grant asked for again is refused.
    w.fetch = async (u, init) => {
      if (!u.includes(s.record.key)) {
        chunkGets += 1;
        if (chunkGets === 2) for (const [k, v] of w.issued) w.issued.set(k, Object.assign({}, v, { expiresAtMs: 0 }));
      }
      return realFetch(u, init);
    };
    w.grant = async (b) => { if (b.keys.length && ++chunkGrants > 1) return { ok: false, because: 'no release' }; return grant(b); };
    const sink = memorySink();
    const r = await restoreWith(s, fetcherFor(s, w, t), { sink });
    assert.equal(r.ok, false);
    assert.equal(r.partial, true);
    assert.equal(r.because, 'no release');
    assert.ok(r.result.restored.length > 0 && r.result.restored.length < Object.keys(s.files).length, JSON.stringify(r.result.restored));
    for (const p of r.result.restored) assert.ok(sink.committed.get(p).equals(s.files[p]), p);
    assert.deepEqual(r.fetchProblems, ['no release']);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 4: a manifest the store is slow with names the store, and a file lost to Kosmos+ out of reach names that', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    w.fetch = async () => new Response('', { status: 503 });
    const r = await restoreWith(s, fetcherFor(s, w, t));
    assert.deepEqual(r, { ok: false, because: 'the storage service did not answer with this backup\'s manifest' });
    // Both grant tries for one file miss, then the next file's grant answers (resetting the count): the lost file says why.
    const w2 = world(s.objects, [s.record], t);
    const real = w2.grant;
    let chunkCalls = 0;
    w2.grant = async (b) => {
      if (!b.keys.length) return real(b);
      chunkCalls += 1;
      if (chunkCalls === 1) { const g = await real(b); for (const [u, v] of w2.issued) if (v.key !== s.record.key) w2.issued.set(u, Object.assign({}, v, { expiresAtMs: 0 })); return g; }
      if (chunkCalls <= 3) throw new Error('blip');
      return real(b);
    };
    const r2 = await restoreWith(s, fetcherFor(s, w2, t));
    assert.ok(r2.result.failed.length >= 1, JSON.stringify(r2));
    assert.ok(r2.fetchProblems.includes('restore could not reach Kosmos+ for some files'), JSON.stringify(r2.fetchProblems));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 4: every chunk under another key: nothing restored, so not ok, and the reason is the epoch', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const f = fetcherFor(s, w, t);
    // The plan is told every key, but as if each sat under epoch 2.
    const r = await restoreWith(s, Object.assign({}, f, { plan: (keys) => f.plan(keys.map((k) => k.replace('/1/', '/2/'))) }));
    assert.equal(r.ok, false);
    assert.equal(r.because, rf.ANOTHER_EPOCH);
    assert.equal(r.result.restored.length, 0);
    assert.ok(r.result.failed.length > 0);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 5: a manifest link expired on arrival names the clocks, and an epoch past 2^53 is refused by name', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW }, w = world(s.objects, [s.record], t);
    const real = w.grant;
    w.grant = async (b) => { const g = await real(b); for (const [u, v] of w.issued) w.issued.set(u, Object.assign({}, v, { expiresAtMs: 0 })); return g; };
    const r = await restoreWith(s, fetcherFor(s, w, t));
    assert.deepEqual(r, { ok: false, because: rf.LINKS_EXPIRED });
    const w2 = world(s.objects, [s.record], t);
    const f2 = fetcherFor(s, w2, t, { epoch: '90071992547409930' });
    assert.equal(await f2.fetchObject(s.record.key, { maxBytes: 2 ** 20 }), null);
    assert.equal(f2.planned().because, 'this backup\'s key epoch is larger than restore can ask Kosmos+ for');
    assert.equal(w2.calls.length, 0, 'nothing asked for');
    const f3 = fetcherFor(s, w2, t, { epoch: 'abc' });
    assert.equal(await f3.fetchObject(s.record.key, { maxBytes: 2 ** 20 }), null);
    assert.equal(f3.planned().because, 'restore was asked for this backup without a valid key epoch', 'review 6: its own sentence');
    assert.equal(w2.calls.length, 0);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('#5536 slice 2 review 5: with nothing restored, a fetch reason heads the result only when every file failed on a fetch', async () => {
  const s = await oneSnapshot();
  try {
    const t = { now: NOW };
    // Every chunk arrives but is not the one sealed (swapped bytes): files fail on their own reason, not the fetch's.
    const w = world(s.objects, [s.record], t);
    const realFetch = w.fetch;
    w.fetch = async (u, init) => (u.includes(s.record.key) ? realFetch(u, init) : new Response(crypto.randomBytes(64), { status: 200 }));
    const f = fetcherFor(s, w, t);
    const plan = f.plan;
    const r = await restoreWith(s, Object.assign({}, f, { plan: async (keys) => { const p = await plan(keys); f.planned = () => Object.assign({}, p, { unreadableBecause: [rf.ANOTHER_EPOCH] }); return p; } , planned: () => f.planned() }));
    assert.equal(r.ok, false);
    assert.equal(r.because, 'no file of this backup could be restored', JSON.stringify(r.result.failed));
    assert.ok(r.result.failed.every((x) => x.why !== 'a chunk is missing'));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
