'use strict';
require('../test-support/tmpscope');
/* kosmos#5942: the card's waitingSince comes from the self-report's askedAt (#5943), and only a real time is kept. */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

test('kosmos#5942 waitingSinceFrom: a real askedAt is kept; missing, garbage and future are null', () => {
  const now = Date.parse('2026-10-12T16:00:00Z');
  assert.equal(status.waitingSinceFrom({ found: true, askedAt: '2026-10-01T10:00:00Z' }, now), '2026-10-01T10:00:00.000Z');
  assert.equal(status.waitingSinceFrom({ found: true }, now), null, 'no askedAt (before #5943, or not waiting)');
  assert.equal(status.waitingSinceFrom({ found: true, askedAt: 'last week' }, now), null);
  assert.equal(status.waitingSinceFrom({ found: true, askedAt: '2026-10-13T10:00:00Z' }, now), null, 'a time ahead of the clock is not a wait');
  assert.equal(status.waitingSinceFrom({ found: false, askedAt: '2026-10-01T10:00:00Z' }, now), null, 'no report');
  assert.equal(status.waitingSinceFrom(null, now), null);
});
