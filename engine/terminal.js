'use strict';

/**
 * #2129 companion -- open the agent's ACTUAL terminal window.
 *
 * The board reads an agent by CAPTURING its tmux pane; it never attaches. So a
 * person who wants to see the live session for themselves -- to answer a prompt
 * the board cannot, or just to watch -- has no way in from the app. This adds
 * one: given a live agent, open a Terminal.app window attached to its tmux
 * session.
 *
 * 🔑 IT ONLY ADDS A VIEWER. tmux allows many clients on one session, and the
 * board's reading is capture-based (not a client), so attaching a Terminal is
 * the first interactive client and changes nothing about the session's state --
 * this neither restarts the agent nor touches what it is doing. That is the
 * whole point beside the trust-and-restart fallback: one is a fix, this is a
 * window.
 *
 * ⚠️ IT NEEDS A GUI SESSION TO SUCCEED. `osascript`/Terminal.app can only open
 * a window where there is a window server -- the app machine a person is
 * actually looking at. On a headless board (a launchd context with no GUI) the
 * osascript call fails and this returns a refusal rather than throwing, which
 * is correct: the button exists for the person at the app, and saying "we could
 * not open a terminal" is the honest answer anywhere else.
 */

const create = require('./create');
const status = require('./status');
const { execFileSync } = require('node:child_process');

/* The osascript seam, mirroring create.setRunner / subscription.setRunner: a
   test intercepts the external call so it never opens a real window, while the
   resolution above it runs for real. setRunner(null) restores the real call. */
let RUNNER = null;
function setRunner(fn) { RUNNER = fn; }

function run(file, args) {
  if (RUNNER) return RUNNER(file, args);
  try {
    execFileSync(file, args, { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, because: String((err && err.message) || err) };
  }
}

/* A session name we are willing to hand to a shell. `paneRoster` only reports a
   Kosmos session as `isNamedOurs` when its name is `<NAME_RE>-discord`, so a
   real session is always safe -- but the value crosses into a shell command
   inside AppleScript, so it is validated HERE rather than trusted, the same
   posture every name-to-path step in this codebase takes. */
const SAFE_SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/* Single-quote a value for /bin/sh: wrap in '...' and turn each ' into '\''. */
function shellSingleQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

/* An AppleScript string literal: escape backslash first, then double-quote. */
function appleScriptString(s) { return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

/**
 * Open a Terminal.app window attached to a live agent's tmux session.
 * Returns {ok:true, session} or {ok:false, because} -- never throws.
 */
function openTerminal(name) {
  const clean = create.cleanName(name);

  let card;
  try { card = status.paneRoster().find((p) => p.sessionName === clean) || null; }
  catch {
    // paneRoster throws when tmux cannot be asked. Fail CLOSED and say so,
    // exactly as remove.js's sessionFor does: "cannot confirm" is not "open it".
    // `unavailable` marks this as an environment failure (a transient, not a
    // bad request) so the route can answer 503 rather than 400.
    return { ok: false, unavailable: true, because: `we could not check whether ${clean} is running right now, so we did not open a terminal. Try again in a moment.` };
  }

  if (!card || !card.session) {
    return {
      ok: false,
      because: `${clean} is not running, so there is no terminal to open. `
        + create.SELF_STARTS.charAt(0).toUpperCase() + create.SELF_STARTS.slice(1) + '.',
    };
  }
  if (card.isNamedOurs !== true) {
    // The same refusal remove.js gives: something wears the name but we cannot
    // confirm it is this agent, so we do not act on it.
    return { ok: false, because: `something is running under ${clean}'s name and we cannot confirm it is this agent, so we left it alone.` };
  }

  const session = card.session;
  if (!SAFE_SESSION.test(session)) {
    return { ok: false, because: `${clean}'s session has a name we will not hand to a terminal.` };
  }

  // The agent's OWN tmux binary (the recorded path is the working one), falling
  // back to a bare `tmux` on PATH only when the job is unreadable.
  const job = create.readJob(clean);
  const tmuxBin = (job && job.tmux) || 'tmux';

  // The command Terminal runs: attach a viewer to the running session. `exec`
  // so the window's shell becomes the tmux client and the window closes with
  // the session rather than dropping to a stray prompt.
  const shellCmd = `exec ${shellSingleQuote(tmuxBin)} attach -t ${shellSingleQuote(session)}`;
  const appleScript = 'tell application "Terminal"\n'
    + '  activate\n'
    + `  do script ${appleScriptString(shellCmd)}\n`
    + 'end tell';

  const r = run('osascript', ['-e', appleScript]);
  if (!r || r.ok === false) {
    // osascript failing is an environment condition -- most often a headless
    // board with no window server, or a transient AppleScript error -- not a
    // bad request. `unavailable` routes it to 503, not 400.
    return { ok: false, unavailable: true, because: `we could not open a terminal window (${(r && r.because) || 'unknown'}).` };
  }
  return { ok: true, session };
}

module.exports = {
  openTerminal,
  setRunner,
  /* Exported for a DIRECT adversarial test. `tmuxBin` reaches the shell with no
     allowlist -- only these two layers neutralize it -- and SAFE_SESSION catches
     a hostile session before the quoting ever sees it, so the quoting is
     otherwise only exercised on benign values. A unit test feeds quote-bearing
     input straight through these to prove the escaping, per that review. */
  shellSingleQuote,
  appleScriptString,
};
