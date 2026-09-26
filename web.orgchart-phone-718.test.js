'use strict';

/**
 * #718: the org chart fits a phone (orgFit).
 *
 * The chart was a fixed (maxR + 78) * 2 square, 420px for a small flat fleet,
 * whatever the screen: on a 375px iPhone the whole board scrolled sideways.
 * orgFit sizes it to the width it is given by giving up the room around the
 * outer ring first and then bringing the rings in, never by shrinking the
 * nodes (a smaller face would be under the 44px tap floor).
 *
 *   node --test web.orgchart-phone-718.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function lift(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let depth = 0;
  for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) return SCRIPT.slice(at, k + 1); }
  }
  throw new Error(name + ' has no end');
}
// Read out of the build, never restated here, so a changed constant reaches the test.
const consts = ['ORG_PAD', 'ORG_PAD_MIN', 'ORG_SQUEEZE_MIN'].map((k) => {
  const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
  assert.ok(m, k + ' is no longer declared in the page');
  return [k, Number(m[1])];
});
const C = Object.fromEntries(consts);
// eslint-disable-next-line no-new-func
const orgFit = new Function(consts.map(([k, v]) => `const ${k} = ${v};`).join('\n') + '\n' + lift('orgFit') + '\nreturn orgFit;')();

test('#718: a chart that fits keeps exactly the size it always had (desktop unchanged)', () => {
  for (const maxR of [120, 194, 330]) {
    const natural = Math.round((maxR + C.ORG_PAD) * 2);
    assert.deepEqual(orgFit(maxR, 1400), { size: natural, k: 1 });
    assert.deepEqual(orgFit(maxR, natural), { size: natural, k: 1 }, 'exactly fitting is fitting');
  }
});

test('#718: no width yet (hidden, or not laid out) draws at the natural size', () => {
  assert.deepEqual(orgFit(120, 0), { size: Math.round((120 + C.ORG_PAD) * 2), k: 1 });
  assert.deepEqual(orgFit(120, undefined), { size: Math.round((120 + C.ORG_PAD) * 2), k: 1 });
});

test('#718: on every phone the harness shoots, a small fleet fits the width without moving a ring', () => {
  // 375 / 393 / 412 screens, less the page's side padding: the chart gets roughly 327 to 364px.
  for (const avail of [300, 327, 345, 364]) {
    const f = orgFit(120, avail);
    assert.ok(f.size <= avail, `size ${f.size} > ${avail}`);
    assert.equal(f.k, 1, 'the padding alone was enough; the rings should not move');
    assert.ok(120 + C.ORG_PAD_MIN <= f.size / 2, 'the outer ring sits inside the drag box');
  }
});

test('#718: a deeper fleet brings its rings in, and never below the floor', () => {
  const f = orgFit(180, 327);
  assert.ok(f.k < 1 && f.k >= C.ORG_SQUEEZE_MIN, `k ${f.k}`);
  assert.ok(f.size <= 327, `size ${f.size}`);
  assert.ok(180 * f.k + C.ORG_PAD_MIN <= f.size / 2 + 0.5, 'the squeezed outer ring fits in the box');
  // Too big even at the floor: k stops at the floor and the chart keeps the width it needs
  // (.orgwrap scrolls on its own; the page does not).
  const big = orgFit(600, 327);
  assert.equal(big.k, C.ORG_SQUEEZE_MIN);
  assert.equal(big.size, Math.round((600 * C.ORG_SQUEEZE_MIN + C.ORG_PAD_MIN) * 2));
});

test('#718: paintOrg sizes the chart by orgFit from its own width, and squeezes the rings, not the nodes', () => {
  const paint = SCRIPT.slice(SCRIPT.indexOf('function paintOrg'), SCRIPT.indexOf('function orgLiveStart'));
  assert.match(paint, /const fit = orgFit\(maxR, wrap\.clientWidth\);/);
  assert.match(paint, /spot\.r \*= fit\.k/);
  assert.match(paint, /const size = fit\.size;/);
  assert.doesNotMatch(paint, /const pad = 78/, 'the old fixed square is back');
  assert.doesNotMatch(paint, /scale\(/, 'scaling the drawing shrinks the nodes under the tap floor');
});

test('#718: a width change repaints the chart, and a too-big chart scrolls in its own box', () => {
  assert.match(SCRIPT, /addEventListener\('resize', \(\) => \{\s*const wrap = document\.getElementById\('orgview'\);[\s\S]{0,200}paintOrg\(\);/);
  assert.match(PAGE, /\.orgwrap \{ overflow-x: auto; \}/);
});
