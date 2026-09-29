'use strict';

/**
 * kosmos#4434: org chart connector lines must never cross.
 *
 * Josh, #admin 2026-09-28: "the agents in the bottom left are crossing over lines and they could have
 * just put their agents in those areas". On main, `orgPlace` fanned each manager's reports over a FIXED
 * arc centred on the manager, whatever room that manager had, so neighbouring fans overlapped and lines
 * crossed; the physics (`orgStep`) could then carry a node into another branch.
 *
 * These tests count PROPER crossings between connector lines (hub to first ring, manager to report),
 * drawn centre to centre, which is stricter than the drawn wires (those are cut back at each face).
 * Realistic trees with uneven branch sizes, plus seeded random trees, checked:
 *   1. on `orgPlace`'s positions (first paint),
 *   2. after the physics and the rest-time repair, the path a released drag takes (settled() below),
 *   3. the page's own live chart (livePage() below): first load, repaints, the glide, clicks and drags.
 * A tree that is repainted off its placement glides straight to it; the physics runs only for a drag.
 */

require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orgsec-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orgsec-w-'));
const fleet = require('./test-support/fleet');
const store = require('./engine/store');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* The same boundary-anchored lift as web.org-view.test.js, with the constants read out of the page. */
function lift(names, tail) {
  const src = names.map((name) => {
    const at = SCRIPT.indexOf('function ' + name + '(');
    assert.ok(at > -1, name + ' vanished from the page');
    let depth = 0; let end = -1;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') depth += 1;
      else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
    }
    return SCRIPT.slice(at, end);
  }).join('\n');
  const consts = ['ORG_R0', 'ORG_STEP', 'ORG_MIN_ARC'].map((k) => {
    const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
    assert.ok(m, k + ' is no longer declared in the page');
    return 'const ' + k + ' = ' + m[1] + ';';
  }).join('\n') + '\n';
  // eslint-disable-next-line no-new-func
  return new Function(consts + src + '\n' + tail)();
}
const place = lift(['orgTreeOf', 'orgPlace'], 'return { orgTreeOf, orgPlace, ORG_MIN_ARC };');
const sim = (() => {
  const at = SCRIPT.indexOf('const ORG_SIM = {');
  const end = SCRIPT.indexOf('let ORG_LIVE = null;');
  assert.ok(at > -1 && end > at, 'the simulation left the page');
  const m = SCRIPT.match(/const\s+ORG_STEP\s*=\s*([-\d.]+)\s*;/);
  // eslint-disable-next-line no-new-func
  return new Function('const ORG_STEP = ' + m[1] + ';\n' + SCRIPT.slice(at, end) + '\nreturn { orgStep, orgPlanarRepair, orgHomeStep, ORG_GLIDE_MAX, ORG_SIM, ORG_SETTLE_STEPS };')();
})();

/* Cards from the real producer (fixture-discipline refuses hand-built ones). Names carry a per-tree
   prefix, so a reportsTo written for one tree cannot leak into the next. */
let TREE = 0;
function cards(spec) {
  TREE += 1;
  const pre = 't' + TREE + '_';
  for (const [name, to] of spec) if (to) store.writeProfile(pre + name, { reportsTo: pre + to });
  const board = fleet.install(spec.map(([name]) => fleet.agent(pre + name, { state: 'idle' })), { strict: false });
  try { return board.agents.slice(); } finally { board.restore(); }
}

/* ---- geometry ---------------------------------------------------------------------------------- */
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
/* A PROPER crossing: the two segments cross at a point interior to both. Segments that only share an
   endpoint (a manager and its reports) do not count; a collinear overlap does. */
function cross(s, t) {
  if (same(s.a, t.a) || same(s.a, t.b) || same(s.b, t.a) || same(s.b, t.b)) {
    // Sharing an end: they overlap only if collinear and pointing the same way.
    const shared = same(s.a, t.a) || same(s.a, t.b) ? s.a : s.b;
    const so = same(shared, s.a) ? s.b : s.a;
    const to = same(shared, t.a) ? t.b : t.a;
    if (Math.abs(orient(shared, so, to)) > 1e-6) return false;
    return (so.x - shared.x) * (to.x - shared.x) + (so.y - shared.y) * (to.y - shared.y) > 0;
  }
  /* A side counts only when it is clear of rounding: two radial lines at exactly opposite angles lie on one
     line through the hub and never meet, yet their orientations come out as tiny numbers of mixed sign
     (review it4: that alone made randomTree(1953, 39) look crossed). */
  const side = (v, g) => { const e = 1e-9 * ((g.b.x - g.a.x) ** 2 + (g.b.y - g.a.y) ** 2); return v > e ? 1 : (v < -e ? -1 : 0); };
  return side(orient(t.a, t.b, s.a), t) * side(orient(t.a, t.b, s.b), t) < 0
    && side(orient(s.a, s.b, t.a), s) * side(orient(s.a, s.b, t.b), s) < 0;
}
/* Every connector as a segment, from a map name -> {x, y} (the hub is `hub`) and name -> parent. */
function segments(pos, parentOf, hub) {
  const out = [];
  for (const [name, p] of pos) {
    const par = parentOf.get(name);
    out.push({ name, a: par ? pos.get(par) : hub, b: p });
  }
  return out;
}
function crossings(segs) {
  const bad = [];
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      if (cross(segs[i], segs[j])) bad.push(segs[i].name + ' x ' + segs[j].name);
    }
  }
  return bad;
}
function overlaps(pos, min) {
  const pts = [...pos.values()];
  let n = 0;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < min) n += 1;
  }
  return n;
}

/* First paint: orgPlace's polar positions around a hub at the origin. */
function firstPaint(agentCards) {
  const { placed } = place.orgPlace(place.orgTreeOf(agentCards));
  const pos = new Map(); const parentOf = new Map();
  for (const [name, s] of placed) {
    pos.set(name, { x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r });
    parentOf.set(name, s.node.parent || null);
  }
  return { placed, pos, parentOf };
}
/* The physics then the repair, as a released drag runs them (orgLiveRun), from nodes built the way
   orgLiveStart builds them,
   on a canvas sized the way paintOrg sizes it: (maxR + ORG_PAD) * 2 square, the box ORG_PAD_MIN in from
   each edge. (A fixed box smaller than a big tree pinned its outer ring to the edge, squashed two nodes
   together and crossed their lines: a test artifact the real page never produces.)
   `seed` (optional) is a map name -> {x, y} of earlier positions, as ORG_POS gives a repaint. */
const pageConst = (k) => {
  const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
  assert.ok(m, k + ' is no longer declared in the page');
  return Number(m[1]);
};
const ORG_PAD = pageConst('ORG_PAD');
const ORG_PAD_MIN = pageConst('ORG_PAD_MIN');
const HUB = { x: 600, y: 600 };   // the re-parent test's canvas; settled() re-centres on its own
const fitOf = (() => {
  const src = ['orgNatural', 'orgFloorOf', 'orgFit'].map((name) => {
    const at = SCRIPT.indexOf('function ' + name + '(');
    let d = 0;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') d += 1; else if (SCRIPT[k] === '}') { d -= 1; if (!d) return SCRIPT.slice(at, k + 1); }
    }
    return '';
  }).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('const ORG_PAD = ' + pageConst('ORG_PAD') + '; const ORG_PAD_MIN = ' + pageConst('ORG_PAD_MIN')
    + '; const ORG_SQUEEZE_MIN = ' + pageConst('ORG_SQUEEZE_MIN') + ';\n' + src + '\nreturn { orgFit, orgFloorOf };')();
})();
/* `avail` (optional): the width the chart must fit, squeezed as paintOrg squeezes it (orgFit scales every
   radius by k; the canvas is fit.size). The physics then ends with orgPlanarRepair, as a drag's does. */
