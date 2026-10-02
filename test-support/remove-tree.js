'use strict';
/**
 * removeTree(dir, opts): remove a test's temp folder, outlasting a Windows hold (kosmos#5010, #5074).
 * Moved here from tools.windows-kosmos-shims-570.test.js so the shims test and the grok and
 * codex win32 runner tests share one retry with its own tests
 * (test-support.remove-tree.test.js), not rmSync's maxRetries: on win32 this hold surfaces as
 * permission_denied, which rmSync's own retry covers only from Node 26.8 on (read from Node's
 * source in review, not measured here), and CI floats on Node 26.
 */
const fs = require('node:fs');

/* #5010: Windows will not remove a folder while a process still runs from it or holds a
   file in it, and a child of the shell under test (the zip's runtime\node.exe) can
   outlive that shell by a moment. A bare rmSync then threw EPERM and the test went red
   on unrelated PRs. So cleanup retries the codes Windows gives for that, pausing a
   little longer each time (about 7 s in all), and only then throws, naming the folder so
   a red reads as cleanup, not as the test's subject. That throw still replaces an assertion error
   from the test body (as the bare rmSync's did): a folder left behind must stay red.
   #5074: the win32 runner tests hit the same hold when they remove a tree holding an exe they just ran
   (grok.exe, codex.exe: copies of node.exe). */
const REMOVE_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);
function removeTree(dir, opts) {
  const o = opts || {};
  const rm = o.rm || ((d) => fs.rmSync(d, { recursive: true, force: true }));
  const pause = o.pause || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const tries = o.tries ?? 8;
  for (let attempt = 1; ; attempt += 1) {
    try {
      rm(dir);
      // Say so when it took more than one try: something outlived the run it belongs to.
      if (attempt > 1 && !o.quiet) process.stderr.write('test cleanup of ' + dir + ' took ' + attempt + ' tries\n');
      return attempt;
    } catch (err) {
      if (!REMOVE_RETRY_CODES.has(err && err.code)) throw err;
      if (attempt >= tries) {
        const e = new Error('cleanup could not remove ' + dir + ' after ' + attempt + ' tries (still busy or denied, ' + err.code + '): ' + err.message);
        e.code = err.code;
        throw e;
      }
      pause(250 * attempt);
    }
  }
}

module.exports = { removeTree };
