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
  assert.equal(cp.parseIoreg('"IOPlatformUUID" = "not a uuid at all"'), null);
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

test('#5532 v1.5: on a Mac, this computer\'s real print exists and is stable (nothing about the id is printed)', { skip: process.platform !== 'darwin' }, () => {
  const a = cp.fingerprint(SALT);
  assert.ok(typeof a === 'string' && /^[0-9a-f]{64}$/.test(a), 'no print on this Mac (ioreg gave no IOPlatformUUID)');
  // Fresh reads, not the cache, and compared as a boolean so a failure can never print a value.
  const fresh = () => require('node:child_process').execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
  const b = cp.fingerprint(SALT, { platform: 'darwin', run: fresh });
  const c = cp.fingerprint(SALT, { platform: 'darwin', run: fresh });
  assert.ok(a === b && b === c, 'the print changed between reads on one computer');
  assert.equal('hardwareId' in cp, false, 'the raw hardware id is exported, so any caller could log or send it');
});

test('#5532 v1.5: a read that fails is tried again, not remembered as "no print" for the whole run', { skip: process.platform !== 'darwin' }, (t) => {
  let n = 0;
  cp._testRunner(() => { n += 1; if (n === 1) throw new Error('ioreg timed out'); return SAMPLE; });   // the UNSEAMED path, with its cache
  t.after(() => cp._testRunner(null));
  assert.equal(cp.fingerprint(SALT), null);
  assert.match(cp.fingerprint(SALT) || '', /^[0-9a-f]{64}$/, 'a failed read was remembered for the whole run');
  cp.fingerprint(SALT);
  assert.equal(n, 2, 'a successful read was not kept (read again)');
});

test('#5532 v1.5: no engine file but computerprint.js reads the raw hardware id', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'computerprint.js');
  assert.ok(files.length > 50, 'the engine folder was not read (' + files.length + ' files)');
  const hits = files.filter((f) => /IOPlatformUUID|MachineGuid/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(hits, [], 'another engine file reads the raw hardware id: ' + hits.join(', '));
});
