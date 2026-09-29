'use strict';

/**
 * kosmos#4472: on the rendered org chart, a big team with no managers in it sits on two staggered rings, and the
 * wires still do not cross or pass nearer a face than the layout promises.
 *
 * web.org-lanes-4472.test.js pins orgPlace's geometry in node; this drives the real page on a board with a CEO over
 * three managers of fourteen reports each (tools/browser-checks.sh ORG_LANES_TREE), where every team takes two rings,
 * lets the chart settle, and reads the faces and wires AS DRAWN: at a desktop width, where the chart is drawn at or
 * near its natural size, and at a phone's width, where orgFit brings the rings in. It keeps a screenshot of each.
 *
 * 🔑 NON-VACUITY. (1) Measured on the PR: against #4473's page on this board the two-rings line is red (every
 * report of a manager at one distance from the hub). (2) In-check: every agent must have a face and a wire, the
 * three managers must be found from the wires, and the crossing count is proven on a control pair first.
 *
 * With such a board on $PORT the check runs standalone:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" KOSMOS_URL="http://127.0.0.1:$PORT" \
 *     SHOT_DIR=/some/dir node docs/browser-checks/render-org-lanes-4472.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a machine with no console session.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orglanes4472-'));
/* The board's shape (tools/browser-checks.sh ORG_LANES_TREE): a CEO, three managers, fourteen reports each. */
const AGENTS = 46;
const MANAGERS = 3;
const FACE_R = 22;   // a face is 44px across
/* The nearest a wire may come to a face that is not one of its ends: what orgPlace promises inside a two-ring team
   (ORG_LANE_SLOT, 31px) at the tightest squeeze orgFit applies on a phone (ORG_SQUEEZE_MIN, 0.7). A tighter threshold
   would pass only by this board's spacing, not by anything the layout guarantees (review it5). */
const WIRE_CLEAR = 31 * 0.7;

/* A proper crossing: interior to both segments (as render-org-sectors-4434 counts it). */
function crossings(segs) {
  const o = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const out = [];
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s = segs[i]; const t = segs[j];
      const side = (v, g) => { const e = 1e-9 * ((g.b.x - g.a.x) ** 2 + (g.b.y - g.a.y) ** 2); return v > e ? 1 : (v < -e ? -1 : 0); };
      if (side(o(t.a, t.b, s.a), t) * side(o(t.a, t.b, s.b), t) < 0 && side(o(s.a, s.b, t.a), s) * side(o(s.a, s.b, t.b), s) < 0) out.push(s.name + ' x ' + t.name);
    }
  }
  return out;
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
  say(crossings([{ name: 'p', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, { name: 'q', a: { x: 0, y: 10 }, b: { x: 10, y: 0 } }]).length === 1
    && crossings([{ name: 'p', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, { name: 'q', a: { x: 20, y: 0 }, b: { x: 30, y: 10 } }]).length === 0,
  'control: the crossing count counts a crossing and only a crossing');
  for (const [label, viewport] of [['desktop', { width: 1400, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport });
    const pg = await ctx.newPage();
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(1200);
    await pg.click('[data-scope="agents"] .vt[data-layout="org"]');
    await pg.waitForTimeout(800);
    const m = await settledRead(pg);
    say(m.settled, label + ': the chart came to rest within 15s');
    say(m.nodes.length === AGENTS, label + ': every agent is on the chart', m.nodes.length + ' of ' + AGENTS);
    say(m.segs.length === AGENTS, label + ': every agent has a wire', m.segs.length + ' wires');
    /* A wire starts at its manager's face edge (or the hub's centre), so its manager is the face nearest its start. */
    const managerOf = new Map();
    for (const s of m.segs) {
      let best = m.hub; let bd = Math.hypot(s.a.x - m.hub.x, s.a.y - m.hub.y);
      for (const n of m.nodes) {
        if (n.key === s.name) continue;
        const d = Math.hypot(s.a.x - n.x, s.a.y - n.y);
        if (d < bd) { bd = d; best = n; }
      }
      managerOf.set(s.name, best.key);
    }
    const teams = new Map();
    for (const [who, mgr] of managerOf) if (mgr !== '(hub)') { if (!teams.has(mgr)) teams.set(mgr, []); teams.get(mgr).push(who); }
    const big = [...teams].filter(([, ks]) => ks.length >= 10);
    say(big.length === MANAGERS, label + ': the three managers are found from the wires (non-vacuity)', big.map(([k, ks]) => k + ':' + ks.length).join(' '));
    /* Two rings: a team's faces sit at two distances from the hub, at least half a face apart. */
    const at = new Map(m.nodes.map((n) => [n.key, n]));
    const spreads = big.map(([, ks]) => {
      const d = ks.map((k) => Math.hypot(at.get(k).x - m.hub.x, at.get(k).y - m.hub.y));
      return Math.max(...d) - Math.min(...d);
    });
    say(spreads.length === MANAGERS && spreads.every((x) => x >= FACE_R), label + ': each big team is on two rings (its faces at two distances from the hub)',
      'spread ' + spreads.map((x) => x.toFixed(0) + 'px').join(', '));
    const bad = crossings(m.segs);
    say(bad.length === 0, label + ': no two connector lines cross', bad.length + ' crossing(s)' + (bad.length ? ': ' + bad.slice(0, 5).join(', ') : ''));
    /* Every wire clears every face that is not one of its ends by WIRE_CLEAR. */
    let least = Infinity; let where = '';
    for (const s of m.segs) {
      for (const n of m.nodes) {
        if (n.key === s.name || n.key === managerOf.get(s.name)) continue;
        const d = segDist(n, s.a, s.b);
        if (d < least) { least = d; where = s.name + ' past ' + n.key; }
      }
    }
    say(least >= WIRE_CLEAR, label + ': no wire comes nearer than ' + WIRE_CLEAR.toFixed(1) + 'px to a face that is not one of its ends', 'least ' + least.toFixed(1) + 'px (' + where + ')');
    const shot = path.join(OUT, 'org-lanes-4472-' + label + '.png');
    await pg.locator('#orgview').screenshot({ path: shot });
    console.log('      screenshot: ' + shot);
    await ctx.close();
  }
  await b.close();
  if (fails.length) { console.log('RED: ' + fails.length + ' failed'); process.exit(1); }
  console.log('GREEN');
})().catch((e) => { console.error(e); process.exit(1); });
