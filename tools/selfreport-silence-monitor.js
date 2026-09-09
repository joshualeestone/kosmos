#!/usr/bin/env node
'use strict';

/* #2522: the LOUD half of the self-report silence detector (see
 * engine/selfreport-freshness.js for the pure verdict, which is where the
 * logic and the tests live).
 *
 * Modelled on kosmos-relay's coordinator-monitor.sh, and carrying its two
 * hard-won properties:
 *
 *  1. REPORT, NEVER ACT. There is no safe automatic remedy for a self-report
 *     outage -- #2509's fix was a board.token mirror plus a board restart, both
 *     judgement calls, and "restart the board" can mint a new signing key and
 *     orphan every enrolled Mac. So this shouts and stops.
 *
 *  2. THE HEALTHY PATH IS SILENT, so a dead alert channel is indistinguishable
 *     from a healthy fleet -- UNLESS something crosses the channel on the
 *     healthy path too. A periodic "still watching" heartbeat does that: its
 *     ABSENCE is the signal that the monitor itself has died. The heartbeat
 *     clock advances only on a post that SUCCEEDED, or a dead channel would
 *     keep marking itself watched forever.
 *
 * It samples on a schedule (a launchd LaunchAgent, 15 min), so a sub-15-min
 * blip is invisible by design -- the right trade for catching a 5-DAY silence.
 *
 * SEAMS (a PATH-based `gh` stub cannot test this, and the post branch is
 * otherwise never exercised -- coordinator-monitor.sh's own lesson):
 *   MONITOR_GH_CMD          the gh binary (default: gh)
 *   MONITOR_AGENT_COUNT     inject the running-agent count directly (tests)
 *   MONITOR_AGENT_COUNT_CMD a shell command whose stdout is the count
 *   MONITOR_NOW_MS          inject the clock (tests)
 *   MONITOR_HEARTBEAT_STATE the heartbeat state file
 * `node tools/selfreport-silence-monitor.js --check` prints the verdict as
 * JSON and exits 0 (fresh/expected) or 1 (stale) WITHOUT posting -- for manual
 * use, CI, and tests.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../engine/store');
const { freshnessVerdict } = require('../engine/selfreport-freshness');

/* The store's selfreports dir, derived PURELY. Deliberately NOT via
 * `selfreport.DIR`: that module computes its path from `store.ROOT`, whose
 * getter runs `maybeMigrateLegacyStore()` -- so merely importing it would make
 * this read-only monitor MIGRATE the store, which is an action, and this
 * monitor's whole contract is report-never-act. `store.dataRootFor(...)` is the
 * same path derivation with no migration side effect, and it is rename-robust
 * (keyed on `store.APP`), which is the #2439 lesson that CAUSED #2509. */
function defaultStoreDir() {
  const home = process.env.AGENT_WORKFORCE_HOME || os.homedir();
  return path.join(store.dataRootFor(process.platform, home, process.env), 'selfreports');
}

const REPO = process.env.KOSMOS_REPO || 'joshualeestone/kosmos';
const ISSUE = process.env.SELFREPORT_SILENCE_ISSUE || '2522';
const MARK = '[selfreport-silence-monitor]';

/* A positive-number env override, or the default. A non-numeric or non-positive
 * override (a typo like SELFREPORT_STALE_MINUTES=fortyfive) would otherwise yield
 * NaN, and `ageMs > NaN` is always false -- silently DISABLING the alarm (fail-quiet,
 * the dangerous direction for a monitor). Fall back to the default instead. */
function posNum(raw, dflt) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
const STALE_MIN = posNum(process.env.SELFREPORT_STALE_MINUTES, 45);
const HEARTBEAT_DAYS = posNum(process.env.SELFREPORT_HEARTBEAT_DAYS, 7);
/* Re-alarm throttle: a real outage lasts days, and at a 15-min sample an
 * unthrottled stale branch would post hundreds of near-identical comments and
 * BURY the very signal it raises. Re-post the alarm at most once per this window;
 * the first alarm is immediate, then reminders. Advances only on a successful post
 * (like the heartbeat), so a dead channel keeps trying rather than going quiet. */
