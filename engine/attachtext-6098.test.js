'use strict';

/**
 * #6098: an xlsx, a docx and a pdf attached to a message each read back as usable text through the same command a text
 * attachment uses: engine/attachtext.js writes text.txt beside the stored file on upload, and the bracketed line the
 * agent receives (attachments.wireNote) names it. Every fixture is built here, small, so the test runs the same on a
 * Mac and on Windows; the PDFs exercise the shapes a modern writer produces (Flate streams, an object stream, a font
 * with a two-byte ToUnicode map), and macOS's PDFKit is stubbed so nothing shells out.
 *
 *   node --test engine/attachtext-6098.test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6098-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const at = require('./attachtext');
const attachments = require('./attachments');
const { buildZip } = require('../test-support/zipfixture');

let kitCalls = 0;
at.setPdfkit(async () => { kitCalls += 1; return null; });   // never shell out from a test

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const entry = (name, text) => ({ name, data: Buffer.from(text, 'utf8'), method: 8 });

function xlsx() {
  return buildZip([
    entry('[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="Sales &amp; Costs" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    entry('xl/sharedStrings.xml', XML + '<sst><si><t>Region</t></si><si><t>Revenue</t></si><si><t>North</t></si><si><r><t>South</t></r><r><t> | West</t></r></si></sst>'),
    entry('xl/worksheets/sheet1.xml', XML + '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>10</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>20</v></c></row>'
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>30</v></c></row>'
      + '</sheetData></worksheet>'),
    entry('xl/worksheets/sheet2.xml', XML + '<worksheet><sheetData><row r="1"><c r="C1" t="inlineStr"><is><t>Check the West figure</t></is></c></row></sheetData></worksheet>'),
    entry('xl/charts/chart1.xml', XML + '<chartSpace/>'),
  ]);
}

function docx() {
  const W = 'xmlns:w="w"';
  return buildZip([
    entry('[Content_Types].xml', XML + '<Types/>'),
    entry('word/document.xml', XML + `<w:document ${W}><w:body>`
      + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Launch plan</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t xml:space="preserve">Owner:</w:t></w:r><w:r><w:tab/><w:t>Dana</w:t></w:r></w:p>'
      + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Ship the beta &amp; gather feedback</w:t></w:r></w:p>'
      + '<w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>Week</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Goal</w:t></w:r></w:p></w:tc></w:tr>'
      + '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Invite 20 testers</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      + '<w:p><w:r><w:delText>removed words</w:delText></w:r><w:r><w:t>Last paragraph.</w:t></w:r></w:p>'
      + '</w:body></w:document>'),
    { name: 'word/media/image1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), method: 0 },
  ]);
}

/* A PDF assembled object by object, with a correct xref, so its byte offsets are real. */
function pdf(objects, trailerExtra) {
  let out = '%PDF-1.5\n%\xe2\xe3\xcf\xd3\n';
  const offs = [];
  const parts = [Buffer.from(out, 'latin1')];
  let len = parts[0].length;
  for (const [num, o] of objects) {
    offs[num] = len;
    const b = Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1');
    const head = Buffer.from(num + ' 0 obj\n', 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    parts.push(head, b, tail);
    len += head.length + b.length + tail.length;
  }
  const n = Math.max(...objects.map((o) => o[0])) + 1;
  let xref = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
  for (let i = 1; i < n; i += 1) xref += String(offs[i] || 0).padStart(10, '0') + ' 00000 n \n';
  parts.push(Buffer.from(xref + 'trailer\n<< /Size ' + n + ' /Root 1 0 R ' + (trailerExtra || '') + '>>\nstartxref\n' + len + '\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}
const streamObj = (dict, data) => {
  const z = zlib.deflateSync(Buffer.from(data, 'latin1'));
  return Buffer.concat([Buffer.from('<< ' + dict + ' /Filter /FlateDecode /Length ' + z.length + ' >>\nstream\n', 'latin1'), z, Buffer.from('\nendstream', 'latin1')]);
};

/* A simple PDF: a standard font, literal strings (the cupsfilter shape). */
function simplePdf() {
  return pdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'],
    [4, streamObj('', 'BT /F1 12 Tf 72 720 Td (Quarterly report) Tj 0 -14 Td (Revenue \\(net\\) grew.) Tj ET')],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [6, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>'],
    [7, streamObj('', 'BT /F1 12 Tf 72 720 Td [(Page) -250 (two)] TJ ET')],
  ]);
}

/* A modern-writer PDF: the font lives in an object stream and maps two-byte codes through a ToUnicode CMap. */
function modernPdf() {
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
    + '2 beginbfchar\n<0001> <0048>\n<0002> <0069>\nendbfchar\n1 beginbfrange\n<0003> <0004> <00E9>\nendbfrange\nendcmap end end';
  const fontDict = '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Body /Encoding /Identity-H /ToUnicode 6 0 R >>';
  const objstm = '5 0 ' + fontDict;
  const first = '5 0 '.length;
  return pdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F9 5 0 R >> >> >>'],   // inherited by the page
    [3, '<< /Type /Page /Parent 2 0 R /Contents [4 0 R] >>'],
    [4, streamObj('', 'BT /F9 11 Tf 1 0 0 1 72 700 Tm <00010002> Tj 1 0 0 1 72 680 Tm <00030004> Tj ET')],
    [6, streamObj('', cmap)],
    [7, streamObj('/Type /ObjStm /N 1 /First ' + first, objstm)],
  ]);
}

test('#6098 xlsx: every sheet under its name, as a table, formulas as saved values, charts noted', () => {
  const { body, notes } = at.xlsxText(xlsx());
  assert.match(body, /## Sheet: Sales & Costs\n\n\| Region \| Revenue \|\n\| --- \| --- \|\n\| North \| 10 \|/);
  assert.ok(body.includes('| South \\| West | 20 |'), 'a pipe in a value is escaped so the table stays a table: ' + body);
  assert.ok(body.includes('| Total | 30 |'), 'the formula shows its saved value');
  assert.ok(body.indexOf('## Sheet: Notes') > body.indexOf('## Sheet: Sales'), 'sheets in workbook order');
  assert.ok(body.includes('| Check the West figure |'), 'a sheet whose first cell is in column C still reads');
  assert.ok(notes.some((n) => /Formulas/.test(n)), 'says formulas are values');
  assert.ok(notes.some((n) => /Charts/.test(n)), 'says charts are not converted');
});

test('#6098 docx: headings, tabs, list items and tables in body order; deleted text left out; pictures noted', () => {
  const { body, notes } = at.docxText(docx());
  const lines = body.split('\n');
  assert.equal(lines[0], '# Launch plan');
  assert.equal(lines[1], 'Owner:\tDana');
  assert.equal(lines[2], '- Ship the beta & gather feedback');
  assert.equal(lines[3], '| Week | Goal |');
  assert.equal(lines[5], '| 1 | Invite 20 testers |');
  assert.equal(lines[6], 'Last paragraph.');
  assert.ok(!body.includes('removed words'), 'tracked-deleted text is not part of the document');
  assert.ok(notes.some((n) => /Pictures/.test(n)));
});

test('#6098 pdf: a simple PDF reads page by page, escapes and TJ spacing handled', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'simple.pdf');
  fs.writeFileSync(f, simplePdf());
  const { body } = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(body, '--- Page 1 ---\nQuarterly report\nRevenue (net) grew.\n\n--- Page 2 ---\nPage two');
  assert.equal(kitCalls, 0, 'readable text needs no PDFKit');
});

