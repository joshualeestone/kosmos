'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
/**
 * kosmos#9218: engine/pdfpreview.js, `kosmos preview <file.pdf> [--page N] [--out <file.png>]`, one page of a PDF drawn
 * as a PNG on this computer. The options and refusals run everywhere; the Linux and Windows renderers through the
 * subprocess seam (what they are handed, and how their answers are read); and real drawings where the tool exists:
 * PDFKit on a Mac, pdftoppm wherever it is on PATH. Every drawn PNG is decoded, never only checked to exist.
 *
 *   node --test engine/pdfpreview-9218.test.js
 */
const test = require('node:test');
const SKIP_POSIX_STANDIN = require('../test-support/skip-on-win32').skipOnWin32('its Linux renderer arms find stand-in pdftoppm and mutool files by their POSIX execute bit, which Windows does not keep, and one names its PDF with a double quote, which a Windows file name cannot hold; the Windows renderer has its own arms here');   // kosmos#8378
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync, spawnSync } = require('node:child_process');
const pdfpreview = require('./pdfpreview');

const REPO = path.join(__dirname, '..');
const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpreview-9218-')));
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
let n = 0;
function fresh() { const d = path.join(SB, 'case-' + (++n)); fs.mkdirSync(d); return d; }

/* A real PNG, w x h, every pixel grey, with true CRCs and a zlib stream: decodable by anything. */
function realPng(w = 3, h = 2) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 0x80); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/* A minimal PDF header is enough for every path that never reaches a real renderer. */
function fakePdf(dir, name = 'design.pdf') { const p = path.join(dir, name); fs.writeFileSync(p, '%PDF-1.4\n%fake\n'); return p; }
/* A folder holding one executable stand-in per name, for onPath. It is never run: the run seam answers instead. */
function pathWith(names) { const d = fresh(); for (const nm of names) { fs.writeFileSync(path.join(d, nm), '#!/bin/sh\nexit 99\n', { mode: 0o755 }); } return d; }
/* kosmos#8378: the refusals and the --out handling are the same on every platform, so their arms run for each renderer:
   the Windows one (PowerShell through the run seam) on every host, and the Linux one (stand-ins found on PATH by the
   POSIX execute bit) off Windows only. A successful draw writes where that renderer leaves its page. */
const RENDERERS = SKIP_POSIX_STANDIN ? ['win32'] : ['linux', 'win32'];
function rendererDeps(kind, d, run) {
  return kind === 'win32'
    ? { platform: 'win32', env: { SystemRoot: 'D:\\Win', PATH: '' }, tmpdir: d, run }
    : { platform: 'linux', env: { PATH: pathWith(['pdftoppm']) }, tmpdir: d, run };
}
function draws(kind, png) {
  return async (cmd, args, opts) => {
    fs.writeFileSync(kind === 'win32' ? path.join(opts.env.KOSMOS_PREVIEW_DIR, 'page.png') : args[args.length - 1] + '.png', png);
    return { code: 0, stdout: kind === 'win32' ? 'ok 1\r\n' : '' };
  };
}

test('parseArgs: page 1 by default; --page and --out in both spellings; -- ends the options', () => {
  assert.deepEqual(pdfpreview.parseArgs(['a.pdf']), { ok: true, file: 'a.pdf', page: 1, out: null });
  assert.deepEqual(pdfpreview.parseArgs(['--page', '3', 'a.pdf', '--out', 'x.PNG']), { ok: true, file: 'a.pdf', page: 3, out: 'x.PNG' });
  assert.deepEqual(pdfpreview.parseArgs(['--page=12', '--out=y.png', 'a.pdf']), { ok: true, file: 'a.pdf', page: 12, out: 'y.png' });
  assert.deepEqual(pdfpreview.parseArgs(['--', '--page.pdf']), { ok: true, file: '--page.pdf', page: 1, out: null });
  assert.equal(pdfpreview.parseArgs(['--help']).help, true);
});

