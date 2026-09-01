'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spinnerActive } = require('./agent-activity');

/* #1722 Arm A. The whole point of the card is that a heartbeat's working
 * detection was measurably wrong on the fleet -- it matched the IDLE status
 * footer and scored stopped agents as busy. These cases are red-capable against
 * exactly that regression. */

test('the live spinner elapsed timer reads as WORKING', () => {
  assert.equal(spinnerActive('Flowing… (3m 26s · 1.2k tokens) Press up to edit'), true);
  assert.equal(spinnerActive('Whisking… (12s · 340 tokens)'), true);
  assert.equal(spinnerActive('· Julienning… (2s · esc to interrupt)'), true);
});

test('the IDLE status footer does NOT read as working (the fleet regression)', () => {
  // The exact shape the old `ctx [0-9]+%.*active` matched, scoring a stopped
  // agent as busy on 2026-08-31.
  assert.equal(spinnerActive('  barondraxum · Opus 4.8 · ctx 83%        /rc active'), false);
  assert.equal(spinnerActive('agent1 · Opus 5 · ctx 17%                  /rc'), false);
});

test('a plain prompt or empty pane does not read as working', () => {
  assert.equal(spinnerActive('❯ '), false);
  assert.equal(spinnerActive(''), false);
  assert.equal(spinnerActive('Press up to edit queued messages'), false);
  assert.equal(spinnerActive(null), false);
});

test('the match is NOT anchored on tokens): a spinner without a token count still fires', () => {
  assert.equal(spinnerActive('Ruminating… (5s · high effort)'), true);
});
