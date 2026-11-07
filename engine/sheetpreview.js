'use strict';
/**
 * kosmos#8122 (parser half): the board's read-only grid for the file viewer, from a spreadsheet's bytes.
 *
 * One shape for the viewer, whatever the file: `{ sheets: [{ name, rows, cut, notGrid?, firstRow? }], moreSheets, noValues, empty,
 * someNoValues? }`
 * (engine/xlsxpreview.js's answer, Mona Lisa's seam), or a refusal `{ ok: false, because, tooLarge? }` whose sentence a
 * person can be shown.
 *
 * - .xlsx goes through engine/xlsxpreview.js (saved values only: no formula runs, no link is followed, nothing outside
 *   the file is loaded).
 * - .csv and .tsv go through `readDelimited` below: the same caps (MAX_ROWS, MAX_COLS, MAX_CELL_CHARS), one pass over
 *   the text with no backtracking pattern, quotes as RFC 4180 has them. A value that looks like a formula (`=SUM(A1)`)
 *   is shown as the text it is; nothing in the file is evaluated.
 *
 * Built-ins only, as xlsxpreview.js.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const xlsx = require('./xlsxpreview');

const MAX_DELIMITED_BYTES = 2 * 1024 * 1024;   // a CSV past this is "too large to preview" (the button still downloads it)
const TOO_LARGE = 'This spreadsheet is too large to preview.';
const CANNOT_READ = 'This file could not be read as a spreadsheet.';

/* Which reader a file name asks for, or null when this is not a spreadsheet the viewer previews. */
function kindOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  if (ext === '.csv') return 'csv';
  if (ext === '.tsv') return 'tsv';
  return null;
}
/* The size cap for a kind, checked before any byte is read. */
function capFor(kind) { return kind === 'xlsx' ? xlsx.MAX_FILE_BYTES : MAX_DELIMITED_BYTES; }

const clip = xlsx.clip;   // review 7: one cut for both readers (this one halved an emoji)

/**
 * A delimited text file (CSV or TSV) to the viewer's shape. RFC 4180 quoting: a field in double quotes may hold the
 * delimiter, a line break or a doubled quote. A UTF-8 byte order mark is dropped. Rows past MAX_ROWS and columns past
 * MAX_COLS are left out and the sheet is marked `cut`; a quote never closed reads to the end of the file, as a
 * spreadsheet program would.
 */
function readDelimited(text, sep, name) {
  if (typeof text !== 'string') throw new TypeError('sheetpreview: readDelimited takes a string');
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let cut = false;
  let width = 0;
  let any = false;
  const endField = () => {
    if (row.length < xlsx.MAX_COLS) row.push(clip(field));
    else if (field !== '') cut = true;   // a value past MAX_COLS is left out, and the sheet says it was cut
    if (field !== '') any = true;
    field = '';
  };
  // Review 7: as the xlsx reader, the rows shown start at the first line with a value when that line is past the cap
  // (a CSV after 250 blank lines showed an empty grid that said "more").
  let line = 0;
  let base = null;
  const endRow = () => {
    endField();
    const blank = row.every((c) => c === '');
    if (base === null && !blank) { base = line >= xlsx.MAX_ROWS ? line : 0; if (base) { rows.length = 0; width = 0; } }
    if (base === null && line >= xlsx.MAX_ROWS) { /* a blank line before the first value: not kept */ }
    else if (rows.length < xlsx.MAX_ROWS) { rows.push(row); if (row.length > width) width = row.length; }
    else if (!blank) cut = true;   // review 6: a blank line past the cap leaves no value out
    line++;
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else if (field.length <= xlsx.MAX_CELL_CHARS) field += ch;   // review 1: a quoted field is bounded too
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === sep) { endField(); continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    field += ch;
    // A cell can never grow past what is shown: the rest of a very long field is not kept (one pass, bounded memory).
    if (field.length > xlsx.MAX_CELL_CHARS + 1) field = field.slice(0, xlsx.MAX_CELL_CHARS + 1);
  }
  if (field !== '' || row.length) endRow();
  // A trailing empty line is not a row.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  const grid = rows.map((r) => Array.from({ length: width }, (_, k) => r[k] || ''));
  return { sheets: [{ name: name || 'Sheet 1', rows: grid, cut, ...(base ? { firstRow: base + 1 } : {}) }], moreSheets: 0, noValues: false, empty: !any };
}

/* Review 5: an answer too large to send is "too large to preview", decided here, whichever reader made it (the xlsx
   reader caps its own answer; this is the seam's own line, and it covers CSV, whose input cap bounds it). */
const MAX_ANSWER_CHARS = 8 * 1024 * 1024;
function fits(answer) {
  let size = Infinity;
  try { size = JSON.stringify(answer).length; } catch { /* past the longest string: too large */ }
  return size <= MAX_ANSWER_CHARS ? answer : { ok: false, because: TOO_LARGE, tooLarge: true };
}

/**
 * A spreadsheet's bytes to `{ ok: true, ...shape }` or `{ ok: false, because, tooLarge? }`. `name` decides the reader.
 */
