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
 *         fonts with a ToUnicode map). Where its text does not read as text, or a font uses its own encoding or has no character map, a Mac asks macOS's own PDFKit, which knows
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
const MAX_SHEETS = 256;
const MAX_PDF_INFLATE = 64 * 1024 * 1024;  // decompressed bytes a PDF may cost, charged even for a stream that overflows
const MAX_PDF_CONTENT = 32 * 1024 * 1024;  // content-stream bytes a PDF may have tokenised, shared streams counted each time
const MAX_PDF_PAGES = 2000;
const MAX_CMAP_ENTRIES = 200000;           // ToUnicode entries per font
const MAX_ARRAY = 4096;                    // items kept from one TJ array
const PDFKIT_TIMEOUT_MS = 20000;
let WORKER_TIMEOUT_MS = 30000;
let WORKER_HEAP_MB = 256;
const MAX_WORKERS = 2;   // conversions at once (iteration 2: a burst of hostile uploads ran all in parallel)
/* Test seam: tests shorten the limits to reach the timeout path without waiting 30 s. */
function setWorkerLimits({ timeoutMs, heapMb } = {}) { if (timeoutMs) WORKER_TIMEOUT_MS = timeoutMs; if (heapMb) WORKER_HEAP_MB = heapMb; }

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
/* Iteration 17: SpreadsheetML written with a prefix on its main namespace (<x:worksheet>, <x:row>, <x:c>, as some .NET
   and Java writers do) is read as the plain form: the root's prefix is dropped from every tag, one linear pass. */
function unprefix(xml, root) {
  if (!xml) return xml;
  const m = new RegExp('<([A-Za-z_][\\w.-]{0,30}):' + root + '\\b').exec(xml.slice(0, 4096));
  if (!m) return xml;
  return xml.split('<' + m[1] + ':').join('<').split('</' + m[1] + ':').join('</');
}
/* Iteration 11: a big part (a sheet of 100,000 rows, a long document) gives its first MAX_PART_BYTES rather than
   nothing; `cut` says it was cut. A damaged part still throws, worded as damaged. */
function prefixPart(get, name, what) {
  try { return get(name, { prefix: true }) || { text: null, cut: false }; } catch { throw new Error('this ' + what + ' is damaged'); }
}
function zipOf(buf, what) {
  try { return oc.unzip(buf); } catch { throw new Error('this ' + what + ' is damaged or is not a ' + what); }
}

/* ── xlsx ──────────────────────────────────────────────────────────────────────────────────── */

