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
  fs.mkdirSync(where, { recursive: true });
  const byNumber = new Map();
  for (let i = 0; i < 4000; i++) {
    const file = path.join(where, 'f' + i + '.txt');
    fs.writeFileSync(file, 'same size\n');
    const big = fs.statSync(file, { bigint: true });
    const key = Number(big.dev) + ':' + Number(big.ino);
    const prior = byNumber.get(key);
    if (prior && prior.ino !== big.ino) return [prior.file, file];
    byNumber.set(key, { file, ino: big.ino });
  }
  return null;
}
let PAIR;
const pair = () => (PAIR === undefined ? (PAIR = collidingFiles(path.join(SANDBOX, 'ids'))) : PAIR);

test('#7229: the download guard tells apart two files whose number ids collide', winOnly, (t) => {
  const p = pair();
  if (!p) { t.skip('no two files here had equal number ids'); return; }
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
  if (!p) { t.skip('no two files here had equal number ids'); return; }
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
  if (!p) { t.skip('no two files here had equal number ids'); return; }
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
