'use strict';
/**
 * kosmos#8122 (Josh 11-06: "It's a spreadsheet so I don't know why we couldn't render a spreadsheet view. Obviously
 * they couldn't edit it or change it or do anything but just showing something here"): a read-only look at an .xlsx,
 * for the file viewer. First slice by Mona Lisa; hardened in review 1 by Ice Cream Kitty.
 *
 * What it reads, and nothing else: the workbook's sheet names (and whether the workbook counts dates from 1904), its
 * shared strings, the number formats that say a number is a date, a time or a percent, and each cell's SAVED value
 * (`<v>`, an inline string, a boolean, an error code). A formula is never read as anything but the value saved with
 * it; a link is never followed; nothing outside the file is loaded; no code in the file runs. A workbook with formulas
 * but no saved values (one a script wrote, which saves `<v/>` or nothing) is said as such (`noValues`), never drawn as
 * an empty grid.
 *
 * Untrusted input, and the work is bounded on every path (review 1 measured a 1.7 KB file hanging the board for
 * minutes, and a 77 KB one costing 19 s, before these):
 * - the zip is read by engine/win32zip.js's checked reader (entry count, sizes, overlapping entries, a deflate capped
 *   at its declared size);
 * - every XML part is capped in size and scanned forward with indexOf; the patterns that run on a whole part or body
 *   (the prefix strip, the entity decode) have no nested repetition, so they are linear; the rest run on a short, capped
 *   piece (a start tag, a format code);
 * - comments are cut and CDATA unwrapped first, so neither can hide or fake a value; namespace prefixes are dropped;
 * - each worksheet part is read once, however many sheets name it, and reading a sheet stops at its row cap;
 * - the whole read has a time budget (WORK_BUDGET_MS), checked every 1024 steps of every loop and between parts; past
 *   it the answer is "too large to preview". One scan (clean) is linear, so it needs no check inside;
 * - the grid is capped (MAX_SHEETS, MAX_ROWS, MAX_COLS, MAX_CELL_CHARS, MAX_SHARED_STRINGS).
 * Anything it cannot read is a XlsxRefusal with a sentence a person can be shown.
 *
 * Built-ins only (package.json has no dependencies; SheetJS was considered and rejected on the card).
 */
const { readZipDirectory, entryContents } = require('./win32zip');

const MAX_FILE_BYTES = 10 * 1024 * 1024;      // over this, "too large to preview" (the button still downloads it)
const MAX_PART_BYTES = 16 * 1024 * 1024;      // one XML part, unpacked
const MAX_SHEETS = 20;
const MAX_ROWS = 200;                          // per sheet
const MAX_COLS = 50;
const MAX_CELL_CHARS = 500;
const MAX_SHARED_STRINGS = 200000;
const MAX_TAG_CHARS = 4096;                    // a start tag longer than this has no attributes we read
const MAX_FORMAT_CODE = 255;                   // Excel's own limit on a number format code
const WORK_BUDGET_MS = 2000;                   // the whole read, on the board's one thread

const TOO_LARGE = 'This spreadsheet is too large to preview.';
const CANNOT_READ = 'This file could not be read as a spreadsheet.';

class XlsxRefusal extends Error { constructor(message) { super(message); this.name = 'XlsxRefusal'; } }
const refuse = (m) => { throw new XlsxRefusal(m); };

const ZIP_LIMITS = {
  // docMetadata/: Microsoft 365 writes a sensitivity label there (review 1: such workbooks were refused).
  allowedTopLevel: ['[Content_Types].xml', '_rels', 'docProps', 'docMetadata', 'xl', 'customXml'],
  maxEntries: 2000, maxEntryBytes: MAX_PART_BYTES, maxTotalBytes: 4 * MAX_PART_BYTES,
  // Review 2: an entry we never read ("[trash]/" from Excel, "_xmlsignatures/", a name Windows could not store) is left
  // out of the listing, not a reason to refuse the workbook. Read-only: nothing here is ever written to disk.
  skipUnsafeNames: true,
};

