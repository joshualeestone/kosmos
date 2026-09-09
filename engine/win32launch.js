'use strict';
/**
 * Starting an agent on Windows: the substrate the Mac gets from launchd.
 *
 * 🛑 WHY THIS EXISTS. `create.js` starts a Mac agent by writing a `.plist` and
 * calling `launchctl` (15 call sites), then `bin/agent-supervisor.sh` opens the
 * tmux pane, mints the sender token and stamps ownership. None of that exists on
 * Windows: no launchd, no tmux, no pane. `engine/win32create.js` already produces
 * the record and the launch ARGS -- and says outright that the spawn itself "is
 * Windows-runtime plumbing built and measured on a real box, not here". This is
 * that piece, and every rule in it was measured on the box rather than reasoned
 * about, because the two that matter are both invisible failures.
 *
 * 🔑 THE ORDER IS THE DESIGN, and it is not interchangeable:
 *
 *      trust  ->  prepare (id + record + token)  ->  spawn
 *
 * ⚠️ TRUST FIRST, AND A FAILED TRUST REFUSES THE LAUNCH. Measured 2026-09-07: a
 * spawn into an untrusted folder starts, stays alive, and sits forever on Claude
 * Code's "Is this a project you created or one you trust?" dialog with `No, exit`
 * PRESELECTED. It never registers, so `claude agents --json` never lists it, so
 * the fail-closed roster emits nothing -- a board that looks exactly like a board
 * with no agents. And because these consoles are HIDDEN (below), the dialog is on
 * no screen anybody can see. An agent that cannot be seen waiting is worse than
 * an agent that never started, so a trust failure returns `ok:false` instead of
 * launching something nobody can rescue.
 *
 * 🔑 HIDDEN CONSOLE, NOT A PANE. Windows has no pty for us and the bundle ships
 * no native modules, so the agent runs in its own console window created hidden.
 * Measured: with trust pre-accepted a hidden-console session REGISTERS IN ~5s,
 * `kind: "interactive"`, and its hooks fire. That is the tmux-pane analog for this
 * platform -- headless, no desktop clutter, nothing to install.
 *
 * ⚠️ INTERACTIVE, NEVER `--bg`. `claude --bg` prints "--bg manages the session id;
 * ignoring --session-id" and mints its own, so a backgrounded agent would run
 * under an id we never recorded and the fail-closed roster would never emit it.
 * The whole ownership record depends on the pin.
 *
 * ⚠️ TOP-LEVEL, NEVER A CHILD. `CLAUDE_CODE_CHILD_SESSION` is set inside an agent
 * session and SUPPRESSES REGISTRATION ENTIRELY. Measured: the naive spawn from
 * inside a session inherits it and silently never appears. Everything in
 * INHERITED_MARKERS is stripped for that reason -- this is the most dangerous
 * rule here, because the agent runs fine and is simply invisible.
 *
 * 📌 THE TOKEN NEVER TOUCHES DISK. It is passed through the child's environment,
 * not written into a launcher script. The first working prototype used a `.cmd`
 * file and that file held a live credential in the clear.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const win32create = require('./win32create');
const trust = require('./trust');

/* Every marker that makes a spawned session a CHILD of this one. Stripped, not
   overwritten: Claude Code reads presence, so an empty string is not the same as
   absent on every one of them. The list is what was observed live inside an agent
   session on 2026-09-07 -- if a future Claude Code adds another, the symptom is a
   session that runs and never registers. */
const INHERITED_MARKERS = Object.freeze([
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDECODE',
]);

/**
 * The environment the agent starts with: ours, minus the markers that would make
 * it a child, plus its own token.
 *
 * 🔑 A PURE FUNCTION OVER AN ENV OBJECT, so the stripping is assertable from a
 * Mac without spawning anything.
 */
function childEnv(baseEnv, token, configDir) {
  const env = Object.assign({}, baseEnv || {});
  for (const k of INHERITED_MARKERS) delete env[k];
  if (token) env.KOSMOS_AGENT_TOKEN = token;
  else delete env.KOSMOS_AGENT_TOKEN;   // never inherit somebody else's credential
  /* 🔑 THE ACCOUNT, THE WAY THIS PLATFORM CARRIES IT. On the Mac a non-default
     account rides in the plist's EnvironmentVariables as CLAUDE_CONFIG_DIR;
     there is no plist here, so it rides in the child's environment instead --
     the same variable Claude Code reads, just delivered by the substrate this
     platform has.

     ⚠️ AND ABSENT MEANS THE DEFAULT ACCOUNT, WHICH IS WHY IT IS DELETED RATHER
     THAN LEFT. This process may itself be running under a CLAUDE_CONFIG_DIR
     (the board inherits the app's launch environment), and #2129 is the whole
     card about that leaking: an agent meant for the DEFAULT account would
     silently inherit the engine's account instead. A default-account agent must
     start with no CLAUDE_CONFIG_DIR at all. */
  if (configDir) env.CLAUDE_CONFIG_DIR = String(configDir);
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}

