#!/usr/bin/env node
'use strict';
/**
 * #5418 ask 2: a one-time, careful cleanup of the records that test runs left in this machine's REAL
 * sender-token store before #5418's ask 1 (PR #5452) made that impossible.
 *
 *   node tools/cleanup-fixture-tokens-5418.js --port <board port> --cutoff <ISO date>            (dry run: prints a digest)
 *   node tools/cleanup-fixture-tokens-5418.js --port <board port> --cutoff <ISO date> --apply --confirm <digest>
 *                                                                          (backs up, then removes EXACTLY that plan)
 *
 * 🛑 --apply removes only the plan a person read: it rebuilds the plan, and if its digest is not the one the dry run
 * printed (an agent missing from a degraded roster, a file changed), it stops. --port must equal this account's own
 * board port, derived as the kosmos CLI derives it, so the board token can only reach this account's board. And
 * --apply needs live execution, which only the command line opens (repo convention: destructive actions fail closed).
 *
 * What it may remove, and only all of these together:
 *   - a token file whose agent is NOT on the running board's roster (GET /api/status, the board's own list),
 *     is NOT in the board's removal records, has no heartbeat record and no profile, was last written BEFORE the
 *     cutoff (at least an hour ago), and is named exactly as the
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
 *   - no roster, an empty one, or no board token to send stops the tool before planning. The tie between the
 *     board on that port and this store is the board token, and it is only as strong as that board's enforcement
 *     of it: a board that does not enforce its token (a sandbox) would answer anyone. Hence the backstop below, and
 *     the person reading every "remove" line.
 *     A roster matching NONE of the store's token files also stops it, as a backstop for a board that does not
 *     enforce its token. The port is required, never assumed.
 *   - each token file is removed only if, under the store's lock, it is still the file the plan looked at
 *     (sendertoken.revokeIfUnchanged): a token minted since the plan was made is never taken.
 *   - a cutoff less than an hour in the past (or in the future) is refused.
 * 🛑 BACKUP FIRST. --apply copies exactly the entries it is about to remove (files with their modes, links as
 * links) to a new timestamped folder beside the store, and stops if the copy fails. Only those: a copy of every
 * live agent's token would be a second set of live credentials left lying around.
 * Prints names and counts only, never a token.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* How long a board may take to answer, and the backup folder's name (beside the store; the tests read it too). */
const BOARD_TIMEOUT_MS = 10000;
const BACKUP_PREFIX = 'sendertokens.backup-5418-';

/* The writer's own temp shape (securewrite's tempPath, and sendertoken's before #1787), anchored at the end. Any
   other name is not a temp this store wrote, so it is listed and left alone. */
const TEMP_SHAPE = /\.kosmos-\d+-(?:t\d+-)?\d+-\d+\.tmp$/;

/* The decision, pure: `entries` is what is in the folder ({ name, isSymlink, targetExists, mtimeMs, tokens }),
   `liveKeys` the safeKey'd names to keep (every spelling of the roster's rows, the removal records, the heartbeat
   records and adopted profiles). Returns { remove: [{ name, kind, why }], keep: [{ name, why }] }. Every entry lands
   in exactly one list. */
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
      else remove.push({ name: e.name, kind: 'token', key, mtimeMs: e.mtimeMs, launchers: info.launchers, names: info.names || [], newestMintMs: info.newestMintMs, why: 'no such agent on the board, nothing newer than the cutoff' });
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
  const out = { launchers: [], names: [], newestMintMs: null };
  let kept;
  try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return out; }
  const tokens = kept && Array.isArray(kept.tokens) ? kept.tokens : (kept && typeof kept.token === 'string' ? [kept] : []);
  for (const t of tokens) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.launcher === 'string' && !out.launchers.includes(t.launcher)) out.launchers.push(t.launcher);
    if (typeof t.name === 'string' && !out.names.includes(t.name)) out.names.push(t.name);
    const ms = Date.parse(t.mintedAt || '');
    if (Number.isFinite(ms) && (out.newestMintMs === null || ms > out.newestMintMs)) out.newestMintMs = ms;
  }
  return out;
}

/* Copy the named entries, links as links and modes kept, into a NEW folder. Throws on any failure; an error after
   the folder was made carries `backupCreated`, so the caller removes only a folder this call made (never one that
   was already there). A copy sits at the umask mode for a moment before its chmod: inside the 0700 folder. */
