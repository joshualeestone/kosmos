'use strict';
/**
 * kosmos#8122 review 1: the hostile and real-world workbooks the first reader got wrong, each pinned. Two froze the
 * board (a format code full of "[", and many sheets naming one big part), one gave a blank grid for a workbook a
 * script wrote (openpyxl saves `<v />` beside a formula), and the rest read values Excel does not show, or refused
 * ordinary files. Workbooks are built by test-support/xlsxfixture.js (stored, or compressed as real ones are); the two
 * openpyxl files are real openpyxl 3.1.5 output.
 *
 *   node --test engine/xlsxpreview-review-8122.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const x = require('./xlsxpreview');
const fx = require('../test-support/xlsxfixture');

const real = (name) => fs.readFileSync(path.join(__dirname, '..', 'test-support', 'xlsx', name));
const timed = (fn) => { const t = Date.now(); let out; let err = null; try { out = fn(); } catch (e) { err = e; } return { out, err, ms: Date.now() - t }; };
const STYLES = (xfs, fmts = '') => `<styleSheet>${fmts}<cellXfs>${xfs}</cellXfs></styleSheet>`;

test('#8122 r1: a format code full of "[" is read in milliseconds, not minutes (it froze the board)', () => {
  const code = '['.repeat(200000);
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="164"/>', `<numFmts><numFmt numFmtId="164" formatCode="${code}"/></numFmts>`);
  const b = fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>') }, { 'xl/styles.xml': styles }, { deflate: true });
  assert.ok(b.length < 20000, 'the hostile file should be small: ' + b.length);
  const r = timed(() => x.readXlsx(b));
  assert.ok(r.ms < 5000, 'took ' + r.ms + ' ms');   // review 7: generous for a busy machine; the bug took minutes
  assert.equal(r.err, null, r.err && r.err.message);
  assert.deepEqual(r.out.sheets[0].rows, [['45000']], 'a code longer than Excel allows is no date format');
});

test('#8122 r1: many sheets naming one big part read it once, and a sheet stops at its row cap', () => {
  const rows = Array.from({ length: 60000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c><c r="B${i + 1}"><v>${i}</v></c></row>`).join('');
  const names = Array.from({ length: 20 }, (_, i) => 'S' + i);
  const parts = {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': fx.WB(names),
    'xl/_rels/workbook.xml.rels': '<Relationships>' + names.map((n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet1.xml"/>`).join('') + '</Relationships>',
    'xl/worksheets/sheet1.xml': fx.SHEET(rows),
  };
  const b = fx.zip(parts, { deflate: true });
  const r = timed(() => x.readXlsx(b));
  assert.equal(r.err, null, r.err && r.err.message);
  assert.ok(r.ms < 5000, 'took ' + r.ms + ' ms');   // review 7: generous; the 19 notGrid below is what pins read-once
  assert.equal(r.out.sheets[0].rows.length, x.MAX_ROWS);
  assert.equal(r.out.sheets[0].cut, true);
  assert.equal(r.out.sheets.filter((s) => s.notGrid).length, 19, 'a part named again is not read again');
});

test('#8122 r1: the whole read has a time budget, and past it the answer is "too large to preview"', () => {
  let t = 0;
  x._internal.setClockForTests(() => (t += 400));   // every check sees 400 ms more
  try {
    const rows = Array.from({ length: 150 }, (_, i) => `<row r="${i + 1}">` + Array.from({ length: 30 }, (_, j) => `<c><v>${j}</v></c>`).join('') + '</row>').join('');
    assert.throws(() => x.readXlsx(fx.book({ S: fx.SHEET(rows) })), (e) => e.name === 'XlsxRefusal' && e.message === x.TOO_LARGE);
  } finally { x._internal.setClockForTests(null); }
  // CONTROL: with the real clock the same workbook is read.
  const rows = '<row r="1"><c><v>1</v></c></row>';
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET(rows) })).sheets[0].rows[0][0], '1');
});

test('#8122 r1: a workbook a script wrote (real openpyxl output) says it has no saved values, never a blank grid', () => {
  const only = x.readXlsx(real('openpyxl-only-formulas.xlsx'));
  assert.equal(only.noValues, true, 'openpyxl\'s <v /> beside a formula counted as a value');
  assert.equal(only.empty, false);
  const mixed = x.readXlsx(real('openpyxl-mixed.xlsx'));
  assert.deepEqual(mixed.sheets[0].rows, [['Item', '3']]);
  assert.equal(mixed.noValues, false);
  assert.equal(mixed.someNoValues, true, 'a formula with no saved value beside real values is not said');
  // CONTROL: a workbook with every value saved has neither mark.
  const full = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>') }));
  assert.equal(full.noValues, false);
  assert.equal(full.someNoValues, undefined);
});

test('#8122 r1: cells and rows with no r are placed by their position, not dropped', () => {
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row><c><v>1</v></c><c t="inlineStr"><is><t>b</t></is></c></row><row><c r="C2"><v>3</v></c><c><v>4</v></c></row>') }));
  assert.deepEqual(r.sheets[0].rows, [['1', 'b', '', ''], ['', '', '3', '4']]);
  assert.equal(r.empty, false);
  // Lowercase references are references.
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="b1"><v>9</v></c></row>') })).sheets[0].rows, [['', '9']]);
});

test('#8122 r1: a comment cannot hide or fake a value, and CDATA is text, never markup', () => {
  const sheet = '<worksheet><!-- <sheetData><row r="1"><c r="A1"><v>666</v></c></row></sheetData> -->'
    + '<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1" t="inlineStr"><is><t><![CDATA[a<b & c]]></t></is></c></row></sheetData></worksheet>';
  const r = x.readXlsx(fx.book({ S: sheet }));
  assert.deepEqual(r.sheets[0].rows, [['1', 'a<b & c']], 'the comment\'s fake value was shown, or the CDATA was raw');
});

test('#8122 r1: ordinary files from other writers are read: a sensitivity label, namespace prefixes, single quotes, any r: prefix', () => {
  const labelled = fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>5</v></c></row>') }, { 'docMetadata/LabelInfo.xml': '<labelList/>' });
  assert.deepEqual(x.readXlsx(labelled).sheets[0].rows, [['5']], 'a Microsoft 365 labelled workbook was refused');
  const sdk = fx.zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': "<x:workbook xmlns:x='m' xmlns:rel='r'><x:sheets><x:sheet name='Q' sheetId='1' rel:id='rId1'/></x:sheets></x:workbook>",
    'xl/_rels/workbook.xml.rels': "<Relationships><Relationship Id='rId1' Target='/xl/worksheets/sheet1.xml'/></Relationships>",
    'xl/worksheets/sheet1.xml': "<x:worksheet><x:sheetData><x:row r='1'><x:c r='A1' t='inlineStr'><x:is><x:t>ok</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>",
  }, { deflate: true });
  const got = x.readXlsx(sdk);
  assert.equal(got.sheets[0].name, 'Q');
  assert.deepEqual(got.sheets[0].rows, [['ok']], 'an SDK-written workbook (prefixes, single quotes) was not read');
});

test('#8122 r1: dates as Excel shows them: the 1904 system, the 1900 leap-year bug, times of day, and percents', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="20"/><xf numFmtId="9"/><xf numFmtId="165"/>',
    '<numFmts><numFmt numFmtId="165" formatCode="hh:mm:ss"/></numFmts>');
  const cell = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const sheet = fx.SHEET(`<row r="1">${cell('A1', 1, 1)}${cell('B1', 1, 60)}${cell('C1', 1, 61)}${cell('D1', 2, 0.5)}${cell('E1', 3, 0.25)}${cell('F1', 4, 0.75)}${cell('G1', 0, '0.30000000000000004')}</row>`);
  const b1900 = x.readXlsx(fx.book({ S: sheet }, { 'xl/styles.xml': styles }));
  assert.deepEqual(b1900.sheets[0].rows[0], ['1900-01-01', '1900-02-29', '1900-03-01', '12:00', '25%', '18:00:00', '0.3']);   // r4: hh:mm:ss shows its seconds
  const wb1904 = '<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const b1904 = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${cell('A1', 1, 45000)}</row>`) }, { 'xl/styles.xml': styles, 'xl/workbook.xml': wb1904 }));
  assert.deepEqual(b1904.sheets[0].rows[0], ['2027-03-16'], 'a 1904-system date was read in the 1900 system');
  // CONTROL: the same serial in the 1900 system.
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${cell('A1', 1, 45000)}</row>`) }, { 'xl/styles.xml': styles })).sheets[0].rows[0], ['2023-03-15']);
});

test('#8122 r1: a phonetic guide is not shown with the text, and a very hidden sheet is not a tab', () => {
  const sst = '<sst><si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si></sst>';
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }, { 'xl/sharedStrings.xml': sst }));
  assert.deepEqual(r.sheets[0].rows, [['東京']]);
  const wb = '<workbook xmlns:r="r"><sheets><sheet name="Shown" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="veryHidden" r:id="rId2"/></sheets></workbook>';
  const two = x.readXlsx(fx.book({ Shown: fx.SHEET(''), Secret: fx.SHEET('') }, { 'xl/workbook.xml': wb }));
  assert.deepEqual(two.sheets.map((s) => s.name), ['Shown']);
});

test('#8122 r1: a compressed part that lies about its size, or unpacks past the cap, is refused in words', () => {
  const big = fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>' + ' '.repeat(5 * 1024 * 1024));
  const liar = fx.book({ S: big }, {}, { deflate: true, declare: { 'xl/worksheets/sheet1.xml': 100 } });
  assert.ok(liar.length < 100000, 'the bomb should be small: ' + liar.length);
  assert.throws(() => x.readXlsx(liar), (e) => e.name === 'XlsxRefusal');
  // CONTROL: the same workbook, honest about its size, is read.
  assert.deepEqual(x.readXlsx(fx.book({ S: big }, {}, { deflate: true })).sheets[0].rows, [['1']]);
});

/* Review 2 */
test('#8122 r2: a part full of comments or CDATA is read in linear time, on the REAL clock (it ran 40 s+ before)', () => {
  for (const [label, unit] of [['comments', '<!---->'], ['CDATA', '<![CDATA[]]>'], ['tags with no closer', '<x']]) {
    const filler = unit.repeat(Math.floor((2 * 1024 * 1024) / unit.length));
    const sheet = `<worksheet>${filler}<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`;
    const b = fx.book({ S: sheet }, {}, { deflate: true });
    const r = timed(() => x.readXlsx(b));
    assert.ok(r.ms < 5000, `${label}: took ${r.ms} ms`);   // review 7: generous; the bug took 40 s+
    if (label !== 'tags with no closer') assert.deepEqual(r.out.sheets[0].rows, [['1']], label + ': the real value was not read');
  }
});