/* A clock for the work budget; `now` is replaced in tests. */
let now = () => Date.now();

/* &amp; &lt; &gt; &quot; &apos; and numeric references; anything else stays as written. */
function unescapeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* A part made safe to scan (review 1): comments cut (a comment can hold a fake <sheetData> or a fake value), CDATA
   unwrapped into escaped text (so its contents are text, never markup), and element-name namespace prefixes dropped
   (`<x:sheetData>` as the .NET OpenXML SDK writes it). One forward pass each; the prefix pattern has no nested
   repetition and a bounded prefix, so it is linear. */
function clean(xml) {
  // Review 2: ONE forward scan for "<", branching on what follows. Two searches per pass (one for each marker) rescanned
  // to the end whenever a marker was absent, which made a part full of empty comments quadratic (a 25 KB file ran 40 s+).
  if (xml.indexOf('<!') < 0) return stripPrefixes(xml);
  const parts = [];
  let at = 0;      // start of the text not yet copied
  let i = 0;       // where the scan has reached
  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) {
      parts.push(xml.slice(at, lt));
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) { at = xml.length; break; }   // a comment never closed: the rest is comment
      at = i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      parts.push(xml.slice(at, lt));
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) { at = xml.length; break; }
      parts.push(escapeXml(xml.slice(lt + 9, end)));
      at = i = end + 3;
    } else i = lt + 1;
  }
  parts.push(xml.slice(at));
  return stripPrefixes(parts.join(''));
}
function stripPrefixes(xml) {
  return xml.replace(/<(\/?)[A-Za-z_][A-Za-z0-9_.-]{0,40}:(?=[A-Za-z_])/g, '<$1');
}

/* One attribute of a start tag (`<c r="B3" t="s">`), or null. Either quote, any namespace prefix (`r:id`, `ns1:id`).
   The tag is short (MAX_TAG_CHARS), so the pattern runs on it alone. */
function attr(tag, name) {
  if (tag.length > MAX_TAG_CHARS) return null;
  const m = new RegExp('\\s(?:[A-Za-z_][A-Za-z0-9_.-]{0,40}:)?' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(tag);
  return m ? unescapeXml(m[1] !== undefined ? m[1] : m[2]) : null;
}
/* Every element named `name` in `xml`, as { tag, body, end } (body '' for a self-closed one), found with indexOf. With
   `lenient` (the containers: sheetData, row), one the part never closes (a file cut short) yields the rest of the part,
   so what is there is still read; a value that is not closed is never read. */
function* elements(xml, name, lenient = false) {
  let at = 0;
  for (;;) {
    let i = xml.indexOf('<' + name, at);
    if (i < 0) return;
    const after = xml[i + name.length + 1];
    if (after !== ' ' && after !== '>' && after !== '/' && after !== '\t' && after !== '\n' && after !== '\r') { at = i + 1; continue; }
    const tagEnd = xml.indexOf('>', i);
    if (tagEnd < 0) return;
    const tag = xml.slice(i, tagEnd + 1);
    if (tag.endsWith('/>')) { yield { tag, body: '', end: tagEnd + 1 }; at = tagEnd + 1; continue; }
    const close = xml.indexOf('</' + name + '>', tagEnd);
    if (close < 0) { if (lenient) yield { tag, body: xml.slice(tagEnd + 1), end: xml.length }; return; }
    yield { tag, body: xml.slice(tagEnd + 1, close), end: close + name.length + 3 };
    at = close + name.length + 3;
  }
}
/* The text of a string item: every <t> run joined, but not the phonetic guide (<rPh>, review 1: a Japanese cell showed
   its reading after it). */
function textOf(body) {
  let shown = body;
  if (body.indexOf('<rPh') >= 0) {
    let out = '', at = 0;
    for (;;) {
      const i = shown.indexOf('<rPh', at);
      if (i < 0) { out += shown.slice(at); break; }
      out += shown.slice(at, i);
      const close = shown.indexOf('</rPh>', i);
      if (close < 0) break;
      at = close + 6;
    }
    shown = out;
  }
  let out = '';
  for (const t of elements(shown, 't')) out += unescapeXml(t.body);
  return out;
}
/* "B3" -> [row 2, column 1] (0-based); case-blind; null for anything else (including row 0). */
function cellRef(ref) {
  const m = /^([A-Za-z]{1,3})([0-9]{1,7})$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(m[2], 10);
  if (row < 1) return null;
  return [row - 1, col - 1];
}
const clip = (s) => (s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS - 1) + '…' : s);

