'use strict';
/**
 * kosmos#5359 part 1: say on the board when this computer restarted while Kosmos was running, and Kosmos came back
 * by itself (a field report: a Windows box blue-screened, everything came back in about seven minutes, and the person
 * wanted to see that without asking an agent).
 *
 * It asks the computer, not the last run: the board writes when it was last alive, once a minute, and at the next
 * start compares that with the computer's boot time (os.uptime()). A note is made only when both hold:
 *   - the board was alive within WINDOW_MS before this boot (it was running when the computer went down), and
 *   - this start is within WINDOW_MS after the boot (it came back with the computer, not long after it).
 * #5450: that second test is a guess, used only when nothing says who started the board. The Mac launcher says so
 * (KOSMOS_BOARD_STARTED_BY, install/kosmos): the supervisor (the login item, or a crash relaunch) makes a note however
 * long after the boot, and a person's start never does. Windows passes nothing yet, so the guess stands there.
 * A person who quit Kosmos yesterday and opened it after a restart gets no note: their last-alive time is old.
 * The words say "restarted", true of a crash and of a person's restart alike; nothing here can tell them apart.
 *
 * A deliberate stop: on a Mac, `kosmos stop` removes the last-alive record once the board is gone (install/kosmos).
 * Every other stop (quitting the app, Windows, which has no stop verb, and switching to another Kosmos, which stops
 * this one's board) leaves it, so stopping Kosmos, restarting the computer and starting it again within the window
 * still makes a note. #5450 fixed that on a Mac (a person's start never makes a note there); Windows waits for its
 * launcher to say who started the board. Clearing on SIGTERM in the board was
 * rejected: an ordinary shutdown sends SIGTERM to every process too, so a Mac would lose the note for every restart.
 *
 * kosmos#8287: the note also says what was checked. The beat records which agents were running, so the note can ask
 * about exactly those: an agent a person stopped last week is not "not back", nor is one that came back and shows
 * a stopped card afterwards (where the board has no such card, as on Windows, it is named: saying more is the safe side). The result of this start's file check
 * (engine/storecheck.js) is kept in the note, so dismissing or repairing that notice cannot turn it into "fine". What
 * could not be checked is left out of the sentence, never reported as fine.
 *
 * Kept for SHOW_MS or until dismissed. Every read and write is best effort: this is a courtesy, never a gate.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');

const BEAT_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const SHOW_MS = 24 * 60 * 60 * 1000;
const MAX_AGENTS = 1000;   // a bound on what a damaged record can make the note carry

const aliveFile = () => path.join(store.ROOT, 'board-alive.json');
const noteFile = () => path.join(store.ROOT, 'board-restart-note.json');

function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // #5434 slice 20: flushed before the rename, exact 0600; a failed save removes its own temp.
    require('./securewrite').writeSecret(file, JSON.stringify(data) + '\n', 0o600, { atomicOnly: true });
    return true;
  } catch { return false; }
}
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/* kosmos#8287: a list of {session, name}, or null when it is not one: null means nobody recorded who was running. */
function cleanRunning(list) {
  if (!Array.isArray(list)) return null;
  return list.filter((a) => a && typeof a.session === 'string' && a.session).slice(0, MAX_AGENTS)
    .map((a) => ({ session: a.session, name: typeof a.name === 'string' && a.name ? a.name : a.session }));
}
/* A session of ours that is not stopped and not in a failed state. A rejected token, no connection or a crash loop is
   exactly what a person checking after a restart needs named. */
const NOT_UP_STATES = new Set(['stopped', 'auth_failed', 'connection_lost']);
function isUp(a) {
  return Boolean(a) && a.isAgentSession === true && a.isNamedOurs === true && !NOT_UP_STATES.has(a.state)
    && !(a.crashLoop && a.crashLoop.looping === true);
}
const cleanReturned = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s).slice(0, MAX_AGENTS) : []);
/* The agents of a roster that are up, as the beat records them. */
function runningOf(roster) {
  return (Array.isArray(roster) ? roster : []).filter((a) => isUp(a) && a.sessionName).map((a) => ({ session: a.sessionName, name: a.name || a.sessionName }));
}

/**
 * The note for a start at `now`, given when the board was last alive and how long the computer has been up, or null.
 * Pure, so the rule is tested without a clock or a disk.
 */
