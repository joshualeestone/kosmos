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
 * 🔑 BUT IT DOES SAY WHEN THE ACCOUNT IS OUT OF USAGE (#5805). Its `rate_limit_info.status` is `rejected` when a request
 * was refused by the account's usage limit, with `resetsAt` (epoch seconds) and `rateLimitType` (shape read from the
 * installed Claude Code's own schema: status allowed | allowed_warning | rejected; resetsAt an int; rateLimitType
 * five_hour | seven_day | ...). Before this, Windows kept only the event's type, so a capped account left every card
 * reading idle while messages were typed into sessions that could not answer (17 hours, 10-18/19). A rejected event is
 * kept as the agent's `limit` until an allowed event or a turn that reached the model and succeeded clears it (an
 * account on its extra usage, sent `rejected` with isUsingOverage, is room), and `stateFor` reports
 * `limit <until> <since|-> <kind|->[ <line>]` while the reset is ahead, which status reads as the Mac's rate_limited.
 *
 * 🔑 AND IT SAYS WHEN THE SIGN-IN STOPPED WORKING (#7369). A turn refused for the sign-in ends in a `result` with
 * is_error and Claude's own sentence ("Not logged in · Please run /login", "Invalid API key ..."). It read as idle, so a
 * signed-out agent's card said nothing for days (#7366). It is kept as the agent's `auth` until a later turn reaches the
 * model and succeeds, and `stateFor` reports `auth <since> <busy|idle>[ <line>]`, which status reads as the Mac's
 * screen-read auth_failed ("Sign-in Issue"), cleared there too once the account's live check reads it signed in.
 *
 * So a message written, or any in-turn event, is BUSY; a `result` is IDLE; a
 * start is IDLE. Nothing is counted: a counter that missed one event would be
 * wrong forever, while this reading corrects itself on the next event.
 *
 * 🔑 THE BOARD IS ANOTHER PROCESS, so the state crosses as a small file per agent,
 * stamped with the session id and the agent's pid. `claude agents --json` lists
 * that same pid (measured: the spawned child's own pid), so `stateFor` accepts a
 * file only when both match the LIVE row. That is why a file left by a dead or
 * earlier process does not describe the one running now: every supervisor started
 * by its task mints a NEW session id, and within one supervisor a run's own stop
 * removes its file before a restarted child could reuse the pid. (A leftover can
 * only line up by stacking the residuals the headless plan names.)
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
/** #5805: the token's first word while the account is out of usage; `stateFor` adds the reset, the latest refusal's
    time, the limit's kind and Claude's sentence. */
const LIMIT = 'limit';
/** A result's text kept with a limit is capped: it is the vendor's sentence on its way to a card, not a transcript. */
const LIMIT_LINE_MAX = 300;
/** #7369: the token's first word while the agent's last turn was refused for its sign-in; `stateFor` adds when, the
    plain state under it, and Claude's sentence. */
const AUTH = 'auth';

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

/** #5805: an epoch time from `resetsAt` as an ISO string, or null. The schema gives seconds; a value already in
    milliseconds (past 1e12) is taken as it is, so a later change of unit cannot put the reset in 1970 or 57000 AD. */
function resetIso(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const ms = v > 1e12 ? v : v * 1000;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * #5805: what one rate_limit_event says about the account's usage limit. `undefined` for no claim, `null` when it
 * shows the account has room (allowed, a warning, or a refusal the account's extra usage covers), or `{ until, kind }`
 * for a refusal. Claude Code's own test (review 2, read from its binary): a refusal counts only with a reset time and
 * neither isUsingOverage nor overageInUse; Kosmos also treats an overageStatus of allowed or allowed_warning as room. Clearing on a finished turn is the publisher's (see event()).
 */
function limitAfterEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
  if (event.type === 'rate_limit_event') {
    const info = event.rate_limit_info;
    if (!info || typeof info !== 'object') return undefined;
    /* Review 1: Claude Code also sends `rejected` for an account running on its extra usage, whose requests still
       succeed (isUsingOverage true, overageStatus allowed). That is room, not a refusal. */
    if (info.status === 'rejected' && (info.isUsingOverage === true || info.overageInUse === true || info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning')) return null;
    if (info.status === 'rejected') {
      /* No reset time: Claude Code does not count it as a limit either, so neither does this. */
      if (resetIso(info.resetsAt) === null) return undefined;
      const kind = typeof info.rateLimitType === 'string' && /^[a-z0-9_]{1,40}$/.test(info.rateLimitType) ? info.rateLimitType : null;
      return { until: resetIso(info.resetsAt), kind };
    }
    if (info.status === 'allowed' || info.status === 'allowed_warning') return null;
    return undefined;
  }
  /* A turn that ended without an error clears it only when the turn reached the model (the publisher tracks whether an
     assistant message was seen): a local command's result made no API request, so it says nothing about the account,
     and clearing on it would leave a capped session reading idle until its next refused request (review 1, 3). */
  return undefined;
}

/* kosmos#6570: a fraction past this is not a utilization this code understands (a later change of unit to a percentage,
   say), so it is refused rather than drawn as thousands of percent. Past 1 is real (an account over its limit). */
const UTILIZATION_MAX = 2;

/** #6570: one window's reading `{ usedPct (0..100), resetsAt (epoch SECONDS) }` from a utilization (a fraction) and a
    reset time, in the status line's units (engine/kosmos-statusline.js), or null when either is not one. A reset in
    milliseconds (past 1e12) is taken as such, as resetIso does. */
function readingOf(utilization, resetsAt) {
  if (typeof utilization !== 'number' || !Number.isFinite(utilization) || utilization < 0 || utilization > UTILIZATION_MAX) return null;
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const secs = resetsAt > 1e12 ? Math.floor(resetsAt / 1000) : resetsAt;
  /* Whole points, as the status line's used_percentage is (the calibration divides by points moved, allowance.js). */
  return { usedPct: Math.round(utilization * 100), resetsAt: secs };
}

/**
 * kosmos#6570: the account's usage readings one rate_limit_event carries, `{ fiveHour, weekly }` (each a reading or
 * null), or null when it carries none.
 *
 * WHY: a Windows agent runs headless (stream-json), so Claude Code never runs its status line there, and the status
 * line was the only thing that recorded these readings (measured 10-21 on the Windows box: the row showed 1% from 10-19
 * while this event said 96%). Every turn's rate_limit_event carries them (captured on that box):
 *   "rate_limit_info":{"status":"allowed_warning","resetsAt":1792965600,"rateLimitType":"seven_day","utilization":0.96,
 *     ...,"unifiedWindows":{"five_hour":{"utilization":0.25,"resetsAt":1792611600},"seven_day":{"utilization":0.96,...}}}
 * `unifiedWindows` is marked @internal in Claude Code's own schema, so a window it does not carry falls back to the
 * top-level `utilization` + `resetsAt` when `rateLimitType` names that window. Nothing is guessed: a window with no
 * readable figure is null.
 */
function usageOfEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'rate_limit_event') return null;
  const info = event.rate_limit_info;
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  const uw = info.unifiedWindows && typeof info.unifiedWindows === 'object' && !Array.isArray(info.unifiedWindows) ? info.unifiedWindows : null;
  const windowOf = (key) => {
    const w = uw && uw[key] && typeof uw[key] === 'object' && !Array.isArray(uw[key]) ? uw[key] : null;
    const fromWindows = w ? readingOf(w.utilization, w.resetsAt) : null;
    if (fromWindows) return fromWindows;
    return info.rateLimitType === key ? readingOf(info.utilization, info.resetsAt) : null;
  };
  const fiveHour = windowOf('five_hour');
  const weekly = windowOf('seven_day');
  return fiveHour || weekly ? { fiveHour, weekly } : null;
}

/**
 * kosmos#6570: the Claude account folder a Windows agent's readings belong to, or null when that cannot be told for
 * certain (then nothing is recorded: a reading filed under the wrong account is worse than none). `configDir` is the
 * agent's CLAUDE_CONFIG_DIR (win32launch.childEnv sets exactly this, or deletes it for the default account, which then
 * reads <home>\.claude). The default's folder is the one the agent's Claude reads (its home, os.homedir()), and it is
 * used only when this process's AGENT_WORKFORCE_HOME, if it names one (a test, a sandboxed run started with it; a
 * Scheduled Task carries none), gives the same default folder (accounts.homeDir()), so a run pointed at another home
 * never writes into the real one. Only an absolute folder that already exists.
 */
function claudeAccountDirFor(configDir, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const home = typeof o.homedir === 'string' ? o.homedir : require('node:os').homedir();
  let dir;
  if (typeof configDir === 'string' && configDir) {
    dir = configDir;
  } else {
    if (!home) return null;
    dir = path.join(home, '.claude');
    const boardHome = env && typeof env.AGENT_WORKFORCE_HOME === 'string' && env.AGENT_WORKFORCE_HOME ? env.AGENT_WORKFORCE_HOME : null;
    if (boardHome) {
      const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));   // Windows folder names ignore case
      try { if (norm(path.join(boardHome, '.claude')) !== norm(dir)) return null; } catch { return null; }
    }
  }
  if (!path.isAbsolute(dir)) return null;
  try { if (!fs.statSync(dir).isDirectory()) return null; } catch { return null; }
  return dir;
}

/** #5805: whether a state token is the out-of-usage one `stateFor` writes (win32capture counts it as a good reading). */
function isLimitToken(token) {
  return typeof token === 'string' && /^limit \S+ \S+ \S+/.test(token);
}

/** #7369: whether a state token is the signed-out one `stateFor` writes (`auth <since> <busy|idle>[ <line>]`). */
function isAuthToken(token) {
  return typeof token === 'string' && /^auth \S+ (?:busy|idle)(?: |$)/.test(token);
}

/**
 * #7369: what one `result` event says about the sign-in. `undefined` for no claim, or `{ line }` when Claude Code ended
 * the turn on a sign-in error (is_error, and its sentence is one of claudesignintext's). Only a result: the assistant
 * message flagged is_api_error_message carries the same words a moment earlier, and the result is the turn's verdict.
 * Clearing is the publisher's, on the limit's own rule: a turn that reached the model and ended without an error.
 */
function signInAfterEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'result' || event.is_error !== true) return undefined;
  const text = typeof event.result === 'string' ? event.result : '';
  let apiErr = '';
  try { apiErr = event.api_error && typeof event.api_error === 'object' ? JSON.stringify(event.api_error) : (typeof event.api_error === 'string' ? event.api_error : ''); } catch { apiErr = ''; }
  const { isStreamSignInError } = require('./claudesignintext');
  /* A 401 status on the api_error itself is the sign-in too, whatever its words. */
  const status401 = !!event.api_error && typeof event.api_error === 'object' && (event.api_error.status === 401 || event.api_error.statusCode === 401);
  if (!isStreamSignInError(text) && !isStreamSignInError(apiErr) && !status401) return undefined;
  return { line: text.replace(/\s+/g, ' ').trim().slice(0, LIMIT_LINE_MAX) || null };
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
    /* Write-then-rename through store.saveFlushed, as store.writeProfile does, so the board can never read a
       half-written file, and a crash cannot leave it zero-filled (#5434 slice 21); a unique temp per save. */
    store.saveFlushed(at, JSON.stringify(record));
    return { ok: true };
  } catch (e) {
    return { ok: false, because: (e && e.code) || 'unknown' };
  }
}

