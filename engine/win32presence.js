'use strict';
/**
 * kosmos#8415: a Windows supervisor's record of its own presence, so the board can tell an agent whose supervisor is
 * up from one that has stopped, including while a Claude supervisor is between children (its state file then names
 * no process: win32streamstate.liveNames).
 *
 * The supervisor listens on a named pipe with a random name for as long as it runs, and writes `<key>.presence` in
 * win32-state naming that pipe. The PIPE is the proof of life, not the pid: Windows removes a pipe when the process
 * that holds it dies (a crash, a killed task tree, a Fast Startup shutdown). Its name is random and is written only in
 * its record, in this account's data folder. Pipe names can be listed on Windows, so the name is not secret: what keeps a
 * stranger from answering for a dead supervisor is that a live pipe counts only while the record's pid is alive too. Measured on Windows (kosmos#8415, Homer, node 24.19): fs.existsSync on the pipe path reads a live pipe
 * true in about 0.1 ms, and false after close, for a name never created, and after taskkill /F of its holder.
 *
 * `opts.pipePath` and `opts.pipeExists` are test seams: off Windows a unix socket path stands in for the pipe.
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');

const PRESENCE_VERSION = 1;
const PRESENCE_EXT = '.presence';
const PIPE_PREFIX = '\\\\.\\pipe\\kosmos-sup-';
const PIPE_SHAPE = /^\\\\\.\\pipe\\kosmos-sup-[a-z0-9]+$/i;   // the whole name, so no `..` can steer the look elsewhere
const RETRY_PAUSE_MS = 5;   // only after a look that missed: a short wait before the second look
/* A synchronous pause (liveNames is read synchronously by the board's poll). */
function pause(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no pause */ } }

function stateDir() { return path.join(store.ROOT, 'win32-state'); }
function presencePath(name) { return path.join(stateDir(), store.safeKey(name) + PRESENCE_EXT); }
function randomPipe() { return PIPE_PREFIX + crypto.randomBytes(8).toString('hex'); }

/** `name`'s presence record, or null when there is none or it cannot be read as one. */
function readPresence(name) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(presencePath(name), 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || rec.v !== PRESENCE_VERSION) return null;
  if (!Number.isInteger(rec.pid) || rec.pid <= 0 || typeof rec.pipe !== 'string' || !rec.pipe) return null;
  if (process.platform === 'win32' && !PIPE_SHAPE.test(rec.pipe)) return null;   // only a pipe of ours (whole name) is proof
  return { pid: rec.pid, pipe: rec.pipe };
}

/* Removes `name`'s record only if it names `ownerPid`: during a restart the new supervisor may already have written
   its own, and the old one's stop must not erase it. Claim by rename, then decide, as clearState does. A rename that
   fails for another reason (the board reading the file at that moment) leaves the record; once this process has
   exited its pipe and pid are gone, so the reader judges it dead, which is true. */
function clearPresence(name, ownerPid) {
  const at = presencePath(name);
  /* Read first: a record that already names someone else is never claimed, so a failed put-back cannot lose it. */
  const seen = readPresence(name);
  if (seen && seen.pid !== ownerPid) return false;
  const claim = at + '.' + process.pid + '.clear';
  try { fs.renameSync(at, claim); } catch (e) { return Boolean(e && e.code === 'ENOENT'); }
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(claim, 'utf8')); } catch { rec = null; }
  if (rec && typeof rec === 'object' && rec.pid === ownerPid) {
    try { fs.rmSync(claim, { force: true }); } catch { /* a private leftover; harmless */ }
    return true;
  }
  /* Not ours: put it back, unless a newer record landed meanwhile (a hard link never replaces a name), as clearState. */
  try { fs.linkSync(claim, at); }
  catch (e) {
    if (!(e && e.code === 'EEXIST')) {
      try { if (!fs.existsSync(at)) { fs.renameSync(claim, at); return false; } } catch { /* the claim is kept, not deleted */ }
      return false;
    }
  }
  try { fs.rmSync(claim, { force: true }); } catch { /* a private leftover; harmless */ }
  return false;
}

/**
 * The supervisor's side. Listens on a fresh pipe and, once it is listening, writes the record. Never throws, and
 * never keeps the process alive (the server is unref'd). Returns `{ stop() }`; stop removes the record (if it is
 * still this process's) and closes the pipe. A pipe that could not be opened is said through `opts.onProblem`; when
 * that happens before it listens, no record is written, so the agent falls back to the state-file rule. (An error
 * after listening leaves the record, which the reader's pipe and pid rules then judge.)
 */
