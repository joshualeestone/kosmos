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
const { execFileSync, spawn } = require('node:child_process');

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

test('parseExePaths: the paths are an answer only with the sentinel; without it there is no answer (null, read as running)', () => {
  assert.deepEqual(runners.parseExePaths('C:\\a\\b.exe\r\nC:\\c d\\e.exe\r\nKOSMOS-RUNNING-READ-OK\r\n'), ['C:\\a\\b.exe', 'C:\\c d\\e.exe']);
  assert.deepEqual(runners.parseExePaths('KOSMOS-RUNNING-READ-OK'), [], 'no programs at all is still an answer');
  for (const s of ['', null, undefined, 'C:\\a\\b.exe', 'garbage', 'x KOSMOS-RUNNING-READ-OK']) {
    assert.equal(runners.parseExePaths(s), null, JSON.stringify(s));
  }
});

test('exeUnder: a program inside the folder, in any spelling that resolves to it, counts; a sibling prefix does not', async () => {
  const root = 'C:\\Users\\Pat Doe\\Kosmos\\runners\\openai';
  // The seam stands in for realpath: the short and mixed spellings resolve to the long one.
  const real = (p) => ({
    'C:\\Users\\PATDOE~1\\Kosmos\\runners\\openai\\pkg\\codex.exe': `${root}\\pkg\\codex.exe`,
    'c:\\users\\pat doe\\KOSMOS\\RUNNE~1\\openai\\pkg\\codex.exe': `${root}\\pkg\\codex.exe`,
  })[p] || p;
  assert.equal(await runners.exeUnder([`${root}\\pkg\\codex.exe`], root, real), true, 'as given');
  assert.equal(await runners.exeUnder(['C:\\Users\\PATDOE~1\\Kosmos\\runners\\openai\\pkg\\codex.exe'], root, real), true, '8.3 form');
  assert.equal(await runners.exeUnder(['c:\\users\\pat doe\\KOSMOS\\RUNNE~1\\openai\\pkg\\codex.exe'], root, real), true, 'mixed, other case');
  assert.equal(await runners.exeUnder([`${root}-old\\pkg\\codex.exe`, 'C:\\Windows\\explorer.exe'], root, real), false, 'a sibling that shares the prefix');
  assert.equal(await runners.exeUnder([`${root}\\pkg\\codex.exe`], `${root}\\`, real), true, 'a root given with its trailing separator');
  const throws = () => { throw new Error('EPERM'); };
  assert.equal(await runners.exeUnder([`${root}\\pkg\\codex.exe`], root, throws), true, 'a path that cannot be resolved is compared as reported');
  assert.equal(await runners.exeUnder(['C:\\Users\\PATDOE~1\\x.exe'], root, () => Promise.reject(new Error('EPERM'))), false, 'an async refusal too');
  assert.equal(await runners.exeUnder([], root, real), false);
  assert.equal(await runners.exeUnder([`\\\\?\\${root}\\pkg\\codex.exe`], root, throws), true, 'the \\\\?\\ long-path form');
  // Another spelling the caller already knows (the form Kosmos started Codex by) counts without resolving anything.
  assert.equal(await runners.exeUnder(['C:\\Users\\PATDOE~1\\Kosmos\\runners\\openai\\codex.exe'], root, throws,
    [root, 'C:\\Users\\PATDOE~1\\Kosmos\\runners\\openai']), true);
});

test('exeUnder resolves only paths on the managed folder\'s own drive: a gone network drive cannot stall it', async () => {
  const root = 'C:\\Users\\Pat Doe\\Kosmos\\runners\\openai';
  const asked = [];
  const real = (p) => { asked.push(p); return p; };
  const paths = ['Z:\\tools\\app.exe', '\\\\server\\share\\app.exe', 'D:\\Games\\x.exe', 'C:\\Windows\\explorer.exe'];
  assert.equal(await runners.exeUnder(paths, root, real), false);
  assert.deepEqual(asked, ['C:\\Windows\\explorer.exe'], 'the mapped drive, the UNC share and the other drive were never resolved');
  // A resolver that never answers (a hung SMB) on another drive is never awaited.
  assert.equal(await runners.exeUnder(['Z:\\gone\\app.exe'], root, () => new Promise(() => {})), false);
});

