'use strict';
/**
 * #3939 slice 3: sign Meta's Muse Code in WITHOUT a terminal the person has to operate.
 *
 * `muse login` is the OAuth device-code flow (Homer's Windows captures on card #3939, Muse Code 1.4.0):
 * it prints Meta's address and a code, then "Press Enter to open it in your browser:", and it only starts
 * waiting for the approval after Enter (an approval made before Enter was never picked up). Then
 * "Waiting for approval...", and one of: "Logged in." (done), "login succeeded but saving failed" (the
 * sign-in could not be stored), or "The login request expired before it was approved. Press r then Enter
 * to try again". It needs a terminal, so Kosmos runs it in a tmux session on its OWN socket (it never
 * appears among agents), in a folder Kosmos owns, reads the screen once a second, and shows the code in
 * its own panel (the #3952 boxes).
 *
 * What Kosmos never does here: override HOME or XDG (on a Mac, a moved HOME hid the login Keychain and
 * Muse raised a console dialog whose second button resets the keychain, 2026-09-26), read the Keychain,
 * or log the code. On a Mac the sign-in lands in Muse's own default store (the login Keychain).
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const musestatus = require('./musestatus');

/* Its own socket, named after this macOS account's home (the agysignin rule): Muse's sign-in is one
   per account. A test names its own (AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET), so it never meets a real one. */
function socket() {
  if (process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET) return process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET;
  return 'kosmos-muse-signin-' + crypto.createHash('sha256').update(String(require('node:os').homedir())).digest('hex').slice(0, 10);
}
const SESSION = 'muse-signin';
const TICK_MS = 1000;
const STUCK_MS = 15000;          // an unknown screen this long is named; a retry with no new code this long ends
const GIVE_UP_MS = 20 * 60000;   // a device code nobody approves ends by itself (Muse's own expire comes first)
const TMUX_CALL_MS = 5000;
const MAX_KEY_FAILURES = 5;
const PANE_COLS = 120;
const PANE_ROWS = 40;
const UNKNOWN = 'Muse Code is showing a step Kosmos does not recognise';
const EXPIRED = 'The code expired before it was approved';
const CLOSED = 'Muse Code\'s sign-in closed before it finished';
/* Final, not retryable (round 5): start again. A retry typed after one was given up can land on the late code. */
const NO_NEW_CODE = 'Muse Code did not send a new code, so start the sign-in again';
const GAVE_UP = 'The sign-in waited too long, so start it again';
const NO_EXPIRED = 'There is no expired code to replace';
const NOT_ON = 'Meta Muse is not turned on for this computer';
const NO_FOLDER = 'Kosmos could not make a folder for the sign-in';
const UNSAVED = 'Muse Code signed in but could not save the sign-in on this computer';
const NOT_RECORDED = 'Muse Code signed in, but Kosmos could not record it on this computer';
const NOT_WAITING = 'Muse Code did not start waiting for the approval';
const UNREACHABLE = 'Kosmos could not reach Muse Code\'s sign-in just now';
const NO_RETRY_SENT = 'Kosmos could not ask Muse Code for a new code';
/* A tmux failure that says nothing about whether the keys arrived (one rule, round 9). */
function deliveryUnknown(e) { return !!(e && (e.code === 'ETIMEDOUT' || e.signal)); }
/* An Enter that did not move Muse off the code screen this long is sent once more, then named (round 1). */
const RESEND_MS = 5000;
/* The line the session prints when muse has exited, so its last screen can still be read (round 1:
   `muse login` exits after "Logged in.", and the session going with it read as a failure). */
const EXITED = 'KOSMOS_MUSE_EXITED';   // underscores: a dashed caps word would look like a device code (round 8)
const NOT_MINE = 'That sign-in has ended or another one has started';
const COULD_NOT_START = 'Kosmos could not start Muse Code\'s sign-in just now';

/* The words each screen ends on. The screen that counts is the one whose words come LAST: an expired
   try's lines stay above the retry's. */
