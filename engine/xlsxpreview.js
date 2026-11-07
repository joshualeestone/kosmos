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
 * Untrusted input, and the work and the answer are bounded (review 1 measured a 1.7 KB file hanging the board for
 * minutes, and a 77 KB one costing 19 s; review 5 a 404 KB one making a 100 MB answer):
 * - the zip is read by engine/win32zip.js's checked reader (entry count, sizes, overlapping entries, a deflate capped
 *   at its declared size);
 * - every XML part is capped in size and scanned forward with indexOf; the patterns that run on a whole part or body
 *   (the prefix strip, the entity decode, the ISO date tidy) have no nested repetition, so they are linear; the rest run
 *   on a short, capped piece (a start tag, a format code, a saved number of at most MAX_NUMBER_CHARS);
 * - comments are cut and CDATA unwrapped first, so neither can hide or fake a value; namespace prefixes are dropped;
 * - each worksheet part is read once, however many sheets name it, and reading a sheet stops after MAX_VISITS rows and
 *   cells walked, shown or not (review 4: a row number that never grew walked a whole part);
 * - the whole read has a time budget (WORK_BUDGET_MS), checked every 1024 steps of the loops over parts, strings,
 *   styles, sheets, rows and cells, and after each part; past it the answer is "too large to preview". The scans that
 *   have no check inside (clean, a string's phonetic strip) are linear in a capped part; the skip inside `elements` counts each
 *   near-miss, with a cap and a budget check (#8147);
 * - the answer's cells are capped as JSON writes them (MAX_OUTPUT_CHARS, all sheets together), and each shared string
 *   is clipped once, however many cells use it;
 * - the grid is capped (MAX_SHEETS, MAX_ROWS, MAX_COLS, MAX_CELL_CHARS, MAX_SHARED_STRINGS).
 * Anything it cannot read is a XlsxRefusal with a sentence a person can be shown.
 *
 * Built-ins only (package.json has no dependencies; SheetJS was considered and rejected on the card).
 */
const { readZipDirectory, entryContents } = require('./win32zip');
const { cutUnits } = require('./textcut');

const MAX_FILE_BYTES = 10 * 1024 * 1024;      // over this, "too large to preview" (the button still downloads it)
const MAX_PART_BYTES = 16 * 1024 * 1024;      // one XML part, unpacked
const MAX_SHEETS = 20;
const MAX_ROWS = 200;                          // per sheet
const MAX_COLS = 50;
const MAX_CELL_CHARS = 500;
const MAX_SHARED_STRINGS = 200000;
const MAX_EXCEL_ROW = 1048576;
const MAX_TEXT_RUNS = 4000000;                 // text runs in strings, per read (#8147 review r3: 200000 rich strings fit)
const MAX_NEAR_MISSES = 1000000;               // tags that only start like one sought, per read (#8147)
const MAX_VISITS = 100000;                     // rows and cells walked per sheet, shown or not (review 4)
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024;      // the answer's cells as JSON writes them, all sheets (review 5)
const MAX_TAG_CHARS = 4096;                    // a start tag longer than this has no attributes we read
const MAX_FORMAT_CODE = 255;                   // Excel's own limit on a number format code
const WORK_BUDGET_MS = 2000;                   // the whole read, on the board's one thread

const TOO_LARGE = 'This spreadsheet is too large to preview.';
/* A saved number as Excel writes one. Review 7: the round-6 pattern put [0-9]+ beside [0-9]* and backtracked on a long
   run of digits (an 841-byte file blocked the board 4.7 s, 300k digits 43 s, inside one step the budget cannot see), so
   the pattern is unambiguous AND a value longer than any number Excel writes is not tried at all. */
const DECIMAL = /^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
const MAX_NUMBER_CHARS = 400;
const isDecimal = (raw) => raw.length <= MAX_NUMBER_CHARS && DECIMAL.test(raw.trim());
const CANNOT_READ = 'This file could not be read as a spreadsheet.';

class XlsxRefusal extends Error { constructor(message, slow = false) { super(message); this.name = 'XlsxRefusal'; this.slow = slow; } }
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
/* #8147: a tag that only starts like the one sought ("<cx" when looking for "<c") is skipped one character on, and a
   part can hold millions of them (1 to 2 s of board time a file, under the budget and unseen by the walk's visit
   count). Each skip counts: the budget is checked every 4096, and past MAX_NEAR_MISSES in one read it is too large.
   `onNearMiss` is set by readXlsx for the length of one read; the board's one thread runs one read at a time. */
let onNearMiss = null;
const nearMiss = () => { if (onNearMiss) onNearMiss(); };
/* #8147 review r3: so are a string's text runs (3.9M "<t/>" in one 16 KB file cost 0.3 to 0.5 s, unseen likewise): each
   run is counted toward its own cap, with the same budget check. */
let onTextRun = null;
/* #8162: an element whose start tag has no ">", or that no closing tag of its name follows anywhere (a part cut short),
   is never read, as before (a container, sheetData or row, still yields the rest of the part); and one whose body holds another start tag of its own name (its close is missing mid-part,
   so it swallowed the next one, review r1) is read as found. Each is counted (`cutShorts`, reset for each read): a sheet
   whose walk counted one is cut, and a workbook where one was counted anywhere (shared strings, the sheet list) is
   never called "empty" or "no saved values". */
let cutShorts = 0;
/* Every element named `name` in `xml`, as { tag, body, end } (body '' for a self-closed one), found with indexOf. With
   `lenient` (the containers: sheetData, row), one the part never closes (a file cut short) yields the rest of the part,
   so what is there is still read; a value that is not closed is never read. */
/* The ">" that ends the start tag at `i`, outside quotes: a raw ">" is legal inside an attribute value
   (formatCode="[>100]0", a sheet named "A>B"), and taking the first ">" cut such a tag short (review r2). -1 if none.
   One forward pass over the tag. */
function startTagEnd(xml, i) {
  let quote = null;
  for (let j = i + 1; j < xml.length; j++) {
    const ch = xml[j];
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return j;
  }
  return -1;
}
/* Whether `body` holds a start tag named `name` ("<c " or "<c>" or "<c/", not "<cols"). One forward indexOf pass. */
function nestedStart(body, name) {
  for (let at = body.indexOf('<' + name); at >= 0; at = body.indexOf('<' + name, at + 1)) {
    const after = body[at + name.length + 1];
    if (after === ' ' || after === '>' || after === '/' || after === '\t' || after === '\n' || after === '\r') return true;
  }
  return false;
}
function* elements(xml, name, lenient = false) {
  let at = 0;
  for (;;) {
    let i = xml.indexOf('<' + name, at);
    if (i < 0) return;
    const after = xml[i + name.length + 1];
    if (after !== ' ' && after !== '>' && after !== '/' && after !== '\t' && after !== '\n' && after !== '\r') { at = i + 1; nearMiss(); continue; }
    const tagEnd = startTagEnd(xml, i);
    if (tagEnd < 0) { cutShorts++; return; }
    const tag = xml.slice(i, tagEnd + 1);
    if (tag.endsWith('/>')) { yield { tag, body: '', end: tagEnd + 1 }; at = tagEnd + 1; continue; }
    const close = xml.indexOf('</' + name + '>', tagEnd);
    // A container never closed (a part cut short) still yields what is there, and is counted like any other (review r2).
    if (close < 0) { cutShorts++; if (lenient) yield { tag, body: xml.slice(tagEnd + 1), end: xml.length }; return; }
    const body = xml.slice(tagEnd + 1, close);
    if (nestedStart(body, name)) cutShorts++;
    yield { tag, body, end: close + name.length + 3 };
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
      // Review 4: a self-closed <rPh/> has no reading to drop (the text after it was lost).
      const tagEnd = shown.indexOf('>', i);
      if (tagEnd > 0 && shown[tagEnd - 1] === '/') { at = tagEnd + 1; continue; }
      const close = shown.indexOf('</rPh>', i);
      if (close < 0) break;
      at = close + 6;
    }
    shown = out;
  }
  let out = '';
  for (const t of elements(shown, 't')) { if (onTextRun) onTextRun(); out += unescapeXml(t.body); }
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
/* A cell cut to MAX_CELL_CHARS, never through the middle of a character outside the BMP (review 5: an emoji was halved);
   the one cut the CSV reader uses too (review 7), on engine/textcut.js's cutUnits. */
const clip = (s) => (s.length > MAX_CELL_CHARS ? cutUnits(s, MAX_CELL_CHARS - 1) + '…' : s);

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
   { kind: 'number', decimals, thousands, percent, digits, sections } for the simple codes ("0.00", "#,##0", "0.0%"), or null (shown as
   saved), with `negative` (the second section's reading and its sign) when a code has one. The first section decides
   positives; a negative is drawn by a simple second section (see negativeKind), else shown as saved (a percent: -N% by
   the first section); a zero under a code with a zero section is shown as saved. Currency symbols, fractions, a
   trailing thousands comma and the rest are null. */
/* A number format's first section (the part before the first ";", which positive numbers use). Not a split: ";" here is
   Excel's section separator, never a path list, and indexOf says so without a separator literal (#1732). */
function firstSection(code) {
  const s = String(code || '');
  const i = s.indexOf(';');
  return i < 0 ? s : s.slice(0, i);
}
/* The k-th (0-based) ";" section of a format code, with quotes and escapes respected, or null (#8147 review r4). */
function sectionAt(code, k) {
  const s = String(code || '').slice(0, MAX_FORMAT_CODE + 1);
  let start = 0, n = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i < s.length && s[i] === '\\') { i++; continue; }
    if (i < s.length && s[i] === '"') { const j = s.indexOf('"', i + 1); if (j < 0) break; i = j; continue; }
    if (i === s.length || s[i] === ';') { if (n === k) return s.slice(start, i); n++; start = i + 1; }
  }
  return null;
}
/* How many ";" sections a format code has, not counting a ";" inside quotes or after a backslash (review r2). */
function countSections(code) {
  const s = String(code || '');
  let n = 1;
  for (let i = 0; i < s.length && i <= MAX_FORMAT_CODE; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') { const j = s.indexOf('"', i + 1); if (j < 0) break; i = j; continue; }
    if (s[i] === ';') n++;
  }
  return n;
}
/* Review r4: a negative is drawn by the second section, which carries its own sign or none ("0%;[Red]0%" shows 50% in
   red, "#,##0;(#,##0)" shows (5)). When that section is itself a simple code (a leading colour stripped; a condition is not simple), the
   value's size is drawn through it with that section's sign (brackets, or a minus); otherwise it is shown as saved. */
function negativeKind(code) {
  if (countSections(code) < 2) return null;
  const raw = sectionAt(code, 1);
  // A leading colour ("[Red]", "[Color10]") only colours it; any other bracket (a currency, a condition) is not simple.
  let second = raw === null ? null : raw.replace(/^\s*(?:\[(?:black|blue|cyan|green|magenta|red|white|yellow|color[0-9]{1,2})\]\s*){1,2}/i, '');
  if (second === null || second.trim() === '') return null;
  // Review r5/r6: the sign this section draws. Brackets, "(#,##0)", are drawn as brackets; a leading "-" as a minus; a
  // section with no sign of its own (a colour alone, "0.00;[Red]0.00", or none at all, "0;0") still gets a minus: a
  // colour is the only sign Excel shows there and this preview shows none, and a negative must never read as positive
  // (in "0;0" Excel itself drops the sign; here it is kept, the safe direction).
  let sign = 'minus';
  const t = second.trim();
  if (t.length > 2 && t[0] === '(' && t[t.length - 1] === ')') { sign = 'brackets'; second = t.slice(1, -1); }
  else if (t[0] === '-') second = t.slice(1);
  const k = formatKind(second);
  return k && k.kind === 'number' ? { ...k, sign } : null;
}
function formatKind(code) {
  const bare = bareCode(firstSection(code));
  if (bare === null) return null;
  const lower = bare.toLowerCase();
  const dur = /^(h+|m+|s+)/.exec(lower);
  if (dur && /\[(h+|m+|s+)\]/i.test(firstSection(code))) return { kind: 'duration', unit: dur[1][0], seconds: /s/.test(lower.slice(dur[1].length)) || dur[1][0] === 's' };
  // Review 4: a date code with no hour or second shows no time (yyyy-mm-dd on 45000.5 showed 12:00), and a time code says
  // whether it is 12-hour and whether it has hours and seconds (h:mm AM/PM showed 18:00, mm:ss showed the hour).
  const time = /[hs]/.test(lower);
  const ampm = /am\/pm|a\/p/.test(lower);
  // Review 5: a date with a time keeps its clock too (m/d/yyyy h:mm AM/PM showed 18:00, and yyyy-mm-dd hh:mm a second).
  if (/[dy]/.test(lower)) return { kind: 'date', time, ampm, seconds: /s/.test(lower) };
  if (time) return { kind: 'time', ampm, hours: /h/.test(lower), seconds: /s/.test(lower) };
  if (/m/.test(lower) && !/^[#0.,%\s]*$/.test(lower)) return { kind: 'date', time: false };   // "mmm" alone is a month
  // Only a code of digit placeholders (review 3: a currency or a unit, quoted or in brackets, was dropped from the shown
  // text); anything else shows the saved number.
  if (!/^[#0.,%\s]+$/.test(firstSection(code))) return null;
  // #8147: a comma after the last digit divides by 1000 ("#,##0," is thousands): shown as saved rather than wrong.
  if (/[#0],+\s*(\.|%|$)/.test(lower)) return null;
  const num = /^\s*([#0,]*)(?:\.(0+))?\s*(%)?\s*$/.exec(lower);
  // Review 4: past 30 places (Excel's own limit) toFixed throws, which refused the whole workbook.
  if (num && num[2] && num[2].length > 30) return null;
  // Review 7: the integer zeros are the fewest digits shown ("00000" on 1234 is 01234, a ZIP code or an id).
  // #8147: `sections` counts the code's ";" parts: the first is for positives (and zero, with fewer than three); a value
  // another section draws goes through that section when it is simple (`negative`), else is shown as saved (review r1:
  // "#,##0.00;[Red]..." lost its formatting for positives when every multi-section code was shown as saved).
  if (num && (num[1] || num[2] || num[3])) return { kind: 'number', decimals: num[2] ? num[2].length : 0, thousands: (num[1] || '').indexOf(',') >= 0, percent: !!num[3], digits: ((num[1] || '').match(/0/g) || []).length, sections: countSections(code), negative: negativeKind(code) };
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
  if (id >= 14 && id <= 17) return { kind: 'date', time: false };
  if (id === 22) return { kind: 'date', time: true, ampm: false, seconds: false };
  if ((id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return { kind: 'date' };   // locale codes: a time only when saved
  if (id === 46) return { kind: 'duration', unit: 'h', seconds: true };
  if (id === 18 || id === 19) return { kind: 'time', ampm: true, hours: true, seconds: id === 19 };
  if (id === 20 || id === 21) return { kind: 'time', ampm: false, hours: true, seconds: id === 21 };
  if (id === 45 || id === 47) return { kind: 'time', ampm: false, hours: false, seconds: true };
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
function serialDate(n, from1904 = false, fmt = null) {
  if (!Number.isFinite(n) || n < 0 || n > (from1904 ? 2957003 : 2958465)) return String(n);   // past 9999-12-31: as saved
  n = Math.round(n * 86400) / 86400;   // review 2: to the second first, so a time just before midnight carries into the next day
  const timePart = (x) => {
    const show = fmt && fmt.time !== undefined ? fmt.time : x % 1 !== 0;
    return show ? ' ' + serialTime(x, fmt && fmt.time ? { ampm: fmt.ampm, hours: true, seconds: fmt.seconds } : null) : '';
  };
  if (!from1904 && Math.floor(n) === 60) return '1900-02-29' + timePart(n);
  if (!from1904 && Math.floor(n) === 0) return '1900-01-00' + timePart(n);   // review 4: Excel's day 0, as Excel shows it
  const days = from1904 ? n + 1462 : (n < 60 ? n + 1 : n);
  const ms = Math.round((days - 25569) * 86400000);   // 25569 = 1970-01-01 in the 1900 system
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(n);
  return d.toISOString().slice(0, 10) + timePart(n);
}
/* The time of day in a serial: HH:MM (with :SS when it has seconds); with a time format's reading (formatKind), its
   12-hour clock ("6:00 PM"), its seconds, and no hour when the code has none ("mm:ss"). */
function serialTime(n, fmt = null) {
  // #8147 review r6: a negative time is no time of day (Excel shows ####; "h:mm" on -0.5 read as 12:00): shown as saved.
  if (!Number.isFinite(n) || n < 0) return String(n);
  const secs = Math.round((((n % 1) + 1) % 1) * 86400) % 86400;
  const h24 = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = secs % 60;
  const showSecs = fmt && fmt.seconds !== undefined ? fmt.seconds : ss !== 0;
  const tail = showSecs ? ':' + String(ss).padStart(2, '0') : '';
  if (fmt && fmt.hours === false) return mm + tail;
  if (fmt && fmt.ampm) return String(h24 % 12 || 12) + ':' + mm + tail + (h24 < 12 ? ' AM' : ' PM');
  return String(h24).padStart(2, '0') + ':' + mm + tail;
}
/* A saved number as a person reads it: no float noise (0.30000000000000004 is 0.3); with a simple number format, its
   decimal places, its thousands separator (as en-US writes them) and its percent sign, rounded half away from zero as
   Excel does (0.075 under "0%" is 8%). */
function shownNumber(raw, fmt) {
  const n = Number(raw);
  // Review 6: only a decimal number is a number (0x1F is not 31).
  if (!isDecimal(raw) || !Number.isFinite(n)) return raw;
  if (!fmt || fmt.kind !== 'number') return String(Number(n.toPrecision(15)));
  // Review r4/r5: a negative under a code with a second section is drawn by that section, with that section's sign
  // (brackets, or a minus: see negativeKind); one that is not a simple code is shown as saved (a percent then keeps its unit by the first section, -50%, as the nearest
  // honest form: -0.5 alone read as -0.5% in a column of 25%, review r2). A zero under a code with a zero section is
  // shown as saved.
  if (fmt.sections > 1 && n < 0) {
    if (fmt.negative) {
      const drawn = shownNumber(String(-n), fmt.negative);
      return fmt.negative.sign === 'brackets' ? '(' + drawn + ')' : '-' + drawn;
    }
    if (!fmt.percent) return String(Number(n.toPrecision(15)));
  }
  if (fmt.sections > 2 && n === 0) return String(Number(n.toPrecision(15)));
  const v = Number((fmt.percent ? n * 100 : n).toPrecision(15));
  const f = Math.pow(10, fmt.decimals);
  // Review 7: rounded on the 15 digits Excel keeps, not with a nudge (2.4999999995 under "0" showed 3).
  const rounded = Math.sign(v) * Math.round(Number((Math.abs(v) * f).toPrecision(15))) / f;
  let text = Math.abs(rounded).toFixed(fmt.decimals);
  if (fmt.digits > 1 && !/e/.test(text)) { const [i, d] = text.split('.'); text = i.padStart(fmt.digits, '0') + (d ? '.' + d : ''); }
  if (fmt.thousands) { const [i, d] = text.split('.'); text = i.replace(/\B(?=(\d{3})+$)/g, ',') + (d ? '.' + d : ''); }
  // #8147: a code with no integer digit drops the leading zero (".00" on 0.5 is .50), and a negative that rounds to zero
  // keeps its sign (-0.4 under "0" is -0), as Excel shows them.
  if (fmt.digits === 0 && fmt.decimals > 0 && text.startsWith('0.')) text = text.slice(1);   // "#.00" too (review r1)
  if (fmt.digits === 0 && fmt.decimals === 0 && !fmt.percent && text === '0') return v < 0 ? '-' : '';   // "#" shows no zero (r3)
  return (v < 0 ? '-' : '') + text + (fmt.percent ? '%' : '');
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
 * Reads `buf` (a whole .xlsx in memory) to `{ sheets: [{ name, rows, cut, notGrid?, firstRow? }], moreSheets, noValues,
 * empty, someNoValues? }`. `firstRow` (1-based) is there only when the rows shown do not start at row 1.
 * `rows` is an array of arrays of strings, as many columns as the widest row (up to MAX_COLS); `cut` is true when a value
 * in the sheet is not shown (past the rows, the columns, the walk or the answer's size). Sheets past MAX_SHEETS are left out and `moreSheets` counts them.
 */
function readXlsx(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('xlsxpreview: readXlsx takes a Buffer');
  if (buf.length > MAX_FILE_BYTES) refuse(TOO_LARGE);
  const started = now();
  // `slow`: refused for the time it took, which a busy moment can cause (the seam does not remember it, review 6).
  const budget = () => { if (now() - started > WORK_BUDGET_MS) throw new XlsxRefusal(TOO_LARGE, true); };
  let misses = 0;
  let runs = 0;
  const outer = onNearMiss, outerRun = onTextRun, outerCut = cutShorts;
  cutShorts = 0;
  onNearMiss = () => { if (++misses > MAX_NEAR_MISSES) refuse(TOO_LARGE); if ((misses & 4095) === 0) budget(); };
  onTextRun = () => { if (++runs > MAX_TEXT_RUNS) refuse(TOO_LARGE); if ((runs & 4095) === 0) budget(); };
  try { return readBook(buf, budget); } finally { onNearMiss = outer; onTextRun = outerRun; cutShorts = outerCut; }
}
function readBook(buf, budget) {
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
  let sharedCut = false;
  const sst = part('xl/sharedStrings.xml');
  if (sst) {
    let k = 0;
    for (const si of elements(sst, 'si')) {
      if (shared.length >= MAX_SHARED_STRINGS) { sharedCut = true; break; }
      shared.push(clip(textOf(si.body)));   // review 5: clipped once, not once per cell that uses it
      if ((++k & 1023) === 0) budget();
    }
  }
  const kinds = styleKinds(part('xl/styles.xml') || '', budget);

  const sheets = [];
  const readTargets = new Set();   // review 1: a part named by several sheets is read once
  let all = 0, anyValue = false, anyFormula = false, bareFormula = false;
  let otherSheet = false;   // a chart or dialog sheet that is in the file
  let savedFormula = false; // #8147: a formula whose saved value is an empty string
  let walkCut = false;      // #8147: something in a sheet was not read (the walk stopped at MAX_VISITS, or a row or cell
                            // could not be placed), so what it held is unknown to the answer
  let outputLeft = MAX_OUTPUT_CHARS;   // review 5: for the whole answer, every sheet together
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
    if (!/^worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target) || readTargets.has(target)) {
      if (!readTargets.has(target) && byName.has('xl/' + target)) otherSheet = true;
      sheets.push({ name, rows: [], cut: false, notGrid: true });
      continue;
    }
    readTargets.add(target);
    const xml = part('xl/' + target);
    // Review 3: a part that is not in the file (damaged, or a name the lister leaves out) is not a grid, never "empty".
    if (xml === null) { sheets.push({ name, rows: [], cut: false, notGrid: true }); continue; }
    // Review 4/5: rows are gathered by number, and the window shown is placed only once the walk is done: at row 1, or at
    // the smallest row holding a value when that is past the cap (data starting at row 300 showed as empty; a far row
    // first in the file hid row 1). Only rows inside a window of the smallest so far are kept, so at most MAX_ROWS rows
    // are held. What bounds the walk is MAX_VISITS, rows and cells together, shown or not (a row number that never grows,
    // or cells past the last column, walked a whole 16 MB part, about 2 s a request). `cut` means a VALUE was left out
    // (review 5: a formatted blank past column 50, or an empty row far down, as Excel writes them, said "more").
    const kept = new Map();   // row -> Map(col -> text)
    let minRow = Infinity;
    let cut = false;
    const cutShortsBefore = cutShorts;   // review r1: before the sheetData search, which can count one too
    const data = elements(xml, 'sheetData', true).next().value;
    let rowAt = -1;
    let k = 0;
    let visits = 0;
    const keepRow = (row, line) => {
      anyValue = true;
      if (row < minRow) {
        minRow = row;   // the window may move up: rows now below its end are left out
        const end = windowEnd();
        for (const r of [...kept.keys()]) if (r >= end) { kept.delete(r); cut = true; }
      }
      if (row >= windowEnd()) { cut = true; return; }
      if (!kept.has(row)) kept.set(row, new Map());
      for (const [col, text] of line) kept.get(row).set(col, text);
    };
    const windowStart = () => (minRow < MAX_ROWS ? 0 : minRow);
    /* A row or cell that is not placed (past the last row, or a start tag too long to read), by what its body holds
       (review r6/r7): a saved value or string is a cut and keeps the answer from "empty"; a formula with no saved value
       keeps it from "no saved values" and is counted as one with none (so the viewer can say why the grid is blank); an
       empty <v/>, as openpyxl writes it, is no value. */
    const skipped = (body) => {
      // #8162: by the reader's own scan, so a value with attributes (<v xml:space="preserve">) counts too; a pattern
      // allowing attributes would be quadratic on a run of unclosed "<v " tags.
      let saved = false;
      for (const v of elements(body, 'v')) if (v.body !== '') { saved = true; break; }
      if (!saved) for (const s of elements(body, 'is')) if (textOf(s.body) !== '') { saved = true; break; }
      if (saved) { cut = true; walkCut = true; }
      else if (/<f[\s>]/.test(body)) { walkCut = true; bareFormula = true; }
    };
    /* A cell's shown text, or null when it holds no saved value. */
    const cellText = (c, hasFormula) => {
      const type = attr(c.tag, 't') || 'n';
      let text = null;
      let savedEmpty = false;
      if (type === 'inlineStr') {
        const is = elements(c.body, 'is').next().value;
        text = is ? textOf(is.body) : null;
        if (text === '') { text = null; savedEmpty = true; }   // #8147: an empty inline string, as an empty shared one
      } else {
        const v = elements(c.body, 'v').next().value;
        // Review 1: an empty <v/> (as openpyxl writes beside a formula) is no saved value, not an empty one. Review 4:
        // except a text result (t="str"), where an empty <v></v> is the saved "" of a formula such as IF(A1,"","").
        if (v && (v.body !== '' || type === 'str')) {
          const raw = unescapeXml(v.body);
          if (type === 's') {
            const n = /^[0-9]{1,9}$/.test(raw.trim()) ? Number(raw) : -1;   // review 6: a decimal index, never 0x1
            // Review 4: a string past the ones read (MAX_SHARED_STRINGS) is not shown, and the sheet says it is cut.
            if (n >= shared.length && sharedCut) { cut = true; anyValue = true; savedEmpty = true; }   // review 7: so a cut sheet is not "empty"; r7: it has a saved value
            text = shared[n] ?? null;   // review 6: an index to no string is no value (it made a blank workbook not empty)
            // #8147: an empty string shows nothing, so it is not a value for `empty`; but it IS a saved value, so a formula
            // that saved one is not "no saved value" (review r1: it set someNoValues).
            if (text === '') { text = null; savedEmpty = true; }
          }
          else if (type === 'b') text = raw === '1' || raw.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
          else if (type === 'e') text = raw;
          // #8147 review r3: a text formula that saved "" is answered as an empty shared or inline string is.
          else if (type === 'str') { text = raw; if (text === '') { text = null; savedEmpty = true; } }
          // Review 3: an ISO date cell (t="d", as openpyxl with iso_dates, SheetJS and Strict OOXML write) is shown as its
          // date, never handed to the serial reader (it showed "NaN").
          else if (type === 'd') {
            text = raw.replace(/T00:00(:00(\.0+)?)?Z?$/, '').replace('T', ' ').slice(0, 16);
            if (text === '') { text = null; savedEmpty = true; }   // review r6: drawn as nothing, as an empty string
          }
          else {
            const fmt = kinds[Number(attr(c.tag, 's') || 0)] || null;
            const kind = fmt && fmt.kind;
            // Review 4: text that is not a number under a date or time format is shown as written, never "NaN".
            text = (kind && kind !== 'number' && (!isDecimal(raw) || !Number.isFinite(Number(raw)))) ? raw
              : kind === 'date' ? serialDate(Number(raw), from1904, fmt)
                : kind === 'time' ? serialTime(Number(raw), fmt)
                  : kind === 'duration' ? shownDuration(Number(raw), fmt)
                    : shownNumber(raw, fmt);
            if (text === '') { text = null; savedEmpty = true; }   // review r4: drawn as nothing ("#" on 0.4), as an empty string
          }
        }
      }
      // #8147 review r2: a formula that saved "" has a saved value, so it is never "no saved values" either.
      if (text === null) { if (hasFormula && !savedEmpty) bareFormula = true; if (hasFormula && savedEmpty) savedFormula = true; return null; }
      return clip(text);
    };
    const windowEnd = () => windowStart() + MAX_ROWS;
    rows: for (const row of data ? elements(data.body, 'row', true) : []) {
      if ((++k & 1023) === 0) budget();
      if (++visits > MAX_VISITS) { cut = true; walkCut = true; break; }
      // Review r6: a start tag past MAX_TAG_CHARS has no attribute read (attr), so its row number is unknown: the row is
      // not placed (it landed on the next real row), and a value in it is unknown to the answer.
      if (row.tag.length > MAX_TAG_CHARS) { skipped(row.body); continue; }
      const rs = (attr(row.tag, 'r') || '').trim() || null;   // review r7: XML integers may carry spaces (" 5")
      // Decimal only (r2); review r5: any length (the tag is capped), so 41 digits are past the last row, not "no r".
      const digits = rs !== null && /^[0-9]+$/.test(rs) ? rs.replace(/^0+(?=.)/, '') : null;
      const rr = digits === null ? NaN : digits.length > 7 ? Infinity : Number(digits);
      // #8147: a row number past Excel's last row (1048576), however many digits, is no row of the sheet: skipped, not
      // placed on another row. Review r3: what it held is unknown to the answer (never "empty"), and an empty one is no cut.
      // Review r7: so is a row with no r that would come after the last row.
      if (rr > MAX_EXCEL_ROW || (!(rr >= 1) && rowAt + 1 >= MAX_EXCEL_ROW)) { skipped(row.body); continue; }
      rowAt = rr >= 1 ? rr - 1 : rowAt + 1;   // a row with no r (or one that is not a number) is the next one (review 1)
      const line = new Map();
      let colAt = -1;
      for (const c of elements(row.body, 'c')) {
        if ((++k & 1023) === 0) budget();
        if (++visits > MAX_VISITS) { cut = true; walkCut = true; if (line.size) keepRow(rowAt, line); break rows; }
        // Review r6: likewise a cell whose start tag is too long to read has no known column: not placed.
        if (c.tag.length > MAX_TAG_CHARS) { skipped(c.body); continue; }
        const at = cellRef(attr(c.tag, 'r'));
        const col = at ? at[1] : colAt + 1;                          // a cell with no r is the next column
        colAt = col;
        const hasFormula = c.body.indexOf('<f') >= 0;
        if (hasFormula) anyFormula = true;
        const text = cellText(c, hasFormula);
        if (text === null) continue;
        if (col >= MAX_COLS) { cut = true; anyValue = true; continue; }   // a value past the last column is left out
        line.set(col, text);
      }
      if (line.size) keepRow(rowAt, line);
    }
    const base = Number.isFinite(minRow) ? windowStart() : 0;   // review 6: a sheet with no row kept starts at row 1
    let width = 0;
    for (const line of kept.values()) for (const col of line.keys()) if (col + 1 > width) width = col + 1;
    const height = kept.size ? Math.max(...kept.keys()) - base + 1 : 0;
    const rows = [];
    for (let r = 0; r < height; r++) {
      const line = kept.get(base + r);
      const out = Array.from({ length: width }, (_, j) => (line && line.get(j)) || '');
      // Review 5: the answer itself is bounded (a 404 KB file of one long shared string in every cell made a 100 MB
      // reply, and a copy that would not fit in a string crashed the board). Counted as JSON writes it.
      let cost = 1;
      for (const t of out) cost += t === '' ? 3 : JSON.stringify(t).length + 1;
      if (cost > outputLeft) { cut = true; outputLeft = 0; break; }
      outputLeft -= cost;
      rows.push(out);
    }
    if (cutShorts > cutShortsBefore) { cut = true; walkCut = true; }   // #8162: an element cut off in this sheet
    sheets.push({ name, rows, cut, ...(base ? { firstRow: base + 1 } : {}) });
    budget();
  }
  if (!all) refuse(CANNOT_READ);
  /* someNoValues: some cells are formulas with no saved value, beside cells that have one or beside a part that was not
     read (so "no saved values" cannot be claimed), so the viewer can say why those cells are blank. noValues: every
     value is missing that way. */
  // Review 6: past MAX_SHEETS the sheets left out are never read, so nothing is known about them: neither empty nor
  // "no saved values" is said of a workbook with sheets left out.
  // Review 7: a chart or dialog sheet is something, so a workbook that has one is not "empty" (a sheet whose part is
  // missing is still nothing, review 3).
  // #8147: nor of one whose walk stopped before the end (formatted blanks, then a value, read as "empty").
  const unread = all > MAX_SHEETS || otherSheet || walkCut || cutShorts > 0;   // #8162 r1: an element lost anywhere
  return { sheets, moreSheets: Math.max(0, all - MAX_SHEETS), noValues: !unread && !anyValue && anyFormula && !savedFormula, empty: !unread && !anyValue && !anyFormula,
    // Review r5: and when what was not read keeps "no saved values" unclaimed, the formulas that were read still say why.
    ...((anyValue || savedFormula || unread) && bareFormula ? { someNoValues: true } : {}) };
}

module.exports = {
  readXlsx, XlsxRefusal, clip, MAX_FILE_BYTES, MAX_ROWS, MAX_COLS, MAX_SHEETS, MAX_CELL_CHARS, WORK_BUDGET_MS, TOO_LARGE, CANNOT_READ,
  _internal: { unescapeXml, cellRef, serialDate, serialTime, styleKinds, formatKind, builtinKind, bareCode, clean, attr, shownNumber, shownDuration, setClockForTests: (fn) => { now = fn || (() => Date.now()); } },
};
