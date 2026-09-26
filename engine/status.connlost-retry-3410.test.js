'use strict';

/*
 * #3410: a pane that is RETRYING a network error is mid-turn (working), and only the
 * pane left behind after the retries run out reads connection_lost.
 *
 * CAPTURED (trimmed from real panes): RETRYING and WEDGED are from Claude Code 2.1.281 in
 * tmux with its API pointed at a closed port (2026-09-24), and the 80-column frame is from the
 * same probe at 80 columns. For 152 seconds the pane showed the "Retrying in Ns · attempt K/10" line;
 * after attempt 10/10 it showed the "⏺ API Error: …" line and the turn footer. Before this
 * fix every retrying frame read connection_lost, so the #3410 self-heal would have
 * restarted an agent mid-retry.
 * COMPOSED (not captured): the other attempt/delay samples, the 529 frame, the #874-layout
 * row (captured under a 401 on #874, placed here over a network error), and every control,
 * each built by editing a captured frame.
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
  assert.match(r.because, /retrying a failed request/);
  assert.match(r.evidence, /Retrying in 34s · attempt 9\/10/);
});

test('#3410: sampled retry attempts and delays read WORKING', () => {
  for (const [delay, n] of [[1, 1], [5, 4], [2, 6], [34, 9], [14, 10]]) {
    const pane = RETRYING.replace('Retrying in 34s · attempt 9/10', `Retrying in ${delay}s · attempt ${n}/10`);
    const r = status.classify(PANE, pane);
    assert.equal(r.state, status.STATE.WORKING, `attempt ${n}`);
    assert.match(r.evidence, new RegExp(`Retrying in ${delay}s · attempt ${n}/10`), 'the sample was actually substituted');
  }
});

test('#3410: the pane left after the retries run out still reads connection_lost', () => {
  const r = status.classify(PANE, WEDGED);
  assert.equal(r.state, status.STATE.CONNECTION_LOST);
  assert.match(r.evidence, /API Error: Connection refused/);
});

test('#3410: on a narrow pane the retry line is truncated, not wrapped, and still reads WORKING', () => {
  // Captured at 80 columns (tmux capture-pane -J, as the board reads it): Claude Code cuts the
  // error text with "…" and keeps the retry suffix on the same row.
  const narrow = RETRYING.replace(
    '✻ Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED) · Retrying in 34s · attempt 9/10',
    '✻ Connection refused — a firewall or proxy ma… · Retrying in 1s · attempt 4/10');
  const r = status.classify(PANE, narrow);
  assert.equal(r.state, status.STATE.WORKING);
  assert.match(r.evidence, /Retrying in 1s · attempt 4\/10/);
});

test('#3410: a non-network retry (529) reads WORKING, with the error in the evidence and no network claim', () => {
  const r = status.classify(PANE, RETRYING.replace(
    'Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED) · Retrying in 34s',
    'API Error (529 Overloaded) · Retrying in 10s'));
  assert.equal(r.state, status.STATE.WORKING);
  assert.match(r.evidence, /529 Overloaded/);
});

test('#3410: #874\'s "└ Retrying in N seconds…" row does NOT make a wedged pane read working (unmeasured layout, not matched)', () => {
  // A stale row of that layout above the real wedged frame must leave it connection_lost:
  // reading working here is a false calm the self-heal would never act on.
  const pane = WEDGED.replace('❯ say hi', '❯ say hi\n  └ Retrying in 30 seconds… (attempt 10/10)');
  assert.equal(status.classify(PANE, pane).state, status.STATE.CONNECTION_LOST);
});

test('#3410 control: an indented ·-led prose row ending in the suffix is not a live retry', () => {
  const prose = WEDGED.replace('⏺ API Error:', '⏺ Notes:\n  · retry note · Retrying in 5s · attempt 4/10\n⏺ API Error:');
  assert.notEqual(status.classify(PANE, prose).state, status.STATE.WORKING);
});

test('#3410 control: a retry line quoted in the agent\'s own output (⏺) is not a live retry', () => {
  const quoted = WEDGED.replace('⏺ API Error:', '⏺ It said "✻ x · Retrying in 5s · attempt 4/10" then API Error:');
  assert.notEqual(status.classify(PANE, quoted).state, status.STATE.WORKING);
});

test('#3410 control: a spinner-glyph quote with text after the suffix is not a live retry (end anchor)', () => {
  const trailing = WEDGED.replace('⏺ API Error:', '✻ x · Retrying in 5s · attempt 4/10 was shown, then\n⏺ API Error:');
  assert.notEqual(status.classify(PANE, trailing).state, status.STATE.WORKING);
});

test('#3410 control: a markdown * bullet ending in the suffix is not a live retry', () => {
  // At column 0, so the glyph class (not the column anchor) is what rejects the `*`.
  const bullet = WEDGED.replace('⏺ API Error:', '⏺ Plan:\n* step one · Retrying in 5s · attempt 1/3\n⏺ API Error:');
  assert.notEqual(status.classify(PANE, bullet).state, status.STATE.WORKING);
});
