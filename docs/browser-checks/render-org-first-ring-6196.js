'use strict';

/**
 * kosmos#6196: on the rendered org chart, the FIRST RING (the roots, which connect to the hub) does not let a
 * hub line pass nearer a face than the 12px line-to-face rule aims for, even when many light near-equal roots
 * cluster at near-equal leaf-count-slice angles and get bumped to outer lanes (r = 120, 178, 236, 294).
 *
 * This is the in-browser regression guard for the #4499 fix (orgPlaceGated's measured first-ring floor). The node
 * guard web.org-first-ring-clear-4499.test.js pins the geometry; the sibling render-org-lanes-4472 drives a board
 * whose first ring is ONE root (its three managers sit on the SECOND ring), so it never clusters and the MIN_SPAN
 * water-fill is never exercised in browser. This drives a board whose first ring is ONE heavy root (100 reports) and
 * nineteen light ones
 * (tools/browser-checks.sh ORG_WIDE_TREE): the heavy root's leaf count hogs the angular slice, so the light roots
 * cram into near-equal slices, bump to outer lanes, and graze. It lets the chart settle and reads the faces and hub
 * lines AS DRAWN, at a desktop width and a phone's width (where orgFit brings the rings in), screenshotting each.
 * An even board (every root the same weight) does NOT cluster and was vacuous -- it cleared 52px pre- and post-fix.
 *
 * FIRST RING, defined from the render: a root's wire starts at the hub centre, so a node whose wire-start is
 * nearest the hub (not another face) is a first-ring node. The rule under test is every first-ring hub line
 * clearing every OTHER node's face by at least ORG_LINE_CLEAR at the scale the chart was drawn at (12px at a
 * desktop, floored at ORG_LINE_CLEAR * ORG_SQUEEZE_MIN on a squeezed phone), read per width (see drawnK).
 *
 * 🔑 NON-VACUITY. (1) Measured on the PR: against PRE-#4499 main on this board the first ring grazes ~6.3px at
 * placement, which a tree's settle preserves (no flat-only clearance force), so the check reds below the per-width
 * threshold (which floors at 8.4px); post-fix orgPlaceGated floors it to ~18px and it greens. (2) In-check: a
 * control pair proves segDist,
 * every agent has a face and a wire, and the first ring must be found with at least a dozen nodes before the
 * clearance is asserted.
 *
 * With such a board on $PORT the check runs standalone:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" KOSMOS_URL="http://127.0.0.1:$PORT" \
 *     SHOT_DIR=/some/dir node docs/browser-checks/render-org-first-ring-6196.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a machine with no console session.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orgfirstring6196-'));
/* The board's shape (tools/browser-checks.sh ORG_WIDE_TREE): one HEAVY root (100 reports) and 19 light ones, so
   the heavy root hogs the angular slice and the light roots cluster at near-equal slices and bump to outer lanes. */
const FIRST_RING_MIN = 12;   // the first ring must have at least this many nodes, or the cluster is not exercised

/* The 12px rule is a NATURAL-space rule; as drawn it is ORG_LINE_CLEAR * (the scale the chart was drawn at),
   bottoming out at ORG_LINE_CLEAR * ORG_SQUEEZE_MIN (the deepest squeeze orgFit allows on a phone). So the
   threshold is per-width: LINE_CLEAR read from the page, times the drawn radius scale k (drawnK below), floored at
   CLEAR_FLOOR. A fixed 8.4 (12 * 0.7) is right only at the deepest squeeze; at desktop scale 1 the real promise is
   12px, and 8.4 would pass 8.5 to 12px through (Liu Kang m5643). */
let LINE_CLEAR = NaN;    // ORG_LINE_CLEAR, the 12px rule, read from the page
let CLEAR_FLOOR = NaN;   // LINE_CLEAR * ORG_SQUEEZE_MIN: the deepest-squeeze floor (8.4)
let SQUEEZE_MIN = NaN;   // ORG_SQUEEZE_MIN (0.7): orgFit's deepest scale, used to sanity-gate drawnK
async function readConsts(pg) {
  const src = await pg.content();
  const num = (k) => Number((src.match(new RegExp('const\\s+' + k + '\\s*=\\s*([\\d.]+)\\s*;')) || [])[1]);
  const line = num('ORG_LINE_CLEAR'); const squeeze = num('ORG_SQUEEZE_MIN');
  if (!(line > 0 && squeeze > 0)) throw new Error('a layout constant is no longer declared in the page: ORG_LINE_CLEAR ' + line + ', ORG_SQUEEZE_MIN ' + squeeze);
  LINE_CLEAR = line; CLEAR_FLOOR = line * squeeze; SQUEEZE_MIN = squeeze;
}

