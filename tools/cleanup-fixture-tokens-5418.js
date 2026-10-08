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
 *     is NOT in the board's removal records, was last written BEFORE the cutoff, and is named exactly as the
 *     store names its files (a name the store could not have written is listed and left alone), and holds
 *     no `launcher: 'remote'` token (a remote agent is on the roster only while its heartbeat is fresh, so an
 *     offline one would look orphaned). Its age is its NEWEST sign of life: the latest token mintedAt or the
 *     file's mtime, whichever is later;
 *   - a writer's leftover temp file, named in the shape the store's writer uses
 *     (`<file>.kosmos-<pid>-[t<thread>-]<started>-<seq>.tmp`), last written before the cutoff;
 *   - a symlink whose target does not exist (a security fixture planted one), unless its name is a live agent's.
 * Anything else in the folder is listed and left alone. A live agent's file is never a candidate,
 * whatever its date.
 *
 * 🛑 THE ROSTER IS THE ONLY GUARD FOR A LIVE AGENT (the cutoff is in the past for every live file). So:
 *   - a roster row counts under EVERY spelling a token file can carry: its session name (the key tokens are
 *     minted under, by the supervisor's token_roster_name: +world stripped, then -discord), that stripped form,
 *     and its display name. A spelling too many keeps a file; a spelling too few would delete a live one.
 *   - beyond the roster, a key with a heartbeat (liveness) record of ANY age is kept: a remote agent reports
 *     through that path, and one minted before #4530 carries no launcher tag to keep it by.
 *   - no roster, an empty one, or no board token to send stops the tool before planning. The real tie between
 *     the board on that port and this store is the board token: a board refuses a token that is not its own.
 *     A roster matching NONE of the store's token files also stops it, as a backstop for a board that does not
 *     enforce its token. The port is required, never assumed.
 *   - each token file is removed only if, under the store's lock, it is still the file the plan looked at
 *     (sendertoken.revokeIfUnchanged): a token minted since the plan was made is never taken.
 *   - a cutoff in the future is refused.
 * 🛑 BACKUP FIRST. --apply copies exactly the entries it is about to remove (files with their modes, links as
 * links) to a new timestamped folder beside the store, and stops if the copy fails. Only those: a copy of every
 * live agent's token would be a second set of live credentials left lying around.
 * Prints names and counts only, never a token.
 */
const fs = require('node:fs');
const path = require('node:path');

/* The decision, pure: `entries` is what is in the folder ({ name, isSymlink, targetExists, mtimeMs }), `liveKeys`
   the safeKey'd names to keep (roster plus removal records). Returns { remove: [{ name, kind, why }], keep: [{ name,
   why }] }. Every entry lands in exactly one list. */
/* The writer's own temp shape (securewrite's tempPath, and sendertoken's before #1787), anchored at the end. Any
   other name is not a temp this store wrote, so it is listed and left alone. */
const TEMP_SHAPE = /\.kosmos-\d+-(?:t\d+-)?\d+-\d+\.tmp$/;

function planCleanup(entries, liveKeys, cutoffMs, safeKey) {
  const canon = (k) => { try { return safeKey(k); } catch { return null; } };
  const remove = [];
  const keep = [];
  for (const e of entries) {
    if (e.other) { keep.push({ name: e.name, why: 'not a file or a link: left alone' }); continue; }
    const old = typeof e.mtimeMs === 'number' && e.mtimeMs < cutoffMs;
    if (e.isSymlink) {
      const linkKey = e.name.endsWith('.json') ? e.name.slice(0, -'.json'.length) : null;
      if (linkKey !== null && liveKeys.has(canon(linkKey))) keep.push({ name: e.name, why: 'a link named for a live agent: left alone' });
      else if (e.targetExists === false) remove.push({ name: e.name, kind: 'symlink', why: 'a link pointing at nothing' });
      else if (e.targetExists === true) keep.push({ name: e.name, why: 'a link to something that exists: not ours to judge' });
      else keep.push({ name: e.name, why: 'a link whose target could not be checked: left alone' });
      continue;
    }
    if (e.name.endsWith('.json')) {
      const key = e.name.slice(0, -'.json'.length);
      /* revoke(key) removes the file named safeKey(key), so only a file already named that way can be planned:
         otherwise the dry run would list one file and --apply remove another. */
      const info = e.tokens || { launchers: [], newestMintMs: null };
      const newest = Math.max(typeof e.mtimeMs === 'number' ? e.mtimeMs : Infinity, typeof info.newestMintMs === 'number' ? info.newestMintMs : -Infinity);
      if (canon(key) !== key) keep.push({ name: e.name, why: 'not a name the store writes: left alone' });
      else if (liveKeys.has(key)) keep.push({ name: e.name, why: 'its agent is on the board or in the removal records' });
      else if (info.launchers.includes('remote')) keep.push({ name: e.name, why: 'holds a remote agent\'s token (an offline remote agent is not on the board)' });
      else if (!(newest < cutoffMs)) keep.push({ name: e.name, why: 'minted or written on or after the cutoff' });
      else remove.push({ name: e.name, kind: 'token', key, mtimeMs: e.mtimeMs, launchers: info.launchers, newestMintMs: info.newestMintMs, why: 'no such agent on the board, nothing newer than the cutoff' });
      continue;
    }
    if (TEMP_SHAPE.test(e.name)) {
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
    const entry = { name, isSymlink, targetExists, mtimeMs: st.mtimeMs };
    if (!isSymlink && name.endsWith('.json')) entry.tokens = tokenInfo(p);
    out.push(entry);
  }
  return out;
}

/* What a token file says about itself: the launchers its tokens name and the newest mintedAt. An unreadable file
   says nothing (no launchers, no mint time), so only its mtime ages it. */
function tokenInfo(file) {
  const out = { launchers: [], newestMintMs: null };
  let kept;
  try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return out; }
  const tokens = kept && Array.isArray(kept.tokens) ? kept.tokens : (kept && typeof kept.token === 'string' ? [kept] : []);
  for (const t of tokens) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.launcher === 'string' && !out.launchers.includes(t.launcher)) out.launchers.push(t.launcher);
    const ms = Date.parse(t.mintedAt || '');
    if (Number.isFinite(ms) && (out.newestMintMs === null || ms > out.newestMintMs)) out.newestMintMs = ms;
  }
  return out;
}