test('#6098 pdf: a modern writer\'s shape (object stream, inherited fonts, two-byte ToUnicode) reads as text', async () => {
  const f = path.join(SANDBOX, 'modern.pdf');
  fs.writeFileSync(f, modernPdf());
  const { body } = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(body, '--- Page 1 ---\nHi\néê');
});

test('#6098 pdf: an encrypted PDF says so instead of returning garbage', async () => {
  const f = path.join(SANDBOX, 'locked.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>'], [3, '<< /Filter /Standard /V 2 >>']], '/Encrypt 3 0 R'));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(got.body, '');
  assert.ok(got.notes.some((n) => /encrypted/.test(n)));
});

test('#6098 pdf: no text at all (a scanned PDF) says so; unreadable text asks PDFKit', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'scan.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R >>']]));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.ok(got.notes.some((n) => /No text was found/.test(n)), JSON.stringify(got));
  assert.equal(kitCalls, 1, 'PDFKit is asked when the reader found nothing readable');
  assert.equal(at.readable(['\u0001\u0002\u0003\u0004\u0005xyz®¯°±²']), false, 'CONTROL: symbols are not text');
  assert.equal(at.readable(['Hello, world.']), true);
});

test('#6098 end to end: saved, rendered beside the file, and named in the line the agent receives', async () => {
  for (const [name, bytes, expect] of [
    ['sales.xlsx', xlsx(), '## Sheet: Sales & Costs'],
    ['plan.docx', docx(), '# Launch plan'],
    ['report.pdf', simplePdf(), 'Quarterly report'],
  ]) {
    const rec = attachments.save('project', 'p6098', { name, type: 'application/octet-stream', bytes });
    const out = await at.render(rec);
    assert.equal(out, path.join(rec.dir, 'text.txt'));
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.startsWith('Text rendering of ' + name + ', made by Kosmos'), text.slice(0, 80));
    assert.ok(text.includes(expect), name);
    const line = attachments.wireNote(attachments.read(rec.id));
    assert.ok(line.includes('; as text: ' + out + ']'), line);
  }
});

test('#6098 control: a text file gets no rendering and its line is unchanged', async () => {
  const rec = attachments.save('project', 'p6098', { name: 'notes.md', type: 'text/markdown', bytes: Buffer.from('# hi') });
  assert.equal(await at.render(rec), null);
  assert.ok(!attachments.wireNote(rec).includes('as text'));
  assert.ok(!fs.existsSync(path.join(rec.dir, 'text.txt')));
});

test('#6098: a damaged office file still gets a rendering that says it could not be read, never a failed upload', async () => {
  const rec = attachments.save('project', 'p6098', { name: 'broken.xlsx', type: 'application/octet-stream', bytes: Buffer.from('not a zip at all') });
  const out = await at.render(rec);
  assert.match(fs.readFileSync(out, 'utf8'), /could not read this file as xlsx/);
});

test('#6098: a person\'s own text.txt keeps its name (the rendering is only ever written beside an office file, in its own folder)', async () => {
  const rec = attachments.save('project', 'p6098', { name: 'text.txt', type: 'text/plain', bytes: Buffer.from('mine') });
  assert.equal(path.basename(rec.file), 'text.txt');
  assert.equal(await at.render(rec), null, 'a text file is never rendered, so nothing is written over it');
  assert.equal(fs.readFileSync(rec.file, 'utf8'), 'mine');
});

/* #4598's rule for a reader of a person's file: linear, so a crafted file cannot freeze the board's only thread. */
test('#6098 growth: a CMap with tens of thousands of unclosed sections reads in linear time', () => {
  const t = Date.now();
  at.parseCmap('beginbfchar <0001> <0041> '.repeat(40000));
  assert.ok(Date.now() - t < 2000, 'took ' + (Date.now() - t) + ' ms');
});

test('#6098 growth: many stream objects with no endstream read in linear time', () => {
  const buf = Buffer.from(Array.from({ length: 20000 }, (_, i) => (i + 1) + ' 0 obj\n<< /Filter /FlateDecode >>\nstream\nxx\nendobj\n').join(''), 'latin1');
  const t = Date.now();
  at.pdfTextJs(buf);
  assert.ok(Date.now() - t < 2000, 'took ' + (Date.now() - t) + ' ms');
});

/* ── review 1 (each finding pinned; the growth arms use shapes measured slow before the fix) ── */
const timed = (fn) => { const t = Date.now(); fn(); return Date.now() - t; };
const docxOf = (body) => buildZip([entry('word/document.xml', XML + '<w:document xmlns:w="w"><w:body>' + body + '</w:body></w:document>')]);

test('#6098 review 1 (B1): a long manuscript and a crafted run of empty paragraphs read in linear time', () => {
  const long = Array.from({ length: 20000 }, (_, i) => '<w:p><w:r><w:t>Paragraph ' + i + ' of a long manuscript, with some ordinary words in it.</w:t></w:r></w:p>').join('');
  assert.ok(timed(() => at.docxText(docxOf(long))) < 3000, '20,000 paragraphs took 17.7 s before');
  assert.ok(timed(() => at.docxText(docxOf('<w:p/>'.repeat(200000)))) < 3000, '200,000 empty paragraphs took 121 s before');
  assert.ok(timed(() => at.docxText(docxOf('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'.repeat(20000)))) < 3000, 'tables with no paragraphs between');
});

test('#6098 review 1 (W4): a nested table, a text box and AlternateContent read right', () => {
  const nested = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc>'
    + '<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const box = '<w:p><w:r><w:t xml:space="preserve">Before box </w:t></w:r><w:r><mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>in box</w:t></w:r></w:p></w:txbxContent></mc:Choice>'
    + '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>in box</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t xml:space="preserve"> after box.</w:t></w:r></w:p>';
  const { body } = at.docxText(docxOf(nested + box));
  const lines = body.split('\n');
  assert.equal(lines[0], '| A1 inner | B1 |', body);
  assert.equal(lines[2], '| A2 | B2 |', body);
  assert.equal(lines[3], 'Before box in box after box.', 'the text box stays in its paragraph, once, and the rest of the paragraph is kept');
});

