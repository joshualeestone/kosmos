'use strict';
/**
 * kosmos#8122 (Josh 11-06: "It's a spreadsheet so I don't know why we couldn't render a spreadsheet view. Obviously
 * they couldn't edit it or change it or do anything but just showing something here"): a read-only look at an .xlsx,
 * for the file viewer.
 *
 * What it reads, and nothing else: the workbook's sheet names, its shared strings, the number formats that say a
 * number is a date, and each cell's SAVED value (`<v>`, an inline string, a boolean, an error code). A formula is
 * never read as anything but the value saved with it; a link is never followed; nothing outside the file is loaded;
 * no code in the file runs. A workbook with formulas but no saved values (one a script wrote) is said as such
 * (`noValues`), never drawn as an empty grid.
 *
 * Untrusted input: the zip is read by engine/win32zip.js's checked reader (entry count, sizes, overlapping entries,
 * a deflate capped at its declared size); every XML part is capped in size and scanned with indexOf, never a
 * backtracking pattern over the whole part; the grid is capped (MAX_SHEETS, MAX_ROWS, MAX_COLS, MAX_CELL_CHARS).
 * Anything it cannot read is a XlsxRefusal with a sentence a person can be shown.
 *
 * Built-ins only (package.json has no dependencies; SheetJS was considered and rejected on the card).
 */
const { readZipDirectory, entryContents } = require('./win32zip');

const MAX_FILE_BYTES = 10 * 1024 * 1024;      // over this, "too large to preview" (the button still downloads it)
const MAX_PART_BYTES = 30 * 1024 * 1024;      // one XML part, unpacked
const MAX_SHEETS = 20;
const MAX_ROWS = 200;                          // per sheet
const MAX_COLS = 50;
const MAX_CELL_CHARS = 500;
const MAX_SHARED_STRINGS = 200000;

class XlsxRefusal extends Error { constructor(message) { super(message); this.name = 'XlsxRefusal'; } }
const refuse = (m) => { throw new XlsxRefusal(m); };

const ZIP_LIMITS = {
  allowedTopLevel: ['[Content_Types].xml', '_rels', 'docProps', 'xl', 'customXml'],
  maxEntries: 2000, maxEntryBytes: MAX_PART_BYTES, maxTotalBytes: 4 * MAX_PART_BYTES,
};

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
/* One attribute of a start tag (`<c r="B3" t="s">`), or null. The tag is short, so the pattern runs on it alone. */
function attr(tag, name) {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
  return m ? unescapeXml(m[1]) : null;
}
/* Every element named `name` in `xml`, as { tag, body } (body '' for a self-closed one), found with indexOf. With
   `lenient` (the containers: sheetData, row), one the part never closes (a file cut short) yields the rest of the part, so
   what is there is still read; a value that is not closed is never read. */
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
    if (tag.endsWith('/>')) { yield { tag, body: '' }; at = tagEnd + 1; continue; }
    const close = xml.indexOf('</' + name + '>', tagEnd);
    if (close < 0) { if (lenient) yield { tag, body: xml.slice(tagEnd + 1) }; return; }   // a container cut short: what is there is read
    yield { tag, body: xml.slice(tagEnd + 1, close) };
    at = close + name.length + 3;
  }
}
/* The text of every <t> in a body (rich text has several runs), joined. */
function textOf(body) {
  let out = '';
  for (const t of elements(body, 't')) out += unescapeXml(t.body);
  return out;
}
/* "B3" -> [row 2, column 1] (0-based); null for anything else. */
function cellRef(ref) {
  const m = /^([A-Z]{1,3})([0-9]{1,7})$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [parseInt(m[2], 10) - 1, col - 1];
}
const clip = (s) => (s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS - 1) + '…' : s);

/* Which cell styles show a number as a date: the built-in date formats (14 to 22, 45 to 47) and any custom format
   whose code has a day, month or year in it (outside quotes and brackets). */
function dateStyles(stylesXml) {
  const custom = new Map();
  for (const f of elements(stylesXml, 'numFmt')) custom.set(Number(attr(f.tag, 'numFmtId')), attr(f.tag, 'formatCode') || '');
  const isDateCode = (code) => /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]*$/.test(code);
  const out = [];
  const xfs = elements(stylesXml, 'cellXfs').next().value;
  if (!xfs) return out;
  for (const x of elements(xfs.body, 'xf')) {
    const id = Number(attr(x.tag, 'numFmtId') || 0);
    out.push((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && isDateCode(custom.get(id))));
  }
  return out;
}
/* An Excel serial date (the 1900 system) as YYYY-MM-DD, with the time when it has one. */
function serialDate(n) {
  if (!Number.isFinite(n) || n < 0 || n > 2958465) return String(n);
  const ms = Math.round((n - 25569) * 86400000);   // 25569 = 1970-01-01
  const d = new Date(ms);
  const day = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return n % 1 === 0 ? day : day + ' ' + time;
}

