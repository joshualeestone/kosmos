'use strict';

/**
 * kosmos#7490: the board page is sent compressed to a browser that accepts it, and as it is to one that does not.
 * Over Kosmos+ the 6 MB page crosses the tunnel and the relay to a phone; uncompressed that was most of a minute (#7489).
 *
 * Against the real server with node:http, NOT fetch: fetch decompresses on its own, so a test through it would pass
 * whether or not the bytes on the wire were compressed. Sandbox boilerplate mirrors server.sw-718.test.js.
 *
 *   node --test server.pagecompress-7490.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gzip7490-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const { pickEncoding, makePageCompressor } = require('./engine/pagecompress');
let port;
test.before(async () => { await start(0); port = server.address().port; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function get(pathname, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the page is sent as it is when the request does not accept compression', async () => {
  const r = await get('/', {});
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], undefined, 'compressed for a request that did not ask');
  assert.equal(r.headers.vary, 'accept-encoding', 'a cache in between could hand a compressed copy to this browser');
  assert.equal(Number(r.headers['content-length']), r.body.length);
  assert.match(r.body.toString('utf8'), /<\/html>\s*$/);
  assert.ok(r.body.length > 1e6, 'premise: the page is large');
});

test('the page is sent brotli when accepted, and decodes to exactly the plain page', async () => {
  const plain = (await get('/', {})).body;
  const r = await get('/', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(r.headers['content-encoding'], 'br');
  assert.equal(r.headers.vary, 'accept-encoding');
  assert.equal(r.headers['cache-control'], 'no-store', 'an update must still arrive (#271)');
  assert.equal(Number(r.headers['content-length']), r.body.length);
  assert.ok(r.body.length < plain.length / 3, `brotli sent ${r.body.length} bytes of ${plain.length}`);
  assert.ok(zlib.brotliDecompressSync(r.body).equals(plain), 'the decoded page differs from the plain one');
});

test('the page is sent gzip to a browser that accepts gzip and not brotli', async () => {
  const plain = (await get('/', {})).body;
  const r = await get('/', { 'accept-encoding': 'gzip' });
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.ok(zlib.gunzipSync(r.body).equals(plain));
});

test('HEAD says the length GET would send, and sends no body', async () => {
  const br = await get('/', { 'accept-encoding': 'br' });
  const r = await get('/', { 'accept-encoding': 'br' }, 'HEAD');
  assert.equal(r.headers['content-encoding'], 'br');
  assert.equal(Number(r.headers['content-length']), br.body.length);
  assert.equal(r.body.length, 0);
  const plain = await get('/', {});
  const h = await get('/', {}, 'HEAD');
  assert.equal(h.headers['content-encoding'], undefined);
  assert.equal(Number(h.headers['content-length']), plain.body.length);
  assert.equal(h.body.length, 0);
});

test('API answers stay uncompressed, however the request asks (BREACH: caller text beside secrets)', async () => {
  const r = await get('/api/health', { 'accept-encoding': 'gzip, br' });
  assert.equal(r.headers['content-encoding'], undefined, '/api/health came back compressed');
});

test('pickEncoding: brotli first, gzip next, q=0 refuses, * stands for the rest', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0'), null);
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('*;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('BR'), 'br');
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding('deflate'), null);
  assert.equal(pickEncoding('gzip;q=1, br;q=0.1'), 'br', 'brotli whenever accepted, whatever the ranking');
  assert.equal(pickEncoding('br;q=abc, gzip'), 'gzip', 'a q that does not parse refuses');
  assert.equal(pickEncoding('br;q=, gzip;q=.'), null);
});

test('a compression that fails sends the page as it is', async () => {
  const { sendPage } = require('./engine/pagecompress');
  const plain = Buffer.from('<html>plain</html>');
  let head = null; let body = null;
  const res = { writeHead: (s, h) => { head = { s, h }; }, end: (b) => { body = b; }, destroy: () => { head = 'destroyed'; } };
  const said = [];
  const realError = console.error;
  console.error = (line) => { said.push(String(line)); };
  try {
    for (let i = 0; i < 2; i += 1) {
      sendPage({ method: 'GET', headers: { 'accept-encoding': 'br' } }, res, { 'content-type': 'text/html' }, plain, () => Promise.reject(new Error('no memory')));
      await new Promise((r) => setImmediate(r));
    }
  } finally { console.error = realError; }
  assert.equal(head.s, 200);
  assert.equal(head.h['content-encoding'], undefined);
  assert.equal(head.h.vary, 'accept-encoding');
  assert.equal(body, plain);
  assert.equal(said.length, 1, `a failure is said once, not per load: ${JSON.stringify(said)}`);
  assert.match(said[0], /^pagecompress: br compression failed; the page was sent uncompressed: no memory$/);
});

test('a failed compression is tried again on the next request', async () => {
  // Stubs the shared zlib module while the server above is up: safe only because this file's tests run one
  // at a time (node:test's default). Do not give this file `concurrency`.
  const real = zlib.brotliCompress;
  let calls = 0;
  zlib.brotliCompress = (buf, opts, done) => { calls += 1; if (calls === 1) { done(new Error('once')); return; } real(buf, opts, done); };
  try {
    const compressed = makePageCompressor();
    const page = Buffer.from('<html>' + 'c'.repeat(3000) + '</html>');
    await assert.rejects(compressed('br', page));
    await new Promise((r) => setImmediate(r));
    const out = await compressed('br', page);
    assert.ok(zlib.brotliDecompressSync(out).equals(page));
    assert.equal(calls, 2);
  } finally { zlib.brotliCompress = real; }
});

test('the compressor makes each form once per page, and again for a changed page', async () => {
  const compressed = makePageCompressor();
  const a = Buffer.from('<html>' + 'a'.repeat(5000) + '</html>');
  const first = await compressed('br', a);
  assert.equal(await compressed('br', Buffer.from(a)), first, 'the same page was compressed again');
  const b = Buffer.from('<html>' + 'b'.repeat(5000) + '</html>');
  const other = await compressed('br', b);
  assert.notEqual(other, first);
  assert.ok(zlib.brotliDecompressSync(other).equals(b), 'a changed page was served from the old bytes');
  assert.ok(zlib.gunzipSync(await compressed('gzip', b)).equals(b));
});
