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

test('HEAD says the compressed length and sends no body', async () => {
  const r = await get('/', { 'accept-encoding': 'br' }, 'HEAD');
  assert.equal(r.headers['content-encoding'], 'br');
  assert.ok(Number(r.headers['content-length']) > 0);
  assert.equal(r.body.length, 0);
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
