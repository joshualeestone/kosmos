'use strict';
/**
 * #4502: in a FLAT fleet (nobody reports to anybody) every line runs from the hub, and an outer agent at the
 * angle of an inner one had its line drawn straight through that face, reading as reporting to it (13 agents: 1
 * such line, 15: 3, measured by review it19 of #4434). orgPlace now puts the second lane in the first lane's gaps
 * and orgStep keeps a hub line off nearer faces as the chart settles.
 *
 * Up to two full lanes (24 agents) no line need pass a face, and none does on a fresh paint at full scale or
 * squeezed to 0.9, at first paint and at rest. An agent joining a settled chart (the others keep their spots)
 * leaves at most 2 (measured). Squeezed harder for a narrow phone (0.7), and past 24 agents, near passes cannot
 * all be avoided with every line from one hub; the plan carries those measurements.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orgflat-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orgflat-w-'));
const fleet = require('./test-support/fleet');

const SCRIPT = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const pageConst = (k) => {
  const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
  assert.ok(m, k + ' is no longer declared in the page');
  return Number(m[1]);
};
function fnBody(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let d = 0;
  for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') d += 1; else if (SCRIPT[k] === '}') { d -= 1; if (!d) return SCRIPT.slice(at, k + 1); }
  }
  throw new Error(name + ' has no end');
}
const consts = ['ORG_R0', 'ORG_STEP', 'ORG_MIN_ARC', 'ORG_FACE_R'].map((k) => 'const ' + k + ' = ' + pageConst(k) + ';').join('\n');
// eslint-disable-next-line no-new-func
const place = new Function(consts + '\n' + fnBody('orgTreeOf') + '\n' + fnBody('orgPlace') + '\nreturn { orgTreeOf, orgPlace };')();
const sim = (() => {
  const at = SCRIPT.indexOf('const ORG_SIM = {');
  const end = SCRIPT.indexOf('let ORG_LIVE = null;');
  assert.ok(at > -1 && end > at, 'the simulation left the page');
  // eslint-disable-next-line no-new-func
  return new Function('const ORG_STEP = ' + pageConst('ORG_STEP') + ';\n' + SCRIPT.slice(at, end) + '\nreturn { orgStep, orgPlanarRepair, ORG_SIM, ORG_SETTLE_STEPS };')();
})();
const FACE = pageConst('ORG_FACE_R');
const ORG_PAD = pageConst('ORG_PAD');
const ORG_PAD_MIN = pageConst('ORG_PAD_MIN');

/* A flat fleet of n from the real card producer (fixture-discipline), laid out by the page's own orgTreeOf. */
let FLEET = 0;
function flatCards(n) {
  FLEET += 1;
  const board = fleet.install(Array.from({ length: n }, (_, i) => fleet.agent('f' + FLEET + '_' + i, { state: 'idle' })), { strict: false });
  try { return board.agents.slice(); } finally { board.restore(); }
}
const placeOf = (cards) => place.orgPlace(place.orgTreeOf(cards)).placed;
const flatFleet = (n) => placeOf(flatCards(n));
/* The physics as a flat chart settles, around a hub at the canvas centre (a flat chart's drawing is near
   symmetric, so this matches paintOrg's bounding-box centring). `k` is orgFit's squeeze of every radius (a
   narrow view); `kept` is name -> position relative to the hub, as ORG_POS keeps an agent's spot on a repaint. */
