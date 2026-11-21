'use strict';
/**
 * kosmos#7248: at board start, name any of Kosmos's own JSON stores that a crash left empty, filled with NUL bytes,
 * or not readable as JSON, say what each one holds, and offer the newest good copy if one exists. Nothing here ever
 * changes a store by itself: a damaged store is left exactly as it was found, and a good copy goes back only when the
 * person asks for it (restore), with the damaged file kept aside under a new name.
 *
 * Why at start, and first: several readers treat a damaged store as empty and a later write replaces it (profiles,
 * settings, worlds.json, the sender tokens), so the only moment the damage is still there to name is before anything
 * else has read the store. An agent found one by hand after a crash (feedback, 2026-10-26).
 *
 * Which files: every .json directly in the data root, the store folders below, the worlds registry at the base (it
 * lives above a named world's root), and (kosmos#8863) the data root's .jsonl records. There is no central list of
 * stores; this is the list.
 *
 * The good copy (kosmos#8863): Kosmos keeps its own copy of the stores LAST_GOOD_FILES and LAST_GOOD_FOLDERS name, in
 * last-good/, made a minute after start and then daily (startKeepingLastGood). Besides that, a copy a crash
 * left behind can be offered: a write's temp file (`<file>.kosmos-<pid>-...tmp`, engine/securewrite.js) that still
 * reads as JSON, or a `.bak` / `.prev` beside it. A temp file is deleted by the next write into its folder, so a good one is first copied
 * to `<file>.recovered-<when>` (a new name, never over anything) and that copy is what is offered.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

// What each store holds, in the words the person reads. A file not named here is "a record Kosmos keeps".
const HOLDS = {
  'projects.json': 'your projects, their tasks and who is on them',
  'settings.json': 'your settings',
  'removed.json': 'the agents you removed',
  'you.json': 'your About you answers',
  'worlds.json': 'your list of Kosmoses and which one is open',
  'remote.json': 'your Kosmos+ settings',
  'remote-status.json': 'how Kosmos+ is connected',
  'policy.json': 'your AI policies',
  'limits.json': 'your usage limits',
  'webhooks.json': 'your webhooks',
  'instruction-adds.json': 'what you added to your agents\' instructions',
  'agent-stars.json': 'the agents you starred',
  'federation.json': 'the computers this Kosmos is joined with',
  'first-run.json': 'that setup is finished',
  'agent-language.json': 'the language your agents write to you in',
  'autoupdate.json': 'your update setting',
  'community.json': 'your Community setting',
  'org-enrollment.json': 'your company\'s Kosmos+ enrollment',
  'service-keys.json': 'the keys for services you connected',
  'stall-pushes.json': 'when Kosmos last told your phone that an agent\'s messages were stuck',   // kosmos#7212
  // kosmos#8863: the append-only records in the data root (a .jsonl is checked for a crash's blank stretch only).
  'messages.jsonl': 'the messages your agents sent each other',
  'messages.ids.jsonl': 'which of your agents\' messages were already delivered',
  'created.jsonl': 'a record of the agents created here',
  'ended-agents.jsonl': 'a record of the agents ended here',
  'autobalance-record.jsonl': 'what automatic account balancing decided',
};
// Store folders, one level deep, and what one file in each holds.
const FOLDERS = {
  profiles: 'an agent\'s profile',
  commitments: 'an agent\'s commitments',
  sendertokens: 'an agent\'s sign-in for Kosmos',
  webhooks: 'your webhooks',
  community: 'Community posts and comments',
  communitysend: 'what your agents sent to the Community',
  catalogue: 'the catalogue',
  remote: 'Kosmos+ connection state',
  limitqueue: 'messages kept for an agent until its usage resets',   // kosmos#8863: the send queue a crash can stop
  chats: 'a conversation with an agent',                              // kosmos#8863
};
const MAX_BYTES = 64 * 1024 * 1024;   // larger is not one of these stores; never read it whole
/* kosmos#8863: where Kosmos keeps its own last good copies, at each store's path relative to the data root. */
const LAST_GOOD = 'last-good';
const LAST_GOOD_MAX = 8 * 1024 * 1024;     // a larger store is not copied
const LAST_GOOD_EVERY_MS = 24 * 60 * 60 * 1000;
/* Stores whose older copy must never come back by itself: a secret (a key, a token, a sign-in), or something the person
   can take back (a webhook, an agent's permission, a company consent). Their damage is named, but no copy is kept or
   put back: a kept secret outlives its own revocation (engine/securewrite.js), and an older copy would revive what was
   removed or withdrawn (reviews 1 and 2). Matched by the path relative to the data root, so an agent named "remote"
   (profiles/remote.json) is not caught by a file name. */
