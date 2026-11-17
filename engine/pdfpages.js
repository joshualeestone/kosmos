'use strict';
/**
 * kosmos#8637: a PDF's page count, and any page past the first drawn as a PNG, for the file preview's arrows.
 *
 * The first page stays Quick Look's (attachments.renderPdf, qlmanage), which draws only that one. Every other page,
 * and the count, come from macOS's own PDFKit through /usr/bin/osascript (JavaScript for Automation), which every
 * Mac has: nothing is installed. Each call is its own subprocess with a timeout, off the event loop, so a slow or
 * broken PDF never stalls the board. The script is passed with -e and the file, page and output as arguments, never
 * spliced into the script's text.
 *
 * Not a Mac (and no test seam): count answers null and render false, so the viewer shows the first page alone, as
 * it did before this card.
 */
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const TIMEOUT_MS = 10000;
const MAX_PAGES = 10000;   // a count above this is not believed (a damaged file); the viewer then shows one page
/* Measured on Mortals (11-17): page 2 of a three-page PDF in 0.3 s, 791 x 1024, opaque white. 1024 matches the
   first page qlmanage draws (-s 1024), so flipping does not change the picture's size. */
const SCRIPT = [
  "ObjC.import('Quartz'); ObjC.import('AppKit');",
  'function run(argv) {',
  '  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));',
  "  if (!doc || doc.isNil()) return 'ERR open';",
  '  const n = doc.pageCount;',
  "  if (argv.length < 3) return 'pages ' + n;",
  '  const i = parseInt(argv[1], 10);',
  "  if (!(i >= 0 && i < n)) return 'ERR range';",
  '  const img = doc.pageAtIndex(i).thumbnailOfSizeForBox($.NSMakeSize(1024, 1024), $.kPDFDisplayBoxMediaBox);',
  "  if (!img || img.isNil()) return 'ERR draw';",
  '  const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);',
  '  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());',
  "  if (!png || png.isNil() || !png.writeToFileAtomically(argv[2], true)) return 'ERR write';",
  "  return 'ok ' + n;",
  '}',
].join('\n');

/* The test seam: { count(file) -> number|null, render(file, index, out) -> boolean }, synchronous. */
let seam = null;
function setImplForTest(impl) { seam = impl && typeof impl === 'object' ? impl : null; }
function available() { return seam !== null || process.platform === 'darwin'; }

function runScript(args) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, ...args], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || '').trim());
    });
  });
}
function believed(n) { return Number.isInteger(n) && n >= 1 && n <= MAX_PAGES ? n : null; }

/** The page count, or null when it cannot be read. */
async function count(file) {
  if (seam) { try { return believed(seam.count(file)); } catch { return null; } }
  if (process.platform !== 'darwin') return null;
  const m = /^pages (\d+)$/.exec(await runScript([String(file)]));
  return m ? believed(Number(m[1])) : null;
}

/* Two requests for one page share one drawing (as attachments.renderPdf does). */
const drawing = new Map();
/** Draws page `index` (0-based) of `file` to `out`, through a temporary name renamed into place whole, so a racing
    reader never sees half a PNG. Resolves true when `out` exists after. */
function render(file, index, out) {
  if (drawing.has(out)) return drawing.get(out);
  const tmp = out + '.' + process.pid + '-' + Date.now() + '.tmp.png';
  const p = (async () => {
    if (!Number.isInteger(index) || index < 0) return false;
    if (seam) { try { if (!seam.render(file, index, tmp)) return false; } catch { return false; } }
    else {
      if (process.platform !== 'darwin') return false;
      if (!/^ok \d+$/.test(await runScript([String(file), String(index), tmp]))) { try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } return false; }
    }
    try { fs.renameSync(tmp, out); } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } }
    return fs.existsSync(out);
  })().finally(() => drawing.delete(out));
  drawing.set(out, p);
  return p;
}

/** The page asked for in a preview address: an integer from 1, or 1 for none or anything else. */
function pageOf(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw);
  return /^[1-9]\d{0,4}$/.test(s) ? Number(s) : (s === '' ? 1 : null);
}

module.exports = { count, render, available, pageOf, setImplForTest, SCRIPT, MAX_PAGES };
