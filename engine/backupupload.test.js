'use strict';
/* #5535 E0.6: engine/backupupload.js. A local HTTP server stands in for the bucket (write-once, MD5-checked, as
 * measured on #5535) and a stub macRequest stands in for the coordinator's grant route. Nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const up = require('./backupupload');

const md5 = (b) => crypto.createHash('md5').update(b).digest('base64');
const chunk = (n, size) => ({ name: crypto.createHash('sha256').update(`c${n}`).digest('hex'), object: crypto.randomBytes(size || up.MIN_OBJECT + n) });

/* A bucket: PUT /<key> stores once (412 after), checks Content-MD5 against the body (400 BadDigest), and can be told
   to answer a status for the next n PUTs of a key. Counts every PUT. */
async function bucket() {
  const stored = new Map();
  const script = new Map();   // key -> [status, ...] answered before the real behaviour
  let puts = 0;
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
      puts++;
      const key = decodeURIComponent(req.url.slice(1));
      const q = script.get(key);
      if (q && q.length) { res.statusCode = q.shift(); return res.end(); }
      const body = Buffer.concat(parts);
      if (req.headers['content-md5'] !== md5(body)) { res.statusCode = 400; return res.end('BadDigest'); }
      if (req.headers['if-none-match'] === '*' && stored.has(key)) { res.statusCode = 412; return res.end(); }
      stored.set(key, body); res.statusCode = 200; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { stored, script, base, get puts() { return puts; }, close: () => new Promise((r) => srv.close(r)) };
}

/* A coordinator stub: answers each grant with one upload per chunk, binding the asked-for MD5 and size. Records
   every body. `refuse` (a list of refusal texts) is answered first, one per call. `tamper(uploads)` edits an answer. */
function coordinator(b, opts) {
  const o = opts || {};
  const bodies = [];
  let n = 0;
  const macRequest = async (method, route, body) => {
    bodies.push(body);
    assert.strictEqual(method, 'POST'); assert.strictEqual(route, up.GRANT_ROUTE);
    if (o.refuse && o.refuse.length) return { ok: false, because: o.refuse.shift() };
    const uploads = body.chunks.map((c) => {
      const key = `m1/${++n}`;
      return { key, url: `${b.base}/${encodeURIComponent(key)}`, headers: { 'Content-MD5': c.md5, 'Content-Length': String(c.size), 'If-None-Match': '*' } };
    });
    const data = { epoch: 1, period: '2026-W41', retain_until: 1, expires_at: o.expiresAt || Math.floor(Date.now() / 1000) + 900, uploads };
    if (o.tamper) o.tamper(data);
    return { ok: true, data };
  };
  return { macRequest, bodies };
}
const deps = (c, extra) => Object.assign({ macRequest: c.macRequest, fetch, sleep: async () => {} }, extra || {});
const opts = { allowHttp: true };

test('refusalOf reads the status and code from the tunnel text, and nothing from other text', () => {
  assert.deepStrictEqual(up.refusalOf('refused: over the allowance (HTTP 429 on /v1/org/backup/grant, code backup_quota)'), { status: 429, code: 'backup_quota' });
  assert.deepStrictEqual(up.refusalOf('refused: x (HTTP 404 on /v1/org/backup/grant)'), { status: 404, code: null });
  assert.deepStrictEqual(up.refusalOf('the tunnel program answered in a shape we could not read'), { status: null, code: null });
  assert.deepStrictEqual(up.refusalOf(undefined), { status: null, code: null });
});

test('every chunk is stored once under its granted key, and the name -> key map comes back', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2), chunk(3)];
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), cs, opts);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.size, 3);
    for (const x of cs) assert.ok(b.stored.get(r.keys.get(x.name)).equals(x.object));
    assert.strictEqual(b.puts, 3);
    // The request asked for exactly these sizes and MD5s, with a nonce.
    assert.deepStrictEqual(c.bodies[0].chunks, cs.map((x) => ({ size: x.object.length, md5: md5(x.object) })));
    assert.match(c.bodies[0].nonce, /^[0-9a-f]{32}$/);
  } finally { await b.close(); }
});

test('a grant that does not bind OUR bytes is refused before anything is sent', async () => {
  for (const [what, tamper] of [
    ['another MD5', (d) => { d.uploads[1].headers['Content-MD5'] = md5(Buffer.from('other')); }],
    ['another length', (d) => { d.uploads[0].headers['Content-Length'] = String(Number(d.uploads[0].headers['Content-Length']) + 7); }],
    ['not write-once', (d) => { delete d.uploads[2].headers['If-None-Match']; }],
    ['one upload short', (d) => { d.uploads.pop(); }],
    ['a repeated key', (d) => { d.uploads[1].key = d.uploads[0].key; }],
    ['no expiry', (d) => { delete d.expires_at; }],
  ]) {
    const b = await bucket();
    try {
      const r = await up.uploadChunks(deps(coordinator(b, { tamper })), [chunk(1), chunk(2), chunk(3)], opts);
      assert.strictEqual(r.ok, false, what);
      assert.strictEqual(b.puts, 0, `${what}: a PUT was sent`);
    } finally { await b.close(); }
  }
});

