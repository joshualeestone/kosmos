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
 * What it carries (fixed values only; no free text ever leaves the Mac, review 4):
 *   on        the remote-access switch
 *   tunnel    running | starting | crashed | stopped | off, from remote.status()
 *   error     a CODE from the fixed list in CODES, classified on the Mac from status()'s own
 *             sentence (the sentence itself is never sent); or, for a board whose switch is
 *             on and which holds a key but is not enrolled, `not-enrolled; missing: <files>`
 *             naming the missing enrolment files by their fixed names
 *   stateDir  default | custom (AGENT_WORKFORCE_TUNNEL_STATE is set) | missing
 *   macId     whether the state dir holds mac_id; macKey whether it holds mac_key
 *   app       this build's version
 *   heal      what the board's supervisor did since the last report that WENT OUT
 *             (relaunched | relaunch-failed | none); the supervisor is remote.js's
 *             ensure()/scheduleRestart, which already relaunches a dead tunnel
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

/* kosmos#4277 review 4: NO free text leaves the Mac. Four rounds of review kept finding
   identifying text that a scrubber missed (hostnames, device names, LAN addresses, phone
   numbers, file:// and relative paths), and a scrubber that grows forever also destroys the
   diagnosis. So the board's own sentence is CLASSIFIED here, on the Mac, into one code from a
   fixed list, and only the code is sent. The input is cut to CLASSIFY_MAX_CHARS first, and every
   pattern is a short literal, so nothing here can run long on a hostile line. */
const CLASSIFY_MAX_CHARS = 2000;
const CODES = [
  ['switch-off', /the switch is off/i],
  ['settings-unreadable', /settings could not be read/i],
  ['no-relay-address', /no relay address/i],
  ['binary-missing', /could not be started|ENOENT|EACCES|unrecognized subcommand/i],
  ['state-dir-invalid', /does not look like a Mac state dir/i],
  ['state-file-unreadable', /reading \S+ from|pinned coordinator_pubkey|decoding mac_key/i],
  ['cert-renewal', /renewal/i],
  ['relay-refused', /relay refused|relay answered AUTH|relay did not answer AUTH/i],
  ['relay-dropped', /go away|keepalive|connection lost|reader stopped|writer gone/i],
  ['coordinator-refused', /Kosmos\+ (refused|answered)|said no|\bHTTP 4\d\d\b/i],
  ['coordinator-unreachable', /unreachable|connect(ion)? refused|timed out|timeout/i],
  ['crashed', /crash|killed|restarting/i],
  ['awaiting-sign-in', /waiting for the (code|sign-in)/i],
  ['not-started', /has not started the tunnel/i],
  ['starting', /starting the connection|connecting to the relay/i],
];
function classify(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.slice(0, CLASSIFY_MAX_CHARS);
  for (const [code, re] of CODES) if (re.test(t)) return code;
  return 'other';
}
/* The enrolment files enrolled() needs, by their FIXED names: which are missing is the reason a
   board with its switch on and a key in hand still believes it is not enrolled. */
const ENROL_FILES = ['mac_id', 'address', 'tls.crt', 'tls.key'];

/* heal: what the supervisor did since the last report that WENT OUT. build() proposes a
   baseline; commitHeal() adopts it once a report is sent, so a refused or failed send does
   not swallow a relaunch. A relaunch whose tunnel is still starting is not yet a result:
   it reads `none` and stays pending for the next report. */
let lastRestarts = 0;   // restarts counts from process start, so 0 is the true baseline

/**
 * The report, or null when it cannot be built. `deps` replaces remote.js and the
 * environment in a test.
 */
function build(deps) {
  try {
    const remote = (deps && deps.remote) || require('./remote');
    const env = (deps && deps.env) || process.env;
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
      error: tunnel === 'running' ? null : errorCode(st.because, on, exists),
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

/* The code sent as `error`. A board whose switch is on but which is not enrolled says which
   enrolment files are missing (fixed names), not status()'s sign-in sentence, which would
   blame the person for what may be a half-written state dir. */
function errorCode(because, on, exists) {
  const missing = ENROL_FILES.filter((f) => !exists(f));
  if (on && missing.length && exists('mac_key')) return 'not-enrolled; missing: ' + missing.join(', ');
  return classify(because);
}

/** Call with the report that was SENT, so its heal baseline counts. */
function commitHeal(report) {
  if (report && typeof report.healBaseline === 'number') lastRestarts = report.healBaseline;
}

module.exports = { build, commitHeal, tunnelState, classify, CODES, ERROR_MAX_CHARS, resetForTests: () => { lastRestarts = 0; } };