/* Returns whether the file is gone (or is no longer ours). After a death a leftover
   is harmless -- it names a pid that is no longer listed -- but when the publisher
   clears a LIVE process's older state, a failed delete leaves that state readable,
   so the caller reports it.

   🛑 WITH AN OWNER, ONLY THE OWNER'S FILE IS DELETED (#570 headless). A restart can
   briefly run two supervisors for one agent: the old one leaves up to a second
   after `/End`, while the new one has already written its state. Deleting by NAME
   let the old one's stop erase the new one's file, and an idle new agent then read
   UNKNOWN until its next message (measured on the box). */
function clearState(name, ownerPid) {
  const at = statePath(name);
  /* No owner means nothing proves the file is ours, so it is left alone. Nothing
     deletes a state file by NAME: during a headless overlap that name can hold a
     still-running supervisor's valid state (review round 3 reproduced exactly
     that through a launch that never spawned). */
  if (!Number.isInteger(ownerPid)) return true;
  /* 🔑 CLAIM, THEN DECIDE -- never read-then-delete. A plain read followed by a
     delete-by-path could remove a file the new supervisor wrote in between (found
     in review round 2). Renaming is atomic: once the file is ours under a private
     name, nobody else's write can be caught by what we do with it. */
  const claim = at + '.' + process.pid + '.clear';
  try { fs.renameSync(at, claim); }
  catch (e) { return Boolean(e && e.code === 'ENOENT'); }
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(claim, 'utf8')); } catch { rec = null; }
  if (rec && typeof rec === 'object' && rec.pid === ownerPid) {
    try { fs.rmSync(claim, { force: true }); } catch { /* a private leftover; harmless */ }
    return true;
  }
  /* Not ours, or unreadable: a doubt never deletes. Put it back -- unless a newer
     file has landed at the real name meanwhile, which then wins (a hard link does
     not replace an existing name). */
  try { fs.linkSync(claim, at); }
  catch (e) {
    if (!(e && e.code === 'EEXIST')) {
      /* The put-back itself failed (a volume without hard links, say). The claim
         is now the only copy of a file that is not ours, so it is KEPT, and the
         caller hears that the clear did not go cleanly. */
      return false;
    }
    /* EEXIST: a newer file landed at the real name meanwhile, and it wins. */
  }
  try { fs.rmSync(claim, { force: true }); } catch { /* a private leftover; harmless */ }
  return true;
}