const SENSITIVE_FILES = new Set(['remote.json', 'service-keys.json', 'org-enrollment.json', 'org-consent.json', 'fed-seal-key.json',
  'github-app.json', 'codex-signins.json', 'grok-signins.json', 'agent-permission-settings.json']);
const SENSITIVE_FOLDERS = new Set(['sendertokens', 'communitysend', 'remote', 'webhooks']);
function holdsSecret(file) {
  const r = path.relative(store.ROOT, file);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return false;
  const parts = r.split(path.sep);
  return parts.length === 1 ? SENSITIVE_FILES.has(parts[0]) : SENSITIVE_FOLDERS.has(parts[0]);
}

let FOUND = [];          // the damaged stores this start found
let UNREAD = 0;          // kosmos#8287: folders and files this scan could not read, so it cannot say they are fine
let SCANNED = null;      // kosmos#8287: what this start's scan found, before anyone repairs or dismisses it; null if it did not finish
let BASE_ROOT = null;    // where worlds.json lives, captured at start
const DAMAGED_THIS_RUN = new Set();   // kosmos#8863: a store found damaged this run never refreshes its last good copy

const isLog = (file) => file.endsWith('.jsonl');
/* kosmos#8863: an append-only record (.jsonl). Empty is a normal state, and a torn line is what an ordinary append crash
   or a concurrent writer leaves (its readers skip it), so neither is reported. A NUL byte is: raw NUL never appears in
   JSON text, and a crash that grew the file before its bytes reached the disk leaves exactly that. Lines are not parsed. */
function classifyLog(buf) {
  if (!buf.length || buf.indexOf(0) === -1) return null;
  for (const b of buf) if (b !== 0) return 'nulpart';
  return 'nul';
}
const classifyFor = (file, buf) => (isLog(file) ? classifyLog(buf) : classify(buf));
const LOG_TAIL = 8 * 1024 * 1024;
/* kosmos#8863: classifyLog on the last LOG_TAIL bytes of an append-only record, so a long log is neither read whole at
   start nor reported as too large. An all-NUL tail of a longer file is 'nulpart': only its end was read. null when the
   file is gone; 'unopenable' when it cannot be opened. */
function logTail(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, LOG_TAIL);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) { const n = fs.readSync(fd, buf, got, len - got, size - len + got); if (!n) break; got += n; }
    const r = classifyLog(buf.subarray(0, got));
    return r === 'nul' && size > got ? 'nulpart' : r;
  } catch (err) {
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return 'unopenable';
    if (!err || err.code !== 'ENOENT') UNREAD += 1;   // not looked at, so the scan cannot call it fine
    return null;
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/** 'empty', 'nul' or 'unreadable', or null when the bytes are a JSON value. */
function classify(buf) {
  if (!buf.length) return 'empty';
  let allNul = true;
  for (const b of buf) { if (b !== 0) { allNul = false; break; } }
  if (allNul) return 'nul';
  const text = buf.toString('utf8');
  if (!text.trim()) return 'empty';
  try { JSON.parse(text); return null; } catch { return 'unreadable'; }
}
const PROBLEM = { empty: 'is empty', nul: 'is blank, as a crash can leave a file', unreadable: 'cannot be read as Kosmos data',
  unopenable: 'cannot be opened (its permissions changed)', toobig: 'is too large for Kosmos to check',
  nulpart: 'has a blank stretch, as a crash can leave a file, and what was written there is lost' };   // kosmos#8863

function rel(abs) {
  // Said relative to the data root (or the base), never as a home path: board.log and the screen carry it.
  const r = path.relative(store.ROOT, abs);
  if (r && !r.startsWith('..') && !path.isAbsolute(r)) return r;
  const b = BASE_ROOT ? path.relative(BASE_ROOT, abs) : '';
  return b && !b.startsWith('..') && !path.isAbsolute(b) ? b : path.basename(abs);   // never an absolute path (Windows drives)
}

function candidates(dir, withLogs) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { if (!err || err.code !== 'ENOENT') UNREAD += 1; return out; }
  for (const d of names) {
    if (d.name.startsWith('.') || !(d.name.endsWith('.json') || (withLogs && d.name.endsWith('.jsonl')))) continue;
    if (!d.isFile() && !d.isSymbolicLink()) continue;   // a linked store is checked at its target (statSync below)
    out.push(path.join(dir, d.name));
  }
  return out;
}