function noteFor({ now, uptimeSec, lastAliveAt, startedBy }) {
  const last = typeof lastAliveAt === 'number' ? lastAliveAt : ms(lastAliveAt);
  if (!Number.isFinite(now) || !Number.isFinite(uptimeSec) || uptimeSec < 0 || last == null) return null;
  // #5450: who started this board, when the launcher said: a person never makes "it came back by itself".
  if (startedBy === 'person') return null;
  const bootAt = now - uptimeSec * 1000;
  if (!(last < bootAt)) return null;                      // alive since this boot: Kosmos restarted, the computer did not
  if (bootAt - last > WINDOW_MS) return null;             // last alive long before the boot: it was not running then
  // Started long after the boot: a person opened it. #5450: only a guess when nothing says who started it (Windows
  // today); the supervisor's word replaces it, so a machine left at a login screen still gets its note.
  if (startedBy !== 'supervisor' && now - bootAt > WINDOW_MS) return null;
  return { lastAliveAt: new Date(last).toISOString(), bootAt: new Date(bootAt).toISOString(), upAt: new Date(now).toISOString() };
}

/**
 * At board start: read the last-alive time BEFORE this run writes its own, make the note if the rule holds, then start
 * beating. Returns the note made, or null. `deps` are for tests.
 */
function atStart(deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const uptimeSec = deps.uptime ? deps.uptime() : os.uptime();
  // #5450: the launcher's word (install/kosmos board-run and start). server.js takes it out of the environment at load
  // and passes it here; noteFor treats anything but 'person' or 'supervisor' as unknown (the timer decides).
  const startedBy = deps.startedBy;
  const prev = readJson(aliveFile());
  const note = noteFor({ now, uptimeSec, lastAliveAt: prev && prev.at, startedBy });
  // A list only counts if it describes the run just ended, not a board last open days ago.
  const lastAt = prev ? ms(prev.at) : null;
  carried = note || (lastAt != null && now - lastAt <= WINDOW_MS) ? cleanRunning(prev && prev.running) : null;
  carriedUntil = now + WINDOW_MS;
  running = carried;   // the beat below must not drop the list before this run has read its own
  if (note) {
    // kosmos#8287: only what is known goes in, so a read that could not be made is absent from the sentence.
    const were = cleanRunning(prev && prev.running);
    if (were) note.wereRunning = were;
    const scan = deps.files;
    if (scan && scan.checked === true && Number.isInteger(scan.damaged) && scan.damaged >= 0) note.files = filesOf(scan);
    writeJson(noteFile(), { ...note, dismissed: false });
  }
  beat(now);
  // The person's mark is consumed only now that it has been used, so a board that died before this point was
  // relaunched still knowing a person started it (review 1). Review 9: and only AFTER the beat: a board killed between
  // the two would otherwise leave no mark and an alive record from before the boot, a false note on the next start.
  // Only the launcher's own mark file, by its name.
  if (typeof deps.personMark === 'string' && path.basename(deps.personMark) === 'board.person-start') {
    try { fs.unlinkSync(deps.personMark); } catch { /* not there, or already gone */ }
  }
  return note;
}

/* kosmos#8287: the list the beat writes, and the last roster the minute tick read (null until one has succeeded). The
   route reads that one rather than taking a blocking roster read of its own. */
let running = null;
let lastCards = null;
let lastCardsAt = 0;
const ROSTER_STALE_MS = 5 * BEAT_MS;   // past this the reading no longer describes now, so the agents are left out
let carried = null;       // who was running before this start, and until when it still counts
let carriedUntil = 0;
function noteRunning(roster, now = Date.now()) {
  if (!Array.isArray(roster)) return;   // a failed read says nothing, so the last good list stands
  lastCards = roster;
  lastCardsAt = now;
  const up = cleanRunning(runningOf(roster));
  markReturned(up);
  /* Agents return over minutes, so a read just after a start is a partial list. A second restart in that time must
     still ask about everyone, or "all 2 are back" could describe a fleet of 12. */
  if (carried && now < carriedUntil) {
    const have = new Set(up.map((a) => a.session));
    running = [...up, ...carried.filter((a) => !have.has(a.session))];
  } else {
    carried = null;
    running = up;
  }
}
/* An agent seen up since the restart and stopped afterwards is not a failure of the restart (checksFor). */
function markReturned(up) {
  const n = readJson(noteFile());
  if (!n || n.dismissed === true) return;
  const were = new Set((cleanRunning(n.wereRunning) || []).map((a) => a.session));
  const had = cleanReturned(n.returned);
  const fresh = up.map((a) => a.session).filter((s) => were.has(s) && !had.includes(s));
  if (fresh.length) writeJson(noteFile(), { ...n, returned: [...had, ...fresh] });
}

