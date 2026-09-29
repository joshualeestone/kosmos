'use strict';

/**
 * kosmos#4499: deep org charts near their pre-#4434 size, and no line within 12px of a face that is not its own.
 *
 * Main's deep 100-agent median (1580px) is its DEPTH floor: every ring one step past the last, faces allowed to
 * overlap. With no overlaps and no crossings the layout cannot sit on that floor, so #4499 aims near it: a team first
 * tries a WIDE window (no tangent cap), kept only when an exact test finds no crossing with any line already drawn,
 * no report line over the hub and every clearance met; shares below the first ring are leaf count to the 0.85; and a
 * first-ring agent that spills to a further lane finds an angle in its own slice whose hub line clears 12px.
 *
 * Sizes are the natural square (maxR + ORG_PAD) * 2 of orgPlace's first paint. Ceilings sit a little above the
 * measured values, so an unrelated change does not trip them, while a change that gives the win back does.
 */

require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-deeptrees-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-deeptrees-w-'));
const fleet = require('./test-support/fleet');
const store = require('./engine/store');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* The same boundary-anchored lift as web.org-sectors-4434.test.js, with the constants read out of the page. */
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
  const consts = ['ORG_R0', 'ORG_STEP', 'ORG_MIN_ARC', 'ORG_PAD'].map((k) => {
    const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
    assert.ok(m, k + ' is no longer declared in the page');
    return 'const ' + k + ' = ' + m[1] + ';';
  }).join('\n') + '\n';
  // eslint-disable-next-line no-new-func
  return new Function(consts + src + '\n' + tail)();
}
const page = lift(['orgTreeOf', 'orgPlace'], 'return { orgTreeOf, orgPlace, ORG_PAD, ORG_MIN_ARC };');
/* ORG_LANE_SLOT lives inside orgPlace (so the tests that lift orgPlace need no new constant); read it from there. */
const LANE_SLOT = Number((SCRIPT.match(/const\s+ORG_LANE_SLOT\s*=\s*([\d.]+)\s*;/) || [])[1]);
assert.ok(LANE_SLOT > 0, 'ORG_LANE_SLOT is no longer declared in the page');

/* Cards from the real producer (fixture-discipline refuses hand-built ones), with a per-tree name prefix. */
let TREE = 0;
function cards(spec) {
  TREE += 1;
  const pre = 't' + TREE + '_';
  for (const [name, to] of spec) if (to) store.writeProfile(pre + name, { reportsTo: pre + to });
  const board = fleet.install(spec.map(([name]) => fleet.agent(pre + name, { state: 'idle' })), { strict: false });
  try { return board.agents.slice(); } finally { board.restore(); }
}
function paint(spec) {
  const { placed } = page.orgPlace(page.orgTreeOf(cards(spec)));
  let maxR = 0;
  const pos = new Map();
  for (const [name, s] of placed) {
    maxR = Math.max(maxR, s.r);
    pos.set(name, { x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r, parent: s.node.parent || null, lane: s.lane || 0 });
  }
  return { placed, pos, size: Math.round((maxR + page.ORG_PAD) * 2) };
}
const lead = (n) => [['lead']].concat(Array.from({ length: n }, (_, i) => ['r' + i, 'lead']));
function randomTree(seed, n, pRoot) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const spec = [];
  for (let i = 0; i < n; i += 1) {
    const to = i === 0 || rnd() < pRoot ? null : 'n' + Math.floor(rnd() * i);
    spec.push(to ? ['n' + i, to] : ['n' + i]);
  }
  return spec;
}
const ceo = (count, n) => [['ceo']].concat(...Array.from({ length: count }, (_, j) =>
  [['M' + j, 'ceo']].concat(Array.from({ length: n }, (_, i) => ['r' + j + '_' + i, 'M' + j]))));
const segDist = (q, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
};
/* A PROPER crossing, as web.org-sectors-4434.test.js counts one. */
const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
function cross(s, t) {
  if (same(s.a, t.a) || same(s.a, t.b) || same(s.b, t.a) || same(s.b, t.b)) {
    const shared = same(s.a, t.a) || same(s.a, t.b) ? s.a : s.b;
    const so = same(shared, s.a) ? s.b : s.a;
    const to = same(shared, t.a) ? t.b : t.a;
    if (Math.abs(orient(shared, so, to)) > 1e-6) return false;
    return (so.x - shared.x) * (to.x - shared.x) + (so.y - shared.y) * (to.y - shared.y) > 0;
  }
  const side = (v, g) => { const e = 1e-9 * ((g.b.x - g.a.x) ** 2 + (g.b.y - g.a.y) ** 2); return v > e ? 1 : (v < -e ? -1 : 0); };
  return side(orient(t.a, t.b, s.a), t) * side(orient(t.a, t.b, s.b), t) < 0
    && side(orient(s.a, s.b, t.a), s) * side(orient(s.a, s.b, t.b), s) < 0;
}
/* Every line (hub or manager to report) of a painted chart. */
const linesOf = (pos) => [...pos].map(([name, p]) => ({ name, parent: p.parent, a: p.parent ? pos.get(p.parent) : { x: 0, y: 0 }, b: p }));