function sheetRows(sheet, shared, clip) {
  const rows = [];
  let truncated = false;
  for (const rowText of oc.blocks(sheet, 'row')) {
    const row = [];
    let next = 0;
    for (const cell of oc.cells(rowText)) {
      const tag = '<c' + cell.attrs + '>';
      const at = oc.colIndex(oc.attr(tag, 'r'));
      const i = at == null ? next : at;
      if (i >= MAX_COLS) { clip.cols = true; break; }
      const type = oc.attr(tag, 't');
      let v = '';
      if (type === 'inlineStr') v = oc.xmlText((oc.innerOf(cell.inner, 'is') || '').slice(0, MAX_CELL * 4));
      else {
        const raw = oc.innerOf(cell.inner, 'v');
        if (raw != null && raw !== '') v = type === 's' ? (shared[Number(raw)] || '') : oc.xmlText(raw.slice(0, MAX_CELL));
        else if (type !== 'str' && /<(?:\w+:)?f[\s>/]/.test(cell.inner)) {   // iteration 16: t="str" with an empty value is a formula that returned "" (Excel's IF(..,""))
          /* Iteration 15: a formula with no saved result (openpyxl writes <v/>) shows as the formula, so a blank is
             never passed off as the value; a shared formula's follower has no text of its own and shows as "=". */
          v = '=' + oc.xmlText((oc.innerOf(cell.inner, 'f') || '').slice(0, MAX_CELL));
          clip.uncalc = true;
        }
      }
      if (v.length > MAX_CELL) clip.cell = true;
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
  const sstPart = prefixPart(get, 'xl/sharedStrings.xml', 'workbook');
  const sst = unprefix(sstPart.text, 'sst');
  if (sst) for (const si of oc.blocks(sst, 'si')) shared.push(oc.xmlText(oc.stripBlocks(si, 'rPh').replace(/<\/t>\s*<t[^<>]*>/g, '')).slice(0, MAX_CELL));
  const out = sink();
  const notes = new Set();
  if (sstPart.cut) notes.add('This workbook\u2019s text is larger than Kosmos reads, so some text cells are shown empty.');
  let formulas = false;
  let first = true;
  const seen = new Set();
  const clip = { cols: false, cell: false, uncalc: false };
  let sheets = 0;
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^<>]*>/g)) {
    if (out.full) break;
    sheets += 1;
    if (sheets > MAX_SHEETS) { notes.add('Only the first ' + MAX_SHEETS + ' sheets are converted.'); break; }
    const name = oc.xmlText(oc.attr(m[0], 'name') || 'Sheet');
    const rid = oc.attr(m[0], 'r:id') || oc.attr(m[0], 'id');
    const target = targets.get(rid);
    if (!target) continue;
    const part = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    out.add((first ? '' : '\n') + '## Sheet: ' + name + '\n\n');
    first = false;
    if (seen.has(part)) { out.add('(the same sheet as one above)\n'); continue; }   // iteration 2: one part listed many times is read once
    seen.add(part);
    let sheet = null;
    let big = false;
    try { const got = get(part, { prefix: true }); sheet = unprefix(got && got.text, 'worksheet'); big = !!(got && got.cut); } catch { sheet = null; }   // one unreadable sheet does not lose the others (review 1)
    if (!sheet) { out.add('(this sheet could not be read)\n'); continue; }
    if (big) notes.add('A sheet is larger than Kosmos reads, so only its first rows are shown.');   // iteration 11: its first rows, not nothing
    if (/<(?:\w+:)?f[\s>]/.test(sheet)) formulas = true;
    const { rows, truncated } = sheetRows(sheet, shared, clip);
    tableInto(out, rows);
    if (truncated) out.add('\n(only the first ' + MAX_SHEET_ROWS + ' rows with values are shown)\n');
  }
  /* Iteration 15: a writer that never calculates (openpyxl leaves results empty, xlsxwriter stores 0) marks the workbook
     for calculation on open; then the saved values are not results, and the note says so instead. */
  if (clip.uncalc || /<(?:\w+:)?calcPr\b[^<>]*fullCalcOnLoad="(?:1|true)"/.test(wb)) {
    if (formulas) notes.add('Some formulas were never calculated by the program that made this file, so they show as formulas (or as 0), not as results.');
  } else if (formulas) notes.add('Formulas are shown as the values they had when the file was last saved.');
  if (clip.cols) notes.add('Only the first ' + MAX_COLS + ' columns of a sheet are converted.');
  if (clip.cell) notes.add('A cell longer than ' + MAX_CELL + ' characters is cut short.');
  let styles = null;
  try { styles = get('xl/styles.xml'); } catch { styles = null; }
  const dateFormat = () => {
    for (const m of styles.matchAll(/formatCode="([^"<>]*)"/g)) {
      const code = m[1].replace(/\[[^\]]*\]/g, '').replace(/&quot;[^&]*&quot;/g, '');   // iteration 4: [Red] is not a date
      if (/[dy]/i.test(code)) return true;
    }
    return false;
  };   // iteration 3: one match then a test, not a backtracking pattern
  if (styles && (/numFmtId="(?:1[4-9]|2[0-2]|4[5-7])"/.test(styles) || dateFormat())) notes.add('Dates may appear as Excel day numbers (for example 45123), not as dates.');
  /* Iteration 11: a percentage shows as the fraction stored (100% as 1) and currency without its symbol. */
  const numberFormat = () => {
    for (const m of styles.matchAll(/formatCode="([^"<>]*)"/g)) {
      // iteration 12: [$-409] is a locale tag (common on dates), not a currency; [$€-407] is one
      const code = m[1].replace(/&quot;([^&]*)&quot;/g, '$1').replace(/\[\$-[^\]]*\]/g, '');   // iteration 13: any [$-...] has no symbol ([$-x-sysdate] too)
      if (/[%$\u00a3\u20ac\u00a5]/.test(code)) return true;
    }
    return false;
  };
  if (styles && (/<xf\b[^<>]*numFmtId="(?:9|10|[5-8]|4[1-4])"/.test(styles) || numberFormat())) notes.add('Numbers are shown as stored, without their formats: a percentage shows as a fraction (100% as 1) and currency has no symbol.');
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
function* bodyBlocks(body, state) {
  const fp = finder(body, 'w:p');
  const ft = finder(body, 'w:tbl');
  let at = 0;
  for (;;) {
    const p = fp.open(at);
    const t = ft.open(at);
    if (p < 0 && t < 0) return;
    if (t >= 0 && (p < 0 || t < p)) {
      const end = endOf(body, t, ft);
      if (end < 0) { if (state) state.broken = true; return; }
      yield { tbl: body.slice(t, end) };
      at = end;
    } else {
      const end = endOf(body, p, fp);
      if (end < 0) { if (state) state.broken = true; return; }
      yield { p: body.slice(p, end) };
      at = end;
    }
  }
}

/* The text of a span: its <w:t> runs, with tabs and line breaks where Word put them. */
function runsText(span) {
  const marked = span.replace(/<w:(?:tab|ptab)\b[^<>]*\/>/g, '<w:t>\t</w:t>').replace(/<w:(?:br|cr)\b[^<>]*\/>/g, '<w:t>\n</w:t>')
    .replace(/<w:noBreakHyphen\b[^<>]*\/>/g, '<w:t>-</w:t>');   // iteration 17: "2026-10-13" kept; a soft hyphen is nothing
  let s = '';
  for (const t of oc.blocks(marked, 'w:t')) { s += oc.xmlText(t); if (s.length > MAX_OUT) break; }
  return s;
}

function paraText(p) {
  const s = runsText(p.replace(/<\/w:p>(?!$)/g, '<w:t>\u2063</w:t></w:p>')).replace(/ *\u2063+ */g, ' ');   // text-box paragraphs keep a space between them; typed spacing is kept
  const style = /<w:pStyle\b[^<>]*w:val="([^"]*)"/.exec(p);
  const heading = style && /^(?:Heading|Title)(\d?)$/i.exec(style[1]);
  if (heading && s.trim()) return '#'.repeat(Math.min(6, Number(heading[1] || 1))) + ' ' + s.trim();
  const num = /<w:numId\b[^<>]*w:val="(\d+)"/.exec(p);
  if (num && num[1] !== '0' && s.trim()) return '- ' + s.trim();   // numId 0 is the no-list marker
  return s;
}