/* The canvas paintOrg gives a placement: the squeeze to `avail` (which scales `placed` in place), the square's
   size, and the hub's centre. */
function canvasFor(placed, avail) {
  let maxR = 0;
  for (const s of placed.values()) maxR = Math.max(maxR, s.r);
  let size = Math.round((maxR + ORG_PAD) * 2);
  if (avail) {
    const fit = fitOf.orgFit(maxR, avail, fitOf.orgFloorOf(placed));   // the page's own floor, as paintOrg calls it
    if (fit.k < 1) for (const s of placed.values()) s.r *= fit.k;
    size = fit.size;
  }
  /* Centred the way paintOrg centres it: on the bounding box of the hub and the faces (review it3: centring at
     size / 2 hid a node pushed past the edge by a drifted hub). */
  let minX = -52; let maxX = 52; let minY = -52; let maxY = 52;
  for (const sp of placed.values()) {
    const x = Math.cos(sp.ang) * sp.r; const y = Math.sin(sp.ang) * sp.r;
    minX = Math.min(minX, x - 27); maxX = Math.max(maxX, x + 27); minY = Math.min(minY, y - 27); maxY = Math.max(maxY, y + 27);
  }
  const cx = Math.round(size / 2 - (minX + maxX) / 2);
  const cy = Math.round(size / 2 - (minY + maxY) / 2);
  return { size, cx, cy };
}
function settled(placed, seed, avail) {
  const { size, cx, cy } = canvasFor(placed, avail);
  const shiftX = cx - HUB.x; const shiftY = cy - HUB.y;   // a seed is given around HUB; move it with the canvas
  const hub = { x: cx, y: cy, vx: 0, vy: 0, fixed: false, size: 52, home: { x: cx, y: cy } };
  const nodes = new Map();
  for (const [key, spot] of placed) {
    const was = seed && seed.get(key);
    nodes.set(key, {
      key, x: was ? was.x + shiftX : cx + Math.cos(spot.ang) * spot.r, y: was ? was.y + shiftY : cy + Math.sin(spot.ang) * spot.r,
      vx: 0, vy: 0, ring: spot.r, parentKey: spot.node.parent || null, parent: null, fixed: false,
      home: Number.isFinite(spot.lo) ? { dx: Math.cos(spot.ang) * spot.r, dy: Math.sin(spot.ang) * spot.r } : null,
      rest: 0,
    });
  }
  for (const n of nodes.values()) n.parent = n.parentKey ? (nodes.get(n.parentKey) || null) : null;
  for (const n of nodes.values()) {
    if (!n.home) continue;
    const ph = n.parent && n.parent.home ? n.parent.home : { dx: 0, dy: 0 };
    n.rest = Math.hypot(n.home.dx - ph.dx, n.home.dy - ph.dy);
  }
  const bodies = [...nodes.values()];
  const box = { lo: ORG_PAD_MIN, hi: size - ORG_PAD_MIN };
  let a = 1;
  for (let i = 0; i < sim.ORG_SETTLE_STEPS; i += 1) {
    const moved = sim.orgStep(bodies, hub, a, box);
    a *= 0.985;
    if (a <= 0.02 || moved <= 0.05) break;
  }
  sim.orgPlanarRepair(bodies, hub);
  const pos = new Map(); const parentOf = new Map();
  for (const n of bodies) { pos.set(n.key, { x: n.x, y: n.y }); parentOf.set(n.key, n.parentKey); }
  return { pos, parentOf, hub: { x: hub.x, y: hub.y }, box, home: { x: cx, y: cy } };
}

/* ---- the trees ----------------------------------------------------------------------------------- */
/* Josh's screenshot shape: several managers with uneven teams, leaves between them. */
const UNEVEN = [
  ['m1'], ['m2'], ['m3'], ['m4'], ['s1'], ['s2'],
  ['a1', 'm1'], ['a2', 'm1'], ['a3', 'm1'], ['a4', 'm1'], ['a5', 'm1'],
  ['b1', 'm2'],
  ['c1', 'm3'], ['c2', 'm3'], ['c3', 'm3'], ['c4', 'c1'], ['c5', 'c1'],
  ['d1', 'm4'], ['d2', 'm4'],
];
/* Three managers side by side with big teams: the fans that overlapped. */
const NEIGHBOURS = [
  ['m1'], ['m2'], ['m3'],
  ...['1', '2', '3', '4', '5', '6'].map((i) => ['x' + i, 'm1']),
  ...['1', '2', '3', '4'].map((i) => ['y' + i, 'm2']),
  ...['1', '2', '3', '4', '5'].map((i) => ['z' + i, 'm3']),
];
/* Deep and lopsided: a chain four deep under one manager, a wide team under another. */
const DEEP = [
  ['m1'], ['m2'], ['m3'], ['s1'],
  ['p1', 'm1'], ['p2', 'p1'], ['p3', 'p2'], ['p4', 'p3'], ['q1', 'p2'], ['q2', 'p2'],
  ...['1', '2', '3', '4', '5', '6', '7'].map((i) => ['w' + i, 'm2']),
  ['v1', 'm3'],
];
/* Lopsided under one manager: one report with eleven of its own, one with two. The big report sits well
   off its manager's angle, and its own reports fan back across toward the manager; without the tangent
   cap their lines could dip inward; since the rework it no longer crosses without the cap, so the cap is
   pinned by the deep tree in the 'cross without the tangent cap' test below. */
const LOPSIDED = [
  ['m1'], ['s0'], ['c1', 'm1'], ['c2', 'm1'],
  ...Array.from({ length: 11 }, (_, i) => ['x' + i, 'c1']),
  ['y0', 'c2'], ['y1', 'c2'],
];
/* A seeded generator, so a failure names a tree that can be rebuilt. */
function randomTree(seed, n, pRoot = 0.33) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const spec = [];
  for (let i = 0; i < n; i += 1) {
    const name = 'n' + i;
    // pRoot of them on the first ring (a third by default); the rest report to a random earlier agent.
    const to = i === 0 || rnd() < pRoot ? null : 'n' + Math.floor(rnd() * i);
    spec.push(to ? [name, to] : [name]);
  }
  return spec;
}

const NAMED = { UNEVEN, NEIGHBOURS, DEEP, LOPSIDED };

test('first paint: no connector crosses another, on uneven trees (#4434)', () => {
  for (const [label, spec] of Object.entries(NAMED)) {
    const { pos, parentOf } = firstPaint(cards(spec));
    assert.equal(pos.size, spec.length, label + ': an agent was not placed');
    const bad = crossings(segments(pos, parentOf, { x: 0, y: 0 }));
    assert.deepEqual(bad, [], label + ': ' + bad.length + ' crossing(s) on first paint: ' + bad.slice(0, 6).join(', '));
  }
});

