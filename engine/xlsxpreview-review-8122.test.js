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
  assert.ok(r.ms < 1000, 'took ' + r.ms + ' ms');
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
  assert.ok(r.ms < 1500, 'took ' + r.ms + ' ms');
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
    assert.ok(r.ms < 1000, `${label}: took ${r.ms} ms`);
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