/** The newest copy of `file` that reads as JSON and is not empty (beside it, or its last good copy), or null. */
function goodCopy(file) {
  // kosmos#8863: no copy of an append-only record: the board keeps appending, and an older copy drops every record since.
  if (holdsSecret(file) || isLog(file)) return null;
  const dir = path.dirname(file);
  const base = path.basename(file);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  for (const n of names) {
    const isTmp = n.startsWith(base + '.kosmos-') && n.endsWith('.tmp');
    const isKept = n === base + '.bak' || n === base + '.prev' || n.startsWith(base + '.recovered-');
    if (!isTmp && !isKept) continue;
    const p = path.join(dir, n);
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;   // lstat: a link is never offered (review 1)
    let buf;
    try { buf = fs.readFileSync(p); } catch { continue; }
    if (classify(buf) !== null) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs, st, isTmp };
  }
  // kosmos#8863: Kosmos's own last good copy, at the same path under last-good/, when it is newer than anything above.
  const lg = lastGoodPath(file);
  if (lg) {
    try {
      const st = fs.lstatSync(lg);
      if (st.isFile() && st.size <= MAX_BYTES && classify(fs.readFileSync(lg)) === null && (!best || st.mtimeMs > best.mtimeMs)) {
        best = { path: lg, mtimeMs: st.mtimeMs, st, isTmp: false };
      }
    } catch { /* none kept */ }
  }
  if (!best) return null;
  if (best.isTmp) {
    // Kept under a new name before anything deletes the temp file; 'wx' never writes over an existing file.
    const kept = path.join(dir, base + '.recovered-' + new Date(best.mtimeMs).toISOString().replace(/[:.]/g, '-'));
    try {
      fs.copyFileSync(best.path, kept, fs.constants.COPYFILE_EXCL);
      // The copy keeps the write's own time, or a later start would offer "the copy saved" at the time it was kept.
      fs.utimesSync(kept, best.st.atime, best.st.mtime);
    } catch (err) { if (err.code !== 'EEXIST') return null; }
    return { path: kept, at: new Date(best.mtimeMs).toISOString() };
  }
  return { path: best.path, at: new Date(best.mtimeMs).toISOString() };
}

