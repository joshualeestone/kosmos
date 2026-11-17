'use strict';
/*
 * kosmos#8637: the file preview flips through every page of a multi-page PDF. The two preview routes (a chat
 * attachment's, and a Files list's) take ?page=N for the pages past the first, and a HEAD answers the page count in
 * x-kosmos-pdf-pages, which is how the viewer learns whether to show arrows. A GET of page 1 does what it did before
 * (no count is read). A page past the end, page 0 or a page that is not a number is 404; a count that cannot be read
 * gives no header and no later pages. PDFKit (engine/pdfpages.js) is replaced by a seam here; its real drawing is
 * engine/pdfpages-8637.test.js's.
 *
 *   node --test server.pdf-pages-8637.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pdfpages-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pdfpages-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pdfpages-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pdfpages-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pdfpages-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const dmfiles = require('./engine/dmfiles');
const attachments = require('./engine/attachments');
const filepreview = require('./engine/filepreview');
const pdfpages = require('./engine/pdfpages');
const store = require('./engine/store');
const CACHE = () => path.join(store.ROOT, 'filepreview');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const base = () => `http://127.0.0.1:${server.address().port}`;
let FILES = null;
/* The seam: `pages` is what the count answers (null: it cannot be read); every call is recorded. */
const seam = { pages: 3, counts: [], renders: [] };
function useSeam() {
  pdfpages.setImplForTest({
    count: (file) => { seam.counts.push(file); return seam.pages; },
    render: (file, index, out) => { seam.renders.push({ file, index }); fs.writeFileSync(out, Buffer.concat([PNG, Buffer.from('page-' + (index + 1) + ':'), fs.readFileSync(file)])); return true; },
  });
}
function reset(pages) { seam.pages = pages; seam.counts.length = 0; seam.renders.length = 0; }

test.before(async () => {
  await start(0);
  attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, Buffer.from('first:'), fs.readFileSync(file)])); });
  useSeam();
  FILES = dmfiles.filesDir('ava');
  fs.mkdirSync(FILES, { recursive: true });
});
test.after(() => { pdfpages.setImplForTest(null); attachments.setRenderer(null); server.close(); });

let N = 0;
const pdfRec = () => attachments.save('agent', 'ava', { name: 'three-' + (++N) + '.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 three ' + N) });

test('attachment: a GET of page 1 is the first page as before, and reads no count', async () => {
  reset(3);
  const rec = pdfRec();
  const res = await fetch(`${base()}/api/attachment/${rec.id}/preview`);
  assert.equal(res.status, 200);
  assert.match(Buffer.from(await res.arrayBuffer()).toString('latin1'), /first:%PDF-1\.4 three/);
  assert.equal(res.headers.get('x-kosmos-pdf-pages'), null, 'a plain GET carries no count');
  assert.equal(seam.counts.length, 0, 'a plain GET read the count');
});

test('attachment: a HEAD answers the page count, read once and kept', async () => {
  reset(3);
  const rec = pdfRec();
  const h1 = await fetch(`${base()}/api/attachment/${rec.id}/preview`, { method: 'HEAD' });
  assert.equal(h1.status, 200);
  assert.equal(h1.headers.get('x-kosmos-pdf-pages'), '3');
  const h2 = await fetch(`${base()}/api/attachment/${rec.id}/preview`, { method: 'HEAD' });
  assert.equal(h2.headers.get('x-kosmos-pdf-pages'), '3');
  assert.equal(seam.counts.length, 1, 'the count was read again instead of kept');
});

test('attachment: ?page=2 and ?page=3 are those pages; 4, 0 and a word are 404', async () => {
  reset(3);
  const rec = pdfRec();
  for (const n of [2, 3]) {
    const res = await fetch(`${base()}/api/attachment/${rec.id}/preview?page=${n}`);
    assert.equal(res.status, 200, 'page ' + n);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('content-security-policy') || '', /sandbox/);
    assert.match(Buffer.from(await res.arrayBuffer()).toString('latin1'), new RegExp('page-' + n + ':%PDF'));
  }
  for (const bad of ['4', '0', 'two', '-1', '2.5']) {
    const res = await fetch(`${base()}/api/attachment/${rec.id}/preview?page=${bad}`);
    assert.equal(res.status, 404, 'page ' + bad + ' was served');
    await res.arrayBuffer();
  }
  assert.deepEqual(seam.renders.map((r) => r.index), [1, 2], 'only pages 2 and 3 were drawn');
});

