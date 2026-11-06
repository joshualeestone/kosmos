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
  assert.deepEqual(b1900.sheets[0].rows[0], ['1900-01-01', '1900-02-29', '1900-03-01', '12:00', '25%', '18:00', '0.3']);
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
