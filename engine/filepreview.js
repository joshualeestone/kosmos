'use strict';
/**
 * #4997 (the half of Josh's #4930 its PR does not build): the full-page preview for a file in one of the three Files
 * lists (an agent's Files folder; a project's folder). A listed file is named by the name the list gave it and
 * resolved by projects.resolveListedFile in its `listed` mode: openFile's three gates (the name's shape, the folder
 * readable, the RESOLVED target inside the RESOLVED folder and a regular file) PLUS the list's own rules, which openFile
 * does not apply (no link anywhere on the path, no hidden or skipped folder, within the list's depth, and the native
 * realpath equal to the walked path, which refuses any other case or normalisation of a name). Nothing here takes a
 * path from the request. The list's count caps (its 2000-entry scan budget and how many rows it shows) are NOT
 * applied: a file past them is inside the folder, by the list's own rules, just not drawn (decided; see the plan).
 *
 * Read-only. The preview is an image's own bytes (its type from the extension, never sniffed or taken from the
 * file) or a PDF's first page drawn by attachments' renderer (macOS qlmanage, in a subprocess with a timeout).
 * That PNG is cached under the board's own data folder, one folder per resolved file (keyed by its path) holding one
 * page named by the file's stamp (device, inode, size and both times, so a changed file is drawn afresh), at most
 * CACHE_KEEP folders, and never written into the person's folder.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const projects = require('./projects');
const attachments = require('./attachments');

/* Review 13: read at each use, never frozen at load (store.js #1443): a module that fixes path.join(store.ROOT, ...)
   once would keep writing private copies of a person's PDFs into whichever data root was set when it first loaded. */
function cacheDir() { return path.join(store.ROOT, 'filepreview'); }
const CACHE_KEEP = 200;   // first pages kept; the oldest go when a new one is drawn (review 1: never forever)

/* Undefined on win32 (#1732 fs-const-platform-flag): captured here and ORed in undefined-safe. The fstat identity
   check in readChecked (projects.sameOpenedFile against the walked file, and a regular file) refuses a swapped link or FIFO
   on every platform; the kernel flags are a second guard where they exist. The seam lets a macOS test take the
   kernel flag away and see the identity check refuse on its own (as instructions.js does). */
const KERNEL_NOFOLLOW = fs.constants.O_NOFOLLOW;
let NOFOLLOW = KERNEL_NOFOLLOW;
const NONBLOCK = fs.constants.O_NONBLOCK;
function _setNofollowForTest(v) { NOFOLLOW = arguments.length ? v : KERNEL_NOFOLLOW; }

function tooBig(st) { return st.size > attachments.MAX_BYTES; }
/* Only a file the list would show: listFiles' rules, walked (resolveListedFile's `listed` mode). An agent's Files
   list is flat (maxDepth 0); a project's walks its subfolders. */
function resolve(folder, name, where, opts) {
  return projects.resolveListedFile(folder, name, where, { listed: true, maxDepth: opts && Number.isInteger(opts.maxDepth) ? opts.maxDepth : undefined, act: opts && opts.act });
}
/* Review 1: the bytes come from ONE handle, checked to be the file the gates resolved (sameOpenedFile, no
   bigger than the cap). With resolveListedFile's own check that the resolved file IS the walked one (review 3), a
   file or parent swapped for a link, or a file grown past the cap, after the walk is refused, not followed or read
   whole. */
function readChecked(got) {
  let fd = null;
  try {
    // O_NONBLOCK (review 2): a FIFO swapped in after the walk must not block the board; isFile() below refuses it.
    fd = fs.openSync(got.target, fs.constants.O_RDONLY | (NOFOLLOW || 0) | (NONBLOCK || 0));
    const st = fs.fstatSync(fd);
    // #5165's sameOpenedFile: the same inode (and device), or, where a drive reports inode 0, the same size and times.
    if (!st.isFile() || !projects.sameOpenedFile(got.st, st)) return { ok: false, because: 'that file changed while it was being read' };
    if (tooBig(st)) return { ok: false, because: 'that file is too big to show here' };
    const bytes = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = fs.readSync(fd, bytes, off, st.size - off, off); if (n <= 0) break; off += n; }
    if (off !== st.size) return { ok: false, because: 'that file changed while it was being read' };   // shrank: never a cut-off picture
    return { ok: true, bytes };
  } catch { return { ok: false, because: 'that file could not be read' }; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}
