'use strict';
/* #5535 E0.6: engine/backupupload.js. A local HTTP server stands in for the bucket (write-once, MD5-checked, as
 * measured on #5535) and a stub macRequest stands in for the coordinator's grant route, answering in the shape
 * kosmos-relay putgrant-5535's coordinator/src/backup.rs sends (ISO expires_at, headers without Content-Length,
 * X-Amz-SignedHeaders in the url, the key at the end of the url path). Nothing leaves the machine. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const up = require('./backupupload');
up.allowHttpForTests(true);   // the local bucket is plain http; only this setter allows that

const md5 = (b) => crypto.createHash('md5').update(b).digest('base64');
const sha256b = (b) => crypto.createHash('sha256').update(b).digest('base64');
const chunk = (n, size) => ({ name: crypto.createHash('sha256').update(`c${n}`).digest('hex'), object: crypto.randomBytes(size || up.MIN_OBJECT + n) });
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const SIGNED = 'content-length;content-md5;host;if-none-match;x-amz-object-lock-mode;x-amz-object-lock-retain-until-date';
// SigV4's X-Amz-Date for a signing time (ms): YYYYMMDDTHHMMSSZ.
const amzDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/* A bucket: PUT /bucket/<key> stores once (412 after), checks Content-MD5 against the body (400 BadDigest). `script`
   (key -> [[status, body, delayMs], ...]) is answered first, one entry per PUT of that key. Counts every PUT. */
async function bucket() {
  const stored = new Map();
  const script = new Map();
  let puts = 0;
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
      puts++;
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/bucket\//, '');
      const q = script.get(key);
      if (q && q.length) {
        const [status, body, delay, location] = q.shift();
        return setTimeout(() => { res.statusCode = status; if (location) res.setHeader('location', location); res.end(body || ''); }, delay || 0);
      }
      const body = Buffer.concat(parts);
      // A manifest binds x-amz-checksum-sha256, a chunk Content-MD5: S3 checks whichever was sent (400 BadDigest).
      const sha = req.headers['x-amz-checksum-sha256'];
      if (sha !== undefined ? sha !== sha256b(body) : req.headers['content-md5'] !== md5(body)) { res.statusCode = 400; return res.end('<Error><Code>BadDigest</Code></Error>'); }
      if (req.headers['if-none-match'] === '*' && stored.has(key)) { res.statusCode = 412; return res.end('<Error><Code>PreconditionFailed</Code></Error>'); }
      stored.set(key, body); res.statusCode = 200; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { stored, script, base, get puts() { return puts; }, close: () => new Promise((r) => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}

/* A coordinator stub in slice 2's shape. Records every body. `refuse` (refusal texts) is answered first, one per
   call. `tamper(data)` edits an answer. `expiresAt` (ms) overrides the 15-minute window. `tag` prefixes its keys, so
   two stubs sharing one bucket never collide (a collision is a first-attempt 412, which the uploader refuses). */
function coordinator(b, opts) {
  const o = opts || {};
  const bodies = [];
  let n = 0;
  const macRequest = async (method, route, body) => {
    bodies.push(body);
    assert.strictEqual(method, 'POST'); assert.strictEqual(route, up.GRANT_ROUTE);
    if (o.refuse && o.refuse.length) return { ok: false, because: o.refuse.shift() };
    const expMs = typeof o.expiresAt === 'function' ? o.expiresAt() : (o.expiresAt || Date.now() + 15 * 60 * 1000);
    const retain = iso(Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000 + 33 * 86400 * 1000);
    const uploads = body.chunks.map((c) => {
      const key = `org1/acct1/1/2026-W41/${o.tag || ''}k${++n}`;
      const signedAt = Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000;
      const url = `${b.base}/bucket/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDTEST%2F20261008%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=${amzDate(signedAt)}&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED)}&X-Amz-Signature=00`;
      return { key, url, headers: { 'content-md5': c.md5, 'if-none-match': '*', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': retain } };
    });
    const data = { epoch: 1, period: '2026-W41', retain_until: retain, expires_at: iso(expMs), uploads };
    if (o.tamper) o.tamper(data);
    return { ok: true, data };
  };
  return { macRequest, bodies };
}
const deps = (c, extra) => Object.assign({ macRequest: c.macRequest, fetch, sleep: async () => {} }, extra || {});
const keyN = (n) => `org1/acct1/1/2026-W41/k${n}`;

test('refusalOf reads the status and code from the tunnel text, and nothing from other text', () => {
  assert.deepStrictEqual(up.refusalOf('refused: over the allowance (HTTP 429 on /v1/org/backup/grant, code backup_quota)'), { status: 429, code: 'backup_quota' });
  assert.deepStrictEqual(up.refusalOf('refused: x (HTTP 404 on /v1/org/backup/grant)'), { status: 404, code: null });
  assert.deepStrictEqual(up.refusalOf('the tunnel program answered in a shape we could not read'), { status: null, code: null });
  assert.deepStrictEqual(up.refusalOf(undefined), { status: null, code: null });
});

test('expires_at is read as the coordinator sends it (ISO), or as seconds or milliseconds; anything else is NaN', () => {
  assert.strictEqual(up.expiryMs('2026-10-08T18:15:00Z'), Date.UTC(2026, 9, 8, 18, 15, 0));
  assert.strictEqual(up.expiryMs(1700000000), 1700000000000);
  assert.strictEqual(up.expiryMs(1700000000000), 1700000000000);
  for (const bad of ['soon', '', null, undefined, -1, NaN, '1700000000', '2026-10-08T18:15:00']) assert.ok(Number.isNaN(up.expiryMs(bad)), String(bad));
  assert.strictEqual(up.expiryMs('2026-10-08T13:15:00-05:00'), Date.UTC(2026, 9, 8, 18, 15, 0), 'an explicit offset is honoured');
});

test('every chunk is stored once under its granted key, and the name -> key map comes back', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2), chunk(3)];
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), cs);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.size, 3);
    for (const x of cs) assert.ok(b.stored.get(r.keys.get(x.name)).equals(x.object));
    assert.strictEqual(b.puts, 3);
    assert.deepStrictEqual(c.bodies[0].chunks, cs.map((x) => ({ size: x.object.length, md5: md5(x.object) })));
    assert.match(c.bodies[0].nonce, /^[0-9a-f]{32}$/);
  } finally { await b.close(); }
});

test('a grant that does not bind OUR bytes, or does not name its key, is refused before anything is sent', async () => {
  for (const [what, tamper, want] of [
    ['another MD5', (d) => { d.uploads[1].headers['content-md5'] = md5(Buffer.from('other')); }, 'MD5'],
    ['a listed Content-Length that is not ours', (d) => { d.uploads[0].headers['Content-Length'] = String(up.MIN_OBJECT + 1 + 7); }, 'length'],
    ['not write-once', (d) => { delete d.uploads[2].headers['if-none-match']; }, 'write-once'],
    ['content-length not signed', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent('content-length;'), ''); }, 'does not sign content-length'],
    ['content-md5 not signed', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent('content-md5;'), ''); }, 'does not sign content-md5'],
    ['no SignedHeaders at all', (d) => { d.uploads[0].url = d.uploads[0].url.replace(/X-Amz-SignedHeaders=[^&]*&/, ''); }, 'has no X-Amz-SignedHeaders'],
    // Distinct url and distinct key, but the url names another object: only the url-to-key check can catch it.
    ['a url that does not carry its key', (d) => { d.uploads[1].key = 'org1/acct1/1/2026-W41/other'; }, 'carry its key'],
    // Distinct keys, ONE url that ends with both ('.../bucket/<k1>' ends with '/' + 'bucket/<k1>' and '/' + '<k1>'), so
    // the url-to-key check passes both and only the repeated-url check can catch it.
    ['a repeated url', (d) => { d.uploads[1].key = 'bucket/' + d.uploads[0].key; d.uploads[1].url = d.uploads[0].url; }, 'repeats a url'],
    ['one upload short', (d) => { d.uploads.pop(); }, 'one upload per chunk'],
    ['a repeated key', (d) => { d.uploads[1].key = d.uploads[0].key; }, 'repeats a key'],
    ['no expiry', (d) => { delete d.expires_at; }, 'expires_at'],
    ['a url that lasts under a minute', (d) => { d.uploads[0].url = d.uploads[0].url.replace('X-Amz-Expires=900', 'X-Amz-Expires=30'); }, 'under a minute'],
    // Every upload under the same TWO segments: one prefix (so the one-path check passes), but not the key under one
    // bucket segment, so the map would record a key that is not the stored object's.
    ['every url two segments above its key', (d) => { for (const u of d.uploads) u.url = u.url.replace('/bucket/', '/bucket/extra/'); }, 'bucket segment'],
    ['a header signed beyond the six', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent('x-amz-object-lock-retain-until-date'), encodeURIComponent('x-amz-object-lock-retain-until-date;x-amz-meta-a')); }, 'outside the six'],
    ['no X-Amz-Signature', (d) => { d.uploads[0].url = d.uploads[0].url.replace('&X-Amz-Signature=00', ''); }, 'has no X-Amz-Signature'],
    ['no X-Amz-Credential', (d) => { d.uploads[0].url = d.uploads[0].url.replace(/&X-Amz-Credential=[^&]*/, ''); }, 'has no X-Amz-Credential'],
    ['an unreadable X-Amz-Date', (d) => { d.uploads[0].url = d.uploads[0].url.replace(/X-Amz-Date=[^&]*/, 'X-Amz-Date=yesterday'); }, 'X-Amz-Date'],
    ['expires_at that disagrees with the signed time', (d) => { d.expires_at = iso(Date.parse(d.expires_at) + 10 * 60 * 1000); }, 'signed time'],
    ['a legal hold in the url query', (d) => { d.uploads[0].url += '&x-amz-object-lock-legal-hold=ON'; }, 'x-amz-object-lock-legal-hold'],
    ['a multipart uploadId in the url query', (d) => { d.uploads[0].url += '&partNumber=1&uploadId=zz'; }, 'may not (partNumber)'],
    ['a repeated query parameter', (d) => { d.uploads[0].url += '&X-Amz-Expires=900'; }, 'repeats a parameter'],
    ['a url that outlives a grant (X-Amz-Expires 3600)', (d) => { d.uploads[0].url = d.uploads[0].url.replace('X-Amz-Expires=900', 'X-Amz-Expires=3600'); }, 'lasts longer'],
    ['a url with no X-Amz-Expires', (d) => { d.uploads[0].url = d.uploads[0].url.replace('X-Amz-Expires=900&', ''); }, 'has no X-Amz-Expires'],
    ['a lock of exactly 28 days', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = iso(Date.parse(d.expires_at) - 15 * 60 * 1000 + 28 * 86400 * 1000); }, '29 to 39'],
    ['a lock of 40 days', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = iso(Date.parse(d.expires_at) - 15 * 60 * 1000 + 40 * 86400 * 1000); }, '29 to 39'],
    ['an extra header', (d) => { d.uploads[0].headers['x-anything'] = '1'; }, 'may not (x-anything)'],
    ['a Host header', (d) => { d.uploads[0].headers.Host = 'evil.example'; }, 'may not (Host)'],
    ['Transfer-Encoding', (d) => { d.uploads[0].headers['Transfer-Encoding'] = 'chunked'; }, 'may not (Transfer-Encoding)'],
    ['a header twice in another case', (d) => { d.uploads[0].headers['Content-MD5'] = md5(Buffer.from('x')); }, 'twice'],
    // The printable-ASCII check runs before the exact lock-mode check, so this case isolates it.
    ['a lock mode with CRLF in it', (d) => { d.uploads[0].headers['x-amz-object-lock-mode'] = 'COMPLIANCE\r\nX-Evil: 1'; }, 'printable ASCII'],
    ['a GOVERNANCE lock', (d) => { d.uploads[0].headers['x-amz-object-lock-mode'] = 'GOVERNANCE'; }, 'COMPLIANCE'],
    ['no lock mode', (d) => { delete d.uploads[0].headers['x-amz-object-lock-mode']; }, 'COMPLIANCE'],
    ['a lock until 2099', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = '2099-01-01T00:00:00Z'; }, '29 to 39'],
    ['a 10-day lock', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = iso(Date.now() + 10 * 86400 * 1000); }, '29 to 39'],
    ['the lock date not signed', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent(';x-amz-object-lock-retain-until-date'), ''); }, 'does not sign x-amz-object-lock-retain-until-date'],
    ['a numeric-looking string expiry', (d) => { d.expires_at = '1700000000'; }, 'expires_at'],
  ]) {
    const b = await bucket();
    try {
      const r = await up.uploadChunks(deps(coordinator(b, { tamper })), [chunk(1), chunk(2), chunk(3)]);
      assert.strictEqual(r.ok, false, what);
      // The refusal must come from the check this case aims at, not from an unrelated earlier one.
      assert.ok(String(r.because).includes(want), `${what}: refused for another reason: ${r.because}`);
      assert.strictEqual(b.puts, 0, `${what}: a PUT was sent`);
    } finally { await b.close(); }
  }
});

