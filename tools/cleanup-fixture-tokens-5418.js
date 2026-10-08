#!/usr/bin/env node
'use strict';
/**
 * #5418 ask 2: a one-time, careful cleanup of the records that test runs left in this machine's REAL
 * sender-token store before #5418's ask 1 (PR #5452) made that impossible.
 *
 *   node tools/cleanup-fixture-tokens-5418.js --port <board port> --cutoff <ISO date>            (dry run)
 *   node tools/cleanup-fixture-tokens-5418.js --port <board port> --cutoff <ISO date> --apply    (backs up, then removes)
 *
 * What it may remove, and only all of these together:
 *   - a token file whose agent is NOT on the running board's roster (GET /api/status, the board's own list),
 *     is NOT in the board's removal records, and was last written BEFORE the cutoff;
 *   - a writer's leftover temp file (`*.tmp`) last written before the cutoff;
 *   - a symlink whose target does not exist (a security fixture planted one).
 * Anything else in the folder is listed and left alone. A live agent's file is never a candidate,
 * whatever its date.
 *
 * 🛑 NO ROSTER, NO REMOVAL. If the board cannot be reached, or answers without an agent list, the tool
 * stops before planning: an empty roster would make every file a candidate. The port is required, never
 * assumed, because the board's port is per account and a wrong port could read another account's board.
 * 🛑 BACKUP FIRST. --apply copies the whole folder (links as links) to a timestamped folder beside the
 * store root before it removes anything, and stops if the copy fails. Token files go through
 * sendertoken.revoke, under its lock, so a launch minting at that moment cannot race the removal.
 * Prints names and counts only, never a token.
 */
const fs = require('node:fs');
const path = require('node:path');

/* The decision, pure: `entries` is what is in the folder ({ name, isSymlink, targetExists, mtimeMs }), `liveKeys`
   the safeKey'd names to keep (roster plus removal records). Returns { remove: [{ name, kind, why }], keep: [{ name,
   why }] }. Every entry lands in exactly one list. */
function planCleanup(entries, liveKeys, cutoffMs) {
  const remove = [];
  const keep = [];
  for (const e of entries) {
    if (e.other) { keep.push({ name: e.name, why: 'not a file or a link: left alone' }); continue; }
    const old = typeof e.mtimeMs === 'number' && e.mtimeMs < cutoffMs;
    if (e.isSymlink) {
      if (e.targetExists === false) remove.push({ name: e.name, kind: 'symlink', why: 'a link pointing at nothing' });
      else keep.push({ name: e.name, why: 'a link to something that exists: not ours to judge' });
      continue;
    }
    if (e.name.endsWith('.json')) {
      const key = e.name.slice(0, -'.json'.length);
      if (liveKeys.has(key)) keep.push({ name: e.name, why: 'its agent is on the board or in the removal records' });
      else if (!old) keep.push({ name: e.name, why: 'written on or after the cutoff' });
      else remove.push({ name: e.name, kind: 'token', key, why: 'no such agent on the board, written before the cutoff' });
      continue;
    }
    if (e.name.endsWith('.tmp')) {
      if (old) remove.push({ name: e.name, kind: 'temp', why: 'a leftover temp written before the cutoff' });
      else keep.push({ name: e.name, why: 'a temp written on or after the cutoff (may be in flight)' });
      continue;
    }
    keep.push({ name: e.name, why: 'not a token, temp or link: left alone' });
  }
  return { remove, keep };
}

/* What is in the folder, without following links. */
function listEntries(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    const isSymlink = st.isSymbolicLink();
    let targetExists = null;
    if (isSymlink) { try { fs.statSync(p); targetExists = true; } catch (e) { targetExists = e && e.code === 'ENOENT' ? false : null; } }
    if (!isSymlink && !st.isFile()) { out.push({ name, isSymlink: false, mtimeMs: null, other: true }); continue; }
    out.push({ name, isSymlink, targetExists, mtimeMs: st.mtimeMs });
  }
  return out;
}

/* Copy the folder, links as links and modes kept, into a new folder. Throws on any failure. */
function backup(dir, dest) {
  fs.mkdirSync(dest, { recursive: false, mode: 0o700 });
  for (const name of fs.readdirSync(dir)) {
    const from = path.join(dir, name);
    const to = path.join(dest, name);
    const st = fs.lstatSync(from);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else if (st.isFile()) { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); fs.chmodSync(to, st.mode & 0o777); }
  }
}

