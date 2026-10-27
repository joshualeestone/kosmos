'use strict';
/*
 * kosmos#6734: an attachment is streamed both ways, so the cap can be 100 MB.
 *
 *   - GET /api/attachment/<id> sends the stored file from disk: byte-identical, never read whole, and a client that
 *     goes away mid-download (or a read that fails mid-file) releases the descriptor and leaves the board running.
 *   - PUT /api/<scope>/<owner>/attachment writes the body to a part file as it arrives: a body exactly at the cap
 *     is kept byte-identical without the board holding it, and one past the cap (declared or not) is refused with
 *     nothing left behind. An upload cut off part way leaves nothing behind either.
 *   - The page's own check, the agent's instructions and the CLI's help name the same figure as the route.
 *
 *   node --test server.attachment-stream-6734.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-stream-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-stream-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-stream-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-stream-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-stream-launch-'));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-stream-src-'));
process.on('exit', () => {
  for (const d of [SANDBOX, SCRATCH]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const { start, server } = require('./server');
const attachments = require('./engine/attachments');
const projects = require('./engine/projects');
const store = require('./engine/store');

const MB = 1024 * 1024;
let project = null;
test.before(async () => {
  await start(0);
  project = projects.create({ name: 'Stream Check' });
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const port = () => server.address().port;
const ownerDir = () => path.join(attachments.ROOT, 'project', store.safeKey(project.id));
const stored = () => { try { return fs.readdirSync(ownerDir()); } catch { return []; } };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(20); }
  return fn();
}
/** Every part file under the attachment store. */
function parts() {
  const found = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name === attachments.PART) found.push(path.join(d, e.name));
    }
  };
  walk(attachments.ROOT);
  return found;
}
/** How many of this process's descriptors are open on `file` (by device and inode, so a rename cannot hide one). */
function fdsOn(file) {
  const st = fs.statSync(file);
  let n = 0;
  for (const name of fs.readdirSync('/dev/fd')) {
    try { const f = fs.fstatSync(Number(name)); if (f.dev === st.dev && f.ino === st.ino) n += 1; } catch { /* closed meanwhile */ }
  }
  return n;
}
/** A stored attachment of `size` bytes, written a megabyte at a time so the test never holds it whole. */
function storedOf(size, name = 'big.bin') {
  const block = crypto.randomBytes(MB);
  const got = attachments.saveFilled('agent', 'ava', { name, type: 'application/octet-stream' }, (fd) => {
    for (let left = size; left > 0; left -= MB) fs.writeSync(fd, block, 0, Math.min(MB, left));
    return { ok: true, size };
  });
  assert.ok(got.ok, got.because);
  return got.rec;
}
/** A source file on disk of `size` bytes and its sha256. */
function sourceOf(size, name) {
  const file = path.join(SCRATCH, name);
  const block = crypto.randomBytes(MB);
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'w');
  try {
    for (let left = size; left > 0; left -= MB) {
      const n = Math.min(MB, left);
      fs.writeSync(fd, block, 0, n);
      h.update(block.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return { file, sum: h.digest('hex') };
}
/** A PUT to the project's attachment route. `send(req)` writes the body; resolves { status, body } or { reset }. */
function put(headers, send) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: port(), method: 'PUT', path: '/api/project/' + project.id + '/attachment', headers });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e) => resolve({ reset: e.code || e.message }));
    });
    req.on('error', (e) => resolve({ reset: e.code || e.message }));
    send(req);
  });
}

test('#6734 sandbox: attachments are stored in this test\'s data root', () => {
  assert.ok(attachments.ROOT.startsWith(SANDBOX + path.sep), attachments.ROOT);
});

test('#6734: the cap is 100 MB, said as "100 MB"', () => {
  assert.equal(attachments.MAX_BYTES, 100 * MB);
  assert.equal(attachments.MAX_WORDS, '100 MB');
  assert.match(attachments.TOO_LARGE, /larger than 100 MB/);
});

