'use strict';
/**
 * #6098: a text rendering of an office attachment (xlsx, docx, pdf), written beside the stored file as text.txt, so an
 * agent of ANY model family reads it with the same `cat` it uses on a text attachment (engine/attachments.js wireNote
 * names the path). Not every family's command line reads these files itself; before this an agent unzipped a
 * spreadsheet and rebuilt its table from raw XML by hand (feedback, 2026-10-13).
 *
 * What each becomes:
 *   xlsx  every sheet, in workbook order, under its name, as a table (formulas as their last saved values)
 *   docx  the body's paragraphs and tables, in order (headings marked, list items bulleted)
 *   pdf   the text of each page, with page breaks, from the reader below (Flate streams, object streams, the page tree,
 *         fonts with a ToUnicode map). Where its text does not read as text, a Mac asks macOS's own PDFKit, which knows
 *         more font encodings; the JS reader goes first because PDFKit can join a page's lines into one.
 * Every rendering starts by saying what it is, and says what could not be converted.
 *
 * ⚠️ A FILE FROM A PERSON IS HOSTILE BYTES (attachments.js). Two layers keep one from hurting the board:
 *   1. The conversion runs in a WORKER THREAD with a memory limit and a time limit (render, below). A file that would
 *      take too long or too much memory ends the worker, never the board's only thread, and the rendering says so.
 *   2. Inside it, every reader is linear (#4598: indexOf walks that only move forward, bounded number patterns, no lazy
 *      `[\s\S]*?` over a person's text), and every output is capped as it is built, not after.
 * PDFKit runs in a subprocess with a timeout. Nothing here executes the file.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const oc = require('./orgchartfile');

const TEXT_NAME = 'text.txt';
const MAX_OUT = 2 * 1024 * 1024;           // characters in a rendering
const MAX_CELL = 32 * 1024;                // characters kept from one cell
const MAX_SHEET_ROWS = 5000;
const MAX_COLS = 256;
const MAX_PDF_INFLATE = 64 * 1024 * 1024;  // decompressed bytes a PDF may cost, charged even for a stream that overflows
const MAX_PDF_CONTENT = 32 * 1024 * 1024;  // content-stream bytes a PDF may have tokenised, shared streams counted each time
const MAX_PDF_PAGES = 2000;
const MAX_CMAP_ENTRIES = 200000;           // ToUnicode entries per font
const MAX_ARRAY = 4096;                    // items kept from one TJ array
const PDFKIT_TIMEOUT_MS = 20000;
const WORKER_TIMEOUT_MS = 30000;
const WORKER_HEAP_MB = 256;

const KINDS = { xlsx: 'xlsx', xlsm: 'xlsx', docx: 'docx', docm: 'docx', pdf: 'pdf' };
const kindFor = (name) => KINDS[path.extname(String(name || '')).toLowerCase().slice(1)] || null;

/* An output that stops at MAX_OUT as it is built, so nothing larger is ever held (review 1: a 2 KB workbook repeating
   one shared string in many cells otherwise built gigabytes before a cap after the fact, and ran the heap out). */
function sink(limit) {
  const cap = limit == null ? MAX_OUT : Math.max(0, limit);
  const parts = [];
  let len = 0;
  let full = false;
  return {
    add(s) {
      if (full) return false;
      s = String(s);
      if (len + s.length > cap) {
        let cut = cap - len;
        if (cut > 0 && /[\ud800-\udbff]/.test(s[cut - 1])) cut -= 1;   // never half a surrogate pair
        parts.push(s.slice(0, Math.max(0, cut)));
        len = cap;
        full = true;
        return false;
      }
      parts.push(s);
      len += s.length;
      return true;
    },
    get full() { return full; },
    get length() { return len; },
    text() { return parts.join(''); },
  };
}

/* One table cell: capped, pipes escaped and line breaks folded, so the table stays a table. */
const cellText = (v) => String(v == null ? '' : v).slice(0, MAX_CELL).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

/* A table written row by row into the sink. */
function tableInto(out, rows) {
  if (!rows.length) return out.add('(no cells with values)\n');
  const width = Math.min(MAX_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0));
  const line = (r) => {
    const cells = [];
    for (let i = 0; i < width; i += 1) cells.push(cellText(r[i]));
    return '| ' + cells.join(' | ') + ' |\n';
  };
  if (!out.add(line(rows[0]))) return false;
  if (!out.add('|' + ' --- |'.repeat(width) + '\n')) return false;
  for (let i = 1; i < rows.length; i += 1) if (!out.add(line(rows[i]))) return false;
  return true;
}

