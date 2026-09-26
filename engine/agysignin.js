'use strict';
/**
 * #3998: sign Gemini's Google subscription in WITHOUT a terminal the person has to operate.
 *
 * agy (Google's Antigravity CLI, 1.2.11) has no login command, flag or environment switch. Its
 * sign-in is interactive: a "Select login method" menu, then it opens Google's page in the browser
 * itself and waits for a code the person copies from that page, then three first-run screens
 * (colour scheme, Terms & Data Use with an OPTIONAL data-sharing box, and "Do you trust <folder>").
 * On 0.6.97 Kosmos opened all of that in a raw Terminal window (Josh, 2026-09-26 11:27 to 11:33).
 *
 * So Kosmos runs agy itself, in a tmux session on its OWN socket (it never appears among agents),
 * in a folder Kosmos owns (never the home folder), reads the screen once a second, and answers each
 * screen it recognises by the words on it. The person sees only Google's page, and pastes the code
 * into Kosmos's own panel. What Kosmos never does on the person's behalf:
 *   - tick the optional data-sharing box (the panel says so; they can opt in later in agy);
 *   - trust any folder but its own sign-in folder.
 * A screen it does not recognise is not guessed at: after a few seconds the state becomes `stuck`,
 * and the panel offers to show the window so the person can finish by hand.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');

/* Its own tmux socket, so the session is invisible to every agent-listing tmux call. A test names
   its own (AGENT_WORKFORCE_AGY_SIGNIN_SOCKET) so it can never meet a real sign-in. */
/* Named after this board's own folder, so two boards run by one macOS account never kill each
   other's sign-in (review round 4). */
function socket() {
  if (process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET) return process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET;
  const root = String(require('./store').ROOT);
  return 'kosmos-agy-signin-' + crypto.createHash('sha256').update(root).digest('hex').slice(0, 10);
}
const SESSION = 'agy-signin';
const TICK_MS = 1000;
const STUCK_MS = 8000;          // an unrecognised screen this long is shown, not guessed at
const GIVE_UP_MS = 30 * 60000;  // a sign-in nobody finishes ends by itself
const SAME_SCREEN_MS = 20000;   // a recognised screen that does not move on this long is stuck too
const CODE_RETRY_MS = 20000;    // the code screen still showing this long after a code: it was not taken
/* Asking agy whether it is signed in costs a prompt on the person's subscription, so one sign-in
   asks at most this many times, however long it sits on a screen Kosmos does not know. */
const MAX_CHECKS = 3;
const UNKNOWN = 'Antigravity is showing a step Kosmos does not recognise';

/* The words each screen shows (agy 1.2.11, Josh's screenshots of 2026-09-26). Matched on the text
   of the screen with the ANSI styling already stripped by capture-pane -p. */
const SCREENS = {
  menu: /Select login method/,
  code: /Your browser should open automatically/,
  theme: /Choose your colou?r scheme/i,
  terms: /Terms of Service & Data Use/,
  trust: /Do you trust the contents of this project\?/,
  /* agy's own ready screen once signed in: "<email> (Antigravity Starter Quota) - Gemini 3.8 Flash
     (High)" on Josh's Mac. Seeing it earns one confirmation even when the others are spent, so a
     sign-in the person finished in the shown window is still recognised (review round 4). */
  ready: /\(.*Quota\)\s+-\s+Gemini/,
};
/* Which screen agy is on: the one whose words appear LAST, so text an earlier screen left behind
   never wins over the screen now drawn (review round 4). */
function screenOf(text) {
  let best = null; let at = -1;
  for (const [k, re] of Object.entries(SCREENS)) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text)) !== null) { if (m.index > at || (m.index === at && best === null)) { at = m.index; best = k; } if (m[0] === '') g.lastIndex += 1; }
  }
  return best;
}

/* ---- seams a test replaces -------------------------------------------------------------- */
function tmuxBin() { return require('./create').binPaths().tmuxBin; }
/* Both real side effects go through the live-execution gate (CLAUDE.md convention 3): a test that
   forgot its seam throws instead of driving a real agy; production warns and fails closed. */
