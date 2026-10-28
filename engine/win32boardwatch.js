'use strict';
/**
 * #2988: the Windows board's supervision. Two halves, one log.
 *
 * 🛑 WHY THIS EXISTS. On the Windows box the board process died between 22:57 on 10-13 and 00:20
 * on 10-14 and nothing started it again for about three and a half days: the `Kosmos\board` task
 * starts it only at logon, and nothing else watches it. Nor was there any record of WHY it died:
 * the board's output goes to a headless console that is never saved. On a Mac, launchd's
 * KeepAlive brings the board back; Windows had no equivalent.
 *
 *  1. THE EXIT LINE (recordBoardExits), in a board its task started. One line when it starts and
 *     one when it exits, with the cause it can see: its host process was gone (the `/End` path,
 *     engine/win32orphan.js), a console signal, an uncaught error and its message, or an exit of
 *     its own with its code. A hard kill (TerminateProcess) runs no code, so it writes nothing,
 *     and that absence is itself the answer the watchdog reports.
 *
 *  2. THE WATCHDOG (watchdogMain), run once a minute by the `Kosmos\board-watchdog` task
 *     (engine/win32board.js registers it beside the board's). It `/Run`s the board task only when
 *     ALL of these hold, cheapest first:
 *       a. this computer may start a board at all: a computer set to connect to Kosmos on another
 *          computer runs none on purpose (#4382; win32apply.boardMayStart, the updater's own rule);
 *       b. no update is in flight: its journal is not unfinished (nor unreadable), and its lock is
 *          not held (win32apply.readJournal and win32update.lockHeldNow, the updater's own readers);
 *       c. nothing answers on this account's board port (the uninstall's look on every address,
 *          and win32handoff.boardMayBeOpen: only a refused connection means no board);
 *       d. the board task exists and is switched on (switched off is a deliberate stop: the
 *          launcher's StopBoardHere, the uninstall, Settings' sign-in switch), and Task Scheduler
 *          does not already show it running (a `/Run` then would be ignored, IgnoreNew);
 *       e. the port is still silent a few seconds later, and b still holds, so a board mid-boot
 *          or mid-hand-off is not raced.
 *     It writes one line to the board's log when it starts the board, and nothing on any other
 *     run, so the log is not a once-a-minute diary.
 *
 * 🔑 THE LOG LIVES WHERE THE AGENT SUPERVISORS' DO, `<Kosmos data>\win32-logs\board.log`, through
 * engine/win32supervisorlog.js (bounded, rotated, secrets redacted), with ONE difference: the data
 * root is read from the environment before any named world was applied (worlds.preWorldEnv),
 * because the watchdog runs outside every world and must read the same file the board wrote.
 * Every line starts with an ISO time and the word `board`, so the watchdog's reading cannot be
 * confused by anything else in the file.
 *
 * Nothing here throws into the process it runs in.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const LOG_NAME = 'board';
/* How long the watchdog waits between its two looks at the port. A board that is booting, or a
   hand-off between its `/End` and `/Run`, is given this long to answer before it is started. */
const SECOND_LOOK_AFTER_MS = 5000;
/* The most one watchdog run may take. The task's repetition is a minute and IgnoreNew, so a run
   that hung would cost every check after it; the shim's process leaves at this point regardless. */
const RUN_DEADLINE_MS = 50 * 1000;
/* An uncaught error's message is kept to one line of at most this many characters. */
const MESSAGE_MAX = 300;
/* The console signals a task-started board records, each with its conventional exit code. */
const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGBREAK', 'SIGTERM'];

/* Only the lines this module writes: an ISO time, then `board`. Anything else in the file (an
   agent that happens to be named `board` shares the name) is never read as the board's. */
const STARTED_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z board started pid=/;
const EXITED_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z board exited pid=/;

/** The environment as it was before any named world was applied. Never throws. */
function baseEnv(env) {
  const e = env || process.env;
  try { return require('./worlds').preWorldEnv(e); } catch { return { ...e }; }
}

/** `<data root>\win32-logs`, for the environment before any world. See the header. */
function boardLogDir(env) {
  const e = baseEnv(env);
  const store = require('./store');
  return path.join(store.resolveDataRoot(process.platform, e.AGENT_WORKFORCE_HOME || os.homedir(), e), 'win32-logs');
}

function boardLogger(o) {
  return require('./win32supervisorlog').logger(LOG_NAME, { dir: o.logDir || boardLogDir(o.env) });
}

function stamp(now) {
  try { return new Date(now()).toISOString(); } catch { return 'unknown-time'; }
}

function oneLine(text) {
  const s = String(text == null ? '' : text).split(/\r?\n/)[0].trim();
  return s.length > MESSAGE_MAX ? s.slice(0, MESSAGE_MAX) + '...' : s;
}