/* Two phrases the code finder cuts at too, so both read one spelling (round 3). */
const PRESS_WORDS = 'Press Enter to open it in your browser';
const EXPIRED_WORDS = 'expired before it was approved';
const SCREENS = Object.freeze({
  press: new RegExp(PRESS_WORDS),
  // Drawn between the Enter and "Waiting for approval" (Homer); a slow browser keeps it up (round 3).
  opening: /Opening your browser/,
  waiting: /Waiting for approval/,
  done: /Logged in\./,
  unsaved: /saving failed/,
  expired: new RegExp(EXPIRED_WORDS),
});
function screenOf(text) {
  let best = null; let at = -1;
  for (const [name, re] of Object.entries(SCREENS)) {
    const g = new RegExp(re.source, 'g');
    let m; while ((m = g.exec(String(text))) !== null) if (m.index > at) { at = m.index; best = name; }
  }
  return best;
}
/* Meta's address and the code, from the lines BEFORE the last "Press Enter" (the current try's).
   Weakest premise: the Mac wording was not captured; a device code is letters and digits in dashed groups. */
const CODE_RE = /\b[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+\b/g;
/* The code as the address carries it (?user_code=), used when no dashed code is printed (round 1). */
function codeFromUrl(url) {
  try { const c = new URL(url).searchParams.get('user_code'); return c && /^[A-Za-z0-9-]{4,32}$/.test(c) ? c : null; } catch { return null; }
}
function promptOf(text) {
  const t = String(text);
  const cut = t.lastIndexOf(PRESS_WORDS);
  return tryOf(cut < 0 ? '' : t.slice(0, cut));
}
/* Whether anything but whitespace follows the last Press prompt. */
function movedOnFromPrompt(text) {
  const t = String(text);
  const at = t.lastIndexOf(PRESS_WORDS);
  return at >= 0 && /\S/.test(t.slice(at + PRESS_WORDS.length).replace(/^:/, ''));
}
/* The address and code in `before`, from the current try only: after a retry, the lines since the last
   expiry. Also read on the waiting screen (round 9: Muse may go straight there, with no Press line). */
function tryOf(before) {
  const own = before.slice(Math.max(0, before.lastIndexOf(EXPIRED_WORDS)));
  const urls = own.match(/https:\/\/\S+/g);
  const codes = own.replace(/https:\/\/\S+/g, ' ').match(CODE_RE);
  const url = urls ? urls[urls.length - 1] : null;
  /* The address's own code first (round 13): a later dashed token (a request id, a UTC-0500) must not put
     a different code in the boxes than the page Meta opens. A printed code only when the address has none. */
  const fromUrl = url ? codeFromUrl(url) : null;
  return { url, code: fromUrl || (codes ? codes[codes.length - 1] : null) };
}

function tmuxBin() { return tmuxBinCached || (tmuxBinCached = require('./create').binPaths().tmuxBin); }
let tmuxBinCached = null;
/* Every real side effect goes through the live-execution gate (CLAUDE.md convention 3). */
function live(file, args) {
  const gate = require('./live-execution');
  if (gate.liveExecutionAllowed()) return true;
  gate.refuseOrWarn('musesignin', file, args);
  return false;
}
let tmux = (args) => {
  const full = ['-L', socket()].concat(args);
  let bin;
  try { bin = tmuxBin(); } catch (e) { const x = new Error('Kosmos could not find tmux: ' + (e && e.message)); x.kosmosInternal = true; throw x; }
  if (!live(bin, full)) throw new Error('live execution is off');
  return execFileSync(bin, full, { encoding: 'utf8', timeout: TMUX_CALL_MS, stdio: ['ignore', 'pipe', 'pipe'] });
};
let museBin = () => musestatus.installed();
let now = () => Date.now();
let tickMs = TICK_MS;

/* ---- one sign-in at a time ------------------------------------------------------------------ */
let S = null;   // { id, state, url, code, because, folder, startedAt, seenAt, screen, pressed, pressedAt, resent, retrying, gone, timer, keyFailures }

/** What a screen is told: never the folder, never the raw screen. */
function status() {
  if (!S) return { state: 'idle' };
  const out = { id: S.id, state: S.state };
  if (S.url) out.url = S.url;
  if (S.code) out.code = S.code;
  if (S.because) out.because = S.because;
  return out;
}
/* The screen's text; null when the session is gone (muse exited); undefined when tmux did not answer
   this once, which is not muse exiting. */
function screen() {
  // The whole history (-S -), not only the visible rows (round 12): a chatty Muse can scroll its code off screen.
  try { return tmux(['capture-pane', '-p', '-J', '-S', '-', '-t', SESSION]); } catch { /* gone, or slow? */ }
  try { tmux(['has-session', '-t', SESSION]); return undefined; } catch (e) {
    return deliveryUnknown(e) || (e && e.kosmosInternal) ? undefined : null;
  }
}
/* Sends are counted, not ticks (round 5): a failure adds one, a send that went out clears the count. */
function keys(...k) { tmux(['send-keys', '-t', SESSION].concat(k)); if (S) S.keyFailures = 0; }
/* A code is served only while it can be used, the address included (it carries ?user_code=). */
function dropCode(mine) { mine.code = null; mine.url = null; mine.pressed = null; }
function logLine(what) { try { console.error('muse sign-in: ' + what); } catch { /* nothing to log to */ } }
function end(state, because) {
  if (!S) return;
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
  S.state = state;
  S.because = because || null;
  dropCode(S);
  logLine('ended ' + state + (because ? ' (' + because + ')' : ''));
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* already gone */ }
}
/* True when the mark is written. On a Mac it is the ONLY record Kosmos reads (the sign-in is in the
   Keychain), so a sign-in it could not record is not reported done (round 8). */
