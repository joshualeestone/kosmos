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
    const c = fp.compare(txt, 'pdf-normalized:' + hex(txt));
    assert.equal(c.ok, true);
    assert.equal(c.match, false, 'a pdf-normalized value matched a file that is not a normalized PDF');
    assert.match(c.words, /this file has none.*Its plain sha256 is sha256:/);
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