function beat(now = Date.now()) {
  const at = new Date(now).toISOString();
  // A list from reads that stopped hours ago no longer says who is running, so it is left out, like no list at all.
  const age = now - lastCardsAt;
  const current = running && ((carried && now < carriedUntil) || (age >= 0 && age <= ROSTER_STALE_MS));
  return writeJson(aliveFile(), current ? { at, running } : { at });
}

/** Start the once-a-minute beat. The timer does not hold the process open. */
function startBeating() {
  const t = setInterval(() => { beat(); }, BEAT_MS);
  if (t.unref) t.unref();
  return t;
}

/* kosmos#8297: the file check as the note keeps it: the damaged count, and `unread` only when some could not be looked at
   (a note written before #8297 has none, which reads as none unread). */
function filesOf(f) {
  const out = { damaged: f.damaged };
  if (Number.isInteger(f.unread) && f.unread > 0) out.unread = f.unread;
  return out;
}

/** The note to show now: made within SHOW_MS and not dismissed, or null. */
function current(now = Date.now()) {
  const n = readJson(noteFile());
  if (!n || n.dismissed === true) return null;
  const up = ms(n.upAt);
  if (up == null || now - up > SHOW_MS || now < up - 60 * 1000) return null;   // a minute of slack for a clock set back a little
  if (ms(n.lastAliveAt) == null || ms(n.bootAt) == null) return null;
  const out = { lastAliveAt: n.lastAliveAt, bootAt: n.bootAt, upAt: n.upAt };
  const were = cleanRunning(n.wereRunning);
  if (were) out.wereRunning = were;
  const returned = cleanReturned(n.returned);
  if (returned.length) out.returned = returned;
  if (n.files && Number.isInteger(n.files.damaged) && n.files.damaged >= 0) out.files = filesOf(n.files);
  return out;
}

/**
 * kosmos#8287: what the page says was checked, from the note and the roster now. Pure. `agents` is absent when nobody
 * recorded who was running or the roster could not be read; `files` is absent when the file check did not finish. An
 * agent missing from the roster counts as not back unless it was removed since (`removed`, the names on the removal records): reading
 * missing as fine would hide the very failure this line exists to show.
 */
function checksFor(note, roster, removed) {
  const out = {};
  if (!note) return out;
  if (Array.isArray(note.wereRunning) && Array.isArray(roster)) {
    const gone = new Set(Array.isArray(removed) ? removed : []);
    const cards = new Map(roster.filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    const asked = note.wereRunning.filter((a) => !gone.has(a.session));
    const seen = new Set(cleanReturned(note.returned));
    // The page says who came back, which an agent stopped since did. A failure still showing is named instead.
    const stoppedSince = (a) => { const c = cards.get(a.session); return seen.has(a.session) && Boolean(c) && c.state === 'stopped' && !(c.crashLoop && c.crashLoop.looping === true); };
    const notBack = asked.filter((a) => !stoppedSince(a) && !isUp(cards.get(a.session))).map((a) => (cards.get(a.session) || {}).name || a.name);
    out.agents = { was: asked.length, back: asked.length - notBack.length, notBack };
  }
  if (note.files) out.files = filesOf(note.files);
  return out;
}

/* kosmos#8287: what the page is sent: the note's times and the checks, never the records they came from. */
function publicNote(note, checks) { return { lastAliveAt: note.lastAliveAt, bootAt: note.bootAt, upAt: note.upAt, checks }; }

function dismiss() {
  const n = readJson(noteFile());
  if (!n) return true;
  return writeJson(noteFile(), { ...n, dismissed: true });
}

function lastRoster(now = Date.now()) { const age = now - lastCardsAt; return lastCards && age >= 0 && age <= ROSTER_STALE_MS ? lastCards : null; }
function resetForTests() { running = null; lastCards = null; lastCardsAt = 0; carried = null; carriedUntil = 0; }

module.exports = { resetForTests, noteFor, atStart, beat, startBeating, current, dismiss, noteRunning, lastRoster, runningOf, checksFor, publicNote, BEAT_MS, WINDOW_MS, SHOW_MS, _files: { aliveFile, noteFile } };
