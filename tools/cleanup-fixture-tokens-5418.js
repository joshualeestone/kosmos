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
 * A dry run removes nothing, but resolving the store's folder runs its one-time move from the legacy app folder
 * (store.js, LEGACY_APP) if that move has not happened yet, as any reader of the store does.
 *
 * 🛑 --apply removes only the plan a person read: it rebuilds the plan, and if its digest is not the one the dry run
 * printed (an agent missing from a degraded roster, a token file changed), it stops. The digest covers each token
 * file's name, key, mtime, newest mint, launchers and token names; for a temp or a link, its name and kind (each is
 * re-checked to still be a file or a dangling link just before it goes). --port must equal this account's own
 * board port, derived as the kosmos CLI derives it (KOSMOS_PORT if set, else from the uid; with no uid
 * KOSMOS_PORT must say), so the board token reaches only the board this account's kosmos command would
 * talk to. A KOSMOS_PORT set to another account's board would send it there, as it would the kosmos command.
 * And --apply needs live execution, which this file's command line opens:
 * a process that never opened it (one that only requires this file) cannot remove anything by calling main. A
 * process that did open it for its own reasons can; there the --confirm digest and the port check still hold.
 *
 * What it may remove, and only all of these together:
 *   - a token file whose agent is NOT on the running board's roster (GET /api/status, the board's own list),
 *     is NOT in the board's removal records, has no heartbeat record, no profile, no worker folder and no startup
 *     job (launchd on macOS, a Scheduled Task on Windows, a systemd unit on Linux), was last written BEFORE the
 *     cutoff (at least an hour ago), and is named exactly as the
 *     store names its files (a name the store could not have written is listed and left alone), and holds
 *     no `launcher: 'remote'` token (a remote agent is on the roster only while its heartbeat is fresh, so an
 *     offline one would look orphaned). Its age is its NEWEST sign of life: the latest token mintedAt or the
 *     file's mtime, whichever is later;
 *   - a writer's leftover temp file, named in the shape the store's writer uses
 *     (`<file>.kosmos-<pid>-[t<thread>-]<started>-<seq>.tmp`), last written before the cutoff by a writer that is provably gone;
 *   - a symlink whose target does not exist (a security fixture planted one), named like a token file or the
 *     writer's temp, unless its name is a live agent's, and only while the folder it pointed into still exists (a
 *     missing one may be an unmounted drive: kept). At ANY age and without the lock: a link that points at
 *     nothing holds no credential, and the store's writer refuses to write through a link.
 * Anything else in the folder is listed and left alone. A live agent's file is never a candidate,
 * whatever its date.
 *
 * 🛑 THE ROSTER IS THE FIRST GUARD FOR A LIVE AGENT, with the store's own records as the others (heartbeats,
 * profiles, worker folders, startup jobs, remote tokens, removal records); the cutoff is in the past for
 * every live file, so it guards nothing here. So:
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
 *   - assumed, and stated: any live use of a token file rewrites it (a mint, a retire), which moves its mtime and
 *     newest mint, so a file in use between the plan and its removal is kept by the locked re-check.
 * 🛑 BACKUP FIRST. --apply copies exactly the entries it is about to remove (files with their modes, flushed to
 * disk; links as links, or on Windows without the privilege a LINKS.txt note) to a new timestamped folder beside the store, and stops if the copy fails. Only those: a copy of every
 * live agent's token would be a second set of live credentials left lying around.
 * Prints names and counts only, never a token.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* How long a board may take to answer, and the backup folder's name (beside the store; the tests read it too). */
const BOARD_TIMEOUT_MS = 10000;
const BACKUP_PREFIX = 'sendertokens.backup-5418-';
/* The cutoff must be at least this old: temps are removed on age without the store's lock, so nothing a writer
   has in flight may be old enough to plan. An hour is far longer than any write takes. */
