'use strict';
/**
 * Keeping a CODEX (OpenAI) agent alive on Windows (#3380).
 *
 * 🛑 WHY A PARALLEL SUPERVISOR, NOT A BRANCH IN `superviseStreaming`. The streaming
 * supervisor is deeply claude-shaped: it holds ONE persistent child fed a
 * `stream-json` line per message, parses claude's system/init/result events for
 * state and session-id rotation, asks `claude agents --json` for liveness, and
 * resumes a crashed child with `--resume`. codex speaks none of that. It runs one
 * `codex exec` turn per message and exits, so there is no persistent child to hold,
 * no stream to parse for a session-id `/clear`, and no `agents --json` row. Branching
 * the claude loop to cover all that would put two half-exercised paths in the file
 * every defect in this lane has arrived through. So codex gets its own loop, and the
 * claude path is left byte-identical.
 *
 * 🔑 WHAT IT REUSES, so this is an addition and not a second world:
 *   - `win32create.prepareSession` mints the Kosmos session id (the board key),
 *     writes the ownership record with `runner: 'codex'`, and mints the run token --
 *     the same one-mint-point every win32 agent goes through.
 *   - `win32streamstate.publisher` records working/idle AND doubles as the codex
 *     agent's PRESENCE (its pid + session id), which `win32codexlive` reads back to
 *     enumerate this agent as live. The pid it stamps is THIS SUPERVISOR's, because
 *     the supervisor is the durable process; a codex turn child is ephemeral.
 *   - `win32launch.childEnv` builds the turn's environment (CODEX_HOME for the
 *     account, the sender token, the agent's `kosmos` on PATH, the child markers
 *     stripped) -- the same env a streaming claude child gets.
 *   - `win32codex.runCodexTurn` drives one turn; `win32channel` (served by `main`)
 *     delivers messages to `handle.send`.
 *
 * 🔑 IDENTITY: TWO IDS, AND ONLY ONE IS THE BOARD'S. The Kosmos session id (a UUID
 * from `prepareSession`) is what the record, the roster, the state file and the
 * stop path all key on -- identical to a claude agent. The codex THREAD id (from
 * the turn's `thread.started`) is codex's own conversation handle, kept IN MEMORY
 * and passed to `codex exec resume` so turns continue one another. It is not
 * persisted: a supervisor restart mints a fresh Kosmos session and starts a fresh
 * codex thread, exactly as a claude supervisor restart is a fresh conversation.
 *
 * ⚠️ TURNS ARE SERIALISED. `codex exec resume` needs the thread id the previous
 * turn established, and two turns against one thread at once would tangle the
 * conversation. So messages queue and turns run one at a time (a backlog goes as ONE
 * turn, see takeBatch); `send` reports the message
 * ACCEPTED (the codex analog of a claude stdin flush), not the turn finished, which
 * is the delivery contract `win32channel`/`chat.js` already expect.
 *
 * 🔑 GEMINI AND GROK RUN THROUGH THIS SAME LOOP (`spec.runner` 'gemini' | 'grok'). They are
 * per-turn on Windows for the same reason codex is (see engine/win32keyed.js), so the
 * record, presence, queue, stop and token handling here are exactly right for them; what
 * differs is only the turn (`win32keyed.runKeyedTurn`) and its environment
 * (`win32keyed.turnEnv`: the account's key, or no key for a Grok subscription). A codex
 * spec (no runner, or 'codex') takes the path it always did.
 */
const win32create = require('./win32create');
const win32launch = require('./win32launch');
const win32codex = require('./win32codex');
const win32keyed = require('./win32keyed');
const win32sessions = require('./win32sessions');
const path = require('node:path');

/* A stream sink that records nothing: the default, so only `main()` publishes --
   the same NO_STREAM the claude supervisor uses. */
const NO_STREAM = { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} };