test('waitForSwap: clear at once with no lock or for a codex outside the managed folder; waits while a fresh lock is up', { skip: WIN_ONLY }, async () => {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'swap-'));
  const bin = path.win32.join(root, 'openai', 'pkg', 'codex.exe');
  const lock = path.win32.join(root, 'openai', runners.SWAP_LOCK);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  assert.equal(await runners.waitForSwap(bin, { root, timeoutMs: 0 }), true, 'no lock');
  fs.writeFileSync(lock, '{}');
  assert.equal(await runners.waitForSwap('C:\\elsewhere\\codex.exe', { root, timeoutMs: 0 }), true, 'not the managed codex');
  assert.equal(await runners.waitForSwap('codex', { root, timeoutMs: 0 }), true, 'a bare name is not the managed codex');
  assert.equal(await runners.waitForSwap(bin, { root, timeoutMs: 30, pollMs: 5 }), false, 'a fresh lock held past the cap');
  setTimeout(() => fs.rmSync(lock, { force: true }), 40);
  assert.equal(await runners.waitForSwap(bin, { root, timeoutMs: 5000, pollMs: 5 }), true, 'clear once the lock comes down');
  fs.writeFileSync(lock, 'half-writ');   // a crash mid-write: its age, not its text, decides
  const old = new Date(Date.now() - 16 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  assert.equal(await runners.waitForSwap(bin, { root, timeoutMs: 0 }), true, 'a lock a dead board left goes stale');
  assert.equal(await runners.waitForSwap(bin.toUpperCase(), { root: root.toLowerCase(), timeoutMs: 0 }), true, 'case does not matter (stale still)');
});

test('win32: the swap lock is up from before the marker comes down until the new tree is proven, and down on every way out', { skip: WIN_ONLY }, async () => {
  const lock = () => fs.existsSync(path.join(DEST(), runners.SWAP_LOCK));
  const cases = [
    { name: 'installed', prove: ok, phase: 'installed' },
    { name: 'prove failed', prove: (bin, done) => done(new Error('exit code 1')), phase: 'failed' },
  ];
  for (const c of cases) {
    plantOld();
    const { tgz, integrity } = winFixture();
    let lockAtProve = null;
    let lockAtLastLook = null;
    const answers = [false, false, false, false];
    try {
      const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity,
        codexRunning: () => { if (answers.length === 1) lockAtLastLook = lock(); return Promise.resolve(answers.shift()); },
        prove: (bin, done) => { lockAtProve = lock(); c.prove(bin, done); } });
      await job.settled;
      assert.equal(job.phase, c.phase, c.name);
      assert.equal(lockAtLastLook, true, `${c.name}: up before the last look`);
      assert.equal(lockAtProve, true, `${c.name}: up while the new tree is unproven`);
      assert.equal(lock(), false, `${c.name}: down afterwards`);
    } finally { clear(); }
  }
  // A wait at the last look takes it down too.
  plantOld();
  const { tgz, integrity } = winFixture();
  const answers = [false, false, false, true];   // first, pre-unpack, pre-swap idle; an agent at the last look
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
      codexRunning: () => Promise.resolve(answers.shift()) });
    await job.settled;
    assert.equal(job.waited, true);
    assert.equal(lock(), false, 'a wait at the last look: down');
  } finally { clear(); try { fs.rmSync(stagingFile(), { force: true }); } catch { /* gone */ } }
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
    // A newer build's tree (another board with a later pin) reads present and not stale, as on the Mac.
    plantOld(`${ma}.${mi}.${pa + 1} ${m.binInPackage}`);
    const newer = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.equal(newer.present, true, 'present: read as absent, the screen would offer an install over it');
    assert.ok(!newer.stale, 'never stale: a newer tree is not downgraded');
    assert.equal(newer.managed, true);
    for (const text of [`${OLD} vendor/other/codex.exe`, `${OLD}`, `x.y.z ${m.binInPackage}`, '']) {
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

/* The staging tarball install() keeps across a wait (its per-process name, in the managed .tmp folder). */
const stagingFile = () => path.join(runners.managedRoot(), '.tmp', `openai-${pin().version}-${process.pid}.tgz`);
const counting = (src) => { const d = downloadFrom(src); const f = (...a) => { f.calls += 1; return d(...a); }; f.calls = 0; return f; };
// The fixture's own size stands in for the published size, which is what lets a kept tarball be reused.
const withSize = (tgz) => ({ ...pin(), downloadBytes: fs.statSync(tgz).size });

test('win32: an agent already running at the first look downloads nothing', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  const download = counting(tgz);
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download, integrity, prove: ok, manifest: withSize(tgz),
      codexRunning: () => Promise.resolve(true) });
    await job.settled;
    assert.equal(job.phase, 'failed'); assert.equal(job.waited, true);
    assert.equal(download.calls, 0, 'no 187 MB fetched for a swap that cannot happen');
    assert.equal(isOldTree(), true);
  } finally { clear(); }
});

test('win32: a newer build tree is never installed over (no downgrade): install() answers installed and fetches nothing', { skip: WIN_ONLY }, async () => {
  const m = pin();
  const [ma, mi, pa] = m.version.split('.').map(Number);
  plantOld(`${ma}.${mi}.${pa + 1} ${m.binInPackage}`);
  const { tgz, integrity } = winFixture();
  const download = counting(tgz);
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download, integrity, prove: ok, codexRunning: () => Promise.resolve(false) });
    await job.settled;
    assert.equal(job.phase, 'installed');
    assert.equal(download.calls, 0);
    assert.equal(isOldTree(), true, 'the newer tree stays');
  } finally { clear(); }
});