/**
 * The argv for one agent.
 *
 * `launchArgs` comes from prepareSession and already carries `--session-id <id>`;
 * it is spliced in verbatim rather than rebuilt, which is the same one-mint-point
 * rule win32create states -- rebuilding it here would be a second place for the
 * recorded id and the running id to disagree.
 */
function argvFor(prepared, opts) {
  const o = opts || {};
  const argv = [];
  if (o.model) argv.push('--model', String(o.model));
  return argv.concat(prepared.launchArgs);
}

/* The spawn seam. Tests replace it; nothing else does. Mirrors the
   setPaneSource/setRunner shape the rest of the engine uses. */
let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }
function spawner() { return spawnFn || spawn; }

/**
 * Start one agent. Returns { ok:true, sessionId, pid, name } or
 * { ok:false, because } -- never throws, because a failed launch must leave the
 * caller able to say why rather than unwind.
 *
 * @param {{name:string, runner?:string, cwd:string, claudeBin?:string, configDir?:string,
 *          model?:string, platform?:string}} spec
 */
function launch(spec) {
  const s = spec || {};
  const plat = s.platform || process.platform;
  if (plat !== 'win32') {
    return { ok: false, because: 'this launcher is for Windows; the Mac path is launchd' };
  }
  if (!s.cwd || !path.isAbsolute(String(s.cwd))) {
    return { ok: false, because: 'an agent needs an absolute folder to run in' };
  }

  /* 1. TRUST, AND IT GATES. See the header: an untrusted spawn hangs on a dialog
        in a hidden console, forever, invisibly. Refusing is the kinder failure. */
  let trusted;
  /* ⚠️ TRUST GOES IN THE CONFIG THE AGENT WILL READ, not ours. Claude Code
     records trust PER CONFIG DIR (#1629, measured: one folder, three configs,
     TRUE in one and FALSE in the other two), so writing it into the engine's
     config while the agent starts under another account leaves the agent facing
     the dialog with the flag written somewhere it never looks. `configDir` is
     the same value that goes into the child's environment below, so the write
     and the read cannot disagree. */
  try { trusted = trust.trustFolder(s.cwd, { configDir: s.configDir || null, createIfAbsent: true, agentDefaultAccount: !s.configDir }); }
  catch (e) { trusted = { ok: false, because: 'we could not write the trust entry (' + ((e && e.code) || 'unknown') + ')' }; }
  if (!trusted.ok) {
    return { ok: false, because: 'we did not start it, because we could not vouch for its folder first: ' + trusted.because };
  }

  /* 2. PREPARE: mint the session id, write the ownership record, mint the token.
        On failure NOTHING was recorded, so there is nothing to abandon. */
  const prepared = win32create.prepareSession({ name: s.name, runner: s.runner });
  if (!prepared.ok) return { ok: false, because: prepared.because };

  /* 3. SPAWN. `cmd /c start` is what creates the agent its own console; Node has
        no CREATE_NEW_CONSOLE flag of its own, and a DETACHED_PROCESS child gets no
        console at all, which an interactive TUI needs. `windowsHide` keeps that
        console off the screen. The empty string after `start` is the WINDOW TITLE
        argument -- omitting it makes `start` treat a quoted program path as the
        title and launch nothing, which is a genuinely baffling failure to debug. */
  const argv = argvFor(prepared, s);
  const bin = s.claudeBin || 'claude';
  let child;
  try {
    child = spawner()('cmd.exe', ['/c', 'start', '', '/min', bin].concat(argv), {
      cwd: s.cwd,
      env: childEnv(process.env, prepared.token, s.configDir),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    if (child && typeof child.unref === 'function') child.unref();
  } catch (e) {
    /* The record and the token outlive a spawn that never happened, so undo both
       -- abandon() retires the token as well as forgetting the row. */
    try { win32create.abandon(prepared); } catch { /* best effort */ }
    return { ok: false, because: 'we could not start it (' + ((e && e.code) || 'unknown') + ')' };
  }

  return {
    ok: true,
    name: prepared.name,
    sessionId: prepared.sessionId,
    /* ⚠️ NOT THE AGENT'S PID, AND THE NAME NOW SAYS SO. `cmd /c start` is what
       gives the agent its own console, so the process we spawned is CMD -- and
       cmd exits the instant `start` has handed off. Measured on the box: a live
       agent's parent pid is already dead. This was called `pid`, and create.js's
       rollback duly called `process.kill()` on it, which killed nothing (or, once
       Windows reused the number, something else) and left the agent running.
       THE AGENT'S REAL PID COMES FROM `claude agents --json`, joined through the
       session id -- see engine/win32live. Kept and renamed rather than dropped,
       because a launcher pid is still the honest answer to "what did we spawn". */
    launcherPid: child && child.pid ? child.pid : null,
    /* Surfaced, not swallowed: a session with no token still runs and still shows
       on the board, but it cannot self-report needs_you or blocked. */
    tokenBecause: prepared.tokenBecause || null,
  };
}

module.exports = { launch, childEnv, argvFor, INHERITED_MARKERS, setSpawn };
