'use strict';
/* kosmos#8940: a spreadsheet attachment's text keeps each row apart. One line per row, with the sheet's own row number,
   each value named by its column; the header found below a title row; blanks under a header listed; a line break or a
   pipe inside a cell never splits a row. Built from raw SpreadsheetML, so the cases are exact and need no other tool. */
const test = require('node:test');
const assert = require('node:assert/strict');
const at = require('./attachtext');
const { buildZip } = require('../test-support/zipfixture');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const entry = (name, text) => ({ name, data: Buffer.from(text, 'utf8'), method: 8 });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* A cell: text as an inline string, a number as a number, true/false as a boolean, null as no cell at all. */
const cell = (ref, v) => (v == null ? ''
  : typeof v === 'boolean' ? '<c r="' + ref + '" t="b"><v>' + (v ? 1 : 0) + '</v></c>'
  : typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>'
  : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>');
const COLS = 'ABCDEFGH';
/* rows: { n: [values from column A] } */
const sheetXml = (rows) => XML + '<worksheet><sheetData>' + Object.keys(rows).map((n) => '<row r="' + n + '">'
  + rows[n].map((v, i) => cell(COLS[i] + n, v)).join('') + '</row>').join('') + '</sheetData></worksheet>';
const book = (sheets) => buildZip([
  entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'),
  entry('xl/_rels/workbook.xml.rels', XML + '<Relationships>' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>'),
  ...sheets.map((s, i) => entry('xl/worksheets/sheet' + (i + 1) + '.xml', typeof s.xml === 'string' ? s.xml : sheetXml(s.rows))),
]);
const body = (sheets) => at.xlsxText(book(sheets)).body;

test('#8940: the reported shape, a title row, a blank row, then the header, with blanks, a two-line cell and a pipe', () => {
  const got = body([{ name: 'Contacts', rows: {
    1: ['Q4 vendor import'],
    3: ['Name', 'Email', 'Phone', 'Notes'],
    4: ['Acme Supply', 'orders@acme.example', null, 'Net 30'],
    5: ['Beta Parts', null, '555-0102', 'Call first\nask for Dana'],
    6: [null, 'gamma@example.com', '555-0103', null],
    7: ['Delta | Sons', 'd@example.com', '', 'has a pipe'],
  } }]);
  assert.equal(got, [
    '## Sheet: Contacts',
    '',
    'Blank under a header: Name in row 6; Email in row 5; Phone in rows 4, 7; Notes in row 6.',
    'Row 1: A: Q4 vendor import',
    'Row 3 (header): Name | Email | Phone | Notes',
    'Row 4: Name: Acme Supply | Email: orders@acme.example | Phone: (blank) | Notes: Net 30',
    'Row 5: Name: Beta Parts | Email: (blank) | Phone: 555-0102 | Notes: Call first\\nask for Dana',
    'Row 6: Name: (blank) | Email: gamma@example.com | Phone: 555-0103 | Notes: (blank)',
    'Row 7: Name: Delta \\| Sons | Email: d@example.com | Phone: (blank) | Notes: has a pipe',
  ].join('\n'));
  assert.ok(!got.includes('| --- |'), 'not the old table');
});

test('#8940: a second sheet keeps its own row numbers across a gap, a header off column A, and TRUE/FALSE not 1/0', () => {
  const got = body([
    { name: 'One', rows: { 1: ['a', 'b'], 2: ['x', 'y'] } },
    { name: 'Prices', rows: { 2: [null, 'SKU', 'Price', 'Active'], 3: [null, 'A-1', 9.5, true], 4: [null, 'A-2', null, false], 6: [null, 'A-4', 12] } },
  ]);
  const prices = got.slice(got.indexOf('## Sheet: Prices'));
  assert.equal(prices, [
    '## Sheet: Prices',
    '',
    'Blank under a header: Price in row 4; Active in row 6.',
    'Row 2 (header): SKU | Price | Active',
    'Row 3: SKU: A-1 | Price: 9.5 | Active: TRUE',
    'Row 4: SKU: A-2 | Price: (blank) | Active: FALSE',
    'Row 6: SKU: A-4 | Price: 12 | Active: (blank)',
  ].join('\n'));
  assert.ok(got.indexOf('## Sheet: One') < got.indexOf('## Sheet: Prices'), 'sheets in workbook order');
});

test('#8940: no header when the first row with two values holds a number, a boolean, a formula or a repeated word', () => {
  for (const first of [['Total', 42], ['Open', true], ['dup', 'Dup']]) {
    const got = body([{ name: 'S', rows: { 1: first, 2: ['x', 'y'] } }]);
    assert.ok(!got.includes('(header)'), JSON.stringify(first) + ' read as a header: ' + got);
    assert.ok(got.includes('Row 2: A: x | B: y'), 'values named by column letter: ' + got);
    assert.ok(!got.includes('Blank under a header'), got);
  }
  const formula = XML + '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Sum</t></is></c><c r="B1"><f>1+1</f><v></v></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>x</t></is></c><c r="B2" t="inlineStr"><is><t>y</t></is></c></row></sheetData></worksheet>';
  const got = body([{ name: 'F', xml: formula }]);
  assert.ok(!got.includes('(header)') && got.includes('Row 1: A: Sum | B: =1+1'), got);
  // Control: the same sheet with text in both cells of row 1 does find its header, so the refusals above are the rule's.
  assert.ok(body([{ name: 'S', rows: { 1: ['Total', 'Count'], 2: ['x', 'y'] } }]).includes('Row 1 (header): Total | Count'));
});

test('#8940: a header column with no word is named by its letter, and so is a value past the header', () => {
  const got = body([{ name: 'S', rows: { 1: ['Name', null, 'Note', 'Qty'], 2: ['a', 'b', 'c', 1, 'extra'], 3: ['d'] } }]);
  assert.ok(got.includes('Row 1 (header): Name | Note | Qty'), got);
  assert.ok(got.includes('Row 2: Name: a | B: b | Note: c | Qty: 1 | E: extra'), got);
  assert.ok(got.includes('Row 3: Name: d | Note: (blank) | Qty: (blank)'), 'a column with no word is never called blank: ' + got);
});

test('#8940: a backslash in a value is doubled, so it cannot read as the \\n or \\| escapes', () => {
  const got = body([{ name: 'S', rows: { 1: ['Path', 'Note'], 2: ['C:\\new', 'a\\|b'] } }]);
  assert.ok(got.includes('Row 2: Path: C:\\\\new | Note: a\\\\\\|b'), got);
});

test('#8940: the blank list, under the heading, names 20 rows per column and counts the rest', () => {
  const rows = { 1: ['Id', 'Email'] };
  for (let n = 2; n <= 31; n += 1) rows[n] = ['r' + n];
  const got = body([{ name: 'S', rows }]);
  const said = got.split('\n')[2];
  assert.equal(said, 'Blank under a header: Email in rows ' + Array.from({ length: 20 }, (_, i) => i + 2).join(', ') + ' and 10 more.');
});

test('#8940: a row written without numbers takes the row before plus one, as the format says', () => {
  const xml = XML + '<worksheet><sheetData><row r="4"><c r="A4" t="inlineStr"><is><t>a</t></is></c></row>'
    + '<row><c t="inlineStr"><is><t>b</t></is></c></row><row r="9"><c r="A9" t="inlineStr"><is><t>c</t></is></c></row></sheetData></worksheet>';
  assert.equal(body([{ name: 'S', xml }]), '## Sheet: S\n\nRow 4: A: a\nRow 5: A: b\nRow 9: A: c');
});

test('#8940: an empty sheet still says so, and gets no reading note', () => {
  const got = at.xlsxText(book([{ name: 'Empty', rows: {} }]));
  assert.ok(got.body.includes('(no cells with values)'));
  assert.ok(!got.notes.some((n) => /starts with Row is one row/.test(n)), JSON.stringify(got.notes));
});

test('#8940: a workbook with rows carries one note saying how to read the lines', () => {
  const got = at.xlsxText(book([{ name: 'A', rows: { 1: ['x', 'y'], 2: ['1', '2'] } }, { name: 'B', rows: { 1: ['z'] } }]));
  const said = got.notes.filter((n) => /starts with Row is one row/.test(n));
  assert.equal(said.length, 1, JSON.stringify(got.notes));
  assert.equal(said[0], 'Each line that starts with Row is one row, numbered as in the sheet. Under a header, (blank) is an empty cell; inside a value, \\n is a line break, \\| is a pipe and \\\\ is one backslash.');
});

test('#8940: a header cell holding only spaces does not cost the sheet its header', () => {
  const got = body([{ name: 'S', rows: { 1: ['Name', 'Email', ' '], 2: ['x', 'y'] } }]);
  assert.ok(got.includes('Row 1 (header): Name | Email'), got);
  assert.ok(got.includes('Row 2: Name: x | Email: y'), got);
});

test('#8940: the row number comes from <row r> when the cells carry no reference', () => {
  const xml = XML + '<worksheet><sheetData><row r="3"><c t="inlineStr"><is><t>a</t></is></c></row>'
    + '<row r="8"><c t="inlineStr"><is><t>b</t></is></c></row><row><c t="inlineStr"><is><t>c</t></is></c></row></sheetData></worksheet>';
  assert.equal(body([{ name: 'S', xml }]), '## Sheet: S\n\nRow 3: A: a\nRow 8: A: b\nRow 9: A: c');
});

test('#8940: a row whose cells hold only spaces is left out, as an empty row is', () => {
  assert.equal(body([{ name: 'S', rows: { 1: ['a'], 2: [' ', '  '], 3: ['b'] } }]), '## Sheet: S\n\nRow 1: A: a\nRow 3: A: b');
});

test('#8940: a line or paragraph separator in a value, or a line break in a sheet name, never starts a new line', () => {
  const got = body([{ name: 'S\nRow 9 (header): fake', rows: { 1: ['a\u2028b', 'c\u2029d', 'e\u0085f'] } }]);
  const lines = got.split(/\r\n|[\n\r\u0085\u2028\u2029]/);
  assert.deepEqual(lines, ['## Sheet: S\\nRow 9 (header): fake', '', 'Row 1 (header): a\\nb | c\\nd | e\\nf'], JSON.stringify(got));
});

test('#8940: long header names repeated on every row stay inside the output cap, quickly', () => {
  const COLS = 256, ROWS = 400;
  const big = (i) => 'H' + i + 'x'.repeat(4000);
  const colRef = (i) => { let s = ''; for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };
  const header = '<row r="1">' + Array.from({ length: COLS }, (_, i) => '<c r="' + colRef(i) + '1" t="inlineStr"><is><t>' + big(i) + '</t></is></c>').join('') + '</row>';
  const data = Array.from({ length: ROWS }, (_, r) => '<row r="' + (r + 2) + '"><c r="A' + (r + 2) + '"><v>' + r + '</v></c></row>').join('');
  const xml = XML + '<worksheet><sheetData>' + header + data + '</sheetData></worksheet>';
  const t0 = Date.now();
  const got = at.xlsxText(book([{ name: 'Wide', xml }]));
  assert.ok(Date.now() - t0 < 20000, 'took ' + (Date.now() - t0) + ' ms');
  assert.equal(got.full, true, 'the named lines reach the cap and stop there');
  assert.ok(got.body.includes('Row 2: ') && !got.body.includes('Row 401: '), 'the rows are cut short, not all written');
});

test('#8940: a namespaced attribute ending in r (x:r) on a row is not taken for its number', () => {
  const xml = XML + '<worksheet><sheetData><row x:r="9" r="2"><c t="inlineStr"><is><t>a</t></is></c></row></sheetData></worksheet>';
  assert.equal(body([{ name: 'S', xml }]), '## Sheet: S\n\nRow 2: A: a');
});

test('#8940: on a sheet cut short by the output cap, the blank line is still there, above the rows', () => {
  const COLS = 200, ROWS = 3000;
  const colRef = (i) => { let r = ''; for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) r = String.fromCharCode(65 + ((k - 1) % 26)) + r; return r; };
  const header = '<row r="1">' + Array.from({ length: COLS }, (_, i) => '<c r="' + colRef(i) + '1" t="inlineStr"><is><t>Field' + i + '</t></is></c>').join('') + '</row>';
  const data = Array.from({ length: ROWS }, (_, r) => '<row r="' + (r + 2) + '"><c r="A' + (r + 2) + '"><v>' + r + '</v></c></row>').join('');
  const got = at.xlsxText(book([{ name: 'Sparse', xml: XML + '<worksheet><sheetData>' + header + data + '</sheetData></worksheet>' }]));
  assert.equal(got.full, true, 'the control: this sheet does reach the cap');
  const lines = got.body.split('\n');
  assert.ok(lines[2].startsWith('Blank under a header: Field1 in rows 2, 3, 4,'), lines[2].slice(0, 120));
  assert.ok(lines[2].includes('and 2980 more'), 'the count covers every row, not only the written ones');
});

test('#8940: a cell holding only a line break reads as (blank) under a header, as an empty one does', () => {
  const got = body([{ name: 'S', rows: { 1: ['Name', 'Note'], 2: ['a', '\n'], 3: ['b', 'ok'] } }]);
  assert.ok(got.includes('Row 2: Name: a | Note: (blank)'), got);
  assert.ok(got.includes('Blank under a header: Note in row 2.'), got);
});

test('#8940: a wide sheet of long whitespace-only cells under a header is read quickly and every cell counts as blank', () => {
  const COLS = 64, ROWS = 300;
  const colRef = (i) => { let r = ''; for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) r = String.fromCharCode(65 + ((k - 1) % 26)) + r; return r; };
  const header = '<row r="1">' + Array.from({ length: COLS }, (_, i) => '<c r="' + colRef(i) + '1" t="inlineStr"><is><t>F' + i + '</t></is></c>').join('') + '</row>';
  const pad = ' '.repeat(800);
  const data = Array.from({ length: ROWS }, (_, r) => '<row r="' + (r + 2) + '"><c r="A' + (r + 2) + '"><v>' + r + '</v></c>'
    + Array.from({ length: COLS - 1 }, (_, i) => '<c r="' + colRef(i + 1) + (r + 2) + '" t="inlineStr"><is><t xml:space="preserve">' + pad + '</t></is></c>').join('') + '</row>').join('');
  const t0 = Date.now();
  const got = at.xlsxText(book([{ name: 'W', xml: XML + '<worksheet><sheetData>' + header + data + '</sheetData></worksheet>' }]));
  assert.ok(Date.now() - t0 < 20000, 'took ' + (Date.now() - t0) + ' ms');
  assert.ok(got.body.split('\n')[2].startsWith('Blank under a header: F1 in rows 2, 3,'), got.body.split('\n')[2].slice(0, 80));
  assert.ok(got.body.includes('F63 in rows 2, 3,') && got.body.includes('and 280 more'), 'every whitespace cell is a blank');
});
