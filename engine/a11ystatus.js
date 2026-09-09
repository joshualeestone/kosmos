'use strict';
/**
 * The native app's Accessibility trust reading -- read from a file the NATIVE app
 * writes. (#2125 slice 3)
 *
 * 🛑 IT WAS BUILT to ask "does the process macOS holds responsible for agent
 * app-control (tmux) have Accessibility trust?" -- but accessibility is keyed on the
 * CALLING BINARY (the kosmos-app), not the responsible process, so `read()` reports
 * the APP's own AXIsProcessTrusted verdict, not tmux's (corrected 2026-09-06, #2125).
 * That is the RIGHT subject for the first-run gate, not a defect: #2451 (Kitty's
 * identity resolution) confirmed the onboarding "Turn On" registers the kosmos-app
 * (the Accessibility row macOS shows + grants is Kosmos, never tmux), so
 * /api/a11y-status serves read() and the gate keys on the app. The #2125 keep/drop
 * fork still decides grant-NECESSITY (whether the ask is needed at all), which is
 * orthogonal to identity.
 *
 * 🔑 WHY A FILE THE NATIVE APP WRITES, AND NOT AN ENGINE CHECK. Accessibility
 * trust is a TCC fact, reachable only from a native macOS call (AXIsProcessTrusted)
 * and NOT from this Node engine -- #1344 established exactly that ("nothing in this
 * product can read whether accessibility is granted: it is a TCC fact, reachable
 * from the native app and not from the engine"). Josh's #2125 ruling now REQUIRES a
 * real check to gate the first-run Continue button, so the native app supplies it:
 * the kosmos-app runs an AX check (AXIsProcessTrusted) under tmux and writes the
 * verdict here. This module is the engine's read side of that seam.
 *
 * ⚠️ ATTRIBUTION, VERIFIED WRONG (2026-09-06, #2125). The seam was BUILT on the
 * belief that an under-tmux re-exec makes macOS attribute the AX read to tmux (the
 * same responsible-process model that makes tmux the folder-TCC owner). It does
 * NOT. Accessibility is keyed on the CALLING BINARY, so the reading reports the
 * kosmos-app's own trust, not tmux's. Josh's 0.6.42 fresh-account re-test proved it:
 * the tmux gate read ACTIVATED on arrival while tmux was ungranted and absent from
 * the Accessibility list, because AXIsProcessTrusted returned the app's state. So a
 * `trusted:true` here means the KOSMOS APP is granted -- which, per #2451, is exactly
 * what the first-run gate needs (the app is the binary the onboarding registers and
 * macOS shows). Do not re-assume the tmux attribution and do not revert the route to
 * tmux's own grant: the gate's subject is the app. The #2125 keep/drop fork is about
 * grant-NECESSITY, not identity: KEEP -> the accessibility ask stays (gate on the
 * app, as now); DROP -> remove the accessibility ask entirely (a repo sweep finds no
 * synthetic-input API in use; agents run on tmux send-keys IPC, so it is unproven
 * anything needs the grant). Root writeup:
 * ~/work/Josh-Brain/Projects/kosmos-tcc-identity-root-2378-1-3-2026-09-06.md
 *
 * 🛑 THREE ANSWERS, NEVER TWO (the liveness discipline). A caller must be able to
 * tell "the native app says NOT trusted" from "we cannot check at all" (no native
 * app -- a browser on localhost, or the file not written yet). Collapsing those
 * would either FALSE-BLOCK a browser tester (there is no accessibility to grant in
 * a browser) or, worse, let a UI claim a state nobody measured. So `read` returns
 * checkable:false for "no native writer", distinct from checkable:true + trusted:
 * false. The GATE consumes this: block only on a POSITIVE checkable:true +
 * trusted:false; an uncheckable context does not gate (fail-safe -- see the route).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('./store');

const FILE = path.join(store.ROOT, 'a11y-status.json');

/* #2085: the system TCC database that holds Accessibility grants. Accessibility
   is a SYSTEM-domain TCC service, so its grants live in the system db (not the
   per-user one), path-keyed on the granted binary. Reading it needs Full Disk
   Access; the engine runs under the board (which holds FDA on a real install),
   and every failure path below falls to checkable:false, so a box that cannot
   read it degrades to "Checking..." rather than a wrong verdict. */
const TCC_DB = '/Library/Application Support/com.apple.TCC/TCC.db';

