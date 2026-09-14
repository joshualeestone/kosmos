'use strict';
/**
 * Detect a Windows agent that spawned but is stuck at Claude Code's
 * workspace-trust prompt -- the invisible-hang half of #2281.
 *
 * 🛑 WHY THIS EXISTS. `engine/trust.js` pre-accepts trust for a folder Kosmos
 * created (kosmos#2394 made the key the forward-slash spelling Claude Code
 * actually reads on Windows), and `engine/win32launch.js` gates every spawn on
 * that write. So the COMMON path no longer meets the dialog. But three cases
 * leave a folder genuinely untrusted and the dialog fires anyway:
 *   - trust.js's own documented race (trust.js:369) -- a live Claude Code save
 *     between our read and our rename drops the entry we just wrote;
 *   - a folder the USER pointed an agent at, not one Kosmos created;
 *   - a config flip (#1629) that re-arms every trust decision for that config dir.
 * In all three the interactive/streaming session hangs on a dialog in a console
 * nobody can see, never registers in `claude agents --json`, and the fail-closed
 * `win32roster` emits nothing -- a board that looks exactly like an empty fleet,
 * with no diagnostic. This module is the detection that lets a caller say what is
 * happening instead of showing nothing.
 *
 * 🔑 THE DETECTABLE STATE, MEASURED ON THE BOX (read-only, 2026-09-13). Claude
 * Code writes an early `<config-dir>/sessions/<pid>.<hash>.key` when a session
 * starts, and only writes `<pid>.json` once it REGISTERS. Every registered
 * session in `~/.claude/sessions` on this box carried BOTH (a 113-byte `.key`
 * and a `<pid>.json`); the issue's measurement is that a session stuck at the
 * trust dialog writes the `.key` and never the `.json`. So:
 *
 *     a `<pid>.<hash>.key` with NO sibling `<pid>.json`, older than a threshold,
 *     is a session that started and did not register.
 *
 * The `olderThanMs` threshold separates "stuck" from "healthy but still starting"
 * for a caller that SCANS the dir on its own schedule: a freshly spawned agent has
 * its `.key` for a few seconds before its `.json` lands, so only a `.key` that has
 * sat alone past the threshold is a stall.
 *
 * 📌 IN PRODUCTION THE DELAY IS THE SUPERVISOR'S, NOT THIS AGE GATE. The one
 * production caller (`win32supervisor.js`) only asks this AFTER its own 90s
 * one-shot timer has elapsed, so the "has it had time to register" question is
 * already answered by then; it passes `olderThanMs: 0`. This module keeps the age
 * gate for any other caller that polls without such a timer -- it is not the
 * load-bearing part of the production path.
 *
 * 📌 AND IT IS CORROBORATION, NOT THE DISCRIMINATOR (review r1). The supervisor
 * decides "trust hang vs slow start" from a POSITIVE signal -- is the folder
 * recorded trusted in the config the agent reads (`trust.folderTrusted`) -- which
 * needs the cwd, not a pid. A lone `.key` here only enriches that wording, so the
 * uncertainty in "is this pid the agent's" (win32launch's detached launch spawns
 * via cmd) never decides the claim.
 *
 * 📌 THIS IS DETECTION ONLY. It reads Claude Code's session dir and answers a
 * question; it never writes trust, never spawns, never touches the fleet. The
 * board-card surfacing (a "waiting at a trust prompt" state on the card) needs
 * `server.js` and `web/index.html`, which are owned elsewhere this cycle and are
 * a filed follow-up (kosmos#3013).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function homeDir() { return os.homedir(); }

/**
 * The directory Claude Code keeps its per-session `.key`/`.json` files in, for a
 * given account config dir.
 *
 * 🔑 IT MIRRORS trust.js's SETTINGS() BASE, NOT ITS CONFIG(). Trust lives in the
 * `.claude.json` FILE (`$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`);
 * the sessions files live under the config DIR, the same base `settings.json`
 * uses (`<configDir>/sessions`, else `~/.claude/sessions`). The default
 * `~/.claude/sessions` arm is the one confirmed read-only on the box; the
 * `configDir` arm is what a Windows agent on a named account uses and is
 * confirmed by the live-check runbook.
 *
 * 🛑 THE DEFAULT-ACCOUNT ARM IGNORES THE ENGINE'S OWN CLAUDE_CONFIG_DIR (#3013,
 * folding in the #2281 review item). A default-account agent launches with
 * CLAUDE_CONFIG_DIR DELETED (win32launch.childEnv only sets it when configDir is
 * given), so Claude Code reads `~/.claude/sessions` -- NOT the engine's own
 * CLAUDE_CONFIG_DIR, which the Kosmos board can carry on a used machine (the same
 * clean-env-vs-used-env divergence trust.js documents at #2129). Honouring the
 * engine's CLAUDE_CONFIG_DIR here scanned the wrong dir and read a default-account
 * agent as "not stuck" while it hung. So `sessionsDir(null)` mirrors
 * `trust.defaultAgentSettings`: the default base is `AGENT_WORKFORCE_HOME` (the
 * sandbox seam, parallel to defaultAgentSettings') else the real home, never the
 * engine's CLAUDE_CONFIG_DIR. This was harmless while only the supervisor called
 * this (it always passes the agent's configDir), and becomes load-bearing now
 * that the board card path (#3013) asks about default-account agents too.
 *
 * @param {string|null} configDir the ACCOUNT's config dir Kosmos hands the agent
 *   (the same value that rides in its CLAUDE_CONFIG_DIR), or null for the default
 *   account (no CLAUDE_CONFIG_DIR).
 */