function fromBytes(buf, name) {
  const kind = kindOf(name);
  if (!kind) return { ok: false, because: 'There is no spreadsheet preview for this kind of file.' };
  if (!Buffer.isBuffer(buf)) return { ok: false, because: CANNOT_READ };
  if (buf.length > capFor(kind)) return { ok: false, because: TOO_LARGE, tooLarge: true };
  // Review 5: the same bytes are read once, not once per request (a hostile file could cost up to the 2 s budget every
  // time the viewer asked). Keyed by the bytes and the reader (and a CSV's name), so a changed file is read again.
  // A CSV's sheet is named after its file, so its name is part of the key. A refusal for what the file IS (too many
  // bytes, not a workbook) is kept; one for the time the read took is not. Each caller gets its own copy.
  const key = kind + ':' + (kind === 'xlsx' ? '' : path.basename(String(name || ''))) + ':' + crypto.createHash('sha256').update(buf).digest('base64');
  let answer = answers.get(key);
  if (answer) answers.delete(key);
  else {
    let read = readFresh(buf, kind, name);
    // Review 6: a refusal for the time it took is not remembered (a busy moment would stick), and an answer is copied
    // before it is kept: its strings were slices of the whole unpacked part, so each entry held up to 16 MB.
    // Review 7: but a file that is slow twice running is slow because of what it is, and is kept from then on (a
    // file always past the budget cost the whole budget on every request).
    if (read.slow) {
      const { slow, ...shown } = read;
      if (!slowOnce.has(key)) { slowOnce.add(key); if (slowOnce.size > MAX_REMEMBERED) slowOnce.delete(slowOnce.values().next().value); return shown; }
      read = shown;
    }
    answer = JSON.parse(JSON.stringify(read));
  }
  answers.set(key, answer);
  if (answers.size > MAX_REMEMBERED) answers.delete(answers.keys().next().value);
  return structuredClone(answer);
}
const MAX_REMEMBERED = 8;   // answers kept, the least recently asked for goes first; each is capped (MAX_ANSWER_CHARS)
const answers = new Map();
const slowOnce = new Set();   // keys refused once for the time taken
function readFresh(buf, kind, name) {
  if (kind === 'xlsx') {
    try { return fits({ ok: true, ...xlsx.readXlsx(buf) }); }
    catch (e) {
      if (e && e.name === 'XlsxRefusal') return { ok: false, because: e.message, ...(e.message === TOO_LARGE ? { tooLarge: true } : {}), ...(e.slow ? { slow: true } : {}) };
      return { ok: false, because: CANNOT_READ };
    }
  }
  // A NUL byte means this is not text, whatever its name says.
  if (buf.includes(0)) return { ok: false, because: CANNOT_READ };
  const base = path.basename(String(name || ''));
  try { return fits({ ok: true, ...readDelimited(buf.toString('utf8'), kind === 'tsv' ? '\t' : ',', base) }); }
  catch { return { ok: false, because: CANNOT_READ }; }
}

/**
 * A file on disk (an attachment the board stored) to the same answer. A link is refused before it is opened (an lstat,
 * because Windows has no O_NOFOLLOW), then one handle: O_NOFOLLOW where the system has it, O_NONBLOCK (a FIFO does
 * not block the board), a regular file only, and the size checked on the open handle before a byte is read, so a
 * file too large is refused without loading it.
 */
function fromFile(file, name) {
  const kind = kindOf(name || file);
  if (!kind) return { ok: false, because: 'There is no spreadsheet preview for this kind of file.' };
  let fd = null;
  try {
    const before = fs.lstatSync(file, { bigint: true });
    if (before.isSymbolicLink()) return { ok: false, because: CANNOT_READ };
    // Undefined on win32 (#1732 fs-const-platform-flag), ORed in undefined-safe: the lstat refusal above and the dev/ino
    // identity check below refuse a swapped link on every platform, and the isFile check refuses a FIFO.
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) return { ok: false, because: CANNOT_READ };
    // Review 7: the file opened is the one looked at (Windows has no O_NOFOLLOW, so a link swapped in between is caught here).
    if (st.ino !== before.ino || st.dev !== before.dev) return { ok: false, because: CANNOT_READ };
    const size = Number(st.size);   // read as a bigint, for the identity check above
    if (size > capFor(kind)) return { ok: false, because: TOO_LARGE, tooLarge: true };
    const bytes = Buffer.alloc(size);
    let off = 0;
    while (off < size) { const n = fs.readSync(fd, bytes, off, size - off, off); if (n <= 0) break; off += n; }
    if (off !== size) return { ok: false, because: 'That file changed while it was being read.' };
    return fromBytes(bytes, name || file);
  } catch { return { ok: false, because: 'That file could not be read.' }; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

module.exports = { _forgetForTests: () => { answers.clear(); slowOnce.clear(); }, kindOf, capFor, readDelimited, fromBytes, fromFile, MAX_DELIMITED_BYTES, TOO_LARGE, CANNOT_READ };