/** Look at every store once and remember what is damaged. Reads only, except keeping a crash's good temp copy. */
function scan(opts) {
  BASE_ROOT = (opts && opts.base) || null;
  UNREAD = 0;
  const files = candidates(store.ROOT, true);
  for (const f of Object.keys(FOLDERS)) files.push(...candidates(path.join(store.ROOT, f)));
  if (BASE_ROOT && path.resolve(BASE_ROOT) !== path.resolve(store.ROOT)) {
    const reg = path.join(BASE_ROOT, 'worlds.json');
    if (fs.existsSync(reg)) files.push(reg);
  }
  const found = [];
  for (const file of files) {
    let st;
    try { st = fs.statSync(file); } catch (err) { if (!err || err.code !== 'ENOENT') UNREAD += 1; continue; }   // a dangling link or a file gone meanwhile: nothing to name
    if (!st.isFile()) continue;
    let problem;
    if (isLog(file)) problem = logTail(file);   // kosmos#8863: a log of any size; its tail is where a crash leaves NULs
    else if (st.size > MAX_BYTES) problem = 'toobig';
    else {
      let buf = null;
      try { buf = fs.readFileSync(file); } catch (err) { problem = err && (err.code === 'EACCES' || err.code === 'EPERM') ? 'unopenable' : null; if (!problem && (!err || err.code !== 'ENOENT')) UNREAD += 1; }
      if (buf) problem = classifyFor(file, buf);
    }
    if (!problem) continue;
    const folder = path.basename(path.dirname(file));
    // The root's own words only for a file at the root (or the worlds registry at the base): profiles/remote.json is
    // an agent's profile, not your Kosmos+ settings (review 3).
    const atRoot = path.dirname(file) === store.ROOT || path.basename(file) === 'worlds.json';
    const holds = (atRoot && HOLDS[path.basename(file)]) || (!atRoot && FOLDERS[folder]) || 'a record Kosmos keeps';
    const copy = problem === 'toobig' || problem === 'unopenable' ? null : goodCopy(file);
    found.push({ file: rel(file), holds, problem, backup: copy ? { file: rel(copy.path), at: copy.at } : null, secret: holdsSecret(file), abs: file, copyAbs: copy ? copy.path : null, size: st.size, mtimeMs: st.mtimeMs });
  }
  FOUND = found;
  for (const d of found) DAMAGED_THIS_RUN.add(d.abs);
  SCANNED = { checked: UNREAD === 0 || found.length > 0, damaged: found.length, unread: UNREAD };
  return found;
}

/** At board start: scan, and say each one in the board log. Never throws. */
function atStart(opts, write) {
  const say = write || ((line) => process.stderr.write(line + '\n'));
  let found = [];
  try { found = scan(opts); } catch (err) { say('Kosmos could not check its own files at start (' + ((err && err.code) || 'an error') + ').'); return []; }
  for (const d of found) {
    say('Kosmos found a damaged file at start: ' + d.file + ' ' + PROBLEM[d.problem] + ' (it holds ' + d.holds + '). '
      + 'Kosmos left it as it is. '
      + (d.backup ? 'A good copy saved ' + d.backup.at + ' is at ' + d.backup.file + '; the person can put it back.'
        : d.secret ? 'It holds a key or something you can take back, so Kosmos keeps no copy of it to put back.'
          : isLog(d.abs) ? 'Kosmos keeps adding new records to it, so there is nothing to put back.' : 'No good copy of it was found.'));
  }
  return found;
}

/* kosmos#8863: the stores Kosmos keeps a last good copy of, by name: an ALLOWLIST, not the secret list above (that list
   decides what may be offered; this one decides what Kosmos copies on its own and keeps). A store not named here is not
   copied. Why the others are not, in .claude/plans/crashcheck-8863.md; the forget kinds are pinned by a test. */
const LAST_GOOD_FILES = new Set(['settings.json', 'projects.json', 'you.json', 'instruction-adds.json', 'agent-stars.json',
  'first-run.json', 'agent-language.json', 'autoupdate.json']);
const LAST_GOOD_FOLDERS = new Set(['profiles', 'catalogue']);

/* kosmos#8863: where the last good copy of `file` lives, or null for a store that gets none. */
function lastGoodPath(file) {
  const r = path.relative(store.ROOT, file);
  if (!r || r.startsWith('..') || path.isAbsolute(r) || !r.endsWith('.json')) return null;
  const parts = r.split(path.sep);
  const allowed = parts.length === 1 ? LAST_GOOD_FILES.has(parts[0]) : parts.length === 2 && LAST_GOOD_FOLDERS.has(parts[0]);
  return allowed ? path.join(store.ROOT, LAST_GOOD, r) : null;
}

/* kosmos#8863: remove each copy whose store is gone or is no longer one that gets a copy, so a removed store's data
   is not kept, or offered again under its name. Only files under last-good/, by name. */
function pruneLastGood() {
  const base = path.join(store.ROOT, LAST_GOOD);
  const copies = [];
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth === 0) walk(p, 1);
      else if (e.isFile() && e.name.endsWith('.json')) copies.push(p);
    }
  };
  walk(base, 0);
  let n = 0;
  for (const copy of copies) {
    const src = path.join(store.ROOT, path.relative(base, copy));
    let gone = false;
    try { fs.lstatSync(src); } catch (err) { gone = Boolean(err && err.code === 'ENOENT'); }
    if (gone || lastGoodPath(src) !== copy) {
      try { fs.unlinkSync(copy); n += 1; } catch { /* the next pass tries again */ }
    }
  }
  return n;
}