const CUTOFF_MARGIN_MS = 60 * 60 * 1000;
/* Hex characters of the plan digest a person types back: 64 bits, plenty to tell two plans apart. */
const DIGEST_HEX = 16;

/* The writer's own temp shape (securewrite's tempPath, and sendertoken's before #1787), anchored at the end. Any
   other name is not a temp this store wrote, so it is listed and left alone. */
// a temp is securewrite's own shape, decided by securewrite's own rule (one definition)
const { tempWriterGone } = require('../engine/securewrite');
const TEMP_SHAPE = { test: (name) => tempWriterGone(name) !== null };

/* The decision, pure: `entries` is what is in the folder ({ name, isSymlink, targetExists, mtimeMs, tokens }),
   `liveKeys` the safeKey'd names to keep (every spelling of the roster's rows, the removal records, the heartbeat
   records, every profile, worker folders and startup jobs). Returns { remove: [{ name, kind, why }], keep: [{ name, why }] }. Every entry lands
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
      else if (e.targetExists === false && e.targetParentExists !== true) keep.push({ name: e.name, why: 'a link pointing at nothing, but its target\'s folder is missing or unreadable too (an unmounted drive?): left alone' });
      else if (e.targetExists === false && (e.name.endsWith('.json') || TEMP_SHAPE.test(e.name))) remove.push({ name: e.name, kind: 'symlink', linkTarget: e.linkTarget || null, why: 'a link pointing at nothing' + (e.linkTarget ? ' (it pointed at ' + e.linkTarget + '; check that is not an unmounted volume)' : '') });
      else if (e.targetExists === false) keep.push({ name: e.name, why: 'a link pointing at nothing, but not a name the store writes: left alone' });
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
    // A temp is planned whatever its key, only when BOTH hold: it is older than the cutoff, and its writer is provably
    // gone (securewrite's own proof-of-death rule, #1793). Either alone keeps it.
    if (TEMP_SHAPE.test(e.name)) {
      if (!old) keep.push({ name: e.name, why: 'a temp written on or after the cutoff (may be in flight)' });
      else if (tempWriterGone(e.name) !== true) keep.push({ name: e.name, why: 'a temp whose writer may still be running' });
      else remove.push({ name: e.name, kind: 'temp', why: 'a leftover temp written before the cutoff by a writer that is gone' });
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
    if (isSymlink) { try { entry.linkTarget = fs.readlinkSync(p); } catch { entry.linkTarget = null; } }
    // a dangling link's target FOLDER: there (the file is really gone), missing (an unmounted drive?), or unknown
    if (isSymlink && targetExists === false) {
      entry.targetParentExists = null;
      if (entry.linkTarget) {
        try { fs.statSync(path.dirname(path.resolve(dir, entry.linkTarget))); entry.targetParentExists = true; }
        catch (e) { entry.targetParentExists = e && e.code === 'ENOENT' ? false : null; }
      }
    }
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
    // the entries the store itself reads (sendertoken.readTokens): one with no string token is not a token
    if (!t || typeof t !== 'object' || typeof t.token !== 'string') continue;
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
  try {
    copyInto(dir, dest, names);
    // the folder's own entries on disk too (POSIX; Windows cannot flush a folder): a crash cannot lose the backup
    if (process.platform !== 'win32') { const fd = fs.openSync(dest, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  } catch (e) { if (e && typeof e === 'object') { try { e.backupCreated = true; } catch { /* frozen */ } } throw e; }
}
/* Flush one backup copy to disk. Read-write on Windows (it refuses to flush a read-only handle); where the platform
   cannot flush or open it so (as securewrite's flushOrThrow allows) the copy stands as written. */