test('#6734: a streamed download of a multi-MB file is byte-identical, with its length, and HEAD sends no body', async () => {
  const bytes = crypto.randomBytes(6 * MB + 7);
  const rec = attachments.save('agent', 'ava', { name: 'six.bin', type: 'application/octet-stream', bytes });
  const res = await fetch(`http://127.0.0.1:${port()}/api/attachment/${rec.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String(bytes.length));
  assert.match(res.headers.get('content-disposition') || '', /^attachment; filename\*=UTF-8''six\.bin$/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') || '', /sandbox/);
  const got = Buffer.from(await res.arrayBuffer());
  assert.equal(got.length, bytes.length);
  assert.equal(sha(got), sha(bytes), 'the downloaded bytes differ from the stored file');
  const head = await fetch(`http://127.0.0.1:${port()}/api/attachment/${rec.id}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(fdsOn(rec.file), 0, 'a whole download or a HEAD left the file open');
});

/* kosmos#7302: readings over a SETTLED baseline. One forced collection is not enough: measured (review 1), a dropped
   64 MB Buffer was still counted in arrayBuffers after gc() in up to 7 of 10 tries, and a closed server's buffer
   stayed reachable for tens of milliseconds. So `settled` collects, waits, collects again, and returns only once two
   readings agree to within 1 MB. Either effect left alone makes a baseline that already holds 64 MB: a 64 MB
   allocation then reads as near zero once the old buffer goes (the CONTROL red seen in CI), and a board that buffers
   can hide behind it (how the old check passed a board reading the file whole with fs.readSync). */
const v8 = require('node:v8');
v8.setFlagsFromString('--expose-gc');
const collect = require('node:vm').runInNewContext('gc');
/* Review 2: readings that agree can still both hold a buffer that frees later, so a baseline must also come back down to
   `floor` (a reading taken before the buffers this test made) when one is given, and three readings over 20 ms must
   agree. A baseline that never settles fails the test by name, never passes it on a doubtful reading. */
async function settled(floor = Infinity) {
  assert.equal(typeof collect, 'function', 'gc() is not available to the memory check (Node refused --expose-gc at run time)');
  const last = [];
  for (let i = 0; i < 100; i++) {
    collect();
    await new Promise((r) => setTimeout(r, 10));
    last.push(process.memoryUsage().arrayBuffers);
    if (last.length > 3) last.shift();
    if (last.length === 3 && Math.max(...last) - Math.min(...last) < MB && last[2] <= floor + 2 * MB) return last[2];
  }
  assert.fail('arrayBuffers never settled for the memory check (last ' + last.map((x) => (x / MB).toFixed(1)).join(', ') + ' MB, floor ' + (floor === Infinity ? 'none' : (floor / MB).toFixed(1)) + ' MB)');
}
/** The most arrayBuffers memory grows over a settled baseline while a client that paused at once holds the response from
 *  `url` for 400 ms: whatever the server read of the file is then held by the server. Sampled every 2 ms from before
 *  the request goes out, so a server that reads the file whole is caught even if it hands the buffer on fast. */
async function pausedPeak(url, floor) {
  const base = await settled(floor);
  let peak = 0;
  const read = () => { peak = Math.max(peak, process.memoryUsage().arrayBuffers - base); };
  const sample = setInterval(read, 2);
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        res.pause();   // the client stops reading: whatever the server has read is now held by it
        read();
        setTimeout(() => { req.destroy(); resolve(); }, 400);
      });
      req.on('error', (e) => { if (!/socket hang up|aborted|ECONNRESET/.test(String(e && e.message))) reject(e); });
    });
  } finally { clearInterval(sample); }
  read();
  return peak;
}

test('#6734: a download does not read the file into memory: a 64 MB file held by a paused client costs the board far less than 64 MB', async () => {
  const rec = storedOf(64 * MB);
  /* CONTROL 1: the instrument sees 64 MB held in a Buffer. */
  const before = await settled();
  let held = Buffer.alloc(64 * MB, 1);
  assert.ok(process.memoryUsage().arrayBuffers - before >= 60 * MB, 'CONTROL: arrayBuffers did not see a 64 MB Buffer');
  held = null;
  // Both baselines below must come back down to `before`: CONTROL 1's 64 MB is gone, not just steady (review 2).
  /* The board FIRST, the buffering control second (kosmos#7302 review 1): a leftover in a baseline can then only make
     the control read low, which fails red, never let a buffering board read low and pass. */
  const readWhole = [];
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (String(p) === rec.file) readWhole.push(p); return realRead.call(this, p, ...rest); };
  let peak = 0;
  try {
    peak = await pausedPeak({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id }, before);
  } finally { fs.readFileSync = realRead; }
  assert.equal(readWhole.length, 0, 'the download read the whole file with readFileSync');
  assert.ok(await until(() => fdsOn(rec.file) === 0), 'the paused-then-dropped download left the file open');
  /* CONTROL 2: a server in this same process that DOES buffer the same file, measured the same way just after, holds
     most of it. So the instrument can see a buffered download on this run, and the board's figure is compared with it. */
  const buffering = http.createServer((req, res) => { res.end(fs.readFileSync(rec.file)); });
  await new Promise((r) => buffering.listen(0, '127.0.0.1', r));
  let bufferedPeak = 0;
  try {
    bufferedPeak = await pausedPeak({ host: '127.0.0.1', port: buffering.address().port, path: '/' }, before);
  } finally { buffering.closeAllConnections(); await new Promise((r) => buffering.close(r)); }
  assert.ok(bufferedPeak >= 48 * MB, 'CONTROL: a buffering server measured only ' + Math.round(bufferedPeak / MB) + ' MB held for a paused 64 MB download');
  /* The board streams in 64 KB reads and measures 0 to about 1 MB held; 8 MB (and an eighth of the buffering figure)
     leaves room for socket buffers and catches a board that holds more than an eighth of the file (review 1: a 20 MB
     partial buffer passed the old 24 MB bound). */
  assert.ok(peak < 8 * MB && peak * 8 < bufferedPeak,
    'the board held ' + (peak / MB).toFixed(1) + ' MB for a paused 64 MB download (a buffering server held ' + Math.round(bufferedPeak / MB) + ' MB)');
});

test('#6734: a download the client abandons part way releases its descriptor, and the board keeps serving', async () => {
  const rec = storedOf(48 * MB, 'abandoned.bin');
  let openMid = -1;
  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id }, (res) => {
      res.once('data', () => {
        openMid = fdsOn(rec.file);   // CONTROL: mid-download the board holds the file open, so the count can see one
        req.destroy();
        resolve();
      });
    });
    req.on('error', (e) => { if (!/socket hang up|aborted|ECONNRESET/.test(String(e && e.message))) reject(e); });
  });
  assert.ok(openMid >= 1, 'CONTROL: no descriptor on the file was seen mid-download');
  assert.ok(await until(() => fdsOn(rec.file) === 0), 'the abandoned download still holds ' + fdsOn(rec.file) + ' descriptor(s) on the file');
  const again = await fetch(`http://127.0.0.1:${port()}/api/attachment/${rec.id}`, { method: 'HEAD' });
  assert.equal(again.status, 200, 'the board stopped serving after an abandoned download');
});

