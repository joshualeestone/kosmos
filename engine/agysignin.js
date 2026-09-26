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
const { execFileSync, execFile } = require('node:child_process');

/* Its own tmux socket, so the session is invisible to every agent-listing tmux call. A test names
   its own (AGENT_WORKFORCE_AGY_SIGNIN_SOCKET) so it can never meet a real sign-in. */
function socket() { return process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET || 'kosmos-agy-signin'; }
const SESSION = 'agy-signin';
const TICK_MS = 1000;
const STUCK_MS = 8000;          // an unrecognised screen this long is shown, not guessed at
const GIVE_UP_MS = 30 * 60000;  // a sign-in nobody finishes ends by itself

/* The words each screen shows (agy 1.2.11, Josh's screenshots of 2026-09-26). Matched on the text
   of the screen with the ANSI styling already stripped by capture-pane -p. */
const SCREENS = {
  menu: /Select login method/,
  code: /Your browser should open automatically/,
  theme: /Choose your colou?r scheme/i,
  terms: /Terms of Service & Data Use/,
  trust: /Do you trust the contents of this project\?/,
};

/* ---- seams a test replaces -------------------------------------------------------------- */
function tmuxBin() { return require('./create').binPaths().tmuxBin; }
let tmux = (args) => execFileSync(tmuxBin(), ['-L', socket()].concat(args), { encoding: 'utf8', timeout: 5000 });
let openFile = (file, done) => execFile('/usr/bin/open', [file], { timeout: 15000 }, (err) => done(err));
let confirmSignedIn = () => require('./agystatus').check();
let agyBin = () => require('./agystatus').installed();
let now = () => Date.now();
let folderRoot = () => require('./store').ROOT;

/* ---- one session at a time --------------------------------------------------------------- */
let S = null;   // { state, url, because, step, folder, since, lastSeen, timer, busy, startedAt }

function signinFolder() { return path.join(folderRoot(), 'agy-signin'); }

/** What a screen is told: never the folder, never the raw screen. */
function status() {
  if (!S) return { state: 'idle' };
  const out = { state: S.state, step: S.step || null };
  if (S.url) out.url = S.url;
  if (S.because) out.because = S.because;
  return out;
}