/* Every <tag>...</tag> span removed, nesting counted (iteration 15: a Fallback holding its own AlternateContent left the
   outer one's tail behind, read twice), self-closed ones alone; an unclosed one takes the rest. Linear (finder). */
function stripNested(text, tag) {
  const f = finder(text, tag);
  let out = '';
  let at = 0;
  for (;;) {
    const i = f.open(at);
    if (i < 0) return out + text.slice(at);
    const e = endOf(text, i, f);
    if (e < 0) return out + text.slice(at, i);
    out += text.slice(at, i);
    at = e;
  }
}

/* Iteration 12: a document cut at the part limit ends mid-way, often inside a table, and an unclosed table reads as
   nothing. Kept up to the last whole paragraph or row, then the tables, rows and cells still open there are closed, so
   what came before the cut is converted. One pass over the tags. */
function closeCut(text) {
  const end = Math.max(text.lastIndexOf('</w:p>'), text.lastIndexOf('</w:tr>'));
  if (end < 0) return text;
  const kept = text.slice(0, text.indexOf('>', end) + 1);
  const open = [];
  for (const m of kept.matchAll(/<(\/?)w:(tbl|tr|tc)\b[^<>]*?(\/?)>/g)) {
    if (m[3]) continue;   // self-closed
    if (m[1]) { if (open.length && open[open.length - 1] === m[2]) open.pop(); } else open.push(m[2]);
  }
  let close = '';
  while (open.length) {
    const t = open.pop();
    close += t === 'tc' ? '<w:p></w:p></w:tc>' : '</w:' + t + '>';   // a cell must hold a paragraph
  }
  return kept + close;
}

function docxText(buf) {
  const get = zipOf(buf, 'document');
  const docPart = prefixPart(get, 'word/document.xml', 'document');
  const doc = docPart.cut ? closeCut(stripNested(docPart.text, 'mc:Fallback')) : docPart.text;   // iteration 13: an unclosed Fallback tail first, or its later strip would take the closers too
  if (!doc) throw new Error('it is not a Word document');
  /* mc:AlternateContent carries the same content twice (Choice and Fallback): keep the Choice (review 1). */
  /* Iteration 17: a moved passage is written twice (moveFrom and moveTo): only where it now stands is kept. */
  const body = stripNested(stripNested(oc.innerOf(doc, 'w:body') || doc, 'mc:Fallback'), 'w:moveFrom');
  const out = sink();
  const state = { broken: false };
  for (const b of bodyBlocks(body, state)) {
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
  if (docPart.cut) notes.push('This document is larger than Kosmos reads, so only its first part is converted.');
  else if (state.broken) notes.push('Part of this document is damaged; the text after that point is not included.');
  if (hasPart(buf, /^word\/media\//)) notes.push('Pictures are not converted.');
  if (hasPart(buf, /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/)) notes.push('Headers, footers, footnotes and comments are not included.');
  /* Iteration 17: a redline read as text would pass for a clean document. */
  if (/<w:(?:ins|del|moveTo|moveFrom)\b/.test(doc)) notes.push('This document has tracked changes; the text shows them accepted (deleted text left out, inserted text kept), so what changed cannot be seen here.');
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
      const fm = /\/Filter\s*(\[[^\]]{0,200}\]|\/[A-Za-z0-9]{1,40})/.exec(head);
      const filters = fm ? (fm[1].match(/\/[A-Za-z0-9]+/g) || []).map((f) => f.slice(1)) : [];
      objs.set(num, { dict, raw: [dataStart, dataEnd], filters });
    } else objs.set(num, { dict, raw: null });
    at = end + 6;
  }
  let inflated = 0;
  const undecodable = { n: 0 };
  const stream = (num) => {
    const o = objs.get(num);
    if (!o || !o.raw) return null;
    if (o.stream !== undefined) return o.stream;
    o.stream = null;
    let data = buf.subarray(o.raw[0], o.raw[1]);
    /* The filters in order (iteration 3: reportlab writes [ /ASCII85Decode /FlateDecode ]). Any other filter (images,
       mostly, or LZW) is not read; undecodable counts so the reader can say so instead of "scanned". */
    for (const f of o.filters) {
      if (f === 'ASCII85Decode' || f === 'A85') { data = a85(data, MAX_PDF_INFLATE - inflated); inflated += data.length; }   // charged like inflation
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = ahx(data);
      else if (f === 'FlateDecode' || f === 'Fl') {
        if (inflated >= MAX_PDF_INFLATE) return null;
        try {
          data = zlib.inflateSync(data, { maxOutputLength: MAX_PDF_INFLATE - inflated, finishFlush: zlib.constants.Z_SYNC_FLUSH });   // a truncated tail keeps what came before it
          inflated += data.length;
        } catch (e) {
          if (e && e.code === 'ERR_BUFFER_TOO_LARGE') inflated = MAX_PDF_INFLATE;   // the work was done: charge it (review 1)
          undecodable.n += 1;
          return null;
        }
      } else { undecodable.n += 1; return null; }
      if (!data) { undecodable.n += 1; return null; }
    }
    o.stream = data;
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
    /* Offsets must rise (iteration 2: an object spanning the whole stream, repeated, cost the page walk 5 ms each); each
       object ends where the next begins, and the text kept is charged to the same budget as inflation. */
    let prev = -1;
    for (let k = 0; k < n && 2 * k + 1 < head.length; k += 1) {
      const onum = head[2 * k];
      const off = first + head[2 * k + 1];
      if (!(off > prev) || off > s.length) break;
      prev = off;
      const nx = 2 * k + 3 < head.length ? first + head[2 * k + 3] : s.length;
      const next = Math.min(s.length, nx > off ? nx : s.length);
      inflated += next - off;
      if (inflated > MAX_PDF_INFLATE) break;
      if (!objs.has(onum)) objs.set(onum, { dict: s.slice(off, next), raw: null });
    }
  }
  return { objs, stream, undecodable };
}

