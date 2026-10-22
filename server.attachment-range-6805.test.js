'use strict';
/*
 * kosmos#6805: a cut attachment download can resume. GET /api/attachment/<id> answers one `Range: bytes=...` with
 * 206 and Content-Range, from the same descriptor and measured size as the whole-file answer; 416 when nothing in
 * the file is asked for; the whole file (200) for a multi-range, a malformed header, or an If-Range that is not this
 * attachment's ETag, so a resume never joins two different files. The image preview is not ranged.
 *
 *   node --test server.attachment-range-6805.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-range-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-range-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-range-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-range-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-range-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server, parseByteRange } = require('./server');
const attachments = require('./engine/attachments');

const MB = 1024 * 1024;
test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const port = () => server.address().port;
const url = (rec, tail = '') => `http://127.0.0.1:${port()}/api/attachment/${rec.id}${tail}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(20); }
  return fn();
}
function fdsOn(file) {
  const st = fs.statSync(file);
  let n = 0;
  for (const name of fs.readdirSync('/dev/fd')) {
    try { const f = fs.fstatSync(Number(name)); if (f.dev === st.dev && f.ino === st.ino) n += 1; } catch { /* closed meanwhile */ }
  }
  return n;
}
function stored(bytes, name = 'file.bin', type = 'application/octet-stream') {
  return attachments.save('agent', 'ava', { name, type, bytes });
}
// The ETag the board sends for this attachment as it is now (its id, size and time).
async function tagOf(rec) { return (await fetch(url(rec), { method: 'HEAD' })).headers.get('etag'); }
async function get(rec, headers = {}, tail = '') {
  const res = await fetch(url(rec, tail), { headers });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

test('#6805 sandbox: attachments are stored in this test\'s data root', () => {
  assert.ok(attachments.ROOT.startsWith(SANDBOX + path.sep), attachments.ROOT);
});

test('#6805: the parser reads a-b, a- and -n, clamps the end, and refuses what RFC 9110 says to ignore', () => {
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('BYTES = 10 - 20 ', 1000), { start: 10, end: 20 }, 'unit is case-insensitive, spaces allowed');
  assert.deepEqual(parseByteRange('bytes=900-5000', 1000), { start: 900, end: 999 }, 'an end past the file is clamped');
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { start: 0, end: 999 }, 'a suffix longer than the file is all of it');
  assert.deepEqual(parseByteRange('bytes=0-99999999999999999999999', 1000), { start: 0, end: 999 });
  for (const h of [undefined, '', 'bytes=', 'bytes=-', 'items=0-9', 'bytes=9-0', 'bytes=0-9,20-29', 'bytes=a-b', 'bytes=1.5-2']) {
    assert.equal(parseByteRange(h, 1000), null, JSON.stringify(h) + ' should be ignored');
  }
  for (const h of ['bytes=1000-', 'bytes=1000-2000', 'bytes=-0', 'bytes=99999999999999999999-']) {
    assert.equal(parseByteRange(h, 1000), 'unsatisfiable', h);
  }
  assert.equal(parseByteRange('bytes=0-', 0), 'unsatisfiable', 'nothing in an empty file can be asked for');
  assert.equal(parseByteRange('bytes=-1', 0), 'unsatisfiable');
});

test('#6805: a whole download says it can be resumed (Accept-Ranges, the ETag), and HEAD does too', async () => {
  const bytes = crypto.randomBytes(64 * 1024);
  const rec = stored(bytes);
  const whole = await get(rec);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.ok(whole.headers.get('etag').startsWith(`"${rec.id}-`) && whole.headers.get('etag').endsWith('"'), whole.headers.get('etag'));
  assert.equal(whole.headers.get('content-range'), null);
  assert.ok(whole.body.equals(bytes));
  const head = await fetch(url(rec), { method: 'HEAD', headers: { range: 'bytes=0-9' } });
  assert.equal(head.status, 200, 'HEAD answers as before, whatever Range says');
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(head.headers.get('etag'), whole.headers.get('etag'), 'HEAD and GET name the same bytes the same way');
});

