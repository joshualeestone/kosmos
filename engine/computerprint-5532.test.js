'use strict';
/**
 * kosmos#5532 (contract v1.5): the per-computer fingerprint. The parses run on fixtures; one arm reads this computer's
 * real ioreg on macOS, one its real MachineGuid on Windows (run there by tools/windows-tests.js), and each compares
 * prints as booleans, never printing or storing the id or the print.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('./computerprint');

const SAMPLE = '+-o Mac  <class IOPlatformExpertDevice, id 0x1, registered>\n    {\n      "IOPlatformSerialNumber" = "XXXX"\n      "IOPlatformUUID" = "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9"\n    }\n';
/* What `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` prints on Windows 11 (CRLF, value made up). */
const REG = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n\r\n';
const GUID = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';
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

test('#5532 v1.5: no hardware id, a failing ioreg, ioreg text on Windows and Linux all give null; nothing is read on Linux', (t) => {
  t.after(() => cp._testRunner());
  cp._testRunner(() => '', { platform: 'darwin' });
  assert.equal(cp._testFingerprint(SALT, ORG), null, 'a print with no hardware id');
  cp._testRunner(() => { throw new Error('ioreg missing'); }, { platform: 'darwin' });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  cp._testRunner(() => SAMPLE, { platform: 'win32' });
  assert.equal(cp._testFingerprint(SALT, ORG), null, 'ioreg text was read as a MachineGuid on Windows');
  cp._testRunner(() => REG, { platform: 'darwin' });
  assert.equal(cp._testFingerprint(SALT, ORG), null, 'reg query text was read as an IOPlatformUUID on a Mac');
  let reads = 0;
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
    // engine/orgenroll-print-5532.test.js: the first caller's guards, whose fake ioreg text reaches the module only
    // through its tests-only _testRunner (no file there reads the hardware).
    .filter((f) => !/^engine\/(computerprint(-5532\.test)?|orgenroll-print-5532\.test)\.js$/.test(f))
    .filter((f) => /\.(js|mjs|cjs|sh|ps1|html|swift|m|mm|c|h|java|kt|py|yml|yaml|plist|gradle|json|xml)$/.test(f)
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
    + '. Only engine/computerprint.js may; add a reader there (the Windows MachineGuid arm lives there too).');
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
  cp._testRunner(() => SAMPLE, { platform: 'linux' });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' }, 'a platform with no reader would wait forever');
  // #5557 review: on Windows a missing or non-GUID MachineGuid is a failed read, so it defers like a failed ioreg.
  cp._testRunner(() => SAMPLE, { platform: 'win32', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'Windows sent print-less on one failed read');
  // Review 8: ioreg answers WITH its hardware block and no id (some VMs): a lasting 'none', not an endless wait.
  cp._testRunner(() => VM, { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'one block without an id (possibly a cut-off dump) was taken as lasting (review 12)');
  cp._testClock(5 + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' }, 'a computer with no hardware id would wait forever');
  // Review 19: a whole block whose id key holds something that is not a UUID is 'none' after two reads, not 'later'.
  const JUNK = '+-o VM <class IOPlatformExpertDevice>\n  {\n    "IOPlatformUUID" = ""\n  }\n';
  cp._testRunner(() => JUNK, { platform: 'darwin', now: 5 });
  cp.printFor(SALT, ORG);
  cp._testClock(5 + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' }, 'a junk id value held every enroll and leave for ten minutes');
  // Review 16: a block cut off before its closing brace, twice in a row, is still a failed read, never 'none'.
  const CUT = '+-o VM <class IOPlatformExpertDevice>\n  {\n    "model" = "VMw';
  const CUT_AFTER_BRACE = '+-o VM <class IOPlatformExpertDevice>\n  {\n    "a" = {\n    }\n    "model" = "VMw';
  cp._testRunner(() => CUT, { platform: 'darwin', now: 5 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' });
  cp._testClock(5 + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'a dump cut off the same way twice was taken as a lasting "no id"');
  // Review 17: a lone "}" line mid-dump, then a cut, is not a whole block.
  cp._testRunner(() => CUT_AFTER_BRACE, { platform: 'darwin', now: 5 });
  cp.printFor(SALT, ORG);
  cp._testClock(5 + cp.RETRY_AFTER_FAIL_MS + 1);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'a mid-dump closing brace read as the end of the block');
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


test('#5532 v1.5 review 15: nothing outside the tests loads computerprint until its first caller brings the two privacy guards', { skip: !require('node:fs').existsSync(require('node:path').join(__dirname, '..', '.git')) && 'needs a git checkout (it lists tracked files)' }, () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const files = require('node:child_process').execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter((f) => /\.(js|mjs|cjs)$/.test(f) && !/\.test\.js$/.test(f) && f !== 'engine/computerprint.js');
  assert.ok(files.includes('server.js'), 'the repo was not listed');
  /* The first caller adds itself here, in the same PR as a test that (1) its file never logs a printFor result, a print
     or a request body carrying one, and (2) it takes `company` from this board's own enrollment record, never from a
     coordinator's answer (see the header of engine/computerprint.js). The read is synchronous: wherever printFor runs, a
     read that hangs blocks the whole board for up to five seconds (fifteen on Windows, reg.exe then PowerShell), a
     timer or deferred task included (review 22). So
     the caller reads it at start, before the board listens, or accepts that block (at most once a minute while reads
     fail, once an hour after giving up), or makes the read asynchronous first. */
  // engine/orgenroll.js: its two guards are engine/orgenroll-print-5532.test.js (no logging; the record's company).
  const ALLOWED = ['engine/orgenroll.js'];
  // Any way of naming the module (review 19): require or import(), with or without a path or a .js/.cjs/.mjs suffix.
  const LOADS = /(require|import)\s*\(\s*['"`][^'"`]*computerprint(\.[cm]?js)?['"`]\s*\)|from\s+['"][^'"]*computerprint(\.[cm]?js)?['"]/;
  for (const spelling of ["require('./computerprint')", "require('./computerprint.js')", "require('../engine/computerprint.js')", "import('./computerprint')", "import x from './computerprint.mjs'"]) {
    assert.ok(LOADS.test(spelling), 'the loader guard misses: ' + spelling);
  }
  assert.equal(LOADS.test("require('./computerprint-5532.test.js')"), false, 'the loader guard catches the test file itself');
  const loaders = files.filter((f) => LOADS.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(loaders.filter((f) => !ALLOWED.includes(f)), [], 'loads computerprint without being allowed: add it to ALLOWED only together with its no-logging and company-source tests');
});

/* ---- Windows: MachineGuid through reg.exe, then PowerShell (the #5557 review: the shared retry rule, no raw-id export) */

test('#5532 Windows: the MachineGuid is read out of reg query text, upper-cased, and nothing else is', () => {
  assert.equal(cp.parseRegQuery(REG), GUID);
  assert.equal(cp.parseRegQuery(REG.replace(/\r\n/g, '\n')), GUID, 'LF-only output');
  assert.equal(cp.parseRegQuery(REG.replace('REG_SZ', 'REG_BINARY')), null, 'only a REG_SZ counts');
  assert.equal(cp.parseRegQuery(REG.replace('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', '{0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9}')), null, 'a braced GUID is not the shape');
  assert.equal(cp.parseRegQuery(REG.replace('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', 'not-a-guid')), null);
  assert.equal(cp.parseRegQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
  assert.equal(cp.parseRegQuery(''), null);
  assert.equal(cp.parsePsValue('  0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n'), GUID);
  assert.equal(cp.parsePsValue('{0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9}'), null);
  assert.equal(cp.parsePsValue('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'), null, 'two values are not one');
  assert.equal(cp.parsePsValue('Get-ItemPropertyValue : Property MachineGuid does not exist'), null);
  assert.equal(cp.parsePsValue(''), null);
});

test('#5532 Windows: the print is the same HMAC over the MachineGuid; no export reads or returns the raw id', (t) => {
  withReader(t, () => REG, { platform: 'win32' });
  const p = cp._testFingerprint(SALT, ORG);
  assert.equal(p, require('node:crypto').createHmac('sha256', Buffer.from(SALT, 'hex')).update(ORG + ':' + GUID).digest('hex'));
  assert.equal(p.includes('0A1B2C3D'), false);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'print', print: p });
  for (const name of ['hardwareId', 'readRegistry', 'readPowerShell', 'readMachineGuid', 'readIoreg', 'realRun']) {
    assert.equal(name in cp, false, name + ' is exported: it reads the hardware and hands back the raw id or text holding it');
  }
});

test('#5532 Windows: PowerShell is the fallback when reg.exe gives no GUID, and only then', (t) => {
  let psRuns = 0;
  const ps = () => { psRuns += 1; return '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n'; };
  const blocked = () => { throw new Error('Registry editing has been disabled by your administrator'); };
  const expected = require('node:crypto').createHmac('sha256', Buffer.from(SALT, 'hex')).update(ORG + ':' + GUID).digest('hex');
  withReader(t, blocked, { platform: 'win32', fallback: ps });
  assert.equal(cp._testFingerprint(SALT, ORG), expected, 'reg.exe refused and PowerShell was not asked');
  assert.equal(psRuns, 1);
  cp._testRunner(() => REG.replace('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', 'not-a-guid'), { platform: 'win32', fallback: ps });
  assert.equal(cp._testFingerprint(SALT, ORG), expected, 'a non-GUID reg.exe answer did not fall back');
  assert.equal(psRuns, 2);
  cp._testRunner(() => REG, { platform: 'win32', fallback: ps });
  assert.equal(cp._testFingerprint(SALT, ORG), expected);
  assert.equal(psRuns, 2, 'PowerShell ran although reg.exe answered');
  cp._testRunner(blocked, { platform: 'win32', fallback: () => { throw new Error('blocked too'); } });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
  cp._testRunner(blocked, { platform: 'win32', fallback: () => 'Get-ItemPropertyValue : Property MachineGuid does not exist' });
  assert.equal(cp._testFingerprint(SALT, ORG), null);
});

test('#5532 Windows: a failed read follows the shared rule: a minute, later for ten, then none, then a doubling wait', (t) => {
  let regRuns = 0;
  let psRuns = 0;
  let healthy = false;
  // A value present but not a GUID, from both reads: on Windows that is a failed read, never a lasting "no id here".
  const reg = () => { regRuns += 1; return healthy ? REG : REG.replace('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9', 'garbage'); };
  const ps = () => { psRuns += 1; return healthy ? GUID : 'garbage'; };
  withReader(t, reg, { platform: 'win32', fallback: ps, now: 0 });
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' });
  assert.ok(regRuns === 1 && psRuns === 1, 'one failed read should ask reg.exe, then PowerShell, once each');
  cp._testClock(cp.RETRY_AFTER_FAIL_MS - 1);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' });
  assert.equal(regRuns, 1, 'read again inside the minute: a hung reg.exe and PowerShell would block the board every call');
  cp._testClock(cp.RETRY_AFTER_FAIL_MS);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'later' }, 'two non-GUID answers were taken as lasting (only a Mac block can be)');
  assert.ok(regRuns === 2 && psRuns === 2, 'not retried after the minute');
  cp._testClock(cp.GIVE_UP_AFTER_MS - 1);
  assert.equal(cp.printFor(SALT, ORG).send, 'later', 'gave up before GIVE_UP_AFTER_MS');
  cp._testClock(cp.GIVE_UP_AFTER_MS);
  assert.deepEqual(cp.printFor(SALT, ORG), { send: 'none' }, 'a PC whose reads always fail would defer enroll and leave forever');
  const before = regRuns;
  for (let m = 1; m <= 60; m += 1) { cp._testClock(cp.GIVE_UP_AFTER_MS + m * 60 * 1000); cp.printFor(SALT, ORG); }
  assert.ok(regRuns - before <= 7, 'read ' + (regRuns - before) + ' times in the hour after giving up; expected a doubling wait');
  assert.ok(regRuns - before >= 1, 'stopped trying for good; a reader that recovers would never be noticed');
  // The reader comes back (a policy lifted): the next read after the wait gives a print, and it is kept.
  healthy = true;
  let printed = null;
  for (let m = 61; m <= 61 + 120 && !printed; m += 1) {
    cp._testClock(cp.GIVE_UP_AFTER_MS + m * 60 * 1000);
    const a = cp.printFor(SALT, ORG);
    if (a.send === 'print') printed = a.print;
  }
  assert.ok(printed, 'a reader that came back was not noticed within two hours');
  const runs = regRuns;
  cp.printFor(SALT, ORG);
  assert.equal(regRuns, runs, 'a successful read was not kept');
});

test('#5532 Windows: System32\'s reg.exe by full path, against the 64-bit registry view; PowerShell through Sysnative from 32-bit', () => {
  assert.deepEqual([...cp.REG_ARGS], ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
  assert.deepEqual([...cp.PS_ARGS], ['-NoProfile', '-NonInteractive', '-Command',
    "Get-ItemPropertyValue -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid"]);
  // Rewrites process-wide variables, restored in finally: safe because node:test runs this file's tests one at a time.
  const saved = { root: process.env.SystemRoot, wow: process.env.PROCESSOR_ARCHITEW6432 };
  const put = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    put('SystemRoot', 'D:\\Win');
    put('PROCESSOR_ARCHITEW6432', undefined);
    assert.equal(cp.regExe(), 'D:\\Win\\System32\\reg.exe', 'reg.exe was not taken from System32');
    assert.equal(cp.powershellExe('x64'), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(cp.powershellExe('ia32'), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '32-bit Windows has no Sysnative');
    put('PROCESSOR_ARCHITEW6432', 'AMD64');   // a 32-bit process on 64-bit Windows
    assert.equal(cp.powershellExe('ia32'), 'D:\\Win\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe', 'a 32-bit node would run the 32-bit PowerShell and read WOW6432Node');
    // A 64-bit process that inherited the variable, or an x64 one emulated on ARM64: Sysnative does not exist for it.
    assert.equal(cp.powershellExe('x64'), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'a 64-bit node would look for PowerShell in Sysnative and never find it');
    put('PROCESSOR_ARCHITEW6432', 'ARM64');
    assert.equal(cp.powershellExe('x64'), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(cp.powershellExe('arm64'), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  } finally { put('SystemRoot', saved.root); put('PROCESSOR_ARCHITEW6432', saved.wow); }
});

test('#5532 Windows: this PC\'s real print exists, is stable, and PowerShell reads the same value (nothing about the id is printed)', { skip: process.platform !== 'win32' }, (t) => {
  t.after(() => cp._testRunner());
  // Every comparison is a boolean, so a failure can never print a value (the #5557 review).
  const fs = require('node:fs');
  assert.ok(fs.existsSync(cp.regExe()), 'the reg.exe path production runs does not exist on this PC');
  assert.ok(fs.existsSync(cp.powershellExe()), 'the PowerShell path production runs does not exist on this PC');
  cp._testRunner();   // production's reader: reg.exe, then PowerShell
  const a = cp._testFingerprint(SALT, ORG);
  assert.ok(typeof a === 'string' && /^[0-9a-f]{64}$/.test(a), 'no print on this PC (neither reg.exe nor PowerShell gave a MachineGuid)');
  cp._testRunner();   // a fresh read, not the cache
  const b = cp.printFor(SALT, ORG);
  assert.ok(b.send === 'print' && b.print === a, 'the print changed between two fresh reads on one PC');
  // Production's PowerShell read, for real, as on a PC whose policy blocks reg.exe: it must give the same print.
  cp._testRunner(() => { throw new Error('Registry editing has been disabled by your administrator'); }, { platform: 'win32', fallback: 'real' });
  const c = cp._testFingerprint(SALT, ORG);
  assert.ok(c === a, 'the PowerShell fallback read a different value, or none');
});