function flushCopy(file, platform = process.platform) {
  // POSIX flushes a read-only handle (and a copy can already carry a read-only original's mode); Windows needs r+
  const tolerated = (e) => !!e && (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(e.code)
    || (platform === 'win32' && (e.code === 'EPERM' || e.code === 'EISDIR' || e.code === 'EACCES')));
  let fd;
  try { fd = fs.openSync(file, platform === 'win32' ? 'r+' : 'r'); } catch (e) { if (tolerated(e)) return; throw e; }
  try { fs.fsyncSync(fd); } catch (e) { if (!tolerated(e)) throw e; } finally { fs.closeSync(fd); }
}
function copyInto(dir, dest, names) {
  for (const name of names) {
    const from = path.join(dir, name);
    const to = path.join(dest, name);
    const st = fs.lstatSync(from);
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(from);
      // where a link cannot be made (Windows without the privilege), its name and target go in a note instead
      try { fs.symlinkSync(target, to); }
      catch (e) { if (e && e.code === 'EPERM') fs.appendFileSync(path.join(dest, 'LINKS.txt'), name + ' -> ' + target + '\n', { mode: 0o600 }); else throw e; }
    }
    else if (st.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      flushCopy(to);   // before the mode goes back: a read-only original's copy could not be opened to flush after
      fs.chmodSync(to, st.mode & 0o777);   // on disk before any original is removed (#5434): a crash right after --apply cannot lose both
      if (fs.statSync(to).size !== st.size) throw new Error('the backup of ' + name + ' is not the same size as the file');
    }
    // anything else (a folder swapped in since the plan) is not backed up, so the run stops rather than go on without it
    else throw new Error(name + ' is no longer a file or a link, so it was not backed up');
  }
}

/* Remove what the plan says, re-checking each entry as it goes. Returns the names removed and any that failed. */
function applyPlan(dir, plan, revoke) {
  // the delete itself is gated, not only main: a caller that requires this file cannot remove anything by calling it
  if (!require('../engine/live-execution').liveExecutionAllowed()) throw new Error('live execution is off: nothing removed');
  const removed = [];
  const failed = [];
  const gone = [];   // already gone when its turn came: not counted as removed
  for (const r of plan.remove) {
    const p = path.join(dir, r.name);
    try {
      if (r.kind === 'token') {
        const res = revoke(r.key, r.mtimeMs, r.newestMintMs);   // sendertoken.revokeIfUnchanged: re-checked under the store's lock
        if (res && res.ok === false) throw new Error(res.because || 'revoke failed');
        if (res && res.already) { gone.push(r.name); continue; }
      } else if (r.kind === 'symlink') {
        if (!fs.lstatSync(p).isSymbolicLink()) throw new Error('no longer a link');
        let targetMissing = false;
        try { fs.statSync(p); } catch (e) { targetMissing = e && e.code === 'ENOENT'; }
        if (!targetMissing) throw new Error('its target exists now, or cannot be checked: kept');
        // the plan's rule again: only when the folder it pointed into is still there (else an unmounted drive?)
        let parentThere = false;
        try { fs.statSync(path.dirname(path.resolve(dir, fs.readlinkSync(p)))); parentThere = true; } catch { parentThere = false; }
        if (!parentThere) throw new Error('the folder its target was in is missing now (an unmounted drive?): kept');
        fs.unlinkSync(p);
      } else if (r.kind === 'temp') {
        if (!fs.lstatSync(p).isFile()) throw new Error('no longer a file');
        fs.unlinkSync(p);
      }
      removed.push(r.name);
    } catch (e) { failed.push({ name: r.name, because: (e && e.message) || String(e) }); }
  }
  return { removed, failed, gone };
}

/* GET a loopback JSON route with node's http module, which never reads proxy settings (a fetch can be sent through a
   proxy by the environment, and the second call carries the board token: install/kosmos's rule #4466 is "never
   through a proxy"). The http module never follows a redirect, so the token's header cannot follow one; a redirect
   answer is also turned into an error here, so it reads as one rather than as a missing roster. */
/* The most a board answer may be; more is refused (the health route answers before any token is sent, so anything on
   the port can reply). A real roster is a few hundred KB at most. */