const ALARM_REPOST_HOURS = posNum(process.env.SELFREPORT_ALARM_REPOST_HOURS, 6);
const HEARTBEAT_STATE = process.env.MONITOR_HEARTBEAT_STATE
  || path.join(process.env.HOME || os.homedir(), '.cache', 'kosmos-selfreport-silence-heartbeat.txt');
const ALARM_STATE = process.env.MONITOR_ALARM_STATE
  || path.join(process.env.HOME || os.homedir(), '.cache', 'kosmos-selfreport-silence-alarm.txt');

/* Is this process command name a running Claude agent? THE CANONICAL RULE, applied
 * inline (issue #252, `~/.claude/scripts/lib/claude-process-classify.sh`, mirrored by
 * status.js `isUnambiguousClaude`): a legacy name (`claude`/`claude.exe`) OR a
 * 3-segment semver SHAPE. The native installer (2.1.x+) runs a versioned executable,
 * so the process name is the VERSION STRING (e.g. `2.1.212`), NOT `claude` -- a bare
 * `claude` match reads 0 on the native fleet and would suppress this alarm forever,
 * the exact class the canonical rule exists to close. NOT bare `node` (the board and
 * tooling are node; counting them would make the gate always-satisfied). The lib
 * sanctions "source THIS or APPLY ITS RULE"; applied here + pinned by a test so a
 * drift is caught. NOTE: on macOS (the launchd runtime this ships on) `ps -axo comm=`
 * returns the FULL executable path, not the basename, so the strip below is
 * LOAD-BEARING on every line, not merely defensive: deleting it would make every
 * command read as a full path, match nothing, and suppress the alarm forever. */
function isAgentCommand(comm) {
  if (typeof comm !== 'string') return false;
  const c = comm.trim().replace(/^.*\//, ''); // REQUIRED: ps comm is a full path on macOS
  return c === 'claude' || c === 'claude.exe' || /^[0-9]+\.[0-9]+\.[0-9]+$/.test(c);
}

/* Running-agent count: the false-alarm gate's input. A proxy for "agents that
 * SHOULD be reporting" -- the generous threshold absorbs a legitimately-quiet
 * running agent (see the plan's named weakest premise). Resolved, in order:
 * an injected MONITOR_AGENT_COUNT (tests), a MONITOR_AGENT_COUNT_CMD, else the
 * process table filtered by isAgentCommand. Any failure yields 0, which CANNOT
 * alarm -- the safe direction (a broken count silences the monitor rather than
 * false-firing). `ps`/`sh` via PATH (launchd sets a controlled PATH), matching
 * sibling monitors. */
function resolveAgentsRunning() {
  if (process.env.MONITOR_AGENT_COUNT !== undefined) {
    const n = Number(process.env.MONITOR_AGENT_COUNT);
    return Number.isFinite(n) ? n : 0;
  }
  const cmd = process.env.MONITOR_AGENT_COUNT_CMD;
  try {
    if (cmd) {
      const out = execFileSync('sh', ['-c', cmd], { encoding: 'utf8' });
      const n = Number(out.trim());
      return Number.isFinite(n) ? n : 0;
    }
    // Enumerate the process table and count Claude agent commands (legacy names
    // AND native version-string names). `ps -axo comm=` prints one command basename
    // per line, no header.
    const out = execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' });
    return out.split('\n').filter(isAgentCommand).length;
  } catch {
    return 0;
  }
}

function nowMs() {
  const injected = Number(process.env.MONITOR_NOW_MS);
  return Number.isFinite(injected) && injected > 0 ? injected : Date.now();
}

function computeVerdict() {
  return freshnessVerdict({
    // MONITOR_STORE_DIR overrides the store path for tests (so the loud half can
    // be exercised against a temp store without touching the live one); prod uses
    // defaultStoreDir() (the pure, migration-free derivation above).
    dir: process.env.MONITOR_STORE_DIR || defaultStoreDir(),
    nowMs: nowMs(),
    agentsRunning: resolveAgentsRunning(),
    staleAfterMs: STALE_MIN * 60 * 1000,
  });
}

// --- posting (the seam) ----------------------------------------------------

function gh(args) {
  const bin = process.env.MONITOR_GH_CMD || 'gh';
  return execFileSync(bin, args, { encoding: 'utf8' });
}

function postComment(body) {
  // Returns true only if gh actually succeeded, so the heartbeat clock (which
  // gates on this) never advances over a dead channel.
  try {
    gh(['issue', 'comment', ISSUE, '--repo', REPO, '--body', body]);
    return true;
  } catch (e) {
    // A lapsed auth must not crash the monitor into a restart loop; report the
    // failure to stdout (launchd logs it) and let the missing heartbeat speak.
    process.stdout.write(`${MARK} could not post (gh failed): ${e && e.message}\n`);
    return false;
  }
}

/* Has it been at least `intervalMs` since we last posted through `stateFile`?
 * Used to throttle BOTH the heartbeat (every HEARTBEAT_DAYS) and the stale-alarm
 * re-post (every ALARM_REPOST_HOURS). A missing/garbled state file reads DUE, so
 * the first post always goes out and a wiped state only re-posts sooner. */
function postDueSince(stateFile, intervalMs) {
  try {
    const last = Number(fs.readFileSync(stateFile, 'utf8').trim());
    if (!Number.isFinite(last)) return true;
    return nowMs() - last > intervalMs;
  } catch {
    return true;
  }
}

function markPosted(stateFile) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, String(nowMs()));
  } catch { /* best effort; a missed mark just re-posts sooner */ }
}

