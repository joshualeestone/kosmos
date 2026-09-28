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
 *   tunnel    running | starting | crashed | stopped | off, from remote.status(). `starting`
 *             with an error code is a tunnel process that is up but whose own retries keep
 *             failing (stuck), not one coming up: read the two together (review 20)
 *   error     a CODE from the fixed list in CODES, classified on the Mac from status()'s own
 *             sentence (the sentence itself is never sent); or, for a board whose switch is
 *             on and which holds a key but is not enrolled, `not-enrolled; missing: <files>`
 *             naming the missing enrolment files by their fixed names
 *   stateDir  default | custom (AGENT_WORKFORCE_TUNNEL_STATE is set) | missing
 *   macId     whether the state dir holds mac_id; macKey whether it holds mac_key
 *   app       this build's version
 *   heal      what the board's supervisor did since the last report that WENT OUT
 *             (relaunched | relaunch-failed | none), judged by whether the relaunched tunnel
 *             PROCESS is up (remote.supervisorState), not by status(), whose `restarting`
 *             also covers the tunnel's own in-process reconnects; the supervisor is remote.js's
 *             ensure()/scheduleRestart, which already relaunches a dead tunnel
 */
const fs = require('node:fs');
const path = require('node:path');


/* remote.status().state -> the coordinator's tunnel vocabulary. `off` means the switch
   is off; a board whose switch is ON but whose tunnel is not started reads `stopped`, and so
   does one that is not enrolled, which will never start (review 12). status() reads
   `restarting` for the tunnel's own in-process reconnects too (a graceful close, a certificate
   renewal), so it is `crashed` only when the supervisor's process is not up (review 12). */
function tunnelState(state, on, sup, enrolledHere) {
  if (state === 'up') return 'running';
  if (on && !enrolledHere) return 'stopped';
  if (state === 'connecting') return 'starting';
  if (state === 'restarting') return sup === 'alive' ? 'starting' : 'crashed';
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
  // The first pattern that matches wins. The board's own healthy "still dialling" sentences
  // (remote.js status()) are matched exactly, so no failure pattern may also match them (review 7:
  // "connecting to the relay" once read as relay-unreachable); remote-report.test.js asserts that
  // each healthy sentence matches `starting` alone, whatever the order here.
  ['starting', /^(starting the connection|connecting to the relay)$/i],
  // The coordinator's own sentences (coordinator.rs) all start with `Kosmos+`, so they are taken
  // right after the healthy sentences, before every other pattern, any of which a gateway error
  // page in their detail could otherwise match (reviews 10 and 16). A 4xx is a refusal and a 5xx
  // an outage; coordinator.rs writes `Kosmos+ refused this Mac: <why> (HTTP <code> on <path>)` for
  // ANY status whose body parses as a refusal, 5xx included, so the 5xx form is taken first
  // (review 9). These are the only coordinator patterns (review 11).
  // 408 and 429 are "not now", not "no" (as remote.js RETIRE_TRANSIENT reads them): an outage (review 18).
  ['coordinator-unreachable', /^Kosmos\+ (answered (5\d\d|408|429)|unreachable)|^Kosmos\+ refused.*\bHTTP (5\d\d|408|429)\b/i],
  ['coordinator-refused', /^Kosmos\+ (refused|answered 4\d\d)/i],
  // An answer that is not what the coordinator sends (coordinator.rs: not JSON, no ticket field,
  // unreadable): a captive portal or a proxy in the way, on the ticket path itself (review 14).
  ['coordinator-bad-answer', /^(reading )?the Kosmos\+ answer/i],
  // No switch-off, settings-unreadable or no-relay-address: nothing is sent while the switch is
  // off or the settings cannot be read, and RELAY() always has a default (review 14).
  // No state-dir-invalid or awaiting-sign-in either (review 16): the tunnel refuses a state dir
  // only without mac_id, which enrolled() requires, and only a not-enrolled board says it is
  // waiting for a code, which sends `not-enrolled; missing: ...` instead. Both read `other`.
  ['status-unreadable', /^status unreadable/i],
  // status() words every spawn failure as `the tunnel program could not be started: <why>` (review 12).
  ['binary-missing', /^the tunnel program could not be started/i],
  ['state-file-unreadable', /reading \S+ from|pinned coordinator_pubkey|decoding mac_key|mac_key is not 32 bytes/i],
  // The ticket had expired by this Mac's clock: usually a Mac clock that is wrong, not a bad key (review 18).
  ['ticket-expired', /ticket expired/i],
  // The coordinator's ticket does not fit this Mac (the pinned key, or a stale address file).
  ['ticket-mismatch', /ticket does not verify|ticket names /i],
  ['cert-renewal', /^certificate renewal is due/i],
  // This Mac's own certificate or key (session.rs local TLS setup): unreadable or unparseable
  // tls.crt / tls.key, a plausible failure after an update (review 16).
  ['local-cert-unreadable', /^(opening certificate|parsing certificate|opening private key|parsing private key|no private key found|building local TLS config)/i],
  // The tunnel's dial of the RELAY (session.rs dial_relay): kept apart from the coordinator,
  // which is the whole question when a Mac never gets a ticket (review 6).
  // The tunnel's own dial error is `connecting to <host:port>: <why>` (a colon after the address).
  // A certificate the Mac does not trust is a trust or configuration fault, not an outage (review 10).
  ['relay-certificate', /relay TLS handshake: invalid peer certificate/i],
  // `relay did not answer AUTH` is session.rs's AUTH read timeout: the relay never answered (review 10).
  ['relay-unreachable', /^connecting to \S+: |relay TLS handshake|relay did not answer AUTH/i],
  ['relay-refused', /relay refused|relay answered AUTH/i],
  ['relay-dropped', /go away|keepalive|connection lost|reader stopped|writer gone|frame from the relay/i],
  // The tunnel's own sentence for a session that ended WITHOUT an error (a relay-side graceful
  // close): routine, not a failure (review 5).
  ['reconnecting', /the connection closed/i],
  ['crashed', /crash|killed|restarting/i],
  ['not-started', /has not started the tunnel/i],
];
function classify(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.slice(0, CLASSIFY_MAX_CHARS);
  for (const [code, re] of CODES) if (re.test(t)) return code;
  return 'other';
}
/* The enrolment files enrolled() needs, by their FIXED names: which are missing is the reason a
   board with its switch on and a key in hand still believes it is not enrolled. The same list as
   remote.js ENROL_FILES, which enrolled() reads; remote.test.js asserts the two are equal (review
   11). Not required from remote.js here, so this module stays loadable without it. */
