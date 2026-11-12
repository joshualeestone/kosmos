'use strict';
/**
 * #8373: a Windows board's own output goes to a log file, as it does on the Mac.
 *
 * On the Mac and Linux, board.log is the board's stdout and stderr, redirected by whatever starts it: launchd's
 * StandardOutPath (install/setup.sh), install/kosmos's `nohup ... >>`, the Linux unit's StandardOutput=append. The
 * Windows board's logon task runs it under `conhost.exe --headless` (engine/win32job.js headlessExec), and that host
 * sends both streams nowhere, so a Windows board had no log at all.
 *
 * The redirect cannot be put on the task's command line. A `cmd /c ... >> board.log` between conhost and node would
 * make cmd node's parent, and engine/win32orphan.js stops a task-started board when its host goes, so `/End` would no
 * longer stop the board. So the board opens the file itself and copies every write into it by descriptor, with the
 * time stamp engine/logstamp.js puts on the Mac's file. Only the file's copy is stamped: what reaches the console (a
 * board started by hand, a test reading a board's stdout) is the board's own text, as on the Mac.
 * engine/diagnostics.js reads the file by its path, and only when it is the file open on that descriptor.
 *
 * WHERE. `<LOCALAPPDATA>\Kosmos\logs\board.log` (the folder name is win32anchor.APP): beside the durable `runtime\`
 * folder of engine/win32anchor.js, as the Mac keeps `logs/board.log` beside `runtime/` in its KOSMOS_HOME. A named
 * Kosmos (#1704) writes `board-<world>.log` there, because the anchor is one for every world and two boards must not
 * share a file the diagnostics read as "this board's own output". Not under the app folder: that is the versioned
 * extract root, which an update deletes. Not `win32-logs\board.log`: that file already holds the board watchdog's own
 * start and exit lines (engine/win32boardwatch.js) under the same name.
 *
 * WHAT IT CANNOT SEE. Only writes made through process.stdout and process.stderr: a child started with inherited
 * stdio, and anything written to the descriptors below JavaScript, never pass through it; an uncaught exception's stack
 * is written to the file from an uncaughtExceptionMonitor (its own line, not node's full report). Nor does anything written before server.js runs:
 * the logon shim's own lines (win32board.js BOOT_JS: a fallback to the previous version, a missing engine pointer)
 * and the world bootstrap's named-world lines still go nowhere.
 *
 * SIZE. The Mac's file is not rotated by the board. Here, a file over ROTATE_BYTES when the board starts is moved to
 * `<name>.old` (one older copy, replaced each time). The size is checked only at each start.
 *
 * WHO. Only a board that carries its logon task's marker (win32board.startedByTask): a board started by hand writes to
 * its own console, and a board a test starts as a child is not marked. The marker is an environment variable, so a
 * second board started from inside the task board's own process tree inherits it and would append to the same file.
 * It is not cleared here, because server.js reads the same marker later to arm its exit watch. Such a second board
 * cannot also serve (the first holds the port), but while it starts it can append to the file, and if the file is over
 * ROTATE_BYTES it moves the first board's open file to `.old`, after which the first board writes there and its
 * diagnostics fall back to the ring.
 *
 * A DEAD CONSOLE. Once routed, each console stream gets an 'error' listener for as long as the board runs, so a console
 * pipe whose reader has gone (Homer's 0.8.03 in-place update) cannot become an uncaught error; this also quiets an
 * error from any other writer on those streams. The file keeps every line and records, once per stream, that its
 * console copy is stopped; later errors on that stream are dropped. Writes still go on to node's own write, which for a
 * destroyed stream reports the error to the caller (kosmos#8424: "recorded as stopped", not "ended").
 *
 * Nothing here throws into the board except what node's own write throws for a caller's bad argument: when the file
 * cannot be opened the board runs as it did before.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROTATE_BYTES = 20 * 1024 * 1024;
// The same set as engine/logstamp.js.
const LINE_TEXT_ENCODINGS = /^(utf-?8|latin1|binary|ascii)$/i;

let routed = null;   // { path, fd } once route() has opened the log in this process

/** The log's path for `platform` and its world, beside the anchor's `runtime\` for the same `home` and `env`. */
function logPath(platform, home, env) {
  const e = env || {};
  const anchor = require('./win32anchor').anchorDir(platform, home, e);   // <base>\runtime
  const world = require('./launchidentity').currentWorldId(e);
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = world === 'default' ? 'board.log' : 'board-' + String(world).replace(/[^A-Za-z0-9_-]/g, '_') + '.log';
  return p.join(p.dirname(anchor), 'logs', name);
}