function signalCode(sig) {
  const n = os.constants && os.constants.signals ? os.constants.signals[sig] : undefined;
  return 128 + (Number.isInteger(n) ? n : 1);
}

/**
 * Record this board's start, and its exit with the cause it can see. For a TASK-STARTED board only:
 * server.js calls this where it used to arm exitWhenParentGone, and this arms it, so a hand-started
 * board (a person's Ctrl+C) behaves exactly as before.
 *
 * `o` (all optional, the seams): proc (process), parentPid, now, logDir, env, line (one-line writer),
 * watch (exitWhenParentGone), isAlive, pollMs.
 * Returns `{ armed, cause() }`. Never throws.
 */
function recordBoardExits(opts) {
  const o = opts || {};
  const proc = o.proc || process;
  const now = o.now || Date.now;
  let write;
  try {
    const log = typeof o.line === 'function' ? { line: o.line } : boardLogger(o);
    write = (text) => { try { log.line(stamp(now) + ' board ' + text); } catch { /* the log must never take the board down */ } };
  } catch { write = () => {}; }
  const pid = proc.pid;
  const parentPid = Number.isInteger(o.parentPid) ? o.parentPid : proc.ppid;
  let cause = null;
  let wrote = false;

  write('started pid=' + pid + ' parent=' + parentPid);

  try {
    proc.on('exit', (code) => {
      if (wrote) return;
      wrote = true;
      write('exited pid=' + pid + ' code=' + code + ': ' + (cause || 'it exited by itself'));
    });
  } catch { /* nothing to record with */ }

  /* An uncaught error. The monitor changes nothing about what happens next; the cause is kept only
     when nothing else will catch it, since a process with an uncaughtException handler lives on. */
  try {
    proc.on('uncaughtExceptionMonitor', (err) => {
      try {
        if (typeof proc.listenerCount === 'function' && proc.listenerCount('uncaughtException') > 0) return;
        const name = err && err.name ? err.name + ': ' : '';
        cause = 'an uncaught error (' + oneLine(name + ((err && err.message) || err)) + ')';
      } catch { /* the monitor must never throw */ }
    });
  } catch { /* nothing to record with */ }

  for (const sig of SIGNALS) {
    try {
      proc.on(sig, () => {
        cause = 'a console signal (' + sig + ')';
        try { proc.exit(signalCode(sig)); } catch { /* already leaving */ }
      });
    } catch { /* this platform does not know that signal */ }
  }

  let watch = { armed: false };
  try {
    const arm = o.watch || require('./win32orphan').exitWhenParentGone;
    watch = arm({
      parentPid,
      isAlive: o.isAlive,
      pollMs: o.pollMs,
      setInterval: o.setInterval,
      clearInterval: o.clearInterval,
      onGone: (gonePid) => {
        cause = 'its host process (pid ' + gonePid + ') was gone';
        proc.exit(0);
      },
    }) || { armed: false };
  } catch { watch = { armed: false }; }

  return { armed: Boolean(watch.armed), watch, cause: () => cause };
}

/**
 * The last exit line written since the last start line, or null. Reads the live log and its one
 * rotation (a rotation moves the newest lines aside, win32supervisorlog's rule). Never throws.
 */
function lastExitSinceStart(file) {
  const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const lines = (readText(file + '.1') + '\n' + readText(file)).split(/\r?\n/);
  let lastStart = -1;
  for (let i = 0; i < lines.length; i += 1) if (STARTED_RE.test(lines[i])) lastStart = i;
  for (let i = lines.length - 1; i > lastStart; i -= 1) {
    if (EXITED_RE.test(lines[i])) return lines[i];
  }
  return null;
}

/** The board's port: PORT when it is a usable number, the default otherwise. The launcher's rule
    (KosmosLauncher.BoardPort), which is also what the task's board gets from the same account. */
function boardPortFrom(env) {
  const raw = (env || {}).PORT;
  const n = Number(raw);
  if (raw !== undefined && raw !== '' && Number.isInteger(n) && n > 0 && n < 65536) return n;
  return require('./win32update').DEFAULT_BOARD_PORT;
}

/**
 * Is an update in flight? `{ inFlight: false }` or `{ inFlight: true, why }`. A doubt is in flight:
 * a journal that cannot be read, or a lock that cannot be judged, starts nothing.
 * `o`: anchorDir (where the journal is), root (the Kosmos folder whose working folder holds the lock).
 */
