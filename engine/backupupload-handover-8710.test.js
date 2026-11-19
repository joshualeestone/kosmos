'use strict';
/* kosmos#8710 slice 3: engine/backupupload.js under opts.handover. A hand-over pack goes through kosmos-relay's
 * /v1/mac/org/handover/grant and /manifest (coordinator/src/handover.rs, slice 2): unlocked, write-once grants that sign
 * four headers (content-length, the digest, host, if-none-match), keys `handover/<org>/<id>/<random>` and
 * `handover/<org>/<id>/manifest`, no key epoch, no period. A local HTTP server stands in for the bucket and a stub for
 * the coordinator, in that shape. Every refusal arm is paired with the backup path, so the switch cannot become a way
 * around a backup check. Nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const up = require('./backupupload');
up.allowHttpForTests(true);   // the local bucket is plain http; only this setter allows that

const md5 = (b) => crypto.createHash('md5').update(b).digest('base64');
const sha256b = (b) => crypto.createHash('sha256').update(b).digest('base64');
const chunk = (n) => ({ name: crypto.createHash('sha256').update(`h${n}`).digest('hex'), object: crypto.randomBytes(up.MIN_OBJECT + n) });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const amzDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const FOUR = 'content-length;content-md5;host;if-none-match';
const FOUR_SHA = 'content-length;host;if-none-match;x-amz-checksum-sha256';
const SIX = 'content-length;content-md5;host;if-none-match;x-amz-object-lock-mode;x-amz-object-lock-retain-until-date';
const HO = { id: 'ho1', prefix: 'handover/org1/ho1/' };

async function bucket() {
  const stored = new Map();
  const script = new Map();
  let puts = 0;
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
      puts++;
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/bucket\//, '');
      const body = Buffer.concat(parts);
      const next = script.has(key) && script.get(key).shift();   // scripted answers first (kosmos#8710 re-grant arm)
      if (next) { res.statusCode = next[0]; return res.end(next[1] || ''); }
      const sha = req.headers['x-amz-checksum-sha256'];
      if (sha !== undefined ? sha !== sha256b(body) : req.headers['content-md5'] !== md5(body)) { res.statusCode = 400; return res.end('<Error><Code>BadDigest</Code></Error>'); }
      if (req.headers['if-none-match'] === '*' && stored.has(key)) { res.statusCode = 412; return res.end(''); }
      stored.set(key, { body, headers: req.headers }); res.statusCode = 200; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { stored, script, base, get puts() { return puts; }, close: () => new Promise((r) => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}

/* The coordinator's hand-over routes. `tamper(data, route)` edits an answer; `prefix` overrides the key prefix. */
function coordinator(b, opts) {
  const o = opts || {};
  const calls = [];
  let n = 0;
  const urlOf = (key, signedAt, signed) => `${b.base}/bucket/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDTEST%2F20261119%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=${amzDate(signedAt)}&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(signed)}&X-Amz-Signature=00`;
  const macRequest = async (method, route, body) => {
    calls.push({ route, body });
    assert.strictEqual(method, 'POST');
    const expMs = Date.now() + 15 * 60 * 1000;
    const signedAt = Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000;
    const prefix = o.prefix || HO.prefix;
    let data;
    if (route === up.HANDOVER_GRANT_ROUTE) {
      const uploads = body.chunks.map((c) => {
        const key = `${prefix}k${++n}`;
        return { key, url: urlOf(key, signedAt, FOUR), headers: { 'content-md5': c.md5, 'if-none-match': '*' } };
      });
      data = { uploads, expires_at: iso(expMs) };
    } else if (route === up.HANDOVER_MANIFEST_ROUTE) {
      const key = `${prefix}manifest`;
      data = { upload: { key, url: urlOf(key, signedAt, FOUR_SHA), headers: { 'x-amz-checksum-sha256': body.sha256, 'if-none-match': '*' } }, expires_at: iso(expMs) };
    } else {
      return { ok: false, because: `refused: not a hand-over route (HTTP 404 on ${route})` };
    }
    if (o.tamper) o.tamper(data, route);
    return { ok: true, data };
  };
  return { macRequest, calls };
}
const deps = (c) => ({ macRequest: c.macRequest, fetch, sleep: async () => {} });
/* For arms that must refuse before asking: any call is recorded and refused at once, so a check that is missing turns
   the arm red quickly (a stub that granted would send the uploader retrying a dead bucket for the grant's 15 minutes). */
