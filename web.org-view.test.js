'use strict';

/**
 * The org view's tree and placement (#137).
 *
 * 🛑 THESE TWO FUNCTIONS SHIPPED WITH NO TEST AT ALL. They were verified in a
 * browser, which proved the picture on ONE board -- fourteen agents, nobody
 * assigned. Every branch that matters is invisible on that board: a cycle, a
 * manager who has been removed, a ring that fills, a chain three deep. A
 * screenshot of the easy case is not coverage of the hard ones.
 *
 * 🔑 AND THE CYCLE ONE IS NOT COSMETIC. `reportsTo` is refused both places a
 * person can set it, but a hand-edited profile file is refused nowhere, and a
 * walk with no seen-set over that data recurses until the tab dies. A guard
 * was written for it and had never once been exercised.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sandboxed before the fleet loads: it writes worker folders and reads a data
   root, and neither belongs to a test about polar coordinates. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-org-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-org-w-'));
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* Boundary-anchored, for the reason server.test.js records: a sibling whose
   name merely starts with the wanted one silently captures the extractor. */
function lift(names, tail) {
  const src = names.map((name) => {
    let at = SCRIPT.indexOf('function ' + name + '(');
    assert.ok(at > -1, name + ' vanished from the page');
    let depth = 0; let end = -1;
    for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
      if (SCRIPT[k] === '{') depth += 1;
      else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
    }
    return SCRIPT.slice(at, end);
  }).join('\n');
  /* ⚠️ READ OUT OF THE BUILD, never restated here. An earlier draft of this
     file hard-coded `150 / 96 / 62`, which is a copy: the day somebody widens
     the first ring, the copy keeps the old number and every placement test
     goes on passing against a geometry the product no longer has. Lifting the
     declarations means a changed constant reaches the tests. */
  const consts = ['ORG_R0', 'ORG_STEP', 'ORG_MIN_ARC'].map((k) => {
    const m = SCRIPT.match(new RegExp('const\\s+' + k + '\\s*=\\s*([-\\d.]+)\\s*;'));
    assert.ok(m, k + ' is no longer declared in the page');
    return 'const ' + k + ' = ' + m[1] + ';';
  }).join('\n') + '\n';
  // eslint-disable-next-line no-new-func
  return new Function(consts + src + '\n' + tail)();
}

const tree = lift(['orgTreeOf'], 'return orgTreeOf;');
const place = lift(['orgTreeOf', 'orgPlace'],
  'return { orgTreeOf, orgPlace, ORG_R0, ORG_STEP, ORG_MIN_ARC };');

/**
 * Inputs come from the REAL producers, and the field names are pinned to them.
 *
 * 🔑 `fixture-discipline.test.js` refuses hand-built cards, and it is right to:
 * a literal is free to carry fields `snapshot()` never emits, and a test built
 * on one proves nothing about production. So the cards here come from
 * `fleet.install()` and the `reportsTo` on them is written through the real
 * `store.writeProfile`, which is the same path `createAgent` uses.
 *
 * 🛑 BUT THE STRICT WRAPPER CANNOT BE LEFT ON FOR THE LAYOUT TESTS, and the
 * reason is worth stating rather than working around. `create.js` writes
 * `reportsTo` into a profile ONLY when one was chosen, so an unassigned
 * agent's profile genuinely does not contain the key. The wrapper throws on
 * any field the producer did not emit, which is precisely what makes it
 * valuable -- and it cannot tell a legitimately absent OPTIONAL field from a
 * misspelled one. Under strict mode the product's own correct read throws on
 * the commonest board there is: a fresh install where nobody is assigned.
 *
 * So the protection is bought back where it can be exact, in `pins` below:
 * ONE strict test proves `sessionName` and `profile.reportsTo` are the names
 * the producer really uses, against a profile written by the real writer. The
 * layout tests then run unstrict, on cards from the same producer. A typo in
 * either field name fails `pins`; the geometry tests stay able to model an
 * absent manager, which is the case that matters most.
 */
const store = require('./engine/store');

