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

/* A sentence safe to send (review 2 of #4277 widened this from "the home directory"):
   - every known sensitive string, in any letter case and Unicode spelling, first: the sign-in
     email -> <email>; the home, the state dir and their real paths -> <path>; the login name,
     as a whole word -> <user>;
   - then ANY remaining absolute path (a `/`, `~`, `C:\` or `\\` start) -> <path>, up to where
     the clause ends (" does not", " (", ": ", ";", a quote, an error code like ENOENT, or the
     end), so a path with spaces in it (an external drive named after a person) goes whole;
   - then ANY word with an `@` in it -> <email> (the coordinator accepts emails with no dot);
   - control characters dropped, cut to the bound, never mid-character.
   It over-redacts rather than under-redacts: a lost word costs a little diagnosis, a leaked
   name costs a person. */
function escapeRe(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function spellings(x) {
  if (typeof x !== 'string' || x.length < 2) return [];
  const out = new Set([x, x.normalize('NFC'), x.normalize('NFD')]);
  const real = safeRealpath(x);
  if (real) for (const r of [real, real.normalize('NFC'), real.normalize('NFD')]) out.add(r);
  return Array.from(out);
}
function scrub(text, home, extra) {
  if (typeof text !== 'string') return null;
  extra = extra || {};
  let s = text.normalize('NFC');
  const swap = (literal, placeholder, wholeWord) => {
    const lit = literal.normalize('NFC');
    const re = wholeWord ? new RegExp('\\b' + escapeRe(lit) + '\\b', 'gi') : new RegExp(escapeRe(lit), 'gi');
    s = s.replace(re, placeholder);
  };
  if (typeof extra.email === 'string' && extra.email.includes('@')) swap(extra.email, '<email>');
  const paths = [...spellings(home), ...spellings(extra.stateDir)]
    .filter((x) => x.length > 1)
    .sort((a, b) => b.length - a.length);
  for (const p of paths) swap(p, '<path>');
  if (typeof extra.user === 'string' && extra.user.length >= 3) swap(extra.user, '<user>', true);
  // An absolute path, carried across a space only while a LATER word still has a slash in it
  // (so "/Volumes/Josh Stone Drive/Kosmos/remote" goes whole, and "…/state failed to load" keeps
  // its words): the diagnosis is the prose, the identifying part is the path. A coordinator
  // route (`/v1/...`) names nobody and says which call was refused, so it is kept.
  const P = '[^\\s:;"\'()<>]';
  s = s.replace(new RegExp('(?<=^|[\\s(\\[{"\'=>])(?:~|[A-Za-z]:\\\\|\\\\\\\\|/(?!v1/))(?!path>)' + P + '*(?:(?:\\s+' + P + '+)*?\\s+' + P + '*[\\\\/]' + P + '*)*', 'g'), '<path>');
  // An email: any run with an @ in it, punctuation around it kept.
  s = s.replace(/[^\s()<>"',;]*@[^\s()<>"',;]*/g, '<email>');
  // An opaque secret: a bearer value, or any long run mixing letters and digits (keys, tokens).
  // A run starting with `/` is left: real paths are already redacted, so it is a /v1 route.
  s = s.replace(/\b(Bearer|Token|token|key|Key)(\s*[:=]?\s+)\S+/g, '$1$2<token>');
  s = s.replace(/[A-Za-z0-9_+/=.-]{20,}/g, (m) => (!m.startsWith('/') && /[A-Za-z]/.test(m) && /[0-9]/.test(m) ? '<token>' : m));
  s = s.replace(/(?:<path>)+/g, '<path>');
  s = Array.from(s).filter((c) => c >= ' ' && c !== '\u007f').join('').trim();
  if (!s) return null;
  return Array.from(s).slice(0, ERROR_MAX_CHARS).join('');
}
function safeRealpath(p) { try { return fs.realpathSync.native(p); } catch { return null; } }

/* heal: what the supervisor did since the last report that WENT OUT. build() proposes a
   baseline; commitHeal() adopts it once a report is sent, so a refused or failed send does
   not swallow a relaunch. A relaunch whose tunnel is still starting is not yet a result:
   it reads `none` and stays pending for the next report. */
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
    let user = deps && deps.user;
    if (user === undefined) { try { user = os.userInfo().username; } catch { user = null; } }
    const settings = remote.read();
    const on = settings && settings.ok === true && settings.on === true;
    const st = remote.status() || {};
    const dir = remote.stateDir();
    const exists = (f) => { try { return fs.existsSync(path.join(dir, f)); } catch { return false; } };
    const dirThere = (() => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } })();
    const tunnel = tunnelState(st.state, on);
    const restarts = typeof remote.restartCount === 'function' ? remote.restartCount() : 0;
    let heal = 'none';
    let proposedRestarts = restarts;
    if (lastRestarts !== null && restarts > lastRestarts) {
      if (tunnel === 'running') heal = 'relaunched';
      else if (tunnel === 'starting') proposedRestarts = lastRestarts;   // not a result yet
      else heal = 'relaunch-failed';
    }
    let app = null;
    try { app = (deps && deps.appVersion) || require('../package.json').version || null; } catch { app = null; }
    const r = {
      on,
      tunnel,
      error: tunnel === 'running' ? null : scrub(st.because, home, { email: settings && settings.email, stateDir: dir, user }),
      stateDir: !dirThere ? 'missing' : (env.AGENT_WORKFORCE_TUNNEL_STATE ? 'custom' : 'default'),
      macId: exists('mac_id'),
      macKey: exists('mac_key'),
      app,
      heal,
    };
    // The heal baseline travels WITH this report (not serialised): commitHeal(report) adopts the
    // one that was actually sent, whatever else build() was called for in between.
    Object.defineProperty(r, 'healBaseline', { value: proposedRestarts, enumerable: false });
    return r;
  } catch {
    return null;
  }
}

/** Call with the report that was SENT, so its heal baseline counts. */
function commitHeal(report) {
  if (report && typeof report.healBaseline === 'number') lastRestarts = report.healBaseline;
}

module.exports = { build, commitHeal, tunnelState, scrub, ERROR_MAX_CHARS, resetForTests: () => { lastRestarts = null; } };
