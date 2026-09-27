'use strict';

/*
 * #4199: a UTC timestamp at the start of every line the board writes to board.log.
 *
 * WHY. board.log is the board process's own stdout and stderr (launchd's StandardOutPath/StandardErrorPath, or
 * install/kosmos's `nohup ... >> board.log`), and its lines carried no time. On 2026-09-27 two agents matched board
 * restarts against the agents' self-reports and reached different conclusions about one event (#4169): with a time on
 * each line it would have been a lookup, not an argument.
 *
 * WHAT. Each line starts `2026-09-27T13:40:01.123Z ` (ISO-8601 UTC, then one space) and the text after it is exactly what
 * was written, so a grep for the text still matches (a grep anchored with ^ on the old text does not; none reads
 * board.log that way).
 *
 * ONLY INTO A FILE. install() stamps a stream only when its file descriptor is a regular FILE: board.log under launchd
 * and nohup, and also any other file the board's output is sent to, such as tools/browser-checks.sh's fixture
 * server.log files. Their readers match text without an anchor (wait_up's grep for EADDRINUSE and its tail), and
 * render-thread reads thread-server.js's log, which loads server.js as a module and so is never stamped. A pipe (the
 * node tests that spawn a board and read its output) or a terminal (a person running it by hand) is left as it was.
 *
 * NOT STAMPED: output that does not go through process.stdout/stderr.write, namely Node's own fatal crash trace, and
 * child processes that inherit the board's stderr (engine/remote.js spawns with stdio 'inherit'); such a line in
 * board.log carries no time, and can split a stamped line.
 */
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

/* The pure part: `text` stamped at every line start. `atLineStart` says whether the previous write ended a line (true
   for the first write). Returns the stamped text and whether this one ended a line. */
function stampText(text, atLineStart, stamp) {
  let out = '';
  let start = atLineStart;
  for (let i = 0; i < text.length; i += 1) {
    if (start) { out += stamp + ' '; start = false; }
    const ch = text[i];
    out += ch;
    if (ch === '\n') start = true;
  }
  return { text: out, atLineStart: start };
}

/* Whether this descriptor is a regular file (board.log), never a pipe, socket or terminal. */
function isRegularFile(fd) {
  try { return fs.fstatSync(fd).isFile(); } catch { return false; }
}

/* Wraps stream.write so every line written from now on starts with the time. A no-op unless fd is a regular file (see the
   header), and only once per stream. `now` is the test seam. `shared` is one line-start state for two streams that write
   the SAME file (the board's stdout and stderr both go to board.log), so a line one begins and the other ends is stamped
   once. Returns whether it installed. */
function install(stream, fd, now, shared) {
  if (!stream || typeof stream.write !== 'function' || stream.__logstamp) return false;
  if (!isRegularFile(fd)) return false;
  const clock = typeof now === 'function' ? now : () => new Date();
  const write = stream.write.bind(stream);
  const state = shared && typeof shared === 'object' ? shared : { atLineStart: true };
  if (typeof state.atLineStart !== 'boolean') state.atLineStart = true;
  const decoder = new StringDecoder('utf8');   // a character split across two Buffer writes stays whole
  stream.write = function (chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    let text;
    if (typeof chunk === 'string') {
      /* A string in another encoding (hex, base64) is not text to stamp: it goes through as written. */
      if (encoding && !/^utf-?8$/i.test(String(encoding))) return write(chunk, encoding, cb);
      text = chunk;
    } else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) text = decoder.write(Buffer.from(chunk));
    else return write(chunk, encoding, cb);   // anything else goes through untouched
    const r = stampText(text, state.atLineStart, clock().toISOString());
    state.atLineStart = r.atLineStart;
    return write(r.text, 'utf8', cb);
  };
  stream.__logstamp = true;
  return true;
}

/* Whether two descriptors are the same open file (same device and inode), so they can share one line-start state. */
function sameFile(fdA, fdB) {
  try { const a = fs.fstatSync(fdA), b = fs.fstatSync(fdB); return a.dev === b.dev && a.ino === b.ino; } catch { return false; }
}

module.exports = { stampText, isRegularFile, install, sameFile };
