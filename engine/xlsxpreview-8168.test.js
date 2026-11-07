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

test('#8168: a row of 95,000 self-closed cells and one closed cell after them is read in one pass', () => {
  // Round 4: big enough that searching for the close again per cell (no cache) runs past the work budget and is
  // refused; one pass is milliseconds. 20,000 cells read in about a second either way, so could not tell them apart.
  const cells = Array.from({ length: 95000 }, (_, i) => `<c r="A${i + 1}" s="0"/>`).join('');
  const r = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1">' + cells + '<c r="B1"><v>7</v></c></row>') }, {}, { deflate: true }));
  assert.equal(r.sheets[0].cut, false, JSON.stringify(r.sheets[0]).slice(0, 200));
});

test('#8168 CONVENTION: a cell body of over a million "<cx" near-misses is refused, not read', () => {
  const body = '<cx'.repeat(1100000);
  assert.throws(() => x.readXlsx(fx.book({ S: fx.SHEET(`<row r="1"><c r="A1"><v>1</v>${body}</c></row>`) })), /too large/i);
  // CONTROL: a few near-misses are read.
  assert.doesNotThrow(() => x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v><cx/></c></row>') })));
});

test('#8168 r1: a lost start on the LAST item is counted too', () => {
  const one = (rows, extra) => x.readXlsx(fx.book({ S: fx.SHEET(rows) }, extra)).sheets[0];
  assert.equal(one('<row r="1"><c r="A1"><v>1</v></c><v>2</v></c></row>').cut, true, 'a lost last <c');
  assert.equal(one('<row r="1"><c r="A1"><v>1</v></c></row><c r="A2"><v>2</v></c></row>').cut, true, 'a lost last <row');
  const si = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" t="s"><v>1</v></c></row>') }, { 'xl/sharedStrings.xml': '<sst><si><t></t></si><t>b</t></si></sst>' }));
  assert.equal(si.sheets[0].cut, true, 'a lost last <si>: ' + JSON.stringify(si));
  assert.notEqual(si.empty, true, 'a workbook holding a string is never called empty');
});

test('#8168 r1: a near-miss does not hide a stray close before it', () => {
  const s = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>1</v></c><v>2</v></c><cx/><c r="C1"><v>3</v></c></row>') })).sheets[0];
  assert.equal(s.cut, true, JSON.stringify(s));
});

test('#8168 r1: a lost start of a self-closed <sheet>, <numFmt>, <Relationship> or last <xf> is counted', () => {
  const wb = '<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/>name="B" sheetId="2" r:id="rId2"/></sheets></workbook>';
  assert.deepEqual(cuts(read({ 'xl/workbook.xml': wb })), [true], 'a lost <sheet');
  const fmt = '<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/> numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="165"/></cellXfs></styleSheet>';
  assert.deepEqual(cuts(read({ 'xl/styles.xml': fmt })), [true, true], 'a lost <numFmt');
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/> Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>';
  assert.deepEqual(cuts(read({ 'xl/_rels/workbook.xml.rels': rels })), [true, true], 'a lost <Relationship');
  const lastXf = '<styleSheet><cellXfs><xf numFmtId="0"/> numFmtId="14"/></cellXfs></styleSheet>';
  assert.deepEqual(cuts(read({ 'xl/styles.xml': lastXf })), [true, true], 'a lost last <xf');
  // CONTROLS: the same lists whole, with whitespace between items, are no cut.
  const okFmt = '<styleSheet><numFmts count="1">\n  <numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>\n</numFmts><cellXfs count="2">\n  <xf numFmtId="0"/>\n  <xf numFmtId="165"/>\n</cellXfs></styleSheet>';
  assert.deepEqual(cuts(read({ 'xl/styles.xml': okFmt })), [false, false]);
  const okWb = '<workbook><sheets>\n  <sheet name="A" sheetId="1" r:id="rId1"/>\n  <sheet name="B" sheetId="2" r:id="rId2"/>\n</sheets></workbook>';
  assert.deepEqual(cuts(read({ 'xl/workbook.xml': okWb })), [false, false]);
});

test('#8168 r1: a list of 300,000 sheets answers MAX_SHEETS and counts the rest', () => {
  // Round 2: structure, not the heap (a synchronous read cannot be sampled). Holding every entry is what the cap stops,
  // and a list read without it answers every sheet.
  const many = '<workbook><sheets>' + '<sheet name="S" sheetId="1" r:id="rId1"/>'.repeat(300000) + '</sheets></workbook>';
  const r = x.readXlsx(fx.book(TWO, { 'xl/workbook.xml': many }, { deflate: true }));
  assert.equal(r.sheets.length, x.MAX_SHEETS, 'answered more than MAX_SHEETS');
  assert.equal(r.moreSheets, 300000 - x.MAX_SHEETS, 'the rest are counted');
  // veryHidden sheets are neither shown nor counted.
  const hidden = '<workbook><sheets><sheet name="H" state="veryHidden" sheetId="9" r:id="rId2"/><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const h = read({ 'xl/workbook.xml': hidden });
  assert.deepEqual([h.sheets.map((s) => s.name), h.moreSheets], [['A'], 0]);
});

test('#8168 r1: the real workbooks read as before, with no cut', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const name of fs.readdirSync(path.join(__dirname, '..', 'test-support', 'xlsx')).filter((n) => n.endsWith('.xlsx'))) {
    const r = x.readXlsx(fs.readFileSync(path.join(__dirname, '..', 'test-support', 'xlsx', name)));
    assert.ok(r.sheets.length > 0, name);
    assert.deepEqual(r.sheets.map((s) => s.cut), r.sheets.map(() => false), name + ' reads as cut: ' + JSON.stringify(r.sheets.map((s) => s.name)));
  }
});

