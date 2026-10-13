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
 *   pdf   the text of each page, with page breaks: macOS's own PDFKit on a Mac, else (Windows, Linux, or PDFKit
 *         finding nothing) the reader below, which handles the common shapes (Flate streams, object streams, fonts
 *         with a ToUnicode map) and says when it found no text.
 * Every rendering starts by saying what it is, and says what could not be converted (images, charts, an encrypted
 * PDF, a scanned page with no text).
 *
 * ⚠️ A FILE FROM A PERSON IS BYTES, NOT A PROGRAM (attachments.js). Nothing here executes it: the zip and XML readers
 * are orgchartfile.js's linear ones (#4598: no regex that can go quadratic on a crafted file), every part and the
 * output are capped, and PDFKit runs in a subprocess with a timeout, off the event loop.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const oc = require('./orgchartfile');

const TEXT_NAME = 'text.txt';
const MAX_OUT = 2 * 1024 * 1024;          // characters written: enough for a long report, not a runaway file
const MAX_SHEET_ROWS = 5000;
const MAX_COLS = 256;
const MAX_PDF_INFLATE = 64 * 1024 * 1024;  // total decompressed bytes a PDF may cost
const MAX_PDF_PAGES = 2000;
const PDFKIT_TIMEOUT_MS = 20000;

const KINDS = { xlsx: 'xlsx', xlsm: 'xlsx', docx: 'docx', docm: 'docx', pdf: 'pdf' };
const kindFor = (name) => KINDS[path.extname(String(name || '')).toLowerCase().slice(1)] || null;

/* One table cell: pipes escaped and line breaks folded, so the table stays a table. */
const cellText = (v) => String(v == null ? '' : v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

function table(rows) {
  if (!rows.length) return '(no cells with values)';
  const width = Math.min(MAX_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0));
  const line = (r) => '| ' + Array.from({ length: width }, (_, i) => cellText(r[i])).join(' | ') + ' |';
  return [line(rows[0]), '|' + ' --- |'.repeat(width), ...rows.slice(1).map(line)].join('\n');
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
      if (type === 'inlineStr') v = oc.xmlText(oc.innerOf(cell.inner, 'is') || '');
      else {
        const raw = oc.innerOf(cell.inner, 'v');
        if (raw != null) v = type === 's' ? (shared[Number(raw)] || '') : oc.xmlText(raw);
      }
      row[i] = v;
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
  const get = oc.unzip(buf);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('it is not an Excel workbook');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^<>]*>/g)) targets.set(oc.attr(m[0], 'Id'), oc.attr(m[0], 'Target'));
  const shared = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) for (const si of oc.blocks(sst, 'si')) shared.push(oc.xmlText(oc.stripBlocks(si, 'rPh').replace(/<\/t>\s*<t[^<>]*>/g, '')));
  const out = [];
  const notes = new Set();
  let formulas = false;
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^<>]*>/g)) {
    const name = oc.xmlText(oc.attr(m[0], 'name') || 'Sheet');
    const rid = oc.attr(m[0], 'r:id') || oc.attr(m[0], 'id');
    const target = targets.get(rid);
    if (!target) continue;
    const part = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const sheet = get(part);
    if (!sheet) { out.push('## Sheet: ' + name + '\n\n(this sheet could not be read)'); continue; }
    if (/<(?:\w+:)?f[\s>]/.test(sheet)) formulas = true;
    const { rows, truncated } = sheetRows(sheet, shared);
    out.push('## Sheet: ' + name + '\n\n' + table(rows) + (truncated ? '\n\n(only the first ' + MAX_SHEET_ROWS + ' rows with values are shown)' : ''));
  }
  if (formulas) notes.add('Formulas are shown as the values they had when the file was last saved.');
  const parts = rels + (get('[Content_Types].xml') || '');
  if (/drawing|chart/i.test(parts) || hasPart(buf, /^xl\/(charts|drawings|media)\//)) notes.add('Charts, pictures and drawings are not converted.');
  return { body: out.join('\n\n'), notes: [...notes] };
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

/* A paragraph's text: its <w:t> runs, with tabs and line breaks where Word put them. */
function paraText(p) {
  const marked = p.replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:(?:br|cr)\b[^<>]*\/>/g, '<w:t>\n</w:t>');
  let s = '';
  for (const t of oc.blocks(marked, 'w:t')) s += oc.xmlText(t);
  const style = /<w:pStyle\b[^<>]*w:val="([^"]*)"/.exec(p);
  const heading = style && /^(?:Heading|Title)(\d?)$/i.exec(style[1]);
  if (heading && s.trim()) return '#'.repeat(Math.min(6, Number(heading[1] || 1))) + ' ' + s.trim();
  if (/<w:numPr\b/.test(p) && s.trim()) return '- ' + s.trim();
  return s;
}