/* A zip part, or null; the reader's own wording replaces orgchartfile's spreadsheet-worded errors (review 1). */
function partOf(get, name, what) {
  try { return get(name); } catch (e) {
    const m = String((e && e.message) || '');
    throw new Error(/too large|expands/.test(m) ? 'a part of this ' + what + ' is larger than Kosmos will convert' : 'this ' + what + ' is damaged');
  }
}
function zipOf(buf, what) {
  try { return oc.unzip(buf); } catch { throw new Error('this ' + what + ' is damaged or is not a ' + what); }
}

/* ── xlsx ──────────────────────────────────────────────────────────────────────────────────── */

function sheetRows(sheet, shared) {
  const rows = [];
  let truncated = false;
  for (const rowText of oc.blocks(sheet, 'row')) {
    const row = [];
    let next = 0;
    for (const cell of oc.cells(rowText)) {
      const tag = '<c' + cell.attrs + '>';
      const at = oc.colIndex(oc.attr(tag, 'r'));
      const i = at == null ? next : at;
      if (i >= MAX_COLS) break;
      const type = oc.attr(tag, 't');
      let v = '';
      if (type === 'inlineStr') v = oc.xmlText((oc.innerOf(cell.inner, 'is') || '').slice(0, MAX_CELL * 4));
      else {
        const raw = oc.innerOf(cell.inner, 'v');
        if (raw != null) v = type === 's' ? (shared[Number(raw)] || '') : oc.xmlText(raw.slice(0, MAX_CELL));
      }
      row[i] = v.slice(0, MAX_CELL);
      next = i + 1;
    }
    const dense = Array.from(row, (x) => x || '');
    if (!dense.some((v) => v !== '')) continue;
    if (rows.length >= MAX_SHEET_ROWS) { truncated = true; break; }
    rows.push(dense);
  }
  return { rows, truncated };
}

function xlsxText(buf) {
  const get = zipOf(buf, 'workbook');
  const wb = partOf(get, 'xl/workbook.xml', 'workbook');
  if (!wb) throw new Error('it is not an Excel workbook');
  const rels = partOf(get, 'xl/_rels/workbook.xml.rels', 'workbook') || '';
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^<>]*>/g)) targets.set(oc.attr(m[0], 'Id'), oc.attr(m[0], 'Target'));
  const shared = [];
  const sst = partOf(get, 'xl/sharedStrings.xml', 'workbook');
  if (sst) for (const si of oc.blocks(sst, 'si')) shared.push(oc.xmlText(oc.stripBlocks(si, 'rPh').replace(/<\/t>\s*<t[^<>]*>/g, '')).slice(0, MAX_CELL));
  const out = sink();
  const notes = new Set();
  let formulas = false;
  let first = true;
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^<>]*>/g)) {
    if (out.full) break;
    const name = oc.xmlText(oc.attr(m[0], 'name') || 'Sheet');
    const rid = oc.attr(m[0], 'r:id') || oc.attr(m[0], 'id');
    const target = targets.get(rid);
    if (!target) continue;
    const part = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    out.add((first ? '' : '\n') + '## Sheet: ' + name + '\n\n');
    first = false;
    let sheet = null;
    try { sheet = get(part); } catch { sheet = null; }   // one unreadable sheet does not lose the others (review 1)
    if (!sheet) { out.add('(this sheet could not be read)\n'); continue; }
    if (/<(?:\w+:)?f[\s>]/.test(sheet)) formulas = true;
    const { rows, truncated } = sheetRows(sheet, shared);
    tableInto(out, rows);
    if (truncated) out.add('\n(only the first ' + MAX_SHEET_ROWS + ' rows with values are shown)\n');
  }
  if (formulas) notes.add('Formulas are shown as the values they had when the file was last saved.');
  if (hasPart(buf, /^xl\/(charts|drawings|media)\//)) notes.add('Charts, pictures and drawings are not converted.');
  return { body: out.text().trim(), notes: [...notes], full: out.full };
}

/* Whether the zip has a part whose name matches, from its central directory (names only, nothing inflated). */
function hasPart(buf, re) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return false;
  const n = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && at + 46 <= buf.length; k += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) return false;
    const nameLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    if (re.test(name)) return true;
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return false;
}

/* ── docx ──────────────────────────────────────────────────────────────────────────────────── */

/* A forward-only finder for the next real `<tag` (not `<tagX`) and the next `</tag>` in `text`. Each position is
   searched again only once `at` has moved past it, so a whole walk is linear (review 1: searching both from `at` on
   every block was quadratic when one tag stopped appearing). */
