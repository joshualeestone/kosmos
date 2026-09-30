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
function createFront({ workspace, sessionId, runTurn, report, write, workingEveryMs = WORKING_EVERY_MS, busyRetryMs = BUSY_RETRY_MS, noteEveryMs = NOTE_EVERY_MS }) {
  let line = '';
  const queue = [];
  /* #4612 review: when each queued copy of the person's DM reached this front, oldest first per text (the same words
     can be sent twice, and the envelope's time has minute resolution or none). */
  const dmReceivedAt = new Map();
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
    if (kindOf(first) !== 'background') return first;
    const rest = [];
    for (let i = queue.length - 1; i >= 0; i--) if (kindOf(queue[i]) === 'background') rest.unshift(queue.splice(i, 1)[0]);
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
        stopNoteRunning = STOP_NOTES.delete(prompt);
        noteSent = waiting();
        // #4612: an answer to the person's DM still pending rides on this turn's working reports.
        report('working', noteSent, freshAnswer());
        const beat = setInterval(() => report('working', noteSent, freshAnswer()), workingEveryMs);
        if (beat.unref) beat.unref();
        let r;
        const isNote = stopNoteRunning;
        /* #4612 review: the answer is dated by when its DM reached this front, not by the turn's start, which the board
           compares with the newest DM: a DM that waited behind a newer one must not pass as that one's answer. A stop
           note has no receipt time here, so its turn's start stands. */
        const startedAt = takeReceived(prompt) || new Date().toISOString();
        try {
          for (let tries = 0; ; tries++) {
            r = await runTurn({ workspace, sessionId, prompt, approvalMode: 'never', onStop: (f) => { stopTurn = f; } });
            stopTurn = null;   // that turn is over: nothing is running during the wait (review round 6)
            if (!(isNote && stopNoteRunning && r && !r.ok && r.because === MUSE_BUSY && tries < BUSY_RETRIES)) break;
            await new Promise((ok) => setTimeout(ok, busyRetryMs));
            // Review round 6: Escape during the wait cancels the note; it must not run after all.
            if (!stopNoteRunning) { r = { ok: false, text: '', because: MUSE_STOPPED }; break; }
          }
        }
        catch { r = { ok: false, text: '', because: 'Kosmos could not run Muse Code just now' }; }
        finally { clearInterval(beat); stopTurn = null; stopNoteRunning = false; }
        const text = r && typeof r.text === 'string' ? printable(r.text).trim() : '';
        if (text) write(text + '\n');
        if (!r || !r.ok) write('(' + printable((r && r.because) || 'Muse Code did not finish the turn') + ')\n');
        // Idle only once nothing is waiting: a queued message starts its turn at once.
        /* #4612: the answer to the person's latest DM rides with the next reports (the working reports of turns queued
           behind it, then the idle one), so the DM can show it when the agent answered in its own window but never ran
           kosmos reply. A later DM turn replaces this copy. */
        if (answersTheDm(prompt)) { dmAnswer = r && r.ok && text ? { text: Array.from(text).slice(0, FINAL_MAX).join(''), startedAt } : null; dmAnswerFresh = !!dmAnswer; }
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
      for (const t of extra) takeReceived(t);   // dropped unread: their receipt times go with them
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
        if (!queue.includes(more)) { STOP_NOTES.add(more); queue.push(more); received(more, at); }
      }
      return;
    }
    const waiting = queue.splice(0, queue.length);
    for (const t of waiting) takeReceived(t);   // dropped unread: their receipt times go with them
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
  const { id, note } = loadSession(workspace);
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

module.exports = { createFront, loadSession, sessionFile, makeReporter, printable, answersTheDm, UUID_RE, PROMPT, HELLO, WORKING_EVERY_MS };