/* kosmos#8863: the stores keepLastGood looks at. */
function lastGoodCandidates() {
  const files = candidates(store.ROOT, false);
  for (const f of LAST_GOOD_FOLDERS) files.push(...candidates(path.join(store.ROOT, f), false));
  return files;
}

/* kosmos#8863: copy one store into last-good/ if it is allowed, reads as good, was not found damaged this run and
   differs from its copy. Flushed and renamed into place at the store's own permissions, with its modified time.
   Returns 1 when it copied, else 0. */
function copyOne(file) {
  const to = lastGoodPath(file);
  if (!to || DAMAGED_THIS_RUN.has(file)) return 0;
  let st;
  try { st = fs.lstatSync(file); } catch { return 0; }
  if (!st.isFile() || st.size > LAST_GOOD_MAX) return 0;   // lstat: a linked store is not copied through its link
  let buf;
  try { buf = fs.readFileSync(file); } catch { return 0; }
  if (classify(buf) !== null) return 0;
  // Unchanged since the last copy: compared by content, since a copied time keeps only whole milliseconds.
  try { if (fs.readFileSync(to).equals(buf)) return 0; } catch { /* no copy yet */ }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') require('./securewrite').writeSecret(to, buf, null, { atomicOnly: true, umaskDefault: true });
    else require('./securewrite').writeSecret(to, buf, st.mode & 0o777, { atomicOnly: true });
    fs.utimesSync(to, st.atime, st.mtime);
    return 1;
  } catch { return 0; }   // best effort: the next pass tries again
}

/** kosmos#8863: one whole pass at once, then prune. Returns how many were copied. */
function keepLastGood() {
  let n = 0;
  for (const file of lastGoodCandidates()) n += copyOne(file);
  pruneLastGood();
  return n;
}

/* kosmos#8863: the same pass one store per turn of the event loop, so the board keeps answering while it runs (each
   copy is flushed to disk). Calls done(copied). */
let stepping = false;
function keepLastGoodInSteps(done) {
  if (stepping) return false;
  stepping = true;
  const files = lastGoodCandidates();
  let i = 0;
  let n = 0;
  const step = () => {
    try {
      if (i < files.length) { n += copyOne(files[i]); i += 1; setImmediate(step); return; }
      pruneLastGood();
    } catch { /* best effort */ }
    stepping = false;
    if (done) done(n);
  };
  setImmediate(step);
  return true;
}

let lastGoodTimer = null;
const LAST_GOOD_FIRST_MS = 60 * 1000;   // after start, so the copies never hold up the board coming back
/** kosmos#8863: a pass a minute after start, then every day, each in steps. The timers never hold the process open. */
function startKeepingLastGood() {
  if (lastGoodTimer) return;
  const run = () => { try { keepLastGoodInSteps(); } catch { /* best effort */ } };
  const first = setTimeout(run, LAST_GOOD_FIRST_MS);
  if (first.unref) first.unref();
  lastGoodTimer = setInterval(run, LAST_GOOD_EVERY_MS);
  if (lastGoodTimer.unref) lastGoodTimer.unref();
}

/** Whether a store was written since this start found it damaged: its size or its time moved. */
function changedSince(d) {
  const st = fs.statSync(d.abs);
  return st.size !== d.size || st.mtimeMs !== d.mtimeMs;
}

/** What the page shows: the damaged stores this start found and has not been told to put back. */
function current() {
  /* Looked at again each time the page asks (review 1): a reader that treats a damaged store as empty writes over it
     on its next save, and then "Kosmos has not changed it" would no longer be true. `savedOver` says so. */
  return FOUND.map((d) => {
    let savedOver = false;
    // One rule for every size (review 3): its size or time moved since start, even if it is still not readable.
    try { savedOver = changedSince(d); } catch { savedOver = false; }
    // kosmos#8863: `log`: an append-only record, which the board adds to and which has no copy to put back.
    return { file: d.file, holds: d.holds, problem: d.problem, backup: d.backup, secret: d.secret, savedOver, log: isLog(d.abs) };
  });
}

