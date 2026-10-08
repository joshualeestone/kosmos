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
  // Two fresh reads through production's own reader (a stubbed run bypasses the cache), so this is real stability.
  assert.ok(cp.hardwareId({ platform: 'win32', run: cp.readRegistry }) === id, 'a fresh read differs from the first');
  assert.ok(cp.hardwareId({ platform: 'win32', run: cp.readRegistry }) === id, 'two fresh reads differ');
  // Production's PowerShell fallback, for real, as on a PC whose policy blocks reg.exe: it must read the same value.
  const blocked = () => { throw new Error('Registry editing has been disabled by your administrator'); };
  assert.ok(cp.hardwareId({ platform: 'win32', run: blocked, runFallback: cp.readPowerShell }) === id, 'the PowerShell fallback read a different value, or none');
});

test('#5532 v1.5: on Windows, PowerShell is the fallback when reg.exe refuses, and only then', () => {
  const blocked = () => { throw new Error('Registry editing has been disabled by your administrator'); };
  let psRuns = 0;
  const ps = () => { psRuns += 1; return '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n'; };
  assert.equal(cp.hardwareId({ platform: 'win32', run: blocked, runFallback: ps }), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9');
  assert.equal(psRuns, 1);
  assert.equal(cp.hardwareId({ platform: 'win32', run: () => REG, runFallback: ps }), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9');
  assert.equal(psRuns, 1, 'PowerShell ran although reg.exe answered');
  assert.equal(cp.hardwareId({ platform: 'win32', run: blocked, runFallback: () => { throw new Error('blocked too'); } }), null);
  assert.equal(cp.hardwareId({ platform: 'win32', run: blocked, runFallback: () => 'Get-ItemPropertyValue : Property MachineGuid does not exist' }), null);
  assert.equal(cp.parsePsValue('  0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\n'), '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9');
  assert.equal(cp.parsePsValue('{0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9}'), null);
  assert.equal(cp.parsePsValue('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9\r\n0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'), null, 'two values are not one');
  assert.equal(cp.parsePsValue(''), null);
});

test('#5532 v1.5: a successful read is kept for the run; a failed one is retried after a growing wait, then not at all', () => {
  const [w1, w2, w3] = cp.RETRY_AFTER_MS;
  assert.ok(cp.RETRY_AFTER_MS.length === 3 && w1 < w2 && w2 < w3, 'the waits grow');
  let runs = 0;
  const fail = () => { runs += 1; throw new Error('reg timed out'); };
  const good = () => { runs += 1; return REG; };
  const at = (now, run) => cp.hardwareId({ platform: 'win32', run, useCache: true, now });
  const GUID = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';
  cp._resetCache();
  try {
    // A transient failure: inside the first wait nothing is spawned; after it, a good read is found and kept.
    assert.equal(at(0, fail), null);
    assert.equal(at(w1 - 1, good), null, 'a failed read was retried at once');
    assert.equal(runs, 1, 'it spawned a read inside the retry window');
    assert.equal(at(w1, good), GUID, 'a failed read was kept for good');
    assert.equal(at(w1 + 10 * w3, fail), GUID, 'a good read was not kept');
    assert.equal(cp.hardwareId({ platform: 'win32', run: fail }), null, 'a stubbed run without useCache read the cache');

    // A PC that blocks the read for good: tried after each wait, then never again this run.
    cp._resetCache();
    runs = 0;
    let t = 0;
    assert.equal(at(t, fail), null);
    assert.equal(at(t + w1 - 1, fail), null); assert.equal(runs, 1, 'retried inside the first wait');
    t += w1; assert.equal(at(t, fail), null); assert.equal(runs, 2);
    assert.equal(at(t + w2 - 1, fail), null); assert.equal(runs, 2, 'retried inside the second wait');
    t += w2; assert.equal(at(t, fail), null); assert.equal(runs, 3);
    t += w3; assert.equal(at(t, fail), null); assert.equal(runs, 4);
    assert.equal(at(t + 100 * w3, good), null, 'it kept spawning after the last wait');
    assert.equal(runs, 4, 'it kept spawning after the last wait');
  } finally { cp._resetCache(); }
});

test('#5532 v1.5: Windows runs System32\'s reg.exe by full path, against the 64-bit registry view', () => {
  assert.deepEqual([...cp.REG_ARGS], ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
  assert.deepEqual([...cp.PS_ARGS], ['-NoProfile', '-NonInteractive', '-Command',
    "Get-ItemPropertyValue -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid"]);
  const saved = { root: process.env.SystemRoot, wow: process.env.PROCESSOR_ARCHITEW6432 };
  const put = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    put('SystemRoot', 'D:\\Win');
    put('PROCESSOR_ARCHITEW6432', undefined);
    assert.equal(cp.regExe(), 'D:\\Win\\System32\\reg.exe', 'reg.exe was not taken from System32');
    assert.equal(cp.powershellExe(), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    put('PROCESSOR_ARCHITEW6432', 'AMD64');   // a 32-bit process on 64-bit Windows
    assert.equal(cp.powershellExe(), 'D:\\Win\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe', 'a 32-bit node would run the 32-bit PowerShell and read WOW6432Node');
  } finally { put('SystemRoot', saved.root); put('PROCESSOR_ARCHITEW6432', saved.wow); }
});

test('#5532 v1.5: on a Mac, this computer\'s real hardware id has the UUID shape (the value is never printed)', { skip: process.platform !== 'darwin' }, () => {
  const id = cp.hardwareId();
  assert.ok(id && cp.UUID.test(id), 'ioreg gave no IOPlatformUUID on this Mac');
  assert.equal(cp.hardwareId(), id, 'not stable within one run');
});
