'use strict';
/**
 * kosmos: the Plus devices panel claimed more than Kosmos can know.
 *
 * The off-state read "Plus is off, so nothing can reach this Mac right now."
 * Kosmos knows whether ITS OWN remote reach is on. It knows nothing about SSH,
 * Screen Sharing, or anything else on the machine, so an unscoped sentence in a
 * panel about access reads as a SECURITY statement and is one Kosmos cannot make.
 *
 * ⭐ This is the same class Josh already ruled on once: the pack's "There are
 * none on this computer yet" was killed because it is a claim about the computer
 * rather than about Kosmos, and the first person outside the team to install was
 * told it on a Mac running two of her own agents. That one was a false ABSENCE
 * of agents; this is a false absence of ACCESS, which is the worse of the two,
 * because a person acts on a reassurance about who can reach their machine.
 *
 * 🛑 THE ASSERTION HAS TO NAME WHAT MUST NOT COME BACK, not only what must be
 * there. A rewording that drops "Kosmos" would pass a presence-only test.
 *
 *   node --test web.plus-reach-scope.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('the Plus off-state scopes its claim to Kosmos and reflects #4318 wording', () => {
  const m = PAGE.match(/id="plus-devices-off"[^>]*>([^<]*)</);
  assert.ok(m, 'the plus-devices-off line is still in the page');
  const line = m[1];

  assert.match(line, /Kosmos/,
    'the off-state must name Kosmos, so the claim is about our reach and not the machine');
  assert.match(line, /^Remote access is off/,
    'the off-state must start with Remote access is off (kosmos#4318)');
  assert.match(line, /Shared projects and phone notifications stay connected\./,
    'the off-state must state that shared projects and phone notifications stay connected (kosmos#4318)');
  assert.doesNotMatch(line, /Plus is off/,
    'the misleading master-switch phrase Plus is off must not be used (kosmos#4318)');
  assert.doesNotMatch(line, /nothing can reach this Mac/,
    'the unscoped claim must not come back');
  assert.doesNotMatch(line, /nothing can reach this computer/,
    'nor the same claim after a this-Mac to this-computer rename (kosmos#1004)');
});

test('CONTROL: the assertion can fail, so a green here means something', () => {
  const broken = '<p id="plus-devices-off">Plus is off, so nothing can reach this Mac right now.</p>';
  const line = broken.match(/id="plus-devices-off"[^>]*>([^<]*)</)[1];
  assert.doesNotMatch(line, /Kosmos/, 'the pre-fix sentence really does lack the scope word');
  assert.match(line, /nothing can reach this Mac/, 'and the regex really does catch it');
});

test('CONTROL: kosmos#4318 off-state copy assertions catch the old text', () => {
  const oldText = '<p id="plus-devices-off">Plus is off, so no device can reach Kosmos on this computer right now. Your devices are kept for when you turn it back on.</p>';
  const line = oldText.match(/id="plus-devices-off"[^>]*>([^<]*)</)[1];
  assert.match(line, /Plus is off/);
  assert.doesNotMatch(line, /^Remote access is off/);
  assert.doesNotMatch(line, /Shared projects and phone notifications stay connected\./);
});
