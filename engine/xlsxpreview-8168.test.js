'use strict';
/**
 * kosmos#8168: round 8's leftovers from #8162, all XML damaged before zipping. A cut sheet list or rels said
 * `cut: false` on the sheets it kept; a start tag lost with its close left behind showed another item's text; and two
 * rules had no test that failed without them.
 *
 *   node --test engine/xlsxpreview-8168.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const x = require('./xlsxpreview');
const fx = require('../test-support/xlsxfixture');

const TWO = { A: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c></row>'), B: fx.SHEET('<row r="1"><c r="A1"><v>2</v></c></row>') };
const read = (extra, sheets = TWO) => x.readXlsx(fx.book(sheets, extra));
const cuts = (r) => r.sheets.map((s) => s.cut);

test('#8168 W1: a sheet list cut inside its second <sheet makes the sheet it kept cut too', () => {
  const wb = fx.WB(['A', 'B']);
  const at = wb.indexOf('<sheet ', wb.indexOf('<sheet ') + 1);
  assert.ok(at > 0, 'CONTROL: the fixture has a second sheet');
  const r = read({ 'xl/workbook.xml': wb.slice(0, at + 8) });
  assert.equal(r.sheets[0].name, 'A');
  assert.equal(r.sheets[0].cut, true, 'the kept sheet says it is whole: ' + JSON.stringify(r.sheets));
  // CONTROL: the same workbook whole, no cut.
  assert.deepEqual(cuts(read({})), [false, false]);
});

test('#8168 W1: rels cut inside the second Relationship mark every sheet cut, the one it cannot place included', () => {
  const rels = fx.RELS(2);
  const at = rels.indexOf('<Relationship ', rels.indexOf('<Relationship ') + 1);
  assert.ok(at > 0, 'CONTROL: the fixture has a second relationship');
  const r = read({ 'xl/_rels/workbook.xml.rels': rels.slice(0, at + 20) });
  assert.equal(r.sheets[1].notGrid, true, 'CONTROL: sheet B could not be placed: ' + JSON.stringify(r.sheets[1]));
  assert.deepEqual(cuts(r), [true, true], JSON.stringify(r.sheets));
});

test('#8168 W3: a rels cut-off makes every sheet cut even when every sheet was placed', () => {
  // A third, unused relationship cut short: both sheets are read normally, and only the rule marks them.
  const rels = fx.RELS(2).replace('</Relationships>', '<Relationship Id="rId9" Target="work');
  const r = read({ 'xl/_rels/workbook.xml.rels': rels });
  assert.deepEqual(r.sheets.map((s) => s.rows), [[['1']], [['2']]], 'CONTROL: both sheets were read');
  assert.deepEqual(cuts(r), [true, true], 'a cut-off rels did not mark the sheets: ' + JSON.stringify(r.sheets));
});

test('#8168 W2: a start tag lost with its close left behind is cut, never another item\'s value', () => {
  const one = (rows, extra) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }, extra)).sheets[0];
  // A lost <si>: index 1 would show "c".
  const si = one('<row r="1"><c r="A1" t="s"><v>1</v></c></row>', { 'xl/sharedStrings.xml': '<sst><si><t>a</t></si><t>b</t></si><si><t>c</t></si></sst>' });
  assert.equal(si.cut, true, JSON.stringify(si));
  // A lost <c: a cell gone.
  const c = one('<row r="1"><c r="A1"><v>1</v></c><v>2</v></c><c r="C1"><v>3</v></c></row>');
  assert.equal(c.cut, true, JSON.stringify(c));
  // A lost <row: two rows merged.
  const row = one('<row r="1"><c r="A1"><v>1</v></c></row><c r="A2"><v>2</v></c></row><row r="3"><c r="A3"><v>3</v></c></row>');
  assert.equal(row.cut, true, JSON.stringify(row));
  // A lost self-closed <xf: every later style shifts.
  const xf = one('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>', { 'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/> numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' });
  assert.equal(xf.cut, true, JSON.stringify(xf));
  // CONTROLS: the same parts whole, no cut, and a style with a body (an <alignment>) is no stray.
  assert.equal(one('<row r="1"><c r="A1" t="s"><v>1</v></c></row>', { 'xl/sharedStrings.xml': '<sst><si><t>a</t></si><si><t>b</t></si></sst>' }).cut, false);
  assert.equal(one('<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>2</v></c></row>').cut, false);
  assert.equal(one('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>', { 'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"><alignment/></xf>\n  <xf numFmtId="14"/></cellXfs></styleSheet>' }).cut, false);
});

test('#8168: a sheet of self-closed cells (no closes at all) is still read in one pass', () => {
  const cells = Array.from({ length: 20000 }, (_, i) => `<c r="A${i + 1}" s="0"/>`).join('');
  const t = Date.now();
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1">' + cells + '<c r="B1"><v>7</v></c></row>') }));
  assert.ok(Date.now() - t < 5000, 'took ' + (Date.now() - t) + ' ms');
  assert.equal(r.sheets[0].cut, false, JSON.stringify(r.sheets[0]).slice(0, 200));
});

test('#8168 CONVENTION: a cell body of over a million "<cx" near-misses is refused, not read', () => {
  const body = '<cx'.repeat(1100000);
  assert.throws(() => x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1"><c r="A1"><v>1</v>${body}</c></row>`) })), /too large/i);
  // CONTROL: a few near-misses are read.
  assert.doesNotThrow(() => x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v><cx/></c></row>') })));
});
