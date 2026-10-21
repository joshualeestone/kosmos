'use strict';
/**
 * kosmos#6849: a delivered file's fingerprint, the one `kosmos task built --file`, `kosmos handoff` and
 * `kosmos fingerprint` all give, so an agent checking a handed-off file compares like with like.
 *
 * For every file but a PDF it is the plain sha256 of the bytes (what `shasum -a 256` prints). For a PDF it is the sha256
 * of the bytes with the PDF's own clock and identity left out: the /CreationDate and /ModDate in its document info,
 * the /ID pair in its trailer, and the matching XMP fields. Those change on every render, so the same source rendered
 * twice gave two fingerprints (measured on #6849: Chrome's print to PDF differs only in its two dates; macOS cupsfilter
 * in its two dates and its /ID). Nothing else is left out, so a change to what the PDF shows still changes the print.
 *
 * Not covered, and why: a PDF that keeps its document info inside a compressed object stream is hashed as it is (its
 * dates are not readable without inflating every stream), and so is a compressed XMP stream; Adobe's xmpMM:History events,
 * single-quoted XMP attributes and an /ID literal holding unescaped brackets are not emptied; a date whose LENGTH changes
 * between renders still moves the xref offsets. Each of these gives two fingerprints, never one for two different
 * documents. A PDF over PDF_MAX (64 MiB) is hashed as plain bytes rather than held whole in memory.
 *
 * Run directly, `node fileprint.js <path>` prints the fingerprint (exit 0) or the reason it could not be read (exit 2).
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

/* Larger PDFs are hashed as plain bytes. The metadata is taken out of the whole file in memory (a buffer, a string and
   its copies, several times the file), so the cap keeps that to a few hundred MB and well under V8's longest string. */
const PDF_MAX = 64 * 1024 * 1024;
const CHUNK = 1 << 20;               // 1 MiB a read

function firstLine(s) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim();
  const nl = t.indexOf('\n');
  return nl === -1 ? t : t.slice(0, nl).trim();
}

const LIT = '\\((?:\\\\[\\s\\S]|[^\\\\)])*\\)';   // a PDF literal string, (...) with backslash escapes
const HEX = '<[0-9A-Fa-f\\s]*>';                  // a PDF hex string
const XMP = '(?:xmp:CreateDate|xmp:ModifyDate|xmp:MetadataDate|xmpMM:DocumentID|xmpMM:InstanceID)';
/* The PDF's clock and identity, each replaced by an empty value of the same field. */
const VOLATILE = [
  [new RegExp('/(CreationDate|ModDate)\\s*(?:' + LIT + '|' + HEX + ')', 'g'), '/$1()'],
  [new RegExp('/ID\\s*\\[\\s*(?:' + HEX + '|' + LIT + ')\\s*(?:' + HEX + '|' + LIT + ')\\s*\\]', 'g'), '/ID[]'],
  [new RegExp('<(' + XMP + ')>[^<]*</\\1>', 'g'), '<$1></$1>'],
  [new RegExp('\\b(' + XMP + ')="[^"]*"', 'g'), '$1=""'],
];

/** True when these first bytes are a PDF's: it starts with %PDF-. (The PDF spec lets a reader look further in, but a file
 * that only mentions %PDF- somewhere near its top is text, and stays its plain sha256.) */
function isPdfHead(head) {
  return head.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** A PDF's bytes with its clock and identity emptied (latin1, so every byte maps to itself and back). */
function stablePdf(buf) {
  let s = buf.toString('latin1');
  for (const [re, to] of VOLATILE) s = s.replace(re, to);
  return Buffer.from(s, 'latin1');
}

/** 'sha256:<hex>' for an open file descriptor of `size` bytes. A read error is thrown for the caller to word. */
function printFd(fd, size) {
  const hash = crypto.createHash('sha256');
  const first = Buffer.allocUnsafe(CHUNK);
  const n0 = fs.readSync(fd, first, 0, first.length, null);
  const head = first.subarray(0, n0);
  if (isPdfHead(head) && size <= PDF_MAX) {
    const parts = [Buffer.from(head)];
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK);
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      parts.push(buf.subarray(0, n));
    }
    hash.update(stablePdf(Buffer.concat(parts)));
    return 'sha256:' + hash.digest('hex');
  }
  hash.update(head);
  if (n0 > 0) {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
  }
  return 'sha256:' + hash.digest('hex');
}

/** The fingerprint, or an honest reason, for one path (#6506 axis 5, moved here from engine/handoff.js for #6849).
 * The path is echoed back exactly as given (never re-split), so a path with spaces is safe. */
function fingerprint(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return 'missing (no such file)';
    if (e && e.code === 'EACCES') return 'unreadable (permission denied)';
    if (e && e.code === 'ELOOP') return 'unreadable (symlink loop)';
    if (e && e.code === 'ENOTDIR') return 'missing (a parent path element is not a directory)';
    return 'could not be read (' + firstLine(e && e.message) + ')';
  }
  if (st.isDirectory()) return 'is a directory, not a file';
  if (!st.isFile()) return 'not a regular file';
  // Read in chunks rather than whole (a large build output would throw); the chunked read also closes the
  // stat-then-read window: a path swapped for a directory in between surfaces as EISDIR and is said as one.
  let fd;
  try {
    fd = fs.openSync(p, 'r');
  } catch (e) {
    if (e && e.code === 'EACCES') return 'unreadable (permission denied)';
    if (e && e.code === 'EISDIR') return 'is a directory, not a file';
    if (e && e.code === 'ENOENT') return 'missing (no such file)';
    return 'could not be read (' + firstLine(e && e.message) + ')';
  }
  try {
    return printFd(fd, st.size);
  } catch (e) {
    if (e && e.code === 'EISDIR') return 'is a directory, not a file';
    if (e && e.code === 'EACCES') return 'unreadable (permission denied)';
    return 'could not be read (' + firstLine(e && e.message) + ')';
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* best effort */ }
  }
}

const isPrint = (s) => /^sha256:[0-9a-f]{64}$/.test(s);

module.exports = { fingerprint, isPrint, isPdfHead, stablePdf, firstLine, PDF_MAX };

if (require.main === module) {
  const p = process.argv[2];
  if (!p) { process.stderr.write('Usage: kosmos fingerprint <file>\n'); process.exit(2); }
  const out = fingerprint(p);
  if (isPrint(out)) { process.stdout.write(out + '\n'); process.exit(0); }
  process.stderr.write(p + ': ' + out + '\n');
  process.exit(2);
}
