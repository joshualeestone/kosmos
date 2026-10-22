'use strict';
/* kosmos#6849: a handed-off file's fingerprint (engine/fileprint.js) is the same for the same source rendered twice. The
   fixtures in test-support/fileprint-6849/ are real renders of one markdown file, made twice on this Mac on 2026-10-21:
   chrome-a/-b by Chrome's print to PDF (they differ only in /CreationDate and /ModDate), cups-a/-b by macOS cupsfilter
   (their dates and their trailer /ID), and *-changed from the same file with one word changed (3rd to 4th). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fp = require('./fileprint');

const FIX = path.join(__dirname, '..', 'test-support', 'fileprint-6849');
const raw = (p) => 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const at = (name) => path.join(FIX, name);

for (const tool of ['chrome', 'cups']) {
  test(`#6849: two ${tool} renders of one file have one fingerprint (CONTROL: their plain sha256s differ)`, () => {
    assert.notEqual(raw(at(tool + '-a.pdf')), raw(at(tool + '-b.pdf')), 'the fixtures no longer drift, so this test proves nothing');
    assert.equal(fp.fingerprint(at(tool + '-a.pdf')), fp.fingerprint(at(tool + '-b.pdf')), 'the same source rendered twice gave two fingerprints');
    assert.ok(fp.isPrint(fp.fingerprint(at(tool + '-a.pdf'))));
  });
  test(`#6849: a ${tool} render with one word changed has another fingerprint`, () => {
    assert.notEqual(fp.fingerprint(at(tool + '-changed.pdf')), fp.fingerprint(at(tool + '-a.pdf')), 'a change to what the PDF shows was left out too');
  });
}

test('#6849: any file but a PDF is its plain sha256, even when its text looks like PDF metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-'));
  try {
    for (const [name, body] of [['a.txt', 'hello\n'], ['meta.txt', 'notes: /CreationDate (D:20261021) /ID [<00><11>]\n'], ['empty.bin', '']]) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, body);
      assert.equal(fp.fingerprint(p), raw(p), name);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* A small PDF in the shapes the real fixtures do not carry: hex-string dates, an /ID pair of literal strings, and XMP
   fields as elements and as attributes. `pad` puts the metadata past the first 1 MiB read. */
function synth({ when = 'D:20261021175907Z', id = 'aa', words = 'Hello', pad = 0, xmpHead = '<x:xmpmeta>', xmpTail = '</x:xmpmeta>' } = {}) {
  const hexWhen = Buffer.from(when).toString('hex');
  const xmp = xmpHead + '<rdf:Description xmp:CreateDate="' + when
    + '" xmpMM:DocumentID="uuid:' + id + '"><xmp:ModifyDate>' + when + '</xmp:ModifyDate><xmpMM:InstanceID>uuid:' + id
    + '</xmpMM:InstanceID></rdf:Description>' + xmpTail;
  return '%PDF-1.7\n' + '%' + 'x'.repeat(pad) + '\n'
    + '1 0 obj\n<< /Producer (Test) /CreationDate <' + hexWhen + '> /ModDate (' + when + ') >>\nendobj\n'
    + '2 0 obj\n<< /Type /Metadata /Subtype /XML /Length ' + xmp.length + ' >>\nstream\n' + xmp + '\nendstream\nendobj\n'
    + '3 0 obj\n<< /Length 5 >>\nstream\n' + words + '\nendstream\nendobj\n'
    + 'trailer\n<< /Root 2 0 R /Info 1 0 R /ID [ (' + id + 'x) (' + id + 'y) ] >>\n%%EOF\n';
}