function finder(text, tag) {
  const open = '<' + tag;
  const close = '</' + tag + '>';
  let o = -2;
  let c = -2;
  const isTag = (i) => /[\s>/]/.test(text[i + open.length] || '');
  return {
    open(at) {
      if (o !== -1 && o < at) {
        o = text.indexOf(open, at);
        while (o >= 0 && !isTag(o)) o = text.indexOf(open, o + 1);
      }
      return o;
    },
    close(at) {
      if (c !== -1 && c < at) c = text.indexOf(close, at);
      return c;
    },
    closeLen: close.length,
  };
}

/* The end (just past its closer) of the `tag` element opened at `start`, nesting counted; -1 when it never closes. */
function endOf(text, start, f) {
  const gt = text.indexOf('>', start);
  if (gt < 0) return -1;
  if (text[gt - 1] === '/') return gt + 1;
  let depth = 1;
  let at = gt + 1;
  for (;;) {
    const o = f.open(at);
    const c = f.close(at);
    if (c < 0) return -1;
    if (o >= 0 && o < c) {
      const g = text.indexOf('>', o);
      if (g < 0) return -1;
      if (text[g - 1] !== '/') depth += 1;
      at = g + 1;
    } else {
      depth -= 1;
      at = c + f.closeLen;
      if (depth === 0) return at;
    }
  }
}

/* The top-level `tag` elements of `text`, in order, each with its nested content. */
function* topLevel(text, tag) {
  const f = finder(text, tag);
  let at = 0;
  for (;;) {
    const o = f.open(at);
    if (o < 0) return;
    const end = endOf(text, o, f);
    if (end < 0) return;
    yield text.slice(o, end);
    at = end;
  }
}

/* The body's top-level paragraphs and tables, in document order, each with its nested content. */
function* bodyBlocks(body) {
  const fp = finder(body, 'w:p');
  const ft = finder(body, 'w:tbl');
  let at = 0;
  for (;;) {
    const p = fp.open(at);
    const t = ft.open(at);
    if (p < 0 && t < 0) return;
    if (t >= 0 && (p < 0 || t < p)) {
      const end = endOf(body, t, ft);
      if (end < 0) return;
      yield { tbl: body.slice(t, end) };
      at = end;
    } else {
      const end = endOf(body, p, fp);
      if (end < 0) return;
      yield { p: body.slice(p, end) };
      at = end;
    }
  }
}

/* The text of a span: its <w:t> runs, with tabs and line breaks where Word put them. */
function runsText(span) {
  const marked = span.replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:(?:br|cr)\b[^<>]*\/>/g, '<w:t>\n</w:t>');
  let s = '';
  for (const t of oc.blocks(marked, 'w:t')) { s += oc.xmlText(t); if (s.length > MAX_OUT) break; }
  return s;
}

function paraText(p) {
  const s = runsText(p);
  const style = /<w:pStyle\b[^<>]*w:val="([^"]*)"/.exec(p);
  const heading = style && /^(?:Heading|Title)(\d?)$/i.exec(style[1]);
  if (heading && s.trim()) return '#'.repeat(Math.min(6, Number(heading[1] || 1))) + ' ' + s.trim();
  if (/<w:numPr\b/.test(p) && s.trim()) return '- ' + s.trim();
  return s;
}

