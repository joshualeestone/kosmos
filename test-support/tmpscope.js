'use strict';
/**
 * Give this test PROCESS its own temp directory, and remove it when the process
 * exits (kosmos#4273). Require it FIRST in a test file, for its side effect:
 *
 *     require('./test-support/tmpscope');
 *
 * WHY, measured 2026-09-27: $TMPDIR held 128,442 entries, 9,325 made in the last
 * 24 hours, almost all test fixtures. tools/run-tests.sh already gives a whole
 * suite run its own temp root (#1151), but a test file run DIRECTLY
 * (`node --test engine/create.test.js`, which agents do constantly while they
 * work) gets none, and every raw `fs.mkdtempSync(path.join(os.tmpdir(), ...))`
 * in it lands in the real temp root and stays. `mkTemp` (./tmpdir.js) fixes one
 * call site at a time; this fixes every call site in the file at once, including
 * the ones written after it.
 *
 * HOW: `os.tmpdir()` reads TMPDIR on every call, so pointing TMPDIR at a
 * per-process directory makes every later mkdtemp in this process land inside
 * it, and so does every child process this one spawns (they inherit the env).
 * One `exit` handler removes the whole directory.
 *
 * ⚠️ WHAT IT DOES NOT COVER:
 *  - macOS `mktemp` (the shell command) IGNORES TMPDIR (measured on 26.7: bare
 *    `mktemp -d` and `mktemp -d -t x` both land in the real temp root). A shell
 *    script this test runs must pass an explicit template to be contained.
 *  - A path computed BEFORE this module runs (another require that already
 *    called os.tmpdir()). That is why it goes first.
 *  - A hard kill (SIGKILL) cannot be caught; one directory is left, named `kts-`,
 *    instead of one per fixture. SIGINT, SIGTERM and SIGHUP are swept when nothing
 *    else in the file listens for them (otherwise the file's handler decides, and
 *    the exit sweep covers a normal end).
 *
 * The name is short on purpose: tmux builds `$TMPDIR/tmux-<uid>/default` and a
 * macOS socket path is capped near 104 characters (see run-tests.sh).
 *
 * It must never throw: a cleanup failure at exit would turn a green run red for a
 * reason that has nothing to do with the code under test.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let scoped = null;

function activate() {
  if (scoped) return scoped;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kts-'));
    scoped = dir;
    process.env.TMPDIR = dir;
    const sweep = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* exiting anyway */ } };
    process.on('exit', sweep);
    /* A signal skips 'exit' handlers, and a runner's timeout or an interrupt is how a
       test file usually ends early. When this is the ONLY listener, sweep and re-raise
       the same signal (now with no listener) so the process dies the normal way. When
       the file has its own handler for that signal, stand aside: that handler decides
       whether the process ends, and sweeping here would leave it running with its
       TMPDIR gone (measured: a later mkdtemp failed ENOENT and the file exited 0). The
       'exit' handler still sweeps when it does end. */
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.once(sig, () => {
        if (process.listenerCount(sig) > 0) return;
        sweep();
        try { process.kill(process.pid, sig); } catch { /* already going */ }
      });
    }
  } catch {
    /* No scope is better than a red test: the file then behaves exactly as before. */
  }
  return scoped;
}

activate();

module.exports = { scopeDir: () => scoped };