test('#6805: a range is answered 206 with exactly that slice, its Content-Range and length', async () => {
  const bytes = crypto.randomBytes(3 * MB + 11);
  const rec = stored(bytes);
  const cases = [
    ['bytes=0-0', 0, 0],
    ['bytes=100-199', 100, 199],
    [`bytes=${MB}-`, MB, bytes.length - 1],
    ['bytes=-17', bytes.length - 17, bytes.length - 1],
    [`bytes=${bytes.length - 5}-${bytes.length + 500}`, bytes.length - 5, bytes.length - 1],
  ];
  const tag = await tagOf(rec);
  for (const [range, a, b] of cases) {
    const got = await get(rec, { range });
    assert.equal(got.status, 206, range);
    assert.equal(got.headers.get('content-range'), `bytes ${a}-${b}/${bytes.length}`, range);
    assert.equal(got.headers.get('content-length'), String(b - a + 1), range);
    assert.equal(got.headers.get('etag'), tag, range);
    assert.equal(got.headers.get('content-disposition'), "attachment; filename*=UTF-8''file.bin", range + ': still a download');
    assert.ok(got.body.equals(bytes.subarray(a, b + 1)), range + ': not the slice asked for');
  }
});

test('#6805: a resumed download joined to its first part is the file', async () => {
  const bytes = crypto.randomBytes(2 * MB + 3);
  const rec = stored(bytes);
  const cut = 1234567;
  const first = await get(rec, { range: `bytes=0-${cut - 1}` });
  const rest = await get(rec, { range: `bytes=${cut}-`, 'if-range': first.headers.get('etag') });
  assert.equal(rest.status, 206);
  assert.ok(Buffer.concat([first.body, rest.body]).equals(bytes));
});

test('#6805: nothing in the file asked for is 416 with bytes */size and no body', async () => {
  const bytes = crypto.randomBytes(1000);
  const rec = stored(bytes);
  for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
    const got = await get(rec, { range });
    assert.equal(got.status, 416, range);
    assert.equal(got.headers.get('content-range'), 'bytes */1000', range);
    assert.equal(got.body.length, 0, range);
    assert.equal(got.headers.get('accept-ranges'), 'bytes', range + ': a 416 still says ranges work, so the client retries with one');
  }
  const head = await fetch(url(rec), { method: 'HEAD', headers: { range: 'bytes=5000-' } });
  assert.equal(head.status, 200, 'HEAD with a range past the end answers as before, never 416');
  assert.equal(head.headers.get('content-length'), '1000');
  assert.equal((await get(rec)).status, 200, 'the board keeps serving after a 416');
});

test('#6805: a multi-range, a malformed range or another unit gets the whole file (200)', async () => {
  const bytes = crypto.randomBytes(5000);
  const rec = stored(bytes);
  for (const range of ['bytes=0-9,20-29', 'bytes=9-0', 'items=0-9', 'bytes=x-']) {
    const got = await get(rec, { range });
    assert.equal(got.status, 200, range);
    assert.equal(got.headers.get('content-range'), null, range);
    assert.ok(got.body.equals(bytes), range);
  }
});

test('#6805: If-Range other than this attachment\'s ETag gets the whole file, so a resume never splices two files', async () => {
  const bytes = crypto.randomBytes(5000);
  const rec = stored(bytes);
  const other = stored(crypto.randomBytes(5000), 'other.bin');
  // CONTROL: the matching validator does give a 206, so the 200s below are the validator's doing.
  const tag = await tagOf(rec);
  assert.equal((await get(rec, { range: 'bytes=10-', 'if-range': tag })).status, 206);
  for (const ifRange of [await tagOf(other), `W/${tag}`, tag.slice(1, -1), `"${rec.id}"`, 'Wed, 21 Oct 2026 07:28:00 GMT']) {
    const got = await get(rec, { range: 'bytes=10-', 'if-range': ifRange });
    assert.equal(got.status, 200, JSON.stringify(ifRange));
    assert.ok(got.body.equals(bytes), JSON.stringify(ifRange));
  }
});