function live(file, args) {
  const gate = require('./live-execution');
  if (gate.liveExecutionAllowed()) return true;
  gate.refuseOrWarn('agysignin', file, args);
  return false;
}
let tmux = (args) => {
  const full = ['-L', socket()].concat(args);
  if (!live(tmuxBin(), full)) throw new Error('live execution is off');
  return execFileSync(tmuxBin(), full, { encoding: 'utf8', timeout: 5000 });
};
let openFile = (file, done) => {
  if (!live('/usr/bin/open', [file])) { done(new Error('live execution is off')); return; }
  execFile('/usr/bin/open', [file], { timeout: 15000 }, (err) => done(err));
};
let confirmSignedIn = () => require('./agystatus').check();
let agyBin = () => require('./agystatus').installed();
let now = () => Date.now();
let folderRoot = () => require('./store').ROOT;

/* ---- one session at a time --------------------------------------------------------------- */
let S = null;   // { id, state, url, because, step, folder, lastSeen, timer, busy, startedAt, checks, ... }

function signinFolder() { return path.join(folderRoot(), 'agy-signin'); }

/** What a screen is told: never the folder, never the raw screen. */
function status() {
  if (!S) return { state: 'idle' };
  const out = { id: S.id, state: S.state, step: S.step || null };
  if (S.url) out.url = S.url;
  if (S.because) out.because = S.because;
  return out;
}

/* The screen's text; null when the session is GONE (agy exited); undefined when tmux did not
   answer this once (a slow machine, a timeout), which is not agy exiting: the next tick tries again. */
function screen() {
  try { return tmux(['capture-pane', '-p', '-J', '-t', SESSION]); } catch { /* is it gone, or slow? */ }
  try { tmux(['has-session', '-t', SESSION]); return undefined; } catch (e) {
    return e && (e.code === 'ETIMEDOUT' || e.signal) ? undefined : null;
  }
}
function keys(...k) { tmux(['send-keys', '-t', SESSION].concat(k)); }

function end(state, because) {
  if (!S) return;
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
  S.state = state;
  S.because = because || null;
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* already gone */ }
}