/* ASCII85 and ASCIIHex, each one forward pass. */
function a85(buf, room) {
  const s = buf.toString('latin1');
  const cap = Math.max(0, Math.min(room == null ? MAX_PDF_INFLATE : room, Math.ceil(s.length * 4)));
  const outBuf = Buffer.alloc(cap);   // iteration 4: written into a bounded buffer, not an unbounded JS array
  let len = 0;
  const out = { push: (...b) => { for (const x of b) { if (len >= cap) return; outBuf[len] = x; len += 1; } } };
  let group = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '~') break;
    if (c === 'z' && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const v = c.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;   // whitespace and stray bytes
    group.push(v);
    if (group.length === 5) {
      let n = 0;
      for (const g of group) n = n * 85 + g;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    let n = 0;
    for (const g of group) n = n * 85 + g;
    const b = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...b.slice(0, k - 1));
  }
  return outBuf.subarray(0, len);
}
function ahx(buf) {
  let h = buf.toString('latin1');
  const end = h.indexOf('>');
  if (end >= 0) h = h.slice(0, end);
  h = h.replace(/[^0-9a-fA-F]/g, '');
  if (h.length % 2) h += '0';
  return Buffer.from(h, 'hex');
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
  out.capped = out.length >= MAX_PDF_PAGES;
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
    if (w === 'ID') {
      /* Iteration 9: an inline image's bytes (BI ... ID <bytes> EI) are not content: a ( or % in them swallowed the rest
         of the page. Skip to the EI that has white space on both sides, one forward search. */
      let j = i + 1;
      for (;;) {
        j = s.indexOf('EI', j);
        if (j < 0 || (/\s/.test(s[j - 1] || '') && (j + 2 >= n || /\s/.test(s[j + 2])))) break;
        j += 2;
      }
      i = j < 0 ? n : j + 2;
      yield { op: 'EI' };
      continue;
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(w)) yield { num: Number(w) }; else yield { op: w };
  }
}

/* A string in a font with no ToUnicode map, read as WinAnsi (the standard fonts' encoding): 0x80-0x9F are curly quotes,
   dashes, bullets and the euro sign there, not control characters (iteration 3). Other control characters are dropped. */
const WINANSI = { 0x80: '\u20ac', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e', 0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030',
  0x8a: '\u0160', 0x8b: '\u2039', 0x8c: '\u0152', 0x8e: '\u017d', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013',
  0x97: '\u2014', 0x98: '\u02dc', 0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153', 0x9e: '\u017e', 0x9f: '\u0178' };
function winAnsi(raw) {
  let s = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    if (c >= 0x80 && c <= 0x9f) s += WINANSI[c] || '';
    else if (c < 0x20 && c !== 0x09) s += '';
    else s += raw[i];
  }
  return s;
}

