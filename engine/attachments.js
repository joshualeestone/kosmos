'use strict';
/**
 * Documents attached to a conversation (#358).
 *
 * 🔑 A SECOND SURFACE, NEVER ROWS IN "FILES IN THIS PROJECT". That list is the
 * project folder, top level, newest first, and that is all it will ever be
 * (web/index.html, the Files section's own note: a comment promising that
 * attachments would join it cost the section a week of looking half-built).
 * So attachments live in their own place under the data root, per project
 * or per agent, keyed by an id this module mints, and the message carries
 * the record. The project folder is untouched.
 *
 * 🔑 HOW AN AGENT READS ONE. The message delivered to the agent's pane ends
 * with the absolute path of the stored file in the bracketed line, so `cat`
 * or `open` works on the spot, followed inside the same bracket by the
 * file's facts in parentheses (type, an image's pixel size, size on disk;
 * #5448) so the agent can tell a screenshot from a contract before
 * deciding to open it. Nothing else tells the agent where the folder is
 * (Mona Lisa, 2026-08-23: the who-you-work-for block is about the person;
 * finding attachments it was not sent is a later card).
 *
 * ⚠️ A FILE FROM A PERSON IS BYTES, NOT A PROGRAM. The stored name is
 * sanitised to one path segment, the file is written with the bytes it
 * arrived with and never executed, served back with content-disposition
 * attachment and nosniff, and the preview is made by macOS's own renderer in
 * a subprocess with a timeout, never by decoding the file here. The one
 * read of its bytes here (#5448, imageFacts) is a bounded header read of at
 * most 256 KB for an image's signature and pixel size: fixed offsets and a
 * length-walked JPEG segment list, every read bounds-checked, nothing
 * decoded.
 *
 * The record on a message row, the shape the page draws against:
 *   attachment: { id, name, type, size, kind, url, preview }
 *     kind     'image' | 'pdf' | 'text' | 'other'
 *     url      '/api/attachment/<id>', the file itself
 *     preview  '/api/attachment/<id>/preview' for image and pdf (a PNG, or
 *              the image itself), the text itself for kind 'text' (capped,
 *              so the card shows a snippet), null when there is none.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const store = require('./store');

/* #6734: 100 MB. The file is streamed both ways (stored as it arrives, served from disk), so the cap is what a
   conversation should carry, not what the board can hold in memory. */
const MAX_BYTES = 100 * 1024 * 1024;
/** The cap the way a person reads it ("100 MB"), for every sentence that names it. */
const MAX_WORDS = Math.round(MAX_BYTES / (1024 * 1024)) + ' MB';
const TOO_LARGE = 'that file is larger than ' + MAX_WORDS + ', which is the most a conversation can carry';
const TEXT_SNIPPET = 2000;
const ROOT = path.join(store.ROOT, 'attachments');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/avif']);
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|x-sh)$)/;

function kindOf(type, name) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_TYPES.has(t) || /^\.(png|jpe?g|gif|webp|heic|avif)$/.test(ext)) return 'image';
  if (t === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (TEXT_TYPES.test(t) || /^\.(txt|md|markdown|csv|json|yaml|yml|log|sh|js|ts|py|html?|css)$/.test(ext)) return 'text';
  return 'other';
}

/** One path segment, never empty, never a dotfile, never a path, no control
    characters (they would reach the pane in the bracketed line and be refused
    there, after the upload had already said yes), cut on characters rather
    than code units so a surrogate pair is never halved, and never one of the
    two names this module writes beside the file. A leading `-` is kept: the
    renderer is always handed the absolute path, never the bare name. */