test('#6849: hex-string dates, a literal-string /ID and XMP fields are left out too; what the PDF shows is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-'));
  const put = (name, s) => { const p = path.join(dir, name); fs.writeFileSync(p, s, 'latin1'); return p; };
  try {
    const a = put('a.pdf', synth());
    const b = put('b.pdf', synth({ when: 'D:20261022093001Z', id: 'bb' }));
    assert.notEqual(raw(a), raw(b), 'CONTROL: the two differ as bytes');
    assert.equal(fp.fingerprint(a), fp.fingerprint(b));
    const c = put('c.pdf', synth({ words: 'Hellp' }));
    assert.notEqual(fp.fingerprint(c), fp.fingerprint(a), 'a change to the page content was left out');
    // Past the first 1 MiB read: the whole PDF is read before the metadata is taken out.
    const big = 1.5 * 1024 * 1024;
    const d = put('d.pdf', synth({ pad: big }));
    const e = put('e.pdf', synth({ pad: big, when: 'D:20261023010101Z', id: 'cc' }));
    assert.equal(fp.fingerprint(d), fp.fingerprint(e), 'dates after the first read chunk still changed the fingerprint');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6849: run directly it prints the fingerprint (exit 0) or why it could not (exit 2)', () => {
  const mod = path.join(__dirname, 'fileprint.js');
  const out = execFileSync(process.execPath, [mod, at('cups-a.pdf')], { encoding: 'utf8' }).trim();
  assert.equal(out, fp.fingerprint(at('cups-b.pdf')));
  for (const [args, said] of [[[path.join(FIX, 'nope.pdf')], /missing \(no such file\)/], [[FIX], /is a directory, not a file/], [[], /Usage: kosmos fingerprint/]]) {
    let code = 0, err = '';
    try { execFileSync(process.execPath, [mod, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (x) { code = x.status; err = String(x.stderr); }
    assert.equal(code, 2, JSON.stringify(args));
    assert.match(err, said);
  }
});

test('#6849: only a file that starts with %PDF- is read as a PDF; text that mentions it near the top stays its plain sha256', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-'));
  try {
    const note = path.join(dir, 'note.md');
    fs.writeFileSync(note, 'How to read %PDF-1.7 files\n/ModDate (D:20261021) xmp:CreateDate="2026"\n');
    assert.equal(fp.isPdfHead(fs.readFileSync(note)), false);
    assert.equal(fp.fingerprint(note), raw(note), 'a note about PDFs was hashed as one');
    assert.equal(fp.isPdfHead(fs.readFileSync(at('chrome-a.pdf'))), true, 'CONTROL: a real PDF reads as one');
    assert.ok(fp.stablePdf(fs.readFileSync(at('cups-a.pdf'))).equals(fp.stablePdf(fs.readFileSync(at('cups-b.pdf')))), 'the two renders differ after their metadata is emptied');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6849: a long unclosed value neither overflows nor stalls (each value is bounded)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-'));
  try {
    const long = path.join(dir, 'long.pdf');
    fs.writeFileSync(long, '%PDF-1.7\n/ModDate (' + 'a'.repeat(20 * 1024 * 1024) + ')\n', 'latin1');
    const many = path.join(dir, 'many.pdf');
    fs.writeFileSync(many, '%PDF-1.7\n' + '/ModDate (aaaa'.repeat(150000), 'latin1');
    const t0 = Date.now();
    assert.ok(fp.isPrint(fp.fingerprint(long)), 'a 20 MB unclosed date was refused');
    assert.ok(fp.isPrint(fp.fingerprint(many)), 'many unclosed dates were refused');
    assert.ok(Date.now() - t0 < 10000, 'took ' + (Date.now() - t0) + ' ms');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* Review 4: page text shaped like a date was emptied too, so changing what a page said kept the fingerprint. */
test('#6849: page text shaped like a date or /ID inside a stream still changes the fingerprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-'));
  const page = (words) => '%PDF-1.7\n1 0 obj\n<< /Length ' + words.length + ' >>\nstream\n' + words + '\nendstream\nendobj\n'
    + '2 0 obj\n<< /Length 9 0 R >>\nstream\n' + words + '\nendstream\nendobj\ntrailer\n<< /ID [<aa><bb>] >>\n%%EOF\n';
  const put = (name, s) => { const p = path.join(dir, name); fs.writeFileSync(p, s, 'latin1'); return p; };
  try {
    const a = put('a.pdf', page('BT /ModDate (Pay Alice $100) Tj /ID [(x)(y)] Tj ET'));
    const b = put('b.pdf', page('BT /ModDate (Pay Mal $9999) Tj /ID [(x)(y)] Tj ET'));
    const c = put('c.pdf', page('BT /ModDate (Pay Alice $100) Tj /ID [(p)(q)] Tj ET'));
    assert.notEqual(fp.fingerprint(a), fp.fingerprint(b), 'changed page text kept the fingerprint');
    assert.notEqual(fp.fingerprint(a), fp.fingerprint(c), 'changed page text shaped like an /ID kept the fingerprint');
    // CONTROL: the same page with only its trailer /ID changed still matches.
    const d = put('d.pdf', page('BT /ModDate (Pay Alice $100) Tj /ID [(x)(y)] Tj ET').replace('<aa><bb>', '<cc><dd>'));
    assert.notEqual(raw(a), raw(d));
    assert.equal(fp.fingerprint(a), fp.fingerprint(d), 'the trailer /ID is no longer left out');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#6849: PDF whitespace is the PDF set: NUL separates, 0xA0 does not', () => {
  const s = (sep, when) => Buffer.from('%PDF-1.7\n<< /ModDate' + sep + '(' + when + ') >>\n', 'latin1');
  assert.ok(fp.stablePdf(s('\x00', 'D:1')).equals(fp.stablePdf(s('\x00', 'D:2'))), 'a NUL before the date stopped the match');
  assert.ok(!fp.stablePdf(s('\xa0', 'D:1')).equals(fp.stablePdf(s('\xa0', 'D:2'))), '0xA0 was read as PDF whitespace');
});

test('#6849: a PDF over 64 MB (64,000,000 bytes) is its plain sha256', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-'));
  try {
    const p = path.join(dir, 'big.pdf');
    fs.writeFileSync(p, '%PDF-1.7\n<< /ModDate (D:20261021) >>\n', 'latin1');
    fs.truncateSync(p, fp.PDF_MAX + 1);
    assert.equal(fp.fingerprint(p), raw(p));
    // CONTROL: the same file at the cap has its date left out, so it is not the plain sha256.
    fs.truncateSync(p, fp.PDF_MAX);
    assert.notEqual(fp.fingerprint(p), raw(p));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* Review 5: the metadata stream is found by its dictionary (/Type /Metadata) as well as by how its body starts. */
test('#6849: an XMP stream whose body does not start with xmpmeta is still found by its /Type /Metadata', () => {
  const a = Buffer.from(synth({ xmpHead: '<rdf:RDF>', xmpTail: '</rdf:RDF>' }), 'latin1');
  const b = Buffer.from(synth({ xmpHead: '<rdf:RDF>', xmpTail: '</rdf:RDF>', when: 'D:20261022093001Z', id: 'bb' }), 'latin1');
  assert.ok(!a.equals(b), 'CONTROL: the two differ as bytes');
  assert.ok(fp.stablePdf(a).equals(fp.stablePdf(b)), 'the XMP dates in a /Type /Metadata stream were kept');
});

/* The regex fix for an indirect /Length read as a shorter direct one (`/Length 1234 0 R` as 123) has no test here: a
   misread could only end a stream at the word endstream inside it, which the indirect fallback does anyway (the residual
   the header names). */
test('#6849: a direct /Length is used when the body holds the word endstream, and a stream after CR alone is a stream', () => {
  const direct = (when) => {
    const body = 'x'.repeat(5) + 'endstream /ModDate (' + when + ') ';
    return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream\nendobj\n', 'latin1');
  };
  assert.ok(!fp.stablePdf(direct('D:1')).equals(fp.stablePdf(direct('D:2'))), 'a direct /Length was not used');
  const cr = (words) => Buffer.from('%PDF-1.7\n1 0 obj\n<< /Length ' + words.length + ' >>\nstream\r' + words + '\rendstream\rendobj\r', 'latin1');
  assert.ok(!fp.stablePdf(cr('BT /ModDate (Pay A) Tj ET')).equals(fp.stablePdf(cr('BT /ModDate (Pay B) Tj ET'))), 'a stream after CR alone was read as objects');
});

test('#6849: the cap is the 64 MB the help and the instruction name', () => {
  assert.equal(fp.PDF_MAX, 64000000);
  const said = require('./defaults').block();
  assert.match(said, /a PDF over 64 MB is hashed as plain/);
});

/* Review 7: the bare Get-FileHash prints a table that cuts the hash short (builtsha-6330 review 7 fixed that once). */
test('#6849: the instruction gives the Windows command that prints the whole hash', () => {
  const said = require('./defaults').block();
  assert.match(said, /`\(Get-FileHash <file>\)\.Hash`/);
  assert.doesNotMatch(said, /`Get-FileHash <file>`/, 'the bare Get-FileHash prints a cut-off table');
});

/* Review 9: outside streams the date and /ID shapes were matched as text, so a form value, an annotation or a Title
   holding one was emptied and two documents differing only there matched. */
test('#6849: a string outside streams shaped like a date or /ID still changes the fingerprint; the real keys are still emptied', () => {
  const doc = (text, when, id) => Buffer.from('%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Annot /Subtype /Text /Contents (Approved: ' + text + ') /T (' + text + ') /V (' + text + ') >>\nendobj\n'
    + '2 0 obj\n<< /Title (xmp:CreateDate="' + text + '") /CreationDate (' + when + ') /ModDate <' + Buffer.from(when).toString('hex') + '> >>\nendobj\n'
    + 'trailer\n<< /Info 2 0 R /ID [ <' + id + '> <' + id + '> ] >>\n%%EOF\n', 'latin1');
  const p = (b) => fp.stablePdf(b).toString('latin1');
  for (const [x, y] of [['/ModDate(Pay Alice 100)', '/ModDate(Pay Mal 9999)'], ['/ID[(1)(2)]', '/ID[(9)(9)]'], ['Alice', 'Mallory']]) {
    assert.notEqual(p(doc(x, 'D:1', 'aa')), p(doc(y, 'D:1', 'aa')), 'two texts gave one fingerprint: ' + x + ' / ' + y);
  }
  // CONTROL: the same text with only the real date and /ID changed still matches.
  assert.equal(p(doc('/ModDate(Pay Alice 100)', 'D:1', 'aa')), p(doc('/ModDate(Pay Alice 100)', 'D:2', 'bb')), 'the real date or /ID was kept');
});

test('#6849: a date too long to be one is kept, so what it would swallow still counts', () => {
  // Closes only after 300 bytes and the Title: emptied whole, the Title would be taken out with it.
  const doc = (tail) => Buffer.from('%PDF-1.7\n1 0 obj\n<< /ModDate (D:1' + 'x'.repeat(300) + '\n' + tail + ' ) >>\nendobj\n', 'latin1');
  assert.ok(!fp.stablePdf(doc('/Title (A)')).equals(fp.stablePdf(doc('/Title (B)'))));
});
