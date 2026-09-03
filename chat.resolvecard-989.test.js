'use strict';

/**
 * #989: a name whose case differs from the tmux session must still reach the
 * agent. Josh changed an agent's model, the restart wedged it on the first-run
 * trust prompt, and the recovery route resolved a name whose case differed from
 * the session -- addressable() did a BARE case-sensitive `sessionName === key`
 * and refused "by exactly this name", while the route gate (claimantFor) had
 * ALREADY admitted the same name via store.safeKey. Two derivations of one fact
 * disagreeing. The fix is chat.resolveCard: exact-first, then CASE-FOLD
 * (a.sessionName.toLowerCase() === key.toLowerCase()), preferring the isNamedOurs
 * card. addressable/viewport use it so the send agrees with the gate ON CASE.
 *
 * 🛑 CASE-FOLD, NOT store.safeKey, AND NOT shared with claimantFor. safeKey also
 * STRIPS, and the send path is deliberately STRICTER than the read gate: a name
 * that merely SANITISES to a live agent (`Ca.sey` -> `casey`) must be REFUSED on
 * the send (engine/chat.test.js:181). So the gate stays safeKey-tolerant (keeps
 * an agent reportable under its sanitised name, #18) and the send tolerates case
 * only -- agreeing on case, differing on strip, on purpose. (An earlier cut used
 * safeKey/unified and challenge-loop iter 1 caught it as a BLOCKER; test 6 below
 * is the guard against reintroducing it.)
 *
 * Both dimensions are perturbation-proven: reverting addressable() to the bare
 * `sessionName === key` reds "the fix: a mixed-case name reaches the agent"
 * (Casey -> refused, the reported bug); reintroducing safeKey in resolveCard reds
 * "the send stays STRICTER than the read gate" (Ca.sey would resolve).
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
  assert.match(a.because, /by exactly this name/);
});

test('#989 the isNamedOurs gate is preserved: an exact stranger pane still refuses', () => {
  // exact-first returns the external (not-ours) Casey; addressable's isNamedOurs
  // check must still refuse it rather than typing into a stranger's pane.
  const roster = [card('casey'), card('Casey', { ours: false })];
  const a = chat.addressable('Casey', roster);
  assert.equal(a.ok, false, 'must not type into a stranger-owned exact-named pane');
});

test('#989 resolveCard: exact-first, then CASE-fold preferring ours (not safeKey)', () => {
  const roster = [card('casey', { ours: true }), card('Casey', { ours: false })];
  // exact "Casey" exists (external) -> exact wins outright
  assert.equal(chat.resolveCard(roster, 'Casey').sessionName, 'Casey');
  // no exact "CASEY" -> case-fold matches both -> prefer the isNamedOurs card
  const r = chat.resolveCard(roster, 'CASEY');
  assert.equal(r.sessionName, 'casey');
  assert.equal(r.isNamedOurs, true);
  // no match at all -> null (the control for the resolver itself)
  assert.equal(chat.resolveCard([card('mikey')], 'nobody'), null);
  // a non-array roster -> null (cannot look)
  assert.equal(chat.resolveCard(null, 'casey'), null);
});

test('#989 the send stays STRICTER than the read gate: a sanitise-only name is refused', () => {
  // `Ca.sey` safeKey-sanitises to `casey` (which the ROUTE GATE admits, #18), but
  // the SEND path must REFUSE it -- resolveCard case-folds, it does not strip.
  // Reintroducing strip-tolerance on the send is the hole engine/chat.test.js:181
  // guards ("a spelling that merely sanitises to a live agent is refused"); this
  // is that guard restated at the resolver, and it is the control the CASE arms
  // above cannot give (they never exercise the strip dimension).
  const roster = [card('casey')];
  assert.equal(chat.resolveCard(roster, 'Ca.sey'), null, 'Ca.sey must NOT resolve to casey on the send path');
  const a = chat.addressable('Ca.sey', roster);
  assert.equal(a.ok, false, 'a sanitise-only name must be refused by addressable');
  assert.match(a.because, /by exactly this name/);
});
