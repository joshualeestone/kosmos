'use strict';
/* #6761: the background fingerprint cache for Files rows (engine/filehash.js).
 *   node --test engine/filehash-6761.test.js */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const filehash = require('./filehash');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filehash-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));
test.beforeEach(() => { filehash._resetForTest(); filehash._onHashedForTest(null); });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const settle = async () => { for (let i = 0; i < 200 && !filehash._idleForTest(); i++) await new Promise((r) => setTimeout(r, 5)); };
const write = (name, data) => { const p = path.join(DIR, name); fs.writeFileSync(p, data); return p; };

test('a row never waits: the first look queues the file and answers null; once hashed, the fingerprint is the file\'s sha256', async () => {
  const p = write('a.txt', 'hello');
  assert.equal(filehash.forRow(p, fs.statSync(p)), null, 'the first look must not read the file');
  await settle();
  assert.equal(filehash.forRow(p, fs.statSync(p)), sha('hello'));
});

test('an unchanged file is read once; a changed one is read again and gets its new fingerprint', async () => {
  const p = write('b.txt', 'one');
  let opens = 0;
  const real = fs.promises.open;
  fs.promises.open = (...a) => { opens += 1; return real(...a); };
  try {
    filehash.forRow(p, fs.statSync(p));
    await settle();
    for (let i = 0; i < 5; i++) assert.equal(filehash.forRow(p, fs.statSync(p)), sha('one'));
    await settle();
    assert.equal(opens, 1, 'an unchanged file was read again');
    fs.writeFileSync(p, 'two, longer');
    assert.equal(filehash.forRow(p, fs.statSync(p)), null, 'the old fingerprint was given for the changed file');
    await settle();
    assert.equal(filehash.forRow(p, fs.statSync(p)), sha('two, longer'));
    assert.equal(opens, 2);
  } finally { fs.promises.open = real; }
});

test('a file past the size cap is never queued (its row shows nothing rather than a guess)', async () => {
  const p = write('c.txt', 'x');
  const st = fs.statSync(p);
  const big = Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: filehash.MAX_BYTES + 1 });
  let opens = 0;
  const real = fs.promises.open;
  fs.promises.open = (...a) => { opens += 1; return real(...a); };
  try {
    filehash.want(p, big);
    await settle();
    assert.equal(opens, 0);
    assert.equal(filehash.known(p, big), null);
  } finally { fs.promises.open = real; }
});

test('a link is not followed: a row whose file became a link gets no fingerprint', async () => {
  const target = write('secret.txt', 'secret');
  const p = path.join(DIR, 'link.txt');
  fs.writeFileSync(p, 'plain');
  const st = fs.statSync(p);   // listed as a plain file
  fs.rmSync(p);
  fs.symlinkSync(target, p);   // then swapped for a link
  filehash.want(p, st);
  await settle();
  assert.equal(filehash.known(p, st), null);
  assert.notEqual(filehash.known(p, fs.statSync(p)), sha('secret'));
});

test('a file written WHILE it is hashed is not cached (a fingerprint never describes a mix of two versions)', async () => {
  const p = write('d.txt', 'a'.repeat(3 * 1024 * 1024));
  const real = fs.promises.open;
  fs.promises.open = async (...a) => {
    const fh = await real(...a);
    const read = fh.read.bind(fh);
    let first = true;
    fh.read = async (...r) => { const out = await read(...r); if (first) { first = false; fs.appendFileSync(p, 'more'); } return out; };
    return fh;
  };
  const st = fs.statSync(p);
  try {
    filehash.want(p, st);
    await settle();
  } finally { fs.promises.open = real; }
  assert.equal(filehash.known(p, st), null, 'a file changed during the read was cached');
  // CONTROL: once it is still, it is fingerprinted.
  filehash.want(p, fs.statSync(p));
  await settle();
  assert.equal(filehash.known(p, fs.statSync(p)), sha(fs.readFileSync(p)));
});
