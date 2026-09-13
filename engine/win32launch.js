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
const fs = require('node:fs');
const path = require('node:path');

const win32create = require('./win32create');
const trust = require('./trust');
const { accountEnvVar } = require('./win32argv');

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

/* The zip's agent command lives here, beside `app\` and `runtime\`
   (tools/build-kosmos-windows.sh stages it). The CLI itself is the marker: the
   shims beside it (kosmos.ps1, kosmos) are per shell, the CLI is always there. */
const AGENT_CLI_DIR = 'bin';
const AGENT_CLI_SHIM = 'kosmos-cli.js';

/**
 * The folder holding the Windows zip's `kosmos` command, or null.
 * This file runs from `<zip>\app\engine`, so the zip root is two up. A source
 * checkout has no such folder and gets null: it teaches the same bare word and
 * has nothing to put on PATH. `root` and `exists` are seams for a test.
 */
function agentCliDir(root, exists) {
  const r = root || path.resolve(__dirname, '..', '..');
  const has = exists || ((f) => fs.existsSync(f));
  const dir = path.join(r, AGENT_CLI_DIR);
  return has(path.join(dir, AGENT_CLI_SHIM)) ? dir : null;
}

/**
 * The environment the agent starts with: ours, minus the markers that would make
 * it a child, plus its own token.
 *
 * 🔑 A PURE FUNCTION OVER AN ENV OBJECT, so the stripping is assertable from a
 * Mac without spawning anything.
 */
