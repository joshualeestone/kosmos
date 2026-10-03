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
 *   - accept Antigravity's terms or decide its OPTIONAL data-sharing box (#4960: agy 1.2.12+ draws it ticked; the
 *     panel shows the terms and the box as agy has it, and Kosmos applies the person's answer, agree());
 *   - trust any folder but its own sign-in folder.
 * A screen it does not recognise is not guessed at: after a few seconds the state becomes `stuck`,
 * and the panel offers to show the window so the person can finish by hand.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const tmuxsignin = require('./tmuxsignin');   // the hidden-tmux plumbing shared with musesignin (#4195)

/* Its own tmux socket, named after this account's home (the rule is tmuxsignin.homeSocket's; here
   since review round 8, replacing round 4's per-Kosmos name). A test names its own with
   AGENT_WORKFORCE_AGY_SIGNIN_SOCKET. */
function socket() { return tmuxsignin.homeSocket('kosmos-agy-signin-', 'AGENT_WORKFORCE_AGY_SIGNIN_SOCKET'); }
const SESSION = 'agy-signin';
const TICK_MS = 1000;
const STUCK_MS = 8000;          // an unrecognised screen this long is shown, not guessed at
const GIVE_UP_MS = 30 * 60000;  // a sign-in nobody finishes ends by itself
/* Round 26: however busy a shown window's screen stays (a spinner counts as a change), it ends this
   long after Show, so agy is never left running out of sight. */
const SHOWN_MAX_MS = 2 * 60 * 60000;
const SAME_SCREEN_MS = 20000;   // a recognised screen that does not move on this long is stuck too
const CODE_RETRY_MS = 20000;    // the code screen still showing this long after a code: it was not taken
/* Round 26: while the prompt still HOLDS the code (agy has not cleared it, so it may still be trading
   it with Google), a refusal is read only after this much longer wait. */
const CODE_STALE_MS = 90000;
const CODE_PROMPT = 'Paste the authorization code:';
/* macOS `open` on the window script: Terminal can take a while to come up the first time. */
const OPEN_MS = 15000;
/* What sits on agy's code prompt now: '' when it is empty (waiting for a code). Round 28: the prompt's
   own line and the next one only (agy may echo the code on the line below), not anything drawn under. */
function promptText(text) {
  const t = String(text);
  const at = t.lastIndexOf(CODE_PROMPT);
  if (at < 0) return '';
  const rest = t.slice(at + CODE_PROMPT.length).split('\n');
  const same = (rest[0] || '').trim();
  return same || (rest[1] || '').trim();
}
/* Asking agy whether it is signed in costs a prompt on the person's subscription, so one sign-in
   asks at most this many times, however long it sits on a screen Kosmos does not know. The whole
   total (round 26): MAX_CHECKS shared by unknown screens and repeat ready-screen asks, plus the first
   look at agy's ready screen, plus one when agy exits: MAX_CHECKS + 2 at the very most. */
const MAX_CHECKS = 3;
const UNKNOWN = 'Antigravity is showing a step Kosmos does not recognise';
// On agy's own ready screen the honest reason is that the sign-in could not be confirmed, not a strange step.
const NOT_CONFIRMED = 'Kosmos could not confirm the sign-in with Antigravity just now';
/* The steps after the person's code went in: only from here can agy be signed in, so only from here is
   it asked (a signed-out agy asked "are you signed in" may open a second Google page). */
const AFTER_CODE = Object.freeze(['code-sent', 'theme', 'terms', 'trust']);
/* When a screen Kosmos does not know may be asked about (round 14): only once a setup screen has shown
   Google took the code. Just after the code, agy may still be trading it with Google, or refusing it,
   and a signed-out agy asked may open a second Google page. (agy EXITING after the code is still asked:
   AFTER_CODE above.) */
const ASK_STEPS = Object.freeze(['trust']);   // round 16: a yes after theme or terms would end the sign-in with the setup unfinished
/* A screen that keeps coming back more than this often is shown, not driven round (round 8). */
const MAX_VISITS = 3;
/* #4960: keys Kosmos sends on the terms after the person agreed (a toggle, Down, Right, Enter is four) before it shows
   the screen instead. */
const MAX_TERMS_KEYS = 6;
/* #4960: the only hosts the terms' links may point at (agy 1.2.12 and 1.2.14 show antigravity.google/terms and
   policies.google.com/privacy). Exact hosts, not any google.com (sites.google.com and redirects are someone else's
   page under the label "Terms of Service"). Anything else is left out of the panel rather than linked. */
