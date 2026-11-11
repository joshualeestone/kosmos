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
 * engine/diagnostics.js reads the file back through the same descriptor.
 *
 * WHERE. `<LOCALAPPDATA>\Kosmos\logs\board.log` (the folder name is win32anchor.APP): beside the durable `runtime\`
 * folder of engine/win32anchor.js, as the Mac keeps `logs/board.log` beside `runtime/` in its KOSMOS_HOME. A named
 * Kosmos (#1704) writes `board-<world>.log` there, because the anchor is one for every world and two boards must not
 * share a file the diagnostics read as "this board's own output". Not under the app folder: that is the versioned
 * extract root, which an update deletes. Not `win32-logs\board.log`: that file already holds the board watchdog's own
 * start and exit lines (engine/win32boardwatch.js) under the same name.
 *
 * WHAT IT CANNOT SEE. Only writes made through process.stdout and process.stderr: a child started with inherited
 * stdio, and anything written to the descriptors below JavaScript, never pass through it; node's report of an uncaught
 * exception is written to the file from an uncaughtExceptionMonitor. Nor does anything written before server.js runs:
 * the logon shim's own lines (win32board.js BOOT_JS: a fallback to the previous version, a missing engine pointer)
 * and the world bootstrap's named-world lines still go nowhere.
 *
 * SIZE. The Mac's file is not rotated by the board. Here, a file over ROTATE_BYTES when the board starts is moved to
 * `<name>.old` (one older copy, replaced each time). The size is checked only at each start.
 *
 * WHO. Only a board that carries its logon task's marker (win32board.startedByTask): a board started by hand writes to
 * its own console, and a board a test starts as a child is not marked. The marker is an environment variable, so a
 * second board started from inside the task board's own process tree inherits it and would append to the same file.
 * It is not cleared here, because server.js reads the same marker later to arm its exit watch.
 *
 * Nothing here throws into the board: when the file cannot be opened the board runs as it did before.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROTATE_BYTES = 20 * 1024 * 1024;
const LINE_TEXT_ENCODINGS = /^(utf-?8|latin1|binary|ascii)$/i;   // engine/logstamp.js's

let routed = null;   // { path, fd } once route() has opened the log in this process

/** The log's path for `platform` and its world, from the same root the durable anchor uses. */
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
  while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off);
}

/* Copies each write on `stream` into `fd`, stamped, then lets the original write go on unchanged. */
function tee(stream, fd, lineState, now) {
  const { stampText, stampBytes } = require('./logstamp');
  const write = stream.write.bind(stream);
  stream.write = function (chunk, encoding, callback) {
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
    return write(chunk, encoding, callback);
  };
}

/**
 * On Windows, for the board its logon task started, when neither stream is already a file: opens the log for
 * appending and copies both streams into it. A board started by hand has its own console, and a board a test starts
 * as a child is not task-started, so neither writes this file. Returns { path, fd } when it routed, else null. `deps`
 * is for tests: platform, home, env, path (the log), isFile(fd), taskStarted(), now(), and onCrash (where the
 * uncaught-exception writer is registered; default process.on).
 */
function route(stdout, stderr, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  if (platform !== 'win32' || routed) return null;
  const env = d.env || process.env;
  const taskStarted = typeof d.taskStarted === 'function' ? d.taskStarted : () => require('./win32board').startedByTask(env);
  if (!taskStarted()) return null;
  if (!d.path && require('./live-execution').inTestProcess()) return null;   // and a test that names no file of its own
  const isFile = typeof d.isFile === 'function' ? d.isFile : require('./logstamp').isRegularFile;
  if (isFile(1) || isFile(2)) return null;   // something already sends the board's output to a file: leave it as it is
  try {
    const file = d.path || logPath(platform, d.home || env.AGENT_WORKFORCE_HOME || os.homedir(), env);
    fs.mkdirSync((d.path ? path : path.win32).dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > ROTATE_BYTES) fs.renameSync(file, file + '.old'); } catch { /* none yet */ }
    const fd = fs.openSync(file, 'a');
    const now = typeof d.now === 'function' ? d.now : () => new Date();
    const lineState = { atLineStart: true };
    if (require('./logstamp').endsMidLine(fd, [file])) { try { writeAll(fd, Buffer.from('\n')); } catch { /* as above */ } }
    const onCrash = typeof d.onCrash === 'function' ? d.onCrash : (name, fn) => process.on(name, fn);
    onCrash('uncaughtExceptionMonitor', (err, origin) => {
      try {
        const at = now().toISOString();
        const text = (lineState.atLineStart ? '' : '\n') + at + ' ' + String(origin || 'uncaughtException')
          + ': ' + String((err && err.stack) || err).replace(/\r?\n/g, '\n' + at + ' ') + '\n';
        writeAll(fd, Buffer.from(text, 'utf8'));
        lineState.atLineStart = true;
      } catch { /* nothing more can be done */ }
    });
    for (const stream of [stdout, stderr]) if (stream && typeof stream.write === 'function') tee(stream, fd, lineState, now);
    routed = { path: file, fd };
    return routed;
  } catch { return null; }
}

/** What route() opened in this process, or null. */
function current() { return routed; }

/* Tests only: forget what route() opened (the descriptor is the test's to close). */
function resetForTest() { routed = null; }

module.exports = { ROTATE_BYTES, logPath, route, current, resetForTest };
