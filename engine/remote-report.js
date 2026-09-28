'use strict';
/**
 * kosmos#4277: this Mac's remote-access status, sent to the coordinator inside the
 * signed standing question so a failure is diagnosable from OUR side without asking
 * the person. The outage behind it (2026-09-27): a board went offline across an update,
 * and every log we held said only that its tunnel never asked for a relay ticket. The
 * one line that said WHY (the board's own remote status) existed only on that Mac.
 *
 * The coordinator validates, bounds and keeps the latest report per Mac
 * (kosmos-relay coordinator/src/macremote.rs; read on the box with
 * deploy/mac-remote-report.sh). This module only builds it, and never throws: a report
 * that cannot be built is not sent, and nothing here can cost the board its standing.
 *
 * What it carries, and what it does not:
 *   on        the remote-access switch
 *   tunnel    running | starting | crashed | stopped | off, from remote.status()
 *   error     remote.status()'s own sentence when not up, cut to ERROR_MAX_CHARS, with
 *             this person's home directory written as `~` (any letter case) and every
 *             email address written as `<email>`: status() names the sign-in email while
 *             the board waits for its code, exactly the state this report is for
 *   stateDir  default | custom (AGENT_WORKFORCE_TUNNEL_STATE is set) | missing
 *   macId     whether the state dir holds mac_id; macKey whether it holds mac_key
 *   app       this build's version
 *   heal      what the board's supervisor did since the last report: relaunched (the
 *             tunnel came back), relaunch-failed (it restarted it and it is still not
 *             up), or none. The supervisor itself is remote.js's ensure()/scheduleRestart,
 *             which already relaunches a dead tunnel every 15 s with backoff; this
 *             reports it rather than adding a second relauncher.
 * Never a home path, an email or a key. The Mac's own address may appear in a sentence;
 * the coordinator already holds it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ERROR_MAX_CHARS = 300;

/* remote.status().state -> the coordinator's tunnel vocabulary. `off` means the switch
   is off; a board whose switch is ON but whose tunnel is not started reads `stopped`. */
function tunnelState(state, on) {
  if (state === 'up') return 'running';
  if (state === 'connecting') return 'starting';
  if (state === 'restarting') return 'crashed';
  return on ? 'stopped' : 'off';
}

/* A sentence safe to send: this person's home directory written as `~` (anywhere in the
   text, longest spelling first), control characters dropped, cut to the bound. */
function scrub(text, home) {
  if (typeof text !== 'string') return null;
  let s = text;
  const homes = [home, home && fs.realpathSync.native ? safeRealpath(home) : null]
    .filter((h) => typeof h === 'string' && h.length > 1)
    .sort((a, b) => b.length - a.length);
  // Any letter case: macOS paths are case-insensitive, so /users/somebody names the same home.
  for (const h of homes) s = s.replace(new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~');
  // An email anywhere in the sentence (status() names the sign-in email while waiting for the code).
  s = s.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[^\s<>()"',;:]+/g, '<email>');
  s = Array.from(s).filter((c) => c >= ' ' && c !== '\u007f').join('').trim();
  if (!s) return null;
  return Array.from(s).slice(0, ERROR_MAX_CHARS).join('');
}
function safeRealpath(p) { try { return fs.realpathSync.native(p); } catch { return null; } }

let lastRestarts = null;

/**
 * The report, or null when it cannot be built. `deps` replaces remote.js and the
 * environment in a test.
 */
function build(deps) {
  try {
    const remote = (deps && deps.remote) || require('./remote');
    const env = (deps && deps.env) || process.env;
    const home = (deps && deps.home) || os.homedir();
    const settings = remote.read();
    const on = settings && settings.ok === true && settings.on === true;
    const st = remote.status() || {};
    const dir = remote.stateDir();
    const exists = (f) => { try { return fs.existsSync(path.join(dir, f)); } catch { return false; } };
    const dirThere = (() => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } })();
    const tunnel = tunnelState(st.state, on);
    const restarts = typeof remote.restartCount === 'function' ? remote.restartCount() : 0;
    let heal = 'none';
    if (lastRestarts !== null && restarts > lastRestarts) heal = tunnel === 'running' ? 'relaunched' : 'relaunch-failed';
    lastRestarts = restarts;
    let app = null;
    try { app = (deps && deps.appVersion) || require('../package.json').version || null; } catch { app = null; }
    return {
      on,
      tunnel,
      error: tunnel === 'running' ? null : scrub(st.because, home),
      stateDir: !dirThere ? 'missing' : (env.AGENT_WORKFORCE_TUNNEL_STATE ? 'custom' : 'default'),
      macId: exists('mac_id'),
      macKey: exists('mac_key'),
      app,
      heal,
    };
  } catch {
    return null;
  }
}

module.exports = { build, tunnelState, scrub, ERROR_MAX_CHARS, resetForTests: () => { lastRestarts = null; } };
