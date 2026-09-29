'use strict';

/**
 * kosmos#4472: the org chart's size for big teams, pinned.
 *
 * #4434 made the chart cross-free by giving each branch its own sector, but a big team then grew one ring until its
 * reports were ORG_MIN_ARC apart: a lead with 30 reports went from 660px to 1410px, a deep 100-agent tree's median
 * from 1432px to 3232px. #4472 brings them down five ways, each measured, none allowed to cost a crossing:
 *   1. a team with no managers in it takes two staggered rings, each outer face on the line from the manager
 *      through the midpoint between two inner faces;
 *   2. a manager's reports are ordered heaviest and lightest alternating, so two light ones are not side by side;
 *   3. the first and last report's slice runs on to the edges of the manager's slice;
 *   4. each team sits at its own radius, pushed out only until it is clear of every face already placed;
 *   5. and until each of its branches has room for its leaves further out (without that, single trees grew to
 *      2.4x #4473's size).
 *
 * Sizes are the natural square (maxR + ORG_PAD) * 2 of orgPlace's first paint, as paintOrg draws it when nothing has
 * to fit. The ceilings sit a little above the measured values, so an unrelated change does not trip them, while a
 * change that gives the win back does.
 */

require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orglanes-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-orglanes-w-'));
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
/* The seeded generator web.org-sectors-4434.test.js uses; 5% on the first ring makes the trees deep. */
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
const segDist = (q, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
};

test('a lead with 30 reports, and one with 50: the natural size stays near its pre-#4434 size (#4472)', () => {
  /* Measured: 30 reports 660 before #4434, 1410 with it, 974 now; 50 reports 776, 2290, 1362. */
  const t30 = paint(lead(30));
  const t50 = paint(lead(50));
  assert.ok(t30.size <= 1000, 'a lead with 30 reports is ' + t30.size + 'px, over 1000 (#4434 alone: 1410)');
  assert.ok(t50.size <= 1400, 'a lead with 50 reports is ' + t50.size + 'px, over 1400 (#4434 alone: 2290)');
  /* CONTROL: the two rings are in use; without them the 30 would sit on one ring at #4434's size. */
  const lanes = new Set([...t30.pos.values()].filter((p) => p.parent).map((p) => p.lane));
  assert.deepEqual([...lanes].sort(), [0, 1], 'CONTROL: the 30 reports are not on two rings, so this tests nothing');
});

test('a small team is no bigger than on main: two rings only when they beat one (#4472)', () => {
  /* Post-rebase review 3: two rings were taken whenever one ring was too tight at the trial radius, so a lead with
     10 reports grew from main's 576px to 668. Measured on main / now: 10 reports 576 / 576, 11 624 / 624, 12 656 / 656,
     13 704 / 668. */
  for (const [n, main] of [[10, 576], [11, 624], [12, 656], [13, 704]]) {
    const t = paint(lead(n));
    assert.ok(t.size <= main, 'a lead with ' + n + ' reports is ' + t.size + 'px, over main\'s ' + main);
  }
  /* CONTROL: 13 is past the point where two rings win, so the guard has not simply switched two rings off. */
  const lanes = new Set([...paint(lead(13)).pos.values()].filter((p) => p.parent).map((p) => p.lane));
  assert.deepEqual([...lanes].sort(), [0, 1], 'CONTROL: a lead with 13 reports is not on two rings, so this tests nothing');
});

test('deep 100-agent trees: the median natural size over 60 seeds, and the largest (#4472)', () => {
  /* Measured over seeds 1..60, through these cards: median 1432 before #4434, 3232 with it, 2700 now; largest 2024,
     8113, 4805. (Plain cards in a different order give 2718: the heavy/light order keeps input order on ties.) The
     plan's table uses seeds 1..200 (median 1580 / 3353 / 2749): a larger sample of the same trees, not a different
     measurement; 60 seeds keep this test fast. */
  const sizes = [];
  for (let seed = 1; seed <= 60; seed += 1) sizes.push(paint(randomTree(seed, 100, 0.05)).size);
  sizes.sort((a, b) => a - b);
  assert.equal(sizes.length, 60, 'CONTROL: not every tree was measured');
  const median = (sizes[29] + sizes[30]) / 2;
  assert.ok(median <= 2800, 'the median deep tree is ' + median + 'px, over 2800 (#4434 alone: 3232)');
  assert.ok(sizes[59] <= 5300, 'the largest deep tree is ' + sizes[59] + 'px, over 5300 (#4434 alone: 8113)');
});