/* Writes all of `bytes` to `fd`. */
function writeAll(fd, bytes) {
  let off = 0;
  while (off < bytes.length) {
    const n = fs.writeSync(fd, bytes, off, bytes.length - off);
    if (!(n > 0)) return;   // no progress: give up on this write rather than spin
    off += n;
  }
}

/* Copies each write on `stream` into `fd`, stamped, then passes it on to the original write. An error on that stream
   (an event, or an I/O error thrown by a write) is recorded once in the file and never ends the board; later writes
   still go to node's own write, whose callback then carries the error. `name` says which stream, in that line. */
function tee(stream, fd, lineState, now, name) {
  const { stampText, stampBytes } = require('./logstamp');
  const write = stream.write.bind(stream);
  /* #8373 follow-up (Homer, 0.8.03 in-place update on Windows): the console stream a task-started board inherits can be
     a pipe whose reader is gone. Its EPIPE then arrives as an 'error' event no one listens for, which node turns into an
     uncaught exception, and the board died 74 s after start. This board's output already goes to the file, so the
     console is the copy that may be lost. Any error event on the stream, not only a dead pipe, is recorded as its console
     copy stopping (kosmos#8424: recorded, not ended; writes still go to node's own write, below).
     The file copy is taken first, so a write node then rejects for a bad argument is still in the file. */
  let dead = false;
  const giveUp = (err) => {
    if (dead) return;
    dead = true;
    const code = (err && err.code) || 'an error';
    try {
      const text = (lineState.atLineStart ? '' : '\n') + now().toISOString() + ' the console copy of ' + name + ' stopped ('
        + code + '); this file keeps every line\n';
      writeAll(fd, Buffer.from(text, 'utf8'));
      lineState.atLineStart = true;
    } catch { /* as below */ }
  };
  if (typeof stream.on === 'function') { try { stream.on('error', giveUp); } catch { /* a stream with no events */ } }
  stream.write = function (chunk, encoding, callback) {
    const cb = typeof encoding === 'function' ? encoding : callback;
    try {
      const enc = typeof encoding === 'string' ? encoding : undefined;
      if (typeof chunk === 'string' && (!enc || LINE_TEXT_ENCODINGS.test(enc))) {
        const s = stampText(chunk, lineState.atLineStart, now().toISOString());
        writeAll(fd, Buffer.from(s.text, enc || 'utf8'));
        lineState.atLineStart = s.atLineStart;
      } else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
        const s = stampBytes(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), lineState.atLineStart, now().toISOString());
        writeAll(fd, s.buf);
        lineState.atLineStart = s.atLineStart;
      } else if (typeof chunk === 'string') {
        writeAll(fd, Buffer.from(chunk, enc));   // a hex or base64 write is not text: copied as it is, like the stamp does
      }
    } catch { /* a full disk or a closed file must not stop the board */ }
    /* Every write still goes to node's own write, even after the console failed: node checks the arguments (a bad one
       throws as it always did) and reports a dead stream through the callback; the first failure also arrives as an
       'error' event, which giveUp absorbs. Once node has destroyed the stream, or marked it no longer writable (a failed
       write with autoDestroy off), this returns true: node's false there would ask a caller to wait for a 'drain'
       that never comes. A stream that is still writable answers as node does (kosmos#8424), so real backpressure is
       not hidden. node's own state decides, not the error event, which arrives a tick after the destroy. Defensive: a pipe's EPIPE arrives as that event,
       not as a throw; only an I/O failure is caught here. */
    try { const ok = write(chunk, encoding, callback); return stream.destroyed === true || stream.writable === false ? true : ok; } catch (err) {
      if (!(err && (err.syscall || typeof err.errno === 'number'))) throw err;
      giveUp(err);
      if (typeof cb === 'function') process.nextTick(() => cb(err));
      return true;   // nothing is buffered, so a caller must not wait for a 'drain' that will not come
    }
  };
}

