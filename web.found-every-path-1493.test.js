'use strict';

/**
 * #2497 (Josh, 2026-09-08, watching Ben + Nacho test): onboarding no longer auto-scans or
 * auto-imports. First run ALWAYS lands on the no-agent "Create your first agent." / "Giddy Up"
 * screen, whatever the engine's path (adopt/create/unknown) or fleetCount, and fires NO discovery.
 *
 *   node --test web.found-every-path-1493.test.js
 *
 * 🛑 THIS FILE SUPERSEDES #1493/#1938/#2389's "look on the disk on every path" behavior.
 * frPaintFleet used to fork on `path` and, on every arm, auto-fire the disk scan (frScanAgents ->
 * /api/scan-agents or the granted /api/scan-import) and render a found/Add-Skip list when
 * candidates existed. Josh reversed that for onboarding: a developer's many tmux Claude Code
 * sessions filled first run with garbage throwaway agents. frPaintFleet now short-circuits to the
 * create/Giddy Up empty state at the top, before any discovery, so none of the old per-path scan
 * behavior runs during onboarding. The discovery ENGINE is intact (the arms are kept-but-bypassed;
 * the manual Import Agent path #1652 reaches the disk via /api/scan-import), only its automatic
 * invocation on first run is gone.
 *
 * These RUN the real lifted frPaintFleet (not a source match), because the claim is about which
 * branch is taken: the forced create/Giddy Up render, and NO discovery call, on every path.
 * The real first-run screen is additionally covered on the wired page by render-first-run.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync('web/index.html', 'utf8'));
/* frPaintFleet references the disk-scan state (FR_SCAN) and helpers even in the kept-but-bypassed
   arms below its early return; the pure reads (frFoundOffer/frScanOffer/frImportOffer) are lifted
   so the lifted body parses, and the impure helpers (frFindAgents/frScanAgents/frPaintFound/
   frPaintScan/frArmRescanOnGrant/frActions/frForkActions) are injected as call-recording stubs.
   The #2497 forced return runs before any of them, so on the new behavior only frActions fires. */
const BODY = lift(SCRIPT, 'frFoundOffer') + '\n' + lift(SCRIPT, 'frScanOffer') + '\n' + lift(SCRIPT, 'frImportOffer') + '\n' + lift(SCRIPT, 'frPaintFleet');

/* ⚠️ THIS HARNESS LIFTS frPaintFleet OUT OF ITS MODULE (Splinter, 2026-09-02): it measures the
   branch logic, not the wired page. The real first-run landing is covered on the actual document
   by render-first-run.js. `frActions`'s `go` closure (() => frFinish(openCreate)) is created but
   never invoked here, so frFinish/openCreate need not be injected. */
function paint(FR, FR_FOUND, FR_SCAN, FR_SCAN_INFLIGHT) {
  const scan = FR_SCAN === undefined ? { ok: true, candidates: [] } : FR_SCAN;
  const inflight = FR_SCAN_INFLIGHT === undefined ? false : FR_SCAN_INFLIGHT;
  const els = {};
  const mk = (id) => (els[id] = { id, textContent: '', innerHTML: '', hidden: false, focus() {} });
  const calls = [];
  const fn = new Function('document', 'FR', 'FR_FOUND', 'FR_SCAN', 'FR_MACHINE', 'FR_STEP', 'FR_STEP_YOU',
    'frPaintFound', 'frPaintScan', 'frActions', 'frForkActions', 'frFindAgents', 'frScanAgents', 'frArmRescanOnGrant', 'esc', 'pjSentence', 'FR_SCAN_INFLIGHT',
    BODY + '\nreturn frPaintFleet();');
  fn({ getElementById: (id) => els[id] || mk(id) }, FR, FR_FOUND, scan, null, 6, 3,
    () => calls.push('PAINT-FOUND'), () => calls.push('PAINT-SCAN'), () => calls.push('actions'),
    () => calls.push('fork'), () => calls.push('SEARCH'), () => calls.push('SCAN-SEARCH'),
    () => calls.push('ARM-RESCAN'), String, String, inflight);
  return {
    calls,
    title: (els['fr-fleet-title'] || {}).textContent || '',
    box: (els['fr-fleet'] || {}).innerHTML || '',
  };
}

/** Every discovery/found stub the onboarding auto-import used; NONE may fire on first run now. */
const DISCOVERY = ['SEARCH', 'SCAN-SEARCH', 'PAINT-FOUND', 'PAINT-SCAN', 'ARM-RESCAN'];
function assertGiddyUpNoScan(r, where) {
  assert.equal(r.title, 'Create your first agent.', `${where}: first run did not land on the create heading`);
  assert.match(r.box, /Let’s get started\./, `${where}: the Giddy Up copy is gone`);
  assert.ok(r.calls.includes('actions'), `${where}: the Giddy Up action was not rendered (calls: ${r.calls})`);
  for (const d of DISCOVERY) {
    assert.ok(!r.calls.includes(d), `${where}: onboarding still runs discovery (${d}) on first run (calls: ${r.calls})`);
  }
}

/* A machine that DOES have agents, on disk and as scan candidates: before #2497 this rendered the
   found/Add-Skip list; now it must still land on Giddy Up with nothing pulled in. */
const onDisk = { ok: true, agents: [{ name: 'Hers', dir: '/Users/x/work/hers' }] };
const withCandidates = { ok: true, candidates: [{ name: 'Garbage', dir: '/Users/x/Downloads/garbage' }] };

test('#2497: the ADOPT path (a running fleet) lands on Giddy Up, no auto-scan, no found list', () => {
  assertGiddyUpNoScan(paint({ path: 'adopt', fleetCount: 13, fleetNames: ['Splinter', 'Angel'] }, onDisk, withCandidates), 'adopt');
});

test('#2497: the CREATE path (no fleet) lands on Giddy Up, no auto-scan', () => {
  assertGiddyUpNoScan(paint({ path: 'create', fleetCount: 0, fleetNames: [] }), 'create');
});

test('#2497: the UNKNOWN path (roster unreadable) lands on Giddy Up, no auto-scan', () => {
  assertGiddyUpNoScan(paint({ path: 'unknown', fleetCount: null, fleetNames: [] }, onDisk, withCandidates), 'unknown');
});

test('#2497: even with agents on disk AND scan candidates, the found list is never shown on first run', () => {
  // The whole point: a dev box full of throwaway agents used to fill this screen. It must not.
  const r = paint({ path: 'adopt', fleetCount: 5 }, onDisk, withCandidates);
  assert.ok(!r.calls.includes('PAINT-SCAN') && !r.calls.includes('PAINT-FOUND'),
    `first run rendered a found/scan list from real candidates (calls: ${r.calls})`);
  assertGiddyUpNoScan(r, 'adopt-with-candidates');
});

test('#2497: malformed/absent payloads still land on Giddy Up rather than crashing or scanning', () => {
  for (const FR of [null, {}, { path: 'adopt' }, { path: 'nonsense', fleetCount: 3 }, { path: 'unknown', fleetCount: 'lots' }]) {
    assertGiddyUpNoScan(paint(FR), 'malformed:' + JSON.stringify(FR));
  }
});
