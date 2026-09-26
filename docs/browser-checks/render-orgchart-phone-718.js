// Browser-check-surface: orgmap
'use strict';
/**
 * #718: the org chart on a phone.
 *
 * The chart canvas was a fixed square, (maxR + 78) * 2 px: 396px for a flat fleet
 * of five (the page then 420px wide), drawn at that width whatever the screen.
 * On a 375, 393 or 412px phone the WHOLE BOARD scrolled sideways. orgFit now sizes the square to the width it
 * is given (spare room first, then the rings come in), and the nodes keep their
 * size so every face stays a 44px tap target.
 *
 * `web.orgchart-phone-718.test.js` proves orgFit's arithmetic and pins the
 * wiring, but a chart that is sized right and then laid out wider (a margin, a
 * min-width somewhere up the tree) stays green there. This drives the REAL page
 * from the REAL server at the four harness phone sizes and reads the result:
 *   - the page is no wider than the screen (no sideways scroll);
 *   - every agent is drawn, fully on screen, and at least 44x44;
 *   - a tap on a face opens that agent;
 *   - a desktop-width board draws the natural square, as before.
 *
 * RED arm (measured, Chromium and WebKit): on the unfixed page "no sideways
 * scroll" reds at 375, 393 and 412 (the page is 420px wide); every other arm stays
 * green there, since the faces sit near the middle of the too-wide chart. 430 (Pro
 * Max) passes either way, which is why it is not the only size.
 *
 * Chromium at phone size is not an Android phone, and WebKit is an engine
 * approximation, not Safari.
 *
 *   node docs/browser-checks/render-orgchart-phone-718.js            # headed
 *   HEADED=0 node docs/browser-checks/render-orgchart-phone-718.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-orgchart-phone-718.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-op-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-op-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-op-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-op-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-op-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-orgchart-phone-718: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ENGINES = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter((e) => ALL_ENGINES.includes(e));
// The mobile-shots harness sizes: iPhone SE, iPhone 15, iPhone 15 Pro Max, a Pixel.
const PHONES = [[375, 667], [393, 852], [430, 932], [412, 915]];
const NAMES = ['ada', 'bram', 'cleo', 'dov', 'eve'];

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function toOrg(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.waitForTimeout(600);
  // Into the org (network) layout, the same control render-org-rings-2576.js uses.
  await page.click('[data-scope="agents"] .vt[data-layout="org"]');
  await page.waitForSelector('#orgmap .onode', { timeout: 8000 });
  await page.waitForTimeout(900);   // let the layout settle
}

function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const map = document.getElementById('orgmap');
    const mr = map ? map.getBoundingClientRect() : null;
    const nodes = [...document.querySelectorAll('#orgmap .onode')].map((n) => {
      const r = n.getBoundingClientRect();
      return { agent: n.getAttribute('data-agent'), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return { vw, pageW: document.documentElement.scrollWidth, mapW: mr ? Math.round(mr.width) : 0, nodes };
  });
}

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, {
    state: ['working', 'idle', 'needs_you', 'idle', 'working'][i],
    displayName: n[0].toUpperCase() + n.slice(1),
    role: 'Role ' + (i + 1),
  })));
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const engine of ENGINES) {
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `[${engine}] could not start a browser`, (err && err.message ? err.message.split('\n')[0] : String(err)));
        continue;
      }
      try {
        for (const [w, h] of PHONES) {
          const tag = `[${engine} ${w}x${h}]`;
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          await toOrg(page, URL);
          const m = await measure(page);
          chk(m.pageW <= m.vw, `${tag} the page does not scroll sideways`, `page ${m.pageW}px on a ${m.vw}px screen, chart ${m.mapW}px`);
          chk(m.nodes.length === NAMES.length, `${tag} every agent is drawn`, `${m.nodes.length} of ${NAMES.length}`);
          const off = m.nodes.filter((n) => n.l < 0 || n.r > m.vw);
          chk(off.length === 0, `${tag} every face is fully on screen`, JSON.stringify(off));
          const small = m.nodes.filter((n) => n.w < 44 || n.h < 44);
          chk(small.length === 0, `${tag} every face is at least 44x44`, JSON.stringify(small.length ? small : m.nodes.map((n) => n.w + 'x' + n.h)));
          // A tap on a face opens that agent (the chart's own click handler).
          const target = m.nodes.find((n) => n.agent);
          if (target) {
            await page.tap(`#orgmap .onode[data-agent="${target.agent}"]`);
            await page.waitForTimeout(500);
            const opened = await page.evaluate(() => ({ tab: URL_TAB, url: location.search }));
            chk(opened.tab === 'detail' && opened.url.includes(target.agent), `${tag} a tap on a face opens that agent`, target.agent + ' ' + JSON.stringify(opened));
          } else chk(false, `${tag} a tap on a face opens that agent`, 'no node to tap');
          chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
          await ctx.close();
        }
        // Desktop: the square fits, so the chart is the natural one, exactly as before.
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
        const page = await ctx.newPage();
        await toOrg(page, URL);
        const m = await measure(page);
        // The natural square from the page's own arithmetic (orgPlace + ORG_PAD), not a transcribed number.
        // The unfixed page (the control run) predates ORG_PAD and wrote the same 78 inline.
        const natural = await page.evaluate(() => Math.round((orgPlace(orgTreeOf(LAST)).maxR
          + (typeof ORG_PAD === 'number' ? ORG_PAD : 78)) * 2));
        chk(m.mapW === natural && m.nodes.length === NAMES.length, `[${engine} desktop] the chart is the natural square, as before, with every agent`, `chart ${m.mapW}px, natural ${natural}px, ${m.nodes.length} nodes`);
        await ctx.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    try { await server.close(); } catch { /* server may already be down */ }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