const RESERVED = new Set(['record.json', 'preview.png']);
function safeName(name) {
  // #6734 review 11: leading spaces and dots are stripped together, so " .upload.part" cannot keep its dot and be
  // stored under the part file's own name (the dots used to go before the trim).
  let n = String(name || '').replace(/[/\\\0]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').replace(/^[\s.]+/, '').trim();
  n = Array.from(n).slice(0, 160).join('');
  if (!n) n = 'file';
  // Review 13: Windows reads "record.json." (and with trailing spaces) as "record.json", so the reserved check ignores them.
  if (RESERVED.has(foldName(n))) n = 'file-' + n;
  return n;
}

/** A name as macOS and Windows compare it, for checking against this module's own names: trailing dots and spaces
    dropped (Windows), case folded, and compatibility forms unified (review 15: "record.j\u017fon", with a long s, is
    the same file as "record.json" on a case-insensitive disk; NFKC turns it into an s). */
function foldName(name) { return String(name).replace(/[\s.]+$/, '').normalize('NFKC').toLowerCase(); }

/** A record's own name, usable as stored: one segment, no separators or controls, not "." or "..", and none of this
    module's own names. Only for records an older safeName wrote (see read). */
function storedAsIs(name) {
  if (typeof name !== 'string' || !name || name.length > 640 || name === '.' || name === '..') return false;
  if (/[/\\\0\u0000-\u001f\u007f]/.test(name)) return false;
  const plain = foldName(name);
  return plain !== PART && !RESERVED.has(plain);
}

/** Where an owner's attachments live: ('project', id) or ('agent', name). */
function ownerDir(scope, owner) {
  const s = scope === 'project' ? 'project' : scope === 'agent' ? 'agent' : null;
  if (!s) throw new Error('attachments belong to a project or an agent');
  const key = store.safeKey(owner);
  return path.join(ROOT, s, key);
}

function newId() { return crypto.randomBytes(12).toString('hex'); }

/* #6734: a file being stored is written under this name first and renamed into place when it is whole. safeName
   strips leading dots, so no stored file can carry it, and `read` never sees the folder until record.json is
   written after the rename: a half-arrived file is never an attachment. */
const PART = '.upload.part';

/** A new attachment's folder, made, with its paths: { id, dir, name, file, part }. */
function slot(scope, owner, name) {
  const id = newId();
  const dir = path.join(ownerDir(scope, owner), id);
  const clean = safeName(name);
  const file = path.join(dir, clean);
  if (!file.startsWith(dir + path.sep)) throw new Error('that file name cannot be stored');
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });   // review 16: the folders it makes above, too
  fs.mkdirSync(dir, { mode: 0o700 });   // review 7: exclusive, so an upload never shares an existing folder; 0700 (review 14)
  return { id, dir, name: clean, file, part: path.join(dir, PART) };
}
/** The slot's part file renamed into place and its record written. Returns the record with its paths. */
function finish(s, scope, owner, { type, size, by }) {
  // Review 25: a Windows scanner often opens a file just written; the repo's retrying rename rides that out.
  require('./win32swap').renameWithRetry(s.part, s.file);
  const record = {
    id: s.id, name: s.name, type: String(type || 'application/octet-stream').split(';')[0].trim().slice(0, 100) || 'application/octet-stream',
    size, kind: kindOf(type, s.name), at: new Date().toISOString(), scope, owner: String(owner),
    ...(by === 'agent' ? { by: 'agent' } : {}),   // #6726: a file the agent attached to its reply, counted against its daily total
  };
  fs.writeFileSync(path.join(s.dir, 'record.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });   // review 12: as the file
  return { ...record, dir: s.dir, file: s.file };
}
function abandon(s) { try { fs.rmSync(s.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ } }   // retries: a scanner holding a file (review 25)
/** #6734 review 19: take back an attachment just stored whose upload could not be answered: no message carries it, and
    nothing would list it, so it would only take up space. Only a folder inside the store is removed. */
function discardStored(rec) {
  if (!rec || typeof rec.dir !== 'string') return;
  // Review 20: exactly <scope>/<owner>/<id> under the store, the id 24 hex, as the orphan sweep requires.
  const parts = path.relative(ROOT, rec.dir).split(path.sep);
  if (parts.length !== 3 || parts.some((p) => !p || p === '..') || !/^[0-9a-f]{24}$/.test(parts[2])) return;
  abandon(rec);
}

/* #6734 review 2: a board that stops mid-upload (a crash, a kill, a power cut) leaves an attachment folder with no
   record.json: a part file of up to the cap, or a renamed file whose record was never written. read() never serves
   one, so only the disk space is at stake; this takes it back. Only a folder named like an attachment id, two levels
   under ROOT, with no record.json, and nothing in it touched for ORPHAN_AGE_MS. An upload still arriving keeps its
   part file's mtime fresh with every write, and Node refuses one whose body takes over five minutes anyway, so an
   hour untouched is never a live upload (review 16: the mtime, not only the timeout, is what protects it). Returns how many it removed.
   ⚠️ Safe only while slot() is the one maker of id folders under ROOT (it always writes record.json or removes the
   folder). server.attachment-stream-6734.test.js fails if another file starts writing under the store. */
const ORPHAN_AGE_MS = 60 * 60 * 1000;
function sweepOrphans(now = Date.now()) {
  let removed = 0;
  const list = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const scope of list(ROOT)) {
    for (const owner of list(path.join(ROOT, scope))) {
      for (const id of list(path.join(ROOT, scope, owner))) {
        if (!/^[0-9a-f]{24}$/.test(id)) continue;
        const dir = path.join(ROOT, scope, owner, id);
        try {
          // Review 11: fail closed. Only a record that is certainly absent (ENOENT) makes an orphan; a dangling link or
          // a stat that fails for any other reason keeps the folder.
          try { fs.lstatSync(path.join(dir, 'record.json')); continue; } catch (e) { if (!e || e.code !== 'ENOENT') continue; }
          let newest = fs.statSync(dir).mtimeMs;
          for (const f of fs.readdirSync(dir)) newest = Math.max(newest, fs.lstatSync(path.join(dir, f)).mtimeMs);
          if (now - newest < ORPHAN_AGE_MS) continue;
          fs.rmSync(dir, { recursive: true, force: true });
          removed += 1;
        } catch { /* best effort: the next sweep tries again */ }
      }
    }
  }
  return removed;
}

/**
 * Store bytes as an attachment. Returns the record (with `dir` and `file`
 * for the server, which strips them before the row goes out).
 */
function save(scope, owner, { name, type, bytes, by }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('there is nothing in that file');
  if (bytes.length > MAX_BYTES) throw new Error(TOO_LARGE);
  const s = slot(scope, owner, name);
  try {
    fs.writeFileSync(s.part, bytes, { mode: 0o600 });   // #6734: as saveFilled and saveStream
    return finish(s, scope, owner, { type, size: bytes.length, by });
  } catch (err) { abandon(s); throw err; }
}

/**
 * #6734: store a file whose bytes the caller writes itself, synchronously: `fill(fd)` writes them into the open
 * part file and returns { ok: true, size } or { ok: false, because }. A refusal, or a throw, leaves nothing stored.
 * Returns { ok: true, rec } or { ok: false, because }. Used by a reply's attachment (engine/replyfile.js), which
 * copies the agent's file across in chunks rather than holding it whole.
 */
function saveFilled(scope, owner, { name, type, by }, fill) {
  const s = slot(scope, owner, name);
  let fd = null;
  try {
    fd = fs.openSync(s.part, 'wx', 0o600);
    const got = fill(fd);
    fs.closeSync(fd);
    fd = null;
    if (!got || !got.ok) { abandon(s); return { ok: false, because: (got && got.because) || 'that file could not be kept' }; }
    if (!(got.size > 0)) { abandon(s); return { ok: false, because: 'there is nothing in that file' }; }
    if (got.size > MAX_BYTES) { abandon(s); return { ok: false, because: TOO_LARGE }; }
    return { ok: true, rec: finish(s, scope, owner, { type, size: got.size, by }) };
  } catch (err) {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
    abandon(s);
    throw err;
  }
}

/**
 * #6734: store an upload as it arrives, never holding it whole. `source` is a readable (the request); its bytes go
 * to the part file and are counted on the way, so a body past MAX_BYTES is refused the moment it crosses the cap,
 * with nothing left behind. Resolves to the record; rejects with a sentence (err.tooLarge set for the cap). The
 * caller owns `source` after a rejection: it is paused, not destroyed, so an answer can still be written first.
 */
function saveStream(scope, owner, { name, type, by }, source) {
  return new Promise((resolve, reject) => {
    let s;
    try { s = slot(scope, owner, name); } catch (err) { reject(err); return; }
    const out = fs.createWriteStream(s.part, { flags: 'wx', mode: 0o600 });
    let size = 0;
    let settled = false;
    const detach = () => {
      source.removeListener('data', onData);
      source.removeListener('end', onEnd);
      source.removeListener('error', onFail);
      source.removeListener('close', onClose);
      out.removeListener('drain', onDrain);
      source.on('error', () => {});   // a late reset on a request this no longer reads must not throw
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      detach();
      try { source.pause(); } catch { /* gone */ }
      /* The folder goes once the part file's descriptor is closed, so nothing is left open or behind. */
      const gone = () => { abandon(s); reject(err); };
      if (out.closed) gone(); else { out.once('close', gone); out.destroy(); }
    };
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BYTES) { const e = new Error(TOO_LARGE); e.tooLarge = true; fail(e); return; }
      if (!out.write(chunk)) source.pause();
    }
    function onDrain() { if (!settled) source.resume(); }
    function onEnd() {
      if (settled) return;
      detach();
      if (!size) { fail(new Error('there is nothing in that file')); return; }
      /* Renamed into place only once the descriptor is closed: every byte is on disk and nothing is left open. */
      out.once('close', () => {
        if (settled) return;
        settled = true;
        try { resolve(finish(s, scope, owner, { type, size, by })); } catch (err) { abandon(s); reject(err); }
      });
      out.end();
    }
    function onFail() { fail(new Error('the file stopped arriving before it was whole')); }
    function onClose() { if (!source.complete && !source.readableEnded) onFail(); }
    out.on('error', () => fail(new Error('that file could not be kept')));
    out.on('drain', onDrain);
    source.on('data', onData);
    source.on('end', onEnd);
    source.on('error', onFail);
    source.on('close', onClose);
    // Review 21: a source that already ended or went away will never emit again, so it is refused now rather than
    // left waiting with the part file open (a route that awaited before calling this would otherwise leak).
    if (source.destroyed || source.readableAborted || source.readableEnded) onFail();
  });
}