test('#6098 review 1 (B2): one huge shared string repeated in every cell is capped as it is built, quickly', () => {
  const big = 'x'.repeat(1024 * 1024);
  const row = (r) => '<row r="' + r + '">' + Array.from({ length: 256 }, (_, c) => '<c t="s"><v>0</v></c>').join('') + '</row>';
  const book = buildZip([
    entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    entry('xl/sharedStrings.xml', XML + '<sst><si><t>' + big + '</t></si></sst>'),
    entry('xl/worksheets/sheet1.xml', XML + '<worksheet><sheetData>' + Array.from({ length: 40 }, (_, r) => row(r + 1)).join('') + '</sheetData></worksheet>'),
  ]);
  let got;
  assert.ok(timed(() => { got = at.xlsxText(book); }) < 5000);
  assert.ok(got.body.length <= at.MAX_OUT, 'never more than the cap');
  assert.equal(got.full, true, 'and it says it stopped');
});

test('#6098 review 1 (B3, B4, B5): crafted PDF number runs, CMap brackets and huge ranges are linear and bounded', () => {
  assert.ok(timed(() => at.pdfTextJs(Buffer.from('%PDF-1.4\n' + '1'.repeat(80000) + ' 0 obj\n<<>>\nendobj\n', 'latin1'))) < 2000, '80k digits took 2.4 s before');
  assert.ok(timed(() => at.parseCmap('beginbfrange\n' + '<00><01>['.repeat(80000) + '\nendbfrange')) < 2000, 'took 37 s before');
  let m;
  assert.ok(timed(() => { m = at.parseCmap('beginbfrange\n' + '<0000><FFFF><0041>\n'.repeat(2000) + 'endbfrange'); }) < 3000);
  assert.ok(m.map.size <= 200000, 'the entries are capped');
  assert.equal(at.parseCmap('beginbfchar <0102030405060708> <0041> endbfchar').codeLen, 4, 'a code is at most 4 bytes');
});

test('#6098 review 1 (B6): a content stream shared by many pages is charged each time, and the output is capped', () => {
  const content = 'BT /F1 12 Tf ' + '(' + 'word '.repeat(50) + ') Tj T* '.repeat(1) + ET_REPEAT() + ' ET';
  function ET_REPEAT() { return Array.from({ length: 4000 }, () => '(' + 'word '.repeat(50) + ') Tj T*').join(' '); }
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [' + Array.from({ length: 300 }, (_, i) => (10 + i) + ' 0 R').join(' ') + '] /Count 300 >>'], [3, streamObj('', content)]];
  for (let i = 0; i < 300; i += 1) objs.push([10 + i, '<< /Type /Page /Parent 2 0 R /Contents [3 0 R 3 0 R] >>']);
  const buf = pdf(objs);
  let got;
  assert.ok(timed(() => { got = at.pdfTextJs(buf); }) < 8000);
  assert.ok(got.pages.join('').length <= at.MAX_OUT, 'the text never passes the cap, across all pages');
  assert.ok(got.cut, 'and says it stopped');
});

test('#6098 review 1 (W1): a stream whose /Length is an indirect object numbered 10 or more still reads', async () => {
  const z = zlib.deflateSync(Buffer.from('BT /F1 12 Tf (Hello world) Tj ET', 'latin1'));
  const s = Buffer.concat([Buffer.from('<< /Filter /FlateDecode /Length 12 0 R >>\nstream\n', 'latin1'), z, Buffer.from('\nendstream', 'latin1')]);
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'], [4, s], [12, String(z.length)]]);
  assert.deepEqual(at.pdfTextJs(buf).pages, ['Hello world']);
});

test('#6098 review 1 (W2, N4): a TJ array of more than 64 items keeps its text; runs on one line placed by Tm keep a space', () => {
  const items = Array.from({ length: 80 }, (_, i) => '(' + String.fromCharCode(97 + (i % 26)) + ') -10').join(' ');
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'],
    [4, streamObj('', 'BT 1 0 0 1 72 700 Tm /F1 12 Tf [' + items + '] TJ ET BT 1 0 0 1 72 600 Tm (Hello) Tj 1 0 0 1 120 600 Tm (world) Tj ET')]]);   // real text is always placed
  const [page] = at.pdfTextJs(buf).pages;
  assert.equal(page.split('\n')[0].replace(/\s/g, '').length, 80, 'all 80 items: ' + page);
  assert.ok(/Hello world/.test(page), 'two runs on one line: ' + page);
});

test('#6098 review 1 (W3): a large Flate image before the text does not use up the budget', () => {
  const img = zlib.deflateSync(Buffer.alloc(70 * 1024 * 1024));   // 70 MB of pixels, over the 64 MB budget
  const imgObj = Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Filter /FlateDecode /Length ' + img.length + ' >>\nstream\n', 'latin1'), img, Buffer.from('\nendstream', 'latin1')]);
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [5, imgObj], [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 12 Tf (After the picture) Tj ET')]]);
  assert.deepEqual(at.pdfTextJs(buf).pages, ['After the picture']);
});

test('#6098 review 1 (N3): a damaged document is described in its own words, not a spreadsheet\'s', () => {
  assert.throws(() => at.docxText(Buffer.from('not a zip')), (e) => /document/.test(e.message) && !/spreadsheet|people/.test(e.message));
});

/* ── review 2 ── */
test('#6098 review 2: a long run of spaces in a PDF string is linear', () => {
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'],
    [4, streamObj('', 'BT (' + ' '.repeat(100000) + 'x) Tj ET')]]);   // under the per-line cap, and about 4 s with the old pattern
  let got;
  assert.ok(timed(() => { got = at.pdfTextJs(buf); }) < 2000);
  assert.ok(got.pages[0].endsWith('x'));
});

test('#6098 review 2: packed objects each end where the next begins, and falling offsets stop the expansion', () => {
  // The page lives in the object stream, and the next packed object carries a font resource that would remap 'P' if it
  // leaked into the page's dictionary: so an object that spans past its end changes the text (review 3: the first
  // version of this arm could not fail).
  const page = '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>';
  const leak = '<< /Resources << /Font << /F1 5 0 R >> >> >>';
  const head = '3 0 9 ' + page.length + ' 10 0 ';   // 9 starts after 3; 10 falls back to 0: refused
  const cmap = 'beginbfchar\n<50> <005A>\nendbfchar';
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [4, streamObj('', 'BT /F1 12 Tf (Packed page) Tj ET')], [5, '<< /Type /Font /ToUnicode 6 0 R >>'], [6, streamObj('', cmap)],
    [7, streamObj('/Type /ObjStm /N 3 /First ' + head.length, head + page + leak)]]);
  assert.deepEqual(at.pdfTextJs(buf).pages, ['Packed page'], 'object 3 ends where 9 begins, so the font in 9 is not the page\'s');
});