test('parseArgs refuses: no file, two files, an unknown option, a bad or repeated page, an --out that is not a .png, a control character', () => {
  const bad = [[], ['a.pdf', 'b.pdf'], ['--bogus', 'a.pdf'], ['-p', '2', 'a.pdf'], ['a.pdf', '--page'], ['a.pdf', '--page', '0'], ['a.pdf', '--page', '03'],
    ['a.pdf', '--page', '100000'], ['a.pdf', '--page', '2', '--page', '3'], ['a.pdf', '--out', 'x.jpg'], ['a.pdf', '--out='], ['a.pdf', '--out', 'a.png', '--out', 'b.png'], ['a\nb.pdf']];
  for (const args of bad) {
    const r = pdfpreview.parseArgs(args);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.ok(!r.help, JSON.stringify(args));
    assert.ok(r.words.length > 10, JSON.stringify(args));
  }
});

for (const kind of RENDERERS) test(`the file is refused before any renderer runs: missing, a folder, not a PDF, over the size limit; each exits 2 (${kind})`, async () => {
  const d = fresh();
  let ran = 0;
  const deps = rendererDeps(kind, d, async () => { ran++; return { code: 0, stdout: '' }; });
  fs.writeFileSync(path.join(d, 'notes.pdf'), 'just text, named .pdf');
  const big = path.join(d, 'big.pdf');
  fs.writeFileSync(big, '%PDF-1.4\n');
  fs.truncateSync(big, pdfpreview.MAX_BYTES + 1);
  for (const [file, want] of [[path.join(d, 'gone.pdf'), /no file/], [d, /not a file/], [path.join(d, 'notes.pdf'), /not a PDF/], [big, /over 25 MB/]]) {
    const r = await pdfpreview.main([file], deps);
    assert.equal(r.code, 2, file);
    assert.match(r.err.join('\n'), want);
    assert.deepEqual(r.out, []);
  }
  /* The control: the limit itself is allowed, so the size test is not refusing every file. */
  fs.truncateSync(big, pdfpreview.MAX_BYTES);
  const draw = draws(kind, realPng());
  const ok = await pdfpreview.main([big], { ...deps, run: async (...a) => { ran++; return draw(...a); } });
  assert.equal(ok.code, 0, ok.err.join('\n'));
  assert.equal(ran, 1, 'a refused file reached a renderer');
});

test('--out: its folder must exist, it must not be a folder, and it must not be the PDF itself', async () => {
  const d = fresh();
  const deps = { platform: 'linux', env: { PATH: pathWith(['pdftoppm']) }, run: async () => assert.fail('reached the renderer'), tmpdir: d };
  const pdf = fakePdf(d, 'odd.png');   // a PDF whose name ends .png
  fs.mkdirSync(path.join(d, 'dir.png'));
  for (const [out, want] of [[path.join(d, 'nope', 'x.png'), /does not exist/], [path.join(d, 'dir.png'), /not a plain file/], [pdf, /the PDF itself/]]) {
    const r = await pdfpreview.main([pdf, '--out', out], deps);
    assert.equal(r.code, 2, out);
    assert.match(r.err.join('\n'), want);
  }
  assert.equal(fs.readFileSync(pdf, 'utf8').startsWith('%PDF-'), true, 'the PDF was overwritten');
});

test('Linux: pdftoppm is handed the private copy, never the given path, and draws the one page asked for', { skip: SKIP_POSIX_STANDIN }, async () => {
  const d = fresh();
  const src = fakePdf(d, 'it\'s "$HOME" `x`.pdf');
  let seen = null;
  const deps = { platform: 'linux', env: { PATH: pathWith(['pdftoppm', 'mutool']) }, tmpdir: d,
    run: async (cmd, args, opts) => { seen = { cmd, args, opts }; fs.writeFileSync(args[args.length - 1] + '.png', realPng(4, 5)); return { code: 0, stdout: '' }; } };
  const r = await pdfpreview.main([src, '--page', '7'], deps);
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.equal(path.basename(seen.cmd), 'pdftoppm', 'mutool was preferred over pdftoppm');
  assert.deepEqual(seen.args.slice(0, 7), ['-f', '7', '-l', '7', '-png', '-singlefile', '-scale-to']);
  const copy = seen.args[seen.args.length - 2];
  assert.equal(path.basename(copy), 'source.pdf');
  assert.ok(!seen.args.some((a) => a.includes('$HOME') || a.includes(src)), 'the given path reached the renderer');
  assert.equal(seen.opts.timeout, pdfpreview.TIMEOUT_MS);
  /* The PNG landed in a new folder of the temporary folder (here the sandbox), named for the file and page, decodable. */
  const out = r.out[0];
  assert.equal(path.dirname(path.dirname(out)), d);
  assert.match(path.basename(path.dirname(out)), /^kosmos-preview-(?!work-)/);
  assert.match(path.basename(out), /^it-s-HOME-x-p7\.png$/);
  assert.equal(pdfpreview.isPng(out), true);
  assert.deepEqual(fs.readdirSync(d).filter((x) => x.startsWith('kosmos-preview-work-')), [], 'the private copy was left behind');
});

