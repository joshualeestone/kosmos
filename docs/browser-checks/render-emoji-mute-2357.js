// Browser-check-surface: pj-emoji-btn
'use strict';

/**
 * kosmos#2357 (Josh, 2026-09-06): the composer emoji-picker button is a MUTED GREY smiley,
 * not a prominent bright-yellow one. The glyph (a color-emoji 😀) is desaturated with a
 * paint filter -- CSS `color` cannot touch a color-font glyph, only a filter can -- and
 * modestly recessed, while the button's own hover/focus/expanded affordance backgrounds
 * stay at full strength (the filter is on the GLYPH span, not the button).
 *
 * Asserts, in a real DOM: the glyph carries a `grayscale(...)` filter (the desaturation),
 * that filter is on the glyph and NOT on the button element (so the affordance is
 * unaffected), and the button keeps its accessible name (aria-label). Reading the COMPUTED
 * filter is what proves the mute actually renders, not just that a class exists.
 *
 * CONTROL: the pre-fix page has the emoji as a bare text glyph inside the button with no
 * grayscale filter, so the grayscale assertion reds.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-emoji-mute-2357.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-emoji-mute-2357: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-emoji-mute-2357: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    const btn = document.getElementById('pj-emoji-btn');
    if (!btn) return { error: 'no #pj-emoji-btn on the page' };
    const glyph = btn.querySelector('.emojibtn-glyph');
    // getComputedStyle resolves `filter` even for an element in a hidden pane (it is not
    // layout-dependent), so the composer need not be revealed to read the mute.
    const btnFilter = getComputedStyle(btn).filter;
    return {
      hasGlyphSpan: !!glyph,
      glyphFilter: glyph ? getComputedStyle(glyph).filter : null,
      glyphText: glyph ? (glyph.textContent || '').trim() : (btn.textContent || '').trim(),
      btnFilter,
      ariaLabel: btn.getAttribute('aria-label') || '',
      glyphAriaHidden: glyph ? glyph.getAttribute('aria-hidden') : null,
    };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (!r.error) {
    if (!r.hasGlyphSpan) problems.push('the emoji glyph is not wrapped in a .emojibtn-glyph span (the filter has nothing to key on)');
    if (!/grayscale/i.test(r.glyphFilter || '')) problems.push('the emoji glyph has no grayscale filter (still the bright yellow smiley) -- computed filter: "' + r.glyphFilter + '"');
    // The desaturation must be on the GLYPH, not the button, so the hover/focus affordance
    // background is not itself muted.
    if (/grayscale/i.test(r.btnFilter || '')) problems.push('the grayscale filter is on the .emojibtn button itself, which also mutes its hover/focus affordance background -- it belongs on the glyph span');
    // textContent resolves the &#128512; entity to the rendered emoji, so match the char.
    if (!/😀/.test(r.glyphText)) problems.push('the emoji glyph is missing (expected the grinning-face emoji), got "' + r.glyphText + '"');
    // Accessibility preserved: the button keeps its name and the decorative glyph is hidden.
    if (!/emoji/i.test(r.ariaLabel)) problems.push('the button lost its accessible name (aria-label about adding an emoji), got "' + r.ariaLabel + '"');
    if (r.glyphAriaHidden !== 'true') problems.push('the decorative glyph span should be aria-hidden="true" (the name comes from the button aria-label), got ' + r.glyphAriaHidden);
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-emoji-mute-2357: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-emoji-mute-2357: the composer emoji button glyph is muted with a grayscale filter on the glyph span (not the button), and keeps its accessible name.');
})();