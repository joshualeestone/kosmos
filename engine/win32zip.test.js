'use strict';
/**
 * win32-update-stage (updater slice S2): the zip reader the Windows updater unpacks a
 * downloaded build with. Every archive is built in the test (test-support/zipfixture.js), the
 * broken ones included, and each refusal is paired with the well-formed archive it was cut from,
 * so a refusal that fires on everything cannot pass.
 *
 *   node --test engine/win32zip.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const win32zip = require('./win32zip');
const { buildZip } = require('../test-support/zipfixture');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32zip-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const LIMITS = Object.freeze({
  allowedTopLevel: ['app', 'bin', 'Kosmos.exe'],
  maxEntries: 50,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
});
const TEXT = 'Kosmos '.repeat(400);

function wellFormed(extra) {
  return [
    { name: 'app/' },
    { name: 'app/server.js', data: TEXT, method: 8 },
    { name: 'app/package.json', data: '{"version":"0.6.60"}', method: 0 },
    { name: 'Kosmos.exe', data: Buffer.from([0x4d, 0x5a, 0, 1, 2, 3]), method: 0 },
    ...(extra || []),
  ];
}
let counter = 0;
function freshDest() { counter += 1; return path.join(SANDBOX, 'case-' + counter, 'staged'); }
function refusesWith(entries, pattern, options) {
  const buf = buildZip(entries, options);
  assert.throws(() => win32zip.readZipDirectory(buf, LIMITS), (e) => e instanceof win32zip.ZipRefusal && pattern.test(e.message));
}

test('the updater\'s sources are text: no raw control or invisible character, so git, review and search can read them', () => {
  /* A raw NUL in a regex literal made git treat all of win32zip.js as binary. Tab, LF and CR are
     the only control characters a source line may hold; escapes are written as \x sequences. */
  const range = (from, to) => String.fromCharCode(from) + '-' + String.fromCharCode(to);
  const RAW = new RegExp('[' + [range(0x00, 0x08), range(0x0b, 0x0c), range(0x0e, 0x1f), range(0x7f, 0xa0), range(0x200b, 0x200f), range(0x2028, 0x202e), range(0x2060, 0x2060), range(0xfeff, 0xfeff)].join('') + ']');
  const files = ['engine/win32zip.js', 'engine/win32zip.test.js', 'engine/win32update.js', 'engine/win32update.test.js', 'test-support/zipfixture.js'];
  const offenders = [];
  for (const rel of files) {
    fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\n').forEach((line, i) => { if (RAW.test(line)) offenders.push(`${rel}:${i + 1}`); });
  }
  assert.ok(RAW.test('a' + String.fromCharCode(0) + 'b') && RAW.test(String.fromCharCode(0x200b)), 'the control: the rule sees what it is for');
  assert.deepEqual(offenders, []);
});

test('CONTROL: a well-formed archive reads, and each entry keeps its method', () => {
  const entries = win32zip.readZipDirectory(buildZip(wellFormed()), LIMITS);
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.isDirectory]), [
    ['app/', 0, true], ['app/server.js', 8, false], ['app/package.json', 0, false], ['Kosmos.exe', 0, false],
  ]);
});

test('a correct extract: stored and deflate entries come back byte for byte', () => {
  const dest = freshDest();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = win32zip.extractZip(buildZip(wellFormed()), dest, LIMITS);
  assert.equal(r.entries, 4);
  assert.equal(fs.readFileSync(path.join(dest, 'app', 'server.js'), 'utf8'), TEXT, 'the deflate entry');
  assert.equal(fs.readFileSync(path.join(dest, 'app', 'package.json'), 'utf8'), '{"version":"0.6.60"}', 'the stored entry');
  assert.deepEqual([...fs.readFileSync(path.join(dest, 'Kosmos.exe'))], [0x4d, 0x5a, 0, 1, 2, 3]);
  assert.ok(fs.statSync(path.join(dest, 'app')).isDirectory());
});

test('an existing destination is refused rather than unpacked into', () => {
  const dest = freshDest();
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'keep.txt'), 'mine');
  assert.throws(() => win32zip.extractZip(buildZip(wellFormed()), dest, LIMITS), /EEXIST/);
  assert.deepEqual(fs.readdirSync(dest), ['keep.txt']);
});