function docxText(buf) {
  const get = zipOf(buf, 'document');
  const doc = partOf(get, 'word/document.xml', 'document');
  if (!doc) throw new Error('it is not a Word document');
  /* mc:AlternateContent carries the same content twice (Choice and Fallback): keep the Choice (review 1). */
  const body = oc.stripBlocks(oc.innerOf(doc, 'w:body') || doc, 'mc:Fallback');
  const out = sink();
  for (const b of bodyBlocks(body)) {
    if (b.tbl != null) {
      const rows = [];
      for (const tr of topLevel(b.tbl.slice(b.tbl.indexOf('>') + 1), 'w:tr')) {
        const row = [];
        for (const tc of topLevel(tr.slice(tr.indexOf('>') + 1), 'w:tc')) row.push(runsText(tc.replace(/<\/w:p>/g, '<w:t> </w:t></w:p>')).replace(/\s+/g, ' ').trim());
        rows.push(row);
      }
      if (!tableInto(out, rows)) break;
    } else if (!out.add(paraText(b.p) + '\n')) break;
  }
  const notes = [];
  if (hasPart(buf, /^word\/media\//)) notes.push('Pictures are not converted.');
  if (hasPart(buf, /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/)) notes.push('Headers, footers, footnotes and comments are not included.');
  return { body: out.text().replace(/\n{3,}/g, '\n\n').trim(), notes, full: out.full };
}

/* ── pdf ───────────────────────────────────────────────────────────────────────────────────── */

/* macOS's own PDFKit, in a subprocess with a timeout. Resolves to the text, or null. A test replaces it. */
const PDFKIT_SCRIPT = [
  "ObjC.import('PDFKit');",
  'function run(argv) {',
  '  var d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));',
  "  if (!d || d.isNil()) return '';",
  "  if (d.isEncrypted && d.isLocked) return '\\u0000locked';",
  '  var out = [];',
  '  for (var i = 0; i < d.pageCount; i++) { var s = d.pageAtIndex(i).string; out.push(s && !s.isNil() ? ObjC.unwrap(s) : \'\'); }',
  "  return out.join('\\n\\f\\n');",
  '}',
].join('\n');
let pdfkit = (file) => new Promise((resolve) => {
  if (process.platform !== 'darwin') { resolve(null); return; }
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', PDFKIT_SCRIPT, file], { timeout: PDFKIT_TIMEOUT_MS, maxBuffer: MAX_OUT * 4 },
    (err, stdout) => resolve(err ? null : String(stdout || '').replace(/\n$/, '').slice(0, MAX_OUT)));
});
function setPdfkit(fn) { pdfkit = fn; }

/* Bounded number patterns (review 1: `\d+\s+\d+` backtracked over a long run of digits, quadratically). */
const REF_SRC = '(?<!\\d)(\\d{1,10})\\s+\\d{1,5}\\s+R\\b';
const ref = (dict, key) => { const m = new RegExp('/' + key + '\\s+(\\d{1,10})\\s+\\d{1,5}\\s+R\\b').exec(dict || ''); return m ? Number(m[1]) : null; };
const refs = (text) => [...String(text || '').matchAll(new RegExp(REF_SRC, 'g'))].map((x) => Number(x[1]));

/* The objects of a PDF: plain ones (found by walking `obj` keywords forward and reading the two numbers before each),
   and those packed into object streams. Streams are kept RAW and inflated only when asked for (review 1: images were
   inflated too, used up the budget, and left the text unread), each charged to one budget, overflow included. */
function pdfObjects(buf) {
  const src = buf.toString('latin1');
  const objs = new Map();
  let at = 0;
  for (;;) {
    const k = src.indexOf('obj', at);
    if (k < 0) break;
    at = k + 3;
    if (/[A-Za-z]/.test(src[k + 3] || '') || /[A-Za-z]/.test(src[k - 1] || '')) continue;   // endobj, a longer word
    let j = k - 1;
    while (j >= 0 && k - j < 32 && /\s/.test(src[j])) j -= 1;
    const genEnd = j + 1;
    while (j >= 0 && genEnd - j <= 6 && /\d/.test(src[j])) j -= 1;
    if (j + 1 === genEnd) continue;
    const numEnd = j;
    while (j >= 0 && numEnd - j < 32 && /\s/.test(src[j])) j -= 1;
    if (j === numEnd) continue;
    const numLast = j + 1;
    while (j >= 0 && numLast - j <= 11 && /\d/.test(src[j])) j -= 1;
    if (j + 1 === numLast || /\d/.test(src[j] || '')) continue;
    const num = Number(src.slice(j + 1, numLast));
    const start = k + 3;
    const end = src.indexOf('endobj', start);
    if (end < 0) break;
    let dict = src.slice(start, end);
    const si = dict.search(/\bstream\r?\n/);
    if (si >= 0) {
      const head = dict.slice(0, si);
      const dataStart = start + si + (dict[si + 6] === '\r' ? 8 : 7);
      const inside = () => { const e = dict.indexOf('endstream', si + 6); return e < 0 ? end : start + e; };
      const lenM = /\/Length\s+(\d{1,10})\b(?!\s+\d{1,5}\s+R)/.exec(head);   // an indirect /Length is found by endstream
      let dataEnd = lenM ? dataStart + Number(lenM[1]) : inside();
      if (dataEnd < dataStart || dataEnd > end) dataEnd = inside();
      dict = head;
      objs.set(num, { dict, raw: [dataStart, dataEnd], flate: /\/FlateDecode/.test(head), other: /\/Filter/.test(head) && !/\/FlateDecode/.test(head) });
    } else objs.set(num, { dict, raw: null });
    at = end + 6;
  }
  let inflated = 0;
  const stream = (num) => {
    const o = objs.get(num);
    if (!o || !o.raw) return null;
    if (o.stream !== undefined) return o.stream;
    o.stream = null;
    if (o.other) return null;   // a filter this reader does not do (images, mostly)
    const data = buf.subarray(o.raw[0], o.raw[1]);
    if (!o.flate) { o.stream = data; return data; }
    if (inflated >= MAX_PDF_INFLATE) return null;
    try {
      o.stream = zlib.inflateSync(data, { maxOutputLength: MAX_PDF_INFLATE - inflated });
      inflated += o.stream.length;
    } catch (e) {
      if (e && e.code === 'ERR_BUFFER_TOO_LARGE') inflated = MAX_PDF_INFLATE;   // the work was done: charge it (review 1)
    }
    return o.stream;
  };
  /* Object streams (PDF 1.5+): the objects a modern writer packs together, fonts and pages among them. */
  for (const [num, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const st = stream(num);
    if (!st) continue;
    const s = st.toString('latin1');
    const n = Math.min(100000, Number((/\/N\s+(\d{1,7})\b/.exec(o.dict) || [])[1] || 0));
    const first = Number((/\/First\s+(\d{1,10})\b/.exec(o.dict) || [])[1] || 0);
    const head = s.slice(0, Math.min(first, s.length)).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n && 2 * k + 1 < head.length; k += 1) {
      const onum = head[2 * k];
      const off = first + head[2 * k + 1];
      const next = 2 * k + 3 < head.length ? first + head[2 * k + 3] : s.length;
      if (!objs.has(onum) && off >= first && next >= off) objs.set(onum, { dict: s.slice(off, next), raw: null });
    }
  }
  return { objs, stream };
}

/* The inner text of the first `<< >>` after /key, nesting counted (a bounded walk). */
function subDict(dict, key) {
  const d = String(dict || '');
  const i = d.search(new RegExp('/' + key + '\\s*<<'));
  if (i < 0) return null;
  const s = d.indexOf('<<', i);
  let depth = 0;
  for (let j = s; j < d.length; j += 1) {
    if (d[j] === '<' && d[j + 1] === '<') { depth += 1; j += 1; } else if (d[j] === '>' && d[j + 1] === '>') { depth -= 1; if (depth === 0) return d.slice(s + 2, j); j += 1; }
  }
  return null;
}

function pagesInOrder(objs) {
  let root = null;
  for (const [, o] of objs) if (/\/Type\s*\/Catalog/.test(o.dict)) { root = o; break; }
  const out = [];
  const seen = new Set();
  const walk = (num, inherited, depth) => {
    if (seen.has(num) || out.length >= MAX_PDF_PAGES || depth > 64) return;   // a crafted page tree cannot run the stack out
    seen.add(num);
    const o = objs.get(num);
    if (!o) return;
    const resources = subDict(o.dict, 'Resources') != null ? o.dict : (ref(o.dict, 'Resources') != null ? (objs.get(ref(o.dict, 'Resources')) || {}).dict : inherited);
    if (/\/Type\s*\/Pages\b/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
      for (const k of refs(kids && kids[1])) walk(k, resources, depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) out.push({ o, resources: resources || '' });
  };
  const top = root ? ref(root.dict, 'Pages') : null;
  if (top != null) walk(top, '', 0);
  if (!out.length) for (const [, o] of objs) if (/\/Type\s*\/Page\b/.test(o.dict) && out.length < MAX_PDF_PAGES) out.push({ o, resources: o.dict });
  return out;
}

/* Each open...close section's inner text, walked with indexOf. Stops at the first opener without a closer. */
function* sections(text, open, close) {
  let at = 0;
  for (;;) {
    const i = text.indexOf(open, at);
    if (i < 0) return;
    const j = text.indexOf(close, i + open.length);
    if (j < 0) return;
    yield text.slice(i + open.length, j);
    at = j + close.length;
  }
}

/* A CMap section's tokens, in one forward pass (review 1: a regex with `\[([^\]]*)\]` rescanned to the section's end for
   every `[` without a `]`): hex strings, and arrays of hex strings. */
function* cmapTokens(sec) {
  let i = 0;
  let arr = null;
  while (i < sec.length) {
    const c = sec[i];
    if (c === '<') {
      const j = sec.indexOf('>', i + 1);
      if (j < 0) return;
      const h = sec.slice(i + 1, j).replace(/\s+/g, '');
      if (arr) { if (arr.length < MAX_ARRAY) arr.push(h); } else yield h;
      i = j + 1;
    } else if (c === '[') { arr = []; i += 1; } else if (c === ']') { if (arr) yield arr; arr = null; i += 1; } else i += 1;
  }
}

function parseCmap(text) {
  const map = new Map();
  let codeLen = 1;
  const utf16 = (h) => { const b = Buffer.from(h.length % 2 ? h + '0' : h, 'hex'); let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; };
  const len = (h) => Math.min(4, Math.max(1, Math.ceil(h.length / 2)));   // a code is 1 to 4 bytes (review 1: uncapped)
  /* The budget counts entries WRITTEN, not the map's size: ranges that overwrite the same codes keep the size flat while
     the work grows without end (iteration 2's measurement: 2,000 full ranges took 3.3 s under a size check). */
  let written = 0;
  const full = () => written >= MAX_CMAP_ENTRIES;
  const set = (k, v) => { map.set(k, v); written += 1; };
  for (const sec of sections(text, 'beginbfchar', 'endbfchar')) {
    const t = [...cmapTokens(sec)];
    for (let i = 0; i + 1 < t.length && !full(); i += 2) {
      if (typeof t[i] !== 'string' || typeof t[i + 1] !== 'string') continue;
      codeLen = Math.max(codeLen, len(t[i]));
      set(parseInt(t[i] || '0', 16), utf16(t[i + 1]));
    }
  }
  for (const sec of sections(text, 'beginbfrange', 'endbfrange')) {
    const t = [...cmapTokens(sec)];
    for (let i = 0; i + 2 < t.length && !full(); i += 3) {
      if (typeof t[i] !== 'string' || typeof t[i + 1] !== 'string') continue;
      const lo = parseInt(t[i] || '0', 16);
      const hi = parseInt(t[i + 1] || '0', 16);
      codeLen = Math.max(codeLen, len(t[i]));
      if (!(hi >= lo) || hi - lo > 65535) continue;
      if (typeof t[i + 2] === 'string') {
        const base = utf16(t[i + 2]);
        if (!base) continue;
        for (let c = lo; c <= hi && !full(); c += 1) set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
      } else {
        const list = t[i + 2];
        for (let c = lo; c <= hi && c - lo < list.length && !full(); c += 1) set(c, utf16(list[c - lo]));
      }
    }
  }
  return { map, codeLen };
}

/* The tokens of a content stream: strings (literal, with escapes and nesting; hex), names, numbers, array brackets,
   operators. Every branch moves `i` forward. */
function* tokens(s) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0') { i += 1; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i += 1; continue; }
    if (c === '(') {
      let depth = 1; let out = ''; i += 1;
      while (i < n && depth > 0) {
        const ch = s[i];
        if (ch === '\\') {
          const nx = s[i + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[nx];
          if (esc != null) { out += esc; i += 2; continue; }
          if (nx != null && nx >= '0' && nx <= '7') { const o = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; out += String.fromCharCode(parseInt(o, 8) & 0xff); i += 1 + o.length; continue; }
          if (nx === '\n' || nx === '\r') { i += nx === '\r' && s[i + 2] === '\n' ? 3 : 2; continue; }
          i += 2; continue;
        }
        if (ch === '(') depth += 1;
        if (ch === ')') { depth -= 1; if (depth === 0) { i += 1; break; } }
        out += ch; i += 1;
      }
      yield { str: out };
      continue;
    }
    if (c === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i);
      if (end < 0) return;
      let h = s.slice(i + 1, end).replace(/\s+/g, '');
      if (h.length % 2) h += '0';
      yield { str: Buffer.from(h, 'hex').toString('latin1') };
      i = end + 1;
      continue;
    }
    if (c === '<' || c === '>') { i += 2; continue; }   // a dictionary's brackets: nothing to read
    if (c === '[' || c === ']') { yield { op: c }; i += 1; continue; }
    if (c === '/') { const m = /^\/[^\s/<>\[\]()%]*/.exec(s.slice(i, i + 128)); yield { name: m[0].slice(1) }; i += Math.max(1, m[0].length); continue; }
    const m = /^[^\s/<>\[\]()%]+/.exec(s.slice(i, i + 64));
    if (!m) { i += 1; continue; }
    const w = m[0];
    i += w.length;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(w)) yield { num: Number(w) }; else yield { op: w };
  }
}