function updateInFlight(o) {
  try {
    const apply = require('./win32apply');
    const update = require('./win32update');
    const read = apply.readJournal(apply.journalPathFor(o.anchorDir));
    if (read.state === 'unfinished') return { inFlight: true, why: 'an update has not finished' };
    if (read.state === 'unreadable') return { inFlight: true, why: 'the record of an update cannot be read' };
    const root = (read.state === 'finished' && read.journal && read.journal.root) || o.root;
    if (!root) return { inFlight: true, why: 'the Kosmos folder is not known' };
    const lock = update.lockHeldNow(path.join(root, update.WORK_DIRNAME, update.LOCK_NAME), o.lockHooks);
    if (lock.held) return { inFlight: true, why: 'the update lock is held (' + lock.why + ')' };
    if (lock.broken) return { inFlight: true, why: 'the update lock ' + lock.why };
    return { inFlight: false };
  } catch (e) {
    return { inFlight: true, why: 'the update state could not be read (' + oneLine(e && e.message) + ')' };
  }
}

/* The production seams; a test passes its own in `deps`. */
function defaultDeps(o) {
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  const handoff = () => require('./win32handoff');
  return {
    board: require('./win32board'),
    mayStartBoard: () => require('./win32apply').boardMayStart(env, home),
    updateInFlight: () => updateInFlight({ anchorDir: o.anchorDir, root: o.root || path.resolve(__dirname, '..', '..') }),
    look: async (port) => {
      const h = handoff();
      const answer = await h.probeBoardOnEveryAddress(port, env);
      return { silent: !h.boardMayBeOpen(answer) };
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  };
}

/**
 * One watchdog run. Returns `{ action, why? }`: 'started', 'start-failed', or 'left' with the gate
 * that held. Writes one line to the board's log when it starts the board (or fails to), nothing
 * otherwise. Never throws.
 *
 * `o`: anchorDir (the shim's folder), env, home, root, logDir, port, secondLookAfterMs, deps
 * ({ board, mayStartBoard, updateInFlight, look, sleep, now }).
 */
async function watchdogRun(opts) {
  const o = opts || {};
  try {
    const d = { ...defaultDeps(o), ...(o.deps || {}) };
    const env = o.env || process.env;
    const port = Number.isInteger(o.port) ? o.port : boardPortFrom(env);
    const left = (why) => ({ action: 'left', why });

    if (!d.mayStartBoard()) return left('this computer does not run its own board');
    const upd = d.updateInFlight();
    if (!upd || upd.inFlight !== false) return left((upd && upd.why) || 'the update state is not known');
    const first = await d.look(port);
    if (!first || !first.silent) return left('a board answers');
    const st = d.board.status();
    if (!st || !st.known) return left('the board task could not be read');
    if (!st.registered) return left('there is no board task');
    if (st.enabled !== true) return left('the board task is switched off');
    if (st.running === true) return left('the board task is already running');
    await d.sleep(Number.isFinite(o.secondLookAfterMs) ? o.secondLookAfterMs : SECOND_LOOK_AFTER_MS);
    const second = await d.look(port);
    if (!second || !second.silent) return left('a board answers');
    const again = d.updateInFlight();
    if (!again || again.inFlight !== false) return left((again && again.why) || 'the update state is not known');

    const log = boardLogger(o);
    const now = d.now || Date.now;
    /* Read BEFORE the /Run, so the start line of the board it starts can never hide the exit. */
    let last = null;
    try { last = lastExitSinceStart(log.file); } catch { last = null; }
    const ran = d.board.runNow();
    const said = last
      ? 'The last exit recorded: ' + last.replace(/^\S+ board /, '') + ' (at ' + last.split(' ')[0] + ')'
      : 'No exit was recorded, so it was killed or crashed hard';
    if (!ran || !ran.ok) {
      log.line(stamp(now) + ' board was not answering; could not start it (' + oneLine(ran && ran.because) + '). ' + said);
      return { action: 'start-failed', why: ran && ran.because };
    }
    log.line(stamp(now) + ' board was not answering; started it. ' + said);
    return { action: 'started' };
  } catch (e) {
    return { action: 'left', why: 'the check failed (' + oneLine(e && e.message) + ')' };
  }
}

/**
 * The watchdog task's entry, called by the shim win32board.WATCH_JS writes. One run, bounded by
 * RUN_DEADLINE_MS, then the caller exits.
 */
function watchdogMain(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ action: 'left', why: 'the check took too long' }), RUN_DEADLINE_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    watchdogRun(o).then((r) => { clearTimeout(timer); resolve(r); }, () => { clearTimeout(timer); resolve({ action: 'left' }); });
  });
}

module.exports = {
  recordBoardExits, watchdogMain, watchdogRun, updateInFlight, lastExitSinceStart, boardLogDir, boardPortFrom,
  SIGNALS, SECOND_LOOK_AFTER_MS,
};