test('the coordinator leaves Content-Length out of headers (fetch sets it): that is accepted, and the bucket gets the exact length', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(5)];
    const r = await up.uploadChunks(deps(coordinator(b)), cs);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(b.stored.get(keyN(1)).length, cs[0].object.length);
  } finally { await b.close(); }
});

test('an http (not https) upload url is refused unless the test seam allows it', () => {
  const c = chunk(1);
  const data = { expires_at: '2030-01-01T00:15:00Z', uploads: [{ key: 'a/k', url: `http://bucket.example/b/a/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=c&X-Amz-Date=20300101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED)}&X-Amz-Signature=00`, headers: { 'Content-MD5': md5(c.object), 'If-None-Match': '*', 'X-Amz-Object-Lock-Mode': 'COMPLIANCE', 'X-Amz-Object-Lock-Retain-Until-Date': '2030-02-03T00:00:00Z' } }] };
  up.allowHttpForTests(false);
  try { assert.strictEqual(up.parseGrant(data, [c]).ok, false); } finally { up.allowHttpForTests(true); }
  assert.strictEqual(up.parseGrant(data, [c]).ok, true);
  data.uploads[0].url = data.uploads[0].url.replace('http:', 'https:');
  assert.strictEqual(up.parseGrant(data, [c]).ok, true, 'header names are matched case-insensitively');
});

test('a 412 on the FIRST attempt is refused (the key was not ours to write); the run stops and asks no new grant', async () => {
  const b = await bucket();
  try {
    b.script.set(keyN(1), [[412, '<Error><Code>PreconditionFailed</Code></Error>']]);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false);
    assert.match(r.because, /HTTP 412/);
    assert.strictEqual(r.keys.size, 0, 'nothing is recorded as stored on a 412 alone');
    assert.strictEqual(c.bodies.length, 1);
  } finally { await b.close(); }
});

test('a lost answer (timeout) is retried on the SAME key, and the 412 that proves it landed counts as stored', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1)];
    // The first PUT is held past the uploader's timeout (its answer is "lost"); the retry finds the key taken.
    b.script.set(keyN(1), [[200, '', 400], [412, '<Error><Code>PreconditionFailed</Code></Error>']]);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), cs, { putTimeoutMs: 100 });
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.get(cs[0].name), keyN(1));
    assert.strictEqual(c.bodies.length, 1, 'no second grant, so no second locked copy');
  } finally { await b.close(); }
});

test('a transient 503 is retried on the same key', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(2)];
    b.script.set(keyN(1), [[503], [503]]);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), cs);
    assert.strictEqual(r.ok, true, r.because);
    assert.ok(b.stored.get(keyN(1)).equals(cs[0].object));
    assert.strictEqual(c.bodies.length, 1);
  } finally { await b.close(); }
});

test('a 403 that says the request expired gets a NEW grant for only the chunks not yet stored', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2), chunk(3)];
    const c = coordinator(b);
    b.script.set(keyN(2), [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const r = await up.uploadChunks(deps(c), cs);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(c.bodies.length, 2);
    assert.deepStrictEqual(c.bodies[1].chunks, [{ size: cs[1].object.length, md5: md5(cs[1].object) }]);
    assert.notStrictEqual(c.bodies[0].nonce, c.bodies[1].nonce);
    assert.strictEqual(r.keys.get(cs[1].name), keyN(4));
  } finally { await b.close(); }
});

test('a refused PUT (400 BadDigest, a 403 signature mismatch) stops the run: no new grant spends allowance on it', async () => {
  for (const [status, body] of [[400, '<Error><Code>BadDigest</Code></Error>'], [403, '<Error><Code>SignatureDoesNotMatch</Code></Error>'], [404, '']]) {
    const b = await bucket();
    try {
      b.script.set(keyN(1), [[status, body]]);
      const c = coordinator(b);
      const r = await up.uploadChunks(deps(c), [chunk(1)]);
      assert.strictEqual(r.ok, false, String(status));
      assert.match(r.because, new RegExp(`HTTP ${status}`));
      assert.strictEqual(c.bodies.length, 1, `${status}: asked for another grant`);
    } finally { await b.close(); }
  }
});

test('a redirect is never followed: the body does not go to the address it names', async () => {
  const b = await bucket(), other = await bucket();
  try {
    b.script.set(keyN(1), [[307, '', 0, `${other.base}/bucket/${keyN(1)}`]]);
    const r = await up.uploadChunks(deps(coordinator(b)), [chunk(1)]);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(other.puts, 0, 'the redirect target got the body');
  } finally { await b.close(); await other.close(); }
});

// A fake clock: sleep advances it, so "retry until the grant expires" runs in no real time.
const clock = () => { let t = Date.now(); return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test('bucket trouble (503, SlowDown, 409) is retried on the SAME url until the grant expires, then the run ends retryLater with no new grant', async () => {
  for (const [status, body] of [[503, '<Error><Code>SlowDown</Code></Error>'], [409, '<Error><Code>ConditionalRequestConflict</Code></Error>'], [500, '']]) {
    const b = await bucket();
    try {
      const c = coordinator(b);
      b.script.get = () => [[status, body]];   // every PUT answers this
      const r = await up.uploadChunks(deps(c, clock()), [chunk(1)]);
      assert.strictEqual(r.ok, false, String(status));
      assert.strictEqual(r.retryLater, true, String(status));
      assert.strictEqual(c.bodies.length, 1, `${status}: asked for another grant`);
      assert.ok(b.puts > 5, `${status}: retried only ${b.puts} times`);
    } finally { await b.close(); }
  }
});

test('a 409 that clears is stored on the same key', async () => {
  const b = await bucket();
  try {
    b.script.set(keyN(1), [[409, '<Error><Code>ConditionalRequestConflict</Code></Error>']]);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), [chunk(3)]);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(c.bodies.length, 1);
  } finally { await b.close(); }
});

test('an unreachable bucket (connection refused) is retried until expiry, then ends retryLater, with one grant', async () => {
  const b = await bucket();
  const base = b.base; await b.close();   // nothing listens there now
  const c = coordinator({ base });
  const r = await up.uploadChunks(deps(c, clock()), [chunk(1)]);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true);
  assert.strictEqual(c.bodies.length, 1);
});

test('fetch refusing the request LOCALLY is not retried: the run stops at once, with one grant', async () => {
  const b = await bucket();
  try {
    let calls = 0;
    const bad = async () => { calls++; const e = new TypeError('fetch failed'); e.cause = { code: 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH' }; throw e; };
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: bad }, clock())), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.ok(!r.retryLater);
    assert.match(r.because, /locally/);
    assert.strictEqual(calls, 1); assert.strictEqual(c.bodies.length, 1);
  } finally { await b.close(); }
});

test('re-granting is bounded: a chunk whose grants keep expiring ends the run after MAX_REGRANTS more grants', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b);
    b.script.get = () => [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']];
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(c.bodies.length, up.MAX_REGRANTS + 1);
  } finally { await b.close(); }
});

test('two chunks with one name but different bytes are refused (a caller bug), not silently deduped', async () => {
  const c = coordinator({ base: 'http://127.0.0.1:9' });
  const a = chunk(1), z = { name: a.name, object: crypto.randomBytes(a.object.length) };
  const r = await up.uploadChunks(deps(c), [a, z]);
  assert.strictEqual(r.ok, false); assert.match(r.because, /share a name/);
  assert.strictEqual(c.bodies.length, 0);
});

test('a lost answer that LANDED, then S3 says the grant expired: no new grant, no second locked copy (retryLater)', async () => {
  const b = await bucket();
  try {
    // The first PUT lands but its answer is held past the timeout; the retry is told the grant expired.
    b.script.set(keyN(1), [[200, '', 400], [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), [chunk(1)], { putTimeoutMs: 100 });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true);
    assert.strictEqual(c.bodies.length, 1, 'a second grant could write a second locked copy');
  } finally { await b.close(); }
});

test('a 403 for an expired CREDENTIAL (ExpiredToken) is refused, not treated as an expired grant', async () => {
  const b = await bucket();
  try {
    b.script.set(keyN(1), [[403, '<Error><Code>ExpiredToken</Code><Message>The provided token has expired.</Message></Error>']]);
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.ok(!r.retryLater);
    assert.strictEqual(c.bodies.length, 1);
  } finally { await b.close(); }
});