function pageText(content, fonts, out) {
  let font = null;
  let lastY = null;
  let line = '';
  const operands = [];
  let arr = null;   // items of the TJ array being read, kept apart from the operands (review 1: 64+ items lost the array)
  const decode = (raw) => {
    const f = font && fonts.get(font);
    if (!f) return raw.replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, '');
    let s = '';
    for (let i = 0; i + f.codeLen <= raw.length; i += f.codeLen) {
      let code = 0;
      for (let k = 0; k < f.codeLen; k += 1) code = code * 256 + raw.charCodeAt(i + k);
      s += f.map.has(code) ? f.map.get(code) : (f.codeLen === 1 ? raw[i] : '');
    }
    return s;
  };
  const flush = () => { if (line) { const ok = out.add(line.replace(/[ \t]+$/, '') + '\n'); line = ''; return ok; } return true; };
  const space = () => { if (line && !/\s$/.test(line)) line += ' '; };
  const lastNum = () => { for (let i = operands.length - 1; i >= 0; i -= 1) if (operands[i].num != null) return operands[i].num; return null; };
  const lastOf = (k) => { for (let i = operands.length - 1; i >= 0; i -= 1) if (operands[i][k] != null) return operands[i]; return null; };
  for (const t of tokens(content)) {
    if (out.full) return;
    if (t.op === '[') { arr = []; continue; }
    if (t.op === ']') { if (arr) operands.push({ arr }); arr = null; continue; }
    if (t.op == null) {
      if (arr) { if (arr.length < MAX_ARRAY) arr.push(t); continue; }
      operands.push(t);
      if (operands.length > 64) operands.shift();
      continue;
    }
    const op = t.op;
    if (op === 'Tf') { const nm = lastOf('name'); if (nm) font = nm.name; }
    else if (op === 'Tj') { const s = lastOf('str'); if (s) line += decode(s.str); }
    else if (op === "'" || op === '"') { if (!flush()) return; const s = lastOf('str'); if (s) line += decode(s.str); }
    else if (op === 'TJ') {
      const a = lastOf('arr');
      if (a) for (const e of a.arr) { if (e.str != null) line += decode(e.str); else if (e.num != null && e.num < -200) space(); }
    } else if (op === 'Td' || op === 'TD') { const ty = lastNum(); if (ty) { if (!flush()) return; } else space(); }
    else if (op === 'T*') { if (!flush()) return; }
    else if (op === 'Tm') { const y = lastNum(); if (lastY != null && y != null && y !== lastY) { if (!flush()) return; } else space(); lastY = y; }   // review 1: same line, a space
    else if (op === 'ET') space();
    if (line.length > MAX_CELL * 4 && !flush()) return;
    operands.length = 0;
  }
  flush();
}

