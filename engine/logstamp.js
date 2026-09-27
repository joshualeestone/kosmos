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
 * NOT STAMPED: output that does not go through this process's stdout/stderr.write, namely Node's own fatal crash trace,
 * child processes that inherit the board's stderr (engine/remote.js spawns with stdio 'inherit'), and install/kosmos's
 * own board-run narration written before it execs node (for example "Kosmos was deliberately stopped; not starting"),
 * and the world bootstrap's named-world lines, which server.js prints before it can install this;
 * such a line in board.log carries no time, and a child's can split a stamped line.
 */
const fs = require('node:fs');

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

/* The same for bytes, so a Buffer write goes out exactly as written: a newline byte (0x0a) never occurs inside a
   multi-byte UTF-8 character, so stamping after each one needs no decoding, holds nothing back and changes no byte. */
function stampBytes(buf, atLineStart, stamp) {
  const parts = [];
  const st = Buffer.from(stamp + ' ', 'utf8');
  let start = atLineStart;
  let from = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (start) { parts.push(st); start = false; }
    if (buf[i] === 0x0a) { parts.push(buf.subarray(from, i + 1)); from = i + 1; start = true; }
  }
  if (from < buf.length) parts.push(buf.subarray(from));
  return { buf: Buffer.concat(parts), atLineStart: start };
}

/* Whether this descriptor is a regular file (board.log), never a pipe, socket or terminal. */
function isRegularFile(fd) {
  try { return fs.fstatSync(fd).isFile(); } catch { return false; }
}

/* Whether the file open on `fd` ends in the middle of a line (a previous board that died mid-write). A board's stdout is
   write-only, so it is read back through a PATH instead: the first of `logPaths` that is the same file (same device and
   inode) as `fd`. False when none is, or the file is empty or ends with a newline. */
function endsMidLine(fd, logPaths) {
  let st;
  try { st = fs.fstatSync(fd); } catch { return false; }
  if (!st.size) return false;
  for (const p of logPaths || []) {
    if (!p) continue;
    try {
      const ps = fs.statSync(p);
      if (ps.dev !== st.dev || ps.ino !== st.ino) continue;
      const rfd = fs.openSync(p, 'r');
      try {
        const b = Buffer.alloc(1);
        fs.readSync(rfd, b, 0, 1, ps.size - 1);
        return b[0] !== 0x0a;
      } finally { fs.closeSync(rfd); }
    } catch { /* not this one */ }
  }
  return false;
}

/* Wraps stream.write so every line written from now on starts with the time. A no-op unless fd is a regular file (see the
   header), and only once per stream. Options:
   - now: the clock (the test seam);
   - shared: one line-start state for two streams on the SAME file (the board's stdout and stderr both go to board.log),
     so a line one begins and the other ends is stamped once;
   - logPaths: where board.log may be, so a file left mid-line by a board that died is ended first, and this run's first
     line starts on a line of its own (endsMidLine).
   Returns whether it installed. */
function install(stream, fd, opts) {
  const o = opts || {};
  if (!stream || typeof stream.write !== 'function' || stream.__logstamp) return false;
  if (!isRegularFile(fd)) return false;
  const clock = typeof o.now === 'function' ? o.now : () => new Date();
  const write = stream.write.bind(stream);
  const state = o.shared && typeof o.shared === 'object' ? o.shared : { atLineStart: true };
  if (typeof state.atLineStart !== 'boolean') state.atLineStart = true;
  if (!state.checkedTail) {
    state.checkedTail = true;
    if (endsMidLine(fd, o.logPaths)) write('\n');
  }
  stream.write = function (chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (typeof chunk === 'string') {
      /* A string in another encoding (hex, base64) is not text to stamp: it goes through as written, and does not move
         the line state (nothing in the board writes one to stdout or stderr). */
      if (encoding && !/^utf-?8$/i.test(String(encoding))) return write(chunk, encoding, cb);
      const r = stampText(chunk, state.atLineStart, clock().toISOString());
      state.atLineStart = r.atLineStart;
      return write(r.text, 'utf8', cb);
    }
    if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      const r = stampBytes(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), state.atLineStart, clock().toISOString());
      state.atLineStart = r.atLineStart;
      return write(r.buf, cb);
    }
    return write(chunk, encoding, cb);   // anything else goes through untouched
  };
  stream.__logstamp = true;
  return true;
}

/* Whether two descriptors are the same open file (same device and inode), so they can share one line-start state. */
function sameFile(fdA, fdB) {
  try { const a = fs.fstatSync(fdA), b = fs.fstatSync(fdB); return a.dev === b.dev && a.ino === b.ino; } catch { return false; }
}

module.exports = { stampText, stampBytes, isRegularFile, endsMidLine, install, sameFile };