test('Linux: mutool when pdftoppm is missing; with neither, one line naming the packages and exit 1; a page past the end exits 2', { skip: SKIP_POSIX_STANDIN }, async () => {
  const d = fresh();
  const src = fakePdf(d);
  let seen = null;
  const mut = { platform: 'linux', env: { PATH: pathWith(['mutool']) }, tmpdir: d,
    run: async (cmd, args) => { if (args[0] === 'info') return { code: 0, stdout: 'Pages: 5\n' }; seen = { cmd, args }; fs.writeFileSync(args[args.indexOf('-o') + 1], realPng()); return { code: 0, stdout: '' }; } };
  const r = await pdfpreview.main([src, '--page', '2'], mut);
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.equal(path.basename(seen.cmd), 'mutool');
  assert.equal(seen.args[0], 'draw');
  assert.equal(seen.args[seen.args.length - 1], '2');
  /* A relative PATH entry is never searched, even when it holds a pdftoppm: it would run whatever the current folder has. */
  const relative = path.relative(process.cwd(), pathWith(['pdftoppm', 'mutool']));
  assert.ok(!path.isAbsolute(relative) && relative !== '');
  const none = await pdfpreview.main([src], { platform: 'linux', env: { PATH: pathWith([]) + path.delimiter + relative }, tmpdir: d, run: async () => assert.fail('ran') });
  assert.equal(none.code, 1);
  assert.match(none.err[0], /poppler-utils/);
  assert.match(none.err[0], /mupdf-tools/);
  const range = await pdfpreview.main([src, '--page', '9'], { platform: 'linux', env: { PATH: pathWith(['pdftoppm']) }, tmpdir: d, run: async () => ({ code: 99, stdout: '', stderr: 'Wrong page range given: the first page (9) can not be after the last page (3).' }) });
  assert.equal(range.code, 2);
  assert.match(range.err[0], /no page 9/);
  const broke = await pdfpreview.main([src], { platform: 'linux', env: { PATH: pathWith(['pdftoppm']) }, tmpdir: d, run: async () => ({ code: 1, stdout: '', stderr: 'Syntax Error: Couldn\'t read xref table' }) });
  assert.equal(broke.code, 1, 'a damaged file was called a page range');
  /* Reviews 1 and 2: mutool may clamp a page past the end to the last page and exit 0 (its draw here SUCCEEDS on any
     page, the worst case), so its own count is read first and decides. */
  const mutOnly = { PATH: pathWith(['mutool']) };
  let asked = [];
  const mrun = (pages, drawOk = false) => async (cmd, args) => {
    asked.push(args[0]);
    if (args[0] === 'info') return { code: pages === null ? 1 : 0, stdout: pages === null ? '' : 'PDF-1.4\nPages: ' + pages + '\n' };
    if (drawOk) fs.writeFileSync(args[args.indexOf('-o') + 1], realPng());
    return { code: drawOk ? 0 : 1, stdout: '' };
  };
  const mpast = await pdfpreview.main([src, '--page', '9'], { platform: 'linux', env: mutOnly, tmpdir: d, run: mrun(3, true) });
  assert.equal(mpast.code, 2, mpast.err.join('\n'));
  assert.equal(mpast.err[0], 'That PDF has 3 pages, so there is no page 9 to draw.');
  assert.deepEqual(asked, ['info'], 'mutool drew a page past the end');
  asked = [];
  const mlast = await pdfpreview.main([src, '--page', '3'], { platform: 'linux', env: mutOnly, tmpdir: d, run: mrun(3, true) });
  assert.equal(mlast.code, 0, 'the last page itself was refused');
  assert.deepEqual(asked, ['info', 'draw']);
  const minside = await pdfpreview.main([src, '--page', '2'], { platform: 'linux', env: mutOnly, tmpdir: d, run: mrun(3) });
  assert.equal(minside.code, 1, 'a page inside the count that failed to draw was called a page range');
  const mnocount = await pdfpreview.main([src, '--page', '9'], { platform: 'linux', env: mutOnly, tmpdir: d, run: mrun(null) });
  assert.equal(mnocount.code, 1, 'a file mutool cannot count was called a page range');
});