// --- main ------------------------------------------------------------------

function alertBody(v) {
  const ageMin = v.ageMs === null ? 'n/a' : Math.round(v.ageMs / 60000);
  const newest = v.newestAtMs === null ? 'never' : new Date(v.newestAtMs).toISOString();
  return `${MARK} the fleet's self-report path looks SILENT. `
    + `${v.agentsRunning} agent process(es) running, but the newest self-report across the store is `
    + `${ageMin} min old (newest at ${newest}, threshold ${STALE_MIN} min). `
    + `This is the #2509 shape: reports have stopped being written while agents run. `
    + `Do NOT auto-remedy - check the board's report route (boardauth / #1968 gate) and store path.`;
}

function run(argv) {
  const v = computeVerdict();

  if (argv.includes('--check')) {
    process.stdout.write(JSON.stringify(v) + '\n');
    return v.stale ? 1 : 0;
  }

  if (v.stale) {
    // Re-post at most once per ALARM_REPOST_HOURS so a multi-day outage does not
    // bury the signal under hundreds of identical comments. The exit code still
    // reflects staleness every sample (a launchd log line each time); only the
    // ISSUE POST is throttled.
    if (postDueSince(ALARM_STATE, ALARM_REPOST_HOURS * 60 * 60 * 1000)) {
      if (postComment(alertBody(v))) markPosted(ALARM_STATE);
    }
    return 1; // exit non-zero on a real alarm, so a wrapper/launchd log reflects it
  }

  // Healthy / expected. Silent, except the periodic proof-of-life heartbeat,
  // whose ABSENCE is how a dead monitor is noticed. Clear the alarm state so the
  // NEXT outage alarms immediately rather than waiting out a stale throttle.
  clearAlarm();
  if (postDueSince(HEARTBEAT_STATE, HEARTBEAT_DAYS * 24 * 60 * 60 * 1000)) {
    if (postComment(`${MARK} still watching. Fleet self-report path healthy `
      + `(${v.reason}; ${v.agentsRunning} agent process(es) running).`)) {
      markPosted(HEARTBEAT_STATE);
    }
  }
  return 0;
}

/* On a return to health, forget the last-alarm time so a FUTURE outage alarms on
 * its first sample instead of being silenced by the previous outage's throttle
 * window. Best-effort; a lingering file only delays one re-alarm by the window. */
function clearAlarm() {
  try { fs.rmSync(ALARM_STATE, { force: true }); } catch { /* best effort */ }
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}

module.exports = { run, computeVerdict, alertBody, resolveAgentsRunning, isAgentCommand };
