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
 * Kept for SHOW_MS or until dismissed. Every read and write is best effort: this is a courtesy, never a gate.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');

const BEAT_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const SHOW_MS = 24 * 60 * 60 * 1000;

const aliveFile = () => path.join(store.ROOT, 'board-alive.json');
const noteFile = () => path.join(store.ROOT, 'board-restart-note.json');

function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
function writeJson(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch { try { fs.unlinkSync(tmp); } catch { /* not there */ } return false; }
}
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

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
  if (note) writeJson(noteFile(), { ...note, dismissed: false });
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

function beat(now = Date.now()) { return writeJson(aliveFile(), { at: new Date(now).toISOString() }); }

/** Start the once-a-minute beat. The timer does not hold the process open. */
function startBeating() {
  const t = setInterval(() => { beat(); }, BEAT_MS);
  if (t.unref) t.unref();
  return t;
}

/** The note to show now: made within SHOW_MS and not dismissed, or null. */
function current(now = Date.now()) {
  const n = readJson(noteFile());
  if (!n || n.dismissed === true) return null;
  const up = ms(n.upAt);
  if (up == null || now - up > SHOW_MS || now < up - 60 * 1000) return null;   // a minute of slack for a clock set back a little
  if (ms(n.lastAliveAt) == null || ms(n.bootAt) == null) return null;
  return { lastAliveAt: n.lastAliveAt, bootAt: n.bootAt, upAt: n.upAt };
}

function dismiss() {
  const n = readJson(noteFile());
  if (!n) return true;
  return writeJson(noteFile(), { ...n, dismissed: true });
}

module.exports = { noteFor, atStart, beat, startBeating, current, dismiss, BEAT_MS, WINDOW_MS, SHOW_MS, _files: { aliveFile, noteFile } };
