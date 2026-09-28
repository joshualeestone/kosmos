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
  return new Function('const ORG_STEP = ' + m[1] + ';\n' + SCRIPT.slice(at, end) + '\nreturn { orgStep, ORG_SIM, ORG_SETTLE_STEPS };')();
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
function settled(placed, seed) {
  let maxR = 0;
  for (const s of placed.values()) maxR = Math.max(maxR, s.r);
  const size = Math.round((maxR + ORG_PAD) * 2);
  const cx = size / 2;
  const shift = cx - HUB.x;   // a seed is given around HUB; move it with the canvas
  const hub = { x: cx, y: cx, vx: 0, vy: 0, fixed: false, size: 52, home: { x: cx, y: cx } };
  const nodes = new Map();
  for (const [key, spot] of placed) {
    const was = seed && seed.get(key);
    nodes.set(key, {
      key, x: was ? was.x + shift : cx + Math.cos(spot.ang) * spot.r, y: was ? was.y + shift : cx + Math.sin(spot.ang) * spot.r,
      vx: 0, vy: 0, ring: spot.r, parentKey: spot.node.parent || null, parent: null, fixed: false,
      lo: spot.lo, hi: spot.hi,
    });
  }
  for (const n of nodes.values()) n.parent = n.parentKey ? (nodes.get(n.parentKey) || null) : null;
  const bodies = [...nodes.values()];
  const box = { lo: ORG_PAD_MIN, hi: size - ORG_PAD_MIN };
  let a = 1;
  for (let i = 0; i < sim.ORG_SETTLE_STEPS; i += 1) {
    const moved = sim.orgStep(bodies, hub, a, box);
    a *= 0.985;
    if (a <= 0.02 || moved <= 0.05) break;
  }
  const pos = new Map(); const parentOf = new Map();
  for (const n of bodies) { pos.set(n.key, { x: n.x, y: n.y }); parentOf.set(n.key, n.parentKey); }
  return { pos, parentOf, hub: { x: hub.x, y: hub.y } };
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
   cap in orgPlace their lines dip inward and cross the manager's (measured: m1 x x9, c2 x x9). This tree
   is what arms the cap. */
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

test('first paint: seeded random trees have no crossings and no overlaps (#4434)', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const spec = randomTree(seed, 6 + (seed % 22));
    const { pos, parentOf } = firstPaint(cards(spec));
    const bad = crossings(segments(pos, parentOf, { x: 0, y: 0 }));
    assert.deepEqual(bad, [], 'random tree seed ' + seed + ': ' + bad.length + ' crossing(s): ' + bad.slice(0, 4).join(', '));
    assert.equal(overlaps(pos, 46), 0, 'random tree seed ' + seed + ': two nodes overlap');
  }
});

test('after the physics settles: still no crossings, and nodes stay apart (#4434)', () => {
  const specs = Object.entries(NAMED).concat(Array.from({ length: 20 }, (_, i) => ['seed ' + (i + 1), randomTree(i + 1, 8 + (i % 18))]));
  for (const [label, spec] of specs) {
    const { placed } = firstPaint(cards(spec));
    const { pos, parentOf, hub } = settled(placed);
    const bad = crossings(segments(pos, parentOf, hub));
    assert.deepEqual(bad, [], label + ': ' + bad.length + ' crossing(s) after settling: ' + bad.slice(0, 6).join(', '));
    assert.equal(overlaps(pos, sim.ORG_SIM.minGap * 0.8), 0, label + ': two nodes ended up on top of each other');
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

test('the same input gives the same positions (stable across reloads) (#4434)', () => {
  const agentsOnce = cards(UNEVEN);
  const one = place.orgPlace(place.orgTreeOf(agentsOnce)).placed;
  const two = place.orgPlace(place.orgTreeOf(agentsOnce)).placed;
  for (const [k, s] of one) {
    assert.equal(two.get(k).ang, s.ang, k + ' moved between two identical layouts');
    assert.equal(two.get(k).r, s.r, k + ' moved between two identical layouts');
  }
});

test('orgLiveStart hands each live node its sector (the physics can only keep what it is given)', () => {
  const at = SCRIPT.indexOf('function orgLiveStart(');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('\n}', at));
  assert.match(body, /lo:\s*spot\.lo/, 'orgLiveStart no longer copies the sector\'s lo onto the live node');
  assert.match(body, /hi:\s*spot\.hi/, 'orgLiveStart no longer copies the sector\'s hi onto the live node');
});

test('a CONTROL for the crossing count: two segments that do cross are counted, touching ends are not', () => {
  const s = (ax, ay, bx, by, name) => ({ name, a: { x: ax, y: ay }, b: { x: bx, y: by } });
  assert.deepEqual(crossings([s(0, 0, 10, 10, 'p'), s(0, 10, 10, 0, 'q')]), ['p x q']);
  assert.deepEqual(crossings([s(0, 0, 10, 10, 'p'), s(10, 10, 20, 0, 'q')]), [], 'a shared end counted as a crossing');
  assert.deepEqual(crossings([s(0, 0, 10, 0, 'p'), s(0, 0, 5, 0, 'q')]), ['p x q'], 'a collinear overlap from a shared end was missed');
});
