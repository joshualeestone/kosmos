'use strict';
/**
 * kosmos#5576: a preload for the agy bridge CHILD in engine/agyseed-4417.test.js (NODE_OPTIONS=--require <this>), so
 * the libuv abort that only a loaded CI runner shows ("Assertion failed: (fd > STDERR_FILENO), function uv__close")
 * leaves a record of what fds 0, 1 and 2 were at each step.
 *
 * ⚠️ It must not change what it measures. The bridge never writes to stderr, so it never opens a stream on fd 2;
 * Node's NODE_DEBUG would make it open one (the kind of handle the assertion is about). These lines go straight to
 * fd 2 with fs.writeSync: a synchronous write, no stream, no libuv handle.
 *
 * Lines, one each, all starting "agy-trace", each with the fds' record ("<fd>:<type>@<inode>"):
 *   start          when the child starts
 *   fetch begin    entering the bridge's one fetch (the board report)
 *   fetch end      leaving it (ok, or the error's code)
 *   exit called    process.exit called (after the bridge's stdout flush)
 *   exit           on 'exit'
 * What separates the two candidate causes is WHERE a stdio fd's record first changes (its number closed and taken by
 * something else): between fetch begin and end, or after it. The abort itself comes at the close, which can be at
 * teardown after the last line either way, so the last line alone does not say which (review 3).
 *
 * A line is written only while fd 2 is still the pipe it was at start (same dev and inode, compared as BigInt, since
 * a socket's inode can pass 2^53): a write into a number reused by a socket would put text into it.
 */
const fs = require('node:fs');

function identity(fd) {
  try { const st = fs.fstatSync(fd, { bigint: true }); return st.dev + ':' + st.ino; } catch { return null; }
}
const FD2_AT_START = identity(2);
function fdRecord() {
  return [0, 1, 2].map((fd) => {
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      const kind = st.isFIFO() ? 'fifo' : st.isCharacterDevice() ? 'chr' : st.isSocket() ? 'sock' : st.isFile() ? 'file' : 'other';
      return fd + ':' + kind + '@' + st.ino;
    } catch (e) { return fd + ':' + ((e && e.code) || 'gone'); }
  }).join(' ');
}
function mark(text) {
  if (FD2_AT_START === null || identity(2) !== FD2_AT_START) return;   // gone, or no longer the pipe it was
  try { fs.writeSync(2, 'agy-trace ' + text + ' | ' + fdRecord() + '\n'); } catch { /* fd 2 gone: nothing to say it on */ }
}

mark('start');
const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  globalThis.fetch = function tracedFetch(...args) {
    mark('fetch begin');
    return realFetch.apply(this, args).then(
      (r) => { mark('fetch end ok'); return r; },
      (e) => {
        let why = 'unknown';
        try { why = (e && ((e.cause && e.cause.code) || e.name)) || 'unknown'; } catch { /* an odd error: still rethrown */ }
        mark('fetch end error ' + why);
        throw e;
      },
    );
  };
}
const realExit = process.exit;
process.exit = function tracedExit(code) {
  mark('exit called ' + code);
  return realExit.call(process, code);
};
process.on('exit', (code) => { mark('exit ' + code); });
