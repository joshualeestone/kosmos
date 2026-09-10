'use strict';
/**
 * A Windows agent's working/idle, read from its OWN event stream (#570 7c-5).
 *
 * 🛑 WHY THIS EXISTS. Every Windows agent is a STREAMING session (7c-2), and its
 * row in `claude agents --json` carries no `status` field at all (measured
 * 2026-09-10: keys pid, cwd, kind, startedAt, sessionId, name), so `win32capture`
 * answered UNKNOWN for every Windows card. The supervisor holds the agent's
 * stdout, and `--output-format stream-json --verbose` puts every event of every
 * turn on it. That is a better source than the Mac's pane scrape: it is what the
 * agent did, not a guess at what its screen means.
 *
 * MEASURED on this box before any of this was written (claude.exe, streaming):
 *   - nothing arrives before the first message, on a fresh session OR a resume
 *   - each message is one turn: system/init ~50ms after the write, then
 *     assistant (text, tool_use, thinking) and user (tool_result) events, then
 *     exactly one `result`; two messages written back to back ran as two turns,
 *     6ms apart, never batched
 *   - rate_limit_event arrives mid-turn and says nothing about working/idle
 *
 * So a message written, or any in-turn event, is BUSY; a `result` is IDLE; a
 * start is IDLE. Nothing is counted: a counter that missed one event would be
 * wrong forever, while this reading corrects itself on the next event.
 *
 * 🔑 THE BOARD IS ANOTHER PROCESS, so the state crosses as a small file per agent,
 * stamped with the session id and the agent's pid. `claude agents --json` lists
 * that same pid (measured: the spawned child's own pid), so `stateFor` accepts a
 * file only when both match the LIVE row. A file left by a dead or earlier
 * process can never describe the one running now.
 *
 * ⚠️ IT IS STILL THE FALLBACK. needs_you / blocked come from the self-report path,
 * and reconcileReport outranks this exactly as it outranks a Mac pane scrape.
 */
const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const store = require('./store');

/** The tokens `claude agents --json` uses for an interactive session, so
    status.classify's win32 arm reads either source without a second vocabulary. */
const BUSY = 'busy';
const IDLE = 'idle';

/** Bumped if the file's shape ever changes, so a board never trusts a file it
    was not written to read. */
const STATE_FILE_VERSION = 1;

/** A stream line longer than this is skipped whole rather than buffered. Only an
    event's `type` matters here and a tool result can be megabytes; without a bound
    one enormous line grows the supervisor's heap without limit. 16M characters is
    far past any line measured, and small enough that the supervisor survives it. */
const MAX_LINE_CHARS = 16 * 1024 * 1024;

/** How long before retrying a state write that failed. On Windows a rename onto a
    file the board is reading at that instant fails with EPERM, and a moment later
    it does not. */
const WRITE_RETRY_MS = 250;

function stateDir() { return path.join(store.ROOT, 'win32-state'); }
/* Same key the rest of the store uses, so this agent's state, pipe, token and
   profile can never be filed under two spellings of one name. */
function statePath(name) { return path.join(stateDir(), store.safeKey(name) + '.json'); }

/** What one stream event means for working/idle: BUSY, IDLE, or null for no claim. */
function stateAfterEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.type === 'result') return IDLE;
  if (event.type === 'assistant' || event.type === 'user') return BUSY;
  /* Only `init`: it is the one system event measured to open a turn. Another
     subtype arriving between turns must not strand the card on WORKING. */
  if (event.type === 'system' && event.subtype === 'init') return BUSY;
  return null;
}

/** One stream line as an event, or null when it is not JSON. */
function parseEvent(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/**
 * Split a byte stream into lines and hand each non-blank one to `onLine`.
 *
 * UTF-8 safe across chunk boundaries (a character split between two chunks is
 * held, not mangled), and bounded: a line that grows past MAX_LINE_CHARS is
 * dropped whole, and reading resumes at the next newline.
 */
function lineReader(onLine) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  let skipping = false;
  return function feed(chunk) {
    /* Search only what just arrived: what was already buffered is known to hold
       no newline. Re-scanning it on every chunk made one long line cost the square
       of its length (measured: a 16MB line in 64KB chunks held the supervisor's
       event loop, which also serves the channel, for half a second). */
    let from = buf.length;
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let nl;
    while ((nl = buf.indexOf('\n', from)) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      from = 0;
      if (skipping) { skipping = false; continue; }
      if (line.trim()) onLine(line);
    }
    if (buf.length > MAX_LINE_CHARS) { buf = ''; skipping = true; }
  };
}