test('#8122 r2: an elapsed time past 24 hours is shown as Excel shows it (1.5 days under [h]:mm is 36:00)', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="166"/><xf numFmtId="46"/><xf numFmtId="167"/>',
    '<numFmts><numFmt numFmtId="166" formatCode="[h]:mm"/><numFmt numFmtId="167" formatCode="[mm]:ss"/></numFmts>');
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1"><v>1.5</v></c><c r="B1" s="2"><v>1.25</v></c><c r="C1" s="3"><v>0.0625</v></c></row>') }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['36:00', '30:00:00', '90:00']);
});

test('#8122 r2: simple number formats show their decimals, thousands and percent as Excel does; locale dates are dates', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="2"/><xf numFmtId="4"/><xf numFmtId="9"/><xf numFmtId="168"/><xf numFmtId="31"/><xf numFmtId="22"/>',
    '<numFmts><numFmt numFmtId="168" formatCode="0.0%"/></numFmts>');
  const c = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 3.14159)}${c('B1', 2, -1234567.891)}${c('C1', 3, 0.075)}${c('D1', 4, 0.1234)}${c('E1', 5, 45000)}${c('F1', 6, 0.99999999)}</row>`) }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['3.14', '-1,234,567.89', '8%', '12.3%', '2023-03-15', '1900-01-01 00:00']);   // r4: id 22 is m/d/yy h:mm
});

test('#8122 r2: an entry the reader never reads ("[trash]/" from Excel, a name Windows cannot store) does not refuse the workbook', () => {
  const b = fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>7</v></c></row>') }, { '[trash]/0001.dat': 'x', '_xmlsignatures/sig1.xml': '<s/>', 'xl/media/a:b.png': 'x' }, { deflate: true });
  assert.deepEqual(x.readXlsx(b).sheets[0].rows, [['7']]);
  // CONTROL: the extraction rules are unchanged: the same archive is still refused by a strict listing.
  const { readZipDirectory } = require('./win32zip');
  assert.throws(() => readZipDirectory(b, { allowedTopLevel: ['xl', '_rels', '[Content_Types].xml'], maxEntries: 100, maxEntryBytes: 1e6, maxTotalBytes: 1e7 }));
});

/* Review 3 */
test('#8122 r3: an ISO date cell (t="d") shows its date; a sheet whose part is missing is not a grid; currency shows the saved number', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="169"/>', '<numFmts><numFmt numFmtId="169" formatCode="&quot;$&quot;#,##0.00"/></numFmts>');
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1" t="d"><v>2024-01-15T00:00:00</v></c><c r="B1" t="d"><v>2024-01-15T13:45:00</v></c><c r="C1" s="2"><v>1234.5</v></c></row>') }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['2024-01-15', '2024-01-15 13:45', '1234.5'], 'a t="d" date showed NaN, or a currency code dropped its symbol');
  const gone = x.readXlsx(fx.zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': fx.WB(['S']), 'xl/_rels/workbook.xml.rels': fx.RELS(1) }));
  assert.deepEqual(gone.sheets, [{ name: 'S', rows: [], cut: false, notGrid: true }]);
  assert.equal(gone.empty, true);
});

/* Review 4 */
test('#8122 r4: a row number that never grows, or cells past the last column, do not walk a whole part (about 2 s a request)', () => {
  const D = { deflate: true };
  const row = '<row r="1">' + '<c r="Z1"><v>1</v></c>'.repeat(5) + '</row>';
  const repeat = fx.book({ S: fx.SHEET(row.repeat(Math.floor(15e6 / row.length))) }, {}, D);
  const wide = fx.book({ S: fx.SHEET('<row r="1">' + '<c r="ZZ1"/>'.repeat(1e6) + '</row>') }, {}, D);
  for (const [name, b] of [['repeat', repeat], ['wide', wide]]) {
    assert.ok(b.length < 120000, name + ' should be a small file: ' + b.length);
    // Review 5: counted work, not a wall clock (a busy machine failed a 600 ms limit). The clock is read once at the start
    // and once per budget check, which runs every 1024 steps, so the count of reads is the walk's length / 1024.
    let reads = 0;
    x._internal.setClockForTests(() => { reads++; return 0; });
    let out, err = null;
    try { out = x.readXlsx(b); } catch (e) { err = e; } finally { x._internal.setClockForTests(null); }
    assert.equal(err, null, name + ': ' + (err && err.message));
    assert.ok(reads < 400, name + ': the walk took ' + reads + ' budget checks (about ' + (reads * 1024) + ' steps)');
    if (name === 'repeat') assert.equal(out.sheets[0].cut, true, 'a walk cut short says so');
  }
  assert.equal(repeat.length > 0 && x.readXlsx(repeat).sheets[0].rows[0][25], '1');
});

test('#8122 r4: data that starts below the row cap is shown (with its first row), and a row out of order is not the end of the sheet', () => {
  const far = x.readXlsx(fx.book({ S: fx.SHEET('<row r="300"><c r="A300"><v>7</v></c></row><row r="301"><c r="A301"><v>8</v></c></row>') }));
  assert.deepEqual(far.sheets[0].rows, [['7'], ['8']]);
  assert.equal(far.sheets[0].firstRow, 300);
  assert.equal(far.empty, false, 'a sheet with values read as empty');
  const odd = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row><row r="900"><c r="A900"><v>9</v></c></row><row r="2"><c r="A2"><v>2</v></c></row>') }));
  assert.deepEqual(odd.sheets[0].rows, [['1'], ['2']]);
  assert.equal(odd.sheets[0].cut, true);
  assert.equal('firstRow' in odd.sheets[0], false, 'a sheet that starts at row 1 has no firstRow');
});

test('#8122 r4: a formula that returns "" is a saved empty text, not a missing value', () => {
  const only = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="str"><f>IF(1,"","")</f><v></v></c></row>') }));
  assert.equal(only.noValues, false, 'a saved "" read as a workbook with no saved values');
  const mixed = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>3</v></c><c r="B1" t="str"><f>IF(1,"","")</f><v></v></c></row>') }));
  assert.equal('someNoValues' in mixed, false);
  // CONTROL: a number cell with an empty <v/> beside a formula (openpyxl) is still no saved value.
  const bare = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>3</v></c><c r="B1"><f>A1*2</f><v/></c></row>') }));
  assert.equal(bare.someNoValues, true);
});

test('#8122 r4: date and time formats show what Excel shows; odd formats and text never break the workbook', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="18"/><xf numFmtId="45"/><xf numFmtId="14"/><xf numFmtId="165"/><xf numFmtId="166"/>',
    '<numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.' + '0'.repeat(101) + '"/><numFmt numFmtId="166" formatCode="h:mm AM/PM"/></numFmts>');
  const c = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 45000.5)}${c('B1', 2, 0.75)}${c('C1', 3, 0.5)}${c('D1', 4, 0)}${c('E1', 5, 1.5)}${c('F1', 4, 'abc')}${c('G1', 6, 0.25)}</row>`) }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['2023-03-15', '6:00 PM', '00:00', '1900-01-00', '1.5', 'abc', '6:00 AM']);
});

