'use strict';
/**
 * The Claude sign-in on Windows: `claude auth login --claudeai` over plain pipes.
 *
 * 🛑 WHY THIS EXISTS. On the Mac, `engine/connect.js` runs the sign-in inside a tmux
 * session and reads the screen with `capture-pane`. Windows has no tmux, so that
 * launch dies with ENOENT. This module is the Windows `signinHost`: the same five
 * operations connect.js's driver asks of tmux (open, capture, sendCode, sendEnter,
 * kill), done with a child process whose pipes we hold.
 *
 * 🔑 WHY PIPES ARE ENOUGH, MEASURED FROM THE BINARY, NOT A LIVE RUN. The Windows
 * `claude.exe` 2.1.270 carries two sign-in programs. Bare `claude` and `/login` are
 * a full-screen Ink UI that needs raw mode and throws on a pipe. `claude auth login`
 * is plain text: it prints "Opening browser to sign in…", then
 * "Paste code here if prompted > ", reads the pasted code with
 * `readline.createInterface({input: process.stdin})`, prints "Login successful." and
 * exits 0, or writes "Login failed: …" to stderr and exits 1. Those texts are what
 * connect.js's `classifyPane` already recognises. (Design:
 * `kosmos-scripts/win32-claude-signin-design.md`, option (e).) ⚠️ The live half is
 * slice 3's L-1; until it passes, connect.js keeps this host switched off
 * (`WINDOWS_SIGNIN_HOST_ENABLED`).
 *
 * 📌 SENSITIVE VALUES. The pasted code goes to stdin and nowhere else: never on a
 * command line (the Mac's `send-keys` does put it on tmux's), never in any text this
 * module returns. Captured output lives in memory only, is never logged, and has
 * `sk-ant-…` tokens redacted before anything can read it.
 */

const { spawn } = require('node:child_process');
const liveExecution = require('./live-execution');

/**
 * The arguments, always. On Windows the sign-in is `auth login` whatever
 * connect.js's `needsLogin` says, because the other program (bare `claude`) needs a
 * console this host does not have. `--claudeai` picks the subscription login and
 * skips the method chooser, the same choice the Mac makes for a needsLogin flow.
 */
const SIGNIN_ARGS = Object.freeze(['auth', 'login', '--claudeai']);

/**
 * How much of the sign-in's output is kept, in characters; the oldest text goes
 * first. `auth login` prints a few hundred characters on a normal run (a browser
 * line, the prompt, a result, perhaps a URL), so 64 KB keeps any real run whole
 * with two orders of magnitude to spare, while a CLI stuck printing in a loop
 * cannot grow the board's memory without bound.
 */
const SIGNIN_OUTPUT_LIMIT_CHARS = 64 * 1024;

/**
 * How many stderr lines a dead sign-in reports. Twelve is what connect.js's
 * `tailOf` shows on the stuck card, so the host hands over no more than the card
 * can use.
 */
const STDERR_TAIL_LINES = 12;

/**
 * How long after the program EXITS we wait for its pipes to close before treating
 * it as finished anyway. Normally 'close' follows 'exit' at once. ⚠️ But a process
 * `auth login` starts to open the browser can inherit the pipe handles and hold
 * them open for as long as the browser runs, and then 'close' would never come
 * while the driver waits on a login that already ended. One second is far longer
 * than a real flush and far shorter than the driver's 3 second capture-failure
 * bound. Whether this happens at all is an L-1 measurement.
 */
const EXIT_PIPE_GRACE_MS = 1000;

/** Anthropic credentials (API keys and OAuth tokens) all start this way. */
const SECRET_PATTERN = /sk-ant-[\w-]+/g;
const SECRET_REPLACEMENT = 'sk-ant-[redacted]';

/* Terminal escape sequences: CSI (colours, cursor moves), OSC (titles, hyperlinks,
   ended by BEL or ST, or by the end of the text when it is still arriving), a CSI
   cut off at the end of the text, and the two-byte escapes. */
const TERMINAL_ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)|\x1b\[[0-?]*[ -/]*$|\x1b[@-Z\\-_]?/g;
/* Control characters left once escapes are gone; newline and tab stay. */
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f]/g;
/* A character that can never be part of a token, so cutting after it never splits one. */
const NON_TOKEN_CHARACTER = /[^\w-]/g;

function redactSecrets(text) {
  return String(text || '').replace(SECRET_PATTERN, SECRET_REPLACEMENT);
}

