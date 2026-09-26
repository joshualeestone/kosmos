'use strict';

/**
 * #4040: an org chart wire stops at each node's picture instead of running to its centre, so it never
 * crosses a swarm cluster (which has no opaque disc behind it). The browser check (render-swarm-ui-3564.js
 * S40) measures one branch as drawn; this sweeps the geometry itself, every helper count and every
 * direction, which no single drawn branch can.
 *
 * It lifts the production orgReach, orgWireEnds and swarmLayout out of web/index.html (not copies: a copy
 * would drift) and asserts, for a swarm of 2 to 10 helpers seen from every whole degree:
 *   - the rest of the wire, from the cut outward, crosses no circle's face (it may graze an edge);
 *   - the cut never runs past the cluster's outline;
 * and that a disc is cut at its edge, the hub at its centre, and nodes whose pictures meet get no wire.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

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

function lift() {
  const from = PAGE.indexOf('const ORG_FACE_PX = ');
  assert.notEqual(from, -1, 'ORG_FACE_PX not found');
  const to = PAGE.indexOf('const ORG_LAYOUT_BY_MAX = ');
  const consts = PAGE.slice(from, PAGE.indexOf('\n', to));
  const src = [extractFn(PAGE, 'function swarmLayout('), consts, extractFn(PAGE, 'function orgReach('), extractFn(PAGE, 'function orgWireEnds(')].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('SWARMS_ON', src + '\nreturn { swarmLayout, orgReach, orgWireEnds, ORG_FACE_PX };')(true);
}

const G = lift();
const swarm = (n) => ({ swarm: { maxHelpers: n } });
/* The drawn circles of an n-helper cluster, in px about the node's centre. */
function circles(n) {
  const L = G.swarmLayout(n);
  return L.p.map((q) => ({ x: (q[0] - 0.5) * G.ORG_FACE_PX, y: (q[1] - 0.5) * G.ORG_FACE_PX, r: L.r * G.ORG_FACE_PX }));
}
/* Nearest approach of the ray from distance `from` outward (along ux, uy) to a circle's centre. */
function nearest(c, ux, uy, from) {
  const t = Math.max(from, c.x * ux + c.y * uy);
  return Math.hypot(c.x - ux * t, c.y - uy * t);
}

test('#4040: from every direction, the rest of a wire crosses no circle of a 2 to 10 helper cluster', () => {
  const into = [];
  let checked = 0;
  for (let n = 2; n <= 10; n += 1) {
    const cs = circles(n);
    for (let deg = 0; deg < 360; deg += 1) {
      const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      const cut = G.orgReach(swarm(n), ux, uy);
      for (const c of cs) {
        checked += 1;
        /* 1.5px: the wire may graze a circle's edge stroke, never cross into its face. */
        if (nearest(c, ux, uy, cut) < c.r - 1.5) into.push(n + ' helpers at ' + deg + ' deg: ' + nearest(c, ux, uy, cut).toFixed(1) + ' < ' + c.r.toFixed(1));
      }
    }
  }
  assert.ok(checked > 10000, 'the sweep checked almost nothing: ' + checked);
  assert.deepEqual(into.slice(0, 5), [], into.length + ' wire ends inside a face');
});

test('#4040: a wire is never cut past the cluster\'s outline, and a disc is cut at its edge', () => {
  for (let n = 2; n <= 10; n += 1) {
    const outline = Math.max(...circles(n).map((c) => Math.hypot(c.x, c.y) + c.r));
    for (let deg = 0; deg < 360; deg += 5) {
      const a = deg * Math.PI / 180;
      const cut = G.orgReach(swarm(n), Math.cos(a), Math.sin(a));
      assert.ok(cut <= outline + 0.01, n + ' helpers at ' + deg + ' deg: cut ' + cut.toFixed(1) + ' past the outline ' + outline.toFixed(1));
    }
  }
  assert.equal(G.orgReach({ name: 'plain' }, 1, 0), G.ORG_FACE_PX / 2);
  assert.equal(G.orgReach({ swarm: null }, 0, 1), G.ORG_FACE_PX / 2, 'a row whose swarm is null is an agent');
});

test('#4040: orgWireEnds cuts each end along the wire, starts a hub wire at its centre, and hides a wire between touching pictures', () => {
  const w = G.orgWireEnds(0, 0, null, 100, 0, { name: 'kid' });
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2, w.shown], [0, 0, 100 - 22, 0, true], 'hub to disc');
  const b = G.orgWireEnds(0, 0, { name: 'mara' }, 100, 0, { name: 'kid' });
  assert.deepEqual([b.x1, b.x2, b.shown], [22, 78, true], 'disc to disc');
  assert.equal(G.orgWireEnds(0, 0, { name: 'a' }, 40, 0, { name: 'b' }).shown, false, 'two discs 40px apart overlap: no wire');
  assert.equal(G.orgWireEnds(0, 0, null, 0, 0, { name: 'b' }).shown, false, 'a zero-length wire is hidden, not NaN');
  // CONTROL: 45px apart, the pictures do not meet and the wire shows.
  assert.equal(G.orgWireEnds(0, 0, { name: 'a' }, 45, 0, { name: 'b' }).shown, true);
});