test('a network code not in any list (ENETDOWN) is retried, not refused: the run ends retryLater', async () => {
  const c = coordinator({ base: 'http://127.0.0.1:9' });
  const down = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENETDOWN' }; throw e; };
  const r = await up.uploadChunks(deps(c, Object.assign({ fetch: down }, clock())), [chunk(1)]);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true);
  // ENETDOWN can end a socket after the body left, so the chunk is named as possibly landed.
  assert.strictEqual(r.unsure && r.unsure.length, 1);
});

test('a slow uplink: a grant that runs out of time shrinks the next to what it carried, and everything is stored', async () => {
  const b = await bucket();
  try {
    const ck = clock();
    // Every PUT costs 4 fake minutes, one at a time: a 15-minute grant carries 3.
    const slow = async (url, init) => { await ck.sleep(4 * 60 * 1000); return fetch(url, init); };
    // The stub's grants are signed on the fake clock, as the coordinator's are on its own.
    const c = coordinator(b, { tag: 's', expiresAt: () => ck.now() + 15 * 60 * 1000 });
    const cs = Array.from({ length: 10 }, (_, i) => chunk(300 + i));
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: slow }, ck)), cs, { concurrency: 1 });
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.size, 10);
    const sizes = c.bodies.map((x) => x.chunks.length);
    assert.strictEqual(sizes[0], up.INITIAL_BATCH);
    assert.ok(sizes.slice(1).every((n) => n <= 3), `later grants were not shrunk: ${sizes}`);
    assert.ok(sizes.reduce((a, n) => a + n, 0) < 2 * cs.length, `charged for ${sizes.reduce((a, n) => a + n, 0)} chunks to send 10`);
  } finally { await b.close(); }
});

test('a grant that expires far further ahead than a grant lasts (a clock far off) is refused before any PUT', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b, { expiresAt: Date.now() + 3 * 3600 * 1000 });   // an hour of tolerance; three is refused
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /clocks is wrong/);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('locks of exactly 29 and 39 days from the grant start are accepted (the window is inclusive)', async () => {
  for (const days of [29, 39]) {
    const b = await bucket();
    try {
      const tamper = (d) => { for (const u of d.uploads) u.headers['x-amz-object-lock-retain-until-date'] = iso(Date.parse(d.expires_at) - 15 * 60 * 1000 + days * 86400 * 1000); };
      const r = await up.uploadChunks(deps(coordinator(b, { tamper, tag: `L${days}` })), [chunk(1)]);
      assert.strictEqual(r.ok, true, `${days}: ${r.because}`);
    } finally { await b.close(); }
  }
});

test('a 412 on a retry after only 5xx answers counts as stored (by design: only this grant could write the key)', async () => {
  const b = await bucket();
  try {
    b.script.set(keyN(1), [[503], [412, '<Error><Code>PreconditionFailed</Code></Error>']]);
    const r = await up.uploadChunks(deps(coordinator(b)), [chunk(1)]);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.size, 1);
  } finally { await b.close(); }
});

test('a PUT started in time is NOT aborted at the grant deadline (S3 checks expiry on arrival): it is stored', async () => {
  const b = await bucket();
  try {
    const t0 = Math.floor(Date.now() / 1000) * 1000;
    let t = t0;
    const ck = { now: () => t, sleep: async (ms) => { t += ms; } };
    const c = coordinator(b, { expiresAt: t0 + 1000 });   // one fake second left when the PUT starts
    // The PUT takes 1.5 REAL seconds; capping its timeout at the grant's remaining second would abort it.
    const slow = async (url, init) => { await new Promise((r) => setTimeout(r, 1500)); return fetch(url, init); };
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: slow }, ck)), [chunk(1)]);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.keys.size, 1);
  } finally { await b.close(); }
});

test('a stuck end names the chunks that may have landed, and their keys (unsure)', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b);
    b.script.get = () => [[503]];
    const cs = [chunk(1)];
    const r = await up.uploadChunks(deps(c, clock()), cs);
    assert.strictEqual(r.retryLater, true);
    assert.deepStrictEqual(r.unsure, [{ name: cs[0].name, key: keyN(1) }]);
  } finally { await b.close(); }
});

test('a grant request that got no answer at all (network, timeout) ends retryLater; one refused before sending does not', async () => {
  let r = await up.uploadChunks({ macRequest: async () => ({ ok: false, because: 'the coordinator did not answer in 20 s' }), fetch }, [chunk(1)]);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true);
  r = await up.uploadChunks({ macRequest: async () => ({ ok: false, notSent: true, because: 'this computer is not connected to Kosmos+' }), fetch }, [chunk(1)]);
  assert.strictEqual(r.ok, false); assert.ok(!r.retryLater);
});

test('a refusal stops the run and still names the chunks that met trouble on the way (unsure)', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2)];
    // Chunk 1: a lost answer (timeout) then a refusal; chunk 2 is refused outright after chunk 1's trouble began.
    b.script.set(keyN(1), [[200, '', 400], [400, '<Error><Code>BadDigest</Code></Error>']]);
    const r = await up.uploadChunks(deps(coordinator(b)), cs, { putTimeoutMs: 100, concurrency: 1 });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.unsure, [{ name: cs[0].name, key: keyN(1) }]);
  } finally { await b.close(); }
});

test('an S3 error body is read only up to 8 KB: a body that never ends still gives an answer at once', async () => {
  // This server sends an error code, then body bytes forever. Only a bounded read returns with the code.
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(400);
      res.write('<Error><Code>BadDigest</Code></Error>');
      const t = setInterval(() => { if (!res.write('x'.repeat(4096))) { /* backpressure: keep trying */ } }, 1);
      res.on('close', () => clearInterval(t));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    let t = Date.now();
    const ck = { now: () => t, sleep: async () => { t += 10 * 60 * 1000; } };   // a retry would run the grant out at once
    const c = coordinator({ base: `http://127.0.0.1:${srv.address().port}` });
    const r = await up.uploadChunks(deps(c, ck), [chunk(1)], { putTimeoutMs: 300 });
    assert.strictEqual(r.ok, false);
    assert.match(r.because, /HTTP 400 BadDigest/, `the body was not read in bounded time: ${r.because}`);
  } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
});

test('S3 400 RequestTimeout and IncompleteBody are retried on the same url (nothing was committed); 501 is refused', async () => {
  for (const code of ['RequestTimeout', 'IncompleteBody']) {
    const b = await bucket();
    try {
      b.script.set(keyN(1), [[400, `<Error><Code>${code}</Code></Error>`]]);
      const c = coordinator(b);
      const r = await up.uploadChunks(deps(c), [chunk(1)]);
      assert.strictEqual(r.ok, true, `${code}: ${r.because}`);
      assert.strictEqual(c.bodies.length, 1);
    } finally { await b.close(); }
  }
  const b = await bucket();
  try {
    b.script.set(keyN(1), [[501, '<Error><Code>NotImplemented</Code></Error>']]);
    const r = await up.uploadChunks(deps(coordinator(b)), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.ok(!r.retryLater); assert.match(r.because, /HTTP 501/);
  } finally { await b.close(); }
});

test('if a worker throws, nothing keeps uploading after the result is returned', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2)];
    b.script.set(keyN(1), [[503]]);
    b.script.set(keyN(2), [[200, '', 300]]);   // chunk 2's PUT is still in flight when chunk 1's worker throws
    const r = await up.uploadChunks(deps(coordinator(b), { sleep: async () => { throw new Error('sleep broke'); } }), cs, { concurrency: 2 });
    assert.strictEqual(r.ok, false); assert.match(r.because, /sleep broke/);
    assert.deepStrictEqual(r.unsure, [{ name: cs[0].name, key: keyN(1) }], 'a worker throw drops the possibly-landed chunk');
    const at = r.keys.size;
    await new Promise((res) => setTimeout(res, 500));
    assert.strictEqual(r.keys.size, at, 'the keys map changed after the result was returned');
  } finally { await b.close(); }
});

test('http is allowed only through the module setter: a deps or opts flag does nothing', async () => {
  const b = await bucket();
  up.allowHttpForTests(false);
  try {
    const c = coordinator(b);
    const r = await up.uploadChunks(Object.assign(deps(c), { allowHttp: true }), [chunk(1)], { allowHttp: true });
    assert.strictEqual(r.ok, false); assert.match(r.because, /not https/);
    assert.strictEqual(b.puts, 0);
  } finally { up.allowHttpForTests(true); await b.close(); }
});

test('grant sizes SETTLE on a slow link: allowance asked for stays within 1.2x of what is stored', async () => {
  const b = await bucket();
  try {
    const ck = clock();
    const slow = async (url, init) => { await ck.sleep(60 * 1000); return fetch(url, init); };   // one PUT per fake minute
    const c = coordinator(b, { tag: 'settle', expiresAt: () => ck.now() + 15 * 60 * 1000 });
    const cs = Array.from({ length: 60 }, (_, i) => chunk(500 + i));
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: slow }, ck)), cs, { concurrency: 1 });
    assert.strictEqual(r.ok, true, r.because);
    const sizes = c.bodies.map((x) => x.chunks.length);
    const asked = sizes.reduce((x, n) => x + n, 0);
    assert.ok(asked <= 1.2 * cs.length, `asked for ${asked} to store ${cs.length}: ${sizes}`);
    // No swing: after the first grant, a size never more than doubles past what a window carries (about 14 here).
    assert.ok(sizes.slice(1).every((n) => n <= 15), `sizes swing: ${sizes}`);
  } finally { await b.close(); }
});

test('a grant deadline runs from its arrival, so a Mac clock minutes off still gets the whole window', async () => {
  const b = await bucket();
  try {
    const ck = clock();
    const slow = async (url, init) => { await ck.sleep(60 * 1000); return fetch(url, init); };
    // The coordinator's clock is 10 minutes behind this Mac's: by the Mac's clock its grants look 5 minutes long.
    const c = coordinator(b, { tag: 'skew', expiresAt: () => ck.now() - 10 * 60 * 1000 + 15 * 60 * 1000 });
    const cs = Array.from({ length: 8 }, (_, i) => chunk(700 + i));
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: slow }, ck)), cs, { concurrency: 1 });
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(c.bodies.length, 1, `the first grant was cut short: ${c.bodies.map((x) => x.chunks.length)}`);
  } finally { await b.close(); }
});

