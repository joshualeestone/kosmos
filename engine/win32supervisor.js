'use strict';
/**
 * Keeping a Windows agent alive: what launchd gives the Mac for free.
 *
 * 🛑 THE MAC'S SHAPE, WHICH THIS MIRRORS RATHER THAN REINVENTS (Splinter, the
 * 2026-09-07 lifecycle write-up). A Mac agent is a launchd job with
 * `RunAtLoad=true` (start at login), `KeepAlive=true` (respawn on ANY exit) and
 * `ThrottleInterval=30` (a crash-loop limps at 30s instead of spinning). Its
 * ProgramArguments run `bin/agent-supervisor.sh`, which does NOT exit while the
 * agent lives -- it parks in `while tmux has-session; do sleep; done`. The chain
 * is: agent dies -> session vanishes -> loop exits -> supervisor exits ->
 * KeepAlive respawns the supervisor -> it starts a new agent.
 *
 * 🔑 ONE SUPERVISOR FOR EVERY AGENT, NEVER A COPY PER AGENT. That is the Mac's
 * hardest-won rule on this file: the per-agent-copy version "shipped every bug N
 * times". This module is that one implementation; the per-agent facts arrive as
 * arguments.
 *
 * ⚠️ WHERE THIS DELIBERATELY DIVERGES, AND WHY. On the Mac the RESPAWN belongs to
 * launchd and the supervisor only watches. Windows has no launchd: the analog is
 * a Scheduled Task, and a task's restart-on-failure keys on a NON-ZERO exit, so a
 * supervisor that exited cleanly when its agent died would not be restarted at
 * all. Rather than encode the respawn in a task setting whose semantics differ
 * from KeepAlive's, the loop lives HERE -- respawn and throttle in code, where
 * both are testable from any platform. The task keeps only the half Windows does
 * well: start at logon. Nothing restarts a supervisor that dies -- the task has
 * no restart-on-failure (`win32job.taskXml`) -- until the next logon.
 *
 *      launchd                          this module
 *      RunAtLoad ......................  Scheduled Task, at-logon trigger
 *      KeepAlive ......................  the respawn loop below
 *      ThrottleInterval 30 ............  THROTTLE_MS below
 *      supervisor parks on has-session   watch() polls the recorded session id
 *
 * ⚠️ AND A REBOOT NEEDS A LOGIN, on both platforms. launchd's RunAtLoad is a
 * per-user agent: it fires at the next USER LOGIN, not at headless boot. An
 * at-logon Scheduled Task has exactly the same property, so this does not paper
 * over the difference -- a box that reboots to a locked login screen brings no
 * fleet back on either OS until somebody signs in.
 */

const cp = require('node:child_process');

const win32channel = require('./win32channel');
const win32launch = require('./win32launch');
const win32sessions = require('./win32sessions');

/* The Mac's ThrottleInterval, in the same units the Mac states it. A crash-loop
   must limp, not spin: without this a agent that dies instantly would be
   respawned as fast as the loop runs, which is a fork bomb with extra steps. */
const THROTTLE_MS = 30 * 1000;

/* How often the watch loop asks whether the agent is still there. The Mac's
   `tmux has-session` poll is the same idea; this is cheap (one `claude agents
   --json`) and 5s is far below any human-visible restart delay. */
const POLL_MS = 5 * 1000;

/* The liveness seam. Tests replace it; production asks the runner. Returns the
   array `claude agents --json` produces, or null when we could not ask -- and
   NULL IS NOT DEATH, which is the distinction the whole loop turns on. */