/* The radius scale k the chart was actually DRAWN at (Liu Kang m5697: read it from the drawn artifact, not a
   recompute of orgFit's k, and not the canvas scale size/natural, which understates k because orgFit pads the
   size with ORG_PAD_MIN while orgNatural uses the larger ORG_PAD). paintOrg scales every placement radius by k
   (spot.r *= fit.k), so for a rendered face k = (its rendered distance from the hub) / (its own placement radius).
   Every face scales by the SAME k, so we read SEVERAL and require them to agree within 1% -- a cheap control
   that the reading is real (the positions are what we think). Fewer than three readable faces, or a spread past
   1%, returns NaN so the caller fails loud rather than measuring against a lie. The placement radius is the
   page's own layout of its LAST agents (orgPlaceGated when present, else orgPlace, matching paintOrg), honouring
   ?limit=; faces below 40px placement radius are skipped, because node positions are written toFixed(1), so on a
   small radius that rounding is too large a share of the ratio (the real board's roots sit at ORG_R0, well above). */
async function drawnK(pg) {
  return pg.evaluate(() => {
    try {
      const map = document.getElementById('orgmap');
      const hubEl = map.querySelector('.hub');
      const hx = parseFloat(hubEl.style.left); const hy = parseFloat(hubEl.style.top);
      const lim = new URLSearchParams(location.search).get('limit');
      const all = (typeof LAST !== 'undefined' && LAST ? LAST : []).filter((a) => a && a.sessionName && !(a.isGuide === true));
      const agents = lim ? all.slice(0, Number(lim)) : all;
      const place = (typeof orgPlaceGated === 'function' ? orgPlaceGated : orgPlace);
      const placed = place(orgTreeOf(agents)).placed;   // Map: name -> { r: natural (pre-squeeze) radius, ... }
      const ks = [];
      for (const n of map.querySelectorAll('.onode')) {
        const key = n.getAttribute('data-agent');
        const spot = placed && placed.get ? placed.get(key) : (placed ? placed[key] : null);
        if (!spot || !(spot.r >= 40)) continue;   // skip small-radius faces: toFixed(1) rounding is too big a share of their ratio
        const rd = Math.hypot(parseFloat(n.style.left) - hx, parseFloat(n.style.top) - hy);
        ks.push(rd / spot.r);
      }
      if (ks.length < 3) return NaN;
      ks.sort((a, b) => a - b);
      const med = ks[Math.floor(ks.length / 2)];
      if (!(med > 0) || (ks[ks.length - 1] - ks[0]) / med > 0.01) return NaN;   // faces must agree within 1% (usual spread ~0.2%; still catches a wrong-but-consistent read)
      return med;
    } catch (e) { return NaN; }
  });
}

const segDist = (q, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
};

async function measure(pg) {
  return pg.evaluate(() => {
    const map = document.getElementById('orgmap');
    const lines = [...map.querySelectorAll('line[data-for]')].filter((l) => l.getAttribute('visibility') !== 'hidden');
    const segs = lines.map((l) => ({
      name: l.getAttribute('data-for'),
      a: { x: Number(l.getAttribute('x1')), y: Number(l.getAttribute('y1')) },
      b: { x: Number(l.getAttribute('x2')), y: Number(l.getAttribute('y2')) },
    }));
    const nodes = [...map.querySelectorAll('.onode')].map((n) => ({ key: n.getAttribute('data-agent'), x: parseFloat(n.style.left), y: parseFloat(n.style.top) }));
    const hubEl = map.querySelector('.hub');
    const hub = { key: '(hub)', x: parseFloat(hubEl.style.left), y: parseFloat(hubEl.style.top) };
    return { segs, nodes, hub, pos: nodes.map((n) => n.x.toFixed(1) + ',' + n.y.toFixed(1)).join(';') };
  });
}

/* Wait until the chart stops moving: two reads 600ms apart with the same positions, within 15s. */
async function settledRead(pg) {
  let last = await measure(pg);
  for (let i = 0; i < 25; i += 1) {
    await pg.waitForTimeout(600);
    const now = await measure(pg);
    if (now.pos === last.pos) return { ...now, settled: true };
    last = now;
  }
  return { ...last, settled: false };
}

