'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/*
 * kosmos#8593: a pin bump reaches a computer that already has Codex. A managed Mac/Linux Codex older than the pin is
 * still present (its agents keep running) but STALE, and install() replaces it instead of answering "installed".
 * Before this, nothing ever upgraded an existing runner, so the user who asked for gpt-6-astra kept 0.149.1.
 *
 *   node --test engine/runners.stale-codex-8593.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/* Sandbox every root this module reads or writes before requiring it (runners.test.js's rule). */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-runners-8593-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = nodePath.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
delete process.env.AGENT_WORKFORCE_CODEX_BIN;
const runners = require('./runners');
const { removeTree } = require('../test-support/remove-tree');
const { skipOnWin32 } = require('../test-support/skip-on-win32');
test.after(() => { removeTree(SANDBOX); });

const PLAT = { platform: 'darwin', arch: 'arm64' };
const PIN = runners.manifestFor('openai', 'darwin', 'arm64');
const DEST = nodePath.join(SANDBOX, 'runners', 'openai');
const LEGACY = nodePath.join(SANDBOX, 'legacy', 'codex');   // absent: only the managed rung can answer

/* An installed managed tree as install() leaves it: pkg/package.json, the binary under binInPackage, a relative
   `codex` symlink beside pkg/. `version` null writes no package.json. */
function plantTree(version) {
  removeTree(DEST);
  const bin = nodePath.join(DEST, 'pkg', PIN.binInPackage);
  fs.mkdirSync(nodePath.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, `#!/bin/sh\necho "codex-cli ${version || 'unknown'}"\n`, { mode: 0o755 });
  if (version) fs.writeFileSync(nodePath.join(DEST, 'pkg', 'package.json'), JSON.stringify({ name: '@openai/codex', version: `${version}-darwin-arm64` }));
  fs.symlinkSync(nodePath.relative(DEST, bin), nodePath.join(DEST, 'codex'));
}

function tarball(version) {
  const dir = fs.mkdtempSync(nodePath.join(SANDBOX, 'fix-'));
  const bin = nodePath.join(dir, 'package', PIN.binInPackage);
  fs.mkdirSync(nodePath.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, `#!/bin/sh\necho "codex-cli ${version} $1"\n`, { mode: 0o755 });
  fs.writeFileSync(nodePath.join(dir, 'package', 'package.json'), JSON.stringify({ name: '@openai/codex', version: `${version}-darwin-arm64` }));
  const tgz = nodePath.join(dir, 'fixture.tgz');
  execFileSync('/usr/bin/tar', ['-czf', tgz, '-C', dir, 'package']);
  return { tgz, integrity: 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64') };
}
const prove = (bin, done) => { try { done(null, execFileSync(bin, ['--version']).toString()); } catch (e) { done(e); } };

test('the pin moved past 0.149.1 (this file is about that bump)', () => {
  assert.notEqual(PIN.version, '0.149.1');
});

test('kosmos#8593: a managed Codex older than the pin is present but stale, and install() replaces it with the pin', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, async () => {
  plantTree('0.149.1');
  const before = runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY });
  assert.equal(before.present, true, 'its agents keep running on it meanwhile');
  assert.equal(before.managed, true);
  assert.equal(before.stale, true, 'older than the pin');
  assert.equal(before.installedVersion, '0.149.1');

  const { tgz, integrity } = tarball(PIN.version);
  let asked = null;
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity,
    download: (url, file, j) => { asked = url; const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); return Promise.resolve(); },
    prove });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(asked, PIN.url, 'it downloaded the pinned tarball');
  assert.equal(job.proved.trim(), `codex-cli ${PIN.version} --version`, 'the new binary is the one that ran');
  const after = runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY });
  assert.equal(after.present, true);
  assert.ok(!after.stale, 'at the pin now');
  assert.equal(runners.installedVersion('openai', 'darwin'), PIN.version);
});

test('kosmos#8593 CONTROLS: a tree at the pin, or one whose version cannot be read, is not stale and is not reinstalled', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, async () => {
  for (const [why, version] of [['at the pin', PIN.version], ['no package.json', null]]) {
    plantTree(version);
    const r = runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY });
    assert.equal(r.present, true, why);
    assert.ok(!r.stale, `${why}: not stale`);
    let asked = false;
    const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, download: () => { asked = true; return Promise.reject(new Error('no')); }, prove });
    assert.equal(job.phase, 'installed', `${why}: answered installed`);
    assert.equal(asked, false, `${why}: nothing downloaded`);
  }
});

test('installedVersion reads the npm version with or without the platform suffix; anything else is null', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, () => {
  const pj = nodePath.join(DEST, 'pkg', 'package.json');
  plantTree('0.149.1');
  for (const [raw, want] of [['0.149.1-darwin-arm64', '0.149.1'], ['0.169.0', '0.169.0'], ['0.169.0-linux-x64', '0.169.0'], ['0.171.0-alpha.9-darwin-arm64', null], ['', null], [7, null]]) {
    fs.writeFileSync(pj, JSON.stringify({ version: raw }));
    assert.equal(runners.installedVersion('openai', 'darwin'), want, JSON.stringify(raw));
  }
  fs.writeFileSync(pj, '{not json');
  assert.equal(runners.installedVersion('openai', 'darwin'), null, 'unreadable');
  assert.equal(runners.installedVersion('openai', 'win32'), null, 'Windows keeps its own marker');
});