/* A format code without its quoted text and bracketed parts ("[Red]", "[$-409]", "[h]" stays: elapsed hours), by a
   forward scan (review 1: a pattern here was quadratic on a code full of "["). Codes longer than Excel allows are not
   formats at all. */
function bareCode(code) {
  if (code.length > MAX_FORMAT_CODE) return null;
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') { const j = code.indexOf('"', i + 1); if (j < 0) break; i = j; continue; }
    if (ch === '\\') { i++; continue; }
    if (ch === '[') {
      const j = code.indexOf(']', i + 1);
      if (j < 0) break;
      const inner = code.slice(i + 1, j).toLowerCase();
      if (/^(h+|m+|s+)$/.test(inner)) out += inner;   // [h]:mm is a duration, still a time
      i = j;
      continue;
    }
    out += ch;
  }
  return out;
}
/* What a number format shows: { kind: 'date' } (a day, maybe with a time), { kind: 'time' } (a time of day),
   { kind: 'duration', unit: 'h' | 'm' | 's', seconds } ("[h]:mm": elapsed time past 24 hours, review 2), or
   { kind: 'number', decimals, thousands, percent } for the simple codes ("0.00", "#,##0", "0.0%"), or null (shown as
   saved). The first section of a code (before ";") decides. Currency symbols, fractions and the rest are null. */