function pageText(content, fonts, out, used = {}) {
  let font = null;
  let line = '';
  /* Iteration 7: where the text is, so a sideways move adds a space only where there is a gap. Writers that place text a
     glyph or a kerned chunk at a time (Chrome, Ghostscript) made every move a space ("C op yright"). size, tc, tw, th and
     tl are the text state; a and d the text matrix's scales; lx and ly the line's origin in user space (Td moves from
     it). Iteration 9: pen is where the drawn text ends, in user space, and it is kept across BT and ET, so a new text
     block on the same line (Chrome writes one per style change; FPDF one per table cell, placed by Td) is a gap only
     where there is room, and a line ends only where y really changes (y in the text's own space: a cm
     between blocks is not followed, see the plan's Not done). exact is false once a glyph since the last move
     had no known width. */
  let size = 1;
  let tc = 0;
  let tw = 0;
  let th = 1;
  let tl = 0;
  let a = 1;
  let d = 1;
  let lx = 0;
  let ly = 0;
  let pen = null;
  let exact = true;
  const measure = (f, raw) => {
    if (!pen) pen = { x: lx, y: ly };
    const len = (f && f.codeLen) || 1;
    for (let i = 0; i + len <= raw.length; i += len) {
      let code = 0;
      for (let k = 0; k < len; k += 1) code = code * 256 + raw.charCodeAt(i + k);
      let w = f && f.width ? f.width(code) : null;
      if (w == null) { w = 500; exact = false; }
      pen.x += ((w / 1000) * size + tc + (len === 1 && code === 32 ? tw : 0)) * th * a;
    }
  };
  /* A new origin for the text. Another y (by more than 0.4 of the font's height) ends the line; on the same line a space
     only where the move leaves (or goes back over) real room. Iteration 8: with a glyph of unknown width since the last
     move (a standard font with no /Widths, mostly) the gap cannot be measured, and an estimate is off by as much as a
     word gap, so every move is a space there, as before iteration 7. */
  const place = (nx, ny) => {
    if (pen && line) {
      if (Math.abs(ny - pen.y) > 0.4 * (Math.abs(size * d) || 1)) { if (!flush()) return false; }
      else if (!exact || Math.abs((nx - pen.x) / (a || 1)) > 0.12 * (Math.abs(size) || 1)) space();
    }
    lx = nx;
    ly = ny;
    pen = { x: nx, y: ny };
    exact = true;
    return true;
  };
  const newline = () => { if (!flush()) return false; ly -= tl * d; pen = { x: lx, y: ly }; exact = true; return true; };
  const operands = [];
  let arr = null;   // items of the TJ array being read, kept apart from the operands (review 1: 64+ items lost the array)
  const decode = (raw) => {
    const f = font && fonts.get(font);
    measure(f, raw);
    if (!f || (!f.cmap && !f.flag)) return winAnsi(raw);
    /* iteration 6: a font is judged when the page draws with it, not when it is merely listed in shared resources. */
    if (f.flag === 'noMap') { used.noMap = true; return ''; }   // glyph numbers, not characters: only this font's text is lost
    if (f.flag === 'ownEncoding') { used.ownEncoding = true; return winAnsi(raw); }
    const c = f.cmap;
    let s = '';
    for (let i = 0; i + c.codeLen <= raw.length; i += c.codeLen) {
      let code = 0;
      for (let k = 0; k < c.codeLen; k += 1) code = code * 256 + raw.charCodeAt(i + k);
      s += c.map.has(code) ? c.map.get(code) : (c.codeLen === 1 ? raw[i] : '');
    }
    /* Iteration 9: macOS maps some CJK glyphs to the look-alike Kangxi radicals (U+2F00-U+2FDF), which a search for the
       real character never finds; NFKC gives the character itself. Iteration 10: the same for Arabic and Hebrew
       presentation forms (U+FB1D-U+FDFF, U+FE70-U+FEFF), which a search for the ordinary letters never matches.
       Iteration 11: and the Latin ligatures (U+FB00-U+FB06: "Proﬁles" is found as "Profiles"). */
    return /[\u2F00-\u2FDF\uFB00-\uFB06\uFB1D-\uFDFF\uFE70-\uFEFE]/.test(s) ? s.replace(/[\u2F00-\u2FDF\uFB00-\uFB06\uFB1D-\uFDFF\uFE70-\uFEFE]/g, (ch) => ch.normalize('NFKC')) : s;
  };
  /* Trailing blanks stripped by a backwards loop (iteration 2: `/[ \t]+$/` is quadratic on a long run of spaces). */
  const trimEnd = (x) => { let e = x.length; while (e && (x[e - 1] === ' ' || x[e - 1] === '\t')) e -= 1; return x.slice(0, e); };
  const flush = () => { if (line) { const ok = out.add(trimEnd(line) + '\n'); line = ''; return ok; } return true; };
  const append = (x) => { line += x.length > MAX_CELL * 4 ? x.slice(0, MAX_CELL * 4) : x; if (line.length > MAX_CELL * 4) return flush(); return true; };
  const space = () => { if (line && !/\s$/.test(line)) line += ' '; };
  const lastNum = () => { for (let i = operands.length - 1; i >= 0; i -= 1) if (operands[i].num != null) return operands[i].num; return null; };
  const nums = (n) => { const r = []; for (let i = operands.length - 1; i >= 0 && r.length < n; i -= 1) if (operands[i].num != null) r.unshift(operands[i].num); return r.length === n ? r : null; };
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
    if (op === 'Tf') { const nm = lastOf('name'); if (nm) font = nm.name; const z = lastNum(); if (z != null) size = z; }
    else if (op === 'Tc') { const v = lastNum(); if (v != null) tc = v; }
    else if (op === 'Tw') { const v = lastNum(); if (v != null) tw = v; }
    else if (op === 'Tz') { const v = lastNum(); if (v != null) th = v / 100; }
    else if (op === 'TL') { const v = lastNum(); if (v != null) tl = v; }
    else if (op === 'BT') { a = 1; d = 1; lx = 0; ly = 0; }   // the text matrix starts again; the pen stays where it is
    else if (op === 'Tj') { const s = lastOf('str'); if (s && !append(decode(s.str))) return; }
    else if (op === "'" || op === '"') {
      if (op === '"') { const v = nums(2); if (v) { tw = v[0]; tc = v[1]; } }   // aw ac string " sets the word and character spacing
      if (!newline()) return;
      const s = lastOf('str'); if (s && !append(decode(s.str))) return; }
    else if (op === 'TJ') {
      const ta = lastOf('arr');
      if (ta) for (const e of ta.arr) {
        if (e.str != null) { if (!append(decode(e.str))) return; } else if (e.num != null) { if (pen) pen.x -= (e.num / 1000) * size * th * a; if (e.num < -200) space(); }
      }
    } else if (op === 'Td' || op === 'TD') {
      const v = nums(2);
      if (v) { if (op === 'TD') tl = -v[1]; if (!place(lx + v[0] * a, ly + v[1] * d)) return; } else space();
    } else if (op === 'T*') { if (!newline()) return; }
    else if (op === 'Tm') {   // review 1: same line, a space (iteration 7: only where there is room)
      const v = nums(6);
      if (v) { a = v[0] || 1; d = v[3] || 1; if (!place(v[4], v[5])) return; } else space();
    }
    if (line.length > MAX_CELL * 4 && !flush()) return;
    operands.length = 0;
  }
  flush();
}