test('#6805: the image preview is not ranged (its file can be drawn again under the same address)', async () => {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(4000)]);
  const rec = stored(bytes, 'shot.png', 'image/png');
  const got = await get(rec, { range: 'bytes=0-9' }, '/preview');
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('accept-ranges'), null);
  assert.equal(got.headers.get('etag'), null);
  assert.ok(got.body.equals(bytes));
});

test('#6805: a ranged download the client abandons releases its descriptor', async () => {
  const rec = stored(crypto.randomBytes(24 * MB), 'abandoned.bin');
  let openMid = -1;
  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id, headers: { range: `bytes=${MB}-` } }, (res) => {
      assert.equal(res.statusCode, 206);
      res.once('data', () => { openMid = fdsOn(rec.file); req.destroy(); resolve(); });
    });
    req.on('error', (e) => { if (!/socket hang up|aborted|ECONNRESET/.test(String(e && e.message))) reject(e); });
  });
  assert.ok(openMid >= 1, 'CONTROL: no descriptor on the file was seen mid-download');
  assert.ok(await until(() => fdsOn(rec.file) === 0), 'the abandoned ranged download still holds a descriptor');
});

// Replaces fs.fstatSync for the whole process while it runs: this file's tests must stay sequential (no concurrency).
test('#6805: a ranged answer sends exactly its length on a keep-alive socket, even if the file grew after it was measured', async () => {
  const bytes = crypto.randomBytes(3 * MB);
  const rec = stored(bytes, 'grows.bin');
  const fstat = fs.fstatSync;
  // Measured as 2 MB: the file "grew" by a MB after the measure. The range ends at the measured end.
  fs.fstatSync = function () { const s = fstat.apply(this, arguments); Object.defineProperty(s, 'size', { value: 2 * MB }); return s; };
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const once = () => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id, agent, headers: { range: `bytes=${MB}-` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, range: res.headers['content-range'], complete: res.complete, body: Buffer.concat(chunks) }));
      res.on('error', (e) => resolve({ error: e.message }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
  });
  let a;
  let b;
  try { a = await once(); b = await once(); } finally { fs.fstatSync = fstat; agent.destroy(); }
  for (const got of [a, b]) {
    assert.equal(got.status, 206, JSON.stringify({ ...got, body: undefined }));
    assert.equal(got.range, `bytes ${MB}-${2 * MB - 1}/${2 * MB}`);
    assert.equal(got.complete, true);
    assert.ok(got.body.equals(bytes.subarray(MB, 2 * MB)), 'not the measured slice (an overrun lands in the next response)');
  }
});

test('#6805: an attachment whose bytes changed under the same id answers a resume with the whole new file', async () => {
  const before = crypto.randomBytes(4000);
  const rec = stored(before);
  const oldTag = await tagOf(rec);
  const onDisk = rec.file;
  assert.ok(fs.readFileSync(onDisk).equals(before), 'the stored file is the one served');
  const after = crypto.randomBytes(4500);
  fs.writeFileSync(onDisk, after);
  fs.utimesSync(onDisk, new Date(), new Date(Date.now() + 5000));
  // CONTROL: the new tag does give a 206, so the 200 below is the old tag's doing.
  assert.equal((await get(rec, { range: 'bytes=10-', 'if-range': await tagOf(rec) })).status, 206);
  const got = await get(rec, { range: 'bytes=10-', 'if-range': oldTag });
  assert.equal(got.status, 200);
  assert.ok(got.body.equals(after));
  // The same length again, so only the time can tell the two apart: the size alone would let this splice.
  const sameSizeTag = await tagOf(rec);
  const again = crypto.randomBytes(after.length);
  fs.writeFileSync(onDisk, again);
  fs.utimesSync(onDisk, new Date(), new Date(Date.now() + 10000));
  const sameSize = await get(rec, { range: 'bytes=10-', 'if-range': sameSizeTag });
  assert.equal(sameSize.status, 200, 'a same-size rewrite is caught by its time');
  assert.ok(sameSize.body.equals(again));
});

test('#6805: a range for an attachment that does not exist is a 404, not bytes', async () => {
  const got = await get({ id: 'f'.repeat(24) }, { range: 'bytes=0-9' });
  assert.equal(got.status, 404);
  assert.equal(got.headers.get('content-range'), null);
});
