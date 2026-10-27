'use strict';
/**
 * kosmos#6849: a delivered file's fingerprint, the one `kosmos task built --file`, `kosmos handoff` and
 * `kosmos fingerprint` all give, so an agent checking a handed-off file compares like with like.
 *
 * For every file but a PDF it is the plain sha256 of the bytes (what `shasum -a 256` prints). For a PDF it is the sha256
 * of the bytes with the PDF's own clock and identity left out: every /CreationDate and /ModDate in it,
 * the /ID pair in its trailer, and the matching XMP fields. Those change on every render, so the same source rendered
 * twice gave two fingerprints (measured on #6849: Chrome's print to PDF differs only in its two dates; macOS cupsfilter
 * in its two dates and its /ID). Outside streams the objects are read as PDF syntax, with every string opaque, so only a
 * value straight after a real /CreationDate, /ModDate or /ID key is emptied; inside a stream only the XMP fields of the
 * metadata stream are. Page text, a form value, an annotation or a Title shaped like one of these fields still changes it.
 *
 * Not covered, and why: a PDF that keeps its document info inside a compressed object stream is hashed as it is (its
 * dates are not readable without inflating every stream), and so is a compressed XMP stream; Adobe's xmpMM:History events,
 * single-quoted XMP attributes and a date or /ID value over 256 bytes are not emptied; a date whose LENGTH changes between
 * renders still moves the xref offsets. Each of these gives two fingerprints for one document. The way to the opposite (one
 * fingerprint for two documents) is a file built so that a stream's edges are misread: the word endstream inside a stream
 * whose /Length is not a plain number, or `>> stream` written inside a string. Text after the misread edge is then read as
 * objects. No renderer we measured writes either, so it takes a file built to do it; a PDF fingerprint is a check for the
 * same render, not a proof against tampering. A PDF over PDF_MAX (64 MB) is hashed as plain bytes rather than held whole in memory.
 *
 * #7213: the two kinds are LABELLED, because for the same unchanged PDF they differ and a reader holding an approval's plain
 * sha256 took the other for a changed file. `sha256:<hex>` is always the plain sha256 of the bytes (what `shasum -a 256`
 * prints). `pdf-normalized:<hex>` is a PDF whose dates or /ID were left out; a PDF with none to leave out hashes to its
 * plain bytes and says sha256:. `plain(p)` gives the plain sha256 of any file, so a PDF can be checked against either.
 *
 * Run directly, `node fileprint.js <path>` prints the fingerprint (exit 0) or the reason it could not be read (exit 2).
 * `node fileprint.js <path> <expected>` compares like with like (see compare) and says which kind it compared.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

/* Larger PDFs are hashed as plain bytes. The metadata is taken out of the whole file in memory (a buffer, a string and
   its copies, several times the file), so the cap keeps that to a few hundred MB and well under V8's longest string. */
const PDF_MAX = 64 * 1000 * 1000;   // 64 MB as the help and instruction say it (not MiB, review 6)
const CHUNK = 1 << 20;               // 1 MiB a read

function firstLine(s) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim();
  const nl = t.indexOf('\n');
  return nl === -1 ? t : t.slice(0, nl).trim();
}

/* Each value is bounded (real dates and IDs are under ~100 bytes): unbounded, a long unclosed `(` overflowed the stack
   and a file of many made every match scan to the end (192 s for 2 MB, measured in review). */
const VALUE_MAX = 256;
const WS = '[\\x00\\t\\n\\f\\r ]';             // PDF whitespace (JS's \s also takes 0xA0 and misses NUL)
const XMP = '(?:xmp:CreateDate|xmp:ModifyDate|xmp:MetadataDate|xmpMM:DocumentID|xmpMM:InstanceID)';
/* The XMP clock and identity, matched only in the XMP metadata stream (XMP is never written outside a stream). */
const XMPS = [
  [new RegExp('<(' + XMP + ')>[^<]{0,256}</\\1>', 'g'), '<$1></$1>'],
  [new RegExp('\\b(' + XMP + ')="[^"]{0,256}"', 'g'), '$1=""'],
];
/* A stream's start: the keyword after its dictionary's >>, then its end of line. */
const STREAM = new RegExp('>>' + WS + '*stream(?:\\r\\n|\\n|\\r)', 'g');   // CR alone is off-spec, but written
/* A direct /Length in the stream's dictionary (an indirect one, `/Length 12 0 R`, is not read; the (?![0-9]) stops it
   being read as a shorter direct one, `/Length 1234 0 R` as 123). */