function screen() {
  try { return tmux(['capture-pane', '-p', '-J', '-t', SESSION]); } catch { return null; }
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
/* The line the menu's ">" marker is on. */
function markedLine(text) {
  const line = String(text).split('\n').find((l) => /^\s*>\s/.test(l));
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
function samePath(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
}

function tick() {
  if (!S || S.busy) return;
  if (now() - S.startedAt > GIVE_UP_MS) { end('failed', 'the sign-in was not finished, so Kosmos stopped it'); return; }
  const text = screen();
  if (text === null) {
    // The session is gone: agy exited. Signed in or not is agy's own answer.
    S.busy = true;
    Promise.resolve(confirmSignedIn()).then((r) => {
      S.busy = false;
      if (r && r.signedIn === true) end('done');
      else end('failed', 'Antigravity closed before the sign-in finished');
    }, () => { S.busy = false; end('failed', 'Antigravity closed before the sign-in finished'); });
    return;
  }
  const seen = (name) => SCREENS[name].test(text);
  if (seen('menu')) {
    // "> 1. Google OAuth" is the default choice; press Enter only when it is the marked one.
    if (/Google OAuth/.test(markedLine(text)) && S.step !== 'menu') { S.step = 'menu'; keys('Enter'); }
    S.lastSeen = now();
    return;
  }
  if (seen('terms')) {
    /* The cursor starts on "Previous", so Enter would go BACK. Move down until the marker is on
       "[Done]" (never Space: that is what ticks the optional data-sharing box), then Enter. */
    S.state = 'setup'; S.step = 'terms';
    const on = markedLine(text);
    if (/Done/.test(on)) { keys('Enter'); S.moves = 0; }
    else if ((S.moves || 0) < 4) { keys('Down'); S.moves = (S.moves || 0) + 1; }
    else end('stuck', 'Kosmos could not find the Done button on Antigravity\'s terms');
    S && (S.lastSeen = now());
    return;
  }
  if (seen('trust')) {
    const folder = trustFolder(text);
    if (!folder || !samePath(folder, S.folder)) {
      // Never trust any folder but Kosmos's own sign-in folder.
      end('failed', 'Antigravity asked to trust a folder Kosmos did not choose, so Kosmos stopped the sign-in');
      return;
    }
    S.state = 'setup'; S.step = 'trust';
    if (/Yes/.test(markedLine(text))) keys('Enter');
    S.lastSeen = now();
    return;
  }
  if (seen('theme')) {
    S.state = 'setup'; S.step = 'theme';
    keys('Enter');   // its default scheme
    S.lastSeen = now();
    return;
  }
  if (seen('code')) {
    if (S.state !== 'code' && S.state !== 'checking') { S.state = 'code'; S.step = 'code'; }
    const u = urlFrom(text);
    if (u) S.url = u;
    S.lastSeen = now();
    return;
  }
  // Not a screen Kosmos knows. After the code and the setup screens, this is agy's own ready
  // screen: ask agy whether it is signed in. Before that, give it a moment, then show it.
  if (S.step === 'terms' || S.step === 'trust' || S.step === 'theme' || S.state === 'checking') {
    S.busy = true; S.state = 'checking';
    Promise.resolve(confirmSignedIn()).then((r) => {
      S.busy = false;
      if (!S) return;
      if (r && r.signedIn === true) end('done');
      else if (now() - S.lastSeen > STUCK_MS) { S.state = 'stuck'; S.because = 'Antigravity is showing a step Kosmos does not recognise'; }
    }, () => { S.busy = false; });
    return;
  }
  if (now() - S.lastSeen > STUCK_MS && S.state !== 'stuck') {
    S.state = 'stuck';
    S.because = 'Antigravity is showing a step Kosmos does not recognise';
  }
}

/** Start a sign-in (ending any earlier one). */
function start() {
  if (S) end('stopped');
  const inst = agyBin();
  if (!inst || !inst.installed) return { ok: false, because: 'Antigravity is not installed on this computer' };
  const folder = signinFolder();
  try { fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); } catch { return { ok: false, because: 'Kosmos could not make a folder for the sign-in' }; }
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* none running */ }
  try {
    tmux(['new-session', '-d', '-s', SESSION, '-x', '120', '-y', '40', '-c', folder, inst.bin]);
  } catch {
    return { ok: false, because: 'Kosmos could not start Antigravity\'s sign-in just now' };
  }
  S = { state: 'starting', url: null, because: null, step: null, folder, startedAt: now(), lastSeen: now(), timer: null, busy: false };
  S.timer = setInterval(tick, TICK_MS);
  if (S.timer.unref) S.timer.unref();
  return { ok: true };
}

/* The code Google shows ("4/0AXl..."): letters, digits and a few URL-safe marks, nothing that a
   terminal would treat as a key. */
const CODE_RE = /^[A-Za-z0-9/_\-.~]{10,512}$/;
/** Type the pasted code into agy. */
function code(value) {
  if (!S || S.state !== 'code') return { ok: false, because: 'Antigravity is not waiting for a code' };
  const v = String(value || '').trim();
  if (!CODE_RE.test(v)) return { ok: false, because: 'That does not look like the code from Google\'s page' };
  try { keys('-l', '--', v); keys('Enter'); } catch { return { ok: false, because: 'Kosmos could not pass the code to Antigravity' }; }
  S.state = 'checking'; S.step = 'code-sent'; S.lastSeen = now();
  return { ok: true };
}

/** The last resort: show the hidden session in a Terminal window so the person can finish it. */
function show() {
  return new Promise((resolve) => {
    if (!S || !S.timer) { resolve({ ok: false, because: 'there is no sign-in to show' }); return; }
    const file = path.join(S.folder, 'show-sign-in.command');
    const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
    try {
      fs.writeFileSync(file, '#!/bin/sh\nexec ' + q(tmuxBin()) + ' -L ' + socket() + ' attach -t ' + SESSION + '\n', { mode: 0o700 });
    } catch { resolve({ ok: false, because: 'Kosmos could not open the sign-in window' }); return; }
    openFile(file, (err) => resolve(err ? { ok: false, because: 'Kosmos could not open the sign-in window' } : { ok: true }));
  });
}

function stop() { if (S && S.timer) end('stopped'); return { ok: true }; }

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
function resetForTests() { if (S && S.timer) clearInterval(S.timer); S = null; }

module.exports = { start, status, code, show, stop, socket, SESSION, SCREENS, CODE_RE,
  urlFrom, markedLine, trustFolder, setForTests, tickForTests, resetForTests };
