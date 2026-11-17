'use strict';
/*
 * kosmos#8598: a proved upgrade of the managed Codex records what it replaced and when (upgraded.json beside the tree),
 * which the board's runner-restart sweep (engine/runnerrestart.js) reads to restart agents still on the replaced
 * version. A failed upgrade writes no record, and a first install removes an old one.
 *
 *   node --test engine/runners.upgrade-stamp-8598.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

/* Sandbox every root this module reads or writes before requiring it (runners.test.js's rule). */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-runners-8598-'));
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

const SKIP = skipOnWin32('it upgrades a Mac/Linux managed Codex through the POSIX pipeline (a #!/bin/sh program behind a symlink, /usr/bin/tar), which Windows does not have');
const STAMP = nodePath.join(DEST, runners.UPGRADE_STAMP);
const feed = (tgz) => (url, file, j) => { const b = fs.readFileSync(tgz); j.totalBytes = b.length; j.receivedBytes = b.length; fs.writeFileSync(file, b); return Promise.resolve(); };

test('kosmos#8598: a proved upgrade records the version it replaced, the new one, and the swap time', { skip: SKIP }, async () => {
  plantTree('0.149.1');
  assert.equal(runners.upgradeStamp('openai'), null, 'no record before');
  const { tgz, integrity } = tarball(PIN.version);
  const t0 = Date.now();
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity, download: feed(tgz), prove });
  await job.settled;
  const t1 = Date.now();
  assert.equal(job.phase, 'installed', job.because || '');
  const rec = runners.upgradeStamp('openai');
  assert.ok(rec, 'a record was written');
  assert.equal(rec.from, '0.149.1');
  assert.equal(rec.to, PIN.version);
  assert.ok(rec.at >= t0 && rec.at <= t1, 'the swap time falls inside the install');
});

test('kosmos#8598: an upgrade that fails and puts the previous version back writes no record', { skip: SKIP }, async () => {
  plantTree('0.149.1');
  const { tgz, integrity } = tarball(PIN.version);
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity, download: feed(tgz),
    prove: (bin, done) => { if (fs.readFileSync(bin, 'utf8').includes(PIN.version)) done(new Error('does not run here')); else prove(bin, done); } });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.equal(fs.existsSync(STAMP), false);
  assert.equal(runners.upgradeStamp('openai'), null);
});

test('kosmos#8598: a first install (nothing replaced) removes an earlier record', { skip: SKIP }, async () => {
  removeTree(DEST);
  fs.mkdirSync(DEST, { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify({ from: '0.100.0', to: '0.149.1', at: 1 }));
  const { tgz, integrity } = tarball(PIN.version);
  const job = runners.install('openai', { ...PLAT, legacyBin: LEGACY, integrity, download: feed(tgz), prove });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(fs.existsSync(STAMP), false, 'a fresh install replaced no running version');
});

test('kosmos#8598: upgradeStamp reads only a well-formed record', () => {
  fs.mkdirSync(DEST, { recursive: true });
  for (const [raw, want] of [
    ['{not json', null],
    [JSON.stringify({ to: '0.169.0' }), null],
    [JSON.stringify({ from: 7, to: '0.169.0', at: 5 }), { from: null, to: '0.169.0', at: 5 }],
    [JSON.stringify({ from: '0.149.1', to: '0.169.0', at: 5 }), { from: '0.149.1', to: '0.169.0', at: 5 }],
  ]) {
    fs.writeFileSync(STAMP, raw);
    assert.deepEqual(runners.upgradeStamp('openai'), want, raw);
  }
  fs.rmSync(STAMP, { force: true });
  assert.equal(runners.upgradeStamp('openai'), null, 'absent');
});