const LENGTH = new RegExp('/Length' + WS + '+(\\d{1,12})(?![0-9])(?!' + WS + '+\\d+' + WS + '+R)', 'g');
const ENDSTREAM = new RegExp('^' + WS + '*endstream');

const empty = (s, rules) => { for (const [re, to] of rules) s = s.replace(re, to); return s; };

/* Outside streams the objects are read as PDF syntax rather than matched as text (review 9): a string is opaque, so a
   form value, an annotation or a Title holding `/ModDate (...)` is never emptied. Only a value straight after a real
   /CreationDate, /ModDate or /ID key is. */
const isWs = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const skipWs = (s, k) => { while (k < s.length && isWs(s.charCodeAt(k))) k++; return k; };

/** The index after the literal string opening at i (balanced brackets, backslash escapes), or -1 when it has not
 * closed within `limit` bytes (or by the end). */
function litEnd(s, i, limit) {
  const stop = Math.min(s.length, i + limit);
  let depth = 0;
  for (let j = i; j < stop; j++) {
    const c = s.charCodeAt(j);
    if (c === 92) { j++; continue; }
    if (c === 40) depth++;
    else if (c === 41 && --depth === 0) return j + 1;
  }
  return -1;
}

/** The index after a short date or ID string at k (a literal or a hex string), or -1 when there is none. */
function valueEnd(s, k) {
  if (s.charCodeAt(k) === 40) return litEnd(s, k, VALUE_MAX + 2);
  if (s.charCodeAt(k) === 60 && s.charCodeAt(k + 1) !== 60) {
    const stop = Math.min(s.length, k + 2 * VALUE_MAX + 2);
    for (let j = k + 1; j < stop; j++) {
      const c = s.charCodeAt(j);
      if (c === 62) return j + 1;
      if (!(isWs(c) || (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102))) return -1;
    }
  }
  return -1;
}

/** Object text (no stream bytes) with its /CreationDate, /ModDate and /ID values emptied: `/ModDate()`, `/ID[]`. */
function stableObjects(s) {
  const n = s.length;
  let out = '';
  let from = 0;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 40) { const e = litEnd(s, i, Infinity); i = e === -1 ? n : e; continue; }   // a string: opaque
    if (c === 37) { while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++; continue; }   // a comment
    if (c !== 47) { i++; continue; }
    let j = i + 1;
    while (j < n && !isWs(s.charCodeAt(j)) && !isDelim(s.charCodeAt(j))) j++;
    const name = s.slice(i + 1, j);
    if (name === 'CreationDate' || name === 'ModDate') {
      const e = valueEnd(s, skipWs(s, j));
      if (e !== -1) { out += s.slice(from, j) + '()'; from = i = e; continue; }
    } else if (name === 'ID') {
      let k = skipWs(s, j);
      if (s.charCodeAt(k) === 91) {
        const e1 = valueEnd(s, skipWs(s, k + 1));
        const e2 = e1 === -1 ? -1 : valueEnd(s, skipWs(s, e1));
        k = e2 === -1 ? -1 : skipWs(s, e2);
        if (k !== -1 && s.charCodeAt(k) === 93) { out += s.slice(from, j) + '[]'; from = i = k + 1; continue; }
      }
    }
    i = j;
  }
  return out + s.slice(from);
}

/** True when these first bytes are a PDF's: it starts with %PDF-. (The PDF spec lets a reader look further in, but a file
 * that only mentions %PDF- somewhere near its top is text, and stays its plain sha256.) */
