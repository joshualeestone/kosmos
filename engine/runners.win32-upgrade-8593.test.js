'use strict';
/*
 * kosmos#8593 (Windows): a pin bump reaches a Windows computer that already has Codex.
 *
 * Before this, a Windows Codex installed by an older build carried a .verified marker naming ITS version, the pin
 * moved, and resolveBin read the tree as ABSENT (the marker no longer matched the pin): Codex agents stopped starting
 * until somebody reinstalled by hand. Now an older marker that vouches for the same binary path reads present but
 * STALE, and install() replaces it the way the Mac's upgrade does, with two Windows rules:
 *   - it swaps only while no process runs from the managed folder (Windows lets the folder be renamed under a running
 *     codex.exe, measured 2026-11-17, and the restart sweep that answers that on the Mac reads tmux);
 *   - a failed upgrade puts the previous tree back AND its marker, so the version that worked keeps working.
 *
 *   node --test engine/runners.win32-upgrade-8593.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runners-w8593-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
delete process.env.AGENT_WORKFORCE_CODEX_BIN;
const runners = require('./runners');
const { removeTree } = require('../test-support/remove-tree');
test.after(() => { removeTree(SANDBOX); });
test.afterEach(() => runners.resetForTests());

const onWin = process.platform === 'win32';
const WIN_ONLY = !onWin && 'win32 only: the managed rung, tar.exe and the .verified marker are the Windows layout';
const LEGACY = path.join(SANDBOX, 'legacy', 'codex');   // absent: only the managed rung can answer
const OLD = '0.149.1';
const pin = () => runners.manifestFor('openai', 'win32', process.arch);
const DEST = () => path.join(runners.managedRoot(), 'openai');
const clear = () => removeTree(DEST());

/* The tree an older build left: codex.exe (a copy of this node.exe, so it is a real runnable .exe) at managedBin, a
   file that marks it as the OLD tree, and the marker that build wrote after its --version passed. */
function plantOld(markerText) {
  clear();
  const m = pin();
  const exe = runners.managedBin(m, 'win32');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.copyFileSync(process.execPath, exe);
  fs.writeFileSync(path.join(DEST(), 'pkg', 'old-tree.txt'), OLD);
  fs.writeFileSync(runners.verifiedMarker('win32'), (markerText == null ? `${OLD} ${m.binInPackage}` : markerText) + '\n');
}
const marker = () => { try { return fs.readFileSync(runners.verifiedMarker('win32'), 'utf8').trim(); } catch { return null; } };
const isOldTree = () => fs.existsSync(path.join(DEST(), 'pkg', 'old-tree.txt'));
const strays = () => fs.readdirSync(DEST()).filter((f) => /^pkg\.(new|old)-/.test(f));