/**
 * Screen text from raw program output: escapes stripped, CRLF and a lone CR each
 * turned into LF (a CR alone is a redraw of the same line, which a pane would show
 * as the newer text; keeping both as lines is safe because `classifyPane` reads the
 * furthest state), other control characters dropped, secrets redacted.
 */
function normaliseSignInText(raw) {
  return redactSecrets(String(raw || '')
    .replace(TERMINAL_ESCAPES, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHARACTERS, ''));
}

function keepNewest(text, limit) {
  return text.length > limit ? text.slice(text.length - limit) : text;
}

/**
 * An accumulating screen, like a tmux pane that never scrolls away.
 *
 * ⚠️ NORMALISED A WHOLE LINE AT A TIME. A chunk boundary can fall inside an escape
 * sequence, between a CR and its LF, or inside a token. Committed text is always cut
 * at a newline, and the unfinished last line is normalised afresh on every read, so
 * none of those is ever processed in halves. Redaction runs BEFORE the cap, so the
 * cap can never cut a token and leave its tail readable.
 *
 * 🛑 A LINE THAT OUTGROWS THE LIMIT is committed at its last non-token character, so
 * no token is split; if it has none, it is dropped whole. Failing closed on text the
 * redactor cannot delimit is the Sensitive values convention.
 */
function createTextKeeper(limit) {
  let kept = '';
  let partial = '';
  const commit = (raw) => { kept = keepNewest(kept + normaliseSignInText(raw), limit); };
  return {
    push(chunk) {
      const raw = partial + String(chunk);
      const lastNewline = raw.lastIndexOf('\n');
      if (lastNewline >= 0) {
        commit(raw.slice(0, lastNewline + 1));
        partial = raw.slice(lastNewline + 1);
      } else {
        partial = raw;
      }
      if (partial.length > limit) {
        let cut = -1;
        for (const m of partial.matchAll(NON_TOKEN_CHARACTER)) cut = m.index;
        if (cut >= 0) {
          commit(partial.slice(0, cut + 1));
          partial = partial.slice(cut + 1);
        }
        if (partial.length > limit) {
          kept = keepNewest(kept + '[output too long to read was dropped]\n', limit);
          partial = '';
        }
      }
    },
    text() {
      return keepNewest(kept + normaliseSignInText(partial), limit);
    },
  };
}

/* The spawn seam. Tests replace it; nothing else does. The same shape as
   `win32launch.setSpawn`. */
let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }

function startFailure(error) {
  const code = (error && error.code) || 'unknown error';
  return {
    ok: false,
    stdout: '',
    /* The code only, never the message: a spawn error message repeats the command
       line and the environment is not ours to echo. */
    stderr: redactSecrets('claude auth login did not start (' + code + ')'),
    because: code === 'ENOENT'
      ? 'Kosmos could not find Claude Code to run its sign-in'
      : 'Kosmos could not start the Claude sign-in on this computer',
  };
}

/**
 * One sign-in host. connect.js makes one and keeps it; each `open` replaces the
 * program the previous one started.
 */
