'use strict';
/*
 * kosmos#9016: a file that did not arrive whole is never taken as whole.
 *
 *   - Boundary: 65,535 / 65,536 / 65,537 bytes and 1 MiB reach the store byte-identical (by sha256), however the body
 *     is sent (declared length, chunked, paused after the first 64 KiB).
 *   - Size: the sender may say the size of its own file (x-attachment-size). A body that arrives short or long of it is
 *     refused in words, with nothing stored; no header, or one that is not a plain number, checks nothing.
 *   - Zip: a zip-based file (an xlsx) whose end is missing is kept, marked `incomplete`, and said so: beside the file
 *     on the page, and to the agent it is handed to. A whole one, and a file that is not a zip, are not marked.
 *
 *   node --test server.attachment-whole-9016.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-whole-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-whole-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-whole-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-whole-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-whole-launch-'));

const { start, server } = require('./server');
const attachments = require('./engine/attachments');
const projects = require('./engine/projects');
const store = require('./engine/store');

let project = null;
test.before(async () => { await start(0); project = projects.create({ name: 'Whole Check' }); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const stored = () => { try { return fs.readdirSync(path.join(attachments.ROOT, 'project', store.safeKey(project.id))); } catch { return []; } };
function put(headers, write) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port: server.address().port, path: '/api/project/' + project.id + '/attachment', method: 'PUT', headers }, (x) => {
      const c = [];
      x.on('data', (d) => c.push(d));
      x.on('end', () => resolve({ status: x.statusCode, body: Buffer.concat(c).toString() }));
    });
    r.on('error', reject);
    write(r);
  });
}
const download = (id) => new Promise((resolve, reject) => {
  http.get({ port: server.address().port, path: '/api/attachment/' + id }, (x) => {
    const c = []; x.on('data', (d) => c.push(d)); x.on('end', () => resolve(Buffer.concat(c)));
  }).on('error', reject);
});
const headers = (name, extra) => ({ 'content-type': 'application/octet-stream', 'x-attachment-name': encodeURIComponent(name), ...extra });

/** A real zip of one stored entry, so truncation is of a real one. */
function zipOf(name, data) {
  const crc = crc32(data);
  const local = Buffer.alloc(30 + name.length);
  local.write('PK\x03\x04', 0, 'binary'); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.write(name, 30);
  const body = Buffer.concat([local, data]);
  const central = Buffer.alloc(46 + name.length);
  central.write('PK\x01\x02', 0, 'binary'); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.write(name, 46);
  const end = Buffer.alloc(22);
  end.write('PK\x05\x06', 0, 'binary'); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, end]);
}
function crc32(buf) { let c, t = -1; for (const b of buf) { c = (t ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; t = (t >>> 8) ^ c; } return (t ^ -1) >>> 0; }

const SIZES = [65535, 65536, 65537, 1024 * 1024];
const WAYS = {
  declared: (b, r) => r.end(b),
  chunked: (b, r) => r.end(b),
  /* Half the body, then the rest after a pause, so bytes really arrive after it at every size. */
  paused: (b, r) => { const at = Math.floor(b.length / 2); r.write(b.subarray(0, at)); setTimeout(() => r.end(b.subarray(at)), 150); },
};
for (const [way, write] of Object.entries(WAYS)) for (const n of SIZES) {
  test('#9016 boundary: ' + n + ' bytes sent ' + way + ' are stored byte-identical', async () => {
    const buf = crypto.randomBytes(n);
    const h = way === 'declared' || way === 'paused' ? { 'content-length': String(n) } : { 'transfer-encoding': 'chunked' };
    const a = await put(headers('b-' + n + '.bin', { ...h, 'x-attachment-size': String(n) }), (r) => write(buf, r));
    assert.equal(a.status, 200, a.body);
    const att = JSON.parse(a.body).attachment;
    assert.equal(att.size, n);
    assert.equal(sha(await download(att.id)), sha(buf), 'byte-identical');
  });
}

test('#9016 size: a body short of, or long past, the sender\'s own file is refused in words and nothing is stored', async () => {
  for (const [said, sent] of [[200000, 65536], [65536, 200000], [200000, 199999]]) {
    const before = stored().length;
    const r = await put(headers('cut.xlsx', { 'transfer-encoding': 'chunked', 'x-attachment-size': String(said) }), (q) => q.end(crypto.randomBytes(sent)));
    assert.equal(r.status, 400, said + ' vs ' + sent + ': ' + r.body);
    const said_ = JSON.parse(r.body).error;
    assert.match(said_, /^that file did not arrive whole; please send it again \(/, said_);
    assert.ok(said_.includes(sent < said ? sent.toLocaleString('en-US') + ' of ' + said.toLocaleString('en-US') + ' bytes' : sent.toLocaleString('en-US') + ' bytes arrived, and the file is ' + said.toLocaleString('en-US')), 'exact counts, said for what they are: ' + said_);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(stored().length, before, 'nothing kept (' + said + ' vs ' + sent + ')');
  }
});

test('#9016 size: with no header, or one that is not a plain number, nothing is checked', async () => {
  for (const extra of [{}, { 'x-attachment-size': 'lots' }, { 'x-attachment-size': '-1' }, { 'x-attachment-size': '1.5' }]) {
    const r = await put(headers('plain.bin', { 'content-length': '10', ...extra }), (q) => q.end(Buffer.alloc(10, 1)));
    assert.equal(r.status, 200, JSON.stringify(extra) + ' ' + r.body);
  }
  for (const huge of ['99999999999', '9999999999999', '9'.repeat(30)]) {
    const over = await put(headers('huge.bin', { 'content-length': '10', 'x-attachment-size': huge }), (q) => q.end(Buffer.alloc(10, 1)));
    assert.equal(over.status, 400, 'a file that says it is over the cap is refused (' + huge + '): ' + over.body);
    assert.match(over.body, /larger than/);
  }
});

test('#9016 zip: an xlsx with its end missing is kept and marked, whatever the cut; a whole one is not', async () => {
  const whole = zipOf('xl/workbook.xml', crypto.randomBytes(200000));
  assert.equal((await put(headers('whole.xlsx', { 'content-length': String(whole.length) }), (r) => r.end(whole))).status, 200);
  for (const cut of [65536, 4096, whole.length - 5, whole.length - 60]) {
    const part = whole.subarray(0, cut);
    const r = await put(headers('cut-' + cut + '.xlsx', { 'content-length': String(part.length) }), (q) => q.end(part));
    assert.equal(r.status, 200, r.body);
    const a = JSON.parse(r.body).attachment;
    assert.equal(a.incomplete, true, 'a zip of ' + cut + ' bytes of ' + whole.length + ' is marked');
    const rec = attachments.read(a.id);
    assert.equal(rec.incomplete, true);
    assert.match(attachments.wireNote([rec]), /INCOMPLETE: its ending could not be found, so it may be cut short\. Ask for it to be sent again/);
  }
  const fine = JSON.parse((await put(headers('whole.xlsx', { 'content-length': String(whole.length) }), (r) => r.end(whole))).body).attachment;
  assert.equal(fine.incomplete, undefined, 'CONTROL: a whole zip says nothing');
  assert.doesNotMatch(attachments.wireNote([attachments.read(fine.id)]), /INCOMPLETE/);
  const plain = JSON.parse((await put(headers('notes.bin', { 'content-length': '9' }), (r) => r.end('not a zip'))).body).attachment;
  assert.equal(plain.incomplete, undefined, 'CONTROL: a file that is not a zip is not judged');
});

test('#9016 zip: what is and is not judged', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-zip-9016-'));
  const at = (name, buf) => { const p = path.join(d, name); fs.writeFileSync(p, buf); return p; };
  const whole = zipOf('a.txt', Buffer.from('hello'));
  assert.equal(attachments.incompleteZip(at('whole.zip', whole)), false);
  assert.equal(attachments.incompleteZip(at('empty.zip', Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]))), false, 'an empty zip is whole');
  assert.equal(attachments.incompleteZip(at('head-only.zip', whole.subarray(0, 30))), true);
  /* Review 1: a cut file that holds a whole inner zip (an office file embeds one) has the INNER end record in its tail. */
  const outer = zipOf('inner.zip', whole);
  assert.equal(attachments.incompleteZip(at('outer.zip', outer)), false);
  const cutAfterInner = outer.subarray(0, outer.length - 22 - 46 - 9 - 1);   // the outer directory and end are gone, the inner zip's are in
  assert.ok(cutAfterInner.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'precondition: the inner end record is there');
  assert.equal(attachments.incompleteZip(at('cut-inner.zip', cutAfterInner)), true, 'the inner zip is not the outer one');
  /* A comment that holds the end signature is not an end record. */
  const comment = Buffer.from('PK\x05\x06 noted here');
  const withComment = Buffer.concat([whole, comment]);
  withComment.writeUInt16LE(comment.length, whole.length - 2);
  assert.equal(attachments.incompleteZip(at('comment.zip', withComment)), false, 'a whole zip with such a comment');
  assert.equal(attachments.incompleteZip(at('comment-cut.zip', withComment.subarray(0, withComment.length - 3))), true, 'its comment cut short');
  assert.equal(attachments.incompleteZip(at('appended.zip', Buffer.concat([whole, crypto.randomBytes(300 * 1024)]))), false, 'data somebody appended after the end is not a cut');
  /* Review 2: an inner EMPTY archive's record, in a file that is not one, is not the file's end. */
  const withEmptyInner = zipOf('empty.zip', Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]));
  assert.equal(attachments.incompleteZip(at('outer-empty.zip', withEmptyInner)), false);
  assert.equal(attachments.incompleteZip(at('cut-empty-inner.zip', withEmptyInner.subarray(0, withEmptyInner.length - 22 - 46 - 9))), true, 'its directory and end are gone');
  const dirBad = Buffer.from(whole);
  dirBad.writeUInt32LE(whole.length, dirBad.length - 6 /* the directory offset of the end record */);
  assert.equal(attachments.incompleteZip(at('dirbad.zip', dirBad)), true, 'a directory past the end of the file');
  const zip64 = Buffer.from(whole);
  zip64.writeUInt32LE(0xffffffff, zip64.length - 6);
  assert.equal(attachments.incompleteZip(at('zip64.zip', zip64)), false, 'the zip64 form is not judged');
  /* A volume of a split archive has no end of its own. */
  assert.equal(attachments.incompleteZip(at('big.zip.001', whole.subarray(0, 60))), false);
  assert.equal(attachments.incompleteZip(at('big.z01', whole.subarray(0, 60))), false);
  assert.equal(attachments.incompleteZip(at('big.zip', whole.subarray(0, 60))), true, 'CONTROL: the same bytes under another name');
  /* An encrypted directory does not start as one, but ends where the record begins. */
  const enc = Buffer.from(whole);
  const cd = whole.length - 22 - 51;   // the central entry is 46 + the 5-letter name
  enc.fill(0x7a, cd, whole.length - 22);
  assert.equal(attachments.incompleteZip(at('encrypted.zip', enc)), false, 'a directory that is not readable but is whole');
  assert.equal(attachments.incompleteZip(at('over.zip', Buffer.concat([whole.subarray(0, whole.length - 5), Buffer.alloc(1)]))), true);
  assert.equal(attachments.incompleteZip(at('tiny.zip', Buffer.from('PK'))), false);
  assert.equal(attachments.incompleteZip(at('text.txt', Buffer.from('PK is a word'))), false);
  assert.equal(attachments.incompleteZip(path.join(d, 'none.zip')), false, 'a file that cannot be read is as it was');
});

