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
  let r = readOnce();
  if (r.ok) { lastFailed = null; return { on: r.on, ok: true }; }
  if (!r.retry) return { on: r.on, ok: r.ok };
  // The same failure on the same file as last time (review 1: a file that stays corrupt, or a lasting EACCES) is not
  // read again: every reader would wait RETRIES pauses on every call until the person rewrites it. A file a writer is
  // part way through changes its size or time between reads, so it is retried.
  if (failureKey(r) === lastFailed) return { on: r.on, ok: r.ok };
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    pause(RETRY_MS);
    r = readOnce();
    if (r.ok) { lastFailed = null; return { on: r.on, ok: true }; }
    if (!r.retry) break;
  }
  lastFailed = failureKey(r);
  return { on: r.on, ok: r.ok };
}
let lastFailed = null;
function failureKey(r) {
  let st = 'nostat';
  try { const x = fs.statSync(FILE); st = x.size + ':' + x.mtimeMs + ':' + x.ctimeMs; } catch { /* keyed on the error alone */ }
  return (r.code || '') + '|' + st;
}

/* #5460: an unreadable switch ends the ON period for every agent (communitysend's sweep), so one brief failure must not
   count. A read error that usually passes (a Windows scanner holding the file: EBUSY, EPERM, EACCES; too many open
   files; EIO; EAGAIN) and a file that does not parse (caught mid-write by a writer that is not ours) are read again,
   RETRIES more times RETRY_MS apart, before the switch reads as unreadable. Other errors are not retried. */
const RETRIES = 3;
const RETRY_MS = 50;
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EIO', 'EAGAIN']);
let pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readOnce() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, ok: true };
    return { on: false, ok: false, retry: Boolean(err && TRANSIENT.has(err.code)), code: err && err.code };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false, retry: true, code: 'PARSE' }; }
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

/* Tests only: replace the pause between retries (null puts the real one back), and forget the last failure. */
const realPause = pause;
function _setPause(f) { pause = f || realPause; lastFailed = null; }

module.exports = { read, setOn, participating, migrate, FILE, RETRIES, _setPause };
