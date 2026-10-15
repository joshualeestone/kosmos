'use strict';
/**
 * #3939 slice 3c-3a: what runs in a Meta Muse agent's tmux pane.
 *
 * Every other runner puts the vendor's own terminal program in the pane. Muse's is not one Kosmos
 * can read from outside (the card's spike: its screen does not read back), and Meta's headless route
 * is one `muse exec` per turn. So the pane runs this instead: it takes each message the board types
 * into the pane and runs ONE Muse turn for it through engine/muserun.runTurn, on this agent's own
 * session, and prints the answer. Delivery, restart, stop and logs are the ordinary tmux ones.
 *
 * Input is read in RAW mode. engine/chat.js always types a message as ONE line (its whitespace is
 * flattened, #3419) and then presses Enter separately, so one carriage return ends one message.
 * Cooked mode would not do: macOS cuts a cooked line at 1024 bytes, and a Kosmos message can be longer.
 *
 * Turns run one at a time: Muse refuses a second turn on a session that is still busy, so a message
 * typed during a turn waits for it. Escape ends the running turn and drops the waiting ones.
 *
 * #4569 (Josh, 11:57: Mark ignored "stop" twice, behind 14 room posts): the waiting order is NOT
 * arrival order. A message from the person (the operator envelopes engine/messages.js mints and
 * refuses inside any agent's text, so an agent cannot forge one) goes ahead of everyone else's,
 * behind only the person's own earlier ones and a stop note that is waiting. A person's short
 * stop request ends the running turn and drops what waits, like Escape, then runs as the next
 * turn with a note naming what was dropped, so the agent can say it stopped. Background room
 * posts ("not addressed to you") that pile up while a turn runs are folded into one turn.
 *
 * The board hears working and idle through bin/agy-report-bridge.js (its PreInvocation and Stop
 * events map to those two states, and it carries the board token, the world header, the per-pane
 * throttle and the never-break-the-agent contract).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMPT = '> ';
const HELLO = 'Meta Muse, run by Kosmos. Messages typed here go to Muse one turn at a time.';

/** Where this agent's Muse session id is kept, inside its own folder. */
function sessionFile(workspace) { return path.join(workspace, '.kosmos', 'muse-session'); }

/* #4603 N12 (0.7.15 diagnostic, a Meta agent): whoami and the board could not name a Muse agent's model, because Muse
   says it only inside each turn (muserun: run.model.configured). The front keeps it here, beside the session id, as
   soon as a turn names it (#4603 R7), and engine/status.js readMuseSession reads it as every other runner's own record is read. */
function modelFile(workspace) { return path.join(workspace, '.kosmos', 'muse-model'); }

/** Keep the model a turn named, when it changed. Never throws: a model that cannot be kept is only not shown. */
function keepModel(workspace, model) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return false;   // review 3: never a relative path
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) return false;
  const file = modelFile(workspace);
  // A `.kosmos` that is a link is not written through (review 2), nor a link or fifo at the file (review 1).
  try { if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) return false; } catch { /* made below */ }
  let st = null;
  try { st = fs.lstatSync(file); } catch { st = null; }
  if (st && !st.isFile()) return false;
  if (st) {
    // The same bounded, non-blocking read the board uses (review 2), so a swap in the window cannot hang this front.
    const got = require('./workerfile').readWorkerFile(file, workspace);
    if (got && got.ok && got.buf.toString('utf8').trim() === model) return true;
  }
  // Review 3: securewrite's temp is a unique name opened exclusively ('wx'), so nothing planted at a predictable name is
  // followed. Review 4, restated: the only files ever removed are this file's own temps whose writer is provably dead.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // #5434 slice 23: flushed before the rename (mode 0600; ownTempsOnly, the person's workspace is not Kosmos's folder)
    require('./securewrite').writeSecret(file, model + '\n', 0o600, { atomicOnly: true, ownTempsOnly: true });
    return true;
  } catch {
    return false;
  }
}

/* At the front's start the last life's model is forgotten (review 1): a Muse agent moved to another provider and back,
   or signed in again, must not show an old model until its first turn names the current one. */
function forgetModel(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return false;
  // Review 4: the same guard as keepModel; a `.kosmos` that is a link is not reached through.
  try { if (fs.lstatSync(path.dirname(modelFile(workspace))).isSymbolicLink()) return false; } catch { return false; }
  // Review 3: any entry but a folder goes (a planted link or fifo too: unlinking touches the entry, never its target),
  // so nothing left there can hide the model for good.
  try { const st = fs.lstatSync(modelFile(workspace)); if (!st.isDirectory()) fs.unlinkSync(modelFile(workspace)); return true; }
  catch { return false; }
}

/* The front's start-up, outside main() so a test reaches the real step (review 3): the session id kept or made, and the
   last life's model forgotten. */
function startup(workspace, o) {
  const got = loadSession(workspace, o);
  forgetModel(workspace);   // #4603 N12: no model is claimed until a turn of this life names one
  return got;
}