function writeState(name, record) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    const at = statePath(name);
    /* Write-then-rename, as store.writeProfile does, so the board can never read a
       half-written file. The temp name carries the pid so two writers could not
       share one temp file. */
    const tmp = at + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, at);
    return { ok: true };
  } catch (e) {
    return { ok: false, because: (e && e.code) || 'unknown' };
  }
}

/* Returns whether the file is gone. After a death a leftover is harmless -- it
   names a pid that is no longer listed -- but when the publisher clears a LIVE
   process's older state, a failed delete leaves that state readable, so the
   caller reports it. */
function clearState(name) {
  try { fs.rmSync(statePath(name), { force: true }); return true; } catch { return false; }
}

/**
 * The state token for `name`, IF its file describes exactly this live session and
 * process; null otherwise, which the board reads as UNKNOWN. Never throws.
 *
 * @param {string} name the recorded agent name
 * @param {{sessionId: string, pid: number}} live the agent's row from `claude agents --json`
 */
function stateFor(name, live) {
  if (!live || typeof live.sessionId !== 'string' || !live.sessionId || !Number.isInteger(live.pid)) return null;
  let rec;
  try { rec = JSON.parse(fs.readFileSync(statePath(name), 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || rec.v !== STATE_FILE_VERSION) return null;
  if (rec.sessionId !== live.sessionId || rec.pid !== live.pid) return null;
  return rec.state === BUSY || rec.state === IDLE ? rec.state : null;
}

/**
 * The supervisor's side: keep `name`'s state file in step with its agent.
 *
 * Writes only on a TRANSITION, so a turn of a hundred events costs two writes.
 * `write`, `clear`, `setTimer` and `onProblem` are injectable for tests;
 * `onProblem` gets a sentence for the task log whenever a state could not be
 * recorded.
 */
function publisher(name, opts) {
  const o = opts || {};
  const write = o.write || ((rec) => writeState(name, rec));
  const clear = o.clear || (() => clearState(name));
  const timer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const onProblem = typeof o.onProblem === 'function' ? o.onProblem : () => {};

  let current = null;      // { pid, sessionId, state } of the agent running now
  let written = null;      // the state last put on disk for `current`
  let retrying = false;
  /* Bumped on every start and stop, so a retry armed for one process can never
     act as the second attempt for the next. */
  let generation = 0;

  /* `retrying` is true from a failed write until the next write that SUCCEEDS, so
     the retry below -- or any transition that comes first -- is the second
     attempt, and a second failure in a row is what clears. */
  function flush() {
    if (!current || written === current.state) { retrying = false; return; }
    const r = write({ v: STATE_FILE_VERSION, state: current.state, sessionId: current.sessionId, pid: current.pid, at: new Date().toISOString() });
    if (r && r.ok) { written = current.state; retrying = false; return; }
    onProblem('we could not record its state (' + ((r && r.because) || 'unknown') + ')');
    if (retrying) {
      /* 🛑 A SECOND FAILURE IN A ROW CLEARS THE FILE. What is on disk now is an
         OLDER state, and a board reading "working" about an idle agent is worse
         than one that says it cannot tell. The next transition starts over. */
      retrying = false;
      written = null;
      if (clear() === false) onProblem('we could not clear its older state either, so its card may be out of date until it next changes');
      return;
    }
    retrying = true;
    const armedFor = generation;
    timer(() => { if (retrying && armedFor === generation) flush(); }, WRITE_RETRY_MS);
  }

  return {
    /** A new agent process is up: idle until it is told something. */
    started(pid, sessionId) {
      generation += 1;
      retrying = false;
      written = null;
      if (!Number.isInteger(pid) || typeof sessionId !== 'string' || !sessionId) { current = null; clear(); return; }
      current = { pid, sessionId, state: IDLE };
      flush();
    },
    /** One parsed stream event. */
    event(e) {
      const next = stateAfterEvent(e);
      if (next && current) { current.state = next; flush(); }
    },
    /** A message reached the agent's stdin. */
    wrote() {
      if (current) { current.state = BUSY; flush(); }
    },
    /** The agent process is gone. */
    stopped() {
      generation += 1;
      current = null;
      written = null;
      retrying = false;
      clear();
    },
  };
}

module.exports = { lineReader, parseEvent, publisher, stateFor };
