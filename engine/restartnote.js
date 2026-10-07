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
 * A person who quit Kosmos yesterday and opened it after a restart gets no note: their last-alive time is old.
 * The words say "restarted", true of a crash and of a person's restart alike; nothing here can tell them apart.
 *
 * A deliberate stop: on a Mac, `kosmos stop` removes the last-alive record once the board is gone (install/kosmos).
 * Every other stop (quitting the app, Windows, which has no stop verb) leaves it, so stopping Kosmos, restarting the
 * computer and starting Kosmos again within the window still makes a note. Clearing on SIGTERM in the board was
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
function noteFor({ now, uptimeSec, lastAliveAt }) {
  const last = typeof lastAliveAt === 'number' ? lastAliveAt : ms(lastAliveAt);
  if (!Number.isFinite(now) || !Number.isFinite(uptimeSec) || uptimeSec < 0 || last == null) return null;
  const bootAt = now - uptimeSec * 1000;
  if (!(last < bootAt)) return null;                      // alive since this boot: Kosmos restarted, the computer did not
  if (bootAt - last > WINDOW_MS) return null;             // last alive long before the boot: it was not running then
  if (now - bootAt > WINDOW_MS) return null;              // started long after the boot: a person opened it
  return { lastAliveAt: new Date(last).toISOString(), bootAt: new Date(bootAt).toISOString(), upAt: new Date(now).toISOString() };
}

/**
 * At board start: read the last-alive time BEFORE this run writes its own, make the note if the rule holds, then start
 * beating. Returns the note made, or null. `deps` are for tests.
 */
function atStart(deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const uptimeSec = deps.uptime ? deps.uptime() : os.uptime();
  const prev = readJson(aliveFile());
  const note = noteFor({ now, uptimeSec, lastAliveAt: prev && prev.at });
  if (note) writeJson(noteFile(), { ...note, dismissed: false });
  beat(now);
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
  if (up == null || now - up > SHOW_MS || now < up) return null;
  if (ms(n.lastAliveAt) == null || ms(n.bootAt) == null) return null;
  return { lastAliveAt: n.lastAliveAt, bootAt: n.bootAt, upAt: n.upAt };
}

function dismiss() {
  const n = readJson(noteFile());
  if (!n) return true;
  return writeJson(noteFile(), { ...n, dismissed: true });
}

module.exports = { noteFor, atStart, beat, startBeating, current, dismiss, BEAT_MS, WINDOW_MS, SHOW_MS, _files: { aliveFile, noteFile } };
