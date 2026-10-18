'use strict';
/**
 * #6262: ios/store/shots-proxy.js, the address the iPhone app opens for the App Store screenshots, against a stub
 * board. The proxy runs as its own process, as shoot-app.sh runs it, on 127.0.0.1 (so this file's own requests come
 * from the address it answers). The arms pin what the store pictures depend on:
 *   - /api/status says the Claude subscription is connected, and keeps every other field;
 *   - the checkout's path becomes a made-up user's install path, and nothing else in the answer changes;
 *   - an answer carrying this Mac's home path is refused (502) and printed as LEAK, never passed on;
 *   - an encoded answer and an event stream are refused, since neither can be read whole first;
 *   - a chunked answer is sent with its own length and no Transfer-Encoding beside it;
 *   - an answer the board breaks off part way is refused and printed as UPSTREAM.
 * Not covered here: refusing a request from another address needs a second source address this machine does not
 * have; it was measured by hand (curl --interface 127.0.0.1 to the proxy on the network address: 403, REFUSED).
 *
 *   node --test ios.store-shots-proxy-6262.test.js
 */
require('./test-support/tmpscope'); // #4273: first, so any temp dir this file makes is contained and removed on exit
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const PROXY = path.join(__dirname, 'ios', 'store', 'shots-proxy.js');
const CHECKOUT = '/Users/someone/work/a-checkout';   // what the board writes, standing in for this checkout's path

const ROUTES = {
  '/api/status': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ connection: { state: 'none', plan: null }, agents: [{ name: 'Cleo' }] })); },
  '/api/agent/cleo/instructions': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: 'Run `' + CHECKOUT + '/install/kosmos task add` or read ' + CHECKOUT + '/web.' })); },
  '/leak': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ where: os.homedir() + '/Documents' })); },
  '/gzip': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('{"a":1}')); },
  '/stream': (res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: hello\n\n'); setTimeout(() => res.end(), 50); },
  '/chunked': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"a":'); setTimeout(() => res.end('1}'), 20); },
  '/cut': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' }); res.write('{"half":'); setTimeout(() => res.socket.destroy(), 20); },
};

let board, proxy, base, logs = '';

test.before(async () => {
  board = http.createServer((req, res) => (ROUTES[new URL(req.url, 'http://x').pathname] || ((r) => { r.writeHead(404); r.end(); }))(res));
  await new Promise((r) => board.listen(0, '127.0.0.1', r));
  proxy = spawn(process.execPath, [PROXY, '127.0.0.1', 'http://127.0.0.1:' + board.address().port, CHECKOUT], { stdio: ['ignore', 'pipe', 'pipe'] });
  proxy.stderr.on('data', (c) => { logs += c; });
  base = await new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('the proxy did not start: ' + logs)), 10000);
    proxy.stdout.on('data', (c) => { out += c; const m = /^listening (\S+)/m.exec(out); if (m) { clearTimeout(t); resolve(m[1]); } });
  });
});

test.after(async () => {
  if (proxy && proxy.exitCode === null) { proxy.kill(); await new Promise((r) => proxy.once('exit', r)); }
  if (board) await new Promise((r) => board.close(r));
});

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + p, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    }).on('error', reject);
    // A proxy that never answers must fail the arm, not hang the suite.
    req.setTimeout(5000, () => req.destroy(new Error('the proxy did not answer ' + p + ' within 5s')));
  });
}

test('/api/status says connected and keeps every other field', async () => {
  const r = await get('/api/status');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.connection.state, 'connected');
  assert.equal(j.connection.plan, null);
  assert.deepEqual(j.agents, [{ name: 'Cleo' }]);
});

test('the checkout path becomes a made-up install path, and only that changes', async () => {
  const r = await get('/api/agent/cleo/instructions');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.text, 'Run `/Users/you/.local/share/kosmos/bin/kosmos task add` or read /Users/you/.local/share/kosmos/app/web.');
  assert.ok(!r.body.includes(CHECKOUT));
  assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.body));
});

test('an answer carrying this Mac\'s home path is refused and printed as LEAK', async () => {
  const r = await get('/leak');
  assert.equal(r.status, 502);
  assert.ok(!r.body.includes(os.homedir()));
  assert.match(logs, /^LEAK \/leak: home:/m);
});

test('an encoded answer and an event stream are refused', async () => {
  assert.equal((await get('/gzip')).status, 502);
  assert.match(logs, /^LEAK \/gzip: an encoded answer/m);
  const s = await get('/stream');
  assert.equal(s.status, 502);
  assert.ok(!s.body.includes('hello'));
  assert.match(logs, /^LEAK \/stream: a stream/m);
});

test('a chunked answer goes on with its own length and no Transfer-Encoding beside it', async () => {
  const r = await get('/chunked');
  assert.equal(r.status, 200);
  assert.equal(r.body, '{"a":1}');
  assert.equal(r.headers['transfer-encoding'], undefined);
  assert.equal(r.headers['content-length'], '7');
});

test('an answer the board breaks off is refused and printed as UPSTREAM', async () => {
  const r = await get('/cut');
  assert.equal(r.status, 502);
  assert.ok(!r.body.includes('half'));
  assert.match(logs, /^UPSTREAM \/cut:/m);
});
