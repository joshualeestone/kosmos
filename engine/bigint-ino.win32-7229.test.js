'use strict';
/*
 * #7229: on Windows an NTFS file id is 64-bit and a number stat keeps 53 bits, so two different files can share a
 * st.ino (on the Windows box 19 pairs of 2000 fresh files did). Identity checks that decide "same file" compare the
 * exact (BigInt) ids instead. Each test here first MAKES a real collision (files until two share a number id), then
 * shows the check tells them apart. Windows only: elsewhere ids fit a number.
 *
 *   node --test engine/bigint-ino.win32-7229.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projects = require('./projects.js');
const diagnostics = require('./diagnostics.js');

const WIN = process.platform === 'win32';
const winOnly = { skip: !WIN && 'Windows file ids' };
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ino-7229-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

/* Two different files whose number ids are equal: up to 4000 files are made to find a pair; null if none did. */
function collidingFiles(where) {
  /* An NTFS id is (sequence << 48) | record, and a record's sequence rises each time it is reused, so ids pass 2^53 once
     a record has been reused 32 times; from there a number keeps only even values, and two neighbouring records at the
     same sequence round alike. A pool of files is made and deleted until their records are past that, then compared
     (review 6: a fresh disk needs about 32 rounds, so up to 128, within 60 s; keyed on the UNSIGNED id, as the number
     stat reads it). */
  const pool = path.join(where, 'pool');
  fs.mkdirSync(pool, { recursive: true });
  const until = Date.now() + 60000;
  for (let round = 0; round < 128 && Date.now() < until; round++) {
    const made = [];
    for (let i = 0; i < 64; i++) { const file = path.join(pool, 'r' + round + '-' + i + '.txt'); fs.writeFileSync(file, 'same size\n'); made.push(file); }
    const byNumber = new Map();
    for (const m of made) {
      const big = fs.statSync(m, { bigint: true });
      const id = BigInt.asUintN(64, big.ino);
      const key = Number(big.dev) + ':' + Number(id);
      const prior = byNumber.get(key);
      if (prior && prior.id !== id) return [prior.file, m];
      byNumber.set(key, { file: m, id });
    }
    for (const m of made) fs.unlinkSync(m);
  }
  return null;
}
let PAIR;
const pair = () => (PAIR === undefined ? (PAIR = collidingFiles(path.join(SANDBOX, 'ids'))) : PAIR);

test('#7229: the download guard tells apart two files whose number ids collide', winOnly, (t) => {
  const p = pair();
  if (!p) { assert.fail('no colliding pair could be made on this disk (review 6: never a silent skip)'); }
  const [a, b] = p;
  assert.equal(fs.statSync(a).ino, fs.statSync(b).ino, 'the collision this test needs');
  const gated = projects.exactPathStat(fs.statSync(a), a, false);
  const fd = fs.openSync(b, 'r');
  try {
    const opened = projects.exactOpenedStat(fs.fstatSync(fd), fd);
    assert.equal(projects.sameOpenedFile(gated, opened, 'win32'), false, 'a different file swapped in is refused');
    // CONTROL: the number stats alone are fooled (the bug), and the same file still passes with exact ids
    assert.equal(projects.sameOpenedFile(fs.statSync(a), fs.fstatSync(fd), 'win32'), true, 'number ids alone match: the bug');
  } finally { fs.closeSync(fd); }
  const fdA = fs.openSync(a, 'r');
  try {
    assert.equal(projects.sameOpenedFile(gated, projects.exactOpenedStat(fs.fstatSync(fdA), fdA), 'win32'), true);
  } finally { fs.closeSync(fdA); }
});

test('#7229: the board-log reader does not take a colliding file for board.log', winOnly, (t) => {
  const p = pair();
  if (!p) { assert.fail('no colliding pair could be made on this disk (review 6: never a silent skip)'); }
  const [log, other] = p;
  const out = fs.openSync(other, 'r');
  try {
    const why = {};
    assert.equal(diagnostics.readBoardLog(log, out, 100, why), null, 'another file is not this board\'s output');
    assert.equal(why.why, 'not this board\'s output');
  } finally { fs.closeSync(out); }
  const own = fs.openSync(log, 'r');
  try {
    assert.notEqual(diagnostics.readBoardLog(log, own, 100), null, 'CONTROL: board.log\'s own descriptor is read');
  } finally { fs.closeSync(own); }
});

test('#7229: a stat whose second read is not the same file never matches', winOnly, () => {
  const a = path.join(SANDBOX, 'swap-a.txt');
  const b = path.join(SANDBOX, 'swap-b.txt');
  fs.writeFileSync(a, 'a\n');
  fs.writeFileSync(b, 'bb\n');
  // the number stat of a, then the path names b: the exact read is not the same file
  const mixed = projects.exactPathStat(fs.statSync(a), b, false);
  const fd = fs.openSync(a, 'r');
  try {
    assert.equal(projects.sameOpenedFile(mixed, projects.exactOpenedStat(fs.fstatSync(fd), fd), 'win32'), false);
  } finally { fs.closeSync(fd); }
  // the exact id is hidden from JSON and rows
  assert.equal(Object.keys(projects.exactPathStat(fs.statSync(a), a, false)).includes('inoExact'), false);
});

