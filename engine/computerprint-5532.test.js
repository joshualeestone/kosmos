'use strict';
/**
 * kosmos#5532 (contract v1.5): the per-computer fingerprint. The parse runs on fixtures; one arm reads this computer's
 * real ioreg on macOS and checks only the SHAPE of the result, never printing or storing the id.
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
  assert.equal(cp.fingerprint(SALT, { platform: 'win32', run }), null, 'Windows answers null until the Windows owner builds MachineGuid');
  assert.equal(cp.fingerprint(SALT, { platform: 'linux', run }), null);
});

test('#5532 v1.5: on a Mac, this computer\'s real hardware id has the UUID shape (the value is never printed)', { skip: process.platform !== 'darwin' }, () => {
  const id = cp.hardwareId();
  assert.ok(id && cp.UUID.test(id), 'ioreg gave no IOPlatformUUID on this Mac');
  assert.equal(cp.hardwareId(), id, 'not stable within one run');
});
