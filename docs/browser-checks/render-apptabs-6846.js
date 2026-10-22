// Browser-check-surface: kplus-bar kplus-menu kapp-comp kapp-me pnav pnav-back pnav-computers kapptabs
'use strict';

/**
 * kosmos#6846 part c (Mona Lisa's frames, ios-design-2026-10-19/tabbar-6846): inside the iPhone app with its native tab
 * bar, the app adds `kapptabs` to <html> and the board's navy bar becomes the app's own header: 44px, no Kosmos+ mark,
 * no two lines; this computer's name on the left only when there is another computer to switch to (Josh #6396), the
 * person's face on the right; the name opens the phone menu at Switch Computers, the face at Settings, and closing
 * gives focus back to the one that opened it.
 *
 * Harness: render-mobilenav-4823's real board over remote.test at an iPhone size, Chromium and WebKit, the app's class
 * added by an init script as the app's WKUserScript adds it (document start). CONTROLS: the same page without the class
 * keeps today's bar (the mark, the two lines, 48px); the Mac's own address with the class keeps today's header (the
 * class alone does nothing off Kosmos+).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-apptabs-6846.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-apptabs-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_ALLOWED_HOSTS = 'remote.test';   // read when server.js loads, so set before it

const playwright = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const ENGINES = ['chromium', 'webkit'];
const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const NAVY = 'rgb(23, 35, 61)';
const WHITE = 'rgb(255, 255, 255)';
const ONE = { ok: true, domain: 'kosmosplus.example', computers: [
  { name: 'studio-laptop', address: 'studio-laptop.kosmosplus.example', this: true, online: true },
] };
const TWO = { ok: true, domain: 'kosmosplus.example', computers: [
  { name: 'studio-laptop', address: 'studio-laptop.kosmosplus.example', this: true, online: true },
  { name: 'desk-mini', address: 'desk-mini.kosmosplus.example', this: false, online: true },
] };

const LONG = 'the-big-render-machine-in-the-back-office-under-the-stairs-01';   // 61 characters, named by a person
const TWO_LONG = { ok: true, domain: 'kosmosplus.example', computers: [
  { name: LONG, address: 'long.kosmosplus.example', this: true, online: true },
  { name: 'desk-mini', address: 'desk-mini.kosmosplus.example', this: false, online: true },
] };

const look = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const q = (s) => document.querySelector(s);
  const nav = q('#pnav');
  const face = q('#kapp-me > img, #kapp-me > .youtint');
  return {
    pageW: Math.round(document.body.getBoundingClientRect().right),
    bar: rect(q('#kplus-bar')), barBg: q('#kplus-bar') ? getComputedStyle(q('#kplus-bar')).backgroundColor : null,
    mark: vis(q('#kplus-bar canvas')), twoLines: vis(q('#kplus-menu')),
    tabs: vis(q('#tabs')), burger: vis(q('#burger')), klink: vis(q('#klink')),
    comp: vis(q('#kapp-comp')) ? rect(q('#kapp-comp')) : null, compName: q('#kapp-comp-name') ? q('#kapp-comp-name').textContent : null,
    compColor: q('#kapp-comp') ? getComputedStyle(q('#kapp-comp')).color : null,
    compFont: q('#kapp-comp') ? getComputedStyle(q('#kapp-comp')).fontSize + ' ' + getComputedStyle(q('#kapp-comp')).fontWeight : null,
    compLabel: q('#kapp-comp') && q('#kapp-comp').getAttribute('aria-label'),
    me: vis(q('#kapp-me')) ? rect(q('#kapp-me')) : null, face: vis(face) ? rect(face) : null, meLabel: q('#kapp-me') && q('#kapp-me').getAttribute('aria-label'),
    apphead: rect(q('.apphead')),
    nav: nav && { shown: !nav.hidden, level: [...nav.querySelectorAll('.pnav-level')].filter((l) => !l.hidden).map((l) => l.dataset.level) },
    meExp: q('#kapp-me') && q('#kapp-me').getAttribute('aria-expanded'), compExp: q('#kapp-comp') && q('#kapp-comp').getAttribute('aria-expanded'),
    focus: document.activeElement && document.activeElement.id,
  };
});
const settled = (page) => page.waitForFunction(() => {
  const n = document.getElementById('pnav');
  if (!n || n.hidden) return true;
  return !n.classList.contains('opening') && typeof PNAV_PENDING !== 'undefined' && PNAV_PENDING === null
    && document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && n.contains(a.effect.target)).length === 0;
}, null, { timeout: 5000 }).then(() => true, () => { unsettled++; return false; });
let unsettled = 0;
let abortedLive = 0;
const abortedWhy = [];
const teardownFails = [];

(async () => {
  fleet.install([
    fleet.agent('marcus', { state: 'idle', displayName: 'Marcus Webb', role: 'Director of Research' }),
  ]);
  const server = await srv.start(0);
  const port = server.address().port;
  const errs = [];
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch(engine === 'chromium'
      ? { headless: process.env.HEADED === '0', args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'] }
      : { headless: process.env.HEADED === '0' });
    const live = new Map();
    const unroute = async (ctx, page) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await page.close().catch((e) => teardownFails.push('page.close: ' + (e && e.message)));
      await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    };
    const shut = async (ctx, page) => {
      live.delete(ctx);
      await unroute(ctx, page);
      await ctx.close().catch((e) => teardownFails.push('ctx.close: ' + (e && e.message)));
    };
    const open = async (host, theme, { app = true, computers = ONE } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: theme, hasTouch: true, serviceWorkers: 'block' });
      await ctx.addInitScript(() => { try { localStorage.setItem('kosmos.switcherTipSeen', '1'); } catch {} });
      /* What the app's WKUserScript does at document start (#6846 part b). Playwright's init script can run before
         <html> exists (documentElement null: the first run threw, the class never landed and every arm read today's
         bar), so it adds the class as soon as <html> is there. */
      if (app) await ctx.addInitScript(() => {
        const add = () => { const h = document.documentElement; if (h) h.classList.add('kapptabs'); return !!h; };
        if (!add()) new MutationObserver((m, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true });
      });
      /* M4: record the menu's first level on screen while the menu is open. A MutationObserver reports after the
         click's own synchronous work, so this sees a pass that lasts past it (the animated walk through the first level
         that kappOpenAt used to make: 160ms on screen), not a show-and-hide inside one task. */
      await ctx.addInitScript(() => {
        window.__mainSeen = false;
        const watch = () => {
          const nav = document.getElementById('pnav');
          if (!nav) return;
          const main = nav.querySelector('.pnav-level[data-level="main"]');
          new MutationObserver(() => { if (!nav.hidden && main && !main.hidden) window.__mainSeen = true; })
            .observe(nav, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] });
        };
        let tries = 0;   // the menu is built at boot over Kosmos+; off it (C2) there is none, so stop after 10 s
        const tryWatch = () => { if (document.getElementById('pnav')) watch(); else if (++tries < 100) setTimeout(tryWatch, 100); };
        document.addEventListener('DOMContentLoaded', tryWatch);
      });
      if (engine === 'webkit' && host === 'remote.test') {
        await ctx.route(/^http:\/\/remote\.test(:\d+)?\//, async (r) => {
          try {
            const u = new URL(r.request().url());
            const res = await r.fetch({ url: 'http://127.0.0.1:' + port + u.pathname + u.search, headers: Object.assign({}, r.request().headers(), { host: 'remote.test:' + port }) });
            return await r.fulfill({ response: res });
          } catch (e) {
            const pg = live.get(ctx);
            if (pg && !pg.isClosed()) { abortedLive++; abortedWhy.push(r.request().url() + ': ' + (e && e.message)); }
            return r.abort().catch(() => {});
          }
        });
      }
      const page = await ctx.newPage();
      live.set(ctx, page);
      page.on('pageerror', (e) => errs.push(engine + ' ' + theme + ': ' + e.message));
      await page.route('**/api/remote/computers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(computers) }));
      await page.route('**/_kosmos/logout', (r) => r.fulfill({ status: 404, body: '' }));
      await page.goto('http://' + host + ':' + port + '/', { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      /* The computers answer has been taken in (worldswComputersSeen names this computer), not merely asked for: an arm
         about one computer must not pass on a board that has not heard yet (review 1). Off Kosmos+ there is no read. */
      const mine = computers.computers.find((c) => c.this).name;
      const landed = host !== 'remote.test' ? true : await page.waitForFunction((n) => typeof THIS_COMPUTER_NAME !== 'undefined' && THIS_COMPUTER_NAME === n, mine, { timeout: 10000 }).then(() => true, () => false);
      chk(landed, '[' + engine + '] ' + theme + ' the computers answer was taken in before the arms read the header');
      return { ctx, page };
    };
    const E = '[' + engine + '] ';
    try {
      // C1 CONTROL: over Kosmos+ without the app's class, today's bar: the mark, the two lines, 48px, no app controls.
      {
        const { ctx, page } = await open('remote.test', 'light', { app: false, computers: TWO });
        const l = await look(page);
        chk(l.bar && l.bar.h === 48 && l.mark && l.twoLines && !l.comp && !l.me,
          E + 'C1 CONTROL: without the app\'s class the bar is today\'s (48px, the mark, the two lines, no app controls)', JSON.stringify({ bar: l.bar, mark: l.mark, two: l.twoLines, comp: l.comp, me: l.me }));
        await shut(ctx, page);
      }
      // C2 CONTROL: the Mac's own address with the class: no bar at all, today's header (the class alone does nothing).
      {
        const { ctx, page } = await open('127.0.0.1', 'light', { app: true, computers: TWO });
        const l = await look(page);
        chk(!l.bar && !l.comp && !l.me && l.klink && l.burger,
          E + 'C2 CONTROL: on the Mac itself the app\'s class changes nothing (no bar, the K mark and menu button stay)', JSON.stringify({ bar: !!l.bar, comp: l.comp, me: l.me, klink: l.klink, burger: l.burger }));
        await shut(ctx, page);
      }
      for (const theme of ['light', 'dark']) {
        const T = E + theme + ' ';
        // One computer: the face only.
        {
          const { ctx, page } = await open('remote.test', theme, { computers: ONE });
          const l = await look(page);
          chk(l.bar && l.bar.t === 0 && l.bar.h === 44 && l.bar.l === 0 && l.bar.r === l.pageW && l.barBg === NAVY,
            T + 'H1 the app header is the navy bar, 44px, edge to edge at the top', JSON.stringify({ bar: l.bar, bg: l.barBg, pageW: l.pageW }));
          chk(!l.mark && !l.twoLines && !l.tabs && !l.burger && !l.klink,
            T + 'H2 no Kosmos+ mark, no two lines, no tab strip, no menu button, no K mark', JSON.stringify({ mark: l.mark, two: l.twoLines, tabs: l.tabs, burger: l.burger, klink: l.klink }));
          chk(!l.comp && l.compName === 'studio-laptop', T + 'H3 one computer: nothing on the left (Josh #6396), though the header knows its name', JSON.stringify({ comp: l.comp, name: l.compName }));
          chk(l.me && l.me.w === 44 && l.me.h === 44 && l.face && l.face.w === 32 && l.face.h === 32 && Math.abs(l.face.r - (l.pageW - 16)) <= 1
            && Math.abs((l.face.t + l.face.h / 2) - 22) <= 1 && l.meLabel === 'Settings, You',
            T + 'H4 the face is 32px in a 44px target, 16px from the right, centred on the bar, named for what it opens (no name yet: You)', JSON.stringify({ me: l.me, face: l.face, label: l.meLabel, pageW: l.pageW }));
          chk(l.apphead && l.apphead.b === 44, T + 'H5 on a quiet board the app header is the whole header', JSON.stringify(l.apphead));
          // The face opens the menu at Settings; closing gives focus back to the face.
          await page.click('#kapp-me');
          await settled(page);
          let m = await look(page);
          chk(m.nav && m.nav.shown && JSON.stringify(m.nav.level) === '["settings"]' && m.meExp === 'true',
            T + 'M1 the face opens the phone menu at Settings', JSON.stringify({ nav: m.nav, exp: m.meExp }));
          await page.click('#pnav-x');
          await settled(page);
          m = await look(page);
          chk(m.nav && !m.nav.shown && m.focus === 'kapp-me' && m.meExp === 'false',
            T + 'M2 closing gives focus back to the face (the two lines are hidden here)', JSON.stringify({ nav: m.nav, focus: m.focus, exp: m.meExp }));
          // Choosing a Settings section opens it and gives focus back to the face too (review 1: it fell to the page).
          await page.click('#kapp-me');
          await settled(page);
          const passedMain = await page.evaluate(() => window.__mainSeen === true);
          await page.click('#pnav .pnav-level[data-level="settings"] [data-pnav-sec="usage"]');
          await settled(page);
          m = await look(page);
          const usage = await page.evaluate(() => { const p = document.getElementById('panel-settings'); const b = document.querySelector('#s-nav button.on'); return !!p && p.getClientRects().length > 0 && !!b && b.dataset.go === 'usage'; });
          chk(m.nav && !m.nav.shown && usage && m.focus === 'kapp-me',
            T + 'M3 a Settings section chosen from the face opens it, and focus goes back to the face', JSON.stringify({ nav: m.nav, usage, focus: m.focus }));
          chk(!passedMain, T + 'M4 the face opens straight at Settings, never showing the first level on the way', String(passedMain));
          // The face as the person's name and picture change it (paintRailMe repaints the user menu and this together).
          const faces = await page.evaluate(() => {
            const f = () => { const b = document.getElementById('kapp-me'); const x = b.querySelector('img, .youtint'); const r = x && x.getBoundingClientRect();
              return { label: b.getAttribute('aria-label'), kind: x ? x.tagName + (x.textContent ? ':' + x.textContent : '') : null, w: r && Math.round(r.width), h: r && Math.round(r.height) }; };
            const empty = f();
            YOU_NAME = 'Josh Example'; paintRailMe(); const named = f();
            YOU_PIC = true; paintRailMe(); const pic = f();
            return { empty, named, pic };
          });
          chk(faces.empty.kind === 'SPAN' && faces.empty.w === 32 && faces.named.kind === 'SPAN:J' && faces.named.label === 'Settings, Josh Example' && faces.named.w === 32
            && faces.pic.kind === 'IMG' && faces.pic.w === 32 && faces.pic.h === 32,
            T + 'M5 the face: an empty disc with no name, initials once named, the picture once set, always 32px, named for the person', JSON.stringify(faces));
          await shut(ctx, page);
        }
        // Two computers: the name on the left opens Switch Computers.
        {
          const { ctx, page } = await open('remote.test', theme, { computers: TWO });
          await page.waitForFunction(() => { const c = document.getElementById('kapp-comp'); return c && !c.hidden; }, null, { timeout: 10000 }).catch(() => {});
          const l = await look(page);
          const barLabel = await page.evaluate(() => document.getElementById('kplus-bar').getAttribute('aria-label'));
          chk(barLabel === 'Kosmos', T + 'S0 in the app the bar is named Kosmos, not a remote session', String(barLabel));
          chk(l.comp && l.comp.l === 16 && l.comp.h === 44 && l.comp.w >= 44 && l.compName === 'studio-laptop' && l.compColor === WHITE && l.compFont === '15px 600'
            && l.compLabel === 'Your computers. This computer: studio-laptop' && l.me,
            T + 'S1 two computers: this computer\'s name left (16px in, 15px semibold, white), the face right', JSON.stringify({ comp: l.comp, name: l.compName, color: l.compColor, font: l.compFont, label: l.compLabel }));
          await page.click('#kapp-comp');
          await settled(page);
          let m = await look(page);
          chk(m.nav && m.nav.shown && JSON.stringify(m.nav.level) === '["computers"]' && m.compExp === 'true',
            T + 'S2 the name opens the phone menu at Switch Computers', JSON.stringify({ nav: m.nav, exp: m.compExp }));
          // Back walks up: Settings, then the first level.
          await page.click('#pnav-back');
          await settled(page);
          m = await look(page);
          chk(m.nav && JSON.stringify(m.nav.level) === '["settings"]' && m.focus === 'pnav-computers', T + 'S3 Back from Switch Computers is Settings, focus on Switch Computers', JSON.stringify({ nav: m.nav, focus: m.focus }));
          await page.click('#pnav-back');
          await settled(page);
          m = await look(page);
          const onSettings = await page.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.pnavGo === 'settings');
          chk(m.nav && JSON.stringify(m.nav.level) === '["main"]' && onSettings, T + 'S3b Back again is the first level, focus on Settings', JSON.stringify({ nav: m.nav, focus: m.focus, onSettings }));
          // M4's CONTROL: the watcher that M4 reads does see the first level when it is shown (here, by Back).
          chk(await page.evaluate(() => window.__mainSeen === true), T + 'M4 CONTROL: the first-level watcher sees the first level when it is on screen');
          await page.click('#pnav-x');
          await settled(page);
          m = await look(page);
          chk(m.nav && !m.nav.shown && m.focus === 'kapp-comp' && m.compExp === 'false', T + 'S4 closing gives focus back to the name', JSON.stringify({ nav: m.nav, focus: m.focus }));
          await shut(ctx, page);
        }
        // A long name a person gave their computer: cut with an ellipsis, the face still in place, no sideways scroll.
        {
          const { ctx, page } = await open('remote.test', theme, { computers: TWO_LONG });
          await page.waitForFunction(() => { const c = document.getElementById('kapp-comp'); return c && !c.hidden; }, null, { timeout: 10000 }).catch(() => {});
          const l = await look(page);
          const cut = await page.evaluate(() => { const n = document.getElementById('kapp-comp-name'); return { sw: n.scrollWidth, cw: n.clientWidth, docW: document.documentElement.scrollWidth, vw: window.innerWidth }; });
          chk(l.comp && l.me && l.compName === LONG && l.comp.r <= l.me.l && cut.sw > cut.cw && cut.docW <= cut.vw && l.face && Math.abs(l.face.r - (l.pageW - 16)) <= 1,
            T + 'S5 a long computer name is cut short before the face, which stays 16px from the right, and the page does not scroll sideways', JSON.stringify({ comp: l.comp, me: l.me, face: l.face, cut }));
          await shut(ctx, page);
        }
      }
    } finally {
      for (const [ctx, page] of [...live]) { live.delete(ctx); await unroute(ctx, page); }
      await browser.close().catch((e) => teardownFails.push('browser.close: ' + (e && e.message)));
    }
  }
  chk(errs.length === 0, 'no page errors', JSON.stringify(errs.slice(0, 3)));
  chk(unsettled === 0, 'every wait for the menu to settle settled', String(unsettled));
  chk(abortedLive === 0, 'no proxied remote.test request failed while its page was open (kosmos#5921)', abortedLive + ' ' + JSON.stringify(abortedWhy.slice(0, 3)));
  chk(teardownFails.length === 0, 'every context and browser closed cleanly (kosmos#5921)', JSON.stringify(teardownFails));
  server.close();
  for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  console.log(`\nrender-apptabs-6846: ${pass} passed, ${fail.length} failed`);
  for (const f of fail) console.log('  FAIL  ' + f);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-apptabs-6846 crashed: ' + (e && e.stack || e)); process.exit(1); });