test('#8122 r4: a self-closed phonetic guide does not cut the text after it', () => {
  const sst = '<sst><si><t>a</t><rPh/><t>b</t></si></sst>';
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }, { 'xl/sharedStrings.xml': sst }));
  assert.deepEqual(r.sheets[0].rows, [['ab']]);
});

/* Review 5 */
test('#8122 r5: the answer is bounded: one long shared string in every cell of 20 sheets is not a 100 MB reply', () => {
  const sp = require('./sheetpreview');
  const cols = Array.from({ length: 50 }, (_, i) => (i < 26 ? '' : 'A') + String.fromCharCode(65 + (i % 26)));
  const rows = Array.from({ length: 200 }, (_, i) => `<row r="${i + 1}">` + cols.map((c) => `<c r="${c}${i + 1}" t="s"><v>0</v></c>`).join('') + '</row>').join('');
  for (const ch of ['A', '&#1;']) {   // '&#1;' is 6 bytes of JSON per character: it made a string too long to build
    const sheets = {};
    for (let i = 0; i < 20; i++) sheets['S' + i] = fx.SHEET(rows);
    const b = fx.book(sheets, { 'xl/sharedStrings.xml': '<sst><si><t>' + ch.repeat(600) + '</t></si></sst>' }, { deflate: true });
    assert.ok(b.length < 600000, 'a small file: ' + b.length);
    const r = sp.fromBytes(b, 'a.xlsx');
    const size = JSON.stringify(r).length;
    assert.ok(size < 3 * 1024 * 1024, ch + ': the answer is ' + size + ' characters');
    assert.equal(r.ok, true, ch + ': a partial grid is shown, not refused');
    assert.equal(r.sheets.some((s) => s.cut), true, ch + ': what is left out is said');
    assert.equal(r.sheets[0].rows[0][0].length, x.MAX_CELL_CHARS);
  }
});

test('#8122 r5: "cut" means a value was left out, never a formatted blank or an empty row', () => {
  const cutOf = (rows) => x.readXlsx(fx.book({ S: fx.SHEET(rows) })).sheets[0];
  assert.equal(cutOf('<row r="1"><c r="A1"><v>1</v></c><c r="BA1" s="0"/></row>').cut, false, 'a formatted blank past column 50');
  assert.equal(cutOf('<row r="1"><c r="A1"><v>1</v></c></row><row r="500" ht="20" customHeight="1"/>').cut, false, 'an empty row far down');
  // CONTROL: a value past column 50, or far down, is cut.
  assert.equal(cutOf('<row r="1"><c r="A1"><v>1</v></c><c r="BA1"><v>2</v></c></row>').cut, true);
  assert.equal(cutOf('<row r="1"><c r="A1"><v>1</v></c></row><row r="500"><c r="A500"><v>2</v></c></row>').cut, true);
  const only = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="BA1"><v>2</v></c></row>') }));
  assert.equal(only.empty, false, 'a workbook whose only value is past column 50 is not empty');
  assert.equal(only.sheets[0].cut, true);
});

test('#8122 r5: the rows shown do not depend on the order rows sit in the file', () => {
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="300"><c r="A300"><v>far</v></c></row><row r="1"><c r="A1" t="str"><v>top</v></c></row>') })).sheets[0];
  assert.deepEqual(r.rows[0], ['top']);
  assert.equal('firstRow' in r, false);
  assert.equal(r.cut, true);
});

test('#8122 r5: a date with a time keeps its format\'s clock; a boolean saved as "true" is TRUE', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/>',
    '<numFmts><numFmt numFmtId="164" formatCode="m/d/yyyy h:mm AM/PM"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>');
  const c = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 45000.75)}${c('B1', 2, 45000.5 + 30 / 86400)}<c r="C1" t="b"><v>true</v></c></row>`) }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['2023-03-15 6:00 PM', '2023-03-15 12:00', 'TRUE']);
});

test('#8122 r5: a long cell is never cut through the middle of an emoji', () => {
  const t = 'a'.repeat(x.MAX_CELL_CHARS - 2) + '😀'.repeat(5);
  const shown = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1"><c r="A1" t="inlineStr"><is><t>${t}</t></is></c></row>`) })).sheets[0].rows[0][0];
  const before = shown.charCodeAt(shown.length - 2);
  assert.equal(before >= 0xd800 && before <= 0xdbff, false, 'a lone high surrogate before the ellipsis');
});