test('an http (not https) upload url is refused unless the test seam allows it', () => {
  const c = chunk(1);
  const data = { expires_at: 2e9, uploads: [{ key: 'k', url: 'http://bucket.example/k', headers: { 'content-md5': md5(c.object), 'content-length': String(c.object.length), 'if-none-match': '*' } }] };
  assert.strictEqual(up.parseGrant(data, [c]).ok, false);
  assert.strictEqual(up.parseGrant(data, [c], { allowHttp: true }).ok, true);
  data.uploads[0].url = 'https://bucket.example/k';
  assert.strictEqual(up.parseGrant(data, [c]).ok, true, 'header names are matched case-insensitively');
});

test('412 (an earlier attempt already wrote it) counts as stored; a transient 503 is retried', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2)];
    const c = coordinator(b);
    b.script.set('m1/1', [412]);
    b.script.set('m1/2', [503, 503]);
    const r = await up.uploadChunks(deps(c), cs, opts);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.get(cs[0].name), 'm1/1');
    assert.ok(b.stored.get('m1/2').equals(cs[1].object));
    assert.strictEqual(c.bodies.length, 1, 'no new grant was needed');
  } finally { await b.close(); }
});

test('403 (the grant ran out) gets a NEW grant for only the chunks not yet stored', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2), chunk(3)];
    const c = coordinator(b);
    b.script.set('m1/2', [403]);
    const r = await up.uploadChunks(deps(c), cs, opts);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(c.bodies.length, 2);
    assert.deepStrictEqual(c.bodies[1].chunks, [{ size: cs[1].object.length, md5: md5(cs[1].object) }]);
    assert.notStrictEqual(c.bodies[0].nonce, c.bodies[1].nonce);
    assert.strictEqual(r.keys.get(cs[1].name), 'm1/4');
  } finally { await b.close(); }
});

test('a grant already past its expiry is not used: the chunks get a new grant', async () => {
  const b = await bucket();
  try {
    let calls = 0;
    const c = coordinator(b);
    const inner = c.macRequest;
    c.macRequest = async (...a) => { const r = await inner(...a); if (calls++ === 0) r.data.expires_at = 1; return r; };
    const r = await up.uploadChunks(deps(c), [chunk(1)], opts);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(calls, 2);
    assert.strictEqual(b.puts, 1, 'nothing was sent on the expired grant');
  } finally { await b.close(); }
});

test('re-granting is bounded: a chunk that never stores ends the run, it does not spend allowance forever', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b);
    b.script.get = () => [403];   // every PUT, under every grant, answers 403
    const r = await up.uploadChunks(deps(c), [chunk(1)], opts);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(c.bodies.length, up.MAX_REGRANTS + 1);
  } finally { await b.close(); }
});

test('refusals: quota ends with retryLater, replayed is retried once with a new nonce, the rest stop', async () => {
  const b = await bucket();
  try {
    let c = coordinator(b, { refuse: ['refused: over the allowance (HTTP 429 on /v1/org/backup/grant, code backup_quota)'] });
    let r = await up.uploadChunks(deps(c), [chunk(1)], opts);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true); assert.strictEqual(r.code, 'backup_quota');

    c = coordinator(b, { refuse: ['refused: seen (HTTP 401 on /v1/org/backup/grant, code replayed)'] });
    r = await up.uploadChunks(deps(c), [chunk(1)], opts);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(c.bodies.length, 2);
    assert.notStrictEqual(c.bodies[0].nonce, c.bodies[1].nonce);

    for (const code of ['backup_off', 'backup_not_member', 'own_lineage', 'backup_bad_size']) {
      c = coordinator(b, { refuse: [`refused: no (HTTP 403 on /v1/org/backup/grant, code ${code})`] });
      r = await up.uploadChunks(deps(c), [chunk(1)], opts);
      assert.strictEqual(r.ok, false, code); assert.strictEqual(r.code, code); assert.ok(!r.retryLater, code);
      assert.strictEqual(c.bodies.length, 1, `${code} was retried`);
    }
  } finally { await b.close(); }
});

test('the same content twice in one run is uploaded once; batches split at the per-grant limit', async () => {
  const b = await bucket();
  try {
    const one = chunk(1);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), [one, one], opts);
    assert.strictEqual(r.ok, true); assert.strictEqual(b.puts, 1);

    const many = Array.from({ length: up.MAX_PER_GRANT + 2 }, (_, i) => chunk(100 + i, up.MIN_OBJECT));
    const c2 = coordinator(b);
    const r2 = await up.uploadChunks(deps(c2, {}), many, Object.assign({ concurrency: 16 }, opts));
    assert.strictEqual(r2.ok, true, r2.because);
    assert.deepStrictEqual(c2.bodies.map((x) => x.chunks.length), [up.MAX_PER_GRANT, 2]);
  } finally { await b.close(); }
});

test('a chunk outside the object size range, or not { name, object }, is refused before any request', async () => {
  const c = coordinator({ base: 'http://127.0.0.1:9' });
  for (const bad of [[{ name: 'x', object: Buffer.alloc(up.MIN_OBJECT - 1) }], [{ name: 'x', object: Buffer.alloc(up.MAX_OBJECT + 1) }], [{ object: Buffer.alloc(up.MIN_OBJECT) }], ['x']]) {
    const r = await up.uploadChunks(deps(c), bad, opts);
    assert.strictEqual(r.ok, false);
  }
  assert.strictEqual(c.bodies.length, 0);
});