function markSignedIn() {
  const file = musestatus.signedInMarker();
  try {
    fs.mkdirSync(musestatus.signinFolder(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ at: new Date(now()).toISOString() }) + '\n', { mode: 0o600 });
    return true;
  } catch (e) { logLine('could not record the sign-in (' + ((e && e.code) || 'unknown') + ')'); return false; }
}

function step() {
  const mine = S;
  if (!mine || !mine.timer) return;
  const text = screen();
  if (S !== mine || !mine.timer) return;
  if (text === undefined) return;
  if (text === null) {
    /* Gone (the session, not only muse: the exit line keeps the session). Two misses in a row, as
       agysignin needs (round 1): one failed has-session must not end a sign-in mid-approval. */
    mine.gone = (mine.gone || 0) + 1;
    if (mine.gone >= 2) end('failed', CLOSED);
    return;
  }
  mine.gone = 0;
  const exited = text.includes(EXITED);
  const t = now();
  const drawn = screenOf(text);
  if (drawn !== mine.screen) { mine.screen = drawn; mine.seenAt = t; }
  if (drawn === 'done') {
    if (markSignedIn()) end('done'); else end('failed', NOT_RECORDED);
    return;
  }
  if (drawn === 'unsaved') {
    // Kosmos has just seen the save fail: an older mark must not answer yes beside it (round 9).
    try { fs.rmSync(musestatus.signedInMarker(), { force: true }); } catch { /* none */ }
    end('failed', UNSAVED); return;
  }
  if (exited) { end('failed', CLOSED); return; }
  if (drawn === 'expired') {
    /* After a retry, the old expiry line is the last one until Muse draws the new code (round 1). If no
       new code comes, the sign-in ends and the person starts again (round 5, reversing round 3). */
    if (mine.retrying) {
      if (t - mine.seenAt > STUCK_MS) end('failed', NO_NEW_CODE);
      return;
    }
    if (mine.state !== 'expired') { mine.state = 'expired'; dropCode(mine); mine.because = EXPIRED; }
    return;
  }
  if (drawn === 'press') {
    mine.retrying = false;
    const p = promptOf(text);
    if (!p.code || !p.url) { if (t - mine.seenAt > STUCK_MS) { mine.state = 'stuck'; mine.because = UNKNOWN; } return; }
    mine.code = p.code; mine.url = p.url; mine.because = null; mine.state = 'code';
    /* Enter once per code: Muse only waits for the approval after it (Homer), and it opens Meta's page
       in the browser itself. Marked before sending: a second Enter would land on the next screen. */
    if (mine.pressed !== p.code) { mine.pressed = p.code; mine.pressedAt = t; mine.resent = false; enterOnce(mine); return; }
    /* Still on the same code's prompt well after the Enter (round 1: a send that failed is never sent
       again otherwise, and Muse never polls): once more, then named. */
    /* Anything drawn after the prompt means the Enter was taken (round 13), even in words Kosmos does not
       know: no resend onto it. The code stays shown; "Logged in." still ends it, and the limit backstops. */
    if (movedOnFromPrompt(text)) return;
    if (t - mine.pressedAt > RESEND_MS) {
      if (!mine.resent) { mine.resent = true; mine.pressedAt = t; enterOnce(mine); }
      else { mine.state = 'stuck'; mine.because = NOT_WAITING; }
    }
    return;
  }
  if (drawn === 'waiting' || drawn === 'opening') {
    if (!mine.code) {
      /* Round 9: Muse went straight to waiting (after a retry's r Enter, perhaps with no Press line), so
         the code is read here, with no Enter (Muse is already waiting). */
      const p = tryOf(String(text));
      if (p.code && p.url) { mine.code = p.code; mine.url = p.url; mine.pressed = p.code; mine.pressedAt = t; mine.retrying = false; }
    }
    // Moved on from the prompt: a reason left by an earlier stuck goes with it (round 3).
    if (mine.code) { mine.state = 'code'; mine.because = null; return; }
    // No code at all: named, not waited on for 20 minutes (round 9).
    if (t - mine.seenAt > STUCK_MS) { if (mine.retrying) end('failed', NO_NEW_CODE); else { mine.state = 'stuck'; mine.because = UNKNOWN; } }
    return;
  }
  if (t - mine.seenAt > STUCK_MS) { mine.state = 'stuck'; mine.because = UNKNOWN; }
}
/* One Enter. A failure that proves it never went out re-arms it for the next tick (the agysignin rule);
   a timeout says nothing about delivery, so that Enter is left to the resend rule. */
