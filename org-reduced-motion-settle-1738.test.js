'use strict';

/**
 * #1738: the org chart must SETTLE under prefers-reduced-motion, not skip layout.
 *
 * 🛑 WHY THIS IS A NODE TEST, NOT A render-org-chart.js ARM. The defect only
 * shows when the seed overlaps, and by Baron's measurement the layout converges
 * to 0 overlaps for a fresh flat fleet -- which is exactly what the runner's
 * fixture is (write_fleet_rich = 5 flat agents). So a reduced-motion arm on the
 * runner fixture would be GREEN on main, GREEN after the fix, and GREEN on a
 * revert: aimed at the arm where the defect does not exist. Reproducing it in
 * the browser needs an overlapping seed, and manufacturing one reliably fights
 * the sim (a motion drag re-separates) or needs a denser fixture that would
 * break render-org-chart.js's fill-band assertion. This test controls the seed
 * directly and runs the REAL orgStep, so it reds on a revert without any of that.
 *
 * ⇒ It lifts the production orgStep + constants out of web/index.html (not a
 * copy -- a copy would drift), seeds nodes ON TOP of each other the way a stale
 * ORG_POS does, and asserts:
 *   - the seed really overlaps (or the test proves nothing), and
 *   - the synchronous settle orgLiveStart now runs under reduced motion pushes
 *     them apart to zero overlaps, using the same anneal orgLiveSettle uses.
 * Plus a wiring guard: orgLiveStart must CALL that settle under reduced motion
 * and must not carry the old skip.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* Brace-match a `function NAME(...) { ... }` out of the page source. */
function extractFn(src, marker) {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, 'could not find ' + marker + ' in web/index.html');
  let i = src.indexOf('{', at);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces after ' + marker);
}

/* Lift the constants block (ORG_R0 .. ORG_SETTLE_STEPS) plus the real orgStep,
   and eval them together so the test runs the production force model. */
function liftSim() {
  const cstart = PAGE.indexOf('const ORG_R0 = 120;');
  assert.notEqual(cstart, -1, 'org constants not found');
  const fn = extractFn(PAGE, 'function orgStep(');
  const consts = PAGE.slice(cstart, PAGE.indexOf('function orgStep(', cstart));
  // eslint-disable-next-line no-new-func
  const make = new Function(consts + '\n' + fn + '\n; return { orgStep, ORG_SETTLE_STEPS, ORG_STEP };');
  return make();
}

const NODE_EXTENT = 27; // orgPlace's; overlap = centre distance < 2*NODE_EXTENT

function overlaps(nodes, hub) {
  const all = [hub, ...nodes];
  let pairs = 0;
  let minD = Infinity;
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
      minD = Math.min(minD, d);
      if (d < 2 * NODE_EXTENT) pairs += 1;
    }
  }
  return { pairs, minD: Math.round(minD) };
}

const CX = 490;
const CY = 490;
const SIZE = 980;
const BOX = { lo: 30, hi: SIZE - 30 };
// Six nodes seeded within a few px of the centre -- what a stale ORG_POS looks
// like after the fleet changed under it. All on ring 120 so the ring force has
// somewhere to spread them.
function seedNodes() {
  return [0, 1, 2, 3, 4, 5].map((k) => ({
    key: 'n' + k, x: CX + (k - 2.5) * 1.2, y: CY + k * 0.9,
    vx: 0, vy: 0, ring: 120, parent: null, fixed: false, size: 22,
  }));
}
function seedHub() {
  return { key: 'hub', x: CX, y: CY, vx: 0, vy: 0, fixed: false, size: 52, home: { x: CX, y: CY } };
}

test('the seed overlaps, so the settle has something to prove', () => {
  const before = overlaps(seedNodes(), seedHub());
  assert.ok(before.pairs > 0, 'seed must overlap; got ' + JSON.stringify(before));
});

test('the reduced-motion synchronous settle resolves an overlapping seed to zero overlaps', () => {
  const { orgStep, ORG_SETTLE_STEPS } = liftSim();
  const nodes = seedNodes();
  const hub = seedHub();
  // The exact anneal orgLiveSettle runs (a *= 0.985 from 1, stop at 0.02 or still).
  let a = 1;
  for (let i = 0; i < ORG_SETTLE_STEPS; i += 1) {
    const moved = orgStep(nodes, hub, a, BOX);
    a *= 0.985;
    if (a <= 0.02 || moved <= 0.05) break;
  }
  const after = overlaps(nodes, hub);
  assert.equal(after.pairs, 0,
    'the settle must push every pair past 2*NODE_EXTENT; got ' + JSON.stringify(after));
});

test('orgLiveStart wires the settle under reduced motion and does not skip the sim', () => {
  const start = extractFn(PAGE, 'function orgLiveStart(');
  // The reduced-motion branch must run the settle.
  assert.match(start, /if \(still\)[\s\S]*orgLiveSettle\(\)/,
    'orgLiveStart must call orgLiveSettle in the reduced-motion branch');
  // And must NOT be the old skip, where the only relaxation trigger was gated on !still.
  assert.doesNotMatch(start, /orgLiveSync\(\);\s*\n\s*if \(!still\) orgLiveRun\(\);\s*\n\s*}/,
    'orgLiveStart still carries the old skip-the-sim-under-reduced-motion path');
  // The settle itself must run the real force model.
  const settle = extractFn(PAGE, 'function orgLiveSettle(');
  assert.match(settle, /orgStep\(/, 'orgLiveSettle must run orgStep');
});
