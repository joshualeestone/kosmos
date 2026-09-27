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
 * ONLY INTO A FILE. install() stamps a stream only when its file descriptor is a regular FILE, which is what board.log
 * is under launchd and nohup. A pipe (every test that spawns the board and reads its output) or a terminal (a person
 * running it by hand) is left exactly as it was.
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

/* Whether this descriptor is a regular file (board.log), never a pipe, socket or terminal. */
function isRegularFile(fd) {
  try { return fs.fstatSync(fd).isFile(); } catch { return false; }
}

/* Wraps stream.write so every line written from now on starts with the time. A no-op unless fd is a regular file (see the
   header), and only once per stream. `now` is the test seam. Returns whether it installed. */
function install(stream, fd, now) {
  if (!stream || typeof stream.write !== 'function' || stream.__logstamp) return false;
  if (!isRegularFile(fd)) return false;
  const clock = typeof now === 'function' ? now : () => new Date();
  const write = stream.write.bind(stream);
  let atLineStart = true;
  stream.write = function (chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    let text;
    if (typeof chunk === 'string') text = chunk;
    else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) text = Buffer.from(chunk).toString('utf8');
    else return write(chunk, encoding, cb);   // anything else goes through untouched
    const r = stampText(text, atLineStart, clock().toISOString());
    atLineStart = r.atLineStart;
    return write(r.text, 'utf8', cb);
  };
  stream.__logstamp = true;
  return true;
}

module.exports = { stampText, isRegularFile, install };
