'use strict';
/* kosmos#7213 (the 0.7.69 five-family report): `kosmos fingerprint` and `kosmos handoff` printed a PDF's normalized hash
   as "sha256:", the label an approval's plain sha256 carries, so for one unchanged file the two values differed and a
   reader concluded the file had changed. The kinds are now labelled (sha256: is always the plain sha256, a PDF whose
   dates or /ID were left out says pdf-normalized:), and `kosmos fingerprint <file> <expected>` compares like with like.
   Fixtures: test-support/fileprint-6849 (real Chrome and cupsfilter renders, see fileprint-6849.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fp = require('./fileprint');
const handoff = require('./handoff');

const FIX = path.join(__dirname, '..', 'test-support', 'fileprint-6849');
const hex = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const at = (name) => path.join(FIX, name);
const MOD = path.join(__dirname, 'fileprint.js');
const run = (...args) => spawnSync(process.execPath, [MOD, ...args], { encoding: 'utf8' });

test('#7213: a PDF with its dates left out says pdf-normalized:, never sha256:; plain() is what shasum prints', () => {
  for (const name of ['chrome-a.pdf', 'cups-a.pdf']) {
    const got = fp.fingerprint(at(name));
    assert.match(got, /^pdf-normalized:[0-9a-f]{64}$/, name + ': the normalized hash is labelled as a plain sha256 again');
    assert.notEqual(got.slice(got.indexOf(':') + 1), hex(at(name)), 'CONTROL: the fixture has nothing left out, so the label proves nothing');
    assert.equal(fp.plain(at(name)), 'sha256:' + hex(at(name)), name);
    assert.ok(fp.isPrint(got));
  }
});

test('#7213: sha256: still means the plain bytes: any other file, a PDF with nothing to leave out, a PDF over the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-7213-'));
  try {
    const txt = path.join(dir, 'a.txt');
    fs.writeFileSync(txt, 'hello\n');
    const bare = path.join(dir, 'bare.pdf');
    fs.writeFileSync(bare, '%PDF-1.7\n1 0 obj << /Title (x) >> endobj\n', 'latin1');
    for (const p of [txt, bare]) assert.equal(fp.fingerprint(p), 'sha256:' + hex(p), path.basename(p));
    // CONTROL: one date in the same PDF and it is normalized, so the bare one above was not labelled by accident.
    const dated = path.join(dir, 'dated.pdf');
    fs.writeFileSync(dated, '%PDF-1.7\n1 0 obj << /Title (x) /ModDate (D:20261026) >> endobj\n', 'latin1');
    assert.match(fp.fingerprint(dated), /^pdf-normalized:/);
    fs.truncateSync(dated, fp.PDF_MAX + 1);
    assert.equal(fp.fingerprint(dated), 'sha256:' + hex(dated), 'a PDF over the cap is its plain bytes and must say so');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7213: compare checks like with like: a plain sha256 (bare or labelled) against the plain bytes of an unchanged PDF', () => {
  const p = at('cups-a.pdf');
  for (const want of [hex(p), hex(p).toUpperCase(), 'sha256:' + hex(p), '  sha256:' + hex(p) + '\n']) {
    const c = fp.compare(p, want);
    assert.equal(c.ok, true);
    assert.equal(c.match, true, 'the report\'s case: an approval\'s plain sha256 of the unchanged file read as changed');
    assert.equal(c.kind, 'sha256');
    assert.match(c.words, /^matches the plain sha256/);
  }
  // The other kind, against a re-render: the plain bytes differ, the PDF fingerprint matches.
  const other = at('cups-b.pdf');
  assert.equal(fp.compare(other, hex(p)).match, false, 'CONTROL: a re-render is not the same bytes');
  assert.match(fp.compare(other, hex(p)).words, /^differs from the plain sha256 .*: this file gives sha256:/);
  const c = fp.compare(other, fp.fingerprint(p));
  assert.equal(c.match, true);
  assert.equal(c.kind, 'pdf-normalized');
  assert.match(c.words, /^matches the PDF fingerprint/);
  assert.equal(fp.compare(at('cups-changed.pdf'), fp.fingerprint(p)).match, false, 'CONTROL: a changed PDF still differs');
});

test('#7213: compare refuses what is not a hash, and a PDF fingerprint against a file that has none says why', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-7213-'));
  try {
    const txt = path.join(dir, 'a.txt');
    fs.writeFileSync(txt, 'hello\n');
    for (const bad of ['', 'md5:' + 'a'.repeat(32), 'sha256:' + 'a'.repeat(63), 'abc', null]) assert.equal(fp.compare(txt, bad).ok, false, String(bad));
    const c = fp.compare(txt, 'pdf-normalized:' + 'c'.repeat(64));
    assert.equal(c.ok, true);
    assert.equal(c.match, false, 'a pdf-normalized value matched a file that is not a normalized PDF');
    assert.match(c.words, /this file is not a PDF, so it has none: sha256:/);
    assert.equal(fp.compare(txt, 'pdf-normalized:' + hex(txt)).match, false, 'review 2: a text file matched a PDF fingerprint by hex');
    assert.equal(fp.compare(path.join(dir, 'nope'), hex(txt)).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7213: run directly with an expected value it says which kind it compared, exit 0 on a match and 1 when it differs', () => {
  const p = at('chrome-a.pdf');
  const same = run(p, hex(p));
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /matches the plain sha256/);
  const diff = run(at('chrome-b.pdf'), hex(p));
  assert.equal(diff.status, 1, diff.stderr);
  assert.match(diff.stdout, /differs from the plain sha256/);
  const bad = run(p, 'nothex');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a sha256 or a fingerprint/);
  // One argument keeps its one-line output, which `kosmos task built --file` reads.
  const one = run(p);
  assert.equal(one.status, 0);
  assert.equal(one.stdout, fp.fingerprint(p) + '\n');
  assert.equal(run(p, 'a', 'b').status, 2, 'three arguments were accepted');
});

test('#7213: the handoff line for a PDF gives both, each labelled; any other file keeps one plain value', () => {
  const p = at('cups-a.pdf');
  assert.equal(handoff.artifactPrint(p), fp.fingerprint(p) + ' (plain sha256:' + hex(p) + ')');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-7213-'));
  try {
    const txt = path.join(dir, 'a.txt');
    fs.writeFileSync(txt, 'hello\n');
    assert.equal(handoff.artifactPrint(txt), 'sha256:' + hex(txt));
    assert.equal(handoff.artifactPrint(path.join(dir, 'nope')), 'missing (no such file)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7213 review 1: a mark sent before this (a normalized PDF hash labelled sha256:) still matches its unchanged PDF, and says which', () => {
  const p = at('cups-a.pdf');
  const fpHex = fp.fingerprint(p).slice('pdf-normalized:'.length);
  const old = fp.compare(at('cups-b.pdf'), 'sha256:' + fpHex);
  assert.equal(old.match, true, 'an older mark of the same render read as a changed file');
  assert.equal(old.kind, 'pdf-normalized');
  assert.match(old.words, /^matches the PDF fingerprint, not the bytes: the bytes differ/, 'review 3: a fallback match must say the bytes differ');
  assert.equal(fp.compare(at('cups-changed.pdf'), 'sha256:' + fpHex).match, false, 'CONTROL: a changed PDF still differs from an older mark');
});

test('#7213 review 1: a PDF whose dates are already empty matches a PDF fingerprint with the same hex, whatever its label', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-7213-'));
  try {
    const dated = path.join(dir, 'dated.pdf');
    fs.writeFileSync(dated, '%PDF-1.7\n1 0 obj << /Title (x) /ModDate (D:20261026) >> endobj\n', 'latin1');
    const emptied = path.join(dir, 'emptied.pdf');
    fs.writeFileSync(emptied, fp.stablePdf(fs.readFileSync(dated)));
    const want = fp.fingerprint(dated);
    assert.match(want, /^pdf-normalized:/);
    assert.equal(fp.fingerprint(emptied), 'sha256:' + want.slice('pdf-normalized:'.length), 'CONTROL: the emptied copy is labelled by its plain bytes');
    const c = fp.compare(emptied, want);
    assert.equal(c.match, true, 'the same hex read as differs because the label differed');
    assert.match(c.words, /^matches: this PDF's own bytes are that value/, 'review 3: nothing was left out, so it is not called a PDF fingerprint match');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7213 review 2: a bare shasum value is checked byte for byte; only a sha256:-labelled one falls back to the PDF fingerprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-7213-'));
  try {
    const edited = path.join(dir, 'edited.pdf');
    fs.writeFileSync(edited, '%PDF-1.7\n1 0 obj << /Title (x) /ModDate (D:20991231) >> endobj\n', 'latin1');
    const orig = path.join(dir, 'orig.pdf');   // the approved file: the same PDF with its date already empty
    fs.writeFileSync(orig, fp.stablePdf(fs.readFileSync(edited)));
    assert.equal(fp.fingerprint(edited), 'pdf-normalized:' + hex(orig), 'CONTROL: the edit is only a date, so the PDF fingerprints agree');
    const bare = fp.compare(edited, hex(orig));
    assert.equal(bare.match, false, 'a shasum check passed for different bytes');
    assert.match(bare.words, /^differs from the plain sha256/);
    const labelled = fp.compare(edited, 'sha256:' + hex(orig));
    assert.equal(labelled.match, true, 'CONTROL: the labelled form is the older mark and still falls back');
    assert.match(labelled.words, /not the bytes: the bytes differ/, 'review 3: it was called a match without saying the bytes differ');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7213 review 2: a PDF fingerprint against a PDF over 64 MB or one with nothing to leave out gives the real reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fileprint-7213-'));
  try {
    const big = path.join(dir, 'big.pdf');
    fs.writeFileSync(big, '%PDF-1.7\n<< /ModDate (D:20261021) >>\n', 'latin1');
    fs.truncateSync(big, fp.PDF_MAX + 1);
    assert.match(fp.compare(big, 'pdf-normalized:' + 'c'.repeat(64)).words, /this PDF is over 64 MB/);
    const bare = path.join(dir, 'bare.pdf');
    fs.writeFileSync(bare, '%PDF-1.7\n1 0 obj << /Title (x) >> endobj\n', 'latin1');
    assert.match(fp.compare(bare, 'pdf-normalized:' + 'c'.repeat(64)).words, /no dates or ID to leave out/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7213 review 4: a PDF fingerprint pasted without its label still differs (byte for byte), and says what it is', () => {
  const p = at('cups-a.pdf');
  const fpv = fp.fingerprint(p);
  const c = fp.compare(p, fpv.slice('pdf-normalized:'.length));
  assert.equal(c.match, false, 'a bare value matched by anything but the bytes');
  assert.match(c.words, /But that value is this PDF's fingerprint \(pdf-normalized:[0-9a-f]{64}\): give it with the pdf-normalized: label/);
  const other = fp.compare(p, 'd'.repeat(64));
  assert.doesNotMatch(other.words, /this PDF's fingerprint/, 'CONTROL: an unrelated value got the hint');
});
