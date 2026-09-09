'use strict';

/* #2522: detect when the fleet's self-report path has gone SILENT.
 *
 * #2509 was a fleet-wide self-report + liveness outage that ran ~5 days
 * UNDETECTED, because nothing watched for silence: the board's report route
 * refused every untokened `kosmos report` and simply stopped writing, and the
 * only human-facing signal was an in-session line nobody saw. This module is
 * the missing detector's PURE core -- the verdict, with no clock, no process
 * probe and no scheduler baked in, so a test drives all of it. The loud half
 * (tools/selfreport-silence-monitor.js) resolves the real inputs and shouts.
 *
 * The signal is deliberately the self-report store's freshness rather than
 * liveness: liveness froze WITH selfreports in #2509 (both are written by the
 * one report handler -- see the "(a) decouple the beat" follow-up), so it is
 * not yet an independent clock. Freshness is the signal available today.
 */

const fs = require('fs');
const path = require('path');

/* Read only the LAST slice of a report file, matching the 64KB window
 * selfreport.js's own reader (TAIL_BYTES) uses on these same files -- a working
 * agent heartbeats, so the .jsonl grows for days (#2509 ran ~5), and this monitor
 * polls every 15 min; an unbounded readFileSync would re-read and re-parse every
 * agent's entire growing file each tick. 64KB holds hundreds of transitions, far
 * more than the newest-line answer needs. (Not imported from selfreport.js: that
 * module's load triggers the store migration -- see the monitor's defaultStoreDir
 * note -- so the constant is redeclared here with this citation.) */
const TAIL_BYTES = 64 * 1024;

/* The newest `at` (ms since epoch) in one .jsonl self-report file, or null.
 * Reads from the END so a partial final line (a write in flight) does not
 * decide the answer: we scan upward for the last line that parses AND carries
 * a usable `at`. A file that is empty, all-blank, or all-unparseable yields
 * null rather than throwing -- a broken file is "no reading", not a crash. The
 * tail window's own first line may be cut mid-record, but it is the OLDEST line
 * in the window and is only examined if every newer line failed to parse, where
 * a torn line failing JSON.parse and yielding null is the safe direction. */
function newestAtInFile(file) {
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = size > TAIL_BYTES ? size - TAIL_BYTES : 0;
      const len = size - start;
      buf = Buffer.alloc(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, start);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null; // unreadable/absent file: contributes nothing, never throws
  }
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let at;
    try {
      at = JSON.parse(line).at;
    } catch {
      continue; // a partial/garbled line: keep scanning upward
    }
    if (typeof at !== 'string') continue;
    const ms = Date.parse(at);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/* The newest `at` across every *.jsonl in `dir`, or null if the directory is
 * absent/empty or holds no parseable report. Enumerates the whole directory:
 * "has ANY agent reported recently" is a fleet-wide question, so one fresh
 * file is enough to prove the path is alive. */
function newestReportMs(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null; // no store dir yet: no reports, not an error
  }
  let newest = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const ms = newestAtInFile(path.join(dir, name));
    if (ms !== null && (newest === null || ms > newest)) newest = ms;
  }
  return newest;
}

/* The verdict. PURE: the caller injects `nowMs`, `agentsRunning` and
 * `staleAfterMs`, and either a `dir` to walk or a precomputed `newestAtMs`
 * (the test uses the latter to pin the boundary without touching the fs).
 *
 * `stale` is true ONLY when agents are running AND there is a prior report AND
 * it is older than the threshold. The two guards are the whole false-alarm
 * defense:
 *  - `agentsRunning > 0`: an empty or stopped fleet writes no reports and MUST
 *    NOT alarm -- that is the expected state on a fresh install or overnight.
 *  - `newestAtMs !== null` (a prior report exists): "never reported" is not the
 *    same failure as "went silent", and without per-agent process UPTIME we
 *    cannot tell a just-launched agent (not yet reported) from one broken from
 *    install. We decline to alarm on no-reports-ever rather than false-alarm
 *    every fresh launch; #2509's shape is history-THEN-silence, which a stale
 *    prior report catches. (Known gap: reporting broken from first install is
 *    not caught here; it needs process uptime, deliberately out of scope.)
 */
function freshnessVerdict({ dir, nowMs, agentsRunning, staleAfterMs, newestAtMs } = {}) {
  const newest = newestAtMs !== undefined ? newestAtMs : newestReportMs(dir);
  const running = Number.isFinite(agentsRunning) ? agentsRunning : 0;
  const ageMs = newest === null ? null : nowMs - newest;

  let stale = false;
  let reason;
  if (running <= 0) {
    reason = 'no-agents-running';
  } else if (newest === null) {
    reason = 'no-reports-ever';
  } else if (ageMs > staleAfterMs) {
    stale = true;
    reason = 'stale';
  } else {
    reason = 'fresh';
  }

  return { newestAtMs: newest, ageMs, agentsRunning: running, stale, reason };
}

module.exports = { freshnessVerdict, newestReportMs, newestAtInFile };