/** The record for an id, with its paths, or null. Ids are hex, so the walk is
    bounded to the two scopes' folders and never reads a path the id built. */
function read(id) {
  const clean = String(id || '');
  if (!/^[0-9a-f]{24}$/.test(clean)) return null;
  for (const scope of ['project', 'agent']) {
    const base = path.join(ROOT, scope);
    let owners = [];
    try { owners = fs.readdirSync(base); } catch { continue; }
    for (const owner of owners) {
      const dir = path.join(base, owner, clean);
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')); } catch { continue; }
      let file = path.join(dir, safeName(rec.name));
      /* #6734 review 13: a name an older build stored (" .env" was kept as ".env") is still found under the name it was
         stored with, when that is one plain segment and none of this module's own names; safeName now gives "env". */
      if (!fs.existsSync(file) && storedAsIs(rec.name)) file = path.join(dir, rec.name);
      if (!fs.existsSync(file)) continue;
      return { ...rec, dir, file };
    }
  }
  return null;
}

/** The row's field: what the page draws against. `preview` is null, never
    absent, when there is none. ⚠️ For kind 'text' it is the file's own first
    characters, UNTRUSTED TEXT, never markup: a `.html` upload is kind text,
    and the page must draw the snippet with textContent. */
/* #6734 review 5: an image's preview IS the image, so a card would pull the whole file to draw a thumbnail; and a PDF's
   is drawn by reading the whole file (review 14: never measured at 100 MB). Above this neither has a preview (its card
   is the file card, and Download still gives the file). The cap they were built under. */
