'use strict';
/**
 * OpenAI's Codex installs on Windows.
 *
 * Found by the founder on a clean Windows 11 laptop running prod 0.6.72: first-run,
 * GPT card, Confirm, progress bar, then "We could not start that install." Two
 * defects under one sentence:
 *
 *   1. runners.install('openai') refused on win32 at the platform gate, because the
 *      only pinned Codex build was the darwin-arm64 tarball. OpenAI publishes
 *      win32-x64 and win32-arm64 builds of the same version on the npm registry,
 *      each with its own integrity, and those are now pinned.
 *   2. The refusal's reason travelled at `job.because`, and the screen read only
 *      `out.error || out.because`, so the reason never reached the person.
 *
 * The first block runs everywhere (the platform and arch are parameters, so the
 * win32 answer is asserted from the Mac CI runs on). The last block runs the real
 * unpack with the Windows-shipped tar.exe and is skipped off win32.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runners-win32-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
delete process.env.AGENT_WORKFORCE_CODEX_BIN;
const runners = require('./runners');
const platformGate = require('./platform');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.afterEach(() => runners.resetForTests());

const LEGACY = path.join(SANDBOX, 'legacy', 'codex');

test('the Codex gate lets Windows through; every other runner arm stays darwin-only', () => {
  assert.equal(platformGate.canDownloadCodex('win32'), true, 'OpenAI publishes a Windows Codex build');
  assert.equal(platformGate.canDownloadCodex('darwin'), true);
  for (const p of ['linux', 'aix', '', null]) assert.equal(platformGate.canDownloadCodex(p), false, String(p) + ' fails closed');
  assert.deepEqual(platformGate.CODEX_DOWNLOADS, ['darwin', 'win32']);
  assert.ok(Object.isFrozen(platformGate.CODEX_DOWNLOADS));
  // The Claude LINK path and unknown providers are unchanged on Windows.
  assert.equal(platformGate.canDownloadRunner('win32'), false);
  assert.match(runners.install('claude', { platform: 'win32' }).because, /not supported/);
});

test('manifestFor picks the WINDOWS build on win32, never the Mac tarball', () => {
  const x64 = runners.manifestFor('openai', 'win32', 'x64');
  assert.match(x64.url, /codex-0\.149\.1-win32-x64\.tgz$/);
  assert.doesNotMatch(x64.url, /darwin/);
  assert.match(x64.integrity, /^sha512-/);
  assert.equal(x64.binInPackage, 'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  assert.equal(x64.arch, 'x64');
  assert.equal(x64.version, runners.MANIFEST.openai.version, 'one pinned release across platforms');
  assert.equal(x64.name, "OpenAI's Codex");

  const arm = runners.manifestFor('openai', 'win32', 'arm64');
  assert.match(arm.url, /win32-arm64\.tgz$/);
  assert.equal(arm.binInPackage, 'vendor/aarch64-pc-windows-msvc/bin/codex.exe');

  // The Mac answer is the untouched MANIFEST entry.
  assert.equal(runners.manifestFor('openai', 'darwin', 'arm64'), runners.MANIFEST.openai);
  // Frozen: these are the trust anchors for bytes this module executes.
  assert.ok(Object.isFrozen(x64));
  assert.throws(() => { runners.CODEX_WIN32.x64.url = 'https://evil.example/x.tgz'; }, TypeError);
  assert.equal(runners.manifestFor('constructor', 'win32', 'x64'), null, 'prototype names stay refused');
});

test('on win32 the managed runner IS the binary inside the unpacked tree (no symlink)', () => {
  const m = runners.manifestFor('openai', 'win32', 'x64');
  const bin = runners.managedBin(m, 'win32');
  assert.ok(bin.endsWith(['openai', 'pkg', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'].join('\\')), bin);
  const r = runners.resolveBin('openai', { platform: 'win32', arch: 'x64', legacyBin: LEGACY });
  assert.equal(r.bin, bin, 'the resolver and the installer name the same path');
  assert.equal(r.present, false);
  // And the Mac keeps its symlink path.
  assert.equal(runners.managedBin(runners.MANIFEST.openai, 'darwin'), path.join(runners.managedRoot(), 'openai', 'codex'));
});

test('tarBin names the system tar.exe on Windows and /usr/bin/tar on the Mac', () => {
  assert.equal(runners.tarBin('win32', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(runners.tarBin('darwin'), '/usr/bin/tar');
});

test('an x64 Windows install passes the gate and starts downloading the win32 build', async () => {
  let asked = null;
  const job = runners.install('openai', {
    platform: 'win32', arch: 'x64', legacyBin: LEGACY,
    download: (url) => { asked = url; const e = new Error('getaddrinfo ENOTFOUND registry.npmjs.org'); e.code = 'ENOTFOUND'; return Promise.reject(e); },
    prove: () => { throw new Error('prove must never run without bytes'); },
  });
  assert.equal(job.phase, 'downloading', 'it is a real job, not the old platform refusal');
  assert.equal(job.totalBytes, runners.CODEX_WIN32.x64.downloadBytes, 'the bar is sized for the Windows file');
  await job.settled;
  assert.match(asked, /win32-x64\.tgz$/, 'the Windows build was requested');
  assert.equal(job.phase, 'failed');
  // Offline is said in words, with something to do, and no errno.
  assert.match(job.because, /could not reach the download server/);
  assert.match(job.because, /try again/);
  assert.doesNotMatch(job.because, /ENOTFOUND|getaddrinfo/);
});

test('a Windows CPU with no published build is refused by name before a byte moves', () => {
  const job = runners.install('openai', {
    platform: 'win32', arch: 'ia32', legacyBin: LEGACY,
    download: () => { throw new Error('no bytes may move for an unpublished CPU'); },
  });
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /ia32/);
  assert.match(job.because, /no download was attempted/);
});

test('an unsupported platform is refused in plain words that name the product', () => {
  const job = runners.install('openai', { platform: 'linux' });
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /not supported/);
  assert.match(job.because, /linux/);
  assert.match(job.because, /OpenAI's Codex/, 'the person reads the product name, not the word "runner"');
  assert.match(job.because, /nothing was downloaded/);
  assert.doesNotMatch(job.because, /\u2014/, 'no em dash in person-facing copy');
});

test('plainFailure turns a thrown pipeline error into a sentence a person can act on', () => {
  const m = runners.manifestFor('openai', 'win32', 'x64');
  const net = Object.assign(new Error('connect ECONNRESET 1.2.3.4:443'), { code: 'ECONNRESET' });
  assert.match(runners.plainFailure(net, m, 'download'), /could not reach the download server.*try again/);
  assert.match(runners.plainFailure(new Error('the download answered 404'), m, 'download'), /did not finish \(the download answered 404\)/);
  assert.match(runners.plainFailure(new Error('tar.exe: Error opening archive'), m, 'unpack'), /could not unpack it.*try again/);
  assert.doesNotMatch(runners.plainFailure(new Error('tar.exe: Error opening archive'), m, 'unpack'), /tar/);
  assert.match(runners.plainFailure(Object.assign(new Error('EPERM: rename'), { code: 'EPERM' }), m, 'swap'), /could not move it into place.*try again/);
  assert.match(runners.plainFailure(new Error('EACCES: mkdir'), m, 'prepare'), /could not finish installing.*try again/);
  for (const s of ['download', 'unpack', 'swap', 'prepare']) {
    assert.doesNotMatch(runners.plainFailure(new Error('x'), m, s), /\u2014/, 'no em dash');
  }
});

/* ------------------------------------------------------------------------- */
/* The real Windows unpack path: tar.exe, no symlink, the binary in the tree. */
const onWin = process.platform === 'win32';