test('attachment: a count that cannot be read gives no header and no later page (the viewer stays one page)', async () => {
  reset(null);
  const rec = pdfRec();
  const h = await fetch(`${base()}/api/attachment/${rec.id}/preview`, { method: 'HEAD' });
  assert.equal(h.status, 200, 'CONTROL: the first page is still there');
  assert.equal(h.headers.get('x-kosmos-pdf-pages'), null);
  const p2 = await fetch(`${base()}/api/attachment/${rec.id}/preview?page=2`);
  assert.equal(p2.status, 404);
  await p2.arrayBuffer();
  assert.equal(seam.renders.length, 0);
  assert.equal(fs.existsSync(path.join(rec.dir, 'pages.txt')), false, 'an unread count was kept');
});

test('attachment: an image says nothing about pages', async () => {
  reset(3);
  const rec = attachments.save('agent', 'ava', { name: 'shot.png', type: 'image/png', bytes: PNG });
  const h = await fetch(`${base()}/api/attachment/${rec.id}/preview`, { method: 'HEAD' });
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('x-kosmos-pdf-pages'), null);
  assert.equal(seam.counts.length, 0);
});

const filesUrl = (name, q) => `${base()}/api/agent/ava/files/preview?name=${encodeURIComponent(name)}${q || ''}`;

test('Files list: HEAD gives the count, ?page=2 the page drawn from a private copy, past the end is 404', async () => {
  reset(3);
  const listed = path.join(FILES, 'report.pdf');
  fs.writeFileSync(listed, Buffer.from('%PDF-1.4 report v1'));
  const g = await fetch(filesUrl('report.pdf'));
  assert.equal(g.status, 200, 'CONTROL: the first page');
  assert.equal(g.headers.get('x-kosmos-pdf-pages'), null);
  await g.arrayBuffer();
  assert.equal(seam.counts.length, 0, 'a plain GET read the count');
  const h = await fetch(filesUrl('report.pdf'), { method: 'HEAD' });
  assert.equal(h.headers.get('x-kosmos-pdf-pages'), '3');
  const p2 = await fetch(filesUrl('report.pdf', '&page=2'));
  assert.equal(p2.status, 200);
  assert.match(Buffer.from(await p2.arrayBuffer()).toString('latin1'), /page-2:%PDF-1\.4 report v1/);
  for (const r of seam.renders.concat(seam.counts.map((file) => ({ file })))) {
    // The private copy is gone once drawn, so this compares the recorded path itself: inside the board's cache, never the person's folder.
    assert.ok(path.resolve(r.file).startsWith(path.resolve(CACHE()) + path.sep), 'PDFKit read a file outside the cache: ' + r.file);
    assert.ok(!path.resolve(r.file).startsWith(path.resolve(FILES) + path.sep), 'PDFKit read the person\'s own path');
  }
  const p4 = await fetch(filesUrl('report.pdf', '&page=4'));
  assert.equal(p4.status, 404);
  await p4.arrayBuffer();
  const p0 = await fetch(filesUrl('report.pdf', '&page=0'));
  assert.equal(p0.status, 404);
  await p0.arrayBuffer();
});

test('Files list: a changed file is drawn afresh, and the older pages and count go', async () => {
  reset(3);
  const listed = path.join(FILES, 'changes.pdf');
  fs.writeFileSync(listed, Buffer.from('%PDF-1.4 changes v1'));
  await (await fetch(filesUrl('changes.pdf'))).arrayBuffer();
  await fetch(filesUrl('changes.pdf'), { method: 'HEAD' });
  await (await fetch(filesUrl('changes.pdf', '&page=2'))).arrayBuffer();
  const dir = fs.readdirSync(CACHE()).map((d) => path.join(CACHE(), d))
    .find((d) => fs.readdirSync(d).some((n) => /-p2\.png$/.test(n)) && JSON.parse(fs.readFileSync(path.join(d, 'source.json'), 'utf8')).target.endsWith('changes.pdf'));
  assert.ok(dir, 'no cache folder holds page 2');
  const before = fs.readdirSync(dir).filter((n) => /\.(png|pages)$/.test(n)).sort();
  assert.equal(before.length, 3, 'the first page, page 2 and the count: ' + before.join(','));
  fs.writeFileSync(listed, Buffer.from('%PDF-1.4 changes v2, longer'));
  const p2 = await fetch(filesUrl('changes.pdf', '&page=2'));
  assert.match(Buffer.from(await p2.arrayBuffer()).toString('latin1'), /page-2:%PDF-1\.4 changes v2/, 'the old page 2 was served');
  const after = fs.readdirSync(dir).filter((n) => /\.(png|pages)$/.test(n));
  assert.ok(!after.some((n) => before.includes(n)), 'an older stamp\'s picture or count stayed: ' + after.join(','));
});