test('#8122 r5: the same bytes are read once; changed bytes, or a CSV under another name, are read again', () => {
  const sp = require('./sheetpreview');
  sp._forgetForTests();
  let reads = 0;
  x._internal.setClockForTests(() => { reads++; return 0; });
  try {
    const b = fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') });
    const first = sp.fromBytes(b, 'a.xlsx');
    const afterFirst = reads;
    assert.ok(afterFirst > 0, 'CONTROL: a read is counted');
    const second = sp.fromBytes(b, 'a.xlsx');
    assert.equal(reads, afterFirst, 'the same bytes were read again');
    assert.deepEqual(second, first);
    second.sheets[0].rows[0][0] = 'changed';
    assert.equal(sp.fromBytes(b, 'a.xlsx').sheets[0].rows[0][0], '1', 'a caller changed the remembered answer');
    sp.fromBytes(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>2</v></c></row>') }), 'a.xlsx');
    assert.ok(reads > afterFirst, 'changed bytes were not read again');
  } finally { x._internal.setClockForTests(null); sp._forgetForTests(); }
  assert.equal(sp.fromBytes(Buffer.from('a,b\n'), 'one.csv').sheets[0].name, 'one.csv');
  assert.equal(sp.fromBytes(Buffer.from('a,b\n'), 'two.csv').sheets[0].name, 'two.csv');
});

/* Review 6 */
test('#8122 r6: a sheet with no row kept has no firstRow (it went out as "firstRow": null)', () => {
  const r = x.readXlsx(fx.book({ A: fx.SHEET(''), B: fx.SHEET('<row r="1"><c r="AZ1"><v>2</v></c></row>') }));
  for (const s of r.sheets) assert.equal('firstRow' in s, false, s.name + ': ' + JSON.stringify(s));
  // CONTROL: a sheet that starts far down still has one.
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET('<row r="300"><c r="A300"><v>7</v></c></row>') })).sheets[0].firstRow, 300);
});

test('#8122 r6: a workbook with sheets left out is never called empty, or "no saved values"', () => {
  const sheets = {};
  for (let i = 0; i < 20; i++) sheets['E' + i] = fx.SHEET('');
  sheets.Data = fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>');
  const r = x.readXlsx(fx.book(sheets));
  assert.equal(r.moreSheets, 1);
  assert.equal(r.empty, false);
  assert.equal(r.noValues, false);
  // CONTROL: twenty empty sheets and nothing left out is empty.
  delete sheets.Data;
  assert.equal(x.readXlsx(fx.book(sheets)).empty, true);
});

test('#8122 r6: a refusal for the time a read took is not remembered; a refusal for what the file is, is', () => {
  const sp = require('./sheetpreview');
  sp._forgetForTests();
  const b = fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') });
  let t = 0;
  x._internal.setClockForTests(() => (t += 5000));   // every check is past the budget: a busy moment
  let slow;
  try { slow = sp.fromBytes(b, 'a.xlsx'); } finally { x._internal.setClockForTests(null); }
  assert.equal(slow.ok, false);
  assert.equal(slow.tooLarge, true);
  assert.equal('slow' in slow, false, 'the internal mark reached the answer');
  assert.equal(sp.fromBytes(b, 'a.xlsx').ok, true, 'a busy-moment refusal stuck');
  sp._forgetForTests();
});

test('#8122 r6: only a decimal number is a number or a string index', () => {
  const sst = '<sst><si><t>zero</t></si><si><t>one</t></si></sst>';
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>0x1F</v></c><c r="B1" t="s"><v>0x1</v></c><c r="C1" t="s"><v>1</v></c><c r="D1"><v>1e3</v></c></row>') }, { 'xl/sharedStrings.xml': sst }));
  assert.deepEqual(r.sheets[0].rows[0], ['0x1F', '', 'one', '1000']);
  const blank = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>9</v></c></row>') }, { 'xl/sharedStrings.xml': sst }));
  assert.equal(blank.empty, true, 'an index to no string made a blank workbook not empty');
});

test('#8122 r6: a CSV with blank lines past the row cap is not cut; a value there is', () => {
  const sp = require('./sheetpreview');
  assert.equal(sp.readDelimited('a\n'.repeat(5) + '\n'.repeat(300), ',').sheets[0].cut, false);
  assert.equal(sp.readDelimited('a\n'.repeat(200) + '\n', ',').sheets[0].cut, false);
  assert.equal(sp.readDelimited('a\n'.repeat(201), ',').sheets[0].cut, true);
});

/* Review 7 */
test('#8122 r7: a long run of digits is not tried as a number (the round-6 pattern backtracked: 841 bytes, 4.7 s)', () => {
  const sp = require('./sheetpreview');
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="14"/>');
  for (const s of [0, 1]) {   // the plain number path, and the date path
    const b = fx.book({ S: fx.SHEET(`<row r="1"><c r="A1" s="${s}"><v>${'1'.repeat(100000)}x</v></c></row>`) }, { 'xl/styles.xml': styles }, { deflate: true });
    assert.ok(b.length < 5000, 'a small file: ' + b.length);
    const t0 = Date.now();
    const r = sp.fromBytes(b, 's' + s + '.xlsx');
    const ms = Date.now() - t0;
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.ok(ms < 1000, 'style ' + s + ': took ' + ms + ' ms (the bug took 4.7 s)');
  }
  // CONTROL: ordinary numbers, signs, decimals and exponents are still numbers.
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>-1.5</v></c><c r="B1"><v>.25</v></c><c r="C1"><v>1E3</v></c><c r="D1"><v>3.</v></c></row>') }));
  assert.deepEqual(r.sheets[0].rows[0], ['-1.5', '0.25', '1000', '3']);
});

