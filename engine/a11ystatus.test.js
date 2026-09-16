'use strict';
/**
 * a11ystatus: the engine's read side of the native Accessibility verdict (#2125
 * slice 3). The load-bearing property is the THREE-answers discipline: "the app
 * says NOT trusted" must be distinguishable from "we cannot check at all", because
 * the gate blocks only on the FORMER and must never false-block a browser (the
 * latter) nor let a UI claim a state nobody measured.
 *
 *   node --test engine/a11ystatus.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-a11y-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const a11y = require('./a11ystatus');

function write(obj) {
  fs.mkdirSync(path.dirname(a11y.FILE), { recursive: true });
  fs.writeFileSync(a11y.FILE, JSON.stringify(obj));
}
function clear() { try { fs.rmSync(a11y.FILE, { force: true }); } catch { /* */ } }

test('no file at all -> checkable:false (a browser / not-yet-checked), NOT trusted:false', () => {
  clear();
  const r = a11y.read();
  assert.equal(r.checkable, false);
  assert.equal(r.trusted, undefined, 'must not claim a trusted verdict when nothing was measured');
});

test('a fresh trusted verdict -> checkable:true, trusted:true', () => {
  write({ trusted: true, at: new Date().toISOString() });
  const r = a11y.read();
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, true);
});

test('a fresh NOT-trusted verdict -> checkable:true, trusted:false (the only state that gates)', () => {
  write({ trusted: false, at: new Date().toISOString() });
  const r = a11y.read();
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
});

test('THE DISCRIMINATOR: not-trusted and uncheckable are different answers', () => {
  write({ trusted: false, at: new Date().toISOString() });
  const gated = a11y.read();
  clear();
  const uncheckable = a11y.read();
  // The gate blocks on `gated` (checkable && !trusted) and NOT on `uncheckable`.
  assert.equal(gated.checkable && gated.trusted === false, true, 'this one gates');
  assert.equal(uncheckable.checkable, false, 'this one does NOT gate (fail-safe)');
});

test('a stale verdict falls back to uncheckable (the app is not maintaining it)', () => {
  write({ trusted: true, at: new Date(Date.now() - (a11y.STALE_AFTER_MS + 1000)).toISOString() });
  const r = a11y.read();
  assert.equal(r.checkable, false, 'a days-old reading must not gate on or vouch for anything');
});

test('a malformed verdict (no boolean trusted) -> uncheckable, never a throw', () => {
  write({ trusted: 'yes', at: new Date().toISOString() });
  assert.equal(a11y.read().checkable, false);
  write({ at: new Date().toISOString() });
  assert.equal(a11y.read().checkable, false);
  fs.writeFileSync(a11y.FILE, 'not json');
  assert.equal(a11y.read().checkable, false);
});

test('a verdict with no readable time -> uncheckable (cannot judge freshness)', () => {
  write({ trusted: true, at: 'whenever' });
  assert.equal(a11y.read().checkable, false);
});

/* ---------------------------------------------------------------------------
   #2085: tmuxGrant() reads TMUX's OWN path-keyed Accessibility grant from the
   system TCC db. (It was #2085's attempt to replace read() under the belief that
   tmux held the grant; #2451 restored read() as the /api/a11y-status route reader,
   because accessibility is keyed on the CALLING binary = the kosmos-app, which is
   the gate's correct subject. tmuxGrant stays covered here for a possible
   #2125-KEEP tmux-identity path.) The load-bearing invariant is NEVER A FALSE
   GREEN: only a real auth_value >= 2 for the tmux binary yields trusted:true;
   every failure path falls to checkable:false ("Checking...").
--------------------------------------------------------------------------- */

// A mocked sqlite runner so the branch logic is deterministic without a db. The
// runner returns {ok, rows:[{client, auth}]} for tmux-shaped clients (the real
// runner does a LIKE '%/tmux'); tmuxGrant matches the exact resolved path in JS.
const rowsRunner = (rows) => () => ({ ok: true, rows });
const failRunner = (because) => () => ({ ok: false, because: because || 'nope' });

test('#2085 tmuxGrant: THIS tmux granted (auth 2) -> checkable:true, trusted:true (the honest green)', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([{ client: '/fake/tmux', auth: 2 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, true);
  assert.equal(typeof r.at, 'string');
});

test('#2085 tmuxGrant: auth 3 (allowed, limited) also -> trusted:true', () => {
  assert.equal(a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([{ client: '/fake/tmux', auth: 3 }]) }).trusted, true);
});