/**
 * This agent's session id: the one kept in its folder, or a new one written there. { id, note } where
 * note says, in words, when a new one had to be made over an unreadable one. Never throws: if the id
 * cannot be written the agent still runs, on a session that lasts until the front restarts.
 */
function loadSession(workspace, o = {}) {
  const file = sessionFile(workspace);
  const make = o.randomUUID || crypto.randomUUID;
  let note = null;
  try {
    const kept = fs.readFileSync(file, 'utf8').trim();
    if (UUID_RE.test(kept)) return { id: kept, note: null };
    note = 'The saved Muse session could not be read, so this agent starts a new one.';
  } catch (e) {
    if (e && e.code !== 'ENOENT') note = 'The saved Muse session could not be read, so this agent starts a new one.';
  }
  const id = make();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id + '\n', { mode: 0o600 });
    fs.chmodSync(file, 0o600);   // a file that was already there keeps its old mode otherwise
  } catch {
    note = 'Kosmos could not save this agent\'s Muse session, so a restart will start a new one.';
  }
  return { id, note };
}

/**
 * Muse's answer can quote anything it read, including terminal control sequences (a clipboard write,
 * a cursor move that hides text). Only newline and tab survive; every other C0 and C1 control is removed.
 */
function printable(t) {
  return String(t).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

/* #4569: who a typed message is from, by the envelope the board put on it. */
const OPERATOR_PREFIXES = ['[message from your operator', '[from your operator'];
const BACKGROUND_PREFIX = '[background from your colleague';
function kindOf(text) {
  if (OPERATOR_PREFIXES.some((p) => text.startsWith(p))) return 'operator';
  if (text.startsWith(BACKGROUND_PREFIX)) return 'background';
  return 'other';
}
/* The words after the envelope (the first "]"), or '' when there is no envelope. */
function bodyOf(text) {
  const end = text.indexOf(']');
  return end === -1 ? '' : text.slice(end + 1).trim();
}
/* The person's own words: the body without Kosmos's framing around it (review round 1). In front, a reply's
   '(answering: "...") ' (engine/messages.js, #4256 / #3745); after, the reactions note (' [kosmos] ...',
   chat.dmReactionNews, #3650) and a room's catch-up note (' [This room has been talking without you: ...'). */
function wordsOf(text) {
  let b = bodyOf(text).replace(/^\(answering: "[^"]*"\)\s*/, '');
  for (const cut of [' [kosmos] ', ' [This room has been talking']) {
    const at = b.indexOf(cut);
    if (at !== -1) b = b.slice(0, at);
  }
  return b.trim();
}
/* A short message that only asks the agent to stop. Narrow on purpose: "stop posting duplicates in
   the room and fix X" is an instruction to carry out, not a stop, so anything longer is a normal message. */
const STOP_WORDS = new Set(['stop', 'stop now', 'stop it', 'please stop', 'stop please', 'stop working', 'stop posting',
  // Not "hold": it can answer "hold or ship?" (review round 3).
  'pause', 'please pause', 'pause now', 'you can stop', 'you can pause', 'halt', 'stop stop', 'stfu']);
function isStopRequest(text) {
  if (kindOf(text) !== 'operator') return false;
  const said = wordsOf(text).toLowerCase().replace(/[.!,?\u2026]+/g, ' ').replace(/\s+/g, ' ').trim();
  return STOP_WORDS.has(said);
}
/* What the pane and the stop note call a waiting message: its words, short. */
function shortOf(text) {
  const b = wordsOf(text) || text;
  const one = b.replace(/\s+/g, ' ');
  return one.length > 60 ? one.slice(0, 57) + '...' : one;
}

/* #5636 F7a and #6065 N1: one line per message this front hands to Muse (logged before the turn, whatever its result), in the agent's own folder
   (.kosmos/muse-turns.log), so a report from a Meta seat can say what reached the agent and when. Both findings were
   Meta-only and left no trace on the board: a community reminder the board logged once a day arriving again, and long
   room posts arriving shortened. One line per turn (a stop note retried while Muse is busy is still one line; a busy digest is one line, digestPosts
   saying how many posts; a
   line dropped by a stop never reaches Muse and is not logged). Each records when it ran (at) and when it reached this
   front (arrived), the kind (operator, background, other), the UTF-16 length, the
   community reminder's Sent stamp when the line carries one (engine/communityturn.js stamped), and, for a message that
   spilled to a file (engine/messages.js spillLine), every word count and the size of each saved copy (spillBytes, read
   from the agent's own Inbox; the line itself is the shortened one, so its length cannot say how long the post was).
   A short colleague post's opening can run into its attachment trailer (a file path), which is not the person's words. The opening words (60 UTF-16 units) are kept only for
   lines starting with a colleague's or Kosmos's envelope, so a colleague's words (quoted or pasted, even a secret) can reach this file (created 0600) in
   the agent's own folder; any line holding the person's envelope (their messages, a stop note quoting them) keeps none.
   The folder may be the person's own git repository (as engine/messages.js's Inbox notes), so the log writes only
   where .kosmos/.gitignore lists it (read as text, not asked of git: a log git already tracks stays tracked): it creates .kosmos/.gitignore naming its two files when there is none, and writes nothing when
   one exists that does not name both, or holds any negation (someone else's file is not edited). The .gitignore it creates
   is itself a new, harmless file in the person's tree (two file names). A busy digest's opening comes from its first
   post (the text after its header), not from the header. A hard link at the file is refused twice: at the lstat
   (before any rotation) and after the open (a link count above one; the cut acts only on the opened file). Measured:
   the tests fail only with both removed, so they prove the pair, not each layer; a swap between the lstat and the rename or cut is not guarded. Bounded: past TURN_LOG_MAX the file moves to a .1 copy
   (so at most about twice TURN_LOG_MAX in all).
   It never throws: a log that cannot be written must not stop the turn. */
const TURN_LOG_MAX = 256 * 1024;
const SENT_RE = /\(Sent (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\. A reminder with a different Sent time/;
/* The full text of a spilled message is a file in the agent's own Inbox; its size in bytes (never fewer than its
   characters, for ASCII equal) is the body's length. The board spills when the WHOLE typed line (envelope, body and
   notes) is over chat.MAX_TEXT less the room for a kept note, so the line also records envChars (the envelope through
   its first "]"): envChars + spillBytes near or over 10000 is the shared rule, by design; well under it would be
   something Meta-specific.
   The path comes from the line, which a colleague can write, so it is looked at only when it is exactly a file
   directly in <workspace>/Inbox (no "..", no deeper folder); anything else is null, and nothing outside is touched. */
const SPILL_ALL_RE = /\(long message, (\d+) words?; the full text is in your own folder at ([^)\n]{1,1024})\)/g;
function spills(t, workspace) {
  let inbox = typeof workspace === 'string' && path.isAbsolute(workspace) ? path.join(workspace, 'Inbox') : null;
  // A linked Inbox is never Kosmos's (messages.js refuses one), and a link would take the lookup elsewhere.
  if (inbox) { try { const st = fs.lstatSync(inbox); if (!st.isDirectory() || st.isSymbolicLink()) inbox = null; } catch { inbox = null; } }
  const words = [], bytes = [];
  for (const m of String(t).matchAll(SPILL_ALL_RE)) {
    words.push(Number(m[1]));
    let size = null;
    const p = m[2];
    if (inbox && path.dirname(p) === inbox && !path.basename(p).includes('..') && path.normalize(p) === p) {
      try { const st = fs.lstatSync(p); size = st.isFile() ? st.size : null; } catch { size = null; }
    }
    bytes.push(size);
  }
  return { words, bytes };
}
function turnLogFile(workspace) { return path.join(workspace, '.kosmos', 'muse-turns.log'); }
/* Envelopes whose opening holds no words of the person's: a colleague's message or room post, and the community
   reminders ("Kosmos here:" with a colon; today's producers put no words of the person's in their first 60 units, though
   the agent's own post title can appear, and a new "Kosmos here:" line must keep the person's words out of them). Left out on purpose: "[Kosmos: you were given task N ...]" quotes the
   person's task, and the "Kosmos here," (comma) nudges can carry a task title. A busy digest is read through its first
   post (below). */
const OPENING_OK = ['[message from your colleague', BACKGROUND_PREFIX, 'Kosmos here:'];
function clipOpening(text) { const one = String(text).replace(/\s+/g, ' '); return one.length > 60 ? one.slice(0, 57) + '...' : one; }
const DIGEST_RE = /^\[Kosmos: (\d+) room posts arrived while you were busy/;
function turnRecord(text, at, arrived = null, workspace = null) {
  const t = String(text);
  const kind = kindOf(t);
  const sent = SENT_RE.exec(t);
  // Every spill in the line (a busy digest can hold several), words and saved size from one match; null when none.
  const sp = spills(t, workspace);
  const digest = DIGEST_RE.exec(t);
  // chars is UTF-16 length, the measure the board's spill rule uses (chat.MAX_TEXT), so the two compare directly.
  // tz: this front's offset from UTC in minutes at `at` (the board's clock stamps Sent; they share a machine, and
  // differ only if the two processes run with different TZ settings), so a Sent stamp (local wall-clock time) lines up with at /
  // arrived (a stamp from the other side of a daylight-saving change reads an hour off).
  const rec = { at, arrived, tz: -new Date(Number.isFinite(Date.parse(at)) ? Date.parse(at) : Date.now()).getTimezoneOffset(), kind, chars: t.length, sent: sent ? sent[1] : null, spillWords: sp.words.length ? sp.words : null,
    spillBytes: sp.words.length ? sp.bytes : null,
    envChars: sp.words.length ? t.indexOf(']') + 1 : null,
    digestPosts: digest ? Number(digest[1]) : null };
  /* The person's words stay out. An opening is kept only for a line that starts with an envelope known not to be theirs
     (a colleague's message or room post, a Kosmos line) and holds none of theirs (a stop note quotes them): text the
     person types straight into this pane has no envelope, so it keeps none (unless they type one of these envelopes
     themselves). */
  // A digest's own header has no words: its opening is its first post's (after that post's envelope).
  const first = digest ? t.slice(t.indexOf('\n') + 1).split('\n')[0] : t;
  if (OPENING_OK.some((x) => first.startsWith(x)) && !OPERATOR_PREFIXES.some((x) => t.includes(x))) {
    // A Kosmos line has no envelope to skip, so its own start is kept (a "]" inside it must not move the cut).
    rec.opening = first.startsWith('Kosmos here:') ? clipOpening(first) : shortOf(first);
  }
  return rec;
}
const TURN_LOG_IGNORE = 'muse-turns.log\nmuse-turns.log.1\n';
function turnLogIgnored(dir) {
  const ig = path.join(dir, '.gitignore');
  let st = null;
  try { st = fs.lstatSync(ig); } catch { st = null; }
  if (!st) {
    try { fs.writeFileSync(ig, TURN_LOG_IGNORE, { flag: 'wx', mode: 0o600 }); return true; } catch { return false; }
  }
  if (!st.isFile()) return false;
  // Read bounded and non-blocking, as keepModel reads (review 7), so a swap at the name cannot hang this front.
  const got = require('./workerfile').readWorkerFile(ig, path.dirname(dir));
  if (!got || !got.ok) return false;
  // Exact lines, not a git check: both names must be listed (the .1 copy is the same text), so "/muse-turns.log" or
  // "*.log" reads as not ignored and nothing is written (fail closed).
  const lines = got.buf.toString('utf8').split(/\r?\n/);
  // Any negation can un-ignore it ("!*.log", "!*"), and git takes the last match: any "!" line reads as not ignored.
  if (lines.some((l) => /^\s*!/.test(l))) return false;
  return lines.includes('muse-turns.log') && lines.includes('muse-turns.log.1');
}
/* Guards (review 1, 5): never a relative workspace, never through a `.kosmos` that is a link, never into a link or
   fifo at the file, a non-blocking, no-follow open so nothing planted there can hang this front, and no write into a
   file with another name (a hard link). keepModel needs no link-count check: it writes a temp and renames. */
function logTurn(workspace, text, at, arrived = null) {
  try {
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return;
    const file = turnLogFile(workspace);
    const dir = path.dirname(file);
    // Only .kosmos is ever made: a workspace that is gone is not recreated to hold a log.
    try { if (fs.lstatSync(dir).isSymbolicLink()) return; } catch { fs.mkdirSync(dir); }
    let st = null;
    try { st = fs.lstatSync(file); } catch { st = null; }
    if (st && (!st.isFile() || st.nlink !== 1)) return;   // a hard link is refused before rotation could touch it
    if (!turnLogIgnored(dir)) return;   // never into a file git would carry out of the person's repository
    let cut = false;
    if (st && st.size > TURN_LOG_MAX) {
      // The bound: about twice TURN_LOG_MAX in all. A rename that fails (a folder at .1) must not end the logging.
      try { fs.renameSync(file, file + '.1'); } catch { cut = true; }   // cut on the opened file below, not by path
    }
    const c = fs.constants;
    const fd = fs.openSync(file, c.O_WRONLY | c.O_APPEND | c.O_CREAT | (c.O_NOFOLLOW || 0) | (c.O_NONBLOCK || 0), 0o600);
    try {
      const f = fs.fstatSync(fd);
      if (f.isFile() && f.nlink === 1) {
        if (cut) fs.ftruncateSync(fd, 0);
        fs.writeSync(fd, JSON.stringify(turnRecord(text, at, arrived, workspace)) + '\n');
      }
    } finally { fs.closeSync(fd); }
  } catch { /* the turn runs whatever the log does */ }
}

/** While a turn runs, working is said again this often, so a long turn never reads as stale on the board. */
const WORKING_EVERY_MS = 50 * 1000;   // under the report bridge's 60 s throttle, so no beat is dropped
/* #4569 review round 1: the most background posts one digest turn carries. */
const DIGEST_MAX = 40;
/* #4569 review round 5: a stop kills the running turn and its note starts at once, while Muse may still hold the
   session ("already in use", muserun.BUSY). The note is tried again this many times, this far apart, before it
   is given up on, so what the stop dropped still reaches the agent. */
const BUSY_RETRIES = 4;
/* #4612: the most of a turn's final answer sent to the board (the DM shows it when no reply arrived). */
const FINAL_MAX = 4000;
/* #4612 review round 1: a turn that answers the person's DIRECT message (engine/messages.js operatorDirect's envelope,
   "... to answer, run: kosmos reply]"), alone or inside a stop note. A room post from the person, a colleague's or a
   background post is not: its answer belongs to the room, never under the person's DM.
   The envelope must START the prompt, or start the line after a stop note's own first line (a stop note is that line
   and then the person's stop DM): a room post that quotes the envelope further down is not the person's DM. */
const DM_ENVELOPE = /^\[message from your operator[^\]\n]*to answer, run: kosmos reply\]/;
const STOP_NOTE_HEAD = /^\[Kosmos: your operator asked you to stop[^\n]*\]\n/;
function answersTheDm(prompt) { return DM_ENVELOPE.test(String(prompt).replace(STOP_NOTE_HEAD, '')); }
/* #4569 fix 4: the window for telling the board a new waiting count (each report starts a node process). */
const NOTE_EVERY_MS = 1500;
const BUSY_RETRY_MS = 500;
const MUSE_BUSY = 'Muse Code is still working on this agent\'s last turn';   // muserun.BUSY; a drift turns the busy-retry test red
const MUSE_STOPPED = 'Stopped before Muse Code finished';                      // muserun.STOPPED; a drift turns the Escape-in-wait test red
/* ...and posts stop being added past this many characters (review round 2: forty long posts are still one argv
   string). A single post longer than this still goes whole; room posts are bounded where they are made. */
const DIGEST_MAX_CHARS = 32 * 1024;

/**
 * The front's logic, with its edges passed in so a test can drive it:
 *   runTurn(input) -> Promise of muserun's result; report(state) -> fire and forget;
 *   write(text) -> the pane.
 * Returns { feed(bytes), stop(), drained() }. feed takes raw input; stop ends the running turn and drops
 * the waiting ones; drained resolves once no turn is queued or running (tests only).
 */
function createFront({ workspace, sessionId, runTurn, report, write, workingEveryMs = WORKING_EVERY_MS, busyRetryMs = BUSY_RETRY_MS, noteEveryMs = NOTE_EVERY_MS, log = logTurn }) {
  let line = '';
  const queue = [];
  /* #4612 review: when each queued copy of the person's DM reached this front, oldest first per text (the same words
     can be sent twice, and the envelope's time has minute resolution or none). */
  const dmReceivedAt = new Map();
  /* #5636 F7a / #6065 N1: when each waiting line reached this front, oldest first per text (any kind), so the turn log
     can say when a line arrived as well as when it ran: a line that waited behind a long turn is not a late send. */
  const arrivedAt = new Map();
  let lastArrived = null;   // the arrival of the line next() last took first
  function arrive(text, at) { const l = arrivedAt.get(text) || []; l.push(at); arrivedAt.set(text, l); }
  function takeArrived(text) {
    const l = arrivedAt.get(text);
    if (!l || !l.length) return null;
    const a = l.shift();
    if (!l.length) arrivedAt.delete(text);
    return a;
  }
  function received(text, at) {
    if (!answersTheDm(text)) return;
    const l = dmReceivedAt.get(text) || [];
    l.push(at); dmReceivedAt.set(text, l);
  }
  function takeReceived(text) {
    const l = dmReceivedAt.get(text);
    if (!l || !l.length) return null;
    const at = l.shift();
    if (!l.length) dmReceivedAt.delete(text);
    return at;
  }
  /* #4612 review: the answer reaches the board once on a working report (then on the idle one): selfreport carries it
     from there, and repeating it on every beat would fill the report tail it reads. */
  let dmAnswerFresh = false;
  function freshAnswer() { if (!dmAnswerFresh) return null; dmAnswerFresh = false; return dmAnswer; }
  let running = false;
  const STOP_NOTES = new Set();   // #4569: stop notes waiting or running (a second stop leaves them alone)
  let stopNoteRunning = false;
  let dmAnswer = null;   // #4612: the latest DM turn's answer, until an idle report carries it
  let stopTurn = null;   // ends the turn that is running now, when runTurn handed one over
  let waiters = [];
  const decoder = new StringDecoder('utf8');   // a character split across two reads stays one character

  const settle = () => { if (!running && !queue.length) { const w = waiters; waiters = []; w.forEach((f) => f()); } };

  /* #4569 fix 4 (the write-up: "Working, 14 messages waiting" on the card): what waits, as the board carries it,
     { n, yours }, or null when nothing waits. Stop notes count as the person's own. The page words it. */
  function waiting() {
    const n = queue.length;
    if (!n) return null;
    return { n, yours: queue.filter((t) => kindOf(t) === 'operator' || STOP_NOTES.has(t)).length };
  }
  const keyOf = (w) => (w ? w.n + '/' + w.yours : '');
  let noteTimer = null;
  let noteSent = null;
  /* Tell the board the count while a turn runs. A fixed window, not a debounce: the first change starts it, later
     ones inside it ride along, so a stream of posts is at most one report per noteEveryMs (each starts a process). */
  function noteSoon() {
    if (noteTimer) return;
    noteTimer = setTimeout(() => {
      noteTimer = null;
      if (!running) return;
      const w = waiting();
      if (keyOf(w) !== keyOf(noteSent)) { noteSent = w; report('working', w, freshAnswer()); }
    }, noteEveryMs);
    if (noteTimer.unref) noteTimer.unref();
  }

  /* #4569: the next turn. A person's message is already at the front (submit puts it there). When the
     next is background, every waiting background post is taken with it, as one turn, including ones that
     came after a colleague's addressed message (they are one turn, so that colleague waits one turn, not
     many). At most DIGEST_MAX go in (review round 1: one argv string); the rest are counted, not sent. */
  function next() {
    const first = queue.shift();
    lastArrived = takeArrived(first);   // a digest is dated by its first (oldest) post, even if the cut below leaves it out
    if (kindOf(first) !== 'background') return first;
    const rest = [];
    for (let i = queue.length - 1; i >= 0; i--) if (kindOf(queue[i]) === 'background') rest.unshift(queue.splice(i, 1)[0]);
    for (const r of rest) takeArrived(r);
    if (!rest.length) return first;
    const all = [first, ...rest];
    const kept = all.slice(-DIGEST_MAX);   // the newest, which the room has not moved past yet
    while (kept.length > 1 && kept.reduce((n, t) => n + t.length + 1, 0) > DIGEST_MAX_CHARS) kept.shift();
    const left = all.length - kept.length;
    return '[Kosmos: ' + all.length + ' room posts arrived while you were busy, all background, none addressed to you.'
      + (left ? ' The ' + left + ' oldest are left out; they are in that project\'s room (kosmos room <project-id>) if you need them.' : '')
      + ' Read them together; answer only if one needs you.]\n' + kept.join('\n');
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const prompt = next();
        try { log(workspace, prompt, new Date().toISOString(), lastArrived); } catch { /* #5636 F7a / #6065 N1: never stops a turn */ }
        stopNoteRunning = STOP_NOTES.delete(prompt);
        noteSent = waiting();
        // #4612: an answer to the person's DM still pending rides on this turn's working reports.
        report('working', noteSent, freshAnswer());
        const beat = setInterval(() => report('working', noteSent, freshAnswer()), workingEveryMs);
        if (beat.unref) beat.unref();
        let r;
        const isNote = stopNoteRunning;
        /* #4612 review: the answer is dated by when its DM reached this front (a stop note: when its stop arrived), not
           by the turn's start, which the board compares with the newest DM. The fallback serves prompts that are not the
           person's DM, whose date nothing reads. */
        const startedAt = takeReceived(prompt) || new Date().toISOString();
        try {
          for (let tries = 0; ; tries++) {
            // #4603 (10-05 R7): kept when the stream names it, so whoami can name it during this turn too.
            r = await runTurn({ workspace, sessionId, prompt, approvalMode: 'never', onStop: (f) => { stopTurn = f; }, onModel: (m) => keepModel(workspace, m) });
            stopTurn = null;   // that turn is over: nothing is running during the wait (review round 6)
            if (!(isNote && stopNoteRunning && r && !r.ok && r.because === MUSE_BUSY && tries < BUSY_RETRIES)) break;
            await new Promise((ok) => setTimeout(ok, busyRetryMs));
            // Review round 6: Escape during the wait cancels the note; it must not run after all.
            if (!stopNoteRunning) { r = { ok: false, text: '', because: MUSE_STOPPED }; break; }
          }
        }
        catch { r = { ok: false, text: '', because: 'Kosmos could not run Muse Code just now' }; }
        finally { clearInterval(beat); stopTurn = null; stopNoteRunning = false; }
        if (r && r.model) keepModel(workspace, r.model);   // #4603 N12
        const text = r && typeof r.text === 'string' ? printable(r.text).trim() : '';
        if (text) write(text + '\n');
        if (!r || !r.ok) write('(' + printable((r && r.because) || 'Muse Code did not finish the turn') + ')\n');
        // Idle only once nothing is waiting: a queued message starts its turn at once.
        /* #4612: the answer to the person's latest DM rides with the next reports (the working reports of turns queued
           behind it, then the idle one), so the DM can show it when the agent answered in its own window but never ran
           kosmos reply. A later DM turn replaces this copy. */
        if (answersTheDm(prompt)) {
          dmAnswer = r && r.ok && text ? { text: Array.from(text).slice(0, FINAL_MAX).join(''), startedAt } : null;
          /* #4612 review: with a newer DM of the person's already waiting, this answer can never be the one to show
             (the DM owed is the newer one), so none is carried. DMs that reached the front in one read share a
             time, which the board's date check alone could not tell apart. */
          if (queue.some(answersTheDm)) dmAnswer = null;
          dmAnswerFresh = !!dmAnswer;
        }
        if (!queue.length) { noteSent = null; report('idle', null, dmAnswer); dmAnswer = null; dmAnswerFresh = false; }
        write(PROMPT);
      }
    } finally {
      running = false;
      settle();
    }
  }

  function submit() {
    const text = line.trim();
    line = '';
    write('\n');
    if (!text) { write(PROMPT); return; }
    const at = new Date().toISOString();
    if (isStopRequest(text) && (running || queue.length)) { stopFor(text, at); noteSoon(); return; }
    received(text, at);
    arrive(text, at);
    if (kindOf(text) === 'operator') {
      // Behind the person's own earlier messages, ahead of everyone else's.
      let at = 0;
      while (at < queue.length && (kindOf(queue[at]) === 'operator' || STOP_NOTES.has(queue[at]))) at++;
      queue.splice(at, 0, text);
      if (running) write('(queued ahead of other waiting messages: a message from your operator; Muse is still on the last message)\n');
    } else {
      queue.push(text);
      if (running) write('(queued: Muse is still on the last message)\n');
    }
    if (running) noteSoon();
    pump().catch(() => { /* report and write never throw; a turn's own failure is said inside pump */ });
  }

  /** Escape: the line being typed, the waiting messages and the running turn all end. */
  function stop() {
    const dropped = queue.length;
    queue.length = 0;
    STOP_NOTES.clear();        // housekeeping: a stop note Escape drops is no longer waiting (nothing reads a stale one)
    dmReceivedAt.clear();      // #4612 review: the DMs Escape drops take their arrival times with them
    arrivedAt.clear();         // #5636 F7a: and every dropped line's, or a later identical line would inherit it
    stopNoteRunning = false;   // a note Escape ends is not "already stopping" for the next stop (review round 5)
    line = '';
    if (dropped) write('\n(' + dropped + (dropped === 1 ? ' waiting message was' : ' waiting messages were') + ' dropped)\n');
    if (stopTurn) { const f = stopTurn; stopTurn = null; try { f(); } catch { /* the turn is ending anyway */ } }
    else if (!running) write('\n' + PROMPT);
  }

  /* #4569: the person asked the agent to stop. Like Escape: the running turn ends and what waits is
     dropped. Then the stop itself runs, with a note saying what was dropped, so the agent tells the
     person it stopped (and which of their own messages it did not get to). */
  function stopFor(text, at) {
    /* Review round 1: Josh stops twice. A second stop while the first stop's note is running or waiting must
       not end that note or replace it, or the list of what was dropped (and the agent saying it stopped) is lost.
       The rest of what waits is still dropped, and the pane says so. */
    if (stopNoteRunning || queue.some((t) => STOP_NOTES.has(t))) {
      const extra = queue.filter((t) => !STOP_NOTES.has(t));
      queue.splice(0, queue.length, ...queue.filter((t) => STOP_NOTES.has(t)));
      for (const t of extra) { takeReceived(t); takeArrived(t); }   // dropped unread: their receipt times go with them
      write('(already stopping' + (extra.length ? '; ' + extra.length + (extra.length === 1 ? ' more waiting message was' : ' more waiting messages were') + ' dropped' : '') + ')\n');
      /* Review round 3: the person's own messages this drops are named to the agent too, in a short note
         after the first one, never only in the pane (the person reads the DM, not the pane). */
      const mine = extra.filter((t) => kindOf(t) === 'operator');
      // Review round 5: a colleague's addressed message dropped here is counted to the agent too.
      const asked = extra.filter((t) => kindOf(t) === 'other').length;
      if (mine.length || asked) {
        /* Review round 4: notes are tracked by their text, so an identical note already waiting says it already;
           a second copy would leave one copy untracked. */
        const said = [];
        if (mine.length) said.push('these messages from them, sent in between, were dropped unread: ' + mine.map((t) => '"' + shortOf(t) + '"').join(', '));
        if (asked) said.push(asked + (asked === 1 ? ' message addressed to you was' : ' messages addressed to you were') + ' dropped too');
        const more = '[Kosmos: your operator asked you to stop again, and ' + said.join('; ') + '.]\n' + text;
        if (!queue.includes(more)) { STOP_NOTES.add(more); queue.push(more); received(more, at); arrive(more, at); }
      }
      return;
    }
    const waiting = queue.splice(0, queue.length);
    for (const t of waiting) { takeReceived(t); takeArrived(t); }   // dropped unread: their receipt times go with them
    const mine = waiting.filter((t) => kindOf(t) === 'operator');
    const others = waiting.length - mine.length;
    const ended = !!stopTurn;
    if (stopTurn) { const f = stopTurn; stopTurn = null; try { f(); } catch { /* the turn is ending anyway */ } }
    write('(stopped at your operator\'s request' + (waiting.length ? '; ' + waiting.length + (waiting.length === 1 ? ' waiting message was' : ' waiting messages were') + ' dropped' : '') + ')\n');
    const parts = [];
    if (ended) parts.push('the turn you were on was ended');
    if (others) parts.push(others + (others === 1 ? ' other waiting message was' : ' other waiting messages were') + ' dropped');
    if (mine.length) parts.push('these earlier messages from your operator were dropped unread: ' + mine.map((t) => '"' + shortOf(t) + '"').join(', '));
    const note = '[Kosmos: your operator asked you to stop, so ' + (parts.join('; ') || 'nothing else was waiting') + '. Stop the work you were doing.]\n' + text;
    STOP_NOTES.add(note);
    queue.push(note);
    received(note, at);   // dated by the stop request's arrival
    arrive(note, at);
  }

  function feed(chunk) {
    const s = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
    const chars = Array.from(s);
    let echo = '';
    const flush = () => { if (echo) { write(echo); echo = ''; } };
    // An escape sequence (an arrow key) arrives whole in one read, so its state never carries into the
    // next read. Any other Escape is stop().
    let esc = 0;   // 0 = none, 1 = after ESC, 2 = inside ESC [ ...
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (esc === 1) {
        if (ch === '[' || ch === 'O') { esc = 2; continue; }
        // An Escape followed by anything else was not a key sequence: stop(), and this character is typed.
        esc = 0;
        flush();
        stop();
      }
      if (esc === 2) { if (ch >= '@' && ch <= '~') esc = 0; continue; }   // the final byte ends it
      if (ch === '\u001b') {
        if (i === chars.length - 1) { flush(); stop(); } else esc = 1;
        continue;
      }
      if (ch === '\r' || ch === '\n') { flush(); submit(); continue; }
      if (ch === '\u0003' || ch === '\u0015') {   // Ctrl+C, Ctrl+U: drop the line being typed
        flush();
        if (line) write('\n' + PROMPT);
        line = '';
        continue;
      }
      if (ch === '\u007f' || ch === '\b') {   // Backspace
        if (line) { line = Array.from(line).slice(0, -1).join(''); flush(); write('\b \b'); }
        continue;
      }
      if (ch < ' ') continue;         // other control bytes are never part of a message
      line += ch;
      echo += ch;
    }
    flush();
  }

  function drained() {
    return new Promise((resolve) => { waiters.push(resolve); settle(); });
  }

  return { feed, stop, drained };
}