test('#8122 r7: simple formats round as Excel does and keep their leading zeros', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="1"/><xf numFmtId="2"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="9"/>',
    '<numFmts><numFmt numFmtId="164" formatCode="00000"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>');
  const c = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 2.4999999995)}${c('B1', 2, 1.004999999995)}${c('C1', 3, 1234)}${c('D1', 2, 1.005)}${c('E1', 4, 1234567.891)}${c('F1', 5, 0.075)}</row>`) }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['2', '1.00', '01234', '1.01', '1,234,567.89', '8%']);
});

test('#8122 r7: a CSV whose data starts after the row cap is shown, with its first row', () => {
  const sp = require('./sheetpreview');
  const r = sp.readDelimited('\n'.repeat(250) + 'a,b\n', ',');
  assert.deepEqual(r.sheets[0].rows, [['a', 'b']]);
  assert.equal(r.sheets[0].firstRow, 251);
  assert.equal(r.sheets[0].cut, false);
  // CONTROL: data from line 1 has no firstRow.
  assert.equal('firstRow' in sp.readDelimited('a,b\n', ',').sheets[0], false);
});

test('#8122 r7: a sheet cut at the shared-string cap is not called empty; a chart-only workbook is not empty', () => {
  const sst = '<sst>' + '<si><t>s</t></si>'.repeat(200001) + '</sst>';
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>200000</v></c></row>') }, { 'xl/sharedStrings.xml': sst }, { deflate: true }));
  assert.equal(r.sheets[0].cut, true);
  assert.equal(r.empty, false);
  const wb = '<workbook xmlns:r="r"><sheets><sheet name="Chart" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="chartsheets/sheet1.xml"/></Relationships>';
  const chart = x.readXlsx(fx.zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': wb, 'xl/_rels/workbook.xml.rels': rels, 'xl/chartsheets/sheet1.xml': '<chartsheet/>' }));
  assert.equal(chart.sheets[0].notGrid, true);
  assert.equal(chart.empty, false);
});

test('#8122 r7: the CSV reader never cuts a long cell through an emoji', () => {
  const sp = require('./sheetpreview');
  const cell = sp.readDelimited('a'.repeat(498) + '😀'.repeat(3) + '\n', ',').sheets[0].rows[0][0];
  const before = cell.charCodeAt(cell.length - 2);
  assert.equal(before >= 0xd800 && before <= 0xdbff, false, 'a lone high surrogate before the ellipsis');
});

test('#8122 r7: a file that is slow twice running is remembered; once is not', () => {
  const sp = require('./sheetpreview');
  sp._forgetForTests();
  const b = fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') });
  let t = 0;
  x._internal.setClockForTests(() => (t += 5000));
  try {
    assert.equal(sp.fromBytes(b, 'a.xlsx').tooLarge, true);
    assert.equal(sp.fromBytes(b, 'a.xlsx').tooLarge, true);
  } finally { x._internal.setClockForTests(null); }
  assert.equal(sp.fromBytes(b, 'a.xlsx').tooLarge, true, 'slow twice: kept');
  sp._forgetForTests();
  assert.equal(sp.fromBytes(b, 'a.xlsx').ok, true, 'CONTROL: forgotten, it reads');
});

/* #8147: the round-8 leftovers */
test('#8147 r3: a string of millions of empty text runs is counted and refused, not read', () => {
  const sp = require('./sheetpreview');
  // 3.9M runs in the shared strings and 1M in one inline cell: each part under the 16 MB part cap, 4.9M runs in all.
  const b = fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is>' + '<t/>'.repeat(1e6) + '</is></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si>' + '<t/>'.repeat(3.9e6) + '</si></sst>' }, { deflate: true });
  assert.ok(b.length < 100000, 'a small file: ' + b.length);
  let reads = 0;
  x._internal.setClockForTests(() => { reads++; return 0; });
  let r;
  try { r = sp.fromBytes(b, 'runs.xlsx'); } finally { x._internal.setClockForTests(null); sp._forgetForTests(); }
  assert.equal(r.tooLarge, true, JSON.stringify(r).slice(0, 200));
  assert.ok(reads > 100, 'CONTROL: the runs reached the budget (' + reads + ' clock reads)');
});

test('#8147: tags that only start like a cell are counted: a part of millions of them is refused, not walked', () => {
  const sp = require('./sheetpreview');
  const parts = {};
  for (let i = 0; i < 4; i++) parts['S' + i] = fx.SHEET('<row r="1">' + '<cx'.repeat(5e6) + '</row>');
  const b = fx.book(parts, {}, { deflate: true });
  assert.ok(b.length < 200000, 'a small file: ' + b.length);
  // Counted work, not a clock: the budget clock is read every 4096 near-misses, and the read stops at the cap.
  let reads = 0;
  x._internal.setClockForTests(() => { reads++; return 0; });
  let r;
  try { r = sp.fromBytes(b, 'near.xlsx'); } finally { x._internal.setClockForTests(null); sp._forgetForTests(); }
  assert.equal(r.tooLarge, true, JSON.stringify(r).slice(0, 200));
  assert.ok(reads > 100, 'CONTROL: the near-misses reached the budget (' + reads + ' clock reads)');
  // CONTROL: an ordinary file is untouched.
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') })).sheets[0].rows, [['1']]);
});

test('#8147: a sheet whose walk stopped before the end is never "empty" or "no saved values"', () => {
  const blanks = Array.from({ length: 2100 }, (_, i) => `<row r="${i + 1}">` + Array.from({ length: 50 }, (_, j) => `<c r="${String.fromCharCode(65 + (j % 26))}${i + 1}" s="1"/>`).join('') + '</row>').join('');
  const a = x.readXlsx(fx.book({ S: fx.SHEET(blanks + '<row r="2200"><c r="A2200"><v>7</v></c></row>') }, {}, { deflate: true }));
  assert.equal(a.sheets[0].cut, true);
  assert.equal(a.empty, false, 'a value past the walk read as empty');
  const f = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1">' + '<c><f>1+1</f></c>'.repeat(100001) + '</row><row r="2"><c><v>5</v></c></row>') }, {}, { deflate: true }));
  assert.equal(f.noValues, false, 'a saved value past the walk read as "no saved values"');
  // Review r5: and the formulas that were read still say why the cells are blank.
  assert.equal(f.someNoValues, true, 'the formulas read have no saved value, and a saved value exists: "some" is true');
  const g = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1">' + '<c><f>1+1</f></c>'.repeat(100001) + '</row>') }, {}, { deflate: true }));
  assert.equal(g.noValues, false);
  assert.equal(g.someNoValues, true, 'a capped sheet of formulas with no saved values said nothing');
  // CONTROL: a workbook with only formulas and no walk cut still says so.
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c><f>1+1</f></c></row>') })).noValues, true);
});

test('#8147: formats that scale or decide by sign show the saved number, not a wrong one; -0, .50', () => {
  const styles = STYLES('<xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="1"/><xf numFmtId="167"/><xf numFmtId="168"/><xf numFmtId="169"/><xf numFmtId="170"/>',
    '<numFmts><numFmt numFmtId="164" formatCode="#,##0,"/><numFmt numFmtId="165" formatCode="0,"/><numFmt numFmtId="166" formatCode="#,##0;(#,##0)"/><numFmt numFmtId="167" formatCode=".00"/><numFmt numFmtId="168" formatCode="#,##0.00;[Red]#,##0.00"/><numFmt numFmtId="169" formatCode="#.00"/><numFmt numFmtId="170" formatCode="0.0;-0.0;&quot;zero&quot;"/></numFmts>');
  const c = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 1234567.891)}${c('B1', 2, 1234567)}${c('C1', 3, -5)}${c('D1', 4, -0.4)}${c('E1', 5, 0.5)}</row>`) }, { 'xl/styles.xml': styles }));
  assert.deepEqual(r.sheets[0].rows[0], ['1234567.891', '1234567', '(5)', '-0', '.50']);   // r5: "(#,##0)" draws brackets
  // Review r1: a positive under a code with a section for negatives keeps the first section's formatting; a negative,
  // or a zero under a code with a zero section, is shown as saved; "#.00" has no leading zero either.
  const s = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 6, 1234.5)}${c('B1', 6, -1234.5)}${c('C1', 3, 5)}${c('D1', 7, 0.5)}${c('E1', 8, 0)}${c('F1', 8, 2)}</row>`) }, { 'xl/styles.xml': styles }));
  // Review r4/r5: -1234.5 under "#,##0.00;[Red]#,##0.00" is drawn by its second section; Excel's only sign there is the
  // red, which this preview cannot show, so it gets a minus (without one a loss read as a gain).
  assert.deepEqual(s.sheets[0].rows[0], ['1,234.50', '-1,234.50', '5', '.50', '0', '2.0']);
  // Review r2: a negative percent keeps its percent; a ";" inside quotes is not a section.
  const st2 = STYLES('<xf numFmtId="0"/><xf numFmtId="171"/><xf numFmtId="172"/>', '<numFmts><numFmt numFmtId="171" formatCode="0%;(0%)"/><numFmt numFmtId="172" formatCode="0.00;&quot;a;b&quot;"/></numFmts>');
  const p = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, -0.5)}${c('B1', 1, 0.25)}${c('C1', 2, 0)}</row>`) }, { 'xl/styles.xml': st2 }));
  assert.deepEqual(p.sheets[0].rows[0], ['(50%)', '25%', '0.00']);   // r5: "(0%)" draws brackets, as Excel does
  // Review r4: "0%;[Red]0%" draws -0.5 as 50% (red, no sign), through its second section.
  const st4 = STYLES('<xf numFmtId="0"/><xf numFmtId="175"/>', '<numFmts><numFmt numFmtId="175" formatCode="0%;[Red]0%"/></numFmts>');
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, -0.5)}</row>`) }, { 'xl/styles.xml': st4 })).sheets[0].rows[0], ['-50%']);
  // Review r5: a "-" written in the second section is drawn as a minus, and "0.00;[Red]0.00" never shows a loss as a gain.
  const st6 = STYLES('<xf numFmtId="0"/><xf numFmtId="176"/><xf numFmtId="177"/>', '<numFmts><numFmt numFmtId="176" formatCode="#,##0.00;-#,##0.00"/><numFmt numFmtId="177" formatCode="0.00;[Red]0.00"/></numFmts>');
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, -1234.5)}${c('B1', 2, -5)}${c('C1', 2, 5)}</row>`) }, { 'xl/styles.xml': st6 })).sheets[0].rows[0], ['-1,234.50', '-5.00', '5.00']);
  // Review r3: a percent code's zero section still decides its zero; "#" shows no zero.
  const st3 = STYLES('<xf numFmtId="0"/><xf numFmtId="173"/><xf numFmtId="174"/>', '<numFmts><numFmt numFmtId="173" formatCode="0%;-0%;&quot;-&quot;"/><numFmt numFmtId="174" formatCode="#"/></numFmts>');
  const z = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 0)}${c('B1', 2, 0.4)}${c('C1', 2, 7)}</row>`) }, { 'xl/styles.xml': st3 }));
  assert.deepEqual(z.sheets[0].rows[0], ['0', '', '7']);
  // Review r4: a cell drawn as nothing is not a value ("empty"), as an empty string is not.
  const st5 = STYLES('<xf numFmtId="0"/><xf numFmtId="174"/>', '<numFmts><numFmt numFmtId="174" formatCode="#"/></numFmts>');
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 0.4)}</row>`) }, { 'xl/styles.xml': st5 })).empty, true);
  // CONTROL: an ordinary thousands code still groups.
  const g = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${c('A1', 1, 1234567)}</row>`) }, { 'xl/styles.xml': STYLES('<xf numFmtId="0"/><xf numFmtId="3"/>') }));
  assert.deepEqual(g.sheets[0].rows[0], ['1,234,567']);
});

test('#8147: a row number past Excel\'s last row is not a row number; an empty shared string is not a value', () => {
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1e300"><c r="A1"><v>1</v></c></row>') }));
  assert.deepEqual(r.sheets[0].rows, [['1']]);
  assert.equal('firstRow' in r.sheets[0], false);
  // Review r2: "0x10" is not row 16; a row past the last never lands on a real row.
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET('<row r="0x10"><c r="A1"><v>1</v></c></row>') })).sheets[0].rows, [['1']]);
  for (const big of ['5000000', '50000000', '0000000000000000000099999999', '9'.repeat(41)]) {   // r5: 41 digits too
    const far = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="2"><c r="A2"><v>2</v></c></row><row r="${big}"><c r="A1"><v>5</v></c></row><row r="3"><c r="A3"><v>9</v></c></row>`) }));
    assert.deepEqual(far.sheets[0].rows, [[''], ['2'], ['9']], big);
    assert.equal(far.sheets[0].cut, true, big);
  }
  // Review r3: leading zeros are still the row ("00000005" is row 5); a far row's value keeps the workbook from "empty";
  // an empty far row is no cut.
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET('<row r="00000002"><c r="A1"><v>1</v></c></row>') })).sheets[0].rows, [[''], ['1']]);
  const lone = x.readXlsx(fx.book({ S: fx.SHEET('<row r="5000000"><c r="A1"><v>5</v></c></row>') }));
  assert.equal(lone.empty, false);
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row><row r="2000000"/>') })).sheets[0].cut, false);
  // Review r4: nor a far row of formatted blanks.
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row><row r="2000000"><c s="1"/></row>') })).sheets[0].cut, false);
  const e = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si><t></t></si></sst>' }));
  assert.equal(e.empty, true);
  // Review r1: but a formula whose saved value is that empty string has a saved value, so it is not "some have none".
  // (Review r3: this and the next check pass on the reader before #8147 too, which counted "" as a value; they pin that
  // the empty-string change did not break them, not the change itself.)
  const f = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>3</v></c><c r="B1" t="s"><f>A2</f><v>0</v></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si><t></t></si></sst>' }));
  assert.equal('someNoValues' in f, false, 'a formula that saved "" was called one with no saved value');
  // Review r2: and a workbook whose only formula saved "" is not "no saved values".
  const only = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="inlineStr"><f>1</f><is><t/></is></c></row>') }));
  assert.equal(only.noValues, false);
  // Review r3: the same formula with t="str" is answered the same way (the case beside a formula with no value is `mix`).
  const str = x.readXlsx(fx.book({ S: fx.SHEET('<row r="500"><c r="A500" t="str"><f>A1</f><v></v></c></row><row r="600"><c r="A600"><v>1</v></c></row>') }));
  assert.equal(str.sheets[0].firstRow, 600);
  // Review r4: and a sheet whose only formula is a t="str" "" is not "no saved values".
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="str"><f>A2</f><v></v></c></row>') })).noValues, false);
  const mix = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><f>A2</f><v>0</v></c><c r="B1"><f>A9</f></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si><t></t></si></sst>' }));
  assert.equal(mix.someNoValues, true, 'a blank grid with no word about the formula with no saved value');
  // CONTROL: a formula with no saved value at all still is.
  assert.equal(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>3</v></c><c r="B1"><f>A2</f></c></row>') })).someNoValues, true);
});