test('#8168 r3: a list whose container was lost is read as before, and said cut, never empty', () => {
  // The rels root lost at both ends: the sheets are still found, and the loss is counted.
  const rels = '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/>';
  const r = read({ 'xl/_rels/workbook.xml.rels': rels });
  assert.deepEqual(r.sheets.map((s) => s.rows), [[['1']], [['2']]], 'the sheets were not read: ' + JSON.stringify(r));
  assert.notEqual(r.empty, true);
  assert.deepEqual(cuts(r), [true, true]);
  // The <sheets> wrapper lost: read as before, and cut.
  const wb = '<workbook><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/></workbook>';
  const w = read({ 'xl/workbook.xml': wb });
  assert.deepEqual([w.sheets.map((s) => s.name), cuts(w)], [['A', 'B'], [true, true]]);
});

test('#8168 r3: a custom format no <numFmt> defines (its wrapper lost) is cut, never a bare number said whole', () => {
  const lost = '<styleSheet><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>';
  const s = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>') }, { 'xl/styles.xml': lost })).sheets[0];
  assert.equal(s.cut, true, JSON.stringify(s));
  // Round 4: a lost format no cell uses cuts nothing (every sheet was marked cut by one unused style).
  const unused = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1"><v>45000</v></c></row>') }, { 'xl/styles.xml': lost })).sheets[0];
  assert.deepEqual([unused.rows, unused.cut], [[['45000']], false], JSON.stringify(unused));
  // CONTROL: the same format inside <numFmts> is a date, whole.
  const ok = '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>';
  const o = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>') }, { 'xl/styles.xml': ok })).sheets[0];
  assert.deepEqual([o.rows, o.cut], [[['2023-03-15']], false]);
});

test('#8168 r3: a differential format (<dxf>) never replaces a cell format of the same id', () => {
  const st = '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>'
    + '<dxfs count="1"><dxf><numFmt numFmtId="164" formatCode="0.00%"/></dxf></dxfs></styleSheet>';
  const s = x.readXlsx(fx.book({ S: fx.SHEET('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>') }, { 'xl/styles.xml': st })).sheets[0];
  assert.deepEqual([s.rows, s.cut], [[['2023-03-15']], false], 'the conditional format overwrote the cell format: ' + JSON.stringify(s));
});

test('#8168 r3: an Excel 365 shaped workbook, rels and styles read with no cut', () => {
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="r" xmlns:mc="mc" mc:Ignorable="x15 xr xr6 xr10 xr2" xmlns:x15="x15">'
    + '<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/><workbookPr defaultThemeVersion="202300"/>'
    + '<mc:AlternateContent xmlns:mc="mc"><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\" xmlns:x15ac="x15ac"/></mc:Choice></mc:AlternateContent>'
    + '<bookViews><workbookView xWindow="-110" yWindow="-110" windowWidth="19420" windowHeight="10300"/></bookViews>'
    + '<sheets><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/>'
    + '<extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}" xmlns:x15="x15"><x15:workbookPr chartTrackingRefBase="1"/></ext></extLst></workbook>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId3" Type="t/theme" Target="theme/theme1.xml"/><Relationship Id="rId2" Type="t/worksheet" Target="worksheets/sheet2.xml"/>'
    + '<Relationship Id="rId1" Type="t/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId4" Type="t/styles" Target="styles.xml"/></Relationships>';
  const st = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<styleSheet xmlns="main" xmlns:mc="mc" mc:Ignorable="x14ac x16r2 xr" xmlns:x14ac="x14ac">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd;@"/></numFmts>'
    + '<fonts count="1" x14ac:knownFonts="1"><font><sz val="11"/><name val="Aptos Narrow"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><numFmt numFmtId="165" formatCode="0.0%"/></dxf></dxfs>'
    + '<extLst><ext uri="{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}" xmlns:x14="x14"><x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1"/></ext></extLst></styleSheet>';
  const r = x.readXlsx(fx.book({ A: fx.SHEET('<row r="1" spans="1:1" x14ac:dyDescent="0.35"><c r="A1" s="1"><v>45000</v></c></row>'), B: fx.SHEET('<row r="1"><c r="A1"><v>2</v></c></row>') },
    { 'xl/workbook.xml': wb, 'xl/_rels/workbook.xml.rels': rels, 'xl/styles.xml': st }));
  assert.deepEqual(r.sheets.map((s) => [s.name, s.rows, s.cut]), [['A', [['2023-03-15']], false], ['B', [['2']], false]], JSON.stringify(r.sheets));
});
