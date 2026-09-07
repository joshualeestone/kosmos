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
   system TCC db -- the honest replacement for read() (which surfaced the native
   APP's trust, the false "TMUX ACTIVATED" pill). The load-bearing invariant is
   NEVER A FALSE GREEN: only a real auth_value >= 2 for the tmux binary yields
   trusted:true; every failure path falls to checkable:false ("Checking...").
--------------------------------------------------------------------------- */

// A mocked sqlite runner so the branch logic is deterministic without a db. The
// runner returns {ok, rows:[{client, auth}]} for tmux-shaped clients (the real
// runner does a LIKE '%tmux%'); tmuxGrant matches the exact resolved path in JS.
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
  // '' is falsy, so it falls through to create.binPaths().tmuxBin (the resolved
  // default) rather than the "could not resolve" arm. rowsRunner([]) (no grant)
  // makes the verdict deterministic regardless of which path binPaths returns.
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
  // exercises the ACTUAL query the default runner builds (LIKE '%tmux%'), not a mock.
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
  // server.js calls tmuxGrant() with NO opts -> useCache is on and the MODULE
  // runner is used. That load-bearing path is exercised here via setSqliteRunner
  // (a counting spy) so the 2s memo (elide repeat sqlite spawns) and
  // resetGrantCache are both covered. A fixed tmuxBin via env keeps the resolve
  // deterministic without a real binary.
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