function backup(dir, dest, names) {
  fs.mkdirSync(dest, { recursive: false, mode: 0o700 });
  try { copyInto(dir, dest, names); } catch (e) { if (e && typeof e === 'object') { try { e.backupCreated = true; } catch { /* frozen */ } } throw e; }
}
function copyInto(dir, dest, names) {
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
        let points = false;
        try { fs.statSync(p); points = true; } catch { points = false; }
        if (points) throw new Error('its target exists now: kept');
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
  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(BOARD_TIMEOUT_MS) });
  let h = null;
  try { h = await health.json(); } catch { h = null; }
  if (!health.ok || !h || h.app !== 'kosmos') throw new Error('nothing on that port answers as a Kosmos board');
  const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: boardToken ? { 'x-kosmos-board-token': boardToken } : {},
    signal: AbortSignal.timeout(BOARD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('the board answered ' + res.status);
  const body = await res.json();
  if (!body || !Array.isArray(body.agents)) throw new Error('the board answered without an agent list');
  return body.agents.filter((a) => a && typeof a === 'object');
}

/* Every spelling under which a token file for this row can exist (see the docblock). */
function spellingsOf(row) {
  const out = new Set();
  for (const v of [row && row.sessionName, row && row.session, row && row.name]) {
    if (typeof v !== 'string' || !v) continue;
    out.add(v);
    const noWorld = v.includes('+') ? v.slice(0, v.indexOf('+')) : v;
    out.add(noWorld);
    for (const x of [v, noWorld]) if (x.endsWith('-discord')) out.add(x.slice(0, -'-discord'.length));
  }
  return [...out];
}

const CUTOFF_MARGIN_MS = 60 * 60 * 1000;
function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') out.apply = true;
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--cutoff') out.cutoff = argv[++i];
    else if (argv[i] === '--confirm') out.confirm = argv[++i];
    else throw new Error('unknown argument: ' + argv[i]);
  }
  if (!Number.isInteger(out.port) || out.port <= 0 || out.port > 65535) throw new Error('--port is required (the board port for THIS account; never assumed)');
  const ms = Date.parse(out.cutoff || '');
  if (!Number.isFinite(ms)) throw new Error('--cutoff is required, as an ISO date');
  if (ms > Date.now()) throw new Error('--cutoff is in the future, which would make every file old');
  /* Temps and links are removed on age alone, without the store's lock: a cutoff at least an hour old keeps any
     writer's in-flight temp out of reach. */
  if (ms > Date.now() - CUTOFF_MARGIN_MS) throw new Error('--cutoff must be at least an hour in the past, so nothing in flight is old enough to plan');
  out.cutoffMs = ms;
  if (out.apply && !out.confirm) throw new Error('--apply needs --confirm <the digest the dry run printed>');
  return out;
}

/* This account's board port, derived exactly as install/kosmos derives it (KOSMOS_PORT, else a pure function of the
   uid). */
function expectedPort(env = process.env) {
  const fromEnv = Number(env.KOSMOS_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) return null;
  return uid === 501 ? 16180 : 16180 + 1 + (uid % 3999);
}

