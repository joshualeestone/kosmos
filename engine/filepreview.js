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
        noteSource(dir, got.target, opts && opts.owner);   // #5254: before prune/sweep, and only beside a page that exists
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
    sweep();   // #5254
  }
  // #5254: a page drawn before this change gets its record on its next view. Only beside a page that exists (review
  // 1: a sweep during this render may have taken the folder; never recreate it holding a record and no page).
  if (fs.existsSync(out)) noteSource(dir, got.target, opts && opts.owner);
  try { return { ok: true, type: 'image/png', bytes: fs.readFileSync(out) }; } catch { return { ok: false, because: 'this computer could not draw the first page' }; }
}

/* #5254: a cached first page goes when its PDF, its project or its agent goes, not only when 200 newer renders push it
   out. Each cache folder carries SOURCE_FILE (mode 0600, in the board's own data folder like the picture): the
   resolved path the page was drawn from and its owner ({ kind: 'project' | 'agent', id }). sweep() removes a folder
   whose file is no longer a regular file at that path, whose project is no longer listed, or whose agent was removed,
   and any folder without a readable record (drawn before this, so its file cannot be checked; a picture is cheap to
   draw again). It runs after each new render, at board start, after a project is removed, and hourly (server.js).
   A removed-agents list that cannot be read is not taken as "nobody removed": that check is skipped, never guessed.
   Known cost (review 1): the file check is a synchronous lstat per folder (at most CACHE_KEEP), so a PDF on a network
   drive that hangs can stall the board for that sweep; an unmounted one answers at once and its page is swept. */
const SOURCE_FILE = 'source.json';
const YOUNG_MS = 10 * 60 * 1000;   // a folder with no record younger than this may be a first render in progress
function noteSource(dir, target, owner) {
  const own = owner && (owner.kind === 'project' || owner.kind === 'agent') && typeof owner.id === 'string' ? { kind: owner.kind, id: owner.id } : null;
  const body = JSON.stringify({ target, owner: own });
  const f = path.join(dir, SOURCE_FILE);
  try { if (fs.readFileSync(f, 'utf8') === body) return; } catch { /* not there yet */ }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, '.' + SOURCE_FILE + '.' + process.pid + '.tmp');
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, f);
  } catch { /* the sweep removes a folder it cannot read a record for */ }
}
function sweep(deps = {}) {
  const CACHE = cacheDir();
  // Review 2 (WARNING): the cache folder itself must be a real folder. If it were a symlink, every old folder without a
  // record wherever it points would be removed; a folder that is not the board's own is never swept.
  try { if (!fs.lstatSync(CACHE).isDirectory()) return { removed: 0 }; } catch { return { removed: 0 }; }
  let ents;
  try { ents = fs.readdirSync(CACHE, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return { removed: 0 }; }
  let projectIds = null;
  try { projectIds = new Set((deps.projects || projects).readAll().map((x) => x && x.id)); } catch { projectIds = null; }
  let removedAgents = null;
  try {
    const got = (deps.removal || require('./remove')).removedNames();
    removedAgents = got && got.ok ? new Set(got.names) : null;
  } catch { removedAgents = null; }
  // Review 1 (BLOCKER): a FIRST render works inside its folder (r-<pid>-...) before the record exists, so a sweep
  // during it must not take the folder. A folder with a LIVE render in it is skipped (review 2), and one with no record is left
  // until it is YOUNG_MS old (a render's own timeout is far shorter).
  const now = deps.now || Date.now();
  // Review 1: removed-agent names are stored cleaned (create.cleanName), so the owner is compared the same way.
  let clean = (n) => n;
  try { clean = require('./create').cleanName; } catch { /* compare as given */ }
  let removed = 0;
  for (const e of ents) {
    const d = path.join(CACHE, e.name);
    let inside = [];
    try { inside = fs.readdirSync(d); } catch { inside = []; }
    // Review 2 (WARNING): a render folder (r-<pid>-...) protects this folder only while it is live: its process is still
    // running and it is younger than YOUNG_MS. One a crash or restart left behind holds a full copy of the person's PDF,
    // so it is removed now, and the folder is then judged as any other.
    let rendering = false;
    for (const n of inside) {
      if (!n.startsWith('r-')) continue;
      const m = /^r-(\d+)-/.exec(n);
      const pid = m ? Number(m[1]) : NaN;
      let alive = pid === process.pid;
      if (!alive && Number.isSafeInteger(pid) && pid > 0) {
        try { (deps.kill || process.kill)(pid, 0); alive = true; } catch (er) { alive = !!(er && er.code === 'EPERM'); }
      }
      let young = false;
      // Real time, not deps.now: whether a render is still running is a fact about this moment.
      try { young = Date.now() - fs.statSync(path.join(d, n)).mtimeMs < YOUNG_MS; } catch { young = false; }
      if (alive && young) { rendering = true; continue; }
      // Review 3: a removal that fails does not shield the folder; it is judged below, which tries to remove it whole.
      try { fs.rmSync(path.join(d, n), { recursive: true, force: true }); } catch { /* judged below */ }
    }
    if (rendering) continue;   // a render is in progress here
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(d, SOURCE_FILE), 'utf8')); } catch { rec = null; }
    if (!rec) {
      let young = true;
      try { young = now - fs.statSync(d).mtimeMs < YOUNG_MS; } catch { young = true; }
      if (young) continue;
    }
    let gone = !rec || typeof rec.target !== 'string';
    if (!gone) {
      try { gone = !fs.lstatSync(rec.target).isFile(); } catch { gone = true; }
    }
    if (!gone && rec.owner && rec.owner.kind === 'project' && projectIds) gone = !projectIds.has(rec.owner.id);
    if (!gone && rec.owner && rec.owner.kind === 'agent' && removedAgents) {
      let c = rec.owner.id;
      try { c = clean(rec.owner.id) || rec.owner.id; } catch { c = rec.owner.id; }
      gone = removedAgents.has(rec.owner.id) || removedAgents.has(c);
    }
    if (gone) { try { fs.rmSync(d, { recursive: true, force: true }); removed++; } catch { /* next sweep */ } }
  }
  return { removed };
}

/** Show the listed file selected in its folder (Finder / File Explorer), never opening it. */
function reveal(folder, name, where, opts) {
  const got = resolve(folder, name, where, opts);
  if (!got.ok) return got;
  return projects.revealFile(got.target, { namedAs: path.join(String(folder), got.given) });   // the record's spelling, for Windows (as openFile)
}

module.exports = { get CACHE() { return cacheDir(); }, CACHE_KEEP, SOURCE_FILE, resolve, preview, reveal, sweep, _setNofollowForTest };