test('Windows: Windows PowerShell under SystemRoot, the script encoded whole, the paths and page as environment values', async () => {
  const d = fresh();
  const src = fakePdf(d, 'a $(calc) b.pdf');
  let seen = null;
  const deps = { platform: 'win32', env: { SystemRoot: 'D:\\Win', PATH: '' }, tmpdir: d,
    run: async (cmd, args, opts) => { seen = { cmd, args, opts }; fs.writeFileSync(path.join(opts.env.KOSMOS_PREVIEW_DIR, 'page.png'), realPng()); return { code: 0, stdout: 'ok 4\r\n' }; } };
  const r = await pdfpreview.main([src, '--page=3'], deps);
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.equal(seen.cmd, 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const at = seen.args.indexOf('-EncodedCommand');
  assert.ok(at > 0 && seen.args.includes('-NoProfile') && seen.args.includes('-NonInteractive'));
  assert.equal(Buffer.from(seen.args[at + 1], 'base64').toString('utf16le'), pdfpreview.WIN_SCRIPT);
  assert.equal(seen.opts.env.KOSMOS_PREVIEW_INDEX, '2');
  assert.equal(path.basename(seen.opts.env.KOSMOS_PREVIEW_IN), 'source.pdf');
  assert.equal(path.dirname(seen.opts.env.KOSMOS_PREVIEW_IN), seen.opts.env.KOSMOS_PREVIEW_DIR);
  assert.ok(!seen.args.join(' ').includes('calc'), 'the file name reached the command line');
  assert.ok(!/\$env:KOSMOS_PREVIEW_\w+\s*=/.test(pdfpreview.WIN_SCRIPT), 'the script writes its own inputs');
  assert.equal(pdfpreview.isPng(r.out[0]), true);
});

test('Windows: ERR range names the page count (exit 2); an empty picture, a failed run and a missing PowerShell exit 1', async () => {
  const d = fresh();
  const src = fakePdf(d);
  const base = { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, tmpdir: d };
  const range = await pdfpreview.main([src, '--page', '5'], { ...base, run: async () => ({ code: 0, stdout: 'ERR range 1\r\n' }) });
  assert.equal(range.code, 2);
  assert.equal(range.err[0], 'That PDF has 1 page, so there is no page 5 to draw.');
  const empty = await pdfpreview.main([src], { ...base, run: async (c, a, o) => { fs.writeFileSync(path.join(o.env.KOSMOS_PREVIEW_DIR, 'page.png'), realPng().subarray(0, 30)); return { code: 0, stdout: 'ok 1' }; } });
  assert.equal(empty.code, 1);
  assert.match(empty.err[0], /came out empty/);
  const failed = await pdfpreview.main([src], { ...base, run: async () => ({ code: 1, stdout: '' }) });
  assert.equal(failed.code, 1);
  const missing = await pdfpreview.main([src], { ...base, run: async () => ({ code: 1, stdout: '', missing: true }) });
  assert.equal(missing.code, 1);
  assert.match(missing.err[0], /no Windows PowerShell at C:\\Windows\\System32/);
  const slow = await pdfpreview.main([src], { ...base, run: async () => ({ code: 1, stdout: '', killed: true }) });
  assert.match(slow.err[0], /took over 30 seconds/);
  assert.deepEqual(fs.readdirSync(d).filter((x) => x.startsWith('kosmos-preview-')), [], 'a failed draw left its folders behind');
});

for (const kind of RENDERERS) test(`--out over an existing PNG replaces it whole; a failed draw leaves it as it was and nothing beside it (${kind})`, async () => {
  const d = fresh();
  const src = fakePdf(d);
  const out = path.join(d, 'keep.png');
  fs.writeFileSync(out, 'the old picture');
  const failed = await pdfpreview.main([src, '--out', out], rendererDeps(kind, d, async () => ({ code: 1, stdout: '' })));
  assert.equal(failed.code, 1);
  assert.equal(fs.readFileSync(out, 'utf8'), 'the old picture');
  const ok = await pdfpreview.main([src, '--out', out], rendererDeps(kind, d, draws(kind, realPng(6, 7))));
  assert.equal(ok.code, 0, ok.err.join('\n'));
  assert.ok(fs.readFileSync(out).equals(realPng(6, 7)));
  assert.deepEqual(fs.readdirSync(d).filter((x) => x.startsWith('.kosmos-preview-') || x.endsWith('.part')), [], 'a staging file was left beside --out');
  /* A link at --out is refused, and says it is a link. */
  const link = path.join(d, 'link.png');
  fs.symlinkSync(out, link);
  /* Review 2: on a disk that ignores case, another spelling of the PDF's own name is still the PDF. */
  const odd = fakePdf(d, 'odd.png');
  const upper = path.join(d, 'ODD.PNG');
  if (fs.existsSync(upper)) {
    const self = await pdfpreview.main([odd, '--out', upper], rendererDeps(kind, d, async () => assert.fail('ran')));
    assert.equal(self.code, 2);
    assert.match(self.err[0], /the PDF itself/);
    assert.ok(fs.readFileSync(odd, 'latin1').startsWith('%PDF-'), 'the PDF was overwritten');
  } else test.diagnostic('this disk tells case apart; the ODD.PNG arm did not run');
  const linked = await pdfpreview.main([src, '--out', link], rendererDeps(kind, d, async () => assert.fail('ran')));
  assert.equal(linked.code, 2);
  assert.match(linked.err[0], /is a link/);
});

test('a renderer killed for printing too much is a failure, not a timeout', { skip: !fs.existsSync('/bin/sh') && 'its renderer stand-in is a /bin/sh script' }, async () => {
  const d = fresh();
  const bin = fresh();
  /* A real pdftoppm stand-in that floods stderr past the buffer and exits: runReal itself, not the seam. Review 1 reasoned
     that Node marks this killed, which would read as a timeout; measured on Node 26, err.killed is unset for
     ERR_CHILD_PROCESS_STDIO_MAXBUFFER, so no guard is needed and this pins the behaviour if a Node changes it. */
  fs.writeFileSync(path.join(bin, 'pdftoppm'), ['#!/bin/sh', 'yes "Syntax Error: no xref table" | head -c 3000000 >&2', 'exit 1', ''].join('\n'), { mode: 0o755 });
  const r = await pdfpreview.main([fakePdf(d)], { platform: 'linux', env: { PATH: bin + path.delimiter + '/usr/bin' + path.delimiter + '/bin' }, tmpdir: d });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.err[0], /took over/, 'an overflowing renderer was reported as a timeout');
});

