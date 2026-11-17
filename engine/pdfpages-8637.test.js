'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
/**
 * kosmos#8637: engine/pdfpages.js, the page count and the pages past the first of a PDF for the file preview's
 * arrows. On a Mac the last two tests draw a real three-page PDF through PDFKit (osascript); elsewhere they skip, and
 * count and render answer null and false.
 *
 *   node --test engine/pdfpages-8637.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pdfpages = require('./pdfpages');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpages-8637-')));
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

test('pageOf: none is page 1; a whole number from 1 is that page; anything else is null', () => {
  assert.equal(pdfpages.pageOf(null), 1);
  assert.equal(pdfpages.pageOf(''), 1);
  assert.equal(pdfpages.pageOf('1'), 1);
  assert.equal(pdfpages.pageOf('3'), 3);
  assert.equal(pdfpages.pageOf('99999'), 99999);
  for (const bad of ['0', '-1', '2.5', 'two', '03', ' 2', '2 ', '100000', '1e3', '0x2']) assert.equal(pdfpages.pageOf(bad), null, JSON.stringify(bad));
});

test('the seam: count is believed only from 1 to MAX_PAGES, and a seam that throws is null and false', async () => {
  const out = path.join(SB, 'seam.png');
  for (const [given, want] of [[3, 3], [1, 1], [0, null], [-2, null], [2.5, null], [pdfpages.MAX_PAGES + 1, null], ['3', null], [null, null]]) {
    pdfpages.setImplForTest({ count: () => given, render: () => false });
    assert.equal(await pdfpages.count('x.pdf'), want, 'count ' + JSON.stringify(given));
  }
  pdfpages.setImplForTest({ count: () => { throw new Error('boom'); }, render: () => { throw new Error('boom'); } });
  assert.equal(await pdfpages.count('x.pdf'), null);
  assert.equal(await pdfpages.render('x.pdf', 1, out), false);
  assert.equal(fs.existsSync(out), false);
  pdfpages.setImplForTest(null);
});

test('render: draws through a temporary name renamed into place, shares one drawing between two asks, and refuses a bad index', async () => {
  const out = path.join(SB, 'p2.png');
  let calls = 0;
  pdfpages.setImplForTest({ count: () => 3, render: (file, index, to) => { calls++; assert.notEqual(to, out, 'drew straight into the final name'); fs.writeFileSync(to, 'page ' + index); return true; } });
  const [a, b] = await Promise.all([pdfpages.render('x.pdf', 1, out), pdfpages.render('x.pdf', 1, out)]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.equal(calls, 1, 'two asks for one page drew it twice');
  assert.equal(fs.readFileSync(out, 'utf8'), 'page 1');
  assert.deepEqual(fs.readdirSync(SB).filter((n) => /tmp/.test(n)), [], 'a temporary file was left behind');
  for (const bad of [-1, 1.5, '1', null]) assert.equal(await pdfpages.render('x.pdf', bad, path.join(SB, 'bad.png')), false, JSON.stringify(bad));
  assert.equal(calls, 1, 'a bad index reached the drawing');
  pdfpages.setImplForTest(null);
});

const mac = process.platform === 'darwin' && fs.existsSync('/usr/bin/osascript') && fs.existsSync('/usr/sbin/cupsfilter');
/* A three-page PDF made by macOS's own print filter from text with form feeds between the pages. */
function threePages() {
  const txt = path.join(SB, 'three.txt');
  fs.writeFileSync(txt, ['Page one', 'Page two', 'Page three'].join('\n\f'));
  const pdf = path.join(SB, 'three.pdf');
  fs.writeFileSync(pdf, execFileSync('/usr/sbin/cupsfilter', ['-m', 'application/pdf', txt], { stdio: ['ignore', 'pipe', 'ignore'] }));
  return pdf;
}

test('on a Mac: a real three-page PDF counts 3, and page 2 is drawn as an opaque PNG 1024 tall', { skip: !mac && 'needs macOS PDFKit' }, async () => {
  const pdf = threePages();
  assert.equal(await pdfpages.count(pdf), 3);
  const out = path.join(SB, 'real-p2.png');
  assert.equal(await pdfpages.render(pdf, 1, out), true);
  const png = fs.readFileSync(out);
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(20), 1024, 'not 1024 tall, as the first page is');
  // CONTROL: page 3 differs from page 2 (a renderer that ignored the index would draw the same page).
  const out3 = path.join(SB, 'real-p3.png');
  assert.equal(await pdfpages.render(pdf, 2, out3), true);
  assert.notDeepEqual(fs.readFileSync(out3), png);
});

