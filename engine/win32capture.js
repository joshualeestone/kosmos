'use strict';
/**
 * The win32 live-STATE source (#570): the Windows analog of `capture-pane`, feeding
 * `status.setPaneCapture`.
 *
 * On a Mac, `status.snapshot` reads each agent's live state by SCRAPING its tmux
 * pane text (`capture-pane` -> `classify`). Windows has no pane. `claude agents
 * --json` reports a per-session `status` for interactive sessions, observed to be
 * `busy` (working) or `idle` (waiting) -- so THAT is the win32 scrape-equivalent.
 *
 * 🔑 BUT A STREAMING SESSION LISTS NO STATUS (measured 2026-09-10), and every agent
 * Kosmos starts has been one since 7c-2. For those the token comes from
 * `engine/win32streamstate`: the supervisor reads the agent's own event stream and
 * keeps its working/idle in a file, which is accepted here only when its session
 * id and pid match the live row. Same two tokens either way, so classify's win32
 * arm reads both without knowing which it got.
 *
 * 🔑 THIS IS THE FALLBACK, NOT THE PRIMARY STATE READER. The primary win32 state
 * reader is the SELF-REPORT path (`engine/selfreport` + `status.reconcileReport`),
 * exactly as on the Mac: a fresh self-report outranks the scrape, and the states
 * that scraping CANNOT see -- `needs_you`, `blocked` -- come only from what an
 * agent SAYS, never from `agents --json` (measured: a waiting session reads
 * `idle`, indistinguishable from idle; see kosmos#570). This module supplies only
 * the coarse working/idle the live list CAN see, for an agent that is not
 * currently self-reporting -- the same role Mac's pane scrape plays under
 * reconcileReport. It deliberately does not attempt needs_you.
 *
 * 🛑 THE STATUS MUST BE JOINED THROUGH THE sessionId, NOT read by name. The roster
 * (win32roster) emits Kosmos's RECORDED name (what create filed the session
 * under); `claude agents --json` reports the session's LIVE name (Claude derives
 * it from the cwd, e.g. `pigeonpete-50`), which is a DIFFERENT string. The only
 * stable link between "the row on the board" and "the live status" is the session
 * UUID: recorded-name -> (win32sessions record) -> sessionId -> (agents --json) ->
 * status. Reading status by name would silently miss every agent whose live name
 * differs from its recorded name, which is all of them.
 *
 * ⚠️ A FAILED READ IS null, NEVER a state. If `agents --json` cannot be read, or
 * the session is not found, the capture returns null, which `classify` renders as
 * "we could not read its state" (UNKNOWN) -- never a confident working/idle off a
 * look that did not happen. Same refuse-honestly discipline as a failed
 * `capture-pane`.
 * 🔑 EXCEPT THROUGH A SHORT GAP (#5949): an agent read well a moment ago keeps that
 * token through a few failed looks, and `note(target)` says it is held, so the card
 * shows it as remembered rather than as a fresh look. See `noteRead` below.
 *
 * ⚠️ COLLAPSES A TICK'S PER-PANE CALLS, via a short TTL memo (not a strict
 * per-tick cache). `snapshot` calls the capture ONCE PER PANE in a loop, so a
 * naive reader would run `agents --json` N times per board tick; the TTL window
 * (default 1500ms) serves all of a tick's per-pane calls from one read. Because it
 * is a time window and NOT tied to the tick boundary, two consequences are
 * accepted as honest and self-healing: (1) the roster does its own separate,
 * un-memoized read for the source seam, so within one tick the capture's status
 * can be up to ttlMs staler than the roster's fresh row -- a just-appeared session
 * briefly reads UNKNOWN, a busy->idle transition can lag one tick; (2) that is two
 * reads per tick total, still far fewer than the Mac path's one `capture-pane` per
 * pane. Every stale outcome is a safe direction (UNKNOWN or a one-tick-late state,
 * never a wrong-session leak) and clears on the next window.
 */
const win32sessions = require('./win32sessions');
const win32roster = require('./win32roster');
const win32live = require('./win32live');
const win32streamstate = require('./win32streamstate');

/* #5949: the two tokens a card can be drawn from (win32streamstate owns them; classify's win32
   arm reads the same two). Anything else is a reading we cannot use. */