test('#2085 tmuxGrant: THIS tmux present but denied (auth 0) -> checkable:true, trusted:false (Not activated, Turn On)', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([{ client: '/fake/tmux', auth: 0 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
});

test('#2085 tmuxGrant: NO tmux granted anywhere -> trusted:false (honest fresh-install Turn On), never a false green', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false, 'no grant anywhere must read as NOT granted (actionable), never activated');
});

test('#2085 tmuxGrant: ANOTHER tmux granted but not ours (path-key mismatch) -> checkable:false, NOT a strand and NOT a false green', () => {
  // The reviewer's strand case: a tmux holds the grant, but under a different path
  // than the binary we resolve. Must NOT block Next with a false "Not activated"
  // (that strands a granted user) and must NOT claim green (it is not OUR tmux) ->
  // the non-committal "Checking..." state (checkable:false) is the honest answer.
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/bundled/tmux', sqliteRunner: rowsRunner([{ client: '/opt/homebrew/Cellar/tmux/3.6a/bin/tmux', auth: 2 }]) });
  assert.equal(r.checkable, false, 'an ambiguous other-tmux grant must be cannot-check, not a blocking "Not activated"');
  assert.equal(r.trusted, undefined, 'and never a false green off a tmux that is not ours');
});

// ---- #2911: the `present` flag (listed-but-off blocks; not-listed is advisory) ----
test('#2911 tmuxGrant: a granted tmux row carries present:true', () => {
  assert.equal(a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([{ client: '/fake/tmux', auth: 2 }]) }).present, true);
});

