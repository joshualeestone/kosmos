'use strict';

/**
 * #989: a name whose case differs from the tmux session must still reach the
 * agent. Josh changed an agent's model, the restart wedged it on the first-run
 * trust prompt, and the recovery route resolved a name whose case differed from
 * the session -- addressable() did a BARE case-sensitive `sessionName === key`
 * and refused "by exactly this name", while the route gate (claimantFor) had
 * ALREADY admitted the same name via store.safeKey. Two derivations of one fact
 * disagreeing. The fix is chat.resolveCard: exact-first, then store.safeKey,
 * preferring the isNamedOurs card -- the same algorithm claimantFor uses, now
 * shared, so addressable/viewport and the route gate agree.
 *
 * These arms are perturbation-proven: a revert of addressable() to the bare
 * `roster.find(a => a.sessionName === key)` reds "the fix: a mixed-case name
 * reaches the agent" (Casey -> refused), which is exactly the reported bug.
 */
const test = require('node:test');
const assert = require('node:assert');
const chat = require('./engine/chat');

const card = (sessionName, opts = {}) => ({
  sessionName,
  isNamedOurs: opts.ours !== false,
  isAgentPane: opts.pane !== false,
  isAgentSession: true,
  target: sessionName + ':0.0',
});

test('#989 the fix: a mixed-case name reaches the agent (Casey -> casey)', () => {
  const roster = [card('casey'), card('mikey')];
  const a = chat.addressable('Casey', roster);
  assert.equal(a.ok, true, `Casey should reach casey, got: ${a.because}`);
  assert.equal(a.card.sessionName, 'casey');
});

test('#989 no regression: an exact name still resolves exactly', () => {
  const roster = [card('casey'), card('mikey')];
  const a = chat.addressable('casey', roster);
  assert.equal(a.ok, true);
  assert.equal(a.card.sessionName, 'casey');
});

test('#989 control: a genuinely-absent name is still refused (not a blanket yes)', () => {
  const roster = [card('casey')];
  const a = chat.addressable('nobody', roster);
  assert.equal(a.ok, false);
  assert.match(a.because, /by this name/);
});

test('#989 the isNamedOurs gate is preserved: an exact stranger pane still refuses', () => {
  // exact-first returns the external (not-ours) Casey; addressable's isNamedOurs
  // check must still refuse it rather than typing into a stranger's pane.
  const roster = [card('casey'), card('Casey', { ours: false })];
  const a = chat.addressable('Casey', roster);
  assert.equal(a.ok, false, 'must not type into a stranger-owned exact-named pane');
});

test('#989 resolveCard mirrors claimantFor: exact-first, then safeKey preferring ours', () => {
  const roster = [card('casey', { ours: true }), card('Casey', { ours: false })];
  // exact "Casey" exists (external) -> exact wins outright
  assert.equal(chat.resolveCard(roster, 'Casey').sessionName, 'Casey');
  // no exact "CASEY" -> safeKey matches both -> prefer the isNamedOurs card
  const r = chat.resolveCard(roster, 'CASEY');
  assert.equal(r.sessionName, 'casey');
  assert.equal(r.isNamedOurs, true);
  // no match at all -> null (the control for the resolver itself)
  assert.equal(chat.resolveCard([card('mikey')], 'nobody'), null);
  // a non-array roster -> null (cannot look)
  assert.equal(chat.resolveCard(null, 'casey'), null);
});