test('#8147: the answer cache is bounded by size, not only by count, and keeps the newest', () => {
  const sp = require('./sheetpreview');
  sp._forgetForTests();
  // Workbooks (an xlsx read reads the clock; a CSV read does not, so a CSV could not show a re-read). Each answer is
  // about 1.9 MB of JSON: 150 rows of 50 inline strings of 250 characters. 8 would be 15 MB, past the 8 MiB kept.
  const cols = Array.from({ length: 50 }, (_, i) => (i < 26 ? '' : 'A') + String.fromCharCode(65 + (i % 26)));
  const book = (k) => fx.book({ S: fx.SHEET(Array.from({ length: 150 }, (_, r) => `<row r="${r + 1}">` + cols.map((c, j) => `<c r="${c}${r + 1}" t="inlineStr"><is><t>${String.fromCharCode(97 + ((k + j) % 26)).repeat(250)}</t></is></c>`).join('') + '</row>').join('')) }, {}, { deflate: true });
  const books = Array.from({ length: 8 }, (_, k) => book(k));
  for (let k = 0; k < 8; k++) assert.equal(sp.fromBytes(books[k], 'b' + k + '.xlsx').ok, true);
  const { count: held } = sp._heldForTests();
  assert.ok(held <= 4, 'held ' + held + ' answers of about 1.9 MB each');
  let reads = 0;
  x._internal.setClockForTests(() => { reads++; return 0; });
  try {
    assert.equal(sp.fromBytes(books[7], 'b7.xlsx').ok, true);
    assert.equal(reads, 0, 'the newest answer was evicted (it was read again)');
    sp.fromBytes(books[0], 'b0.xlsx');
    assert.ok(reads > 0, 'CONTROL: the oldest was evicted, so it is read again');
  } finally { x._internal.setClockForTests(null); sp._forgetForTests(); }
});