test('#7229: on Windows a project folder must be a drive path or a share', () => {
  const ok = (f) => projects.windowsProjectFolderOk(f, 'win32');
  for (const f of ['C:\\work', 'c:/work', '\\\\?\\C:\\work', '\\\\.\\C:\\work', '\\\\server\\share\\x', '//server/share', '\\\\?\\UNC\\server\\share']) {
    assert.equal(ok(f), true, f);
  }
  for (const f of ['\\\\.\\pipe\\x', '\\\\.\\COM1', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\x', '\\\\?\\Volume{8567e582-9e23-4c72-a97e-1fbdfc2f255f}\\x']) {
    assert.equal(ok(f), false, f);
  }
  assert.equal(projects.windowsProjectFolderOk('\\\\.\\pipe\\x', 'darwin'), true, 'only Windows reads these spellings');
});

const filepreview = require('./filepreview.js');
const { Worker } = require('node:worker_threads');

test('#7229 review 1: the zip\'s first check (the listed entry against the gate) refuses a colliding file swapped in', winOnly, (t) => {
  const p = pair();
  if (!p) { assert.fail('no colliding pair could be made on this disk (review 6: never a silent skip)'); }
  const dir = path.join(SANDBOX, 'zip');
  fs.mkdirSync(dir, { recursive: true });
  const [a, b] = p;
  const target = path.join(dir, 'x.txt');
  fs.copyFileSync(a, path.join(SANDBOX, 'a-backup.txt'));
  fs.renameSync(a, target);
  const walked = projects.walkListedDir(dir, '', 'this folder', { maxDepth: 2 });
  assert.equal(walked.ok, true, JSON.stringify(walked).slice(0, 200));
  const e = walked.files.find((f) => f.name === 'x.txt');
  assert.ok(e && typeof e.st.inoExact === 'bigint', 'the listed entry carries its exact id');
  fs.renameSync(b, target);   // the colliding file, same size, swapped in after the listing
  const gate = filepreview.resolve(dir, 'x.txt', 'this folder', { maxDepth: 2, act: 'download' });
  assert.equal(gate.ok, true);
  assert.equal(gate.st.ino, e.st.ino, 'the collision: the number ids are equal');
  assert.equal(projects.sameOpenedFile(e.st, gate.st), false, 'the swapped file is refused');
  PAIR = null;   // the pair has been moved; later tests make their own files
});

test('#7229 review 1: a file being written to is still the same file (only the id is compared)', winOnly, async () => {
  const file = path.join(SANDBOX, 'grow.log');
  fs.writeFileSync(file, '');
  const w = new Worker(`const fs=require('fs');const end=Date.now()+700;while(Date.now()<end)fs.appendFileSync(${JSON.stringify(file)},'line\\n');`, { eval: true });
  let refused = 0;
  let reads = 0;
  const until = Date.now() + 500;
  while (Date.now() < until) {
    const st = projects.exactPathStat(fs.statSync(file), file, false);
    reads += 1;
    if (st.inoExact === -1n) refused += 1;
  }
  await new Promise((r) => w.on('exit', r));
  assert.ok(reads > 100, 'the loop ran: ' + reads);
  assert.equal(refused, 0, refused + ' of ' + reads + ' reads of a growing file were taken for another file');
});

test('#7229 review 1: exact ids are unsigned (node reads BigInt stats as signed 64-bit)', winOnly, () => {
  const f = path.join(SANDBOX, 'u.txt');
  fs.writeFileSync(f, 'u');
  const fd = fs.openSync(f, 'r');
  try { assert.ok(projects.exactOpenedStat(fs.fstatSync(fd), fd).inoExact >= 0n); } finally { fs.closeSync(fd); }
  // an id with the top bit set: the signed read is negative, the unsigned one equals the number stat's reading
  assert.equal(Number(BigInt.asUintN(64, -9223090561878060492n)), Number(0x8001000000001234n));
  const src = fs.readFileSync(path.join(__dirname, 'projects.js'), 'utf8');
  assert.equal((src.match(/u64\(/g) || []).length >= 3, true, 'all three exact readers normalise');
});

test('#7229 review 1: a rooted folder with no drive letter is on the current drive, so it is allowed', () => {
  assert.equal(projects.windowsProjectFolderOk('\\work', 'win32'), true);
  assert.equal(projects.windowsProjectFolderOk('/work', 'win32'), true);
  assert.equal(projects.windowsProjectFolderOk('\\\\.\\pipe\\x', 'win32'), false, 'CONTROL');
});


test('#7229 review 2: moving a project folder follows the same Windows rule as create; the file-hash key carries the exact id', () => {
  const src = fs.readFileSync(path.join(__dirname, 'projects.js'), 'utf8');
  const move = src.slice(src.indexOf('function moveFolder('), src.indexOf('function moveFolder(') + 2000);
  assert.match(move, /windowsProjectFolderOk\(given\)/, 'moveFolder checks the folder as create does');
  const filehash = fs.readFileSync(path.join(__dirname, 'filehash.js'), 'utf8');
  assert.match(filehash, /st\.inoExact === undefined \? \[\] : \[String\(st\.inoExact\)\]/);
});

test('#7229 review 3: on Windows a listDir row (exact id) is fingerprinted, and a listFiles row still is', winOnly, async () => {
  const filehash = require('./filehash.js');
  filehash._settleForTest(0);
  const root = path.join(SANDBOX, 'fp');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'hello');
  const want = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';   // sha256('hello')
  const rowOf = (r) => (r.files || r.entries || []).find((e) => /a\.txt$/.test(e.name));
  projects.listDir(root, 'sub', 'this folder', { maxDepth: 1, fingerprint: true });
  let row;
  for (let i = 0; i < 40 && !(row && row.sha256); i++) {
    await new Promise((r) => setTimeout(r, 50));
    row = rowOf(projects.listDir(root, 'sub', 'this folder', { maxDepth: 1, fingerprint: true }));
  }
  assert.equal(row && row.sha256, want, 'the listDir row gets its fingerprint: ' + JSON.stringify(row));
  // CONTROL: listFiles (no exact id on its rows) still fingerprints
  projects.listFiles(root, 50, { maxDepth: 2, fingerprint: true });
  let lrow;
  for (let i = 0; i < 40 && !(lrow && lrow.sha256); i++) {
    await new Promise((r) => setTimeout(r, 50));
    lrow = (projects.listFiles(root, 50, { maxDepth: 2, fingerprint: true }).files || []).find((e) => /a\.txt$/.test(e.name));
  }
  assert.equal(lrow && lrow.sha256, want);
});

test('#7229 review 4: listFiles and listDir share one fingerprint on Windows (no re-hash every poll)', winOnly, async () => {
  const filehash = require('./filehash.js');
  filehash._settleForTest(0);
  let hashed = 0;
  filehash._onHashedForTest(() => { hashed += 1; });
  const root = path.join(SANDBOX, 'pingpong');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'one.txt'), 'hello');
  const want = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const shaOf = (rows) => ((rows || []).find((e) => /one\.txt$/.test(e.name)) || {}).sha256;
  const seen = [];
  for (let tick = 0; tick < 5; tick++) {
    const a = shaOf(projects.listFiles(root, 50, { maxDepth: 1, fingerprint: true }).files);
    const r = projects.listDir(root, '', 'this folder', { maxDepth: 1, fingerprint: true });
    const b = shaOf(r.files || r.entries);
    seen.push([a, b]);
    await new Promise((res) => setTimeout(res, 150));
  }
  assert.deepEqual(seen.slice(2), [[want, want], [want, want], [want, want]], 'both lists keep the sha: ' + JSON.stringify(seen));
  assert.equal(hashed, 1, 'the file is hashed once, not once per poll');
});

