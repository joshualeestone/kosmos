'use strict';

/*
 * kosmos#3605 -- preloaded into EVERY test process by tools/run-tests.sh
 * (`node --test --require ./test-support/launch-guard.js`; node forwards the flag
 * to each file's process). It makes a write into the operator's real
 * ~/Library/LaunchAgents throw, whoever does the writing.
 *
 * Why here and not only in engine/create.js: most tests that need a job file write
 * it THEMSELVES with fs.writeFileSync(create.plistPath(name), ...) (about sixty
 * sites), so a guard inside create.js's writers never sees them. That is exactly
 * how status.codex-observed-2413.test.js leaked five codex* plists (#3011), and a
 * copy of it from an older checkout leaked them again on 2026-09-24, after which
 * launchd loaded all five at the next login.
 *
 * Deliberately standalone (node built-ins only): requiring engine code here would
 * run it before each test file sets its sandbox seams, the freeze-at-require class
 * (#1432). "Real" is the account home from the password database, so a test that
 * points $HOME or AGENT_WORKFORCE_HOME at its sandbox is left alone.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function realLaunchAgentsDir() {
  try { return path.join(os.userInfo().homedir, 'Library', 'LaunchAgents'); } catch { return ''; }
}

const REAL = realLaunchAgentsDir();

function isRealLaunchTarget(target) {
  if (!REAL || target == null || typeof target === 'number') return false;
  let p;
  try { p = path.resolve(String(target instanceof URL ? target.pathname : target)); } catch { return false; }
  return path.dirname(p) === path.resolve(REAL);
}

function refusal(op, target) {
  const msg = `#3605: a test tried to ${op} ${path.basename(String(target))} in the real ${REAL}. ` +
    'Set process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, "LaunchAgents") before the test ' +
    'creates agents or writes a job file.';
  try { process.stderr.write(msg + '\n'); } catch { /* the throw still carries it */ }
  return new Error(msg);
}

// [module, method, index of the DESTINATION argument]
const WRITERS = [
  [fs, 'writeFileSync', 0], [fs, 'appendFileSync', 0], [fs, 'copyFileSync', 1],
  [fs, 'renameSync', 1], [fs, 'symlinkSync', 1], [fs, 'linkSync', 1],
  [fs, 'writeFile', 0], [fs, 'appendFile', 0], [fs, 'copyFile', 1], [fs, 'rename', 1],
  [fs.promises, 'writeFile', 0], [fs.promises, 'appendFile', 0],
  [fs.promises, 'copyFile', 1], [fs.promises, 'rename', 1],
];

function install() {
  if (!REAL || fs.__kosmosLaunchGuard3605) return;
  for (const [mod, name, at] of WRITERS) {
    const orig = mod[name];
    if (typeof orig !== 'function') continue;
    const isPromise = mod === fs.promises;
    mod[name] = function guardedLaunchWrite(...args) {
      if (isRealLaunchTarget(args[at])) {
        const err = refusal(name, args[at]);
        if (isPromise) return Promise.reject(err);
        throw err;
      }
      return orig.apply(this, args);
    };
  }
  Object.defineProperty(fs, '__kosmosLaunchGuard3605', { value: true });
}

install();

module.exports = { isRealLaunchTarget, realLaunchAgentsDir };
