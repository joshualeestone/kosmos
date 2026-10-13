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

test('#6098: an upload named text.txt cannot overwrite the rendering', () => {
  const rec = attachments.save('project', 'p6098', { name: 'text.txt', type: 'text/plain', bytes: Buffer.from('mine') });
  assert.notEqual(path.basename(rec.file), 'text.txt');
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
