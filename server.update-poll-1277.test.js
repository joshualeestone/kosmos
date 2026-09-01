'use strict';
/* #1277: THE WIRING, not the mechanism.
 *
 * engine/update.test.js proves the poll works when something starts it. This
 * file proves SOMETHING STARTS IT, which is a different claim and the one the
 * card is actually about. #1277 was never a broken function: `poke()` was
 * correct and well tested, and had exactly one caller in the whole product,
 * the status route. A board nobody looked at therefore never checked for a
 * release and never installed one, with its own preference reading on.
 *
 * 🛑 SO A GUARD THAT ONLY DRIVES `startAutoPoll()` DIRECTLY WOULD REPRODUCE
 * THE DEFECT IT IS GUARDING. Delete the one call in server.js and every arm
 * in engine/update.test.js stays green while the bug returns in full.
 * Measured before this file existed: removing that line broke nothing.
 *
 * This boots the real server and asks whether the poll is running, which is
 * the only question that distinguishes "the machinery exists" from "the
 * machinery is driven".
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-update-poll-1277-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* Long, so the boot never actually reaches the release host during the suite.
   This test asks whether the poll is RUNNING, never what it fetched. */
process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = String(60 * 60 * 1000);

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const update = require('./engine/update');

test.before(async () => { await start(0); });
test.after(() => {
  update.stopAutoPoll();
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('#1277: booting the board starts the updater poll, so a machine nobody watches still updates', () => {
  assert.equal(update.autoPollRunning(), true,
    'the board booted without starting the update poll: poke() is back to having one caller, '
    + 'the status route, and a headless machine will sit frozen at its installed version');
});

test('#1277: startAutoPoll unrefs its timer, so a poll cannot hold the process open', () => {
  /* If this ever goes red, `kosmos start` stops exiting and every suite that
     boots the server hangs at the end instead of failing, which is far harder
     to diagnose than an assertion.

     🛑 SCOPE, STATED BECAUSE THE OLD NAME OVERCLAIMED. This drives
     startAutoPoll DIRECTLY, so it proves the MECHANISM unrefs. It does NOT
     inspect the timer the board started at boot: this call replaces that timer
     with a fresh one and asserts on the new object, so a `start()` that wired a
     ref'd poll by some other route would leave this green. That is the same
     wiring-versus-mechanism distinction this file's header is built on, and
     this arm is on the mechanism side of it.

     Closing it needs an accessor for the live timer, and I did not add one:
     an export only tests can reach is what the repo's engine.reachable guard
     catches, and it caught exactly that on this branch one iteration ago.
     I also tried observing it without an accessor, via
     process._getActiveHandles(); measured, that returns 0 Timeouts even for a
     deliberately ref'd interval, so the probe cannot tell the two apart and
     would have been a check that always passes. Recorded as a known gap rather
     than covered by an instrument that cannot fail. */
  const t = update.startAutoPoll({ every: 60 * 60 * 1000 });
  assert.equal(t.hasRef(), false, 'a ref\'d poll would keep the board process alive forever');
  update.stopAutoPoll();
});

test('#1277: every test file that boots the server sets DRY_RUN, so none can reach the release host', () => {
  /* The poll's fetch gate is a CONVENTION across sixteen files and nothing
     enforced it. All sixteen set it today, so the exposure is closed, but the
     next file somebody writes inherits nothing. The failure it prevents is not
     a red test: it is a test run that reaches installkosmos.com and, from an
     installed layout, spawns a real curl-pipe-sh installer. */
  const fs = require('node:fs'); const path = require('node:path');
  const dir = path.resolve(__dirname);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'));
  const boots = files.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return /require\((['"])\.\/server\1\)/.test(src) && /\bstart\s*\(/.test(src);
  });
  assert.ok(boots.length >= 10,
    `only ${boots.length} files looked like they boot the server; the detector is probably wrong, `
    + 'and a detector that finds nothing would make this arm pass for the wrong reason');
  const missing = boots.filter((f) => !/AGENT_WORKFORCE_DRY_RUN/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(missing, [],
    `these files boot the server without setting AGENT_WORKFORCE_DRY_RUN: ${missing.join(', ')}. `
    + 'Booting the server starts the update poll, and without the gate that poll uses the real '
    + 'fetch against the real release host.');
});
