'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sweepOnce, handoffPathFor } = require('./autohandoff-sweep');
const autohandoff = require('./autohandoff'); // Mona's committed decision core, consumed not modified
const { DELIVERY } = require('./chat');

/* #1724 integration. The sweep composes Mona's autohandoff.shouldPrompt over the
 * board's per-agent context fill and injects a handoff prompt when an agent
 * crosses a fill band -- and, per Splinter's measured finding, advances the band
 * ONLY on a confirmed (PLACED) delivery, so an inject that never submitted is
 * retried rather than silencing the agent. The fill % is the variable under
 * test, so the rows are synthetic (shorthand, not a hand-built card): the real
 * board emits exactly this `context.percent` (status.js readContext). */

const agentAt = (sessionName, percent) => ({ sessionName, context: { percent } });
const bare = (sessionName) => ({ sessionName }); // an agent the board could not read context for
const pathFor = (k) => '/handoffs/' + k + '.md';

// A deliver stub returning a fixed verdict, recording its calls.
function scriptedDeliver(state) {
  const calls = [];
  return { calls, fn: (session, text) => { calls.push({ session, text }); return { state }; } };
}

const ON = { enabled: true, threshold: 85 };

test('an agent over threshold gets the handoff prompt; one under threshold does not', () => {
  const d = scriptedDeliver(DELIVERY.PLACED);
  const { prompted } = sweepOnce({
    setting: ON, roster: [agentAt('over', 92), agentAt('under', 50)],
    lastBand: new Map(), deliver: d.fn, pathFor, autohandoff, DELIVERY,
  });
  assert.equal(prompted.length, 1);
  assert.equal(prompted[0].session, 'over');
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].session, 'over');
  assert.match(d.calls[0].text, /context window is 92% full/i, 'the prompt names the fill');
  assert.match(d.calls[0].text, /\/handoffs\/over\.md/, 'the prompt names the agent path');
});

test('disabled: nobody is prompted, whatever their fill', () => {
  const d = scriptedDeliver(DELIVERY.PLACED);
  const { prompted } = sweepOnce({
    setting: { enabled: false, threshold: 85 }, roster: [agentAt('over', 99)],
    lastBand: new Map(), deliver: d.fn, pathFor, autohandoff, DELIVERY,
  });
  assert.deepEqual(prompted, []);
  assert.equal(d.calls.length, 0);
});

test('a second sweep at the same band does not re-prompt (once per band)', () => {
  const d = scriptedDeliver(DELIVERY.PLACED);
  const bands = new Map();
  sweepOnce({ setting: ON, roster: [agentAt('a', 86)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY });
  const second = sweepOnce({ setting: ON, roster: [agentAt('a', 86)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY });
  assert.deepEqual(second.prompted, [], 'a steady 86% is prompted once, not every sweep');
  assert.equal(d.calls.length, 1);
});

test('a climb into a NEW band re-prompts', () => {
  const d = scriptedDeliver(DELIVERY.PLACED);
  const bands = new Map();
  sweepOnce({ setting: ON, roster: [agentAt('a', 86)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY }); // band 85
  const climbed = sweepOnce({ setting: ON, roster: [agentAt('a', 91)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY }); // band 90
  assert.equal(climbed.prompted.length, 1, 'crossing into a higher band prompts again');
  assert.equal(d.calls.length, 2);
});

test('🛑 an UNCONFIRMED inject does NOT advance the band: the next sweep retries', () => {
  const d = scriptedDeliver(DELIVERY.UNCONFIRMED);
  const bands = new Map();
  const first = sweepOnce({ setting: ON, roster: [agentAt('a', 92)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY });
  assert.equal(first.prompted[0].advanced, false, 'unconfirmed did not advance the band');
  assert.equal(bands.has('a'), false, 'the band was not burned');
  const second = sweepOnce({ setting: ON, roster: [agentAt('a', 92)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY });
  assert.equal(second.prompted.length, 1, 'still stalled + unconfirmed => retried, never left silent');
  assert.equal(d.calls.length, 2);
});

test('a COULD_NOT delivery also leaves the band for retry', () => {
  const d = scriptedDeliver(DELIVERY.COULD_NOT);
  const bands = new Map();
  sweepOnce({ setting: ON, roster: [agentAt('a', 92)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY });
  assert.equal(bands.has('a'), false, 'a failed delivery did not advance the band');
});

test('fill dropping below threshold clears the band, so a fresh climb re-prompts', () => {
  const d = scriptedDeliver(DELIVERY.PLACED);
  const bands = new Map();
  sweepOnce({ setting: ON, roster: [agentAt('a', 92)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY }); // prompted, band 90
  assert.equal(bands.get('a'), 90);
  sweepOnce({ setting: ON, roster: [agentAt('a', 40)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY }); // reset
  assert.equal(bands.has('a'), false, 'a reset clears the stale high-water band');
  const climbed = sweepOnce({ setting: ON, roster: [agentAt('a', 92)], lastBand: bands, deliver: d.fn, pathFor, autohandoff, DELIVERY });
  assert.equal(climbed.prompted.length, 1, 'the fresh climb is prompted again, not suppressed');
});

test('an unreadable fill (null percent) is skipped without prompting or throwing', () => {
  const d = scriptedDeliver(DELIVERY.PLACED);
  const { prompted } = sweepOnce({
    setting: ON, roster: [agentAt('a', null), bare('b')],
    lastBand: new Map(), deliver: d.fn, pathFor, autohandoff, DELIVERY,
  });
  assert.deepEqual(prompted, []);
  assert.equal(d.calls.length, 0);
});

// #1724 integration seam: the server wiring builds the handoff path with this
// exact exported function (server.js), not an inline lambda. The first inline
// version called store.root() -- which does not exist; store exposes ROOT, a
// string -- so it threw on every sweep and the interval's best-effort catch
// swallowed it, leaving the consume half dead on arrival with a fully green
// suite. This drives the REAL function against the REAL store, so that class of
// typo fails here instead of silently in production.
test('handoffPathFor resolves through store.ROOT to a string path (guards the store.root() seam)', () => {
  const store = require('./store');
  const p = handoffPathFor(store, 'Some Agent 42');
  assert.equal(typeof p, 'string', 'the handoff path must be a string, not a thrown TypeError');
  assert.match(p, /[/\\]handoffs[/\\][^/\\]+\.md$/, 'it lands under handoffs/ as a .md file');
});
