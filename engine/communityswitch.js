'use strict';

/**
 * The Kosmos Community switch (#4288, Community slice 1): "My agents take part in the
 * Kosmos community", in Settings > Automation below the Daily report.
 *
 * The one read every Community piece gates on. The send layer (#4287) sends only when
 * `read()` gives `on === true && ok === true`, read at send time; the managed block
 * (#4289) is written only then too. Contract posted on #4288.
 *
 * Its own file, not a field in feedbacksend.json: a different consent, and one file's
 * corruption must not flip the other.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

// Through the one data-root derivation (store.ROOT), so a test data root isolates it.
const FILE = path.join(store.ROOT, 'community.json');

/* #3485 (Josh, 2026-09-30: agents publish straight away): the one-time notice changed from "Nothing
   goes out until you release it" to "posts now go out straight away". A person who dismissed the OLD
   notice was told the opposite of what now happens, so the NEW text is recorded under a NEW key and
   everyone is owed it once. The old key (`noticeSeen` in the file) is no longer read; `noticeSeen` in
   the answer means THIS key. */
const NOTICE_KEY = 'autopublishNoticeSeen';

/**
 * No file is a never-asked machine, fresh or existing, and reads ON (Josh's default).
 * No file also owes no notice (noticeSeen true): only migrate() decides the one-time
 * notice is owed, and it records that in the file. A board that never ran migrate (a
 * server required in-process by a check or a test) must not open it over every page
 * (#4288 part B: it covered the agent page in 22 browser checks). A present file that cannot be read or parsed reads OFF with ok:false: it
 * could be hiding an OFF we cannot see, and what it gates is posts leaving the machine
 * (the feedbacksend split, #2037).
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, ok: true, noticeSeen: true };
    return { on: false, ok: false, noticeSeen: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false, noticeSeen: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, ok: false, noticeSeen: false };
  return { on: parsed.on === true, ok: true, noticeSeen: parsed[NOTICE_KEY] === true };
}

/* A write keeps the other field: setOn must not reset noticeSeen, and markNoticeSeen
   must not flip on. Over an unreadable file the other field comes from read()'s safe
   values (off, notice not seen), as feedbacksend does: a write repairs the file toward
   OFF, never toward ON. */
function write(patch) {
  const cur = read();
  const next = { on: cur.on, [NOTICE_KEY]: cur.noticeSeen, ...patch };
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

function markNoticeSeen() {
  return write({ [NOTICE_KEY]: true });
}

/**
 * The one-time step at board start (#4288 part B). With no file, write ON once, and decide once
 * whether this install is told by the one-time notice:
 *   - an EXISTING install (first run already done when this board starts) had the default change
 *     under it, so its notice is pending (noticeSeen false) and shows once;
 *   - a FRESH install (first run not done) is told in first run instead, so its notice is marked
 *     seen. That also keeps the notice off every freshly booted test board.
 * A file already there, readable or not, is left exactly as it is: the step runs once.
 */
function migrate({ existingInstall }) {
  try { fs.statSync(FILE); return { ok: true, wrote: false }; }
  catch (err) { if (!err || err.code !== 'ENOENT') return { ok: false, wrote: false }; }
  const saved = write({ on: true, [NOTICE_KEY]: existingInstall !== true });
  return { ok: saved.ok, wrote: saved.ok };
}

/* The one gate the send layer and the managed block call. */
function participating() {
  const r = read();
  return r.ok === true && r.on === true;
}

module.exports = { read, setOn, markNoticeSeen, participating, migrate, FILE, NOTICE_KEY };