test('all uploads of one grant must sit under one bucket path', async () => {
  const b = await bucket();
  try {
    const tamper = (d) => { d.uploads[1].url = d.uploads[1].url.replace('/bucket/', '/bucket/extra/'); d.uploads[1].key = d.uploads[1].key; };
    const r = await up.uploadChunks(deps(coordinator(b, { tamper })), [chunk(1), chunk(2)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /bucket (path|segment)/);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a later grant that repeats a key an earlier grant in the run gave is refused before any PUT', async () => {
  const b = await bucket();
  try {
    let calls = 0;
    const c = coordinator(b, { tamper: (d) => { if (++calls === 2) { d.uploads[0].key = keyN(1); d.uploads[0].url = d.uploads[0].url.replace(/k\d+\?/, 'k1?'); } } });
    b.script.set(keyN(1), [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /earlier grant in this run/);
    assert.strictEqual(b.puts, 1, 'only the first grant\'s PUT was sent');
  } finally { await b.close(); }
});

test('a Mac clock up to an hour ahead still uploads (S3 never reads the Mac clock)', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadChunks(deps(coordinator(b, { expiresAt: Date.now() - 20 * 60 * 1000 })), [chunk(1)]);
    assert.strictEqual(r.ok, true, r.because);
  } finally { await b.close(); }
});

test('S3 ending grants EARLY does not make sizing over-ask: allowance asked stays near what is stored', async () => {
  const b = await bucket();
  try {
    const ck = clock();
    let grantAt = 0;
    // Each PUT costs 3 fake seconds; S3 answers "expired" to any PUT 10 s after its grant arrived.
    const early = async (url, init) => {
      await ck.sleep(3000);
      if (ck.now() - grantAt > 10 * 1000) return new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>', { status: 403 });
      return fetch(url, init);
    };
    const c = coordinator(b, { tag: 'early', expiresAt: () => ck.now() + 15 * 60 * 1000 });
    const inner = c.macRequest;
    c.macRequest = async (...a) => { const r = await inner(...a); grantAt = ck.now(); return r; };
    const cs = Array.from({ length: 60 }, (_, i) => chunk(900 + i));
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: early }, ck)), cs, { concurrency: 1 });
    assert.strictEqual(r.ok, true, r.because);
    const asked = c.bodies.reduce((x, bd) => x + bd.chunks.length, 0);
    assert.ok(asked <= 1.6 * cs.length, `asked for ${asked} to store ${cs.length}: ${c.bodies.map((bd) => bd.chunks.length)}`);
  } finally { await b.close(); }
});

