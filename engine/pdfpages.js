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
 * Review 5: the PDF is untrusted (a chat upload, a file any agent wrote), and Quick Look parses its first page in a
 * sandboxed extension, where this osascript would otherwise run with the board's full rights. So every call runs under
 * sandbox-exec (SANDBOX): no network, no program started but osascript itself, no writes but a fresh empty folder made
 * for that one call in the system's temporary folder (never the folder the PDF sits in, which for an attachment holds
 * the person's upload), and no reads under the account's home but the PDF's folder and that one. Reads outside the
 * home (other volumes, /Users/Shared, system folders) are not narrowed. It does NOT narrow mach-lookup or other IPC, which
 * AppKit needs to draw at all. With no sandbox-exec, nothing is drawn or counted (one page, as before).
 * At most MAX_AT_ONCE run at a time; the rest wait their turn, so a held arrow key cannot start dozens at once.
 *
 * Not a Mac (and no test seam): count answers null and render false, so the viewer shows the first page alone, as
 * it did before this card.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
  // Not atomically: an atomic write goes through a folder the sandbox refuses, and render() renames into place itself.
  "  if (!png || png.isNil() || !png.writeToFileAtomically(argv[2], false)) return 'ERR write';",
  "  return 'ok ' + n;",
  '}',
].join('\n');

/* The test seam: { count(file) -> number|null, render(file, index, out) -> boolean }, synchronous. */
let seam = null;
function setImplForTest(impl) { seam = impl && typeof impl === 'object' ? impl : null; }
function available() { return seam !== null || process.platform === 'darwin'; }

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/* Paths come in as -D parameters, never spliced into the profile's text. */
const SANDBOX = '(version 1)(allow default)(deny network*)'
  + '(deny process-exec*)(allow process-exec* (literal "/usr/bin/osascript"))'
  + '(deny file-write*)(allow file-write* (subpath (param "OUT")))'
  + '(deny file-read* (subpath (param "HOME")))(allow file-read* (subpath (param "IN")) (subpath (param "OUT")))';
/* The account's own home, from the user database rather than $HOME, which a board's environment can point elsewhere. */
function realHome() { try { return os.userInfo().homedir; } catch { return os.homedir(); } }

const MAX_AT_ONCE = 2;
let running = 0;
const waiting = [];
function turn() { return running < MAX_AT_ONCE ? (running++, Promise.resolve()) : new Promise((r) => waiting.push(r)); }
function done() { const next = waiting.shift(); if (next) next(); else running--; }

/* Said once per board run (review 8): a macOS whose PDFKit needs something the sandbox refuses would otherwise lose
   the arrows with no word anywhere, and the failed-count memory would keep it quiet. Never the PDF's path or name. */
let saidFailure = false;
function sayFailureOnce(why) {
  if (saidFailure) return;
  saidFailure = true;
  console.warn('[pdfpages] a PDF page could not be counted or drawn (' + why + '); the file preview shows the first page only');
}

/* The script's answer, or '' for any failure (no sandbox-exec, a timeout, a refusal). `inDir` holds the PDF; `outDir`
   is the only folder it may write. */
async function runScript(args, inDir, outDir) {
  if (!fs.existsSync(SANDBOX_EXEC)) { sayFailureOnce('no sandbox-exec on this Mac'); return ''; }
  await turn();
  try {
    return await new Promise((resolve) => {
      execFile(SANDBOX_EXEC, ['-p', SANDBOX, '-D', 'HOME=' + fs.realpathSync(realHome()), '-D', 'IN=' + fs.realpathSync(inDir), '-D', 'OUT=' + fs.realpathSync(outDir),
        '/usr/bin/osascript', '-l', 'JavaScript', '-e', SCRIPT, ...args], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 }, (err, stdout) => {
        const said = err ? '' : String(stdout || '').trim();
        // A PDF that is not one answers ERR open, which is the file's doing, not the Mac's; anything else is said once.
        if (err) sayFailureOnce(err.killed ? 'timed out' : 'exit ' + (err.code === undefined ? '?' : err.code));
        resolve(said);
      });
    });
  } catch { return ''; } finally { done(); }
}
function believed(n) { return Number.isInteger(n) && n >= 1 && n <= MAX_PAGES ? n : null; }

