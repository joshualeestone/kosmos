'use strict';

/**
 * kosmos#4499: the org chart's first-ring line-to-face fix, as shipped through orgPlaceGated (option A).
 *
 * The bug: light first-ring roots cluster at near-equal leaf-count-slice angles, get bumped to outer lanes but
 * keep their angle, so an outer root's hub line grazes an inner root's face below ORG_LINE_CLEAR (12px). The fix
 * gives each first-ring root a minimum angular span (the floor), applied through a MEASURED, all-or-nothing gate:
 * orgPlaceGated lays the chart out proportionally (identical to the pre-#4499 / main layout) and floored, and
 * keeps the floored layout ONLY when the chart actually has the bug AND the floored layout is measured size-safe
 * (maxR within 1% of prop) AND clears 12px AND is no worse than prop's first-ring clearance. A chart with no
 * sub-12 first-ring line, or one that cannot be cleared without growing (two heavy roots, or many roots with one
 * heavy root), keeps the proportional layout; that residual size work is #4499's size card.
 *
 * What this guard pins, on the SHIPPED layout:
 *  1. ORG_LINE_CLEAR is 12 (a value change cannot silently relax the floor).
 *  2. SIZE: charts that blow up under an un-gated always-floor stay within 1% of the proportional maxR.
 *     RED on c1ad35613 (the un-gated always-floor fix), where these charts grow 3x-20x.
 *  3. 12px WHERE FUNDED: a funded clustered chart clears ORG_LINE_CLEAR by the FULL check (no line anywhere
 *     under 12). RED on a7a761731 (pre-fix), where rt(23,250,0.06) passes a face at 5.50px.
 *  4. NON-BUG IDENTICAL: a chart with no sub-12 first-ring line gets a layout byte-identical to main (every
 *     position equal, not merely within 1%) -- the property that makes the fix safe to ship (Liu Kang, m5385).
 *  5. HONEST FUNDED + CLEARANCE NEVER WORSE BY FULL: across a representative sweep of shapes (including ones the
 *     fix was not designed around -- two heavy roots, heavy roots at depth, random fans), every chart the cheap
 *     first-ring gate funds passes the FULL O(n^2) check (no sub-12 line anywhere), and no chart's full clearance
 *     drops below prop. This closes the gap between the first-ring runtime decision and the full check (Liu Kang
 *     condition 1): the two never disagree.
 *
 * orgPlaceGated/orgFirstRingClear are ABSENT on a pre-#4499 page; the lift below tolerates that so a red-on-main
 * run measures what that page actually ships (its orgPlace) rather than crashing at load.
 */

require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orgfirstring-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orgfirstring-w-'));
const fleet = require('./test-support/fleet');
const store = require('./engine/store');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* Lift the named functions that EXIST. orgPlaceGated/orgFirstRingClear are absent pre-#4499, which is how the
   red-on-main runs stay meaningful (they measure that page's orgPlace) rather than failing at load. */
function liftFns(names) {
  const present = names.filter((n) => SCRIPT.indexOf('function ' + n + '(') > -1);
  const src = present.map((name) => {
    const at = SCRIPT.indexOf('function ' + name + '(');
    let depth = 0; let end = -1;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') depth += 1;
      else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
    }
    return SCRIPT.slice(at, end);
  }).join('\n');
  const out = [];
  const re = /^\s*const\s+(ORG_[A-Z0-9_]+|TAU)\s*=\s*([^;]+);/gm;
  const safe = (r) => r.replace(/Math\.(PI|E)/g, '').replace(/[-+*/(). \t\d]/g, '') === '';
  let m; const seen = new Set();
  while ((m = re.exec(SCRIPT))) { const n = m[1]; const r = m[2].trim(); if (seen.has(n) || !new RegExp('\\b' + n + '\\b').test(src) || !safe(r)) continue; seen.add(n); out.push('const ' + n + ' = ' + r + ';'); }
  // eslint-disable-next-line no-new-func
  return new Function(out.join('\n') + '\n' + src + '\nreturn { ' + present.join(', ') + ' };')();
}
const page = liftFns(['orgTreeOf', 'orgPlace', 'orgFirstRingClear', 'orgPlaceGated']);
const hasGate = typeof page.orgPlaceGated === 'function';

/* ORG_LINE_CLEAR is the 12px rule. It is module-scope since #4499 (orgPlaceGated reads it); read it from the page. */
const LINE_CLEAR = Number((SCRIPT.match(/const\s+ORG_LINE_CLEAR\s*=\s*([\d.]+)\s*;/) || [])[1]);

