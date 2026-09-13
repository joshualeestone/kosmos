'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * win32-update-arm (updater slice S4): the engine that arms the Windows in-app updater.
 *
 * Every network/scheduler/filesystem edge is sandboxed or seamed, so nothing real downloads, swaps,
 * or calls schtasks. The arms that touch the win32 anchor on disk are gated to a win32 host (the
 * anchor path uses the win32 joiner, which is not a real path on the macOS CI box); everything else
 * runs on either OS.
 *
 *   node --test engine/update.win32-arm.test.js
 */

// Sandbox the data root (and thus the anchor) before requiring anything that freezes it.
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win32arm-'));

const update = require('./update');
const platform = require('./platform');
const win32anchor = require('./win32anchor');
const win32apply = require('./win32apply');
const { version: RUNNING } = require('../package.json');

const ARCH = process.arch;
const NEWER = '99.0.0';
const BUNDLE = 'C:\\Users\\someone\\Kosmos';
const ONEDRIVE = 'C:\\Users\\someone\\OneDrive';
const PROGFILES = 'C:\\Program Files';
const WIN_ONLY = process.platform !== 'win32' ? { skip: 'the win32 anchor path is not a real path on this host' } : {};
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'];
let savedEnv = {};

function winManifest(version) {
  return { version, sha256: 'ab'.repeat(32), artifact: `kosmos-win-${ARCH}.zip`, versioned: `kosmos-${version}-win-${ARCH}.zip`, arch: ARCH };
}
const winFetch = (version) => (async () => ({ ok: true, json: async () => winManifest(version) }));
/** Land a manifest in the cache, so available()/installOffer()/manualOffer() have something to read. */
async function look(version) {
  update.setFetcher(winFetch(version));
  await update.refresh().catch(() => {});
}
const tick = () => new Promise((r) => setTimeout(r, 15));

test.beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  update.resetCache();
  update.setBase(null);
  update.setPlatform('win32');
  update.setWindowsBundleRoot(() => BUNDLE);
  update.setInstalledRoot(() => BUNDLE);
  update.setWindowsInstaller(null);
  update.setBoardContext({ port: null, pid: null });
  update.setAutoPref(() => ({ on: false, ok: true }));
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  update.resetCache();
  update.setFetcher(null);
  update.setPlatform(null);
  update.setWindowsBundleRoot(null);
  update.setInstalledRoot(null);
  update.setWindowsInstaller(null);
  update.setBoardContext({ port: null, pid: null });
  update.setAutoPref(null);
});

/* ── installedRoot / the source-checkout guard ─────────────────────────────────────────────── */

test('installedRoot: win32 returns the running bundle root, and null off a bundle', () => {
  update.setInstalledRoot(null);   // exercise the real win32 arm, not the seam
  update.setWindowsBundleRoot(() => BUNDLE);
  assert.equal(update.installedRoot(), BUNDLE, 'the win32 arm did not return the bundle root');
  update.setWindowsBundleRoot(() => null);
  assert.equal(update.installedRoot(), null, 'a non-bundle (source checkout) layout must be null');
});

test('THE SOURCE-CHECKOUT GUARD: this box, with no seams, cannot self-install', () => {
  /* With no bundle-root seam, installedRoot() asks the real win32board.bundleRoot(), which is null
     for a board running from a source checkout (this dev box runs from src\kosmos\engine). A null
     installedRoot is what keeps beginInstall's win32 arm and maybeAutoInstall off a working tree. */
  update.setInstalledRoot(null);
  update.setWindowsBundleRoot(null);
  update.setPlatform(null);   // read this real process's platform
  assert.equal(update.installedRoot(), null, 'a source-checkout board reported an installable root -- it could self-install over its own tree');
});

/* ── the OneDrive / Program Files rule (decision 5) ─────────────────────────────────────────── */

test('decision 5: the one named location rule refuses OneDrive and Program Files, by env var AND path', () => {
  // OneDrive: the variable set AND the root inside it.
  update.setWindowsBundleRoot(() => ONEDRIVE + '\\Kosmos');
  process.env.OneDrive = ONEDRIVE;
  const od = update.windowsLocationRefusal();
  assert.ok(od && /OneDrive/.test(od), 'a bundle under OneDrive was not refused');

  // Program Files, via a different variable name, path inside.
  delete process.env.OneDrive;
  update.setWindowsBundleRoot(() => PROGFILES + '\\Kosmos');
  process.env.ProgramFiles = PROGFILES;
  const pf = update.windowsLocationRefusal();
  assert.ok(pf && /Program Files/.test(pf), 'a bundle under Program Files was not refused');

  // The variable set but the bundle OUTSIDE it: not refused (path-inside, not mere presence).
  update.setWindowsBundleRoot(() => BUNDLE);
  process.env.OneDrive = ONEDRIVE;   // set, but BUNDLE is not inside it
  assert.equal(update.windowsLocationRefusal(), null, 'a normal bundle was refused just because OneDrive is installed');

  // A normal bundle with nothing set, and the Mac, are never refused.
  delete process.env.OneDrive; delete process.env.ProgramFiles;
  assert.equal(update.windowsLocationRefusal(), null, 'a normal armed bundle was refused');
  update.setPlatform('darwin');
  assert.equal(update.windowsLocationRefusal(), null, 'the Mac has no location rule');
});