test('#7333: exact ids that match on two different volumes are two files (the device is compared on Windows too)', () => {
  const exact = (id, dev) => { const s = { isFile: () => true, ino: 1, dev, size: 1, mtimeMs: 1 }; Object.defineProperty(s, 'inoExact', { value: id }); return s; };
  assert.equal(projects.sameOpenedFile(exact(15481123720534727n, 111), exact(15481123720534727n, 222), 'win32'), false, 'same exact id, another volume, passed');
  assert.equal(projects.sameOpenedFile(exact(15481123720534727n, 111), exact(15481123720534727n, 111), 'win32'), true, 'CONTROL: same exact id, same volume');
});

test('#7333: a real file read by path and by handle has the same device on this computer (what the compare relies on)', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev7333-'));
  const f = path.join(dir, 'f.txt');
  fs.writeFileSync(f, 'x');
  const fd = fs.openSync(f, 'r');
  try {
    assert.equal(fs.statSync(f).dev, fs.fstatSync(fd).dev, 'stat by path and by handle disagree on the device');
    assert.equal(projects.sameOpenedFile(fs.statSync(f), fs.fstatSync(fd)), true, 'the real file, by path and by handle, is the same file');
  } finally { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#7333 review 1: a 64-bit volume serial read at two widths (full and low 32 bits) is one volume on Windows; other volumes still differ', () => {
  const st = (dev) => ({ isFile: () => true, ino: 5, dev, size: 1, mtimeMs: 1 });
  const full = 0x1a2b3c4d5n * 1n;   // a serial wider than 32 bits (ReFS / Dev Drive)
  const low = Number(BigInt.asUintN(32, full));
  assert.equal(projects.sameOpenedFile(st(Number(full)), st(low), 'win32'), true, 'the same volume read at two widths was refused');
  assert.equal(projects.sameOpenedFile(st(low), st(low + 1), 'win32'), false, 'CONTROL: another volume still differs');
  assert.equal(projects.sameOpenedFile(st(Number(full)), st(low), 'darwin'), false, 'CONTROL: off Windows the device is compared exactly');
});