const MAX_ANSWER_BYTES = 8 * 1024 * 1024;
function getJson(port, route, headers, timeoutMs = BOARD_TIMEOUT_MS, maxBytes = MAX_ANSWER_BYTES) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request({ host: '127.0.0.1', port, path: route, method: 'GET', headers: headers || {}, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new Error('the board answered with a redirect')); return; }
      // a board that stalls mid-answer: the timeout destroys the request; settle on the response's error too, whichever
      // object this Node version reports it on (the arm pins only the outcome: a clean refusal, no hang)
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('the board stopped answering part way')));
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        // settle first, then close without an error (an error passed to destroy would surface again as uncaught)
        if (Buffer.byteLength(body) > maxBytes) { reject(new Error('the board answer is larger than ' + maxBytes + ' bytes')); res.removeAllListeners('end'); req.destroy(); }
      });
      res.on('end', () => { let json = null; try { json = JSON.parse(body); } catch { json = null; } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('the board did not answer in time')));
    // `timeout` above is an IDLE timeout; this is the whole-answer deadline, so a board dripping bytes cannot hold it
    const deadline = setTimeout(() => req.destroy(new Error('the board did not answer in time')), timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end();
  });
}

async function fetchRoster(port, boardToken) {
  /* Ask, WITHOUT the token, whether a Kosmos board answers on that port at all, so a wrong --port never hands
     this store's board token to some other local program. */
  const health = await getJson(port, '/api/health');
  if (health.status !== 200 || !health.json || health.json.app !== 'kosmos') throw new Error('nothing on that port answers as a Kosmos board');
  const res = await getJson(port, '/api/status', boardToken ? { 'x-kosmos-board-token': boardToken } : {});
  if (res.status !== 200) throw new Error('the board answered ' + res.status);
  const body = res.json;
  if (!body || !Array.isArray(body.agents)) throw new Error('the board answered without an agent list');
  // A board that could not read some of its own agents answers with a partial list: not one to remove by.
  if (body.counts && Number(body.counts.unreadableLines) > 0) throw new Error('the board could not read all of its agents just now (' + body.counts.unreadableLines + ' unreadable), so its list may be partial');
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
  // ISO only (YYYY-MM-DD, optionally with a time): Date.parse would take "1" as the year 2001 and plan nothing.
  // with a time, a zone is required (Z or an offset): without one Date.parse reads local time, a date alone reads UTC
  const ms = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2}))?$/.test(String(out.cutoff || '')) ? Date.parse(out.cutoff) : NaN;
  if (!Number.isFinite(ms)) throw new Error('--cutoff is required, as an ISO date');
  if (ms > Date.now()) throw new Error('--cutoff is in the future, which would make every file old');
  /* Temps are removed without the store's lock, only when old AND their writer is provably gone (a dangling link holds
     nothing and is not aged): a cutoff at least an hour old is a second margin for any writer's in-flight temp. */
  if (ms > Date.now() - CUTOFF_MARGIN_MS) throw new Error('--cutoff must be at least an hour in the past, so nothing in flight is old enough to plan');
  out.cutoffMs = ms;
  if (out.apply && !out.confirm) throw new Error('--apply needs --confirm <the digest the dry run printed>');
  return out;
}

/* This account's board port, derived exactly as install/kosmos derives it (KOSMOS_PORT, else a pure function of the
   uid). */
function expectedPort(env = process.env) {
  if (env.KOSMOS_PORT !== undefined && env.KOSMOS_PORT !== '') {
    const fromEnv = Number(env.KOSMOS_PORT);
    return Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv <= 65535 ? fromEnv : null;   // set but unusable: no answer
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) return null;   // no uid (Windows): only KOSMOS_PORT can say, and it is not set
  return portForUid(uid);
}
/* The agent names that have a startup job on Windows (Scheduled Tasks) or Linux (systemd units), each a keep signal;
   null when the jobs could not be read (the caller stops). `reader` is register.jobReader(platform). macOS's launchd
   jobs are read from the LaunchAgents folder by the caller, which also sees the fleet's com.<name>.discord jobs. */