test('first paint: every report sits inside its manager\'s sector, and nothing overlaps (#4434)', () => {
  for (const [label, spec] of Object.entries(NAMED)) {
    const { placed, pos } = firstPaint(cards(spec));
    const wrap = (d) => Math.atan2(Math.sin(d), Math.cos(d));
    for (const [name, s] of placed) {
      assert.ok(Number.isFinite(s.lo) && Number.isFinite(s.hi) && s.hi > s.lo, label + ': ' + name + ' has no sector');
      const mid = (s.lo + s.hi) / 2;
      assert.ok(Math.abs(wrap(s.ang - mid)) <= (s.hi - s.lo) / 2 + 1e-9, label + ': ' + name + ' sits outside its own sector');
      const par = s.node.parent ? placed.get(s.node.parent) : null;
      if (par) {
        const pm = (par.lo + par.hi) / 2;
        assert.ok(Math.abs(wrap(s.ang - pm)) <= (par.hi - par.lo) / 2 + 1e-9, label + ': ' + name + ' sits outside its manager\'s sector');
      }
    }
    assert.equal(overlaps(pos, 46), 0, label + ': two nodes overlap on first paint');
  }
});

test('first paint: the trees that cross without the tangent cap do not cross (#4434, review it3, it4)', () => {
  /* The one tree of 4,500 (seeds 1 to 1500, a tenth, a third and 0.6 on the first ring) that crosses on first
     paint without the cap on managers that have a manager: a deep one, three crossings. This is what pins the
     cap. (it3's randomTree(1953, 39) and (2064, 30) only crossed through the rounding the count now ignores,
     review it4.) */
  for (const [seed, n, pRoot] of [[892, 85, 0.1]]) {
    const { pos, parentOf } = firstPaint(cards(randomTree(seed, n, pRoot)));
    const bad = crossings(segments(pos, parentOf, { x: 0, y: 0 }));
    assert.deepEqual(bad, [], 'randomTree(' + seed + ', ' + n + '): ' + bad.length + ' crossing(s): ' + bad.slice(0, 4).join(', '));
  }
});

test('first paint: seeded random trees have no crossings and no overlaps (#4434)', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const spec = randomTree(seed, 6 + (seed % 22));
    const { pos, parentOf } = firstPaint(cards(spec));
    const bad = crossings(segments(pos, parentOf, { x: 0, y: 0 }));
    assert.deepEqual(bad, [], 'random tree seed ' + seed + ': ' + bad.length + ' crossing(s): ' + bad.slice(0, 4).join(', '));
    assert.equal(overlaps(pos, 46), 0, 'random tree seed ' + seed + ': two nodes overlap');
  }
});

test('after the physics and the rest-time repair (a released drag\'s path): no crossings, and faces stay apart (#4434)', () => {
  const specs = Object.entries(NAMED).concat(Array.from({ length: 20 }, (_, i) => ['seed ' + (i + 1), randomTree(i + 1, 8 + (i % 18))]));
  for (const [label, spec] of specs) {
    const { placed } = firstPaint(cards(spec));
    const { pos, parentOf, hub } = settled(placed);
    const bad = crossings(segments(pos, parentOf, hub));
    assert.deepEqual(bad, [], label + ': ' + bad.length + ' crossing(s) after settling: ' + bad.slice(0, 6).join(', '));
    assert.equal(overlaps(pos, 44), 0, label + ': two faces (44px) overlap after the settle');
  }
});

test('the physics from old positions (a drag released after a re-parent) ends in the new sector without crossing (#4434)', () => {
  /* A repaint seeds each node from ORG_POS by key, so a moved agent STARTS where it used to be, in its
     old manager's branch. Settling must carry it into its new manager's sector. */
  const before = firstPaint(cards(UNEVEN));
  const oldPos = new Map();
  for (const [k, s] of before.placed) oldPos.set(k.replace(/^t\d+_/, ''), { x: HUB.x + Math.cos(s.ang) * s.r, y: HUB.y + Math.sin(s.ang) * s.r });
  // a5 moves from m1 to m4, across the chart.
  const moved = UNEVEN.map(([n, to]) => (n === 'a5' ? ['a5', 'm4'] : [n, to]));
  const after = firstPaint(cards(moved));
  const seed = new Map();
  for (const k of after.placed.keys()) seed.set(k, oldPos.get(k.replace(/^t\d+_/, '')));
  const { pos, parentOf, hub } = settled(after.placed, seed);
  const bad = crossings(segments(pos, parentOf, hub));
  assert.deepEqual(bad, [], bad.length + ' crossing(s) after a re-parent: ' + bad.slice(0, 6).join(', '));
});

test('the physics stays close to the placement: the spring rests at the placed length, not the ring step (#4434)', () => {
  /* orgPlace grows rings; a parent spring resting at ORG_STEP pulled grown rings back in, across other branches
     (review it1: a node placed at r=322 settled at 145). Measured max drift with the placed rest 61.5px, with
     ORG_STEP 110.9px, over 200 random trees; 85px separates them. */
  let worst = 0; let where = '';
  for (let seed = 1; seed <= 60; seed += 1) {
    const spec = randomTree(seed, 8 + (seed % 40));
    const { placed } = firstPaint(cards(spec));
    const { pos, home } = settled(placed);
    for (const [k, s] of placed) {
      const d = Math.hypot(pos.get(k).x - (home.x + Math.cos(s.ang) * s.r), pos.get(k).y - (home.y + Math.sin(s.ang) * s.r));
      if (d > worst) { worst = d; where = 'seed ' + seed + ' ' + k; }
    }
  }
  assert.ok(worst < 85, 'a node drifted ' + worst.toFixed(0) + 'px from where it was placed (' + where + ')');
});

test('no line but the hub\'s own passes over the hub (#4434)', () => {
  /* A first-ring manager's reports spread at most ~85 degrees either side of it. Wider, a line to a report
     on the far side sweeps past the centre, over the person's own picture (measured without the limit: a
     line 28px from the hub centre). Clearance: the hub's radius plus a face's, 52 + 22. */
  let closest = Infinity; let where = '';
  for (const [label, spec] of Object.entries(NAMED).concat(Array.from({ length: 40 }, (_, i) => ['seed ' + (i + 1), randomTree(i + 1, 8 + (i % 40))]))) {
    const { pos, parentOf } = firstPaint(cards(spec));
    for (const [k, b] of pos) {
      const par = parentOf.get(k);
      if (!par) continue;
      const a = pos.get(par);
      const vx = b.x - a.x; const vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, (-a.x * vx - a.y * vy) / (vx * vx + vy * vy)));
      const d = Math.hypot(a.x + t * vx, a.y + t * vy);
      if (d < closest) { closest = d; where = label + ' ' + k; }
    }
  }
  assert.ok(closest >= 74, 'a report\'s line passes ' + closest.toFixed(0) + 'px from the hub centre (' + where + ')');
});

test('a bigger branch gets a wider slice (sectors are weighted by the people at the ends of each branch) (#4434)', () => {
  const { placed } = firstPaint(cards(UNEVEN));
  const width = (suffix) => { for (const [k, s] of placed) if (k.endsWith('_' + suffix)) return s.hi - s.lo; return NaN; };
  // m1 has five leaves, m2 one, s1 none of its own (a leaf, weight 1).
  assert.ok(width('m1') > 3 * width('m2'), 'm1 (5 leaves) is not much wider than m2 (1 leaf): ' + width('m1').toFixed(2) + ' vs ' + width('m2').toFixed(2));
  assert.ok(Math.abs(width('m2') - width('s1')) < 1e-9, 'two branches of one leaf each got different slices');
});

