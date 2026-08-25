"use strict";
/**
 * Josh, #chaoskosmos-design (paraphrased across earlier feedback, confirmed
 * 2026-08-25 17:58 when asked directly which shape he wanted): below the
 * consolidated view's 1280px design width, the two side rails should now
 * auto-fold to icon-only first, buying the centre and right columns room,
 * rather than the view snapping straight back to the tab view. Only below a
 * lower floor (960px) does it actually fall back to tabs. His answer to the
 * proposal: "thats perfect, lets try that."
 *
 * web.layout-picker.test.js pins the width constants and the CSS/JS gate
 * shape; this file pins the auto-fold LOGIC in railFoldsApply() -- the part
 * that decides whether a rail renders folded from three inputs (an explicit
 * stored '1', an explicit stored '0', or the width) rather than the old
 * two (stored '1', or absent-meaning-open).
 *
 *   node --test web.consolidated-breakpoint.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const FN = SCRIPT.slice(SCRIPT.indexOf('function railFoldsApply('), SCRIPT.indexOf('function railFoldsApply(') + 1400);

test('railFoldsApply computes "narrow" from the fold width, not the min width -- the two are different thresholds', () => {
  assert.match(FN, /const narrow = layoutConsolidated\(\) && window\.innerWidth < CONSOLIDATED_FOLD_WIDTH;/,
    'the auto-fold condition is gone, reads the wrong width, or no longer requires the view to actually be consolidated first');
});

test('an explicit stored preference always wins over the width, in both directions', () => {
  assert.match(FN, /const on = stored === '1' \? true : stored === '0' \? false : narrow;/,
    'a rail with an explicit "stay open" (\'0\') or "stay folded" (\'1\') no longer overrides the width-driven default');
});

test('a click always writes an explicit value now, never removes the key', () => {
  const click = SCRIPT.slice(SCRIPT.indexOf("document.querySelectorAll('[data-fold]')"), SCRIPT.indexOf("document.querySelectorAll('[data-fold]')") + 600);
  assert.match(click, /sessionStorage\.setItem\('rail-fold-' \+ k, on \? '1' : '0'\)/,
    'the click handler still removes the key on "open" instead of writing an explicit \'0\' -- an untouched rail would stop reacting to width at all once clicked once');
  assert.doesNotMatch(click, /sessionStorage\.removeItem/, 'the click handler still clears the stored preference instead of pinning it explicitly');
});

test('resizing within the still-consolidated range re-reads the fold state, not just the tabs-vs-consolidated boundary', () => {
  const resize = SCRIPT.slice(SCRIPT.indexOf("window.addEventListener('resize'"), SCRIPT.indexOf("window.addEventListener('resize'") + 500);
  assert.match(resize, /else if \(document\.body\.classList\.contains\('consolidated'\)\) railFoldsApply\(\);/,
    'crossing the fold width without crossing the min width no longer re-applies the fold state, so resizing inside 960-1280 would leave the rails stuck at whatever they rendered on load');
});

test('the two thresholds are named constants, not two different magic numbers that could drift apart', () => {
  assert.match(SCRIPT, /const CONSOLIDATED_MIN_WIDTH = 960;/);
  assert.match(SCRIPT, /const CONSOLIDATED_FOLD_WIDTH = 1280;/);
  assert.ok(SCRIPT.indexOf('const CONSOLIDATED_MIN_WIDTH') < SCRIPT.indexOf('function layoutConsolidated'),
    'the constants are declared after their first use');
});
