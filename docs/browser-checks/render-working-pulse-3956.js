// Browser-check-surface: acard lrow pjm-working working-pulse
'use strict';
/**
 * #3956 (Josh, 2026-09-26): the green ground of a working agent pulses slowly, a little greener and
 * back, and never for someone who asked for reduced motion.
 *
 * Boots a real sandboxed board with one working and one idle agent and reads the RENDERED grid card:
 *   - the working card runs `working-pulse`, slowly (3s or more per cycle), forever;
 *   - its ground is sampled across one full cycle and must swing toward green and back, and stay
 *     light at its greenest (a pulse that never moves, or one that goes dark, both fail);
 *   - watched across three five-second polls, a rebuilt card continues the pulse instead of
 *     snapping back to the plain surface;
 *   - the idle card does not pulse;
 *   - a list row (also in the one-screen folded layout) and a project member box carry the same animation;
 *   - in the dark theme the working ground still swings toward green
 *     (read from elements placed in the real page, so the page's own stylesheet decides);
 *   - under prefers-reduced-motion nothing pulses and the working card keeps its static ground.
 * Control: the same readings on the idle card show the instrument can see "no pulse".
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-working-pulse-3956.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pulse-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* How green a colour leans: green minus the mean of red and blue, on sRGB bytes. */
const lean = (c) => c[1] - (c[0] + c[2]) / 2;

/* The element's background colour as sRGB bytes [r, g, b]. Painted through a 1x1 canvas, because a
   colour mid-animation computes as oklab(...) (the interpolation space), not rgb(...), and reading
   that string's numbers as bytes is a wrong instrument that reports no movement at all. */
async function ground(page, sel) {
  return page.$eval(sel, (el) => {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const x = c.getContext('2d');
    x.fillStyle = getComputedStyle(el).backgroundColor;
    x.fillRect(0, 0, 1, 1);
    return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3));
  });
}
async function anim(page, sel) {
  return page.$eval(sel, (el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: cs.animationDuration, count: cs.animationIterationCount };
  });
}

/* The list row, its one-screen variant and the project member box, placed into the real page so
   the page's own stylesheet decides what they carry. */
