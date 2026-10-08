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

const md5 = (b) => crypto.createHash('md5').update(b).digest('base64');
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
      if (req.headers['content-md5'] !== md5(body)) { res.statusCode = 400; return res.end('<Error><Code>BadDigest</Code></Error>'); }
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
const deps = (c, extra) => Object.assign({ macRequest: c.macRequest, fetch, sleep: async () => {}, allowHttp: true }, extra || {});
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
  for (const [what, tamper] of [
    ['another MD5', (d) => { d.uploads[1].headers['content-md5'] = md5(Buffer.from('other')); }],
    ['a listed Content-Length that is not ours', (d) => { d.uploads[0].headers['Content-Length'] = String(up.MIN_OBJECT + 1 + 7); }],
    ['not write-once', (d) => { delete d.uploads[2].headers['if-none-match']; }],
    ['content-length not signed', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent('content-length;'), ''); }],
    ['content-md5 not signed', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent('content-md5;'), ''); }],
    ['no SignedHeaders at all', (d) => { d.uploads[0].url = d.uploads[0].url.replace(/X-Amz-SignedHeaders=[^&]*&/, ''); }],
    // Distinct url and distinct key, but the url names another object: only the url-to-key check can catch it.
    ['a url that does not carry its key', (d) => { d.uploads[1].key = 'org1/acct1/1/2026-W41/other'; }],
    // Distinct keys, ONE url that ends with both ('.../bucket/<k1>' ends with '/' + 'bucket/<k1>' and '/' + '<k1>'), so
    // the url-to-key check passes both and only the repeated-url check can catch it.
    ['a repeated url', (d) => { d.uploads[1].key = 'bucket/' + d.uploads[0].key; d.uploads[1].url = d.uploads[0].url; }],
    ['one upload short', (d) => { d.uploads.pop(); }],
    ['a repeated key', (d) => { d.uploads[1].key = d.uploads[0].key; }],
    ['no expiry', (d) => { delete d.expires_at; }],
    ['no X-Amz-Signature', (d) => { d.uploads[0].url = d.uploads[0].url.replace('&X-Amz-Signature=00', ''); }],
    ['no X-Amz-Credential', (d) => { d.uploads[0].url = d.uploads[0].url.replace(/&X-Amz-Credential=[^&]*/, ''); }],
    ['an unreadable X-Amz-Date', (d) => { d.uploads[0].url = d.uploads[0].url.replace(/X-Amz-Date=[^&]*/, 'X-Amz-Date=yesterday'); }],
    ['expires_at that disagrees with the signed time', (d) => { d.expires_at = iso(Date.parse(d.expires_at) + 10 * 60 * 1000); }],
    ['a legal hold in the url query', (d) => { d.uploads[0].url += '&x-amz-object-lock-legal-hold=ON'; }],
    ['a multipart uploadId in the url query', (d) => { d.uploads[0].url += '&partNumber=1&uploadId=zz'; }],
    ['a repeated query parameter', (d) => { d.uploads[0].url += '&X-Amz-Expires=900'; }],
    ['a url that outlives a grant (X-Amz-Expires 3600)', (d) => { d.uploads[0].url = d.uploads[0].url.replace('X-Amz-Expires=900', 'X-Amz-Expires=3600'); }],
    ['a url with no X-Amz-Expires', (d) => { d.uploads[0].url = d.uploads[0].url.replace('X-Amz-Expires=900&', ''); }],
    ['a lock of exactly 28 days', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = iso(Date.parse(d.expires_at) - 15 * 60 * 1000 + 28 * 86400 * 1000); }],
    ['a lock of 40 days', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = iso(Date.parse(d.expires_at) - 15 * 60 * 1000 + 40 * 86400 * 1000); }],
    ['an extra header', (d) => { d.uploads[0].headers['x-anything'] = '1'; }],
    ['a Host header', (d) => { d.uploads[0].headers.Host = 'evil.example'; }],
    ['Transfer-Encoding', (d) => { d.uploads[0].headers['Transfer-Encoding'] = 'chunked'; }],
    ['a header twice in another case', (d) => { d.uploads[0].headers['Content-MD5'] = md5(Buffer.from('x')); }],
    // (Caught by the exact lock-mode check; the printable-ASCII rule is defense in depth, not isolable: every allowed
    // header also has an exact-value check.)
    ['a lock mode with CRLF in it', (d) => { d.uploads[0].headers['x-amz-object-lock-mode'] = 'COMPLIANCE\r\nX-Evil: 1'; }],
    ['a GOVERNANCE lock', (d) => { d.uploads[0].headers['x-amz-object-lock-mode'] = 'GOVERNANCE'; }],
    ['no lock mode', (d) => { delete d.uploads[0].headers['x-amz-object-lock-mode']; }],
    ['a lock until 2099', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = '2099-01-01T00:00:00Z'; }],
    ['a 10-day lock', (d) => { d.uploads[0].headers['x-amz-object-lock-retain-until-date'] = iso(Date.now() + 10 * 86400 * 1000); }],
    ['the lock date not signed', (d) => { d.uploads[0].url = d.uploads[0].url.replace(encodeURIComponent(';x-amz-object-lock-retain-until-date'), ''); }],
    ['a numeric-looking string expiry', (d) => { d.expires_at = '1700000000'; }],
  ]) {
    const b = await bucket();
    try {
      const r = await up.uploadChunks(deps(coordinator(b, { tamper })), [chunk(1), chunk(2), chunk(3)]);
      assert.strictEqual(r.ok, false, what);
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
  assert.strictEqual(up.parseGrant(data, [c]).ok, false);
  assert.strictEqual(up.parseGrant(data, [c], true).ok, true);
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

test('an S3 error body is read only up to 8 KB', async () => {
  const b = await bucket();
  try {
    b.script.set(keyN(1), [[400, '<Error><Code>BadDigest</Code></Error>' + 'x'.repeat(2 * 1024 * 1024)]]);
    const r = await up.uploadChunks(deps(coordinator(b)), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /HTTP 400 BadDigest/);
  } finally { await b.close(); }
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
    const at = r.keys.size;
    await new Promise((res) => setTimeout(res, 500));
    assert.strictEqual(r.keys.size, at, 'the keys map changed after the result was returned');
  } finally { await b.close(); }
});

test('the http test seam does nothing outside the test runner', () => {
  const c = chunk(1);
  const data = { expires_at: '2030-01-01T00:15:00Z', uploads: [{ key: 'a/k', url: `http://bucket.example/b/a/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=c&X-Amz-Date=20300101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(SIGNED)}&X-Amz-Signature=00`, headers: { 'content-md5': md5(c.object), 'if-none-match': '*', 'x-amz-object-lock-mode': 'COMPLIANCE', 'x-amz-object-lock-retain-until-date': '2030-02-03T00:00:00Z' } }] };
  const saved = process.env.NODE_TEST_CONTEXT;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    assert.strictEqual(up.parseGrant(data, [c], true).ok, false);
  } finally { if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved; }
  assert.strictEqual(up.parseGrant(data, [c], true).ok, true);
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
    assert.strictEqual(r.ok, false); assert.match(r.because, /bucket path/);
    assert.strictEqual(b.puts, 0);
  } finally { await b.close(); }
});

test('never throws: a throwing injected clock still resolves to ok: false', async () => {
  const b = await bucket();
  try {
    const r = await up.uploadChunks(deps(coordinator(b), { now: () => { throw new Error('clock broke'); } }), [chunk(1)]);
    assert.strictEqual(r.ok, false); assert.match(r.because, /clock broke/);
  } finally { await b.close(); }
});

test('a grant already over when it arrives (a clock ahead of the coordinator) stops the run, with no second grant', async () => {
  const b = await bucket();
  try {
    const c = coordinator(b, { expiresAt: Date.now() - 1000 });
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
