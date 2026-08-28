'use strict';
/**
 * kosmos#1320: a codex agent blocked on a prompt is not "unknown".
 *
 * PigeonPete, answering #1315: every codex agent stops at a CLI update prompt,
 * and `classify()` read that pane as `unknown` -- the same word the board uses
 * for an agent that is merely quiet. Nothing escalated. Nobody was told.
 *
 * 🛑 THE CAUSE WAS NARROWER THAN THE CARD SAID. The whole codex needs-you list
 * was ONE pattern that required the first option to literally say "Yes":
 *
 *     /^\s*›\s*1\.\s*Yes/m
 *
 * So `› 1. Update now` missed. Not "questions only" in the abstract: one
 * captured phrasing, and every other prompt invisible.
 *
 *   node --test engine/status.awaiting-input-1320.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');

/** The real array, lifted and evaluated, never re-typed. */
function markers() {
  const m = SRC.match(/const CODEX_NEEDS_YOU_MARKERS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(m, 'CODEX_NEEDS_YOU_MARKERS is gone');
  // eslint-disable-next-line no-eval
  return eval('[' + m[1] + ']');
}
const hits = (text) => markers().some((re) => re.test(text));

/* Pete's capture, verbatim off a live pane on 2026-08-28. The whole licence for
   widening this list is that it is OBSERVED, not that it is symmetrical: the
   note in status.js asks for "a second observed prompt", and this is it. */
const UPDATE_PROMPT = [
  '› 1. Update now (runs `npm install -g @openai/codex`)',
  '  2. Skip',
  '  3. Skip until next version',
].join('\n');

test('the update prompt is seen, which is the whole card', () => {
  assert.equal(hits(UPDATE_PROMPT), true,
    'a codex agent parked on the update prompt still reports as unknown');
});

test('it is matched by STRUCTURE, not by the word Update', () => {
  /* The class in the card is "prompts that are not questions". A list keyed on
     the word `Update` would fix this instance and leave the next one. */
  const invented = ['› 1. Continue with the migration', '  2. Not now'].join('\n');
  assert.equal(hits(invented), true,
    'a differently-worded two-option prompt is invisible, so this is still a vocabulary list');
});

test('the question-shaped prompt still matches, so nothing was traded away', () => {
  // The original captured shape (#249/#998). A fix that widens one case and
  // drops another is not a fix.
  assert.equal(hits('Do you want to proceed?\n› 1. Yes\n  2. No'), true);
});

/**
 * 🛑 THE FALSE POSITIVE THAT DECIDED THE PATTERN'S SHAPE. Codex draws `›` as its
 * COMPOSER glyph, so a person typing "1. fix the bug" renders `› 1. fix the bug`.
 * A plain option-line pattern would call that a prompt and light the board red
 * for somebody who is simply typing.
 *
 * A real prompt always draws its other choices underneath, unglyphed. That is
 * why this requires a SECOND numbered line and plain OPTION_LINE would not do.
 */
test('a composer holding text that starts with a number is NOT a prompt', () => {
  assert.equal(hits('› 1. fix the bug in the parser'), false,
    'somebody typing a numbered list into the composer now reads as needing you');
  assert.equal(hits('› 1. Update now (runs something)'), false,
    'a single option line with nothing under it is enough, so the composer is at risk');
});

test('the idle composer is untouched', () => {
  assert.equal(hits('› Ask Codex to do anything'), false);
});

/**
 * #1243's lesson, preserved: the anchor and the `m` flag. This is tested
 * against the whole pane tail, so `^` must mean line-start or prose ABOUT a
 * prompt classifies as one. Measured before the anchor existed: a pane carrying
 * the sentence below classified needs_you.
 */
test('prose describing a prompt is still not a prompt', () => {
  assert.equal(hits('The codex marker is the line drawn as › 1. Yes.'), false,
    'the anchor was lost, so a sentence about a prompt reads as a prompt');
  /* ⚠️ MY FIRST VERSION OF THIS CONTROL WAS WRONG AND THE TEST CAUGHT ME. I
     wrote `I will show you › 1. Update now` and expected a match "because the
     option lines are line-initial". They are not: the glyph sits mid-line
     there, so refusing it is exactly right. A control has to be a case that
     genuinely SHOULD match, or its failure teaches you nothing. */
  assert.equal(hits('I will show you:\n› 1. Update now\n  2. Skip'), true,
    'CONTROL: line-initial options SHOULD match, or the pattern is dead');
});

test('every marker keeps the m flag, or the anchor means the wrong thing', () => {
  for (const re of markers()) {
    assert.ok(re.flags.includes('m'), `${re} lost its m flag; ^ now means start-of-text`);
    assert.ok(re.source.startsWith('^'), `${re} is no longer anchored to a line start`);
  }
});