/* How long the native app's verdict is believed before it is treated as stale.
   The app refreshes it on launch and on demand (the Open-Accessibility button,
   and the first-run poll trigger); a verdict older than this means the app is not
   currently maintaining it, so we fall back to "cannot check" rather than trust a
   possibly-days-old reading. Generous: the cost of erring long is a slightly stale
   trusted/untrusted reading, and the app rewrites it well within this window
   whenever the first-run screen is open. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * The native app's Accessibility verdict, if a fresh one is on file.
 * Returns one of:
 *   { checkable: true,  trusted: true|false, at }   -- the app measured it
 *   { checkable: false, because }                   -- no native writer / stale / unreadable
 * Never throws: the caller is a route that must answer, not crash.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { checkable: false, because: 'no native app has written an accessibility reading (a browser, or not yet checked)' };
    return { checkable: false, because: 'we could not read the accessibility reading' };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch { return { checkable: false, because: 'the accessibility reading is not readable' }; }
  if (!rec || typeof rec.trusted !== 'boolean') {
    return { checkable: false, because: 'the accessibility reading carries no verdict' };
  }
  const ms = Date.parse(rec.at || '');
  if (!Number.isFinite(ms)) return { checkable: false, because: 'the accessibility reading carries no readable time' };
  if (Date.now() - ms > STALE_AFTER_MS) {
    return { checkable: false, because: 'the accessibility reading is stale; the app is not currently maintaining it' };
  }
  return { checkable: true, trusted: rec.trusted === true, at: rec.at };
}

/* Production reader (and test seam): read the Accessibility grant rows for any
   tmux binary from the system TCC db. This is the DEFAULT runner server.js uses
   via tmuxGrant() with no opts; a test can swap it via setSqliteRunner. Returns
   { ok:true, rows:[{client, auth}] } or { ok:false, because }. Never throws.
   - `-readonly` so a locked live db still reads and this can NEVER mutate the
     system TCC store.
   - The query is a FIXED literal (a `LIKE '%/tmux'` with no interpolated value),
     so there is no injected path and nothing to escape -- the exact-binary match
     is done in JS below against `client`, off the returned rows. The pattern ends
     in `/tmux` (not a bare `%tmux%`) so a granted non-tmux binary whose path merely
     contains "tmux" (e.g. tmuxinator) cannot enter the ambiguity set; a real tmux
     binary path always ends in `/tmux`.
   - `timeout` is short (2s): this is a local single-row read, and the caller runs
     on the board's HTTP thread, so a pathological lock must not pin the event loop
     for long; a timeout lands in { ok:false } -> checkable:false ("Checking...").
   - The schema (service/client/auth_value) is Apple-private and can drift across
     macOS versions; any drift makes the query error -> { ok:false } -> never a
     wrong grant verdict. */
let sqliteRunner = (dbPath) => {
  try {
    const q = "SELECT client, auth_value FROM access WHERE service='kTCCServiceAccessibility' AND client LIKE '%/tmux';";
    const out = execFileSync('/usr/bin/sqlite3', ['-readonly', dbPath, q], {
      encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rows = String(out).split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
      // sqlite3's default separator is '|'; a client path never contains one, so
      // split on the LAST '|' to keep any '|' inside a (hypothetical) path safe.
      const i = line.lastIndexOf('|');
      if (i < 0) return null;
      const auth = Number(line.slice(i + 1));
      return Number.isFinite(auth) ? { client: line.slice(0, i), auth } : null;
    }).filter(Boolean);
    return { ok: true, rows };
  } catch (e) { return { ok: false, because: String((e && e.message) || e) }; }
};
function setSqliteRunner(fn) { sqliteRunner = fn; }

/* #2085: a tiny time-boxed cache so the 1.5s first-run gate poll does not spawn a
   sqlite3 subprocess on EVERY request (each spawn blocks the board's single HTTP
   thread). It elides the SUBPROCESS SPAWN specifically; the cheap path resolution
   (binPaths + realpathSync) still runs each call, because it computes the cache
   key. The grant changes only when the user toggles it in System Settings, so a
   ~2s staleness is invisible -- the poll re-reads continuously and the pill flips
   within a poll or two of a real change. Disabled whenever a test passes an
   override (custom runner / db / tmuxBin) so tests are never served a stale value. */
let grantCache = null; // { key, at, value }
const GRANT_TTL_MS = 2000;
function resetGrantCache() { grantCache = null; }