/** The page count, or null when it cannot be read. */
async function count(file) {
  if (seam) { try { return believed(seam.count(file)); } catch { return null; } }
  if (process.platform !== 'darwin') return null;
  let empty = null;
  try {
    empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pdfcount-'));   // a count writes nothing; its one writable folder is empty
    const m = /^pages (\d+)$/.exec(await runScript([String(file)], path.dirname(String(file)), empty));
    return m ? believed(Number(m[1])) : null;
  } catch { return null; } finally { if (empty) { try { fs.rmSync(empty, { recursive: true, force: true }); } catch { /* best effort */ } } }
}

/* Puts a drawn page at `out` whole: a rename, or, when the temporary folder is on another volume (EXDEV), a copy to a
   name beside `out` renamed over it, so a reader never sees half a picture. */
function moveInto(from, out) {
  try { fs.renameSync(from, out); return; } catch (e) { if (!e || e.code !== 'EXDEV') throw e; }
  const part = out + '.' + process.pid + '.part';
  try { fs.copyFileSync(from, part); fs.renameSync(part, out); } catch (e) { try { fs.rmSync(part, { force: true }); } catch { /* gone */ } throw e; }
}

/* Two requests for one page share one drawing (as attachments.renderPdf does). */
const drawing = new Map();
/** Draws page `index` (0-based) of `file` to `out`, through a temporary name renamed into place whole, so a racing
    reader never sees half a PNG. Resolves true when `out` exists after. */
function render(file, index, out) {
  if (drawing.has(out)) return drawing.get(out);
  const p = (async () => {
    if (!Number.isInteger(index) || index < 0) return false;
    /* Drawn into a fresh folder in the system's temporary folder (review 9: never beside `out`, where a crash would
       leave it inside an attachment's folder for good), the only folder the sandbox lets PDFKit write, then moved in. */
    let work = null;
    try {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pdfpage-'));
      const tmp = path.join(work, 'page.png');
      if (seam) { try { if (!seam.render(file, index, tmp)) return false; } catch { return false; } }
      else {
        if (process.platform !== 'darwin') return false;
        if (!/^ok \d+$/.test(await runScript([String(file), String(index), tmp], path.dirname(String(file)), work))) return false;
      }
      moveInto(tmp, out);
      return fs.existsSync(out);
    } catch { return false; } finally { if (work) { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } } }
  })().finally(() => drawing.delete(out));
  drawing.set(out, p);
  return p;
}

/* At most this many later pages are kept per PDF (review 4): flipping through a long PDF must not leave hundreds of
   pictures beside it. The oldest drawn go first; one asked for again is simply drawn again. */
const KEEP_PAGES = 40;
/** Removes the oldest of the files in `dir` whose names match `pattern` until at most `keep` remain. Best effort. */
function keepNewestPages(dir, pattern, keep = KEEP_PAGES) {
  let found = [];
  try { found = fs.readdirSync(dir).filter((n) => pattern.test(n)); } catch { return; }
  if (found.length <= keep) return;
  const aged = found.map((n) => { let t = 0; try { t = fs.statSync(path.join(dir, n)).mtimeMs; } catch { t = 0; } return { n, t }; }).sort((a, b) => a.t - b.t);
  for (const { n } of aged.slice(0, aged.length - keep)) { try { fs.rmSync(path.join(dir, n), { force: true }); } catch { /* next time */ } }
}

/* A count that failed is not asked again for a while (review 6): a PDF that PDFKit cannot read (or a sandbox that
   refuses it) would otherwise cost a subprocess run of up to TIMEOUT_MS on every open of the preview. Kept in memory
   (a restart tries again), keyed by the caller (an attachment's file, a Files-list file's stamp), at most FAILED_KEEP. */
const FAILED_FOR_MS = 10 * 60 * 1000;
const FAILED_KEEP = 500;
const failedAt = new Map();
function failedRecently(key, now = Date.now()) {
  const t = failedAt.get(key);
  if (t === undefined) return false;
  if (now - t < FAILED_FOR_MS) return true;
  failedAt.delete(key);
  return false;
}
function noteFailed(key, now = Date.now()) {
  failedAt.delete(key);
  failedAt.set(key, now);
  while (failedAt.size > FAILED_KEEP) failedAt.delete(failedAt.keys().next().value);
}

/** The page asked for in a preview address: 1 when none is given, the number for a whole number from 1 (written
    without a leading zero, at most five digits), null for anything else (the routes answer 404). */
function pageOf(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw);
  return /^[1-9]\d{0,4}$/.test(s) ? Number(s) : (s === '' ? 1 : null);
}

module.exports = { count, render, available, pageOf, keepNewestPages, failedRecently, noteFailed, setImplForTest, MAX_PAGES };