/**
 * The state token for `name`, IF its file describes exactly this live session and
 * process; null otherwise, which the board reads as UNKNOWN. Never throws.
 *
 * @param {string} name the recorded agent name
 * @param {{sessionId: string, pid: number}} live the agent's row from `claude agents --json`
 */
function stateFor(name, live, nowMs) {
  if (!live || typeof live.sessionId !== 'string' || !live.sessionId || !Number.isInteger(live.pid)) return null;
  let rec;
  try { rec = JSON.parse(fs.readFileSync(statePath(name), 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || rec.v !== STATE_FILE_VERSION) return null;
  if (rec.sessionId !== live.sessionId || rec.pid !== live.pid) return null;
  const base = rec.state === BUSY || rec.state === IDLE ? rec.state : null;
  if (base === null) return null;
  /* #5805: out of usage while the reset is ahead: `limit <until> <since|-> <kind|->[ <line>]`. Past the reset the plain state comes
     back, so the card reads released and held messages are typed. A limit with no readable reset is not one (the
     publisher never writes such a record; this is the reader refusing to trust one it did not write). */
  const lim = rec.limit;
  if (lim && typeof lim === 'object') {
    const until = typeof lim.until === 'string' && Number.isFinite(Date.parse(lim.until)) ? lim.until : null;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (until !== null && Date.parse(until) > now) {
      const kind = typeof lim.kind === 'string' && /^[a-z0-9_]{1,40}$/.test(lim.kind) ? lim.kind : '-';
      const since = typeof lim.since === 'string' && Number.isFinite(Date.parse(lim.since)) ? lim.since : '-';
      const line = typeof lim.line === 'string' && lim.line ? ' ' + lim.line : '';
      return LIMIT + ' ' + until + ' ' + since + ' ' + kind + line;
    }
  }
  /* #7369: refused for its sign-in: `auth <since> <busy|idle>[ <line>]`, after the limit (as the Mac's classify reads a
     usage limit before a dead token). The plain state rides along, so when the account's live check reads it signed in
     again (status.reconcileReport, #1930) the card falls back to what the agent is doing, not to "can't tell". No
     expiry of its own: only a later good turn (the publisher) or that live check ends it. */
  const auth = rec.auth;
  if (auth && typeof auth === 'object' && typeof auth.since === 'string' && Number.isFinite(Date.parse(auth.since))) {
    const line = typeof auth.line === 'string' && auth.line ? ' ' + auth.line : '';
    return AUTH + ' ' + auth.since + ' ' + base + line;
  }
  return base;
}

/**
 * The pid and session id `name`'s state file was last stamped with, or null. Never
 * throws.
 *
 * 🔑 THE STATE FILE DOUBLES AS A CODEX AGENT'S PRESENCE (#3380). A claude agent is
 * enumerated live by `claude agents --json`, which reports its pid; a codex agent
 * has no persistent process there (it is driven per turn by `codex exec`), so its
 * live pid is its SUPERVISOR's, which is exactly what the codex supervisor stamps
 * here at start and clears on stop. `win32codexlive` reads it back to join the
 * ownership record against a supervisor that is still alive -- the codex analog of
 * a session appearing in `agents --json`. Only the pid and id are exposed; the
 * busy/idle token stays `stateFor`'s to interpret.
 */
function liveIdentity(name) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(statePath(name), 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || rec.v !== STATE_FILE_VERSION) return null;
  if (!Number.isInteger(rec.pid) || typeof rec.sessionId !== 'string' || !rec.sessionId) return null;
  return { pid: rec.pid, sessionId: rec.sessionId };
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
  const clear = o.clear || ((ownerPid) => clearState(name, ownerPid));
  const timer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const onProblem = typeof o.onProblem === 'function' ? o.onProblem : () => {};
  /* kosmos#6570: the agent's Claude account folder (claudeAccountDirFor), where each rate_limit_event's readings are
     recorded the way the status line records them; none, and nothing is. `recordUsage` is injectable for tests. */
  /* A folder, or a function naming it (asked at each event, so an account folder made after the agent started is
     found without a restart; review 3). */
  const usageDirNow = typeof o.usageDir === 'function' ? o.usageDir
    : (() => { const d = typeof o.usageDir === 'string' && o.usageDir ? o.usageDir : null; return () => d; })();
  const recordUsage = typeof o.recordUsage === 'function' ? o.recordUsage
    : (dir, readings) => require('./kosmos-statusline').recordReadings(dir, readings, Date.now(), { latestWins: true });

  let current = null;      // { pid, sessionId, state, limit } of the agent running now
  let written = null;      // the state and limit last put on disk for `current` (see keyOf)
  let retrying = false;
  /* Bumped on every start and stop, so a retry armed for one process can never
     act as the second attempt for the next. */
  let generation = 0;

  /* `retrying` is true from a failed write until the next write that SUCCEEDS, so
     the retry below -- or any transition that comes first -- is the second
     attempt, and a second failure in a row is what clears. */
  /* #5805: a refusal can arrive while the state token does not change, so a transition is the token AND the limit. */
  /* #7369: and the sign-in record, which a result can set or clear while the token stays idle. */
  function keyOf(c) { return c.state + '\u0000' + JSON.stringify(c.limit || null) + '\u0000' + JSON.stringify(c.auth || null); }
  function flush() {
    if (!current || written === keyOf(current)) { retrying = false; return; }
    const rec = { v: STATE_FILE_VERSION, state: current.state, sessionId: current.sessionId, pid: current.pid, at: new Date().toISOString() };
    if (current.limit) rec.limit = current.limit;
    if (current.auth) rec.auth = current.auth;
    const r = write(rec);
    if (r && r.ok) { written = keyOf(current); retrying = false; return; }
    onProblem('we could not record its state (' + ((r && r.because) || 'unknown') + ')');
    if (retrying) {
      /* 🛑 A SECOND FAILURE IN A ROW CLEARS THE FILE. What is on disk now is an
         OLDER state, and a board reading "working" about an idle agent is worse
         than one that says it cannot tell. The next transition starts over. */
      retrying = false;
      written = null;
      if (clear(current.pid) === false) onProblem('we could not clear its older state either, so its card may be out of date until it next changes');
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
      if (!Number.isInteger(pid) || typeof sessionId !== 'string' || !sessionId) {
        /* A launch that did not spawn (no pid) proves nothing about the file at
           this name, which may be the still-running previous supervisor's. Only
           this publisher's OWN earlier process is cleared, never an unowned file. */
        const was = current;
        current = null;
        if (was) clear(was.pid);
        return;
      }
      current = { pid, sessionId, state: IDLE, limit: null, auth: null, reachedModel: false };
      flush();
    },
    /** One parsed stream event. */
    event(e) {
      if (!current) return;
      /* #6570: on its own: a reading that cannot be recorded must never cost the card its state. */
      if (e && e.type === 'rate_limit_event') {
        try {
          const u = usageOfEvent(e);
          const dir = u ? usageDirNow() : null;
          if (u && typeof dir === 'string' && dir) recordUsage(dir, u);
        } catch { /* the next event tries again */ }
      }
      const next = stateAfterEvent(e);
      if (next) current.state = next;
      /* #5805: a refusal is kept, room clears it, and the refused turn's own sentence rides with it. */
      /* Review 9: a refused request's own error message (is_api_error_message, in Claude Code's stream-json schema) did
         not reach the model, so it does not count; then even a result without is_error cannot clear the limit. */
      const apiError = e && (e.is_api_error_message === true || e.isApiErrorMessage === true
        || (e.message && typeof e.message === 'object' && (e.message.is_api_error_message === true || e.message.isApiErrorMessage === true)));
      if (e && e.type === 'assistant' && !apiError) current.reachedModel = true;
      let lim = limitAfterEvent(e);
      /* A refused turn's error arrives as an assistant message flagged is_api_error_message (so it does not count as
         reaching the model, above), and its result carries is_error true and api_error (Claude Code 2.1.303's schema).
         Any one of the three keeps the refused turn's own result from clearing the limit it just set (reviews 3, 9). */
      if (lim === undefined && e && e.type === 'result' && e.is_error !== true && !e.api_error && current.reachedModel === true) lim = null;
      /* Every refusal is stamped now, the LATEST one (review 7: a refusal after the agent's report proves the account is
         capped now; status lets only an agent report newer than this outrank the limit). The same refusal again
         (Claude Code re-sends it, at most every 30 s per reset) keeps the sentence already read. */
      if (lim) {
        const same = current.limit && lim.until === current.limit.until && lim.kind === current.limit.kind;
        lim = { ...lim, since: new Date().toISOString(), ...(same && current.limit.line ? { line: current.limit.line } : {}) };
      }
      if (lim !== undefined) current.limit = lim;
      /* Only the first error sentence after the refusal (review 1): a later, different error must not become the
         limit's evidence. */
      if (current.limit && !current.limit.line && e && e.type === 'result' && e.is_error === true && typeof e.result === 'string') {
        const line = e.result.replace(/\s+/g, ' ').trim().slice(0, LIMIT_LINE_MAX);
        if (line) current.limit = { ...current.limit, line };
      }
      /* #7369: a turn Claude Code ended on a sign-in error is kept as the agent's `auth`, and a later turn that reached
         the model and ended without an error clears it (the limit's own rule above, and for the same reason: a local
         command's result made no API request, so it says nothing about the sign-in). Review 2: each refusal is stamped
         with its own time: status keeps a refusal the account check has read as stale cleared by that stamp, so a NEW
         refusal (signed out again before any good turn) must not carry an old, cleared one. */
      const signIn = signInAfterEvent(e);
      let authChanged = false;
      if (signIn) {
        current.auth = { since: new Date().toISOString(), ...(signIn.line ? { line: signIn.line } : {}) };
        authChanged = true;
      } else if (current.auth && e && e.type === 'result' && e.is_error !== true && !e.api_error && current.reachedModel === true) {
        current.auth = null;
        authChanged = true;
      }
      if (next || lim !== undefined || current.limit || authChanged) flush();
    },
    /** A message reached the agent's stdin. */
    wrote() {
      if (current) { current.state = BUSY; current.reachedModel = false; flush(); }
    },
    /** The agent process is gone. */
    stopped() {
      const was = current;
      generation += 1;
      current = null;
      written = null;
      retrying = false;
      /* Only this process's own file: a newer supervisor may already own it. A
         run that never had a process (a launch that did not spawn) has no file of
         its own, so it clears nothing. */
      if (was) clear(was.pid);
    },
    /** The running session's id rotated under it (a `/clear` does this, #2669).
        Re-stamp the file with the new id so `stateFor` still matches the live
        row; the pid and the state token do not change, so the write is forced. */
    rekey(sessionId) {
      if (!current) return;
      if (typeof sessionId !== 'string' || !sessionId || sessionId === current.sessionId) return;
      generation += 1;    // a retry armed under the old id must not act for the new
      retrying = false;
      current.sessionId = sessionId;
      written = null;     // force the rewrite though the state token is unchanged
      flush();
    },
  };
}

module.exports = { BUSY, IDLE, lineReader, parseEvent, publisher, stateFor, liveIdentity, isLimitToken, isAuthToken, usageOfEvent, claudeAccountDirFor };