/** Tell the board working or idle, through the agy bridge beside the engine. Never throws or waits. */
function makeReporter(o = {}) {
  const spawn = o.spawn || require('node:child_process').spawn;
  // The supervisor passes the bridge beside itself (in an install that is not beside the engine).
  const env = o.env || process.env;
  const bridge = o.bridge || env.KOSMOS_MUSE_BRIDGE || path.join(__dirname, '..', 'bin', 'agy-report-bridge.js');
  const EVENT = { working: 'PreInvocation', idle: 'Stop' };
  return (state, waitingNow, final) => {
    const ev = EVENT[state];
    if (!ev) return;
    try {
      const child = spawn(o.node || process.execPath, [bridge, ev], { stdio: ['pipe', 'ignore', 'ignore'], env });
      child.on('error', () => { /* a missed report must never stop a turn */ });
      // #4569 fix 4: the queue rides in the payload; agy's own payloads never carry this field.
      const payload = {};
      if (waitingNow) payload.kosmosWaiting = waitingNow;
      if (final) payload.kosmosFinal = final;   // #4612
      if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload)); }
      if (child.unref) child.unref();
    } catch { /* same */ }
  };
}

function main(argv = process.argv) {
  const workspace = argv[2];
  const write = (t) => { try { process.stdout.write(t); } catch { /* the pane went away */ } };
  if (!workspace || !path.isAbsolute(workspace)) {
    write('Kosmos could not start Muse: it was not told which folder this agent works in.\n');
    process.exitCode = 2;
    return;
  }
  /* Running Muse is this process's whole job, so it states that intent here, on the real-start path
     only, as server.js does (engine/live-execution.js). Without it every turn was refused as "live
     execution is off". Never at module load: tests require this file and must stay fail-closed. */
  require('./live-execution').allowLiveExecution();
  const { id, note } = startup(workspace);
  write(HELLO + '\n');
  if (note) write(note + '\n');
  const report = makeReporter();
  const front = createFront({ workspace, sessionId: id, runTurn: require('./muserun').runTurn, report, write });
  /* The pane closing (a Stop agent, a restart) must not leave a turn running behind it: Muse runs in
     its own process group, which the pane's hangup never reaches, and a turn left running would hold
     this agent's session and refuse the next front's first turn. */
  const leave = () => { front.stop(); process.exit(0); };
  process.on('SIGHUP', leave);
  process.on('SIGTERM', leave);
  if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.on('data', (b) => front.feed(b));
  process.stdin.on('end', leave);
  process.stdin.on('error', leave);    // a closed pane can show up as EIO rather than end
  process.stdout.on('error', leave);
  report('idle');   // the board hears from a new agent before its first message
  write(PROMPT);
}

if (require.main === module) main();

module.exports = { turnRecord, logTurn, turnLogFile, TURN_LOG_MAX, createFront, loadSession, startup, sessionFile, modelFile, keepModel, forgetModel, makeReporter, printable, answersTheDm, UUID_RE, PROMPT, HELLO, WORKING_EVERY_MS };