/* 🔑 A BACKLOG IS ONE TURN, NOT ONE TURN PER MESSAGE (#4003). Every message that
   arrived while a turn was running is handed to the NEXT turn together, so an agent that
   fell behind catches up in one step and answers where the room is now. Before this, a
   burst of N room posts cost N full turns in a row (measured with a real Gemini agent on
   this box: see the PR), each answering a message the room had long moved past. The cap
   is on characters because the message rides in argv, and a Windows command line tops out
   at 32767; the first message always goes, so one oversized message is no worse than
   before, and whatever does not fit waits for the turn after. */
const BATCH_CHARS = 24000;

function takeBatch(queue) {
  const parts = [queue.shift()];
  let size = parts[0].length;
  while (queue.length && size + queue[0].length <= BATCH_CHARS) {
    size += queue[0].length;
    parts.push(queue.shift());
  }
  if (parts.length === 1) return parts[0];
  return 'These ' + parts.length + ' messages arrived while you were busy, oldest first. '
    + 'Read them all before acting, then answer for where things stand now, once in each place '
    + 'still waiting on you (each message says how to answer it): skip anything a later message '
    + 'already settled, and do not answer the messages one by one.\n\n'
    + parts.map((p, i) => '--- message ' + (i + 1) + ' of ' + parts.length + ' ---\n' + p).join('\n\n');
}

/* kosmos#8348: the Codex version a `codex --version` line names ("codex-cli 0.149.1"), or null. */
function codexVersionOf(out) {
  const m = /^codex-cli (\S+)$/.exec(String(out || '').trim());
  return m ? m[1] : null;
}

/* kosmos#8348: put the Codex edit hook into an agent's NAMED Codex home: ask the codex it will run (with the turn's own
   environment, so a bare name resolves as the turns resolve it) for its version, since the hook's trust record is known
   for one version only (codexhooks.js), and install the bridge that ships beside this engine. No home (the person's
   default ~/.codex) is nothing to do and nothing to say. The probe is asynchronous and bounded (15 s), once per agent
   start, so a slow Codex start holds neither the supervisor nor the agent's presence. Resolves { ok, because }; never
   rejects. `deps` ({ execFile, install, bridge }) are seams for tests. */
function installCodexHookFor(home, bin, env, deps) {
  const d = deps || {};
  if (!home) return Promise.resolve({ ok: false, because: null });
  /* The person's own Codex home is never given the hook, even when it arrives as a named one: with CODEX_HOME (or
     AGENT_WORKFORCE_CODEX_HOME) set, the default account's agent carries that folder as its configDir (create.js,
     codexHomeOverridden). Kosmos never puts CODEX_HOME into this supervisor's own environment, so defaultHome() here is
     the person's: their override, or ~/.codex. Compared canonically (case and links, as Codex resolves a home). */
  /* Lowercased because this module runs on Windows, where a path's case does not name another folder. */
  const canon = d.canonical || ((p) => String(require('./trust').canonicalOnDisk(p)).toLowerCase());
  const personHomes = d.personHomes || [require('./codexupdate').defaultHome(), path.join(require('node:os').homedir(), '.codex')];
  try {
    if (personHomes.some((p) => p && canon(p) === canon(home))) return Promise.resolve({ ok: false, because: null });
  } catch { return Promise.resolve({ ok: false, because: 'we could not tell whether its Codex home is your own, so the Codex hook was not set up' }); }
  const run = d.execFile || require('node:child_process').execFile;
  return new Promise((resolve) => {
    try {
      run(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: env || process.env },
        (err, stdout) => resolve(err ? null : codexVersionOf(stdout)));
    } catch { resolve(null); }
  }).then((version) => {
    const bridge = d.bridge || path.join(__dirname, '..', 'bin', 'codex-report-bridge.js');
    return (d.install || require('./codexhooks').install)(String(home), bridge, version);
  }).catch(() => ({ ok: false, because: 'we could not set up the Codex hook' }));
}

/**
 * Supervise a codex agent. Returns a handle with `send(text, done)`, `stop()`,
 * `current()` and `sessionId`, the same surface `main()` wires a claude handle
 * through. `opts` mirrors `superviseStreaming`'s: `stream`, `mayStart`, `onEvent`,
 * plus codex-only seams (`runTurn`, `prepare`, `retireRun`, `env`) for tests.
 */