test('#6098 review 2: one sheet part listed many times is read once; more than 256 columns says so', () => {
  const wide = '<row r="1">' + Array.from({ length: 300 }, (_, c) => '<c t="inlineStr"><is><t>v' + c + '</t></is></c>').join('') + '</row>';
  const book = buildZip([
    entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets>' + Array.from({ length: 300 }, (_, i) => '<sheet name="S' + i + '" r:id="rId1"/>').join('') + '</sheets></workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    entry('xl/worksheets/sheet1.xml', XML + '<worksheet><sheetData>' + wide + '</sheetData></worksheet>'),
  ]);
  const got = at.xlsxText(book);
  assert.equal((got.body.match(/\| v0 \|/g) || []).length, 1, 'the part is converted once');
  assert.ok(got.body.includes('(the same sheet as one above)'));
  assert.ok(got.notes.some((n) => /256 columns/.test(n)), JSON.stringify(got.notes));
  assert.ok(got.notes.some((n) => /256 sheets/.test(n)), 'the sheet cap says so');
});

test('#6098 review 2: a conversion that runs past the time limit ends the worker and says so', async () => {
  at.setWorkerLimits({ timeoutMs: 1 });
  try {
    const rec = attachments.save('project', 'p6098', { name: 'slow.docx', type: 'application/octet-stream', bytes: docxOf('<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(50000)) });
    const out = await at.render(rec);
    assert.match(fs.readFileSync(out, 'utf8'), /stopped converting this file after/);
  } finally { at.setWorkerLimits({ timeoutMs: 30000 }); }
});

test('#6098 review 2: numId 0 is not a list; text-box paragraphs keep a space; a damaged body says so', () => {
  const { body } = at.docxText(docxOf('<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>Not a list item</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Outer</w:t><w:txbxContent><w:p><w:r><w:t>Box one</w:t></w:r></w:p><w:p><w:r><w:t>Box two</w:t></w:r></w:p></w:txbxContent></w:r></w:p>'));
  assert.equal(body.split('\n')[0], 'Not a list item');
  assert.ok(/Box one Box two/.test(body), body);
  const broken = at.docxText(docxOf('<w:p><w:r><w:t>Kept</w:t></w:r></w:p><w:p><w:r><w:t>never closes'));
  assert.ok(broken.notes.some((n) => /damaged/.test(n)));
});

/* ── review 3 ── */
test('#6098 review 3: the text cap is said when it is reached, and later pages are not called scanned', async () => {
  const line = '(' + 'word '.repeat(200) + ') Tj T*';
  const pageStream = streamObj('', 'BT /F1 9 Tf ' + Array.from({ length: 300 }, () => line).join(' ') + ' ET');   // ~300 KB of text per page
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [' + Array.from({ length: 12 }, (_, i) => (10 + i) + ' 0 R').join(' ') + '] /Count 12 >>'], [3, pageStream]];
  for (let i = 0; i < 12; i += 1) objs.push([10 + i, '<< /Type /Page /Parent 2 0 R /Contents 3 0 R >>']);
  const f = path.join(SANDBOX, 'long.pdf');
  fs.writeFileSync(f, pdf(objs));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.ok(got.notes.some((n) => /stops at/.test(n)), JSON.stringify(got.notes));
  assert.ok(!got.notes.some((n) => /had no text|scanned/.test(n)), 'later pages are not called scanned: ' + JSON.stringify(got.notes));
});

test('#6098 review 3: an ASCII85 then Flate stream (reportlab\'s default) reads; WinAnsi punctuation reads as punctuation', () => {
  const a85 = (b) => { let o = ''; for (let i = 0; i < b.length; i += 4) { const c = Buffer.alloc(4); b.copy(c, 0, i, Math.min(i + 4, b.length)); let n = c.readUInt32BE(0); const g = []; for (let k = 0; k < 5; k += 1) { g.unshift(String.fromCharCode(33 + (n % 85))); n = Math.floor(n / 85); } o += g.slice(0, Math.min(5, b.length - i + 1)).join(''); } return o + '~>'; };
  const z = zlib.deflateSync(Buffer.from('BT /F1 12 Tf (don\\222t \\223quote\\224 \\226 dash \\225 bullet \\200) Tj ET', 'latin1'));
  const enc = a85(z);
  const s = '<< /Filter [/ASCII85Decode /FlateDecode] /Length ' + enc.length + ' >>\nstream\n' + enc + '\nendstream';
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'], [4, s]]);
  assert.deepEqual(at.pdfTextJs(buf).pages, ['don\u2019t \u201cquote\u201d \u2013 dash \u2022 bullet \u20ac']);
});

test('#6098 review 3: the Excel date-format check is linear on a long unclosed format', () => {
  const book = buildZip([
    entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    entry('xl/worksheets/sheet1.xml', XML + '<worksheet><sheetData/></worksheet>'),
    entry('xl/styles.xml', XML + '<styleSheet><numFmts><numFmt formatCode="' + 'd'.repeat(200000) + '</numFmts></styleSheet>'),
  ]);
  assert.ok(timed(() => at.xlsxText(book)) < 2000, '100K took 4.8 s before');
});

/* ── review 4 ── */
test('#6098 review 4: a font with its own encoding and no ToUnicode marks the text as not to be trusted (PDFKit is asked)', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'macroman.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 12 Tf (ENERGY STAR\\250 is fine) Tj ET')],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /MacRomanEncoding >>']]));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(kitCalls, 1, 'PDFKit is asked for a MacRoman font');
  assert.ok(got.notes.some((n) => /symbols and punctuation/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 4: the date note ignores [Red] colour codes; a real date format still gets it', () => {
  const book = (fmt) => buildZip([
    entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    entry('xl/worksheets/sheet1.xml', XML + '<worksheet><sheetData/></worksheet>'),
    entry('xl/styles.xml', XML + '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="' + fmt + '"/></numFmts></styleSheet>'),
  ]);
  assert.ok(!at.xlsxText(book('#,##0;[Red]-#,##0')).notes.some((n) => /Dates/.test(n)));
  assert.ok(at.xlsxText(book('dd/mm/yyyy')).notes.some((n) => /Dates/.test(n)));
});

/* ── review 5 ── */
test('#6098 review 5: a two-byte font with no character map is not passed off as text', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'cjk.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 12 Tf <00340058004400550057> Tj ET')],
    [5, '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic /Encoding /Identity-H >>']]));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(kitCalls, 1, 'PDFKit is asked');
  assert.equal(got.body.replace(/--- Page \d+ ---/g, '').trim(), '', 'no garbage kept: ' + got.body);
  assert.ok(got.notes.some((n) => /no character map/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 5: an encrypted PDF that PDFKit can open is read through it', async () => {
  const f = path.join(SANDBOX, 'owner-only.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>'], [3, '<< /Filter /Standard /V 2 >>']], '/Encrypt 3 0 R'));
  at.setPdfkit(async () => 'Opened by PDFKit');
  try {
    const got = await at.pdfText(f, fs.readFileSync(f));
    assert.ok(got.body.includes('Opened by PDFKit'), JSON.stringify(got));
  } finally { at.setPdfkit(async () => { kitCalls += 1; return null; }); }
});

