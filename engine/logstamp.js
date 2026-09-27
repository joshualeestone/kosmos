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

/* String encodings whose text can be stamped like UTF-8: in each, a newline is the one byte 0x0a and the ASCII stamp is
   the same bytes. Any other (hex, base64, utf16le) is not line text and goes through untouched. */
const LINE_TEXT_ENCODINGS = /^(utf-?8|latin1|binary|ascii)$/i;

/* The pure part: `text` stamped at every line start. `atLineStart` says whether the previous write ended a line (true
   for the first write). Returns the stamped text and whether this one ended a line. */
function stampText(text, atLineStart, stamp) {
  let stamped = '';
  let atStart = atLineStart;
  for (let index = 0; index < text.length; index += 1) {
    if (atStart) { stamped += stamp + ' '; atStart = false; }
    const character = text[index];
    stamped += character;
    if (character === '\n') atStart = true;
  }
  return { text: stamped, atLineStart: atStart };
}

/* The same for bytes, so a Buffer write goes out exactly as written: a newline byte (0x0a) never occurs inside a
   multi-byte UTF-8 character, so stamping after each one needs no decoding, holds nothing back and changes no byte. */
function stampBytes(bytes, atLineStart, stamp) {
  const pieces = [];
  const stampBytesPrefix = Buffer.from(stamp + ' ', 'utf8');
  let atStart = atLineStart;
  let pieceStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (atStart) { pieces.push(stampBytesPrefix); atStart = false; }
    if (bytes[index] === 0x0a) { pieces.push(bytes.subarray(pieceStart, index + 1)); pieceStart = index + 1; atStart = true; }
  }
  if (pieceStart < bytes.length) pieces.push(bytes.subarray(pieceStart));
  return { buf: Buffer.concat(pieces), atLineStart: atStart };
}

/* Whether this descriptor is a regular file (board.log), never a pipe, socket or terminal. */
function isRegularFile(fd) {
  try { return fs.fstatSync(fd).isFile(); } catch { return false; }
}

/* Whether the file open on `fd` ends in the middle of a line (a previous board that died mid-write). A board's stdout is
   write-only, so it is read back through a PATH instead: the first of `logPaths` that is the same file (same device and
   inode) as `fd`. False when none is, when the file is empty or ends with a newline, or when the last byte cannot be
   read (a file truncated or rotated between the two looks), so an unsure answer never adds a blank line. */
function endsMidLine(fd, logPaths) {
  let fdStat;
  try { fdStat = fs.fstatSync(fd); } catch { return false; }
  if (!fdStat.size) return false;
  for (const logPath of logPaths || []) {
    if (!logPath) continue;
    try {
      const pathStat = fs.statSync(logPath);
      if (pathStat.dev !== fdStat.dev || pathStat.ino !== fdStat.ino || pathStat.size < 1) continue;
      const readFd = fs.openSync(logPath, 'r');
      try {
        const lastByte = Buffer.alloc(1);
        if (fs.readSync(readFd, lastByte, 0, 1, pathStat.size - 1) !== 1) return false;
        return lastByte[0] !== 0x0a;
      } finally { fs.closeSync(readFd); }
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
function install(stream, fd, options) {
  const settings = options || {};
  if (!stream || typeof stream.write !== 'function' || stream.__logstamp) return false;
  if (!isRegularFile(fd)) return false;
  const clock = typeof settings.now === 'function' ? settings.now : () => new Date();
  const write = stream.write.bind(stream);
  const lineState = settings.shared && typeof settings.shared === 'object' ? settings.shared : { atLineStart: true };
  if (typeof lineState.atLineStart !== 'boolean') lineState.atLineStart = true;
  if (!lineState.checkedTail) {
    lineState.checkedTail = true;
    if (endsMidLine(fd, settings.logPaths)) write('\n');
  }
  stream.write = function (chunk, encoding, callback) {
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    if (typeof chunk === 'string') {
      if (encoding && !LINE_TEXT_ENCODINGS.test(String(encoding))) return write(chunk, encoding, callback);
      const stamped = stampText(chunk, lineState.atLineStart, clock().toISOString());
      lineState.atLineStart = stamped.atLineStart;
      return write(stamped.text, encoding || 'utf8', callback);
    }
    if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const stamped = stampBytes(bytes, lineState.atLineStart, clock().toISOString());
      lineState.atLineStart = stamped.atLineStart;
      return write(stamped.buf, callback);
    }
    return write(chunk, encoding, callback);   // anything else goes through untouched
  };
  stream.__logstamp = true;
  return true;
}

/* Whether two descriptors are the same open file (same device and inode), so they can share one line-start state. */
function sameFile(firstFd, secondFd) {
  try {
    const first = fs.fstatSync(firstFd), second = fs.fstatSync(secondFd);
    return first.dev === second.dev && first.ino === second.ino;
  } catch { return false; }
}

module.exports = { stampText, stampBytes, isRegularFile, endsMidLine, install, sameFile };