/* #8147 review r6 */
test('#8147 r6: no format code shows a negative without a sign; a negative time is shown as saved', () => {
  const codes = ['0;0', '0.00;[Color10]0.00', '0;[Red][<0]0', '#,##0;(#,##0);"-";@', '0%;0', '[Blue]0;[Red]0', '_(#,##0_);(#,##0)', '"$"#,##0;("$"#,##0)'];
  const fmts = codes.map((code, i) => `<numFmt numFmtId="${180 + i}" formatCode="${code.replace(/"/g, '&quot;')}"/>`).join('');
  const xfs = '<xf numFmtId="0"/>' + codes.map((_, i) => `<xf numFmtId="${180 + i}"/>`).join('') + '<xf numFmtId="20"/>';
  const cells = codes.map((_, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${i + 1}"><v>-5</v></c>`).join('') + `<c r="Z1" s="${codes.length + 1}"><v>-0.5</v></c>`;
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1">${cells}</row>`) }, { 'xl/styles.xml': `<styleSheet><numFmts>${fmts}</numFmts><cellXfs>${xfs}</cellXfs></styleSheet>` }));
  const shown = r.sheets[0].rows[0].filter((t) => t !== '');
  assert.equal(shown.length, codes.length + 1);
  for (const t of shown) assert.ok(/^-|^\(/.test(t), 'a negative shown with no sign: ' + JSON.stringify(t) + ' in ' + JSON.stringify(shown));
  assert.equal(shown[shown.length - 1], '-0.5', 'h:mm on -0.5 is shown as saved, never 12:00');
});

test('#8147 r6: a row or cell whose start tag is too long to read is not placed on another row or column', () => {
  const pad = ' z="' + 'a'.repeat(5000) + '"';
  const r = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="2"><c r="A2"><v>2</v></c></row><row${pad} r="9999999"><c r="A1"><v>5</v></c></row>`) }));
  assert.deepEqual(r.sheets[0].rows, [[''], ['2']]);
  assert.equal(r.sheets[0].cut, true);
  const c = x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1"><c r="A1"><v>1</v></c><c${pad} r="C1"><v>3</v></c></row>`) }));
  assert.deepEqual(c.sheets[0].rows, [['1']]);
  assert.equal(c.sheets[0].cut, true);
  // CONTROL: a short tag is read.
  assert.deepEqual(x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>') })).sheets[0].rows, [['1', '', '3']]);
});

/* #8147 review r7 */
test('#8147 r7: a row or cell that is not placed answers by what it held', () => {
  const pad = ' z="' + 'a'.repeat(5000) + '"';
  const read = (rows) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }));
  // A formula in a long-tag cell: never "empty", and the viewer is told why (no saved value).
  const a = read(`<row r="1"><c${pad}><f>1</f></c></row>`);
  assert.equal(a.empty, false);
  assert.equal(a.someNoValues, true);
  // A far row holding only a formula: the same.
  const b = read('<row r="2000000"><c><f>1+1</f></c></row>');
  assert.equal(b.someNoValues, true);
  // A far row whose cell is an openpyxl empty <v/> is no cut.
  assert.equal(read('<row r="1"><c r="A1"><v>1</v></c></row><row r="2000000"><c><f>1</f><v /></c></row>').sheets[0].cut, false);
  // A row with no r after the last row is not placed past it.
  const c = read('<row r="1048576"><c r="A1"><v>1</v></c></row><row><c><v>2</v></c></row>');
  assert.equal(c.sheets[0].rows.length, 1);
  assert.equal(c.sheets[0].cut, true);
  // " 5" is row 5.
  assert.deepEqual(read('<row r=" 2"><c r="A2"><v>1</v></c></row>').sheets[0].rows, [[''], ['1']]);
});

/* #8162 */
test('#8162: a skipped row or cell with a value that has attributes is still a value', () => {
  const pad = ' z="' + 'a'.repeat(5000) + '"';
  const read = (rows) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }));
  const a = read('<row r="2000000"><c><v xml:space="preserve">5</v></c></row>');
  assert.equal(a.empty, false);
  assert.equal(a.sheets[0].cut, true);
  const b = read(`<row r="1"><c${pad}><v >5</v></c></row>`);
  assert.equal(b.empty, false);
  assert.equal(b.sheets[0].cut, true);
  // CONTROL: an empty <v/> (openpyxl) is still no value.
  assert.equal(read('<row r="1"><c r="A1"><v>1</v></c></row><row r="2000000"><c><f>1</f><v /></c></row>').sheets[0].cut, false);
  // A run of unclosed "<v " tags in a skipped row is linear (the scan stops at the first, counted as cut off; no backtracking).
  const t0 = Date.now();
  const runs = read('<row r="2000000"><c>' + '<v '.repeat(200000) + '</c></row>');
  assert.ok(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
  assert.equal(runs.sheets[0].cut, true, 'the unclosed "<v " tags are counted as cut off');
});

