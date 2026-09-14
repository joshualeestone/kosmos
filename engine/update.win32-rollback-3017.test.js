'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * win32-update-rollback (updater slice S5, #3017): the engine wiring for the user-initiated "Roll
 * back" button -- rollbackOffer() (the kept-previous-build offer the card paints) and beginRollback()
 * (the single-flighted, witnessed call into win32update.rollbackToPrevious).
 *
 * Every edge is seamed, so nothing real reads the anchor, swaps a build, or calls schtasks; the whole
 * file runs on either OS (the rollback offer/begin arms take a seamed kept build and a seamed rollback
 * fn, neither of which touches a win32-only path).
 *
 *   node --test engine/update.win32-rollback-3017.test.js
 */

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win32rb-'));

const update = require('./update');

const BUNDLE = 'C:\\Users\\someone\\Kosmos';
const ONEDRIVE = 'C:\\Users\\someone\\OneDrive';
const PREV = '0.6.50';
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'];
let savedEnv = {};
const tick = () => new Promise((r) => setTimeout(r, 15));

test.beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  update.resetCache();
  update.setBase(null);
  update.setPlatform('win32');
  update.setWindowsBundleRoot(() => BUNDLE);
  update.setInstalledRoot(() => BUNDLE);
  update.setKeptPreviousBuild(() => ({ dir: BUNDLE + '\\.kosmos-update\\previous-' + PREV, version: PREV }));
  update.setWindowsRollback(null);
  update.setWindowsInstaller(null);
  update.setWindowsHelperWitnessMs(null);
  update.setBoardContext({ port: null, pid: null });
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  update.resetCache();
  update.setPlatform(null);
  update.setWindowsBundleRoot(null);
  update.setInstalledRoot(null);
  update.setKeptPreviousBuild(null);
  update.setWindowsRollback(null);
  update.setWindowsInstaller(null);
  update.setWindowsHelperWitnessMs(null);
  update.setBoardContext({ port: null, pid: null });
});

/* ── rollbackOffer ─────────────────────────────────────────────────────────────────────────── */

test('rollbackOffer: the kept previous build\'s version, or null off win32 / source / a refused location', () => {
  assert.deepEqual(update.rollbackOffer(), { version: PREV }, 'a kept build should be offered');

  update.setInstalledRoot(() => null);            // a source checkout
  assert.equal(update.rollbackOffer(), null, 'a source run offers no rollback');
  update.setInstalledRoot(() => BUNDLE);

  update.setKeptPreviousBuild(() => null);        // nothing kept
  assert.equal(update.rollbackOffer(), null, 'no kept build, no offer');
  update.setKeptPreviousBuild(() => ({ dir: BUNDLE + '\\x', version: PREV }));

  update.setPlatform('darwin');                   // never on the Mac
  assert.equal(update.rollbackOffer(), null, 'the Mac has no in-app rollback');
  update.setPlatform('win32');

  update.setWindowsBundleRoot(() => ONEDRIVE + '\\Kosmos');   // a refused location
  process.env.OneDrive = ONEDRIVE;
  assert.equal(update.rollbackOffer(), null, 'a OneDrive bundle whose swap is refused offers no rollback');
});

test('rollbackOffer: a kept-build lookup that throws is swallowed to null (never breaks the poll)', () => {
  update.setKeptPreviousBuild(() => { throw new Error('boom'); });
  assert.equal(update.rollbackOffer(), null);
});

/* ── beginRollback ─────────────────────────────────────────────────────────────────────────── */

test('beginRollback: hands the running bundle root and board context to the rollback entrypoint', async () => {
  update.setBoardContext({ port: 16999, pid: 4242 });
  let seen = null;
  update.setWindowsRollback(async (o) => { seen = o; return { ok: true }; });
  update.beginRollback();
  await tick();
  assert.ok(seen, 'beginRollback did not reach win32update.rollbackToPrevious');
  assert.equal(seen.root, BUNDLE);
  assert.equal(seen.port, 16999);
  assert.equal(seen.boardPid, 4242);
  assert.equal(update.alreadyInstalling(), true, 'on success single-flight stays held: the board is about to be stopped');
});

test('beginRollback: shares the update single-flight -- an update in progress blocks a rollback', async () => {
  let calls = 0;
  update.setWindowsInstaller(async () => { calls += 1; return { ok: true }; });
  update.setWindowsRollback(async () => { calls += 1; return { ok: true }; });
  update.beginInstall({});           // takes the flag
  await tick();
  update.beginRollback();            // must not start while an install holds it
  await tick();
  assert.equal(calls, 1, 'a rollback started while an install was in flight');
});

test('beginRollback: a refusal releases single-flight and records the sentence', async () => {
  update.setWindowsRollback(async () => ({ ok: false, because: 'there is no earlier Kosmos kept to roll back to' }));
  update.beginRollback();
  await tick();
  assert.equal(update.alreadyInstalling(), false, 'a refusal left single-flight set');
  assert.match(update.lastAttempt().because, /no earlier Kosmos kept/, 'the refusal was not recorded on the attempt');
});

test('beginRollback: a thrown entrypoint is caught, single-flight released, failure recorded', async () => {
  update.setWindowsRollback(async () => { throw new Error('boom'); });
  update.beginRollback();
  await tick();
  assert.equal(update.alreadyInstalling(), false, 'a throw left single-flight set');
  assert.match(update.lastAttempt().because, /boom/, 'a thrown entrypoint was not recorded');
});

test('FIX2: inFlightKind reports which operation holds the single-flight, and null when none does', async () => {
  assert.equal(update.inFlightKind(), null, 'nothing running, so no operation');
  update.setWindowsRollback(async () => ({ ok: true }));
  update.beginRollback();
  await tick();
  assert.equal(update.inFlightKind(), 'rollback', 'a rollback holds the flag, so an Update press can be told the truth');
  update.resetCache();
  update.setPlatform('win32');
  update.setInstalledRoot(() => BUNDLE);
  update.setWindowsInstaller(async () => ({ ok: true }));
  update.beginInstall({});
  await tick();
  assert.equal(update.inFlightKind(), 'update', 'a forward update holds the flag, so a Roll back press can be told the truth');
});

test('beginRollback: a helper that spawns then dies before stopping the board releases single-flight', async () => {
  /* The rollback reuses the forward path's detached-helper witness: on {ok:true} the flag is held for
     the helper to stop this board; if the journal never leaves absent/'staged' inside the witness
     window, the helper died before the swap and the flag is released. windowsJournalRead reads the
     real (seamed-away) anchor, which has no journal here, so it reads 'none' -> release. */
  update.setWindowsHelperWitnessMs(60);
  update.setWindowsRollback(async () => ({ ok: true }));
  update.beginRollback();
  await tick();
  assert.equal(update.alreadyInstalling(), true, 'while the witness window is open, single-flight is still held');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(update.alreadyInstalling(), false, 'the witness did not release a helper that died before stopping the board');
  assert.match(update.lastAttempt().because, /stopped before it could stop the board/, 'the stranded-flag release was not recorded');
});
