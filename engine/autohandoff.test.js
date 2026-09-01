'use strict';

/**
 * #1724 auto-handoff decision core. The load-bearing behaviour: it fires when an
 * agent crosses the threshold, re-fires as it climbs, does NOT spam at a steady
 * level, and stays silent when disabled or below the line.
 *
 *   node --test engine/autohandoff.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const ah = require('./autohandoff');

test('shouldPrompt fires at/over the threshold and stays silent below it', () => {
  const T = 85;
  assert.equal(ah.shouldPrompt(true, T, 84.9, null), false, 'below threshold: no');
  assert.equal(ah.shouldPrompt(true, T, 85, null), true, 'at threshold, first time: yes');
  assert.equal(ah.shouldPrompt(true, T, 92, null), true, 'over threshold, first time: yes');
});

test('shouldPrompt respects the enabled flag', () => {
  assert.equal(ah.shouldPrompt(false, 85, 99, null), false, 'disabled: never');
});

test('shouldPrompt de-dups within a band but re-fires as it climbs', () => {
  const T = 85;
  // first crossing at 86 -> band 85 -> prompt, record band 85
  assert.equal(ah.shouldPrompt(true, T, 86, null), true);
  // still 88, same band 85 -> no re-prompt
  assert.equal(ah.shouldPrompt(true, T, 88, 85), false, 'same band: no spam');
  // climbs to 91 -> band 90 > 85 -> re-prompt
  assert.equal(ah.shouldPrompt(true, T, 91, 85), true, 'higher band: re-fire');
  // pegged at 100 -> band 100 > 90 -> one prompt at the wall
  assert.equal(ah.shouldPrompt(true, T, 100, 90), true, 'the wall: one more');
  assert.equal(ah.shouldPrompt(true, T, 100, 100), false, 'still pegged: no spam');
});

test('shouldPrompt refuses a non-numeric fill (a status read that failed)', () => {
  assert.equal(ah.shouldPrompt(true, 85, null, null), false);
  assert.equal(ah.shouldPrompt(true, 85, NaN, null), false);
  assert.equal(ah.shouldPrompt(true, 85, undefined, null), false);
});

test('fillBand groups into 5-point bands with 100 its own', () => {
  assert.equal(ah.fillBand(85), 85);
  assert.equal(ah.fillBand(89), 85);
  assert.equal(ah.fillBand(90), 90);
  assert.equal(ah.fillBand(99), 95);
  assert.equal(ah.fillBand(100), 100);
  assert.equal(ah.fillBand(150), 100, 'over-100 (a wrong denominator) still bands to the wall');
});

test('settingFrom defaults to off/85 for an unwritten store and normalises a bad threshold', () => {
  assert.deepEqual(ah.settingFrom({}), { enabled: false, threshold: 85 }, 'opt-in default is off');
  assert.deepEqual(ah.settingFrom(undefined), { enabled: false, threshold: 85 });
  assert.deepEqual(ah.settingFrom({ autohandoff: { enabled: true, threshold: 90 } }), { enabled: true, threshold: 90 });
  assert.deepEqual(ah.settingFrom({ autohandoff: { enabled: true, threshold: 42 } }), { enabled: true, threshold: 85 }, 'bad threshold falls to default');
});

test('validSetting accepts a well-formed patch and refuses garbage', () => {
  assert.equal(ah.validSetting({ enabled: true, threshold: 85 }), true);
  assert.equal(ah.validSetting({ enabled: false, threshold: 95 }), true);
  assert.equal(ah.validSetting({ enabled: 'yes', threshold: 85 }), false, 'enabled must be a real boolean');
  assert.equal(ah.validSetting({ enabled: true, threshold: 42 }), false, 'threshold must be an offered option');
  assert.equal(ah.validSetting({ enabled: true }), false, 'missing threshold');
  assert.equal(ah.validSetting(null), false);
});

test('handoffPrompt names the path, the fill, and the required contents', () => {
  const p = ah.handoffPrompt(92, '/data/handoffs/angel.md');
  assert.match(p, /92% full/);
  assert.match(p, /\/data\/handoffs\/angel\.md/);
  assert.match(p, /branch and sha/);
  assert.match(p, /verified, versus merely claimed/);
  assert.match(p, /ordered next steps/);
  assert.match(p, /not into a message/, 'the path-not-message rule is in the prompt');
  // no em dash in the user/agent-facing prompt (all 5 spellings)
  assert.doesNotMatch(p, /\u2014/, 'no em dash char in the prompt');
});