function isPdfHead(head) {
  return head.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** A PDF's bytes with its clock and identity emptied (latin1, so every byte maps to itself and back). A stream's bytes
 * are left as they are, except the XMP fields of the metadata stream: page text is never taken for metadata. */
function stablePdf(buf) {
  const s = buf.toString('latin1');
  let out = '';
  let pos = 0;
  STREAM.lastIndex = 0;
  for (let m; (m = STREAM.exec(s)) !== null;) {
    const start = m.index + m[0].length;
    out += stableObjects(s.slice(pos, start));
    // The stream's own dictionary: back to its object's `obj`, at most 4 KiB.
    const back = s.slice(Math.max(pos, m.index - 4096), m.index);
    const dict = back.slice(back.lastIndexOf('obj') + 1);
    let end = -1;
    let L = null;
    LENGTH.lastIndex = 0;
    for (let n; (n = LENGTH.exec(dict)) !== null;) L = Number(n[1]);
    if (L !== null && start + L <= s.length && ENDSTREAM.test(s.slice(start + L, start + L + 64))) end = start + L;
    if (end === -1) end = s.indexOf('endstream', start);
    if (end === -1) end = s.length;
    const body = s.slice(start, end);
    const isXmp = /\/Type[\x00\t\n\f\r ]*\/Metadata\b/.test(dict) || /^[\x00\t\n\f\r ]*<(?:\?xpacket|x:xmpmeta)/.test(body);
    out += isXmp ? empty(body, XMPS) : body;
    pos = end;
    STREAM.lastIndex = end;
  }
  out += stableObjects(s.slice(pos));
  return Buffer.from(out, 'latin1');
}

const PLAIN = 'sha256:';
const PDF_KIND = 'pdf-normalized:';   // #7213: never 'sha256:', which an approval's plain hash also carries

/** 'sha256:<hex>' or 'pdf-normalized:<hex>' for an open file descriptor of `size` bytes. `raw` takes the plain sha256 even
 * of a PDF. A read error is thrown for the caller to word. */
function printFd(fd, size, raw) {
  const hash = crypto.createHash('sha256');
  const first = Buffer.allocUnsafe(CHUNK);
  const n0 = fs.readSync(fd, first, 0, first.length, null);
  const head = first.subarray(0, n0);
  if (!raw && isPdfHead(head) && size <= PDF_MAX) {
    const parts = [Buffer.from(head)];
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK);
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      parts.push(buf.subarray(0, n));
    }
    const whole = Buffer.concat(parts);
    const stable = stablePdf(whole);
    hash.update(stable);
    // Nothing left out: the value IS the plain sha256, and says so.
    return (stable.equals(whole) ? PLAIN : PDF_KIND) + hash.digest('hex');
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
  return PLAIN + hash.digest('hex');
}

/** The fingerprint, or an honest reason, for one path (#6506 axis 5, moved here from engine/handoff.js for #6849).
 * The path is echoed back exactly as given (never re-split), so a path with spaces is safe. */
function fingerprint(p) { return readPrint(p, false); }

/** The plain sha256 ('sha256:<hex>') of any file, a PDF's bytes as they are, or the same honest reason (#7213). */
function plain(p) { return readPrint(p, true); }

function readPrint(p, raw) {
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
    return printFd(fd, st.size, raw);
  } catch (e) {
    if (e && e.code === 'EISDIR') return 'is a directory, not a file';
    if (e && e.code === 'EACCES') return 'unreadable (permission denied)';
    return 'could not be read (' + firstLine(e && e.message) + ')';
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* best effort */ }
  }
}

const PRINT_RE = /^(?:sha256|pdf-normalized):[0-9a-f]{64}$/;
const isPrint = (s) => typeof s === 'string' && PRINT_RE.test(s);

/** What kind of hash a fingerprint is, in words (#7213). */
function kindWords(print) {
  return String(print).startsWith(PDF_KIND) ? "the PDF fingerprint (its own dates and ID left out; not what shasum prints)"
    : 'the plain sha256 (what shasum -a 256 prints)';
}

/** Whether `p` starts as a PDF, and its size (a read error reads as not a PDF; compare has read it already). */
function pdfHeadOf(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(5);
    const n = fs.readSync(fd, head, 0, 5, 0);
    return { pdf: isPdfHead(head.subarray(0, n)), size: fs.fstatSync(fd).size };
  } catch { return { pdf: false, size: 0 }; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* best effort */ } }
}

/** Compare file `p` with `expected`, like with like (#7213). `expected` may be 'sha256:<hex>', 'pdf-normalized:<hex>' or
 * a bare 64-hex value (case ignored), which is how an approval usually cites a plain sha256 and is read as one. Returns
 * { ok, match, kind, got, words } where `got` is this file's value of the kind compared, or { ok: false, words } when
 * the expected value is not a hash or the file cannot be read. A `sha256:` value that misses the plain bytes of a PDF
 * is tried against its PDF fingerprint too (a mark sent after #6849 and before this change labelled that sha256:), and a match
 * there says the value is a PDF fingerprint, not whether the bytes differ; a bare value never is, so a bare shasum check
 * stays byte for byte. */
