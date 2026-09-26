'use strict';

/**
 * #718: the board may only draw under the status bar if the frame pads itself
 * clear of it in the same change.
 *
 * The iOS shell (#3688) found the board drawn UNDER the status bar when the
 * page had not opted in, so the shell now leaves WebKit's default insets alone.
 * The page keeps its half of that bargain here: while the viewport meta has no
 * `viewport-fit=cover`, WebKit keeps the page clear of the notch and home bar
 * and there is nothing to check. The moment it has cover, the frame (`body` or
 * `.apphead`) must pad by all four `--safe-*` variables, or this goes red.
 *
 * ⚠️ THE META TAG, NOT THE FILE. The CSS comment beside the variables says
 * "viewport-fit=cover" in prose, so a whole-file search would call the page
 * opted in today. Only the viewport meta's content decides.
 * ⚠️ COMMENTS ARE STRIPPED before the rules are read, for the same reason: the
 * comment shows `var(--safe-bottom)` as an example and must not count as a
 * frame that pads.
 * ⚠️ WEAKEST PART: "the frame" is `body` or a `.apphead` rule (not a descendant of
 * either). Padding that lands on some other wrapper is correct and would read red
 * here; widen FRAME rather than delete the test. A padding value it does not know
 * (a calc() around the inset, say) also reads red; widen INSET for that.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SIDES = ['top', 'right', 'bottom', 'left'];
// The frame itself: `body` or `.apphead`, optionally narrowed (`body.consolidated`,
// `.apphead:hover`), never a descendant (`.apphead .burger` pads a child, not the frame).
const FRAME = /^(body|\.apphead)([.:#\[][^\s>+~]*)?$/;
// A side's inset as a padding value: the variable, with or without a fallback
// (`var(--safe-bottom, 0px)` is the house form), or the raw env() it stands for.
const INSET = (side) => `(var\\(--safe-${side}(\\s*,[^)]*)?\\)|env\\(safe-area-inset-${side}[^)]*\\))`;
const STRIP = /var\(--safe-(top|right|bottom|left)(\s*,[^)]*)?\)|env\(safe-area-inset-(top|right|bottom|left)[^)]*\)/g;

function viewportContent(page) {
  const m = page.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
  return m ? m[1] : null;
}

function frameRules(page) {
  const css = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (sels.some((s) => FRAME.test(s))) out.push(m[2]);
  }
  return out;
}

// Which insets the frame fails to pad. Empty means the page is safe.
function unpaddedSides(page) {
  const vp = viewportContent(page);
  if (vp === null) return ['no viewport meta'];
  if (!/viewport-fit\s*=\s*cover/i.test(vp)) return [];
  const decls = frameRules(page).join(';');
  return SIDES.filter((side) => !new RegExp(
    `padding(-${side})?\\s*:[^;]*${INSET(side)}`).test(decls));
}

test('the four inset variables exist and read the real inset', () => {
  for (const side of SIDES) {
    assert.match(PAGE, new RegExp(`--safe-${side}: env\\(safe-area-inset-${side}, 0px\\)`),
      `--safe-${side} is the name Scorpion's composer and the frame share`);
  }
});

test('the page as shipped is safe: no cover, or cover with the frame padded', () => {
  assert.notEqual(viewportContent(PAGE), null, 'the viewport meta moved; update viewportContent');
  assert.deepEqual(unpaddedSides(PAGE), []);
});

test('control: cover without frame padding goes red, on all four sides', () => {
  const opted = PAGE.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)"/, '$1$2, viewport-fit=cover"');
  assert.notEqual(opted, PAGE, 'the control did not inject cover');
  /* Only red if the shipped page has no frame padding yet. Once someone ships
     the padding this arm would go green for the right reason, so strip it
     first and keep the control aimed at the arm under test. */
  const bare = opted.replace(STRIP, '0px');
  assert.deepEqual(unpaddedSides(bare), SIDES);
});

test('control: cover WITH frame padding goes green, and one missing side is named', () => {
  const opted = PAGE.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)"/, '$1$2, viewport-fit=cover"');
  const padded = opted.replace('</style>',
    'body { padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); }\n</style>');
  assert.deepEqual(unpaddedSides(padded), []);
  const longhand = opted.replace('</style>',
    '.apphead { padding-top: var(--safe-top); }\nbody { padding-left: var(--safe-left); padding-right: var(--safe-right); }\n</style>');
  assert.deepEqual(unpaddedSides(longhand), ['bottom']);
});

test('control: padding that only appears in a comment or off the frame does not count', () => {
  const opted = PAGE.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)"/, '$1$2, viewport-fit=cover"');
  const bare = opted.replace(STRIP, '0px');
  const fake = bare.replace('</style>',
    '/* body { padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); } */\n'
    + '.cinput { padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); }\n</style>');
  assert.deepEqual(unpaddedSides(fake), SIDES);
});

test('control: the house fallback form and raw env() count; a descendant of the frame does not; Cover in any case', () => {
  const opted = PAGE.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)"/, '$1$2, viewport-fit=cover"');
  const bare = opted.replace(STRIP, '0px');
  const fallback = bare.replace('</style>',
    'body { padding: var(--safe-top, 0px) var(--safe-right,0px) env(safe-area-inset-bottom) var(--safe-left , 0px); }\n</style>');
  assert.deepEqual(unpaddedSides(fallback), []);
  const child = bare.replace('</style>',
    '.apphead .burger { padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); }\n</style>');
  assert.deepEqual(unpaddedSides(child), SIDES);
  const upper = PAGE.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)"/, '$1$2, viewport-fit=Cover"').replace(STRIP, '0px');
  assert.deepEqual(unpaddedSides(upper), SIDES);
});