test('kosmos#8593 review 2: an upgrade whose new Codex does not run puts the previous version back, still working', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, async () => {
  plantTree('0.149.1');
  const { tgz, integrity } = tarball(PIN.version);
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity,
    download: (url, file, j) => { const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); return Promise.resolve(); },
    prove: (bin, done) => { if (fs.readFileSync(bin, 'utf8').includes(PIN.version)) done(new Error('does not run here')); else prove(bin, done); } });
  await job.settled;
  assert.equal(job.phase, 'failed', 'the failure is still reported');
  assert.match(job.because || '', /version already here is kept/);
  const r = runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY });
  assert.equal(r.present, true, 'a runner is still there');
  assert.equal(r.installedVersion, '0.149.1', 'and it is the previous one');
  assert.equal(execFileSync(r.bin).toString().trim(), 'codex-cli 0.149.1', 'and it runs');
  // CONTROL: a first install (nothing there before) that fails leaves nothing, as before.
  removeTree(DEST);
  const fresh = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity,
    download: (url, file, j) => { const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); return Promise.resolve(); },
    prove: (bin, done) => done(new Error('does not run here')) });
  await fresh.settled;
  assert.equal(fresh.phase, 'failed');
  assert.equal(runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY }).present, false, 'no runner after a failed first install');
});

test('kosmos#8593 review 2: an upgrade does not count as installing while it downloads (the old runner is usable), and does once it swaps', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, async () => {
  plantTree('0.149.1');
  const { tgz, integrity } = tarball(PIN.version);
  let release;
  const gate = new Promise((res) => { release = res; });
  let during = null;
  let atProve = null;
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity,
    download: async (url, file, j) => { during = runners.installing('openai'); await gate; const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); },
    prove: (bin, done) => { atProve = runners.installing('openai'); prove(bin, done); } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(during, false, 'downloading an upgrade: not installing');
  assert.equal(runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY }).present, true);
  release();
  await job.settled;
  assert.equal(atProve, true, 'from the swap on, the unproven tree counts as installing');
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(Object.keys(job).includes('upgrade'), false, 'the API job shape is unchanged');
});

test('kosmos#8593 review 3: only an OLDER tree is stale; a newer one (another board with a later pin) is left alone', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, () => {
  assert.equal(runners.olderVersion('0.149.1', '0.169.0'), true);
  assert.equal(runners.olderVersion('0.169.0', '0.169.0'), false);
  assert.equal(runners.olderVersion('0.170.0', '0.169.0'), false);
  assert.equal(runners.olderVersion('0.169.0', '0.169.1'), true);
  assert.equal(runners.olderVersion('1.0.0', '0.169.0'), false);
  assert.equal(runners.olderVersion('0.9.0', '0.10.0'), true, 'numeric, not text');
  assert.equal(runners.olderVersion('x', '0.169.0'), false, 'unparsable is never stale');
  const [ma, mi, pa] = PIN.version.split('.').map(Number);
  plantTree(`${ma}.${mi + 1}.${pa}`);
  const r = runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY });
  assert.equal(r.present, true);
  assert.ok(!r.stale, 'a newer tree is not stale');
});

test('kosmos#8593 review 3: status() reads the runner as present while an upgrade downloads', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') || (process.platform !== 'darwin' && "status() reads this process's platform; the fixture tree is the darwin layout") }, async () => {
  plantTree('0.149.1');
  const { tgz, integrity } = tarball(PIN.version);
  let release;
  const gate = new Promise((res) => { release = res; });
  let seen = null;
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity,
    download: async (url, file, j) => { seen = runners.status().openai; await gate; const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); },
    prove });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen, 'status was read during the download');
  assert.equal(seen.present, true, 'not "missing" while the old runner is in place');
  release();
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
});

test('kosmos#8593 review 4: a failure AFTER the swap (making the link) also puts the previous version back', { skip: skipOnWin32('it upgrades a stale Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have; Windows upgrades through its own .verified marker, only while no agent runs (runners.win32-upgrade-8593.test.js)') }, async () => {
  plantTree('0.149.1');
  const { tgz, integrity } = tarball(PIN.version);
  const real = fs.symlinkSync;
  let calls = 0;
  fs.symlinkSync = (...a) => { calls += 1; if (calls === 1) throw Object.assign(new Error('link refused'), { code: 'EPERM' }); return real(...a); };
  let job;
  try {
    job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity,
      download: (url, file, j) => { const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); return Promise.resolve(); },
      prove });
    await job.settled;
  } finally { fs.symlinkSync = real; }
  assert.equal(calls >= 2, true, 'the link step failed once, then the restore made the link');
  assert.equal(job.phase, 'failed');
  assert.match(job.because || '', /[.!?] The version already here is kept\.$/, 'one sentence after another, with its full stop');
  const r = runners.resolveBin('openai', { ...PLAT, legacyBin: LEGACY });
  assert.equal(r.present, true);
  assert.equal(r.installedVersion, '0.149.1');
  assert.equal(execFileSync(r.bin).toString().trim(), 'codex-cli 0.149.1');
  assert.deepEqual(fs.readdirSync(DEST).filter((f) => /^pkg\.old-/.test(f)), [], 'no stranded previous tree');
});