test('zip-slip: a name that climbs out is refused before anything is written', () => {
  const dest = freshDest();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = buildZip(wellFormed([{ name: 'app/../../escaped.txt', data: 'out' }]));
  assert.throws(() => win32zip.extractZip(buf, dest, LIMITS), /climbs out of its folder/);
  assert.equal(fs.existsSync(path.join(path.dirname(dest), 'escaped.txt')), false);
  assert.equal(fs.existsSync(path.join(SANDBOX, 'escaped.txt')), false);
  assert.equal(fs.existsSync(dest), false, 'the table of contents is checked in full before the first write');
});

test('every name trick is refused, each with its own sentence', () => {
  const cases = [
    ['/app/abs.txt', /absolute path/],
    ['../evil.txt', /climbs out/],
    ['app/./x.txt', /climbs out/],
    ['app\\evil.txt', /backslash/],
    ['C:/evil.txt', /colon/],
    ['app/server.js:hidden', /colon/],
    ['app//x.txt', /empty folder name/],
    ['app/x\u0001.txt', /control character/],
    ['app/x.', /ending in a dot or a space/],
    ['app/x ', /ending in a dot or a space/],
    ['app/CON', /reserves for a device/],
    ['app/nul.txt', /reserves for a device/],
    ['app/a<b.txt', /cannot store/],
    ['evil.txt', /not part of a Kosmos build/],
    ['App/server.js', /not part of a Kosmos build/],
  ];
  for (const [name, pattern] of cases) refusesWith(wellFormed([{ name, data: 'x' }]), pattern);
});

test('duplicates are refused, compared the way NTFS compares names', () => {
  refusesWith(wellFormed([{ name: 'app/server.js', data: 'second' }]), /twice/);
  refusesWith(wellFormed([{ name: 'app/SERVER.js', data: 'second' }]), /twice/);
  refusesWith(wellFormed([{ name: 'app/server.js/inner.txt', data: 'x' }]), /both a file and a folder/);
});

test('a symlink, an encrypted entry, an unknown method and zip64 are refused', () => {
  refusesWith(wellFormed([{ name: 'app/link', data: '/etc/passwd', unixMode: 0o120777 }]), /is a link/);
  refusesWith(wellFormed([{ name: 'app/secret', data: 'x', flags: 0x0001 }]), /encrypted/);
  refusesWith(wellFormed([{ name: 'app/bz', data: 'x', method: 12 }]), /method this updater does not read \(12\)/);
  refusesWith(wellFormed(), /zip64/, { zip64Locator: true });
  /* The control for the symlink rule: the same bits on a non-Unix host are not a link. */
  assert.doesNotThrow(() => win32zip.readZipDirectory(buildZip(wellFormed([{ name: 'app/link', data: 'x', unixMode: 0o120777, madeByHost: 0 }])), LIMITS));
});

test('each named cap is enforced: one entry, the total, and the count', () => {
  const big = Buffer.alloc(LIMITS.maxEntryBytes + 1, 0x41);
  refusesWith(wellFormed([{ name: 'app/big.bin', data: big }]), /more than the 1048576 any one file/);
  const quarter = Buffer.alloc(LIMITS.maxEntryBytes - 1, 0x42);
  const many = [1, 2, 3, 4, 5].map((n) => ({ name: `bin/part${n}.bin`, data: quarter }));
  refusesWith(wellFormed(many), /unpacks to more than the 4194304 bytes/);
  const crowd = Array.from({ length: LIMITS.maxEntries }, (_, n) => ({ name: `bin/f${n}.txt`, data: 'x' }));
  refusesWith(wellFormed(crowd), /more than the 50 a Kosmos build may have/);
});

test('the caps are required: no caller can unpack without naming them', () => {
  const buf = buildZip(wellFormed());
  assert.throws(() => win32zip.readZipDirectory(buf, {}), /allowedTopLevel is required/);
  assert.throws(() => win32zip.readZipDirectory(buf, { allowedTopLevel: ['app'] }), /maxEntries is required/);
});