test('the offer split: a normal bundle offers in-app, a refused location offers the manual download', async () => {
  await look(NEWER);
  assert.deepEqual(update.installOffer(), { version: NEWER }, 'a normal armed bundle does not offer the in-app update');
  assert.equal(update.manualOffer(), null, 'a normal armed bundle offered the manual download too');

  update.setWindowsBundleRoot(() => ONEDRIVE + '\\Kosmos');
  update.setInstalledRoot(() => ONEDRIVE + '\\Kosmos');
  process.env.OneDrive = ONEDRIVE;
  assert.equal(update.installOffer(), null, 'a OneDrive bundle offered an [Update] that would only fail');
  assert.deepEqual(update.manualOffer(), { version: NEWER, download: `https://installkosmos.com/dist/kosmos-${NEWER}-win-${ARCH}.zip` },
    'a OneDrive bundle did not fall back to the manual download');
});

/* ── beginInstall routes win32 to win32update.begin ─────────────────────────────────────────── */

test('beginInstall win32: hands the running bundle root and board context to the updater', async () => {
  update.setBoardContext({ port: 16999, pid: 4242 });
  let seen = null;
  update.setWindowsInstaller(async (o) => { seen = o; return { ok: true }; });
  update.beginInstall({});
  await tick();
  assert.ok(seen, 'beginInstall did not reach the win32 in-app updater');
  assert.equal(seen.root, BUNDLE, 'the running bundle root was not handed to the updater');
  assert.equal(seen.port, 16999, 'the board port was not handed to the updater');
  assert.equal(seen.boardPid, 4242, 'the board pid was not handed to the updater');
  assert.equal(update.alreadyInstalling(), true, 'on success single-flight stays held: the board is about to be stopped');
});

test('beginInstall win32: a refusal releases single-flight and records the sentence; auto arms the backoff', async () => {
  update.setWindowsInstaller(async () => ({ ok: false, because: 'the board was not started by its Windows logon job' }));
  update.beginInstall({ auto: true });
  await tick();
  assert.equal(update.alreadyInstalling(), false, 'a refusal left single-flight set, so every retry would answer already-updating');
  assert.match(update.lastAttempt().because, /logon job/, 'the refusal was not recorded on the attempt');

  /* The backoff is armed: an immediate auto retry does not fire the updater again. */
  let calls = 0;
  update.setWindowsInstaller(async () => { calls += 1; return { ok: false, because: 'still refused' }; });
  await look(NEWER);   // refresh() -> maybeAutoInstall(); autoPref is off, so it would not fire anyway
  update.setAutoPref(() => ({ on: true, ok: true }));
  update.refresh && (await update.refresh().catch(() => {}));
  await tick();
  assert.equal(calls, 0, 'the hourly backoff did not hold an auto retry after a failure');
});

test('beginInstall win32: a thrown updater is caught, single-flight released, failure recorded', async () => {
  update.setWindowsInstaller(async () => { throw new Error('boom'); });
  update.beginInstall({});
  await tick();
  assert.equal(update.alreadyInstalling(), false, 'a throw left single-flight set');
  assert.match(update.lastAttempt().because, /boom/, 'a thrown updater was not recorded');
});

/* ── maybeAutoInstall: the SAME policy as the Mac ──────────────────────────────────────────── */

test('maybeAutoInstall win32: default ON installs; off, backoff and single-flight each suppress', async () => {
  // Default ON: autoupdate missing => ON. A newer look drives refresh() -> maybeAutoInstall.
  let autoCalls = [];
  update.setWindowsInstaller(async (o) => { autoCalls.push(o); return { ok: true }; });
  update.setAutoPref(() => ({ on: true, ok: true }));
  await look(NEWER);
  await tick();
  assert.equal(autoCalls.length, 1, 'auto ON did not install a newer build');

  // Off: the Settings switch suppresses it.
  update.resetCache();
  autoCalls = [];
  update.setAutoPref(() => ({ on: false, ok: true }));
  await look(NEWER);
  await tick();
  assert.equal(autoCalls.length, 0, 'the off switch did not suppress the auto install');

  // Corrupt reads OFF (autoupdate.js contract): also suppressed.
  update.resetCache();
  autoCalls = [];
  update.setAutoPref(() => ({ on: false, ok: false }));
  await look(NEWER);
  await tick();
  assert.equal(autoCalls.length, 0, 'a corrupt (OFF) preference installed anyway');

  // Single-flight: an install already in flight is not stacked.
  update.resetCache();
  autoCalls = [];
  update.setAutoPref(() => ({ on: true, ok: true }));
  update.setWindowsInstaller(async (o) => { autoCalls.push(o); return { ok: true }; });
  await look(NEWER);   // starts one (single-flight now held)
  await tick();
  await update.refresh().catch(() => {});   // a second look while one is in flight
  await tick();
  assert.equal(autoCalls.length, 1, 'a second look stacked a second installer');
});

