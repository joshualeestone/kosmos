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
 * command line (the Mac's `send-keys` does put it on tmux's) and never in a result
 * this module returns. What a program ECHOES back is redacted as `redactSentPieces`
 * and `createTextKeeper` describe, with the limits they state. Captured output lives
 * in memory only, is never logged, and has `sk-ant-…` tokens redacted before the
 * 64 KB cap.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
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

/**
 * The shortest piece of a sent code that is redacted on its own. A code is
 * `<code>#<state>` and each half is a long random string, so either half appearing
 * in the output is the code leaking. Eight characters keeps a stray short fragment
 * (a code with a two-letter half, say) from blanking ordinary words all over the
 * screen, while every half a real OAuth code has is far longer.
 */
const SENT_FRAGMENT_MIN_CHARS = 8;

/**
 * The shortest partial of a sent piece masked where text was CUT: the start of the
 * kept text (the 64 KB cap, or a long line committed early) and the end of a line
 * still arriving. Four random characters reveal next to nothing about a code of dozens;
 * masking shorter edges would keep blanking ordinary text that happens to match.
 */
const SENT_PARTIAL_MIN_CHARS = 4;

/**
 * Every redaction this module writes contains this, so a reader of captured text
 * (connect.js's URL extraction) can tell a value that was redacted from one that
 * was not.
 */
const REDACTION_MARKER = '[redacted';
const SENT_REPLACEMENT = '[redacted code]';

/**
 * What `auth login` writes to stderr when a pasted line is not `<code>#<state>`
 * (read from the binary: `process.stderr.write("Invalid code…")`). After a send it is
 * the one signal that the code was refused and the prompt is waiting again.
 */
const INVALID_CODE_PATTERN = /Invalid code/i;

/**
 * Script launchers a directly started program cannot be. Without a shell, Windows
 * starts only program files: a `claude.cmd` fails with EINVAL, a `.ps1` with EFTYPE,
 * and an extensionless path whose only sibling is a script fails with ENOENT.
 */
const SCRIPT_EXTENSIONS = Object.freeze(['.cmd', '.bat', '.ps1']);
const SCRIPT_START_ERRORS = Object.freeze(['ENOENT', 'EINVAL', 'EFTYPE']);
const PROGRAM_EXTENSION = '.exe';

const SCRIPT_ONLY_BECAUSE = 'Kosmos can only start the Claude Code program file (claude.exe), '
  + 'and this computer has a script version it cannot start directly';

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
 * The strings a sent code could leak as: the whole code, and each `#` half of at
 * least SENT_FRAGMENT_MIN_CHARS. Longest first, so the whole code is replaced before
 * its halves are looked for.
 */
function sentFragmentsOf(code) {
  const whole = String(code || '');
  const pieces = [whole, ...whole.split('#')].filter((p) => p.length >= SENT_FRAGMENT_MIN_CHARS);
  return [...new Set(pieces)].sort((a, b) => b.length - a.length);
}

/** Every whole occurrence of a sent piece, replaced. */
function redactSentPieces(text, pieces) {
  let out = String(text || '');
  for (const piece of pieces) out = out.split(piece).join(SENT_REPLACEMENT);
  return out;
}

/** A suffix of a sent piece (SENT_PARTIAL_MIN_CHARS or longer) at the very start, masked. */
function maskLeadingSentPartial(text, pieces) {
  let out = String(text || '');
  for (const piece of pieces) {
    for (let len = piece.length - 1; len >= SENT_PARTIAL_MIN_CHARS; len--) {
      if (out.startsWith(piece.slice(piece.length - len))) { out = SENT_REPLACEMENT + out.slice(len); break; }
    }
  }
  return out;
}

/** A prefix of a sent piece (SENT_PARTIAL_MIN_CHARS or longer) at the very end, masked. */
function maskTrailingSentPartial(text, pieces) {
  let out = String(text || '');
  for (const piece of pieces) {
    for (let len = piece.length - 1; len >= SENT_PARTIAL_MIN_CHARS; len--) {
      if (out.endsWith(piece.slice(0, len))) { out = out.slice(0, out.length - len) + SENT_REPLACEMENT; break; }
    }
  }
  return out;
}