test('a virtual-hosted S3 url must have the key as its whole path', () => {
  const c = chunk(1);
  const mk = (host, path) => ({ expires_at: '2030-01-01T00:15:00Z', uploads: [{ key: 'a/k', url: `https://${host}${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=c&X-Amz-Date=20300101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED)}&X-Amz-Signature=00`, headers: { 'content-md5': md5(c.object), 'if-none-match': '*', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': '2030-02-03T00:00:00Z' } }] });
  assert.strictEqual(up.parseGrant(mk('b1.s3.us-east-1.amazonaws.com', '/a/k'), [c]).ok, true);
  assert.strictEqual(up.parseGrant(mk('b1.s3.us-east-1.amazonaws.com', '/x/a/k'), [c]).ok, false);
  assert.strictEqual(up.parseGrant(mk('s3.us-east-1.amazonaws.com', '/b1/a/k'), [c]).ok, true, 'path-style keeps one bucket segment');
  up.allowHttpForTests(false);
  try {
    // Path-style: S3 takes the first segment as the bucket, so a bare key path would store another object.
    let r = up.parseGrant(mk('s3.us-east-1.amazonaws.com', '/a/k'), [c]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /path-style/);
    r = up.parseGrant(mk('s3.us-east-1.amazonaws.com', '/b1/a/k'), [c]);
    assert.strictEqual(r.ok, true, r.because);
    r = up.parseGrant(mk('bkt.s3-website-us-east-1.amazonaws.com', '/a/k'), [c]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /not an AWS S3 endpoint/);
  } finally { up.allowHttpForTests(true); }
});

test('upload hosts are AWS S3 endpoints only (outside the test setter): a LAN host, another service or a port is refused', () => {
  const c = chunk(1);
  const mk = (host) => ({ expires_at: '2030-01-01T00:15:00Z', uploads: [{ key: 'a/k', url: `https://${host}/b1/a/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=c&X-Amz-Date=20300101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED)}&X-Amz-Signature=00`, headers: { 'content-md5': md5(c.object), 'if-none-match': '*', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': '2030-02-03T00:00:00Z' } }] });
  up.allowHttpForTests(false);
  try {
    for (const ok of ['s3.us-east-1.amazonaws.com', 's3-us-west-2.amazonaws.com', 's3.amazonaws.com']) assert.strictEqual(up.parseGrant(mk(ok), [c]).ok, true, ok);
    // The coordinator's default: virtual-hosted (BackupStore::url), the key as the whole path. Must pass with the pin ON.
    const vh = mk('kosmos-org-backup.s3.us-east-1.amazonaws.com');
    vh.uploads[0].url = vh.uploads[0].url.replace('/b1/a/k?', '/a/k?');
    const rv = up.parseGrant(vh, [c]);
    assert.strictEqual(rv.ok, true, `the production url shape was refused: ${rv.because}`);
    for (const bad of ['s3-control.amazonaws.com', 'ab.s3.us-east-1.amazonaws.com']) assert.strictEqual(up.parseGrant(mk(bad), [c]).ok, false, bad);
    for (const bad of ['192.168.1.10', 'localhost', 'storage.example.com', 's3.us-east-1.amazonaws.com.evil.example', 's3.us-east-1.amazonaws.com:8443']) {
      const r = up.parseGrant(mk(bad), [c]);
      assert.strictEqual(r.ok, false, bad); assert.match(r.because, /not an AWS S3 endpoint/, bad);
    }
  } finally { up.allowHttpForTests(true); }
});

test('a bucket that cannot even be reached (DNS) ends retryLater with nothing unsure and no second grant', async () => {
  const c = coordinator({ base: 'http://127.0.0.1:9' });
  const nodns = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  const r = await up.uploadChunks(deps(c, Object.assign({ fetch: nodns }, clock())), [chunk(1), chunk(2)]);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true);
  assert.match(r.because, /could not be reached/);
  assert.strictEqual(r.unsure, undefined, 'a chunk that never connected was named as possibly landed');
  assert.strictEqual(c.bodies.length, 1);
});

// One connect failure, then a bucket that answers (400 IncompleteBody: S3 committed nothing) until the grant runs out.
// The bucket was reached, so this is not "could not be reached": it re-grants, as the same run without the blip does.
const blipThenIncomplete = () => {
  let n = 0;
  return async () => {
    if (n++ === 0) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
    return new Response('<Error><Code>IncompleteBody</Code></Error>', { status: 400 });
  };
};

test('a chunk that met one connect failure and then reached the bucket is not "could not be reached", and re-grants', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b);
    const r = await up.uploadChunks(deps(c, Object.assign({ fetch: blipThenIncomplete() }, clock())), [chunk(1)]);
    assert.strictEqual(r.ok, false);
    assert.doesNotMatch(r.because, /could not be reached/, 'a bucket that answered was reported unreachable');
    assert.ok(c.bodies.length > 1, `a reachable bucket got no second grant (${c.bodies.length})`);
    assert.strictEqual(r.unsure, undefined, 'S3 said it committed nothing, so nothing is unsure');
  } finally { await b.close(); }
});

test('a lock date given as a number (not an ISO string) is refused', () => {
  const c = chunk(1);
  const data = { expires_at: '2030-01-01T00:15:00Z', uploads: [{ key: 'a/k', url: `http://bucket.example/b/a/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=c&X-Amz-Date=20300101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED)}&X-Amz-Signature=00`, headers: { 'content-md5': md5(c.object), 'if-none-match': '*', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': Date.UTC(2030, 1, 3) } }] };
  assert.strictEqual(up.parseGrant(data, [c]).ok, false);
  data.uploads[0].headers['x-amz-object-lock-retain-until-date'] = '2030-02-03T00:00:00Z';
  assert.strictEqual(up.parseGrant(data, [c]).ok, true, 'control');
});

test('a 412 after only pre-connect failures, or after S3 said it committed nothing, is refused (none of ours could be there)', async () => {
  for (const [what, first] of [
    ['ECONNREFUSED', 'refused'],
    ['400 IncompleteBody', 'incomplete'],
  ]) {
    const b = await bucket();
    try {
      let n = 0;
      const f = async (url, init) => {
        if (n++ === 0) {
          if (first === 'refused') { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
          return new Response('<Error><Code>IncompleteBody</Code></Error>', { status: 400 });
        }
        return new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 });
      };
      const r = await up.uploadChunks(deps(coordinator(b), { fetch: f }), [chunk(1)]);
      assert.strictEqual(r.ok, false, `${what}: a 412 was recorded as ours`);
      assert.strictEqual(r.keys.size, 0, what);
    } finally { await b.close(); }
  }
});

test('every grant of a run must name the first grant\'s bucket', async () => {
  const b = await bucket();
  try {
    let calls = 0;
    const c = coordinator(b, { tamper: (d) => { if (++calls === 2) for (const u of d.uploads) u.url = u.url.replace('/bucket/', '/bucket2/'); } });
    b.script.set(keyN(1), [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /another bucket/);
    assert.strictEqual(b.puts, 1);
  } finally { await b.close(); }
});

test('never throws: a throwing injected clock still resolves to ok: false', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadChunks(deps(coordinator(b), { now: () => { throw new Error('clock broke'); } }), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /clock broke/);
  } finally { await b.close(); }
});

test('a grant over an hour past its expiry when it arrives (a clock far off) stops the run, with no second grant', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b, { expiresAt: Date.now() - 2 * 3600 * 1000 });
    const r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false);
    assert.match(r.because, /clock/);
    assert.strictEqual(c.bodies.length, 1);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('refusals: quota ends with retryLater, replayed is retried once with a new nonce, the rest stop', async () => {
  const b = await bucket();
  try {
    let c = coordinator(b, { tag: 'q', refuse: ['refused: over the allowance (HTTP 429 on /v1/org/backup/grant, code backup_quota)'] });
    let r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true); assert.strictEqual(r.code, 'backup_quota');

    c = coordinator(b, { tag: 'r', refuse: ['refused: seen (HTTP 401 on /v1/org/backup/grant, code replayed)'] });
    r = await up.uploadChunks(deps(c), [chunk(1)]);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(c.bodies.length, 2);
    assert.notStrictEqual(c.bodies[0].nonce, c.bodies[1].nonce);

    for (const code of ['backup_off', 'backup_not_member', 'own_lineage', 'backup_bad_size']) {
      c = coordinator(b, { tag: code, refuse: [`refused: no (HTTP 403 on /v1/org/backup/grant, code ${code})`] });
      r = await up.uploadChunks(deps(c), [chunk(1)]);
      assert.strictEqual(r.ok, false, code); assert.strictEqual(r.code, code); assert.ok(!r.retryLater, code);
      assert.strictEqual(c.bodies.length, 1, `${code} was retried`);
    }
  } finally { await b.close(); }
});

test('the same content twice in one run is uploaded once; grants start small, double, and never pass the per-grant limit', async () => {
  const b = await bucket();
  try {
    const one = chunk(1);
    const r = await up.uploadChunks(deps(coordinator(b, { tag: 'a' })), [one, one]);
    assert.strictEqual(r.ok, true); assert.strictEqual(b.puts, 1);

    const many = Array.from({ length: 1100 }, (_, i) => chunk(100 + i, up.MIN_OBJECT));
    const c2 = coordinator(b, { tag: 'b' });
    const r2 = await up.uploadChunks(deps(c2), many, { concurrency: 16 });
    assert.strictEqual(r2.ok, true, r2.because);
    assert.deepStrictEqual(c2.bodies.map((x) => x.chunks.length), [8, 16, 32, 64, 128, 256, up.MAX_PER_GRANT, 96]);
    assert.strictEqual(r2.keys.size, many.length);
  } finally { await b.close(); }
});

test('a bad concurrency value falls back to the default: it never starts zero workers and reports success', async () => {
  const b = await bucket();
  try {
    for (const conc of ['x', NaN, 0, -3, 2.5]) {
      const cs = [chunk(1), chunk(2)];
      const r = await up.uploadChunks(deps(coordinator(b, { tag: `c${String(conc)}` })), cs, { concurrency: conc });
      assert.strictEqual(r.ok, true, `${conc}: ${r.because}`);
      assert.strictEqual(r.keys.size, 2, String(conc));
    }
  } finally { await b.close(); }
});

test('missing wiring is refused before any request; a chunk outside the size range or not { name, object } too', async () => {
  const c = coordinator({ base: 'http://127.0.0.1:9' });
  assert.strictEqual((await up.uploadChunks({}, [chunk(1)])).ok, false);
  assert.strictEqual((await up.uploadChunks({ macRequest: c.macRequest, fetch: 'nope' }, [chunk(1)])).ok, false);
  for (const bad of [[{ name: 'x', object: Buffer.alloc(up.MIN_OBJECT - 1) }], [{ name: 'x', object: Buffer.alloc(up.MAX_OBJECT + 1) }], [{ object: Buffer.alloc(up.MIN_OBJECT) }], ['x']]) {
    const r = await up.uploadChunks(deps(c), bad);
    assert.strictEqual(r.ok, false);
  }
  assert.strictEqual(c.bodies.length, 0);
});

/* ---- the manifest (#5535 slice 2: POST /v1/org/backup/manifest, one upload bound by x-amz-checksum-sha256) ---- */
const SIGNED_M = 'content-length;host;if-none-match;x-amz-checksum-sha256;x-amz-object-lock-mode;x-amz-object-lock-retain-until-date';
const DAY = 86400 * 1000;

/* A manifest coordinator stub in slice 2's shape. `retainMs(expMs)` sets the lock (default: the grant start plus 33
   days); `refuse`, `tamper` and `expiresAt` as coordinator(); keys are mK1, mK2, ... */
function manifestCoordinator(b, opts) {
  const o = opts || {};
  const bodies = [];
  let n = 0;
  const macRequest = async (method, route, body) => {
    bodies.push(body);
    assert.strictEqual(method, 'POST'); assert.strictEqual(route, up.MANIFEST_ROUTE);
    if (o.refuse && o.refuse.length) return { ok: false, because: o.refuse.shift() };
    const expMs = typeof o.expiresAt === 'function' ? o.expiresAt() : (o.expiresAt || Date.now() + 15 * 60 * 1000);
    const signedAt = Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000;
    const retain = iso(o.retainMs ? o.retainMs(expMs) : signedAt + 33 * DAY);
    const key = `org1/acct1/1/2026-W41/mK${++n}`;
    const url = `${b.base}/bucket/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDTEST%2F20261008%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=${amzDate(signedAt)}&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED_M)}&X-Amz-Signature=00`;
    const upload = { key, url, headers: { 'x-amz-checksum-sha256': Buffer.from(body.sha256, 'hex').toString('base64'), 'if-none-match': '*', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': retain } };
    const data = { epoch: 1, period: '2026-W41', retain_until: retain, expires_at: iso(expMs), upload };
    if (o.tamper) o.tamper(data);
    return { ok: true, data };
  };
  return { macRequest, bodies };
}
const mKey = (n) => `org1/acct1/1/2026-W41/mK${n}`;
// A script for every key, kept per key between PUTs (a getter returning a fresh array would replay step one forever).
const perKey = (...steps) => { const m = new Map(); return (k) => { if (!m.has(k)) m.set(k, steps.slice()); return m.get(k); }; };
const manifestBytes = () => crypto.randomBytes(up.MIN_OBJECT + 100);
// The opts a caller passes: the chunks' bucket path (the local bucket's) and a lock end no manifest here outlasts.
// One chunk it names (a key no stub hands out) locked 38 days (a real lock is at most 39), so no manifest here outlasts it.
const oneChunk = (lockedUntilMs, key) => [{ key: key || 'org1/acct1/1/2026-W41/chunk-x', lockedUntilMs: lockedUntilMs === undefined ? Date.now() + 38 * DAY : lockedUntilMs }];
const mOpts = (b, extra) => Object.assign({ bucket: `${new URL(b.base).host}/bucket/`, chunks: oneChunk() }, extra || {});
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('chunks then their manifest: uploadChunks returns each lock end and the bucket, and the manifest is stored there under its SHA-256', async () => {
  const b = await bucket();
  try {
    const cs = [chunk(1), chunk(2)];
    const r = await up.uploadChunks(deps(coordinator(b)), cs);
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.bucket, `${new URL(b.base).host}/bucket/`);
    for (const x of cs) assert.ok(Number.isFinite(r.lockedUntil.get(x.name)), 'each chunk has its lock end');
    const m = manifestBytes();
    // The real coordinator locks every object of a period to ONE date; the stubs each round their own clock, so a
    // second boundary between the two grants would lock the manifest a second past its chunks (review 9: 1 in 80).
    // The manifest stub therefore locks to the chunks' own date, as the coordinator does.
    const mc = manifestCoordinator(b, { retainMs: () => Math.min(...r.lockedUntil.values()) });
    const mr = await up.uploadManifest(deps(mc), m, { bucket: r.bucket, chunks: cs.map((x) => ({ key: r.keys.get(x.name), lockedUntilMs: r.lockedUntil.get(x.name) })) });
    assert.strictEqual(mr.ok, true, mr.because);
    assert.strictEqual(mr.key, mKey(1));
    assert.strictEqual(mr.sha256, sha256hex(m));
    assert.ok(b.stored.get(mKey(1)).equals(m));
    assert.strictEqual(mc.bodies.length, 1);
    assert.deepStrictEqual(Object.keys(mc.bodies[0]).sort(), ['nonce', 'sha256', 'size']);
    assert.strictEqual(mc.bodies[0].sha256, sha256hex(m));
    assert.strictEqual(mc.bodies[0].size, m.length);
    assert.match(mc.bodies[0].nonce, /^[0-9a-f]{32}$/);
  } finally { await b.close(); }
});

test('the local bucket checks x-amz-checksum-sha256 as S3 does (CONTROL: other bytes get 400 BadDigest)', async () => {
  const b = await bucket();
  try {
    const m = manifestBytes();
    const r = await fetch(`${b.base}/bucket/x`, { method: 'PUT', headers: { 'x-amz-checksum-sha256': sha256b(Buffer.from('other')) }, body: m });
    assert.strictEqual(r.status, 400);
    assert.match(await r.text(), /BadDigest/);
  } finally { await b.close(); }
});

test('a manifest grant that does not bind OUR bytes, or is not bound the manifest way, is refused before anything is sent', async () => {
  const cases = [
    ['another SHA-256', (d) => { d.upload.headers['x-amz-checksum-sha256'] = sha256b(Buffer.from('x')); }, /does not bind this manifest's SHA-256/],
    ['content-md5 in place of the checksum', (d) => { delete d.upload.headers['x-amz-checksum-sha256']; d.upload.headers['content-md5'] = md5(Buffer.from('x')); }, /may not \(content-md5\)/],
    ['the checksum not signed', (d) => { d.upload.url = d.upload.url.replace(encodeURIComponent(SIGNED_M), encodeURIComponent(SIGNED)); }, /does not sign x-amz-checksum-sha256/],
    ['not write-once', (d) => { d.upload.headers['if-none-match'] = 'x'; }, /not write-once/],
    ['a GOVERNANCE lock', (d) => { d.upload.headers['x-amz-object-lock-mode'] = 'GOVERNANCE'; }, /not a COMPLIANCE lock/],
    ['another length listed', (d) => { d.upload.headers['content-length'] = '5'; }, /does not bind this manifest's length/],
    ['an uploads array (the chunk shape)', (d) => { d.uploads = [d.upload]; delete d.upload; }, /has no upload/],
    ['a url without its key', (d) => { d.upload.key = 'other/key'; }, /does not carry its key/],
  ];
  for (const [what, tamper, why] of cases) {
    const b = await bucket();
    try {
      const r = await up.uploadManifest(deps(manifestCoordinator(b, { tamper })), manifestBytes(), mOpts(b));
      assert.strictEqual(r.ok, false, what);
      assert.match(r.because, why, what);
      assert.strictEqual(b.puts, 0, `${what}: a byte was sent`);
    } finally { await b.close(); }
  }
});

test('a manifest grant naming another bucket than its chunks is refused before anything is sent', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { bucket: 's3.us-east-1.amazonaws.com/other/' }));
    assert.strictEqual(r.ok, false);
    assert.match(r.because, /another bucket/);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a manifest locked past the earliest chunk it names is refused before its PUT; locked exactly to it is stored (CONTROL)', async () => {
  const floor = Math.floor((Date.now() + 35 * DAY) / 1000) * 1000;   // whole seconds, as an ISO lock date carries
  for (const [what, retain, ok] of [['one second past', floor + 1000, false], ['exactly at', floor, true]]) {
    const b = await bucket();
    try {
      const mc = manifestCoordinator(b, { retainMs: () => retain });
      const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(floor) }));
      assert.strictEqual(r.ok, ok, `${what}: ${r.because}`);
      if (!ok) { assert.strictEqual(r.outlastsChunks, true); assert.strictEqual(r.grantSpent, true); assert.strictEqual(b.puts, 0, `${what}: a byte was sent`); assert.strictEqual(mc.bodies.length, 1); }
      else assert.strictEqual(r.lockedUntilMs, floor);
    } finally { await b.close(); }
  }
});

test('chunks whose lock ends within 30 days are refused before any grant is asked for (no allowance spent)', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(Date.now() + 29 * DAY) }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.outlastsChunks, true);
    assert.strictEqual(r.grantSpent, false);
    assert.strictEqual(mc.bodies.length, 0, 'a grant was asked for');
    // CONTROL: 31 days asks. The stub would lock 33 days out, past this floor, so it is told to lock just UNDER 31 days
    // (the grant's start + 31 d - 60 s): the post-grant check then passes and the manifest is stored.
    const ok = await up.uploadManifest(deps(manifestCoordinator(b, { retainMs: (e) => e - 15 * 60 * 1000 + 31 * DAY - 60 * 1000 })), manifestBytes(), mOpts(b, { chunks: oneChunk(Date.now() + 31 * DAY) }));
    assert.strictEqual(ok.ok, true, ok.because);
  } finally { await b.close(); }
});

