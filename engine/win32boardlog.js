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
 * stdio, and anything written to the descriptors below JavaScript, never pass through it. The one such write that
 * matters, node's report of an uncaught exception, is written to the file from an uncaughtExceptionMonitor.
 *
 * SIZE. The Mac's file is not rotated by the board. Here, a file over ROTATE_BYTES when the board starts is moved to
 * `<name>.old` (one older copy, replaced each time), so a board that runs for months cannot grow it without end.
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
  return p.join(p.dirname(anchor), 'logs', world === 'default' ? 'board.log' : 'board-' + world + '.log');
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
        lineState.atLineStart = s.atLineStart;
        writeAll(fd, Buffer.from(s.text, 'utf8'));
      } else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
        const s = stampBytes(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), lineState.atLineStart, now().toISOString());
        lineState.atLineStart = s.atLineStart;
        writeAll(fd, s.buf);
      } else if (typeof chunk === 'string') {
        writeAll(fd, Buffer.from(chunk, enc));   // a hex or base64 write is not text: copied as it is, like the stamp does
      }
    } catch { /* a full disk or a closed file must not stop the board */ }
    return write(chunk, encoding, callback);
  };
}

/**
 * On Windows, when neither stream is already a file, opens the log for appending and copies both streams into it.
 * Returns { path, fd } when it did, else null. `deps` is for tests: platform, home, env, path (the log), isFile(fd),
 * now(), and onCrash (where the uncaught-exception writer is registered; default process.on).
 */
function route(stdout, stderr, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  if (platform !== 'win32' || routed) return null;
  // A test that did not name its own file never writes the person's real log.
  if (!d.path && require('./live-execution').inTestProcess()) return null;
  const isFile = typeof d.isFile === 'function' ? d.isFile : require('./logstamp').isRegularFile;
  if (isFile(1) || isFile(2)) return null;   // something already sends the board's output to a file: leave it as it is
  try {
    const env = d.env || process.env;
    const file = d.path || logPath(platform, d.home || env.AGENT_WORKFORCE_HOME || os.homedir(), env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > ROTATE_BYTES) fs.renameSync(file, file + '.old'); } catch { /* none yet */ }
    const fd = fs.openSync(file, 'a');
    const now = typeof d.now === 'function' ? d.now : () => new Date();
    const lineState = { atLineStart: true };
    if (require('./logstamp').endsMidLine(fd, [file])) { try { writeAll(fd, Buffer.from('\n')); } catch { /* as above */ } }
    for (const stream of [stdout, stderr]) if (stream && typeof stream.write === 'function') tee(stream, fd, lineState, now);
    const onCrash = typeof d.onCrash === 'function' ? d.onCrash : (name, fn) => process.on(name, fn);
    onCrash('uncaughtExceptionMonitor', (err, origin) => {
      try {
        const text = (lineState.atLineStart ? '' : '\n') + now().toISOString() + ' ' + String(origin || 'uncaughtException')
          + ': ' + String((err && err.stack) || err).replace(/\r?\n/g, '\n' + now().toISOString() + ' ') + '\n';
        writeAll(fd, Buffer.from(text, 'utf8'));
        lineState.atLineStart = true;
      } catch { /* nothing more can be done */ }
    });
    routed = { path: file, fd };
    return routed;
  } catch { return null; }
}

/** What route() opened in this process, or null. */
function current() { return routed; }

/* Tests only: forget what route() opened (the descriptor is the test's to close). */
function resetForTest() { routed = null; }

module.exports = { ROTATE_BYTES, logPath, route, current, resetForTest };