function refuser() {
  const calls = [];
  return { calls, macRequest: async (method, route, body) => { calls.push({ route, body }); return { ok: false, because: `refused: this arm asks nothing (HTTP 403 on ${route})` }; } };
}
const lockAll = (data) => {
  for (const u of data.uploads || [data.upload]) {
    u.headers['x-amz-object-lock-mode'] = 'COMPLIANCE';
    u.headers['x-amz-object-lock-retain-until-date'] = iso(Date.now() + 33 * 86400 * 1000);
    u.url = u.url.replace(encodeURIComponent(FOUR), encodeURIComponent(SIX));
  }
};

test('a hand-over pack uploads through the hand-over routes, unlocked, under its own prefix (kosmos#8710)', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b);
    const objs = [chunk(1), chunk(2), chunk(3)];
    const r = await up.uploadChunks(deps(c), objs, { handover: HO });
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.size, 3);
    for (const k of r.keys.values()) assert.ok(k.startsWith(HO.prefix), k);
    for (const v of r.lockedUntil.values()) assert.strictEqual(v, null);
    for (const s of b.stored.values()) assert.strictEqual(s.headers['x-amz-object-lock-mode'], undefined);
    const g = c.calls[0];
    assert.strictEqual(g.route, up.HANDOVER_GRANT_ROUTE);
    assert.strictEqual(g.body.id, 'ho1');
    assert.deepStrictEqual(g.body.chunks.map((x) => x.size), objs.map((x) => x.object.length));
    assert.match(g.body.nonce, /^[0-9a-f]{32}$/);   // a retry after a lost answer is a new body, not a replay

    const manifest = crypto.randomBytes(up.MIN_OBJECT + 7);
    const chunks = [...r.keys.values()].map((key) => ({ key, lockedUntilMs: null }));
    const m = await up.uploadManifest(deps(c), manifest, { handover: HO, bucket: r.bucket, chunks, snapshot: '20261119T000000Z-00000000' });
    assert.strictEqual(m.ok, true, m.because);
    assert.strictEqual(m.key, `${HO.prefix}manifest`);
    assert.strictEqual(m.lockedUntilMs, null);
    const mb = c.calls[c.calls.length - 1];
    assert.strictEqual(mb.route, up.HANDOVER_MANIFEST_ROUTE);
    assert.deepStrictEqual(Object.keys(mb.body).sort(), ['id', 'nonce', 'sha256', 'size']);   // no snapshot id for a hand-over
    assert.strictEqual(mb.body.sha256, sha256b(manifest));   // standard base64, as the route requires
    assert.strictEqual(mb.body.sha256.length, 44);
    assert.ok(b.stored.get(`${HO.prefix}manifest`).body.equals(manifest));
  } finally { await b.close(); }
});

