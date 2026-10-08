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
const ORG = 'org_acme_1';

test('#5532 v1.5: the IOPlatformUUID is read out of ioreg text, and nothing else is', () => {
  assert.equal(cp.parseIoreg(SAMPLE), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9');
  assert.equal(cp.parseIoreg('"IOPlatformSerialNumber" = "C02XYZ"'), null, 'a serial number is not the UUID');
  assert.equal(cp.parseIoreg('"IOPlatformUUID" = "not a uuid at all"'), null);
  assert.equal(cp.parseIoreg(''), null);
});

test('#5532 v1.5: the print is sha256(salt:id); the raw id never appears in it; a bad salt or no id gives null', () => {
  const run = () => SAMPLE;
  const p = cp.fingerprint(SALT, ORG, { platform: 'darwin', run });
  assert.match(p, /^[0-9a-f]{64}$/);
  assert.equal(p.includes('0A1B2C3D'), false);
  assert.equal(p, require('node:crypto').createHash('sha256').update(SALT + ':' + ORG + ':0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9').digest('hex'));
  // Review 3: one salt served to two companies must still give two prints, so a computer cannot be linked across them.
  assert.notEqual(cp.fingerprint(SALT, 'org_other_2', { platform: 'darwin', run }), p, 'a reused salt linked one computer across two companies');
  assert.equal(cp.fingerprint(SALT, '', { platform: 'darwin', run }), null, 'a print with no company');
  assert.equal(cp.fingerprint(SALT, 'org with spaces', { platform: 'darwin', run }), null);
  assert.notEqual(cp.fingerprint('cd'.repeat(16), ORG, { platform: 'darwin', run }), p, 'two accounts\' salts gave one print, so prints could be matched across accounts');
  assert.equal(cp.fingerprint('short', ORG, { platform: 'darwin', run }), null, 'a malformed salt was used');
  assert.equal(cp.fingerprint(SALT, ORG, { platform: 'darwin', run: () => '' }), null, 'a print with no hardware id');
  assert.equal(cp.fingerprint(SALT, ORG, { platform: 'darwin', run: () => { throw new Error('ioreg missing'); } }), null);
  assert.equal(cp.fingerprint(SALT, ORG, { platform: 'win32', run }), null, 'Windows answers null until the Windows owner builds MachineGuid');
  assert.equal(cp.fingerprint(SALT, ORG, { platform: 'linux', run }), null);
});

test('#5532 v1.5: on a Mac, this computer\'s real print exists and is stable (nothing about the id is printed)', { skip: process.platform !== 'darwin' }, () => {
  const a = cp.fingerprint(SALT, ORG);
  assert.ok(typeof a === 'string' && /^[0-9a-f]{64}$/.test(a), 'no print on this Mac (ioreg gave no IOPlatformUUID)');
  // Fresh reads, not the cache, and compared as a boolean so a failure can never print a value.
  const fresh = () => require('node:child_process').execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const b = cp.fingerprint(SALT, ORG, { platform: 'darwin', run: fresh });
  const c = cp.fingerprint(SALT, ORG, { platform: 'darwin', run: fresh });
  assert.ok(a === b && b === c, 'the print changed between reads on one computer');
  assert.equal('hardwareId' in cp, false, 'the raw hardware id is exported, so any caller could log or send it');
});

test('#5532 v1.5: a read that fails is tried again, not remembered as "no print" for the whole run', { skip: process.platform !== 'darwin' }, (t) => {
  let n = 0;
  cp._testRunner(() => { n += 1; if (n === 1) throw new Error('ioreg timed out'); return SAMPLE; });   // the UNSEAMED path, with its cache
  t.after(() => cp._testRunner(null));
  const T = 1000000;
  assert.equal(cp.fingerprint(SALT, ORG, { now: T }), null);
  assert.equal(cp.fingerprint(SALT, ORG, { now: T + 1000 }), null, 'asked ioreg again at once after a failure');
  assert.equal(n, 1, 'a hung ioreg would block the board on every call (review 2)');
  assert.match(cp.fingerprint(SALT, ORG, { now: T + cp.RETRY_AFTER_FAIL_MS + 1 }) || '', /^[0-9a-f]{64}$/, 'a failed read was remembered for the whole run');
  cp.fingerprint(SALT, ORG, { now: T + cp.RETRY_AFTER_FAIL_MS + 2 });
  assert.equal(n, 2, 'a successful read was not kept (read again)');
});

test('#5532 v1.5: no file but computerprint.js uses a known spelling of a raw hardware read, and nothing outside tests swaps its reader', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const files = require('node:child_process').execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter((f) => /\.(js|mjs|cjs|sh|ps1|html)$/.test(f) && !/^engine\/computerprint(-5532\.test)?\.js$/.test(f));
  assert.ok(files.length > 300, 'the repo was not listed (' + files.length + ' files)');
  /* The spellings covered (review 3 listed the ones an earlier version missed): ioreg's keys, system_profiler's hardware
     page, sysctl's kern.uuid, WMI's computer-system product, Linux's machine-id, and the Windows registry key, whole or
     split into arguments. A read by another spelling is not caught: this is a guard on the known ways, not a proof. */
  const READ = /IOPlatformUUID|IOPlatformExpertDevice|IOPlatformSerialNumber|MachineGuid|Microsoft\\+Cryptography|SPHardwareDataType|Hardware UUID|kern\.uuid|Win32_ComputerSystemProduct|csproduct|machine-id|['"]Cryptography['"]/;
  const hits = [];
  const swaps = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (READ.test(text)) hits.push(f);
    if (text.includes('_testRunner') && !/\.test\.js$/.test(f)) swaps.push(f);
  }
  assert.deepEqual(hits, [], 'another file reads the raw hardware id: ' + hits.join(', '));
  assert.deepEqual(swaps, [], 'the test-only reader swap is called outside the tests: ' + swaps.join(', '));
});
