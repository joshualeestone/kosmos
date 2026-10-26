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
const PROBLEM = { empty: 'is empty', nul: 'holds only empty bytes (a crash can leave a file like this)', unreadable: 'cannot be read as Kosmos data' };

function rel(abs) {
  // Said relative to the data root (or the base), never as a home path: board.log and the screen carry it.
  const r = path.relative(store.ROOT, abs);
  if (!r.startsWith('..')) return r;
  return BASE_ROOT ? path.relative(BASE_ROOT, abs) : path.basename(abs);
}

function candidates(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    if (!d.isFile() || d.name.startsWith('.') || !d.name.endsWith('.json')) continue;
    out.push(path.join(dir, d.name));
  }
  return out;
}

/** The newest copy beside `file` that reads as JSON and is not empty, or null. */
function goodCopy(file) {
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
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    let buf;
    try { buf = fs.readFileSync(p); } catch { continue; }
    if (classify(buf) !== null) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs, isTmp };
  }
  if (!best) return null;
  if (best.isTmp) {
    // Kept under a new name before anything deletes the temp file; 'wx' never writes over an existing file.
    const kept = path.join(dir, base + '.recovered-' + new Date(best.mtimeMs).toISOString().replace(/[:.]/g, '-'));
    try { fs.copyFileSync(best.path, kept, fs.constants.COPYFILE_EXCL); } catch (err) { if (err.code !== 'EEXIST') return null; }
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
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    let buf;
    try { buf = fs.readFileSync(file); } catch { continue; }
    const problem = classify(buf);
    if (!problem) continue;
    const folder = path.basename(path.dirname(file));
    const holds = HOLDS[path.basename(file)] || (path.dirname(file) !== store.ROOT && FOLDERS[folder]) || 'a record Kosmos keeps';
    const copy = goodCopy(file);
    found.push({ file: rel(file), holds, problem, backup: copy ? { file: rel(copy.path), at: copy.at } : null, abs: file, copyAbs: copy ? copy.path : null });
  }
  FOUND = found;
  return found;
}

/** At board start: scan, and say each one in the board log. Never throws. */
function atStart(opts, write) {
  const say = write || ((line) => process.stderr.write(line + '\n'));
  let found = [];
  try { found = scan(opts); } catch (err) { say('Kosmos could not check its own files at start: ' + ((err && err.message) || err)); return []; }
  for (const d of found) {
    say('Kosmos found a damaged file at start: ' + d.file + ' ' + PROBLEM[d.problem] + ' (it holds ' + d.holds + '). '
      + 'Kosmos left it as it is. '
      + (d.backup ? 'A good copy from ' + d.backup.at + ' is at ' + d.backup.file + '; the person can put it back.' : 'No good copy of it was found.'));
  }
  return found;
}

/** What the page shows: the damaged stores this start found and has not been told to put back. */
function current() {
  return FOUND.map((d) => ({ file: d.file, holds: d.holds, problem: d.problem, backup: d.backup }));
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
  // The store must still be the damaged one: if something wrote it meanwhile, nothing here replaces that.
  let now;
  try { now = fs.readFileSync(d.abs); } catch { now = null; }
  if (now && classify(now) === null) return { ok: false, why: 'it is readable again, so Kosmos left it alone' };
  const aside = d.abs + '.damaged-' + new Date().toISOString().replace(/[:.]/g, '-');
  try {
    if (now) fs.copyFileSync(d.abs, aside, fs.constants.COPYFILE_EXCL);
    const tmp = d.abs + '.restore-' + process.pid + '.tmp';
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, d.abs);
  } catch (err) {
    say('Kosmos could not put back the good copy of ' + d.file + ': ' + ((err && err.message) || err));
    return { ok: false, why: 'Kosmos could not put it back' };
  }
  say('Kosmos put back the good copy of ' + d.file + ' from ' + d.backup.at + ', at the person\'s request; the damaged one is kept at ' + rel(aside) + '.');
  FOUND = FOUND.filter((x) => x !== d);
  return { ok: true };
}

/** The person said they have seen it: not shown again until the next start. */
function dismiss() { FOUND = []; return true; }

module.exports = { atStart, scan, current, restore, dismiss, classify };