test('#9016 the agent-side copy keeps a file at the boundary whole (engine/replyfile.js readOwn)', () => {
  const replyfile = require('./engine/replyfile');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-copy-9016-'));
  for (const n of SIZES) {
    const src = path.join(d, 'src-' + n);
    const buf = crypto.randomBytes(n);
    fs.writeFileSync(src, buf);
    const real = fs.realpathSync(src);
    const out = fs.openSync(path.join(d, 'out-' + n), 'w');
    const got = replyfile.readOwn(real, fs.statSync(real, { bigint: true }), real, out);
    fs.closeSync(out);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.size, n);
    assert.equal(sha(fs.readFileSync(path.join(d, 'out-' + n))), sha(buf));
  }
});

test('#9016 the page says it beside the file, and sends the file\'s own size', () => {
  const page = require('./test-support/page');
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const SCRIPT = page.scriptOf(html);
  const fn = new Function('esc', 'pjFileWord', 'pjSize', 'PV_ATTS', page.lift(SCRIPT, 'pjAttachmentCard') + '\nreturn pjAttachmentCard;')(
    (s) => String(s), () => 'Excel spreadsheet', () => '64 KB', new Map());
  const url = '/api/attachment/' + 'a'.repeat(24);
  assert.match(fn({ url, name: 'book.xlsx', kind: 'other', size: 65536, incomplete: true }), /incomplete upload, please send again/);
  assert.doesNotMatch(fn({ url, name: 'book.xlsx', kind: 'other', size: 65536 }), /incomplete/, 'CONTROL');
  assert.match(SCRIPT, /'x-attachment-size': String\(file\.size\)/, 'the page sends the size the browser read');
});