test('win32: a kept tarball survives a later look that finds an agent running before it downloads', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  const download = counting(tgz);
  // look 1: idle, then busy before the unpack; look 2: busy at once; look 3: idle at all four (first, pre-unpack, pre-swap, marker down)
  const answers = [false, true, true, false, false, false, false];
  const go = () => runners.install('openai', { legacyBin: LEGACY, download, integrity, prove: ok, manifest: withSize(tgz),
    codexRunning: () => Promise.resolve(answers.shift()) });
  try {
    const a = go(); await a.settled; assert.equal(a.waited, true);
    const b = go(); await b.settled; assert.equal(b.waited, true);
    assert.equal(fs.existsSync(stagingFile()), true, 'still kept after a look that waited before downloading');
    const c = go(); await c.settled;
    assert.equal(c.phase, 'installed', c.because || '');
    assert.equal(download.calls, 1, 'fetched once across three looks');
  } finally { clear(); try { fs.rmSync(stagingFile(), { force: true }); } catch { /* gone */ } }
});

test('win32: a tarball downloaded before an agent started is kept, and the next look reuses it instead of fetching again', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  const download = counting(tgz);
  const answers = [false, true];   // idle at the first look, an agent started during the download
  try {
    const first = runners.install('openai', { legacyBin: LEGACY, download, integrity, prove: ok, manifest: withSize(tgz),
      codexRunning: () => Promise.resolve(answers.shift()) });
    await first.settled;
    assert.equal(first.phase, 'failed'); assert.equal(first.waited, true);
    assert.equal(download.calls, 1);
    assert.equal(fs.existsSync(stagingFile()), true, 'the verified tarball is kept');
    assert.equal(isOldTree(), true);

    const second = runners.install('openai', { legacyBin: LEGACY, download, integrity, prove: ok, manifest: withSize(tgz),
      codexRunning: () => Promise.resolve(false) });
    await second.settled;
    assert.equal(second.phase, 'installed', second.because || '');
    assert.equal(download.calls, 1, 'reused, not fetched again');
    assert.equal(fs.existsSync(stagingFile()), false, 'and removed once installed');
    assert.equal(marker(), `${pin().version} ${pin().binInPackage}`);
  } finally { clear(); try { fs.rmSync(stagingFile(), { force: true }); } catch { /* gone */ } }
});

test('win32: a kept tarball whose bytes no longer match is discarded by the checksum, never unpacked', { skip: WIN_ONLY }, async () => {
  plantOld();
  const before = marker();
  const { tgz, integrity } = winFixture();
  const download = counting(tgz);
  fs.mkdirSync(path.dirname(stagingFile()), { recursive: true });
  fs.writeFileSync(stagingFile(), Buffer.alloc(fs.statSync(tgz).size, 7));   // the right size, the wrong bytes
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download, integrity, prove: ok, manifest: withSize(tgz),
      codexRunning: () => Promise.resolve(false) });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /did not match its published checksum/);
    assert.equal(download.calls, 0, 'PRECONDITION: the kept file was the one checked');
    assert.equal(fs.existsSync(stagingFile()), false, 'the wrong bytes are deleted, so the next look downloads fresh');
    assert.equal(marker(), before); assert.equal(isOldTree(), true);
  } finally { clear(); try { fs.rmSync(stagingFile(), { force: true }); } catch { /* gone */ } }
});

test('win32: a caller that just checked (agentsCheckedIdle) skips only the first look; the pre-swap look still runs', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  let asks = 0;
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok, agentsCheckedIdle: true,
      codexRunning: () => { asks += 1; return Promise.resolve(true); } });
    await job.settled;
    assert.equal(asks, 1, 'asked once, before the unpack (its first look skipped)');
    assert.equal(job.phase, 'failed'); assert.equal(job.waited, true, 'and that look still stops the swap');
    assert.equal(isOldTree(), true);
  } finally { clear(); try { fs.rmSync(stagingFile(), { force: true }); } catch { /* gone */ } }
});

test('win32: what the screen reads after a wait is the runner present and no failed job (a wait never shows as a failure)', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
      codexRunning: () => Promise.resolve(true) });
    await job.settled;
    assert.equal(job.phase, 'failed', 'PRECONDITION: the job ended as a wait');
    const s = runners.status().openai;
    assert.equal(s.present, true, 'the older Codex still reads present (the install button shows only for a missing one)');
    assert.equal(s.job, null, 'a failed job beside a present runner is dropped, so no failure reaches the screen');
  } finally { clear(); }
});

