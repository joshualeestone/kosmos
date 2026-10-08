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

/* Every reader swap goes through the tests-only hook; fingerprint() itself takes only a salt and a company. */
function withReader(t, run, opts) { cp._testRunner(run, opts); t.after(() => cp._testRunner()); }

test('#5532 v1.5: the print is HMAC-SHA256(salt, company:id); the raw id never appears in it; anything missing gives null', (t) => {
  withReader(t, () => SAMPLE, { platform: 'darwin' });
  const p = cp.fingerprint(SALT, ORG);
  assert.match(p, /^[0-9a-f]{64}$/);
  assert.equal(p.includes('0A1B2C3D'), false);
  assert.equal(p, require('node:crypto').createHmac('sha256', Buffer.from(SALT, 'hex')).update(ORG + ':0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9').digest('hex'));
  assert.equal(cp.fingerprint(SALT.toUpperCase(), ORG), p, 'the coordinator serving upper-case hex changed the print');
  // Review 3: one salt served to two companies must still give two prints, so a computer cannot be linked across them.
  assert.notEqual(cp.fingerprint(SALT, 'org_other_2'), p, 'a reused salt linked one computer across two companies');
  assert.notEqual(cp.fingerprint('cd'.repeat(16), ORG), p, 'two salts gave one print');
  assert.equal(cp.fingerprint('short', ORG), null, 'a malformed salt was used');
  assert.equal(cp.fingerprint('abc'.repeat(11), ORG), null, 'an odd-length salt was used');
  assert.equal(cp.fingerprint(SALT, ''), null, 'a print with no company');
  assert.equal(cp.fingerprint(SALT, 'org with spaces'), null);
  assert.equal(cp.fingerprint.length, 2, 'fingerprint() takes options again, so a caller could change how the hardware is read (review 4)');
});

test('#5532 v1.5: no hardware id, a failing ioreg, Windows and Linux all give null; another platform records no failure', (t) => {
  cp._testRunner(() => '', { platform: 'darwin' });
  assert.equal(cp.fingerprint(SALT, ORG), null, 'a print with no hardware id');
  cp._testRunner(() => { throw new Error('ioreg missing'); }, { platform: 'darwin' });
  assert.equal(cp.fingerprint(SALT, ORG), null);
  let reads = 0;
  cp._testRunner(() => { reads += 1; return SAMPLE; }, { platform: 'win32' });
  t.after(() => cp._testRunner());
  assert.equal(cp.fingerprint(SALT, ORG), null, 'Windows answers null until its owner builds MachineGuid');
  assert.equal(reads, 0, 'ioreg was run on Windows');
  cp._testRunner(() => SAMPLE, { platform: 'linux' });
  assert.equal(cp.fingerprint(SALT, ORG), null);
});

test('#5532 v1.5: on a Mac, this computer\'s real print exists and is stable (nothing about the id is printed)', { skip: process.platform !== 'darwin' }, (t) => {
  cp._testRunner();
  const a = cp.fingerprint(SALT, ORG);
  assert.ok(typeof a === 'string' && /^[0-9a-f]{64}$/.test(a), 'no print on this Mac (ioreg gave no IOPlatformUUID)');
  // Fresh reads, not the cache, and compared as a boolean so a failure can never print a value.
  const fresh = () => require('node:child_process').execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  cp._testRunner(fresh, { platform: 'darwin' });
  const b = cp.fingerprint(SALT, ORG);
  cp._testRunner(fresh, { platform: 'darwin' });
  const c = cp.fingerprint(SALT, ORG);
  t.after(() => cp._testRunner());
  assert.ok(a === b && b === c, 'the print changed between reads on one computer');
  assert.equal('hardwareId' in cp, false, 'the raw hardware id is exported, so any caller could log or send it');
});

test('#5532 v1.5: a read that fails is tried again after a minute, not at once and not never; a good read is kept', (t) => {
  let n = 0;
  const T = 1000000;
  withReader(t, () => { n += 1; if (n === 1) throw new Error('ioreg timed out'); return SAMPLE; }, { platform: 'darwin', now: T });
  assert.equal(cp.fingerprint(SALT, ORG), null);
  cp._testClock(T + 1000);
  assert.equal(cp.fingerprint(SALT, ORG), null, 'asked ioreg again at once after a failure');
  assert.equal(n, 1, 'a hung ioreg would block the board on every call (review 2)');
  cp._testClock(T + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.match(cp.fingerprint(SALT, ORG) || '', /^[0-9a-f]{64}$/, 'a failed read was remembered for the whole run');
  cp.fingerprint(SALT, ORG);
  assert.equal(n, 2, 'a successful read was not kept (read again)');
});

test('#5532 v1.5: no file but computerprint.js uses a known spelling of a raw hardware read, and nothing outside tests swaps its reader', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  // Needs git (it lists tracked files); outside a checkout it throws, and the count below keeps it from passing empty.
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
    if (/_testRunner|_testClock/.test(text) && !/\.test\.js$/.test(f)) swaps.push(f);
  }
  assert.deepEqual(hits, [], 'another file reads the raw hardware id: ' + hits.join(', '));
  assert.deepEqual(swaps, [], 'the test-only reader swap is called outside the tests: ' + swaps.join(', '));
});

test('#5532 v1.5 review 6: a failure at clock 0 still starts the wait', (t) => {
  let n = 0;
  withReader(t, () => { n += 1; throw new Error('ioreg timed out'); }, { platform: 'darwin', now: 0 });
  assert.equal(cp.fingerprint(SALT, ORG), null);
  cp._testClock(1000);
  assert.equal(cp.fingerprint(SALT, ORG), null);
  assert.equal(n, 1, 'a failure at clock 0 was not recorded, so ioreg was asked again at once');
});
