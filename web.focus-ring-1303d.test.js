'use strict';
/**
 * kosmos#1303 D, then REVERSED by Josh 0.6.47 (item 6.01.26): the text
 * composer no longer paints a dark focus stroke when you click into it.
 *
 * History, because this file's intent inverted and the reasoning matters:
 *   - #1303 D softened a DOUBLED near-black outline (border colour change + a 1px
 *     ring of the same colour) down to one border change + a soft halo, and a
 *     note in web/index.html insisted the ring was "SOFTENED, NOT DELETED"
 *     because a colour change alone asks somebody to remember the resting border.
 *   - Josh raised it AGAIN in his 0.6.47 live test -- "the black inner stroke
 *     when you click into a text box" -- so the softening was not enough. Mona
 *     ruled (a): for the TEXT COMPOSER specifically, drop the dark focus border;
 *     the blinking caret is the "box is on" signal.
 *
 * 🛑 WHY DROPPING THE RING STILL MEETS WCAG AA. The #1303 D note's own argument
 * was that a focus signal must be a change of SHAPE that needs no comparison to
 * the resting state. The caret is exactly that -- a visible text cursor is an
 * accepted focus indicator under WCAG 2.4.7 Focus Visible (Level AA) for a text
 * field. So the accessibility property the ring provided is met by the caret,
 * not lost. The stronger 2.4.13 Focus Appearance (area/contrast) is Level AAA,
 * not AA, so a thin caret is a tradeoff below our AA floor, not a failure of it.
 * This test therefore pins: no dark focus stroke, AND the caret is not hidden.
 *
 * 📌 COMPLEMENTARY, NOT REDUNDANT, with docs/browser-checks/render-composer-reset.js.
 * These source-string guards catch a re-add written the #1303 D way; the browser-check
 * reads the focused composer's COMPUTED style, so it also catches a re-add spelled
 * differently (grouped selector, different spacing) as long as it lands near-black. Keep
 * both.
 *
 *   node --test web.focus-ring-1303d.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const rule = (needle) => {
  const n = PAGE.split(needle).length - 1;
  assert.equal(n, 1, `the anchor ${needle} matches ${n} places`);
  return PAGE.slice(PAGE.indexOf(needle), PAGE.indexOf('}', PAGE.indexOf(needle)) + 1);
};

test('the dark focus stroke is gone: focus does not repaint the composer border near-black', () => {
  /* The regression this catches is a re-added `.composerbox:focus-within` that
     paints the near-black `--k-ink-2` border back on -- exactly the "black inner
     stroke" Josh asked to remove. Its ABSENCE passes (the rule was deleted); its
     RETURN in that colour fails. Written against the near-black colour, not
     against the selector existing, so a future soft non-dark focus treatment is
     not forbidden -- only the dark stroke Josh named is. */
  assert.doesNotMatch(PAGE, /\.composerbox:focus-within\s*\{[^}]*border-color:\s*var\(--k-ink-2\)/,
    'the near-black composer focus border is back -- Josh 0.6.47 asked for it removed');
  assert.doesNotMatch(PAGE, /\.composerbox:focus-within\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(74, 79, 87/,
    'the composer focus ring/halo is back -- Josh 0.6.47 asked for it removed');
});

test('the caret is the focus signal, so it must not be hidden on the composer inputs', () => {
  /* With the ring gone the caret IS the visible focus indicator (WCAG 2.4.7 AA).
     A `caret-color: transparent` on `.cinput` would leave the text box with no
     focus signal at all, which is the one way this change could become an AA
     regression. Guard it. */
  assert.doesNotMatch(PAGE, /\.cinput[^{]*\{[^}]*caret-color:\s*transparent/,
    'the composer caret is hidden, so a focused text box shows no focus at all');
});

test('the resting border is untouched, because it always matched', () => {
  // Unchanged from #1303 D: 1px --k-rule in both themes. That half of the item
  // was never broken, and dropping the focus stroke leaves it as the border the
  // box shows at rest AND on focus.
  assert.match(rule('.composerbox { display: flex'), /border: 1px solid var\(--k-rule\)/);
});