/* The Google sign-in address agy prints under "If not:"; wrapped lines are joined by -J. */
function urlFrom(text) {
  const m = String(text).match(/https:\/\/accounts\.google\.com\/\S+/);
  return m ? m[0] : null;
}
/* The line the ">" marker is on: the LAST one, the screen now drawn. */
function markedLine(text) {
  const line = String(text).split('\n').reverse().find((l) => /^\s*>\s/.test(l));
  return line ? line.trim() : '';
}
/* The folder the trust screen names (the line after "Accessing workspace:"). */
function trustFolder(text) {
  const lines = String(text).split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => /^Accessing workspace:/.test(l));
  if (at < 0) return null;
  const inline = lines[at].replace(/^Accessing workspace:\s*/, '');
  if (inline) return inline;
  return lines.slice(at + 1).find((l) => l) || null;
}
function shq(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
function samePath(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
}

/* The loop runs on a timer, and a board has no process-level uncaughtException handler, so
   nothing may throw out of it: one failed tmux call would take the whole board down. A key that
   did not go out is pressed again on the next tick (its screen's once-guards are reset); five
   failures in a row show the window instead. */
const MAX_KEY_FAILURES = 5;
function tick() {
  const mine = S;
  try {
    step();
    if (mine) mine.keyFailures = 0;
  } catch {
    if (!mine || S !== mine || !mine.timer) return;
    mine.pressed = false; mine.downFrom = null;
    mine.keyFailures = (mine.keyFailures || 0) + 1;
    if (mine.keyFailures >= MAX_KEY_FAILURES) { mine.state = 'stuck'; mine.because = 'Kosmos could not reach Antigravity\'s sign-in just now'; }
  }
}
function step() {
  if (!S || S.busy) return;
  if (now() - S.startedAt > GIVE_UP_MS) { end('failed', 'the sign-in was not finished, so Kosmos stopped it'); return; }
  const text = screen();
  if (text === null) {
    // The session is gone: agy exited. Signed in or not is agy's own answer. The answer is for THIS
    // session only: a Stop and a new Sign in while it was out must not be ended by it.
    const mine = S;
    mine.busy = true;
    Promise.resolve().then(() => confirmSignedIn()).then((r) => {   // a throw is a rejection, so busy is always cleared
      mine.busy = false;
      if (S !== mine || !mine.timer) return;   // stopped or replaced while agy was asked
      if (r && r.signedIn === true) end('done');
      else end('failed', 'Antigravity closed before the sign-in finished');
    }, () => { mine.busy = false; if (S === mine && mine.timer) end('failed', 'Antigravity closed before the sign-in finished'); });
    return;
  }
  if (text === undefined) return;
  const name = screenOf(text);
  const changed = name !== S.screen;
  if (changed) { S.screen = name; S.screenSince = now(); S.pressed = false; S.downFrom = null; S.moves = 0; }
  if (name === 'ready') { readyCheck(text); return; }
  /* 🛑 ONCE THE WINDOW IS SHOWN, THE PERSON DRIVES (review round 4). Kosmos presses nothing more:
     its keys would race theirs (a Done pressed before they tick the box they meant to). It only
     watches for the end: agy exiting (above) or its ready screen. */
  if (S.shown) return;
  if (!changed && name && S.state === 'stuck') return;   // shown to the person; nothing more is pressed on it
  /* A recognised screen that stays the same this long is stuck too (a changed default, a cursor
     that is not where Kosmos expects): the code screen is exempt, it waits for the person. */
  if (!changed && name && name !== 'code' && now() - S.screenSince > SAME_SCREEN_MS) {
    S.state = 'stuck'; S.because = UNKNOWN;
    return;
  }
  const seen = (n) => name === n;   // the screen drawn NOW, not words an earlier one left behind
  if (seen('menu')) {
    // "> 1. Google OAuth" is the default choice; press Enter only when it is the marked one.
    if (S.state === 'stuck') { S.state = 'starting'; S.because = null; }
    if (/Google OAuth/.test(markedLine(text)) && !S.pressed) { S.step = 'menu'; S.pressed = true; keys('Enter'); }
    S.lastSeen = now();
    return;
  }
  if (seen('terms')) {
    /* The cursor starts on "Previous", so Enter would go BACK. Move down until the marker is on
       "[Done]" (never Space: that is what ticks the optional data-sharing box), then Enter. */
    S.state = 'setup'; S.step = 'terms'; S.because = null;
    S.lastSeen = now();
    const on = markedLine(text);
    /* Each key once: Enter once on "[Done]", and the next Down only after the marker has moved, so
       a slow redraw never carries a second key onto the next screen (the trust question). */
    if (S.pressed) return;
    if (/\[Done\]/.test(on)) { S.pressed = true; keys('Enter'); return; }
    if (S.downFrom !== null && S.downFrom !== undefined && on === S.downFrom) return;   // the last Down has not landed yet
    if (S.moves < 4) { S.downFrom = on; S.moves += 1; keys('Down'); return; }
    // Shown, not ended: the person can still finish it in the window, or stop.
    S.state = 'stuck'; S.because = 'Kosmos could not find the Done button on Antigravity\'s terms';
    return;
  }
  if (seen('trust')) {
    const folder = trustFolder(text);
    if (!folder || !samePath(folder, S.folder)) {
      // Never trust any folder but Kosmos's own sign-in folder.
      end('failed', 'Antigravity asked to trust a folder Kosmos did not choose, so Kosmos stopped the sign-in');
      return;
    }
    S.state = 'setup'; S.step = 'trust'; S.because = null;
    if (/Yes/.test(markedLine(text)) && !S.pressed) { S.pressed = true; keys('Enter'); }
    S.lastSeen = now();
    return;
  }
  if (seen('theme')) {
    S.state = 'setup'; S.step = 'theme'; S.because = null;
    if (!S.pressed) { S.pressed = true; keys('Enter'); }   // its default scheme
    S.lastSeen = now();
    return;
  }
  if (seen('code')) {
    if (S.step === 'code-sent' && now() - S.codeSentAt > CODE_RETRY_MS) {
      // Still asking for a code well after one was typed: Google's code was not taken (expired, or
      // copied short). Ask again rather than wait here for half an hour.
      S.state = 'code'; S.step = 'code';
      S.because = 'Antigravity did not take that code. Copy the newest code from Google\'s page and paste it again.';
    } else if (S.state !== 'code' && S.state !== 'checking') { S.state = 'code'; S.step = 'code'; S.because = null; }
    const u = urlFrom(text);
    if (u) S.url = u;
    S.lastSeen = now();
    return;
  }
  /* Not a screen Kosmos knows. After the code or the setup screens this is usually agy's own ready
     screen, and on a first screen it may be agy already signed in (Sign in again): so agy is asked,
     at once after the setup, after a moment otherwise. Each ask costs a prompt, so it happens at
     most MAX_CHECKS times a sign-in, and while stuck only when the screen has changed (the person
     may have finished it in the shown window). A "no" or "could not tell" makes it stuck, and
     stuck stays stuck: it never flips back to checking by itself. */
  const settled = S.step === 'terms' || S.step === 'trust' || S.step === 'theme';
  const ask = S.checks < MAX_CHECKS && (S.state === 'stuck'
    ? text !== S.stuckText && now() - S.lastCheckAt > STUCK_MS   // a redrawing screen does not spend them all at once
    : settled || now() - S.lastSeen > STUCK_MS);
  if (!ask) {
    if (S.state !== 'stuck' && now() - S.lastSeen > STUCK_MS) { S.state = 'stuck'; S.because = UNKNOWN; S.stuckText = text; }
    return;
  }
  const mine = S;
  mine.busy = true; mine.checks += 1; mine.lastCheckAt = now();
  if (mine.state !== 'stuck') mine.state = 'checking';
  Promise.resolve().then(() => confirmSignedIn()).then((r) => {   // a throw is a rejection, so busy is always cleared
    mine.busy = false;
    if (S !== mine || !mine.timer) return;   // a session that has ended, or been replaced, is not touched
    if (r && r.signedIn === true) { end('done'); return; }
    mine.state = 'stuck'; mine.because = UNKNOWN; mine.stuckText = text;
  }, () => {
    mine.busy = false;
    if (S !== mine || !mine.timer) return;
    mine.state = 'stuck'; mine.because = UNKNOWN; mine.stuckText = text;
  });
}

/* agy's ready screen: signed in, very likely. It is confirmed once (a prompt on the person's
   subscription), even when the unknown-screen asks are spent, because this is the one screen that
   says the person may have finished. A "no" leaves it stuck; the same ready screen is not asked
   about again. */
function readyCheck(text) {
  if (S.readyChecked) return;
  const mine = S;
  mine.readyChecked = true; mine.busy = true; mine.lastCheckAt = now();
  if (mine.state !== 'stuck') mine.state = 'checking';
  Promise.resolve().then(() => confirmSignedIn()).then((r) => {
    mine.busy = false;
    if (S !== mine || !mine.timer) return;
    if (r && r.signedIn === true) { end('done'); return; }
    mine.state = 'stuck'; mine.because = UNKNOWN; mine.stuckText = text;
  }, () => {
    mine.busy = false;
    if (S !== mine || !mine.timer) return;
    mine.state = 'stuck'; mine.because = UNKNOWN; mine.stuckText = text;
  });
}

/** Start a sign-in (ending any earlier one). */
function start() {
  if (S) end('stopped');
  const inst = agyBin();
  if (!inst || !inst.installed) return { ok: false, because: 'Antigravity is not installed on this computer' };
  /* The live-execution gate is checked here, OUTSIDE the try below, so a test that forgot its seam
     throws instead of the throw being swallowed as "could not start". */
  if (tmux === REAL.tmux && !live(tmuxBin(), ['-L', socket(), 'new-session', '-s', SESSION])) {
    return { ok: false, because: 'Kosmos could not start Antigravity\'s sign-in just now' };
  }
  const folder = signinFolder();
  try { fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); } catch { return { ok: false, because: 'Kosmos could not make a folder for the sign-in' }; }
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* none running */ }
  try {
    /* -f /dev/null: this private server never reads the person's ~/.tmux.conf (a remain-on-exit
       there would keep a dead agy's pane, and the exit would never be seen). The program is quoted
       for the shell tmux runs it with, so a path with a space still starts. */
    tmux(['-f', '/dev/null', 'new-session', '-d', '-s', SESSION, '-x', '120', '-y', '40', '-c', folder, 'exec ' + shq(inst.bin)]);
  } catch {
    return { ok: false, because: 'Kosmos could not start Antigravity\'s sign-in just now' };
  }
  S = { id: crypto.randomBytes(8).toString('hex'), state: 'starting', url: null, because: null, step: null, folder,
    startedAt: now(), lastSeen: now(), timer: null, busy: false, checks: 0, lastCheckAt: 0, moves: 0, downFrom: null };
  S.timer = setInterval(tick, TICK_MS);
  if (S.timer.unref) S.timer.unref();
  return { ok: true, id: S.id };
}
/* A screen names the sign-in it started, so one tab's Stop or code never lands on the sign-in
   another tab started since. */
