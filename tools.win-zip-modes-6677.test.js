'use strict';
/**
 * #6677: every entry in the Windows zip was stored world-writable. On the Windows release box the
 * build's `zip` is a shim over Windows' bsdtar, which records 0666 for files and 0777 for folders and
 * .exe files: the 0.7.60 zip carried all 369 entries that way. tools/lib/zip-modes.js now rewrites each
 * entry to 0644, 0755 for programs and 0755 for folders after the zip is written, and the build reads
 * the modes back and refuses a zip that still has a wrong one.
 *
 * The hand-made zips below run on every host. The arm that makes the zip the way the release box does
 * (tar.exe -a) needs Windows' own tar, so it runs only on win32 (tools/windows-tests.js selects this file
 * there, by its tools.win- name).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zm = require('./tools/lib/zip-modes');

const SCRIPT = path.join(__dirname, 'tools', 'lib', 'zip-modes.js');
const WIN = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-windows.sh'), 'utf8');

/* CRC-32 by hand, so the file does not need zlib.crc32 (Node 22.2+). */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored (uncompressed) zip from [{name, data, madeBy, attrs, extra, comment}], with an optional ZIP64 end
    record. extra and comment are written into the central directory (and extra into the local header) the way
    Info-ZIP writes its UT/ux fields, so the walk over them is exercised off Windows too. */
function makeZip(entries, { zip64 = false } = {}) {
  const locals = [];
  const cens = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data || '');
    const extra = Buffer.from(e.extra || '');
    const comment = Buffer.from(e.comment || '');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(extra.length, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.madeBy, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(extra.length, 30); ch.writeUInt16LE(comment.length, 32);
    ch.writeUInt32LE(e.attrs >>> 0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, extra, data);
    cens.push(ch, name, extra, comment);
    offset += 30 + name.length + extra.length + data.length;
  }
  const cen = Buffer.concat(cens);
  const parts = [...locals, cen];
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  if (zip64) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0); rec.writeBigUInt64LE(44n, 4); rec.writeUInt16LE(45, 12); rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(entries.length), 24); rec.writeBigUInt64LE(BigInt(entries.length), 32);
    rec.writeBigUInt64LE(BigInt(cen.length), 40); rec.writeBigUInt64LE(BigInt(offset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(offset + cen.length), 8); loc.writeUInt32LE(1, 16);
    parts.push(rec, loc);
    eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10); eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16);
  } else {
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cen.length, 12); eocd.writeUInt32LE(offset, 16);
  }
  parts.push(eocd);
  return Buffer.concat(parts);
}

const UNIX = 3 << 8 | 20;
const DOS = 0 << 8 | 20;
/* What bsdtar on Windows wrote into 0.7.60, plus a DOS-hosted entry and a shebang script. */
const BAD = [
  { name: '! READ ME FIRST - Windows will warn you.txt', data: 'read me', madeBy: UNIX, attrs: (0o100666 << 16) | 0x20 },
  { name: 'Kosmos.exe', data: 'MZ', madeBy: UNIX, attrs: (0o100777 << 16) | 0x20,
    extra: Buffer.from([0x55, 0x54, 5, 0, 1, 0x10, 0x20, 0x30, 0x40]), comment: 'an entry comment' },
  { name: 'app/', madeBy: UNIX, attrs: (0o040777 << 16) | 0x10 },
  { name: 'app/server.js', data: 'console.log(1)', madeBy: UNIX, attrs: 0o100666 << 16 },
  { name: 'bin/', madeBy: DOS, attrs: 0x10 },
  { name: 'bin/kosmos', data: '#!/bin/sh\necho hi\n', madeBy: UNIX, attrs: 0o100666 << 16 },
  { name: 'bin/kosmos.ps1', data: 'Write-Output hi', madeBy: UNIX, attrs: 0o100777 << 16 },
  { name: 'bin/kosmos.CMD', data: '@echo off', madeBy: DOS, attrs: 0x20 },
  { name: 'runtime/WebView2Loader.dll', data: 'MZ', madeBy: UNIX, attrs: 0o100666 << 16 },
];
const WANT = {
  '! READ ME FIRST - Windows will warn you.txt': 0o100644, 'Kosmos.exe': 0o100755, 'app/': 0o040755,
  'app/server.js': 0o100644, 'bin/': 0o040755, 'bin/kosmos': 0o100755, 'bin/kosmos.ps1': 0o100644,
  'bin/kosmos.CMD': 0o100755, 'runtime/WebView2Loader.dll': 0o100755,
};