/* ── review 6 ── */
const mixedPdf = (content) => pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F2 5 0 R /F3 6 0 R >> >> >>'],
  [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'], [4, streamObj('', content)],
  [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  [6, '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic /Encoding /Identity-H >>']]);

test('#6098 review 6: a mapless font listed in shared resources but never drawn with changes nothing', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'unused-cjk.pdf');
  fs.writeFileSync(f, mixedPdf('BT /F2 12 Tf (Hello plain latin text) Tj ET'));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(got.body, '--- Page 1 ---\nHello plain latin text');
  assert.equal(kitCalls, 0, 'an unused font does not send the file to PDFKit');
  assert.ok(!got.notes.some((n) => /character map/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 6: text in a mapless font is left out, and only that text', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'mixed-cjk.pdf');
  fs.writeFileSync(f, mixedPdf('BT /F2 12 Tf (Latin kept) Tj 0 -20 Td /F3 12 Tf <00340058004400550057> Tj ET'));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(kitCalls, 1, 'PDFKit is asked');
  assert.equal(got.body, '--- Page 1 ---\nLatin kept');
  assert.ok(got.notes.some((n) => /no character map/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 6: an encrypted PDF that PDFKit reports locked says it needs a password', async () => {
  const f = path.join(SANDBOX, 'user-password.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>'], [3, '<< /Filter /Standard /V 2 >>']], '/Encrypt 3 0 R'));
  at.setPdfkit(async () => '\u0000locked');
  try {
    const got = await at.pdfText(f, fs.readFileSync(f));
    assert.equal(got.body, '');
    assert.ok(got.notes.some((n) => /protected with a password/.test(n)), JSON.stringify(got.notes));
  } finally { at.setPdfkit(async () => { kitCalls += 1; return null; }); }
});

/* ── review 7 ── */
const onePage = (content, fonts) => pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << ' + fonts.map((f, i) => '/F' + (i + 1) + ' ' + (5 + i) + ' 0 R').join(' ') + ' >> >> /Contents 4 0 R >>'],
  [4, streamObj('', content)], ...fonts.map((f, i) => [5 + i, f])]);
/* Widths for 32..121: space 278, then a flat 500 for every letter, so a glyph's advance at size 10 is 5. */
const FLAT = '<< /Type /Font /Subtype /TrueType /BaseFont /Flat /FirstChar 32 /Widths [278 ' + Array(89).fill(500).join(' ') + '] >>';
const glyphs = (word, x0, step) => word.split('').map((ch, i) => (i ? step + ' 0 Td ' : '') + '(' + ch + ') Tj').join(' ');

test('#6098 review 7: text placed a glyph at a time (Chrome, Ghostscript) reads as words; a real gap is a space', () => {
  const content = 'BT /F1 10 Tf 72 700 Td ' + glyphs('Hello', 72, 5) + ' 8 0 Td ' + glyphs('world', 0, 5) + ' ET';
  assert.equal(at.pdfTextJs(onePage(content, [FLAT])).pages[0], 'Hello world');
});

test('#6098 review 7: a kerned chunk (a move a little short of the drawn width) is not a space', () => {
  const content = 'BT /F1 10 Tf 72 700 Td (Cop) Tj 14.8 0 Td (yright) Tj 33 0 Td (holder) Tj ET';
  assert.equal(at.pdfTextJs(onePage(content, [FLAT])).pages[0], 'Copyright holder');
});

test('#6098 review 7: a Type3 font\'s widths are scaled by its FontMatrix; placement by Tm reads as words', () => {
  const t3 = '<< /Type /Font /Subtype /Type3 /FontMatrix [0.00048828125 0 0 0.00048828125 0 0] /FirstChar 32 /Widths [570 ' + Array(89).fill(1024).join(' ') + '] >>';
  // size 1, the matrix scales by 20: a letter advances 1024/2048*20 = 10 in user space
  const at20 = (x, ch) => '20 0 0 20 ' + x + ' 700 Tm (' + ch + ') Tj';
  const content = 'BT /F1 1 Tf ' + [at20(100, 'A'), at20(110, 'b'), at20(120, 'c'), at20(150, 'd')].join(' ') + ' ET';
  assert.equal(at.pdfTextJs(onePage(content, [t3])).pages[0], 'Abc d');
});

test('#6098 review 7: a Type0 font\'s /W widths are read (Tm placement, two-byte codes)', () => {
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 3 beginbfchar <0041> <0041> <0042> <0042> <0043> <0043> endbfchar endcmap end end';
  const content = 'BT /F1 10 Tf 1 0 0 1 50 700 Tm <0041> Tj 1 0 0 1 56 700 Tm <0042> Tj 1 0 0 1 70 700 Tm <0043> Tj ET';
  const doc = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', content)],
    [5, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'],
    [6, '<< /Type /Font /Subtype /CIDFontType2 /DW 1000 /W [65 [600] 66 67 600] >>'], [7, streamObj('', cmap)]]);
  assert.equal(at.pdfTextJs(doc).pages[0], 'AB C');
});

test('#6098 review 7: a symbolic font with no /Encoding is not trusted as WinAnsi (PDFKit is asked)', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'symbolic.pdf');
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 12 Tf (\\214le) Tj ET')],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /XYZ+Times /FontDescriptor 6 0 R >>'], [6, '<< /Type /FontDescriptor /Flags 131076 >>']]));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(kitCalls, 1, 'PDFKit is asked');
  assert.ok(got.notes.some((n) => /symbols and punctuation/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 7: a page emptied by a mapless font is not called scanned, a really empty page still is, and both font notes show', async () => {
  const f = path.join(SANDBOX, 'mixed-notes.pdf');
  const mac = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /MacRomanEncoding >>';
  const cjk = '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic /Encoding /Identity-H >>';
  fs.writeFileSync(f, pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /Resources << /Font << /F1 8 0 R /F2 9 0 R >> >> >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>'], [4, '<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>'], [5, '<< /Type /Page /Parent 2 0 R >>'],
    [6, streamObj('', 'BT /F1 12 Tf (Plain words here) Tj ET')], [7, streamObj('', 'BT /F2 12 Tf <00340058> Tj ET')], [8, mac], [9, cjk]]));
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.ok(got.notes.some((n) => /no character map/.test(n)), JSON.stringify(got.notes));
  assert.ok(got.notes.some((n) => /symbols and punctuation/.test(n)), JSON.stringify(got.notes));
  assert.ok(got.notes.some((n) => /^1 of its 3 pages had no text/.test(n)), JSON.stringify(got.notes));
});