function isMine(id) { return !!S && typeof id === 'string' && id === S.id; }
const NOT_MINE = 'That sign-in has ended or another one has started';

/* The code Google shows ("4/0AXl..."): letters, digits and a few URL-safe marks, nothing that a
   terminal would treat as a key. */
const CODE_RE = /^[A-Za-z0-9/_\-.~]{10,512}$/;
/** Type the pasted code into agy. */
function code(value, id) {
  if (!isMine(id)) return { ok: false, because: NOT_MINE };
  if (S.state !== 'code') return { ok: false, because: 'Antigravity is not waiting for a code' };
  const v = String(value || '').trim();
  if (!CODE_RE.test(v)) return { ok: false, because: 'That does not look like the code from Google\'s page' };
  /* 🛑 THE SCREEN, NOT THE STATE, right before typing (review round 4): the state can be a tick
     behind, and a code typed onto another screen is keystrokes there (on the ready screen, a
     prompt spent on the subscription). */
  const now_ = screen();
  if (typeof now_ !== 'string' || screenOf(now_) !== 'code') return { ok: false, because: 'Antigravity is not waiting for a code' };
  try { keys('-l', '--', v); keys('Enter'); } catch { return { ok: false, because: 'Kosmos could not pass the code to Antigravity' }; }
  S.state = 'checking'; S.step = 'code-sent'; S.because = null; S.lastSeen = now(); S.codeSentAt = now();
  return { ok: true };
}

