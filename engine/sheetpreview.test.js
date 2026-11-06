'use strict';
/**
 * kosmos#8122 (parser half): engine/sheetpreview.js, the viewer's grid from a spreadsheet's bytes or a stored file.
 * CSV and TSV through the same caps and shape as an .xlsx; a file too large, a link, a FIFO and a file that is not
 * text are refused in words; a workbook a script wrote says it has no saved values.
 *
 *   node --test engine/sheetpreview.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sp = require('./sheetpreview');
const xlsx = require('./xlsxpreview');
const fx = require('../test-support/xlsxfixture');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sheetpreview-'));
process.on('exit', () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
const csv = (text, name = 'data.csv') => sp.fromBytes(Buffer.from(text, 'utf8'), name);

test('which files have a grid: xlsx (and xlsm), csv and tsv, by name, case-blind; nothing else', () => {
  assert.equal(sp.kindOf('Plan.XLSX'), 'xlsx');
  assert.equal(sp.kindOf('macro.xlsm'), 'xlsx');
  assert.equal(sp.kindOf('a.csv'), 'csv');
  assert.equal(sp.kindOf('a.tsv'), 'tsv');
  for (const n of ['a.xls', 'a.ods', 'a.numbers', 'a.txt', 'a.pdf', 'xlsx', '']) assert.equal(sp.kindOf(n), null, n);
  assert.match(sp.fromBytes(Buffer.from('x'), 'notes.txt').because, /no spreadsheet preview for this kind of file/);
});

test('a CSV is the same shape as a workbook: one sheet named for the file, quoted fields, CRLF, a BOM', () => {
  const r = csv('﻿Name,"Note, with comma","He said ""hi"""\r\nAda,"two\nlines",3\r\n', 'people.csv');
  assert.equal(r.ok, true);
  assert.deepEqual(r.sheets, [{ name: 'people.csv', rows: [['Name', 'Note, with comma', 'He said "hi"'], ['Ada', 'two\nlines', '3']], cut: false }]);
  assert.equal(r.moreSheets, 0);
  assert.equal(r.noValues, false);
  assert.equal(r.empty, false);
  // Ragged rows are padded to the widest, so the grid is rectangular.
  assert.deepEqual(csv('a,b,c\nd\n').sheets[0].rows, [['a', 'b', 'c'], ['d', '', '']]);
  // A TSV splits on tabs, and a comma inside it is text.
  assert.deepEqual(sp.fromBytes(Buffer.from('a\tb,c\n'), 'x.tsv').sheets[0].rows, [['a', 'b,c']]);
});

test('a CSV value that looks like a formula is shown as the text it is: nothing in the file is evaluated', () => {
  const r = csv('=SUM(A1:A2),@cmd,+1+1,-2\n=HYPERLINK("http://example.invalid","x")\n');
  // A quote that does not open a field is text (RFC 4180), so the link formula stays as written and is never followed.
  assert.deepEqual(r.sheets[0].rows, [['=SUM(A1:A2)', '@cmd', '+1+1', '-2'], ['=HYPERLINK("http://example.invalid"', 'x)', '', '']]);
});

test('a CSV is capped like a workbook (rows, columns, a cell\'s text) and says it was cut', () => {
  const many = Array.from({ length: xlsx.MAX_ROWS + 5 }, (_, i) => String(i)).join('\n');
  const r1 = csv(many);
  assert.equal(r1.sheets[0].rows.length, xlsx.MAX_ROWS);
  assert.equal(r1.sheets[0].cut, true);
  const wide = Array.from({ length: xlsx.MAX_COLS + 3 }, (_, i) => 'c' + i).join(',');
  const r2 = csv(wide);
  assert.equal(r2.sheets[0].rows[0].length, xlsx.MAX_COLS);
  assert.equal(r2.sheets[0].cut, true);
  const long = csv('x'.repeat(xlsx.MAX_CELL_CHARS * 3)).sheets[0].rows[0][0];
  assert.equal(long.length, xlsx.MAX_CELL_CHARS);
  assert.ok(long.endsWith('…'));
  // CONTROL: exactly at the caps is not cut.
  assert.equal(csv(Array.from({ length: xlsx.MAX_ROWS }, () => 'a').join('\n')).sheets[0].cut, false);
});

test('an empty CSV is said as empty, and a quote never closed reads to the end, as a spreadsheet program does', () => {
  const r = csv('');
  assert.equal(r.ok, true);
  assert.equal(r.empty, true);
  assert.deepEqual(r.sheets[0].rows, []);
  assert.deepEqual(csv('a,"open\nstill open').sheets[0].rows, [['a', 'open\nstill open']]);
});

test('a hostile delimited file: a NUL byte (not text) and an oversized file are refused in words, before parsing', () => {
  assert.match(csv('a,b\0c').because, /could not be read as a spreadsheet/);
  const big = Buffer.alloc(sp.MAX_DELIMITED_BYTES + 1, 0x61);
  const r = sp.fromBytes(big, 'big.csv');
  assert.equal(r.ok, false);
  assert.equal(r.tooLarge, true);
  assert.match(r.because, /too large to preview/);
  // A quote storm does not hang: one pass, bounded memory.
  const t0 = Date.now();
  assert.equal(csv('"'.repeat(sp.MAX_DELIMITED_BYTES - 1)).ok, true);
  assert.ok(Date.now() - t0 < 5000, 'a quote storm took too long');
});

test('an .xlsx through fromBytes: saved values, and a script-written workbook says it has no saved values', () => {
  const r = sp.fromBytes(fx.SIMPLE(), 'plan.xlsx');
  assert.equal(r.ok, true);
  assert.deepEqual(r.sheets[0].rows, [['Name', '42']]);
  const s = sp.fromBytes(fx.SCRIPTED(), 'totals.xlsx');
  assert.equal(s.ok, true);
  assert.equal(s.noValues, true, 'a script-written workbook would be drawn as an empty grid');
  assert.equal(s.empty, false);
  // A file named .xlsx that is not one is refused in words.
  assert.match(sp.fromBytes(Buffer.from('PK not a zip'), 'fake.xlsx').because, /could not be read as a spreadsheet/);
});

test('fromFile: one handle; a link is not followed, a FIFO does not block, the size is checked before reading', () => {
  const real = path.join(DIR, 'plan.xlsx');
  fs.writeFileSync(real, fx.SIMPLE());
  assert.equal(sp.fromFile(real, 'plan.xlsx').ok, true, 'CONTROL: a real workbook is read');
  const link = path.join(DIR, 'link.xlsx');
  let linked = true;
  try { fs.symlinkSync(real, link); } catch (e) { if (process.platform === 'win32' && e && e.code === 'EPERM') linked = false; else throw e; }
  // On Windows a link needs a privilege the runner may not have; where it can be made, it must be refused there too.
  if (linked) assert.equal(sp.fromFile(link, 'link.xlsx').ok, false, 'a link was followed');
  if (process.platform !== 'win32') {
    const fifo = path.join(DIR, 'pipe.csv');
    execFileSync('mkfifo', [fifo]);
    const t0 = Date.now();
    assert.equal(sp.fromFile(fifo, 'pipe.csv').ok, false, 'a FIFO was read');
    assert.ok(Date.now() - t0 < 2000, 'a FIFO blocked the read');
  }
  // Too large: refused from the size alone (a sparse file, so nothing large is written).
  const big = path.join(DIR, 'big.xlsx');
  const fd = fs.openSync(big, 'w');
  fs.ftruncateSync(fd, xlsx.MAX_FILE_BYTES + 1);
  fs.closeSync(fd);
  const r = sp.fromFile(big, 'big.xlsx');
  assert.equal(r.tooLarge, true);
  assert.match(r.because, /too large to preview/);
  assert.match(sp.fromFile(path.join(DIR, 'missing.csv'), 'missing.csv').because, /could not be read/);
});