(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17491';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  /* control: segDist reports the perpendicular distance from a point to a segment, and clamps to the endpoints. */
  say(Math.abs(segDist({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }) - 3) < 1e-9
    && Math.abs(segDist({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }) - 10) < 1e-9,
  'control: segDist measures distance to a segment and clamps to its endpoints');
  for (const [label, viewport] of [['desktop', { width: 1400, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport });
    const pg = await ctx.newPage();
    await pg.goto(URL, { waitUntil: 'networkidle' });
    await readConsts(pg);
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(1200);
    await pg.click('[data-scope="agents"] .vt[data-layout="org"]');
    await pg.waitForTimeout(800);
    const m = await settledRead(pg);
    say(m.settled, label + ': the chart came to rest within 15s');
    say(m.nodes.length > 0 && m.segs.length === m.nodes.length, label + ': every agent has a face and a wire', m.nodes.length + ' faces, ' + m.segs.length + ' wires');
    /* A wire starts at its parent's face edge, or the hub's centre for a root. A root's wire-start is therefore
       nearest the hub; a non-root's is nearest its parent face. First ring = the roots. */
    const firstRing = [];
    for (const s of m.segs) {
      let best = m.hub; let bd = Math.hypot(s.a.x - m.hub.x, s.a.y - m.hub.y);
      for (const n of m.nodes) {
        if (n.key === s.name) continue;
        const d = Math.hypot(s.a.x - n.x, s.a.y - n.y);
        if (d < bd) { bd = d; best = n; }
      }
      if (best.key === '(hub)') firstRing.push(s.name);
    }
    say(firstRing.length >= FIRST_RING_MIN, label + ': the first ring has at least ' + FIRST_RING_MIN + ' roots found from the wires (non-vacuity)', firstRing.length + ' roots');
    const ringSet = new Set(firstRing);
    const at = new Map(m.nodes.map((n) => [n.key, n]));
    /* Every first-ring hub line clears every OTHER node's face by the 12px rule at the drawn radius scale k, as drawn. The
       #4499 bug is a hub line to an outer-lane root grazing an inner root's face; so the pairs that matter are a
       first-ring wire against every other face. */
    let least = Infinity; let where = '';
    for (const s of m.segs) {
      if (!ringSet.has(s.name)) continue;
      for (const n of m.nodes) {
        if (n.key === s.name) continue;
        const d = segDist(n, s.a, s.b);
        if (d < least) { least = d; where = s.name + ' past ' + n.key; }
      }
    }
    const k = await drawnK(pg);
    /* k is the TRUE radius scale, read from the drawn faces, so the gate [ORG_SQUEEZE_MIN, 1] is tight (up to the
       0.01 tolerance and float rounding): orgFit floors k at ORG_SQUEEZE_MIN and caps it at 1, so a reading outside
       it, or a NaN (every comparison false, which is also what the faces-disagree-past-1% control returns), means
       the read was not real. Fail loud rather than measure the clearance against a lie. */
    say(k >= SQUEEZE_MIN - 0.01 && k <= 1.01, label + ': the drawn radius scale k read plausibly (ORG_SQUEEZE_MIN..1)', Number.isFinite(k) ? k.toFixed(3) : String(k));
    /* Threshold = the 12px rule AT the drawn radius scale (paintOrg scales clearances by k), floored at CLEAR_FLOOR
       (8.4 on a fully squeezed phone). k is capped at 1 so it can never demand MORE than the 12px desktop promise
       (a false red); an unreadable k falls back to 1, the strictest value, so a bad read reds and never greens falsely. */
    const threshold = Math.max(CLEAR_FLOOR, LINE_CLEAR * Math.min(1, k > 0 ? k : 1));
    say(least >= threshold, label + ': no first-ring hub line comes nearer than ' + threshold.toFixed(1) + 'px (the ' + LINE_CLEAR + 'px rule at drawn k ' + (k > 0 ? k.toFixed(3) : '?') + ', floored at ' + CLEAR_FLOOR.toFixed(1) + ') to any face', 'least ' + least.toFixed(1) + 'px (' + where + ')');
    const shot = path.join(OUT, 'org-first-ring-6196-' + label + '.png');
    await pg.locator('#orgview').screenshot({ path: shot });
    console.log('      screenshot: ' + shot);
    await ctx.close();
  }
  await b.close();
  if (fails.length) { console.log('RED: ' + fails.length + ' failed'); process.exit(1); }
  console.log('GREEN');
})().catch((e) => { console.error(e); process.exit(1); });