/* The body's top-level paragraphs and tables, in document order: the next `<w:p` or `<w:tbl` that is the element
   itself (not <w:pPr>, <w:tblPr>), each taken to its own closer, walking with indexOf (linear, as orgchartfile). */
function* bodyBlocks(body) {
  let at = 0;
  const isTag = (i, n) => /[\s>/]/.test(body[i + n] || '');
  for (;;) {
    let p = body.indexOf('<w:p', at);
    while (p >= 0 && !isTag(p, 4)) p = body.indexOf('<w:p', p + 1);
    let t = body.indexOf('<w:tbl', at);
    while (t >= 0 && !isTag(t, 6)) t = body.indexOf('<w:tbl', t + 1);
    if (p < 0 && t < 0) return;
    if (t >= 0 && (p < 0 || t < p)) {
      const end = body.indexOf('</w:tbl>', t);
      if (end < 0) return;
      yield { tbl: body.slice(t, end) };
      at = end + 8;
    } else {
      const gt = body.indexOf('>', p);
      if (gt < 0) return;
      if (body[gt - 1] === '/') { yield { p: '' }; at = gt + 1; continue; }
      const end = body.indexOf('</w:p>', gt);
      if (end < 0) return;
      yield { p: body.slice(p, end) };
      at = end + 6;
    }
  }
}

function docxText(buf) {
  const get = oc.unzip(buf);
  const doc = get('word/document.xml');
  if (!doc) throw new Error('it is not a Word document');
  const body = oc.innerOf(doc, 'w:body') || doc;
  const out = [];
  for (const b of bodyBlocks(body)) {
    if (b.tbl != null) {
      const rows = [];
      for (const tr of oc.blocks(b.tbl, 'w:tr')) {
        const row = [];
        for (const tc of oc.blocks(tr, 'w:tc')) {
          const paras = [];
          for (const p of oc.blocks(tc, 'w:p')) paras.push(paraText('<w:p>' + p).trim());
          row.push(paras.filter(Boolean).join(' '));
        }
        rows.push(row);
      }
      out.push(table(rows));
    } else {
      out.push(paraText(b.p));
    }
  }
  const notes = [];
  if (hasPart(buf, /^word\/media\//)) notes.push('Pictures are not converted.');
  if (hasPart(buf, /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/)) notes.push('Headers, footers, footnotes and comments are not included.');
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), notes };
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
    (err, stdout) => resolve(err ? null : String(stdout || '').replace(/\n$/, '')));
});
function setPdfkit(fn) { pdfkit = fn; }

/* The reader for everywhere else: objects (plain, and inside object streams), Flate streams, the page tree in order,
   and each page's text operators, decoded through its font's ToUnicode map where it has one. */
