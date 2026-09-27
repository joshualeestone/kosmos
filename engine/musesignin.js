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
const path = require('node:path');
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
const STUCK_MS = 15000;          // a screen Kosmos does not recognise this long is named, not guessed at
const GIVE_UP_MS = 20 * 60000;   // a device code nobody approves ends by itself (Muse's own expire comes first)
const TMUX_CALL_MS = 5000;
const MAX_KEY_FAILURES = 5;
const PANE_COLS = 120;
const PANE_ROWS = 40;
const UNKNOWN = 'Muse Code is showing a step Kosmos does not recognise';
const NOT_MINE = 'That sign-in has ended or another one has started';
const COULD_NOT_START = 'Kosmos could not start Muse Code\'s sign-in just now';

/* The words each screen ends on. The screen that counts is the one whose words come LAST: an expired
   try's lines stay above the retry's. */
const SCREENS = Object.freeze({
  press: /Press Enter to open it in your browser/,
  waiting: /Waiting for approval/,
  done: /Logged in\./,
  unsaved: /saving failed/,
  expired: /expired before it was approved/,
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
function promptOf(text) {
  const t = String(text);
  const cut = t.lastIndexOf('Press Enter to open it in your browser');
  const before = cut < 0 ? '' : t.slice(0, cut);
  // After a retry, only the lines since the last expiry are this try's.
  const own = before.slice(Math.max(0, before.lastIndexOf('expired before it was approved')));
  const urls = own.match(/https:\/\/\S+/g);
  const codes = own.replace(/https:\/\/\S+/g, ' ').match(CODE_RE);
  return { url: urls ? urls[urls.length - 1] : null, code: codes ? codes[codes.length - 1] : null };
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
let folderRoot = () => require('./store').ROOT;

/* ---- one sign-in at a time ------------------------------------------------------------------ */
let S = null;   // { id, state, url, code, because, folder, startedAt, seenAt, screen, pressed, timer, keyFailures }

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
  try { return tmux(['capture-pane', '-p', '-J', '-t', SESSION]); } catch { /* gone, or slow? */ }
  try { tmux(['has-session', '-t', SESSION]); return undefined; } catch (e) {
    return e && (e.code === 'ETIMEDOUT' || e.signal || e.kosmosInternal) ? undefined : null;
  }
}
function keys(...k) { tmux(['send-keys', '-t', SESSION].concat(k)); }
function logLine(what) { try { console.error('muse sign-in: ' + what); } catch { /* nothing to log to */ } }
function end(state, because) {
  if (!S) return;
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
  S.state = state;
  S.because = because || null;
  if (state !== 'code' && state !== 'waiting') { S.code = null; }   // a code is only shown while it can be used
  logLine('ended ' + state + (because ? ' (' + because + ')' : ''));
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* already gone */ }
}
function markSignedIn() {
  const file = musestatus.signedInMarker();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ at: new Date(now()).toISOString() }) + '\n', { mode: 0o600 });
  } catch (e) { logLine('could not record the sign-in (' + ((e && e.code) || 'unknown') + ')'); }
}

function step() {
  const mine = S;
  if (!mine || !mine.timer) return;
  const text = screen();
  if (S !== mine || !mine.timer) return;
  if (text === undefined) return;
  if (text === null) {
    // Gone. After "Logged in." the tick that saw it has already ended the sign-in, so this is an early exit.
    end('failed', 'Muse Code\'s sign-in closed before it finished');
    return;
  }
  const t = now();
  const drawn = screenOf(text);
  if (drawn !== mine.screen) { mine.screen = drawn; mine.seenAt = t; }
  if (drawn === 'done') { markSignedIn(); end('done'); return; }
  if (drawn === 'unsaved') { end('failed', 'Muse Code signed in but could not save the sign-in on this computer'); return; }
  if (drawn === 'expired') {
    if (mine.state !== 'expired') { mine.state = 'expired'; mine.code = null; mine.url = null; mine.pressed = false; mine.because = 'The code expired before it was approved'; }
    return;
  }
  if (drawn === 'press') {
    const p = promptOf(text);
    if (!p.code || !p.url) { if (t - mine.seenAt > STUCK_MS) { mine.state = 'stuck'; mine.because = UNKNOWN; } return; }
    mine.code = p.code; mine.url = p.url; mine.because = null;
    /* Enter once per code: Muse only waits for the approval after it (Homer), and it opens Meta's page
       in the browser itself. Marked before sending: a second Enter would land on the next screen. */
    if (mine.pressed !== p.code) { mine.pressed = p.code; keys('Enter'); }
    mine.state = 'code';
    return;
  }
  if (drawn === 'waiting') { if (mine.code) mine.state = 'code'; return; }
  if (t - mine.seenAt > STUCK_MS) { mine.state = 'stuck'; mine.because = UNKNOWN; }
}
function tick() {
  const mine = S;
  if (mine && mine.timer && now() - mine.startedAt > GIVE_UP_MS) { end('expired', 'The code expired before it was approved'); return; }
  try {
    step();
    if (mine) mine.keyFailures = 0;
  } catch (e) {
    if (!mine || S !== mine || !mine.timer) return;
    mine.keyFailures = (mine.keyFailures || 0) + 1;
    if (mine.keyFailures >= MAX_KEY_FAILURES) {
      mine.state = 'stuck'; mine.because = 'Kosmos could not reach Muse Code\'s sign-in just now';
      logLine('tmux kept failing (' + ((e && (e.code || e.message)) || 'unknown') + ')');
    }
  }
}