test('a truncated archive is refused: the tail cut off, or bytes missing from the middle', () => {
  const buf = buildZip(wellFormed());
  assert.throws(() => win32zip.readZipDirectory(buf.subarray(0, buf.length - 10), LIMITS), /cut short/);
  assert.throws(() => win32zip.readZipDirectory(buf.subarray(0, Math.floor(buf.length / 2)), LIMITS), /cut short/);
  const holed = Buffer.concat([buf.subarray(0, 40), buf.subarray(50)]);
  assert.throws(() => win32zip.readZipDirectory(holed, LIMITS), win32zip.ZipRefusal);
  assert.throws(() => win32zip.readZipDirectory(Buffer.concat([buf, Buffer.from('appended')]), LIMITS), /something appended/);
});

test('a bad CRC is refused at extract, and that file is not written', () => {
  const dest = freshDest();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = buildZip(wellFormed([{ name: 'bin/damaged.txt', data: 'payload', method: 8, crc: 0x12345678 }]));
  assert.doesNotThrow(() => win32zip.readZipDirectory(buf, LIMITS), 'the CRC is a property of the bytes, checked as they are unpacked');
  assert.throws(() => win32zip.extractZip(buf, dest, LIMITS), /damaged \(its checksum does not match\)/);
  assert.equal(fs.existsSync(path.join(dest, 'bin', 'damaged.txt')), false);
  /* The same bad CRC on a stored entry. */
  const dest2 = freshDest();
  fs.mkdirSync(path.dirname(dest2), { recursive: true });
  assert.throws(() => win32zip.extractZip(buildZip(wellFormed([{ name: 'bin/d.txt', data: 'p', method: 0, crc: 1 }])), dest2, LIMITS), /checksum/);
});

test('a size that lies is refused, whichever way it lies', () => {
  for (const [declaredSize, pattern] of [[TEXT.length + 5, /different size than it declares/], [10, /could not be unpacked/]]) {
    const dest = freshDest();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = buildZip(wellFormed([{ name: 'bin/liar.txt', data: TEXT, method: 8, declaredSize }]));
    assert.throws(() => win32zip.extractZip(buf, dest, LIMITS), pattern);
  }
  refusesWith(wellFormed([{ name: 'bin/stored-liar.txt', data: 'abc', method: 0, declaredSize: 4 }]), /stored with two different sizes/);
});

test('a local header that disagrees with the table of contents is refused: name, flags, CRC or size', () => {
  refusesWith(wellFormed([{ name: 'bin/a.txt', localName: 'bin/b.txt', data: 'x' }]), /described two different ways/);
  refusesWith(wellFormed([{ name: 'bin/a.txt', data: 'x', local: { flags: 0x0001 } }]), /"bin\/a\.txt" is described two different ways/);
  refusesWith(wellFormed([{ name: 'bin/a.txt', data: 'x', local: { crc: 0xdeadbeef } }]), /described two different ways/);
  refusesWith(wellFormed([{ name: 'bin/a.txt', data: 'xyz', method: 0, local: { size: 99, compressedSize: 99 } }]), /described two different ways/);
  refusesWith(wellFormed([{ name: 'bin/a.txt', data: TEXT, method: 8, local: { compressedSize: 1 } }]), /described two different ways/);
});

test('CONTROL: with a data descriptor (bit 3) the local CRC and sizes are deferred, and the entry still unpacks', () => {
  const dest = freshDest();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = buildZip(wellFormed([{ name: 'bin/dd.txt', data: TEXT, method: 8, flags: 0x0008, local: { crc: 0, compressedSize: 0, size: 0 } }]));
  win32zip.extractZip(buf, dest, LIMITS);
  assert.equal(fs.readFileSync(path.join(dest, 'bin', 'dd.txt'), 'utf8'), TEXT);
});

test('overlapping entries are refused: one entry\'s data carries another entry\'s header', () => {
  const innerName = 'bin/inner.txt';
  const outerName = 'bin/outer.bin';
  const inner = buildZip([{ name: innerName, data: 'hidden', method: 0 }]);
  const innerRecord = inner.subarray(0, 30 + innerName.length + 'hidden'.length);
  refusesWith(wellFormed([
    { name: outerName, data: innerRecord, method: 0 },
    { name: innerName, data: 'hidden', method: 0, centralOffset: (at) => at[outerName] + 30 + outerName.length },
  ]), /the archive entries "bin\/outer\.bin" and "bin\/inner\.txt" overlap/);
});