test('a two-ring team: every line to the outer ring clears every other face by ORG_LANE_SLOT (#4472)', () => {
  /* The first version alternated faces by slot and a line to the outer ring, which starts at the manager and not
     the hub, ran slantwise through an inner face: 0.2px from its centre in a lead with 18 reports. */
  let checked = 0;
  for (let n = 3; n <= 60; n += 1) {
    const { pos } = paint(lead(n));
    const hubLead = [...pos.values()].find((p) => !p.parent);
    for (const [name, p] of pos) {
      if (!p.lane) continue;
      for (const [other, q] of pos) {
        if (other === name || !q.parent) continue;
        const d = segDist(q, hubLead, p);
        checked += 1;
        assert.ok(d >= LANE_SLOT - 1e-6, 'lead ' + n + ': the line to ' + name + ' passes ' + d.toFixed(1) + 'px from ' + other);
      }
    }
  }
  assert.ok(checked > 1000, 'CONTROL: only ' + checked + ' line-to-face pairs on an outer ring were checked, so this tests nothing');
});

/* Several leads on the first ring, and a CEO over several managers: here a team's window is bounded by its slice,
   not by the cap as for a lone lead. Review it1 found an even-sized team there could never take two rings (its last
   outer face was aimed past the window), so one more report shrank a fleet by 40%. */
const leads = (count, n) => [].concat(...Array.from({ length: count }, (_, j) =>
  [['L' + j]].concat(Array.from({ length: n }, (_, i) => ['r' + j + '_' + i, 'L' + j]))));
const ceo = (count, n) => [['ceo']].concat(...Array.from({ length: count }, (_, j) =>
  [['M' + j, 'ceo']].concat(Array.from({ length: n }, (_, i) => ['r' + j + '_' + i, 'M' + j]))));
const outer = (t) => [...t.pos.values()].filter((p) => p.lane).length;

test('several leads, and a CEO over several managers: even and odd teams both take two rings and shrink (#4472)', () => {
  /* Measured (main / #4473 / now): 4 leads x 30: 1240 / 2558 / 1777; x 31: 1240 / 2630 / 1691.
     CEO over 4 x 20: 924 / 3506 / 2804; 4 x 21: 1040 / 3710 / 2645. */
  const cases = [['4 leads x 30', leads(4, 30), 1850], ['4 leads x 31', leads(4, 31), 1800],
    ['a CEO over 4 x 20', ceo(4, 20), 2950], ['a CEO over 4 x 21', ceo(4, 21), 2800]];
  for (const [label, spec, ceiling] of cases) {
    const t = paint(spec);
    /* Per team, not a face count: since #4499's wide window one team of a CEO over 4 x 20 fits on one ring (30 outer
       faces, not 40), and a count would pin the window's width rather than the two rings (review it1 of #4499). */
    const teamsOnTwo = new Set([...t.pos.values()].filter((p) => p.lane).map((p) => p.parent)).size;
    assert.ok(teamsOnTwo >= 3, label + ': only ' + teamsOnTwo + ' team(s) on two rings');
    assert.ok(t.size <= ceiling, label + ' is ' + t.size + 'px, over ' + ceiling);
  }
});

test('a two-ring team below the first ring: its outer lines clear every other face by ORG_LANE_SLOT (#4472)', () => {
  let checked = 0;
  for (const [count, n] of [[3, 20], [4, 20], [4, 21], [6, 12]]) {
    const { pos } = paint(ceo(count, n));
    for (const [name, p] of pos) {
      if (!p.lane) continue;
      const from = pos.get(p.parent);
      for (const [other, q] of pos) {
        if (other === name || other === p.parent) continue;
        const d = segDist(q, from, p);
        checked += 1;
        assert.ok(d >= LANE_SLOT - 1e-6, count + ' x ' + n + ': the line to ' + name + ' passes ' + d.toFixed(1) + 'px from ' + other);
      }
    }
  }
  assert.ok(checked > 1000, 'CONTROL: only ' + checked + ' line-to-face pairs on an outer ring were checked, so this tests nothing');
});