const ENROL_FILES = ['mac_id', 'address', 'tls.crt', 'tls.key'];

/* heal: what the supervisor did since the last report that WENT OUT. build() proposes a
   baseline; commitHeal() adopts it once a report is sent, so a refused or failed send does
   not swallow a relaunch. A relaunch whose process is up is `relaunched` whatever the tunnel is
   doing inside it; one that died again (a relaunch is scheduled) is `relaunch-failed`; with no
   process and nothing scheduled (a deliberate stop) it is not a result and reads `none`. */
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
    const sup = typeof remote.supervisorState === 'function' ? remote.supervisorState() : 'none';
    const tunnel = tunnelState(st.state, on, sup, ENROL_FILES.every(exists));
    const restarts = typeof remote.restartCount === 'function' ? remote.restartCount() : 0;
    let heal = 'none';
    if (restarts > lastRestarts) {
      if (sup === 'alive') heal = 'relaunched';
      else if (sup === 'waiting') heal = 'relaunch-failed';
    }
    const proposedRestarts = restarts;
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
  // Both senders hold the key before they build (mac-standing.js via enrolled(), remote.js via
  // holdsKey()); this re-reads mac_key rather than trusting that, so a key deleted in between (a
  // Forget) falls back to classify(), which loses the missing-files detail but never leaks text.
  const missing = ENROL_FILES.filter((f) => !exists(f));
  if (on && missing.length && exists('mac_key')) return 'not-enrolled; missing: ' + missing.join(', ');
  return classify(because);
}

/** Call with the report that was SENT, so its heal baseline counts. */
function commitHeal(report) {
  // Forward only: restarts only grows, so a slow send committing late never rolls it back.
  if (report && typeof report.healBaseline === 'number') lastRestarts = Math.max(lastRestarts, report.healBaseline);
}

module.exports = { build, commitHeal, tunnelState, classify, CODES, ENROL_FILES, resetForTests: () => { lastRestarts = 0; } };