const TERMS_HOSTS = new Set(['antigravity.google', 'policies.google.com']);
/* The size of agy's hidden terminal: wide enough that its Google URL and the trust folder's path are
   not wrapped mid-word (the screen readers match on whole lines), tall enough for its longest screen. */
const PANE_COLS = 120;
const PANE_ROWS = 40;
/* The trust answer Kosmos presses (agy 1.2.11, Josh's screenshot): exactly this label, nothing broader. */
const TRUST_YES = /^>\s*Yes, I trust this folder\s*$/;

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
function screenOf(text, skip) {
  let best = null; let at = -1;
  for (const [k, re] of Object.entries(SCREENS)) {
    if (k === skip) continue;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text)) !== null) { if (m.index > at || (m.index === at && best === null)) { at = m.index; best = k; } if (m[0] === '') g.lastIndex += 1; }
  }
  return best;
}

/* ---- seams a test replaces -------------------------------------------------------------- */
/* tmuxBin (looked up once, round 10), the live-execution gate (convention 3) and the tmux call with
   its kosmosInternal marking (round 15) and piped stderr (round 21) are shared: engine/tmuxsignin.js. */
const { tmuxBin, shq } = tmuxsignin;   // functions, so forgetTmuxBin still reaches the cache behind tmuxBin
function live(file, args) { return tmuxsignin.live('agysignin', file, args); }
let tmux = (args) => tmuxsignin.runTmux('agysignin', socket(), args);
let openFile = (file, done) => {
  if (!live('/usr/bin/open', [file])) { done(new Error('live execution is off')); return; }
  execFile('/usr/bin/open', [file], { timeout: OPEN_MS }, (err) => done(err));
};
let confirmSignedIn = () => require('./agystatus').check();
let agyBin = () => require('./agystatus').installed();
let now = () => Date.now();
let tickMs = TICK_MS;   // a test sets it out of the way, so only its own ticks run (round 24)
let folderRoot = () => require('./store').ROOT;

/* ---- one session at a time --------------------------------------------------------------- */
let S = null;   // { id, state, url, because, step, folder, lastSeen, timer, busy, startedAt, checks, ... }

function signinFolder() { return path.join(folderRoot(), 'agy-signin'); }

/** What a screen is told: never the folder, never the raw screen (#4960: only `seen`, a few masked lines, when stuck). */
function status() {
  if (!S) return { state: 'idle' };
  const out = { id: S.id, state: S.state, step: S.step || null };
  if (S.url) out.url = S.url;
  if (S.because) out.because = S.because;
  if (S.shown) out.shown = true;   // the window is the person's now; the panel says so
  if (S.showFailed) out.showFailed = true;   // it did not open: the panel offers it again
  if (S.refusals) out.refusals = S.refusals;
  /* #4960: the terms as agy shows them, for the panel to ask the person (never ticked or agreed on their behalf). */
  if (S.state === 'terms' && S.terms) out.terms = { dataUse: S.terms.dataUse, termsUrl: S.terms.termsUrl, privacyUrl: S.terms.privacyUrl };
  if (S.state === 'stuck' && S.seen && S.because === UNKNOWN) out.seen = S.seen.slice();
  return out;
}

/* The screen's text; null when the session is GONE (agy exited); undefined when tmux did not
   answer this once (a slow machine, a timeout), which is not agy exiting: the next tick tries again. */
function screen() {
  try { return tmux(['capture-pane', '-p', '-J', '-t', SESSION]); } catch { /* is it gone, or slow? */ }
  try { tmux(['has-session', '-t', SESSION]); return undefined; } catch (e) {
    return tmuxsignin.deliveryUnknown(e) || (e && e.kosmosInternal) ? undefined : null;
  }
}
function keys(...k) { tmux(['send-keys', '-t', SESSION].concat(k)); }

/* One line per sign-in that ends, and per failure at the tmux/open boundary (round 17): a stuck sign-in
   on someone's Mac must leave something to read besides a state name. Never the code or the screen. */
