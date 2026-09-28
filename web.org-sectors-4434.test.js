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
 *   2. after the physics settles, exactly as orgLiveSettle runs it,
 *   3. after a re-parent, from the OLD positions (a repaint seeds from ORG_POS by key).
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
  return new Function('const ORG_STEP = ' + m[1] + ';\n' + SCRIPT.slice(at, end) + '\nreturn { orgStep, orgPlanarRepair, ORG_SIM, ORG_SETTLE_STEPS };')();
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
  const d1 = orient(t.a, t.b, s.a); const d2 = orient(t.a, t.b, s.b);
  const d3 = orient(s.a, s.b, t.a); const d4 = orient(s.a, s.b, t.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
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
/* The settle, built the way orgLiveStart builds its live nodes and run the way orgLiveSettle runs it,
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
  const src = ['orgNatural', 'orgFit'].map((name) => {
    const at = SCRIPT.indexOf('function ' + name + '(');
    let d = 0;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') d += 1; else if (SCRIPT[k] === '}') { d -= 1; if (!d) return SCRIPT.slice(at, k + 1); }
    }
    return '';
  }).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('const ORG_PAD = ' + pageConst('ORG_PAD') + '; const ORG_PAD_MIN = ' + pageConst('ORG_PAD_MIN')
    + '; const ORG_SQUEEZE_MIN = ' + pageConst('ORG_SQUEEZE_MIN') + ';\n' + src + '\nreturn orgFit;')();
})();
/* `avail` (optional): the width the chart must fit, squeezed as paintOrg squeezes it (orgFit scales every
   radius by k; the canvas is fit.size). The settle then ends with orgPlanarRepair, as orgLiveSettle does. */
/* The canvas paintOrg gives a placement: the squeeze to `avail` (which scales `placed` in place), the square's
   size, and the hub's centre. */
function canvasFor(placed, avail) {
  let maxR = 0;
  for (const s of placed.values()) maxR = Math.max(maxR, s.r);
  let size = Math.round((maxR + ORG_PAD) * 2);
  if (avail) {
    let closest = Infinity;
    const spots = [...placed.values()];
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        closest = Math.min(closest, Math.hypot(Math.cos(spots[i].ang) * spots[i].r - Math.cos(spots[j].ang) * spots[j].r,
          Math.sin(spots[i].ang) * spots[i].r - Math.sin(spots[j].ang) * spots[j].r));
      }
    }
    const fit = fitOf(maxR, avail, Number.isFinite(closest) ? 46 / closest : 0);
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
      lo: spot.lo, hi: spot.hi,
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
   pinned by the two trees in the 'cross without the tangent cap' test below. */
const LOPSIDED = [
  ['m1'], ['s0'], ['c1', 'm1'], ['c2', 'm1'],
  ...Array.from({ length: 11 }, (_, i) => ['x' + i, 'c1']),
  ['y0', 'c2'], ['y1', 'c2'],
];
/* A seeded generator, so a failure names a tree that can be rebuilt. */
function randomTree(seed, n) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const spec = [];
  for (let i = 0; i < n; i += 1) {
    const name = 'n' + i;
    // About a third on the first ring; the rest report to a random earlier agent (a tree by construction).
    const to = i === 0 || rnd() < 0.33 ? null : 'n' + Math.floor(rnd() * i);
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

test('first paint: the trees that cross without the tangent cap do not cross (#4434, review it3)', () => {
  /* Found by review it3 over 6000 random trees: without the cap on managers that have a manager, these cross
     on first paint (n35 x n27, n23 x n26). This is what pins the cap. */
  for (const [seed, n] of [[1953, 39], [2064, 30]]) {
    const { pos, parentOf } = firstPaint(cards(randomTree(seed, n)));
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

test('after the settle (the physics, then the rest-time repair): no crossings, and faces stay apart (#4434)', () => {
  const specs = Object.entries(NAMED).concat(Array.from({ length: 20 }, (_, i) => ['seed ' + (i + 1), randomTree(i + 1, 8 + (i % 18))]));
  for (const [label, spec] of specs) {
    const { placed } = firstPaint(cards(spec));
    const { pos, parentOf, hub } = settled(placed);
    const bad = crossings(segments(pos, parentOf, hub));
    assert.deepEqual(bad, [], label + ': ' + bad.length + ' crossing(s) after settling: ' + bad.slice(0, 6).join(', '));
    assert.equal(overlaps(pos, 44), 0, label + ': two faces (44px) overlap after the settle');
  }
});

test('a re-parent settles into the new manager\'s sector without crossing, from the old positions (#4434)', () => {
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

test('a settle stays close to the placement: the spring rests at the placed length, not the ring step (#4434)', () => {
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

test('squeezed to a phone, a large fleet still settles with no crossings (#4434, review it2)', () => {
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

test('the rest-time repair is wired where every settle ends: the reduced-motion settle and the animation\'s stop', () => {
  const body = (name) => { const at = SCRIPT.indexOf('function ' + name + '('); return SCRIPT.slice(at, SCRIPT.indexOf('\n}', at)); };
  assert.match(body('orgLiveSettle'), /orgPlanarRepair\(bodies, L\.hub\)/, 'orgLiveSettle no longer repairs a crossing at rest');
  assert.match(body('orgLiveRun'), /orgPlanarRepair\(\[\.\.\.L\.nodes\.values\(\)\], L\.hub\)/, 'the animation no longer repairs a crossing when it stops');
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
function livePage() {
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
  const frames = [];
  const el = () => ({ style: {}, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} });
  const els = new Map();
  const map = { querySelector: (q) => { if (!els.has(q)) els.set(q, el()); return els.get(q); } };
  const env = {
    window: { matchMedia: () => ({ matches: false }) },
    CSS: { escape: (x) => x },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: () => {},
  };
  // eslint-disable-next-line no-new-func
  const page = new Function('window', 'CSS', 'requestAnimationFrame', 'cancelAnimationFrame',
    'const ORG_STEP = ' + pageConst('ORG_STEP') + '; const ORG_PAD_MIN = ' + ORG_PAD_MIN + ';\n' + simSrc
    + "let ORG_LIVE = null; let ORG_POS = new Map(); let ORG_PLANAR_AT = '';\n"
    + 'function orgWireEnds(x0, y0, a0, x1, y1) { return { x1: x0, y1: y0, x2: x1, y2: y1, shown: true }; }\n'
    + ['orgLiveStart', 'orgLiveSettle', 'orgLiveSync', 'orgLiveRun'].map(grab).join('\n')
    + '\nreturn { orgLiveStart, pos: () => ORG_POS, planarAt: () => ORG_PLANAR_AT, forget: () => { ORG_PLANAR_AT = \'\'; } };')(
    env.window, env.CSS, env.requestAnimationFrame, env.cancelAnimationFrame);
  /* Run queued frames until the animation stops; return how far any node got from where it started. */
  const run = () => {
    const from = new Map([...page.pos()].map(([k, q]) => [k, { x: q.x, y: q.y }]));
    let far = 0; let n = 0;
    while (frames.length && n < 5000) {
      frames.shift()(); n += 1;
      for (const [k, q] of page.pos()) { const f = from.get(k); if (f) far = Math.max(far, Math.hypot(q.x - f.x, q.y - f.y)); }
    }
    assert.ok(n < 5000, 'the animation never stopped');
    return { far, frames: n };
  };
  return { page, map, run };
}

test('a repaint of a chart the repair already restored does not replay the crossing and the snap (#4434)', () => {
  /* randomTree(104, 82) at 375px: the physics carries it into a crossing, the repair snaps it back ~130px,
     and before this memory every repaint that changed the chart (a status, a name) replayed both. */
  const { placed } = firstPaint(cards(randomTree(104, 82)));
  const { size, cx, cy } = canvasFor(placed, 375);
  const { page, map, run } = livePage();
  page.orgLiveStart(map, placed, cx, cy, size);
  const first = run();
  assert.ok(first.frames > 0 && page.planarAt() !== '', 'CONTROL: this tree no longer needs the repair on first load, so it tests nothing');
  const rested = new Map([...page.pos()].map(([k, q]) => [k, { x: q.x, y: q.y }]));
  page.orgLiveStart(map, placed, cx, cy, size);   // a repaint, same layout
  const again = run();
  assert.equal(again.frames, 0, 'a repaint of the restored layout ran the physics again');
  for (const [k, q] of page.pos()) assert.ok(Math.hypot(q.x - rested.get(k).x, q.y - rested.get(k).y) < 0.01, k + ' moved on a repaint');
  page.forget();
  page.orgLiveStart(map, placed, cx, cy, size);
  const control = run();
  assert.ok(control.far > 40, 'CONTROL: without the memory the repaint does replay the move (' + control.far.toFixed(0) + 'px), so the assertion above can fail');
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