function pdfObjects(buf) {
  const src = buf.toString('latin1');
  const objs = new Map();   // num -> { dict, stream (Buffer|null) }
  let inflated = 0;
  const inflate = (raw) => {
    if (inflated > MAX_PDF_INFLATE) return null;
    try {
      const out = zlib.inflateSync(raw, { maxOutputLength: MAX_PDF_INFLATE - inflated });
      inflated += out.length;
      return out;
    } catch { return null; }
  };
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endobj', start);
    if (end < 0) break;
    let body = src.slice(start, end);
    let stream = null;
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      /* The stream's own end: its /Length, else its `endstream` searched for INSIDE this object only (#4598: a search
         that may run on to the end of the file, once per object, is quadratic on a crafted one). */
      const inside = (from) => { const k = body.indexOf('endstream', from - start); return k < 0 ? end : start + k; };
      let dataEnd = lenM ? dataStart + Number(lenM[1]) : inside(dataStart);
      if (dataEnd < dataStart || dataEnd > end) dataEnd = inside(dataStart);
      let raw = buf.subarray(dataStart, dataEnd);
      if (/\/FlateDecode/.test(dict)) raw = inflate(raw);
      else if (/\/Filter/.test(dict)) raw = null;   // a filter this reader does not do (images, mostly)
      stream = raw;
      body = dict;
    }
    objs.set(Number(m[1]), { dict: body, stream });
    re.lastIndex = end + 6;
  }
  /* Object streams (PDF 1.5+): the objects a modern writer packs together, fonts and pages among them. */
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const s = o.stream.toString('latin1');
    const n = Number((/\/N\s+(\d+)/.exec(o.dict) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(o.dict) || [])[1] || 0);
    const head = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n && 2 * k + 1 < head.length; k += 1) {
      const num = head[2 * k];
      const off = first + head[2 * k + 1];
      const next = k + 1 < n && 2 * k + 3 <= head.length ? first + head[2 * k + 3] : s.length;
      if (!objs.has(num)) objs.set(num, { dict: s.slice(off, next), stream: null });
    }
  }
  return objs;
}

const ref = (dict, key) => { const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(dict || ''); return m ? Number(m[1]) : null; };
const refs = (text) => [...String(text || '').matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
/* The inner text of the first `<< >>` after /key, nesting counted. */
function subDict(dict, key) {
  const i = String(dict || '').search(new RegExp('/' + key + '\\s*<<'));
  if (i < 0) return null;
  let depth = 0;
  for (let j = dict.indexOf('<<', i); j < dict.length; j += 1) {
    if (dict.startsWith('<<', j)) { depth += 1; j += 1; } else if (dict.startsWith('>>', j)) { depth -= 1; if (depth === 0) return dict.slice(dict.indexOf('<<', i) + 2, j); j += 1; }
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

/* Each open...close section's inner text, walked with indexOf (#4598: a lazy regex rescans to the end for every opener
   with no closer). Stops at the first opener without one. */
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

function parseCmap(text) {
  const map = new Map();
  let codeLen = 1;
  const hex = (h) => h.replace(/\s+/g, '');
  const utf16 = (h) => { const b = Buffer.from(hex(h), 'hex'); let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; };
  for (const sec of sections(text, 'beginbfchar', 'endbfchar')) {
    for (const p of sec.matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g)) { codeLen = Math.max(codeLen, hex(p[1]).length / 2); map.set(parseInt(hex(p[1]), 16), utf16(p[2])); }
  }
  for (const sec of sections(text, 'beginbfrange', 'endbfrange')) {
    for (const p of sec.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F\s]*)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(p[1], 16); const hi = parseInt(p[2], 16);
      codeLen = Math.max(codeLen, p[1].length / 2);
      if (hi - lo > 65535) continue;
      if (p[3] != null) {
        const base = utf16(p[3]);
        for (let c = lo; c <= hi; c += 1) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
      } else {
        const list = [...p[4].matchAll(/<([0-9a-fA-F\s]*)>/g)];
        for (let c = lo; c <= hi && c - lo < list.length; c += 1) map.set(c, utf16(list[c - lo][1]));
      }
    }
  }
  return { map, codeLen };
}

