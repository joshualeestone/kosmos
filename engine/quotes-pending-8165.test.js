'use strict';
/**
 * kosmos#8165 review 5/6: a post still being delivered is in the quote tag's view (so a fast reply quotes as a late
 * one does). Its copy carries the quote tags its row will carry, computed when it is minted, so it is judged exactly as
 * a recorded row: a tagged requote does not cancel a true quote, an untagged second use of the words still does (#460:
 * ambiguity resolves to no styling). An earlier version excused every pending row, which tagged in the unsafe direction.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const messages = require('./messages');

const X = 'the signing step on the release branch failed with an expired certificate this morning';
const P = 'proj-8165';
const row = (id, from, text, extra) => Object.assign({ kind: 'post', id, project: P, from, text, at: '2026-11-06T00:00:00.000Z' }, extra || {});

test('kosmos#8165 r6: a pending requote that is tagged as quoting the origin does not cancel a true quote', () => {
  const recorded = row('m10', 'mara', X);
  const requote = row('m11', 'leo', 'as mara said: ' + X, { pending: true, quotes: [{ of: 'm10', from: 'mara', start: 14, end: 14 + X.length }] });
  const segs = messages.quotedSegments(X + ' -- agreed', 'kim', P, [recorded, requote]);
  assert.equal(segs.length, 1, JSON.stringify(segs));
  assert.equal(segs[0].of, 'm10');
});

test('kosmos#8165 r6: a pending, untagged second use of the words means common speech, as a recorded one does (no tag)', () => {
  const recorded = row('m10', 'mara', X);
  assert.deepEqual(messages.quotedSegments(X + ' -- agreed', 'kim', P, [recorded, row('m11', 'leo', 'as mara said: ' + X, { pending: true })]), []);
  assert.deepEqual(messages.quotedSegments(X + ' -- agreed', 'kim', P, [recorded, row('m11', 'leo', 'as mara said: ' + X)]), [], 'CONTROL: recorded, the same');
});
