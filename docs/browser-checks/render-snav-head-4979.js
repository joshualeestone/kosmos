// Browser-check-surface: s-nav
'use strict';
/**
 * #4979: Settings' left nav (#s-nav) is sticky, and so is the app header (.apphead), which is drawn
 * above the page. The nav stuck 16px from the window's top, under the header, so on any long Settings
 * section, once scrolled, its first pill ("Your Profile") could not be seen or clicked. It now sticks
 * 16px below the header, whose height is measured (51px on a wide window, 77px at 900px, where it
 * wraps).
 *
 * Boots a sandboxed board. On chromium and webkit, in both layouts (tabs, consolidated), at 900 and
 * 1200px wide, opens two long Settings sections (Mac, Connections) and scrolls to the end. Every nav
 * pill's top must be at or below the header's bottom, and the point at the first pill's centre must be
 * the pill (so a click lands on it). Controls: the page scrolled further than the nav's own top
 * (so the nav is stuck, not resting where it was drawn), the nav is still sticky, and the header is
 * showing.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-snav-head-4979.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-snavhead-' + tag)); ROOTS.push(d); return d; };
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

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  let ran = 0;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        for (const layout of ['tabs', 'consolidated']) {
          await fetch(URL + '/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout }) });
          for (const width of [900, 1200]) {
            const page = await browser.newPage({ viewport: { width, height: 600 } });
            const errs = [];
            page.on('pageerror', (e) => errs.push(e.message));
            for (const sec of ['mac', 'connect']) {
              const tag = `${engineName} ${layout} ${width}px ${sec}`;
              await page.goto(URL + '/?tab=settings&sec=' + sec);
              await page.waitForSelector('#s-nav button[data-go]', { state: 'visible', timeout: 20000 });
              await page.waitForTimeout(300);
              const drawnTop = await page.evaluate(() => document.getElementById('s-nav').getBoundingClientRect().top + window.scrollY);
              await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
              await page.waitForTimeout(200);
              const r = await page.evaluate(() => {
                const head = document.querySelector('.apphead');
                const hb = head.getBoundingClientRect();
                const pills = [...document.querySelectorAll('#s-nav button[data-go]')].filter((b) => !b.hidden && b.getClientRects().length);
                const tops = pills.map((b) => Math.round(b.getBoundingClientRect().top));
                const fb = pills[0].getBoundingClientRect();
                const hit = document.elementFromPoint(fb.left + fb.width / 2, fb.top + fb.height / 2);
                return { layout: document.documentElement.getAttribute('data-layout') || 'tabs', headBottom: Math.round(hb.bottom), headShown: hb.height > 0,
                  navPos: getComputedStyle(document.getElementById('s-nav')).position, y: Math.round(window.scrollY), tops, firstHit: !!(hit && pills[0].contains(hit)) };
              });
              chk(r.layout === layout && r.headShown && r.navPos === 'sticky' && r.y > drawnTop,
                `${tag}: control: the layout is ${layout}, the header shows, the nav is sticky and the page scrolled past it`, JSON.stringify({ drawnTop: Math.round(drawnTop), ...r }));
              chk(r.tops.length > 0 && r.tops.every((t) => t >= r.headBottom), `${tag}: every pill sits below the app header`, JSON.stringify({ headBottom: r.headBottom, tops: r.tops }));
              chk(r.firstHit, `${tag}: a click at the first pill lands on it, not on the header`);
              ran += 1;
            }
            chk(errs.length === 0, `${engineName} ${layout} ${width}px: no page errors`, errs.join(' | '));
            await page.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  chk(ran === 16, 'precondition: every engine, layout, width and section ran', String(ran));
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