let TREE = 0;
function cards(spec) {
  TREE += 1;
  const pre = 't' + TREE + '_';
  for (const [name, to] of spec) if (to) store.writeProfile(pre + name, { reportsTo: pre + to });
  const board = fleet.install(spec.map(([name]) => fleet.agent(pre + name, { state: 'idle' })), { strict: false });
  try { return board.agents.slice(); } finally { board.restore(); }
}
function randomTree(seed, n, pRoot) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const spec = [];
  for (let i = 0; i < n; i += 1) { const to = i === 0 || rnd() < pRoot ? null : 'n' + Math.floor(rnd() * i); spec.push(to ? ['n' + i, to] : ['n' + i]); }
  return spec;
}
function heavyFan(n, f) { const s = []; for (let i = 0; i < n; i += 1) s.push(['r' + i]); for (let j = 0; j < f; j += 1) s.push(['h' + j, 'r0']); return s; }
function twoHeavy(n, fa, fb) { const s = []; for (let i = 0; i < n; i += 1) s.push(['r' + i]); for (let j = 0; j < fa; j += 1) s.push(['a' + j, 'r0']); for (let j = 0; j < fb; j += 1) s.push(['b' + j, 'r1']); return s; }
function deepHeavy(n, f) { const s = []; for (let i = 0; i < n; i += 1) s.push(['r' + i]); s.push(['a', 'r0']); for (let j = 0; j < f; j += 1) s.push(['d' + j, 'a']); return s; }

const HUB = { x: 0, y: 0 };
const segDist = (q, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
};
function posOf(placed) {
  const pos = new Map();
  for (const [name, s] of placed) pos.set(name, { x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r, parent: s.node.parent || null, ang: s.ang, r: s.r });
  return pos;
}
/* The nearest any line (a node to its parent, or a root to the hub) passes any OTHER face. The full O(n^2) check. */
function fullWorst(placed) {
  const pos = posOf(placed); let worst = Infinity; let pairs = 0;
  for (const [name, p] of pos) {
    const a = p.parent ? pos.get(p.parent) : HUB;
    for (const [other, q] of pos) { if (other === name || other === p.parent) continue; pairs += 1; const d = segDist(q, a, p); if (d < worst) worst = d; }
  }
  return { worst, pairs };
}
function samePlacement(aPlaced, bPlaced) {
  const a = posOf(aPlaced); const b = posOf(bPlaced);
  if (a.size !== b.size) return false;
  for (const [k, s] of a) { const t = b.get(k); if (!t) return false; if (Math.abs(s.ang - t.ang) > 1e-9 || Math.abs(s.r - t.r) > 1e-9) return false; }
  return true;
}
/* Build the board once, then lay it out proportionally (= main) and as shipped, on the SAME agents so names line up. */
function layouts(spec) {
  const ag = cards(spec);
  const prop = page.orgPlace(page.orgTreeOf(ag), false);
  const ship = hasGate ? page.orgPlaceGated(page.orgTreeOf(ag)) : page.orgPlace(page.orgTreeOf(ag));
  return { prop, ship };
}

/* Embedded proportional maxR for the size fixtures, measured from orgPlace(,false). The stale guard below pins
   each against the live proportional layout on this page, so a base-layout drift fails loudly rather than
   letting the size assertion rot. An always-floor page cannot reproduce the proportional layout, so the stale
   guard also fails there -- part of why this file reds on c1ad35613. */
const EMBED_PROP_MAXR = { 'heavyFan(40,60)': 708, 'heavyFan(47,60)': 708, 'heavyFan(41,20)': 464, 'rt(36,100,0.33)': 857 };
const SIZE_FIXTURES = [
  ['heavyFan(40,60)', heavyFan(40, 60)],
  ['heavyFan(47,60)', heavyFan(47, 60)],
  ['heavyFan(41,20)', heavyFan(41, 20)],
  ['rt(36,100,0.33)', randomTree(36, 100, 0.33)],
];
/* Clustered charts that DO have the bug and are funded, so the shipped layout clears 12px. rt(23,250,0.06) is the
   canonical worst bug tree (pre-fix 5.50px); the heavyFans are inside the fan-60 funded region (<= ~23 roots). */
const BUG_FIXTURES = [
  ['rt(23,250,0.06)', randomTree(23, 250, 0.06), 5.50],
  ['heavyFan(18,60)', heavyFan(18, 60), null],
];

test('ORG_LINE_CLEAR is the 12px rule this file pins', () => {
  assert.equal(LINE_CLEAR, 12, 'ORG_LINE_CLEAR is the 12px rule the first-ring gate floors to; it reads ' + LINE_CLEAR);
});

