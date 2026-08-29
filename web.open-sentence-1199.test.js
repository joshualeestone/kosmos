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
 * EIGHT DOWN TO FOUR (#1283). This started as "what this card does not fix",
 * pinned at eight so a ninth could not arrive quietly. Five of those eight were
 * straight stop-dressing copies and now call `asSentence`; the doubled-full-stop
 * defect they carried is gone with them. Measured before: 5 of the engine's 363
 * `because` strings already end in a stop, so an unconditional `+ '.'` rendered
 * "..".
 *
 * ⚠️ THE FOUR THAT REMAIN ARE NOT THE SAME THING AS EACH OTHER, which is why the
 * number stops at four rather than zero. Converting them is a behaviour change,
 * not a refactor, and each wants its own decision:
 *
 *   the definition of `asSentence` itself      counted by this regex, and is the
 *                                              thing every other site delegates to
 *   a capitalise-only site, no stop at all     adding one changes what renders
 *   `+ '. '`, WITH A TRAILING SPACE            something downstream may concatenate
 *                                              onto it; a behaviour until proven not
 *   a `' ' + ...` leading-space form           same question at the other end
 *
 * The bound stays `<=` on purpose: lowering it is the fix and must keep passing,
 * raising it must fail.
 */
test('the other inline capitalizers are known, counted, and not growing', () => {
  const inline = PAGE.match(/charAt\(0\)\.toUpperCase\(\) \+ /g) || [];
  assert.ok(inline.length <= 4,
    `inline sentence-dressing copies went up to ${inline.length}; use asSentence instead`);
});

/* The five converted sites, pinned by NAME rather than by count, because a count
   cannot tell you WHICH one regressed. Each of these delegated an inline copy to
   the shared dresser in #1283; a revert of any one of them fails here with its
   own name rather than as an off-by-one in the number above. */
test('#1283: the five converted sites go through the shared dresser', () => {
  for (const [what, pattern] of [
    ['the agent why-line', /why\.textContent = asSentence\(reason\);/],
    ['the session sentence', /const sentence = asSentence\(why\);/],
    ['pjSentence', /return asSentence\(said\);/],
    ['the connection status line', /: asSentence\(because\);/],
    ['placedWords', /return asSentence\(note\);/],
  ]) {
    assert.match(PAGE, pattern, `${what} kept or regrew its own copy of the sentence rule`);
  }
});