test('#6734: a read that fails mid-file ends the download short, releases the descriptor, and the board keeps serving', async () => {
  const rec = storedOf(8 * MB, 'failing.bin');
  const realCreate = fs.createReadStream;
  fs.createReadStream = function (...args) {
    const s = realCreate.apply(this, args);
    s.once('data', () => setImmediate(() => s.destroy(Object.assign(new Error('simulated read failure'), { code: 'EIO' }))));
    return s;
  };
  let got = 0;
  let ended = 'complete';
  try {
    await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id }, (res) => {
        assert.equal(res.headers['content-length'], String(8 * MB));
        res.on('data', (c) => { got += c.length; });
        res.on('end', resolve);
        res.on('error', () => { ended = 'cut'; resolve(); });
        res.on('aborted', () => { ended = 'cut'; });
      });
      req.on('error', () => { ended = 'cut'; resolve(); });
    });
  } finally { fs.createReadStream = realCreate; }
  assert.ok(got < 8 * MB, 'the whole file arrived although the read failed (' + got + ' bytes, ended ' + ended + ')');
  assert.ok(await until(() => fdsOn(rec.file) === 0), 'the failed read left the file open');
  const again = await fetch(`http://127.0.0.1:${port()}/api/attachment/${rec.id}`);
  assert.equal(again.status, 200, 'the board stopped serving after a failed read');
  assert.equal((await again.arrayBuffer()).byteLength, 8 * MB);
});

test('#6734: an image preview is streamed from the file too, byte-identical and never read whole', async () => {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(5 * MB)]);
  const rec = attachments.save('agent', 'ava', { name: 'shot.png', type: 'image/png', bytes });
  const readWhole = [];
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (String(p) === rec.file) readWhole.push(p); return realRead.call(this, p, ...rest); };
  try {
    const res = await fetch(`http://127.0.0.1:${port()}/api/attachment/${rec.id}/preview`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-length'), String(bytes.length));
    assert.equal(sha(Buffer.from(await res.arrayBuffer())), sha(bytes));
  } finally { fs.readFileSync = realRead; }
  assert.equal(readWhole.length, 0, 'the preview read the whole image with readFileSync');
});

test('#6734: an upload exactly at the cap is kept byte-identical, without the board holding it, and leaves no part file', async () => {
  const src = sourceOf(attachments.MAX_BYTES, 'at-cap.bin');
  const before = stored().length;
  // kosmos#7302 review 2: a settled baseline here too, so a leftover from the test before cannot hide the upload's hold.
  const base = await settled();
  let peak = 0;
  const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers - base); }, 10);
  let got;
  try {
    got = await put({ 'content-type': 'application/octet-stream', 'content-length': String(attachments.MAX_BYTES), 'x-attachment-name': 'at-cap.bin' },
      (req) => fs.createReadStream(src.file).pipe(req));
  } finally { clearInterval(sample); }
  assert.equal(got.status, 200, JSON.stringify(got));
  const att = JSON.parse(got.body).attachment;
  assert.equal(att.size, attachments.MAX_BYTES);
  const rec = attachments.read(att.id);
  assert.ok(rec, 'the record cannot be read back');
  assert.equal(fs.statSync(rec.file).size, attachments.MAX_BYTES);
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(rec.file).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject));
  assert.equal(h.digest('hex'), src.sum, 'the stored file differs from the uploaded one');
  assert.equal(stored().length, before + 1);
  assert.deepEqual(parts(), [], 'a part file was left behind');
  assert.ok(peak < 48 * MB, 'the board held ' + Math.round(peak / MB) + ' MB while a 100 MB upload arrived');
  fs.rmSync(rec.dir, { recursive: true, force: true });
  fs.rmSync(src.file, { force: true });
});

test('#6734: an upload that declares a length over the cap is refused at once, before its body, with the route\'s sentence', async () => {
  const before = stored().length;
  /* Only 16 bytes of the declared length are ever sent: an answer can come only from the declared length. */
  const got = await Promise.race([
    put({ 'content-type': 'application/octet-stream', 'content-length': String(attachments.MAX_BYTES + 1), 'x-attachment-name': 'too-big.bin' },
      (req) => req.write(Buffer.alloc(16))),
    wait(5000).then(() => ({ timeout: true })),
  ]);
  assert.equal(got.status, 400, JSON.stringify(got));
  assert.equal(JSON.parse(got.body).error, attachments.TOO_LARGE);
  assert.equal(stored().length, before, 'a refused upload made an attachment folder');
  assert.deepEqual(parts(), []);
});

test('#6734: an upload that does not declare its length is refused as it crosses the cap, and leaves nothing behind', async () => {
  const before = stored().length;
  const block = Buffer.alloc(MB, 7);
  let sent = 0;
  const got = await put({ 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked', 'x-attachment-name': 'chunked.bin' }, (req) => {
    const pump = () => {
      while (sent <= attachments.MAX_BYTES) {
        const n = Math.min(MB, attachments.MAX_BYTES + 1 - sent);
        sent += n;
        if (!req.write(n === MB ? block : block.subarray(0, n))) { req.once('drain', pump); return; }
      }
      req.end();
    };
    req.on('error', () => {});
    pump();
  });
  assert.equal(got.status, 400, JSON.stringify(got));
  assert.equal(JSON.parse(got.body).error, attachments.TOO_LARGE);
  assert.ok(await until(() => stored().length === before && parts().length === 0), 'an over-cap upload left ' + JSON.stringify(parts()) + ' / ' + stored().length + ' folders');
});