function winFixture() {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'fix-'));
  const abs = path.join(dir, 'package', ...pin().binInPackage.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(process.execPath, abs);
  const tgz = path.join(dir, 'fixture.tgz');
  execFileSync(runners.tarBin('win32'), ['-czf', tgz, '-C', dir, 'package']);
  return { tgz, integrity: 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64') };
}
const downloadFrom = (src) => (url, file, job) => {
  const bytes = fs.readFileSync(src);
  job.totalBytes = bytes.length; job.receivedBytes = bytes.length;
  fs.writeFileSync(file, bytes);
  return Promise.resolve();
};
const ok = (bin, done) => done(null, `codex-cli ${pin().version}\n`);

test('the Windows pin is newer than the version older builds installed (this file is about that bump)', () => {
  assert.equal(runners.olderVersion(OLD, runners.manifestFor('openai', 'win32', 'x64').version), true);
});

test('parseRunning: a count with the sentinel is an answer; anything else is no answer (null, read as running)', () => {
  assert.equal(runners.parseRunning('0 KOSMOS-RUNNING-READ-OK'), false);
  assert.equal(runners.parseRunning('3 KOSMOS-RUNNING-READ-OK\r\n'), true);
  for (const s of ['', null, undefined, '0', 'KOSMOS-RUNNING-READ-OK', 'x KOSMOS-RUNNING-READ-OK', 'garbage']) {
    assert.equal(runners.parseRunning(s), null, JSON.stringify(s));
  }
});

test('win32: a tree an older build vouched for is present but stale; its agents keep starting on it', { skip: WIN_ONLY }, () => {
  plantOld();
  try {
    const r = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.equal(r.present, true, 'before #8593 this read false: the marker named the old version, so Codex vanished');
    assert.equal(r.managed, true);
    assert.equal(r.stale, true);
    assert.equal(r.installedVersion, OLD);
    assert.equal(r.bin, runners.managedBin(pin(), 'win32'));
  } finally { clear(); }
});

test('win32 CONTROLS: a marker at the pin, a newer one, another path, or a garbled one is not stale', { skip: WIN_ONLY }, () => {
  const m = pin();
  const [ma, mi, pa] = m.version.split('.').map(Number);
  try {
    plantOld(`${m.version} ${m.binInPackage}`);
    const atPin = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.equal(atPin.present, true); assert.ok(!atPin.stale, 'at the pin');
    for (const text of [`${ma}.${mi}.${pa + 1} ${m.binInPackage}`, `${OLD} vendor/other/codex.exe`, `${OLD}`, `x.y.z ${m.binInPackage}`, '']) {
      plantOld(text);
      const r = runners.resolveBin('openai', { legacyBin: LEGACY });
      assert.equal(r.present, false, `${JSON.stringify(text)} vouches for nothing at managedBin, as before`);
      assert.ok(!r.stale, JSON.stringify(text));
    }
  } finally { clear(); }
});

test('win32: an upgrade with no agent running replaces the tree, vouches for the pin, and records the upgrade', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  let asked = null;
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
      codexRunning: (dir) => { asked = dir; return Promise.resolve(false); } });
    await job.settled;
    assert.equal(job.phase, 'installed', job.because || '');
    assert.equal(asked, DEST(), 'it asked about the managed folder');
    assert.equal(marker(), `${pin().version} ${pin().binInPackage}`, 'the new tree is vouched for');
    assert.equal(isOldTree(), false, 'the new tree is in place');
    const r = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.equal(r.present, true); assert.ok(!r.stale);
    const rec = runners.upgradeStamp('openai');
    assert.equal(rec && rec.from, OLD); assert.equal(rec && rec.to, pin().version);
    assert.deepEqual(strays(), [], 'no set-aside tree left behind');
  } finally { clear(); }
});

for (const [busy, says] of [[true, /an agent is running/], [null, /could not check/]]) {
  test(`win32: an upgrade while the check answers ${busy} keeps the old tree and its marker, untouched`, { skip: WIN_ONLY }, async () => {
    plantOld();
    const before = marker();
    const { tgz, integrity } = winFixture();
    try {
      const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
        codexRunning: () => Promise.resolve(busy) });
      await job.settled;
      assert.equal(job.phase, 'failed');
      assert.match(job.because, says);
      assert.match(job.because, /version is kept/);
      assert.equal(job.waited, true, 'marked as a wait, so the sweep hands its try back (engine/runnerupgrade.js)');
      assert.equal(Object.keys(job).includes('waited'), false, 'kept off the API job shape');
      assert.doesNotMatch(job.because, /—/, 'no em dash');
      assert.equal(marker(), before, 'the marker never came down');
      assert.equal(isOldTree(), true);
      const r = runners.resolveBin('openai', { legacyBin: LEGACY });
      assert.equal(r.present, true, 'its agents keep working'); assert.equal(r.stale, true, 'and the next look tries again');
      assert.deepEqual(strays(), [], 'the unpacked new tree was removed');
    } finally { clear(); }
  });
}