test('#9016 the mark survives being saved: a direct conversation keeps it', () => {
  const chat = require('./engine/chat');
  const rec = { id: 'b'.repeat(24), name: 'book.xlsx', type: 'application/zip', size: 10, kind: 'other', url: '/api/attachment/' + 'b'.repeat(24), preview: null, incomplete: true };
  const kept = chat.appendMessage(chat.DIRECT, 'whole9016', { text: 'here it is', at: new Date().toISOString(), delivery: 'person', attachment: rec, attachments: [rec] });
  assert.equal(kept && kept.recorded, true, JSON.stringify(kept));
  const thread = chat.readThread(chat.DIRECT, 'whole9016');
  const rows = (thread.rows || thread.messages || thread).filter((m) => m && m.attachment);
  assert.ok(rows.length >= 1, 'precondition: the message is kept');
  assert.equal(rows[rows.length - 1].attachment.incomplete, true, 'kept beside the file');
  assert.equal(rows[rows.length - 1].attachments[0].incomplete, true);
  const plainRec = { ...rec };
  delete plainRec.incomplete;
  chat.appendMessage(chat.DIRECT, 'plain9016', { text: 'whole', at: new Date().toISOString(), delivery: 'person', attachment: plainRec });
  const pr = chat.readThread(chat.DIRECT, 'plain9016');
  const plainRows = (pr.messages || pr.rows || pr).filter((m) => m && m.attachment);
  assert.equal(plainRows[plainRows.length - 1].attachment.incomplete, undefined, 'CONTROL: a whole file is not marked');
});