test('a temporary folder that cannot be made is one line and exit 1, not a crash', async () => {
  const d = fresh();
  const r = await pdfpreview.main([fakePdf(d)], { platform: 'linux', env: { PATH: pathWith(['pdftoppm']) }, tmpdir: path.join(d, 'no', 'such'), run: async () => assert.fail('ran') });
  assert.equal(r.code, 1);
  assert.match(r.err[0], /could not make a folder for the picture/);
  assert.match(r.err[0], /--out/);
});

test('a computer with no renderer for its kind says so and exits 1', async () => {
  const r = await pdfpreview.main([fakePdf(fresh())], { platform: 'aix' });
  assert.equal(r.code, 1);
  assert.match(r.err[0], /cannot draw PDFs on this kind of computer \(aix\)/);
});

test('isPng: a real PNG is one; cut short, zero-sized or not a PNG is not', () => {
  const d = fresh();
  const good = realPng(2, 2);
  const zero = Buffer.from(good); zero.writeUInt32BE(0, 16);
  for (const [name, bytes, want] of [['good', good, true], ['cut', good.subarray(0, good.length - 4), false], ['zero', zero, false], ['text', Buffer.from('not a png at all, just words here for length....'), false]]) {
    const p = path.join(d, name + '.png'); fs.writeFileSync(p, bytes);
    assert.equal(pdfpreview.isPng(p), want, name);
  }
  assert.equal(pdfpreview.isPng(path.join(d, 'absent.png')), false);
});