function compare(p, expected) {
  let want = String(expected == null ? '' : expected).trim().toLowerCase();
  const bare = /^[0-9a-f]{64}$/.test(want);   // a shasum value: never an older mark, which always said sha256:
  if (bare) want = PLAIN + want;
  if (!isPrint(want)) return { ok: false, words: 'that is not a sha256 or a fingerprint: give sha256:<64 hex>, pdf-normalized:<64 hex> or the 64 hex characters alone' };
  const kind = want.startsWith(PDF_KIND) ? 'pdf-normalized' : 'sha256';
  const hexOf = (s) => s.slice(s.indexOf(':') + 1);
  const got = kind === 'sha256' ? plain(p) : fingerprint(p);
  if (!isPrint(got)) return { ok: false, words: got };
  if (kind === 'pdf-normalized') {
    /* A PDF whose dates and ID are already empty normalizes to its own bytes and is labelled sha256: (review 1, finding 2),
       so for a PDF the hex decides, not the label. A file that is not a PDF has no PDF fingerprint at all (review 2). */
    const head = pdfHeadOf(p);
    if (head.pdf && hexOf(got) === hexOf(want)) {
      // Labelled sha256:, nothing was left out (none to leave, or over 64 MB): the bytes themselves are that value (review 3).
      return { ok: true, match: true, kind, got, words: got.startsWith(PDF_KIND) ? 'matches ' + kindWords(want) : 'matches: this PDF\'s own bytes are that value (nothing in it was left out)' };
    }
    if (got.startsWith(PDF_KIND)) return { ok: true, match: false, kind, got, words: 'differs from ' + kindWords(want) + ': this file gives ' + got };
    const why = !head.pdf ? 'this file is not a PDF, so it has none'
      : head.size > PDF_MAX ? 'this PDF is over 64 MB, so it is hashed as plain bytes and has none'
      : 'this PDF has no dates or ID to leave out, so its fingerprint is its plain sha256';
    return { ok: true, match: false, kind, got, words: 'differs: that value is a PDF fingerprint, and ' + why + ': ' + got };
  }
  if (got === want) return { ok: true, match: true, kind, got, words: 'matches ' + kindWords(want) };
  /* A mark sent after #6849 and before this change carries a PDF's normalized hash under the sha256: label (review 1, finding 1).
     Its plain bytes do not match, so try the PDF fingerprint too, and say that is what matched. */
  const fp = fingerprint(p);
  /* Review 4: a bare value stays a byte-for-byte check (review 2), but when it is this PDF's own fingerprint with its
     label left off, say so: "differs" alone was the #7213 confusion again. */
  if (bare && fp.startsWith(PDF_KIND) && hexOf(fp) === hexOf(want)) {
    return { ok: true, match: false, kind, got, words: 'differs from the plain sha256 (what shasum -a 256 prints): this file gives ' + got + '. But that value is this PDF\'s fingerprint (' + fp + '): give it with the pdf-normalized: label to compare it that way' };
  }
  if (!bare && fp.startsWith(PDF_KIND) && hexOf(fp) === hexOf(want)) {
    /* Review 3: a sha256: value typed by hand cannot be told from an older mark, so the words never call this a byte
       match. What is known is only that the value is this PDF's fingerprint: an older mark of an identical file reads the
       same as a plain sha256 of a copy whose dates were already empty. So the words say what the value is, and claim
       nothing about whether the bytes differ (Josh's 0.7.71 report: the file was byte-identical, and "the bytes differ"
       was wrong). */
    return { ok: true, match: true, kind: 'pdf-normalized', got: fp, words: 'matches the PDF fingerprint, not the bytes: that value is this PDF\'s fingerprint (its dates and ID left out), not its plain sha256, so it does not show whether the bytes are identical. For a byte-for-byte check give the approved file\'s plain sha256 (what shasum -a 256 prints for it; a kosmos handoff prints it beside the fingerprint). This value alone cannot give one. (Older marks put the sha256: label on a PDF fingerprint.)' };
  }
  return { ok: true, match: false, kind, got, words: 'differs from ' + kindWords(want) + ': this file gives ' + got };
}

module.exports = { fingerprint, plain, compare, kindWords, isPrint, isPdfHead, stablePdf, firstLine, PDF_MAX };

if (require.main === module) {
  const p = process.argv[2];
  if (!p || process.argv.length > 4) { process.stderr.write('Usage: kosmos fingerprint <file> [expected]\n'); process.exit(2); }
  if (process.argv.length === 4) {
    const c = compare(p, process.argv[3]);
    if (!c.ok) { process.stderr.write(p + ': ' + c.words + '\n'); process.exit(2); }
    process.stdout.write(p + ' ' + c.words + '\n');
    process.exit(c.match ? 0 : 1);
  }
  const out = fingerprint(p);
  if (isPrint(out)) { process.stdout.write(out + '\n'); process.exit(0); }
  process.stderr.write(p + ': ' + out + '\n');
  process.exit(2);
}