function childEnv(baseEnv, token, configDir, cliDir, runner) {
  const env = Object.assign({}, baseEnv || {});
  for (const k of INHERITED_MARKERS) delete env[k];
  /* #570: the agent's `kosmos` command. Every instruction and every message the
     board delivers teaches a bare `kosmos reply` / `kosmos msg` / `kosmos post`,
     and the Windows zip's command lives in its own `bin` folder, so that folder
     goes FIRST on the agent's PATH (see agentCliDir).
     ⚠️ ONE PATH KEY, WHATEVER ITS CASE. Windows env names are case-insensitive but
     a copied env object is not: `process.env` copies as `Path`, and adding `PATH`
     beside it gives the child two, of which Windows keeps one unpredictably. */
  if (cliDir) {
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    env[pathKey] = env[pathKey] ? String(cliDir) + path.win32.delimiter + env[pathKey] : String(cliDir);
  }
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
  /* 🔑 A CODEX AGENT'S ACCOUNT IS ITS CODEX_HOME (round 1 BUG). A Mac job writes the
     account directory under the runner's own variable (win32argv.accountEnvVar,
     the key create.plistFor uses). Here only CLAUDE_CONFIG_DIR was ever set, so a
     codex agent moved to a named OpenAI home was told "runs on X now" and kept
     reading ~/.codex.
     ⚠️ ONLY FOR A NAMED HOME. A default-home codex agent gets no CODEX_HOME
     written, so it keeps inheriting exactly what it did before. The
     CLAUDE_CONFIG_DIR handling above is unchanged for every runner. */
  const accountKey = accountEnvVar(runner);
  if (accountKey !== 'CLAUDE_CONFIG_DIR' && configDir) env[accountKey] = String(configDir);
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
/* The autonomy flag, per runner. The Mac states the rule and this platform needs
   it MORE, not less -- see AUTONOMY below. codex's spelling of claude's
   --dangerously-skip-permissions is --dangerously-bypass-approvals-and-sandbox,
   the same pairing bin/agent-supervisor.sh uses. */
const AUTONOMY = Object.freeze({
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
});

function argvFor(prepared, opts) {
  const o = opts || {};
  const argv = [];
  /**
   * 🛑 AUTONOMY IS NOT OPTIONAL FOR AN UNATTENDED AGENT, and this platform had
   * been launching without it. `bin/agent-supervisor.sh` says it outright:
   *
   *     "--dangerously-skip-permissions is not optional for an unattended agent.
   *      Without it the agent starts, looks healthy, and freezes forever on its
   *      first permission prompt with nobody there to answer it."
   *
   * The Mac at least has a tmux pane a person can attach to and answer. Windows
   * runs the agent in a console created HIDDEN, so there is no screen the prompt
   * could appear on -- the agent would sit at it forever while `claude agents
   * --json` reports `idle` and the board draws a healthy row.
   *
   * ⚠️ THIS IS THE TRUST-DIALOG DEFECT AGAIN, one prompt over. This module's own
   * header describes the same shape and calls it out: a hidden console cannot show
   * anybody a question, so "an agent that cannot be seen waiting is worse than an
   * agent that never started". Trust was fixed by pre-accepting it; permissions
   * were missed, because until delivery lands (7c) no Windows agent had ever been
   * asked to DO anything -- the rehearsal made agents and they sat idle, so
   * nothing ever reached a prompt.
   *
   * 📌 The runner picks the spelling. An unknown runner gets NO flag rather than a
   * guessed one: a wrong flag is a refused launch, which is loud, and inventing
   * autonomy for a runner we do not know is the one direction that must not be
   * guessed.
   */
  const autonomy = AUTONOMY[String(o.runner || prepared.runner || 'claude')];
  if (autonomy) argv.push(autonomy);
  if (o.model) argv.push('--model', String(o.model));
  return argv.concat(prepared.launchArgs);
}

/**
 * The program to spawn: the resolved path when we have one and it is still there,
 * the bare name when we do not.
 *
 * 🛑 A DURABLE TASK OUTLIVES A RESOLVED PATH (7c-2). `create.js` resolves the
 * runner once, at create time, and that absolute path now rides into a Scheduled
 * Task that will still be firing months later -- across a Claude Code update, a
 * reinstall, or a person moving where they keep it. A stranded path spawns ENOENT
 * forever, and the symptom is a supervisor that throttle-loops in a task log
 * nobody is reading.
 *
 * 🔑 SO THE PATH IS A HINT, NOT A CONTRACT, and the bare name is the fallback --
 * which is what PATH is for and what the shipped installer arranges (it lands
 * `claude.exe` under `%USERPROFILE%\.local\bin`, on PATH). Both directions are
 * covered: the hint beats a PATH that does not carry the folder, and PATH beats a
 * hint that has gone stale. Neither alone was enough.
 *
 * 📌 THE RUNNER PICKS THE FALLBACK SPELLING. `claudeBin` is the parameter's name
 * for historical reasons but its VALUE is whichever runner this agent uses, so
 * falling back to `claude` for a codex agent would spawn the wrong program on the
 * one path where the hint is gone.
 */
function binFor(s) {
  const bare = String((s && s.runner) === 'codex' ? 'codex' : 'claude');
  const given = s && s.claudeBin;
  if (!given) return bare;
  /* Only a path can go stale; a bare name handed in is already the PATH lookup. */
  if (!path.isAbsolute(String(given))) return String(given);
  try { if (fs.existsSync(String(given))) return String(given); } catch { /* treat as gone */ }
  return bare;
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
  const bin = binFor(s);
  let child;
  try {
    child = spawner()('cmd.exe', ['/c', 'start', '', '/min', bin].concat(argv), {
      cwd: s.cwd,
      env: childEnv(process.env, prepared.token, s.configDir, agentCliDir(), s.runner),
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

/* ── the streaming launch (7c) ──────────────────────────────────────────────
 *
 * 🛑 WHY A SECOND LAUNCH SHAPE, AND WHY IT IS NOT A REPLACEMENT YET. `launch()`
 * above starts a DETACHED agent through `cmd /c start`, deliberately, so the
 * agent outlives whatever started it. That is the right shape for everything
 * #570 built -- and it is exactly why a Windows agent cannot be TOLD anything:
 * `stdio: 'ignore'` means nobody holds its stdin, and this platform has no tmux
 * pane to type into instead.
 *
 * 🔑 A STREAMING SESSION IS THE DOCUMENTED WAY IN, and it was measured before it
 * was designed against (see .claude/plans/WINDOWS-ROADMAP.md §3):
 *
 *      claude -p --input-format stream-json --output-format stream-json
 *
 *   - it does NOT run one turn and exit; it stays open and answers messages as
 *     they arrive on stdin, one JSON line each
 *   - it is STILL listed by `claude agents --json` as kind:"interactive", with a
 *     pid and a session id -- so win32roster, win32live, win32stop and win32job
 *     all keep working on it unchanged
 *   - and it RESUMES: a new process given `--resume <id>` continues the same
 *     conversation under the SAME session id
 *
 * ⚠️ THE TRADE IS OWNERSHIP, AND IT IS NOT FREE. Holding stdin means the agent is
 * OUR CHILD: if the holder dies, the child's stdin closes and the agent exits.
 * The detached launch survived its starter; this one does not. That is acceptable
 * only because the holder is the SUPERVISOR, whose entire job is to outlive the
 * agent and restart it -- and because a restart is now `--resume`, so the
 * conversation is re-opened rather than replaced. Adopt-not-replace becomes
 * resume-not-replace: a supervisor cannot adopt a pipe somebody else holds, but
 * it can re-open the same session id, which every other module already keys on.
 *
 * 📌 WIRED through `win32supervisor.superviseStreaming`, which every agent's task
 * runs; `launch()` remains only for the older detached `supervise()` loop.
 */

/** One message, in the shape `--input-format stream-json` reads. */
function messageLine(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: String(text) }] },
  }) + '\n';
}