/* ── review 8 ── */
test('#6098 review 8: a standard font with no /Widths keeps a space at every sideways move (its gaps cannot be measured)', () => {
  const helv = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  assert.equal(at.pdfTextJs(onePage('BT /F1 10 Tf 72 700 Td (Hello) Tj 25.56 0 Td (World) Tj ET', [helv])).pages[0], 'Hello World');
});

test('#6098 review 8: Type0 widths share one budget across the document (300 fonts of [0 65535 500] stay small)', () => {
  const n = 300;
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << ' + Array.from({ length: n }, (_, i) => '/F' + i + ' ' + (10 + 2 * i) + ' 0 R').join(' ') + ' >> >> /Contents 4 0 R >>'],
    [4, streamObj('', 'BT /F0 10 Tf (x) Tj ET')]];
  for (let i = 0; i < n; i += 1) {
    objs.push([10 + 2 * i, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [' + (11 + 2 * i) + ' 0 R] >>']);
    objs.push([11 + 2 * i, '<< /Type /Font /Subtype /CIDFontType2 /W [0 65535 500] >>']);
  }
  const doc = pdf(objs);
  const before = process.memoryUsage().heapUsed;
  const ms = timed(() => at.pdfTextJs(doc));
  assert.ok(ms < 3000, 'took ' + ms + ' ms');
  assert.ok(process.memoryUsage().heapUsed - before < 200 * 1024 * 1024, 'heap grew too much');
});

/* ── review 9 ── */
test('#6098 review 9: a new text block on the same line (a style change) adds no space where there is no gap', () => {
  // size 1 under a scale of 10: a letter of the flat font advances 5 in user space, so "ab" ends at 50
  const content = 'BT 10 0 0 10 40 745 Tm /F1 1 Tf (ab) Tj ET BT 10 0 0 10 50 745 Tm /F1 1 Tf (cd) Tj ET BT 10 0 0 10 66 745 Tm /F1 1 Tf (ef) Tj ET';
  assert.equal(at.pdfTextJs(onePage(content, [FLAT])).pages[0], 'abcd ef');
});

test('#6098 review 9: table cells placed by BT x y Td stay on one line (FPDF, TCPDF)', () => {
  const content = 'BT /F1 10 Tf 40 745 Td (ab) Tj ET BT /F1 10 Tf 80 745 Td (cd) Tj ET BT /F1 10 Tf 40 730 Td (ef) Tj ET';
  assert.equal(at.pdfTextJs(onePage(content, [FLAT])).pages[0], 'ab cd\nef');
});

test('#6098 review 9: an inline image\'s bytes do not swallow the text after it', () => {
  for (const bytes of ['a(bc', 'ab%c', 'xEIy']) {
    const content = 'q BI /W 4 /H 1 /BPC 8 /CS /G ID ' + bytes + ' EI Q BT /F1 10 Tf 72 700 Td (Hello) Tj ET';
    assert.equal(at.pdfTextJs(onePage(content, [FLAT])).pages[0], 'Hello', bytes);
  }
});

test('#6098 review 9: Kangxi radicals from a ToUnicode map read as the characters they stand for', () => {
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <4F7F> <0002> <2F64> endbfchar endcmap end end';
  const doc = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 10 Tf 72 700 Td <00010002> Tj ET')],
    [5, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'],
    [6, '<< /Type /Font /Subtype /CIDFontType2 /DW 1000 >>'], [7, streamObj('', cmap)]]);
  assert.equal(at.pdfTextJs(doc).pages[0], '使用');
});

/* ── review 10 ── */
const hebrewPdf = () => {
  const word = 'שלום עולם טוב מאוד ';
  const pairs = Array.from(word).map((ch, i) => '<' + (i + 1).toString(16).padStart(4, '0') + '> <' + ch.codePointAt(0).toString(16).padStart(4, '0') + '>');
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange ' + pairs.length + ' beginbfchar ' + pairs.join(' ') + ' endbfchar endcmap end end';
  const codes = Array.from(word).map((_, i) => (i + 1).toString(16).padStart(4, '0')).join('');
  return pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 10 Tf 72 700 Td <' + codes + codes + '> Tj ET')],
    [5, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'],
    [6, '<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>'], [7, streamObj('', cmap)]]);
};

