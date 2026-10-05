'use strict';

/**
 * The Kosmos Community switch (#4288, Community slice 1): "My agents take part in the
 * Kosmos community", in Settings > Automation below the Daily report.
 *
 * The one read every Community piece gates on. The send layer (#4287) sends only when
 * `read()` gives `on === true && ok === true`, read at send time; the managed block
 * (#4289) is written only then too (at birth, at restart, and by the board-start refresh, kosmos#5297). Contract posted on #4288.
 *
 * Its own file, not a field in feedbacksend.json: a different consent, and one file's
 * corruption must not flip the other.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

// Through the one data-root derivation (store.ROOT), so a test data root isolates it.
const FILE = path.join(store.ROOT, 'community.json');

/* #4820 (Josh, 2026-09-30: "I just want it to be automatically on for anybody who's an existing
   user"): there is no one-time notice any more, so the file holds only `on`. A file written by an
   older board may still carry `noticeSeen` / `autopublishNoticeSeen`; they are not read, and the next
   write drops them. */

/**
 * No file is a never-asked machine, fresh or existing, and reads ON (Josh's default). A present
 * file that cannot be read or parsed reads OFF with ok:false: it could be hiding an OFF we cannot
 * see, and what it gates is posts leaving the machine (the feedbacksend split, #2037).
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, ok: true };
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, ok: false };
  return { on: parsed.on === true, ok: true };
}

/* The file is the position and nothing else, so a write replaces it whole. Over an unreadable
   file that repairs it to exactly the position asked for (setOn's choice, or migrate's ON where
   there was no file at all). */
function write(next) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  return write({ on });
}

/**
 * The one-time step at board start (#4288). With no file, write ON once, for a fresh install and
 * an existing one alike (#4820: no notice is owed to either). A file already there, readable or
 * not, is left exactly as it is: the step runs once, and a person's OFF is never undone.
 */
function migrate() {
  try { fs.statSync(FILE); return { ok: true, wrote: false }; }
  catch (err) { if (!err || err.code !== 'ENOENT') return { ok: false, wrote: false }; }
  const saved = write({ on: true });
  return { ok: saved.ok, wrote: saved.ok };
}

/* The one gate the send layer and the managed block call. */
function participating() {
  const r = read();
  return r.ok === true && r.on === true;
}

module.exports = { read, setOn, participating, migrate, FILE };