/**
 * The argv for a streaming agent.
 *
 * 🔑 `--resume` AND `--session-id` ARE MUTUALLY EXCLUSIVE, and which one is used
 * says whether this is a birth or a return. A fresh agent pins the id win32create
 * minted (`prepared.launchArgs`, spliced verbatim -- the one-mint-point rule). A
 * returning one names the id it already has, and Claude Code answers with the
 * same id rather than a new one (measured), which is what keeps the ownership
 * record, the roster join and the stop path pointing at the same agent.
 */
function streamArgvFor(prepared, opts) {
  const o = opts || {};
  const argv = argvFor({ launchArgs: [] }, o);   // autonomy + model, no id yet
  argv.push('-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose');
  if (o.resumeSessionId) argv.push('--resume', String(o.resumeSessionId));
  else argv.push(...prepared.launchArgs);
  return argv;
}

/**
 * Start a streaming agent and KEEP its pipes.
 *
 * Returns { ok:true, name, sessionId, child, instance } -- `child` is a live
 * ChildProcess whose stdin takes `messageLine()` and whose stdout emits
 * newline-delimited events, and `instance` names this run's credential so the
 * caller can retire it when the run ends. Or { ok:false, because }; never throws.
 *
 * ⚠️ ON RESUME NO RECORD IS WRITTEN, BUT A TOKEN IS MINTED. `prepareSession` writes
 * the ownership record; a resume already has one, so re-preparing would file a
 * SECOND record for one agent -- the duplicate-name hazard win32live documents.
 * The credential is different: it belongs to a RUN, not to the session, and a
 * resume that carried none was measured having every self-report refused. So a
 * resume mints its own (`win32create.mintForRun`), the way the Mac mints one on
 * every launch.
 */
function launchStreaming(spec) {
  const s = spec || {};
  const plat = s.platform || process.platform;
  if (plat !== 'win32') return { ok: false, because: 'this launcher is for Windows; the Mac path is launchd' };
  if (!s.cwd || !path.isAbsolute(String(s.cwd))) return { ok: false, because: 'an agent needs an absolute folder to run in' };

  /* Trust first, and it gates -- the same rule and the same reason as `launch()`:
     an untrusted spawn sits on a dialog nobody can see. A resume needs it too; the
     folder's trust can have been revoked while the agent was down. */
  let trusted;
  try { trusted = trust.trustFolder(s.cwd, { configDir: s.configDir || null, createIfAbsent: true, agentDefaultAccount: !s.configDir }); }
  catch (e) { trusted = { ok: false, because: 'we could not write the trust entry (' + ((e && e.code) || 'unknown') + ')' }; }
  if (!trusted.ok) return { ok: false, because: 'we did not start it, because we could not vouch for its folder first: ' + trusted.because };

  let prepared;
  if (s.resumeSessionId) {
    prepared = {
      ok: true, name: s.name, sessionId: String(s.resumeSessionId), launchArgs: [],
      ...win32create.mintForRun(s.name),
    };
  } else {
    prepared = win32create.prepareSession({ name: s.name, runner: s.runner });
    if (!prepared.ok) return { ok: false, because: prepared.because };
  }

  const argv = streamArgvFor(prepared, s);
  const bin = binFor(s);
  let child;
  try {
    child = spawner()(bin, argv, {
      cwd: s.cwd,
      env: childEnv(process.env, prepared.token, s.configDir, agentCliDir(), s.runner),
      windowsHide: true,
      /* 🔑 PIPES, AND THIS IS THE WHOLE POINT. `launch()` passes 'ignore' so the
         agent is nobody's child; here stdin is the delivery channel and stdout is
         the event stream that replaces the Mac's pane scrape. NOT detached: a
         detached child with pipes is a child whose pipes nobody is holding. */
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    /* A fresh start undoes its record AND its token. A resume keeps the record (it
       is the agent's, not this run's) and retires only the token it just minted. */
    let tokenNote = '';
    if (!s.resumeSessionId) { try { win32create.abandon(prepared); } catch { /* best effort */ } }
    else {
      const retired = win32create.retireRun(prepared.name, prepared.instance);   // never throws
      if (!retired.ok) tokenNote = '; ' + retired.because;
    }
    return { ok: false, because: 'we could not start it (' + ((e && e.code) || 'unknown') + ')' + tokenNote };
  }

  return {
    ok: true,
    name: prepared.name,
    sessionId: prepared.sessionId,
    resumed: Boolean(s.resumeSessionId),
    child,
    instance: prepared.instance || null,
    tokenBecause: prepared.tokenBecause || null,
  };
}

module.exports = {
  launch, launchStreaming, messageLine, streamArgvFor,
  childEnv, agentCliDir, argvFor, AUTONOMY, INHERITED_MARKERS, setSpawn,
};