/* The tokens of a content stream: strings (literal, with escapes and nesting; hex), names, numbers, arrays, operators. */
function* tokens(s) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i += 1; continue; }
    if (c === '(') {
      let depth = 1; let out = ''; i += 1;
      while (i < n && depth > 0) {
        const ch = s[i];
        if (ch === '\\') {
          const nx = s[i + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[nx];
          if (esc != null) { out += esc; i += 2; continue; }
          if (/[0-7]/.test(nx)) { const o = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; out += String.fromCharCode(parseInt(o, 8) & 0xff); i += 1 + o.length; continue; }
          if (nx === '\n' || nx === '\r') { i += nx === '\r' && s[i + 2] === '\n' ? 3 : 2; continue; }
          i += 1; continue;
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
    if (c === '/') { const m = /^\/[^\s/<>\[\]()%]*/.exec(s.slice(i, i + 128)); yield { name: m[0].slice(1) }; i += m[0].length; continue; }
    const m = /^[^\s/<>\[\]()%]+/.exec(s.slice(i, i + 64));
    if (!m) { i += 1; continue; }
    const w = m[0];
    i += w.length;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(w)) yield { num: Number(w) }; else yield { op: w };
  }
}

function pageText(content, fonts) {
  let out = '';
  let font = null;
  let lastY = null;
  const stack = [];
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
  const newline = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  for (const t of tokens(content)) {
    if (t.op == null) { stack.push(t); if (stack.length > 64) stack.shift(); continue; }
    const op = t.op;
    if (op === '[') { stack.push({ arr: [] }); continue; }
    if (op === ']') {
      const items = [];
      while (stack.length && !(stack[stack.length - 1].arr)) items.unshift(stack.pop());
      const a = stack.pop();
      if (a) { a.arr = items; stack.push(a); }
      continue;
    }
    if (op === 'Tf') { const nm = stack.filter((x) => x.name != null).pop(); if (nm) font = nm.name; }
    else if (op === 'Tj') { const s = stack.filter((x) => x.str != null).pop(); if (s) out += decode(s.str); }
    else if (op === "'" || op === '"') { newline(); const s = stack.filter((x) => x.str != null).pop(); if (s) out += decode(s.str); }
    else if (op === 'TJ') {
      const a = stack.filter((x) => x.arr).pop();
      if (a) for (const e of a.arr) { if (e.str != null) out += decode(e.str); else if (e.num != null && e.num < -200 && !out.endsWith(' ')) out += ' '; }
    } else if (op === 'Td' || op === 'TD') { const nums = stack.filter((x) => x.num != null); const ty = nums.length ? nums[nums.length - 1].num : 0; if (ty !== 0) newline(); else if (out && !/\s$/.test(out)) out += ' '; }
    else if (op === 'T*') newline();
    else if (op === 'Tm') { const nums = stack.filter((x) => x.num != null); const y = nums.length ? nums[nums.length - 1].num : null; if (lastY != null && y != null && y !== lastY) newline(); lastY = y; }
    else if (op === 'ET') { if (out && !/\s$/.test(out)) out += ' '; }
    stack.length = 0;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

function pdfTextJs(buf) {
  /* Encryption is declared in the trailer (or a cross-reference stream's dictionary), never in the objects it hides. */
  if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(buf.toString('latin1'))) return { encrypted: true, pages: [] };
  const objs = pdfObjects(buf);
  const cmaps = new Map();
  const cmapOf = (fontNum) => {
    if (cmaps.has(fontNum)) return cmaps.get(fontNum);
    const fo = objs.get(fontNum);
    const tu = fo ? ref(fo.dict, 'ToUnicode') : null;
    const st = tu != null && objs.get(tu) ? objs.get(tu).stream : null;
    const c = st ? parseCmap(st.toString('latin1')) : null;
    cmaps.set(fontNum, c);
    return c;
  };
  const pages = [];
  for (const { o, resources } of pagesInOrder(objs)) {
    const fonts = new Map();
    let fontDict = subDict(resources, 'Font');
    if (fontDict == null && ref(resources, 'Font') != null) fontDict = (objs.get(ref(resources, 'Font')) || {}).dict || '';
    for (const fm of String(fontDict || '').matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) { const c = cmapOf(Number(fm[2])); if (c) fonts.set(fm[1], c); }
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(o.dict);
    const nums = contents ? refs(contents[1]) : (ref(o.dict, 'Contents') != null ? [ref(o.dict, 'Contents')] : []);
    let content = '';
    for (const n of nums) { const st = objs.get(n) && objs.get(n).stream; if (st) content += st.toString('latin1') + '\n'; }
    pages.push(pageText(content, fonts));
  }
  return { encrypted: false, pages };
}

/* Whether extracted text reads as text: mostly letters, digits, spaces and ordinary punctuation. A font with no
   ToUnicode map and its own encoding comes out as symbols, which this says no to. */
function readable(pages) {
  const all = pages.join('');
  const chars = Array.from(all.replace(/\s+/g, ''));
  if (!chars.length) return false;
  const ok = chars.filter((c) => /[\p{L}\p{N}.,;:!?'"()\-\/%$&@#*+=\u2010-\u201f]/u.test(c)).length;
  return ok / chars.length >= 0.8;
}

/* The JS reader first: it keeps the line breaks (macOS's PDFKit can join a page's lines into one). Where its text does
   not read as text (an odd font encoding), a Mac asks PDFKit, which knows more encodings. */
async function pdfText(file, buf) {
  const notes = [];
  const js = pdfTextJs(buf);
  if (js.encrypted) return { body: '', notes: ['This PDF is encrypted, so its text could not be read.'] };
  let pages = js.pages;
  if (!readable(pages)) {
    const viaKit = await pdfkit(file);
    if (viaKit === '\u0000locked') return { body: '', notes: ['This PDF is protected with a password, so its text could not be read.'] };
    if (viaKit && viaKit.replace(/\s+/g, '')) pages = viaKit.split('\n\f\n');
    else if (pages.join('').trim()) notes.push('Some of this PDF\u2019s text may not have converted cleanly (an unusual font encoding).');
  }
  const empty = pages.filter((p) => !String(p).trim()).length;
  if (!pages.length || empty === pages.length) notes.push('No text was found in this PDF. It may be scanned pages (pictures of text), which are not converted.');
  else if (empty) notes.push(empty + ' of its ' + pages.length + ' pages had no text (scanned pages or pictures are not converted).');
  notes.push('Pictures are not converted, and the layout of columns and tables may not be kept.');
  return { body: pages.map((p, i) => '--- Page ' + (i + 1) + ' ---\n' + String(p).trim()).join('\n\n'), notes };
}

/* ── the rendering ─────────────────────────────────────────────────────────────────────────── */

/**
 * Write the text rendering of a stored attachment beside it, if it is an office file. Resolves to the text file's
 * path, or null (not an office file, or nothing could be read; the reason is in the file when one was written).
 */
async function render(rec) {
  const kind = rec && kindFor(rec.name);
  if (!kind) return null;
  let buf;
  try { buf = fs.readFileSync(rec.file); } catch { return null; }
  let got;
  try {
    got = kind === 'xlsx' ? xlsxText(buf) : kind === 'docx' ? docxText(buf) : await pdfText(rec.file, buf);
  } catch (e) {
    got = { body: '', notes: ['Kosmos could not read this file as ' + kind + ' (' + String((e && e.message) || 'it is damaged') + '), so there is no text rendering.'] };
  }
  let body = got.body || '';
  const notes = got.notes || [];
  if (body.length > MAX_OUT) { body = body.slice(0, MAX_OUT); notes.push('The rendering stops at ' + MAX_OUT + ' characters.'); }
  const head = 'Text rendering of ' + rec.name + ', made by Kosmos from the attached file (#6098).'
    + (notes.length ? '\n' + notes.map((n) => 'Note: ' + n).join('\n') : '');
  const out = path.join(rec.dir, TEXT_NAME);
  try { fs.writeFileSync(out, head + '\n\n' + body + '\n'); } catch { return null; }
  return out;
}

module.exports = { TEXT_NAME, kindFor, render, xlsxText, docxText, pdfTextJs, pdfText, parseCmap, setPdfkit, readable, MAX_SHEET_ROWS, MAX_OUT };