test('on a Mac: past the end, a missing file and a file that is not a PDF are null and false, with nothing left behind', { skip: !mac && 'needs macOS PDFKit' }, async () => {
  const pdf = threePages();
  assert.equal(await pdfpages.render(pdf, 3, path.join(SB, 'past.png')), false);
  assert.equal(await pdfpages.count(path.join(SB, 'missing.pdf')), null);
  const notPdf = path.join(SB, 'words.pdf');
  fs.writeFileSync(notPdf, 'just words');
  assert.equal(await pdfpages.count(notPdf), null);
  assert.equal(await pdfpages.render(notPdf, 1, path.join(SB, 'words.png')), false);
  assert.deepEqual(fs.readdirSync(SB).filter((n) => /^(past|words)\.png|tmp/.test(n)), []);
});

test('keepNewestPages: keeps the newest matching files up to the limit, and touches nothing else', () => {
  const d = fs.mkdtempSync(path.join(SB, 'keep-'));
  const t0 = Date.now() - 100000;
  for (let i = 1; i <= 5; i++) { const f = path.join(d, '.pdf-page-' + i + '.png'); fs.writeFileSync(f, String(i)); fs.utimesSync(f, new Date(t0 + i * 1000), new Date(t0 + i * 1000)); }
  fs.writeFileSync(path.join(d, 'preview.png'), 'first');
  fs.writeFileSync(path.join(d, 'deck.pdf'), 'the upload');
  pdfpages.keepNewestPages(d, /^\.pdf-page-\d+\.png$/, 2);
  assert.deepEqual(fs.readdirSync(d).sort(), ['.pdf-page-4.png', '.pdf-page-5.png', 'deck.pdf', 'preview.png']);
  pdfpages.keepNewestPages(path.join(d, 'missing'), /x/, 1);   // a folder that is gone is not an error
});

test('every PDFKit call runs under sandbox-exec with the PDF\'s folder and the output\'s, and at most two at once', { skip: !(process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) && 'needs macOS sandbox-exec' }, async () => {
  const cp = require('node:child_process');
  const realExecFile = cp.execFile;
  const calls = [];
  let now = 0;
  let most = 0;
  cp.execFile = (bin, args, opts, cb) => {
    calls.push([bin, args]);
    now++; most = Math.max(most, now);
    setTimeout(() => { now--; cb(null, 'pages 3\n'); }, 20);
  };
  const id = require.resolve('./pdfpages');
  delete require.cache[id];
  try {
    const fresh = require('./pdfpages');
    const pdf = path.join(SB, 'held.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4');
    const got = await Promise.all([1, 2, 3, 4, 5, 6].map(() => fresh.count(pdf)));
    assert.deepEqual(got, [3, 3, 3, 3, 3, 3]);
    assert.equal(calls.length, 6);
    assert.equal(most, 2, 'more than two ran at once');
    for (const [bin, args] of calls) {
      assert.equal(bin, '/usr/bin/sandbox-exec');
      const profile = args[args.indexOf('-p') + 1];
      assert.match(profile, /\(deny network\*\)/);
      assert.match(profile, /\(deny process-exec\*\)\(allow process-exec\* \(literal "\/usr\/bin\/osascript"\)\)/);
      const out = args.find((x) => x.startsWith('OUT=')).slice(4);
      assert.notEqual(out, fs.realpathSync(SB), 'the PDF\'s own folder is writable');
      assert.match(profile, /\(deny file-write\*\)\(allow file-write\* \(subpath \(param "OUT"\)\)\)/);
      assert.match(profile, /\(deny file-read\* \(subpath \(param "HOME"\)\)\)/);
      assert.ok(args.includes('IN=' + fs.realpathSync(SB)), 'the PDF\'s folder is not the readable one');
      assert.ok(args.includes('HOME=' + fs.realpathSync(require('node:os').userInfo().homedir)));
      assert.equal(args[args.indexOf('/usr/bin/osascript') - 1].startsWith('OUT='), true, 'osascript is not the sandboxed command');
      assert.ok(!profile.includes(SB), 'a path was spliced into the profile');
    }
  } finally {
    cp.execFile = realExecFile;
    delete require.cache[id];
  }
});

test('a failed count is remembered for ten minutes per key, then tried again', () => {
  const t = 1e12;
  assert.equal(pdfpages.failedRecently('k-a', t), false);
  pdfpages.noteFailed('k-a', t);
  assert.equal(pdfpages.failedRecently('k-a', t + 60 * 1000), true);
  assert.equal(pdfpages.failedRecently('k-b', t + 60 * 1000), false, 'another key was caught by it');
  assert.equal(pdfpages.failedRecently('k-a', t + 10 * 60 * 1000), false, 'still remembered after ten minutes');
  assert.equal(pdfpages.failedRecently('k-a', t + 60 * 1000), false, 'an expired entry was kept');
});
