'use strict';
/**
 * #4408: while the board restarts itself from the Restart Kosmos button, the full-page "Kosmos requires a
 * full restart" screen (#4343) stands down, the way it does during an update; the board is away on purpose.
 * The observable is BOARD_NO_ANSWER_SINCE: a stand-down clears it, the normal path stamps it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

function sinceAfter(restarting) {
  const src = page.lift(SCRIPT, 'paintRestartScreen');
  return new Function('document', 'location', 'offlineRemoteView', 'UPDATING_NOW', 'WORLDSW_SWITCHING', 'ENGINE_RESTARTING',
    'RESTART_SCREEN_AFTER_MS',
    'let BOARD_NO_ANSWER_SINCE = null;\n' + src + '\npaintRestartScreen(true, false);\nreturn BOARD_NO_ANSWER_SINCE;')(
    { querySelector: () => null }, { protocol: 'http:' }, () => false, false, false, restarting, 1e12);
}

test('#4408: the did-not-answer screen stands down while the board restarts itself', () => {
  assert.equal(sinceAfter(true), null, 'a restart the person asked for was treated as a board that stopped answering');
  assert.equal(typeof sinceAfter(false), 'number', 'CONTROL: without the restart, a board that does not answer starts the clock');
});