test('never downgrade: a not-newer look makes no offer and never auto-installs', async () => {
  let calls = 0;
  update.setWindowsInstaller(async () => { calls += 1; return { ok: true }; });
  update.setAutoPref(() => ({ on: true, ok: true }));
  await look(RUNNING);   // the same version we run: not newer
  await tick();
  assert.equal(update.installOffer(), null, 'a not-newer build was offered for install');
  assert.equal(calls, 0, 'a not-newer build was auto-installed');
});

/* ── fail-closed integration: nothing real happens in a test process ───────────────────────── */

test('beginInstall win32 with the REAL updater: a test process (no live execution) never swaps', async () => {
  update.setWindowsInstaller(null);   // the real win32update.begin
  update.setInstalledRoot(() => fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-notbundle-')));   // not a real bundle
  update.beginInstall({ auto: true });
  await tick();
  assert.equal(update.alreadyInstalling(), false, 'the real updater left single-flight set in a test process');
  const att = update.lastAttempt();
  assert.ok(att && att.because, 'the real updater recorded no refusal');
  assert.equal(att.code, null, 'nothing ran, so there is no exit code to claim');
});

/* ── updatePhase and the win32 status record (win32 host only: the anchor path is win32-shaped) ─ */

test('updatePhase and the win32 status surface null when there is nothing to read, and null on the Mac', () => {
  // No journal / status yet in the sandbox anchor.
  const anchor = win32anchor.anchorDir('win32', os.homedir(), process.env);
  try { fs.rmSync(path.join(anchor, win32anchor.UPDATE_JOURNAL_NAME), { force: true }); } catch { /* none */ }
  try { fs.rmSync(path.join(anchor, win32anchor.UPDATE_STATUS_NAME), { force: true }); } catch { /* none */ }
  assert.equal(update.updatePhase(), null, 'a phase appeared with no journal');
  assert.equal(update.lastAttempt(), null, 'a win32 attempt appeared with no status record');
  update.setPlatform('darwin');
  assert.equal(update.updatePhase(), null, 'the Mac has no win32 update phase');
});

test('the win32 status record: a failure surfaces as a failed attempt; a success seeds nothing', WIN_ONLY, () => {
  const anchor = win32anchor.anchorDir('win32', os.homedir(), process.env);
  fs.mkdirSync(anchor, { recursive: true });
  const statusAt = path.join(anchor, win32anchor.UPDATE_STATUS_NAME);

  // A failure outcome: surfaced with a non-zero code so a reader keys on it as a failure.
  fs.writeFileSync(statusAt, JSON.stringify({
    outcome: 'rolled-back', from: RUNNING, to: NEWER,
    sentence: 'The update did not take. Kosmos is still on ' + RUNNING + '.', because: 'a handle was held', at: new Date().toISOString(),
  }));
  const att = update.lastAttempt();
  assert.ok(att, 'the win32 failure status did not surface as an attempt');
  assert.equal(att.code, 1, 'a failure must read as a non-zero code');
  assert.match(att.because, /did not take/, 'the failure sentence was not carried');

  // A success seeds nothing: the board came back on the new version, read from the version change.
  fs.writeFileSync(statusAt, JSON.stringify({ outcome: 'updated', from: RUNNING, to: NEWER, sentence: 'Kosmos is now on ' + NEWER + '.', at: new Date().toISOString() }));
  assert.equal(update.lastAttempt(), null, 'a successful update seeded a phantom attempt');
  fs.rmSync(statusAt, { force: true });
});

test('updatePhase reads the journal phase from a real staged journal', WIN_ONLY, () => {
  const anchor = win32anchor.anchorDir('win32', os.homedir(), process.env);
  fs.mkdirSync(anchor, { recursive: true });
  const journalAt = win32apply.journalPathFor(anchor);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-jroot-'));
  /* The journal records the engine pointer's current text, so the pointer must exist for a valid one
     (journalProblem refuses a journal that "names no engine pointer"). */
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), path.join(root, 'app', 'engine'));
  try {
    win32apply.writeStagedJournal(journalAt, {
      root, anchor,
      prepared: {
        version: NEWER, expectedIdentity: 'kosmos:default', sha256: 'ab'.repeat(32), runtimeChanged: false,
        stagedDir: path.join(root, '.kosmos-update', 'staged'),
      },
      fromVersion: RUNNING, fromIdentity: 'kosmos:default', board: { pid: 1, port: 16180 }, now: Date.now(),
    });
    assert.equal(update.updatePhase(), 'staged', 'the journal phase did not surface');
  } finally {
    try { fs.rmSync(journalAt, { force: true }); } catch { /* best effort */ }
  }
});