test('squeezed to a phone, a large fleet under the physics and the repair rests with no crossings (#4434, review it2)', () => {
  /* orgFit squeezes a big chart to the screen by scaling every radius; faces then sit closer than the
     physics' gap and push each other off their places. Without the rest-time repair, 60-90 agents at 375px
     crossed in 9 of 150 trees (review it2). */
  /* The six trees (seed, size) that crossed at 375px without the repair (found with the review harness), plus
     a spread of others. */
  const trees = [[27, 87], [28, 88], [48, 77], [49, 78], [77, 75], [88, 86]].concat(Array.from({ length: 8 }, (_, i) => [i * 11 + 2, 60 + ((i * 11 + 2) % 31)]));
  for (const [seed, n] of trees) {
    const { placed } = firstPaint(cards(randomTree(seed, n)));
    const { pos, parentOf, hub } = settled(placed, null, 375);
    const bad = crossings(segments(pos, parentOf, hub));
    assert.deepEqual(bad, [], 'randomTree(' + seed + ', ' + n + ') at 375px: ' + bad.length + ' crossing(s): ' + bad.slice(0, 4).join(', '));
    assert.equal(overlaps(pos, 44), 0, 'randomTree(' + seed + ', ' + n + ') at 375px: faces overlap (the squeeze went below the tree\'s floor)');
    const { box } = settled(firstPaint(cards(randomTree(seed, n))).placed, null, 375);
    const out = [...pos.values()].filter((q) => q.x < box.lo - 0.5 || q.x > box.hi + 0.5 || q.y < box.lo - 0.5 || q.y > box.hi + 0.5);
    assert.equal(out.length, 0, 'randomTree(' + seed + ', ' + n + ') at 375px: ' + out.length + ' node(s) rest past the canvas edge');
  }
});

test('one manager with hundreds of direct reports: nobody overlaps on first paint (#4434, review it2)', () => {
  const spec = [['pm']].concat(Array.from({ length: 300 }, (_, i) => ['r' + i, 'pm']));
  const { pos } = firstPaint(cards(spec));
  assert.equal(overlaps(pos, 46), 0, 'a 300-report team overlaps');
});

test('the rest-time repair is wired where the physics ends: the animation\'s stop (the only physics a tree runs is a drag)', () => {
  const body = (name) => { const at = SCRIPT.indexOf('function ' + name + '('); return SCRIPT.slice(at, SCRIPT.indexOf('\n}', at)); };
  assert.match(body('orgLiveRun'), /orgPlanarRepair\(\[\.\.\.L\.nodes\.values\(\)\], L\.hub, true\)\) \{ L\.homing = true;/, 'the animation no longer repairs a crossing when it stops (by gliding home)');
});

test('the repair never moves a held node or hub, so a drag held still keeps what the person holds (#4434, review it3)', () => {
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  const a = { key: 'a', x: 400, y: 300, parent: null, fixed: false, home: { dx: 100, dy: 0 } };
  const b = { key: 'b', x: 420, y: 420, parent: null, fixed: false, home: { dx: 0, dy: 100 } };
  /* c is held where a's line to it (400,300 to 350,450) crosses the hub's line to b (300,300 to 420,420) at
     375,375, inside both. With c held, nothing may move. */
  const c = { key: 'c', x: 350, y: 450, parent: a, fixed: true, home: { dx: 150, dy: 50 } };
  const d = { key: 'd', x: 500, y: 400, parent: a, fixed: false, home: { dx: 150, dy: -50 } };
  assert.equal(sim.orgPlanarRepair([a, b, c, d], hub), false, 'the repair ran while a node was held');
  assert.deepEqual([c.x, c.y, d.x, d.y], [350, 450, 500, 400], 'a held drag was moved');
  c.fixed = false;
  hub.fixed = true;   // the hub held (a hub drag) is the person's too
  assert.equal(sim.orgPlanarRepair([a, b, c, d], hub), false, 'the repair ran while the hub was held');
  hub.fixed = false;
  assert.equal(sim.orgPlanarRepair([a, b, c, d], hub), true, 'CONTROL: released, the same crossing is repaired');
  const src = SCRIPT.slice(SCRIPT.indexOf('function orgLiveRun('), SCRIPT.indexOf('\n}', SCRIPT.indexOf('function orgLiveRun(')));
  assert.match(src, /!L\.dragging && orgPlanarRepair/, 'the animation\'s stop no longer skips the repair mid-drag');
});

test('the repair places the chart around the hub\'s HOME, not where the hub drifted (#4434, review it3)', () => {
  /* Offsets from a drifted hub land past the canvas edge; the placement around the home fits by construction. */
  const hub = { x: 380, y: 260, vx: 1, vy: 1, fixed: false, home: { x: 300, y: 300 } };
  const a = { key: 'a', x: 400, y: 300, parent: null, fixed: false, home: { dx: 100, dy: 0 } };
  const b = { key: 'b', x: 420, y: 420, parent: null, fixed: false, home: { dx: 0, dy: 100 } };
  const c = { key: 'c', x: 350, y: 450, parent: a, fixed: false, home: { dx: 150, dy: 50 } };
  assert.equal(sim.orgPlanarRepair([a, b, c], hub), true, 'CONTROL: the crossing was not repaired');
  assert.deepEqual([hub.x, hub.y], [300, 300], 'the hub was not returned to its home');
  assert.deepEqual([c.x, c.y], [450, 350], 'a node was placed around the drifted hub, not its home');
});