/** The last resort: show the hidden session in a Terminal window so the person can finish it. */
function show(id) {
  return new Promise((resolve) => {
    if (!isMine(id)) { resolve({ ok: false, because: NOT_MINE }); return; }
    if (!S.timer) { resolve({ ok: false, because: 'there is no sign-in to show' }); return; }
    const file = path.join(S.folder, 'show-sign-in.command');
    try {
      fs.writeFileSync(file, '#!/bin/sh\nexec ' + shq(tmuxBin()) + ' -L ' + shq(socket()) + ' attach -t ' + SESSION + '\n', { mode: 0o700 });
    } catch { resolve({ ok: false, because: 'Kosmos could not open the sign-in window' }); return; }
    const mine = S;
    openFile(file, (err) => {
      if (!err && S === mine) mine.shown = true;   // from here the person drives; Kosmos presses nothing
      resolve(err ? { ok: false, because: 'Kosmos could not open the sign-in window' } : { ok: true });
    });
  });
}

function stop(id) {
  if (!isMine(id)) return { ok: false, because: NOT_MINE };
  if (S.timer) end('stopped');
  return { ok: true };
}

/* ---- tests ------------------------------------------------------------------------------ */
function setForTests(o) {
  if (o.tmux) tmux = o.tmux;
  if (o.openFile) openFile = o.openFile;
  if (o.confirmSignedIn) confirmSignedIn = o.confirmSignedIn;
  if (o.agyBin) agyBin = o.agyBin;
  if (o.now) now = o.now;
  if (o.folderRoot) folderRoot = o.folderRoot;
}
function tickForTests() { tick(); }
const REAL = { tmux, openFile, confirmSignedIn, agyBin, now, folderRoot };
/** Ends any session and puts every seam back. */
function resetForTests() {
  if (S && S.timer) clearInterval(S.timer);
  S = null;
  ({ tmux, openFile, confirmSignedIn, agyBin, now, folderRoot } = REAL);
}

module.exports = { start, status, code, show, stop, socket, SESSION, SCREENS, CODE_RE, MAX_CHECKS, MAX_KEY_FAILURES, NOT_MINE, screenOf,
  urlFrom, markedLine, trustFolder, setForTests, tickForTests, resetForTests };