function stageFor(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipmodes-stage-'));
  for (const e of entries) {
    const p = path.join(dir, ...e.name.split('/'));
    if (e.name.endsWith('/')) fs.mkdirSync(p, { recursive: true });
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, e.data || ''); }
  }
  return dir;
}

function modesOf(buf) {
  return Object.fromEntries(zm.listEntries(buf).map((e) => [e.name, { host: e.madeBy >> 8, mode: e.attrs >>> 16, dos: e.attrs & 0xffff }]));
}

for (const zip64 of [false, true]) {
  test(`#6677: set gives every entry its mode and a Unix host, and changes nothing else${zip64 ? ' (ZIP64 end record)' : ''}`, () => {
    const stage = stageFor(BAD);
    try {
      const before = makeZip(BAD, { zip64 });
      /* The control: the check refuses the zip as bsdtar wrote it, naming each wrong entry. */
      const bad = zm.checkModes(before);
      assert.equal(bad.problems.length, BAD.length, 'the check passed a world-writable zip: ' + bad.problems.join(' | '));
      const after = Buffer.from(before);
      const counts = zm.setModes(after, stage);
      assert.deepEqual(counts, { file: 3, exec: 4, dir: 2 });
      const got = modesOf(after);
      assert.equal(Object.keys(got).length, BAD.length);
      for (const [name, mode] of Object.entries(WANT)) {
        assert.equal(got[name].host, 3, name + ' is not Unix-hosted');
        assert.equal(got[name].mode.toString(8), mode.toString(8), name);
        assert.equal(got[name].mode & 0o022, 0, name + ' is group- or world-writable');
      }
      assert.equal(got['bin/'].dos & 0x10, 0x10, 'a folder lost its DOS folder bit');
      assert.equal(got['Kosmos.exe'].dos, 0x20, 'the DOS archive bit was not kept');
      assert.deepEqual(zm.checkModes(after).problems, []);
      /* Only the patched fields moved: same length, and the bytes differ only inside central-directory headers. */
      assert.equal(after.length, before.length);
      const heads = zm.listEntries(after).map((e) => e.at);
      for (let i = 0; i < after.length; i++) {
        if (after[i] === before[i]) continue;
        assert.ok(heads.some((h) => (i >= h + 4 && i < h + 6) || (i >= h + 38 && i < h + 42)), `byte ${i} changed outside a mode field`);
      }
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  });
}

test('#6677: check refuses a program left at 0644, which is not writable but cannot run on a Unix extract', () => {
  const buf = makeZip([
    { name: 'Kosmos.exe', data: 'MZ', madeBy: UNIX, attrs: 0o100644 << 16 },
    { name: 'bin/kosmos', data: '#!/bin/sh\n', madeBy: UNIX, attrs: 0o100644 << 16 },
  ]);
  assert.deepEqual(zm.checkModes(buf).problems, ['Kosmos.exe: mode 100644']);
  zm.setModes(buf);
  assert.deepEqual(zm.checkModes(buf).problems, []);
});

test('#6677: with the stage folder check is exact (a .js left 0755 is refused); an empty zip is refused', () => {
  const stage = stageFor(BAD);
  try {
    const buf = makeZip(BAD);
    zm.setModes(buf, stage);
    assert.deepEqual(zm.checkModes(buf, stage).problems, []);
    const server = zm.listEntries(buf).find((e) => e.name === 'app/server.js');
    buf.writeUInt32LE(((0o100755 << 16) | (server.attrs & 0xffff)) >>> 0, server.at + 38);
    /* The control: without the stage folder a 0755 .js is allowed (it could be a #! script). */
    assert.deepEqual(zm.checkModes(buf).problems, []);
    assert.deepEqual(zm.checkModes(buf, stage).problems, ['app/server.js: mode 100755']);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  assert.deepEqual(zm.checkModes(makeZip([])).problems, ['the zip has no entries']);
});

test('#6677: a stage folder that is not there is refused, and an entry missing from the stage is named', () => {
  const stage = stageFor(BAD);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipmodes-stage-missing-'));
  try {
    const z = path.join(dir, 'k.zip');
    fs.writeFileSync(z, makeZip(BAD));
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
    /* A wrong stage path would hide every #! script from set and check alike, so both refuse it. */
    for (const verb of ['set', 'check']) {
      const r = run(verb, z, path.join(dir, 'no-such-stage'));
      assert.equal(r.status, 2, verb + ': ' + r.stdout + r.stderr);
      assert.match(r.stderr, /is not a folder/);
    }
    fs.rmSync(path.join(stage, 'bin', 'kosmos'));
    const buf = makeZip(BAD);
    zm.setModes(buf, stage);
    assert.deepEqual(zm.checkModes(buf, stage).problems.filter((p) => /not in the stage folder/.test(p)).map((p) => p.split(':')[0]), ['bin/kosmos']);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#6677: check refuses a non-ASCII name not marked UTF-8, and passes one that is', () => {
  const plain = makeZip([{ name: 'café.txt', data: 'x', madeBy: UNIX, attrs: 0o100644 << 16 }]);
  assert.deepEqual(zm.checkModes(plain).problems, ['café.txt: a name that is not ASCII and not marked UTF-8']);
  const marked = Buffer.from(plain);
  const e = zm.listEntries(marked)[0];
  marked.writeUInt16LE(e.flags | 0x800, e.at + 8);
  assert.deepEqual(zm.checkModes(marked).problems, []);
});

test('#6677: set refuses a symlink entry rather than turning it into a file, and a zip with bytes after its end record', () => {
  const link = makeZip([{ name: 'app/link', data: '../outside', madeBy: UNIX, attrs: 0o120777 << 16 }]);
  assert.throws(() => zm.setModes(link), /app\/link is not a regular file or a folder \(Unix type 120000\)/);
  /* The control: the same entry as a regular file is rewritten. */
  assert.deepEqual(zm.setModes(makeZip([{ name: 'app/link', data: '../outside', madeBy: UNIX, attrs: 0o100666 << 16 }])), { file: 1, exec: 0, dir: 0 });
  const appended = Buffer.concat([makeZip(BAD), Buffer.from('trailing')]);
  assert.throws(() => zm.listEntries(appended), /does not end the file/);
});

/* The updater unpacks the served zip with engine/win32zip.js, using win32update's own top-level names. A zip
   set has rewritten must still be one it accepts: that is a promise between two modules, so it is held here. */
function updaterReads(buf) {
  const win32zip = require('./engine/win32zip');
  const { ENTRIES } = require('./engine/win32update');
  return win32zip.readZipDirectory(buf, { allowedTopLevel: ENTRIES, maxEntries: 5000, maxEntryBytes: 1 << 30, maxTotalBytes: 1 << 30 });
}

test('#6677: the updater\'s zip reader accepts a zip after set, as it accepted it before', () => {
  const stage = stageFor(BAD);
  try {
    const buf = makeZip(BAD);
    assert.equal(updaterReads(buf).length, BAD.length, 'the control: the updater does not read the fixture as written');
    zm.setModes(buf, stage);
    assert.equal(updaterReads(buf).length, BAD.length);
    /* The check can fail: the same zip with one entry marked a symlink is refused by the updater. */
    const linked = Buffer.from(buf);
    const e = zm.listEntries(linked).find((x) => x.name === 'app/server.js');
    linked.writeUInt32LE(((0o120644 << 16) | (e.attrs & 0xffff)) >>> 0, e.at + 38);
    assert.throws(() => updaterReads(linked), /is a link/);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
});

test('#6677: without a stage folder a shebang cannot be seen, so such a file is 0644, never writable', () => {
  assert.equal(zm.modeFor('bin/kosmos'), zm.MODE_FILE);
  assert.equal(zm.modeFor('x/Kosmos.EXE'), zm.MODE_EXEC);
  assert.equal(zm.modeFor('x/'), zm.MODE_DIR);
});

test('#6677: the command line refuses a world-writable zip and passes the fixed one', () => {
  const stage = stageFor(BAD);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipmodes-cli-'));
  try {
    const z = path.join(dir, 'k.zip');
    fs.writeFileSync(z, makeZip(BAD));
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
    const before = run('check', z);
    assert.equal(before.status, 1, before.stdout + before.stderr);
    assert.match(before.stderr, /Kosmos\.exe: mode 100777/);
    const set = run('set', z, stage);
    assert.equal(set.status, 0, set.stderr);
    const after = run('check', z, stage);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /3 files 0644, 4 programs 0755, 2 folders 0755, nothing world-writable/);
    const notZip = path.join(dir, 'not.zip');
    fs.writeFileSync(notZip, 'hello');
    assert.equal(run('check', notZip).status, 1, 'a file that is not a zip passed the check');
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#6677: the build sets the modes before the .sha256 and refuses a zip whose modes read back wrong', () => {
  const zipAt = WIN.indexOf('zip -qr "$ZIPOUT" .');
  const setAt = WIN.indexOf('node "$REPO/tools/lib/zip-modes.js" set "$ZIPOUT" "$STAGE"');
  const shaAt = WIN.indexOf('shasum -a 256 "$ZIPOUT"');
  assert.ok(zipAt > -1 && setAt > zipAt && shaAt > setAt, 'the modes are not set between the zip and its .sha256');
  const refuseAt = WIN.indexOf('refuse() {');
  const checkAt = WIN.indexOf('node "$REPO/tools/lib/zip-modes.js" check "$ZIPOUT" "$STAGE" || refuse');
  assert.ok(refuseAt > -1 && checkAt > refuseAt, 'the finished zip\'s modes are not read back and refused');
});

/* The release box's own path: Windows' bsdtar (what the build's zip shim calls) really does write
   world-writable entries, and set makes them sane without breaking the archive. */
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
test('#6677 on Windows: a zip made by tar.exe -a, as the release box makes it, comes out 0644/0755 and still extracts',
  { skip: process.platform !== 'win32' ? 'needs Windows\' own tar.exe' : (!fs.existsSync(TAR) && 'no tar.exe in System32') }, () => {
    const stage = stageFor(BAD);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipmodes-tar-'));
    try {
      const z = path.join(dir, 'k.zip');
      const made = spawnSync(TAR, ['-a', '-cf', z, ...fs.readdirSync(stage)], { cwd: stage, encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      const before = zm.checkModes(fs.readFileSync(z));
      assert.ok(before.problems.length > 0, 'the control failed: tar.exe wrote sane modes, so this test proves nothing');
      assert.ok(before.problems.some((p) => /mode 100666|mode 100777|mode 40777/.test(p)), before.problems.join(' | '));
      const buf = fs.readFileSync(z);
      zm.setModes(buf, stage);
      fs.writeFileSync(z, buf);
      const got = modesOf(fs.readFileSync(z));
      for (const [name, mode] of Object.entries(WANT)) {
        if (got[name]) assert.equal(got[name].mode.toString(8), mode.toString(8), name);
      }
      assert.ok(got['Kosmos.exe'] && got['app/server.js'] && got['bin/kosmos'], 'tar.exe left out entries this test reads');
      assert.deepEqual(zm.checkModes(fs.readFileSync(z)).problems, []);
      /* And the updater still reads the real (deflated) tar.exe zip after set. */
      assert.equal(updaterReads(fs.readFileSync(z)).length, zm.listEntries(fs.readFileSync(z)).length);
      const out = path.join(dir, 'out');
      fs.mkdirSync(out);
      const x = spawnSync(TAR, ['-xf', z], { cwd: out, encoding: 'utf8' });
      assert.equal(x.status, 0, x.stderr);
      assert.equal(fs.readFileSync(path.join(out, 'bin', 'kosmos'), 'utf8'), '#!/bin/sh\necho hi\n');
      assert.equal(fs.readFileSync(path.join(out, 'app', 'server.js'), 'utf8'), 'console.log(1)');
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