test('a hand-over grant that sets a lock is refused before any byte is sent, and the backup path still requires one', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b, { tamper: (d) => lockAll(d) });
    const r = await up.uploadChunks(deps(c), [chunk(1)], { handover: HO });
    assert.strictEqual(r.ok, false);
    assert.match(r.because, /signs headers outside the four|asks to send a header it may not/);
    assert.strictEqual(b.puts, 0);
    // Only the lock headers listed, not signed: still refused (a header the grant may not ask for).
    const c2 = coordinator(b, { tamper: (d) => { d.uploads[0].headers['x-amz-object-lock-mode'] = 'GOVERNANCE'; } });
    const r2 = await up.uploadChunks(deps(c2), [chunk(2)], { handover: HO });
    assert.strictEqual(r2.ok, false);
    assert.match(r2.because, /asks to send a header it may not \(x-amz-object-lock-mode\)/);
    assert.strictEqual(b.puts, 0);
    // The control: the same unlocked grant, answered on the backup route, is refused by the backup checks.
    const backup = { macRequest: async (m, route, body) => { const x = await c2.macRequest(m, up.HANDOVER_GRANT_ROUTE, body); delete x.data.uploads[0].headers['x-amz-object-lock-mode']; return x; } };
    const r3 = await up.uploadChunks(Object.assign(deps(c2), backup), [chunk(3)], {});
    assert.strictEqual(r3.ok, false);
    assert.match(r3.because, /does not sign x-amz-object-lock-mode/);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a hand-over key outside its own prefix is refused, for a chunk and for the manifest', async () => {
  const b = await bucket();
  try {
    for (const prefix of ['handover/org1/ho2/', 'handover/org2/ho1/', 'org1/acct1/1/2026-W47/']) {
      const c = coordinator(b, { prefix });
      const r = await up.uploadChunks(deps(c), [chunk(1)], { handover: HO });
      assert.strictEqual(r.ok, false, prefix);
      assert.match(r.because, /is not under this hand-over \(handover\/org1\/ho1\/\)/);
    }
    // A key that nests a further folder under the prefix is not one plain segment.
    const nest = coordinator(b, { tamper: (d) => { for (const u of d.uploads) { u.key = `${HO.prefix}x/${u.key.slice(HO.prefix.length)}`; u.url = u.url.replace(encodeURIComponent('ho1') + '/', `${encodeURIComponent('ho1')}/x/`); } } });
    const rn = await up.uploadChunks(deps(nest), [chunk(4)], { handover: HO });
    assert.strictEqual(rn.ok, false);
    assert.match(rn.because, /is not under this hand-over/);
    const good = coordinator(b);
    const ok = await up.uploadChunks(deps(good), [chunk(5)], { handover: HO });
    assert.strictEqual(ok.ok, true, ok.because);
    const bad = coordinator(b, { prefix: 'handover/org1/ho2/' });
    const m = await up.uploadManifest(deps(bad), crypto.randomBytes(up.MIN_OBJECT), { handover: HO, bucket: ok.bucket, chunks: [...ok.keys.values()].map((key) => ({ key, lockedUntilMs: null })) });
    assert.strictEqual(m.ok, false);
    assert.match(m.because, /the manifest upload: the key .* is not under this hand-over/);
    assert.strictEqual(m.grantSpent, true);
    assert.strictEqual(b.puts, 1);   // only the good chunk
  } finally { await b.close(); }
});

test('hand-over options are checked before anything is asked', async () => {
  const c = refuser();
  const cases = [
    [{ handover: { id: 'ho1', prefix: 'handover/org1/ho2/' } }, /is not \{ id, prefix \}/],
    [{ handover: { id: 'ho1', prefix: 'handover/org1/ho1' } }, /is not \{ id, prefix \}/],
    [{ handover: { id: 'ho1', prefix: 'backup/org1/ho1/' } }, /is not \{ id, prefix \}/],
    [{ handover: { id: '..', prefix: 'handover/org1/../' } }, /is not \{ id, prefix \}/],
    [{ handover: null }, /is not \{ id, prefix \}/],
    [{ handover: HO, epoch: 1 }, /has no key epoch/],
  ];
  for (const [opts, re] of cases) {
    const r = await up.uploadChunks(deps(c), [chunk(1)], opts);
    assert.strictEqual(r.ok, false, JSON.stringify(opts));
    assert.match(r.because, re);
    assert.strictEqual(r.grantSpent, false);
    const m = await up.uploadManifest(deps(c), crypto.randomBytes(up.MIN_OBJECT), Object.assign({ bucket: '127.0.0.1:9/bucket/', chunks: [{ key: `${HO.prefix}k1`, lockedUntilMs: null }] }, opts));
    assert.strictEqual(m.ok, false, JSON.stringify(opts));
    assert.match(m.because, re);
    assert.strictEqual(m.grantSpent, false);
  }
  assert.strictEqual(c.calls.length, 0);
});