let liveFn = null;
function setLiveReader(fn) { liveFn = typeof fn === 'function' ? fn : null; }
function liveSessions(bin) {
  if (liveFn) return liveFn();
  try {
    /* 🔑 THE RUNNER'S BINARY WHEN WE HAVE IT, `claude` WHEN WE DO NOT. A task
       starts with the user's logon environment, and whether `%USERPROFILE%\.local\bin`
       is on that PATH is not ours to assume -- `claude install` puts it there, and a
       fleet must not go blind because it did not. The absolute path rides argv (see
       specFromArgv); this is the same fallback win32launch takes for the spawn. */
    const out = cp.execFileSync(bin || 'claude', ['agents', '--json'], { encoding: 'utf8', timeout: 15000 });
    const v = JSON.parse(out);
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * Is this session still running?
 *
 * 🛑 THREE ANSWERS, NOT TWO, and collapsing them is how a fleet eats itself.
 * `true` it is alive; `false` it is provably gone; `null` WE COULD NOT ASK.
 * Treating null as death would respawn a healthy agent every time the runner was
 * briefly unreadable -- and then adopt-not-replace would be the only thing
 * standing between that and two agents under one name.
 */
function isAlive(sessionId, live) {
  const list = live === undefined ? liveSessions() : live;
  if (list === null) return null;
  return list.some((a) => a && a.sessionId === sessionId);
}

/**
 * Is somebody ELSE already running under this name?
 *
 * ⚠️ ADOPT, NEVER REPLACE -- and on a foreign session, WAIT. The Mac's supervisor
 * adopts an existing healthy session and only creates one when none exists; a
 * same-named session it does not own makes it wait rather than kill. Killing
 * would let a stale supervisor take out a live agent, so the conservative answer
 * is the safe one in both directions.
 */
function ourLiveSession(name, live) {
  const list = live === undefined ? liveSessions() : live;
  if (list === null) return null;
  /* The ownership record is the only thing that ties a live session to a Kosmos
     name -- `claude agents --json` reports a cwd-derived name, not ours (measured:
     a session recorded as `winagent-1` reports itself as `real-launch-8c`). Read
     once per cycle rather than per session; the record is a single small file. */
  let recorded;
  try { recorded = win32sessions.read(); } catch { return null; }
  if (!recorded) return null;
  for (const a of list) {
    if (!a || !a.sessionId) continue;
    const rec = recorded[a.sessionId];
    if (rec && rec.name === name) return a.sessionId;
  }
  return null;
}

/**
 * One supervision cycle: make sure an agent for `spec` is running, and return
 * what happened. Pure-ish -- it does no waiting, so a test can drive the whole
 * state machine without a clock.
 *
 * Returns { action, sessionId?, because? } where action is one of:
 *   'adopted'   an agent for this name was already live; we did not start one
 *   'started'   none was live, so we launched
 *   'waiting'   we could not ask the runner -- do NOTHING, ask again later
 *   'refused'   the launch itself was refused (trust, a bad folder, a dead spawn)
 */
function ensureRunning(spec) {
  const s = spec || {};
  const live = liveSessions();
  if (live === null) {
    /* ⚠️ THE MOST IMPORTANT BRANCH IN THE FILE. An unreadable runner is not an
       absent agent. Starting one here is how a transient failure becomes two
       agents under one name -- the exact collision adopt-not-replace exists to
       prevent, arriving through the back door. */
    return { action: 'waiting', because: 'we could not ask which agents are running, so we changed nothing' };
  }

  const mine = ourLiveSession(s.name, live);
  if (mine) return { action: 'adopted', sessionId: mine };

  const r = win32launch.launch({
    name: s.name, runner: s.runner, cwd: s.cwd,
    claudeBin: s.claudeBin, configDir: s.configDir, model: s.model,
    platform: s.platform || 'win32',
  });
  if (!r.ok) return { action: 'refused', because: r.because };
  return { action: 'started', sessionId: r.sessionId };
}

/**
 * The supervision loop. Runs until `stop()` is called on the returned handle --
 * it does NOT exit when the agent dies, because on this platform there is no
 * KeepAlive above it to notice.
 *
 * `sleep` is injected so a test can drive years of supervision in milliseconds.
 */
function supervise(spec, opts) {
  const o = opts || {};
  const sleep = o.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  const throttleMs = o.throttleMs === undefined ? THROTTLE_MS : o.throttleMs;
  const pollMs = o.pollMs === undefined ? POLL_MS : o.pollMs;
  const onEvent = typeof o.onEvent === 'function' ? o.onEvent : () => {};

  let running = true;
  const handle = { stop() { running = false; } };

  handle.done = (async () => {
    let lastStart = 0;
    while (running) {
      const now = o.now ? o.now() : Date.now();
      /* THE THROTTLE, and it gates the START rather than the loop: a healthy
         adopted agent must not be made to wait 30s to be noticed, but a crashing
         one must not be restarted faster than that. */
      const sinceStart = now - lastStart;
      if (lastStart && sinceStart < throttleMs) {
        const alive = isAlive(handle.sessionId, undefined);
        if (alive === true) { await sleep(pollMs); continue; }
        onEvent({ action: 'throttled', waitMs: throttleMs - sinceStart });
        await sleep(Math.min(pollMs, throttleMs - sinceStart));
        continue;
      }

      const r = ensureRunning(spec);
      onEvent(r);
      if (r.action === 'started') { lastStart = now; handle.sessionId = r.sessionId; }
      else if (r.action === 'adopted') { handle.sessionId = r.sessionId; }
      await sleep(pollMs);
    }
  })();

  return handle;
}

/**
 * The argument vector the Scheduled Task runs.
 *
 * 🔑 POSITIONAL, APPEND-ONLY, EVERY NEW ONE OPTIONAL AND DEFAULTED -- the Mac's
 * contract for `agent-supervisor.sh`, adopted deliberately. There is ONE
 * supervisor for every agent (the per-agent-copy version "shipped every bug N
 * times"), so the per-agent facts have to arrive as arguments, and a task
 * registered last week must keep working when a new argument is added. NEVER
 * REORDER THESE; add to the end.
 *
 *   argv:  <name> <cwd> [model] [configDir] [runner] [claudeBin]
 *
 * 🛑 `claudeBin` IS ARGUMENT SIX, AND IT WAS ADDED BECAUSE THE TASK PATH LOST IT
 * (7c-2). `create.js` resolves the runner's absolute path (`runners.resolveBin`,
 * with the PATHEXT candidates #570 added) and used to hand it straight to
 * `win32launch.launch`. Once the TASK became the launcher, the only facts that
 * survive into the agent are the ones on this line -- and the resolved path was
 * not one of them, so every task-started agent fell back to a bare `claude` and
 * depended on the logon PATH carrying `%USERPROFILE%\.local\bin`. That is exactly
 * the class of assumption this lane keeps being punished for, so the path is
 * carried rather than assumed. A task registered before this argument existed
 * passes five arguments, gets `undefined`, and falls back as it always did.
 */
function specFromArgv(argv) {
  const a = Array.isArray(argv) ? argv : [];
  const at = (i) => (typeof a[i] === 'string' && a[i] !== '' && a[i] !== '-' ? a[i] : undefined);
  return {
    name: at(0),
    cwd: at(1),
    model: at(2),
    configDir: at(3),
    runner: at(4) || 'claude',
    claudeBin: at(5),
  };
}

/**
 * The process entry point.
 *
 * 🔑 EXPORTED, BECAUSE THE TASK NO LONGER RUNS THIS FILE DIRECTLY. A Scheduled
 * Task is durable and this file is not: it lives under the extract root, which
 * moves with every update (see engine/win32anchor.js). The task runs the anchored
 * shim instead, and the shim resolves the current engine and calls THIS. Keeping
 * the `require.main` guard as well means the file still runs standalone, which is
 * how it gets driven by hand on the box.
 *
 * 🛑 IT SUPERVISES THE STREAMING AGENT, NOT THE DETACHED ONE (7c-2). This called
 * `supervise()` -- which watches a detached agent nobody holds the stdin of, and
 * that is precisely why a Windows agent could not be TOLD anything. Pointing the
 * task at `superviseStreaming` is what makes delivery possible at all: the agent
 * the supervisor starts is its own child, its stdin is the message channel, and
 * `handle.send()` is the thing `chat.js`'s win32 arm will call.
 *
 * ⚠️ AND IT IS ONE SWITCH, NOT A MODE FLAG, ON PURPOSE. Two supervision shapes
 * selectable at runtime would mean two live paths, each half-exercised, which is
 * the shape every defect in this lane arrived in. `supervise()` stays exported
 * and tested -- it is the adoption watcher, and the measured knowledge in it is
 * worth keeping -- but nothing in production selects it.
 */
function main(argv, deps) {
  const d = deps || {};
  const spec = specFromArgv(argv);
  if (!spec.name || !spec.cwd) {
    process.stderr.write('kosmos win32 supervisor: needs <name> <cwd>\n');
    process.exit(2);
  }
  let last = null;
  const handle = superviseStreaming(spec, {
    /* 🛑 NEVER START AN AGENT FOR A TASK THAT WAS JUST ENDED (#570 headless). `/End`
       kills the host at once but this process for up to a second after, and a
       remove kills the agent right after its `/End` -- so without this check the
       dying supervisor could relaunch the agent that was just removed. */
    mayStart: d.hostAlive || (() => require('./win32orphan').pidAlive(process.ppid)),
    /* 🔑 THE ONE PRODUCTION PUBLISHER (7c-5): the agent's working/idle, kept in a
       file the board's capture reads. A state it could not record is said on the
       task log, where a missing card state can be traced back to it. */
    stream: require('./win32streamstate').publisher(spec.name, {
      onProblem: (why) => process.stderr.write(new Date().toISOString() + ' ' + spec.name + ' state-unrecorded -- ' + why + '\n'),
    }),
    onEvent: (e) => {
      /* One line per transition, on stderr so a task log captures it.
         ⚠️ A REPEATED `waiting` IS NOT A TRANSITION. Everything else here happens
         once per start or per death; waiting repeats every poll for as long as
         somebody else's session holds the name, which would be a line every five
         seconds forever. Narrated on the EDGE, so the reason is still on the
         record and the flood is not -- and every other action still prints every
         time, because a supervisor that hides a restart storm is worse than one
         that is chatty about it. */
      if (e.action === 'waiting' && last === 'waiting') return;
      last = e.action;
      process.stderr.write(new Date().toISOString() + ' ' + spec.name + ' ' + e.action
        + (e.because ? ' -- ' + e.because : '') + '\n');
    },
  });
  /**
   * 🔑 AND IT SERVES THE CHANNEL, BECAUSE IT IS THE ONLY PROCESS THAT COULD (7c-3).
   * `handle.send()` types at the agent, and until now nothing outside this process
   * could call it -- the board is somewhere else entirely. The pipe is opened here,
   * in the process that holds the agent's stdin, which is the whole reason the
   * server half lives in the supervisor rather than in the board.
   *
   * ⚠️ A CHANNEL THAT COULD NOT BE OPENED DOES NOT STOP THE SUPERVISOR. An agent
   * that runs and cannot be messaged is the state Windows has been in all along;
   * refusing to supervise it as well would turn a lost capability into a lost
   * agent. It is said once, on stderr, where the task log keeps it.
   */
  const channel = win32channel.serve(spec.name, {
    onSay: (text, replyWith) => { handle.send(text, replyWith); },
    /* A listen that failed after serve() returned -- anything but the retried
       "the previous supervisor still has it" -- is said on the task log. */
    onProblem: (why) => process.stderr.write(new Date().toISOString() + ' ' + spec.name + ' channel-refused -- ' + why + '\n'),
  });
  if (!channel.ok) {
    process.stderr.write(new Date().toISOString() + ' ' + spec.name
      + ' channel-refused -- ' + channel.because + '\n');
  }

  /* ⚠️ STOPPING HAS TO CLOSE THE CHANNEL TOO, and hanging that off `stop` rather
     than off the signal handlers is what makes it true for every caller. A pipe
     server holds the event loop open, so a supervisor that stopped supervising and
     left its channel listening is a process that never exits -- which is a hung
     Scheduled Task in production and a test run that never returns. */
  /**
   * 🔑 AND IT LEAVES WHEN ITS HOST DOES (#570). The task runs this under
   * `conhost.exe --headless` so no window opens, and `/End` kills only that
   * conhost. This watch is what makes every Kosmos stop still stop the agent:
   * the supervisor stops its agent and exits. See engine/win32orphan.js. Under
   * an older windowed task the parent is Task Scheduler's svchost, which never
   * leaves, so nothing changes there.
   */
  const watchHost = d.watchHost || require('./win32orphan').exitWhenParentGone;
  const exitLater = d.exitLater || ((ms) => { const t = setTimeout(() => process.exit(0), ms); if (t.unref) t.unref(); });
  const hostWatch = watchHost({
    onGone: () => {
      process.stderr.write(new Date().toISOString() + ' ' + spec.name
        + ' host-gone -- its task was ended, so its agent is being stopped\n');
      handle.stop();
      exitLater(HOST_GONE_GRACE_MS);
    },
  });

  const supervisionStop = handle.stop;
  handle.stop = function stop() {
    supervisionStop();
    if (channel.ok) channel.close();
    if (hostWatch && typeof hostWatch.stop === 'function') hostWatch.stop();
  };
  process.on('SIGINT', handle.stop);
  process.on('SIGTERM', handle.stop);
  handle.channel = channel;
  return handle;
}

/* istanbul ignore next -- the process wrapper; the state machine above is what
   the tests drive. */
if (require.main === module) main(process.argv.slice(2));

/* ── the streaming supervisor (7c-1) ───────────────────────────────────────── */

/* A stream sink that records nothing: the default, so only `main()` publishes. */
const NO_STREAM = { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} };

/* How long between attempts to record an agent's new session id after a `/clear`
   (#2669), and how many attempts. The failures worth retrying are short: a rename
   refused while the board reads the file, or the record's lock held by another
   writer. Thirty tries two seconds apart give those a full minute. */
const REKEY_RETRY_MS = 2 * 1000;
const REKEY_ATTEMPTS = 30;

/** How much of a dying agent's stderr rides on its `died` line. Enough for the
    one sentence that explains a crash; small enough that a chatty agent cannot
    flood the task log through it. */
const STDERR_TAIL_CHARS = 500;

/** How long the supervisor gives its agent to leave, once its host is gone, before
    exiting anyway. Closing stdin was measured ending the agent in ~800ms, so this
    is room enough without leaving a stopped agent up for long. */
const HOST_GONE_GRACE_MS = 2000;

/**
 * Supervise an agent whose PIPES WE HOLD.
 *
 * 🛑 THE ONE PROPERTY THIS TRADES AWAY, AND ITS EXACT SHAPE. `supervise()` above
 * watches a DETACHED agent: it outlives its supervisor, so a supervisor restart
 * ADOPTS it. A piped agent cannot be adopted -- adoption would mean holding a
 * stdin somebody else holds -- so the question is what happens to the agent when
 * its holder dies. Measured on the box rather than reasoned about:
 *
 *      holder closes stdin cleanly  -> agent gone in ~800ms, out of agents --json
 *      holder KILLED, pipes broken  -> agent gone in ~800ms, out of agents --json
 *
 * 🔑 NO ORPHANS, IN EITHER DIRECTION, and that is what makes this design safe.
 * A dead supervisor leaves nothing live to collide with. Two different returns
 * follow from that, and an earlier version of this comment ran them together:
 *   - an AGENT that dies under a living supervisor is relaunched by it with
 *     `--resume` -- the SAME session id, the same conversation (measured);
 *   - a SUPERVISOR that dies is not restarted by anything (the task has no
 *     restart-on-failure). The next start of its task -- a logon, a restore, a
 *     restart from the board -- runs `main()`, which mints a NEW session: a fresh
 *     conversation, as a Mac restart gives.
 * Neither can put two agents under one name.
 *
 * ⚠️ SO THE EXIT EVENT IS THE SIGNAL, NOT THE POLL. `supervise()` asks
 * `claude agents --json` every POLL_MS because a detached agent's death is
 * invisible otherwise. Here the child IS ours: its 'exit' fires immediately and
 * cannot be missed, so death is known in milliseconds rather than up to a poll
 * late, and the runner is not asked anything on the happy path.
 */
function superviseStreaming(spec, opts) {
  const s = spec || {};
  const o = opts || {};
  const throttleMs = o.throttleMs === undefined ? THROTTLE_MS : o.throttleMs;
  const pollMs = o.pollMs === undefined ? POLL_MS : o.pollMs;
  const onEvent = typeof o.onEvent === 'function' ? o.onEvent : () => {};
  const now = o.now || (() => Date.now());
  const timer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const launcher = o.launch || win32launch.launchStreaming;
  /* The liveness seam, per-handle rather than module-wide, because this loop asks
     the question at a different moment than `supervise()` does and a test needs to
     drive the two independently. Defaults to the real runner. */
  const readLive = o.liveReader || (() => liveSessions(s.claudeBin));
  /* Asked right before every launch; `main()` answers "is my host still alive". */
  const mayStart = typeof o.mayStart === 'function' ? o.mayStart : () => true;
  /* How a finished run's credential is retired. Each launch mints one token
     (win32create.mintForRun); without this every crash-restart would leave one
     more live credential behind for the agent. Injectable so a test never touches
     a real token store. */
  const retireRun = typeof o.retireRun === 'function' ? o.retireRun
    : (name, instance) => require('./win32create').retireRun(name, instance);
  /* The ownership record, injectable so a test can make a record fail. */
  const sessions = o.sessions || win32sessions;

  /* Where the agent's working/idle goes (7c-5). The default does nothing, so no
     suite that drives this loop writes state files; `main()` passes the real
     publisher, which is the one production wiring. */
  const stream = o.stream || NO_STREAM;

  let running = true;
  let child = null;
  let lastStart = 0;
  const handle = { sessionId: s.resumeSessionId || null };

  /**
   * Follow the session id when it changes under a running agent (#2669).
   *
   * 🛑 A `/clear` ROTATES A STREAMING SESSION'S ID: same pid, new `session_id`.
   * Measured on the box, fresh and `--resume`d alike: `conversation_reset` still
   * carries the old id, then a `system`/`init` carries the new one, then a
   * `result`, all within a tenth of a second. Three
   * holders of the old id must follow it, or the agent drops off the board:
   * ownership (`win32sessions`, which `win32live` joins the live list through),
   * the resume id (`handle.sessionId`, which a crash relaunch `--resume`s), and
   * the 7c-5 state file (`stream.rekey`).
   *
   * Gated on `system`/`init` ONLY: it is the one event that opens every turn and
   * carries the id. Hook events carry it too but depend on configuration, and a
   * looser gate would fire this once per event.
   *
   * 🔑 RECORD THE NEW ID BEFORE FORGETTING THE OLD, so an interruption leaves the
   * agent visible under two ids, never under none. The resume id moves only after
   * the record succeeds, so a failed record never strands it on an unrecorded
   * session.
   */
  function followSessionId(e) {
    if (!e || e.type !== 'system' || e.subtype !== 'init') return;
    const id = e.session_id;
    if (typeof id !== 'string' || !id || id === handle.sessionId) return;
    rekeyTo(id, child, 1);
  }

  /* 🛑 A FAILED RECORD IS RETRIED, because it does not heal on its own: with the
     new id unrecorded the agent has no card, so no message reaches it, so no later
     `init` comes along to try again. Retries stop when this child is replaced or
     the loop stops, when a newer id supersedes this one, or after REKEY_ATTEMPTS.
     `stop()` also clears `child`, so a stopped loop fails both `running` and
     `child === owner`; a test pins that a retry after a stop writes nothing. */
  let pendingRekey = null;
  function rekeyTo(id, owner, attempt) {
    const oldId = handle.sessionId;
    let rec;
    try { rec = sessions.record(id, { name: s.name, runner: s.runner }); }
    catch (err) { rec = { ok: false, because: 'we could not record its new session (' + ((err && err.code) || 'unknown') + ')' }; }
    if (!rec || !rec.ok) {
      const why = (rec && rec.because) || 'we could not record its new session';
      pendingRekey = id;
      const last = attempt >= REKEY_ATTEMPTS;
      if (attempt === 1 || last) {
        onEvent({ action: 'rekey-failed', sessionId: id,
          because: 'its session changed from ' + oldId + ' to ' + id + ', but ' + why + (last ? '; we stopped trying' : '; we will keep trying') });
      }
      if (!last) timer(() => { if (running && child === owner && pendingRekey === id) rekeyTo(id, owner, attempt + 1); }, REKEY_RETRY_MS);
      return;
    }
    pendingRekey = null;
    handle.sessionId = id;
    stream.rekey(id);
    if (oldId) {
      /* Said, not swallowed: a stale row is harmless only while nothing runs under
         the old id, and `claude --resume <old id>` would join the live list under
         this agent's name -- the duplicate-name case win32live's header warns of. */
      let forgot;
      try { forgot = sessions.forget(oldId); }
      catch (err) { forgot = { ok: false, because: 'we could not update the ownership record (' + ((err && err.code) || 'unknown') + ')' }; }
      if (!forgot || !forgot.ok) {
        onEvent({ action: 'forget-failed', sessionId: oldId,
          because: 'its old session ' + oldId + ' is still recorded under its name: ' + ((forgot && forgot.because) || 'unknown') });
      }
    }
    onEvent({ action: 'rekeyed', sessionId: id, from: oldId, because: 'its session changed from ' + oldId + ' to ' + id });
  }

  function attach(c, runInstance) {
    child = c;
    /* 🔑 THE EVENT STREAM IS READ, and that is what gives a Windows card its
       working/idle (7c-5): `claude agents --json` lists no status for a
       streaming session. Reading stdout also retires the old question of what
       happens when nobody drains a full pipe. Only the CURRENT child publishes;
       a late line from a child already replaced says nothing about the new one. */
    const { lineReader, parseEvent } = require('./win32streamstate');
    if (c.stdout && typeof c.stdout.on === 'function') {
      const feed = lineReader((line) => {
        if (child !== c) return;
        const e = parseEvent(line);
        followSessionId(e);   // before the state sink, so a rekey lands before the turn's events
        stream.event(e);
      });
      c.stdout.on('data', feed);
    }
    /* stderr is drained so it can never fill, and its tail is kept so a death can
       say why on the task log rather than dying in silence. */
    let stderrTail = '';
    if (c.stderr && typeof c.stderr.on === 'function') {
      /* Decoded by the stream, so a character split between two chunks stays whole. */
      if (typeof c.stderr.setEncoding === 'function') c.stderr.setEncoding('utf8');
      c.stderr.on('data', (d) => { stderrTail = (stderrTail + String(d)).slice(-STDERR_TAIL_CHARS); });
    }
    /* ⚠️ ONE HANDLER, AND IT MUST NOT FIRE TWICE. 'exit' and 'close' both arrive;
       acting on both would double-count a death and burn the throttle budget. */
    let handled = false;
    const gone = (code) => {
      if (handled) return;
      handled = true;
      /* This run is over whether or not it was already replaced, so its token is
         retired unconditionally -- retire, never revoke, so the agent's other runs
         keep theirs. A clean stop ends the child through this same path. */
      if (runInstance) {
        let retired;
        try { retired = retireRun(s.name, runInstance); }
        catch (e) { retired = { ok: false, because: 'we could not retire its token (' + ((e && e.code) || 'unknown') + ')' }; }
        /* Said, not swallowed: a token left live only waits out the store's cap,
           but the task log should show why it is still there. */
        if (retired && retired.ok === false) onEvent({ action: 'token-not-retired', because: retired.because });
      }
      if (child === c) { child = null; stream.stopped(); }
      const said = stderrTail.replace(/\s+/g, ' ').trim();
      onEvent({ action: 'died', code: code === undefined ? null : code, sessionId: handle.sessionId, because: said ? 'it said: ' + said : undefined });
      if (running) schedule();
    };
    c.on('exit', gone);
    c.on('error', () => gone(null));
  }

  /**
   * May we start one, or is a session we do not hold already answering to this
   * name? Returns a sentence when the answer is no, and null when it is yes.
   *
   * 🛑 WITHOUT THIS, resume-not-replace HAS A HOLE THE SIZE OF adopt-not-replace's
   * (7c-2). `supervise()` above asks `ourLiveSession` before every launch, for the
   * one reason that matters: two agents under one name, editing one folder. This
   * loop had no such check, because until 7c-2 nothing in production started it --
   * and the moment the task and `create.js` both point here, the hole is live:
   *
   *   - `win32job.start()` (the Restore button, and create's own start) runs the
   *     task NOW. If a detached agent from the pre-7c-2 launch path is still
   *     running under that name, an unguarded start would put a second one beside
   *     it -- and the first one is unreachable, so nothing would ever notice.
   *   - a restart whose own session is still listed would `--resume` an id that
   *     already has a process on it, which is two processes on one conversation.
   *
   * ⚠️ AND IT WAITS RATHER THAN KILLING, which is `ourLiveSession`'s own ruling
   * and for its reason: killing would let a stale supervisor take out a live
   * agent. Waiting is self-resolving -- the foreign session ends, or the box
   * reaches a logon where nothing detached survives -- and it is honest on the
   * way, because the sentence reaches the task log every time the state changes.
   *
   * ⚠️ AN UNREADABLE RUNNER IS NOT AN ABSENT AGENT, the most important branch in
   * `ensureRunning` and the same branch here. Starting on a look that failed is
   * how a transient failure becomes the duplicate this guard exists to prevent.
   */
  function blockedBy() {
    const live = readLive();
    if (live === null) return 'we could not ask which agents are running, so we did not start a second one';
    const mine = ourLiveSession(s.name, live);
    if (!mine) return null;
    if (handle.sessionId && mine === handle.sessionId) {
      /* Our own id, still listed. Either the list is a moment stale after a death
         we already saw, or the agent is somehow still up; `--resume` is wrong in
         both readings, and a poll from now it will be right in one of them. */
      return 'its own session is still listed as running, so we did not resume it on top of itself';
    }
    return 'a session we do not hold is already running under this name, so we left it alone';
  }

  function startOnce() {
    if (!running) return;
    let may = true;
    try { may = mayStart() !== false; } catch { may = true; }
    if (!may) {
      onEvent({ action: 'not-starting', because: 'its task was ended, so it is not starting its agent again' });
      return;
    }
    const blocked = blockedBy();
    if (blocked) {
      /* 🔑 THE THROTTLE IS NOT BURNED BY WAITING. `lastStart` is untouched here, so
         a name that frees up after an hour of waiting starts immediately rather
         than serving a crash-loop penalty it never earned. */
      onEvent({ action: 'waiting', because: blocked });
      timer(() => { if (running) startOnce(); }, pollMs);
      return;
    }
    const r = launcher({
      name: s.name, runner: s.runner, cwd: s.cwd, claudeBin: s.claudeBin,
      configDir: s.configDir, model: s.model, platform: s.platform || 'win32',
      /* 🔑 THE RETURN, NOT A BIRTH. Once we know the id, every later start is a
         resume: same conversation, same id, and NOTHING new recorded. A start
         that minted a fresh id each time would file a second ownership row per
         restart -- the duplicate-name hazard, arriving through the routine path. */
      resumeSessionId: handle.sessionId || undefined,
    });
    lastStart = now();
    if (!r.ok) { onEvent({ action: 'refused', because: r.because }); if (running) schedule(); return; }
    handle.sessionId = r.sessionId;
    /* Published BEFORE the handlers attach, so the first line the agent prints
       already has a process to belong to. Idle: measured, a streaming agent says
       nothing until it is told something, fresh or resumed. */
    stream.started(r.child && r.child.pid, r.sessionId);
    attach(r.child, r.instance || null);
    /* A run that could not mint a token still runs, but the board refuses every
       report it sends -- so the task log says why, rather than nothing. */
    onEvent(Object.assign({ action: r.resumed ? 'resumed' : 'started', sessionId: r.sessionId },
      r.tokenBecause ? { because: 'it has no reporting token: ' + r.tokenBecause } : {}));
  }

  /* The Mac's ThrottleInterval, gating the RESTART. A crash-loop must limp, not
     spin: an agent that dies instantly would otherwise be relaunched as fast as
     the event loop turns. */
  function schedule() {
    const since = now() - lastStart;
    const wait = since >= throttleMs ? 0 : throttleMs - since;
    if (wait > 0) onEvent({ action: 'throttled', waitMs: wait });
    timer(() => { if (running) startOnce(); }, wait);
  }

  /**
   * Deliver one message to the agent. The whole point of the design.
   *
   * Returns { ok:true } or { ok:false, because } and never throws -- a throw here
   * would become a 500 where a sentence belongs. `done` gets the same shapes,
   * plus `unsure:true` when the bytes may have reached the agent anyway, which
   * `chat.js` reports as unconfirmed rather than could_not.
   */
  handle.send = function send(text, done) {
    const answer = (r) => { if (typeof done === 'function') { try { done(r); } catch { /* the caller's problem, not ours */ } } return r; };
    if (!child || !child.stdin || child.stdin.destroyed) {
      return answer({ ok: false, because: 'it is not running just now, so we did not type anything' });
    }
    /* 🔑 `done` IS CALLED WHEN THE BYTES HAVE FLUSHED, NOT WHEN THEY WERE HANDED
       TO A STREAM (7c-3). The return value is a PRE-CHECK -- it says the pipe was
       open when we looked -- and that was enough while the only caller was a test.
       The channel answers a person's send with it, so it needs the later truth: an
       agent that died between the check and the write fails the write, and
       reporting that as delivered is exactly the over-claim chat.js's `could_not`
       contract exists to prevent. Callers that want the old, cheaper answer simply
       pass no callback. */
    /* The child this message goes to. Its flush can land after that child has died
       and a restart has replaced it, and "a message reached it" is then news about
       a process that is gone -- the same reason stdout and the exit handler check
       `child === c` (7c-5, found in review). */
    const target = child;
    try {
      child.stdin.write(win32launch.messageLine(text), (err) => {
        /* 🔑 A WRITE THAT FAILS HERE HAD ALREADY BEEN HANDED TO THE PIPE, so part
           of it may be in front of the agent. That is `unsure` -- the Mac's
           UNCONFIRMED -- never a definite no (Baron's bar, 2026-09-10: a write
           that buffered and then errored is not could_not). Only the synchronous
           throw below proves nothing left this process. */
        if (err) answer({ ok: false, unsure: true, because: 'the write to it failed part-way (' + ((err && err.code) || 'unknown') + '), so we cannot tell whether it arrived' });
        else { if (child === target) stream.wrote(); answer({ ok: true }); }
      });
    } catch (e) { return answer({ ok: false, because: 'we could not reach it (' + ((e && e.code) || 'unknown') + ')' }); }
    return { ok: true };
  };

  handle.stop = function stop() {
    running = false;
    /* Close stdin rather than killing: measured, the agent exits ~800ms later of
       its own accord, which lets it finish writing anything in flight. A stop
       that must be immediate is win32stop's job, and that is a different verb. */
    if (child && child.stdin && !child.stdin.destroyed) { try { child.stdin.end(); } catch { /* it is going anyway */ } }
    /* A stop clears the state too. `child` is dropped here, before the agent's
       exit arrives, so the death handler below would never publish it -- and a
       turn cut off by the stop must not stay WORKING on disk. */
    if (child) stream.stopped();
    child = null;
  };

  handle.current = () => child;
  startOnce();
  return handle;
}

module.exports = {
  THROTTLE_MS, POLL_MS,
  isAlive, ourLiveSession, ensureRunning, supervise, superviseStreaming, specFromArgv,
  setLiveReader, liveSessions, main,
};