test('#9016 an agent that attaches its own cut file is told, and nothing is kept', () => {
  const replyfile = require('./engine/replyfile');
  const files = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'cut9016', 'Files');
  fs.mkdirSync(files, { recursive: true });
  const whole = zipOf('a.txt', crypto.randomBytes(5000));
  fs.writeFileSync(path.join(files, 'whole.zip'), whole);
  fs.writeFileSync(path.join(files, 'cut.xlsx'), whole.subarray(0, 3000));
  const roster = [{ session: 'cut9016', workdir: path.join(process.env.AGENT_WORKFORCE_WORKERS, 'cut9016') }];
  const ok = replyfile.attach('cut9016', path.join(files, 'whole.zip'), { roster });
  const bad = replyfile.attach('cut9016', path.join(files, 'cut.xlsx'), { roster });
  if (ok.ok) {
    assert.equal(ok.rec.incomplete, undefined, 'CONTROL: a whole one is attached');
    assert.equal(bad.ok, false);
    assert.match(bad.because, /looks cut short.*save it again/);
    assert.equal(fs.existsSync(path.join(attachments.ROOT, 'agent', store.safeKey('cut9016'))) && fs.readdirSync(path.join(attachments.ROOT, 'agent', store.safeKey('cut9016'))).length, 1, 'only the whole file is kept');
  } else { assert.fail('this environment did not let an agent attach its own file: ' + ok.because); }
});

