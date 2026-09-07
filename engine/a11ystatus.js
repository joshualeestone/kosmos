'use strict';
/**
 * The native app's Accessibility trust reading -- read from a file the NATIVE app
 * writes. (#2125 slice 3)
 *
 * 🛑 IT WAS BUILT TO ANSWER "does the process macOS holds responsible for agent
 * app-control (tmux) have Accessibility trust?" -- BUT IT DOES NOT (corrected
 * 2026-09-06, #2125). Accessibility is keyed on the CALLING BINARY (the kosmos-app),
 * not the responsible process, so the verdict is the APP's trust, not tmux's. The
 * subject is the app, not tmux. Left unresolved pending the #2125 keep/drop fork.
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
 * `trusted:true` here does NOT mean tmux is granted. Do not re-assume the tmux
 * attribution when touching this. The fix is the pending #2125 fork: KEEP -> route
 * the AX check AND the grant through one identity so this answers a real subject;
 * DROP -> remove the accessibility ask entirely (a repo sweep finds no synthetic-
 * input API in use; agents run on tmux send-keys IPC, so it is unproven anything
 * needs the grant). Root writeup:
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

/* SQL single-quote escaping for the client path. The path comes from the
   install layout / config, not from a network caller, but the sqlite3 CLI takes
   no bound parameters, so the literal is escaped rather than trusted. */
function sqlQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

/* Test seam: read tmux's Accessibility auth_value(s) from the system TCC db.
   Returns { ok:true, authValues:[int,...] } or { ok:false, because }. Never
   throws. `-readonly` so a locked live db still reads and this can never mutate
   the system TCC store. The schema (service/client/auth_value) is Apple-private
   and can drift across macOS versions; any drift makes the query error, which
   lands in { ok:false } and thus checkable:false -- never a wrong grant verdict. */
let sqliteRunner = (dbPath, clientPath) => {
  try {
    const q = "SELECT auth_value FROM access WHERE service='kTCCServiceAccessibility' AND client=" + sqlQuote(clientPath) + ';';
    const out = execFileSync('/usr/bin/sqlite3', ['-readonly', dbPath, q], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const authValues = String(out).split('\n').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    return { ok: true, authValues };
  } catch (e) { return { ok: false, because: String((e && e.message) || e) }; }
};
function setSqliteRunner(fn) { sqliteRunner = fn; }

/**
 * #2085: tmux's REAL Accessibility grant, read from the system TCC db, in the
 * SAME three-answer shape as read().
 *
 * 🛑 THIS EXISTS BECAUSE read() ABOVE ANSWERS ABOUT THE WRONG SUBJECT. read()
 * surfaces the native app's own AXIsProcessTrusted (the CALLING binary), so a
 * `trusted:true` there meant "the app is trusted", NOT "tmux is granted" -- the
 * false "TMUX ACTIVATED" pill Josh flagged (0.6.42 fresh-account: the pill read
 * ACTIVATED while tmux was ungranted and absent from the Accessibility list). AX
 * is keyed on the calling binary and there is no clean API to ask "is tmux
 * trusted" from another process, so this reads tmux's OWN path-keyed grant row
 * directly. (tmux appearing in the db is real and path-keyed -- measured on the
 * fleet, `.../tmux -> auth_value 2`; that is orthogonal to tmux disclaiming
 * responsibility for its CHILDREN, which is why the under-tmux re-exec in #2125
 * still returned the app's state.)
 *
 * Dispositions (never a false green is the load-bearing invariant):
 *   auth_value >= 2 for THIS tmux binary -> { checkable:true, trusted:true }
 *   no row / auth_value < 2              -> { checkable:true, trusted:false }
 *       tmux was never granted (or the path does not match) -> the actionable
 *       "Not activated, Turn On" state; safe, never claims a grant it did not see.
 *   any read failure (no FDA, missing/locked db, schema drift, no sqlite3,
 *   unresolvable tmux path) -> { checkable:false, because } -> "Checking..."
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

  const runner = (opts && opts.sqliteRunner) || sqliteRunner;
  const dbPath = (opts && opts.tccDb) || TCC_DB;
  let res;
  try { res = runner(dbPath, real); } catch (e) { res = { ok: false, because: String((e && e.message) || e) }; }
  if (!res || res.ok !== true) {
    return { checkable: false, because: 'the accessibility database was not readable (no access, missing, locked, or a changed format)' };
  }
  const vals = Array.isArray(res.authValues) ? res.authValues : [];
  // auth_value 2 (allowed) / 3 (allowed, limited) => granted; 0/1 => denied; no
  // row => never requested => not granted. Only a real >=2 shows the green pill.
  const trusted = vals.some((v) => v >= 2);
  return { checkable: true, trusted, at: new Date().toISOString() };
}

module.exports = { FILE, STALE_AFTER_MS, read, tmuxGrant, setSqliteRunner };