test('#6734: an upload cut off part way leaves nothing behind, and the board keeps taking uploads', async () => {
  const before = stored().length;
  await new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: port(), method: 'PUT', path: '/api/project/' + project.id + '/attachment',
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(20 * MB), 'x-attachment-name': 'cut.bin' },
    });
    req.on('error', () => resolve());
    req.write(Buffer.alloc(2 * MB, 3), () => setTimeout(() => { req.destroy(); resolve(); }, 100));
  });
  assert.ok(await until(() => parts().length === 0 && stored().length === before), 'a cut-off upload left ' + JSON.stringify(parts()) + ' / ' + stored().length + ' folders');
  const ok = await put({ 'content-type': 'text/plain', 'content-length': '5', 'x-attachment-name': 'after.txt' }, (req) => req.end('hello'));
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(JSON.parse(ok.body).attachment.preview, 'hello');
  // Review 15: an upload (saveStream) stores its file 0600 too, not only the reply copy.
  if (process.platform !== 'win32') {
    const rec = attachments.read(JSON.parse(ok.body).attachment.id);
    assert.equal(fs.statSync(rec.file).mode & 0o777, 0o600, 'an uploaded file');
  }
});

test('#6734: a text file\'s snippet is read from its first bytes, not the whole file', () => {
  const line = 'The lease runs to March, and été is summer. ';
  const bytes = Buffer.from(line.repeat(Math.ceil((3 * MB) / Buffer.byteLength(line))));
  const rec = attachments.save('agent', 'ava', { name: 'long.txt', type: 'text/plain', bytes });
  const readWhole = [];
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (String(p) === rec.file) readWhole.push(p); return realRead.call(this, p, ...rest); };
  let field;
  try { field = attachments.rowField(rec); } finally { fs.readFileSync = realRead; }
  assert.equal(readWhole.length, 0, 'the snippet read the whole file');
  assert.equal(field.preview, bytes.toString('utf8').slice(0, 2000));
  assert.equal(fdsOn(rec.file), 0);
});

test('#6734: the page, the agent\'s instructions and the CLI name the route\'s own cap', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = page.match(/const ATTACH_MAX_BYTES = ([0-9 *]+);/);
  assert.ok(m, 'the page has no ATTACH_MAX_BYTES');
  assert.equal(Function('return (' + m[1] + ');')(), attachments.MAX_BYTES, 'the page checks a different cap from the route');
  assert.match(page, /if \(file\.size > ATTACH_MAX_BYTES\)/, 'the page does not check the file against ATTACH_MAX_BYTES');
  const dm = fs.readFileSync(path.join(__dirname, 'engine', 'dmfiles.js'), 'utf8');
  assert.ok(dm.includes('can be attached, up to ' + attachments.MAX_WORDS + '.'), 'the agent\'s instructions name another cap');
  const cli = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  assert.ok(cli.includes('a project you are on, up to ' + attachments.MAX_WORDS + ':'), 'kosmos reply --file help names another cap');
});

test('#6734: an office file over the conversion limit is attached unconverted, and not sent to the PDF fallback', async () => {
  const attachtext = require('./engine/attachtext');
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'render-'));
  const big = path.join(dir, 'big.pdf');
  fs.closeSync(fs.openSync(big, 'w'));
  fs.truncateSync(big, attachtext.MAX_RENDER_BYTES + 1);   // sparse: no bytes are written
  const out = await attachtext.render({ name: 'big.pdf', file: big, dir });
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /converts files up to 25 MB to text; this one is larger, so it is attached as it is/, text);
  assert.doesNotMatch(text, /macOS’s own PDF reader/, 'the oversized file must not go to the PDF fallback either');
  // CONTROL: a small file still goes to the converter, so the note above is the gate and not every PDF's fate.
  const small = path.join(dir, 'small.pdf');
  fs.writeFileSync(small, 'not really a pdf');
  const out2 = await attachtext.render({ name: 'small.pdf', file: small, dir: fs.mkdtempSync(path.join(SCRATCH, 'render-')) });
  assert.doesNotMatch(fs.readFileSync(out2, 'utf8'), /converts files up to/);
});

test('#6734: the Files preview keeps its own 25 MB limit when the attachment cap rises, since it reads the whole file', async () => {
  const filepreview = require('./engine/filepreview');
  assert.equal(filepreview.MAX_PREVIEW_BYTES, 25 * 1024 * 1024);
  assert.ok(filepreview.MAX_PREVIEW_BYTES < attachments.MAX_BYTES, 'the preview limit must not follow the attachment cap');
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'files-'));
  const sparse = (name, size) => { const f = path.join(dir, name); fs.closeSync(fs.openSync(f, 'w')); fs.truncateSync(f, size); };
  sparse('over.png', filepreview.MAX_PREVIEW_BYTES + 1);
  sparse('at.png', filepreview.MAX_PREVIEW_BYTES);
  const over = await filepreview.preview(dir, 'over.png', 'here', { maxDepth: 0 });
  assert.deepEqual([over.ok, over.because], [false, 'that file is too big to show here']);
  // CONTROL: exactly at the limit is not refused for its size.
  const at = await filepreview.preview(dir, 'at.png', 'here', { maxDepth: 0 });
  assert.notEqual(at.because, 'that file is too big to show here', JSON.stringify({ ok: at.ok, because: at.because }));
});