test('a manifest call without its bucket or a usable list of its chunks, or outside the size range, asks for nothing', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const cases = [
      [manifestBytes(), { chunks: oneChunk() }, /no bucket/],
      [manifestBytes(), { bucket: mOpts(b).bucket }, /no list of the manifest's chunks/],
      [manifestBytes(), mOpts(b, { chunks: null }), /no list of the manifest's chunks/],
      [manifestBytes(), mOpts(b, { chunks: [] }), /at least one chunk/],
      [manifestBytes(), mOpts(b, { chunks: [{ key: 'org1/k' }] }), /no lock end for the manifest's chunk org1\/k/],
      [manifestBytes(), mOpts(b, { chunks: oneChunk(NaN) }), /no lock end/],
      [crypto.randomBytes(up.MIN_OBJECT - 1), mOpts(b), /outside/],
      ['not bytes', mOpts(b), /not bytes/],
    ];
    for (const [bytes, opts, why] of cases) {
      const r = await up.uploadManifest(deps(mc), bytes, opts);
      assert.strictEqual(r.ok, false); assert.match(r.because, why);
    }
    assert.strictEqual(mc.bodies.length, 0);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a manifest 412 on the FIRST attempt is refused; after a lost answer it counts as stored', async () => {
  for (const [what, script, ok] of [
    ['first attempt', [[412, '<Error><Code>PreconditionFailed</Code></Error>']], false],
    ['after a 500', [[500], [412, '<Error><Code>PreconditionFailed</Code></Error>']], true],
  ]) {
    const b = await bucket();
    try {
      const mc = manifestCoordinator(b);
      b.script.set(mKey(1), script.slice());
      const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
      assert.strictEqual(r.ok, ok, `${what}: ${r.because}`);
      assert.strictEqual(mc.bodies.length, 1, `${what}: asked for another grant`);
      if (ok) assert.strictEqual(r.key, mKey(1));
    } finally { await b.close(); }
  }
});

test('manifest bucket trouble is retried on the SAME url until expiry, then ends retryLater naming the key, with one grant', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    b.script.get = () => [[503, '<Error><Code>SlowDown</Code></Error>']];
    const r = await up.uploadManifest(deps(mc, clock()), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retryLater, true);
    assert.deepStrictEqual(r.unsure, [{ key: mKey(1) }]);
    assert.strictEqual(mc.bodies.length, 1);
    assert.ok(b.puts > 5, `retried only ${b.puts} times`);
  } finally { await b.close(); }
});

test('a manifest grant that expired cleanly gets a NEW grant with a fresh nonce; bounded at MAX_REGRANTS more', async () => {
  const expired = [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>'];
  const rt = [400, '<Error><Code>RequestTimeout</Code></Error>'];
  let b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    // A real expiry follows an attempt that got no further (a RequestTimeout): an expiry on the FIRST attempt is a
    // clock disagreement and is not re-granted (its own test).
    b.script.set(mKey(1), [rt, expired]);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(r.key, mKey(2));
    assert.strictEqual(mc.bodies.length, 2);
    assert.notStrictEqual(mc.bodies[0].nonce, mc.bodies[1].nonce);
  } finally { await b.close(); }
  b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    b.script.get = perKey(rt, expired);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retryLater, true);
    assert.strictEqual(mc.bodies.length, up.MAX_REGRANTS + 1);
  } finally { await b.close(); }
});

test('a lost manifest answer, then S3 says the grant expired: no new grant (no second locked manifest), retryLater', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    b.script.set(mKey(1), [[500], [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retryLater, true);
    assert.deepStrictEqual(r.unsure, [{ key: mKey(1) }]);
    assert.strictEqual(mc.bodies.length, 1);
  } finally { await b.close(); }
});

test('manifest grant refusals: replayed once is retried with a fresh nonce; quota ends retryLater; a refused PUT stops', async () => {
  let b = await bucket();
  try {
    const mc = manifestCoordinator(b, { refuse: ['refused (HTTP 401 on /v1/org/backup/manifest, code replayed)'] });
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, true, r.because);
    assert.strictEqual(mc.bodies.length, 2);
    assert.notStrictEqual(mc.bodies[0].nonce, mc.bodies[1].nonce);
    const q = await up.uploadManifest(deps(manifestCoordinator(b, { refuse: ['refused (HTTP 429 on /v1/org/backup/manifest, code backup_quota)'] })), manifestBytes(), mOpts(b));
    assert.strictEqual(q.ok, false); assert.strictEqual(q.retryLater, true); assert.strictEqual(q.code, 'backup_quota');
  } finally { await b.close(); }
  b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    b.script.set(mKey(1), [[400, '<Error><Code>BadDigest</Code></Error>']]);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.match(r.because, /refused the manifest \(HTTP 400 BadDigest\)/);
    assert.strictEqual(r.retryLater, undefined);
    assert.strictEqual(mc.bodies.length, 1);
  } finally { await b.close(); }
});

test('a manifest grant expiring far further ahead than a grant lasts (a clock far off) is refused before any PUT', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadManifest(deps(manifestCoordinator(b, { expiresAt: Date.now() + 3 * 60 * 60 * 1000 })), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.match(r.because, /clocks is wrong/);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('an unreachable bucket for the manifest is retried until expiry, then ends retryLater with no unsure key and ONE grant', async () => {
  const b = await bucket();
  const base = b.base; await b.close();   // nothing listens there now (not port 1: fetch blocks it as a bad port)
  const mc = manifestCoordinator({ base });
  const r = await up.uploadManifest(deps(mc, clock()), manifestBytes(), { bucket: `${new URL(base).host}/bucket/`, chunks: oneChunk() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.retryLater, true);
  assert.match(r.because, /could not be reached/);
  assert.strictEqual(r.unsure, undefined);
  assert.strictEqual(mc.bodies.length, 1, 'a new grant spent manifest allowance on a bucket it could not reach');
});

test('a manifest grant naming one of its chunks\' keys, or a key an earlier manifest grant gave, is refused before any PUT', async () => {
  let b = await bucket();
  try {
    const r = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { chunks: [...oneChunk(undefined, keyN(9)), ...oneChunk(undefined, mKey(1))] }));
    assert.strictEqual(r.ok, false); assert.match(r.because, /must not write/);
    assert.strictEqual(b.puts, 0);
    // CONTROL: other chunk keys pass.
    const ok = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { chunks: new Set(oneChunk(undefined, keyN(9))) }));
    assert.strictEqual(ok.ok, true, ok.because);
    const bad = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { chunks: 'org1/acct1' }));
    assert.strictEqual(bad.ok, false); assert.match(bad.because, /no list of the manifest's chunks/);
    // uploadChunks' keys Map itself (not its values) would iterate [name, key] pairs and never match: refused.
    const asMap = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { chunks: new Map([['n', { key: mKey(1), lockedUntilMs: Date.now() + 40 * DAY }]]) }));
    assert.strictEqual(asMap.ok, false); assert.match(asMap.because, /no list of the manifest's chunks/);
    const pairs = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { chunks: [['n', mKey(1)]] }));
    assert.strictEqual(pairs.ok, false); assert.match(pairs.because, /not all \{ key, lockedUntilMs \}/);
    assert.strictEqual(b.puts, 1, 'only the control PUT');
  } finally { await b.close(); }
  b = await bucket();
  try {
    // A re-grant (after a clean expiry) that repeats the first grant's key.
    let n = 0;
    const mc = manifestCoordinator(b, { tamper: (d) => { if (++n === 2) { d.upload.key = mKey(1); d.upload.url = d.upload.url.replace('mK2', 'mK1'); } } });
    b.script.set(mKey(1), [[400, '<Error><Code>RequestTimeout</Code></Error>'], [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>'], [500], [412, '<Error><Code>PreconditionFailed</Code></Error>']]);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.match(r.because, /must not write/);
    assert.strictEqual(mc.bodies.length, 2);
    assert.strictEqual(b.puts, 2, 'the first grant\'s two attempts only; nothing under the repeated key');
  } finally { await b.close(); }
});

test('each chunk reports the lock date its OWN upload signed, stored by a 200 or through a 412 after a lost answer', async () => {
  const b = await bucket();
  try {
    // Two chunks, each signed a DIFFERENT lock date, so a lock end taken from the wrong upload (or made up) fails.
    // Chunk 1 is stored through a 412 after a 503 (present), chunk 2 by a plain 200.
    b.script.set(keyN(1), [[503], [412, '<Error><Code>PreconditionFailed</Code></Error>']]);
    const signed = [];
    const c = coordinator(b, { tamper: (d) => {
      d.uploads.forEach((u, i) => {
        const t = Date.parse(u.headers['x-amz-object-lock-retain-until-date']) + i * 86400 * 1000;
        u.headers['x-amz-object-lock-retain-until-date'] = iso(t);
        signed.push(t);
      });
    } });
    const cs = [chunk(1), chunk(2)];
    const r = await up.uploadChunks(deps(c), cs);
    assert.strictEqual(r.ok, true, r.because);
    assert.notStrictEqual(signed[0], signed[1]);
    assert.strictEqual(r.lockedUntil.get(cs[0].name), signed[0], 'present: not the lock date its own upload signed');
    assert.strictEqual(r.lockedUntil.get(cs[1].name), signed[1], 'stored: not the lock date its own upload signed');
  } finally { await b.close(); }
});

test('a refused manifest PUT names the key as unsure only when an earlier attempt may have written it', async () => {
  for (const [what, script, unsure] of [
    ['first attempt refused', [[400, '<Error><Code>BadDigest</Code></Error>']], undefined],
    ['refused after a 500 (a write that may have landed)', [[500], [400, '<Error><Code>BadDigest</Code></Error>']], [{ key: mKey(1) }]],
  ]) {
    const b = await bucket();
    try {
      const mc = manifestCoordinator(b);
      b.script.set(mKey(1), script.slice());
      const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
      assert.strictEqual(r.ok, false, what);
      assert.match(r.because, /refused the manifest/, what);
      assert.deepStrictEqual(r.unsure, unsure, what);
      assert.strictEqual(mc.bodies.length, 1, `${what}: asked for another grant`);
    } finally { await b.close(); }
  }
});

test('the pre-grant floor counts the grant window: chunks locked until now + 30 days + 10 minutes are refused with no grant; + 30 days + 30 minutes asks (no clock margin: a correct manifest in a period\'s last hour)', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(Date.now() + 30 * DAY + 10 * 60 * 1000) }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.outlastsChunks, true); assert.strictEqual(r.grantSpent, false);
    assert.strictEqual(mc.bodies.length, 0);
    // CONTROL: 30 days + 30 minutes is what a chunk granted earlier in a period ending 15 minutes from now carries;
    // its manifest is valid, so a grant is asked for (the stub then locks it 33 days out and the post-grant check
    // refuses it, after the grant).
    const asked = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(Date.now() + 30 * DAY + 30 * 60 * 1000) }));
    assert.strictEqual(mc.bodies.length, 1);
    assert.strictEqual(asked.outlastsChunks, true); assert.strictEqual(asked.grantSpent, true);
  } finally { await b.close(); }
});

