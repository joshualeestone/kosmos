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
 *   - a three-level fleet, too deep for an iPhone SE even at the squeeze floor:
 *     the page still does not scroll sideways, the chart's own box does, and a
 *     touch swipe across the chart scrolls it (Chromium; WebKit checks the
 *     touch-action only).
 *
 * RED arm (measured, Chromium and WebKit): on the unfixed page "no sideways
 * scroll" reds at 375, 393 and 412 (the page is 420px wide); every other arm stays
 * green there, since the faces sit near the middle of the too-wide chart. 430 (Pro
 * Max) passes either way, which is why it is not the only size.
 * The deep-fleet swipe arm reds when the chart keeps touch-action: none while
 * wider than its box (scrollLeft does not move). The "does not clip" arms red when
 * the box scrolls for every chart; the deep "held at the top edge" arm reds without the
 * scrolling box's top padding; the centred arm reds without the centring; the narrowed
 * arm reds when the old scroll offset is kept across a width change; the
 * same-width repaint arm reds when every repaint writes the scroll; the turned-
 * while-hidden arm reds when the resize handler remembers its own width; the long
 * callout arm reds without the box's sideways clip (page 406px at 375); the
 * widened arm reds when the re-centre reads the browser-clamped scroll; the
 * keyboard arm reds when the scrolling box cannot take focus; the ring-added arm
 * reds when a same-width growth leaves the scroll where it was; the failed-poll
 * arm reds when the failure path leaves the scrolling box's classes or the
 * emptied map's size behind.
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
const store = require('../../engine/store');
const srv = require('../../server.js');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ENGINES = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter((e) => ALL_ENGINES.includes(e));
// The mobile-shots harness sizes: iPhone SE, iPhone 15, iPhone 15 Pro Max, a Pixel.
if (!ENGINES.length) {
  console.log('FAIL  render-orgchart-phone-718: ENGINES names no known engine (' + (process.env.ENGINES || '') + '); nothing would run');
  process.exit(1);
}
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
    // A label the chart's box cuts off: only possible while the box clips (it scrolls),
    // and measured on every node's name and callout whether or not it is showing.
    const wrap = document.getElementById('orgview');
    // Vertical clipping is what can cut a name off; the box clips sideways by design.
    const clips = getComputedStyle(wrap).overflowY !== 'visible';
    const wr = wrap.getBoundingClientRect();
    const clipped = !clips ? [] : [...document.querySelectorAll('#orgmap .onode')].flatMap((n) =>
      [...n.querySelectorAll('.oname, .callout')].map((el) => ({ agent: n.getAttribute('data-agent'), cls: el.className, r: el.getBoundingClientRect() })))
      .filter((x) => x.r.top < wr.top - 0.5 || x.r.bottom > wr.bottom + 0.5)
      .map((x) => x.agent + ' ' + x.cls + ' ' + Math.round(x.r.top - wr.top) + '/' + Math.round(wr.bottom - x.r.bottom));
    return { vw, pageW: document.documentElement.scrollWidth, mapW: mr ? Math.round(mr.width) : 0, nodes, clips, clipped };
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
          // A chart that fits must not clip: the name callout above a top node reaches past its square.
          chk(!m.clips, `${tag} a chart that fits does not clip its names (the box is not a scroller)`, 'overflow clips=' + m.clips);
          // A callout is laid out while hidden. A long name and role over the rightmost node
          // must not make the page wider than the screen (the fixture's short names cannot).
          const longCo = await page.evaluate(() => {
            const n = [...document.querySelectorAll('#orgmap .onode')].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
            const c = n && n.querySelector('.callout');
            const nm = c && c.querySelector('.co-name'); const rl = c && c.querySelector('.co-role');
            if (!nm || !rl) return { error: 'no callout name/role on the rightmost node (renamed? re-anchor this check)' };
            nm.textContent = 'Johnny Cage the Second'; rl.textContent = 'Head of partnerships and field operations';
            return { agent: n.dataset.agent, calloutRight: Math.round(c.getBoundingClientRect().right), pageW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
          });
          chk(!longCo.error && longCo.calloutRight > longCo.vw && longCo.pageW <= longCo.vw,
            `${tag} a long name and role over the rightmost node do not widen the page`, JSON.stringify(longCo));
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
        // Turned while the chart was hidden: portrait on the chart, open an agent, turn to
        // landscape, come back (the chart paints wide), turn to portrait again. The chart must
        // repaint for that last turn, or the page scrolls sideways again until the next poll.
        {
          const tag = `[${engine} turned while hidden]`;
          const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });
          const page = await ctx.newPage();
          await toOrg(page, URL);
          await page.setViewportSize({ width: 375, height: 667 }); await page.waitForTimeout(500);
          await page.evaluate(() => openDetail(LAST.find((a) => a.sessionName).sessionName)); await page.waitForTimeout(300);
          await page.setViewportSize({ width: 667, height: 375 }); await page.waitForTimeout(500);
          await page.evaluate(() => showTab('agents')); await page.waitForTimeout(500);
          const shown = await page.evaluate(() => !document.getElementById('orgview').hidden);
          await page.setViewportSize({ width: 375, height: 667 }); await page.waitForTimeout(500);
          const m = await measure(page);
          chk(shown && m.pageW <= m.vw, `${tag} back in portrait, the page does not scroll sideways`, `chart shown=${shown}, page ${m.pageW}px on a ${m.vw}px screen, chart ${m.mapW}px`);
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
        chk(!m.clips, `[${engine} desktop] the chart's box does not clip, as before`, 'overflow clips=' + m.clips);
        await ctx.close();
      } finally {
        await browser.close();
      }
    }

    // ── A three-level fleet (ada <- bram <- cleo): too deep to fit an iPhone SE even
    //    with the rings at the squeeze floor, so the chart scrolls in its own box.
    //    The page must still not scroll sideways, and a FINGER must be able to scroll
    //    the box: touch-action: none on the chart (it is there for dragging) would
    //    block that on every point of it, leaving the far side unreachable by touch.
    store.writeProfile('bram', { reportsTo: 'ada' });
    store.writeProfile('cleo', { reportsTo: 'bram' });
    for (const engine of ENGINES) {
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `[${engine} deep] could not start a browser`, (err && err.message ? err.message.split('\n')[0] : String(err)));
        continue;
      }
      try {
        const tag = `[${engine} 375x667 deep fleet]`;
        const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await toOrg(page, URL);
        const m = await measure(page);
        const box = await page.evaluate(() => {
          const wrap = document.getElementById('orgview');
          const map = document.getElementById('orgmap');
          return { scrollW: wrap.scrollWidth, clientW: wrap.clientWidth, touch: getComputedStyle(map).touchAction };
        });
        chk(m.nodes.length === NAMES.length, `${tag} every agent is drawn`, `${m.nodes.length} of ${NAMES.length}`);
        chk(m.pageW <= m.vw, `${tag} the page does not scroll sideways`, `page ${m.pageW}px on a ${m.vw}px screen`);
        chk(box.scrollW > box.clientW, `${tag} the fleet is too deep to fit, so the chart's box scrolls (the case under test)`, JSON.stringify(box));
        chk(/pan-x/.test(box.touch), `${tag} the chart lets a finger pan when it is wider than its box`, box.touch);
        const opened = await page.evaluate(() => document.getElementById('orgview').scrollLeft);
        const mid = Math.round((box.scrollW - box.clientW) / 2);
        chk(Math.abs(opened - mid) <= 2, `${tag} the chart opens centred on the hub, not scrolled to its left edge`, `scrollLeft ${opened}, centre ${mid}`);
        // Narrowed while it scrolls (a phone turned, a smaller phone): the point in the middle
        // of the box stays in the middle, rather than the old scroll offset being kept as is.
        {
          await page.setViewportSize({ width: 360, height: 667 });
          await page.waitForTimeout(600);
          const r = await page.evaluate(() => { const w = document.getElementById('orgview'); return { left: w.scrollLeft, scrollW: w.scrollWidth, clientW: w.clientWidth }; });
          const c = Math.round((r.scrollW - r.clientW) / 2);
          chk(r.clientW < box.clientW && Math.abs(r.left - c) <= 2, `${tag} narrowed to 360, the chart stays centred in its box`, `box ${box.clientW} -> ${r.clientW}px, scrollLeft ${r.left}, centre ${c}`);
        }
        // Widened while scrolled to the right edge: the box's maximum scroll shrinks and the
        // browser clamps before the repaint. The point that was in the middle must stay in the
        // middle as far as the new edge allows (here the right edge stays the right edge),
        // not be re-centred from the clamped value.
        {
          const at360 = await page.evaluate(() => { const w = document.getElementById('orgview'); w.scrollLeft = w.scrollWidth - w.clientWidth;
            return new Promise((res) => setTimeout(() => res({ left: w.scrollLeft, clientW: w.clientWidth }), 200)); });
          await page.setViewportSize({ width: 375, height: 667 });
          await page.waitForTimeout(600);
          const r = await page.evaluate(() => { const w = document.getElementById('orgview'); return { left: w.scrollLeft, max: w.scrollWidth - w.clientWidth, clientW: w.clientWidth }; });
          const want = Math.min(r.max, Math.round(at360.left - (r.clientW - at360.clientW) / 2));
          chk(r.clientW > at360.clientW && Math.abs(r.left - want) <= 2, `${tag} widened back to 375 from the right edge, the scroll keeps its middle point`,
            `box ${at360.clientW} -> ${r.clientW}px, scrollLeft ${at360.left} -> ${r.left}, want ${want} (max ${r.max})`);
        }
        // The board repaints every 5s at the same width. That repaint must not write the box's
        // scroll: a write mid-pan stops a finger's scroll. Count writes through a spy on the box.
        {
          const r = await page.evaluate(() => {
            const w = document.getElementById('orgview');
            const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
            let writes = 0;
            Object.defineProperty(w, 'scrollLeft', { configurable: true, get() { return desc.get.call(this); }, set(v) { writes += 1; desc.set.call(this, v); } });
            paintOrg(); ORG_HTML = null; paintOrg();   // the guarded repaint, then a forced full one
            delete w.scrollLeft;
            return { writes };
          });
          chk(r.writes === 0, `${tag} a repaint at the same width leaves the box's scroll alone`, `scrollLeft writes: ${r.writes}`);
        }
        // The scrolling box clips vertically too. The worst case for a callout is a node held
        // at the top of the drag box: drag the topmost node up past it (mouse, so the drag is
        // not given over to a pan) and measure while it is still held there.
        {
          const top = await page.evaluate(() => {
            document.getElementById('orgview').scrollIntoView({ block: 'center' });
            const ns = [...document.querySelectorAll('#orgmap .onode')].map((n) => ({ a: n.dataset.agent, r: n.getBoundingClientRect() }));
            ns.sort((x, y) => x.r.top - y.r.top);
            const t = ns[0];
            return { a: t.a, x: t.r.left + t.r.width / 2, y: t.r.top + t.r.height / 2 };
          });
          await page.mouse.move(top.x, top.y);
          await page.mouse.down();
          for (let i = 1; i <= 10; i++) await page.mouse.move(top.x, top.y - i * 20);
          await page.waitForTimeout(100);
          const held = await measure(page);
          const heldAt = await page.evaluate((a) => Math.round(document.querySelector('#orgmap .onode[data-agent="' + a + '"]').getBoundingClientRect().top
            - document.getElementById('orgmap').getBoundingClientRect().top), top.a);
          await page.mouse.up();
          chk(heldAt <= 10 && held.clipped.length === 0,
            `${tag} a node held at the top edge keeps its name callout inside the scrolling box`,
            `${top.a} face top at ${heldAt}px of the chart; cut off: ${JSON.stringify(held.clipped)}`);
        }
        if (engine === 'chromium') {
          // A real touch swipe across the middle of the chart, through the browser's own
          // gesture path (which honours touch-action), not a scrollLeft assignment.
          // The chart starts below the fold on a short phone: bring it on screen first.
          const r = await page.evaluate(() => {
            const map = document.getElementById('orgmap');
            map.scrollIntoView({ block: 'center' });
            // From the middle, so the swipe has room whichever arm above left the box at an edge.
            const box = document.getElementById('orgview'); box.scrollLeft = Math.round((box.scrollWidth - box.clientWidth) / 2);
            const b = map.getBoundingClientRect();
            const wrap = document.getElementById('orgview').getBoundingClientRect();
            return { x: Math.round(wrap.left + wrap.width / 2),
              y: Math.round(Math.min(Math.max(b.top + b.height / 2, 1), innerHeight - 1)) };
          });
          // Baseline read HERE, after everything above that moves the scroll (the narrowed arm
          // re-centres it, scrollIntoView can shift it), so only the swipe can change it.
          const before = await page.evaluate(() => document.getElementById('orgview').scrollLeft);
          let left = before; let why = '';
          try {
            const cdp = await ctx.newCDPSession(page);
            await cdp.send('Input.synthesizeScrollGesture', { x: r.x, y: r.y, xDistance: -150, yDistance: 0, gestureSourceType: 'touch', speed: 800 });
            await page.waitForTimeout(300);
            left = await page.evaluate(() => document.getElementById('orgview').scrollLeft);
          } catch (err) { why = ' (the swipe itself failed: ' + (err && err.message ? err.message.split('\n')[0] : err) + ')'; }
          chk(left !== before, `${tag} a touch swipe across the chart scrolls its box`, `scrollLeft ${before} -> ${left} at ${r.x},${r.y}${why}`);
        } else {
          console.log(`INFO  ${tag} touch swipe arm is Chromium only (no gesture path here); touch-action is checked above`);
        }
        // A keyboard can pan it: the scrolling box takes focus, is named, and the arrow keys move it.
        {
          const r = await page.evaluate(() => { const w = document.getElementById('orgview'); w.scrollLeft = 0; w.focus();
            return { tab: w.tabIndex, role: w.getAttribute('role'), label: w.getAttribute('aria-label'), focused: document.activeElement === w }; });
          // Arrow keys: Chromium only. Headless WebKit does not pan a focused box with them
          // (measured, with and without these attributes); focus and the name are checked in both.
          let left = null;
          if (engine === 'chromium') {
            await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(400);
            left = await page.evaluate(() => document.getElementById('orgview').scrollLeft);
          }
          chk(r.tab === 0 && r.role === 'region' && !!r.label && r.focused && (left === null || left > 0),
            `${tag} the scrolling box takes keyboard focus and is named` + (left === null ? '' : ', and the arrow keys pan it'),
            JSON.stringify(r) + (left === null ? '' : ' scrollLeft after two ArrowRight: ' + left));
        }
        // The fleet grows a ring while the box is scrolled (same width): the drawing grows by
        // half the difference on each side, so the point in the middle must stay in the middle.
        {
          const c0 = await page.evaluate(() => { const w = document.getElementById('orgview'); w.scrollLeft = Math.round((w.scrollWidth - w.clientWidth) / 2);
            return { left: w.scrollLeft, size: document.getElementById('orgmap').getBoundingClientRect().width }; });
          store.writeProfile('dov', { reportsTo: 'cleo' });
          let r = null;
          for (let i = 0; i < 24; i++) {   // the board polls every 5s
            await page.waitForTimeout(500);
            r = await page.evaluate(() => { const w = document.getElementById('orgview');
              return { left: w.scrollLeft, scrollW: w.scrollWidth, clientW: w.clientWidth, size: Math.round(document.getElementById('orgmap').getBoundingClientRect().width) }; });
            if (r.size > c0.size) break;
          }
          store.writeProfile('dov', { reportsTo: '' });   // back to the first ring for the next engine (writeProfile merges)
          const c = Math.round((r.scrollW - r.clientW) / 2);
          chk(r.size > c0.size && Math.abs(r.left - c) <= 2, `${tag} a ring added while scrolled keeps the chart centred in its box`,
            `chart ${Math.round(c0.size)} -> ${r.size}px, scrollLeft ${c0.left} -> ${r.left}, centre ${c}`);
        }
        // A poll that fails clears the chart: the box must go back to a plain one (no scroll
        // padding over the error note, not announced as a scrolling chart).
        {
          const before = await page.evaluate(() => document.getElementById('orgview').classList.contains('orgscroll'));
          // The page's own status fetch rejects, as it does when the Mac cannot be reached. Done in
          // the page, not with page.route: the board's service worker would carry the request past it.
          await page.evaluate(() => { window.__realFetch = window.fetch;
            window.fetch = function (u) { if (String(u).includes('/api/status')) return Promise.reject(new TypeError('offline (check)')); return window.__realFetch.apply(this, arguments); }; });
          let r = null;
          for (let i = 0; i < 24; i++) {
            await page.waitForTimeout(500);
            r = await page.evaluate(() => { const w = document.getElementById('orgview');
              return { note: document.getElementById('orgnote').textContent, scroll: w.classList.contains('orgscroll'), tab: w.getAttribute('tabindex'), role: w.getAttribute('role'),
                wide: document.getElementById('orgmap').classList.contains('orgwide'), padTop: getComputedStyle(w).paddingTop,
                mapH: Math.round(document.getElementById('orgmap').getBoundingClientRect().height) }; });
            if (/cannot read|sign/i.test(r.note)) break;
          }
          await page.evaluate(() => { window.fetch = window.__realFetch; });
          chk(before && /cannot read|sign/i.test(r.note) && !r.scroll && !r.wide && r.tab === null && r.role === null && r.padTop === '0px' && r.mapH === 0,
            `${tag} a failed poll leaves a plain, empty box under its note (no scrolling region, no blank square)`, JSON.stringify(r));
        }
        chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
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