function superviseCodexStreaming(spec, opts) {
  const s = spec || {};
  const o = opts || {};
  const onEvent = typeof o.onEvent === 'function' ? o.onEvent : () => {};
  const stream = o.stream || NO_STREAM;
  const mayStart = typeof o.mayStart === 'function' ? o.mayStart : () => true;
  /* Which per-turn runner this is. Anything but gemini/grok is codex, as before. */
  /* #3568: 'antigravity' (Google's agy) is per-turn too, through engine/win32agy.js. */
  const runner = win32keyed.isKeyedRunner(s.runner) || s.runner === 'antigravity' ? String(s.runner) : 'codex';
  const runTurn = typeof o.runTurn === 'function' ? o.runTurn
    : runner === 'codex' ? win32codex.runCodexTurn
      : runner === 'antigravity' ? (t) => require('./win32agy').runAgyTurn(Object.assign({ name: s.name }, t))
        : (t) => win32keyed.runKeyedTurn(Object.assign({ runner, name: s.name }, t));
  const prepare = typeof o.prepare === 'function' ? o.prepare : (meta) => win32create.prepareSession(meta);
  const retireRun = typeof o.retireRun === 'function' ? o.retireRun
    : (name, instance) => win32create.retireRun(name, instance);
  const sessions = o.sessions || win32sessions;
  const supervisorPid = Number.isInteger(o.supervisorPid) ? o.supervisorPid : process.pid;
  /* #5949: the automatic idle report at the end of a turn, sent as Claude's Stop hook sends it (the same writer, the
     same /api/report route, auto:true, this run's own token), and the agent's latest report, to see whether its own
     hook already said idle. Both injectable for tests; never throw. Inside a test the default sends nothing
     (live-execution.inTestRun): a suite that drives this loop without the seam must not post to a real board. */
  const reportIdle = typeof o.reportIdle === 'function' ? o.reportIdle
    : (env) => (require('./live-execution').inTestRun() ? null : require('./kosmos-report-hook')
      .main({ input: JSON.stringify({ hook_event_name: 'Stop' }), env, stdout: () => {}, noRetry: true }));   // kosmos#8230: not awaited, so no late retry
  const lastReport = typeof o.lastReport === 'function' ? o.lastReport : () => require('./selfreport').read(s.name);

  /* The codex binary (path hint or bare name) and the turn environment, resolved
     once: every turn runs the same program with the same account, token and PATH. */
  const bin = o.bin || win32launch.binFor(s);
  /* A gemini/grok path hint that has gone stale leaves binFor's bare name, which is not on a
     task's PATH; ask the resolver again at each turn, so a reinstall is picked up. */
  const binNow = () => {
    if (runner === 'codex' || o.bin || path.win32.isAbsolute(String(bin))) return bin;
    try { const r = require('./runners').resolveBin(runner); if (r && r.present) return r.bin; } catch { /* the bare name */ }
    return bin;
  };
  const cliDir = o.cliDir !== undefined ? o.cliDir : win32launch.agentCliDir();
  /* kosmos#8348: put the Codex edit hook into the agent's named Codex home. A seam for tests; the default asks the
     codex it will run for its version (the hook's trust record is known for one version only, codexhooks.js) and
     installs the bridge that ships beside this engine. Inside a test the default does nothing. */
  const installCodexHook = typeof o.installCodexHook === 'function' ? o.installCodexHook
    : (home) => (require('./live-execution').inTestRun() ? { ok: false, because: null } : installCodexHookFor(home, binNow(), turnEnv));

  let running = true;
  let sessionId = null;      // the Kosmos board id
  let threadId = null;       // codex's own conversation id, in-memory continuity
  let instance = null;       // this run's token instance, retired on stop
  let turnEnv = null;
  const queue = [];
  let turning = false;
  let hookPending = false;   // kosmos#8348: the Codex hook is being set up; the first turn waits for it
  let turnChild = null;      // the in-flight `codex exec` child, killed on stop

  const handle = { sessionId: null };

  /* Drop stale rows this name accumulated from earlier supervisor lives (#2720's
     shape): each codex supervisor start is a fresh session, and nothing removes the
     row of the one that ended. Keep only the id just started. */
  function pruneEnded(keepId) {
    let r;
    try { r = sessions.pruneName(s.name, [keepId]); }
    catch (err) { r = { ok: false, because: 'we could not prune the ownership record (' + ((err && err.code) || 'unknown') + ')' }; }
    if (r && r.ok && r.removed) onEvent({ action: 'pruned', because: 'it forgot ' + r.removed + ' ended session' + (r.removed === 1 ? '' : 's') + ' recorded under its name' });
    else if (r && !r.ok) onEvent({ action: 'prune-failed', because: (r && r.because) || 'unknown' });
  }

  function startOnce() {
    if (!running) return;
    let may = true;
    try { may = mayStart() !== false; } catch { may = true; }
    if (!may) { onEvent({ action: 'not-starting', because: 'its task was ended, so it is not starting its agent again' }); return; }

    const p = prepare({ name: s.name, runner });
    if (!p || !p.ok) { onEvent({ action: 'refused', because: (p && p.because) || 'we could not record its session' }); return; }
    sessionId = p.sessionId;
    handle.sessionId = sessionId;
    instance = p.instance || null;
    /* The env every turn runs under: CODEX_HOME (the account), the sender token,
       the agent's `kosmos` on PATH, the child markers stripped. Built with the
       same helper a streaming claude child uses, so the account rule cannot drift. */
    turnEnv = o.env || win32launch.childEnv(process.env, p.token, s.configDir, cliDir, runner);
    /* gemini/grok: the account's key (or none, for a Grok subscription), see win32keyed. */
    if (!o.env && runner === 'antigravity') turnEnv = require('./win32agy').turnEnv(turnEnv);
    else if (!o.env && runner !== 'codex') turnEnv = win32keyed.turnEnv(runner, turnEnv, s.configDir || null);
    /* Idle until it is told something -- measured true of a streaming claude agent,
       and true here: nothing runs until a message arrives. Presence is stamped now
       (pid + id), which is what makes `win32codexlive` see this agent as up. */
    stream.started(supervisorPid, sessionId);
    onEvent(Object.assign({ action: 'started', sessionId }, p.tokenBecause ? { because: 'it has no reporting token: ' + p.tokenBecause } : {}));
    pruneEnded(sessionId);
    /* kosmos#8348: the Codex edit hook (changed-by and the undo copy), the Windows half of what the Mac supervisor does
       at each launch. Only into a NAMED Codex home (s.configDir, the account Kosmos made); an agent on the person's
       default ~/.codex gets none, because that home is theirs. Set up after presence is stamped, and the first turn
       waits for it (bounded by the probe's 15 s) so its edits are recorded. Never fatal: a hook not set up costs the
       record, not the agent. */
    if (runner === 'codex' && s.configDir) {
      hookPending = true;
      Promise.resolve().then(() => installCodexHook(s.configDir))
        .catch((e) => ({ ok: false, because: 'it threw (' + ((e && e.code) || 'unknown') + ')' }))
        .then((r) => {
          if (r && r.ok) onEvent({ action: 'codex-hook-installed' });
          if (r && !r.ok && r.because) onEvent({ action: 'codex-hook-skipped', because: r.because });
        })
        .finally(() => { hookPending = false; pump(); });
    }
    pump();
  }

  function pump() {
    if (turning || hookPending || !running || queue.length === 0) return;
    turning = true;
    const msg = takeBatch(queue);   // everything pending, not just the oldest
    /* Busy the moment a turn starts, idle when it ends -- the same two transitions
       the claude stream produces, so the board reads a codex card exactly as a
       claude one. */
    stream.wrote();
    const turnAt = Date.now();   // #5949: an idle the agent's own hook reports after this belongs to this turn
    Promise.resolve(runTurn({
      bin: binNow(),
      message: msg,
      sessionId: threadId || undefined,   // resume the codex thread for continuity
      model: s.model || undefined,
      autonomy: true,                     // an unattended agent must be able to act
      cwd: s.cwd,
      env: turnEnv,
      onSpawn: (c) => { turnChild = c; },
    })).then((r) => {
      turnChild = null;
      if (!running) { turning = false; return; }
      /* resetSession: a gemini/grok turn whose conversation cannot be resumed (a failed first
         turn, or one the CLI says is gone) starts the next turn fresh. codex never sets it. */
      if (r && r.resetSession) threadId = null;
      else if (r && r.sessionId) threadId = r.sessionId;
      stream.event({ type: 'result' });   // idle: reuses stateAfterEvent's mapping
      if (r && r.ok) onEvent({ action: 'turn', sessionId });
      else onEvent({ action: 'turn-failed', sessionId, because: (r && r.error) || 'the ' + runner + ' turn produced no answer' });
      turning = false;
      /* 🛑 #5949: SAY IDLE WHEN THE WORK IS DONE. Codex has no turn-end hook at all, and on Josh's machine the
         Gemini, Grok and Antigravity bridges' own turn-end idle did not land either (2026-10-12), so the automatic
         "working" from the turn's start stayed the last word and five minutes later the card read "Can't tell". The
         supervisor knows the turn ended, so it says so. Sent only on a NORMAL end with nothing queued behind it (a
         failed turn says its own thing, #5948; a queued message starts the next turn now), AUTOMATIC (refused over a
         standing blocked or needs_you, exactly as Claude's is), and not when the agent's own hook already said idle
         during this turn, so its last words stay on its card. */
      if (r && r.ok && queue.length === 0) {
        try {
          let said = null;
          try { said = lastReport(); } catch { said = null; }
          const saidIdle = Boolean(said && said.found === true && said.state === 'idle' && Date.parse(said.at || '') >= turnAt);
          if (!saidIdle) Promise.resolve(reportIdle(turnEnv)).catch(() => {});
        } catch { /* a report is never worth a turn */ }
      }
      pump();
    }).catch((e) => {
      turnChild = null;
      stream.event({ type: 'result' });
      onEvent({ action: 'turn-failed', sessionId, because: 'the ' + runner + ' turn threw (' + ((e && e.code) || 'unknown') + ')' });
      turning = false;
      if (running) pump();
    });
  }

  /**
   * Deliver one message. Enqueues it and reports it ACCEPTED -- the turn runs
   * asynchronously and its own side effects (the agent shelling out to `kosmos`)
   * are how it answers, exactly as a claude turn's are. Never throws.
   */
  handle.send = function send(text, done) {
    const answer = (r) => { if (typeof done === 'function') { try { done(r); } catch { /* the caller's problem */ } } return r; };
    if (!running || !sessionId) {
      return answer({ ok: false, because: 'it is not running just now, so we did not hand it the message' });
    }
    queue.push(String(text));
    pump();
    return answer({ ok: true });
  };

  handle.stop = function stop() {
    running = false;
    /* Kill an in-flight turn's whole tree so a stopped agent is not still running a
       `codex exec` (and its `kosmos` children) after the supervisor has left. */
    if (turnChild && typeof turnChild.kill === 'function') { try { turnChild.kill(); } catch { /* going anyway */ } }
    turnChild = null;
    /* Retire this run's token, as the claude death handler does: one token per run,
       and a stop is the end of the run. */
    if (instance) {
      let retired;
      try { retired = retireRun(s.name, instance); }
      catch (e) { retired = { ok: false, because: 'we could not retire its token (' + ((e && e.code) || 'unknown') + ')' }; }
      if (retired && retired.ok === false) onEvent({ action: 'token-not-retired', because: retired.because });
      instance = null;
    }
    /* Clear the state/presence so the board stops seeing it as up. */
    stream.stopped();
  };

  handle.current = () => turnChild;
  startOnce();
  return handle;
}

module.exports = { superviseCodexStreaming, installCodexHookFor, codexVersionOf, NO_STREAM };