const GOOD = new Set([win32streamstate.BUSY, win32streamstate.IDLE]);
/* #5949: a card shows "Can't tell" only after this many failed looks in a row AND this long
   since its last good one. Both, so neither a burst of quick looks nor one slow one is enough
   on its own: about 15 s at the board's 5 s poll. The time is the roster's own hold, one fact,
   so the cards give up when the roster stops standing in for the list. */
const FAILS_TO_UNKNOWN = 3;
const HOLD_MS = win32roster.HOLD_MS;
/* #5949: a state remembered from before the board started is used only if it is this recent.
   An update restarts the board in seconds; a state from a board that stopped long ago says
   nothing about now. */
const CARRY_MAX_MS = 10 * 60 * 1000;
/* #5949: how often an unchanged state is confirmed on disk, so the carry can be aged on when it
   was last SEEN, not when it last changed: an agent idle all morning is still a fresh "idle" if
   the board read it a minute before it restarted. At most one write per this interval. */
const CONFIRM_EVERY_MS = 60 * 1000;
/* #5949: and a changed state at most this often: the save is flushed to disk (so a crash cannot tear
   it), and it runs on the board's status path, where several agents can change turn every few
   seconds. A carry a few seconds old is as good as a fresh one. */
const WRITE_EVERY_MS = 5000;

/* target is `${session}:${window}.${pane}` (win32roster emits pane "0.0"); the session name is what is
   left after the LAST colon (a Kosmos agent name is a slug with no colon). One parser, both callers. */
function sessionOf(target) {
  return typeof target === 'string' ? target.replace(/:[^:]*$/, '') : '';
}

/**
 * #5949: the last good state of each agent, kept on disk so a board that has just started
 * (an update restarts it) can show it, marked as remembered, until its first live reading,
 * instead of drawing "Can't tell" on every card before it has looked. One small file,
 * { name: { token, at } } where `at` is when that state was last SEEN, written when a state
 * changes and at most once a CONFIRM_EVERY_MS otherwise. Never throws.
 */
function fileLastState() {
  const file = () => require('node:path').join(require('./store').ROOT, 'win32-laststate.json');
  return {
    read() {
      try {
        const o = JSON.parse(require('node:fs').readFileSync(file(), 'utf8'));
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
      } catch { return {}; }
    },
    write(obj) {
      try { require('./store').saveFlushed(file(), JSON.stringify(obj)); } catch { /* a remembered state is a nicety */ }
    },
  };
}

/* #5949: one line in the agent's own log (win32-logs/<name>.log, the file its supervisor
   writes), in the supervisor's shape. Lazy, and never fatal: a log write must not blank a tick. */
function defaultLog(name, event, because) {
  try {
    require('./win32supervisorlog').logger(name).line(new Date().toISOString() + ' ' + name + ' ' + event + ' -- ' + because);
  } catch { /* nothing to log to */ }
}

/**
 * Build the win32 capture function for `status.setPaneCapture`.
 *
 * @param {object} [opts]
 * @param {() => (Array|null)} [opts.run] the `claude agents --json` reader
 *   (default the SAME shared `win32roster.cachedRun` the source seam uses -- one
 *   definition of the read, and one read per moment for both); returns the
 *   parsed array or null on failure.
 * @param {{ read: () => object }} [opts.record] the ownership record (default the
 *   real win32sessions), injectable for tests.
 * @param {() => number} [opts.now] clock (default Date.now), injectable so the
 *   memo TTL is testable without real time.
 * @param {number} [opts.ttlMs] memo window in ms (default 1500).
 * @param {(name: string, hit: object) => (string|null)} [opts.streamState] a streaming
 *   session's token from its supervisor's state file (default win32streamstate.stateFor).
 * @param {() => (string|null)} [opts.problem] why the last read failed, in words for the
 *   agent's log (default `run.problem`, which win32roster's cachedRun carries) (#5949).
 * @param {(name: string, event: string, because: string) => void} [opts.log] where a fall
 *   to unknown, a hold and a recovery are written (default the agent's own
 *   win32-logs/<name>.log) (#5949).
 * @param {number} [opts.failsToUnknown] failed looks in a row before "Can't tell"
 *   (default FAILS_TO_UNKNOWN, 3) (#5949).
 * @param {number} [opts.holdMs] and how long since the last good look, both needed
 *   (default win32roster.HOLD_MS, 15 s) (#5949).
 * @param {{ read: () => object, write: (obj: object) => void }} [opts.lastState] where the
 *   last good states survive a board restart (server.js passes fileLastState() on Windows);
 *   none by default, so nothing is carried (#5949).
 * @returns {((target: string, lines?: number) => (string|null)) & { note: (target: string) => (object|null) }}
 *   a paneCapture: the session's live status token (its last good one while held), or null
 *   on a failed/absent look. The `lines` argument is accepted (the seam passes it) and
 *   ignored -- there is no scrollback. `.note(target)` says how the last answer was reached
 *   ({ held, cause }, { unreadable, cause }, or null for a fresh look); status.captureNote
 *   reads it to mark the card (#5949).
 */
