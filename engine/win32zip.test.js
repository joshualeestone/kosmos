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

test('a local header that disagrees with the table of contents is refused', () => {
  refusesWith(wellFormed([{ name: 'bin/a.txt', localName: 'bin/b.txt', data: 'x' }]), /described two different ways/);
});
