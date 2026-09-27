'use strict';
/**
 * #3939: Meta's Muse Code as a Kosmos runner, first slice: is it on this computer, and which version.
 * Nothing here signs in, starts a session or writes anything.
 *
 * Measured on the Mortals Mac (2026-09-26, card #3939): Meta's installer puts a launcher at
 * ~/.local/bin/muse, and `muse --version` prints "Muse Code 1.4.0 (1.4.0-R4161.1)" and writes nothing.
 * (`muse exec`, not used here, creates a register in the REAL ~/Library/Application Support/Muse
 * whatever HOME says: so this module never overrides HOME, and later slices must not rely on it.)
 *
 * The version read runs the binary, so it goes through the live-execution gate (CLAUDE.md
 * convention 3) and has a timeout; an answer that does not look like Muse Code is "unknown",
 * never a guessed version.
 */
const { execFile } = require('node:child_process');
const runners = require('./runners');

/* `muse --version` answers at once; this long means something is wrong with the binary. */
const VERSION_TIMEOUT_MS = 10000;
/* "Muse Code 1.4.0 (1.4.0-R4161.1)": the product name, the version, and the build in brackets. */
const VERSION_RE = /^Muse Code (\d+\.\d+\.\d+)(?: \(([^)\s]+)\))?\s*$/m;

/** { installed, bin, because }: cheap (a file check), safe on every render. */
function installed() {
  const r = runners.resolveBin('muse');
  return { installed: !!(r && r.present), bin: r ? r.bin : null, because: r && r.because ? r.because : null };
}

/** The version from `muse --version`'s text, or null when it is not Muse Code's line. */
function parseVersion(text) {
  const m = VERSION_RE.exec(String(text || ''));
  return m ? { version: m[1], build: m[2] || null } : null;
}

let runVersion = (bin, done) => {
  const gate = require('./live-execution');
  if (!gate.liveExecutionAllowed()) { gate.refuseOrWarn('musestatus', bin, ['--version']); done(new Error('live execution is off')); return; }
  execFile(bin, ['--version'], { timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout) => done(err, stdout));
};

/** Promise of { installed, version, build, because }: never rejects. */
function version() {
  return new Promise((resolve) => {
    const inst = installed();
    if (!inst.installed) { resolve({ installed: false, version: null, build: null, because: inst.because || 'Muse Code is not on this computer' }); return; }
    try {
      runVersion(inst.bin, (err, out) => {
        const v = err ? null : parseVersion(out);
        resolve(v ? { installed: true, version: v.version, build: v.build, because: null }
          : { installed: true, version: null, build: null, because: 'Kosmos could not read which Muse Code this is' });
      });
    } catch {
      resolve({ installed: true, version: null, build: null, because: 'Kosmos could not read which Muse Code this is' });
    }
  });
}

const REAL = { runVersion };
function setRunnerForTests(fn) { runVersion = fn; }
function resetForTests() { runVersion = REAL.runVersion; }

module.exports = { installed, version, parseVersion, VERSION_TIMEOUT_MS, setRunnerForTests, resetForTests };