test('#9016 the page says it on the chip, the status line, the documents list and the preview', () => {
  const page = require('./test-support/page');
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const SCRIPT = page.scriptOf(html);
  const pv = new Map();
  const card = new Function('esc', 'pjFileWord', 'pjSize', 'PV_ATTS', page.lift(SCRIPT, 'pjAttachmentCard') + '\nreturn pjAttachmentCard;')(
    (x) => String(x), () => 'Excel spreadsheet', () => '64 KB', pv);
  const url = '/api/attachment/' + 'c'.repeat(24);
  card({ url, name: 'book.xlsx', kind: 'other', size: 65536, incomplete: true });
  assert.equal(pv.get('c'.repeat(24)).meta, 'Excel spreadsheet · 64 KB · incomplete upload, please send again', 'the full-page preview says it');
  card({ url, name: 'book.xlsx', kind: 'other', size: 65536 });
  assert.equal(pv.get('c'.repeat(24)).meta, 'Excel spreadsheet · 64 KB', 'CONTROL');
  /* The pending chip: the real function, over a fake box and list. */
  const box = { hidden: true, innerHTML: '' };
  const list = [{ id: 'x', name: 'book.xlsx', incomplete: true }, { id: 'y', name: 'ok.txt' }];
  const chips = new Function('document', 'attachList', 'esc', page.lift(SCRIPT, 'attachPaint') + '\nreturn attachPaint;')(
    { getElementById: () => box }, () => list, (x) => String(x));
  chips({ chipsId: 'c' });
  const parts = box.innerHTML.split('attach-chip-name').slice(1);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /incomplete upload, please send again/, 'the chip of the cut file says it');
  assert.doesNotMatch(parts[1], /incomplete/, 'CONTROL: the other chip does not');
  assert.match(SCRIPT, /w\.textContent = pjSize\(a\.size\) \+ \(a\.incomplete === true \? ' · incomplete upload, please send again' : ''\)/, 'the documents list says it');
});

/* The page's own upload functions, run over a fake page and a fake board: `answers` are what each upload is told, in order. */
function uploader(answers) {
  const page = require('./test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const els = { m: { textContent: '' }, b: { disabled: false } };
  const list = []; const sent = []; const u = { target: 'leo' };
  const src = ['attachCutSay', 'attachUpload', 'attachUploadAll'].map((n) => page.lift(SCRIPT, n)).join('\n');
  const all = new Function('document', 'attachList', 'attachTarget', 'attachAdd', 'fetch', 'ATTACH_MAX', 'ATTACH_MAX_BYTES', 'ATTACH_SLOW_BYTES',
    'let ATTACH_UPLOADING = 0;\n' + src + '\nreturn attachUploadAll;')(
    { getElementById: (id) => els[id] || null }, () => list, () => u.target, (w, r) => list.push(r),
    async (url, opt) => {
      sent.push(opt.headers);
      const a = answers.shift();
      if (a === 'down') throw new TypeError('failed to fetch');
      return a.error ? { ok: false, status: 400, json: async () => ({ error: a.error }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, attachment: { id: 'i' + sent.length, name: 'n' + sent.length, ...(a.cut ? { incomplete: true } : {}) } }) };
    }, 3, 1000, 5000);
  Object.assign(u, { go: (...files) => all(files, { msgId: 'm', btnId: 'b', textId: 't', url: () => '/x' }), els, list, sent });
  return u;
}
const pick = (name, size = 10) => ({ name, size, type: '' });
const CUT1 = 'a.xlsx may be cut short: its ending could not be found. Remove it and send it again.';