test('zip64 markers are refused, in an entry and in the end record', () => {
  refusesWith(wellFormed([{ name: 'bin/huge.bin', data: 'x', method: 8, declaredSize: 0xffffffff }]), /"bin\/huge\.bin" uses zip64 records/);
  refusesWith(wellFormed([{ name: 'bin/far.bin', data: 'x', centralOffset: () => 0xffffffff }]), /"bin\/far\.bin" uses zip64 records/);
  refusesWith(wellFormed(), /^the archive uses zip64 records/, { eocd: { entryCount: 0xffff, entriesOnDisk: 0xffff } });
  refusesWith(wellFormed(), /^the archive uses zip64 records/, { eocd: { directoryOffset: 0xffffffff } });
  refusesWith(wellFormed(), /^the archive uses zip64 records/, { eocd: { directorySize: 0xffffffff } });
});

test('an archive split across several files is refused', () => {
  refusesWith(wellFormed(), /split across several files/, { eocd: { diskNumber: 1 } });
  refusesWith(wellFormed(), /split across several files/, { eocd: { directoryDisk: 2 } });
});

test('a folder entry with contents of its own is refused', () => {
  refusesWith(wellFormed([{ name: 'app/stuff/', data: 'x', method: 0 }]), /"app\/stuff\/" is a folder with contents of its own/);
});

test('a name that is not plain printable ASCII is refused, flagged as UTF-8 or not', () => {
  const eAcute = String.fromCharCode(0xe9);
  refusesWith(wellFormed([{ name: `app/caf${eAcute}.txt`, data: 'x', noUtf8Flag: true }]), /not plain ASCII and is not marked as UTF-8/);
  refusesWith(wellFormed([{ name: `app/caf${eAcute}.txt`, data: 'x' }]), /not plain printable ASCII/);
  refusesWith(wellFormed([{ name: `app/${String.fromCharCode(0x202e)}txt.exe`, data: 'x' }]), /not plain printable ASCII/);
  refusesWith(wellFormed([{ name: `app/x${String.fromCharCode(0x200b)}`, data: 'x' }]), /not plain printable ASCII/);
  /* NTFS folds the dotless i and the Kelvin sign to letters JavaScript's toLowerCase keeps apart. */
  refusesWith(wellFormed([{ name: `app/${String.fromCharCode(0x212a)}.txt`, data: 'x' }]), /not plain printable ASCII/);
});

test('Windows short names are refused, file or folder, so no alias can land on a long name', () => {
  refusesWith(wellFormed([{ name: 'app/averylongfilename.txt', data: 'long' }, { name: 'app/AVERYL~1.TXT', data: 'short' }]), /"app\/AVERYL~1\.TXT" looks like a Windows short name/);
  refusesWith(wellFormed([{ name: 'app/averylongdirname/a', data: '1' }, { name: 'app/AVERYL~1/b', data: '2' }]), /looks like a Windows short name/);
  refusesWith(wellFormed([{ name: 'bin/a~1', data: 'x' }]), /looks like a Windows short name/);
  /* The control: a tilde with no digit after it is an ordinary name. */
  assert.doesNotThrow(() => win32zip.readZipDirectory(buildZip(wellFormed([{ name: 'bin/a~b.txt', data: 'x' }])), LIMITS));
});

test('every Windows device name is refused, with an extension or spaces before it', () => {
  for (const segment of ['CONIN$', 'conout$.txt', 'CLOCK$', 'nul .txt', 'con .txt', 'COM1 .log', 'aux', 'LPT9.dat', 'prn.x.y']) {
    refusesWith(wellFormed([{ name: `app/${segment}`, data: 'x' }]), /reserves for a device/);
  }
  assert.throws(() => win32zip.readZipDirectory(buildZip(wellFormed([{ name: `app/COM${String.fromCharCode(0xb9)}`, data: 'x' }])), LIMITS), win32zip.ZipRefusal);
  /* The controls: names that merely start like one are ordinary. */
  assert.doesNotThrow(() => win32zip.readZipDirectory(buildZip(wellFormed([{ name: 'app/console.js', data: 'x' }, { name: 'app/connect.js', data: 'x' }])), LIMITS));
});