test('FLOOR FORMULA PINNED: orgPlace (floor) and orgPlaceGated (fundability ceiling) derive from ONE expression (#4499)', () => {
  if (!hasGate) { assert.fail('orgPlaceGated is absent, so the floor and the ceiling cannot be pinned'); return; }
  // The floor (orgPlace's MIN_SPAN) and the gate's fundability ceiling (orgPlaceGated's maxFundable) are inverses
  // of the SAME angular floor. Repo convention #5 (this codebase's most-shipped defect): one source of truth, or
  // a test that pins the two derivations equal. They live in two functions, so this is that test -- change the
  // margin or the formula in one spot and the two source expressions stop matching here.
  const bodyOf = (name) => {
    const at = SCRIPT.indexOf('function ' + name + '(');
    let d = 0;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) { if (SCRIPT[k] === '{') d += 1; else if (SCRIPT[k] === '}') { d -= 1; if (!d) return SCRIPT.slice(at, k + 1); } }
    return '';
  };
  const asin = /Math\.asin\(Math\.min\(1,\s*\(ORG_LINE_CLEAR\s*\+\s*ORG_LINE_MARGIN\)\s*\/\s*ORG_R0\)\)/;
  const inPlace = bodyOf('orgPlace').match(asin);
  const inGated = bodyOf('orgPlaceGated').match(asin);
  assert.ok(inPlace, 'orgPlace no longer floors to asin(min(1,(ORG_LINE_CLEAR+ORG_LINE_MARGIN)/ORG_R0)); the floor formula moved or changed');
  assert.ok(inGated, 'orgPlaceGated maxFundable no longer uses the same asin(ORG_LINE_CLEAR+ORG_LINE_MARGIN) expression; the gate ceiling can drift from the floor');
  assert.equal(inPlace[0], inGated[0], 'the floor and the fundability ceiling derive from DIFFERENT expressions now (a change in one spot would ship green while the gate disagrees with the water-fill/equal-shares boundary)');
  // and neither re-introduced a raw margin literal in place of the named constant
  assert.ok(!/ORG_LINE_CLEAR\s*\+\s*\d/.test(bodyOf('orgPlace') + bodyOf('orgPlaceGated')), 'a raw margin literal (ORG_LINE_CLEAR + <number>) reappeared; both spots must use ORG_LINE_MARGIN so the margin has one source');
});

test('SIZE: a chart that blows up under an un-gated always-floor stays within 1% of the proportional maxR (#4499)', () => {
  for (const [label, spec] of SIZE_FIXTURES) {
    const embed = EMBED_PROP_MAXR[label];
    const { prop, ship } = layouts(spec);
    // stale guard: the proportional layout on THIS page must match the embedded reference (a base-layout drift,
    // or an always-floor page that cannot produce the proportional layout, fails here).
    assert.ok(Math.abs(prop.maxR - embed) <= 1, label + ' proportional maxR ' + prop.maxR.toFixed(1) + ' no longer matches the embedded ' + embed + ' (base layout drifted, or this page cannot draw the proportional layout)');
    assert.ok(
      ship.maxR <= embed * 1.01 + 1,
      label + ': the shipped maxR is ' + ship.maxR.toFixed(0) + ', over 1% past the proportional ' + embed + ' (an un-gated always-floor grows this chart 3x to 20x; the gate must fall it back to the proportional layout)',
    );
  }
});

test('12px WHERE FUNDED: a funded clustered chart clears ORG_LINE_CLEAR by the full check (#4499, red on pre-fix main)', () => {
  for (const [label, spec, preFix] of BUG_FIXTURES) {
    const { ship } = layouts(spec);
    const { worst, pairs } = fullWorst(ship.placed);
    assert.ok(pairs > 5000, label + ' CONTROL: only ' + pairs + ' line-to-face pairs measured, so this asserts nothing');
    assert.ok(
      worst >= LINE_CLEAR - 1e-6,
      label + ': a line passes ' + worst.toFixed(2) + 'px from a face, under the ' + LINE_CLEAR + 'px rule'
        + (preFix !== null ? ' (pre-fix main: ' + preFix.toFixed(2) + 'px)' : ''),
    );
  }
});

