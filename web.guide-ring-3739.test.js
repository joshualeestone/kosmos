'use strict';
/**
 * #3739 (Josh, 0.6.94: the guide "renders with no context ring"): before its first session the setup guide's own
 * page draws the empty memory ring (the track, nothing filled). Any other agent with no reading still draws
 * nothing, which is #1915's rule for an unknown reading.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const detailRing = new Function(page.liftConst(SCRIPT, 'NEARLY_FULL') + '\n' + page.liftConst(SCRIPT, 'WARM') + '\n'
  + page.liftAll(SCRIPT, ['pctOf', 'memBand', 'detailRing']) + '\nreturn detailRing;')();

test('#3739: the guide with no reading gets the empty ring, an ordinary agent gets none', () => {
  const guide = detailRing({ isGuide: true, context: null });
  assert.match(guide, /<circle class="gt"/, 'the guide with no reading drew no ring');
  assert.doesNotMatch(guide, /class="gf/, 'the empty ring filled something it has no reading for');
  assert.equal(detailRing({ context: null }), '', 'CONTROL: an ordinary agent with no reading drew a ring');
  assert.equal(detailRing({ isGuide: false, context: { percent: null } }), '', 'CONTROL: nor with an unreadable percent');
});

test('#3739: once the guide has a reading, its ring is the ordinary filled one', () => {
  const read = detailRing({ isGuide: true, context: { percent: 40 } });
  assert.match(read, /class="gf /, 'a guide with a reading drew only the empty track');
  assert.equal(read, detailRing({ context: { percent: 40 } }), 'the guide and an ordinary agent differ at the same reading');
});