const MAX_THUMBNAIL_BYTES = 25 * 1024 * 1024;
function tooBigToPreview(rec) { return (rec.kind === 'image' || rec.kind === 'pdf') && !(Number(rec.size) <= MAX_THUMBNAIL_BYTES); }
function rowField(rec) {
  if (!rec) return null;
  let preview = null;
  if ((rec.kind === 'image' || rec.kind === 'pdf') && !tooBigToPreview(rec)) preview = '/api/attachment/' + rec.id + '/preview';
  else if (rec.kind === 'text') preview = textHead(rec.file);
  return { id: rec.id, name: rec.name, type: rec.type, size: rec.size, kind: rec.kind, url: '/api/attachment/' + rec.id, preview };
}

/* #6734: a text file's first TEXT_SNIPPET characters, read from its first bytes only (a 100 MB log is not read whole
   to show a snippet). Four bytes a character covers any UTF-8, and a character cut at the end of the read sits past
   the snippet: even three-byte characters give 2,666 whole ones. */
function textHead(file) {
  let fd = null;
  try {
    // Review 5: without blocking, and only an ordinary file, so a FIFO in a stored file's place cannot stall the board.
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.allocUnsafe(TEXT_SNIPPET * 4);
    let n = 0;
    for (;;) {
      const got = fs.readSync(fd, buf, n, buf.length - n, n);
      if (got === 0) break;
      n += got;
      if (n === buf.length) break;
    }
    return buf.toString('utf8', 0, n).slice(0, TEXT_SNIPPET);
  } catch { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/* The preview renderer seam: tests replace it so nothing shells out. The
   real one runs qlmanage off the event loop (a slow Quick Look must not
   stall every poll on the board) with a timeout, writing to a temp name and
   renaming into place so two requests racing on one fresh PDF cannot cache a
   half-written PNG; the second waits on the first's promise. */
let renderer = null;
function setRenderer(fn) { renderer = typeof fn === 'function' ? fn : null; }
function hasRenderer() { return renderer !== null; }   // #4997: a test's renderer stands in for macOS
const rendering = new Map();
function renderPdf(file, dir, out) {
  if (rendering.has(out)) return rendering.get(out);
  const p = new Promise((resolve) => {
    if (renderer) {
      try { renderer(file, dir); resolve(fs.existsSync(out)); } catch { resolve(false); }
      return;
    }
    const tmp = path.join(dir, 'preview-' + process.pid + '-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    execFile('/usr/bin/qlmanage', ['-t', '-s', '1024', '-o', tmp, file], { timeout: 10000 }, () => {
      try {
        const made = path.join(tmp, path.basename(file) + '.png');
        if (fs.existsSync(made)) fs.renameSync(made, out);
      } catch { /* no preview, said below */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
      resolve(fs.existsSync(out));
    });
  }).finally(() => rendering.delete(out));
  rendering.set(out, p);
  return p;
}
/** The type an image preview is served as: from the IMAGE set by extension,
    never the uploader's header (a .png uploaded as text/html must not draw as
    HTML on the board's origin). */
function imageTypeOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.avif': 'image/avif' }[ext] || null;
}

/**
 * A PNG preview: for an image, the file itself (the browser draws it; the
 * route caps nothing further because the file was capped on the way in);
 * for a PDF, the first page through qlmanage, cached beside the file. Returns
 * { ok: true, type, bytes } or { ok: false, because }.
 */
// #6734: reads the whole file, so it is for tests only; every route uses previewFile, which streams.
async function preview(rec) {
  const pv = await previewFile(rec);
  if (!pv.ok) return pv;
  try { return { ok: true, type: pv.type, bytes: fs.readFileSync(pv.file) }; } catch { return { ok: false, because: pv.unread }; }
}
/** #6734: the same, as the file to send rather than its bytes ({ ok: true, type, file, unread }), so the route can
    stream a 100 MB image instead of reading it whole. `unread` is the sentence for a file that then cannot be read. */
async function previewFile(rec) {
  if (!rec) return { ok: false, because: 'no such attachment' };
  if (rec.kind === 'image') {
    if (tooBigToPreview(rec)) return { ok: false, because: 'that image is too large to preview here; download it instead' };
    const type = imageTypeOf(rec.name) || (IMAGE_TYPES.has(String(rec.type).toLowerCase()) ? String(rec.type).toLowerCase() : null);
    if (!type) return { ok: false, because: 'that is not an image this board will draw' };
    return { ok: true, type, file: rec.file, unread: 'that file could not be read' };
  }
  if (rec.kind !== 'pdf') return { ok: false, because: 'no preview for this kind of file' };
  if (tooBigToPreview(rec)) return { ok: false, because: 'that PDF is too large to preview here; download it instead' };
  const out = path.join(rec.dir, 'preview.png');
  if (!fs.existsSync(out)) {
    const made = await renderPdf(rec.file, rec.dir, out);
    if (!made) return { ok: false, because: 'this computer could not draw the first page' };
  }
  return { ok: true, type: 'image/png', file: out, unread: 'this computer could not draw the first page' };
}

/**
 * An image's pixel size from its first bytes, or null (#5448). Reads the
 * header only, never decodes: PNG (IHDR), GIF (logical screen), JPEG (the
 * first SOF marker, walking segments by their lengths), WebP (VP8, VP8L,
 * VP8X). The format is decided by the bytes' own magic, never by the name
 * or the uploader's type, so a .png that is really text answers null.
 * HEIC and AVIF are boxes nested in boxes and answer null: the agent is
 * then told type and size without dimensions, which is still true.
 */
function imageFacts(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const ok = (type, w, h) => (w > 0 && h > 0 ? { type, width: w, height: h } : null);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString('latin1', 12, 16) === 'IHDR') {
    return ok('image/png', buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a') {
    return ok('image/gif', buf.readUInt16LE(6), buf.readUInt16LE(8));
  }
  if (signatureType(buf) === 'image/jpeg') {
    let i = 2;
    while (i + 8 < buf.length) {
      if (buf[i] === 0x00) { i += 1; continue; }   // zero padding some encoders leave between segments
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }   // fill byte
      if (marker === 0x00) return null;            // a stuffed byte outside image data: damaged
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }   // no length
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      /* SOF0-SOF15, but not DHT (C4), JPG (C8) or DAC (CC), which share the range. */
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (len < 8) return null;   // a frame header too short to hold its size: damaged
        return ok('image/jpeg', buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
      }
      if (marker === 0xda || marker === 0xd9) return null;   // image data or the end before any frame header
      i += 2 + len;
    }
    return null;
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP' && buf.length >= 30) {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return ok('image/webp', buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    }
    if (chunk === 'VP8L' && buf[20] === 0x2f) {
      const b = buf.readUInt32LE(21);
      return ok('image/webp', (b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') {
      return ok('image/webp', buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
    }
  }
  return null;
}

/** The format an image's bytes carry by their signature alone, or null:
    a real image whose dimensions sit past the bytes read (a JPEG behind a
    large ICC profile) still matches its format. A match is a signature,
    not a validation: a file that starts like a JPEG and is not one past its
    first marker is still called a JPEG. */
function signatureType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a') return 'image/gif';
  /* JPEG: the start marker, then a marker a JPEG opens with (APPn, DQT, DHT, a frame header, a comment, DRI). */
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && ((buf[3] >= 0xc0 && buf[3] <= 0xcf) || (buf[3] >= 0xdb && buf[3] <= 0xef) || buf[3] === 0xfe)) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(buf.toString('latin1', 12, 16))) return 'image/webp';
  return null;
}