test('#8162: a cell or value cut off before its close marks the sheet cut and never "empty"', () => {
  const read = (rows) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }));
  for (const rows of ['<row r="1"><c r="A1"><v>5</v>', '<row r="1"><c r="A1"><v>5</c></row>', '<row r="1"><c r="A1" ']) {
    const r = read(rows);
    assert.equal(r.sheets[0].cut, true, rows);
    assert.equal(r.empty, false, rows);
  }
  // Review r1: a close missing mid-part (a row that swallowed the next, a cell that swallowed the next) is counted too.
  for (const rows of ['<row r="1"><c r="A1"><v>5</v></c><row r="2"><c r="A2"><v>6</v></c></row>', '<row r="1"><c r="A1"><v>5</v><c r="B1"><v>6</v></c></row>',
    '<row r="1"><c r="A1"><v>5</v><c/></c></row>', '<row r="1"><c r="A1"><v>5</v><c\tr="B1"><v>6</v></c></row>', '<row r="1"><c r="A1"><v>5</v><c\nr="B1"><v>6</v></c></row>',
    '<row r="1"><c r="A1"><v>5</v><c\rr="B1"><v>6</v></c></row>']) {   // r4: "/", tab, newline; r5: carriage return
    assert.equal(read(rows).sheets[0].cut, true, rows);
  }
  // Review r2: a part truly cut short (no ">" after a start tag, or no close of a row or of sheetData) is counted too;
  // these are raw parts, not wrapped by fx.SHEET, which would supply closing tags.
  for (const part of ['<worksheet><sheetData><row r="1"><c r="A1" ', '<worksheet><sheetData><row r="1">', '<worksheet><sheetData>', '<worksheet><sheetData><row r="1"><c r="A1"><v>5</v></c>']) {
    const r = x.readXlsx(fx.book({ S: part }));
    assert.equal(r.sheets[0].cut, true, part);
    assert.equal(r.empty, false, part);
  }
  // Review r2: a raw ">" inside an attribute (legal XML) is no cut-off tag: "no saved values" is still said.
  const gt = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1"><f>1</f></c></row>') }, { 'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[>100]0"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' }));
  assert.equal(gt.noValues, true);
  const named = x.readXlsx(fx.book({ 'A>B': fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') }));
  assert.deepEqual([named.sheets[0].name, named.sheets[0].cut, named.sheets[0].rows], ['A>B', false, [['1']]]);
  // Review r1: an element lost outside the sheet walk (the shared strings, the sheet list) keeps the workbook from "empty".
  const list = '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"></sheets></workbook>';
  const lost = x.readXlsx(fx.book({ A: fx.SHEET(''), B: fx.SHEET('<row r="1"><c r="A1"><v>5</v></c></row>') }, { 'xl/workbook.xml': list }));
  assert.equal(lost.empty, false, 'a sheet lost from the list read as an empty workbook');
  const sst = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>0</v></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si><t>hi</si></sst>' }));
  assert.equal(sst.empty, false);
  // CONTROL: a whole cell is read and the sheet is not cut.
  const ok = read('<row r="1"><c r="A1"><v>5</v></c></row>');
  assert.deepEqual(ok.sheets[0].rows, [['5']]);
  assert.equal(ok.sheets[0].cut, false);
});

/* #8162 review r3: the pieces a mutation could remove without a test noticing */
test('#8162 r3: the seam refuses an answer past 8 MiB of JSON, and remembers that', () => {
  const sp = require('./sheetpreview');
  sp._forgetForTests();
  const line = Array.from({ length: 50 }, () => '\x01'.repeat(200)).join(',');
  const csv = Buffer.from((line + '\n').repeat(200));
  assert.ok(csv.length <= sp.MAX_DELIMITED_BYTES, 'under the input cap: ' + csv.length);
  assert.equal(sp.fromBytes(csv, 'ctl.csv').tooLarge, true);
  assert.equal(sp._heldForTests().count, 1, 'the refusal is remembered (r5)');
  assert.equal(sp.fromBytes(csv, 'ctl.csv').tooLarge, true);
  sp._forgetForTests();
  // CONTROL: the same shape with plain letters fits.
  assert.equal(sp.fromBytes(Buffer.from((Array.from({ length: 50 }, () => 'a'.repeat(200)).join(',') + '\n').repeat(200)), 'a.csv').ok, true);
  sp._forgetForTests();
});

test('#8162 r3: a start tag with no end, alone, is counted; single quotes are quotes; an empty skipped string is nothing', () => {
  // Only the "no >" count can see this: the sheet is empty and the shared strings end inside a start tag.
  const a = x.readXlsx(fx.book({ S: fx.SHEET('') }, { 'xl/sharedStrings.xml': '<sst><si><t>hi</t></si><si ' }));
  assert.equal(a.empty, false);
  // A sheet entry written with single quotes, with a raw ">" inside them.
  const wb = "<workbook xmlns:r='r'><sheets><sheet name='A>B' sheetId='1' r:id='rId1'/></sheets></workbook>";
  const b = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') }, { 'xl/workbook.xml': wb }));
  assert.deepEqual([b.sheets[0].name, b.sheets[0].cut, b.sheets[0].rows], ['A>B', false, [['1']]]);
  // A skipped row holding only an empty inline string is no value.
  const c = x.readXlsx(fx.book({ S: fx.SHEET('<row r="2000000"><c t="inlineStr"><is><t></t></is></c></row>') }));
  assert.equal(c.empty, true);
  assert.equal(c.sheets[0].cut, false);
});

test('#8162 r4: an answer that cannot be written to JSON is "too large", not a crash', () => {
  const sp = require('./sheetpreview');
  sp._forgetForTests();
  const real = JSON.stringify;
  let calls = 0;
  // Only the seam's own write of the whole answer (the reader also writes single cells to count its output).
  JSON.stringify = function (...args) {
    const v = args[0];
    if (v && typeof v === 'object' && 'ok' in v && ++calls === 1) throw new RangeError('Invalid string length');
    return real.apply(this, args);
  };
  let r;
  try { r = sp.fromBytes(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>') }), 'throw.xlsx'); } finally { JSON.stringify = real; sp._forgetForTests(); }
  assert.equal(calls >= 1, true, 'CONTROL: the stub was reached');
  assert.equal(r.tooLarge, true, JSON.stringify(r));
});

test('#8162 r5: an unclosed quote never loses later cells silently; a cut-off shared string marks its cell; rich text is no cut', () => {
  const read = (rows, extra) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }, extra));
  const q = read('<row r="1"><c r="A1" s="1><v>1</v></c><c r="B1" t="inlineStr"><is><t>it\'s "x</t></is></c></row><row r="2"><c r="A2"><v>3</v></c></row>');
  assert.equal(q.sheets[0].cut, true, JSON.stringify(q.sheets[0]));
  // Review r6: and the cells after the damaged tag are still read (only the fallback to its first ">" does that).
  assert.deepEqual(q.sheets[0].rows[1], ['3', ''], JSON.stringify(q.sheets[0].rows));
  const s = read('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>', { 'xl/sharedStrings.xml': '<sst><si><t>hi</si><si><t>ok</t></si></sst>' });
  assert.equal(s.sheets[0].cut, true, 'a blank cell from a cut-off string said nothing');
  // A skipped row whose only value is an inline string still counts.
  const f = read('<row r="2000000"><c t="inlineStr"><is><t>x</t></is></c></row>');
  assert.equal(f.empty, false);
  assert.equal(f.sheets[0].cut, true);
  // CONTROL: a well-formed rich inline string (<color> starts like <c) is read whole, with no cut.
  const rich = read('<row r="1"><c r="A1" t="inlineStr"><is><r><rPr><color rgb="FFFF0000"/><b/></rPr><t>red</t></r><r><t> plain</t></r></is></c></row>');
  assert.deepEqual([rich.sheets[0].rows, rich.sheets[0].cut], [[['red plain']], false]);
});

test('#8162 r6: a shared string lost at the <si> level marks its cell; a raw "<" in a quoted format code is text', () => {
  const read = (rows, sst) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }, { 'xl/sharedStrings.xml': sst }));
  const cells = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>';
  // The part ends inside the last string: C1 is lost, and says so.
  const a = read(cells, '<sst><si><t>a</t></si><si><t>b</t></si><si><t>c</t>');
  assert.equal(a.sheets[0].cut, true, JSON.stringify(a.sheets[0]));
  // A string missing its close swallowed the next: the cell using it is cut.
  const b = read(cells, '<sst><si><t>a</t><si><t>b</t></si><si><t>c</t></si></sst>');
  assert.equal(b.sheets[0].cut, true, JSON.stringify(b.sheets[0]));
  // CONTROL: whole strings, no cut.
  const ok = read(cells, '<sst><si><t>a</t></si><si><t>b</t></si><si><t>c</t></si></sst>');
  assert.deepEqual([ok.sheets[0].rows, ok.sheets[0].cut], [[['a', 'b', 'c']], false]);
  // A raw "<" inside a quoted format code does not drop the number formats after it.
  const styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[<100]0.0"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  const d = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="2"><v>45000</v></c></row>') }, { 'xl/styles.xml': styles }));
  assert.deepEqual(d.sheets[0].rows, [['2023-03-15']]);
});

test('#8162 r7: a swallowed <si> or <xf> makes every later index suspect; "<" outside a quote ends a tag; an open guide counts', () => {
  const read = (rows, extra) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }, extra));
  // Index 0 swallowed index 1, so cells at 1 and 2 would show another cell's text: they are cut.
  const s = read('<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c></row>', { 'xl/sharedStrings.xml': '<sst><si><t>a</t><si><t>b</t></si><si><t>c</t></si><si><t>d</t></si></sst>' });
  assert.equal(s.sheets[0].cut, true, JSON.stringify(s.sheets[0]));
  // A style that swallowed the next shifts every later style: the sheets that use them are cut.
  const st = '<styleSheet><cellXfs><xf numFmtId="0"><alignment/><xf numFmtId="0"><alignment/></xf><xf numFmtId="14"/></cellXfs></styleSheet>';
  assert.equal(read('<row r="1"><c r="A1" s="1"><v>45000</v></c><c r="B1" s="2"><v>45000</v></c></row>', { 'xl/styles.xml': st }).sheets[0].cut, true);
  // A format code with ">" then "<" (two conditions) cuts the style walk: the sheet says so.
  const fm = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[>100]0;[<=100]0.0"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  assert.equal(read('<row r="1"><c r="A1" s="2"><v>45000</v></c></row>', { 'xl/styles.xml': fm }).sheets[0].cut, true);
  // "<" outside a quote: the tag has no end, and B1's value never lands in A1 unannounced.
  const lt = read('<row r="1"><c r="A1" <c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row>');
  assert.equal(lt.sheets[0].cut, true, JSON.stringify(lt.sheets[0]));
  // A phonetic guide never closed loses the text after it: the cell is cut.
  const g = read('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', { 'xl/sharedStrings.xml': '<sst><si><r><t>a</t></r><rPh sb="0" eb="1"><t>x</t><r><t>b</t></r></si></sst>' });
  assert.equal(g.sheets[0].cut, true, JSON.stringify(g.sheets[0]));
  // CONTROL: the same strings and styles whole, no cut.
  assert.equal(read('<row r="1"><c r="A1" t="s"><v>1</v></c></row>', { 'xl/sharedStrings.xml': '<sst><si><t>a</t></si><si><t>b</t></si></sst>' }).sheets[0].cut, false);
});