const build = (specs, opts) => {
  for (const sp of specs) if (sp.to) store.writeProfile(sp.name, { reportsTo: sp.to });
  const board = fleet.install(
    specs.map((sp) => fleet.agent(sp.name, { state: 'idle' })),
    opts,
  );
  try {
    const byName = Object.fromEntries(board.agents.map((c) => [c.sessionName, c]));
    return specs.map((sp) => {
      assert.ok(byName[sp.name], 'the fleet produced no card for ' + sp.name);
      return byName[sp.name];
    });
  } finally { board.restore(); }
};

/* Unstrict, for the reason written above. */
const agents = (...specs) => build(specs, { strict: false });
const a = (name, to) => ({ name, to });

test('the producer emits the two fields the org view reads', () => {
  /* Strict ON. This is the one test that can afford it, and it is the one that
     makes the rest honest: if `snapshot()` ever renames either field, or if
     `writeProfile` stops landing in `profile`, this fails by name. */
  const [boss, kid] = build([a('theboss'), a('thekid', 'theboss')]);

  assert.equal(kid.sessionName, 'thekid', 'the card names its session `sessionName`');
  assert.equal(kid.profile.reportsTo, 'theboss',
    'a profile written by the real writer reaches the card as `profile.reportsTo`');

  /* And the absent case is asserted WITHOUT reading the key, since reading it
     is what the wrapper refuses. `Object.keys` goes through a different trap. */
  assert.ok(!Object.keys(boss.profile || {}).includes('reportsTo'),
    'an unassigned agent has no reportsTo, which is why the layout tests run unstrict');
});

test('nobody assigned puts everyone on the first ring', () => {
  const out = tree(agents(a('a'), a('b'), a('c')));
  assert.deepEqual(out.map((n) => n.depth), [0, 0, 0]);
  assert.deepEqual(out.map((n) => n.parent), [null, null, null]);
});

test('a chain runs outward, one ring per step', () => {
  const out = tree(agents(a('a'), a('b', 'a'), a('c', 'b')));
  const byName = Object.fromEntries(out.map((n) => [n.agent.sessionName, n]));
  assert.equal(byName.a.depth, 0);
  assert.equal(byName.b.depth, 1);
  assert.equal(byName.c.depth, 2);
  assert.equal(byName.c.parent, 'b');
});

test('a manager who is not on the board is no manager', () => {
  /* ⚠️ Otherwise the agent hangs off a node that is not drawn and vanishes from
     the picture entirely. Back to the first ring is the truth: nothing above it
     exists here. */
  const out = tree(agents(a('a', 'departed')));
  assert.equal(out.length, 1);
  assert.equal(out[0].depth, 0);
  assert.equal(out[0].parent, null);
});

test('an agent reporting to itself is not a manager either', () => {
  const out = tree(agents(a('a', 'a')));
  assert.equal(out[0].depth, 0, 'a self-report made a ring of one');
});

test('a CYCLE terminates, and draws everybody exactly once', () => {
  /**
   * 🛑 THE ONE THAT WOULD KILL THE TAB. Both write paths refuse a self-loop,
   * and neither can refuse `a -> b -> a` written into the profile files by
   * hand. A walk with no seen-set recurses forever on that.
   *
   * ⚠️ AND EVERY AGENT MUST STILL APPEAR. An agent missing from a picture is
   * the one failure a picture cannot admit to: there is no empty space that
   * says "somebody is not drawn here".
   */
  const out = tree(agents(a('a', 'b'), a('b', 'a'), a('c')));
  const names = out.map((n) => n.agent.sessionName).sort();
  assert.deepEqual(names, ['a', 'b', 'c'], 'a cycle swallowed an agent');
  assert.equal(new Set(names).size, 3, 'an agent was drawn twice');
});

test('a three-way cycle also terminates', () => {
  const out = tree(agents(a('a', 'b'), a('b', 'c'), a('c', 'a')));
  assert.deepEqual(out.map((n) => n.agent.sessionName).sort(), ['a', 'b', 'c']);
});