function winFixture(binRel) {
  // A real .tgz with the npm layout, made with the same System32 tar.exe the module
  // unpacks with. The "binary" is a copy of this node.exe, so it is a real runnable
  // .exe; prove is injected anyway so the test never depends on what it prints.
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'fix-'));
  const abs = path.join(dir, ...binRel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(process.execPath, abs);
  const tgz = path.join(dir, 'fixture.tgz');
  execFileSync(runners.tarBin('win32'), ['-czf', tgz, '-C', dir, 'package']);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  return { tgz, integrity };
}
const downloadFrom = (src) => (url, file, job) => {
  const bytes = fs.readFileSync(src);
  job.totalBytes = bytes.length; job.receivedBytes = bytes.length;
  fs.writeFileSync(file, bytes);
  return Promise.resolve();
};

test('win32: the real pipeline unpacks with tar.exe and lands codex.exe where resolveBin looks', { skip: !onWin && 'win32 only' }, async () => {
  const m = runners.manifestFor('openai', 'win32', process.arch);
  const { tgz, integrity } = winFixture('package/' + m.binInPackage);
  let provedBin = null;
  const job = runners.install('openai', {
    legacyBin: LEGACY, download: downloadFrom(tgz), integrity,
    prove: (bin, done) => { provedBin = bin; done(null, 'codex-cli 9.9.9\n'); },
  });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(job.proved, 'codex-cli 9.9.9');
  const r = runners.resolveBin('openai', { legacyBin: LEGACY });
  assert.equal(r.present, true, 'the installed runner reads present');
  assert.equal(r.managed, true);
  assert.equal(provedBin, r.bin, 'the proved binary is the one every caller resolves');
  assert.equal(fs.existsSync(path.join(runners.managedRoot(), 'openai', 'codex')), false, 'no symlink is made on Windows');
  fs.rmSync(path.join(runners.managedRoot(), 'openai'), { recursive: true, force: true });
});

test('win32: a binary that does not run is never left looking present', { skip: !onWin && 'win32 only' }, async () => {
  const m = runners.manifestFor('openai', 'win32', process.arch);
  const { tgz, integrity } = winFixture('package/' + m.binInPackage);
  const job = runners.install('openai', {
    legacyBin: LEGACY, download: downloadFrom(tgz), integrity,
    prove: (bin, done) => done(new Error('Command failed: C:\\x\\codex.exe --version')),
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /did not run on this computer/);
  assert.doesNotMatch(job.because, /Command failed|codex\.exe/, 'no raw child error on the screen');
  assert.equal(runners.resolveBin('openai', { legacyBin: LEGACY }).present, false,
    'on Windows the binary inside the tree is the runner, so the tree must go');
});