function pdfTextJs(buf) {
  /* Encryption is declared in the trailer (or a cross-reference stream's dictionary), never in the objects it hides. */
  if (/\/Encrypt\s*(?:\d{1,10}\s+\d{1,5}\s+R|<<)/.test(buf.toString('latin1'))) return { encrypted: true, pages: [] };
  const { objs, stream, undecodable } = pdfObjects(buf);
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
  /* The [...] after /key, written inline or one reference away; brackets counted, at most 1 MB read. */
  const arrayOf = (dict, key) => {
    const m = new RegExp('/' + key + '\\s*(?:(\\[)|(\\d{1,10})\\s+\\d{1,5}\\s+R)').exec(dict || '');
    if (!m) return null;
    const src = m[1] ? dict : ((objs.get(Number(m[2])) || {}).dict || '');
    const start = m[1] ? m.index + m[0].length - 1 : src.indexOf('[');
    if (start < 0) return null;
    let depth = 0;
    const stop = Math.min(src.length, start + 1024 * 1024);
    for (let i = start; i < stop; i += 1) {
      if (src[i] === '[') depth += 1;
      else if (src[i] === ']') { depth -= 1; if (depth === 0) return src.slice(start + 1, i); }
    }
    return null;
  };
  const numAt = (dict, key) => { const m = new RegExp('/' + key + '\\s+(-?\\d{1,9}(?:\\.\\d{1,9})?)').exec(dict || ''); return m ? Number(m[1]) : null; };
  /* Glyph widths (iteration 7), so a move can be told from a word gap. A simple font's /FirstChar and /Widths; a Type0
     font's descendant /W and /DW. At most 65536 widths a font, and 262144 in the document (iteration 8: a budget per font
     alone let 200 fonts of `[0 65535 500]` fill the worker's memory); a width the budget left out is unknown, not /DW. A Type3 font (Chrome writes these) gives its widths in its own
     glyph units, which its /FontMatrix turns into text space: they are scaled to thousandths like the others. */
  const wBudget = { n: 262144 };
  const widthsOf = (fd, type0) => {
    if (!type0) {
      const w = arrayOf(fd, 'Widths');
      const first = numAt(fd, 'FirstChar');
      if (w == null || first == null) return null;
      let scale = 1;
      if (/\/Subtype\s*\/Type3/.test(fd)) {
        const m = (arrayOf(fd, 'FontMatrix') || '').match(/-?\d*\.?\d+(?:[eE]-?\d+)?/);
        scale = m && Number(m[0]) ? Number(m[0]) * 1000 : 1;
      }
      const list = (w.match(/-?\d*\.?\d+/g) || []).slice(0, 256).map((v) => Number(v) * scale);
      return (code) => (code >= first && code < first + list.length ? list[code - first] : null);
    }
    const desc = arrayOf(fd, 'DescendantFonts');
    const dn = desc ? refs(desc)[0] : null;
    const dd = dn != null ? (objs.get(dn) || {}).dict || '' : (desc || '');   // or written inline
    const dw = numAt(dd, 'DW');
    const map = new Map();
    const w = arrayOf(dd, 'W');
    let short = false;
    if (w) {
      const toks = w.match(/\[|\]|-?\d*\.?\d+/g) || [];
      let budget = Math.min(65536, wBudget.n);
      for (let i = 0; i < toks.length && budget > 0;) {
        const c1 = Number(toks[i]);
        if (toks[i + 1] === '[') {
          let j = i + 2;
          for (let c = c1; j < toks.length && toks[j] !== ']' && budget > 0; j += 1, c += 1, budget -= 1) map.set(c, Number(toks[j]));
          while (j < toks.length && toks[j] !== ']') j += 1;
          i = j + 1;
        } else if (i + 2 < toks.length && toks[i + 1] !== ']' && toks[i + 2] !== '[' && toks[i + 2] !== ']') {
          const c2 = Number(toks[i + 1]);
          const v = Number(toks[i + 2]);
          for (let c = c1; c <= c2 && budget > 0; c += 1, budget -= 1) map.set(c, v);
          i += 3;
        } else i += 1;
      }
      wBudget.n -= map.size;
      short = budget <= 0;
    }
    return (code) => (map.has(code) ? map.get(code) : (short ? null : (dw != null ? dw : 1000)));
  };
  const infos = new Map();
  const fontInfo = (num) => {
    if (infos.has(num)) return infos.get(num);
    const fd = (objs.get(num) || {}).dict || '';
    const type0 = /\/Subtype\s*\/Type0/.test(fd);
    const cmap = cmapOf(num);
    let flag = null;
    if (!cmap) {
      /* iteration 5: a two-byte (Type0 / Identity) font with no ToUnicode has glyph numbers, not characters: what the JS
         reader makes of it is garbage that looks like text. A Mac asks PDFKit; elsewhere that font's text is not kept. */
      if (type0 || /\/Identity-/.test(fd)) flag = 'noMap';
      /* iteration 4: no ToUnicode, and an encoding of its own (MacRoman from a Mac, or /Differences): read as WinAnsi it
         would be wrong without looking wrong, so the text is marked as not to be trusted (a Mac then asks PDFKit).
         Iteration 7: so is a symbolic font (its descriptor's Flags bit 3) with no /Encoding, whose codes are its own. */
      else if (/\/MacRomanEncoding|\/Differences|\/MacExpertEncoding/.test(fd) || (ref(fd, 'Encoding') != null && /\/Differences/.test((objs.get(ref(fd, 'Encoding')) || {}).dict || ''))) flag = 'ownEncoding';
      else if (!/\/Encoding\b/.test(fd) && ((numAt((objs.get(ref(fd, 'FontDescriptor')) || {}).dict, 'Flags') || 0) & 4)) flag = 'ownEncoding';
    }
    /* Iteration 6: the marks count only when a page draws with the font (see decode), so an unused font listed in shared
       resources changes nothing. */
    const info = { cmap, flag, codeLen: cmap ? cmap.codeLen : (flag === 'noMap' ? 2 : 1), width: widthsOf(fd, type0) };
    infos.set(num, info);
    return info;
  };
  const pages = [];
  const mapless = new Set();   // pages that lost text to a font with no character map (not scanned pages)
  let content = 0;
  let cut = null;
  const used = { ownEncoding: false, noMap: false };
  const total = sink();
  const ordered = pagesInOrder(objs);
  if (ordered.capped) cut = 'Only the first ' + MAX_PDF_PAGES + ' pages are converted.';
  for (const { o, resources } of ordered) {
    if (total.full) { cut = (cut ? cut + ' ' : '') + 'The rendering stops at ' + MAX_OUT + ' characters.'; break; }
    const fonts = new Map();
    let fontDict = subDict(resources, 'Font');
    if (fontDict == null && ref(resources, 'Font') != null) fontDict = (objs.get(ref(resources, 'Font')) || {}).dict || '';
    for (const fm of String(fontDict || '').matchAll(/\/([^\s/<>\[\]()]{1,64})\s+(\d{1,10})\s+\d{1,5}\s+R\b/g)) fonts.set(fm[1], fontInfo(Number(fm[2])));
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(o.dict);
    const nums = contents ? refs(contents[1]) : (ref(o.dict, 'Contents') != null ? [ref(o.dict, 'Contents')] : []);
    const parts = [];
    for (const n of nums) {
      const st = stream(n);
      if (!st) continue;
      content += st.length;   // a stream shared by many pages is charged each time (review 1)
      if (content > MAX_PDF_CONTENT) { cut = (cut ? cut + ' ' : '') + 'The PDF has more page content than Kosmos will convert; the rest is not included.'; break; }
      parts.push(st.toString('latin1'));
    }
    const page = sink(MAX_OUT - total.length);   // one budget for the whole document, not one per page (iteration 2)
    const before = used.noMap;
    used.noMap = false;
    pageText(parts.join('\n'), fonts, page, used);
    if (used.noMap) mapless.add(pages.length);
    used.noMap = used.noMap || before;
    const text = page.text().trim();
    pages.push(text);
    total.add(text);
    if (page.full || total.length >= MAX_OUT) { cut = (cut ? cut + ' ' : '') + 'The rendering stops at ' + MAX_OUT + ' characters; later pages are not included.'; break; }   // iteration 3
    if (cut) break;
  }
  /* Iteration 10: right-to-left text (Hebrew, Arabic) comes out of a content stream in the order it is drawn, which is
     the reverse of reading order. Marked so a Mac asks PDFKit (which gives reading order) and elsewhere a note says so. */
  const sample = pages.join('').slice(0, 200000);
  const rtlCount = (sample.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]/g) || []).length;
  const letters = (sample.match(/\p{L}/gu) || []).length;
  const rtl = rtlCount >= 20 && rtlCount >= 0.1 * letters;
  return { encrypted: false, pages, cut, undecodable: undecodable.n, ownEncoding: used.ownEncoding, noMap: used.noMap, mapless: [...mapless], rtl };
}

