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
 *   - a request for another host name (a page reaching the proxy by DNS rebinding) is refused with 403 and REFUSED.
 * Not covered here: refusing a request from another source address needs a second address this machine does not
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

const fs = require('node:fs');
const PROXY = path.join(__dirname, 'ios', 'store', 'shots-proxy.js');
/* Stands in for the checkout the board runs from: its path is what the board writes into instructions, and its
   web/ is what the product ships (one icon here). */
const CHECKOUT = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-proxy-'));
fs.mkdirSync(path.join(CHECKOUT, 'web', 'icons'), { recursive: true });
fs.writeFileSync(path.join(CHECKOUT, 'web', 'icons', 'kosmos-32.png'), 'png');
const PNG = (res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end('png'); };

const ROUTES = {
  '/api/status': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ connection: { state: 'none', plan: null }, agents: [{ name: 'Cleo' }] })); },
  '/api/agent/cleo/instructions': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: 'Run `' + CHECKOUT + '/install/kosmos task add` or read ' + CHECKOUT + '/web.' })); },
  '/icons/kosmos-32.png': PNG,                 // a file the product ships
  '/api/agent/cleo/avatar': PNG,                // a picture of someone: not a shipped file
  '/files/report.pdf': (res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.7 ...'); },
  // A sibling folder whose name starts with the checkout's: not this checkout, so it must not be swapped.
  '/sibling': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: CHECKOUT + '-other/x' })); },
  '/leak': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ where: os.homedir() + '/Documents' })); },
  '/gzip': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('{"a":1}')); },
  '/stream': (res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: hello\n\n'); setTimeout(() => res.end(), 50); },
  '/chunked': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"a":'); setTimeout(() => res.end('1}'), 20); },
  '/cut': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' }); res.write('{"half":'); setTimeout(() => res.socket.destroy(), 20); },
};

let board, proxy, base, logs = '';

test.before(async () => {
  board = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    (ROUTES[p] || (p.endsWith('.png') ? PNG : (r) => { r.writeHead(404); r.end(); }))(res);
  });
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

/* The proxy's log lines and its answers travel on separate pipes, so wait for the line rather than assume it is in. */
async function logged(re) {
  for (const deadline = Date.now() + 3000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 20))) if (re.test(logs)) return;
  assert.match(logs, re);
}

function get(p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + p, { headers: headers || {} }, (res) => {
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

test('a picture passes only when it is a file the product ships', async () => {
  const icon = await get('/icons/kosmos-32.png');
  assert.equal(icon.status, 200);
  assert.equal(icon.body, 'png');
  const avatar = await get('/api/agent/cleo/avatar');
  assert.equal(avatar.status, 502);
  await logged(/^LEAK \/api\/agent\/cleo\/avatar: a picture or media file that is not one the product ships/m);
});

test('a file that is neither text nor shipped is refused, and a malformed path cannot stop the proxy', async () => {
  assert.equal((await get('/files/report.pdf')).status, 502);
  await logged(/^LEAK \/files\/report\.pdf: an answer that is neither text/m);
  assert.equal((await get('/icons/%E0%A4%A.png')).status, 502);
  assert.equal((await get('/api/status')).status, 200);   // still answering
  assert.equal(proxy.exitCode, null);
});

test('a request for another host name is refused (a page reaching the proxy by DNS rebinding)', async () => {
  const r = await get('/api/status', { host: 'rebind.example:80' });
  assert.equal(r.status, 403);
  await logged(/^REFUSED /m);
  assert.equal((await get('/api/status')).status, 200);   // its own address still answers
});

test('a sibling of the checkout is not swapped', async () => {
  const r = await get('/sibling');
  assert.equal(r.status, 200);   // first, so a guard hit reads as one rather than as a JSON error
  assert.equal(JSON.parse(r.body).text, CHECKOUT + '-other/x');
});

test('an answer carrying this Mac\'s home path is refused and printed as LEAK', async () => {
  const r = await get('/leak');
  assert.equal(r.status, 502);
  assert.ok(!r.body.includes(os.homedir()));
  await logged(/^LEAK \/leak: home:/m);
});

test('an encoded answer and an event stream are refused', async () => {
  assert.equal((await get('/gzip')).status, 502);
  await logged(/^LEAK \/gzip: an encoded answer/m);
  const s = await get('/stream');
  assert.equal(s.status, 502);
  assert.ok(!s.body.includes('hello'));
  await logged(/^LEAK \/stream: a stream/m);
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
  await logged(/^UPSTREAM \/cut:/m);
});