function formatKind(code) {
  const bare = bareCode(String(code || '').split(';')[0]);
  if (bare === null) return null;
  const lower = bare.toLowerCase();
  const dur = /^(h+|m+|s+)/.exec(lower);
  if (dur && /\[(h+|m+|s+)\]/i.test(String(code || '').split(';')[0])) return { kind: 'duration', unit: dur[1][0], seconds: /s/.test(lower.slice(dur[1].length)) || dur[1][0] === 's' };
  if (/[dy]/.test(lower)) return { kind: 'date' };
  if (/[hs]/.test(lower)) return { kind: 'time' };
  if (/m/.test(lower) && !/^[#0.,%\s]*$/.test(lower)) return { kind: 'date' };   // "mmm" alone is a month
  // Only a code of digit placeholders (review 3: a currency or a unit, quoted or in brackets, was dropped from the shown
  // text); anything else shows the saved number.
  if (!/^[#0.,%\s]+$/.test(String(code || '').split(';')[0])) return null;
  const num = /^\s*(#,##0|#,#|0|#)?(?:\.(0+))?\s*(%)?\s*$/.exec(lower);
  if (num && (num[1] || num[2] || num[3])) return { kind: 'number', decimals: num[2] ? num[2].length : 0, thousands: (num[1] || '').indexOf(',') >= 0, percent: !!num[3] };
  return null;
}
/* Built-in number formats by id (ECMA-376 18.8.30): 1 "0", 2 "0.00", 3 "#,##0", 4 "#,##0.00", 9 "0%", 10 "0.00%",
   dates 14-17 and 22, times 18-21 and 45 and 47, the duration 46 "[h]:mm:ss", and the locale date formats 27-36 and
   50-58 (review 2: shown as raw serials before). */
function builtinKind(id) {
  if (id === 1) return { kind: 'number', decimals: 0, thousands: false, percent: false };
  if (id === 2) return { kind: 'number', decimals: 2, thousands: false, percent: false };
  if (id === 3) return { kind: 'number', decimals: 0, thousands: true, percent: false };
  if (id === 4) return { kind: 'number', decimals: 2, thousands: true, percent: false };
  if (id === 9) return { kind: 'number', decimals: 0, thousands: false, percent: true };
  if (id === 10) return { kind: 'number', decimals: 2, thousands: false, percent: true };
  if ((id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return { kind: 'date' };
  if (id === 46) return { kind: 'duration', unit: 'h', seconds: true };
  if ((id >= 18 && id <= 21) || id === 45 || id === 47) return { kind: 'time' };
  return null;
}
/* For each cell style, what its number format shows (see formatKind), or null. */
function styleKinds(stylesXml, budget = () => {}) {
  const custom = new Map();
  let k = 0;
  for (const f of elements(stylesXml, 'numFmt')) {
    custom.set(Number(attr(f.tag, 'numFmtId')), attr(f.tag, 'formatCode') || '');
    if ((++k & 1023) === 0) budget();
  }
  const out = [];
  const xfs = elements(stylesXml, 'cellXfs').next().value;
  if (!xfs) return out;
  const memo = new Map();   // review 3: one reading per format, not one per style
  for (const x of elements(xfs.body, 'xf')) {
    const id = Number(attr(x.tag, 'numFmtId') || 0);
    if (!memo.has(id)) memo.set(id, custom.has(id) ? formatKind(custom.get(id)) : builtinKind(id));
    out.push(memo.get(id));
    if ((++k & 1023) === 0) budget();
  }
  return out;
}
/* An Excel serial date as YYYY-MM-DD (with HH:MM when it has a time). The 1900 system keeps Excel's leap-year bug:
   serial 60 is the 1900-02-29 that never was, and serials below it are one day later than the plain count (review 1).
   The 1904 system counts from 1904-01-01. */
function serialDate(n, from1904 = false) {
  if (!Number.isFinite(n) || n < 0 || n > 2958465) return String(n);
  n = Math.round(n * 86400) / 86400;   // review 2: to the second first, so a time just before midnight carries into the next day
  if (!from1904 && Math.floor(n) === 60) return '1900-02-29' + timePart(n);
  const days = from1904 ? n + 1462 : (n < 60 ? n + 1 : n);
  const ms = Math.round((days - 25569) * 86400000);   // 25569 = 1970-01-01 in the 1900 system
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(n);
  return d.toISOString().slice(0, 10) + timePart(n);
}
function timePart(n) { return n % 1 === 0 ? '' : ' ' + serialTime(n); }
/* The time of day in a serial, HH:MM (with :SS when it has seconds). */
function serialTime(n) {
  if (!Number.isFinite(n)) return String(n);
  const secs = Math.round((((n % 1) + 1) % 1) * 86400) % 86400;
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = secs % 60;
  return hh + ':' + mm + (ss ? ':' + String(ss).padStart(2, '0') : '');
}
/* A saved number as a person reads it: no float noise (0.30000000000000004 is 0.3); with a simple number format, its
   decimal places, its thousands separator (as en-US writes them) and its percent sign, rounded half away from zero as
   Excel does (0.075 under "0%" is 8%). */
function shownNumber(raw, fmt) {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return raw;
  if (!fmt || fmt.kind !== 'number') return String(Number(n.toPrecision(15)));
  const v = Number((fmt.percent ? n * 100 : n).toPrecision(15));
  const f = Math.pow(10, fmt.decimals);
  const rounded = Math.sign(v) * Math.round(Math.abs(v) * f + 1e-9) / f;
  let text = Math.abs(rounded).toFixed(fmt.decimals);
  if (fmt.thousands) { const [i, d] = text.split('.'); text = i.replace(/\B(?=(\d{3})+$)/g, ',') + (d ? '.' + d : ''); }
  return (rounded < 0 ? '-' : '') + text + (fmt.percent ? '%' : '');
}
/* An elapsed time ("[h]:mm:ss"): total hours, minutes or seconds, past 24 hours (Excel shows 1.5 days as 36:00). */
function shownDuration(n, fmt) {
  if (!Number.isFinite(n)) return String(n);
  const total = Math.round(Math.abs(n) * 86400);
  const sign = n < 0 ? '-' : '';
  const pad = (x) => String(x).padStart(2, '0');
  if (fmt.unit === 's') return sign + total;
  if (fmt.unit === 'm') return sign + Math.floor(total / 60) + ':' + pad(total % 60);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  return sign + h + ':' + pad(m) + (fmt.seconds ? ':' + pad(sec) : '');
}

/**
 * Reads `buf` (a whole .xlsx in memory) to `{ sheets: [{ name, rows, cut, notGrid? }], moreSheets, noValues, empty,
 * someNoValues? }`.
 * `rows` is an array of arrays of strings, as many columns as the widest row (up to MAX_COLS); `cut` is true when the
 * sheet had more rows or columns than shown. Sheets past MAX_SHEETS are left out and `moreSheets` counts them.
 */
function readXlsx(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('xlsxpreview: readXlsx takes a Buffer');
  if (buf.length > MAX_FILE_BYTES) refuse(TOO_LARGE);
  const started = now();
  const budget = () => { if (now() - started > WORK_BUDGET_MS) refuse(TOO_LARGE); };
  let entries;
  try { entries = readZipDirectory(buf, ZIP_LIMITS); }
  catch (e) { refuse(CANNOT_READ); }
  const byName = new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.name, e]));
  const part = (name) => {
    const e = byName.get(name);
    if (!e) return null;
    let text = null;
    try { text = entryContents(buf, e).toString('utf8'); }
    catch (err) { refuse(CANNOT_READ); }
    budget();
    return clean(text);
  };
  const workbook = part('xl/workbook.xml');
  if (!workbook) refuse(CANNOT_READ);
  const pr = elements(workbook, 'workbookPr').next().value;
  const from1904 = !!pr && /^(1|true)$/i.test(attr(pr.tag, 'date1904') || '');
  const rels = new Map();
  let rk = 0;
  for (const r of elements(part('xl/_rels/workbook.xml.rels') || '', 'Relationship')) {
    rels.set(attr(r.tag, 'Id'), attr(r.tag, 'Target') || '');
    if ((++rk & 1023) === 0) budget();
  }
  const shared = [];
  const sst = part('xl/sharedStrings.xml');
  if (sst) {
    let k = 0;
    for (const si of elements(sst, 'si')) {
      if (shared.length >= MAX_SHARED_STRINGS) break;
      shared.push(textOf(si.body));
      if ((++k & 1023) === 0) budget();
    }
  }
  const kinds = styleKinds(part('xl/styles.xml') || '', budget);

  const sheets = [];
  const readTargets = new Set();   // review 1: a part named by several sheets is read once
  let all = 0, anyValue = false, anyFormula = false, bareFormula = false;
  let sk = 0;
  for (const s of elements(workbook, 'sheet')) {
    if ((++sk & 1023) === 0) budget();
    if ((attr(s.tag, 'state') || '') === 'veryHidden') continue;   // a sheet Excel never shows, not even to unhide
    all++;
    if (sheets.length >= MAX_SHEETS) continue;
    const name = attr(s.tag, 'name') || ('Sheet ' + all);
    let target = rels.get(attr(s.tag, 'id')) || '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    // Only a part inside xl/worksheets/ (a chart sheet or a dialog sheet is not a grid; a path that climbs out is not
    // read), and only once.
    if (!/^worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target) || readTargets.has(target)) { sheets.push({ name, rows: [], cut: false, notGrid: true }); continue; }
    readTargets.add(target);
    const xml = part('xl/' + target);
    // Review 3: a part that is not in the file (damaged, or a name the lister leaves out) is not a grid, never "empty".
    if (xml === null) { sheets.push({ name, rows: [], cut: false, notGrid: true }); continue; }
    const grid = new Map();   // row -> Map(col -> text)
    let width = 0, cut = false;
    const data = elements(xml, 'sheetData', true).next().value;
    let rowAt = -1;
    let k = 0;
    for (const row of data ? elements(data.body, 'row', true) : []) {
      if ((++k & 1023) === 0) budget();
      const rr = Number(attr(row.tag, 'r'));
      rowAt = Number.isInteger(rr) && rr >= 1 ? rr - 1 : rowAt + 1;   // a row with no r is the next one (review 1)
      if (rowAt >= MAX_ROWS) { cut = true; break; }                  // review 1: stop at the cap, do not walk the rest
      let colAt = -1;
      for (const c of elements(row.body, 'c')) {
        if ((++k & 1023) === 0) budget();
        const at = cellRef(attr(c.tag, 'r'));
        const col = at ? at[1] : colAt + 1;                          // a cell with no r is the next column
        colAt = col;
        if (col >= MAX_COLS) { cut = true; continue; }
        const hasFormula = c.body.indexOf('<f') >= 0;
        if (hasFormula) anyFormula = true;
        const type = attr(c.tag, 't') || 'n';
        let text = null;
        if (type === 'inlineStr') {
          const is = elements(c.body, 'is').next().value;
          text = is ? textOf(is.body) : null;
        } else {
          const v = elements(c.body, 'v').next().value;
          // Review 1: an empty <v/> (as openpyxl writes beside a formula) is no saved value, not an empty one.
          if (v && v.body !== '') {
            const raw = unescapeXml(v.body);
            if (type === 's') text = shared[Number(raw)] ?? '';
            else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
            else if (type === 'e' || type === 'str') text = raw;
            // Review 3: an ISO date cell (t="d", as openpyxl with iso_dates, SheetJS and Strict OOXML write) is shown as its
            // date, never handed to the serial reader (it showed "NaN").
            else if (type === 'd') text = raw.replace(/T00:00(:00(\.0+)?)?Z?$/, '').replace('T', ' ').slice(0, 16);
            else {
              const fmt = kinds[Number(attr(c.tag, 's') || 0)] || null;
              const kind = fmt && fmt.kind;
              text = kind === 'date' ? serialDate(Number(raw), from1904)
                : kind === 'time' ? serialTime(Number(raw))
                  : kind === 'duration' ? shownDuration(Number(raw), fmt)
                    : shownNumber(raw, fmt);
            }
          }
        }
        if (text === null) { if (hasFormula) bareFormula = true; continue; }
        anyValue = true;
        if (!grid.has(rowAt)) grid.set(rowAt, new Map());
        grid.get(rowAt).set(col, clip(text));
        if (col + 1 > width) width = col + 1;
      }
    }
    const height = grid.size ? Math.max(...grid.keys()) + 1 : 0;
    const rows = [];
    for (let r = 0; r < height; r++) {
      const line = grid.get(r);
      rows.push(Array.from({ length: width }, (_, j) => (line && line.get(j)) || ''));
    }
    sheets.push({ name, rows, cut });
    budget();
  }
  if (!all) refuse(CANNOT_READ);
  /* someNoValues: some cells are formulas with no saved value, beside cells that have one (a workbook partly written by a
     script), so the viewer can say why those cells are blank. noValues: every value is missing that way. */
  return { sheets, moreSheets: Math.max(0, all - MAX_SHEETS), noValues: !anyValue && anyFormula, empty: !anyValue && !anyFormula,
    ...(anyValue && bareFormula ? { someNoValues: true } : {}) };
}

module.exports = {
  readXlsx, XlsxRefusal, MAX_FILE_BYTES, MAX_ROWS, MAX_COLS, MAX_SHEETS, MAX_CELL_CHARS, WORK_BUDGET_MS, TOO_LARGE, CANNOT_READ,
  _internal: { unescapeXml, cellRef, serialDate, serialTime, styleKinds, formatKind, builtinKind, bareCode, clean, attr, shownNumber, shownDuration, setClockForTests: (fn) => { now = fn || (() => Date.now()); } },
};
