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

test('#1277: the poll the board started does not hold the process open', () => {
  /* If this ever goes red, `kosmos start` stops exiting and every suite that
     boots the server hangs at the end instead of failing, which is far harder
     to diagnose than an assertion. */
  const t = update.startAutoPoll({ every: 60 * 60 * 1000 });
  assert.equal(t.hasRef(), false, 'a ref\'d poll would keep the board process alive forever');
});