test('win32: a check that throws counts as running (the old version stays)', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
      codexRunning: () => Promise.reject(new Error('CIM unavailable')) });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.equal(isOldTree(), true);
    assert.equal(runners.resolveBin('openai', { legacyBin: LEGACY }).present, true);
  } finally { clear(); }
});

test('win32: an upgrade whose new Codex does not run puts the previous tree AND its marker back', { skip: WIN_ONLY }, async () => {
  plantOld();
  const before = marker();
  const { tgz, integrity } = winFixture();
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity,
      codexRunning: () => Promise.resolve(false), prove: (bin, done) => done(new Error('exit code 1')) });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /version already here is kept/);
    assert.equal(isOldTree(), true, 'the previous tree is back at pkg/');
    assert.equal(marker(), before, 'and vouched for again');
    const r = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.equal(r.present, true, 'a runner that worked before still works'); assert.equal(r.stale, true);
    assert.equal(runners.upgradeStamp('openai'), null, 'no upgrade is recorded');
    assert.notEqual(job.waited, true, 'a failed prove is a real try, not a wait');
  } finally { clear(); }
});

test('win32: a failed upgrade whose new tree will not delete (antivirus) still puts the previous tree back', { skip: WIN_ONLY }, async () => {
  plantOld();
  const before = marker();
  const { tgz, integrity } = winFixture();
  const pkgDir = path.join(DEST(), 'pkg');
  const realRm = fs.rmSync;
  let refused = 0;
  fs.rmSync = function (p, o) {
    if (path.resolve(String(p)) === path.resolve(pkgDir) && !fs.existsSync(path.join(pkgDir, 'old-tree.txt'))) {
      refused++;
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    }
    return realRm.call(fs, p, o);
  };
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity,
      codexRunning: () => Promise.resolve(false), prove: (bin, done) => done(new Error('exit code 1')) });
    await job.settled;
    assert.ok(refused >= 2, 'PRECONDITION: removing the new tree was refused, by the retried rm and by the restore');
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /version already here is kept/);
    assert.equal(isOldTree(), true, 'the previous tree is back at pkg/');
    assert.equal(marker(), before, 'and vouched for');
    assert.equal(runners.resolveBin('openai', { legacyBin: LEGACY }).present, true);
    assert.ok(strays().some((f) => /^pkg\.new-\d+-failed$/.test(f)), 'the stuck new tree waits under a name the age-gated sweep removes');
  } finally { fs.rmSync = realRm; clear(); }
});

test('win32: a swap whose first rename is refused vouches for the untouched previous tree again', { skip: WIN_ONLY }, async () => {
  plantOld();
  const before = marker();
  const { tgz, integrity } = winFixture();
  const realRename = fs.renameSync;
  let refused = 0;
  fs.renameSync = function (from, to) {
    if (path.basename(String(from)) === 'pkg' && /pkg\.old-/.test(String(to))) {
      refused++;
      throw Object.assign(new Error('EXDEV: refused for the test'), { code: 'EXDEV' });
    }
    return realRename.call(fs, from, to);
  };
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
      codexRunning: () => Promise.resolve(false) });
    await job.settled;
    assert.ok(refused >= 1, 'PRECONDITION: the set-aside rename really was refused');
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /version already here is kept/);
    assert.equal(isOldTree(), true);
    assert.equal(marker(), before, 'the marker taken down before the swap is back');
    assert.equal(runners.resolveBin('openai', { legacyBin: LEGACY }).present, true);
  } finally { fs.renameSync = realRename; clear(); }
});

test('win32: the real process check sees a program running from a folder, and not from an idle one', { skip: WIN_ONLY }, async () => {
  assert.equal(await runners.managedProcessRunning(path.dirname(process.execPath)), true, 'this node runs from its own folder');
  const idle = fs.mkdtempSync(path.join(SANDBOX, 'idle-'));
  assert.equal(await runners.managedProcessRunning(idle), false);
  // A sibling that only shares the prefix is not the folder.
  assert.equal(await runners.managedProcessRunning(path.dirname(process.execPath).slice(0, -1)), false);
});