test('two radial lines at exactly opposite angles are not a crossing, to the count or to the repair (#4434, review it4)', () => {
  /* randomTree(35, 40) places two radial lines at exactly opposite angles: one line through the hub, either
     side of it, never meeting. Their orientations come out as tiny numbers of mixed sign, so without a
     rounding margin both the count and the repair called it a crossing (the repair then "snapped" a chart
     that was already right). */
  const { placed, pos, parentOf } = firstPaint(cards(randomTree(35, 40)));
  const segs = segments(pos, parentOf, { x: 0, y: 0 });
  assert.deepEqual(crossings(segs), [], 'randomTree(35, 40): the count found a crossing');
  const hub = { x: 0, y: 0, vx: 0, vy: 0, fixed: false, home: { x: 0, y: 0 } };
  const nodes = new Map();
  for (const [k, sp] of placed) nodes.set(k, { key: k, x: pos.get(k).x, y: pos.get(k).y, vx: 0, vy: 0, fixed: false, home: { dx: pos.get(k).x, dy: pos.get(k).y }, parentKey: sp.node.parent || null });
  for (const n of nodes.values()) n.parent = n.parentKey ? nodes.get(n.parentKey) : null;
  assert.equal(sim.orgPlanarRepair([...nodes.values()], hub), false, 'the repair called the placement of randomTree(35, 40) crossed');
  /* CONTROL: a sign test with no margin does call these very coordinates crossed, so the two above can fail. */
  const naive = (s, t) => {
    if (same(s.a, t.a) || same(s.a, t.b) || same(s.b, t.a) || same(s.b, t.b)) return false;
    const d1 = orient(t.a, t.b, s.a); const d2 = orient(t.a, t.b, s.b); const d3 = orient(s.a, s.b, t.a); const d4 = orient(s.a, s.b, t.b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  let fake = 0;
  for (let i = 0; i < segs.length; i += 1) for (let j = i + 1; j < segs.length; j += 1) if (naive(segs[i], segs[j])) fake += 1;
  assert.ok(fake > 0, 'CONTROL: randomTree(35, 40) no longer has the rounding case, so this tests nothing');
});

test('the repair treats two lines from one manager lying along each other as a crossing (#4434, review it4)', () => {
  /* a's lines to c and d lie on one line, the same way out (measured: the canvas edge clamped a manager and two
     reports onto one vertical line). The hub's line to a is on the same line too, but the other way out, which
     is not an overlap. */
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  const a = { key: 'a', x: 400, y: 300, parent: null, fixed: false, home: { dx: 100, dy: 0 } };
  const c = { key: 'c', x: 500, y: 300, parent: a, fixed: false, home: { dx: 190, dy: -40 } };
  const d = { key: 'd', x: 450, y: 300, parent: a, fixed: false, home: { dx: 190, dy: 40 } };
  assert.equal(sim.orgPlanarRepair([a, c, d], hub), true, 'two lines lying along each other were not repaired');
  assert.deepEqual([d.x, d.y], [490, 340], 'd was not returned to its placement');
  /* CONTROLS: apart, nothing; the hub-to-a line and a-to-c point opposite ways from a, so they are not one. */
  const c2 = { ...c, x: 500, y: 300 }; const d2 = { ...d, x: 450, y: 350 };
  assert.equal(sim.orgPlanarRepair([a, c2, d2], hub), false, 'CONTROL: lines apart were repaired');
  assert.equal(sim.orgPlanarRepair([a, { ...c, x: 500, y: 300 }], hub), false, 'CONTROL: a straight chain hub, a, c was repaired');
});

test('the repair also sends a tree home when two faces overlap at rest, with no crossing (#4434, review it5)', () => {
  /* A hub dragged into a corner and let go could rest with faces overlapping and no line crossed (review it5:
     1 or 2 of 30 at 60-150 agents; 7 of 30 at 375px measured with the glide). */
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  const a = { key: 'a', x: 400, y: 300, parent: null, fixed: false, home: { dx: 100, dy: 0 } };
  const b = { key: 'b', x: 420, y: 330, parent: null, fixed: false, home: { dx: 0, dy: 100 } };   // 36px from a
  assert.equal(sim.orgPlanarRepair([a, b], hub, true), true, 'two overlapping faces at rest were left there');
  b.x = 300; b.y = 400;
  assert.equal(sim.orgPlanarRepair([a, b], hub, true), false, 'CONTROL: faces apart were sent home');
});

test('the repair glides a tree home: the whole chart the same fraction, never more than ORG_GLIDE_MAX a step (#4434, review it5)', () => {
  const hub = { x: 1000, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };   // dragged 700px off
  const a = { key: 'a', x: 1100, y: 300, parent: null, fixed: false, home: { dx: 100, dy: 0 } };
  const c = { key: 'c', x: 1150, y: 360, parent: a, fixed: false, home: { dx: 150, dy: 60 } };
  const nodes = [a, c];
  let left = Infinity; let steps = 0; let jump = 0;
  while (left > 0.5 && steps < 500) {
    const was = [hub, a, c].map((b) => ({ x: b.x, y: b.y }));
    left = sim.orgHomeStep(nodes, hub, 0.2); steps += 1;
    [hub, a, c].forEach((b, i) => { jump = Math.max(jump, Math.hypot(b.x - was[i].x, b.y - was[i].y)); });
    assert.ok(Math.abs((c.x - a.x) - 50) < 1e-9 && Math.abs((c.y - a.y) - 60) < 1e-9, 'the chart lost its shape on the way home');
  }
  assert.ok(steps > 10 && steps < 500, 'the glide took ' + steps + ' steps');
  assert.ok(jump <= sim.ORG_GLIDE_MAX + 1e-9, 'a step moved ' + jump.toFixed(1) + 'px');
  sim.orgHomeStep(nodes, hub, 1);
  assert.deepEqual([hub.x, hub.y, a.x, a.y, c.x, c.y], [300, 300, 400, 300, 450, 360], 'the glide did not end exactly at the placement');
});

test('a grab during the glide home ends the glide: the held hub does not move (#4434, review it7)', () => {
  /* orgHomeStep moves every body, held or not; only orgLiveRun's !L.dragging keeps the glide off a held one.
     review it7: without it the glide moved the held node in 27 of 27 grabs. */
  const { placed } = firstPaint(cards(randomTree(7, 60)));
  const { size, cx, cy } = canvasFor(placed, 0);
  const { page, map, run, down, up, one } = livePage();
  page.orgLiveStart(map, placed, cx, cy, size);
  run();
  const L = page.live();
  for (const b of [L.hub, ...L.nodes.values()]) b.x += 300;   // the whole chart 300px off: a glide home
  L.homing = true; page.wake();
  one(); one();
  assert.ok(L.homing, 'CONTROL: the glide did not start, so this tests nothing');
  down();
  const held = { x: L.hub.x, y: L.hub.y };
  for (let i = 0; i < 30; i += 1) one();
  assert.deepEqual({ x: L.hub.x, y: L.hub.y }, held, 'the glide moved the hub while it was held');
  up();
  run();
  assert.ok(offPlacement(page, placed, cx, cy) < 0.01, 'CONTROL: let go, the chart did not come back to its placement');
});

test('a tree that turns flat (its last manager removed) starts from the flat placement, not the tree\'s positions (#4434, review it8, it15)', () => {
  /* Handed the tree's far larger canvas as it is (2630px against 860px here), the flat physics clamped faces to
     the new edge and they rested on top of each other (review it8: 37 pairs, one at 0px). A glide into the flat
     placement kept state that a mid-glide repaint broke the same way (review it15), so a tree turning flat is a
     one-step re-layout, like a window resize. */
  const at = SCRIPT.indexOf('function paintOrg(');
  const paint = SCRIPT.slice(at, SCRIPT.indexOf('\n}', at));
  assert.match(paint, /const tree = \[\.\.\.placed\.values\(\)\]\.some\(\(sp\) => Number\.isFinite\(sp\.lo\)\);[\s\S]{0,900}?const turnedFlat = ORG_POS_TREE === true && !tree;\s*ORG_POS_TREE = tree;\s*if \(turnedFlat\) ORG_POS\.clear\(\);/,
    'paintOrg no longer drops a tree\'s positions when it turns flat');
  const spec = [['m']].concat(Array.from({ length: 59 }, (_, i) => ['a' + i, 'm']));
  const tp = firstPaint(cards(spec)).placed;
  const pre = [...tp.keys()][0].split('_')[0] + '_';
  const fp0 = firstPaint(cards(spec.map(([nm]) => [nm]))).placed;
  const preF = [...fp0.keys()][0].split('_')[0] + '_';
  const fp = new Map([...fp0].map(([key, v]) => [key.replace(preF, pre), v]));
  const settleFlat = (clear) => {
    const t = canvasFor(tp, 0);
    const { page, map, run } = livePage();
    page.orgLiveStart(map, tp, t.cx, t.cy, t.size); run();
    if (clear) page.pos().clear();
    const c = canvasFor(fp, 0);
    page.orgLiveStart(map, fp, c.cx, c.cy, c.size); run();
    const pos = new Map([...page.pos()].filter(([key]) => key !== '\u0000hub'));
    return { overlapping: overlaps(pos, 44), grew: t.size / c.size };
  };
  assert.equal(settleFlat(true).overlapping, 0, 'the flat fleet rests with faces overlapping');
  const carried = settleFlat(false);
  assert.ok(carried.grew > 2 && carried.overlapping > 0, 'CONTROL: seeded from the tree\'s positions the flat fleet does not overlap (' + carried.overlapping + ' pairs, tree canvas ' + carried.grew.toFixed(1) + 'x), so this tests nothing');
});

test('a tree\'s kept positions move with the canvas on screen, measured by the page itself (#4434, review it13, it15)', () => {
  /* The canvas moves on screen when a tree's canvas changes size (centring, the carried and clamped scroll, the
     scrolling box's top padding); paintOrg measures its rect before and after and moves kept positions by the
     difference, so no face jumps in the paint. A browser measures this; the wiring is pinned here. */
  const at = SCRIPT.indexOf('function paintOrg(');
  const paint = SCRIPT.slice(at, SCRIPT.indexOf('\n}', at));
  const before = paint.indexOf('const mapBefore = mapWas.getBoundingClientRect();');
  const moves = paint.search(/wrap\.classList\.toggle\('orgscroll'/);
  assert.ok(before > -1 && before < moves, 'the canvas is not measured before this paint moves it');
  assert.match(paint, /const mapWasDrawn = mapWas\.childElementCount > 0 && !!mapWas\.style\.width;/, 'the carry no longer checks a drawn canvas was there (a failed poll empties the map)');
  assert.match(paint, /map\.innerHTML = html;[\s\S]{0,1500}?if \(tree && !widthChanged && mapWasDrawn\) \{\s*const mapAfter = map\.getBoundingClientRect\(\);\s*const dx = mapBefore\.left - mapAfter\.left; const dy = mapBefore\.top - mapAfter\.top;\s*if \(dx \|\| dy\) for \(const p of ORG_POS\.values\(\)\) \{ p\.x \+= dx; p\.y \+= dy; \}\s*\}\s*[\s\S]{0,400}?orgLiveStart\(map, placed, cx, cy, size\);/,
    'kept positions no longer move by the measured canvas offset before the live chart starts');
});

test('in a tree, a body outside the box comes in at most ORG_GLIDE_MAX a step; a flat fleet keeps the hard clamp (#4434, review it15)', () => {
  const box = { lo: 42, hi: 958 };
  const mk = (home) => {
    const hub = { x: 500, y: 500, vx: 0, vy: 0, fixed: true, size: 52, home: { x: 500, y: 500 } };
    const out = { key: 'o', x: 1600, y: 500, vx: 0, vy: 0, fixed: false, parent: null, ring: 120, rest: 0, home };
    return { hub, out };
  };
  const t = mk({ dx: 120, dy: 0 });
  sim.orgStep([t.out], t.hub, 0.02, box);
  assert.ok(1600 - t.out.x <= sim.ORG_GLIDE_MAX + 1e-9 && t.out.x < 1600, 'a tree body 642px outside moved ' + (1600 - t.out.x).toFixed(0) + 'px in one step');
  // Outside on both axes: the whole move is capped, not each axis (review it17: 56.6px per step).
  // Outside on y only (below a canvas that shrank): the cap still applies (review it19).
  const yo = mk({ dx: 120, dy: 0 }); yo.out.x = 500; yo.out.y = 1600;
  sim.orgStep([yo.out], yo.hub, 0.02, box);
  assert.ok(Math.hypot(500 - yo.out.x, 1600 - yo.out.y) <= sim.ORG_GLIDE_MAX + 1e-9 && yo.out.y < 1600, 'a tree body outside only on y moved ' + (1600 - yo.out.y).toFixed(0) + 'px in one step');
  const c = mk({ dx: 120, dy: 0 }); c.out.y = 1600;
  sim.orgStep([c.out], c.hub, 0.02, box);
  const moved = Math.hypot(1600 - c.out.x, 1600 - c.out.y);
  assert.ok(moved <= sim.ORG_GLIDE_MAX + 1e-9 && moved > 0, 'a corner body moved ' + moved.toFixed(1) + 'px in one step');
  const f = mk(null);
  sim.orgStep([f.out], f.hub, 0.02, box);
  assert.equal(f.out.x, 958, 'CONTROL: a flat body outside is put on the edge, as on main');
});

test('a flat fleet given its first manager glides from where it was to the tree\'s placement (#4434, review it9)', () => {
  /* Dropping the ring's positions snapped the chart up to ~380px with no animation, where main animated it. */
  const flatSpec = Array.from({ length: 12 }, (_, i) => ['a' + i]);
  const fp = firstPaint(cards(flatSpec)).placed;
  const pre = [...fp.keys()][0].split('_')[0] + '_';
  const tp0 = firstPaint(cards(flatSpec.map(([nm], i) => (i === 3 ? [nm, 'a0'] : [nm])))).placed;
  const preT = [...tp0.keys()][0].split('_')[0] + '_';
  const ren = (k) => k && k.replace(preT, pre);
  const tp = new Map([...tp0].map(([k, v]) => [ren(k), { ...v, node: { ...v.node, parent: ren(v.node.parent) } }]));
  const f0 = canvasFor(fp, 1000);
  const { page, map, run } = livePage();
  page.orgLiveStart(map, fp, f0.cx, f0.cy, f0.size); run();
  const t0 = canvasFor(tp, 1000);
  page.orgLiveStart(map, tp, t0.cx, t0.cy, t0.size);   // the ring's positions as paintOrg keeps them (its screen offset is measured in the browser)
  const g = run();
  assert.ok(g.frames > 1 && g.far > 40, 'CONTROL: the tree\'s placement is where the ring already was (' + g.far.toFixed(0) + 'px), so this tests nothing');
  assert.ok(g.jump <= 41, 'a frame moved a face ' + g.jump.toFixed(0) + 'px: the change snapped instead of gliding');
  assert.ok(offPlacement(page, tp, t0.cx, t0.cy) < 0.01, 'the glide did not end at the tree\'s placement');
});

test('under reduced motion a tree off its placement is placed there at once, with no animation (#4434, review it11)', () => {
  const { placed } = firstPaint(cards(randomTree(7, 60)));
  const { size, cx, cy } = canvasFor(placed, 375);
  for (const still of [true, false]) {
    const { page, map, run } = livePage(still);
    page.orgLiveStart(map, placed, cx, cy, size); run();
    for (const [k, q] of [...page.pos()]) page.pos().set(k, { x: q.x + 120, y: q.y + 40 });   // off its placement: a re-parent, an add
    page.orgLiveStart(map, placed, cx, cy, size);
    if (still) {
      assert.ok(offPlacement(page, placed, cx, cy) < 0.01, 'under reduced motion the tree was not placed at once');
      assert.equal(run().frames, 0, 'under reduced motion the tree animated');
    } else {
      assert.ok(run().frames > 1, 'CONTROL: animated, the same change did not glide, so this tests nothing');
    }
  }
});

test('a click that stops a glide finishes it: the chart comes home even with nothing crossed (#4434, review it11)', () => {
  /* A press held for a few frames stopped the glide; the release resumed it only when something crossed, so a
     chart could rest part-way home (review it11: 3 of 40, up to 124px off). */
  const { placed } = firstPaint(cards(randomTree(7, 60)));
  const { size, cx, cy } = canvasFor(placed, 0);
  const { page, map, run, down, up, one } = livePage();
  page.orgLiveStart(map, placed, cx, cy, size); run();
  /* The whole chart 30px off, inside its box: nothing crosses or overlaps, so only the paused glide can bring
     it home (a larger shift runs faces into the box edge, and the repair would resume it anyway). */
  for (const [k, q] of [...page.pos()]) page.pos().set(k, { x: q.x + 30, y: q.y });
  page.orgLiveStart(map, placed, cx, cy, size);
  one(); one();
  const L = page.live();
  down();
  for (let i = 0; i < 4; i += 1) one();
  L.hub.fixed = false;
  assert.equal(sim.orgPlanarRepair([...L.nodes.values()], L.hub, true), false, 'CONTROL: the chart part-way home crosses or overlaps, so the repair would bring it home anyway');
  L.hub.fixed = true;
  up();
  run();
  assert.ok(offPlacement(page, placed, cx, cy) < 0.01, 'the chart rested ' + offPlacement(page, placed, cx, cy).toFixed(0) + 'px off its placement after a click stopped the glide');
});

test('a click on the hub of a tree at rest does not move it; a drag of the same hub does (#4434, review it5, it6)', () => {
  /* Through the page's own pointerdown and pointerup. review it6: the source pin below stayed green with every
     press counted as moved, which re-opened the bug. */
  const { placed } = firstPaint(cards(randomTree(7, 260)));
  const { size, cx, cy } = canvasFor(placed, 0);
  const { page, map, run, press } = livePage();
  page.orgLiveStart(map, placed, cx, cy, size);
  assert.equal(run().frames, 0, 'CONTROL: the first load already moved');
  press(0, 0);
  const click = run();
  assert.equal(click.frames, 0, 'a click on the hub ran ' + click.frames + ' frames of physics');
  assert.ok(offPlacement(page, placed, cx, cy) < 0.01, 'a click moved the chart');
  press(80, 60);
  const drag = run();
  assert.ok(drag.frames > 0, 'CONTROL: a real drag of the hub did not run the physics, so the click arm tests nothing');
});

test('a click on a tree (a press that never moved) does not restart the physics (#4434, review it5)', () => {
  /* A plain click re-ran the physics at alpha 0.5, which drifts a tree off its placement (review it5: 17 of 30
     trees of 150-220 agents then snapped 111-192px). The release handler lives in the page's pointer wiring,
     so this pins its condition. */
  const at = SCRIPT.indexOf('const release = (e) => {');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('\n  };', at));
  assert.match(body, /if \(was\.moved \|\| !\[\.\.\.ORG_LIVE\.nodes\.values\(\)\]\.some\(\(n\) => n\.home\)\) \{[^}]*orgLiveRun\(\); \}/, 'a release that never moved runs the physics on a tree again');
  assert.match(body, /else if \(ORG_LIVE\.glidePaused \|\| orgPlanarRepair\(\[\.\.\.ORG_LIVE\.nodes\.values\(\)\], ORG_LIVE\.hub, true\)\) \{ ORG_LIVE\.glidePaused = false; ORG_LIVE\.homing = true; orgLiveRun\(\); \}/, 'a click that interrupted a glide no longer finishes it');
});

test('the same input gives the same positions (stable across reloads) (#4434)', () => {
  const agentsOnce = cards(UNEVEN);
  const one = place.orgPlace(place.orgTreeOf(agentsOnce)).placed;
  const two = place.orgPlace(place.orgTreeOf(agentsOnce)).placed;
  for (const [k, s] of one) {
    assert.equal(two.get(k).ang, s.ang, k + ' moved between two identical layouts');
    assert.equal(two.get(k).r, s.r, k + ' moved between two identical layouts');
  }
});

/* The page's live chart itself (orgLiveStart, orgLiveSettle, orgLiveSync, orgLiveRun), lifted with the
   simulation and run against a stub map, animation frames queued by hand. */
function livePage(still) {
  const grab = (name) => {
    const at = SCRIPT.indexOf('function ' + name + '(');
    assert.ok(at > -1, name + ' vanished from the page');
    let d = 0;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') d += 1; else if (SCRIPT[k] === '}') { d -= 1; if (!d) return SCRIPT.slice(at, k + 1); }
    }
    return '';
  };
  const simAt = SCRIPT.indexOf('const ORG_SIM = {');
  const simSrc = SCRIPT.slice(simAt, SCRIPT.indexOf('let ORG_LIVE = null;'));
  const frames = []; let nextFrame = 0;
  const el = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, dataset: {}, isConnected: true,
    setAttribute() {}, removeAttribute() {}, setPointerCapture() {}, releasePointerCapture() {} });
  const els = new Map();
  const on = {};
  const map = {
    querySelector: (q) => { if (!els.has(q)) els.set(q, el()); return els.get(q); },
    addEventListener: (type, f) => { on[type] = f; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    classList: { contains: () => false },
  };
  /* The page's own pointer wiring (the IIFE after orgLiveRun), bound to this map. */
  const ptrAt = SCRIPT.indexOf('/* Grab any node, the hub included.');
  const ptrSrc = SCRIPT.slice(ptrAt, SCRIPT.indexOf("document.getElementById('orgmap').addEventListener('click'", ptrAt));
  assert.ok(ptrAt > -1 && ptrSrc.includes("addEventListener('pointerup', release)"), 'the org chart pointer wiring left the page');
  const env = {
    window: { matchMedia: () => ({ matches: Boolean(still) }) },   // prefers-reduced-motion
    CSS: { escape: (x) => x },
    requestAnimationFrame: (f) => { nextFrame += 1; frames.push({ id: nextFrame, f }); return nextFrame; },
    // Cancels as a browser does, so a second orgLiveStart with a frame still queued does not replay it (review it10).
    cancelAnimationFrame: (id) => { const i = frames.findIndex((q) => q.id === id); if (i > -1) frames.splice(i, 1); },
  };
  // eslint-disable-next-line no-new-func
  const page = new Function('window', 'CSS', 'requestAnimationFrame', 'cancelAnimationFrame', 'document',
    'const ORG_STEP = ' + pageConst('ORG_STEP') + '; const ORG_PAD_MIN = ' + ORG_PAD_MIN + ';\n' + simSrc
    + "let ORG_LIVE = null; let ORG_POS = new Map();\n"
    + 'function orgWireEnds(x0, y0, a0, x1, y1) { return { x1: x0, y1: y0, x2: x1, y2: y1, shown: true }; }\n'
    + ['orgLiveStart', 'orgLiveSettle', 'orgLiveSync', 'orgLiveRun'].map(grab).join('\n')
    + '\nlet ORG_DRAG_MOVED = false; function orgResizeRepaint() {}\n' + ptrSrc
    + '\nreturn { orgLiveStart, pos: () => ORG_POS, live: () => ORG_LIVE, wake: () => orgLiveRun() };')(
    env.window, env.CSS, env.requestAnimationFrame, env.cancelAnimationFrame, { getElementById: () => map });
  /* Run queued frames until the animation stops; return how far any node got from where it started. */
  const run = () => {
    const from = new Map([...page.pos()].map(([k, q]) => [k, { x: q.x, y: q.y }]));
    let far = 0; let n = 0; let jump = 0;
    let last = new Map(from);
    while (frames.length && n < 5000) {
      frames.shift().f(); n += 1;
      const now = new Map();
      for (const [k, q] of page.pos()) {
        const f = from.get(k); if (f) far = Math.max(far, Math.hypot(q.x - f.x, q.y - f.y));
        const l = last.get(k); if (l) jump = Math.max(jump, Math.hypot(q.x - l.x, q.y - l.y));
        now.set(k, { x: q.x, y: q.y });
      }
      last = now;
    }
    assert.ok(n < 5000, 'the animation never stopped');
    return { far, frames: n, jump };
  };
  /* Press the hub, optionally move the pointer by (dx, dy), and let go, through the page's own listeners. */
  const hubEl = { ...el(), classList: { ...el().classList, contains: (c) => c === 'hub' } };
  const at = { button: 0, pointerType: 'mouse', pointerId: 1, target: { closest: () => hubEl }, clientX: 100, clientY: 100 };
  const one = () => { if (frames.length) frames.shift().f(); };
  const down = () => on.pointerdown(at);
  const up = () => on.pointerup(at);
  const press = (dx, dy) => {
    down();
    if (dx || dy) for (let i = 1; i <= 10; i += 1) { on.pointermove({ ...at, clientX: 100 + dx * i / 10, clientY: 100 + dy * i / 10 }); one(); }
    up();
  };
  return { page, map, run, press, down, up, one };
}