test('the manifest takes the EARLIEST lock end among its chunks itself (a later chunk listed first does not raise it)', async () => {
  const b = await bucket();
  try {
    const floor = Math.floor((Date.now() + 35 * DAY) / 1000) * 1000;
    const mc = manifestCoordinator(b, { retainMs: () => floor + 1000 });
    const chunks = [...oneChunk(floor + 2 * DAY, 'org1/acct1/1/2026-W41/late'), ...oneChunk(floor, 'org1/acct1/1/2026-W41/early')];
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.outlastsChunks, true); assert.strictEqual(r.grantSpent, true);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('the manifest bytes are copied on entry: changing the caller\'s buffer during the call does not change what is sent', async () => {
  const b = await bucket();
  try {
    const m = manifestBytes();
    const sent = Buffer.from(m);
    const mc = manifestCoordinator(b);
    const real = mc.macRequest;
    mc.macRequest = async (...a) => { const r = await real(...a); m.fill(7); return r; };   // the caller reuses its buffer
    const r = await up.uploadManifest(deps(mc), m, mOpts(b));
    assert.strictEqual(r.ok, true, r.because);
    assert.ok(b.stored.get(mKey(1)).equals(sent));
  } finally { await b.close(); }
});

test('a chunk lock end later than any grant can set (a wrong unit, or not a lock date) is refused before any grant', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    for (const bad of [(Date.now() + 38 * DAY) * 1000, Date.now() + 40 * DAY]) {
      const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: [...oneChunk(), ...oneChunk(bad, 'org1/acct1/1/2026-W41/bad')] }));
      assert.strictEqual(r.ok, false); assert.match(r.because, /later than any lock a grant can set/);
    }
    assert.strictEqual(mc.bodies.length, 0);
    // CONTROL: 39 days (the most a grant sets) asks.
    const ok = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(Date.now() + 39 * DAY) }));
    assert.strictEqual(ok.ok, true, ok.because);
  } finally { await b.close(); }
});

test('a bucket that is not host/ or host/bucket/ is refused before any grant; every refusal after a grant says grantSpent', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    for (const bad of ['kosmos-backup', 'host', 'https://h/b/', 'h/b/c/']) {
      const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { bucket: bad }));
      assert.strictEqual(r.ok, false, bad); assert.match(r.because, /not a bucket path/, bad);
    }
    assert.strictEqual(mc.bodies.length, 0);
    // After a grant: another bucket (a parse refusal), a reused key, a clock far off.
    const other = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { bucket: 's3.us-east-1.amazonaws.com/other/' }));
    assert.strictEqual(other.grantSpent, true);
    const reused = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b, { chunks: oneChunk(undefined, mKey(1)) }));
    assert.strictEqual(reused.grantSpent, true);
    const skew = await up.uploadManifest(deps(manifestCoordinator(b, { expiresAt: Date.now() + 3 * 60 * 60 * 1000 })), manifestBytes(), mOpts(b));
    assert.strictEqual(skew.grantSpent, true);
    // CONTROL: a refusal before any grant does not.
    for (const opts of [mOpts(b, { chunks: [] }), mOpts(b, { bucket: 'x' }), mOpts(b, { chunks: oneChunk(Date.now() + 29 * DAY) })]) {
      const none = await up.uploadManifest(deps(mc), manifestBytes(), opts);
      assert.strictEqual(none.ok, false); assert.strictEqual(none.grantSpent, false, none.because);
    }
    const notBytes = await up.uploadManifest(deps(mc), 'x', mOpts(b));
    assert.strictEqual(notBytes.grantSpent, false);
    // A grant request refused outright (no answer we accepted): absent, since it may still have been spent.
    const q = await up.uploadManifest(deps(manifestCoordinator(b, { refuse: ['refused (HTTP 429 on /v1/org/backup/manifest, code backup_quota)'] })), manifestBytes(), mOpts(b));
    assert.strictEqual(q.ok, false); assert.strictEqual(q.grantSpent, undefined);
  } finally { await b.close(); }
});

test('every manifest exit after a grant answered says grantSpent: a refused PUT, trouble, an unreachable bucket, the re-grant cap', async () => {
  const expired = [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>'];
  const rt = [400, '<Error><Code>RequestTimeout</Code></Error>'];
  let b = await bucket();
  try {
    b.script.set(mKey(1), [[400, '<Error><Code>BadDigest</Code></Error>']]);
    const refused = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b));
    assert.match(refused.because, /refused the manifest/); assert.strictEqual(refused.grantSpent, true);
    b.script.get = () => [[503]];
    const trouble = await up.uploadManifest(deps(manifestCoordinator(b), clock()), manifestBytes(), mOpts(b));
    assert.strictEqual(trouble.retryLater, true); assert.ok(trouble.unsure); assert.strictEqual(trouble.grantSpent, true);
    b.script.get = perKey(rt, expired);
    const cap = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b));
    assert.match(cap.because, /grants in a row/); assert.strictEqual(cap.grantSpent, true);
  } finally { await b.close(); }
  b = await bucket();
  const base = b.base; await b.close();
  const unreached = await up.uploadManifest(deps(manifestCoordinator({ base }), clock()), manifestBytes(), { bucket: `${new URL(base).host}/bucket/`, chunks: oneChunk() });
  assert.match(unreached.because, /could not be reached/); assert.strictEqual(unreached.grantSpent, true);
});

test('a manifest that met one connect failure and then reached the bucket is not "could not be reached", and re-grants', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const r = await up.uploadManifest(deps(mc, Object.assign({ fetch: blipThenIncomplete() }, clock())), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false);
    assert.doesNotMatch(r.because, /could not be reached/, 'a bucket that answered was reported unreachable');
    assert.ok(mc.bodies.length > 1, `a reachable bucket got no second manifest grant (${mc.bodies.length})`);
    assert.strictEqual(r.unsure, undefined);
  } finally { await b.close(); }
});

test('a bucket path with an upper-case host is refused before any grant (a URL host is always lower case)', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { bucket: 'S3.us-east-1.amazonaws.com/b1/' }));
    assert.strictEqual(r.ok, false); assert.match(r.because, /not a bucket path/);
    assert.strictEqual(mc.bodies.length, 0);
  } finally { await b.close(); }
});

test('a manifest grant already over an hour expired by this computer\'s clock (a clock far ahead) is refused before any PUT', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadManifest(deps(manifestCoordinator(b, { expiresAt: Date.now() - 2 * 60 * 60 * 1000 })), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.match(r.because, /over an hour past the grant's expiry/);
    assert.strictEqual(r.grantSpent, true);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a chunk lock end in seconds (before 2020 as milliseconds) is refused as the wrong unit, not as chunks gone', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(Math.floor((Date.now() + 35 * DAY) / 1000)) }));
    assert.strictEqual(r.ok, false); assert.match(r.because, /before 2020: not a lock date in milliseconds/);
    assert.strictEqual(r.outlastsChunks, undefined);
    assert.strictEqual(mc.bodies.length, 0);
  } finally { await b.close(); }
});

test('a chunk grant refused for its clock says grantSpent, like a chunk grant that fails its checks', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadChunks(deps(coordinator(b, { expiresAt: Date.now() + 3 * 60 * 60 * 1000 })), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /clocks is wrong/); assert.strictEqual(r.grantSpent, true);
    const bad = await up.uploadChunks(deps(coordinator(b, { tamper: (d) => { d.uploads[0].headers['if-none-match'] = 'x'; } })), [chunk(2)]);
    assert.strictEqual(bad.ok, false); assert.strictEqual(bad.grantSpent, true);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a bucket path with a port is refused before any grant outside the test seam (checkOne would refuse it after)', async () => {
  up.allowHttpForTests(false);
  try {
    let asked = 0;
    const r = await up.uploadManifest({ macRequest: async () => { asked++; return { ok: false, because: 'x' }; }, fetch, sleep: async () => {} },
      crypto.randomBytes(up.MIN_OBJECT), { bucket: 's3.us-east-1.amazonaws.com:443/b1/', chunks: oneChunk() });
    assert.strictEqual(r.ok, false); assert.match(r.because, /not a bucket path/); assert.strictEqual(asked, 0);
    // CONTROL: without the port it asks.
    await up.uploadManifest({ macRequest: async () => { asked++; return { ok: false, because: 'x' }; }, fetch, sleep: async () => {} },
      crypto.randomBytes(up.MIN_OBJECT), { bucket: 's3.us-east-1.amazonaws.com/b1/', chunks: oneChunk() });
    assert.strictEqual(asked, 1);
  } finally { up.allowHttpForTests(true); }
});

