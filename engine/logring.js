'use strict';

/* #5959 slice 4: the last lines the board itself wrote, kept in memory for the diagnostics file.

   The board does not know where its log goes: board.log is its stdout and stderr, redirected by whatever started it
   (launchd, install/kosmos, the Linux unit, the Windows supervisor), and on Windows there is no board.log path the
   engine can name. So the lines are taken where the board writes them. tap() wraps a stream's write (after
   engine/logstamp.js, so the line is the board's own text, not the stamp) and keeps each finished line with the time it
   was written. It taps whatever the stream is (a file, a pipe, a terminal), and holds only lines since this board
   started.

   Bounded: at most MAX_LINES lines, each cut to MAX_LINE_CHARS, and a line still unfinished is cut at the same length.
   The write itself always goes through unchanged, whatever recording does. */

const { StringDecoder } = require('node:string_decoder');

const MAX_LINES = 2000;
const TEXT_ENCODINGS = /^(utf-?8|latin1|binary|ascii)$/i;   // logstamp.js's LINE_TEXT_ENCODINGS
/* 2,000 shown (engine/diagnostics cuts there) plus 256 kept past it, so a key or a name that straddles the cut is still
   whole when the diagnostics redactor reads it: it redacts first and cuts after. */
const MAX_LINE_CHARS = 2256;

function createRing(options) {
  const settings = options || {};
  const maxLines = Number.isInteger(settings.maxLines) && settings.maxLines > 0 ? settings.maxLines : MAX_LINES;
  const maxChars = Number.isInteger(settings.maxChars) && settings.maxChars > 0 ? settings.maxChars : MAX_LINE_CHARS;
  const clock = typeof settings.now === 'function' ? settings.now : () => new Date();
  const lines = [];

  function push(stream, text) {
    lines.push({ at: clock().toISOString(), stream, line: text.length > maxChars ? text.slice(0, maxChars) : text });
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
  }

  /* Records `text` as written to `stream`; `carry` holds the unfinished line between writes. */
  function record(state, text) {
    const parts = (state.carry + text).split('\n');
    state.carry = parts.pop();
    if (state.carry.length > maxChars) state.carry = state.carry.slice(0, maxChars);
    for (const part of parts) push(state.name, part.endsWith('\r') ? part.slice(0, -1) : part);
  }

  function tap(stream, name) {
    if (!stream || typeof stream.write !== 'function' || stream.__logring) return false;
    const write = stream.write.bind(stream);
    // One decoder per stream, so a character split across two writes is decoded whole.
    const state = { name: String(name || ''), carry: '', decoder: new StringDecoder('utf8') };
    stream.write = function (chunk, encoding, callback) {
      try {
        // As logstamp: a string in another encoding (hex, base64) is bytes, not a line of text, and is not recorded.
        if (typeof chunk === 'string') { if (!encoding || typeof encoding === 'function' || TEXT_ENCODINGS.test(String(encoding))) record(state, chunk); }
        else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
          record(state, state.decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
        }
      } catch { /* recording never stops the write */ }
      return write(chunk, encoding, callback);
    };
    stream.__logring = true;
    return true;
  }

  /* The newest `n` finished lines (all of them when n is not a positive integer), oldest first, as copies. */
  function tail(n) {
    const count = Number.isInteger(n) && n > 0 ? Math.min(n, lines.length) : lines.length;
    return lines.slice(lines.length - count).map((entry) => ({ ...entry }));
  }

  return { tap, tail };
}

/* The board's own ring: server.js taps stdout and stderr into it when it is the board. */
const board = createRing();

module.exports = { createRing, board, MAX_LINES, MAX_LINE_CHARS };
