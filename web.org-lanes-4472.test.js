'use strict';

/**
 * kosmos#4472: the org chart's size for big teams, pinned.
 *
 * #4434 made the chart cross-free by giving each branch its own sector, but a big team then grew one ring until its
 * reports were ORG_MIN_ARC apart: a lead with 30 reports went from 660px to 1410px, a deep 100-agent tree's median
 * from 1432px to 3232px. #4472 brings them down three ways, each measured, none allowed to cost a crossing:
 *   1. a team with no managers in it takes two staggered rings, each outer face on the line from the manager
 *      through the midpoint between two inner faces;
 *   2. a manager's reports are ordered heaviest and lightest alternating, so two light ones are not side by side;
 *   3. each team sits at its own radius, pushed out only until it is clear of every face already placed.
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

test('deep 100-agent trees: the median natural size over 60 seeds, and the largest (#4472)', () => {
  /* Measured over seeds 1..60: median 1432 before #4434, 3232 with it, 2730 now; largest 2024, 8113, 6008. */
  const sizes = [];
  for (let seed = 1; seed <= 60; seed += 1) sizes.push(paint(randomTree(seed, 100, 0.05)).size);
  sizes.sort((a, b) => a - b);
  assert.equal(sizes.length, 60, 'CONTROL: not every tree was measured');
  const median = (sizes[29] + sizes[30]) / 2;
  assert.ok(median <= 2850, 'the median deep tree is ' + median + 'px, over 2850 (#4434 alone: 3232)');
  assert.ok(sizes[59] <= 6500, 'the largest deep tree is ' + sizes[59] + 'px, over 6500 (#4434 alone: 8113)');
});

test('a two-ring team: every line to the outer ring clears every other face by half ORG_MIN_ARC (#4472)', () => {
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
        assert.ok(d >= page.ORG_MIN_ARC / 2 - 1e-6, 'lead ' + n + ': the line to ' + name + ' passes ' + d.toFixed(1) + 'px from ' + other);
      }
    }
  }
  assert.ok(checked > 1000, 'CONTROL: only ' + checked + ' line-to-face pairs on an outer ring were checked, so this tests nothing');
});
