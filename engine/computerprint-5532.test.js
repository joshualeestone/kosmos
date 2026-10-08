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
function withReader(t, run, opts) { t.after(() => cp._testRunner()); cp._testRunner(run, opts); }

test('#5532 v1.5: the print is HMAC-SHA256(salt, company:id); the raw id never appears in it; anything missing gives null', (t) => {
  withReader(t, () => SAMPLE, { platform: 'darwin' });
  const p = cp._testFingerprint(SALT, ORG);
  assert.match(p, /^[0-9a-f]{64}$/);
  assert.equal(p.includes('0A1B2C3D'), false);
  assert.equal(p, require('node:crypto').createHmac('sha256', Buffer.from(SALT, 'hex')).update(ORG + ':0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9').digest('hex'));
  // Pins Node's own behaviour (review 13): hex decoding reads either case alike, so a coordinator's case cannot change it.
  assert.equal(cp._testFingerprint(SALT.toUpperCase(), ORG), p, 'the coordinator serving upper-case hex changed the print');
  // Review 3: one salt served to two companies must still give two prints, so a computer cannot be linked across them.
  assert.notEqual(cp._testFingerprint(SALT, 'org_other_2'), p, 'a reused salt linked one computer across two companies');
  assert.notEqual(cp._testFingerprint('cd'.repeat(16), ORG), p, 'two salts gave one print');
  assert.equal(cp._testFingerprint('short', ORG), null, 'a malformed salt was used');
  assert.equal(cp._testFingerprint('abc'.repeat(11), ORG), null, 'an odd-length salt was used');
  assert.equal(cp._testFingerprint(SALT, ''), null, 'a print with no company');
  assert.equal(cp._testFingerprint(SALT, 'org with spaces'), null);
  assert.equal(cp._testFingerprint.length, 2, 'fingerprint() takes options again, so a caller could change how the hardware is read (review 4)');
  assert.equal('fingerprint' in cp, false, 'the bare print function is exported; callers must use printFor (review 11)');
});

test('#5532 v1.5: no hardware id, a failing ioreg, Windows and Linux all give null; ioreg is never run off a Mac', (t) => {
  t.after(() => cp._testRunner());
  cp._testRunner(() => '', { platform: 'darwin' });
  assert.equal(cp._testFingerprint(SALT, ORG), null, 'a print with no hardware id');
  cp._testRunner(() => { throw new Error('ioreg missing'); }, { platform: 'darwin' });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  let reads = 0;
  cp._testRunner(() => { reads += 1; return SAMPLE; }, { platform: 'win32' });
  assert.equal(cp._testFingerprint(SALT, ORG), null, 'Windows answers null until its owner builds MachineGuid');
  assert.equal(reads, 0, 'ioreg was run on Windows');
  cp._testRunner(() => { reads += 1; return SAMPLE; }, { platform: 'linux' });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  assert.equal(reads, 0, 'ioreg was run on Linux');
});

test('#5532 v1.5: on a Mac, this computer\'s real print exists and is stable (nothing about the id is printed)', { skip: process.platform !== 'darwin' }, (t) => {
  t.after(() => cp._testRunner());
  cp._testRunner();
  const a = cp._testFingerprint(SALT, ORG);
  assert.ok(typeof a === 'string' && /^[0-9a-f]{64}$/.test(a), 'no print on this computer (ioreg gave no IOPlatformUUID)');
  // Fresh reads, not the cache, and compared as a boolean so a failure can never print a value.
  const fresh = () => require('node:child_process').execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  cp._testRunner(fresh, { platform: 'darwin' });
  const b = cp._testFingerprint(SALT, ORG);
  cp._testRunner(fresh, { platform: 'darwin' });
  const c = cp._testFingerprint(SALT, ORG);
  assert.ok(a === b && b === c, 'the print changed between reads on one computer');
  assert.equal('hardwareId' in cp, false, 'the raw hardware id is exported, so any caller could log or send it');
});