function defaultSessionsDir() {
  return path.join(process.env.AGENT_WORKFORCE_HOME || homeDir(), '.claude', 'sessions');
}
function sessionsDir(configDir) {
  if (configDir) return path.join(String(configDir), 'sessions');
  return defaultSessionsDir();
}

/* A `.key` is `<pid>.<hash>.key`; a `.json` is `<pid>.json`. The pid is the
   OS process id (digits) -- the same number `claude agents --json` reports and
   the same one `win32launch.launchStreaming` spawns the child under, which is
   what lets the supervisor ask about its OWN child by pid. */
const KEY_RE = /^(\d+)\.[^.]+\.key$/;
const JSON_RE = /^(\d+)\.json$/;

/**
 * The stuck sessions in one directory listing -- PURE over the listing, so it is
 * asserted from any host with synthetic names and never reads a real dir here.
 *
 * @param {object} opts
 * @param {Array<{name: string, mtimeMs: number}>} opts.entries the dir listing
 *   (a name and the `.key`'s modified-time in ms). A caller reads it once; this
 *   function does no IO.
 * @param {number} [opts.now] the clock, ms since epoch (default Date.now()).
 * @param {number} [opts.olderThanMs] a `.key` younger than this is still
 *   starting, not stuck (default 0 -- the caller sets the real grace).
 * @returns {Array<{pid: string, keyFile: string, ageMs: number}>} one per stuck
 *   pid, in listing order.
 */
function stuckSessions(opts) {
  const o = opts || {};
  const entries = Array.isArray(o.entries) ? o.entries : [];
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const olderThanMs = Number.isFinite(o.olderThanMs) ? o.olderThanMs : 0;

  // The pids that DID register (have a `<pid>.json`). Built first so a `.key`
  // listed before its own `.json` is still resolved correctly.
  const registered = new Set();
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue;
    const m = JSON_RE.exec(e.name);
    if (m) registered.add(m[1]);
  }

  const out = [];
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue;
    const m = KEY_RE.exec(e.name);
    if (!m) continue;
    const pid = m[1];
    if (registered.has(pid)) continue;            // it registered -- not stuck
    const mtimeMs = Number.isFinite(e.mtimeMs) ? e.mtimeMs : now;
    /* Clamp at 0: statSync's mtimeMs is a FLOAT and Date.now() truncates to whole
       ms, so a just-written .key can compute a hair-negative age. Without the
       clamp, `ageMs < olderThanMs` would reject that file even at olderThanMs:0 --
       making "0" mean "accept nothing this instant" instead of "accept all ages".
       Clamping fixes olderThanMs:0 and is a no-op for any positive threshold. */
    const ageMs = Math.max(0, now - mtimeMs);
    if (ageMs < olderThanMs) continue;            // still within its start-up grace
    out.push({ pid, keyFile: e.name, ageMs });
  }
  return out;
}

