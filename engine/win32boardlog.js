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
 * longer stop the board. So the board opens the file itself and copies every write into it by descriptor. The rest of
 * the board then treats that descriptor exactly as the Mac's fd 1: engine/logstamp.js stamps it (it checks for a
 * regular file), and engine/diagnostics.js reads the file back when the path names that open file.
 *
 * WHERE. `<LOCALAPPDATA>\Kosmos\logs\board.log` (the folder name is win32anchor.APP): beside the durable `runtime\` folder of engine/win32anchor.js,
 * as the Mac keeps `logs/board.log` beside `runtime/` in its KOSMOS_HOME. Not under the app folder: that is the
 * versioned extract root, which an update deletes. Not `win32-logs\board.log`: that file already holds the board
 * watchdog's own start and exit lines (engine/win32boardwatch.js) under the same name.
 *
 * Like the Mac's file it is appended to and not rotated here.
 *
 * Nothing here throws into the board: when the file cannot be opened the board runs as it did before.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let routed = null;   // { path, fd } once route() has opened the log in this process

/** The log's path for `platform`, from the same root the durable anchor uses. */
function logPath(platform, home, env) {
  const anchor = require('./win32anchor').anchorDir(platform, home, env);   // <base>\runtime
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(p.dirname(anchor), 'logs', 'board.log');
}

/* Copies each write on `stream` into `fd`, then lets the write go on as before. */
function tee(stream, fd) {
  const write = stream.write.bind(stream);
  stream.write = function (chunk, encoding, callback) {
    try {
      if (typeof chunk === 'string') fs.writeSync(fd, Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
      else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) fs.writeSync(fd, chunk);
    } catch { /* a full disk or a closed file must not stop the board */ }
    return write(chunk, encoding, callback);
  };
}

/**
 * On Windows, when stdout is not already a file, opens the log for appending and copies both streams into it.
 * Returns { path, fd } when it did, else null. `deps` is for tests: platform, home, env, path (the log), isFile(fd).
 */
function route(stdout, stderr, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  if (platform !== 'win32' || routed) return null;
  const isFile = typeof d.isFile === 'function' ? d.isFile : require('./logstamp').isRegularFile;
  if (isFile(1)) return null;   // something already sends the board's output to a file: leave it as it is
  try {
    const env = d.env || process.env;
    const file = d.path || logPath(platform, d.home || env.AGENT_WORKFORCE_HOME || os.homedir(), env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'a');
    for (const stream of [stdout, stderr]) if (stream && typeof stream.write === 'function') tee(stream, fd);
    routed = { path: file, fd };
    return routed;
  } catch { return null; }
}

/** What route() opened in this process, or null. */
function current() { return routed; }

/* Tests only: forget what route() opened (the descriptor is the test's to close). */
function resetForTest() { routed = null; }

module.exports = { logPath, route, current, resetForTest };
