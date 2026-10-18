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
 *  - A process this file started that makes the directory again AFTER this one has ended
 *    (#6362): the sweep has already run, so the leak guard can only list what it holds.
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
const { removeAtEnd } = require('./remove-at-end');

let scoped = null;

function activate() {
  if (scoped) return scoped;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kts-'));
    scoped = dir;
    process.env.TMPDIR = dir;
    /* #6061: name the test file that owns this directory. A kill this module cannot catch leaves the directory
       behind, and the suite's leak guard (tools/lib/test-leak-guard.sh) reads this file to say which test was
       killed; without it a `kts-` leak names only a random suffix, from any of some two hundred files. */
    let ownerLine = null;
    try {
      /* Real paths on both sides: macOS gives the cwd as /private/var/... and the script as /var/..., and a relative
         path between those is a climb to the root. A script outside the cwd keeps its absolute path, with the home
         folder written as ~ so a user name does not reach a log someone pastes into a card. A symlinked test file
         is named by its target. */
      const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
      let script = `(no script, ${path.basename(process.argv0)})`;
      if (process.argv[1]) {
        const abs = real(process.argv[1]);
        let cwd = null;
        try { cwd = real(process.cwd()); } catch { /* a deleted cwd: name the file by its absolute path below */ }
        const rel = cwd ? path.relative(cwd, abs) : '';
        const home = real(os.homedir());
        script = rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ? rel
          : (home && abs.startsWith(home + path.sep) ? '~' + abs.slice(home.length) : abs);
      }
      ownerLine = `${script}\tpid ${process.pid}`;
      fs.writeFileSync(path.join(dir, '.kts-owner'), ownerLine + '\n');
    } catch { /* the directory still works without its owner line */ }
    /* At exit, and on SIGINT/SIGTERM/SIGHUP (./remove-at-end.js). When the file has its
       own handler for the signal, that handler decides whether the process ends, and the
       sweep waits for the exit: sweeping first would leave it running with its TMPDIR
       gone (measured: a later mkdtemp failed ENOENT and the file exited 0). */
    removeAtEnd(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* checked below */ }
      /* #6362: still here means the sweep failed part way (a process this file started was still
         writing into it, or something in it could not be removed), and it may already have taken
         .kts-owner (that depends on the order it met the entries). Put the owner back, marked,
         so the leak guard names this file. (A process that makes the folder again AFTER this one
         has ended cannot be caught here; the guard lists what such a folder holds instead.) */
      try {
        if (ownerLine && fs.existsSync(dir)) {
          // Written aside and renamed in, so a kill mid-write never leaves an empty owner where a good one was.
          const tmp = path.join(dir, '.kts-owner.new');
          fs.writeFileSync(tmp, ownerLine + '\tsurvived its sweep\n');
          fs.renameSync(tmp, path.join(dir, '.kts-owner'));
        }
      } catch { /* the leak is still reported, without its owner */ }
    });
  } catch {
    /* No scope is better than a red test: the file then behaves exactly as before. */
  }
  return scoped;
}

activate();

module.exports = { scopeDir: () => scoped };