function shq(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
/* The environment for `muse login`, added in front of the command: never HOME, never XDG. MUSE_LOGIN=1
   lets it sign in; auto-update and the installer's shell-profile edits stay off. */
const LOGIN_ENV = Object.freeze(['MUSE_LOGIN=1', 'MUSE_NO_AUTO_UPDATE=1', 'MUSE_NO_MODIFY_PATH=1']);

function start() {
  if (!musestatus.enabled()) return { ok: false, because: 'Meta Muse is not turned on for this computer' };
  if (S && S.timer) end('stopped');
  tmuxBinCached = null;
  const inst = museBin();
  if (!inst || !inst.installed) return { ok: false, because: (inst && inst.because) || 'Muse Code is not on this computer' };
  if (tmux === REAL.tmux && !live(tmuxBin(), ['-L', socket(), 'new-session', '-s', SESSION])) return { ok: false, because: COULD_NOT_START };
  const folder = path.join(folderRoot(), 'muse-signin');
  try { fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); } catch { return { ok: false, because: 'Kosmos could not make a folder for the sign-in' }; }
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* none running */ }
  try {
    // -f /dev/null: this private server never reads the person's ~/.tmux.conf.
    tmux(['-f', '/dev/null', 'new-session', '-d', '-s', SESSION, '-x', String(PANE_COLS), '-y', String(PANE_ROWS), '-c', folder,
      'exec env ' + LOGIN_ENV.join(' ') + ' ' + shq(inst.bin) + ' login']);
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
  if (!S.timer || S.state !== 'expired') return { ok: false, because: 'There is no expired code to replace' };
  // The screen, not the state, right before typing: an r on any other screen is keystrokes there.
  const text = screen();
  if (typeof text !== 'string' || screenOf(text) !== 'expired') return { ok: false, because: 'There is no expired code to replace' };
  try { keys('-l', 'r'); keys('Enter'); } catch { return { ok: false, because: 'Kosmos could not ask Muse Code for a new code' }; }
  S.state = 'starting'; S.because = null; S.seenAt = now(); S.screen = null;
  return { ok: true };
}
function stop(id) {
  if (!isMine(id)) return { ok: false, because: NOT_MINE };
  if (S.timer) end('stopped');
  return { ok: true };
}

/* ---- tests -------------------------------------------------------------------------------- */
const REAL = { tmux, museBin, now, folderRoot };
function setForTests(o) {
  if (o.tmux) tmux = o.tmux;
  if (o.museBin) museBin = o.museBin;
  if (o.now) now = o.now;
  if (o.folderRoot) folderRoot = o.folderRoot;
  if (o.tickMs) tickMs = o.tickMs;
}
function tickForTests() { tick(); }
function resetForTests() {
  if (S && S.timer) clearInterval(S.timer);
  S = null;
  ({ tmux, museBin, now, folderRoot } = REAL);
  tickMs = TICK_MS;
}

module.exports = { start, status, retry, stop, socket, SESSION, SCREENS, LOGIN_ENV, NOT_MINE, STUCK_MS, GIVE_UP_MS, screenOf, promptOf,
  setForTests, tickForTests, resetForTests };