/* Whether extracted text reads as text: mostly letters, digits, spaces and ordinary punctuation, judged on a sample. */
function readable(pages) {
  const sample = pages.join('').slice(0, 200000);
  const chars = Array.from(sample.replace(/\s+/g, ''));
  if (!chars.length) return false;
  const ok = chars.filter((c) => /[\p{L}\p{N}.,;:!?'"()\-\/%$&@#*+=‐-‟]/u.test(c)).length;
  if (/[\u0080-\u009f]/.test(sample)) return false;   // control characters where text should be: ask PDFKit (iteration 3)
  return ok / chars.length >= 0.8;
}

/* Pages to a rendering, with the notes a reader needs. */
function pdfFinish(pages, notes, skip = new Set()) {
  /* Pages emptied by a font with no character map are said by their own note, not called scanned (iteration 7). */
  const empty = pages.filter((p, i) => !String(p).trim() && !skip.has(i)).length;
  if (notes.some((n) => /compression Kosmos cannot read/.test(n)) || (skip.size && empty === 0)) { /* said already */ } else if (!pages.length || empty === pages.length) notes.push('No text was found in this PDF. It may be scanned pages (pictures of text), which are not converted.');
  else if (empty) notes.push(empty + ' of its ' + pages.length + ' pages had no text (scanned pages or pictures are not converted).');
  notes.push('Pictures are not converted, and the layout of columns and tables may not be kept.');
  const out = sink();
  pages.forEach((p, i) => out.add((i ? '\n\n' : '') + '--- Page ' + (i + 1) + ' ---\n' + String(p).trim()));
  return { body: out.text(), notes, full: out.full };
}

/* The JS reader, then PDFKit (on a Mac) when its text does not read as text, a font has its own encoding or no character
   map, or the file is encrypted. pdfText runs both in the calling thread
   (tests); render runs the JS half in a worker and asks PDFKit from the main thread (pdfAfter). */
async function pdfText(file, buf) {
  return pdfAfter(file, pdfTextJs(buf));
}
async function pdfAfter(file, js) {
  const notes = [];
  /* iteration 5: an encrypted PDF that only restricts permissions opens without a password; PDFKit reads it on a Mac. */
  const kit = async () => { await slot(); try { return await pdfkit(file); } finally { release(); } };
  if (js.encrypted) {
    const v = await kit();
    if (v && v !== '\u0000locked' && v.replace(/\s+/g, '')) return pdfFinish(v.split('\n\f\n'), []);
    return { body: '', notes: [v === '\u0000locked' ? 'This PDF is protected with a password, so its text could not be read.' : 'This PDF is encrypted, so its text could not be read.'] };
  }
  let pages = js.pages;
  let cut = js.cut;
  let skip = new Set();
  if (js.ownEncoding || js.noMap || js.rtl || !readable(pages)) {
    const viaKit = await kit();   // iteration 3: PDFKit counts against the same two conversions at once
    if (viaKit === '\u0000locked') return { body: '', notes: ['This PDF is protected with a password, so its text could not be read.'] };
    if (viaKit && viaKit.replace(/\s+/g, '')) { pages = viaKit.split('\n\f\n'); cut = null; }   // PDFKit read the whole file
    else {
      if (js.noMap) notes.push('Some of this PDF\u2019s text is in fonts that carry no character map (common in Chinese, Japanese and Korean documents), so that text could not be read here and is left out.');
      if (js.ownEncoding && pages.join('').trim()) notes.push('Some symbols and punctuation in this PDF may be wrong (its fonts use an encoding Kosmos reads only approximately).');
      if (js.rtl) notes.push('Right-to-left text in this PDF (Hebrew or Arabic) may read in reverse order here, as it is drawn on the page.');
      if (!js.noMap && !js.ownEncoding && !js.rtl) {
        if (pages.join('').trim()) notes.push('Some of this PDF’s text may not have converted cleanly (an unusual font encoding).');
        else if (js.undecodable) notes.push('This PDF uses a compression Kosmos cannot read, so its text could not be converted.');
      }
      skip = new Set(js.mapless || []);
    }
  }
  if (cut) notes.push(cut);
  return pdfFinish(pages, notes, skip);
}

/* ── the rendering ─────────────────────────────────────────────────────────────────────────── */

/* The conversion in a worker thread, with a memory and a time limit. Resolves to { body, notes, full } for xlsx and docx,
   { js } for pdf (the main thread may still ask PDFKit), or { failed: sentence }. */
let running = 0;
const waiting = [];
function slot() { return new Promise((r) => { if (running < MAX_WORKERS) { running += 1; r(); } else waiting.push(r); }); }
function release() { const next = waiting.shift(); if (next) next(); else running -= 1; }
async function convertIsolated(file, kind) {
  await slot();
  try { return await convertOnce(file, kind); } finally { release(); }
}
function convertOnce(file, kind) {
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
  else if (kind === 'pdf' && got && got.failed) {
    /* Iteration 15: the JS reader gave up (time or memory); PDFKit runs in its own process with its own limit, so a Mac
       still asks it. Its text is kept only when there is some. */
    const kit = await pdfAfter(rec.file, { encrypted: false, pages: [], cut: null, undecodable: 0, ownEncoding: false, noMap: false, mapless: [], rtl: false });
    if (kit && kit.body && kit.body.replace(/--- Page \d+ ---/g, '').trim()) got = { ...kit, notes: [got.failed.replace(/\.?$/, '.') + ' This text is from macOS\u2019s own PDF reader instead.', ...(kit.notes || [])] };
  }
  if (!got || got.failed) got = { body: '', notes: [(got && got.failed) || 'Kosmos could not convert this file.'] };
  const notes = (got.notes || []).slice();
  if (got.full && !notes.some((n) => /stops at/.test(n))) notes.push('The rendering stops at ' + MAX_OUT + ' characters.');   // iteration 11: said once
  const head = 'Text rendering of ' + rec.name + ', made by Kosmos from the attached file (#6098).'
    + (notes.length ? '\n' + notes.map((n) => 'Note: ' + n).join('\n') : '');
  const out = path.join(rec.dir, TEXT_NAME);
  try { fs.writeFileSync(out, head + '\n\n' + (got.body || '') + '\n'); } catch { return null; }
  return out;
}

module.exports = { TEXT_NAME, kindFor, render, xlsxText, docxText, pdfTextJs, pdfText, parseCmap, setPdfkit, setWorkerLimits, readable, MAX_SHEET_ROWS, MAX_OUT };