test("a hand-over manifest refuses a locked chunk or one outside the prefix, and the backup path still wants a lock end", async () => {
  const c = refuser();
  const o = (chunks, extra) => Object.assign({ handover: HO, bucket: '127.0.0.1:9/bucket/', chunks }, extra || {});
  const m1 = await up.uploadManifest(deps(c), crypto.randomBytes(up.MIN_OBJECT), o([{ key: `${HO.prefix}k1`, lockedUntilMs: Date.now() + 33 * 86400 * 1000 }]));
  assert.strictEqual(m1.ok, false);
  assert.match(m1.because, /has a lock end, which no hand-over chunk has/);
  const m2 = await up.uploadManifest(deps(c), crypto.randomBytes(up.MIN_OBJECT), o([{ key: 'handover/org1/ho9/k1', lockedUntilMs: null }]));
  assert.strictEqual(m2.ok, false);
  assert.match(m2.because, /the manifest's chunk: the key .* is not under this hand-over/);
  // The control: without opts.handover, a chunk with no lock end is refused as before.
  const m3 = await up.uploadManifest(deps(c), crypto.randomBytes(up.MIN_OBJECT), { bucket: '127.0.0.1:9/bucket/', chunks: [{ key: `${HO.prefix}k1`, lockedUntilMs: null }] });
  assert.strictEqual(m3.ok, false);
  assert.match(m3.because, /no lock end for the manifest's chunk/);
  assert.strictEqual(c.calls.length, 0);
});

test('a hand-over manifest whose grant ran out cleanly is re-granted under the same key and stored; a re-grant naming a chunk key is still refused', async () => {
  let b = await bucket();
  try {
    const c = coordinator(b);
    const chunks = await up.uploadChunks(deps(c), [chunk(1)], { handover: HO });
    assert.strictEqual(chunks.ok, true, chunks.because);
    const list = [...chunks.keys.values()].map((key) => ({ key, lockedUntilMs: null }));
    b.script.set(`${HO.prefix}manifest`, [[400, '<Error><Code>RequestTimeout</Code></Error>'], [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const m = await up.uploadManifest(deps(c), crypto.randomBytes(up.MIN_OBJECT + 7), { chunks: list, handover: HO, bucket: chunks.bucket });
    assert.strictEqual(m.ok, true, m.because);
    assert.strictEqual(c.calls.filter((x) => x.route === up.HANDOVER_MANIFEST_ROUTE).length, 2, 'granted again');
    assert.ok(b.stored.has(`${HO.prefix}manifest`));
  } finally { await b.close(); }
  b = await bucket();
  try {
    let n = 0;
    const c = coordinator(b, { tamper: (d, route) => { if (route === up.HANDOVER_MANIFEST_ROUTE && ++n === 2) { d.upload.key = `${HO.prefix}k1`; d.upload.url = d.upload.url.replace('manifest', 'k1'); } } });
    const chunks = await up.uploadChunks(deps(c), [chunk(1)], { handover: HO });
    const list = [...chunks.keys.values()].map((key) => ({ key, lockedUntilMs: null }));
    b.script.set(`${HO.prefix}manifest`, [[400, '<Error><Code>RequestTimeout</Code></Error>'], [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const m = await up.uploadManifest(deps(c), crypto.randomBytes(up.MIN_OBJECT + 7), { chunks: list, handover: HO, bucket: chunks.bucket });
    assert.strictEqual(m.ok, false);
    assert.match(m.because, /must not write/);
  } finally { await b.close(); }
});
