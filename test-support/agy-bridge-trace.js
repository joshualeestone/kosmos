'use strict';
/**
 * kosmos#5576: a preload for the agy bridge CHILD in engine/agyseed-4417.test.js (NODE_OPTIONS=--require <this>), so
 * the libuv abort that only a loaded CI runner shows ("Assertion failed: (fd > STDERR_FILENO), function uv__close")
 * says which path it died on.
 *
 * ⚠️ It must not change what it measures. The bridge never writes to stderr, so it never opens a stream on fd 2;
 * Node's NODE_DEBUG would make it open one (the kind of handle the assertion is about). These markers go straight to
 * fd 2 with fs.writeSync: a synchronous write, no stream, no libuv handle.
 *
 * Markers, one line each, all starting "agy-trace":
 *   start   the type of fds 0, 1 and 2 when the child starts
 *   fetch   entering and leaving the bridge's one fetch (the board report)
 *   exit    process.exit called (after the bridge's stdout flush), then on 'exit' the fds 0, 1 and 2 again
 * The last marker before an abort line says whether it died inside fetch or on the way out; the fd lines say whether
 * a stdio fd was closed (and its number then reused by a socket).
 */
const fs = require('node:fs');

function mark(text) {
  try { fs.writeSync(2, 'agy-trace ' + text + '\n'); } catch { /* fd 2 gone: nothing to say it on */ }
}
function fdKinds() {
  return [0, 1, 2].map((fd) => {
    try {
      const st = fs.fstatSync(fd);
      const kind = st.isFIFO() ? 'fifo' : st.isCharacterDevice() ? 'chr' : st.isSocket() ? 'sock' : st.isFile() ? 'file' : 'other';
      return fd + ':' + kind;
    } catch (e) { return fd + ':' + ((e && e.code) || 'gone'); }
  }).join(' ');
}

mark('start ' + fdKinds());
const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  globalThis.fetch = function tracedFetch(...args) {
    mark('fetch begin');
    return realFetch.apply(this, args).then(
      (r) => { mark('fetch end ok'); return r; },
      (e) => { mark('fetch end error ' + ((e && (e.cause && e.cause.code || e.name)) || 'unknown')); throw e; },
    );
  };
}
const realExit = process.exit;
process.exit = function tracedExit(code) {
  mark('exit called ' + code);
  return realExit.call(process, code);
};
process.on('exit', (code) => { mark('exit ' + code + ' ' + fdKinds()); });