function jobKeepNames(platform, tokenKeys, reader) {
  if (platform === 'darwin') return [];
  if (!reader || reader.known === false) return null;
  if (platform === 'win32') return reader.fleet ? [...reader.fleet] : null;
  // a unit folder that cannot be listed stops the tool (presence() alone reads EACCES as "no unit")
  if (platform === 'linux' && reader.dirReadable && reader.dirReadable() === false) return null;
  // a unit is named for the session, so a key's -discord session (whose tokens sit under the key) is asked too
  if (platform === 'linux') return tokenKeys.filter((k) => { try { return reader.of(k) === true || reader.of(k + '-discord') === true; } catch { return true; } });
  return [];
}
/* install/kosmos's derivation, for one uid (its test reads the formula out of install/kosmos). */
function portForUid(uid) { return uid === 501 ? 16180 : 16180 + 1 + (uid % 3999); }

/* A short digest of exactly what a plan removes (name, kind, key, mtime, newest mint, launchers, token names; a temp
   or a link has no mtime here), so --apply can require the plan a person read. */
function planDigest(plan) {
  const lines = plan.remove.map((r) => JSON.stringify([r.name, r.kind, r.key || '', r.mtimeMs === undefined ? null : r.mtimeMs,
    r.newestMintMs === undefined ? null : r.newestMintMs, (r.launchers || []).slice().sort(), (r.names || []).slice().sort(), r.linkTarget || null])).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, DIGEST_HEX);
}

