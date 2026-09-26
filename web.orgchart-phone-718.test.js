'use strict';

/**
 * #718: the org chart fits a phone (orgFit).
 *
 * The chart was a fixed (maxR + 78) * 2 square, 396px for a small flat fleet of five,
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
const orgFit = new Function(consts.map(([k, v]) => `const ${k} = ${v};`).join('\n') + '\n' + lift('orgNatural') + '\n' + lift('orgFit') + '\nreturn orgFit;')();

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
  for (const avail of [327, 345, 364]) {
    const f = orgFit(120, avail);
    assert.ok(f.size <= avail, `size ${f.size} > ${avail}`);
    assert.equal(f.k, 1, 'the padding alone was enough; the rings should not move');
    assert.ok(120 + C.ORG_PAD_MIN <= f.size / 2, 'the outer ring sits inside the drag box');
  }
  // A 320px phone (about 300px for the chart): the margin keeps each outer face's glow inside, so
  // the rings come in a little, still well above the floor.
  const small = orgFit(120, 300);
  assert.ok(small.size <= 300 && small.k < 1 && small.k > C.ORG_SQUEEZE_MIN, JSON.stringify(small));
});

test('#718: a deeper fleet brings its rings in, and never below the floor', () => {
  const f = orgFit(160, 327);
  assert.ok(f.k < 1 && f.k >= C.ORG_SQUEEZE_MIN, `k ${f.k}`);
  assert.ok(f.size <= 327, `size ${f.size}`);
  assert.ok(160 * f.k + C.ORG_PAD_MIN <= f.size / 2 + 0.5, 'the squeezed outer ring fits in the box');
  // Too big even at the floor: k stops at the floor and the chart keeps the width it needs
  // (.orgwrap scrolls on its own; the page does not).
  const big = orgFit(600, 327);
  assert.equal(big.k, C.ORG_SQUEEZE_MIN);
  assert.equal(big.size, Math.round((600 * C.ORG_SQUEEZE_MIN + C.ORG_PAD_MIN) * 2));
});

test('#718: paintOrg sizes the chart by orgFit from its own width, and squeezes the rings, not the nodes', () => {
  const paint = SCRIPT.slice(SCRIPT.indexOf('function paintOrg'), SCRIPT.indexOf('function orgLiveStart'));
  assert.match(paint, /const viewW = wrap\.clientWidth;[\s\S]{0,400}?const fit = orgFit\(maxR, viewW\);/);
  assert.match(paint, /spot\.r \*= fit\.k/);
  assert.match(paint, /const size = fit\.size;/);
  assert.doesNotMatch(paint, /const pad = 78/, 'the old fixed square is back');
  assert.doesNotMatch(paint, /scale\(/, 'scaling the drawing shrinks the nodes under the tap floor');
});

test('#718: a width change repaints the chart, and a too-big chart scrolls in its own box', () => {
  assert.match(SCRIPT, /function orgResizeRepaint\(\) \{\s*if \(ORG_RESIZE_RAF\) return;\s*ORG_RESIZE_RAF = requestAnimationFrame\(\(\) => \{[\s\S]{0,600}paintOrg\(\);/);
  assert.match(SCRIPT, /window\.addEventListener\('resize', orgResizeRepaint\);/);
  // Compared with the width the chart was last painted at, not one remembered by the handler.
  assert.match(SCRIPT, /if \(wrap\.clientWidth === ORG_VIEW_W\) return;\s*paintOrg\(\);/);
});

test('#718: a chart wider than its box lets a finger scroll the box, and the drag box is the fit margin', () => {
  const paint = SCRIPT.slice(SCRIPT.indexOf('function paintOrg'), SCRIPT.indexOf('function orgLiveStart'));
  assert.match(paint, /const wide = viewW > 0 && size > viewW;/);
  assert.match(paint, /orgmapEl\.classList\.add\('orgwide'\)/);
  // touch-action: none on the chart would block the box's own scroll on every point of it.
  assert.match(PAGE, /\.orgmap\.orgwide \{ touch-action: pan-x pan-y; \}/);
  // One number for the margin orgFit leaves and the box a dragged node is kept inside.
  assert.match(SCRIPT, /box: \{ lo: ORG_PAD_MIN, hi: size - ORG_PAD_MIN \}/);
  // Only a chart wider than its box scrolls: overflow-x clips overflow-y too, and the
  // callouts reach past the square, so an always-on scroller would cut them off.
  assert.match(paint, /classList\.toggle\('orgscroll', wide\)/);
  assert.match(PAGE, /\.orgwrap\.orgscroll \{ overflow-x: auto;/);
  assert.doesNotMatch(PAGE, /\.orgwrap \{[^}]*overflow-x: (auto|hidden|scroll)/, 'every chart would clip its callouts');
  // Sideways only, and clip (not hidden) so it is not a scroller and overflow-y stays visible.
  assert.match(PAGE, /\.orgwrap \{ margin-top: 8px; overflow-x: clip; \}/);
  // A finger on a wide chart pans it; it does not also start a drag.
  assert.match(SCRIPT, /if \(e\.pointerType !== 'mouse' && map\.classList\.contains\('orgwide'\)\) return;/);
  // A squeezed chart anchors edge callouts inward; a dragged hub keeps its own margin.
  assert.match(SCRIPT, /orgmapEl\.classList\.toggle\('orgtight', size < natural\);/);
  // One derivation of the natural square, shared by orgFit and the .orgtight test.
  assert.match(SCRIPT, /const natural = orgNatural\(maxR\);   \/\/ the square before any fit/);
  assert.equal((SCRIPT.match(/Math\.round\(\(maxR \+ ORG_PAD\) \* 2\)/g) || []).length, 1, 'the natural square is derived in one place');
  // No repaint on resize mid-drag; the release catches up.
  assert.match(SCRIPT, /function paintOrg\(\) \{\s*const wrap = document\.getElementById\('orgview'\);\s*if \(!wrap \|\| wrap\.hidden\) return;[\s\S]{0,500}?if \(ORG_LIVE && ORG_LIVE\.dragging\) return;/);
  assert.match(SCRIPT, /orgResizeRepaint\(\);   \/\/ #718: a width change held off during the drag lands now/);
  assert.match(PAGE, /\.orgmap\.orgtight \.onode\.co-l \.callout \{ left: 0; transform: none; \}/);
  assert.match(SCRIPT, /const extra = drag\.body === ORG_LIVE\.hub \? Math\.max\(0, ORG_LIVE\.hub\.size - box\.lo\) : 0;/);
});

test('#718: positions from a canvas of another width are carried across in proportion', () => {
  const paint = SCRIPT.slice(SCRIPT.indexOf('function paintOrg'), SCRIPT.indexOf('function orgLiveStart'));
  assert.match(paint, /const f = widthChanged && ORG_SIZE > 0 \? size \/ ORG_SIZE : 1;/);
  // A zero-width box (an ancestor not laid out) is neither a width change nor a new ORG_SIZE.
  assert.match(paint, /const widthChanged = viewW > 0 && ORG_VIEW_W > 0 && viewW !== ORG_VIEW_W;/);
  assert.match(paint, /if \(viewW > 0\) ORG_SIZE = size;/);
  assert.match(paint, /if \(viewW === 0\) return;/);
  // The box losing its tabindex hands focus to the first node rather than dropping it on the body.
  assert.match(SCRIPT, /const hadFocus = document\.activeElement === wrap;[\s\S]{0,500}if \(hadFocus\) \{\s*const first = map\.querySelector\('\.onode'\);\s*if \(first\) first\.focus\(\);/);
  // The note inside a scrolling box stays in view.
  assert.match(PAGE, /\.orgwrap\.orgscroll #orgnote \{ position: sticky; left: 0; \}/);
  // The scroll is written the first time the box scrolls and when its width changes, never on a
  // same-width repaint (the 5s poll): a write mid-pan stops a finger's scroll.
  assert.match(paint, /: widthChanged \? \(ORG_SCROLL_X \+ ORG_VIEW_W \/ 2\) \* f - viewW \/ 2\s*: size !== sizeWas && sizeWas > 0 \? wrap\.scrollLeft \+ \(size - sizeWas\) \/ 2 : null;/);
  // A scrolling box is focusable and named, so a keyboard can pan it.
  assert.match(paint, /if \(wide\) \{\s*wrap\.tabIndex = 0; wrap\.setAttribute\('role', 'region'\);/);
  // Every path that clears the chart instead of painting it resets the box the same way.
  assert.match(paint, /\} else orgBoxPlain\(\);/);
  // The failed-poll path in tick(): identified by the note it writes right after.
  assert.match(SCRIPT, /document\.getElementById\('orgmap'\)\.innerHTML = '';\s*ORG_HTML = null;\s*orgBoxPlain\(true\);\s*document\.getElementById\('orgnote'\)\.textContent = BOARD_NEEDS_SIGNIN/);
  assert.match(paint, /for \(const p of ORG_POS\.values\(\)\) \{ p\.x \*= f; p\.y \*= f; \}/);
  assert.doesNotMatch(paint, /ORG_POS = new Map\(\)/, 'a width change throws the positions away again');
});