/* How far any node of a live chart sits from its placement (relative to the hub's home, as orgPlace put it). */
function offPlacement(page, placed, cx, cy) {
  const hub = page.pos().get('\u0000hub');
  let far = Math.hypot(hub.x - cx, hub.y - cy);
  for (const [k, sp] of placed) {
    const q = page.pos().get(k);
    far = Math.max(far, Math.hypot(q.x - cx - Math.cos(sp.ang) * sp.r, q.y - cy - Math.sin(sp.ang) * sp.r));
  }
  return far;
}

test('a tree already at its placement is painted there and not animated: first load, and a repaint after the repair (#4434, review it4)', () => {
  /* At full size a 150-300 agent tree drifted under the physics until two lines crossed, and the repair then
     snapped it back up to ~150px, on an idle board (review it4); squeezed, randomTree(104, 82) at 375px did it
     on every repaint. Both trees, first load then a repaint: */
  for (const [seed, n, avail] of [[104, 82, 375], [7, 260, 0]]) {
    const { placed } = firstPaint(cards(randomTree(seed, n)));
    const { size, cx, cy } = canvasFor(placed, avail);
    const { page, map, run } = livePage();
    page.orgLiveStart(map, placed, cx, cy, size);
    assert.equal(run().frames, 0, 'randomTree(' + seed + ', ' + n + '): the first load of a tree ran the physics');
    assert.ok(offPlacement(page, placed, cx, cy) < 0.01, 'randomTree(' + seed + ', ' + n + '): the first load is not at the placement');
    /* CONTROL: started off its placement (one node 5px out, as a drag leaves it), the tree does animate, and
       it GLIDES straight back (review it9): only that node moves, and only its 5px. Under the physics every
       node would drift (these trees drifted into a crossing and a ~150px repair, review it4 and it5). */
    const k0 = [...placed.keys()][0];
    const q = page.pos().get(k0); page.pos().set(k0, { x: q.x + 5, y: q.y });
    page.orgLiveStart(map, placed, cx, cy, size);
    const moved = run();
    assert.ok(moved.frames > 0, 'CONTROL randomTree(' + seed + ', ' + n + '): off its placement nothing moved, so this tree tests nothing');
    assert.ok(moved.far < 5.5, 'randomTree(' + seed + ', ' + n + '): off its placement the chart moved ' + moved.far.toFixed(0) + 'px (the physics ran instead of the glide)');
    assert.ok(offPlacement(page, placed, cx, cy) < 0.01, 'randomTree(' + seed + ', ' + n + '): the glide did not end at the placement');
    page.orgLiveStart(map, placed, cx, cy, size);   // a repaint, same layout
    assert.equal(run().frames, 0, 'randomTree(' + seed + ', ' + n + '): a repaint after the repair ran the physics again (the snap repeats)');
    /* The hub counts too: the whole chart 30px off its home (every node still at its placement relative to
       the hub, as a released hub drag leaves it) is not at rest, and must move back (review it5: M16). */
    for (const [k, q] of [...page.pos()]) page.pos().set(k, { x: q.x + 30, y: q.y });
    page.orgLiveStart(map, placed, cx, cy, size);
    assert.ok(run().frames > 0, 'randomTree(' + seed + ', ' + n + '): a chart shifted off its hub\'s home was left there');
  }
});