/**
 * Reads `buf` (a whole .xlsx in memory) to `{ sheets: [{ name, rows, cut }], noValues }`. `rows` is an array of
 * arrays of strings, as many columns as the widest row (up to MAX_COLS); `cut` is true when the sheet had more rows
 * or columns than shown. Sheets past MAX_SHEETS are left out and `moreSheets` counts them.
 */
function readXlsx(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('xlsxpreview: readXlsx takes a Buffer');
  if (buf.length > MAX_FILE_BYTES) refuse('This spreadsheet is too large to preview.');
  let entries;
  try { entries = readZipDirectory(buf, ZIP_LIMITS); }
  catch (e) { refuse('This file could not be read as a spreadsheet.'); }
  const byName = new Map(entries.filter((e) => !e.isDirectory).map((e) => [e.name, e]));
  const part = (name) => {
    const e = byName.get(name);
    if (!e) return null;
    try { return entryContents(buf, e).toString('utf8'); }
    catch (err) { refuse('This file could not be read as a spreadsheet.'); }
    return null;
  };
  const workbook = part('xl/workbook.xml');
  if (!workbook) refuse('This file could not be read as a spreadsheet.');
  const rels = new Map();
  for (const r of elements(part('xl/_rels/workbook.xml.rels') || '', 'Relationship')) rels.set(attr(r.tag, 'Id'), attr(r.tag, 'Target') || '');
  const shared = [];
  const sst = part('xl/sharedStrings.xml');
  if (sst) for (const si of elements(sst, 'si')) { if (shared.length >= MAX_SHARED_STRINGS) break; shared.push(textOf(si.body)); }
  const dates = dateStyles(part('xl/styles.xml') || '');

  const sheets = [];
  let all = 0, anyValue = false, anyFormula = false;
  for (const s of elements(workbook, 'sheet')) {
    all++;
    if (sheets.length >= MAX_SHEETS) continue;
    const name = attr(s.tag, 'name') || ('Sheet ' + all);
    let target = rels.get(attr(s.tag, 'r:id')) || '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    // Only a part inside xl/worksheets/ (a chart sheet or a dialog sheet is not a grid; a path that climbs out is not read).
    if (!/^worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target)) { sheets.push({ name, rows: [], cut: false, notGrid: true }); continue; }
    const xml = part('xl/' + target) || '';
    const grid = new Map();   // row -> Map(col -> text)
    let width = 0, cut = false;
    const data = elements(xml, 'sheetData', true).next().value;
    for (const row of data ? elements(data.body, 'row', true) : []) {
      for (const c of elements(row.body, 'c')) {
        const at = cellRef(attr(c.tag, 'r'));
        if (!at) continue;
        const [r, col] = at;
        if (r >= MAX_ROWS || col >= MAX_COLS) { cut = true; continue; }
        if (c.body.indexOf('<f') >= 0) anyFormula = true;
        const type = attr(c.tag, 't') || 'n';
        let text = null;
        if (type === 'inlineStr') {
          const is = elements(c.body, 'is').next().value;
          text = is ? textOf(is.body) : null;
        } else {
          const v = elements(c.body, 'v').next().value;
          if (v) {
            const raw = unescapeXml(v.body);
            if (type === 's') text = shared[Number(raw)] ?? '';
            else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
            else if (type === 'e' || type === 'str') text = raw;
            else {
              const style = Number(attr(c.tag, 's') || 0);
              text = dates[style] ? serialDate(Number(raw)) : raw;
            }
          }
        }
        if (text === null) continue;
        anyValue = true;
        if (!grid.has(r)) grid.set(r, new Map());
        grid.get(r).set(col, clip(text));
        if (col + 1 > width) width = col + 1;
      }
    }
    const height = grid.size ? Math.max(...grid.keys()) + 1 : 0;
    const rows = [];
    for (let r = 0; r < height; r++) {
      const line = grid.get(r);
      rows.push(Array.from({ length: width }, (_, k) => (line && line.get(k)) || ''));
    }
    sheets.push({ name, rows, cut });
  }
  if (!all) refuse('This file could not be read as a spreadsheet.');
  return { sheets, moreSheets: Math.max(0, all - MAX_SHEETS), noValues: !anyValue && anyFormula, empty: !anyValue && !anyFormula };
}

module.exports = { readXlsx, XlsxRefusal, MAX_FILE_BYTES, MAX_ROWS, MAX_COLS, MAX_SHEETS, MAX_CELL_CHARS, _internal: { unescapeXml, cellRef, serialDate, dateStyles } };