function enterOnce(mine) {
  try { keys('Enter'); } catch (e) {
    if (!deliveryUnknown(e)) { mine.pressed = null; mine.resent = false; }
    throw e;
  }
}
function tick() {
  const mine = S;
  try {
    step();   // first (round 12): an approval drawn in the last tick is read before the limit ends it
  } catch (e) {
    if (!mine || S !== mine || !mine.timer) return;
    mine.keyFailures = (mine.keyFailures || 0) + 1;
    if (mine.keyFailures >= MAX_KEY_FAILURES) {
      mine.state = 'stuck'; mine.because = UNREACHABLE;
      logLine('tmux kept failing (' + ((e && (e.code || e.message)) || 'unknown') + ')');
    }
  }
  if (S === mine && mine && mine.timer && now() - mine.startedAt > GIVE_UP_MS) end('failed', GAVE_UP);
}

function shq(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
/* The environment for `muse login`, added in front of the command: never HOME, never XDG. MUSE_LOGIN=1
   lets it sign in; auto-update and the installer's shell-profile edits stay off. */
const LOGIN_ENV = Object.freeze(['MUSE_LOGIN=1', 'MUSE_NO_AUTO_UPDATE=1', 'MUSE_NO_MODIFY_PATH=1']);

function start() {
  if (!musestatus.enabled()) return { ok: false, because: NOT_ON };
  if (S && S.timer) end('stopped');
  tmuxBinCached = null;
  const inst = museBin();
  if (!inst || !inst.installed) return { ok: false, because: (inst && inst.because) || musestatus.NOT_INSTALLED_BECAUSE };
  if (tmux === REAL.tmux && !live(tmuxBin(), ['-L', socket(), 'new-session', '-s', SESSION])) return { ok: false, because: COULD_NOT_START };
  const folder = musestatus.signinFolder();
  try { fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); } catch { return { ok: false, because: NO_FOLDER }; }
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* none running */ }
  try {
    // -f /dev/null: this private server never reads the person's ~/.tmux.conf.
    /* Not exec (round 1): when muse exits, the shell prints the exit line and waits, so its last screen
       ("Logged in." or not) is still there to read. Ending the sign-in kills the session. */
    /* Through /bin/sh (round 3): tmux runs a command with the person's own shell, and fish refuses $?. */
    const inner = 'env ' + LOGIN_ENV.join(' ') + ' ' + shq(inst.bin) + ' login; printf "\\n%s %s\\n" ' + shq(EXITED) + ' "$?"; exec sleep 3600';
    tmux(['-f', '/dev/null', 'new-session', '-d', '-s', SESSION, '-x', String(PANE_COLS), '-y', String(PANE_ROWS), '-c', folder,
      'exec /bin/sh -c ' + shq(inner)]);
  } catch (e) {
    logLine('could not start (' + ((e && (e.code || e.message)) || 'unknown') + ')');
    return { ok: false, because: COULD_NOT_START };
  }
  S = { id: crypto.randomBytes(8).toString('hex'), state: 'starting', url: null, code: null, because: null, folder,
    startedAt: now(), seenAt: now(), screen: null, pressed: null, timer: null, keyFailures: 0 };
  S.timer = setInterval(tick, tickMs);
  if (S.timer.unref) S.timer.unref();
  return { ok: true, id: S.id };
}
function isMine(id) { return !!S && typeof id === 'string' && id === S.id; }