/**
 * Put the good copy back for one damaged store, at the person's request only. The damaged file is kept aside under a
 * new name, never deleted, and the store is replaced with the copy by a write and a rename. Returns { ok, why }.
 */
function restore(file, write) {
  const say = write || ((line) => process.stderr.write(line + '\n'));
  const d = FOUND.find((x) => x.file === file);
  if (!d) return { ok: false, why: 'that file is not one Kosmos found damaged' };
  if (!d.copyAbs) return { ok: false, why: 'there is no good copy of it' };
  let buf;
  try { buf = fs.readFileSync(d.copyAbs); } catch { return { ok: false, why: 'the good copy could not be read' }; }
  if (classify(buf) !== null) return { ok: false, why: 'the good copy is no longer good' };
  /* Only while the store is still the damaged one (review 2): if anything wrote it since this start (the person changed
     a setting, a reader saved over it), putting an older copy back would undo that, so it is refused and the page says
     where the copy is kept. A linked store is not replaced through its link. Nothing is ever deleted here; the owning
     module's lock is not taken: inside the board everything is one thread, so the residual is another process (the
     CLI, a second board) writing the same store in the same moment. */
  let lst;
  try { lst = fs.lstatSync(d.abs); } catch { return { ok: false, why: 'it is no longer there, so Kosmos did not bring it back' }; }
  if (lst.isSymbolicLink()) return { ok: false, why: 'it is a link to another place, so Kosmos left it alone' };
  let now;
  try { now = fs.readFileSync(d.abs); } catch { return { ok: false, why: 'Kosmos cannot open it' }; }
  // Still the SAME damaged file, not merely still unreadable: a hand edit that left a stray comma is newer data (review 3).
  if (classify(now) === null || changedSince(d)) return { ok: false, why: 'it has been saved since Kosmos started, so Kosmos left it; the copy is kept at ' + d.backup.file };
  const aside = d.abs + '.damaged-' + new Date().toISOString().replace(/[:.]/g, '-');
  try {
    if (fs.existsSync(aside)) return { ok: false, why: 'try again in a moment' };
    // Created at the store's own permissions in one step, never briefly readable by others (reviews 2 and 3).
    if (process.platform === 'win32') require('./securewrite').writeSecret(aside, now, null, { atomicOnly: true, umaskDefault: true });
    else require('./securewrite').writeSecret(aside, now, lst.mode & 0o777, { atomicOnly: true });
    store.saveFlushed(d.abs, buf);   // flushed before it replaces the file, so a crash cannot leave it blank again
  } catch (err) {
    say('Kosmos could not put back the good copy of ' + d.file + ' (' + ((err && err.code) || 'an error') + ').');
    return { ok: false, why: 'Kosmos could not put it back' };
  }
  say('Kosmos put back the good copy of ' + d.file + ' saved ' + d.backup.at + ', at the person\'s request; '
    + 'the damaged one is kept at ' + rel(aside) + '.');
  FOUND = FOUND.filter((x) => x !== d);
  DAMAGED_THIS_RUN.delete(d.abs);   // kosmos#8863: it holds a good copy again, so its last good copy may follow it
  return { ok: true };
}

/** The person said they have seen it: not shown again until the next start. */
function dismiss() { FOUND = []; return true; }

/**
 * kosmos#8287, #8297: what this start's scan may say, as { checked, damaged, unread }.
 * - `damaged`: how many records it found damaged. `unread`: how many it could not look at (a folder it could not list,
 *   a file it could not stat or read).
 * - `checked` is false when the scan has not run, or when something was unread and nothing damaged was found: "read
 *   fine" would then be a claim about files it never saw. When something damaged was found, `checked` stays true and
 *   `unread` says the count is a floor.
 */
function lastScan() { return SCANNED ? { ...SCANNED } : { checked: false }; }

module.exports = { atStart, scan, current, restore, dismiss, classify, classifyLog, lastScan, keepLastGood, keepLastGoodInSteps, startKeepingLastGood, LAST_GOOD };
