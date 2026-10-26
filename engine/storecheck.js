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
 * Which files: every .json directly in the data root, the store folders below, and the worlds registry at the base
 * (it lives above a named world's root). There is no central list of stores; this is the list.
 *
 * The good copy: Kosmos keeps no backups of these files, so the only good copy there can be is one a crash left
 * behind: a write's temp file (`<file>.kosmos-<pid>-...tmp`, engine/securewrite.js) that still reads as JSON, or a
 * `.bak` / `.prev` beside it. A temp file is deleted by the next write into its folder, so a good one is first copied
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
};
const MAX_BYTES = 64 * 1024 * 1024;   // larger is not one of these stores; never read it whole
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
let BASE_ROOT = null;    // where worlds.json lives, captured at start

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
  unopenable: 'cannot be opened (its permissions changed)', toobig: 'is too large for Kosmos to check' };

function rel(abs) {
  // Said relative to the data root (or the base), never as a home path: board.log and the screen carry it.
  const r = path.relative(store.ROOT, abs);
  if (r && !r.startsWith('..') && !path.isAbsolute(r)) return r;
  const b = BASE_ROOT ? path.relative(BASE_ROOT, abs) : '';
  return b && !b.startsWith('..') && !path.isAbsolute(b) ? b : path.basename(abs);   // never an absolute path (Windows drives)
}

function candidates(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    if (d.name.startsWith('.') || !d.name.endsWith('.json')) continue;
    if (!d.isFile() && !d.isSymbolicLink()) continue;   // a linked store is checked at its target (statSync below)
    out.push(path.join(dir, d.name));
  }
  return out;
}

/** The newest copy beside `file` that reads as JSON and is not empty, or null. */
function goodCopy(file) {
  if (holdsSecret(file)) return null;
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
  const files = candidates(store.ROOT);
  for (const f of Object.keys(FOLDERS)) files.push(...candidates(path.join(store.ROOT, f)));
  if (BASE_ROOT && path.resolve(BASE_ROOT) !== path.resolve(store.ROOT)) {
    const reg = path.join(BASE_ROOT, 'worlds.json');
    if (fs.existsSync(reg)) files.push(reg);
  }
  const found = [];
  for (const file of files) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }   // a dangling link or a file gone meanwhile: nothing to name
    if (!st.isFile()) continue;
    let problem;
    if (st.size > MAX_BYTES) problem = 'toobig';
    else {
      let buf = null;
      try { buf = fs.readFileSync(file); } catch (err) { problem = err && (err.code === 'EACCES' || err.code === 'EPERM') ? 'unopenable' : null; }
      if (buf) problem = classify(buf);
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
        : d.secret ? 'It holds a key or something you can take back, so Kosmos keeps no copy of it to put back.' : 'No good copy of it was found.'));
  }
  return found;
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
    return { file: d.file, holds: d.holds, problem: d.problem, backup: d.backup, secret: d.secret, savedOver };
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
  return { ok: true };
}

/** The person said they have seen it: not shown again until the next start. */
function dismiss() { FOUND = []; return true; }

module.exports = { atStart, scan, current, restore, dismiss, classify };