test('#9016 a pick of several: every outcome is still said at the end', async () => {
  let u = uploader([{}, {}]);
  await u.go(pick('a.xlsx'), pick('b.txt'));
  assert.equal(u.els.m.textContent, '', 'CONTROL: whole files say nothing');
  assert.equal(u.list.length, 2);
  assert.equal(u.sent[0]['x-attachment-size'], '10', 'the size sent is the file\'s own');

  u = uploader([{ cut: true }]);
  await u.go(pick('a.xlsx'));
  assert.equal(u.els.m.textContent, CUT1, 'one file');

  u = uploader([{ cut: true }, {}]);
  await u.go(pick('a.xlsx'), pick('b.txt'));
  assert.equal(u.els.m.textContent, CUT1, 'a whole file after the cut one does not wipe it');

  u = uploader([{ cut: true }, {}, { cut: true }]);
  await u.go(pick('a.xlsx'), pick('b.txt'), pick('c.xlsx'));
  assert.equal(u.els.m.textContent, '2 files may be cut short (a.xlsx, c.xlsx): their endings could not be found. Remove them and send them again.');

  u = uploader([{ error: 'that file did not arrive whole; please send it again (5 of 10 bytes arrived)' }]);
  await u.go(pick('$$a$&.xlsx'));
  assert.equal(u.els.m.textContent, '$$a$&.xlsx did not arrive whole; please send it again (5 of 10 bytes arrived).', 'one refused file is named, whatever its name holds');

  u = uploader([{ error: 'that file did not arrive whole; please send it again (5 of 10 bytes arrived)' }, {}]);
  await u.go(pick('a.xlsx'), pick('b.txt'));
  assert.equal(u.els.m.textContent, 'a.xlsx did not arrive whole; please send it again (5 of 10 bytes arrived). Not added: a.xlsx.', 'a refused file is named');
  assert.equal(u.list.length, 1, 'and the next one is still added');

  u = uploader([{ cut: true }, { error: 'no' }, { error: 'no' }, {}]);
  await u.go(pick('a.xlsx'), pick('b.txt'), pick('c.txt'), pick('d.txt'));
  assert.equal(u.els.m.textContent, 'no. Not added: b.txt, c.txt. ' + CUT1, 'one sentence for one reason, each file named, and the earlier cut file kept');
  assert.equal(u.list.length, 2);

  u = uploader([{}, 'down', {}]);
  await u.go(pick('a.xlsx'), pick('b.txt'), pick('c.txt'));
  assert.equal(u.els.m.textContent, 'We could not reach Kosmos to add that file. Not added: b.txt, c.txt.', 'a lost connection stops it');
  assert.equal(u.sent.length, 2);

  u = uploader([{}]);
  await u.go(pick('big.bin', 1001), pick('b.txt'));
  assert.match(u.els.m.textContent, /^That file is over .* Not added: big\.bin\.$/, 'a file over the cap');
  assert.equal(u.list.length, 1, 'the next one is still added');

  u = uploader([{ cut: true }, {}, {}]);
  await u.go(pick('a.xlsx'), pick('b'), pick('c'), pick('d'), pick('e'));
  assert.equal(u.els.m.textContent, 'A message can carry 3 files; send these first. Not added: d, e. ' + CUT1, 'the limit of files');
  assert.equal(u.sent.length, 3);

  u = uploader([]);
  u.target = null;
  await u.go(pick('a'), pick('b'));
  assert.equal(u.els.m.textContent, 'Open a conversation first. Not added: a, b.', 'nothing open');
});