test('an agent listed twice is drawn once, not stacked on itself', () => {
  /**
   * 🔑 THIS IS WHAT THE SEEN-SET IN `walk` ACTUALLY GUARDS, and it took a
   * mutation to find out. Removing that check leaves every cycle test green,
   * because a cycle never enters the recursion: the walk starts at agents with
   * no manager, each agent has at most one manager, so the reachable graph is
   * a tree and no node can be arrived at twice.
   *
   * A REPEATED NAME is the case that reaches it, and it is not exotic -- a
   * tmux session with two panes produces two cards with one sessionName.
   * Drawn twice, the second node lands exactly on the first, which reads as
   * one agent while the roster count says otherwise.
   */
  const [one] = agents(a('twinned'));
  const out = tree([one, one]);

  assert.equal(out.length, 1, 'the same agent was placed ' + out.length + ' times');
  assert.equal(out[0].agent.sessionName, 'twinned');

  const { placed } = place.orgPlace(place.orgTreeOf([one, one]));
  assert.equal(placed.size, 1, 'two nodes were drawn for one agent');
});

test('a crowded ring spills outward instead of overlapping', () => {
  /**
   * 🔑 EVERYBODY'S FIRST ORG CHART IS THIS. A fleet starts with nobody
   * assigned, so "everyone on ring one" is the FIRST screen anyone sees, not an
   * edge case. Circumference is finite: the first ring holds however many
   * minimum-arcs fit around it, and thirty is comfortably more than that at
   * any ring size this product has shipped.
   */
  const many = agents(...Array.from({ length: 30 }, (_, i) => a('a' + i)));
  const { placed, maxR } = place.orgPlace(place.orgTreeOf(many));
  assert.equal(placed.size, 30, 'an agent was dropped');
  /* ⚠️ AGAINST THE LIFTED CONSTANT, not against `150`. Written as a literal
     this assertion passed with the first ring widened to 400px -- where thirty
     nodes fit on one ring comfortably and NOTHING SPILLS, which is the exact
     behaviour the test is named for. A literal here does not merely go stale,
     it inverts: the bigger the ring grows, the more certainly `maxR > 150`
     holds while the property stops being true. */
  assert.ok(maxR > place.ORG_R0,
    'thirty nodes stayed on the first ring (maxR ' + maxR + ', R0 ' + place.ORG_R0 + ')');

  /* The real assertion: no two nodes closer than a node's width. Positions are
     polar, so this is the same arithmetic the browser check does on rects. */
  const pts = [...placed.values()].map((s) => ({
    x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r,
  }));
  let tooClose = 0;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 46) tooClose += 1;
    }
  }
  assert.equal(tooClose, 0, tooClose + ' pairs of nodes overlap');
});