test('win32: a check that throws counts as running (the old version stays)', { skip: WIN_ONLY }, async () => {
  plantOld();
  const { tgz, integrity } = winFixture();
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok,
      codexRunning: () => Promise.reject(new Error('CIM unavailable')) });
    await job.settled;
    assert.equal(job.phase, 'failed');
    assert.equal(job.waited, true, 'a wait, not a spent try');
    assert.equal(isOldTree(), true);
    assert.equal(runners.resolveBin('openai', { legacyBin: LEGACY }).present, true);
  } finally { clear(); }
});

test('win32: an agent that starts while the marker comes down is caught by the last look; the marker goes back', { skip: WIN_ONLY }, async () => {
  plantOld();
  const before = marker();
  const { tgz, integrity } = winFixture();
  const answers = [false, false, true];   // (first look skipped) idle before the unpack and the swap, an agent by the time the marker is down
  let markerAtLastLook;
  const optsSeen = [];
  try {
    const job = runners.install('openai', { legacyBin: LEGACY, download: downloadFrom(tgz), integrity, prove: ok, agentsCheckedIdle: true,
      codexRunning: (dir, opts) => { optsSeen.push(opts); if (answers.length === 1) markerAtLastLook = marker(); return Promise.resolve(answers.shift()); } });
    await job.settled;
    assert.equal(markerAtLastLook, null, 'PRECONDITION: the last look ran with the marker down');
    assert.deepEqual(optsSeen, [undefined, undefined, { deadlineMs: 5000 }], 'the marker-down look, and only it, has the short deadline');
    assert.equal(job.phase, 'failed'); assert.equal(job.waited, true);
    assert.equal(marker(), before, 'vouched for again');
    assert.equal(isOldTree(), true, 'nothing was set aside');
    const r = runners.resolveBin('openai', { legacyBin: LEGACY });
    assert.equal(r.present, true); assert.equal(r.stale, true);
    assert.equal(runners.installing('openai'), false, 'a wait is not an install in progress');
  } finally { clear(); try { fs.rmSync(stagingFile(), { force: true }); } catch { /* gone */ } }
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
    assert.ok(strays().some((f) => /^pkg\.new-\d+-failed-\d+$/.test(f)), 'the stuck new tree waits under a name the age-gated sweep removes');
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
  // A folder that is not there runs nothing: false, not "no answer".
  assert.equal(await runners.managedProcessRunning(path.join(SANDBOX, 'never-made')), false);
  // A deadline too short for PowerShell to answer is no answer (null, read as running), never "nothing running".
  assert.equal(await runners.managedProcessRunning(path.dirname(process.execPath), { deadlineMs: 1 }), null);
});

test('win32: the check sees a running program when the folder is given by its 8.3 short name', { skip: WIN_ONLY }, async (t) => {
  const long = path.join(SANDBOX, 'a long runner folder name');
  fs.mkdirSync(long, { recursive: true });
  const exe = path.join(long, 'codex.exe');
  fs.copyFileSync(process.execPath, exe);
  // The folder's 8.3 name, asked of Windows (the path rides in the environment, so no quoting can change it).
  const short = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::Out.Write((New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:KOSMOS_LONG_DIR).ShortPath)'],
  { encoding: 'utf8', env: { ...process.env, KOSMOS_LONG_DIR: long } }).trim();
  if (!short || short.toLowerCase() === long.toLowerCase()) { t.skip('8.3 names are off on this volume'); return; }
  const hold = (file) => spawn(file, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  const settle = () => new Promise((r) => setTimeout(r, 500));
  let child = hold(exe);
  try {
    await settle();
    assert.equal(await runners.managedProcessRunning(short), true, `started by its long name, asked by ${short}`);
    assert.equal(await runners.managedProcessRunning(long), true);
    child.kill(); await settle();
    // The other way round, the case the code comment names: started by the short name, asked by the long one.
    child = hold(path.join(short, 'codex.exe'));
    await settle();
    assert.equal(await runners.managedProcessRunning(long), true, `started by ${short}, asked by its long name`);
    assert.equal(await runners.managedProcessRunning(short), true);
    child.kill(); await settle();
    // A REAL sibling that shares the prefix, with a program running in it, is not the folder.
    const sibling = `${long}-old`;
    fs.mkdirSync(sibling, { recursive: true });
    fs.copyFileSync(process.execPath, path.join(sibling, 'codex.exe'));
    child = hold(path.join(sibling, 'codex.exe'));
    await settle();
    assert.equal(await runners.managedProcessRunning(sibling), true, 'PRECONDITION: the sibling program is seen');
    assert.equal(await runners.managedProcessRunning(long), false, 'a running sibling is not the folder');
  } finally { child.kill(); await settle(); }
});
