'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tick } = require('./heartbeat');

/* #1722. The heartbeat composes the board's already-classified states and asks a
 * check-in question once when an agent LEAVES the working state. These cases pin
 * the two decisions this module actually makes: the edge (ask once, not every
 * tick) and Splinter's correction (a working -> UNREADABLE agent is asked about,
 * never passed over in silence -- Kitty's 70-minute stall). Detection itself is
 * status.js classify()'s job and is not re-tested here. */

const row = (sessionName, state, confidence) => ({ sessionName, state, confidence });

test('working -> stopped asks once, on the edge', () => {
  const t1 = tick([row('a', 'working', 'scraped')], new Map());
  assert.deepEqual(t1.toAsk, []); // still working: nothing to ask
  const t2 = tick([row('a', 'stopped', 'structured')], t1.next);
  assert.equal(t2.toAsk.length, 1);
  assert.equal(t2.toAsk[0].session, 'a');
  assert.equal(t2.toAsk[0].from, 'working');
  assert.equal(t2.toAsk[0].to, 'stopped');
});

test('a still-stopped agent is NOT re-asked (suppression)', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  s = tick([row('a', 'stopped', 'structured')], s).next; // asked here
  const t = tick([row('a', 'stopped', 'structured')], s);
  assert.deepEqual(t.toAsk, []); // was === stopped, not working: no re-ask
});

test('working -> UNREADABLE asks (never fail toward silence -- the Splinter fix)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  // classify() could not read the pane: state unknown at confidence none.
  const t = tick([row('a', 'unknown', 'none')], s);
  assert.equal(t.toAsk.length, 1, 'a working agent gone unreadable must be asked about, not silently carried');
  assert.equal(t.toAsk[0].to, 'unknown');
});

test('working -> idle asks (finished a step, may not have started the next)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a', 'idle', 'scraped')], s);
  assert.equal(t.toAsk.length, 1);
  assert.equal(t.toAsk[0].to, 'idle');
});

test('working -> needs_you does NOT ask (the person\'s own path)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a', 'needs_you', 'scraped')], s);
  assert.deepEqual(t.toAsk, []);
});

test('an agent already idle at first sighting is not asked about (no working frame to leave)', () => {
  const t = tick([row('a', 'idle', 'scraped')], new Map());
  assert.deepEqual(t.toAsk, []);
});

test('a fresh stall after resuming asks again', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  s = tick([row('a', 'idle', 'scraped')], s).next;    // asked
  s = tick([row('a', 'working', 'scraped')], s).next; // back to work: episode over
  const t = tick([row('a', 'idle', 'scraped')], s);   // stalls again
  assert.equal(t.toAsk.length, 1, 'a new working->stall episode is a new question');
});

test('a missing state field is treated as unreadable, and asked about from working', () => {
  const s = tick([{ sessionName: 'a', state: 'working', confidence: 'scraped' }], new Map()).next;
  const t = tick([{ sessionName: 'a' }], s); // no state at all
  assert.equal(t.toAsk.length, 1);
  assert.equal(t.toAsk[0].to, 'unknown');
});

test('rows with no session name are skipped without throwing', () => {
  const t = tick([{ state: 'stopped' }, null, row('a', 'working', 'scraped')], new Map());
  assert.deepEqual(t.toAsk, []);
  assert.equal(t.next.get('a'), 'working');
});