/**
 * #2085: tmux's REAL Accessibility grant, read from the system TCC db, in the
 * SAME three-answer shape as read().
 *
 * 🛑 THIS READS TMUX'S OWN GRANT, a DIFFERENT subject from read(). It was #2085's
 * attempt to answer "is tmux granted" while read() (the native app's own
 * AXIsProcessTrusted = the CALLING binary) was believed to be the wrong subject. But
 * #2451 (Kitty's identity resolution) established the CALLING binary IS the subject
 * the first-run gate needs: the onboarding registers the kosmos-app (the Accessibility
 * row macOS shows + grants is Kosmos, never tmux), so /api/a11y-status serves read()
 * and this function is NOT route-called -- do not re-wire the gate to it. It stays a
 * library function (and for a possible #2125-KEEP tmux-identity path): AX is keyed on
 * the calling binary and there is no clean API to ask "is tmux trusted" from another
 * process, so this reads tmux's OWN path-keyed grant row directly. (tmux appearing in
 * the db is real and path-keyed -- measured on the fleet, `.../tmux -> auth_value 2`;
 * that is orthogonal to tmux disclaiming responsibility for its CHILDREN, which is why
 * the under-tmux re-exec in #2125 still returned the app's state.)
 *
 * Dispositions -- NEVER a false green is the load-bearing invariant, and it never
 * strands a granted user on a Next gate either:
 *   THIS tmux binary granted (auth >= 2)            -> { checkable:true, trusted:true }  (green)
 *   THIS binary present but denied (auth < 2)        -> { checkable:true, trusted:false } (Not activated + Turn On)
 *   THIS binary absent, but ANOTHER tmux IS granted  -> { checkable:false } ("Checking...")
 *       ambiguous: some tmux holds the grant but not the binary we resolve (a
 *       path-key mismatch -- bundled vs Homebrew, symlink vs target). Never claim
 *       a green we cannot attribute to OUR tmux, and never block Next on a "not
 *       activated" that may be false -- so this is the non-committal, non-blocking
 *       state, not a red one.
 *   NO tmux granted anywhere                         -> { checkable:true, trusted:false } (Not activated + Turn On)
 *       the honest fresh-install state: nothing is granted, so offer the action.
 *   any read failure (no FDA, missing/locked db, schema drift, no sqlite3,
 *   unresolvable tmux path)                          -> { checkable:false }      ("Checking...")
 *
 * @returns {{checkable:true,trusted:boolean,at:string}|{checkable:false,because:string}}
 */
function tmuxGrant(opts) {
  // The tmux binary Kosmos actually runs, then its realpath: TCC keys on the
  // real path, and the resolved bin is commonly a symlink (Homebrew's
  // bin/tmux -> Cellar/.../tmux, or the bundled tmux/bin/tmux). Lazy require of
  // create so a11ystatus carries no load-time dependency on it (no cycle).
  let tmuxBin;
  try { tmuxBin = (opts && opts.tmuxBin) || require('./create').binPaths(opts).tmuxBin; }
  catch { tmuxBin = null; }
  if (!tmuxBin) return { checkable: false, because: 'could not resolve the tmux binary path' };
  let real;
  try { real = fs.realpathSync(tmuxBin); } catch { real = tmuxBin; }

  const dbPath = (opts && opts.tccDb) || TCC_DB;
  // Only the production path (no test overrides) is cached, so a test never reads
  // a value seeded by another test or by production.
  const useCache = !(opts && (opts.sqliteRunner || opts.tccDb || opts.tmuxBin));
  const cacheKey = real + ' ' + dbPath;
  if (useCache && grantCache && grantCache.key === cacheKey && (Date.now() - grantCache.at) < GRANT_TTL_MS) {
    return grantCache.value;
  }

  const runner = (opts && opts.sqliteRunner) || sqliteRunner;
  let res;
  try { res = runner(dbPath); } catch (e) { res = { ok: false, because: String((e && e.message) || e) }; }
  let verdict;
  if (!res || res.ok !== true || !Array.isArray(res.rows)) {
    verdict = { checkable: false, because: 'the accessibility database was not readable (no access, missing, locked, or a changed format)' };
  } else {
    const rows = res.rows;
    const exact = rows.find((r) => r && r.client === real);
    // auth_value 2 (allowed) / 3 (allowed, limited) => granted; 0/1 => denied.
    const granted = (r) => r && r.auth >= 2;
    if (exact) {
      verdict = { checkable: true, trusted: granted(exact), at: new Date().toISOString() };
    } else if (rows.some(granted)) {
      // A tmux is granted, but not the binary we resolve -- ambiguous. Do not
      // claim green (it is not OUR tmux) and do not block Next with a possibly-
      // false "Not activated"; report cannot-check so the pill reads "Checking...".
      verdict = { checkable: false, because: 'a tmux Accessibility grant exists but not for the tmux binary this install runs (path-key mismatch)' };
    } else {
      // No tmux granted anywhere -> the honest, actionable fresh-install state.
      verdict = { checkable: true, trusted: false, at: new Date().toISOString() };
    }
  }
  if (useCache) grantCache = { key: cacheKey, at: Date.now(), value: verdict };
  return verdict;
}

module.exports = { FILE, STALE_AFTER_MS, read, tmuxGrant, setSqliteRunner, resetGrantCache };