/* The real directory read, isolated so it is the ONLY IO in this module and can
   be swapped in a test. Fail-soft: any fault (dir absent, unreadable) answers an
   empty listing, so a caller reads "cannot tell / not stuck" rather than throwing
   -- the same false-zero discipline the rest of the win32 family keeps. */
function readEntries(dir) {
  let names;
  try { names = fs.readdirSync(dir); }
  catch { return []; }
  const out = [];
  for (const name of names) {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs; }
    catch { continue; }   // vanished between readdir and stat -- skip it
    out.push({ name, mtimeMs });
  }
  return out;
}

/**
 * Is THIS pid stuck at a trust/registration prompt -- has it written its `.key`
 * and no `.json`, older than the grace? The one the supervisor calls, about its
 * own child.
 *
 * @param {number|string} pid the spawned child's pid.
 * @param {object} [opts]
 * @param {string|null} [opts.configDir] the agent's account config dir.
 * @param {number} [opts.olderThanMs] the start-up grace (default 0).
 * @param {number} [opts.now] the clock (default Date.now()).
 * @param {(dir: string) => Array<{name: string, mtimeMs: number}>} [opts.list]
 *   the directory reader, injectable for tests; defaults to the real fs read.
 * @returns {boolean} true only when a stuck `.key` for this exact pid is found.
 */
function pidWaiting(pid, opts) {
  const o = opts || {};
  const want = String(pid);
  if (!/^\d+$/.test(want)) return false;    // not a pid we could match a file to
  const list = typeof o.list === 'function' ? o.list : readEntries;
  const entries = list(sessionsDir(o.configDir || null));
  const stuck = stuckSessions({ entries, now: o.now, olderThanMs: o.olderThanMs });
  return stuck.some((s) => s.pid === want);
}

/**
 * Is ANY session in this account's sessions dir stuck at a trust/registration
 * prompt -- a lone `<pid>.<hash>.key` with no `<pid>.json`, older than the grace?
 *
 * 🔑 THE FOLDER-LEVEL SIBLING OF pidWaiting, FOR THE #3013 BOARD CARD. A stuck
 * agent never registered, so the board has no pid for it (the pid is the
 * supervisor's own child, invisible to the board) -- it knows only the ACCOUNT
 * whose folder is not trusted. So the card asks "is a started-but-unregistered
 * session sitting in this account's dir" rather than "is THIS pid". Attribution to
 * a specific agent is done per-folder by trust.folderTrusted at the call site; this
 * answers only the account-level detector half, reusing the exact same
 * lone-`.key` rule pidWaiting does (no second detector).
 *
 * @param {string|null} configDir the agent's account config dir (null = default
 *   account -> ~/.claude/sessions, ignoring the engine's CLAUDE_CONFIG_DIR).
 * @param {object} [opts]
 * @param {number} [opts.olderThanMs] the start-up grace a board caller sets so a
 *   freshly spawned agent's brief lone `.key` is not read as a stall (default 0).
 * @param {number} [opts.now] the clock (default Date.now()).
 * @param {(dir: string) => Array<{name: string, mtimeMs: number}>} [opts.list]
 *   the directory reader, injectable for tests; defaults to the real fs read.
 * @returns {boolean} true when at least one stuck `.key` sits in the dir.
 */
function dirWaiting(configDir, opts) {
  const o = opts || {};
  const list = typeof o.list === 'function' ? o.list : readEntries;
  const entries = list(sessionsDir(configDir || null));
  return stuckSessions({ entries, now: o.now, olderThanMs: o.olderThanMs }).length > 0;
}

module.exports = { sessionsDir, stuckSessions, pidWaiting, dirWaiting };
