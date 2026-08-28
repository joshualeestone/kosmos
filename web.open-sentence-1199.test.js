'use strict';
/**
 * kosmos#1199, the launch half, page side.
 *
 * The engine now says WHICH failure it was ("nothing on this computer opens
 * .pptx files yet, and the file itself is fine"). This pins that the page
 * dresses that sentence the way it already dresses every other engine sentence,
 * because it did not: the documents panel capitalized its own FALLBACK and
 * showed the engine's real sentence raw, so the better answer looked worse.
 *
 * ⚠️ THE FUNCTION IS EXTRACTED AND RUN, not matched. A regex over the page can
 * assert that `asSentence` is mentioned and learn nothing about what it does,
 * which is how a suite passes over an identifier that is never called.
 *
 *   node --test web.open-sentence-1199.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

function asSentence() {
  const m = PAGE.match(/function asSentence\(s\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'asSentence is gone from the page');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function asSentence', 'function') + ')');
}

test('an engine sentence is capitalized and given one full stop', () => {
  const f = asSentence();
  assert.equal(f('nothing on this computer opens .pptx files yet, and the file itself is fine'),
    'Nothing on this computer opens .pptx files yet, and the file itself is fine.');
  assert.equal(f('that file lives outside this project, so we will not open it'),
    'That file lives outside this project, so we will not open it.');
});

test('it does not double a stop the engine already wrote, or add one after a question', () => {
  const f = asSentence();
  assert.equal(f('that file did not open.'), 'That file did not open.');
  assert.equal(f('did that file move?'), 'Did that file move?');
  assert.ok(!f('that file did not open.').includes('..'), 'no doubled full stop');
});

test('nothing in, nothing out, so the fallback survives', () => {
  // ⚠️ THE ARM THAT KEEPS THE HANDLERS CORRECT. Both call sites read
  // `asSentence(json.error) || because`, so an empty return is what lets the
  // dressed fallback stand. If this returned "." the person would see a lone
  // full stop instead of a sentence.
  const f = asSentence();
  for (const bad of ['', '   ', null, undefined, 0, {}]) assert.equal(f(bad), '');
});

test('both open-file handlers dress the engine sentence, not just one', () => {
  // The documents list and the thread's file chips are two call sites of one
  // route. The first version of this fix changed one of them, and the panel
  // Josh was looking at was the other.
  const dressed = PAGE.match(/because = asSentence\(\(await res\.json\(\)\)\.error\) \|\| because;/g) || [];
  assert.equal(dressed.length, 2, 'both handlers dress the reason');
  const raw = PAGE.match(/because = \(await res\.json\(\)\)\.error \|\| because;/g) || [];
  assert.equal(raw.length, 0, 'no handler shows the engine sentence undressed');
});

test('conflictNote delegates rather than keeping its own copy', () => {
  const f = asSentence();
  assert.equal(f('its screen shows a question its reports do not mention'),
    'Its screen shows a question its reports do not mention.');
  // The body, not the whole page: conflictNote had this inline and must not
  // regrow it. Scoped to the function so the assertion says what it means.
  const m = PAGE.match(/function conflictNote\(a\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'conflictNote is gone');
  assert.ok(m[0].includes('asSentence'), 'conflictNote goes through the shared dressing');
  assert.ok(!m[0].includes('toUpperCase'), 'conflictNote keeps no copy of the casing rule');
});

/**
 * ⚠️ WHAT THIS CARD DOES NOT FIX, asserted so the number cannot quietly grow.
 *
 * The page has EIGHT inline copies of "dress an engine sentence" and they do
 * three different things: guard the full stop, append one unconditionally, or
 * add none. Measured: 5 of the engine's 363 `because` strings already end in a
 * stop, so an unconditional `+ '.'` can render "..". That is a real defect and
 * it is carded separately, because converting all eight touches surfaces this
 * change has no business moving.
 *
 * This pins the count so the next person meets the finding instead of adding
 * a ninth. Lowering it is the fix; raising it should fail.
 */
test('the other inline capitalizers are known, counted, and not growing', () => {
  const inline = PAGE.match(/charAt\(0\)\.toUpperCase\(\) \+ /g) || [];
  assert.ok(inline.length <= 8,
    `inline sentence-dressing copies went up to ${inline.length}; use asSentence instead`);
});
