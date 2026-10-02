// Browser-check-surface: s-nav
'use strict';
/**
 * #4979: Settings' left nav (#s-nav) is sticky, and so is the app header (.apphead), which is drawn
 * above the page. The nav stuck 16px from the window's top, under the header, so on any long Settings
 * section, once scrolled, its first pill ("Your Profile") could not be seen or clicked. It now sticks
 * 16px below the header, whose height is measured (51px on a wide window, 77px at 900px, where it
 * wraps).
 *
 * Boots a sandboxed board. On chromium and webkit, with each saved layout (tabs, consolidated), at
 * 900 and 1200px wide, opens the Settings TAB on two long sections (Mac, Connections) and scrolls to
 * the end. Every nav pill's top must be at or below the header's bottom, and the point at the first
 * pill's centre must be the pill (so a click lands on it). Controls: body.consolidated is off (this
 * is the tab view, whatever layout is saved), the header shows, the nav is sticky, and the page
 * scrolled further than the nav's own top (so the nav is stuck, not resting where it was drawn).
 *
 * A short window (1200x480, 900x520), where the whole nav cannot fit below the header: on Mac,
 * scrolled halfway and to the end, either the nav is not sticky (it scrolls with the page) or every
 * pill is between the header and the window's bottom (control: the page scrolled).
 *
 * Just above where it stops fitting (1200x565, 900x565) the nav stays sticky with every pill between
 * the header and the bottom. And a header that changes height after load: Mac at 1200x600, scrolled to the end,
 * then the window narrowed to 900px (the header wraps to two lines): every pill moves below it.
 *
 * A taller header (a Kosmos+ bar or a notice, stood in for by a block added inside .apphead) at
 * 1200x600: grown by 100px the whole nav no longer fits, so it must scroll with the page or show every
 * pill; grown by 40px it still fits, so it stays sticky with every pill below the taller header.
 *
 * Then the consolidated view itself (Settings opened from the user menu while body.consolidated is
 * on, where Settings is its own scroll box and the header does not stick): on the Mac section, at
 * the panel's top and scrolled to its end, the nav stays within the panel's top padding plus 16px,
 * as before #4979 (control: body.consolidated is on and the panel itself scrolled).
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
  let consRan = 0;
  let shortRan = 0;
  let aboveRan = 0;
  let resizeRan = 0;
  let tallRan = 0;
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
                return { layout: document.documentElement.getAttribute('data-layout') || 'tabs', cons: document.body.classList.contains('consolidated'), headBottom: Math.round(hb.bottom), headShown: hb.height > 0,
                  navPos: getComputedStyle(document.getElementById('s-nav')).position, y: Math.round(window.scrollY), tops, firstHit: !!(hit && pills[0].contains(hit)) };
              });
              chk(r.layout === layout && !r.cons && r.headShown && r.navPos === 'sticky' && r.y > drawnTop,
                `${tag}: control: ${layout} saved, the tab view (no body.consolidated), the header shows, the nav is sticky and the page scrolled past it`, JSON.stringify({ drawnTop: Math.round(drawnTop), ...r }));
              chk(r.tops.length > 0 && r.tops.every((t) => t >= r.headBottom), `${tag}: every pill sits below the app header`, JSON.stringify({ headBottom: r.headBottom, tops: r.tops }));
              chk(r.firstHit, `${tag}: a click at the first pill lands on it, not on the header`);
              ran += 1;
            }
            chk(errs.length === 0, `${engineName} ${layout} ${width}px: no page errors`, errs.join(' | '));
            await page.close();
          }
        }
        /* A short window: the nav either scrolls with the page or fits between header and bottom. */
        await fetch(URL + '/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'tabs' }) });
        for (const [width, height] of [[1200, 480], [900, 520]]) {
          const page = await browser.newPage({ viewport: { width, height } });
          await page.goto(URL + '/?tab=settings&sec=mac');
          await page.waitForSelector('#s-nav button[data-go]', { state: 'visible', timeout: 20000 });
          await page.waitForTimeout(300);
          for (const where of ['halfway', 'the end']) {
            const tag = `${engineName} short ${width}x${height} mac, scrolled ${where}`;
            await page.evaluate((wh) => { const m = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, wh === 'the end' ? m : Math.round(m / 2)); }, where);
            await page.waitForTimeout(150);
            const r = await page.evaluate(() => {
              const hb = document.querySelector('.apphead').getBoundingClientRect().bottom;
              const pills = [...document.querySelectorAll('#s-nav button[data-go]')].filter((x) => !x.hidden && x.getClientRects().length).map((x) => x.getBoundingClientRect());
              return { y: Math.round(scrollY), navPos: getComputedStyle(document.getElementById('s-nav')).position, headBottom: Math.round(hb),
                underHeader: pills.filter((p) => p.top < hb - 0.5).length, offBottom: pills.filter((p) => p.bottom > innerHeight + 0.5).length };
            });
            chk(r.y > 0, `${tag}: control: the page scrolled`, JSON.stringify(r));
            chk(r.navPos !== 'sticky' || (r.underHeader === 0 && r.offBottom === 0), `${tag}: the nav scrolls with the page, or every pill is between the header and the bottom`, JSON.stringify(r));
            shortRan += 1;
          }
          await page.close();
        }
        /* Just above the short-window threshold: still sticky, and everything fits. */
        for (const [width, height] of [[1200, 565], [900, 565]]) {
          const page = await browser.newPage({ viewport: { width, height } });
          await page.goto(URL + '/?tab=settings&sec=mac');
          await page.waitForSelector('#s-nav button[data-go]', { state: 'visible', timeout: 20000 });
          await page.waitForTimeout(300);
          await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) / 2)));
          await page.waitForTimeout(150);
          const r = await page.evaluate(() => {
            const hb = document.querySelector('.apphead').getBoundingClientRect().bottom;
            const pills = [...document.querySelectorAll('#s-nav button[data-go]')].filter((x) => !x.hidden && x.getClientRects().length).map((x) => x.getBoundingClientRect());
            return { y: Math.round(scrollY), navPos: getComputedStyle(document.getElementById('s-nav')).position, headBottom: Math.round(hb),
              underHeader: pills.filter((p) => p.top < hb - 0.5).length, offBottom: pills.filter((p) => p.bottom > innerHeight + 0.5).length };
          });
          chk(r.y > 0 && r.navPos === 'sticky' && r.underHeader === 0 && r.offBottom === 0,
            `${engineName} just above the threshold ${width}x${height} mac, scrolled halfway: sticky, and every pill is between the header and the bottom`, JSON.stringify(r));
          aboveRan += 1;
          await page.close();
        }
        /* A header that changes height after load: narrow the window until it wraps. */
        {
          const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
          await page.goto(URL + '/?tab=settings&sec=mac');
          await page.waitForSelector('#s-nav button[data-go]', { state: 'visible', timeout: 20000 });
          await page.waitForTimeout(300);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(150);
          const before = await page.evaluate(() => Math.round(document.querySelector('.apphead').getBoundingClientRect().height));
          await page.setViewportSize({ width: 900, height: 600 });
          await page.waitForTimeout(400);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(150);
          const r = await page.evaluate(() => {
            const head = document.querySelector('.apphead').getBoundingClientRect();
            const tops = [...document.querySelectorAll('#s-nav button[data-go]')].filter((x) => !x.hidden && x.getClientRects().length).map((x) => Math.round(x.getBoundingClientRect().top));
            return { headH: Math.round(head.height), headBottom: Math.round(head.bottom), tops, navPos: getComputedStyle(document.getElementById('s-nav')).position };
          });
          chk(r.headH > before && r.navPos === 'sticky', `${engineName} resized 1200 -> 900px: control: the header grew after load and the nav is still sticky`, JSON.stringify({ before, ...r }));
          chk(r.tops.every((t) => t >= r.headBottom), `${engineName} resized 1200 -> 900px: every pill moved below the taller header`, JSON.stringify({ headBottom: r.headBottom, tops: r.tops }));
          resizeRan += 1;
          await page.close();
        }
        /* A taller header: grown by 100px the nav no longer fits; grown by 40px it still does. */
        for (const extra of [100, 40]) {
          const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
          await page.goto(URL + '/?tab=settings&sec=mac');
          await page.waitForSelector('#s-nav button[data-go]', { state: 'visible', timeout: 20000 });
          await page.evaluate((px) => { const d = document.createElement('div'); d.style.height = px + 'px'; d.dataset.check4979 = '1'; document.querySelector('.apphead').appendChild(d); }, extra);
          await page.waitForTimeout(300);
          for (const where of ['halfway', 'the end']) {
            const tag = `${engineName} header +${extra}px, 1200x600 mac, scrolled ${where}`;
            await page.evaluate((wh) => { const m = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, wh === 'the end' ? m : Math.round(m / 2)); }, where);
            await page.waitForTimeout(150);
            const r = await page.evaluate(() => {
              const hb = document.querySelector('.apphead').getBoundingClientRect();
              const pills = [...document.querySelectorAll('#s-nav button[data-go]')].filter((x) => !x.hidden && x.getClientRects().length).map((x) => x.getBoundingClientRect());
              return { y: Math.round(scrollY), headH: Math.round(hb.height), navPos: getComputedStyle(document.getElementById('s-nav')).position,
                underHeader: pills.filter((p) => p.top < hb.bottom - 0.5).length, offBottom: pills.filter((p) => p.bottom > innerHeight + 0.5).length };
            });
            chk(r.y > 0 && r.headH >= 51 + extra, `${tag}: control: the header grew and the page scrolled`, JSON.stringify(r));
            if (extra === 100) chk(r.navPos !== 'sticky' || (r.underHeader === 0 && r.offBottom === 0), `${tag}: the nav no longer fits, so it scrolls with the page or shows every pill`, JSON.stringify(r));
            else chk(r.navPos === 'sticky' && r.underHeader === 0 && r.offBottom === 0, `${tag}: it still fits: sticky, every pill below the taller header and above the bottom`, JSON.stringify(r));
            tallRan += 1;
          }
          await page.close();
        }
        /* The consolidated view: Settings from the user menu, inside Projects, its own scroll box. */
        await fetch(URL + '/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) });
        for (const width of [1000, 1280]) {
          const page = await browser.newPage({ viewport: { width, height: 600 } });
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          const tag = `${engineName} consolidated view ${width}px mac`;
          await page.goto(URL + '/?tab=projects');
          await page.waitForSelector('#userpop-settings', { state: 'attached', timeout: 20000 });
          await page.evaluate(() => document.getElementById('userpop-settings').click());
          await page.waitForSelector('#s-nav button[data-go="mac"]', { state: 'visible', timeout: 20000 });
          await page.evaluate(() => document.querySelector('#s-nav button[data-go="mac"]').click());
          await page.waitForTimeout(300);
          const read = () => page.evaluate(() => {
            const p = document.getElementById('panel-settings');
            const pb = p.getBoundingClientRect();
            return { cons: document.body.classList.contains('consolidated'), inProjects: p.parentElement && p.parentElement.id === 'panel-projects',
              scrolled: Math.round(p.scrollTop), limit: Math.round(parseFloat(getComputedStyle(p).paddingTop) + 16),
              navFromPanel: Math.round(document.getElementById('s-nav').getBoundingClientRect().top - pb.top) };
          });
          const atTop = await read();
          await page.evaluate(() => { const p = document.getElementById('panel-settings'); p.scrollTop = p.scrollHeight; });
          await page.waitForTimeout(200);
          const atEnd = await read();
          chk(atTop.cons && atTop.inProjects && atEnd.scrolled > 0, `${tag}: control: the consolidated view, Settings inside Projects, and the panel itself scrolled`, JSON.stringify({ atTop, atEnd }));
          chk([atTop, atEnd].every((x) => x.navFromPanel >= 0 && x.navFromPanel <= x.limit), `${tag}: the nav stays stuck within the panel's top padding plus 16px, at the top and scrolled to the end`, JSON.stringify({ atTop, atEnd }));
          chk(errs.length === 0, `${tag}: no page errors`, errs.join(' | '));
          consRan += 1;
          await page.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  chk(ran === 16 && shortRan === 8 && aboveRan === 4 && resizeRan === 2 && tallRan === 8 && consRan === 4, 'precondition: every engine, layout, width and section ran, and the short, near-threshold, resize, taller-header and consolidated arms on both engines', `ran=${ran} shortRan=${shortRan} aboveRan=${aboveRan} resizeRan=${resizeRan} tallRan=${tallRan} consRan=${consRan}`);
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