test('a child sits near its parent rather than wherever its index falls', () => {
  /* A chain must run outward ALONG ITS OWN BRANCH; scattering children by index
     is what makes a radial chart unreadable. */
  const { placed } = place.orgPlace(place.orgTreeOf(
    agents(a('p1'), a('p2'), a('p3'), a('p4'), a('kid', 'p1')),
  ));
  const parent = placed.get('p1');
  const kid = placed.get('kid');
  const diff = Math.abs(((kid.ang - parent.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(diff < 0.35, 'the child was placed away from its parent, angle gap ' + diff.toFixed(2));
  assert.ok(kid.r > parent.r, 'the child is not further out than its parent');
});

test('an empty board places nothing and does not throw', () => {
  const { placed } = place.orgPlace(place.orgTreeOf([]));
  assert.equal(placed.size, 0);
});

/* ---- the organic layer (#285) -------------------------------------------- */
const sim = (() => {
  const at = SCRIPT.indexOf('const ORG_SIM = {');
  const end = SCRIPT.indexOf('let ORG_LIVE = null;');
  assert.ok(at > -1 && end > at, 'the simulation left the page');
  const m = SCRIPT.match(/const\s+ORG_STEP\s*=\s*([-\d.]+)\s*;/);
  // eslint-disable-next-line no-new-func
  return new Function('const ORG_STEP = ' + m[1] + ';\n' + SCRIPT.slice(at, end) + '\nreturn { orgStep, ORG_SIM };')();
})();
function fleetOf(n, ring, hub) {
  const nodes = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    nodes.push({ x: hub.x + Math.cos(a) * ring, y: hub.y + Math.sin(a) * ring, vx: 0, vy: 0, ring, parent: null, fixed: false });
  }
  return nodes;
}
function settle(nodes, hub, box, alpha = 1, steps = 400) {
  let a = alpha;
  for (let t = 0; t < steps; t += 1) { sim.orgStep(nodes, hub, a, box); a *= 0.985; }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('the simulation keeps depth: a settled node stays near the ring it was born on, and a child stays outside its parent', () => {
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  const nodes = fleetOf(6, 120, hub);
  const kid = { x: hub.x + 194, y: hub.y, vx: 0, vy: 0, ring: 194, parent: nodes[0], fixed: false };
  nodes.push(kid);
  settle(nodes, hub, { lo: 30, hi: 570 });
  for (const n of nodes.slice(0, 6)) {
    const d = dist(n, hub);
    assert.ok(Math.abs(d - 120) < 35, 'a first-ring node drifted to ' + d.toFixed(0) + ' from its ring at 120');
  }
  assert.ok(dist(kid, hub) > dist(nodes[0], hub) + 30, 'the child is no longer further out than its parent');
});

test('nothing overlaps after settling, and nothing leaves the box', () => {
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  // Everyone starts on the same spot: the worst case for repulsion.
  const nodes = fleetOf(10, 120, hub).map((n) => ({ ...n, x: 301, y: 299 }));
  settle(nodes, hub, { lo: 30, hi: 570 });
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      assert.ok(dist(nodes[i], nodes[j]) >= sim.ORG_SIM.minGap * 0.8, 'two nodes ended up on top of each other');
    }
    assert.ok(nodes[i].x >= 30 && nodes[i].x <= 570 && nodes[i].y >= 30 && nodes[i].y <= 570, 'a node left the canvas');
  }
});

test('dragging the hub carries the rings with it, and a dragged node is pinned until released', () => {
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  const nodes = fleetOf(6, 120, hub);
  settle(nodes, hub, { lo: 30, hi: 570 });
  const before = nodes.map((n) => ({ x: n.x, y: n.y }));
  // Grab the hub and move it: the grabbed body is fixed, the rest follows.
  hub.fixed = true; hub.x = 160; hub.y = 160;
  settle(nodes, hub, { lo: 30, hi: 570 }, 0.6, 300);
  assert.equal(hub.x, 160, 'the pinned hub moved under simulation');
  const centroid = nodes.reduce((c, n) => ({ x: c.x + n.x / nodes.length, y: c.y + n.y / nodes.length }), { x: 0, y: 0 });
  assert.ok(dist(centroid, hub) < 40, 'the rings did not follow the hub; centroid is ' + dist(centroid, hub).toFixed(0) + ' away');
  assert.ok(nodes.some((n, i) => dist(n, before[i]) > 60), 'nothing moved when the hub was dragged');
  // Release: the hub drifts home, the rest follow.
  hub.fixed = false;
  settle(nodes, hub, { lo: 30, hi: 570 }, 0.5, 600);
  assert.ok(dist(hub, hub.home) < 25, 'a released hub did not settle back toward its home; at ' + dist(hub, hub.home).toFixed(0));
});

test('a still step produces no motion: alpha zero is the reduced-motion state', () => {
  const hub = { x: 300, y: 300, vx: 0, vy: 0, fixed: false, home: { x: 300, y: 300 } };
  const nodes = fleetOf(4, 120, hub);
  const moved = sim.orgStep(nodes, hub, 0, { lo: 30, hi: 570 });
  assert.equal(moved, 0);
});

test('children are angled among their SIBLINGS, not among every cousin at that depth (#352)', () => {
  /* Two managers on the first ring, two children each. With the angle derived
     from a child's index among all four cousins, the children interleave
     across both parents' arcs; derived among siblings, each pair sits inside
     its own parent's spread. */
  const { placed } = place.orgPlace(place.orgTreeOf(
    agents(a('m1'), a('m2'), a('m3'), a('m4'), a('k1', 'm1'), a('k2', 'm1'), a('k3', 'm3'), a('k4', 'm3')),
  ));
  const gap = (x, y) => Math.abs(((placed.get(x).ang - placed.get(y).ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  for (const [kid, parent] of [['k1', 'm1'], ['k2', 'm1'], ['k3', 'm3'], ['k4', 'm3']]) {
    assert.ok(gap(kid, parent) < 0.7, `${kid} was angled away from its parent ${parent} by ${gap(kid, parent).toFixed(2)} rad`);
  }
  // And two siblings do not share a spoke.
  assert.ok(gap('k1', 'k2') > 0.2, 'two siblings were placed on the same spoke');
  assert.ok(gap('k3', 'k4') > 0.2, 'two siblings were placed on the same spoke');
  // Each pair is CENTRED on its parent: the defect's visible form was a bias,
  // every child pushed to one side of its manager by its index among cousins.
  const mid = (x, y, p) => {
    const ax = placed.get(x).ang; const ay = placed.get(y).ang; const ap = placed.get(p).ang;
    return Math.abs(((ax + ay) / 2 - ap + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  };
  assert.ok(mid('k1', 'k2', 'm1') < 0.05, 'm1\'s children are not centred on m1');
  assert.ok(mid('k3', 'k4', 'm3') < 0.05, 'm3\'s children are not centred on m3');
  /* The sharpest form: one child each. With the angle derived among cousins,
     a lone child sits at the EDGE of its parent's arc (idx 0 of 2) rather
     than straight out from it. */
  const lone = place.orgPlace(place.orgTreeOf(
    agents(a('m1'), a('m2'), a('m3'), a('m4'), a('c1', 'm1'), a('c3', 'm3')),
  )).placed;
  const g = (x, y) => Math.abs(((lone.get(x).ang - lone.get(y).ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(g('c1', 'm1') < 0.05, 'a lone child is off to the side of its parent by ' + g('c1', 'm1').toFixed(2) + ' rad');
  assert.ok(g('c3', 'm3') < 0.05, 'a lone child is off to the side of its parent by ' + g('c3', 'm3').toFixed(2) + ' rad');
});

test('the callout shows the name, the title small, and a chevron; the verb lives in the accessible name only (#392)', () => {
  /* Josh, after the drag fix: "write their name. Underneath, real small,
     their title, with a little right arrow or chevron... We get rid of the
     word Open." The verb stays in aria-label, because a chevron is invisible
     to a screen reader and this button is the only focusable way into an
     agent from the chart (:1120 records what retiring a verb cost once). */
  const at = SCRIPT.indexOf("'<span class=\"callout\">");
  assert.ok(at > -1, 'the callout markup moved');
  const node = SCRIPT.slice(SCRIPT.lastIndexOf("nodes.push(", at), at + 600);
  assert.match(node, /aria-label="Open ' \+ esc\(shown\)/, 'the accessible name lost its verb');
  assert.match(node, /class="co-name">' \+ esc\(shown\)/, 'the name is not in the callout');
  assert.match(node, /class="co-role">' \+ esc\(roleLine\(a, ROLE_TITLES\)\)/, 'the title is not in the callout');
  assert.match(node, /class="co-go" aria-hidden="true">&rsaquo;/, 'the chevron is missing or read aloud');
  assert.doesNotMatch(node, /callout">Open /, 'the visible word Open is back');
});

test('the flat-fleet hint stays removed (Josh, 2026-08-31): a deletion needs an absence guard', () => {
  /* The flat-fleet org-chart hint was removed at Josh's request. Guard the MECHANISM, not
     the string: the removal's own comment quotes the old line for the record, so a
     whole-file string search would match that documentation. anyManaged was the hint's
     ONLY reader, so its absence plus the note render staying the simplified two-branch
     form (empty fallback, no anyManaged arm) is the durable signal that an older branch
     has not re-added the hint. A removal with no assertion is undone silently. */
  const paint = SCRIPT.slice(SCRIPT.indexOf('function paintOrg'), SCRIPT.indexOf('function orgLiveStart'));
  assert.doesNotMatch(paint, /anyManaged/, 'anyManaged was the removed hint\'s only reader; it stays gone');
  assert.match(paint, /note\.textContent = unplaced > 0[\s\S]{0,120}: '';/,
    'the flat-fleet case renders an empty note, with no re-added hint arm');
  assert.match(paint, /could not be placed/, 'control: the unplaced branch the removal kept is still present');
});