/* A short digest of exactly what a plan removes (name, kind, mtime), so --apply can require the plan a person read. */
function planDigest(plan) {
  const lines = plan.remove.map((r) => [r.name, r.kind, r.mtimeMs === undefined ? '' : String(r.mtimeMs)].join('|')).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

async function main(argv) {
  const args = parseArgs(argv);
  const want = expectedPort();
  if (want !== null && args.port !== want) {
    console.error(`Stopped, nothing changed: --port ${args.port} is not this account's board port (${want}), so the board token is not sent.`);
    return 2;
  }
  if (args.apply && !require('../engine/live-execution').liveExecutionAllowed()) {
    console.error('Stopped, nothing changed: --apply needs live execution, which only the command line turns on.');
    return 2;
  }
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
  const removedRead = removal.removedNames();
  if (!removedRead.ok) { console.error('Stopped, nothing changed: the removal records could not be read.'); return 2; }
  const removed = removedRead.names.filter((n) => typeof n === 'string' && n).map((name) => ({ name }));
  const keyOf = (n) => { try { return store.safeKey(n); } catch { return null; } };
  const rosterKeys = new Set();
  for (const row of rows) for (const n of spellingsOf(row)) { const k = keyOf(n); if (k) rosterKeys.add(k); }
  const liveKeys = new Set(rosterKeys);
  for (const row of removed) for (const n of spellingsOf(row)) { const k = keyOf(n); if (k) liveKeys.add(k); }
  let heartbeats = [];
  try { heartbeats = fs.readdirSync(liveness.DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)); }
  catch { heartbeats = []; }   // no heartbeat folder: no agent has ever reported that way
  for (const k of heartbeats) liveKeys.add(k);
  const dir = sendertoken.DIR;
  const entries = listEntries(dir);
  const tokenKeys = entries.filter((e) => !e.isSymlink && !e.other && e.name.endsWith('.json')).map((e) => e.name.slice(0, -'.json'.length));
  /* Any key the store keeps a profile for is kept, whatever the profile says. An adopted or a Windows agent's token is
     minted with no launcher, and an offline one is not on the board; a profile is the store's own record of an agent.
     Fixture profiles leaked too, so this keeps some leftovers: a keep signal only, never a reason to remove. */
  let profiled = 0;
  for (const k of tokenKeys) {
    let prof = {};
    try { prof = store.readProfile(k) || {}; } catch { prof = {}; }
    if (prof && typeof prof === 'object' && Object.keys(prof).length > 0) { liveKeys.add(k); profiled += 1; }
  }
  /* The backstop counts the ROSTER only: this store's own heartbeat and removal records would match it on any real
     machine, whichever board answered. */
  if (tokenKeys.length > 0 && !tokenKeys.some((k) => rosterKeys.has(k))) {
    console.error('Stopped, nothing changed: not one token file here belongs to an agent on that board, so it is probably serving a different store.');
    return 2;
  }
  const plan = planCleanup(entries, liveKeys, args.cutoffMs, store.safeKey);
  console.log(`Kept by name: ${rows.length} agents on the board (${tokenKeys.filter((k) => rosterKeys.has(k)).length} of ${tokenKeys.length} token files match one), ${removed.length} in the removal records, ${heartbeats.length} with a heartbeat record, ${profiled} with a profile.`);
  console.log(`Would remove ${plan.remove.length}, keep ${plan.keep.length}:`);
  for (const r of plan.remove) {
    const detail = r.kind === 'token' ? `; token names: ${r.names.join(', ') || 'none'}; launchers: ${r.launchers.join(', ') || 'none'}; newest mint: ${r.newestMintMs ? new Date(r.newestMintMs).toISOString() : 'none'}` : '';
    console.log(`  remove  ${r.name}  (${r.why}${detail})`);
  }
  for (const k of plan.keep) console.log(`  keep    ${k.name}  (${k.why})`);
  const digest = planDigest(plan);
  console.log(`Plan digest: ${digest}`);
  if (!args.apply) { console.log(`Dry run: nothing changed. Read every "remove" line against the agents you know, then run again with --apply --confirm ${digest}.`); return 0; }
  if (args.confirm !== digest) {
    console.error(`Stopped, nothing removed: this plan (${digest}) is not the one confirmed (${args.confirm}); something changed since the dry run. Run the dry run again and read it.`);
    return 4;
  }
  if (plan.remove.length === 0) { console.log('Nothing to remove.'); return 0; }
  const dest = path.join(path.dirname(dir), BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, '-'));
  try { backup(dir, dest, plan.remove.map((r) => r.name)); }
  catch (e) {
    /* The half-made backup holds copies of tokens: take it back, or name it so a person can. */
    let left = '';
    if (e && e.backupCreated) {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch { left = ' A partial backup is left at ' + dest + ' (it holds token copies): delete it.'; }
    }
    console.error('Stopped, nothing removed: the backup failed (' + e.message + '). If a file it names is gone, the store changed since the plan was made: run it again.' + left);
    return 3;
  }
  console.log('Backed up to ' + dest + ' (it holds the planned tokens, including any kept because they changed: delete it once the result is checked).');
  const res = applyPlan(dir, plan, sendertoken.revokeIfUnchanged);
  console.log(`Removed ${res.removed.length}.`);
  for (const f of res.failed) console.log(`  not removed  ${f.name}  (${f.because})`);
  return res.failed.length ? 1 : 0;
}

if (require.main === module) {
  require('../engine/live-execution').allowLiveExecution();   // the command line, run by a person, is the only opt-in
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { console.error('Stopped: ' + ((e && e.message) || e)); process.exitCode = 2; });
}

module.exports = { planCleanup, listEntries, tokenInfo, backup, applyPlan, parseArgs, fetchRoster, spellingsOf, expectedPort, planDigest, BACKUP_PREFIX, main };