/* Copy the named entries, links as links and modes kept, into a new folder. Throws on any failure. */
function backup(dir, dest, names) {
  fs.mkdirSync(dest, { recursive: false, mode: 0o700 });
  for (const name of names) {
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
        const res = revoke(r.key, r.mtimeMs);   // sendertoken.revokeIfUnchanged: re-checked under the store's lock
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

async function fetchRoster(port, boardToken) {
  /* Ask, WITHOUT the token, whether a Kosmos board answers on that port at all, so a wrong --port never hands
     this store's board token to some other local program. */
  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10000) });
  let h = null;
  try { h = await health.json(); } catch { h = null; }
  if (!health.ok || !h || h.app !== 'kosmos') throw new Error('nothing on that port answers as a Kosmos board');
  const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: boardToken ? { 'x-kosmos-board-token': boardToken } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('the board answered ' + res.status);
  const body = await res.json();
  if (!body || !Array.isArray(body.agents)) throw new Error('the board answered without an agent list');
  return body.agents.filter((a) => a && typeof a === 'object');
}

/* Every spelling under which a token file for this row can exist (see the docblock). */
function spellingsOf(row) {
  const out = new Set();
  for (const v of [row && row.sessionName, row && row.name]) {
    if (typeof v !== 'string' || !v) continue;
    out.add(v);
    const noWorld = v.includes('+') ? v.slice(0, v.indexOf('+')) : v;
    out.add(noWorld);
    for (const x of [v, noWorld]) if (x.endsWith('-discord')) out.add(x.slice(0, -'-discord'.length));
  }
  return [...out];
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
  if (ms > Date.now()) throw new Error('--cutoff is in the future, which would make every file old');
  out.cutoffMs = ms;
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const store = require('../engine/store');
  const sendertoken = require('../engine/sendertoken');
  const boardauth = require('../engine/boardauth');
  const removal = require('../engine/remove');
  const liveness = require('../engine/liveness');
  let token = null;
  try { token = boardauth.readToken(); } catch { token = null; }
  if (!token) { console.error('Stopped, nothing changed: no board token for this store, so nothing ties the board on that port to it.'); return 2; }
  let rows;
  try { rows = await fetchRoster(args.port, token); }
  catch (e) { console.error('Stopped, nothing changed: could not read the board roster (' + e.message + ').'); return 2; }
  if (rows.length === 0) { console.error('Stopped, nothing changed: the board lists no agents, so every file would look orphaned.'); return 2; }
  const removed = removal.removedAgents().filter((r) => r && typeof r === 'object');
  const liveKeys = new Set();
  for (const row of rows.concat(removed)) {
    for (const n of spellingsOf(row)) { try { liveKeys.add(store.safeKey(n)); } catch { /* an unkeyable name holds no file */ } }
  }
  let heartbeats = [];
  try { heartbeats = fs.readdirSync(liveness.DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)); }
  catch { heartbeats = []; }   // no heartbeat folder: no agent has ever reported that way
  for (const k of heartbeats) liveKeys.add(k);
  const dir = sendertoken.DIR;
  const entries = listEntries(dir);
  const tokenKeys = entries.filter((e) => !e.isSymlink && !e.other && e.name.endsWith('.json')).map((e) => e.name.slice(0, -'.json'.length));
  if (tokenKeys.length > 0 && !tokenKeys.some((k) => liveKeys.has(k))) {
    console.error('Stopped, nothing changed: not one token file here belongs to an agent on that board, so it is probably serving a different store.');
    return 2;
  }
  const plan = planCleanup(entries, liveKeys, args.cutoffMs, store.safeKey);
  console.log(`Kept by name: ${rows.length} agents on the board, ${removed.length} in the removal records, ${heartbeats.length} with a heartbeat record; ${tokenKeys.filter((k) => liveKeys.has(k)).length} of ${tokenKeys.length} token files match one.`);
  console.log(`Would remove ${plan.remove.length}, keep ${plan.keep.length}:`);
  for (const r of plan.remove) {
    const detail = r.kind === 'token' ? `; launchers: ${r.launchers.join(', ') || 'none'}; newest mint: ${r.newestMintMs ? new Date(r.newestMintMs).toISOString() : 'none'}` : '';
    console.log(`  remove  ${r.name}  (${r.why}${detail})`);
  }
  for (const k of plan.keep) console.log(`  keep    ${k.name}  (${k.why})`);
  if (!args.apply) { console.log('Dry run: nothing changed. Read every "remove" line against the agents you know, then add --apply to back up and remove.'); return 0; }
  if (plan.remove.length === 0) { console.log('Nothing to remove.'); return 0; }
  const dest = path.join(path.dirname(dir), 'sendertokens.backup-5418-' + new Date().toISOString().replace(/[:.]/g, '-'));
  try { backup(dir, dest, plan.remove.map((r) => r.name)); }
  catch (e) {
    console.error('Stopped, nothing removed: the backup failed (' + e.message + '). If a file it names is gone, the store changed since the plan was made: run it again.');
    return 3;
  }
  console.log('Backed up to ' + dest + ' (it holds the removed tokens: delete it once the result is checked).');
  const res = applyPlan(dir, plan, sendertoken.revokeIfUnchanged);
  console.log(`Removed ${res.removed.length}.`);
  for (const f of res.failed) console.log(`  not removed  ${f.name}  (${f.because})`);
  return res.failed.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { console.error('Stopped: ' + ((e && e.message) || e)); process.exitCode = 2; });
}

module.exports = { planCleanup, listEntries, tokenInfo, backup, applyPlan, parseArgs, fetchRoster, spellingsOf, main };