function pdfTextJs(buf) {
  /* Encryption is declared in the trailer (or a cross-reference stream's dictionary), never in the objects it hides. */
  if (/\/Encrypt\s*(?:\d{1,10}\s+\d{1,5}\s+R|<<)/.test(buf.toString('latin1'))) return { encrypted: true, pages: [] };
  const { objs, stream } = pdfObjects(buf);
  const cmaps = new Map();
  const cmapOf = (fontNum) => {
    if (cmaps.has(fontNum)) return cmaps.get(fontNum);
    cmaps.set(fontNum, null);
    const fo = objs.get(fontNum);
    const tu = fo ? ref(fo.dict, 'ToUnicode') : null;
    const st = tu != null ? stream(tu) : null;
    const c = st ? parseCmap(st.toString('latin1')) : null;
    cmaps.set(fontNum, c);
    return c;
  };
  const pages = [];
  let content = 0;
  let cut = null;
  const total = sink();
  for (const { o, resources } of pagesInOrder(objs)) {
    if (total.full) { cut = 'The rendering stops at ' + MAX_OUT + ' characters.'; break; }
    const fonts = new Map();
    let fontDict = subDict(resources, 'Font');
    if (fontDict == null && ref(resources, 'Font') != null) fontDict = (objs.get(ref(resources, 'Font')) || {}).dict || '';
    for (const fm of String(fontDict || '').matchAll(/\/([^\s/<>\[\]()]{1,64})\s+(\d{1,10})\s+\d{1,5}\s+R\b/g)) { const c = cmapOf(Number(fm[2])); if (c) fonts.set(fm[1], c); }
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(o.dict);
    const nums = contents ? refs(contents[1]) : (ref(o.dict, 'Contents') != null ? [ref(o.dict, 'Contents')] : []);
    const parts = [];
    for (const n of nums) {
      const st = stream(n);
      if (!st) continue;
      content += st.length;   // a stream shared by many pages is charged each time (review 1)
      if (content > MAX_PDF_CONTENT) { cut = 'The PDF has more page content than Kosmos will convert; the rest is not included.'; break; }
      parts.push(st.toString('latin1'));
    }
    const page = sink(MAX_OUT - total.length);   // one budget for the whole document, not one per page (iteration 2)
    pageText(parts.join('\n'), fonts, page);
    const text = page.text().trim();
    pages.push(text);
    total.add(text);
    if (cut) break;
  }
  return { encrypted: false, pages, cut };
}

