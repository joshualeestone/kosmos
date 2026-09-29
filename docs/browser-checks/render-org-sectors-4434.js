'use strict';

/**
 * kosmos#4434: on the rendered org chart, no two connector lines cross.
 *
 * Josh (#admin, 2026-09-28): "the agents in the bottom left are crossing over lines and they could have
 * just put their agents in those areas". web.org-sectors-4434.test.js pins the geometry in node; this
 * drives the real page on a board with that shape (five managers with uneven teams and depths, leaves
 * between them; a tree that crosses on main even AFTER the physics settles), lets the chart settle, and counts crossings among the wires AS DRAWN (the <line> elements, which
 * are cut back at each face), in both the animated and the reduced-motion paths. It keeps a screenshot.
 *
 * 🔑 NON-VACUITY. (1) Measured on the PR: the same check against main's page on this board is red. (2)
 * In-check: it requires every agent to have a wire, at least three managers with reports, and the
 * crossing count to come from lines that were actually measured (a control pair that does cross is
 * counted by the same function).
 *
 * The board is the one tools/browser-checks.sh boots with boot_board_org and ORG_UNEVEN_TREE (fifteen agents
 * n0..n14, five managers; not the node test's UNEVEN tree); with such
 * a board on $PORT the check runs standalone:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" KOSMOS_URL="http://127.0.0.1:$PORT" \
 *     SHOT_DIR=/some/dir node docs/browser-checks/render-org-sectors-4434.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a machine with no console session.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orgsectors4434-'));
/* The board's shape (tools/browser-checks.sh ORG_UNEVEN_TREE): 15 agents, 5 of them managers. */
const AGENTS = 15;
const MANAGERS_MIN = 3;

/* A proper crossing: interior to both segments. Wires are cut back at each face, so two wires from one
   manager do not even share an end on screen; a touch at an end is still not a crossing. */
function crossings(segs) {
  const o = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const out = [];
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s = segs[i]; const t = segs[j];
      /* A side counts only when clear of rounding (as orgPlanarRepair and the node test count it): two wires at
         exactly opposite angles never meet but their orientations can round to tiny numbers of mixed sign. */
      const side = (v, g) => { const e = 1e-9 * ((g.b.x - g.a.x) ** 2 + (g.b.y - g.a.y) ** 2); return v > e ? 1 : (v < -e ? -1 : 0); };
      if (side(o(t.a, t.b, s.a), t) * side(o(t.a, t.b, s.b), t) < 0 && side(o(s.a, s.b, t.a), s) * side(o(s.a, s.b, t.b), s) < 0) out.push(s.name + ' x ' + t.name);
    }
  }
  return out;
}

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
  // The control, before anything is trusted: a pair that crosses is counted, a pair that does not is not.
  say(crossings([{ name: 'p', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, { name: 'q', a: { x: 0, y: 10 }, b: { x: 10, y: 0 } }]).length === 1
    && crossings([{ name: 'p', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, { name: 'q', a: { x: 20, y: 0 }, b: { x: 30, y: 10 } }]).length === 0,
  'control: the crossing count counts a crossing and only a crossing');
  for (const reduced of [false, true]) {
    const label = reduced ? 'reduced motion' : 'animated';
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const pg = await ctx.newPage();
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(1200);
    await pg.click('[data-scope="agents"] .vt[data-layout="org"]');
    await pg.waitForTimeout(800);
    const m = await settledRead(pg);
    say(m.settled, label + ': the chart came to rest within 15s (a chart still moving is not measured at rest)');
    say(m.nodes.length === AGENTS, label + ': every agent is on the chart', m.nodes.length + ' of ' + AGENTS);
    say(m.segs.length === AGENTS, label + ': every agent has a wire', m.segs.length + ' wires');
    /* A wire starts at its manager's face edge (or the hub's centre), so its manager is the node centre
       nearest its start. Managers = distinct starts other than the hub. */
    const managers = new Set();
    for (const s of m.segs) {
      let best = m.hub; let bd = Math.hypot(s.a.x - m.hub.x, s.a.y - m.hub.y);
      for (const n of m.nodes) {
        if (n.key === s.name) continue;
        const d = Math.hypot(s.a.x - n.x, s.a.y - n.y);
        if (d < bd) { bd = d; best = n; }
      }
      if (best !== m.hub) managers.add(best.key);
    }
    say(managers.size >= MANAGERS_MIN, label + ': the board has at least ' + MANAGERS_MIN + ' managers with reports (non-vacuity)', managers.size + ' managers: ' + [...managers].join(', '));
    const bad = crossings(m.segs);
    say(bad.length === 0, label + ': no two connector lines cross', bad.length + ' crossing(s)' + (bad.length ? ': ' + bad.slice(0, 5).join(', ') : ''));
    const shot = path.join(OUT, 'org-sectors-4434-' + (reduced ? 'reduced' : 'animated') + '.png');
    await pg.locator('#orgview').screenshot({ path: shot });
    console.log('      screenshot: ' + shot);
    await ctx.close();
  }
  await b.close();
  if (fails.length) { console.log('RED: ' + fails.length + ' failed'); process.exit(1); }
  console.log('GREEN');
})().catch((e) => { console.error(e); process.exit(1); });
