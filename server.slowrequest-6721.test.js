'use strict';
/**
 * kosmos#6721: the board logs any request it answers slowly, or never, with its method, path and duration, so the next
 * "Your Mac is not answering" is measured rather than inferred. The path only: a query can carry a token (#1946).
 *
 *   node --test server.slowrequest-6721.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-slowreq6721-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.KOSMOS_SLOW_REQUEST_MS = '1';   // read when server.js loads: every real request below is "slow"

const { start, server, watchSlowRequest, SLOW_REQUEST_MS, safeLogUrl } = require('./server');

test.after(() => { server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* A request and a response the way node's http module shapes the parts this reads. */
function pair(method) {
  const req = { method };
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  return { req, res };
}

test('#6721: a request answered after the limit is logged once, with its method, path, seconds and status', () => {
  const { req, res } = pair('GET');
  let t = 1000;
  const lines = [];
  watchSlowRequest(req, res, '/api/status', { now: () => t, write: (l) => lines.push(l), limitMs: 5000 });
  t += 7360;
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');   // node emits close after finish: still one line
  assert.deepEqual(lines, ['[slow request] GET /api/status took 7.4 s (answered 200)\n']);
});

test('#6721: a request the browser gave up on before an answer is logged as that', () => {
  const { req, res } = pair('GET');
  let t = 0;
  const lines = [];
  watchSlowRequest(req, res, '/api/status', { now: () => t, write: (l) => lines.push(l), limitMs: 5000 });
  t += 10000;
  res.emit('close');   // closed with nothing finished: the client's 10 s limit hit first
  assert.deepEqual(lines, ['[slow request] GET /api/status took 10.0 s (closed before an answer)\n']);
});

test('#6721 CONTROL: a request under the limit writes nothing', () => {
  const { req, res } = pair('GET');
  let t = 0;
  const lines = [];
  watchSlowRequest(req, res, '/api/status', { now: () => t, write: (l) => lines.push(l), limitMs: 5000 });
  t += 4999;
  res.writableFinished = true;
  res.emit('finish');
  assert.deepEqual(lines, []);
});

test('#6721: a path cannot add a line to the log, and a throwing writer never escapes', () => {
  const { req, res } = pair('POST');
  let t = 0;
  const lines = [];
  watchSlowRequest(req, res, '/api/x\nforged line', { now: () => t, write: (l) => lines.push(l), limitMs: 1 });
  t += 2000;
  res.writableFinished = true;
  res.emit('finish');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].split('\n').length, 2, 'the path added a line: ' + JSON.stringify(lines[0]));
  const b = pair('GET');
  watchSlowRequest(b.req, b.res, '/api/y', { now: () => t, write: () => { throw new Error('disk full'); }, limitMs: 1 });
  t += 2000;
  assert.doesNotThrow(() => b.res.emit('close'));
});

test('#6721: the default limit is 5 s, and a set one is read from KOSMOS_SLOW_REQUEST_MS', () => {
  assert.equal(SLOW_REQUEST_MS, 1, 'this file sets KOSMOS_SLOW_REQUEST_MS=1 before loading the server');
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /Number\.isFinite\(v\) && v > 0 \? v : 5000/, 'the default is no longer 5000 ms');
});

test('#6721: the real board logs a request past the limit, by path and never with its query', async () => {
  await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const lines = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => { if (String(chunk).startsWith('[slow request]')) lines.push(String(chunk)); return real(chunk, ...rest); };
  // kosmos#6876: a request answered within one millisecond measures 0 ms, under even the 1 ms limit, so the clock
  // steps a second on every read while this request runs. The threshold itself is pinned by the tests above, and the
  // duration assertion below fails if watchSlowRequest stops reading Date.now (a real request under a second reads "took 0.x s").
  const realNow = Date.now;
  let step = 0;
  Date.now = () => realNow() + 1000 * ++step;
  try {
    const res = await fetch(base + '/api/health?token=SECRET_6721');
    await res.text();
    await new Promise((r) => setTimeout(r, 100));   // finish fires after the body is flushed
  } finally { process.stdout.write = real; Date.now = realNow; }
  const mine = lines.filter((l) => l.includes(' /api/health '));
  assert.equal(mine.length, 1, 'the request was not logged: ' + JSON.stringify(lines));
  assert.match(mine[0], /^\[slow request\] GET \/api\/health took [1-9]\d*\.\d s \(answered 200\)\n$/);
  assert.ok(!lines.join('').includes('SECRET_6721'), 'the query reached the log');
});

test('#6721 (review 1): a slow webhook call never logs its secret, whichever way the path is spelled', () => {
  const secret = 'S3CRET6721abcdefghijklmnopqrstuvwxyz0123456';
  for (const url of ['/hooks/proj1/' + secret, '/hooks/./proj1/' + secret, '/%68ooks/proj1/' + secret, '/hooks/proj1/' + secret + '?token=T0K']) {
    const req = { method: 'POST', url };
    const res = new EventEmitter();
    res.statusCode = 204; res.writableFinished = true;
    let t = 0; const lines = [];
    watchSlowRequest(req, res, url, { now: () => t, write: (l) => lines.push(l), limitMs: 1 });
    t += 6000; res.emit('finish');
    assert.equal(lines.length, 1, url);
    assert.ok(!lines[0].includes(secret) && !lines[0].includes('T0K'), 'the secret reached the log: ' + lines[0]);
  }
  // CONTROL: gateLog's rule is the one applied (a settings route under "webhooks" keeps its path).
  assert.equal(safeLogUrl('/api/project/p1/webhooks'), '/api/project/p1/webhooks');
  assert.equal(safeLogUrl('/hooks/p1/' + secret), '/hooks/REDACTED');
});