test('#6734: a folder a stopped upload left with no record is swept once it is an hour old, and nothing else is', () => {
  assert.ok(attachments.ROOT.startsWith(SANDBOX), 'the sweep must run on the sandbox, never the real store');
  const owner = path.join(attachments.ROOT, 'agent', 'sweep-test');
  const make = (id, files, ageMs) => {
    const dir = path.join(owner, id);
    fs.mkdirSync(dir, { recursive: true });
    const when = (Date.now() - ageMs) / 1000;
    for (const f of files) { fs.writeFileSync(path.join(dir, f), 'x'); fs.utimesSync(path.join(dir, f), when, when); }
    fs.utimesSync(dir, when, when);
    return dir;
  };
  const HOUR = attachments.ORPHAN_AGE_MS;
  const oldPart = make('a'.repeat(24), [attachments.PART], HOUR + 60000);
  const oldNoRecord = make('b'.repeat(24), ['clip.mov'], HOUR + 60000);   // renamed, record never written
  const fresh = make('c'.repeat(24), [attachments.PART], 60000);          // CONTROL: may still be arriving
  const kept = make('d'.repeat(24), ['clip.mov', 'record.json'], HOUR * 5); // CONTROL: a real attachment
  const notAnId = make('not-an-attachment-id', [attachments.PART], HOUR * 5); // CONTROL: not ours to judge
  // Review 11: a record.json that is a dangling link still counts as a record, so the folder is kept.
  const dangling = make('f'.repeat(24), ['clip.mov'], HOUR * 5);
  fs.symlinkSync(path.join(SCRATCH, 'no-such-record'), path.join(dangling, 'record.json'));
  const old = (Date.now() - HOUR * 5) / 1000;   // so only the record check, not its age, can keep it
  fs.lutimesSync(path.join(dangling, 'record.json'), old, old);
  fs.utimesSync(dangling, old, old);
  try {
    // Review 22: at least this test's two, by path below; a count over the whole store would depend on other tests.
    assert.ok(attachments.sweepOrphans() >= 2);
    assert.deepEqual([oldPart, oldNoRecord, fresh, kept, notAnId, dangling].map((d) => fs.existsSync(d)), [false, false, true, true, true, true]);
  } finally {
    fs.rmSync(owner, { recursive: true, force: true });   // the kept controls, so later tests counting part files see none
  }
});

test('#6734: a reply file that grew after it was measured is refused having copied at most one byte past the measure', () => {
  const replyfile = require('./engine/replyfile');
  const src = path.join(fs.mkdtempSync(path.join(SCRATCH, 'grow-')), 'grows.bin');
  fs.writeFileSync(src, Buffer.alloc(3 * MB, 1));
  const real = fs.realpathSync(src);
  const st = fs.statSync(real);
  const outFile = path.join(SCRATCH, 'grow-out-' + process.pid);
  const out = fs.openSync(outFile, 'w');
  const fstat = fs.fstatSync;
  // The descriptor reports 1 MB: what a file that grew from 1 MB to 3 MB after the fstat looks like to the reader.
  fs.fstatSync = function (fd) { const s = fstat.apply(this, arguments); if (fd !== out) Object.defineProperty(s, 'size', { value: MB }); return s; };
  let got;
  try { got = replyfile.readOwn(real, st, src, out); } finally { fs.fstatSync = fstat; fs.closeSync(out); }
  assert.equal(got.ok, false, JSON.stringify(got));
  assert.ok(fs.statSync(outFile).size <= MB + 1, 'copied ' + fs.statSync(outFile).size + ' bytes of a file measured at ' + MB);
});

test('#6734: a download sends exactly the size it measured, even if the file is longer when it is read', async () => {
  const rec = storedOf(3 * MB, 'grows-later.bin');
  const whole = fs.readFileSync(rec.file);
  const fstat = fs.fstatSync;
  // The download's fstat reports 1 MB: a file that grew after it was measured.
  fs.fstatSync = function () { const s = fstat.apply(this, arguments); Object.defineProperty(s, 'size', { value: MB }); return s; };
  // One keep-alive socket for two requests: bytes sent past the first response's length would land in front of the
  // second response, so the second one is the check that can see an overrun.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const fetchOnce = () => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id, agent }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, length: res.headers['content-length'], complete: res.complete, body: Buffer.concat(chunks) }));
        res.on('error', (e) => resolve({ error: e.message }));
      });
      req.on('error', (e) => resolve({ error: e.message }));
    });
  let got;
  let second;
  try { got = await fetchOnce(); second = await fetchOnce(); } finally { fs.fstatSync = fstat; agent.destroy(); }
  assert.equal(second.status, 200, 'the next response on the same connection: ' + JSON.stringify({ ...second, body: undefined }));
  assert.ok(second.body.equals(whole.subarray(0, MB)), 'the next response on the same connection was not the file');
  assert.equal(got.status, 200, JSON.stringify({ ...got, body: undefined }));
  assert.equal(got.length, String(MB));
  assert.equal(got.complete, true, 'the response was cut rather than ended at its length');
  assert.equal(got.body.length, MB);
  assert.ok(got.body.equals(whole.subarray(0, MB)), 'the bytes sent are not the first MB of the file');
});