test('paintOrg squeezes with the page\'s own floor for the placement, as this file\'s canvasFor does (#4434, review it5)', () => {
  /* canvasFor calls orgFloorOf and orgFit as paintOrg does; this pins paintOrg to the same call, so the
     squeezed tests measure the squeeze the page makes. Without the floor, faces overlap on a phone (review it5:
     34 of 100 random trees at 375px, closest 42.9px). */
  const at = SCRIPT.indexOf('function paintOrg(');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('\n}', at));
  assert.match(body, /orgFit\(maxR, viewW, orgFloorOf\(placed\)\)/, 'paintOrg no longer squeezes with the tree floor');
  const { placed } = firstPaint(cards(UNEVEN));
  assert.ok(fitOf.orgFloorOf(placed) > 0, 'CONTROL: a tree gets no floor');
  assert.equal(fitOf.orgFloorOf(firstPaint(cards([['f1'], ['f2'], ['f3']])).placed), 0, 'a flat fleet got a floor');
});

test('orgLiveStart gives each tree node its placed home and spring rest, as this file\'s settle does', () => {
  /* settled() above mirrors orgLiveStart; this pins the page to the same two pieces, so the settle the tests
     measure is the one the page runs. */
  const at = SCRIPT.indexOf('function orgLiveStart(');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('\n}', at));
  assert.match(body, /home:\s*Number\.isFinite\(spot\.lo\)\s*\?\s*\{\s*dx:\s*Math\.cos\(spot\.ang\)\s*\*\s*spot\.r/, 'orgLiveStart no longer gives a tree node its placed home');
  assert.match(body, /n\.rest\s*=\s*Math\.hypot\(n\.home\.dx - ph\.dx, n\.home\.dy - ph\.dy\)/, 'orgLiveStart no longer sets the spring rest to the placed length');
});

test('a CONTROL for the crossing count: two segments that do cross are counted, touching ends are not', () => {
  const s = (ax, ay, bx, by, name) => ({ name, a: { x: ax, y: ay }, b: { x: bx, y: by } });
  assert.deepEqual(crossings([s(0, 0, 10, 10, 'p'), s(0, 10, 10, 0, 'q')]), ['p x q']);
  assert.deepEqual(crossings([s(0, 0, 10, 10, 'p'), s(10, 10, 20, 0, 'q')]), [], 'a shared end counted as a crossing');
  assert.deepEqual(crossings([s(0, 0, 10, 0, 'p'), s(0, 0, 5, 0, 'q')]), ['p x q'], 'a collinear overlap from a shared end was missed');
});
