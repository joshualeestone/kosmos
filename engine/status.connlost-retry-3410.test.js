'use strict';

/*
 * #3410: a pane that is RETRYING a network error is mid-turn (working), and only the
 * pane left behind after the retries run out reads connection_lost.
 *
 * The frames below are real captures, not hand-written: Claude Code 2.1.281 in tmux
 * with its API pointed at a closed port (2026-09-24). For 152 seconds the pane showed
 * the "Retrying in Ns · attempt K/10" line; after attempt 10/10 it showed the
 * "⏺ API Error: …" line and the turn footer. Before this fix every retrying frame read
 * connection_lost, so the #3410 self-heal would have restarted an agent mid-retry.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

const PANE = { command: '2.1.281', session: 'probe' };
const RULE = '─'.repeat(60);

const RETRYING = [
  '❯ say hi',
  '✻ Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED) · Retrying in 34s · attempt 9/10',
  RULE,
  '❯',
  RULE,
  '  work · Opus 5.5',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n');

const WEDGED = [
  '❯ say hi',
  '⏺ API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)',
  '✻ Worked for 2m 58s · done 2:01 PM',
  RULE,
  '❯',
  RULE,
  '  work · Opus 5.5',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n');

test('#3410: a pane drawing the live retry line reads WORKING, not connection_lost', () => {
  const r = status.classify(PANE, RETRYING);
  assert.equal(r.state, status.STATE.WORKING);
  assert.match(r.because, /retrying its connection/);
  assert.match(r.evidence, /Retrying in 34s · attempt 9\/10/);
});

test('#3410: every retry attempt number and delay reads WORKING', () => {
  for (const [delay, n] of [[1, 1], [5, 4], [2, 6], [34, 9], [14, 10]]) {
    const pane = RETRYING.replace('Retrying in 34s · attempt 9/10', `Retrying in ${delay}s · attempt ${n}/10`);
    assert.equal(status.classify(PANE, pane).state, status.STATE.WORKING, `attempt ${n}`);
  }
});

test('#3410: the pane left after the retries run out still reads connection_lost', () => {
  const r = status.classify(PANE, WEDGED);
  assert.equal(r.state, status.STATE.CONNECTION_LOST);
  assert.match(r.evidence, /API Error: Connection refused/);
});

test('#3410 control: a retry line quoted in the agent\'s own output is not a live retry', () => {
  // ⏺ prefixes lines the agent writes; it is not a spinner frame, so this must not read WORKING.
  const quoted = WEDGED.replace('⏺ API Error:', '⏺ It said "✻ x · Retrying in 5s · attempt 4/10" then API Error:');
  assert.notEqual(status.classify(PANE, quoted).state, status.STATE.WORKING);
});