/* Real drawings. A three-page PDF made by macOS's own print filter; elsewhere, none is made and these skip. */
const cups = process.platform === 'darwin' && fs.existsSync('/usr/sbin/cupsfilter');
function threePages(dir) {
  const txt = path.join(dir, 'three.txt');
  fs.writeFileSync(txt, ['Page one', 'Page two', 'Page three'].join('\n\f'));
  const pdf = path.join(dir, 'three pages $x.pdf');
  fs.writeFileSync(pdf, execFileSync('/usr/sbin/cupsfilter', ['-m', 'application/pdf', txt], { stdio: ['ignore', 'pipe', 'ignore'] }));
  return pdf;
}
/* Decoded by the system's own image tool (sips), so a PNG the module merely believes in is not enough. */
function decodedSize(p) {
  const s = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf8' });
  return { w: Number(/pixelWidth: (\d+)/.exec(s)[1]), h: Number(/pixelHeight: (\d+)/.exec(s)[1]) };
}
function differ(a, b) { return !fs.readFileSync(a).equals(fs.readFileSync(b)); }

test('on a Mac: pages 1 and 3 of a real PDF are drawn through PDFKit, decode at 1024 tall, and differ; page 4 is refused with the count', { skip: !(cups && fs.existsSync('/usr/bin/sips') && fs.existsSync('/usr/bin/sandbox-exec')) && 'needs macOS PDFKit, cupsfilter and sips' }, async () => {
  const d = fresh();
  const pdf = threePages(d);
  const p1 = await pdfpreview.main([pdf, '--out', path.join(d, 'one.png')], { tmpdir: d });
  const p3 = await pdfpreview.main([pdf, '--page', '3', '--out', path.join(d, 'three.png')], { tmpdir: d });
  assert.equal(p1.code, 0, p1.err.join('\n'));
  assert.equal(p3.code, 0, p3.err.join('\n'));
  assert.equal(decodedSize(p1.out[0]).h, 1024);
  assert.equal(decodedSize(p3.out[0]).h, 1024);
  assert.ok(differ(p1.out[0], p3.out[0]), 'page 3 drew the same picture as page 1');
  const past = await pdfpreview.main([pdf, '--page', '4'], { tmpdir: d });
  assert.equal(past.code, 2);
  assert.equal(past.err[0], 'That PDF has 3 pages, so there is no page 4 to draw.');
});

/* Review 2: a PDF locked with a password, made by PDFKit itself. PDFKit counts its pages and draws each one blank white,
   which an agent would read as an empty design. */