test('an unexpected throw after a write that may have landed still reports grantSpent and the unsure key', async () => {
  const b = await bucket();
  try {
    b.script.set(mKey(1), [[500]]);
    const r = await up.uploadManifest(deps(manifestCoordinator(b), { sleep: async () => { throw new Error('boom'); } }), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.match(r.because, /manifest uploader failed: boom/);
    assert.strictEqual(r.grantSpent, true);
    assert.deepStrictEqual(r.unsure, [{ key: mKey(1) }]);
  } finally { await b.close(); }
  // CONTROL: a throw that escapes before any grant (deps.now, which askSigned does not wrap) reaches the same catch
  // and reports no spend (grantSpent false) and no unsure key.
  let asked = 0;
  const r2 = await up.uploadManifest({ macRequest: async () => { asked++; return { ok: false, because: 'x' }; }, fetch, sleep: async () => {}, now: () => { throw new Error('early'); } },
    manifestBytes(), { bucket: '127.0.0.1:1/bucket/', chunks: oneChunk() });
  assert.strictEqual(r2.ok, false); assert.match(r2.because, /manifest uploader failed: early/);
  assert.strictEqual(asked, 0);
  assert.strictEqual(r2.grantSpent, false); assert.strictEqual(r2.unsure, undefined);
});

test('a re-grant request that fails after a grant ran out cleanly still says grantSpent (the first grant answered)', async () => {
  const b = await bucket();
  try {
    let n = 0;
    const mc = manifestCoordinator(b);
    const real = mc.macRequest;
    mc.macRequest = async (...a) => (++n === 1 ? real(...a) : { ok: false, because: 'refused (HTTP 429 on /v1/org/backup/manifest, code backup_quota)' });
    b.script.set(mKey(1), [[400, '<Error><Code>RequestTimeout</Code></Error>'], [403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']]);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'backup_quota');
    assert.strictEqual(r.grantSpent, true);
    assert.match(r.because, /^an earlier manifest grant ran out with nothing stored, then refused/);
    assert.strictEqual(n, 2);
  } finally { await b.close(); }
});

test('a manifest key under another <org>/<account> than its chunks is refused before its PUT; chunks under two owners are refused before any grant', async () => {
  let b = await bucket();
  try {
    const mc = manifestCoordinator(b, { tamper: (d) => { d.upload.key = d.upload.key.replace('org1/acct1/', 'org1/acct2/'); d.upload.url = d.upload.url.replace('org1/acct1/', 'org1/acct2/'); } });
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.match(r.because, /not under its chunks' path \(org1\/acct1\/\)/);
    assert.strictEqual(r.grantSpent, true); assert.strictEqual(b.puts, 0);
    // CONTROL: the same key layout under the chunks' own path is stored.
    const ok = await up.uploadManifest(deps(manifestCoordinator(b)), manifestBytes(), mOpts(b));
    assert.strictEqual(ok.ok, true, ok.because);
  } finally { await b.close(); }
  b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const two = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: [...oneChunk(undefined, 'org1/acct1/1/W/a'), ...oneChunk(undefined, 'org1/acct2/1/W/b')] }));
    assert.strictEqual(two.ok, false); assert.match(two.because, /not all under one <org>\/<account> path/); assert.strictEqual(two.grantSpent, false);
    const short = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(undefined, 'org1/a') }));
    assert.strictEqual(short.ok, false); assert.match(short.because, /not all under one/);
    assert.strictEqual(mc.bodies.length, 0);
  } finally { await b.close(); }
});

test('an unexpected throw before any grant was asked for says grantSpent: false; a parser throwing on an answer says true', async () => {
  // now() throws on its first call (the plausibility check), before any grant.
  const r = await up.uploadManifest({ macRequest: async () => ({ ok: false, because: 'x' }), fetch, sleep: async () => {}, now: () => { throw new Error('early'); } },
    manifestBytes(), { bucket: '127.0.0.1:1/bucket/', chunks: oneChunk() });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.grantSpent, false);
  // The parser throwing on the grant's answer: a grant answered, so it is a refusal of that answer, grantSpent true.
  const b = await bucket();
  try {
    const r2 = await up.uploadManifest(deps({ macRequest: async () => ({ ok: true, data: { get expires_at() { throw new Error('bad answer'); } } }) }), manifestBytes(), mOpts(b));
    assert.strictEqual(r2.ok, false); assert.match(r2.because, /grant answer could not be read: bad answer/);
    assert.strictEqual(r2.grantSpent, true);
  } finally { await b.close(); }
});

test('a failed chunk run still reports each STORED chunk\'s lock end and the bucket, and grantSpent when any grant answered', async () => {
  const b = await bucket();
  try {
    // Chunk 1 stores; chunk 2 is refused (a 400), so the run fails with chunk 1 stored.
    b.script.set(keyN(2), [[400, '<Error><Code>BadDigest</Code></Error>']]);
    const cs = [chunk(1), chunk(2)];
    const r = await up.uploadChunks(deps(coordinator(b), { }), cs, { concurrency: 1 });
    assert.strictEqual(r.ok, false);
    assert.ok(r.keys.has(cs[0].name) && !r.keys.has(cs[1].name));
    assert.ok(Number.isFinite(r.lockedUntil.get(cs[0].name)), 'no lock end for the stored chunk');
    assert.ok(!r.lockedUntil.has(cs[1].name));
    assert.strictEqual(r.bucket, `${new URL(b.base).host}/bucket/`);
    assert.strictEqual(r.grantSpent, true);
    // A re-grant request that fails after a grant ran out cleanly: grantSpent still true (call-wide, as for a manifest).
    let n = 0;
    const c2 = coordinator(b, { tag: 'r' });
    const real = c2.macRequest;
    c2.macRequest = async (...a) => (++n === 1 ? real(...a) : { ok: false, because: 'refused (HTTP 429 on /v1/org/backup/grant, code backup_quota)' });
    b.script.get = () => [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']];
    const q = await up.uploadChunks(deps(c2), [chunk(3)]);
    assert.strictEqual(q.ok, false); assert.strictEqual(q.code, 'backup_quota'); assert.strictEqual(q.grantSpent, true);
    // CONTROL: a run whose only grant request is refused outright spent nothing it knows of: absent.
    const none = await up.uploadChunks(deps(coordinator(b, { refuse: ['refused (HTTP 429 on /v1/org/backup/grant, code backup_quota)'] })), [chunk(4)]);
    assert.strictEqual(none.ok, false); assert.strictEqual(none.grantSpent, undefined); assert.strictEqual(none.bucket, null);
  } finally { await b.close(); }
});

test('the production bucket shape (virtual-hosted, test seam off) passes the manifest bucket checks; another bucket does not', async () => {
  const b = await bucket();
  const bytes = manifestBytes();
  let data;
  await manifestCoordinator(b, { tamper: (d) => { data = d; } }).macRequest('POST', up.MANIFEST_ROUTE, { sha256: sha256hex(bytes), size: bytes.length });
  await b.close();
  // Rewrite the stub's path-style local url to a virtual-hosted S3 url: https://bkt1.s3.us-east-1.amazonaws.com/<key>?...
  const u = new URL(data.upload.url);
  data.upload.url = `https://bkt1.s3.us-east-1.amazonaws.com/${data.upload.key.split('/').map(encodeURIComponent).join('/')}${u.search}`;
  up.allowHttpForTests(false);
  try {
    assert.strictEqual(up.parseManifestGrant(data, bytes, 'bkt1.s3.us-east-1.amazonaws.com/').ok, true);
    assert.match(up.parseManifestGrant(data, bytes, 'bkt2.s3.us-east-1.amazonaws.com/').because, /another bucket/);
    // And the pre-grant bucket shape accepts host/ (asks for a grant).
    let asked = 0;
    await up.uploadManifest({ macRequest: async () => { asked++; return { ok: false, because: 'x' }; }, fetch, sleep: async () => {} },
      bytes, { bucket: 'bkt1.s3.us-east-1.amazonaws.com/', chunks: oneChunk() });
    assert.strictEqual(asked, 1);
  } finally { up.allowHttpForTests(true); }
});

test('a manifest grant already out of time before any attempt (a slow answer) ends retryLater with no re-grant', async () => {
  const b = await bucket();
  try {
    const ck = clock();
    const mc = manifestCoordinator(b);
    const real = mc.macRequest;
    mc.macRequest = async (...a) => { const r = await real(...a); await ck.sleep(15 * 60 * 1000); return r; };   // the answer takes the grant's whole life
    const r = await up.uploadManifest(deps(mc, ck), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true); assert.strictEqual(r.grantSpent, true);
    assert.match(r.because, /before a single upload attempt/);
    assert.strictEqual(mc.bodies.length, 1, 'a new grant was asked for');
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('a chunk key with an empty third segment has no owner (refused before any grant)', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b, { chunks: oneChunk(undefined, 'org1/acct1/') }));
    assert.strictEqual(r.ok, false); assert.match(r.because, /not all under one/);
    assert.strictEqual(mc.bodies.length, 0);
  } finally { await b.close(); }
});

test('S3 saying "expired" on the FIRST manifest attempt (a clock disagreement) ends retryLater with no re-grant', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    b.script.get = () => [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']];
    const r = await up.uploadManifest(deps(mc), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true); assert.strictEqual(r.grantSpent, true);
    assert.match(r.because, /expired on the first attempt that reached it/);
    assert.strictEqual(mc.bodies.length, 1);
    assert.strictEqual(b.puts, 1);
  } finally { await b.close(); }
});

test('a chunk run refused before asking for any grant says grantSpent: false', async () => {
  let asked = 0;
  const r = await up.uploadChunks({ macRequest: async () => { asked++; return { ok: false, because: 'x' }; }, fetch, sleep: async () => {} }, [{ name: 'n', object: Buffer.alloc(10) }]);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.grantSpent, false); assert.strictEqual(asked, 0);
});

test('a refusal of the FIRST manifest grant\'s answer does not claim an earlier grant ran out (but still says grantSpent)', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadManifest(deps(manifestCoordinator(b, { tamper: (d) => { d.expires_at = 'not a time'; } })), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.grantSpent, true);
    assert.match(r.because, /^the manifest grant answer has no readable expires_at/);
    assert.doesNotMatch(r.because, /earlier manifest grant/);
  } finally { await b.close(); }
});

test('S3 saying "expired" after only connection failures is still the clock case: retryLater, no re-grant', async () => {
  const b = await bucket();
  try {
    const mc = manifestCoordinator(b);
    b.script.get = () => [[403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>']];
    let n = 0;
    const refusedFirst = async (...a) => {
      if (++n <= 2) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
      return fetch(...a);
    };
    const r = await up.uploadManifest(deps(mc, { fetch: refusedFirst }), manifestBytes(), mOpts(b));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.retryLater, true); assert.strictEqual(r.grantSpent, true);
    assert.match(r.because, /expired on the first attempt that reached it/);
    assert.strictEqual(mc.bodies.length, 1, 'a new grant was asked for');
    assert.strictEqual(n, 3);
  } finally { await b.close(); }
});
