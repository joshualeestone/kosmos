'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tick } = require('./heartbeat');

/* #1722. The heartbeat composes the board's already-classified states and asks a
 * check-in QUESTION when an agent is in an open stall. These cases pin the three
 * decisions this module makes: the edge (an episode opens on working -> stall),
 * Splinter's silence fix (working -> UNREADABLE is asked about, not passed over
 * -- Kitty's 70-minute stall), and the delivery contract (an UNCONFIRMED ask
 * must not burn the slot: an open stall keeps being asked until the runner marks
 * `asked` on confirmed delivery). Detection is status.js classify()'s job and is
 * not re-tested here. */

const row = (sessionName, state, confidence) => ({ sessionName, state, confidence });

test('working -> stopped opens an episode and asks', () => {
  const t1 = tick([row('a', 'working', 'scraped')], new Map());
  assert.deepEqual(t1.toAsk, []);
  const t2 = tick([row('a', 'stopped', 'structured')], t1.next);
  assert.equal(t2.toAsk.length, 1);
  assert.equal(t2.toAsk[0].session, 'a');
  assert.equal(t2.toAsk[0].from, 'working');
  assert.equal(t2.toAsk[0].to, 'stopped');
});

test('an UNCONFIRMED ask does NOT burn the slot: a still-stopped agent is re-asked', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t2 = tick([row('a', 'stopped', 'structured')], s); // asked, delivery unconfirmed
  assert.equal(t2.toAsk.length, 1);
  // The runner did NOT confirm delivery, so `asked` stays false in t2.next.
  const t3 = tick([row('a', 'stopped', 'structured')], t2.next);
  assert.equal(t3.toAsk.length, 1, 'unconfirmed => re-ask, never leave it sitting stopped un-asked');
});

test('a CONFIRMED-delivered ask suppresses re-asks within the episode', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t2 = tick([row('a', 'stopped', 'structured')], s);
  assert.equal(t2.toAsk.length, 1);
  // The runner confirms delivery: it sets asked=true on the record it carries.
  t2.next.get('a').asked = true;
  const t3 = tick([row('a', 'stopped', 'structured')], t2.next);
  assert.deepEqual(t3.toAsk, [], 'a confirmed ask holds until the agent resumes');
});

test('working -> UNREADABLE asks (never fail toward silence -- the Splinter fix, Kitty 70 min)', () => {
  const s = tick([row('a', 'working', 'scraped')], new Map()).next;
  const t = tick([row('a', 'unknown', 'none')], s); // classify could not read the pane
  assert.equal(t.toAsk.length, 1, 'a working agent gone unreadable must be asked about');
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

test('an agent already idle at first sighting is never asked about (no working frame to leave)', () => {
  let s = tick([row('a', 'idle', 'scraped')], new Map());
  assert.deepEqual(s.toAsk, []);
  // and it stays quiet on subsequent ticks -- it never opened an episode.
  const t = tick([row('a', 'idle', 'scraped')], s.next);
  assert.deepEqual(t.toAsk, []);
});

test('resuming closes the episode; a fresh stall opens a new one and asks again', () => {
  let s = tick([row('a', 'working', 'scraped')], new Map()).next;
  s = tick([row('a', 'idle', 'scraped')], s).next;    // asked (episode 1)
  s = tick([row('a', 'working', 'scraped')], s).next; // back to work: episode closed
  const t = tick([row('a', 'idle', 'scraped')], s);   // stalls again: episode 2
  assert.equal(t.toAsk.length, 1, 'a new working->stall episode is a new question');
});

test('a missing state field is treated as unreadable and asked about from working', () => {
  const s = tick([{ sessionName: 'a', state: 'working', confidence: 'scraped' }], new Map()).next;
  const t = tick([{ sessionName: 'a' }], s);
  assert.equal(t.toAsk.length, 1);
  assert.equal(t.toAsk[0].to, 'unknown');
});

test('rows with no session name are skipped without throwing', () => {
  const t = tick([{ state: 'stopped' }, null, row('a', 'working', 'scraped')], new Map());
  assert.deepEqual(t.toAsk, []);
  assert.equal(t.next.get('a').prev, 'working');
});