async function placeSiblings(page) {
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.dataset.pulse3956 = 'host';
    host.innerHTML = '<div class="lrow working" data-pulse3956="lrow"></div><div class="lrow" data-pulse3956="lrow-idle"></div>';
    document.body.appendChild(host);
    let pj = document.getElementById('pj-one-agents');
    if (!pj) { pj = document.createElement('div'); pj.id = 'pj-one-agents'; document.body.appendChild(pj); }
    const m = document.createElement('div');
    m.className = 'pj-member pjm-working';
    m.dataset.pulse3956 = 'pjm';
    pj.appendChild(m);
  });
}

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'working', displayName: 'Beatrix', role: 'Collections Coordinator' }),
    fleet.agent('cosmo', { state: 'idle', displayName: 'Cosmo', role: 'Researcher' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        /* --- motion allowed --- */
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
        const page = await ctx.newPage();
        await page.goto(URL);
        await page.waitForSelector('.acard.working', { timeout: 20000 });
        await page.waitForSelector('.acard:not(.working)', { timeout: 20000 });
        const w = await anim(page, '.acard.working');
        chk(w.name === 'working-pulse', `${engineName}: the working card runs working-pulse`, JSON.stringify(w));
        chk(parseFloat(w.dur) >= 3, `${engineName}: the pulse is slow (3s or more per cycle)`, w.dur);
        chk(w.count === 'infinite', `${engineName}: the pulse never stops while working`, w.count);

        /* Sampled across one full cycle: the ground must swing, gently. */
        const raw = [];
        for (let k = 0; k < 9; k++) { raw.push(await ground(page, '.acard.working')); await page.waitForTimeout(450); }
        const samples = raw;
        const leans = samples.map(lean);
        const swing = Math.max(...leans) - Math.min(...leans);
        chk(swing > 3, `${engineName}: the working ground swings toward green and back over one cycle`, `green lean ${Math.min(...leans).toFixed(1)}..${Math.max(...leans).toFixed(1)}`);
        const greenest = samples[leans.indexOf(Math.max(...leans))];
        chk(Math.min(...greenest) >= 200, `${engineName}: at its greenest the light ground stays light, never dark`, String(greenest));

        /* The board rebuilds its cards on every five-second poll, and a rebuilt card must pick the
           pulse up where the old one left it rather than snap back to the plain surface. Watched
           across three polls, re-finding the card each time: at least two rebuilds must happen (or
           this arm proves nothing), and no step between neighbouring readings may jump. A smooth
           step here is under one unit; the snap this guards against was about five. */
        const watch = await page.evaluate(async () => {
          const out = { steps: [], replaced: 0 };
          const px = (el) => {
            const c = document.createElement('canvas'); c.width = 1; c.height = 1;
            const x = c.getContext('2d'); x.fillStyle = getComputedStyle(el).backgroundColor; x.fillRect(0, 0, 1, 1);
            const d = x.getImageData(0, 0, 1, 1).data; return d[1] - (d[0] + d[2]) / 2;
          };
          let prev = null; let prevEl = null;
          const end = performance.now() + 16000;
          while (performance.now() < end) {
            await new Promise((r) => requestAnimationFrame(r));
            const el = document.querySelector('.acard.working');
            if (!el) continue;
            if (prevEl && el !== prevEl) out.replaced += 1;
            const v = px(el);
            if (prev !== null) out.steps.push(Math.abs(v - prev));
            prev = v; prevEl = el;
          }
          return out;
        });
        chk(watch.replaced >= 2, `${engineName}: precondition: the board rebuilt the working card during the watch`, `rebuilt ${watch.replaced}x`);
        const worst = Math.max(...watch.steps);
        chk(worst < 2.5, `${engineName}: a rebuilt card continues the pulse, it does not snap back to white`, `largest frame-to-frame step ${worst.toFixed(2)} over ${watch.steps.length} frames`);

        /* Control: the idle card does not pulse, and the same instrument says so. */
        const i = await anim(page, '.acard:not(.working)');
        chk(i.name === 'none', `${engineName}: control: an idle card does not pulse`, i.name);
        const idle = [];
        for (let k = 0; k < 9; k++) { idle.push(lean(await ground(page, '.acard:not(.working)'))); await page.waitForTimeout(450); }
        chk(Math.max(...idle) - Math.min(...idle) < 0.5, `${engineName}: control: an idle card's ground holds still over the same cycle`, idle.map((x) => x.toFixed(1)).join(','));

        await placeSiblings(page);
        for (const sel of ['[data-pulse3956="lrow"]', '[data-pulse3956="pjm"]']) {
          const s = await anim(page, sel);
          chk(s.name === 'working-pulse', `${engineName}: ${sel} (working) carries the same pulse`, s.name);
        }
        chk((await anim(page, '[data-pulse3956="lrow-idle"]')).name === 'none', `${engineName}: control: an idle list row does not pulse`);
        /* The one-screen layout folds the list and re-declares the row's ground (its own rule). The
           pulse must still apply there and the wash must still be drawn under it. */
        const folded = await page.evaluate(() => {
          const html = document.documentElement, body = document.body;
          const before = { layout: html.getAttribute('data-layout'), cls: body.className };
          html.setAttribute('data-layout', 'consolidated');
          body.classList.add('consolidated', 'fold-a');
          const el = document.querySelector('[data-pulse3956="lrow"]');
          const cs = getComputedStyle(el);
          const out = { name: cs.animationName, wash: /gradient/.test(cs.backgroundImage) };
          if (before.layout === null) html.removeAttribute('data-layout'); else html.setAttribute('data-layout', before.layout);
          body.className = before.cls;
          return out;
        });
        chk(folded.name === 'working-pulse' && folded.wash, `${engineName}: the one-screen (folded) list row pulses over its wash`, JSON.stringify(folded));

        /* Dark theme: the pulse mixes into the dark surface, so it must still swing there. */
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const dark = [];
        for (let k = 0; k < 9; k++) { dark.push(lean(await ground(page, '.acard.working'))); await page.waitForTimeout(450); }
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
        chk(Math.max(...dark) - Math.min(...dark) > 2, `${engineName}: in the dark theme the working ground still swings toward green`, `green lean ${Math.min(...dark).toFixed(1)}..${Math.max(...dark).toFixed(1)}`);

        await ctx.close();

        /* --- reduced motion --- */
        const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
        const rpage = await rctx.newPage();
        await rpage.goto(URL);
        await rpage.waitForSelector('.acard.working', { timeout: 20000 });
        const r = await anim(rpage, '.acard.working');
        chk(r.name === 'none', `${engineName}: reduced motion: the working card does not pulse`, r.name);
        const surface = await rpage.evaluate(() => {
          const d = document.createElement('div');
          d.dataset.pulse3956 = 'surface';
          d.style.backgroundColor = 'var(--k-surface)';
          document.body.appendChild(d);
        }).then(() => ground(rpage, '[data-pulse3956="surface"]'));
        /* Sampled across a full cycle, not once: a single reading can land on the pulse's trough,
           which equals the surface, and pass with the reduced-motion rule gone. */
        const rgs = [];
        for (let k = 0; k < 9; k++) { rgs.push(String(await ground(rpage, '.acard.working'))); await rpage.waitForTimeout(450); }
        chk(rgs.every((x) => x === String(surface)), `${engineName}: reduced motion: the ground under the wash stays the plain surface for a whole cycle`, `${[...new Set(rgs)].join(' | ')} vs ${surface}`);
        chk(await rpage.$eval('.acard.working', (el) => /gradient/.test(getComputedStyle(el).backgroundImage)),
          `${engineName}: reduced motion: the static green wash is still there`);
        await placeSiblings(rpage);
        for (const sel of ['[data-pulse3956="lrow"]', '[data-pulse3956="pjm"]']) {
          chk((await anim(rpage, sel)).name === 'none', `${engineName}: reduced motion: ${sel} does not pulse`);
        }
        await rctx.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  const total = fail.length;
  console.log(total ? `${total} check(s) FAILED` : 'all checks passed');
  process.exit(total ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