function createSigninHost() {
  let current = null;

  async function kill() {
    const session = current;
    current = null;
    if (!session || session.killed) return;
    session.killed = true;
    /* Stdin first: `auth login` is a readline loop, and a closed input is the polite
       way to end it. The kill is what guarantees it. */
    try { if (session.child.stdin && !session.child.stdin.destroyed) session.child.stdin.end(); } catch { /* already gone */ }
    try { session.child.kill(); } catch { /* already exited */ }
  }

  async function open(launch) {
    await kill();
    const spec = launch || {};
    const bin = String(spec.claudeBin || 'claude');
    /* Convention 3: a real program starts only in a process that armed live
       execution (server.js's real start) or under a test's spawn seam. In a test
       process with neither, refuseOrWarn throws, surfacing the missing seam. */
    if (!spawnFn && !liveExecution.liveExecutionAllowed()) {
      liveExecution.refuseOrWarn('win32signin', bin, SIGNIN_ARGS);
      return {
        ok: false,
        stdout: '',
        stderr: 'this board has not been allowed to run programs, so the sign-in was not started',
        because: 'Kosmos could not start the Claude sign-in on this computer',
      };
    }
    /* childEnv strips the markers that would make this a child session, deletes
       KOSMOS_AGENT_TOKEN, and sets CLAUDE_CONFIG_DIR to the account's folder or
       DELETES it for the default account (#1922: absent is not unset). Required here,
       not at the top: win32launch pulls in modules that fix data roots at require time. */
    const env = require('./win32launch').childEnv(process.env, null, spec.launchDir || null, null);
    const session = {
      child: null,
      screen: createTextKeeper(SIGNIN_OUTPUT_LIMIT_CHARS),
      stderr: createTextKeeper(SIGNIN_OUTPUT_LIMIT_CHARS),
      closed: false,
      exitCode: null,
      signal: null,
      drained: false,
      killed: false,
    };
    let child;
    try {
      /* No shell and no `cmd /c`: the program is started directly, so nothing is
         parsed by a command interpreter. windowsHide keeps a console from flashing. */
      child = (spawnFn || spawn)(bin, SIGNIN_ARGS.slice(), {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return startFailure(e);
    }
    session.child = child;
    current = session;

    let resolveStart;
    const started = new Promise((resolve) => { resolveStart = resolve; });
    child.once('spawn', () => resolveStart(null));
    /* Persistent, not once: an 'error' with no listener throws, and a kill can emit
       one after the start was settled. */
    child.on('error', (e) => resolveStart(e));

    for (const [stream, isStderr] of [[child.stdout, false], [child.stderr, true]]) {
      if (!stream || typeof stream.on !== 'function') continue;
      if (typeof stream.setEncoding === 'function') stream.setEncoding('utf8');
      stream.on('data', (d) => {
        session.screen.push(d);
        if (isStderr) session.stderr.push(d);
      });
      stream.on('error', () => { /* the exit handling below reports the ending */ });
    }
    if (child.stdin && typeof child.stdin.on === 'function') {
      /* A write racing the exit gets EPIPE; unhandled, that would take the board down. */
      child.stdin.on('error', () => { /* sendCode reports a failed write through its callback */ });
    }
    const markClosed = () => { session.closed = true; };
    child.on('exit', (code, signal) => {
      session.exitCode = code;
      session.signal = signal;
      const t = setTimeout(markClosed, EXIT_PIPE_GRACE_MS);
      if (t && typeof t.unref === 'function') t.unref();
    });
    child.on('close', (code, signal) => {
      if (session.exitCode === null) session.exitCode = code;
      if (session.signal === null) session.signal = signal;
      markClosed();
    });

    const error = await started;
    if (error) {
      if (current === session) current = null;
      return startFailure(error);
    }
    if (current !== session) {
      return { ok: false, stdout: '', stderr: 'the sign-in was stopped before it started' };
    }
    return { ok: true, stdout: '', stderr: '' };
  }

  async function capture() {
    const session = current;
    if (!session) return { ok: false, stdout: '', stderr: 'the sign-in is not running' };
    /* The FIRST read after the program ends still returns its final screen, so a
       "Login successful." printed just before exiting is seen (it sets
       connect.js's sawLoginDone). Every later read fails, which is how a closed
       tmux pane looks to the driver, and its #1922 rescue takes it from there. */
    if (!session.closed || !session.drained) {
      if (session.closed) session.drained = true;
      return { ok: true, stdout: session.screen.text(), stderr: '' };
    }
    const lines = session.stderr.text().split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
      .slice(-STDERR_TAIL_LINES);
    lines.push(session.exitCode !== null
      ? 'claude auth login exited with code ' + session.exitCode
      : 'claude auth login was stopped' + (session.signal ? ' (' + session.signal + ')' : ''));
    return { ok: false, stdout: '', stderr: lines.join('\n'), exitCode: session.exitCode };
  }

  async function sendCode(code) {
    const session = current;
    const stdin = session && session.child && session.child.stdin;
    if (!session || session.closed || !stdin || stdin.destroyed || stdin.writableEnded) {
      return { ok: false, stderr: 'the sign-in is no longer running, so the code had nowhere to go' };
    }
    /* The error CODE only on failure: the code itself must never ride back out. */
    return new Promise((resolve) => {
      try {
        stdin.write(String(code) + '\n', (err) => resolve(err
          ? { ok: false, stderr: 'the code could not be handed to the sign-in (' + (err.code || 'write failed') + ')' }
          : { ok: true, stderr: '' }));
      } catch (e) {
        resolve({ ok: false, stderr: 'the code could not be handed to the sign-in (' + ((e && e.code) || 'write failed') + ')' });
      }
    });
  }

  /* `auth login` has no screen that waits for Enter, and a bare newline would be read
     as an empty code ("Invalid code"), so there is nothing to send. */
  async function sendEnter() {
    return { ok: true, stderr: '' };
  }

  return { open, capture, sendCode, sendEnter, kill };
}

module.exports = {
  createSigninHost, setSpawn,
  SIGNIN_ARGS, SIGNIN_OUTPUT_LIMIT_CHARS, STDERR_TAIL_LINES,
  normaliseSignInText, redactSecrets, createTextKeeper,
};