test('NON-BUG IDENTICAL: a chart with no sub-12 first-ring line gets a layout identical to main (#4499, m5385)', () => {
  if (!hasGate) { assert.fail('orgPlaceGated is absent, so the fix is not present (identical-to-main cannot hold)'); return; }
  // Charts with no first-ring clustering: a lone lead, a shallow team, a sparse random tree.
  const nonBug = [
    ['lead+10', [['lead']].concat(Array.from({ length: 10 }, (_, i) => ['r' + i, 'lead']))],
    ['rt(1,60,0.3)', randomTree(1, 60, 0.3)],
    ['deepHeavy(8,60)', deepHeavy(8, 60)],
  ];
  let asserted = 0;
  for (const [label, spec] of nonBug) {
    const ag = cards(spec);
    const prop = page.orgPlace(page.orgTreeOf(ag), false);
    const gated = page.orgPlaceGated(page.orgTreeOf(ag));
    const clear = page.orgFirstRingClear(prop.placed);
    // Only assert identity for charts the gate leaves alone (no bug). If one of these clusters, skip it rather
    // than make a false claim -- the sweep test covers the funded ones.
    if (clear < LINE_CLEAR) continue;
    assert.equal(gated.funded, false, label + ' has no sub-12 first-ring line (clear ' + clear.toFixed(2) + ') yet the gate funded it');
    assert.ok(samePlacement(prop.placed, gated.placed), label + ': a chart with no bug must get the proportional (main) layout exactly, but a position differs');
    asserted += 1;
  }
  assert.ok(asserted > 0, 'CONTROL: every non-bug fixture clustered (clear < ' + LINE_CLEAR + '), so the identical-to-main property was never actually asserted');
});

test('HONEST FUNDED + CLEARANCE NEVER WORSE BY FULL: the first-ring gate never disagrees with the full check (#4499 condition 1)', () => {
  if (!hasGate) { assert.fail('orgPlaceGated is absent, so the measured gate is not present'); return; }
  // A representative set of shapes (the exhaustive 1000+ tree sweep is offline; this guards against regression).
  // One per shape family across the funded/fallback boundary, kept small so the installs + full O(n^2) stay fast.
  const sweep = [];
  for (const [n, f] of [[16, 60], [36, 60], [41, 20]]) sweep.push(['heavyFan(' + n + ',' + f + ')', heavyFan(n, f)]);  // funded and fallback
  sweep.push(['twoHeavy(20,30,30)', twoHeavy(20, 30, 30)]);                                                           // two heavy roots
  sweep.push(['deepHeavy(24,40)', deepHeavy(24, 40)]);                                                                // heavy root at depth
  for (const [seed, n, p] of [[1, 50, 0.3], [2, 70, 0.3]]) sweep.push(['rt(' + seed + ',' + n + ',' + p + ')', randomTree(seed, n, p)]); // random fans

  let funded = 0; let checked = 0;
  for (const [label, spec] of sweep) {
    const ag = cards(spec);
    const prop = page.orgPlace(page.orgTreeOf(ag), false);
    const gated = page.orgPlaceGated(page.orgTreeOf(ag));
    const propW = fullWorst(prop.placed).worst;
    const shipW = fullWorst(gated.placed).worst;
    checked += 1;
    // clearance never worse by the FULL check, funded or not
    assert.ok(shipW >= propW - 0.05, label + ': full clearance dropped from ' + propW.toFixed(2) + ' to ' + shipW.toFixed(2) + ' (the first-ring gate funded a layout the full check finds worse)');
    if (gated.funded) {
      funded += 1;
      // honest funded: a funded chart has NO sub-12 line ANYWHERE (not just first ring)
      assert.ok(shipW >= LINE_CLEAR - 1e-6, label + ': FUNDED but the full check finds a line at ' + shipW.toFixed(2) + 'px, under ' + LINE_CLEAR + ' (dishonest funded decision)');
    }
  }
  assert.ok(checked >= 7, 'CONTROL: only ' + checked + ' charts swept, too few to exercise the shapes');
  assert.ok(funded > 0, 'CONTROL: no chart in the sweep was funded, so the funded path asserted nothing');
});

test('CONTROL: the line-to-face measure reports a planted sub-rule clearance, so it is not vacuous (#4499)', () => {
  const planted = new Map([
    ['root', { ang: 0, r: 100, node: { parent: null } }],
    ['near', { ang: Math.atan2(5, 50), r: Math.hypot(50, 5), node: { parent: null } }],
  ]);
  const { worst } = fullWorst(planted);
  assert.ok(worst < LINE_CLEAR, 'CONTROL: the measure reports ' + worst.toFixed(2) + 'px for a face planted 5px off a line, so it cannot see the rule broken');
  assert.ok(Math.abs(worst - 5) < 1e-6, 'CONTROL: the measure reports ' + worst.toFixed(2) + 'px, not the planted 5px');
});