/* Whether extracted text reads as text: mostly letters, digits, spaces and ordinary punctuation, judged on a sample. */
function readable(pages) {
  const sample = pages.join('').slice(0, 200000);
  const chars = Array.from(sample.replace(/\s+/g, ''));
  if (!chars.length) return false;
  const ok = chars.filter((c) => /[\p{L}\p{N}.,;:!?'"()\-\/%$&@#*+=‐-‟]/u.test(c)).length;
  return ok / chars.length >= 0.8;
}

/* Pages to a rendering, with the notes a reader needs. */
function pdfFinish(pages, notes) {
  const empty = pages.filter((p) => !String(p).trim()).length;
  if (!pages.length || empty === pages.length) notes.push('No text was found in this PDF. It may be scanned pages (pictures of text), which are not converted.');
  else if (empty) notes.push(empty + ' of its ' + pages.length + ' pages had no text (scanned pages or pictures are not converted).');
  notes.push('Pictures are not converted, and the layout of columns and tables may not be kept.');
  const out = sink();
  pages.forEach((p, i) => out.add((i ? '\n\n' : '') + '--- Page ' + (i + 1) + ' ---\n' + String(p).trim()));
  return { body: out.text(), notes, full: out.full };
}

/* The JS reader, then PDFKit (on a Mac) when its text does not read as text. pdfText runs both in the calling thread
   (tests); render runs the JS half in a worker and asks PDFKit from the main thread (pdfAfter). */
async function pdfText(file, buf) {
  return pdfAfter(file, pdfTextJs(buf));
}
async function pdfAfter(file, js) {
  const notes = [];
  if (js.encrypted) return { body: '', notes: ['This PDF is encrypted, so its text could not be read.'] };
  if (js.cut) notes.push(js.cut);
  let pages = js.pages;
  if (!readable(pages)) {
    const viaKit = await pdfkit(file);
    if (viaKit === '\u0000locked') return { body: '', notes: ['This PDF is protected with a password, so its text could not be read.'] };
    if (viaKit && viaKit.replace(/\s+/g, '')) pages = viaKit.split('\n\f\n');
    else if (pages.join('').trim()) notes.push('Some of this PDF’s text may not have converted cleanly (an unusual font encoding).');
  }
  return pdfFinish(pages, notes);
}

/* ── the rendering ─────────────────────────────────────────────────────────────────────────── */

/* The conversion in a worker thread, with a memory and a time limit. Resolves to { body, notes, full } for xlsx and docx,
   { js } for pdf (the main thread may still ask PDFKit), or { failed: sentence }. */
function convertIsolated(file, kind) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let w;
    try {
      w = new Worker(__filename, { workerData: { attachtext: true, file, kind }, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 } });
    } catch { resolve({ failed: 'Kosmos could not start converting this file.' }); return; }
    timer = setTimeout(() => {
      finish({ failed: 'Kosmos stopped converting this file after ' + Math.round(WORKER_TIMEOUT_MS / 1000) + ' seconds; it is too large or too complex to convert here.' });
      w.terminate().catch(() => {});
    }, WORKER_TIMEOUT_MS);
    w.on('message', (m) => finish(m));
    w.on('error', (e) => finish({ failed: e && e.code === 'ERR_WORKER_OUT_OF_MEMORY'
      ? 'Kosmos stopped converting this file: it needed more memory than a conversion may use.'
      : 'Kosmos could not read this file as ' + kind + ' (' + String((e && e.message) || 'it is damaged') + ').' }));
    w.on('exit', () => finish({ failed: 'Kosmos stopped converting this file before it finished.' }));
  });
}

