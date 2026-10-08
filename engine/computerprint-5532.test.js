'use strict';
/**
 * kosmos#5532 (contract v1.5): the per-computer fingerprint. The parses run on fixtures; one arm reads this computer's
 * real ioreg on macOS, one its real MachineGuid on Windows (run there via tools/windows-tests.js ALSO), and each checks
 * only the SHAPE of the result, never printing or storing the id (assert.ok, so a failure prints no value either).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('./computerprint');

const SAMPLE = '+-o Mac  <class IOPlatformExpertDevice, id 0x1, registered>\n    {\n      "IOPlatformSerialNumber" = "XXXX"\n      "IOPlatformUUID" = "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9"\n    }\n';
const SALT = 'ab'.repeat(16);

test('#5532 v1.5: the IOPlatformUUID is read out of ioreg text, and nothing else is', () => {
  assert.equal(cp.parseIoreg(SAMPLE), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9');
  assert.equal(cp.parseIoreg('"IOPlatformSerialNumber" = "C02XYZ"'), null, 'a serial number is not the UUID');
  assert.equal(cp.parseIoreg('"IOPlatformUUID" = "not-a-uuid /Users/me"'), null);
  assert.equal(cp.parseIoreg(''), null);
});

test('#5532 v1.5: the print is sha256(salt:id); the raw id never appears in it; a bad salt or no id gives null', () => {
  const run = () => SAMPLE;
  const p = cp.fingerprint(SALT, { platform: 'darwin', run });
  assert.match(p, /^[0-9a-f]{64}$/);
  assert.equal(p.includes('0A1B2C3D'), false);
  assert.equal(p, require('node:crypto').createHash('sha256').update(SALT + ':0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9').digest('hex'));
  assert.notEqual(cp.fingerprint('cd'.repeat(16), { platform: 'darwin', run }), p, 'two accounts\' salts gave one print, so prints could be matched across accounts');
  assert.equal(cp.fingerprint('short', { platform: 'darwin', run }), null, 'a malformed salt was used');
  assert.equal(cp.fingerprint(SALT, { platform: 'darwin', run: () => '' }), null, 'a print with no hardware id');
  assert.equal(cp.fingerprint(SALT, { platform: 'darwin', run: () => { throw new Error('ioreg missing'); } }), null);
  assert.equal(cp.fingerprint(SALT, { platform: 'win32', run }), null, 'ioreg text was read as a MachineGuid on Windows');
  assert.equal(cp.fingerprint(SALT, { platform: 'linux', run }), null);
});

/* What `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` prints on Windows 11 (CRLF, value made up). */
const REG = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n\r\n';

test('#5532 v1.5: the MachineGuid is read out of reg query text, upper-cased, and nothing else is', () => {
  assert.equal(cp.parseRegQuery(REG), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9');
  assert.equal(cp.parseRegQuery(REG.replace(/\r\n/g, '\n')), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9', 'LF-only output');
  assert.equal(cp.parseRegQuery(REG.replace('REG_SZ', 'REG_BINARY')), null, 'only a REG_SZ counts');
  assert.equal(cp.parseRegQuery(REG.replace('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', '{0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9}')), null, 'a braced GUID is not the shape');
  assert.equal(cp.parseRegQuery(REG.replace('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', 'not-a-guid')), null);
  assert.equal(cp.parseRegQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
  assert.equal(cp.parseRegQuery(''), null);
});

test('#5532 v1.5: on Windows the print is sha256(salt:MachineGuid); a failed read gives null', () => {
  const run = () => REG;
  const p = cp.fingerprint(SALT, { platform: 'win32', run });
  assert.equal(p, require('node:crypto').createHash('sha256').update(SALT + ':0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9').digest('hex'));
  assert.equal(p.includes('0A1B2C3D'), false);
  assert.equal(cp.fingerprint(SALT, { platform: 'darwin', run }), null, 'reg text was read as an IOPlatformUUID on a Mac');
  assert.equal(cp.fingerprint(SALT, { platform: 'win32', run: () => { throw new Error('reg timed out'); } }), null);
});

test('#5532 v1.5: on Windows, this computer\'s real MachineGuid has the GUID shape (the value is never printed)', { skip: process.platform !== 'win32' }, () => {
  const id = cp.hardwareId();
  assert.ok(id && cp.UUID.test(id), 'reg query gave no MachineGuid on this PC');
  assert.ok(id === id.toUpperCase(), 'the MachineGuid was not upper-cased');
  // Two fresh registry reads (a stubbed run that calls the real reg.exe bypasses the cache), so this is real stability.
  const read = () => require('node:child_process').execFileSync(cp.regExe(), cp.REG_ARGS, { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  assert.ok(cp.hardwareId({ platform: 'win32', run: read }) === id, 'a fresh read differs from the first');
  assert.ok(cp.hardwareId({ platform: 'win32', run: read }) === id, 'two fresh reads differ');
});

test('#5532 v1.5: a successful read is kept for the run, a failed one is not (a timeout at logon must not stick)', () => {
  const fail = () => { throw new Error('reg timed out'); };
  cp._resetCache();
  try {
    assert.equal(cp.hardwareId({ platform: 'win32', run: fail, useCache: true }), null);
    assert.equal(cp.hardwareId({ platform: 'win32', run: () => REG, useCache: true }), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9', 'a failed read was kept, so a later good one was never tried');
    assert.equal(cp.hardwareId({ platform: 'win32', run: fail, useCache: true }), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9', 'a good read was not kept');
    assert.equal(cp.hardwareId({ platform: 'win32', run: fail }), null, 'a stubbed run without useCache read the cache');
  } finally { cp._resetCache(); }
});

test('#5532 v1.5: Windows runs System32\'s reg.exe by full path, against the 64-bit registry view', () => {
  assert.deepEqual([...cp.REG_ARGS], ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
  const saved = process.env.SystemRoot;
  try {
    process.env.SystemRoot = 'D:\\Win';
    assert.equal(cp.regExe(), 'D:\\Win\\System32\\reg.exe', 'reg.exe was not taken from System32');
  } finally { if (saved === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = saved; }
});

test('#5532 v1.5: on a Mac, this computer\'s real hardware id has the UUID shape (the value is never printed)', { skip: process.platform !== 'darwin' }, () => {
  const id = cp.hardwareId();
  assert.ok(id && cp.UUID.test(id), 'ioreg gave no IOPlatformUUID on this Mac');
  assert.equal(cp.hardwareId(), id, 'not stable within one run');
});