/** After "expired": Muse asks for r then Enter to print a new code. */
function retry(id) {
  if (!isMine(id)) return { ok: false, because: NOT_MINE };
  if (!S.timer || S.state !== 'expired' || S.retrying) return { ok: false, because: NO_EXPIRED };
  // The screen, not the state, right before typing: an r on any other screen is keystrokes there.
  const text = screen();
  if (typeof text !== 'string' || screenOf(text) !== 'expired') return { ok: false, because: NO_EXPIRED };
  // One call (round 5): an r typed without its Enter would be doubled by the next retry.
  try { keys('r', 'Enter'); } catch (e) {
    /* A timeout says nothing about delivery (round 7, the enterOnce rule): taken as sent, so no second r
       can follow onto the new code; NO_NEW_CODE ends it if the keys never arrived. */
    if (!deliveryUnknown(e)) return { ok: false, because: NO_RETRY_SENT };
  }
  // The give-up clock is the new code's (round 1), and the old expiry is ignored until it is drawn.
  S.state = 'starting'; S.because = null; S.seenAt = now(); S.screen = null; S.startedAt = now(); S.retrying = true;
  return { ok: true };
}
function stop(id) {
  if (!isMine(id)) return { ok: false, because: NOT_MINE };
  if (S.timer) end('stopped');
  return { ok: true };
}

/* ---- tests -------------------------------------------------------------------------------- */
const REAL = { tmux, museBin, now };
function setForTests(o) {
  if (o.tmux) tmux = o.tmux;
  if (o.museBin) museBin = o.museBin;
  if (o.now) now = o.now;
  if (o.tickMs) tickMs = o.tickMs;
}
function tickForTests() { tick(); }
function resetForTests() {
  if (S && S.timer) clearInterval(S.timer);
  S = null;
  ({ tmux, museBin, now } = REAL);
  tickMs = TICK_MS;
}

module.exports = { start, status, retry, stop, socket, SESSION, SCREENS, LOGIN_ENV, NOT_MINE, NOT_ON, COULD_NOT_START, MAX_KEY_FAILURES, STUCK_MS, GIVE_UP_MS, RESEND_MS, EXITED, screenOf, promptOf,
  setForTests, tickForTests, resetForTests };