/* How much of a file is read to find its pixel size: enough for a JPEG whose
   frame header sits behind a camera's metadata (one APP segment is at most
   64 KB; a phone photo can carry two or three). Past this, no dimensions. */
const HEAD_BYTES = 256 * 1024;
function headOf(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(HEAD_BYTES);   // only the n bytes read are returned
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } catch { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/** A size the way a person says it: 512 bytes, 312 KB, 4.2 MB (1024s, as
    the MAX_BYTES cap counts). */
function sizeWords(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b < 0) return null;
  if (b < 1024) return b + (b === 1 ? ' byte' : ' bytes');
  if (Math.round(b / 1024) < 1024) return Math.round(b / 1024) + ' KB';
  return (Math.round(b / (1024 * 1024) * 10) / 10) + ' MB';
}

/** The facts typed after a file's path (#5448): type, then for an image its
    pixel size, then its size on disk. For an image the type is the one its
    bytes' signature matches (PNG, GIF, JPEG, WebP), with dimensions when the
    header could be read. A stored PNG, GIF, JPEG (or image/jpg) or WebP
    type whose bytes were read and match no signature is not repeated
    ("unknown type"): the uploader claimed it and the bytes say otherwise.
    A file that was not read keeps its stored type. Only a file stored as kind
    'image' is read this way; any other file, and a HEIC or AVIF, is told by
    its stored type, kept to the plain characters a media type has (the
    uploader chose it, and this line is typed into a terminal; chat.js
    refuses a trailer with control characters). Size is read from the disk,
    not the record. */
