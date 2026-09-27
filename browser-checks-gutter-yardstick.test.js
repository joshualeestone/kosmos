'use strict';

/**
 * kosmos#3973: render-boot-no-flash and render-plus-bar-3837 each measure their subject against the
 * ROOT's box with a scratch-scroller probe. The copies live inside page.evaluate() callbacks (one of
 * them races a boot cover that is up for moments), so they are not shared code. Pinned here, as text:
 * the root declaration, the probe, the gutter line and the tolerance expression, each once per file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['render-boot-no-flash.js', 'render-plus-bar-3837.js']
  .map((f) => path.join(__dirname, 'docs', 'browser-checks', f));

// The probe, from its creation to its removal, whitespace-normalised.
function probe(src) {
  const start = src.indexOf("const probe = document.createElement('div');");
  const end = src.indexOf('probe.remove();', start);
  assert.ok(start >= 0 && end > start, 'no scratch-scroller probe found');
  return src.slice(start, end).replace(/\s+/g, ' ').trim();
}

const TOLERANCE = 'Math.abs(root.left) <= 1 && (Math.abs(gutter) <= 1 || Math.abs(gutter - sbw) <= 1)';
const GUTTER = 'const gutter = innerWidth - root.right;';
const ROOT = 'const root = document.documentElement.getBoundingClientRect();';

test('#3973: both checks measure the root yardstick with the same probe and the same tolerance', () => {
  const [a, b] = FILES.map((f) => fs.readFileSync(f, 'utf8'));
  assert.equal(probe(a), probe(b), 'the scratch-scroller probe differs between the two checks');
  for (const [name, src] of [[FILES[0], a], [FILES[1], b]]) {
    assert.equal(src.split(ROOT).length - 1, 1, `${path.basename(name)} should take the root box exactly once`);
    assert.equal(src.split(GUTTER).length - 1, 1, `${path.basename(name)} should compute the gutter exactly once`);
    assert.equal(src.split(TOLERANCE).length - 1, 1, `${path.basename(name)} should apply the root tolerance exactly once`);
  }
});