async function main(argv, { armFromCommandLine = false } = {}) {
  const args = parseArgs(argv);
  // the command line arms live execution only from the PARSED flag, so `--apply` inside another value cannot
  if (armFromCommandLine && args.apply === true) require('../engine/live-execution').allowLiveExecution();
  const want = expectedPort();
  if (want === null) {
    console.error('Stopped, nothing changed: this account\'s board port cannot be worked out here (on Windows nothing sets it); set KOSMOS_PORT to the board\'s port (16180 unless it was changed) and pass the same --port.');
    return 2;
  }
  if (args.port !== want) {
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
  catch (e) {
    if (!(e && e.code === 'ENOENT')) {   // only a missing folder means "none"; one that cannot be read keeps nothing
      console.error('Stopped, nothing changed: the heartbeat records could not be read (' + ((e && e.code) || e) + ').');
      return 2;
    }
  }
  // heartbeat files are keyed by safeKey(session); keep its -discord-stripped spelling too. A `+world` is already
  // folded away by safeKey, so a world session's heartbeat may not reach its token key: REASONED (the only heartbeat
  // writer runs after a token check), not measured; the roster, profiles and folders are the other keeps for it.
  for (const k of heartbeats) for (const n of spellingsOf({ sessionName: k })) { try { liveKeys.add(store.safeKey(n)); } catch { /* not a key */ } }
  const dir = sendertoken.DIR;
  if (!fs.existsSync(dir)) { console.log('Nothing to clean: this store has no sender-token folder.'); return 0; }
  const entries = listEntries(dir);
  const tokenKeys = entries.filter((e) => !e.isSymlink && !e.other && e.name.endsWith('.json')).map((e) => e.name.slice(0, -'.json'.length));
  /* An agent can exist with no profile (a leftover with only a launchd job or a worker folder, #500) and still be
     running where the board cannot see it (#668), and the board's offline rows can drop a row silently. So any key
     with a worker folder or a launchd job is kept too; a folder that is there but cannot be read stops the tool. */
  const create = require('../engine/create');   // ONE derivation of these folders: the one the app uses (#5 in CLAUDE.md)
  const listed = (dir, what) => {
    try { return fs.readdirSync(dir); } catch (e) {
      if (e && e.code === 'ENOENT') return [];
      throw new Error(what + ' could not be read (' + ((e && e.code) || e) + ')');
    }
  };
  let workerNames;
  let jobNames;
  try {
    workerNames = listed(create.workersDir(), 'the worker folders');
    const agentsDir = path.dirname(create.plistPath('x'));   // launchd jobs (macOS only; elsewhere none are read)
    jobNames = process.platform === 'darwin' ? listed(agentsDir, 'the launchd jobs').map((f) => {
      // the label prefix and the world separator are create.js's and launchidentity's own, not copies
      const sep = require('../engine/launchidentity').WORLD_SEPARATOR;
      const prefix = create.SERVICE_LABEL_PREFIX;
      const own = f.startsWith(prefix) && f.endsWith('.plist') ? f.slice(prefix.length, -'.plist'.length) : null;
      const m = own ? [null, own] : /^com\.([^.]+(?:\.[^.]+)*)\.discord\.plist$/.exec(f);
      return m && m[1] ? m[1].split(sep)[0].replace(/\.discord$/, '') : null;   // a stray .discord stays a keep (over-keep is safe)
    }).filter(Boolean) : [];
  } catch (e) { console.error('Stopped, nothing changed: ' + e.message + '.'); return 2; }
  // Windows Scheduled Tasks and Linux systemd units, read the way the board's own survey reads them (register.jobReader)
  const jobReader = require('../engine/register').jobReader(process.platform);
  if (process.platform === 'linux') {
    // one unit file read here, not through presence() (existsSync reads EACCES as "no unit"): unreadable keeps the key
    const lj = require('../engine/linuxjob');
    jobReader.of = (name) => { try { fs.statSync(lj.unitPath(name)); return true; } catch (e) { return !(e && e.code === 'ENOENT'); } };
    jobReader.dirReadable = () => {
      try { fs.readdirSync(require('../engine/linuxjob').systemdDir()); return true; } catch (e) { return !!e && e.code === 'ENOENT'; }
    };
  }
  const otherJobs = jobKeepNames(process.platform, tokenKeys, jobReader);
  if (otherJobs === null) { console.error('Stopped, nothing changed: this computer\'s startup jobs could not be read, so offline agents cannot be told apart.'); return 2; }
  jobNames = jobNames.concat(otherJobs);
  for (const raw of workerNames.concat(jobNames)) {
    for (const n of spellingsOf({ sessionName: raw })) { try { liveKeys.add(store.safeKey(n)); } catch { /* not a key */ } }
  }
  /* The board's offline rows come from these same profile files (register.known); one it cannot list silently
     empties that part of its roster, so a profiles folder that is there but cannot be read stops the tool. */
  const knownProfiles = require('../engine/register').known();
  if (!knownProfiles.ok) {
    console.error('Stopped, nothing changed: the agent profiles could not be read, so offline agents cannot be told apart.');
    return 2;
  }
  // every spelling of every profile's name, as for the roster (a profile `sam-discord` keeps the tokens in `sam`)
  for (const raw of knownProfiles.names) {
    for (const n of spellingsOf({ sessionName: raw })) { try { liveKeys.add(store.safeKey(n)); } catch { /* not a key */ } }
  }
  /* Any key the store keeps a profile for is kept, whatever the profile says. An adopted or a Windows agent's token is
     minted with no launcher, and an offline one is not on the board; a profile is the store's own record of an agent.
     Fixture profiles leaked too, so this keeps some leftovers: a keep signal only, never a reason to remove. */
  let profiled = 0;
  for (const k of tokenKeys) {
    let canonical = false;
    try { canonical = store.safeKey(k) === k; } catch { canonical = false; }
    if (!canonical) continue;   // a name the store could not have written is kept anyway, and is not counted here
    let prof = {};
    try { prof = store.readProfile(k) || {}; } catch { prof = {}; }
    let present = prof && typeof prof === 'object' && Object.keys(prof).length > 0;
    // readProfile answers {} for a file it cannot read: a profile that is THERE but unreadable still keeps the key
    if (!present) { try { present = fs.existsSync(path.join(store.PROFILES, store.profileFileName(k))); } catch { present = true; } }
    if (present) { liveKeys.add(k); profiled += 1; }
  }
  /* The backstop counts the ROSTER only: this store's own heartbeat and removal records would match it on any real
     machine, whichever board answered. */
  if (tokenKeys.length > 0 && !tokenKeys.some((k) => rosterKeys.has(k))) {
    console.error('Stopped, nothing changed: not one token file here belongs to an agent on that board, so it is probably serving a different store.');
    return 2;
  }
  const plan = planCleanup(entries, liveKeys, args.cutoffMs, store.safeKey);
  console.log(`Keep records read: ${workerNames.length} worker folders, ${jobNames.length} startup jobs.`);
  console.log(`Board: ${rows.length} agents, matching ${tokenKeys.filter((k) => rosterKeys.has(k)).length} of ${tokenKeys.length} token files. Other keep records: ${removed.length} removal records, ${heartbeats.length} heartbeats, ${profiled} token files with a profile.`);
  console.log(`Would remove ${plan.remove.length}, keep ${plan.keep.length}:`);
  if (plan.remove.some((r) => r.kind === 'token' && !(r.launchers || []).length)) console.log('  (NO LAUNCHER is expected on most fixture lines: fixture, adopted and Windows tokens all mint without one. Read each name.)');
  for (const r of plan.remove) {
    const newest = Math.max(r.mtimeMs || 0, r.newestMintMs || 0);
    const age = newest ? `; silent ${Math.floor((Date.now() - newest) / 86400000)} days` : '';
    const detail = r.kind === 'token' ? `; token names: ${r.names.join(', ') || 'none'}; launchers: ${r.launchers.join(', ') || 'none'}; newest mint: ${r.newestMintMs ? new Date(r.newestMintMs).toISOString() : 'none'}${age}` : '';
    // a token naming no launcher is the one shape no keep signal can vouch for (an offline adopted or Windows agent)
    const loud = r.kind === 'token' && !(r.launchers || []).length ? '  <- NO LAUNCHER: check this one is not a real agent' : '';
    console.log(`  remove  ${r.name}  (${r.why}${detail})${loud}`);
  }
  for (const k of plan.keep) console.log(`  keep    ${k.name}  (${k.why})`);
  const digest = planDigest(plan);
  console.log(`Plan digest: ${digest}`);
  if (!args.apply) { console.log(`Dry run: no token was removed (reading the store may run its usual one-time migration). Read every "remove" line against the agents you know, then run again with --apply --confirm ${digest}.`); return 0; }
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
  console.log(`Removed ${res.removed.length}.` + (res.gone.length ? ` ${res.gone.length} were already gone.` : ''));
  for (const f of res.failed) console.log(`  not removed  ${f.name}  (${f.because})`);
  if (res.failed.length) console.log('The backup is still at ' + dest + ' and holds token copies: delete it once the result is checked.');
  return res.failed.length ? 1 : 0;
}

if (require.main === module) {
  // the command line, run by a person, is the only opt-in, and only for --apply (a dry run removes nothing)
  main(process.argv.slice(2), { armFromCommandLine: true }).then((code) => { process.exitCode = code; },
    (e) => { console.error('Stopped: ' + ((e && e.message) || e)); process.exitCode = 2; });
}

module.exports = { planCleanup, listEntries, tokenInfo, backup, applyPlan, parseArgs, getJson, fetchRoster, spellingsOf, expectedPort, portForUid, jobKeepNames, flushCopy, planDigest, BACKUP_PREFIX, main };