function settle(placed, k = 1, kept = null) {
  let maxR = 0;
  for (const s of placed.values()) maxR = Math.max(maxR, s.r);
  const size = k < 1 ? Math.round((maxR * k + ORG_PAD_MIN) * 2) : Math.round((maxR + ORG_PAD) * 2);
  const cx = size / 2; const cy = size / 2;
  const hub = { x: cx, y: cy, vx: 0, vy: 0, fixed: false, size: 52, home: { x: cx, y: cy } };
  const bodies = [...placed].map(([key, s]) => {
    const w = kept && kept.get(key);
    return { key, x: w ? cx + w.x : cx + Math.cos(s.ang) * s.r * k, y: w ? cy + w.y : cy + Math.sin(s.ang) * s.r * k,
      vx: 0, vy: 0, ring: s.r * k, parentKey: null, parent: null, fixed: false, home: null, rest: 0 };
  });
  const box = { lo: ORG_PAD_MIN, hi: size - ORG_PAD_MIN };
  let a = 1;
  for (let i = 0; i < sim.ORG_SETTLE_STEPS; i += 1) {
    const moved = sim.orgStep(bodies, hub, a, box);
    a *= 0.985;
    if (a <= 0.02 || moved <= 0.05) break;
  }
  sim.orgPlanarRepair(bodies, hub);
  return { bodies, hub };
}
function distToSeg(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/* The hub lines that pass within a face of an unrelated face, as "line -> face" names. */
function nearPasses(bodies, hub) {
  const out = [];
  for (const n of bodies) for (const m of bodies) if (m !== n && distToSeg(m, hub, n) < FACE) out.push(n.key + ' -> ' + m.key);
  return out;
}
const firstPaint = (placed) => ({ bodies: [...placed].map(([key, s]) => ({ key, x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r })), hub: { x: 0, y: 0 } });

test('#4502 CONTROL: the count sees a line drawn straight through a face, and only such a line', () => {
  const hub = { x: 0, y: 0 };
  assert.equal(nearPasses([{ key: 'in', x: 120, y: 0 }, { key: 'out', x: 178, y: 0 }], hub).length, 1, 'a line through a face was not counted');
  assert.equal(nearPasses([{ key: 'in', x: 120, y: 0 }, { key: 'out', x: 0, y: 178 }], hub).length, 0, 'a clear line was counted');
});

test('#4502: a flat fleet of 5 to 24 has no hub line through another face, at first paint and at rest', () => {
  for (let n = 5; n <= 24; n += 1) {
    const placed = flatFleet(n);
    const fp = firstPaint(placed);
    assert.deepEqual(nearPasses(fp.bodies, fp.hub), [], n + ' agents: a line runs through a face at first paint');
    const rest = settle(placed);
    assert.deepEqual(nearPasses(rest.bodies, rest.hub), [], n + ' agents: a line runs through a face at rest');
  }
});

test('#4502: the second lane sits in the first lane\'s gaps (midway between two first-lane agents)', () => {
  for (const n of [13, 17, 20, 24]) {
    const spots = [...flatFleet(n).values()];
    const r0 = Math.min(...spots.map((s) => s.r));
    const first = spots.filter((s) => s.r === r0).map((s) => s.ang);
    const step = (2 * Math.PI) / first.length;
    for (const s of spots.filter((x) => x.r > r0)) {
      const off = ((((s.ang - first[0]) % step) + step) % step);
      assert.ok(Math.abs(off - step / 2) < 1e-9, n + ' agents: a second-lane agent is not midway in a gap');
    }
  }
});

test('#4502: the physics keeps lines a face plus 4px off (ORG_SIM.clearReach is ORG_FACE_R + 4)', () => {
  assert.equal(sim.ORG_SIM.clearReach, FACE + 4, 'the clearance and the face radius drifted apart');
});

test('#4502: an agent joining a settled flat chart (the others keep their spots) leaves at most 2 near passes, 6 to 24', () => {
  let total = 0; const where = [];
  for (let n = 6; n <= 24; n += 1) {
    const cards = flatCards(n);
    const prev = settle(placeOf(cards.slice(0, n - 1)));
    const kept = new Map(prev.bodies.map((b) => [b.key, { x: b.x - prev.hub.x, y: b.y - prev.hub.y }]));
    const rest = settle(placeOf(cards), 1, kept);
    const bad = nearPasses(rest.bodies, rest.hub).length;
    total += bad;
    if (bad) where.push(n + ':' + bad);
  }
  // Measured 2 (at 23 agents). Before this change, up to 9 per size; with the gentler 0.12 push, 12 in all.
  assert.ok(total <= 2, 'growth leaves ' + total + ' near passes at rest: ' + where.join(' '));
});

test('#4502: a chart squeezed to 0.9 for a narrower view is still clean at rest, 5 to 24', () => {
  for (let n = 5; n <= 24; n += 1) {
    const rest = settle(flatFleet(n), 0.9);
    assert.deepEqual(nearPasses(rest.bodies, rest.hub), [], n + ' agents at 0.9: a line runs through a face at rest');
  }
});
