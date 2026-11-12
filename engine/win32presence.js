'use strict';
/**
 * kosmos#8415: a Windows supervisor's record of its own presence, so the board can tell an agent whose supervisor is
 * up from one that has stopped, including while a Claude supervisor is between children (its state file then names
 * no process: win32streamstate.liveNames).
 *
 * The supervisor listens on a named pipe with a random name for as long as it runs, and writes `<key>.presence` in
 * win32-state naming that pipe. The PIPE is the proof of life, not the pid: Windows removes a pipe when the process
 * that holds it dies (a crash, a killed task tree, a Fast Startup shutdown), and no other process can hold a name this
 * one made up. Measured on Windows (kosmos#8415, Homer, node 24.19): fs.existsSync on the pipe path reads a live pipe
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

function stateDir() { return path.join(store.ROOT, 'win32-state'); }
function presencePath(name) { return path.join(stateDir(), store.safeKey(name) + PRESENCE_EXT); }
function randomPipe() { return PIPE_PREFIX + crypto.randomBytes(8).toString('hex'); }

/** `name`'s presence record, or null when there is none or it cannot be read as one. */
function readPresence(name) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(presencePath(name), 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || rec.v !== PRESENCE_VERSION) return null;
  if (!Number.isInteger(rec.pid) || typeof rec.pipe !== 'string' || !rec.pipe) return null;
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
  try { if (!fs.existsSync(at)) fs.renameSync(claim, at); else fs.rmSync(claim, { force: true }); } catch { /* best effort */ }
  return false;
}

/**
 * The supervisor's side. Listens on a fresh pipe and, once it is listening, writes the record. Never throws, and
 * never keeps the process alive (the server is unref'd). Returns `{ stop() }`; stop removes the record (if it is
 * still this process's) and closes the pipe. A pipe that could not be opened is said through `opts.onProblem`, and
 * then no record is written, so the agent falls back to the state-file rule.
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
  const server = net.createServer((socket) => { socket.destroy(); });   // a look at the pipe never holds it
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
 * name -> true (its pipe exists) or false (its pipe is gone, so that supervisor is dead). A name with no record is
 * absent from the map. Fail-soft to an empty map.
 */
function presenceByName(opts) {
  const o = opts || {};
  const pipeExists = typeof o.pipeExists === 'function' ? o.pipeExists : (p) => fs.existsSync(p);
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
    out.set(name, up);
  }
  return out;
}

module.exports = { PRESENCE_VERSION, PRESENCE_EXT, PIPE_PREFIX, presencePath, readPresence, clearPresence, start, presenceByName };
