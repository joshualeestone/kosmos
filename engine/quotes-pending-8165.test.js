'use strict';
/**
 * kosmos#8165 review 5: a post still being delivered is in the quote tag's view (so a fast reply quotes as a late one
 * does), but it has no `quotes` of its own yet, so it must never count as an untagged second author of the words it
 * carries: a pending requote would otherwise cancel a true quote that a late reply keeps.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const messages = require('./messages');

const X = 'the signing step on the release branch failed with an expired certificate this morning';
const P = 'proj-8165';
const row = (id, from, text, extra) => Object.assign({ kind: 'post', id, project: P, from, text, at: '2026-11-06T00:00:00.000Z' }, extra || {});

test('kosmos#8165 r5: a pending requote of the words does not cancel a true quote of them', () => {
  const recorded = row('m10', 'mara', X);
  const pendingRequote = row('m11', 'leo', 'as mara said: ' + X, { pending: true });
  const segs = messages.quotedSegments(X + ' -- agreed', 'kim', P, [recorded, pendingRequote]);
  assert.equal(segs.length, 1, JSON.stringify(segs));
  assert.equal(segs[0].of, 'm10');
});

test('kosmos#8165 r5 CONTROL: a recorded, untagged second use of the words still means common speech (no tag)', () => {
  const recorded = row('m10', 'mara', X);
  const independent = row('m11', 'leo', 'as mara said: ' + X);
  assert.deepEqual(messages.quotedSegments(X + ' -- agreed', 'kim', P, [recorded, independent]), []);
});
