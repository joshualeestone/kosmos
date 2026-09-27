'use strict';
/* The 0.7.03 design walk (Mona Lisa, 2026-09-27): three small fixes found on the served build, pinned here.
 *   node --test web.walk-0705.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test("What's New: an odd last tile spans both columns, so five highlights leave no empty cell", () => {
  assert.match(PAGE, /\.wn-tiles:not\(\.one\) > \.wn-tile:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
});

test('the Gemini subscription row does not repeat "Google subscription" when its title already says it', () => {
  const m = PAGE.match(/'<span class="acct-tag"> ' \+ \(a\.email \? '([^']+)' : '([^']+)'\)/);
  assert.ok(m, 'the tag moved');
  assert.equal(m[2], 'Through Antigravity on this computer');
  assert.doesNotMatch(m[2], /Google subscription/);
  assert.match(m[1], /^Google subscription, through Antigravity on this computer$/, 'with an email the tag keeps saying which subscription');
});

test('Token Usage: "1 place ... that holds", "2 places ... that hold"', () => {
  const m = PAGE.match(/'Counted from ' \+ roots \+ \(roots === 1 \? '([^']+)' : '([^']+)'\) \+ ' transcripts\./);
  assert.ok(m, 'the sentence moved');
  const say = (roots) => 'Counted from ' + roots + (roots === 1 ? m[1] : m[2]) + ' transcripts.';
  assert.equal(say(1), 'Counted from 1 place on this computer that holds transcripts.');
  assert.equal(say(3), 'Counted from 3 places on this computer that hold transcripts.');
});
