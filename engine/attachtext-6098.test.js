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

test('#6098 review 2: packed objects with overlapping or falling offsets are refused, not spanned', () => {
  const body = 'x'.repeat(200000);
  const head = Array.from({ length: 200 }, (_, k) => (100 + k) + ' ' + (k % 2 ? 1000 : 0)).join(' ') + ' ';
  const buf = pdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>'], [7, streamObj('/Type /ObjStm /N 200 /First ' + head.length, head + body)]]);
  assert.ok(timed(() => at.pdfTextJs(buf)) < 2000);
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