function factsOf(r) {
  let st = null;
  try { st = fs.statSync(r.file); } catch { /* the record's own count, below */ }
  const head = r.kind === 'image' && st && st.isFile() ? headOf(r.file) : null;   // never open a FIFO or device
  const img = head ? imageFacts(head) : null;
  const proven = img ? img.type : (head ? signatureType(head) : null);
  const stored = String(r.type || '').toLowerCase();
  const PROVABLE = ['image/png', 'image/gif', 'image/jpeg', 'image/jpg', 'image/webp'];
  /* A claimed png/gif/jpeg/webp is dropped only when the bytes WERE read and did not match it. */
  const contradicted = head !== null && PROVABLE.includes(stored);
  const plain = /^[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*$/.test(stored) && !contradicted;
  const type = proven || (plain ? stored : null);
  const bytes = st && st.isFile() ? st.size : r.size;
  const parts = [type || 'unknown type'];
  if (img) parts.push(img.width + 'x' + img.height);
  const size = sizeWords(bytes);
  if (size) parts.push(size);
  return parts.join(', ');
}

/** The sentence added to the wire so the agent can open the file(s): one
    bracket per file, in the order they were attached, each with the file's
    facts (#5448) so the agent knows what it is before deciding to open it:
      [attached file: /…/shot.png (image/png, 1280x720, 312 KB)]
    The path already ends with the file's name, so the name is not repeated.
    Reads up to 256 KB of each image synchronously (at most MAX_PER_MESSAGE
    files), on the send path. */
function wireNote(recs) {
  const list = Array.isArray(recs) ? recs : (recs ? [recs] : []);
  return list.filter(Boolean).map((r) => ' [attached file: ' + r.file + ' (' + factsOf(r) + ')' + asText(r) + ']').join('');
}
/* #6098: an office file (xlsx, docx, pdf) also names its text rendering, written beside it on upload
   (engine/attachtext.js), so an agent of any model family reads it with the same command as a text file:
      [attached file: /…/sales.xlsx (application/vnd…, 18 KB); as text: /…/text.txt]
   Only when the rendering is there: an upload from before #6098, or one that could not be written, says nothing. */
function asText(r) {
  if (!r || !r.dir || !require('./attachtext').kindFor(r.name)) return '';
  const t = path.join(r.dir, 'text.txt');
  try { return fs.statSync(t).isFile() ? '; as text: ' + t : ''; } catch { return ''; }
}

/** Resolve a request's attachment ids (either `attachment: id` or
    `attachments: [ids]`, at most MAX_PER_MESSAGE) to records owned by this
    scope and owner. Returns { ok: true, recs } or { ok: false, because }. */
const MAX_PER_MESSAGE = 10;
function resolveForMessage(body, scope, owner, refusal) {
  const ids = Array.isArray(body && body.attachments) ? body.attachments.slice() : [];
  if (body && body.attachment) ids.unshift(body.attachment);
  if (!ids.length) return { ok: true, recs: [] };
  if (ids.length > MAX_PER_MESSAGE) return { ok: false, because: 'a message can carry ' + MAX_PER_MESSAGE + ' files; send these first' };
  const recs = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(String(id))) continue;
    seen.add(String(id));
    const rec = read(id);
    if (!rec || rec.scope !== scope || rec.owner !== owner) return { ok: false, because: refusal };
    recs.push(rec);
  }
  return { ok: true, recs };
}

/** The row's fields for a list: `attachments` for every file, and
    `attachment` as the first so a card drawn against one file keeps working. */
function rowFields(recs) {
  const list = (recs || []).map(rowField).filter(Boolean);
  if (!list.length) return {};
  return { attachment: list[0], attachments: list };
}

module.exports = { MAX_BYTES, MAX_WORDS, TOO_LARGE, PART, ORPHAN_AGE_MS, MAX_THUMBNAIL_BYTES, sweepOrphans, discardStored, MAX_PER_MESSAGE, ROOT, kindOf, imageTypeOf, renderPdf, hasRenderer, safeName, save, saveFilled, saveStream, read, rowField, rowFields, resolveForMessage, preview, previewFile, wireNote, imageFacts, signatureType, sizeWords, setRenderer };   // #4997: imageTypeOf, renderPdf and hasRenderer for engine/filepreview.js