function logLine(what) { try { console.error('agy sign-in: ' + what); } catch { /* nothing to log to */ } }
function end(state, because) {
  if (!S) return;
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
  S.state = state;
  S.because = because || null;
  logLine('ended ' + state + (because ? ' (' + because + ')' : '') + ' at step ' + (S.step || 'none'));
  try { tmux(['kill-session', '-t', SESSION]); } catch { /* already gone */ }
  // The throwaway window script goes with the session (the remembered sign-in lives elsewhere, agystatus).
  try { fs.rmSync(path.join(S.folder, 'show-sign-in.command'), { force: true }); } catch { /* none */ }
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
/* #4960: what the terms screen says (agy 1.2.12/1.2.14, MEASURED): the data-use box starts focused and TICKED
   ("  > [x] Yes, I agree ..."), Enter toggles it, Down moves to the buttons ("  >  Previous       [Done]"), Right
   selects Done ("    [Previous]    >  Done "): the selected button loses its brackets and its ">" sits MID-LINE.
   agy 1.2.11 drew each item on its own line ("> [Done]"). Both are read here; on 1.2.11's layout only a "no" is
   driven (Down to Done with the box left unticked): a "yes" there needs an Up to the box, which is not sent, so it
   ends stuck with the window offered (round 2: a safe limit, for a version no longer shipped).
   Returns { dataUse: true|false|null, focus: 'box'|'previous'|'done'|null, sameRow, termsUrl, privacyUrl }. */
function safeLink(u) {
  try {
    const x = new URL(String(u).replace(/[.,;:)\]]+$/, ''));   // a sentence's own punctuation is not the address
    return x.protocol === 'https:' && TERMS_HOSTS.has(x.hostname) && !x.port && !x.username && !x.password ? x.href : null;
  } catch { return null; }
}
function termsOf(text) {
  const t = String(text);
  const at = t.lastIndexOf('Terms of Service & Data Use');
  const lines = (at >= 0 ? t.slice(at) : t).split('\n');
  const out = { dataUse: null, focus: null, sameRow: false, termsUrl: null, privacyUrl: null };
  for (const l of lines) {
    const box = l.match(/^\s*(>\s*)?\[( |x|X)\]\s*Yes, I agree/);
    if (box) { out.dataUse = box[2] !== ' '; if (box[1]) out.focus = 'box'; continue; }
    const prev = /Previous\b/.test(l);
    const done = /\bDone\b/.test(l);
    if (prev && done) out.sameRow = true;
    if (done && />\s*\[?Done\b/.test(l)) out.focus = 'done';
    else if (prev && />\s*\[?Previous\b/.test(l)) out.focus = 'previous';
    const tos = l.match(/Terms of Service:\s*(\S+)/);
    if (tos) out.termsUrl = safeLink(tos[1]);
    const pp = l.match(/Privacy Policy:\s*(\S+)/);
    if (pp) out.privacyUrl = safeLink(pp[1]);
  }
  return out;
}
/* #4960: the last lines of a screen Kosmos did not recognise (the newest screen is drawn last), for the panel and the
   log, so a stuck sign-in says what it saw. Long tokens (a code, a key), e-mail addresses and paths are masked;
   box-drawing and blank lines are dropped. */
function seenOf(text) {
  return String(text).split('\n')
    .map((l) => l.replace(/[\u2500-\u259f]/g, '').trim())
    .filter((l) => l)
    .slice(-6)
    .map((l) => l.replace(/(?:~|\/(?:Users|home|private|var|tmp))\/\S*/g, '<path>'))
    .map((l) => l.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<email>').replace(/[A-Za-z0-9/_\-.~+=]{24,}/g, '<long>').slice(0, 120));
}
function stuckUnknown(text) {
  S.state = 'stuck'; S.because = UNKNOWN;
  S.seen = seenOf(text);
  logLine('stuck on a screen Kosmos does not recognise: ' + S.seen.join(' | '));
}

/* The folder the trust screen names (the line after "Accessing workspace:"). */
function trustFolder(text) {
  const lines = String(text).split('\n').map((l) => l.trim());
  // The LAST prompt on screen (round 14): the one whose "Yes" the marker is on (the newest-wins rule).
  let at = -1;
  lines.forEach((l, i) => { if (/^Accessing workspace:/.test(l)) at = i; });
  if (at < 0) return null;
  // A box border or a "~" around the path (round 12) is not part of it.
  const clean = (l) => {
    const t = String(l).replace(/^[\s\u2500-\u257f|]+|[\s\u2500-\u257f|]+$/g, '');
    return t.startsWith('~/') || t === '~' ? path.join(require('node:os').homedir(), t.slice(1)) : t;
  };
  const inline = clean(lines[at].replace(/^Accessing workspace:\s*/, ''));
  if (inline) return inline;
  return lines.slice(at + 1).map(clean).find((l) => l) || null;
}
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
  } catch (e) {
    if (!mine || S !== mine || !mine.timer) return;
    /* Only a failure that proves the key never went out re-arms it (round 14). A timeout says nothing
       about delivery (tmux may have sent it), and a second Enter could land on the next screen: the
       screen is then left to the same-screen rule, which shows it if nothing moved. */
    const unknownDelivery = tmuxsignin.deliveryUnknown(e);
    if (!unknownDelivery) { mine.pressed = false; mine.termsKeyFrom = null; }
    mine.keyFailures = (mine.keyFailures || 0) + 1;
    if (mine.keyFailures >= MAX_KEY_FAILURES) {
      mine.state = 'stuck'; mine.because = 'Kosmos could not reach Antigravity\'s sign-in just now';
      logLine('tmux kept failing (' + ((e && (e.code || e.message)) || 'unknown') + ')');
    }
  }
}
/* The setup screen agy's ready line is drawn OVER, else null. One rule for the tick and for code()'s
   last look before typing (round 23). Round 20: before the trust step, theme, terms or trust under the
   ready line is that screen, not the end. Round 24 (reverses round 22's "any known screen"): the code
   screen or the menu under a ready line is the READY screen, whose earlier words were left above it
   (round 4): read as the code screen, a second code went onto agy's ready prompt. After trust, nothing
   holds the ready screen up. */
function underReady(text) {
  if (!S || S.step === 'trust') return null;
  const under = screenOf(text, 'ready');
  return under === 'theme' || under === 'terms' || under === 'trust' ? under : null;
}
/* The ready line itself (the last one drawn), so "the same ready screen twice" is about that line, not
   a spinner or tip elsewhere in the frame (round 24: a changing frame held the sign-in for 30 minutes). */
function readyLineOf(text) {
  const lines = String(text).split('\n').filter((l) => SCREENS.ready.test(l));
  return lines.length ? lines[lines.length - 1].trim() : null;
}
function step() {
  if (!S || S.busy) return;
  /* Round 25: once the window is shown the person is driving it, so the half hour counts from the last
     time its screen changed, not from the start: a person still working in it is never cut off. */
  const since = S.shown ? Math.max(S.startedAt, S.lastChangeAt || 0) : S.startedAt;
  if (now() - since > GIVE_UP_MS || (S.shown && S.shownAt && now() - S.shownAt > SHOWN_MAX_MS)) { end('failed', 'the sign-in was not finished, so Kosmos stopped it'); return; }
  const text = screen();
  if (typeof text === 'string' && text !== S.lastText) { S.lastText = text; S.lastChangeAt = now(); }
  /* Gone only when tmux says so twice in a row (round 13): one failed has-session can be a hiccup
     (a fork failure, a moved binary), and "gone" ends the sign-in or spends an ask. */
  if (text === null) { S.goneMisses = (S.goneMisses || 0) + 1; if (S.goneMisses < 2) return; } else if (text !== undefined) S.goneMisses = 0;
  if (text === null) {
    // The session is gone: agy exited. Signed in or not is agy's own answer. The answer is for THIS
    // session only: a Stop and a new Sign in while it was out must not be ended by it.
    // Not counted against MAX_CHECKS: it happens once at most, since the sign-in ends right after it.
    /* Before a code went in, agy cannot have signed in, and asking a signed-out agy may open a Google
       page of its own (round 10): it ends as not finished without asking. A window the person drove
       may have finished it, so that one is asked. */
    /* Round 19: an exit before the trust question is not asked either, the same gate as ASK_STEPS
       (round 16): a yes there would end the sign-in done with agy's setup unfinished. */
    if (!S.shown && !ASK_STEPS.includes(S.step)) {
      end('failed', AFTER_CODE.includes(S.step) ? 'Antigravity closed before its setup finished' : 'Antigravity closed before the sign-in finished');
      return;
    }
    const mine = S;
    mine.busy = true;
    Promise.resolve().then(() => confirmSignedIn()).then((r) => {   // a throw is a rejection, so busy is always cleared
      mine.busy = false;
      if (S !== mine || !mine.timer) return;   // stopped or replaced while agy was asked
      if (r && r.signedIn === true) end('done');
      else end('failed', 'Antigravity closed before the sign-in finished');
    }, () => { mine.busy = false; if (S === mine && mine.timer) end('failed', 'Antigravity closed before the sign-in finished'); }).catch(() => { mine.busy = false; });   // round 9: nothing a callback throws escapes (no process handler)
    return;
  }
  if (text === undefined) return;
  let name = screenOf(text);
  /* Round 20: agy's ready line drawn under a setup screen still being answered (a status footer) is
     not the end: before the trust step, a frame that also shows theme, terms or trust is that setup
     screen. (After trust, words it left behind above the ready line do not hold the ready screen up.) */
  if (name) S.lastUnknown = null;   // "the same unknown frame twice" means twice IN A ROW (round 20)
  if (name === 'ready') {
    const under = underReady(text);
    if (under) name = under;
    /* Round 22: a footer caught alone between two setup screens must be the same frame on two ticks
       in a row before agy is asked. */
    else if (S.step && S.step !== 'trust' && !S.shown && readyLineOf(text) !== S.lastReady) { S.lastReady = readyLineOf(text); return; }
  }
  if (name !== 'ready') S.lastReady = null;
  /* A blank frame caught mid-redraw is not a new screen (round 10): it must not clear `pressed` and
     send the same key again when the screen comes back. */
  /* Only a DIFFERENT KNOWN screen is a new screen (round 12): a frame Kosmos does not recognise (a
     blank or half-drawn redraw) leaves the last known one in place, so when that screen is drawn
     again its key is not sent again (a second Enter on the terms could land on the trust question
     and answer it without the folder check). Time on an unknown screen is its own clock below. */
  const changed = name !== null && name !== S.screen;
  if (changed) {
    S.screen = name; S.screenSince = now(); S.pressed = false; S.termsKeyFrom = null; S.moves = 0;
    if (name) {
      S.seenKnown = true;
      /* A screen that keeps coming back (Enter landing on "Previous" loops terms -> theme -> terms)
         is shown, not driven round for half an hour (round 8). */
      S.visits = S.visits || {};
      S.visits[name] = (S.visits[name] || 0) + 1;
      if (S.visits[name] > MAX_VISITS && name !== 'code' && !S.shown) { stuckUnknown(text); return; }
    }
  }
  if (name === 'ready') { readyCheck(text); return; }
  /* 🛑 ONCE THE WINDOW IS SHOWN, THE PERSON DRIVES (review round 4). Kosmos presses nothing more on
     a screen it knows: its keys would race theirs (a Done pressed before they tick the box they
     meant to). It still watches for the end: agy exiting (above), its ready screen, and a screen it
     does not know, which it may ask agy about (the bounded asks below press nothing; round 6). */
  if (S.shown && name) return;
  if (!changed && name && S.state === 'stuck') return;   // shown to the person; nothing more is pressed on it
  /* A recognised screen that stays the same this long is stuck too (a changed default, a cursor
     that is not where Kosmos expects): the code screen is exempt, it waits for the person. */
  /* #4960: and the terms while the person is being asked them (state 'terms'): that screen waits for the person too.
     Not a terms frame that never draws the box (round 2): that is a screen Kosmos cannot read, and is shown. */
  if (!changed && name && name !== 'code' && !(name === 'terms' && !S.agreed && S.state === 'terms') && now() - S.screenSince > SAME_SCREEN_MS) {
    stuckUnknown(text);
    return;
  }
  const seen = (n) => name === n;   // the screen drawn NOW, not words an earlier one left behind
  if (seen('menu')) {
    // "> 1. Google OAuth" is the default choice; press Enter only when it is the marked one.
    /* Back at the menu (stuck, or after a code agy did not take, round 18): the sign-in starts over, so
       the next code screen asks for a code again instead of sitting on "checking". */
    /* Round 19: the step starts over too, so a stale 'trust' left from the last attempt cannot make an
       exit in the next tick look like one after the setup. */
    if (S.state === 'stuck' || S.state === 'checking' || AFTER_CODE.includes(S.step)) { S.state = 'starting'; S.because = null; S.step = null; S.codeSentAt = null; }
    // Anchored to the marker (round 8): the words must be the item the ">" is on, not anywhere on its line.
    if (/^>\s*(1\.\s*)?Google OAuth\b/.test(markedLine(text)) && !S.pressed) { S.step = 'menu'; S.pressed = true; keys('Enter'); }
    S.lastSeen = now();
    return;
  }
  if (seen('terms')) {
    /* #4960: the data-use box is OPTIONAL and agy now draws it already ticked, so pressing Done would opt the person
       in. Kosmos shows the terms in its own panel (the links, and the box as agy has it) and presses nothing until the
       person answers there (agree()). Then: Enter on the box only if it differs from their answer, Down to the
       buttons, Right to Done (Down where agy draws the buttons on lines of their own), Enter on Done. One key per
       change of the screen, at most MAX_TERMS_KEYS, so a slow redraw never carries a key onto the trust question. */
    S.step = 'terms'; S.lastSeen = now();
    const tm = termsOf(text);
    if (!S.agreed) {
      /* Only once the box itself is drawn (round 1): a half-drawn first frame would give the panel "unticked" while
         Antigravity has it ticked, and the panel sets its box once. Until then it is still setting up, and a box that
         never comes goes stuck by the same-screen rule above (round 2). */
      if (tm.dataUse === null) { if (S.state !== 'terms') { S.state = 'setup'; S.because = null; } return; }
      /* A redraw that has not drawn the link lines yet keeps the links already read (round 2): the panel must not lose
         the link the person may be on. */
      const was = S.terms || {};
      S.terms = { ...tm, termsUrl: tm.termsUrl || was.termsUrl || null, privacyUrl: tm.privacyUrl || was.privacyUrl || null };
      if (S.state !== 'terms') { S.state = 'terms'; S.because = null; }
      return;
    }
    S.state = 'setup'; S.because = null;
    if (S.pressed) return;
    const sig = String(tm.dataUse) + '|' + tm.focus;
    if (S.termsKeyFrom === sig) return;   // the last key has not landed yet
    let key = null;
    if (tm.focus === 'box') key = tm.dataUse === S.agreed.dataUse ? 'Down' : 'Enter';
    else if (tm.focus === 'previous') key = tm.sameRow ? 'Right' : 'Down';
    else if (tm.focus === 'done') {
      /* Done only on a frame that SHOWS the box as the person chose (round 1): a box not drawn in this frame is no key
         (the same-screen rule shows the window if it never comes), and one drawn the other way is stuck. */
      if (tm.dataUse === null) return;
      if (tm.dataUse !== S.agreed.dataUse) { S.state = 'stuck'; S.because = 'Kosmos could not set Antigravity\'s data-sharing choice the way you chose it'; return; }
      key = 'Enter';
    }
    if (!key) return;   // no marker drawn yet: wait for the full frame (round 26)
    if (S.moves >= MAX_TERMS_KEYS) { S.state = 'stuck'; S.because = 'Kosmos could not find the Done button on Antigravity\'s terms'; return; }
    S.termsKeyFrom = sig;   // BEFORE the send (round 16): a key that timed out may have gone out
    if (key === 'Enter' && tm.focus === 'done') S.pressed = true;
    keys(key); S.moves += 1;
    return;
  }
  if (seen('trust')) {
    const folder = trustFolder(text);
    if (!folder || !samePath(folder, S.folder)) {
      /* Never trust any folder but Kosmos's own sign-in folder. Shown rather than ended (round 12): the
         Google sign-in may already be saved, and the person can answer this one in the window. */
      if (S.state !== 'stuck') { S.state = 'stuck'; S.because = 'Antigravity asked to trust a folder Kosmos did not choose, so Kosmos left that question to you'; }
      return;
    }
    S.state = 'setup'; S.because = null;
    // The step becomes 'trust' only once its Enter went out (round 17): asking agy (and so a done) waits for it.
    // Anchored to the measured label (round 20): a broader "Yes" an update might offer is not pressed.
    if (TRUST_YES.test(markedLine(text)) && !S.pressed) { S.pressed = true; keys('Enter'); S.step = 'trust'; }
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
    const holding = promptText(text) !== '';
    if (S.step === 'code-sent' && now() - S.codeSentAt > (holding ? CODE_STALE_MS : CODE_RETRY_MS)) {
      // Still asking for a code well after one was typed: Google's code was not taken (expired, or
      // copied short). Ask again rather than wait here for half an hour.
      S.state = 'code'; S.step = 'code';
      S.because = 'Antigravity did not take that code. Copy the newest code from Google\'s page and paste it again.';
      S.refusals = (S.refusals || 0) + 1;   // the same words twice are two refusals (the page refocuses on each)
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
  /* Only after the LAST setup screen (round 6): between theme and terms a blank redraw is not agy's
     ready screen, and a yes there would end the session before terms and trust were answered. */
  const settled = S.step === 'trust';
  /* Nothing is asked before agy has drawn a screen Kosmos knows (round 8): a signed-out check may
     open a Google page of its own, and a second page while the person signs in on the first hands
     them the wrong code. An already signed-in agy is its ready screen (readyCheck), and a window the
     person drives may still be asked about. */
  /* Round 10: not merely "a known screen was seen" (the menu counts, before any code): only once the
     code has gone in or the setup screens are under way, or the person drives the window. */
  /* Round 20: only a screen that is really drawn is asked about: never a blank frame, and in the
     shown window the same frame on two ticks in a row (the person's keys make agy redraw, and a yes
     on a passing frame mid-setup would end it done and close their window). */
  const blank = !text.trim();
  const steady = text === S.lastUnknown;
  S.lastUnknown = text;
  const shownMayAsk = S.shown && steady;
  const mayAsk = !blank && (shownMayAsk || ASK_STEPS.includes(S.step));
  const ask = mayAsk && S.checks < MAX_CHECKS && (S.state === 'stuck'
    ? text !== S.stuckText && now() - S.lastCheckAt > STUCK_MS   // a redrawing screen does not spend them all at once
    : settled || now() - S.lastSeen > STUCK_MS);
  if (!ask) {
    if (S.state !== 'stuck' && now() - S.lastSeen > STUCK_MS) { stuckUnknown(text); S.stuckText = text; }
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
  }).catch(() => {   // round 9: nothing a callback throws escapes (no process handler)
    mine.busy = false;
    if (S === mine && mine.timer) { mine.state = 'stuck'; mine.because = UNKNOWN; }   // round 13: shown, not left stale
  });
}

/* agy's ready screen: signed in, very likely. It is confirmed once (a prompt on the person's
   subscription), even when the unknown-screen asks are spent, because this is the one screen that
   says the person may have finished. A "no" leaves it stuck; the same ready screen is not asked
   about again. */
function readyCheck(text) {
  /* Once, except in the shown window (round 24): after a "could not confirm", the person may finish or
     see it signed in there, and the panel says Kosmos notices. The ready screen is asked at most
     MAX_CHECKS times in all (the first included), STUCK_MS apart. */
  if (S.readyChecked && !(S.shown && S.checks < MAX_CHECKS && now() - S.lastCheckAt > STUCK_MS)) return;
  const mine = S;
  if (mine.readyChecked) mine.checks += 1;   // round 26: a repeat spends from the one budget
  mine.readyChecked = true; mine.busy = true; mine.lastCheckAt = now();
  if (mine.state !== 'stuck') mine.state = 'checking';
  Promise.resolve().then(() => confirmSignedIn()).then((r) => {
    mine.busy = false;
    if (S !== mine || !mine.timer) return;
    if (r && r.signedIn === true) { end('done'); return; }
    mine.state = 'stuck'; mine.because = NOT_CONFIRMED; mine.stuckText = text;
  }, () => {
    mine.busy = false;
    if (S !== mine || !mine.timer) return;
    mine.state = 'stuck'; mine.because = NOT_CONFIRMED; mine.stuckText = text;
  }).catch(() => {   // round 9: nothing a callback throws escapes (no process handler)
    mine.busy = false;
    if (S === mine && mine.timer) { mine.state = 'stuck'; mine.because = NOT_CONFIRMED; }   // round 13: shown, not left stale; round 19: the ready screen's own reason
  });
}

/** Start a sign-in (ending any earlier one). */
function start() {
  if (S && S.timer) end('stopped');   // only a sign-in still running is stopped (round 18: no false log line)
  tmuxsignin.forgetTmuxBin();   // looked up again for each sign-in (the person may have installed tmux since)
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
    tmux(['-f', '/dev/null', 'new-session', '-d', '-s', SESSION, '-x', String(PANE_COLS), '-y', String(PANE_ROWS), '-c', folder, 'exec ' + shq(inst.bin)]);
  } catch (e) {
    logLine('could not start (' + ((e && (e.code || e.message)) || 'unknown') + ')');
    return { ok: false, because: 'Kosmos could not start Antigravity\'s sign-in just now' };
  }
  S = { id: crypto.randomBytes(8).toString('hex'), state: 'starting', url: null, because: null, step: null, folder,
    startedAt: now(), lastSeen: now(), timer: null, busy: false, checks: 0, lastCheckAt: 0, moves: 0, termsKeyFrom: null };
  S.timer = setInterval(tick, tickMs);
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
  // The window is the person's once shown (round 5): a code from another tab must not race their typing.
  if (S.shown) return { ok: false, because: 'The sign-in window is open now, so finish it there' };
  if (S.state !== 'code') return { ok: false, because: 'Antigravity is not waiting for a code' };
  const v = String(value || '').trim();
  if (!CODE_RE.test(v)) return { ok: false, because: 'That does not look like the code from Google\'s page' };
  /* 🛑 THE SCREEN, NOT THE STATE, right before typing (review round 4): the state can be a tick
     behind, and a code typed onto another screen is keystrokes there (on the ready screen, a
     prompt spent on the subscription). */
  const now_ = screen();
  // The tick's own reading (round 24): only the code screen itself; with the ready line under it, agy has moved on.
  const drawn = typeof now_ === 'string' ? screenOf(now_) : null;
  // Round 26: never over the code just sent while agy may still be reading it.
  if (drawn === 'code' && S.step === 'code-sent' && promptText(now_) !== '') return { ok: false, because: 'Antigravity is still checking the last code' };
  if (drawn !== 'code') return { ok: false, because: 'Antigravity is not waiting for a code' };
  // C-u first (round 12): a code left half-sent by an earlier failed try is cleared, not doubled.
  try { keys('C-u'); keys('-l', '--', v); keys('Enter'); } catch (e) {
    logLine('could not pass the code (' + ((e && (e.code || e.message)) || 'unknown') + ')');   // never the code itself
    return { ok: false, because: 'Kosmos could not pass the code to Antigravity' };
  }
  S.state = 'checking'; S.step = 'code-sent'; S.because = null; S.lastSeen = now(); S.codeSentAt = now();
  return { ok: true };
}

/** #4960: the person's answer to the terms, from Kosmos's panel. dataUse is their choice for the OPTIONAL box. */
function agree(id, opts) {
  if (!isMine(id)) return { ok: false, because: NOT_MINE };
  if (S.shown) return { ok: false, because: 'The sign-in window is open now, so finish it there' };
  if (S.state !== 'terms') return { ok: false, because: 'Antigravity is not showing its terms just now' };
  const dataUse = opts && opts.dataUse;
  if (dataUse !== true && dataUse !== false) return { ok: false, because: 'Kosmos needs to know whether to share your usage data with Google' };
  S.agreed = { dataUse };
  S.state = 'setup'; S.because = null; S.termsKeyFrom = null; S.moves = 0; S.screenSince = now();
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
    } catch (e) { logLine('could not write the window script (' + ((e && e.code) || 'unknown') + ')'); resolve({ ok: false, because: 'Kosmos could not open the sign-in window' }); return; }
    /* From here the person drives, set BEFORE the window opens (round 6): `open` can time out after
       Terminal has come up, and pressing nothing is the safe way to be wrong. Stop still works. */
    S.shown = true;
    if (!S.shownAt) S.shownAt = now();
    /* #4960 round 1: shown on the terms, the person answers them in the window (agree() refuses once shown), so the
       panel stops asking: the shown-window state, not 'terms' forever. */
    if (S.state === 'terms') { S.state = 'stuck'; S.because = 'Antigravity is showing its terms; answer them in the window'; }
    const mine = S;
    openFile(file, (err) => {
      /* An `open` that failed outright (not a timeout, which may have opened Terminal anyway) opened
         nothing: the panel says so and offers it again rather than claiming a window (round 10). */
      if (S === mine) mine.showFailed = !!err && !err.killed && !err.signal;
      if (err) logLine('open ' + (err.killed || err.signal ? 'timed out' : 'failed') + ' (' + (err.code || err.signal || 'unknown') + ')');
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
  if (o.tickMs) tickMs = o.tickMs;
}
function tickForTests() { tick(); }
const REAL = { tmux, openFile, confirmSignedIn, agyBin, now, folderRoot };
/** Ends any session and puts every seam back. */
function resetForTests() {
  if (S && S.timer) clearInterval(S.timer);
  S = null;
  ({ tmux, openFile, confirmSignedIn, agyBin, now, folderRoot } = REAL);
  tickMs = TICK_MS;
}

module.exports = { start, status, code, agree, show, stop, socket, SESSION, SCREENS, CODE_RE, MAX_CHECKS, MAX_KEY_FAILURES, NOT_MINE, screenOf,
  urlFrom, markedLine, trustFolder, termsOf, seenOf, setForTests, tickForTests, resetForTests };