/* A segment of text about to be kept or shown: whole pieces, and a partial at either
   cut edge. */
function maskSentPieces(text, pieces) {
  if (!pieces.length) return text;
  return maskTrailingSentPartial(maskLeadingSentPartial(redactSentPieces(text, pieces), pieces), pieces);
}

/**
 * An accumulating screen, like a tmux pane that never scrolls away.
 *
 * ⚠️ NORMALISED A WHOLE LINE AT A TIME. A chunk boundary can fall inside an escape
 * sequence, between a CR and its LF, or inside a token. Committed text is always cut
 * at a newline, and the unfinished last line is normalised afresh on every read, so
 * none of those is ever processed in halves.
 *
 * 🔑 WHAT IS REDACTED, AND WHERE. `sk-ant-` tokens, and the pieces `sentPieces()`
 * returns when the text is committed or read, are replaced BEFORE the cap, so the cap
 * cuts through a redaction marker, never through a secret. Where text was cut (the
 * start of the kept text after the cap or an early commit, the end of the line still
 * arriving) a partial sent piece of SENT_PARTIAL_MIN_CHARS or more is masked too.
 * ⚠️ NOT GUARANTEED: a partial shorter than that at a cut edge, and a piece echoed in
 * text committed BEFORE the code was sent (the host's capture covers that case for
 * whole pieces).
 *
 * 🛑 A LINE THAT OUTGROWS THE LIMIT is committed at its last non-token character, so
 * no `sk-ant-` token is split; if it has none, it is dropped whole. Failing closed on
 * text the redactor cannot delimit is the Sensitive values convention.
 */
function createTextKeeper(limit, sentPieces) {
  const piecesNow = typeof sentPieces === 'function' ? sentPieces : () => [];
  let kept = '';
  let partial = '';
  const protectSegment = (text) => maskSentPieces(text, piecesNow());
  const protectHead = (text) => maskLeadingSentPartial(text, piecesNow());
  const commit = (raw) => { kept = protectHead(keepNewest(kept + protectSegment(normaliseSignInText(raw)), limit)); };
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
      return protectHead(keepNewest(kept + protectSegment(normaliseSignInText(partial)), limit));
    },
  };
}

/**
 * The file to start for a resolved Claude path. The resolver names the vendor's
 * extensionless `~\.local\bin\claude`; on Windows the program on disk is
 * `claude.exe`, so that is named outright rather than left to the loader's search.
 */
function programFileFor(bin) {
  const given = String(bin || 'claude');
  if (path.win32.extname(given)) return given;
  try { if (fs.existsSync(given + PROGRAM_EXTENSION)) return given + PROGRAM_EXTENSION; } catch { /* fall through to the name as given */ }
  return given;
}

/** Is the file we tried a script, or the only thing at its path a script? */
function onlyAScriptIsThere(bin) {
  const ext = path.win32.extname(String(bin)).toLowerCase();
  if (ext) return SCRIPT_EXTENSIONS.includes(ext);
  return SCRIPT_EXTENSIONS.some((e) => { try { return fs.existsSync(String(bin) + e); } catch { return false; } });
}

/* The spawn seam. Tests replace it; nothing else does. The same shape as
   `win32launch.setSpawn`. */
let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }

function startFailure(error, bin) {
  const code = (error && error.code) || 'unknown error';
  let because = 'Kosmos could not start the Claude sign-in on this computer';
  /* ENOENT beside a script, and EINVAL or EFTYPE on one, are one situation: Claude Code
     is installed, as something this host cannot start without a shell. Saying "could
     not find Claude Code" there would contradict the stuck card's own offer to run it.
     A broken `.exe` also fails EFTYPE, and is not a script, so it keeps the general
     sentence. */
  if (SCRIPT_START_ERRORS.includes(code) && onlyAScriptIsThere(bin)) because = SCRIPT_ONLY_BECAUSE;
  else if (code === 'ENOENT') because = 'Kosmos could not find Claude Code to run its sign-in';
  return {
    ok: false,
    stdout: '',
    /* The code only, never the message: a spawn error message repeats the command
       line and the environment is not ours to echo. */
    stderr: redactSecrets('claude auth login did not start (' + code + ')'),
    because,
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
    const bin = programFileFor(spec.claudeBin);
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
      screen: null,
      stderr: null,
      /* Set by sendCode: the screen since the last code went in, and whether the
         program's answer to it is still pending (see capture). */
      sinceSend: null,
      stderrSinceSend: null,
      awaitingVerdict: false,
      sentFragments: [],
      closed: false,
      exitCode: null,
      signal: null,
      drained: false,
      killed: false,
    };
    const sentPieces = () => session.sentFragments;
    session.screen = createTextKeeper(SIGNIN_OUTPUT_LIMIT_CHARS, sentPieces);
    session.stderr = createTextKeeper(SIGNIN_OUTPUT_LIMIT_CHARS, sentPieces);
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
      return startFailure(e, bin);
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
        if (session.sinceSend) session.sinceSend.push(d);
        if (!isStderr) return;
        session.stderr.push(d);
        if (session.stderrSinceSend) {
          session.stderrSinceSend.push(d);
          if (session.awaitingVerdict && INVALID_CODE_PATTERN.test(session.stderrSinceSend.text())) {
            session.awaitingVerdict = false;
          }
        }
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
      return startFailure(error, bin);
    }
    if (current !== session) {
      return { ok: false, stdout: '', stderr: 'the sign-in was stopped before it started' };
    }
    return { ok: true, stdout: '', stderr: '' };
  }

  /**
   * 🛑 AFTER A CODE GOES IN, THE SCREEN SHOWS ONLY WHAT CAME SINCE, until the program
   * refuses the code. A tmux pane redraws: once Claude takes a pasted code the prompt
   * leaves the screen. This kept text never loses anything, so without this the
   * prompt stayed visible through the whole token exchange, and connect.js's rule
   * "the prompt is still up 6 s after a code was typed, so the code was rejected"
   * told the person a VALID code did not work whenever Anthropic took longer than
   * that, and invited a second paste into a program still handling the first.
   * So a send hides everything before it; an `Invalid code` line arriving after the
   * send brings the whole screen back, prompt included, which is exactly the
   * rejection the driver's rule exists to see. While hidden, an empty screen reads as
   * blank and gets the driver's blank grace; an exit still drains and fails as below.
   */
  function visibleScreen(session) {
    return session.awaitingVerdict ? session.sinceSend.text() : session.screen.text();
  }

  async function capture() {
    const session = current;
    if (!session) return { ok: false, stdout: '', stderr: 'the sign-in is not running' };
    /* The keepers already redacted what arrived after each send, before the cap. This
       second pass covers whole pieces in text kept BEFORE the code was sent. */
    const redact = (text) => redactSentPieces(text, session.sentFragments);
    /* The FIRST read after the program ends still returns its final screen, so a
       "Login successful." printed just before exiting is seen (it sets
       connect.js's sawLoginDone). Every later read fails, which is how a closed
       tmux pane looks to the driver, and its #1922 rescue takes it from there. */
    if (!session.closed || !session.drained) {
      if (session.closed) session.drained = true;
      return { ok: true, stdout: redact(visibleScreen(session)), stderr: '' };
    }
    const lines = redact(session.stderr.text()).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
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
    /* Remembered BEFORE the write, so an echo racing the write is redacted too. */
    for (const fragment of sentFragmentsOf(code)) {
      if (!session.sentFragments.includes(fragment)) session.sentFragments.push(fragment);
    }
    session.sentFragments.sort((a, b) => b.length - a.length);
    const sentPieces = () => session.sentFragments;
    session.sinceSend = createTextKeeper(SIGNIN_OUTPUT_LIMIT_CHARS, sentPieces);
    session.stderrSinceSend = createTextKeeper(SIGNIN_OUTPUT_LIMIT_CHARS, sentPieces);
    session.awaitingVerdict = true;
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
  SIGNIN_ARGS, SIGNIN_OUTPUT_LIMIT_CHARS, STDERR_TAIL_LINES, SENT_FRAGMENT_MIN_CHARS,
  REDACTION_MARKER,
  normaliseSignInText, redactSecrets, createTextKeeper,
};
