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
test.beforeEach(() => { filehash._resetForTest(); filehash._onHashedForTest(null); filehash._settleForTest(0); });   // most tests hash at once
test.after(() => filehash._settleForTest(null));

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

test('a link is not followed: the file is opened with O_NOFOLLOW (where the platform has it)', async () => {
  const p = write('nofollow.txt', 'plain');
  const flags = [];
  const real = fs.promises.open;
  fs.promises.open = (f, fl, ...r) => { flags.push(fl); return real(f, fl, ...r); };
  try { filehash.want(p, fs.statSync(p)); await settle(); } finally { fs.promises.open = real; }
  assert.equal(flags.length, 1);
  if (fs.constants.O_NOFOLLOW) assert.ok((flags[0] & fs.constants.O_NOFOLLOW) !== 0, 'opened without O_NOFOLLOW: a link swapped in would be followed');
});

test('iteration 1: a file still being written (not settled) is not hashed; once settled, it is', async () => {
  filehash._settleForTest(60 * 1000);
  const p = write('fresh.txt', 'just written');
  let opens = 0;
  const real = fs.promises.open;
  fs.promises.open = (...x) => { opens += 1; return real(...x); };
  try {
    assert.equal(filehash.forRow(p, fs.statSync(p)), null);
    await settle();
    assert.equal(opens, 0, 'a file written a moment ago was read');
    filehash._settleForTest(0);
    filehash.forRow(p, fs.statSync(p));
    await settle();
    assert.equal(filehash.known(p, fs.statSync(p)), sha('just written'), 'CONTROL: settled, it is fingerprinted');
  } finally { fs.promises.open = real; }
});

test('iteration 1: a file that changed while it was read is not tried again for the back-off, however often it is polled', async () => {
  const p = write('grow.txt', 'a'.repeat(2 * 1024 * 1024));
  let opens = 0;
  const real = fs.promises.open;
  fs.promises.open = async (...x) => {
    opens += 1;
    const fh = await real(...x);
    const read = fh.read.bind(fh);
    let first = true;
    fh.read = async (...r) => { const out = await read(...r); if (first) { first = false; fs.appendFileSync(p, 'more'); } return out; };
    return fh;
  };
  try {
    filehash.want(p, fs.statSync(p));
    await settle();
    for (let i = 0; i < 5; i++) { filehash.forRow(p, fs.statSync(p)); await settle(); }
  } finally { fs.promises.open = real; }
  assert.equal(opens, 1, 'a file that keeps changing was read again on every poll: ' + opens);
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
  // CONTROL: once it is still (and past its back-off, cleared here), it is fingerprinted.
  filehash._resetForTest();
  filehash.want(p, fs.statSync(p));
  await settle();
  assert.equal(filehash.known(p, fs.statSync(p)), sha(fs.readFileSync(p)));
});

test('iteration 2: a file whose modification time is in the future is still fingerprinted once settled', async () => {
  filehash._settleForTest(60 * 1000);
  const p = write('future.txt', 'from a fast clock');
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  fs.utimesSync(p, future, future);   // sets mtime (the change time moves to now)
  filehash.forRow(p, fs.statSync(p));
  await settle();
  assert.equal(filehash.known(p, fs.statSync(p)), null, 'premise: just changed, so not yet settled');
  // Settled by the change time: pretend it was changed long ago, as a file copied in yesterday would be.
  const st = fs.statSync(p);
  const old = Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ctimeMs: Date.now() - 120 * 1000 });
  const real = fs.promises.open;
  fs.promises.open = async (...x) => { const fh = await real(...x); const s0 = fh.stat.bind(fh); fh.stat = async () => Object.assign(Object.create(Object.getPrototypeOf(st)), await s0(), { ctimeMs: old.ctimeMs }); return fh; };
  try { filehash.want(p, old); await settle(); } finally { fs.promises.open = real; }
  assert.equal(filehash.known(p, old), sha('from a fast clock'), 'a future modification time kept the file unhashed');
});

test('iteration 3: a cloud-only placeholder (full size, no blocks here) is never read, so showing a list downloads nothing', async () => {
  const p = write('cloud.txt', 'x');
  const st = fs.statSync(p);
  const placeholder = Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 8 * 1024 * 1024, blocks: 0 });
  let opens = 0;
  const real = fs.promises.open;
  fs.promises.open = (...x) => { opens += 1; return real(...x); };
  try { filehash.forRow(p, placeholder); await settle(); } finally { fs.promises.open = real; }
  assert.equal(opens, 0, 'a placeholder was read, which would make the system download it');
  filehash.forRow(p, fs.statSync(p));   // CONTROL: the same file, really here, is hashed
  await settle();
  assert.equal(filehash.known(p, fs.statSync(p)), sha('x'));
});

test('iteration 4: a SMALL file with no blocks of its own (stored inline or compressed) is still fingerprinted', async () => {
  const p = write('tiny.txt', 'tiny');
  const st = fs.statSync(p);
  const inline = Object.assign(Object.create(Object.getPrototypeOf(st)), st, { blocks: 0 });   // its real small size, no blocks
  filehash.want(p, inline);
  await settle();
  assert.equal(filehash.known(p, inline), sha('tiny'), 'a small block-less file was taken for a cloud placeholder');
});