function locked(dir) {
  const script = path.join(dir, 'lock.js');
  fs.writeFileSync(script, ["ObjC.import('Quartz');", 'function run(argv) {',
    '  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));',
    "  const opts = $({ [ObjC.unwrap($.PDFDocumentUserPasswordOption)]: 'pw', [ObjC.unwrap($.PDFDocumentOwnerPasswordOption)]: 'pw' });",
    '  doc.writeToURLWithOptions($.NSURL.fileURLWithPath(argv[1]), opts);',
    '  return String($.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[1])).isLocked);', '}'].join('\n'));
  const out = path.join(dir, 'locked.pdf');
  assert.equal(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', script, threePages(dir), out], { encoding: 'utf8' }).trim(), 'true', 'the fixture is not locked');
  return out;
}
test('on a Mac: a PDF locked with a password is refused (exit 1, saying so), never drawn as a blank page', { skip: !(cups && fs.existsSync('/usr/bin/sandbox-exec')) && 'needs macOS PDFKit and cupsfilter' }, async () => {
  const d = fresh();
  const pdf = locked(d);
  const out = path.join(d, 'blank.png');
  const r = await pdfpreview.main([pdf, '--out', out], { tmpdir: d });
  assert.equal(r.code, 1, 'a locked PDF was drawn: ' + r.out.join(' '));
  assert.match(r.err[0], /locked with a password/);
  assert.equal(fs.existsSync(out), false);
  /* The board's own preview reads the same script: no count, so it shows no later pages of a locked file. */
  assert.equal(await require('./pdfpages').count(pdf), null);
});

const pdftoppm = pdfpreview.onPath('pdftoppm');
test('wherever pdftoppm is on PATH: the Linux renderer draws real pages that decode, and a page past the end exits 2', { skip: !(cups && pdftoppm && fs.existsSync('/usr/bin/sips')) && 'needs pdftoppm, and cupsfilter and sips to make and decode the PDF' }, async () => {
  const d = fresh();
  const pdf = threePages(d);
  const a = await pdfpreview.main([pdf, '--page', '1', '--out', path.join(d, 'l1.png')], { platform: 'linux', tmpdir: d });
  const b = await pdfpreview.main([pdf, '--page', '2', '--out', path.join(d, 'l2.png')], { platform: 'linux', tmpdir: d });
  assert.equal(a.code, 0, a.err.join('\n'));
  assert.equal(b.code, 0, b.err.join('\n'));
  assert.equal(Math.max(decodedSize(a.out[0]).w, decodedSize(a.out[0]).h), 1024);
  assert.ok(differ(a.out[0], b.out[0]), 'page 2 drew the same picture as page 1');
  const past = await pdfpreview.main([pdf, '--page', '4'], { platform: 'linux', tmpdir: d });
  assert.equal(past.code, 2, past.err.join('\n'));
});

test('install/kosmos preview runs this module: the path on stdout and exit 0; an unknown option exits 2; --help names the usage', { skip: !(process.platform === 'darwin' && cups && fs.existsSync('/usr/bin/sandbox-exec')) && 'draws through PDFKit' }, () => {
  const d = fresh();
  const pdf = threePages(d);
  const out = path.join(d, 'cli.png');
  const env = { ...process.env, KOSMOS_HOME: REPO };
  const run = (args) => spawnSync('bash', [path.join(REPO, 'install', 'kosmos'), 'preview', ...args], { encoding: 'utf8', env, timeout: 60000 });
  const ok = run([pdf, '--page', '2', '--out', out]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, out + '\n');
  assert.equal(pdfpreview.isPng(out), true);
  const bad = run(['--nope', pdf]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /does not know the option "--nope"/);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stdout, pdfpreview.USAGE + '\n');
});

test('the Windows CLI\'s preview verb runs this module and passes its exit status through; its usage is the module\'s', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const out = [], err = [];
  const io = { out: (l) => out.push(l), err: (l) => err.push(l) };
  assert.ok(cli.VERBS.includes('preview'));
  assert.equal(await cli.main(['preview', '--bogus'], io), 2);
  assert.match(err.join('\n'), /does not know the option "--bogus"/);
  assert.equal(await cli.main(['preview', path.join(fresh(), 'none.pdf')], io), 2);
  assert.match(err.join('\n'), /There is no file at/);
  assert.deepEqual(out, [], 'a refusal printed a path');
  const help = [];
  assert.equal(await cli.main(['preview', '--help'], { ...io, out: (l) => help.push(l) }), 0);
  assert.ok(help.includes(pdfpreview.USAGE), 'the Windows --help is not the module usage');
  const src = fs.readFileSync(path.join(REPO, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  const lit = /\n {2}preview: '((?:[^'\\]|\\.)*)',\n/.exec(src);
  assert.ok(lit, 'no preview usage in the Windows CLI');
  assert.equal(lit[1].replace(/\\'/g, '\''), pdfpreview.USAGE, 'the Windows usage drifted from the module\'s');
  const mac = fs.readFileSync(path.join(REPO, 'install', 'kosmos'), 'utf8');
  assert.ok(mac.includes('    preview)\n      printf \'' + pdfpreview.USAGE.replace(/'/g, '\'"\'"\'') + '\\n\''), 'the Mac usage drifted from the module\'s');
});