test('#5532 v1.5: a read that fails is tried again after a minute, not at once and not never; a good read is kept', (t) => {
  let n = 0;
  const T = 1000000;
  withReader(t, () => { n += 1; if (n === 1) throw new Error('ioreg timed out'); return SAMPLE; }, { platform: 'darwin', now: T });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  cp._testClock(T + 1000);
  assert.equal(cp._testFingerprint(SALT, ORG), null, 'asked ioreg again at once after a failure');
  assert.equal(n, 1, 'a hung ioreg would block the board on every call (review 2)');
  cp._testClock(T + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.match(cp._testFingerprint(SALT, ORG) || '', /^[0-9a-f]{64}$/, 'a failed read was remembered for the whole run');
  cp._testFingerprint(SALT, ORG);
  assert.equal(n, 2, 'a successful read was not kept (read again)');
});

test('#5532 v1.5: no file but computerprint.js uses a known spelling of a raw hardware read, and nothing outside tests swaps its reader', { skip: !require('node:fs').existsSync(require('node:path').join(__dirname, '..', '.git')) && 'needs a git checkout (it lists tracked files)' }, () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  // Needs git (it lists tracked files); outside a checkout it throws, and the count below keeps it from passing empty.
  const files = require('node:child_process').execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter((f) => !/^engine\/computerprint(-5532\.test)?\.js$/.test(f))
    .filter((f) => /\.(js|mjs|cjs|sh|ps1|html|swift|m|mm|c|h|java|kt|py|yml|yaml|plist|gradle)$/.test(f)
      // and extensionless scripts, found by their first line (install/kosmos, install/pkg-scripts/postinstall; review 15)
      || (!/\.[^/]+$/.test(f) && (() => { try { return /^#!/.test(fs.readFileSync(path.join(root, f), 'utf8').slice(0, 2)); } catch { return false; } })()));
  assert.ok(files.includes('server.js') && files.includes('engine/store.js') && files.includes('install/kosmos'), 'the repo was not listed, or extensionless scripts were skipped (' + files.length + ' files)');
  /* The spellings covered (review 3 listed the ones an earlier version missed): ioreg's keys, system_profiler's hardware
     page, sysctl's kern.uuid, WMI's computer-system product, Linux's machine-id, and the Windows registry key, whole or
     split into arguments. A read by another spelling is not caught: this is a guard on the known ways, not a proof. */
  const READ = /IOPlatformUUID|IOPlatformExpertDevice|IOPlatformSerialNumber|MachineGuid|Microsoft\\+Cryptography|SPHardwareDataType|Hardware UUID:|kern\.uuid|Win32_ComputerSystemProduct|wmic\s+csproduct|\/etc\/machine-id|['"\/]ioreg['"]|\bioreg\s+-[a-zA-Z]|parseIoreg\s*\(|gethostuuid\s*\(|IORegistryEntryCreateCFProperty\s*\(|kIOPlatformUUIDKey|\.identifierForVendor\b|Secure\.ANDROID_ID|['"]Cryptography['"]/;
  const hits = [];
  const swaps = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (READ.test(text)) hits.push(f);
    if (/_testRunner|_testClock|_testFingerprint/.test(text) && !/\.test\.js$/.test(f)) swaps.push(f);
  }
  assert.deepEqual(hits, [], 'another file reads (or names a way to read) the raw hardware id: ' + hits.join(', ')
    + '. Only engine/computerprint.js may; add a reader there (the Windows MachineGuid arm belongs there too).');
  assert.deepEqual(swaps, [], 'the test-only reader swap is called outside the tests: ' + swaps.join(', '));
});

test('#5532 v1.5 review 6: a failure at clock 0 still starts the wait', (t) => {
  let n = 0;
  withReader(t, () => { n += 1; throw new Error('ioreg timed out'); }, { platform: 'darwin', now: 0 });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  cp._testClock(1000);
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  assert.equal(n, 1, 'a failure at clock 0 was not recorded, so ioreg was asked again at once');
});

test('#5532 v1.5 reviews 7 to 9: printFor gives ONE answer: send the print, send none, or later', (t) => {
  t.after(() => cp._testRunner());
  const VM = '+-o VM <class IOPlatformExpertDevice>\n  {\n    "model" = "VMware"\n  }\n';
  cp._testRunner(() => SAMPLE, { platform: 'darwin' });
  const ok = cp.printFor(SALT, ORG);
  assert.equal(ok.send, 'print'); assert.equal(ok.print, cp._testFingerprint(SALT, ORG));
  // Review 9: 'ok' is only ever said WITH a print, so a bad salt or company defers rather than sending none.
  // Review 10: a malformed salt or company is an error to say, never a silent wait forever and never a print-less send.
  assert.equal(cp.printFor('bad', ORG).send, 'error', 'a malformed salt would wait forever, or send a print-less request read as a copy');
  cp._testRunner(() => SAMPLE, { platform: 'win32' });
  assert.equal(cp.printFor('bad', ORG).send, 'error', 'a malformed salt was an error on a Mac and silent off one (review 11)');
  cp._testRunner(() => SAMPLE, { platform: 'darwin' });
  assert.equal(cp.printFor(SALT, 'no spaces allowed').send, 'error');
  assert.equal(/[0-9A-F]{8}-|[0-9a-f]{64}/.test(JSON.stringify(cp.printFor('bad', ORG))), false, 'an error carried an id or a print');
  cp._testRunner(() => { throw new Error('ioreg timed out'); }, { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'a failed read on the real computer must defer, not send print-less');
  cp._testRunner(() => SAMPLE, { platform: 'win32' });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' });
  // Review 8: ioreg answers WITH its hardware block and no id (some VMs): a lasting 'none', not an endless wait.
  cp._testRunner(() => VM, { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'one block without an id (possibly a cut-off dump) was taken as lasting (review 12)');
  cp._testClock(5 + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' }, 'a computer with no hardware id would wait forever');
  // A cut-off dump followed by a good one is a computer WITH an id: the streak resets.
  let k = 0;
  cp._testRunner(() => (k++ === 0 ? VM : SAMPLE), { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' });
  cp._testClock(5 + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.equal(cp.printFor(SALT, ORG).send, 'print');
  // Review 9: a truncated or garbled answer is a failed read to retry, never 'none'.
  cp._testRunner(() => 'garbage, cut off', { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'one odd ioreg answer would flag a pinned computer as a copy');
  // Review 10: a mention of the class inside a value is not the block's header line.
  cp._testRunner(() => '  "note" = "see <class IOPlatformExpertDevice> docs"\n', { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'a quoted mention read as the hardware block');
});

test('#5532 v1.5 reviews 9 and 15: an ioreg that always fails stops deferring after GIVE_UP_AFTER_MS on the clock, then backs off', (t) => {
  let n = 0;
  withReader(t, () => { n += 1; throw new Error('ioreg missing'); }, { platform: 'darwin', now: 0 });
  assert.equal(cp.printFor(SALT, ORG).send, 'later');
  // Review 15: the give-up is time, not how often a caller asks. One retry only, long after: still gives up.
  cp._testClock(cp.GIVE_UP_AFTER_MS - 1);
  assert.equal(cp.printFor(SALT, ORG).send, 'later', 'gave up before GIVE_UP_AFTER_MS');
  cp._testClock(cp.GIVE_UP_AFTER_MS);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' }, 'a Mac whose ioreg always fails would defer enroll and leave forever');
  // Backoff after giving up: the next reads come further apart, so a hung ioreg cannot stall the board every minute.
  const before = n;
  for (let m = 1; m <= 60; m += 1) { cp._testClock(cp.GIVE_UP_AFTER_MS + m * 60 * 1000); cp.printFor(SALT, ORG); }
  assert.ok(n - before <= 7, 'read ' + (n - before) + ' times in the hour after giving up; expected a doubling wait');
  assert.ok(n - before >= 1, 'stopped trying for good; a reader that recovers would never be noticed');
});


test('#5532 v1.5 review 15: nothing outside the tests loads computerprint until its first caller brings the two privacy guards', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const files = require('node:child_process').execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter((f) => /\.(js|mjs|cjs)$/.test(f) && !/\.test\.js$/.test(f) && f !== 'engine/computerprint.js');
  assert.ok(files.includes('server.js'), 'the repo was not listed');
  /* The first caller adds itself here, in the same PR as a test that (1) its file never logs a printFor result, a print
     or a request body carrying one, and (2) it takes `company` from this board's own enrollment record, never from a
     coordinator's answer (see the header of engine/computerprint.js). */
  const ALLOWED = [];
  const loaders = files.filter((f) => /require\(\s*['"][^'"]*computerprint['"]\s*\)|from\s+['"][^'"]*computerprint['"]/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(loaders.filter((f) => !ALLOWED.includes(f)), [], 'loads computerprint without being allowed: add it to ALLOWED only together with its no-logging and company-source tests');
});