test('#6098 review 10: right-to-left text is not trusted in drawn order (PDFKit is asked; off a Mac a note says so)', async () => {
  kitCalls = 0;
  const f = path.join(SANDBOX, 'hebrew.pdf');
  fs.writeFileSync(f, hebrewPdf());
  const got = await at.pdfText(f, fs.readFileSync(f));
  assert.equal(kitCalls, 1, 'PDFKit is asked');
  assert.ok(got.notes.some((n) => /Right-to-left/.test(n)), JSON.stringify(got.notes));
  assert.ok(!got.notes.some((n) => /converted cleanly/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 10: Arabic presentation forms read as the ordinary letters', () => {
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0001> <FE8D> endbfchar endcmap end end';
  const doc = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 10 Tf 72 700 Td <0001> Tj ET')],
    [5, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'],
    [6, '<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>'], [7, streamObj('', cmap)]]);
  assert.equal(at.pdfTextJs(doc).pages[0], 'ا');
});

/* ── review 11 ── */
const book1 = (sheetXml, styles) => buildZip([
  entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>'),
  entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  entry('xl/worksheets/sheet1.xml', sheetXml),
  ...(styles ? [entry('xl/styles.xml', XML + '<styleSheet>' + styles + '</styleSheet>')] : []),
]);

test('#6098 review 11: a sheet larger than the part limit shows its first rows and says so, not "could not be read"', () => {
  const row = (i) => '<row r="' + i + '">' + Array.from({ length: 10 }, (_, c) => '<c r="' + String.fromCharCode(65 + c) + i + '"><v>' + (i * 10 + c) + '</v></c>').join('') + '</row>';
  const rows = [];
  for (let i = 1; i <= 90000; i += 1) rows.push(row(i));
  const xml = XML + '<worksheet><sheetData>' + rows.join('') + '</sheetData></worksheet>';
  assert.ok(xml.length > 21 * 1024 * 1024, 'the sheet must exceed the 20 MB part limit: ' + xml.length);
  const got = at.xlsxText(book1(xml));
  assert.ok(!got.body.includes('could not be read'), got.body.slice(0, 200));
  assert.ok(got.body.includes('| 10 | 11 | 12 |'), got.body.slice(0, 200));
  assert.ok(got.notes.some((n) => /larger than Kosmos reads/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 11: percentages and currency say they are shown without their formats; a plain number format does not', () => {
  const sheet = XML + '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>1</v></c></row></sheetData></worksheet>';
  const withFmt = (code) => at.xlsxText(book1(sheet, '<numFmts><numFmt numFmtId="164" formatCode="' + code + '"/></numFmts>')).notes.some((n) => /without their formats/.test(n));
  assert.equal(withFmt('0.0%'), true);
  assert.equal(withFmt('&quot;$&quot;#,##0'), true);
  assert.equal(withFmt('#,##0.00'), false);
  assert.equal(at.xlsxText(book1(sheet, '<cellXfs><xf numFmtId="9"/></cellXfs>')).notes.some((n) => /without their formats/.test(n)), true, 'built-in 0%');
});

test('#6098 review 11: Latin ligatures read as their letters', () => {
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0050> <0002> <FB01> endbfchar endcmap end end';
  const doc = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'], [4, streamObj('', 'BT /F1 10 Tf 72 700 Td <00010002> Tj ET')],
    [5, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'],
    [6, '<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>'], [7, streamObj('', cmap)]]);
  assert.equal(at.pdfTextJs(doc).pages[0], 'Pfi');
});

test('#6098 review 11: a PDF that reaches the text cap says so once in the rendering', async () => {
  const line = '(' + 'word '.repeat(200) + ') Tj T*';
  const pageStream = streamObj('', 'BT /F1 9 Tf ' + Array.from({ length: 300 }, () => line).join(' ') + ' ET');
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [' + Array.from({ length: 12 }, (_, i) => (10 + i) + ' 0 R').join(' ') + '] /Count 12 >>'], [3, pageStream]];
  for (let i = 0; i < 12; i += 1) objs.push([10 + i, '<< /Type /Page /Parent 2 0 R /Contents 3 0 R >>']);
  const rec = attachments.save('project', 'p6098', { name: 'long.pdf', type: 'application/pdf', bytes: pdf(objs) });
  const out = await at.render(rec);
  const head = fs.readFileSync(out, 'utf8').slice(0, 2000);
  assert.equal((head.match(/stops at/g) || []).length, 1, head.slice(0, 600));
});

/* ── review 12 ── */
test('#6098 review 12: a document cut at the part limit inside a table keeps the rows before the cut', () => {
  const row = (i) => '<w:tr><w:tc><w:p><w:r><w:t>row ' + i + '</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>' + 'x'.repeat(600) + '</w:t></w:r></w:p></w:tc></w:tr>';
  const rows = [];
  for (let i = 0; i < 40000; i += 1) rows.push(row(i));
  const body = '<w:p><w:r><w:t>intro</w:t></w:r></w:p><w:tbl>' + rows.join('') + '</w:tbl>';
  assert.ok(body.length > 21 * 1024 * 1024, 'over the part limit: ' + body.length);
  const got = at.docxText(docxOf(body));
  assert.ok(got.body.includes('| row 1 |'), got.body.slice(0, 200));
  assert.ok(got.notes.some((n) => /larger than Kosmos reads/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 12: a locale tag on a date format is not a currency; a currency in brackets still is', () => {
  const sheet = XML + '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';
  const noted = (code) => at.xlsxText(book1(sheet, '<numFmts><numFmt numFmtId="164" formatCode="' + code + '"/></numFmts>')).notes.some((n) => /without their formats/.test(n));
  assert.equal(noted('[$-409]mmm d, yyyy'), false);
  assert.equal(noted('[$-F800]dddd, mmmm dd, yyyy'), false);
  assert.equal(noted('[$-x-sysdate]dddd, mmmm dd, yyyy'), false);
  assert.equal(noted('[$-x-systime]h:mm:ss AM/PM'), false);
  assert.equal(noted('[$$-409]#,##0.00'), true);
  assert.equal(noted('[$€-407]#,##0.00'), true);
});

test('#6098 review 12: a stored (not deflated) sheet over the part limit, and shared text over it, are read in part with notes', () => {
  const rows = [];
  for (let i = 1; i <= 60000; i += 1) rows.push('<row r="' + i + '"><c r="A' + i + '" t="s"><v>' + (i % 3) + '</v></c><c r="B' + i + '"><v>' + '9'.repeat(300) + '</v></c></row>');
  const sheet = XML + '<worksheet><sheetData>' + rows.join('') + '</sheetData></worksheet>';
  const sst = XML + '<sst>' + ['<si><t>alpha</t></si>', '<si><t>beta</t></si>', '<si><t>gamma</t></si>'].join('') + '<si><t>' + 'z'.repeat(21 * 1024 * 1024) + '</t></si></sst>';
  const stored = (name, text) => ({ name, data: Buffer.from(text, 'utf8'), method: 0 });
  const book = buildZip([
    entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    stored('xl/worksheets/sheet1.xml', sheet), stored('xl/sharedStrings.xml', sst),
  ]);
  const got = at.xlsxText(book);
  assert.ok(got.body.includes('| beta |'), got.body.slice(0, 200));
  assert.ok(got.notes.some((n) => /A sheet is larger/.test(n)), JSON.stringify(got.notes));
  assert.ok(got.notes.some((n) => /text is larger than Kosmos reads/.test(n)), JSON.stringify(got.notes));
});

/* ── review 13 ── */
test('#6098 review 13: a cut that lands inside a text box\'s Fallback copy still keeps the table rows before it', () => {
  const box = '<w:r><mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>box</w:t></w:r></w:p></w:txbxContent></mc:Choice>'
    + '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>box</w:t></w:r></w:p>' + 'y'.repeat(22 * 1024 * 1024);   // the cut falls in here
  const rows = Array.from({ length: 200 }, (_, i) => '<w:tr><w:tc><w:p><w:r><w:t>row ' + i + '</w:t></w:r></w:p></w:tc></w:tr>').join('');
  const body = '<w:p><w:r><w:t>intro</w:t></w:r></w:p><w:tbl>' + rows + '<w:tr><w:tc><w:p>' + box;
  const got = at.docxText(docxOf(body));
  assert.ok(got.body.includes('| row 199 |'), got.body.slice(0, 200));
});

/* ── review 14 ── */
test('#6098 review 14: a self-closed Fallback (or a longer tag name) does not take the rest of the document', () => {
  const body = '<w:p><w:r><w:t>A</w:t></w:r></w:p><mc:AlternateContent><mc:Choice Requires="wps"><w:p><w:r><w:t>box</w:t></w:r></w:p></mc:Choice><mc:Fallback/></mc:AlternateContent>'
    + '<w:p><w:r><w:t>IMPORTANT TAIL</w:t></w:r></w:p><mc:FallbackX><w:p><w:r><w:t>kept too</w:t></w:r></w:p></mc:FallbackX>';
  const got = at.docxText(docxOf(body));
  assert.ok(got.body.includes('IMPORTANT TAIL'), got.body);
  assert.ok(got.body.includes('kept too'), got.body);
});

/* ── review 15 ── */
const calcBook = (cells, calcPr) => buildZip([
  entry('xl/workbook.xml', XML + '<workbook xmlns:r="r"><sheets><sheet name="S" r:id="rId1"/></sheets>' + (calcPr || '') + '</workbook>'),
  entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  entry('xl/worksheets/sheet1.xml', XML + '<worksheet><sheetData>' + cells + '</sheetData></worksheet>'),
]);

test('#6098 review 15: a formula never calculated (openpyxl) shows as the formula, its row is kept, and the note says so', () => {
  const got = at.xlsxText(calcBook('<row r="1"><c r="A1" t="inlineStr"><is><t>Apples</t></is></c><c r="B1"><v>3</v></c><c r="C1"><f>B1*2</f><v /></c></row>'
    + '<row r="2"><c r="C2"><f>SUM(C1:C1)</f><v></v></c></row>', '<calcPr fullCalcOnLoad="1"/>'));
  assert.ok(got.body.includes('| Apples | 3 | =B1*2 |'), got.body);
  assert.ok(got.body.includes('=SUM(C1:C1)'), 'a row of formulas only is kept: ' + got.body);
  assert.ok(got.notes.some((n) => /never calculated/.test(n)), JSON.stringify(got.notes));
  assert.ok(!got.notes.some((n) => /last saved/.test(n)), JSON.stringify(got.notes));
});

test('#6098 review 15: a workbook marked for calculation on open (xlsxwriter stores 0) does not claim its values were saved results', () => {
  const cells = '<row r="1"><c r="A1"><f>1+1</f><v>0</v></c></row>';
  assert.ok(at.xlsxText(calcBook(cells, '<calcPr calcId="124519" fullCalcOnLoad="1"/>')).notes.some((n) => /never calculated/.test(n)));
  assert.ok(at.xlsxText(calcBook(cells, '<calcPr calcId="191029"/>')).notes.some((n) => /last saved/.test(n)), 'a calculated workbook keeps the saved-values note');
});

test('#6098 review 15: a PDF the worker gave up on is still offered to PDFKit', async () => {
  at.setWorkerLimits({ timeoutMs: 1 });
  at.setPdfkit(async () => 'Read by PDFKit');
  try {
    const rec = attachments.save('project', 'p6098', { name: 'gaveup.pdf', type: 'application/pdf', bytes: simplePdf() });
    const text = fs.readFileSync(await at.render(rec), 'utf8');
    assert.ok(text.includes('Read by PDFKit'), text.slice(0, 400));
    assert.ok(/macOS’s own PDF reader/.test(text), text.slice(0, 400));
  } finally {
    at.setWorkerLimits({ timeoutMs: 30000 });
    at.setPdfkit(async () => { kitCalls += 1; return null; });
  }
});

test('#6098 review 15: a Fallback holding its own AlternateContent is removed whole (no text read twice)', () => {
  const inner = '<mc:AlternateContent><mc:Choice><w:p><w:r><w:t>innerChoice</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>innerFallback</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>';
  const body = '<w:p><w:r><w:t>before</w:t></w:r></w:p><mc:AlternateContent><mc:Choice><w:p><w:r><w:t>box</w:t></w:r></w:p></mc:Choice>'
    + '<mc:Fallback>' + inner + '<w:p><w:r><w:t>outerTail</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent><w:p><w:r><w:t>after</w:t></w:r></w:p>';
  const got = at.docxText(docxOf(body));
  assert.ok(!got.body.includes('outerTail') && !got.body.includes('innerFallback'), got.body);
  assert.ok(got.body.includes('after'), got.body);
});

/* ── review 16 ── */
test('#6098 review 16: a formula that returned an empty string (Excel, t="str") stays blank, beside an uncalculated one', () => {
  const excel = at.xlsxText(calcBook('<row r="1"><c r="A1" t="str"><f>IF(B1=1,"x","")</f><v></v></c><c r="B1"><v>2</v></c></row>', '<calcPr calcId="191029"/>'));
  assert.ok(!excel.body.includes('=IF'), excel.body);
  assert.ok(!excel.notes.some((n) => /never calculated/.test(n)), JSON.stringify(excel.notes));
  const openpyxl = at.xlsxText(calcBook('<row r="1"><c r="A1"><f>B1*2</f><v /></c><c r="B1"><v>2</v></c></row>'));
  assert.ok(openpyxl.body.includes('=B1*2'), openpyxl.body);
});

/* ── review 17 ── */
test('#6098 review 17: a redline says it has tracked changes, and a moved passage is read once', () => {
  const body = '<w:p><w:r><w:t>Kept </w:t></w:r><w:del><w:r><w:delText>gone </w:delText></w:r></w:del><w:ins><w:r><w:t>added</w:t></w:r></w:ins></w:p>'
    + '<w:moveFrom><w:p><w:r><w:t>Moved passage</w:t></w:r></w:p></w:moveFrom><w:p><w:r><w:t>Middle</w:t></w:r></w:p>'
    + '<w:moveTo><w:p><w:r><w:t>Moved passage</w:t></w:r></w:p></w:moveTo>';
  const got = at.docxText(docxOf(body));
  assert.ok(got.notes.some((n) => /tracked changes/.test(n)), JSON.stringify(got.notes));
  assert.equal((got.body.match(/Moved passage/g) || []).length, 1, got.body);
  assert.ok(got.body.startsWith('Kept added'), got.body);
  assert.ok(!at.docxText(docxOf('<w:p><w:r><w:t>plain</w:t></w:r></w:p>')).notes.some((n) => /tracked/.test(n)), 'a plain document says nothing');
});

test('#6098 review 17: a spreadsheet written with a namespace prefix (<x:row>) reads its cells', () => {
  const book = buildZip([
    entry('xl/workbook.xml', XML + '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Data" r:id="rId1"/></x:sheets></x:workbook>'),
    entry('xl/_rels/workbook.xml.rels', XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    entry('xl/worksheets/sheet1.xml', XML + '<x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1"><x:v>42</x:v></x:c></x:row></x:sheetData></x:worksheet>'),
    entry('xl/sharedStrings.xml', XML + '<x:sst xmlns:x="m"><x:si><x:t>Widgets</x:t></x:si></x:sst>'),
  ]);
  const got = at.xlsxText(book);
  assert.ok(got.body.includes('| Widgets | 42 |'), got.body);
});

test('#6098 review 17: a non-breaking hyphen and a positioned tab are kept', () => {
  const got = at.docxText(docxOf('<w:p><w:r><w:t>2026</w:t><w:noBreakHyphen/><w:t>10</w:t><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/><w:t>end</w:t></w:r></w:p>'));
  assert.equal(got.body, '2026-10\tend');
});