test('#6734: a download of a stored file swapped for a FIFO is refused at once, not left waiting for a writer', { skip: process.platform === 'win32' }, async () => {
  const rec = storedOf(MB, 'swapped.bin');
  fs.rmSync(rec.file);
  require('node:child_process').execFileSync('mkfifo', [rec.file]);
  const got = await Promise.race([
    new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id }, (res) => { res.resume(); resolve({ status: res.statusCode }); });
      req.on('error', (e) => resolve({ error: e.message }));
    }),
    wait(3000).then(() => ({ timeout: true })),
  ]);
  assert.deepEqual(got, { status: 404 });
});

test('#6734: a download of a file that shrank after it was measured is cut, not ended short for the client to wait on', async () => {
  const rec = storedOf(MB, 'shrinks-later.bin');
  const fstat = fs.fstatSync;
  // The download's fstat reports 1 MB more than there is: a file that shrank after it was measured.
  fs.fstatSync = function () { const s = fstat.apply(this, arguments); Object.defineProperty(s, 'size', { value: s.size + MB }); return s; };
  let got;
  try {
    got = await Promise.race([
      new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id, agent: new http.Agent({ keepAlive: true }) }, (res) => {
          let n = 0;
          res.on('data', (c) => { n += c.length; });
          res.on('end', () => resolve({ ended: true, complete: res.complete, n }));
          res.on('error', () => resolve({ cut: true, n }));
          res.on('aborted', () => resolve({ cut: true, n }));
        });
        req.on('error', () => resolve({ cut: true }));
      }),
      wait(3000).then(() => ({ waiting: true })),
    ]);
  } finally { fs.fstatSync = fstat; }
  assert.ok(got.cut || (got.ended && got.complete === false), 'the client was left ' + JSON.stringify(got));
});

test('#6734: a reply copy that cannot be written says Kosmos could not store it, not that the file could not be read', () => {
  const replyfile = require('./engine/replyfile');
  const src = path.join(fs.mkdtempSync(path.join(SCRATCH, 'wfail-')), 'fine.bin');
  fs.writeFileSync(src, Buffer.alloc(64 * 1024, 2));
  const real = fs.realpathSync(src);
  const ro = path.join(SCRATCH, 'wfail-out-' + process.pid);
  fs.writeFileSync(ro, '');
  const out = fs.openSync(ro, 'r');   // a descriptor writes cannot go to
  let got;
  try { got = replyfile.readOwn(real, fs.statSync(real), src, out); } finally { fs.closeSync(out); }
  assert.deepEqual(got, { ok: false, because: 'Kosmos could not store a copy of that file' });
  // CONTROL: the same file to a writable descriptor is copied.
  const ok = fs.openSync(ro, 'w');
  try { assert.deepEqual(replyfile.readOwn(real, fs.statSync(real), src, ok), { ok: true, size: 64 * 1024 }); } finally { fs.closeSync(ok); }
});

test('#6734: an image or PDF over 25 MB has no thumbnail, so a card never reads the whole file to draw one', async () => {
  const LIMIT = attachments.MAX_THUMBNAIL_BYTES;
  assert.equal(LIMIT, 25 * 1024 * 1024);
  const image = (size) => ({ id: 'e'.repeat(24), name: 'photo.png', type: 'image/png', kind: 'image', size, file: '/nonexistent/photo.png' });
  assert.equal(attachments.rowField(image(LIMIT + 1)).preview, null);
  const refused = await attachments.previewFile(image(LIMIT + 1));
  assert.deepEqual([refused.ok, refused.because], [false, 'that image is too large to preview here; download it instead']);
  // CONTROL: at the limit, the image is its own preview, as before.
  assert.equal(attachments.rowField(image(LIMIT)).preview, '/api/attachment/' + 'e'.repeat(24) + '/preview');
  assert.equal((await attachments.previewFile(image(LIMIT))).ok, true);
  // Review 14: a PDF's thumbnail is drawn by reading the whole PDF, so the same limit applies.
  const pdf = (size) => ({ ...image(size), kind: 'pdf', name: 'big.pdf', type: 'application/pdf' });
  assert.equal(attachments.rowField(pdf(LIMIT + 1)).preview, null);
  assert.deepEqual(await attachments.previewFile(pdf(LIMIT + 1)), { ok: false, because: 'that PDF is too large to preview here; download it instead' });
  assert.match(attachments.rowField(pdf(LIMIT)).preview, /\/preview$/, 'CONTROL: a PDF at the limit keeps its thumbnail');
});