if (!isMainThread && workerData && workerData.attachtext) {
  let m;
  try {
    const buf = fs.readFileSync(workerData.file);
    m = workerData.kind === 'xlsx' ? xlsxText(buf) : workerData.kind === 'docx' ? docxText(buf) : { js: pdfTextJs(buf) };
  } catch (e) {
    m = { failed: 'Kosmos could not read this file as ' + workerData.kind + ' (' + String((e && e.message) || 'it is damaged') + ').' };
  }
  parentPort.postMessage(m);
}

/**
 * Write the text rendering of a stored attachment beside it, if it is an office file. Resolves to the text file's
 * path, or null (not an office file, or the rendering could not be written). A file that could not be converted still
 * gets a rendering that says why, so the agent is told rather than left guessing.
 */
async function render(rec) {
  const kind = rec && kindFor(rec.name);
  if (!kind) return null;
  let got = await convertIsolated(rec.file, kind);
  if (got && got.js) got = await pdfAfter(rec.file, got.js);
  if (!got || got.failed) got = { body: '', notes: [(got && got.failed) || 'Kosmos could not convert this file.'] };
  const notes = (got.notes || []).slice();
  if (got.full) notes.push('The rendering stops at ' + MAX_OUT + ' characters.');
  const head = 'Text rendering of ' + rec.name + ', made by Kosmos from the attached file (#6098).'
    + (notes.length ? '\n' + notes.map((n) => 'Note: ' + n).join('\n') : '');
  const out = path.join(rec.dir, TEXT_NAME);
  try { fs.writeFileSync(out, head + '\n\n' + (got.body || '') + '\n'); } catch { return null; }
  return out;
}

module.exports = { TEXT_NAME, kindFor, render, xlsxText, docxText, pdfTextJs, pdfText, parseCmap, setPdfkit, readable, MAX_SHEET_ROWS, MAX_OUT, WORKER_TIMEOUT_MS };