function start(name, opts) {
  const o = opts || {};
  const onProblem = typeof o.onProblem === 'function' ? o.onProblem : () => {};
  /* Off Windows there is no \\.\pipe\ namespace (listening on that string would make a socket FILE in the working
     folder), so only a test's own socket path is listened on there. */
  if (process.platform !== 'win32' && !(typeof o.pipePath === 'string' && o.pipePath)) return { pipe: null, stop() {} };
  const pipe = typeof o.pipePath === 'string' && o.pipePath ? o.pipePath : randomPipe();
  let wrote = false;
  let stopped = false;
  /* A record left by an earlier run (a crash) names a pipe that is gone, and would say this agent is dead. It is
     removed before this run's pipe opens, so if that open or the write below fails, no record answers for this agent
     and the board falls back to its state file. A record whose pipe still exists belongs to a supervisor that is still
     up (a restart overlap), and stays: it is true until this run's own record replaces it. */
  const pipeExists = typeof o.pipeExists === 'function' ? o.pipeExists : (p) => fs.existsSync(p);
  const isAlive = typeof o.isAlive === 'function' ? o.isAlive : require('./win32orphan').pidAlive;
  const older = readPresence(name);
  let olderUp = false;
  try {
    olderUp = Boolean(older) && (pipeExists(older.pipe) === true
      || (isAlive(older.pid) === true && (pause(RETRY_PAUSE_MS), pipeExists(older.pipe) === true)));   // the reader's own retry
  } catch { olderUp = false; }
  if (!olderUp) {
    /* By its pid when it can be read (claim, then decide, as everywhere here); an unreadable file is no one's record. */
    let gone = true;
    try { if (older) gone = clearPresence(name, older.pid); else fs.rmSync(presencePath(name), { force: true }); }
    catch (e) { gone = false; }
    if (!gone) onProblem('we could not remove an older presence record');
  }
  /* A look at the pipe on Windows (fs.existsSync) may open a client connection (not measured), so a board poll could
     arrive here. It is dropped at once, and a connection that errors on the way out must not become an uncaught exception. */
  const server = net.createServer((socket) => { socket.on('error', () => {}); socket.destroy(); });
  /* A pipe that failed to open before listening also removes an older supervisor's record kept above: when that one
     exits, its record would otherwise say this live agent is dead, and no record of ours replaces it. */
  const dropOlder = () => {
    if (!wrote && !stopped && older && !clearPresence(name, older.pid)) {
      const now = readPresence(name);
      if (now && now.pid === older.pid) onProblem('we could not remove an older presence record');   // a newer one is not a problem
    }
  };
  const save = typeof o.save === 'function' ? o.save : (at, text) => store.saveFlushed(at, text);   // a test seam
  server.on('error', (e) => { dropOlder(); onProblem('we could not open its presence pipe (' + ((e && e.code) || 'unknown') + ')'); });
  try {
    server.listen(pipe, () => {
      if (stopped) return;
      const text = JSON.stringify({ v: PRESENCE_VERSION, pid: process.pid, pipe });
      /* One retry, 50 ms later on a timer (never blocking this process's loop): a rename over a file the board is reading can fail. */
      const tryWrite = (attempt) => {
        if (stopped || wrote) return;
        try { fs.mkdirSync(stateDir(), { recursive: true }); save(presencePath(name), text); wrote = true; }
        catch (e) {
          if (attempt === 0) { const t = setTimeout(() => tryWrite(1), RETRY_PAUSE_MS * 10); if (t.unref) t.unref(); return; }
          dropOlder(); onProblem('we could not record its presence (' + ((e && e.code) || 'unknown') + ')');
        }
      };
      tryWrite(0);
    });
    if (typeof server.unref === 'function') server.unref();
  } catch (e) {
    dropOlder();
    onProblem('we could not open its presence pipe (' + ((e && e.code) || 'unknown') + ')');
  }
  return {
    pipe,
    stop() {
      if (stopped) return;
      stopped = true;
      if (wrote) clearPresence(name, process.pid);
      try { server.close(); } catch { /* not listening */ }
    },
  };
}

/**
 * The reader's side: for every presence record in win32-state, whether its supervisor is up. Returns a Map of
 * name -> true (its pipe exists: up) or false (its pipe is gone AND its pid is not alive: dead). A record whose pipe
 * looks gone while its pid is alive decides nothing (a look can miss a busy pipe, or the pid is someone else's now), so
 * that name is left out and its state file answers, as does a name with no record. Fail-soft to an empty map.
 */
function presenceByName(opts) {
  const o = opts || {};
  const pipeExists = typeof o.pipeExists === 'function' ? o.pipeExists : (p) => fs.existsSync(p);
  const isAlive = typeof o.isAlive === 'function' ? o.isAlive : require('./win32orphan').pidAlive;
  const out = new Map();
  let files;
  try { files = fs.readdirSync(stateDir()); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith(PRESENCE_EXT)) continue;
    const name = f.slice(0, -PRESENCE_EXT.length);
    const rec = readPresence(name);
    if (!rec) continue;
    let up = false;
    try { up = pipeExists(rec.pipe) === true; } catch { up = false; }
    let pidAlive = true;
    try { pidAlive = isAlive(rec.pid) === true; } catch { pidAlive = true; }   // could not tell: decide nothing
    /* A pipe up counts only with its supervisor's pid alive: pipe names can be listed on Windows, so once a supervisor
       has died another process could take its old name; a live pipe with a dead pid is that stranger's, not ours. */
    if (up && pidAlive) { out.set(name, true); continue; }
    if (!pidAlive) { out.set(name, false); continue; }   // a dead process holds no pipe: one look is enough, no pause
    /* Its pid is alive, so the look may have met a busy pipe: one more look after a short pause. Still gone: this
       record decides nothing (the pid may be someone else's now), and the state file answers. */
    try { pause(RETRY_PAUSE_MS); up = pipeExists(rec.pipe) === true; } catch { up = false; }
    if (up) out.set(name, true);
  }
  return out;
}

module.exports = { PRESENCE_VERSION, PRESENCE_EXT, PIPE_PREFIX, presencePath, readPresence, clearPresence, start, presenceByName };