test('Files list: a count that cannot be read is no header and no page 2, and leaves no empty folder', async () => {
  reset(null);
  fs.writeFileSync(path.join(FILES, 'nocount.pdf'), Buffer.from('%PDF-1.4 nocount'));
  const folders = () => (fs.existsSync(CACHE()) ? fs.readdirSync(CACHE()).length : 0);
  const had = folders();
  const p2 = await fetch(filesUrl('nocount.pdf', '&page=2'));
  assert.equal(p2.status, 404);
  await p2.arrayBuffer();
  assert.equal(folders(), had, 'a failed later page left a folder behind');
  const h = await fetch(filesUrl('nocount.pdf'), { method: 'HEAD' });
  assert.equal(h.status, 200, 'CONTROL: the first page');
  assert.equal(h.headers.get('x-kosmos-pdf-pages'), null);
});

test('filepreview.preview refuses a page that is not a whole number from 1', async () => {
  reset(3);
  fs.writeFileSync(path.join(FILES, 'direct.pdf'), Buffer.from('%PDF-1.4 direct'));
  for (const page of [0, -2, 1.5, '2']) {
    const r = await filepreview.preview(FILES, 'direct.pdf', 'ava', { maxDepth: 0, page });
    assert.equal(r.ok, false, 'page ' + JSON.stringify(page));
  }
  const ok = await filepreview.preview(FILES, 'direct.pdf', 'ava', { maxDepth: 0, page: 2 });
  assert.equal(ok.ok, true, 'CONTROL: page 2');
  assert.equal(ok.pages, 3);
});

test('attachment: a PDF uploaded as "pages.txt" (or any page-file name) is never overwritten by its own count or pages', async () => {
  reset(3);
  const body = Buffer.from('%PDF-1.4 the only copy');
  for (const name of ['pages.txt', '.pdf-pages', 'preview-p2.png', '.pdf-page-2.png']) {
    const rec = attachments.save('agent', 'ava', { name, type: 'application/pdf', bytes: body });
    assert.ok(!['.pdf-pages', '.pdf-page-2.png'].includes(path.basename(rec.file)), 'stored under a page file\'s name: ' + rec.file);
    const h = await fetch(`${base()}/api/attachment/${rec.id}/preview`, { method: 'HEAD' });
    if (rec.kind === 'pdf') {
      assert.equal(h.headers.get('x-kosmos-pdf-pages'), '3', name);
      await (await fetch(`${base()}/api/attachment/${rec.id}/preview?page=2`)).arrayBuffer();
    }
    assert.deepEqual(fs.readFileSync(rec.file), body, name + ': the upload itself was overwritten');
  }
});

test('Files list: the viewer\'s HEAD counts without drawing page 1 (its GET does that), and the count is kept', async () => {
  reset(3);
  let drawn = 0;
  attachments.setRenderer((file, dir) => { drawn++; fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, Buffer.from('first:'), fs.readFileSync(file)])); });
  try {
    fs.writeFileSync(path.join(FILES, 'headonly.pdf'), Buffer.from('%PDF-1.4 headonly'));
    const h = await fetch(filesUrl('headonly.pdf'), { method: 'HEAD' });
    assert.equal(h.status, 200);
    assert.equal(h.headers.get('x-kosmos-pdf-pages'), '3');
    assert.equal(drawn, 0, 'the HEAD drew page 1');
    const g = await fetch(filesUrl('headonly.pdf'));
    assert.match(Buffer.from(await g.arrayBuffer()).toString('latin1'), /first:%PDF-1\.4 headonly/, 'CONTROL: the GET draws page 1');
    assert.equal(drawn, 1);
    await fetch(filesUrl('headonly.pdf'), { method: 'HEAD' });
    assert.equal(seam.counts.length, 1, 'the count was read again instead of kept');
  } finally {
    attachments.setRenderer((file, dir) => { fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.concat([PNG, Buffer.from('first:'), fs.readFileSync(file)])); });
  }
});

test('Files list: flipping a PDF whose first page was never drawn counts once, not once per page', async () => {
  reset(4);
  fs.writeFileSync(path.join(FILES, 'direct-pages.pdf'), Buffer.from('%PDF-1.4 direct-pages'));
  for (const n of [2, 3, 4]) {
    const r = await fetch(filesUrl('direct-pages.pdf', '&page=' + n));
    assert.equal(r.status, 200, 'page ' + n);
    await r.arrayBuffer();
  }
  assert.equal(seam.counts.length, 1);
});
