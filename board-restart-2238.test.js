'use strict';

/**
 * #2238: pin the board-restart launchd LABEL derivation.
 *
 * The /api/board/restart endpoint restarts the installed board so it boots into
 * the newly-active world. It targets a launchd label derived the SAME way
 * install/setup.sh does (~1284). If that derivation drifts from setup.sh, the
 * endpoint targets a non-existent job: it degrades SAFELY (the launchctl-print
 * probe fails, so it never kills the board and returns "reopen Kosmos yourself"),
 * but the auto-restart silently never works and only a live install test would
 * notice. So the derivation is pinned HERE, directly, rather than only through a
 * live restart that cannot be run on the shared box (com.kosmos.board is loaded
 * there -- a live hit would restart the real review board).
 *
 *   node --test board-restart-2238.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert');
const { test } = require('node:test');

// Sandbox the stores BEFORE requiring the server (it reads roots at module load).
// boardRestartLabel itself is pure over its ARG, but requiring server.js must be safe.
const SB = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-brestart-'));
process.env.AGENT_WORKFORCE_DATA = SB;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-brestart-w-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-brestart-c-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SB, 'claude.json');
// server.js refuses a HALF sandbox (#634): sandbox every root or none.
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-brestart-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-brestart-proj-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const { boardRestartLabel } = require('./server.js');

test('#2238: default KOSMOS_HOME derives the bare com.kosmos.board label', () => {
  const label = boardRestartLabel({ HOME: '/Users/casey' });
  assert.equal(label, 'com.kosmos.board');
});

test('#2238: default is recognized even with redundant slashes (matches setup.sh tr -s / and trailing-slash strip)', () => {
  // setup.sh normalizes both HOME-derived default and KOSMOS_HOME the same way, so
  // an explicit KOSMOS_HOME equal to the default (modulo slashes) is still the bare label.
  const label = boardRestartLabel({ HOME: '/Users/casey', KOSMOS_HOME: '/Users/casey//.local/share/kosmos/' });
  assert.equal(label, 'com.kosmos.board');
});

test('#2238: a non-default KOSMOS_HOME derives the hashed label matching setup.sh', () => {
  const kh = '/Volumes/Big/kosmos-home';
  const want = 'com.kosmos.board.' + crypto.createHash('sha256').update(kh).digest('hex').slice(0, 8);
  assert.equal(boardRestartLabel({ HOME: '/Users/casey', KOSMOS_HOME: kh }), want);
});

test('#2238: the hashed label uses the NORMALIZED path (trailing slash / doubled slashes do not change the hash)', () => {
  const canonical = '/Volumes/Big/kosmos-home';
  const messy = '/Volumes/Big//kosmos-home/';
  assert.equal(
    boardRestartLabel({ HOME: '/Users/casey', KOSMOS_HOME: messy }),
    boardRestartLabel({ HOME: '/Users/casey', KOSMOS_HOME: canonical }),
    'a switch after an install and a switch typed by hand must target the SAME launchd job',
  );
});
