'use strict';
/**
 * kosmos#8122: the read-only spreadsheet preview's reader (engine/xlsxpreview.js). Workbooks are built here with the
 * repo's own zip writer (engine/zipwrite.js), so each case is exactly the bytes it names, hostile ones included.
 *
 *   node --test engine/xlsxpreview.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readXlsx, XlsxRefusal, MAX_ROWS, MAX_COLS, MAX_CELL_CHARS, MAX_FILE_BYTES } = require('./xlsxpreview');
/* The zip builder is shared with the route tests (test-support/xlsxfixture.js), so the two make the same bytes. */
const { zip } = require('../test-support/xlsxfixture');
const WB = (sheets) => '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>'
  + sheets.map((s, i) => `<sheet name="${s}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>';
const RELS = (n, target = (i) => `worksheets/sheet${i}.xml`) => '<Relationships>'
  + Array.from({ length: n }, (_, k) => `<Relationship Id="rId${k + 1}" Target="${target(k + 1)}"/>`).join('') + '</Relationships>';
const SHEET = (rowsXml) => `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
const STYLES = '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
  + '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';
function book(sheetsXml, extra = {}) {
  const names = Object.keys(sheetsXml);
  const parts = { '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': WB(names), 'xl/_rels/workbook.xml.rels': RELS(names.length), 'xl/styles.xml': STYLES };
  names.forEach((n, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetsXml[n]; });
  return zip({ ...parts, ...extra });
}

test('an ordinary workbook: its sheets, in order, with shared and inline strings, numbers, booleans and dates as saved', () => {
  const buf = book({
    Budget: SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>Rent &amp; bills</t></is></c><c r="B2"><v>1250.5</v></c><c r="C2" t="b"><v>1</v></c></row>'
      + '<row r="4"><c r="A4" s="1"><v>45967</v></c><c r="B4" s="2"><v>45967.5</v></c><c r="D4" t="e"><v>#DIV/0!</v></c></row>'),
    'Q4 notes': SHEET('<row r="1"><c r="B1" t="str"><v>done</v></c></row>'),
  }, { 'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><r><t>Cost</t></r><r><t> (USD)</t></r></si></sst>' });
  const out = readXlsx(buf);
  assert.deepEqual(out.sheets.map((s) => s.name), ['Budget', 'Q4 notes']);
  assert.deepEqual(out.sheets[0].rows, [
    ['Item', 'Cost (USD)', '', ''],
    ['Rent & bills', '1250.5', 'TRUE', ''],
    ['', '', '', ''],
    ['2025-11-06', '2025-11-06 12:00', '', '#DIV/0!'],
  ]);
  assert.deepEqual(out.sheets[1].rows, [['', 'done']]);
  assert.equal(out.noValues, false);
  assert.equal(out.sheets[0].cut, false);
});

test('a formula shows only the value saved with it; formulas with no saved values are said as such, not an empty grid', () => {
  const saved = readXlsx(book({ S: SHEET('<row r="1"><c r="A1"><f>SUM(1,2)</f><v>3</v></c></row>') }));
  assert.deepEqual(saved.sheets[0].rows, [['3']]);
  assert.equal(saved.noValues, false);
  // A script-written workbook: formulas, no cached values (the card's weakest premise).
  const scripted = readXlsx(book({ S: SHEET('<row r="1"><c r="A1"><f>SUM(1,2)</f></c><c r="B1"><f>NOW()</f></c></row>') }));
  assert.equal(scripted.noValues, true);
  assert.deepEqual(scripted.sheets[0].rows, []);
  // CONTROL: an empty sheet is empty, not "no saved values".
  const blank = readXlsx(book({ S: SHEET('') }));
  assert.equal(blank.noValues, false);
  assert.equal(blank.empty, true);
});

test('the grid is capped: rows, columns and a cell\'s text, and says it was cut', () => {
  let rows = '';
  for (let r = 1; r <= MAX_ROWS + 50; r++) rows += `<row r="${r}"><c r="A${r}"><v>${r}</v></c></row>`;
  rows += '<row r="1"><c r="BZ1"><v>far</v></c></row>';   // column 78, past MAX_COLS
  const big = readXlsx(book({ S: SHEET(rows) }));
  assert.equal(big.sheets[0].rows.length, MAX_ROWS);
  assert.ok(big.sheets[0].rows.every((r) => r.length <= MAX_COLS));
  assert.equal(big.sheets[0].cut, true);
  const long = readXlsx(book({ S: SHEET(`<row r="1"><c r="A1" t="str"><v>${'x'.repeat(MAX_CELL_CHARS * 3)}</v></c></row>`) }));
  assert.equal(long.sheets[0].rows[0][0].length, MAX_CELL_CHARS);
  // CONTROL: a small sheet is not marked cut.
  assert.equal(readXlsx(book({ S: SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') })).sheets[0].cut, false);
});

test('a hostile or broken file is refused in words, never a crash or a hang', () => {
  const refused = (buf, what) => assert.throws(() => readXlsx(buf), (e) => e instanceof XlsxRefusal && /spreadsheet/.test(e.message), what);
  refused(Buffer.from('not a zip at all, just text'), 'not a zip');
  refused(zip({ '[Content_Types].xml': '<Types/>' }), 'a zip with no workbook');
  refused(Buffer.alloc(MAX_FILE_BYTES + 1), 'over the size cap');
  refused(zip({ 'xl/workbook.xml': '<workbook><sheets></sheets></workbook>' }), 'a workbook with no sheets');
  // A name outside a workbook's own folders: the checked zip reader refuses the whole file.
  refused(zip({ 'xl/workbook.xml': WB(['S']), 'evil/x.xml': 'x' }), 'an unexpected top-level entry');
  // A sheet whose target climbs out of xl/worksheets is not read (shown as not a grid), whatever it names.
  const climb = readXlsx(zip({ 'xl/workbook.xml': WB(['S']), 'xl/_rels/workbook.xml.rels': RELS(1, () => '../../docProps/app.xml'), 'docProps/app.xml': SHEET('<row r="1"><c r="A1" t="str"><v>secret</v></c></row>') }));
  assert.equal(climb.sheets[0].notGrid, true);
  assert.deepEqual(climb.sheets[0].rows, []);
  // Broken XML (an unclosed tag, a stray <) ends quickly with what it could read.
  const t0 = Date.now();
  const broken = readXlsx(book({ S: '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2' + '<'.repeat(200000) }));
  assert.ok(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0) + ' ms');
  assert.deepEqual(broken.sheets[0].rows, [['1']]);
  // A shared-string index past the table reads as empty, not undefined.
  assert.deepEqual(readXlsx(book({ S: SHEET('<row r="1"><c r="A1" t="s"><v>99</v></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si><t>a</t></si></sst>' })).sheets[0].rows, [['']]);
});

test('XML references decode, and none can produce a lone surrogate or a code point out of range', () => {
  const out = readXlsx(book({ S: SHEET('<row r="1"><c r="A1" t="str"><v>&#x1F600; &lt;b&gt; &#55357; &#x110000; &quot;q&quot;</v></c></row>') }));
  assert.equal(out.sheets[0].rows[0][0], '\u{1F600} <b>   "q"');
});