test('deep 100-agent trees: the median and the largest natural size over 60 seeds (#4499)', () => {
  /* Measured over seeds 1..60, through these cards: median 1432 before #4434 (its depth floor), 3232 with it, 2700
     with #4472, 1930 now; largest 2024, 8113, 4805, 2809. */
  const sizes = [];
  for (let seed = 1; seed <= 60; seed += 1) sizes.push(paint(randomTree(seed, 100, 0.05)).size);
  sizes.sort((a, b) => a - b);
  assert.equal(sizes.length, 60, 'CONTROL: not every tree was measured');
  const median = (sizes[29] + sizes[30]) / 2;
  assert.ok(median <= 2000, 'the median deep tree is ' + median + 'px, over 2000 (#4472: 2700)');
  assert.ok(sizes[59] <= 3000, 'the largest deep tree is ' + sizes[59] + 'px, over 3000 (#4472: 4805)');
});

test('a lead with 30 and 50 reports, and a CEO over 4 x 20, shrink with the wide window (#4499)', () => {
  /* Measured (#4472 / now): lead 30: 974 / 828; lead 50: 1362 / 1016; CEO over 4 x 20: 2804 / 2061. */
  for (const [label, spec, ceiling] of [['a lead with 30', lead(30), 870], ['a lead with 50', lead(50), 1070], ['a CEO over 4 x 20', ceo(4, 20), 2150]]) {
    const t = paint(spec);
    assert.ok(t.size <= ceiling, label + ' is ' + t.size + 'px, over ' + ceiling);
  }
});

test('no line within 12px of a face that is not one of its ends, first ring included; none over the hub; none crossing (#4499)', () => {
  /* On #4473 the least was 5.5px (a first-ring spill), on #4472 10.55px. A crowded first ring (dozens of agents on
     several lanes, each full inner lane ruling out ~139 degrees for a hub line) now meets it by starting further out,
     which costs size there (measured: 1000 agents at 30% first ring, mean 13,323 -> 15,769 against #4472). */
  let checked = 0; let least = Infinity; let where = ''; let hub = Infinity; let crossings = 0;
  const specs = [];
  for (const n of [30, 60, 100]) for (const p of [0.05, 0.33]) for (let seed = 1; seed <= 12; seed += 1) specs.push(['randomTree(' + seed + ', ' + n + ', ' + p + ')', randomTree(seed, n, p)]);
  for (let n = 2; n <= 60; n += 2) specs.push(['lead ' + n, lead(n)]);
  specs.push(['a CEO over 4 x 20', ceo(4, 20)], ['a CEO over 6 x 12', ceo(6, 12)]);
  for (const [label, spec] of specs) {
    const { pos } = paint(spec);
    const lines = linesOf(pos);
    for (const g of lines) {
      if (g.parent) hub = Math.min(hub, segDist({ x: 0, y: 0 }, g.a, g.b));
      for (const [other, q] of pos) {
        if (other === g.name || other === g.parent) continue;
        const d = segDist(q, g.a, g.b);
        checked += 1;
        if (d < least) { least = d; where = label + ': the line to ' + g.name + ' past ' + other; }
      }
    }
    for (let i = 0; i < lines.length; i += 1) for (let j = i + 1; j < lines.length; j += 1) if (cross(lines[i], lines[j])) crossings += 1;
  }
  assert.ok(checked > 100000, 'CONTROL: only ' + checked + ' line-to-face pairs were checked');
  assert.ok(least >= 12, 'a line passes ' + least.toFixed(1) + 'px from a face (' + where + ')');
  assert.ok(hub >= 74, 'a report line passes ' + hub.toFixed(1) + 'px from the hub centre');
  assert.equal(crossings, 0, crossings + ' crossing(s)');
});

test('the exact crossing test: a tree that crosses without it does not cross (#4499)', () => {
  /* Measured: with the exact test removed from orgPlace, randomTree(3, 200, 0.01) has 2 crossings (the smallest such
     tree found in 750 of 100 to 250 agents); the wide window alone does not rule them out. */
  const { pos } = paint(randomTree(3, 200, 0.01));
  const lines = linesOf(pos);
  assert.equal(lines.length, 200, 'CONTROL: every agent has a line');
  let crossings = 0;
  for (let i = 0; i < lines.length; i += 1) for (let j = i + 1; j < lines.length; j += 1) if (cross(lines[i], lines[j])) crossings += 1;
  assert.equal(crossings, 0, crossings + ' crossing(s) in randomTree(3, 200, 0.01)');
});

test('the layout stays within its speed budget: 1000 agents in well under 150ms, a tree and a crowded first ring (#4499)', () => {
  /* orgPlace runs on every repaint (each 5s poll and each drag's rest). Measured on the Mac mini: 1000 agents ~21ms
     (#4472: 17.6ms); an early #4499 version without the per-team filters took 160ms. 150ms is headroom for a slower
     machine or a busy CI box, not a target: it catches a change of order, not of a few ms. Median of 5 runs. */
  /* Two shapes: a deep tree, and a crowded first ring (1000 agents with no manager plus one small team), where the
     first-ring search once checked every face for every agent on every lane and took 481ms (review it1; now ~40ms,
     #4472 ~14ms). */
  const flatPlusTeam = [['lead'], ['a', 'lead'], ['b', 'lead'], ['c', 'lead']].concat(Array.from({ length: 1000 }, (_, i) => ['f' + i]));
  for (const [label, spec] of [['a 1000-agent tree', randomTree(1, 1000, 0.05)], ['1000 agents with no manager and one team', flatPlusTeam]]) {
    const agents = page.orgTreeOf(cards(spec));
    page.orgPlace(agents);
    const ms = [];
    for (let i = 0; i < 5; i += 1) {
      const t = process.hrtime.bigint();
      page.orgPlace(agents);
      ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    ms.sort((a, b) => a - b);
    assert.ok(ms[2] < 150, 'orgPlace on ' + label + ' took ' + ms[2].toFixed(1) + 'ms (median of 5), over 150ms');
  }
});
