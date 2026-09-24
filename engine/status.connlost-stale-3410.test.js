'use strict';

/*
 * #3410 PR 2b: connection_lost only while nothing newer follows the error line.
 * CAPTURED (trimmed): Claude Code 2.1.281 in tmux, API pointed at a closed port until it gave up,
 * then a local proxy to the real API was started and one message was typed (2026-09-24). The
 * agent answered ("⏺ PINEAPPLE"), yet on main the pane still read connection_lost because the old
 * error line stayed on screen, so an auto-recovery sweep would have nudged a recovered agent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

const PANE = { command: '2.1.281', session: 'probe' };
const RULE = '─'.repeat(60);
const ERR = '⏺ API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)';
const CHROME = [RULE, '❯ ', RULE, '  work · Opus 5.5', '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'];

const WEDGED = ['❯ reply with exactly the word PINEAPPLE', ERR, '✻ Cogitated for 3m 6s · done 5:17 PM', ...CHROME].join('\n');
const RECOVERED = ['❯ reply with exactly the word PINEAPPLE', ERR, '✻ Cogitated for 3m 6s · done 5:17 PM', RULE,
  '❯ Your connection to the API is back. Please retry what you were doing.', '⏺ PINEAPPLE',
  '✻ Worked for 2s · done 5:18 PM', ...CHROME].join('\n');

test('#3410: a wedged pane (error, footer, empty prompt) reads connection_lost', () => {
  const r = status.classify(PANE, WEDGED);
  assert.equal(r.state, status.STATE.CONNECTION_LOST);
  assert.match(r.evidence, /ECONNREFUSED/);
});

test('#3410: a recovered pane whose old error line is still on screen does NOT read connection_lost', () => {
  assert.notEqual(status.classify(PANE, RECOVERED).state, status.STATE.CONNECTION_LOST);
});

test('#3410: a prompt showing placeholder text still reads connection_lost (prompt rows are not agent output)', () => {
  const pane = WEDGED.replace('❯ \n', '❯ Try "fix lint errors"\n');
  assert.equal(status.classify(PANE, pane).state, status.STATE.CONNECTION_LOST);
});

test('#3410: a second error after a recovered turn reads connection_lost again (the LAST error counts)', () => {
  const again = RECOVERED.replace('✻ Worked for 2s · done 5:18 PM', '✻ Worked for 2s · done 5:18 PM\n' + ERR);
  assert.equal(status.classify(PANE, again).state, status.STATE.CONNECTION_LOST);
});

test('#3410: the agent quoting the error words in its own prose is NOT connection_lost', () => {
  // Found in review: only Claude Code's own "API Error:" row counts, or a healthy agent that
  // writes about a firewall would read connection_lost and be nudged.
  const pane = ['⏺ It said the request failed because a firewall or proxy may be blocking it, so I stopped.',
    '✻ Worked for 12s · done 5:20 PM', ...CHROME].join('\n');
  assert.notEqual(status.classify(PANE, pane).state, status.STATE.CONNECTION_LOST);
});