test('#2911 tmuxGrant: our tmux row present but OFF (auth 0) -> present:true (the user CAN toggle it -> the gate may block, not a trap)', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([{ client: '/fake/tmux', auth: 0 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
  assert.equal(r.present, true, 'a listed-but-off tmux is actionable, so present:true -> blocking Next is correct, not a trap');
});

test('#2911 tmuxGrant: tmux NOT listed at all -> present:false (nothing to toggle; the route maps this to advisory, never a trap)', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: rowsRunner([]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
  assert.equal(r.present, false, 'no row for our tmux binary -> present:false, so /api/tmux-a11y-status advises (non-blocking) instead of trapping');
});

test('#2911 tmuxGrant: a checkable:false verdict (path-mismatch) carries no present field', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/bundled/tmux', sqliteRunner: rowsRunner([{ client: '/opt/homebrew/bin/tmux', auth: 2 }]) });
  assert.equal(r.checkable, false);
  assert.equal(r.present, undefined, 'present is only meaningful on a checkable verdict');
});

// ---- #3113 / #3075 item 5: tmuxGrant resolves the BUNDLED tmux env-independently ----
// The board's /api/tmux-a11y-status route can run inside the com.kosmos.board launchd
// job, which does NOT carry AGENT_WORKFORCE_TMUX_BIN. tmuxGrant must still resolve
// $installedRoot/tmux/bin/tmux (the bundled binary agents run under) rather than falling
// to homebrew and reading the wrong TCC row. These pin the fix: given ONLY
// opts.installedRoot (no tmuxBin, no env), it reads the bundled row.

// A temp install root carrying a real bundled tmux/bin/tmux the fix can stat + realpath.
function bundledInstallRoot() {
  // Under SANDBOX so it rides the file's exit-time cleanup (no per-call temp-dir leak).
  const root = fs.mkdtempSync(path.join(SANDBOX, 'installroot-'));
  const bin = path.join(root, 'tmux', 'bin', 'tmux');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
  return { root, real: fs.realpathSync(bin) };
}

test('#3113 THE REGRESSION (env-independent): bundled tmux granted, NO other tmux row -> resolved and read as green', () => {
  // This is the guard that fails without the fix on ANY machine, homebrew or not.
  // Pre-fix, with no AGENT_WORKFORCE_TMUX_BIN, binPaths resolved '/opt/homebrew/bin/tmux';
  // with only the BUNDLED row present, `exact` missed and `rows.some(granted)` was false,
  // so present:false -- but on a real install the bundled tmux IS granted, and reading
  // homebrew instead is exactly the wrong-subject read. The fix resolves the bundled
  // binary, so its own granted row is read: checkable:true, trusted:true, present:true.
  const { root, real } = bundledInstallRoot();
  const r = a11y.tmuxGrant({ installedRoot: root, sqliteRunner: rowsRunner([{ client: real, auth: 2 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, true);
  assert.equal(r.present, true);
});

test('#3113 a coexisting stray homebrew grant does not divert the read from OUR bundled tmux', () => {
  // A coexistence robustness check, NOT the primary regression guard: on a box with no
  // homebrew the pre-fix code realpath-fails on the '/opt/homebrew/bin/tmux' literal and
  // would match the stray row anyway, so its discriminating power is machine-dependent.
  // The env-independent guard is the test above; this pins that a stray grant alongside
  // the bundled one still resolves to the bundled row.
  const { root, real } = bundledInstallRoot();
  const r = a11y.tmuxGrant({
    installedRoot: root,
    sqliteRunner: rowsRunner([
      { client: '/opt/homebrew/bin/tmux', auth: 2 },   // a stray homebrew grant
      { client: real, auth: 2 },                         // OUR bundled tmux, granted
    ]),
  });
  assert.equal(r.checkable, true, 'the bundled tmux is resolved and read, not a cannot-check mismatch');
  assert.equal(r.trusted, true);
});

test('#3113 tmuxGrant: bundled tmux present but OFF (auth 0) -> present:true, Not activated + Turn On (never stuck on Checking)', () => {
  const { root, real } = bundledInstallRoot();
  const r = a11y.tmuxGrant({ installedRoot: root, sqliteRunner: rowsRunner([{ client: real, auth: 0 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
  assert.equal(r.present, true);
});

test('#3113 tmuxGrant: bundled tmux not listed at all -> present:false (advisory, never a trap)', () => {
  const { root } = bundledInstallRoot();
  const r = a11y.tmuxGrant({ installedRoot: root, sqliteRunner: rowsRunner([]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
  assert.equal(r.present, false);
});

test('#3113 opts.tmuxBin still takes precedence over the installedRoot resolution (test seam order)', () => {
  const { root, real } = bundledInstallRoot();   // a granted bundled tmux exists...
  // ...but an explicit tmuxBin must win, so the verdict reflects /fake/tmux (off), not
  // the bundled row (granted).
  const r = a11y.tmuxGrant({
    installedRoot: root,
    tmuxBin: '/fake/tmux',
    sqliteRunner: rowsRunner([{ client: real, auth: 2 }, { client: '/fake/tmux', auth: 0 }]),
  });
  assert.equal(r.present, true);
  assert.equal(r.trusted, false);
});

// ---- #2559: appGrant, the LIVE app-AX reader (previously untested) ----
test('#2559 appGrant: app row granted (auth 2) -> checkable:true, trusted:true (live green)', () => {
  const r = a11y.appGrant({ appSqliteRunner: rowsRunner([{ client: a11y.APP_CLIENT, auth: 2 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, true);
  assert.equal(typeof r.at, 'string');
});

test('#2559 appGrant: auth 3 (allowed, limited) also -> trusted:true', () => {
  assert.equal(a11y.appGrant({ appSqliteRunner: rowsRunner([{ client: a11y.APP_CLIENT, auth: 3 }]) }).trusted, true);
});

test('#2559 appGrant: app row present but denied (auth 0) -> checkable:true, trusted:false (Not activated)', () => {
  const r = a11y.appGrant({ appSqliteRunner: rowsRunner([{ client: a11y.APP_CLIENT, auth: 0 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
});

test('#2559 appGrant: app row ABSENT (db readable) -> checkable:true, trusted:false (honest fresh install, never granted)', () => {
  const r = a11y.appGrant({ appSqliteRunner: rowsRunner([]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false);
});

test('#2559 appGrant: a granted row for a DIFFERENT client is not our app -> trusted:false (never a false green off another app)', () => {
  const r = a11y.appGrant({ appSqliteRunner: rowsRunner([{ client: 'com.someone.else', auth: 2 }]) });
  assert.equal(r.checkable, true);
  assert.equal(r.trusted, false, 'appGrant grants only on OUR bundle id, never another granted client');
});

test('#2559 appGrant: a read failure (no FDA / locked / missing db) -> checkable:false, never a false verdict', () => {
  const r = a11y.appGrant({ appSqliteRunner: failRunner('no access') });
  assert.equal(r.checkable, false);
  assert.equal(r.trusted, undefined);
});

test('#2559 appGrant: a runner that THROWS is caught -> checkable:false, never a throw out', () => {
  const r = a11y.appGrant({ appSqliteRunner: () => { throw new Error('boom'); } });
  assert.equal(r.checkable, false);
});

test('#2085 tmuxGrant: a read failure -> checkable:false ("Checking..."), NEVER trusted:true', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: failRunner('no FDA') });
  assert.equal(r.checkable, false);
  assert.equal(r.trusted, undefined, 'a could-not-read must never manufacture a grant verdict');
});

test('#2085 tmuxGrant: a runner that THROWS is caught -> checkable:false, never a throw out', () => {
  const r = a11y.tmuxGrant({ tmuxBin: '/fake/tmux', sqliteRunner: () => { throw new Error('boom'); } });
  assert.equal(r.checkable, false);
});

test('#2085 tmuxGrant: an empty opts.tmuxBin FALLS BACK to the resolved default (does not crash)', () => {
  // '' is falsy, so it falls through the new installedRoot branch (which finds no
  // bundle on this from-source test box: update.installedRoot() -> null) to
  // create.binPaths().tmuxBin (the resolved default), not the "could not resolve" arm.
  // rowsRunner([]) (no grant) makes the verdict deterministic regardless of the path.
  const r = a11y.tmuxGrant({ tmuxBin: '', sqliteRunner: rowsRunner([]) });
  assert.equal(r.checkable, true, 'an empty tmuxBin should resolve via binPaths, not fail to ask');
  assert.equal(r.trusted, false);
});

test('#2085 tmuxGrant: real sqlite3 end-to-end against a TCC-shaped db (query + 3-way + schema-guard)', () => {
  const { execFileSync } = require('node:child_process');
  // Skip cleanly if sqlite3 is unavailable in this environment.
  let haveSqlite = true;
  try { execFileSync('/usr/bin/sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] }); }
  catch { haveSqlite = false; }
  if (!haveSqlite) return; // node --test reports this as a passing (empty) test

  const db = path.join(SANDBOX, 'tcc-test.db');
  try { fs.rmSync(db, { force: true }); } catch { /* */ }
  // Match the real schema (service/client/client_type/auth_value) so this
  // exercises the ACTUAL query the default runner builds (LIKE '%/tmux'), not a mock.
  execFileSync('/usr/bin/sqlite3', [db,
    "CREATE TABLE access(service TEXT NOT NULL, client TEXT NOT NULL, client_type INTEGER NOT NULL, auth_value INTEGER NOT NULL);"
    + "INSERT INTO access VALUES('kTCCServiceAccessibility','/fake/bundled/tmux',1,2);"
    + "INSERT INTO access VALUES('kTCCServiceAccessibility','/some/other/app',0,0);"]);

  // Granted tmux path -> trusted:true (DEFAULT runner: real sqlite3 + real query).
  const granted = a11y.tmuxGrant({ tmuxBin: '/fake/bundled/tmux', tccDb: db });
  assert.equal(granted.checkable, true);
  assert.equal(granted.trusted, true, 'a real auth_value 2 row for the tmux path was not read as granted');

  // A DIFFERENT tmux path while /fake/bundled/tmux IS granted -> ambiguous ->
  // checkable:false (never a false green off the granted-but-not-ours row, never a strand).
  const ambiguous = a11y.tmuxGrant({ tmuxBin: '/fake/other/tmux', tccDb: db });
  assert.equal(ambiguous.checkable, false, 'another-tmux-granted must be cannot-check, not a false green or a strand');

  // No tmux granted at all -> trusted:false (fresh-install Turn On). A granted
  // NON-tmux binary whose path merely CONTAINS "tmux" (tmuxinator) must NOT count
  // as "another tmux granted" (#9): the query ends in '/tmux', so tmuxinator is
  // excluded and the fresh path stays actionable (trusted:false), not ambiguous
  // (checkable:false). A '%tmux%' substring match would fail this assertion.
  const emptyDb = path.join(SANDBOX, 'tcc-empty.db');
  execFileSync('/usr/bin/sqlite3', [emptyDb,
    "CREATE TABLE access(service TEXT NOT NULL, client TEXT NOT NULL, client_type INTEGER NOT NULL, auth_value INTEGER NOT NULL);"
    + "INSERT INTO access VALUES('kTCCServiceAccessibility','/opt/homebrew/bin/tmuxinator',1,2);"]);
  const none = a11y.tmuxGrant({ tmuxBin: '/fake/bundled/tmux', tccDb: emptyDb });
  assert.equal(none.checkable, true, 'a granted tmuxinator must not push a fresh install into ambiguous cannot-check');
  assert.equal(none.trusted, false);

  // Schema drift / wrong db shape -> checkable:false (the guard), never a verdict.
  const bad = path.join(SANDBOX, 'tcc-bad.db');
  execFileSync('/usr/bin/sqlite3', [bad, 'CREATE TABLE unrelated(x INTEGER);']);
  const drifted = a11y.tmuxGrant({ tmuxBin: '/fake/bundled/tmux', tccDb: bad });
  assert.equal(drifted.checkable, false, 'a db without the access table must fall to checkable:false, not throw or vouch');
});

test('#2085 tmuxGrant: the PRODUCTION (no-opts) cache path memoizes, and resetGrantCache clears it', () => {
  // tmuxGrant()'s no-opts path turns useCache on and uses the MODULE runner. (As of
  // #2451 the /api/a11y-status route serves a11ystatus.read(), not tmuxGrant(), so this
  // is no longer a route path; tmuxGrant stays a library function for a possible future
  // #2125-KEEP caller, and its cache/resetGrantCache mechanics are still worth covering.)
  // Exercised here via setSqliteRunner (a counting spy) so the 2s memo (elide repeat
  // sqlite spawns) and resetGrantCache are both covered. A fixed tmuxBin via env keeps
  // the resolve deterministic without a real binary.
  const origBin = process.env.AGENT_WORKFORCE_TMUX_BIN;
  process.env.AGENT_WORKFORCE_TMUX_BIN = '/fake/cachetest/tmux';
  let calls = 0;
  a11y.setSqliteRunner(() => { calls += 1; return { ok: true, rows: [] }; });
  a11y.resetGrantCache();
  try {
    a11y.tmuxGrant();  // miss -> spy called
    a11y.tmuxGrant();  // hit within the 2s TTL -> spy NOT called again
    assert.equal(calls, 1, 'the memo must serve the second no-opts call from cache, not re-spawn');
    a11y.resetGrantCache();
    a11y.tmuxGrant();  // cleared -> fresh read
    assert.equal(calls, 2, 'resetGrantCache must force a fresh read');
  } finally {
    // Restore a benign module runner + clear the cache so no later test in this
    // file inherits the spy or a stale value.
    a11y.setSqliteRunner(() => ({ ok: false, because: 'test teardown runner' }));
    a11y.resetGrantCache();
    if (origBin === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = origBin;
  }
});

test('#2559 appGrant: the PRODUCTION (no-opts) cache path memoizes, and resetAppGrantCache clears it', () => {
  // appGrant()'s no-opts path turns useCache on and uses the MODULE app runner -- the twin
  // of the tmuxGrant cache test above. appGrant is the LIVE re-gate source the /api/a11y-status
  // route serves (#2559), so its 2s memo (which elides a repeat sqlite spawn on the 750ms gate
  // poll) and its reset must be covered symmetrically. No env fiddle: appGrant keys on the fixed
  // bundle id, not a resolved binary path. setAppSqliteRunner is a counting spy.
  let calls = 0;
  a11y.setAppSqliteRunner(() => { calls += 1; return { ok: true, rows: [{ client: a11y.APP_CLIENT, auth: 2 }] }; });
  a11y.resetAppGrantCache();
  try {
    const first = a11y.appGrant();   // miss -> spy called
    a11y.appGrant();                 // hit within the 2s TTL -> spy NOT called again
    assert.equal(calls, 1, 'the memo must serve the second no-opts call from cache, not re-spawn');
    assert.equal(first.trusted, true, 'and the cached verdict is the real one (granted)');
    a11y.resetAppGrantCache();
    a11y.appGrant();                 // cleared -> fresh read
    assert.equal(calls, 2, 'resetAppGrantCache must force a fresh read');
  } finally {
    // Restore a benign module runner + clear the cache so no later test inherits the spy.
    a11y.setAppSqliteRunner(() => ({ ok: false, because: 'test teardown runner' }));
    a11y.resetAppGrantCache();
  }
});
