'use strict';

/**
 * #5209: a resize scales the Kosmos+ star field's dots into the new box without pushing a dot that sits in
 * the 4px wrap margin past the wrap line (which flashed it at the opposite edge for one frame).
 *
 *   node --test web.plus-stars-wrap-5209.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const src = (HTML.match(/\nfunction plusStarScale\(v, o, n\) \{[^\n]*\}\n/) || [])[0];

test('#5209: the instrument is reading the page', () => {
  assert.ok(HTML.length > 100000, 'web/index.html read back only ' + HTML.length + ' bytes');
  assert.ok(src, 'plusStarScale is gone from web/index.html');
});

// eslint-disable-next-line no-new-func
const plusStarScale = src ? new Function(src + '; return plusStarScale;')() : () => NaN;   // a missing helper fails the first test, by name
const WRAP = 4;   // the draw loop wraps at -4 and size + 4

test('#5209: a just-wrapped dot near the top stays inside the wrap band when the field grows (the card\'s case)', () => {
  const y = plusStarScale(-3.7, 698, 1136);
  assert.ok(y >= -WRAP, 'grown to ' + y + ', past the -4 wrap line, so it flashes at the bottom');
  assert.equal(y, -3.7);
});

test('#5209: a dot past the bottom keeps its offset from the bottom edge, growing or shrinking', () => {
  assert.equal(plusStarScale(700, 698, 1136), 1138);
  assert.equal(plusStarScale(1139, 1136, 698), 701);
  for (const [v, o, n] of [[701.9, 698, 1136], [1139.9, 1136, 400]]) {
    assert.ok(plusStarScale(v, o, n) <= n + WRAP, 'a dot past the bottom is pushed past the bottom wrap line');
  }
});

test('#5209: the wrap lines and the box edge themselves never jump', () => {
  assert.equal(plusStarScale(-4, 698, 1136), -4);
  assert.equal(plusStarScale(698 + 4, 698, 1136), 1136 + 4);
  assert.equal(plusStarScale(698, 698, 1136), 1136);   // in-box and past-the-edge rules meet here
});

test('#5209: a dot inside the box scales with it, as before', () => {
  assert.equal(plusStarScale(349, 698, 1396), 698);
  assert.equal(plusStarScale(0, 698, 1136), 0);
  assert.equal(plusStarScale(698, 698, 1136), 1136);
});

test('#5209: plusStarsResize scales every dot through plusStarScale, on both axes', () => {
  const body = HTML.slice(HTML.indexOf('function plusStarsResize() {'), HTML.indexOf('function plusStarsWatch()'));
  assert.match(body, /plusParts\[i\]\.x = plusStarScale\(plusParts\[i\]\.x, ow, plusSW\)/);
  assert.match(body, /plusParts\[i\]\.y = plusStarScale\(plusParts\[i\]\.y, oh, plusSH\)/);
  assert.doesNotMatch(body, /\*= f[xy]/, 'a raw multiply scales the wrap margin too');
});
