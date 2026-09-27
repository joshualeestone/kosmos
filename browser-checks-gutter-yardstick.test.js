'use strict';

/**
 * kosmos#3973: render-boot-no-flash, render-plus-bar-3837 and (#4213) render-tasks-view-3559 each
 * measure their subject against the ROOT's box, and (#4213) the root's own stable-gutter width. The copies live inside
 * page.evaluate() callbacks (one of them races a boot cover that is up for moments), so they are not
 * shared code. Pinned here, as text: the root declaration, the probe, the gutter line and the
 * tolerance expression, each once per file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['render-boot-no-flash.js', 'render-plus-bar-3837.js', 'render-tasks-view-3559.js']
  .map((f) => path.join(__dirname, 'docs', 'browser-checks', f));

// The root's gutter measurement, from saving the root's style to the finally that restores it,
// whitespace-normalised.
function probe(src) {
  const start = src.indexOf('const rs = document.documentElement.style,');
  const end = src.indexOf('scrollTo(sx, sy); }', start);
  assert.ok(start >= 0 && end > start, 'no root gutter measurement found');
  return src.slice(start, end).replace(/\s+/g, ' ').trim();
}

const TOLERANCE = 'Math.abs(root.left) <= 1 && (Math.abs(gutter) <= 1 || Math.abs(gutter - sbw) <= 1)';
const GUTTER = 'const gutter = innerWidth - root.right;';
const ROOT = 'const root = document.documentElement.getBoundingClientRect();';

test('#3973: every check that measures the root yardstick uses the same probe and the same tolerance', () => {
  const srcs = FILES.map((f) => fs.readFileSync(f, 'utf8'));
  for (let i = 1; i < srcs.length; i += 1) {
    const name = path.basename(FILES[i]);
    assert.equal(probe(srcs[i]), probe(srcs[0]), `the root gutter measurement in ${name} differs from the first file's`);
  }
  for (const [name, src] of FILES.map((f, i) => [f, srcs[i]])) {
    assert.equal(src.split(ROOT).length - 1, 1, `${path.basename(name)} should take the root box exactly once`);
    assert.equal(src.split(GUTTER).length - 1, 1, `${path.basename(name)} should compute the gutter exactly once`);
    assert.equal(src.split(TOLERANCE).length - 1, 1, `${path.basename(name)} should apply the root tolerance exactly once`);
    // #4213: a scratch scroller reads 0 on the runner, which hides element scrollbars.
    assert.doesNotMatch(src, /overflow:scroll/, `${path.basename(name)} measures a scratch scroller again`);
    // The root box is read before its style is changed, and restored in a finally.
    assert.ok(src.indexOf(ROOT) < src.indexOf('const rs = document.documentElement.style,'), `${path.basename(name)} reads the root after changing it`);
    assert.match(src, /\} finally \{ \[rs\.scrollbarGutter, rs\.overflow\] = was; scrollTo\(sx, sy\); \}/, `${path.basename(name)} does not restore the root in a finally`);
  }
});

test('#4213: render-tasks-view-3559 reads its right edge from the root and asserts the yardstick', () => {
  // The pin above guards the copied text; this guards its use, which a revert to clientWidth would undo.
  const src = fs.readFileSync(FILES[2], 'utf8');
  assert.match(src, /w: Math\.floor\(root\.right\)/, 'the right edge is no longer the root box');
  assert.doesNotMatch(src, /w: document\.documentElement\.clientWidth/, 'the right edge went back to clientWidth');
  assert.match(src, /chk\(geo\.rootOk,/, 'the yardstick is measured but never asserted');
});