function prune() {
  let ents;
  const CACHE = cacheDir();
  try { ents = fs.readdirSync(CACHE, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return; }
  if (ents.length <= CACHE_KEEP) return;
  const aged = ents.map((e) => { const d = path.join(CACHE, e.name); let t = 0; try { t = fs.statSync(d).mtimeMs; } catch { t = 0; } return { d, t }; })
    .sort((a, b) => a.t - b.t);
  for (const { d } of aged.slice(0, aged.length - CACHE_KEEP)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* next time */ } }
}

/** The picture the preview shows: { ok, type, bytes } or { ok: false, because }. */
async function preview(folder, name, where, opts) {
  const got = resolve(folder, name, where, opts);
  if (!got.ok) return got;
  const kind = attachments.kindOf('', got.target);
  if (kind === 'image') {
    const type = attachments.imageTypeOf(got.target);
    if (!type) return { ok: false, because: 'that is not an image this board will draw' };
    const read = readChecked(got);
    return read.ok ? { ok: true, type, bytes: read.bytes } : read;
  }
  if (kind !== 'pdf') return { ok: false, because: 'no preview for this kind of file' };
  // The first page is drawn by macOS (qlmanage) only: no private copy is written where nothing can draw it (review 5).
  if (process.platform !== 'darwin' && !attachments.hasRenderer()) return { ok: false, because: 'this computer cannot draw a PDF\'s first page' };
  if (tooBig(got.st)) return { ok: false, because: 'that file is too big to show here' };
  const key = crypto.createHash('sha256').update(got.target).digest('hex').slice(0, 32);
  const dir = path.join(cacheDir(), key);
  /* Review 1: the stamp names THIS file (device, inode, size, both times). Review 3: the page is stored UNDER its stamp
     (one file, named by a hash of it), so a picture and the stamp it belongs to can never be paired wrongly by two
     previews racing; each render works in its own folder and is renamed into place whole. */
  const stamp = [got.st.dev, got.st.ino, got.st.size, got.st.mtimeMs, got.st.ctimeMs].join('|');   // hashed only (#1732: not ':')
  const out = path.join(dir, crypto.createHash('sha256').update(stamp).digest('hex').slice(0, 32) + '.png');
  if (!fs.existsSync(out)) {
    const read = readChecked(got);   // review 2: the renderer reads a private copy, never the person's path
    if (!read.ok) return read;
    const work = path.join(dir, 'r-' + process.pid + '-' + crypto.randomBytes(6).toString('hex'));
    let made = false;
    try {
      fs.mkdirSync(work, { recursive: true });
      const copy = path.join(work, 'source.pdf');
      fs.writeFileSync(copy, read.bytes);
      const drawn = path.join(work, 'preview.png');
      made = await attachments.renderPdf(copy, work, drawn);
      if (made) {
        for (const n of fs.readdirSync(dir)) if (/\.png$/.test(n) && path.join(dir, n) !== out) { try { fs.rmSync(path.join(dir, n), { force: true }); } catch { /* next time */ } }
        fs.renameSync(drawn, out);
      }
    } catch { made = false; }
    finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } }
    if (!made) {
      // Review 10: a render that failed leaves no empty folder behind to count against CACHE_KEEP (rmdir only removes
      // an empty one, so a page another request drew stays).
      try { fs.rmdirSync(dir); } catch { /* not empty, or already gone */ }
      return { ok: false, because: 'this computer could not draw the first page' };
    }
    prune();
  }
  try { return { ok: true, type: 'image/png', bytes: fs.readFileSync(out) }; } catch { return { ok: false, because: 'this computer could not draw the first page' }; }
}

/** Show the listed file selected in its folder (Finder / File Explorer), never opening it. */
function reveal(folder, name, where, opts) {
  const got = resolve(folder, name, where, opts);
  if (!got.ok) return got;
  return projects.revealFile(got.target, { namedAs: path.join(String(folder), got.given) });   // the record's spelling, for Windows (as openFile)
}

module.exports = { get CACHE() { return cacheDir(); }, CACHE_KEEP, resolve, preview, reveal, _setNofollowForTest };