/**
 * On Windows, for the board its logon task started, when neither stream is already a file: opens the log for
 * appending and copies both streams into it. A board started by hand has its own console, and a board a test starts
 * as a child is not task-started, so neither writes this file. Returns { path, fd } when it routed, else null. `deps`
 * is for tests: platform, home, env, path (the log), isFile(fd), taskStarted(), now(), inTest(), handlers() (how many
 * uncaughtException handlers there are), and onCrash (where the uncaught-exception writer is registered; default
 * process.on).
 */
function route(stdout, stderr, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  if (platform !== 'win32' || routed) return null;
  const env = d.env || process.env;
  const taskStarted = typeof d.taskStarted === 'function' ? d.taskStarted : () => require('./win32board').startedByTask(env);
  if (!taskStarted()) return null;
  const inTest = typeof d.inTest === 'function' ? d.inTest : () => require('./live-execution').inTestRun();
  if (!d.path && inTest()) return null;   // and a test that names no file of its own
  const isFile = typeof d.isFile === 'function' ? d.isFile : require('./logstamp').isRegularFile;
  if (isFile(1) || isFile(2)) return null;   // something already sends the board's output to a file: leave it as it is
  let fd = null;
  try {
    const file = d.path || logPath(platform, d.home || os.homedir(), env);   // the anchor's own callers pass os.homedir()
    fs.mkdirSync((d.path ? path : path.win32).dirname(file), { recursive: true });
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* none yet */ }
    if (size > ROTATE_BYTES) { try { fs.renameSync(file, file + '.old'); } catch { /* keep appending to the big one */ } }
    fd = fs.openSync(file, 'a');
    const now = typeof d.now === 'function' ? d.now : () => new Date();
    const lineState = { atLineStart: true };
    if (require('./logstamp').endsMidLine(fd, [file])) { try { writeAll(fd, Buffer.from('\n')); } catch { /* as above */ } }
    const onCrash = typeof d.onCrash === 'function' ? d.onCrash : (name, fn) => process.on(name, fn);
    onCrash('uncaughtExceptionMonitor', (err, origin) => {
      try {
        // An error something catches is not a crash: the board lives on (win32boardwatch.js's own monitor, the same rule).
        if (typeof d.handlers === 'function' ? d.handlers() > 0 : process.listenerCount('uncaughtException') > 0) return;
        const at = now().toISOString();
        const text = (lineState.atLineStart ? '' : '\n') + at + ' ' + String(origin || 'uncaughtException')
          + ': ' + String((err && err.stack) || err).replace(/\r?\n/g, '\n' + at + ' ') + '\n';
        writeAll(fd, Buffer.from(text, 'utf8'));
        lineState.atLineStart = true;
      } catch { /* nothing more can be done */ }
    });
    for (const [stream, name] of [[stdout, 'stdout'], [stderr, 'stderr']]) {
      if (stream && typeof stream.write === 'function') tee(stream, fd, lineState, now, name);
    }
    routed = { path: file, fd };
    return routed;
  } catch {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already gone */ } }
    return null;
  }
}

/** What route() opened in this process, or null. */
function current() { return routed; }

/* Tests only: forget what route() opened (the descriptor is the test's to close). */
function resetForTest() { routed = null; }

module.exports = { ROTATE_BYTES, logPath, route, current, resetForTest };