function make(opts) {
  const run = opts && typeof opts.run === 'function' ? opts.run : win32roster.cachedRun;
  const record = opts && opts.record ? opts.record : win32sessions;
  const now = opts && typeof opts.now === 'function' ? opts.now : Date.now;
  const ttlMs = opts && Number.isFinite(opts.ttlMs) ? opts.ttlMs : 1500;
  const streamState = opts && typeof opts.streamState === 'function' ? opts.streamState : win32streamstate.stateFor;
  /* #5949: why the shared read failed (win32roster's cachedRun keeps it), and where a fall to
     unknown is written down. All injectable for tests. */
  const runProblem = opts && typeof opts.problem === 'function' ? opts.problem
    : (typeof run.problem === 'function' ? run.problem : () => null);
  const log = opts && typeof opts.log === 'function' ? opts.log : defaultLog;
  const failsToUnknown = opts && Number.isInteger(opts.failsToUnknown) ? opts.failsToUnknown : FAILS_TO_UNKNOWN;
  const holdMs = opts && Number.isFinite(opts.holdMs) ? opts.holdMs : HOLD_MS;
  const say = (name, event, because) => { try { log(name, event, because); } catch { /* never fatal */ } };
  /* #5949: where the last good states survive a board restart; none unless the caller gives one
     (server.js gives fileLastState on Windows), so a test never reads another test's file. */
  const lastState = opts && opts.lastState && typeof opts.lastState.read === 'function' ? opts.lastState : null;
  let carried = null;   // name -> { token, at }, read once, kept in step with what is written
  const carriedNow = () => {
    if (carried) return carried;
    try { carried = lastState ? lastState.read() || {} : {}; } catch { carried = {}; }
    return carried;
  };
  let confirmedAt = -Infinity;   // when the file was last written for an unchanged state
  /* #5949: the carry is for a board that has just started, until its first good read; after that an
     agent not yet read well is a NEW start (a relaunch, a new session), and a past session's state
     says nothing about it. */
  let firstGoodRead = false;
  let lastWriteAt = -Infinity;
  let dirty = false;
  /* Called once per good read with every agent it read well. Writes when a state changed, or when
     the file has not been confirmed for CONFIRM_EVERY_MS; drops agents a good read no longer lists
     whose state is too old to carry anyway, so the file does not grow with every agent ever seen. */
  const remember = (good, t, sids) => {
    if (!lastState || !Number.isFinite(t)) return;
    const c = carriedNow();
    const iso = new Date(t).toISOString();
    let changed = false;
    for (const [name, token] of good) {
      /* The session it was read from rides along, so a carry is only ever used for that same session. */
      const sid = (sids && sids.get(name)) || null;
      if (!c[name] || c[name].token !== token || c[name].sid !== sid) { c[name] = { token, at: iso, sid }; changed = true; }
    }
    for (const name of Object.keys(c)) {
      if (good.has(name)) continue;
      const at = c[name] && typeof c[name].at === 'string' ? Date.parse(c[name].at) : NaN;
      if (!Number.isFinite(at) || t - at >= CARRY_MAX_MS) { delete c[name]; changed = true; }
    }
    dirty = dirty || changed;
    if (!(dirty && t - lastWriteAt >= WRITE_EVERY_MS) && t - confirmedAt < CONFIRM_EVERY_MS) return;
    for (const [name] of good) c[name].at = iso;   // confirmed: seen now
    confirmedAt = t;
    lastWriteAt = t;
    dirty = false;
    try { lastState.write(c); } catch { /* never fatal */ }
  };
  /* Under the same never-throw contract as run() and record.read(). */
  const readStreamState = (name, hit) => { try { return streamState(name, hit); } catch { return null; } };

  // Cache one { at, ok, byName } per TTL window so a whole snapshot's per-pane
  // calls share a single read. `ok` records whether the live read SUCCEEDED, kept
  // distinct from "succeeded but this name has no live status" -- both return null
  // to the caller (UNKNOWN either way), but the flag keeps the two truthfully
  // separable for any future reason string.
  let cache = null;

  function byNameNow() {
    // now() is an injected callable too, so it is under the same never-throw
    // contract as run()/record.read(): a throwing clock returns a transient failed
    // read (NOT cached) -> null -> UNKNOWN, rather than propagating out of
    // capturePane -> snapshot and blanking the whole tick. Date.now never throws,
    // so this only defends an injected clock, for full parity with the contract.
    let t;
    try { t = now(); } catch { return { at: 0, ok: false, claudeOk: false, byName: new Map(), why: new Map(), runners: new Map(), sids: new Map(), readWhy: 'the clock could not be read' }; }
    if (cache && (t - cache.at) < ttlMs) return cache;
    const byName = new Map();
    const why = new Map();   // #5949: name -> why its live row gave no usable token
    const runners = new Map();   // #5949: name -> its recorded runner, so an unlisted per-turn agent is known stopped
    const sids = new Map();   // #5949: name -> the session it was listed with, so a carry matches its own session only
    let ok = false;
    let claudeOk = false;   // #5949: did `claude agents --json` itself answer? (codex rows come from elsewhere)
    let readWhy = null;
    // NEVER THROW. A paneCapture must return null on a failed read, exactly as a
    // failed Mac `capture-pane` does -- if this propagated an exception out through
    // `status.capturePane` -> `snapshot`, one throwing read would blank the WHOLE
    // board's tick, not just one pane. Production's run/record (win32roster.defaultRun,
    // win32sessions.read) both swallow their own errors to null/{}, so this cannot
    // throw there; the guard defends the INJECTED-callable seam boundary (a test or
    // future caller whose run()/record.read() throws), degrading it to a failed read
    // (ok:false -> null -> UNKNOWN) rather than taking down the tick. byName is
    // rebuilt fresh each call and cleared on throw, so a partial join never leaks.
    try {
      /* ONE JOIN, shared with the roster and the stop (engine/win32live). This
         used to be a hand-maintained copy of win32roster's resolution, carrying a
         comment that promised it stayed BYTE-IDENTICAL to it -- the ownership
         gates, the name fallback, and the reason each was re-checked, all written
         out twice. The promise is structural now, and the capture keeps only the
         part that is actually its own: the TTL memo, and reading `status` off the
         resolved entry. */
      /* One read per memo window, seen by the join and by the check below alike. */
      let got;
      let asked = false;
      const once = () => { if (!asked) { asked = true; got = run(); } return got; };
      const live = win32live.byName({ run: once, record });
      /* 🛑 #5949: a live map can come back with the Claude read FAILED, when a codex agent is up
         (win32live refuses only when both are missing). That is not "no Claude agent is running",
         so it is kept apart. */
      try { claudeOk = Array.isArray(once()); } catch { claudeOk = false; }
      if (!claudeOk) { try { readWhy = runProblem() || null; } catch { readWhy = null; } }
      // null is a FAILED look; an empty map is a successful look at a machine with
      // no owned sessions running. `ok` is what keeps those apart downstream.
      if (live) {
        ok = true;
        for (const [name, hit] of live) {
          /* 🔑 TWO SOURCES, ONE TOKEN (7c-5). An interactive session reports its own
             status. A STREAMING one -- every agent Kosmos has started since 7c-2 --
             lists none, so its state comes from the file its supervisor keeps from
             the agent's event stream, accepted only for this exact session and pid. */
          const listed = typeof hit.status === 'string' && hit.status ? hit.status : null;
          const token = listed || readStreamState(name, hit);
          byName.set(name, token);
          runners.set(name, typeof hit.runner === 'string' ? hit.runner : '');
          sids.set(name, typeof hit.sessionId === 'string' && hit.sessionId ? hit.sessionId : null);
          if (!GOOD.has(token)) {
            why.set(name, listed
              ? 'Claude Code reported a status Kosmos does not know (' + JSON.stringify(listed.slice(0, 40)) + ')'
              : 'its state file did not match the running session');
          }
        }
      } else {
        try { readWhy = runProblem() || null; } catch { readWhy = null; }
      }
    } catch {
      // An injected run()/record.read() threw. Treat it as a failed read: no state
      // is a safe answer (null -> UNKNOWN), a thrown one is not.
      ok = false;
      readWhy = readWhy || 'the status read could not be matched to the agents Kosmos started';
      byName.clear();
      why.clear();
      runners.clear();
      sids.clear();
    }
    cache = { at: t, ok, claudeOk: ok && claudeOk, byName, why, runners, sids, readWhy: readWhy || 'the status read failed' };
    noteRead(cache);
    return cache;
  }

  /* 🛑 #5949: ONE FAILED LOOK USED TO BLANK EVERY CLAUDE CARD. A failed read answered null for
     every agent at once and the board drew "Can't tell" on all of them, with no reason written
     anywhere, for a read that fails now and then while every agent is fine. So each agent keeps
     its last good token through a short gap, and the card is marked as remembered (status.js
     carries the mark from `note`), never passed off as a fresh look. "Can't tell" comes only once
     the looks keep failing: FAILS_TO_UNKNOWN in a row AND HOLD_MS since the last good one.
     Counted once per memo window (ttlMs), never per call: one snapshot asks once per pane. A memo window is not
     quite one real read: the shared cachedRun serves one failed answer for up to FRESH_MS and until its refresh
     lands, so frequent callers can count one failure two or three times. The time half (HOLD_MS) bounds that,
     which is why giving up needs both. `at` is when we looked, not when the list was read (see win32roster).
     Written to the agent's log only when it changes (held, gave up, back), never every tick.
     An agent never read well this run starts from its remembered state (see fileLastState), so a
     board that has just started shows that, marked, instead of "Can't tell" before its first look. */
  const memory = new Map();   // name -> { token, at, fails, cause, phase: 'ok' | 'held' | 'unknown', said, carried, sid: the session it was read in }
  const runnerOf = new Map();   // name -> the runner its last listing recorded ('' for Claude)
  const PER_TURN = require('./win32codexlive').PER_TURN;
  function noteRead(snap) {
    const t = snap.at;
    if (snap.ok) {
      const good = new Map();
      for (const [name, token] of snap.byName) {
        if (GOOD.has(token)) {
          const m = memory.get(name);
          if (m && m.said) say(name, 'status-read-back', 'Kosmos can check on it again, after ' + m.fails + ' failed ' + (m.fails === 1 ? 'look' : 'looks'));
          memory.set(name, { token, at: t, fails: 0, cause: null, phase: 'ok', said: false, carried: false, sid: snap.sids.get(name) || null });
          good.set(name, token);
        } else {
          failed(name, snap.why.get(name) || 'its status could not be read', t, snap.sids.get(name));
        }
      }
      /* A good read that does not list an agent: it is not running, and the roster draws no
         card for it, so there is nothing to hold and nothing to say. Forgotten quietly. But if the
         Claude read itself failed (a codex agent kept the map alive), an unlisted agent is one we
         could not see: that is a failed look, held like any other. */
      for (const [name, runner] of snap.runners) runnerOf.set(name, runner);
      for (const name of [...memory.keys()]) {
        if (snap.byName.has(name)) continue;
        /* A per-turn agent (Codex, Gemini, Grok, Antigravity) is listed from its own source, which DID answer: unlisted,
           it has stopped, whatever the Claude read did. */
        if (snap.claudeOk || PER_TURN.has(runnerOf.get(name))) { memory.delete(name); runnerOf.delete(name); }
        else failed(name, snap.readWhy, t);
      }
      /* Any good read ends the board-start window and is remembered, the Claude read or only the per-turn agents' own
         source: a box where `claude agents --json` never answers must not carry a past session's state forever. */
      remember(good, t, snap.sids);
      firstGoodRead = true;
      return;
    }
    /* A failed read says nothing about any agent, so every agent we know counts one failure. */
    for (const name of memory.keys()) failed(name, snap.readWhy, t);
  }
  function failed(name, cause, t, sid) {
    let m = memory.get(name);
    /* Listed under a DIFFERENT session from the one it was read well in: it was relaunched (a crash and a restart the
       board did not start, say), and the old session's state says nothing about the new one, exactly as for the
       board-start carry. Started afresh, with nothing to hold. */
    let relaunched = false;
    if (m && typeof sid === 'string' && sid && typeof m.sid === 'string' && m.sid && m.sid !== sid) {
      memory.delete(name);
      m = null;
      relaunched = true;
    }
    if (!m) {
      /* Not read well yet this run: start from the state remembered before the board started,
         if it is recent. Its hold runs from this first look, not from when it was remembered. */
      const c = firstGoodRead || relaunched ? null : carriedNow()[name];
      const cAt = c && typeof c.at === 'string' ? Date.parse(c.at) : NaN;
      /* Only for the SAME session it was remembered from: an agent relaunched while the board restarted is a new
         session, and its predecessor's state says nothing about it. An entry with no session (or a look with none)
         is not used. */
      const sameSession = Boolean(c && typeof c.sid === 'string' && c.sid && typeof sid === 'string' && sid === c.sid);
      const usable = Boolean(sameSession && GOOD.has(c.token) && Number.isFinite(cAt) && Number.isFinite(t) && t - cAt >= 0 && t - cAt < CARRY_MAX_MS);
      m = { token: usable ? c.token : null, at: t, fails: 0, cause, phase: 'ok', said: false, carried: usable, sid: (typeof sid === 'string' && sid) || null };
      memory.set(name, m);
    }
    m.fails += 1;
    m.cause = cause;
    /* Nothing good to hold (never read well, nothing remembered): it can only be Can't tell. */
    const giveUp = !GOOD.has(m.token) || (m.fails >= failsToUnknown && (t - m.at) >= holdMs);
    if (giveUp) {
      if (m.phase !== 'unknown') m.phase = 'unknown';
      /* Said once. An agent never read well is said only once it has kept failing: a streaming
         agent that has just started has no state file for a moment, and that is not a fault. */
      if (m.said !== 'cant-tell' && (GOOD.has(m.token) || m.fails >= failsToUnknown)) {
        m.said = 'cant-tell';
        say(name, 'cant-tell', 'Kosmos could not check on it ' + (m.fails === 1 ? 'once' : m.fails + ' times in a row')
          + ', so its card says it cannot tell: ' + cause);
      }
    } else if (m.phase === 'ok') {
      m.phase = 'held';
      m.said = 'held';
      say(name, 'status-read-failed', 'Kosmos could not check on it just now' + (m.carried ? ' (Kosmos has just started; this is its state from before)' : '')
        + ', so its card keeps its last known state (' + (m.token === win32streamstate.BUSY ? 'working' : 'idle') + '), marked as remembered: ' + cause);
    }
  }

  /** #5949: how the last answer for `target` was reached: { held: true, cause } while its last
      good token stands in, { unreadable: true, cause } when it could not be read and is not
      held, or null for a fresh reading (or an agent this capture was never asked about). */
  function noteFor(target) {
    const session = sessionOf(target);
    const m = memory.get(session);
    /* Never read well, and the last read failed outright: unreadable, with that read's why. */
    if (!m) return cache && !cache.claudeOk ? { unreadable: true, cause: cache.readWhy } : null;
    if (m.phase === 'held') return { held: true, cause: m.cause };
    /* Never read well and not yet failing for long: a streaming agent that has just started has no state file for a
       moment, which is not a fault. The card says so only when the log does (see failed). */
    if (m.phase === 'unknown' && !GOOD.has(m.token) && m.fails < failsToUnknown) return null;
    if (m.phase === 'unknown') return { unreadable: true, cause: m.cause };
    return null;
  }

  function win32Capture(target) {
    const snap = byNameNow();
    // target is `${session}:${window}.${pane}` (win32roster emits pane "0.0");
    // strip the trailing `:<pane>` to recover the session name. A Kosmos agent
    // name is a slug with no colon, and tmux-style session names forbid `:`, so
    // the LAST colon is always the target separator.
    const session = sessionOf(target);
    /* #5949: inside the hold, the last good token stands in; `note` says it is remembered. */
    const m = memory.get(session);
    if (m && m.phase === 'held') return m.token;
    // A failed live read refuses honestly: null -> classify renders UNKNOWN
    // ("could not read its state"), never a confident idle off a look that
    // never happened.
    if (!snap.ok) return null;
    const status = snap.byName.get(session);
    // Present-and-a-string only; anything else (absent, undefined-status
    // background row) is "we have no state for it" -> null -> UNKNOWN.
    return typeof status === 'string' && status ? status : null;
  }
  win32Capture.note = noteFor;
  return win32Capture;
}

module.exports = { make, fileLastState };
