'use strict';
/**
 * kosmos#8415: a Windows supervisor's record of its own presence, so the board can tell an agent whose supervisor is
 * up from one that has stopped, including while a Claude supervisor is between children (its state file then names
 * no process: win32streamstate.liveNames).
 *
 * The supervisor listens on a named pipe with a random name for as long as it runs, and writes `<key>.presence` in
 * win32-state naming that pipe. The PIPE is the proof of life, not the pid: Windows removes a pipe when the process
 * that holds it dies (a crash, a killed task tree, a Fast Startup shutdown). Its name is random and is written only in
 * its record, in this account's data folder, and the reader accepts only a `kosmos-sup-` pipe; that is what keeps a
 * stranger from answering for it (Windows itself protects only the first instance's creator). Measured on Windows (kosmos#8415, Homer, node 24.19): fs.existsSync on the pipe path reads a live pipe
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
  if (!Number.isInteger(rec.pid) || typeof rec.pipe !== 'string' || !rec.pipe) return null;
  if (process.platform === 'win32' && !rec.pipe.startsWith(PIPE_PREFIX)) return null;   // only a pipe of ours is proof
  return { pid: rec.pid, pipe: rec.pipe };
}

/* Removes `name`'s record only if it names `ownerPid`: during a restart the new supervisor may already have written
   its own, and the old one's stop must not erase it. Claim by rename, then decide, as clearState does. */
function clearPresence(name, ownerPid) {
  const at = presencePath(name);
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
  catch (e) { if (!(e && e.code === 'EEXIST')) return false; }   // the put-back failed: the claim is kept, not deleted
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
     and the board falls back to its state file. During a restart overlap this also removes the old supervisor's
     record, which is about to be replaced anyway. */
  try { fs.rmSync(presencePath(name), { force: true }); } catch (e) { onProblem('we could not remove an older presence record (' + ((e && e.code) || 'unknown') + ')'); }
  /* A look at the pipe on Windows (fs.existsSync) opens a client connection, so every board poll arrives here. It is
     dropped at once, and a connection that errors on the way out (a reset) must not become an uncaught exception. */
  const server = net.createServer((socket) => { socket.on('error', () => {}); socket.destroy(); });
  server.on('error', (e) => { onProblem('we could not open its presence pipe (' + ((e && e.code) || 'unknown') + ')'); });
  try {
    server.listen(pipe, () => {
      if (stopped) return;
      try {
        fs.mkdirSync(stateDir(), { recursive: true });
        store.saveFlushed(presencePath(name), JSON.stringify({ v: PRESENCE_VERSION, pid: process.pid, pipe }));
        wrote = true;
      } catch (e) {
        onProblem('we could not record its presence (' + ((e && e.code) || 'unknown') + ')');
      }
    });
    if (typeof server.unref === 'function') server.unref();
  } catch (e) {
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
    try { up = pipeExists(rec.pipe) === true || (pause(RETRY_PAUSE_MS), pipeExists(rec.pipe) === true); } catch { up = false; }   // one retry, after a short pause: a look can meet a busy pipe
    if (up) { out.set(name, true); continue; }
    let pidAlive = true;
    try { pidAlive = isAlive(rec.pid) === true; } catch { pidAlive = true; }   // could not tell: decide nothing
    if (!pidAlive) out.set(name, false);
  }
  return out;
}

module.exports = { PRESENCE_VERSION, PRESENCE_EXT, PIPE_PREFIX, presencePath, readPresence, clearPresence, start, presenceByName };