test('#6734: only attachments.js writes under the store, so the orphan sweep never meets a folder that keeps its record elsewhere', () => {
  // sweepOrphans removes an id folder with no record.json. That is safe only while slot() is the one maker of those
  // folders (it always writes record.json or removes the folder). A new writer under the store fails here first.
  const tracked = require('node:child_process').execFileSync('git', ['-C', __dirname, 'ls-files', '*.js'], { encoding: 'utf8' })
    .split('\n').filter((f) => f && !/\.test\.js$/.test(f) && !f.startsWith('test-support/') && f !== 'engine/attachments.js');
  assert.ok(tracked.length > 50, 'the scan saw ' + tracked.length + ' files');
  const readers = tracked.filter((f) => fs.readFileSync(path.join(__dirname, f), 'utf8').includes('attachments.ROOT'));
  assert.deepEqual(readers, ['engine/replyfile.js'], 'a new file reaches into the attachment store');
  const rf = fs.readFileSync(path.join(__dirname, 'engine', 'replyfile.js'), 'utf8');
  assert.doesNotMatch(rf, /mkdirSync|createWriteStream|renameSync/, 'replyfile must only read the store; storing goes through attachments.js');
  const joins = tracked.filter((f) => /path\.join\([^)]*ROOT[^)]*['"]attachments['"]/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.deepEqual(joins, [], 'a file builds the store path itself');
});

test('#6734: an upload whose part file cannot be written (a full disk) is refused with a sentence and leaves nothing', async () => {
  const before = stored().length;
  const real = fs.createWriteStream;
  let failed = 0;
  const full = (cb) => { failed += 1; cb(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })); };
  fs.createWriteStream = function (file, opts) {
    if (!String(file).endsWith(attachments.PART)) return real.apply(this, arguments);
    // The stream's own fs hook: the part file opens and closes for real, and every write fails as on a full disk.
    return real.call(this, file, { ...opts, fs: { open: fs.open, close: fs.close, write: (...a) => full(a[a.length - 1]), writev: (...a) => full(a[a.length - 1]) } });
  };
  let got;
  try {
    got = await put({ 'content-type': 'application/octet-stream', 'content-length': String(64 * 1024), 'x-attachment-name': 'full-disk.bin' },
      (req) => { req.on('error', () => {}); req.end(Buffer.alloc(64 * 1024, 3)); });
  } finally { fs.createWriteStream = real; }
  assert.ok(failed > 0, 'the write was never attempted, so this tested nothing');
  assert.equal(got.status, 400, JSON.stringify(got));
  assert.equal(JSON.parse(got.body).error, 'that file could not be kept');
  assert.ok(await until(() => stored().length === before && parts().length === 0), 'a failed write left ' + JSON.stringify(parts()));
});

test('#6734: a system error while storing an upload reaches the person as a sentence, never as a path with their name', async () => {
  const before = stored().length;
  const real = fs.renameSync;
  let thrown = 0;
  fs.renameSync = function (from) {
    if (String(from).endsWith(attachments.PART)) {
      thrown += 1;
      throw Object.assign(new Error("ENOSPC: no space left on device, rename '" + from + "'"), { code: 'ENOSPC' });
    }
    return real.apply(this, arguments);
  };
  let got;
  try {
    got = await put({ 'content-type': 'application/octet-stream', 'content-length': '4096', 'x-attachment-name': 'rename-fails.bin' },
      (req) => { req.on('error', () => {}); req.end(Buffer.alloc(4096, 5)); });
  } finally { fs.renameSync = real; }
  assert.ok(thrown > 0, 'the rename was never reached, so this tested nothing');
  assert.equal(got.status, 400, JSON.stringify(got));
  assert.equal(JSON.parse(got.body).error, 'we could not keep that file');
  assert.ok(!got.body.includes(SANDBOX) && !got.body.includes('ENOSPC'), got.body);
  assert.ok(await until(() => stored().length === before && parts().length === 0), 'a failed rename left ' + JSON.stringify(parts()));
});

test('#6734: a stored attachment and its record are both readable by this user only (0600)', { skip: process.platform === 'win32' }, () => {
  const rec = storedOf(1024, 'modes.bin');
  assert.equal(fs.statSync(rec.file).mode & 0o777, 0o600, 'the file');
  assert.equal(fs.statSync(path.join(rec.dir, 'record.json')).mode & 0o777, 0o600, 'the record');
  assert.equal(fs.statSync(rec.dir).mode & 0o777, 0o700, 'the folder');
  assert.equal(fs.statSync(path.dirname(rec.dir)).mode & 0o777, 0o700, 'the owner folder above it');
});

test('#6734: a file an older build stored under its old clean name (".env" from " .env") is still found', () => {
  const owner = path.join(attachments.ROOT, 'agent', 'old-names');
  const record = (id, name, files) => {
    const dir = path.join(owner, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f), 'content of ' + f);
    fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({ id, name, type: 'text/plain', size: 1, kind: 'text', at: new Date().toISOString(), scope: 'agent', owner: 'old-names' }));
  };
  try {
    record('a1'.repeat(12), '.env', ['.env']);   // what the old safeName kept for " .env"
    const got = attachments.read('a1'.repeat(12));
    assert.ok(got, 'an old record was lost');
    assert.equal(path.basename(got.file), '.env');
    assert.equal(fs.readFileSync(got.file, 'utf8'), 'content of .env');
    // CONTROLS: a record naming the part file, or a path, is never followed as stored.
    record('a2'.repeat(12), attachments.PART, [attachments.PART]);
    assert.equal(attachments.read('a2'.repeat(12)), null);
    record('a3'.repeat(12), '../a1a1a1a1a1a1a1a1a1a1a1a1/.env', []);
    assert.equal(attachments.read('a3'.repeat(12)), null);
    // Review 14: the part file in another case, or with a trailing dot, is the same file on macOS and Windows.
    record('a4'.repeat(12), '.UPLOAD.PART', [attachments.PART]);
    assert.equal(attachments.read('a4'.repeat(12)), null);
    record('a5'.repeat(12), attachments.PART + '.', [attachments.PART]);
    assert.equal(attachments.read('a5'.repeat(12)), null);
  } finally {
    fs.rmSync(owner, { recursive: true, force: true });
  }
});

test('#6734: a name Windows would read as record.json or preview.png ("record.json." or with spaces) is renamed', () => {
  assert.equal(attachments.safeName('record.json.'), 'file-record.json.');
  assert.equal(attachments.safeName('Preview.PNG . '), 'file-Preview.PNG .');
  assert.equal(attachments.safeName('record.json.txt'), 'record.json.txt', 'CONTROL: a longer name is its own');
  // Review 15: a long s (U+017F) folds to s on a case-insensitive disk, so this is the record's own file there.
  const longS = 'record.j' + String.fromCharCode(0x17f) + 'on';
  assert.equal(attachments.safeName(longS), 'file-' + longS);
});