/* Remove what the plan says, re-checking each entry as it goes. Returns the names removed and any that failed. */
function applyPlan(dir, plan, revoke) {
  const removed = [];
  const failed = [];
  for (const r of plan.remove) {
    const p = path.join(dir, r.name);
    try {
      if (r.kind === 'token') {
        const res = revoke(r.key);
        if (res && res.ok === false) throw new Error(res.because || 'revoke failed');
      } else if (r.kind === 'symlink') {
        if (!fs.lstatSync(p).isSymbolicLink()) throw new Error('no longer a link');
        fs.unlinkSync(p);
      } else if (r.kind === 'temp') {
        if (!fs.lstatSync(p).isFile()) throw new Error('no longer a file');
        fs.unlinkSync(p);
      }
      removed.push(r.name);
    } catch (e) { failed.push({ name: r.name, because: (e && e.message) || String(e) }); }
  }
  return { removed, failed };
}

async function fetchRosterNames(port, boardToken) {
  const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: boardToken ? { 'x-kosmos-board-token': boardToken } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('the board answered ' + res.status);
  const body = await res.json();
  if (!body || !Array.isArray(body.agents)) throw new Error('the board answered without an agent list');
  return body.agents.map((a) => a && a.name).filter((n) => typeof n === 'string' && n);
}

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') out.apply = true;
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--cutoff') out.cutoff = argv[++i];
    else throw new Error('unknown argument: ' + argv[i]);
  }
  if (!Number.isInteger(out.port) || out.port <= 0) throw new Error('--port is required (the board port for THIS account; never assumed)');
  const ms = Date.parse(out.cutoff || '');
  if (!Number.isFinite(ms)) throw new Error('--cutoff is required, as an ISO date');
  out.cutoffMs = ms;
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const store = require('../engine/store');
  const sendertoken = require('../engine/sendertoken');
  const boardauth = require('../engine/boardauth');
  const removal = require('../engine/remove');
  let names;
  try { names = await fetchRosterNames(args.port, boardauth.readToken()); }
  catch (e) { console.error('Stopped, nothing changed: could not read the board roster (' + e.message + ').'); return 2; }
  if (names.length === 0) { console.error('Stopped, nothing changed: the board lists no agents, so every file would look orphaned.'); return 2; }
  const removed = removal.removedAgents().map((r) => r && r.name).filter(Boolean);
  const liveKeys = new Set();
  for (const n of names.concat(removed)) {
    try { liveKeys.add(store.safeKey(n)); } catch { /* an unkeyable name holds no file */ }
  }
  const dir = sendertoken.DIR;
  const plan = planCleanup(listEntries(dir), liveKeys, args.cutoffMs);
  console.log(`Kept by name: ${names.length} agents on the board, ${removed.length} in the removal records.`);
  console.log(`Would remove ${plan.remove.length}, keep ${plan.keep.length}:`);
  for (const r of plan.remove) console.log(`  remove  ${r.name}  (${r.why})`);
  for (const k of plan.keep) console.log(`  keep    ${k.name}  (${k.why})`);
  if (!args.apply) { console.log('Dry run: nothing changed. Add --apply to back up and remove.'); return 0; }
  if (plan.remove.length === 0) { console.log('Nothing to remove.'); return 0; }
  const dest = path.join(path.dirname(dir), 'sendertokens.backup-5418-' + new Date().toISOString().replace(/[:.]/g, '-'));
  try { backup(dir, dest); }
  catch (e) { console.error('Stopped, nothing removed: the backup failed (' + e.message + ').'); return 3; }
  console.log('Backed up to ' + dest);
  const res = applyPlan(dir, plan, sendertoken.revoke);
  console.log(`Removed ${res.removed.length}.`);
  for (const f of res.failed) console.log(`  not removed  ${f.name}  (${f.because})`);
  return res.failed.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { console.error('Stopped: ' + ((e && e.message) || e)); process.exitCode = 2; });
}

module.exports = { planCleanup, listEntries, backup, applyPlan, parseArgs, fetchRosterNames, main };
