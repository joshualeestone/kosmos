'use strict';
/*
 * kosmos#7686: a failure after a response's headers went out must never write a second head.
 *
 * At 11:51 CDT on 10-31 Josh's board crashed: the attachment preview route's `.catch(() => sendJson(...))` ran after
 * the headers were sent, `writeHead` threw ERR_HTTP_HEADERS_SENT inside the catch, nothing handled that rejection,
 * and the process ended for every agent and device on the computer. The defect is the shape, not that one line:
 * about two hundred routes answer a failure with `sendJson` from a catch. So `sendJson` itself refuses to write a
 * second head (it ends the broken response instead), and this test forces the failure after the headers, as the card
 * asks, rather than assuming which call threw.
 *
 *   node --test server.headers-twice-7686.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-headers-7686-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-headers-7686-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-headers-7686-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-headers-7686-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-headers-7686-launch-'));
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* Every rejection nobody handled, recorded rather than left to end the process, so the test can say which one. */
const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });

const { start, server, _sendJsonForTest: sendJson, _refuseDownloadForTest: refuseDownload } = require('./server');
const attachments = require('./engine/attachments');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const port = () => server.address().port;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** How many of this process's open descriptors are on `file` (as server.attachment-stream-6734.test.js counts). */
function fdsOn(file) {
  const st = fs.statSync(file);
  let n = 0;
  for (const name of fs.readdirSync('/dev/fd')) {
    try { const f = fs.fstatSync(Number(name)); if (f.dev === st.dev && f.ino === st.ino) n += 1; } catch { /* closed meanwhile */ }
  }
  return n;
}

/** GET a path; resolves with the status, 'cut' when the connection ended without a full answer, or 'hung' when
 *  nothing ended it within 5 s (a head sent with its body never finished, and the socket left open). */
function get(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port(), path: p }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
      res.on('error', () => resolve('cut'));
      res.on('aborted', () => resolve('cut'));
    });
    req.on('error', () => resolve('cut'));
    setTimeout(() => { resolve('hung'); req.destroy(); }, 5000).unref();
  });
}

test('#7686: a preview that fails after its headers went out ends that response, and the board keeps answering', async () => {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(64 * 1024)]);
  const rec = attachments.save('agent', 'ava', { name: 'shot.png', type: 'image/png', bytes });
  // CONTROL: the preview answers normally, so the failure below is the only thing that differs.
  assert.equal(await get(`/api/attachment/${rec.id}/preview`), 200, 'CONTROL: the preview did not answer 200');

  /* The failure, AFTER writeHead: sendFileStream writes the head, then opens the stream outside its own try, so a
     throw here reaches the route's `.catch`, which answers with sendJson on a response whose head is already out. */
  const realCreate = fs.createReadStream;
  let thrown = 0;
  /* Only the call that opens a stream on an already-open descriptor (sendFileStream's), so background work the board
     starts cannot take the injected throw instead (review 1). */
  fs.createReadStream = function (...args) {
    if (thrown === 0 && args[0] === null && args[1] && typeof args[1].fd === 'number') {
      thrown += 1;
      throw Object.assign(new Error('simulated failure after the head'), { code: 'EIO' });
    }
    return realCreate.apply(this, args);
  };
  let first;
  try {
    first = await get(`/api/attachment/${rec.id}/preview`);
  } finally { fs.createReadStream = realCreate; }
  assert.equal(thrown, 1, 'CONTROL: the failure was never injected, so this test proves nothing');
  await wait(50);   // let any rejection from the route's catch surface before reading the record
  assert.deepEqual(
    unhandled.map((e) => String(e && (e.code || e.message))),
    [],
    'a rejection escaped the route (before #7686 this is ERR_HTTP_HEADERS_SENT, which ends the board)'
  );
  // The broken response is ended (cut), never left open and never answered with a second head.
  assert.equal(first, 'cut', 'the response after the failure was ' + first + ', not ended');
  // And the descriptor the stream never took is closed (review 1: surviving the failure must not leak one).
  assert.equal(fdsOn(rec.file), 0, 'the failed preview left ' + fdsOn(rec.file) + ' descriptor(s) open on the file');
  // And the board still answers.
  assert.equal(await get(`/api/attachment/${rec.id}/preview`), 200, 'the board stopped answering after the failure');
});

/** A response whose head is already out, as Node's own ServerResponse reports it. */
function sentResponse() {
  const res = new http.ServerResponse({ method: 'GET', url: '/api/x?token=secret' });
  res.req = { method: 'GET', url: '/api/x?token=secret', headers: {} };
  let destroyed = 0;
  Object.defineProperty(res, 'headersSent', { value: true });
  res.destroy = () => { destroyed += 1; };
  res.writeHead = () => { throw Object.assign(new Error('second head'), { code: 'ERR_HTTP_HEADERS_SENT' }); };
  return { res, destroyed: () => destroyed };
}

test('#7686: sendJson after the head ends the response and never writes a second head', () => {
  const { res, destroyed } = sentResponse();
  const logged = [];
  const realErr = console.error;
  console.error = (m) => { logged.push(String(m)); };
  try { sendJson(res, 404, { error: 'late' }); } finally { console.error = realErr; }
  assert.equal(destroyed(), 1, 'the broken response was not ended');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /GET \/api\/x/, 'the log line does not name the route');
  assert.doesNotMatch(logged[0], /secret/, 'the log line leaked a token');
});

test('#7686: refuseDownload after the head, on a browser download, ends the response too', () => {
  const { res, destroyed } = sentResponse();
  const req = { method: 'GET', url: '/api/diagnostics', headers: { 'sec-fetch-mode': 'navigate' } };
  const realErr = console.error;
  console.error = () => {};
  try { refuseDownload(req, res, 'late', 500); } finally { console.error = realErr; }
  assert.equal(destroyed(), 1, 'the broken response was not ended');
});

test('#7686: the diagnostics download that fails after its head ends that response, and the board keeps answering', async () => {
  const realStringify = JSON.stringify;
  let thrown = 0;
  // sendDiagnostics writes its head, then serialises with an indent of 2: fail exactly that call, once.
  JSON.stringify = function (v, r, indent) {
    if (thrown === 0 && indent === 2 && v && typeof v === 'object' && !Array.isArray(v)) {
      thrown += 1;
      throw new RangeError('Invalid string length');
    }
    return realStringify.call(this, v, r, indent);
  };
  let first;
  try {
    first = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/diagnostics', headers: { 'sec-fetch-mode': 'navigate' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
        res.on('error', () => resolve('cut'));
        res.on('aborted', () => resolve('cut'));
      });
      req.on('error', () => resolve('cut'));
      setTimeout(() => { resolve('hung'); req.destroy(); }, 5000).unref();
    });
  } finally { JSON.stringify = realStringify; }
  await wait(50);
  if (thrown === 0) {
    // CONTROL: the route did not reach its serialise step here (no diagnostics on this board), so say so loudly.
    assert.fail('CONTROL: the diagnostics route never serialised, so this test proves nothing (answered ' + first + ')');
  }
  assert.deepEqual(unhandled.map((e) => String(e && (e.code || e.message))), [], 'a rejection escaped the diagnostics route');
  assert.notEqual(first, 'hung', 'the diagnostics response was left open');
  const again = await fetch(`http://127.0.0.1:${port()}/api/attachment/none/preview`);
  assert.ok(again.status >= 200, 'the board stopped answering after the diagnostics failure');
});
