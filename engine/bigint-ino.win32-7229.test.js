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