test('#6734: a failure answering for a stored upload takes the file back and says it was not added', async () => {
  const before = stored().length;
  const real = attachments.rowField;
  let thrown = 0;
  attachments.rowField = () => { thrown += 1; throw new Error('answering failed'); };
  let got;
  try {
    got = await put({ 'content-type': 'application/octet-stream', 'content-length': '4', 'x-attachment-name': 'kept.bin' },
      (req) => req.end('kept'));
  } finally { attachments.rowField = real; }
  assert.ok(thrown > 0, 'the answer was never built, so this tested nothing');
  assert.equal(got.status, 500, JSON.stringify(got));
  assert.equal(JSON.parse(got.body).error, 'we could not add that file; try again');
  // Review 19: nothing refers to it and nothing would list it, so it must not be left taking up space.
  assert.ok(await until(() => stored().length === before), 'a file nobody can reach was left behind');
});

test('#6734: an upload whose client leaves during the conversion is taken back, not left with nobody holding its id', async () => {
  const before = stored().length;
  const attachtext = require('./engine/attachtext');
  const real = attachtext.render;
  let release = null;
  attachtext.render = () => new Promise((r) => { release = r; });
  try {
    const req = http.request({ host: '127.0.0.1', port: port(), method: 'PUT', path: '/api/project/' + project.id + '/attachment',
      headers: { 'content-type': 'application/octet-stream', 'content-length': '4', 'x-attachment-name': 'gone.docx' } });
    req.on('error', () => {});
    req.end('gone');
    assert.ok(await until(() => release !== null), 'the conversion was never reached, so this tested nothing');
    assert.equal(stored().length, before + 1, 'CONTROL: the file was stored before the client left');
    req.destroy();
    await wait(100);
    release(null);
    assert.ok(await until(() => stored().length === before), 'an upload nobody will ever hear about was left behind');
  } finally { attachtext.render = real; }
});

test('#6734: discardStored removes only an attachment folder, never an owner folder or anything outside the store', () => {
  const owner = path.join(attachments.ROOT, 'agent', 'discard-guard');
  const id = path.join(owner, 'b'.repeat(24));
  fs.mkdirSync(id, { recursive: true });
  try {
    attachments.discardStored({ dir: owner });
    attachments.discardStored({ dir: path.join(owner, 'not-an-id') });
    attachments.discardStored({ dir: path.join(attachments.ROOT, '..') });
    assert.ok(fs.existsSync(id), 'a folder that is not one attachment was removed');
    attachments.discardStored({ dir: id });
    assert.ok(!fs.existsSync(id), 'CONTROL: an attachment folder is removed');
  } finally { fs.rmSync(owner, { recursive: true, force: true }); }
});

test('#6734: saveStream refuses a request that already went away instead of waiting on it for ever', async () => {
  const { PassThrough } = require('node:stream');
  const gone = new PassThrough();
  gone.destroy();
  await new Promise((r) => gone.once('close', r));   // gone already: its close has fired before saveStream listens
  assert.ok(gone.destroyed && gone.listenerCount('close') === 0);
  const before = fs.existsSync(path.join(attachments.ROOT, 'agent', 'gone-source')) ? fs.readdirSync(path.join(attachments.ROOT, 'agent', 'gone-source')).length : 0;
  const got = await Promise.race([
    attachments.saveStream('agent', 'gone-source', { name: 'x.bin', type: 'application/octet-stream' }, gone).then(() => 'stored', (e) => e.message),
    wait(2000).then(() => 'still waiting'),
  ]);
  assert.equal(got, 'the file stopped arriving before it was whole');
  assert.ok(await until(() => fs.readdirSync(path.join(attachments.ROOT, 'agent', 'gone-source')).length === before), 'its folder was left');
  // CONTROL: a live source is still read and stored.
  const live = new PassThrough();
  const kept = attachments.saveStream('agent', 'gone-source', { name: 'y.bin', type: 'application/octet-stream' }, live);
  live.end(Buffer.from('ok'));
  assert.equal((await kept).size, 2);
});

test('#6734: a download whose client stops reading is ended after the stall time, releasing its descriptor', async () => {
  /* Measured on the board's side: a paused client never reads the board's close (the FIN sits unread), so the client
     cannot report it. What matters is that the board lets go of the file while that client is still connected. */
  const srv = require('./server');
  const rec = storedOf(64 * MB, 'stalled.bin');   // larger than the socket buffers, so the board is left waiting
  srv._setDownloadStallForTest(300);
  let req = null;
  try {
    let openWhilePaused = -1;
    await new Promise((resolve, reject) => {
      req = http.get({ host: '127.0.0.1', port: port(), path: '/api/attachment/' + rec.id }, (res) => {
        res.pause();   // connected, reading nothing
        openWhilePaused = fdsOn(rec.file);
        resolve();
      });
      req.on('error', (e) => { if (!/socket hang up|aborted|ECONNRESET/.test(String(e && e.message))) reject(e); });
    });
    assert.ok(openWhilePaused >= 1, 'CONTROL: no descriptor on the file was seen once the download started');
    assert.ok(await until(() => fdsOn(rec.file) === 0, 4000), 'the stalled download still holds the file open with its client connected');
  } finally {
    srv._setDownloadStallForTest(null);
    if (req) req.destroy();
  }
});
