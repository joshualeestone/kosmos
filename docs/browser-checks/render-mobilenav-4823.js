// Browser-check-surface: kplus-bar kplus-menu pnav pnav-item pnav-back pnav-logout pnav-computers pnav-dot pnav-themeopt lpill lpres boardbar new-agent setNavBadge
'use strict';

/**
 * Josh's mobile web redesign (kosmos#4823, 2026-09-30 20:54 and 20:56, mockups navigation-mock.png and
 * agents-listview-mock.png): on a phone viewing the board through Kosmos+, the navy bar is the whole header (apple.com's
 * 48px, the Kosmos+ mark left, two lines right), the two lines open a full-screen navy menu (Agents, Projects, Tasks
 * when its tab shows, Settings, with the tab bubbles), Settings goes one level deeper the apple.com way (a back chevron,
 * every Settings section, Switch Computers when there is another computer, Appearance, a small Log out), and the Agents
 * page has no count tiles and no grid, a square plus, and white rows with the ring, the dot and a state pill.
 *
 * Harness: the real board (render-plus-bar-3837's), reached through remote.test, at 430x932 (the size Josh's mock was
 * drawn at), in Chromium and WebKit (a phone on Kosmos+ is Safari). Chromium maps remote.test to loopback; WebKit has
 * no such switch, so its context answers remote.test from the same board through Playwright's router, with service
 * workers blocked so every request goes through it. CONTROLS: the same phone size on the Mac's own address (127.0.0.1)
 * keeps today's header and board, and the remote board at 1280 wide keeps today's list.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-mobilenav-4823.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mnav-' + tag)); ROOTS.push(d); return d; };
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
// The Settings page's sections on this board, in order, by their words (never read back from the page: a list read
// with the code's own method would agree with the code even when both are wrong).
const SECTIONS = ['Your Profile', 'AI Models', 'Connections', 'Global Skills', 'AI Policies', 'Computer', 'Automation', 'Token Usage', 'Updates', 'Kosmos+', 'Advanced'];
const TWO = { ok: true, domain: 'kosmosplus.example', computers: [
  { name: 'studio-laptop', address: 'studio-laptop.kosmosplus.example', this: true, online: true },
  { name: 'desk-mini', address: 'desk-mini.kosmosplus.example', this: false, online: true },
] };

// Everything the arms read, in one pass, so an arm cannot read a different moment from its neighbour.
const look = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const q = (s) => document.querySelector(s);
  const nav = q('#pnav');
  const level = nav ? [...nav.querySelectorAll('.pnav-level')].filter((l) => !l.hidden).map((l) => l.dataset.level) : [];
  const items = (lv) => nav ? [...nav.querySelectorAll('.pnav-level[data-level="' + lv + '"] .pnav-item')].filter(vis).map((b) => b.querySelector('.pnav-text').textContent) : [];
  const firstItem = nav && nav.querySelector('.pnav-level[data-level="main"] .pnav-item .pnav-text');
  const rowOf = (sel) => { const r = q(sel); return r && { bg: getComputedStyle(r).backgroundColor, img: getComputedStyle(r).backgroundImage,
    ring: vis(r.querySelector('.lring')) ? rect(r.querySelector('.lring')) : null, dot: vis(r.querySelector('.lpres')),
    pill: vis(r.querySelector('.lpill')) ? getComputedStyle(r.querySelector('.lpill'), '::after').content.replace(/^"|"$/g, '') : null, mem: vis(r.querySelector('.lmem')), task: vis(r.querySelector('.ltask')) }; };
  return {
    /* The page's own width: CI's browser reserves a scrollbar gutter (415 of 430), a phone does not. Read from the body's
       right edge: on CI documentElement.clientWidth still read 430 while the gutter took 15px (run 36861960715). */
    pageW: Math.round(document.body.getBoundingClientRect().right),
    cw: document.documentElement.clientWidth, iw: window.innerWidth,
    bar: rect(q('#kplus-bar')), barBg: q('#kplus-bar') ? getComputedStyle(q('#kplus-bar')).backgroundColor : null,
    mark: rect(q('#kplus-bar canvas')), menuBtn: vis(q('#kplus-menu')) ? rect(q('#kplus-menu')) : null,
    logoutBtn: vis(q('#kplus-logout')), klink: vis(q('#klink')), userpop: vis(q('#userpop')), burger: vis(q('#burger')),
    apphead: rect(q('.apphead')), stats: vis(q('#boardbar .stats')), gridBtn: vis(q('#boardbar .vt[data-layout="grid"]')),
    newAgent: rect(q('#new-agent')), newAgentName: q('#new-agent') ? q('#new-agent').textContent.replace(/\s+/g, ' ').trim() : '',
    sortH: rect(q('#agent-sort')) && rect(q('#agent-sort')).h, vtH: rect(q('#boardbar .vt[data-layout="list"]')) && rect(q('#boardbar .vt[data-layout="list"]')).h,
    layout: typeof BOARD_LAYOUT !== 'undefined' ? BOARD_LAYOUT : null, saved: (() => { try { return localStorage.getItem('kosmos.layout.agents'); } catch { return 'X'; } })(),
    listShown: vis(q('#alist')),
    idle: rowOf('#alist .lrow:not(.working):not(.notrunning)'), working: rowOf('#alist .lrow.working'),
    nav: nav && { shown: !nav.hidden, rect: rect(nav), bg: getComputedStyle(nav).backgroundColor, level, items: items(level[0] || 'main'),
      font: firstItem ? getComputedStyle(firstItem).fontSize : null, textLeft: firstItem ? Math.round(firstItem.getBoundingClientRect().left) : null,
      x: vis(q('#pnav-x')), back: vis(q('#pnav-back')) && getComputedStyle(q('#pnav-back')).opacity === '1',
      logout: vis(q('#pnav-logout')), msg: q('#pnav-msg').textContent, computers: vis(q('#pnav-computers')),
      themes: [...nav.querySelectorAll('.pnav-themeopt')].filter(vis).map((b) => b.dataset.themeSet + ':' + b.getAttribute('aria-checked')),
      dots: [...nav.querySelectorAll('.pnav-level[data-level="settings"] .pnav-item')].filter((b) => b.querySelector('.pnav-dot')).map((b) => b.querySelector('.pnav-text').textContent),
      needsWords: [...nav.querySelectorAll('.pnav-text')].some((t) => /needs you/.test(t.textContent)),
      comps: [...nav.querySelectorAll('.pnav-level[data-level="computers"] .pnav-item')].filter(vis).map((b) => b.tagName + ':' + b.querySelector('.pnav-text').textContent),
      badge: vis(q('#nav-badge-agents-m')) ? q('#nav-badge-agents-m').textContent : null, focusIn: nav.contains(document.activeElement) },
    tabBadge: q('#nav-badge-agents') && !q('#nav-badge-agents').hidden ? q('#nav-badge-agents').textContent : null,
    up: document.documentElement.classList.contains('pnav-up'), expanded: q('#kplus-menu') && q('#kplus-menu').getAttribute('aria-expanded'),
    tab: q('#tabs .tab.on') ? q('#tabs .tab.on').dataset.tab : null, settingsShown: vis(q('#panel-settings')), secOn: q('#s-nav button.on') ? q('#s-nav button.on').dataset.go : null,
    focus: document.activeElement && document.activeElement.id,
  };
});
// The menu at rest: open, no level move pending, nothing animating inside it.
const settled = (page) => page.waitForFunction(() => {
  const n = document.getElementById('pnav');
  if (!n) return true;
  if (n.hidden) return true;
  return !n.classList.contains('opening') && typeof PNAV_PENDING !== 'undefined' && PNAV_PENDING === null
    && n.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length === 0
    && document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && n.contains(a.effect.target)).length === 0;
}, null, { timeout: 5000 }).then(() => true, () => { unsettled++; return false; });
let unsettled = 0;   // a wait that timed out is reported, never swallowed (review round 2)

(async () => {
  fleet.install([
    fleet.agent('marcus', { state: 'idle', displayName: 'Marcus Webb', role: 'Director of Research & Market Intelligence' }),
    fleet.agent('elon', { state: 'working', displayName: 'Elon', role: 'Project Manager' }),
  ]);
  const server = await srv.start(0);
  const port = server.address().port;
  const errs = [];
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch(engine === 'chromium'
      ? { headless: process.env.HEADED === '0', args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'] }
      : { headless: process.env.HEADED === '0' });
    const open = async (host, theme, opts) => {
      const ctx = await browser.newContext(Object.assign({ viewport: { width: 430, height: 932 }, colorScheme: theme, hasTouch: true, serviceWorkers: 'block' }, opts || {}));
      if (engine === 'webkit' && host === 'remote.test') {
        // remote.test answered by the same board on loopback; the Host header stays remote.test, which the board accepts.
        await ctx.route(/^http:\/\/remote\.test(:\d+)?\//, async (r) => {
          const u = new URL(r.request().url());
          const res = await r.fetch({ url: 'http://127.0.0.1:' + port + u.pathname + u.search, headers: Object.assign({}, r.request().headers(), { host: 'remote.test:' + port }) });
          return r.fulfill({ response: res });
        });
      }
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errs.push(engine + ' ' + theme + ': ' + e.message));
      // A known context reading and an unread message, so the ring and the bubbles have something to show.
      await page.route('**/api/status*', async (r) => {
        const res = await r.fetch({ url: r.request().url().replace(/^http:\/\/remote\.test/, 'http://127.0.0.1') }); let j;
        try { j = await res.json(); } catch { return r.fulfill({ response: res }); }
        (j.agents || []).forEach((a, i) => { a.context = Object.assign({}, a.context || {}, { percent: 40 + i * 20 }); a.dmUnread = i === 0 ? 3 : 0; });
        return r.fulfill({ response: res, json: j });
      });
      await page.route('**/api/remote/computers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TWO) }));
      await page.route('**/_kosmos/logout', (r) => r.fulfill({ status: 404, body: '' }));
      await page.goto('http://' + host + ':' + port + '/', { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      await page.evaluate(() => { try { localStorage.setItem('kosmos.layout.agents', 'grid'); } catch { /* reported by the saved arm */ } });
      await page.reload({ waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      await page.waitForFunction(() => document.querySelectorAll('#alist .lrow, #grid .acard').length >= 2 && (document.getElementById('nav-badge-agents') || {}).hidden === false, null, { timeout: 15000 }).catch(() => {});
      return { ctx, page };
    };
    const E = '[' + engine + '] ';
    try {
      // L CONTROL: a phone-size window on the Mac's own address keeps today's header and board.
      {
        const { ctx, page } = await open('127.0.0.1', 'light');
        const l = await look(page);
        chk(!l.bar && !l.nav && l.klink && l.burger && l.stats && l.gridBtn && l.layout === 'grid',
          E + 'L CONTROL: on the Mac itself at phone width there is no navy bar or phone menu; the K mark, the menu button, the count tiles and the grid stay',
          JSON.stringify({ bar: !!l.bar, nav: !!l.nav, klink: l.klink, burger: l.burger, stats: l.stats, grid: l.gridBtn, layout: l.layout }));
        await ctx.close();
      }
      for (const theme of ['light', 'dark']) {
        const T = E + theme + ' ';
        const { ctx, page } = await open('remote.test', theme);
        let l = await look(page);
        chk(l.bar && l.bar.t === 0 && l.bar.h === 48 && l.bar.l === 0 && l.bar.r === l.pageW && l.barBg === NAVY,
          T + 'H1 the navy bar is apple.com\'s 48px, edge to edge at the top', JSON.stringify({ bar: l.bar, bg: l.barBg, pageW: l.pageW, cw: l.cw, iw: l.iw }));
        chk(l.mark && l.mark.h === 14 && l.mark.l === 16 && Math.abs((l.mark.t + l.mark.h / 2) - 24) <= 1,
          T + 'H2 the Kosmos+ mark is 14px tall, 16px in, centred on the bar (Josh\'s mock)', JSON.stringify(l.mark));
        chk(l.menuBtn && l.menuBtn.r === l.pageW && l.menuBtn.h === 48 && l.menuBtn.t === 0,
          T + 'H3 the two lines sit at the right of the bar in a 48px box', JSON.stringify({ btn: l.menuBtn, pageW: l.pageW, cw: l.cw }));
        chk(!l.logoutBtn && !l.klink && !l.userpop && !l.burger,
          T + 'H4 no Log out button, K mark, name or old menu button in the header', JSON.stringify({ out: l.logoutBtn, klink: l.klink, userpop: l.userpop, burger: l.burger }));
        chk(l.apphead && l.apphead.b === 48, T + 'H5 on a quiet board the navy bar is the whole header', JSON.stringify(l.apphead));
        chk(!l.stats && !l.gridBtn, T + 'A1 no count tiles and no grid button', JSON.stringify({ stats: l.stats, grid: l.gridBtn }));
        chk(l.layout === 'list' && l.saved === 'grid' && l.listShown, T + 'A2 a saved grid shows as the list here, and the saved choice is kept', JSON.stringify({ layout: l.layout, saved: l.saved, list: l.listShown }));
        chk(l.newAgent && l.newAgent.w === 44 && l.newAgent.h === 44 && l.newAgentName.includes('New agent') && l.sortH === 44 && l.vtH === 44,
          T + 'A3 New agent is a 44px square plus (still named New agent), the sort and the view buttons 44px tall', JSON.stringify({ na: l.newAgent, name: l.newAgentName, sort: l.sortH, vt: l.vtH }));
        chk(l.idle && l.idle.ring && l.idle.ring.w === 74 && l.idle.dot && l.idle.pill === 'Idle' && !l.idle.mem && !l.idle.task,
          T + 'A4 a row has the 74px ring, the dot and a state pill, and no memory bar or task line', JSON.stringify(l.idle));
        // The state washes are background IMAGES; the ground is only white when there is none (round 1: the colour alone passes on main).
        chk(l.working && l.working.img === 'none' && l.idle.img === 'none' && (theme === 'dark' || (l.working.bg === 'rgb(255, 255, 255)' && l.idle.bg === 'rgb(255, 255, 255)')),
          T + 'A5 rows have no state wash: a working row is white too', JSON.stringify({ working: l.working && [l.working.bg, l.working.img], idle: [l.idle.bg, l.idle.img] }));

        // A second sample half a pulse later: the working pulse animates the ground colour (review round 3).
        await page.waitForTimeout(1800);
        const l2 = await look(page);
        chk(l2.working && l2.working.img === 'none' && (theme === 'dark' || l2.working.bg === 'rgb(255, 255, 255)'),
          T + 'A6 the working row stays white through its pulse', JSON.stringify(l2.working && [l2.working.bg, l2.working.img]));

        // The menu.
        await page.click('#kplus-menu');
        await settled(page);
        l = await look(page);
        chk(l.nav && l.nav.shown && l.nav.rect.t === 0 && l.nav.rect.l === 0 && l.nav.rect.w === 430 && l.nav.rect.h === 932 && l.nav.bg === NAVY && l.up && l.expanded === 'true',
          T + 'M1 the menu takes the whole screen in Kosmos+ navy and the page stops scrolling', JSON.stringify({ nav: l.nav && l.nav.rect, bg: l.nav && l.nav.bg, up: l.up, exp: l.expanded }));
        chk(l.nav && JSON.stringify(l.nav.items) === JSON.stringify(['Agents', 'Projects', 'Settings']) && l.nav.font === '28px' && l.nav.textLeft === 63,
          T + 'M2 Agents, Projects, Settings (Tasks waits for its tab) in 28px type, 63px in (the mock)', JSON.stringify(l.nav && { items: l.nav.items, font: l.nav.font, left: l.nav.textLeft }));
        const capTop = await page.evaluate(() => { const t = document.querySelector('#pnav .pnav-level[data-level="main"] .pnav-item .pnav-text'); return Math.round(t.getBoundingClientRect().top); });
        chk(Math.abs(capTop - 54) <= 4, T + 'M2b the first word sits where Josh\'s mock has it (its line box at about 54px, capitals at about 61)', String(capTop));
        chk(l.nav && l.nav.badge === '3' && l.tabBadge === '3', T + 'M3 the Agents bubble says what the Agents tab bubble says', JSON.stringify({ menu: l.nav && l.nav.badge, tab: l.tabBadge }));
        chk(l.nav && l.nav.x && !l.nav.back && l.nav.focusIn, T + 'M4 an X, no back chevron on the first level, and focus inside the menu', JSON.stringify(l.nav && { x: l.nav.x, back: l.nav.back, focus: l.nav.focusIn }));
        for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
        l = await look(page);
        chk(l.nav && l.nav.focusIn, T + 'M5 Tab stays inside the menu', JSON.stringify({ focus: l.focus }));
        for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+Tab');
        l = await look(page);
        chk(l.nav && l.nav.focusIn, T + 'M6 Shift+Tab stays inside the menu', JSON.stringify({ focus: l.focus }));
        // The board's other layers treat the open menu as covering (What's New, the community notice, tips), the
        // menu's keys stand down while a screen above makes it inert, and the status stamp reads as the page's does.
        // (The one-time community notice this also held is gone from main, #4820.)
        const cov = await page.evaluate(() => ({ tip: tipModalOpen(), wn: wnCovered() }));
        chk(cov.tip && cov.wn, T + 'K1 with the menu open, tips and What\'s New wait', JSON.stringify(cov));
        const stamp = await page.evaluate(() => ({ menu: document.getElementById('pnav-stamp').textContent,
          page: [...document.getElementById('checked').childNodes].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ') }));
        chk(stamp.menu !== '' && stamp.menu === stamp.page && !/[a-z][A-Z]/.test(stamp.menu), T + 'K2 the menu carries the Agent status stamp, its parts spaced', JSON.stringify(stamp));
        await page.evaluate(() => { document.getElementById('pnav').inert = true; });
        await page.keyboard.press('Escape');
        const inertOpen = await page.evaluate(() => !document.getElementById('pnav').hidden);
        await page.evaluate(() => { document.getElementById('pnav').inert = false; });
        chk(inertOpen, T + 'K3 while a screen above makes the menu inert, its Escape does nothing', String(inertOpen));

        // Settings, one level deeper, opened from the Agents tab (the Settings panel itself is hidden then).
        await page.click('[data-pnav-go="settings"]');
        await page.waitForFunction(() => !document.getElementById('pnav-computers').hidden, null, { timeout: 5000 }).catch(() => {});
        await settled(page);
        l = await look(page);
        chk(l.nav && JSON.stringify(l.nav.level) === '["settings"]' && JSON.stringify(l.nav.items) === JSON.stringify(SECTIONS) && !l.nav.needsWords,
          T + 'S1 Settings lists every Settings section by its own words, from the Agents tab, with no "(needs you)" when nothing does', JSON.stringify(l.nav && { level: l.nav.level, items: l.nav.items }));
        chk(l.nav && l.nav.back && l.nav.logout && l.nav.computers && l.nav.focusIn && l.nav.themes.length === 2,
          T + 'S2 a back chevron, Switch Computers (another computer is online), Appearance, Log out, and focus inside',
          JSON.stringify(l.nav && { back: l.nav.back, out: l.nav.logout, comps: l.nav.computers, themes: l.nav.themes, focus: l.nav.focusIn }));
        chk(l.nav && l.nav.themes.includes(theme + ':true'), T + 'S3 Appearance shows the theme in use', JSON.stringify(l.nav && l.nav.themes));
        await page.click('#pnav-logout');
        await page.waitForFunction(() => document.getElementById('pnav-msg').textContent !== '', null, { timeout: 12000 }).catch(() => {});
        l = await look(page);
        chk(l.nav && l.nav.msg === 'Log out is not available on this Kosmos yet.', T + 'S4 Log out runs the Kosmos+ log out and says what happened', JSON.stringify(l.nav && l.nav.msg));

        // Switch Computers, a third level. Its read is slowed here, so the arm can see the level BEFORE the answer: an
        // earlier read's "Online" link must not be offered while a fresh one is on its way (review round 5).
        await page.unroute('**/api/remote/computers*');
        await page.route('**/api/remote/computers*', async (r) => { await new Promise((res) => setTimeout(res, 1500)); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TWO) }); });
        const stale = await page.evaluate(() => document.querySelectorAll('#worldsw-computers-list a').length);
        chk(stale > 0, T + 'C0 precondition: an earlier read left an Online link that the fresh read must clear', String(stale));
        await page.click('#pnav-computers');
        await page.waitForTimeout(400);
        const early = await page.evaluate(() => [...document.querySelectorAll('#pnav .pnav-level[data-level="computers"] a.pnav-item')].length);
        chk(early === 0, T + 'C0 before the fresh answer lands the level offers no link', String(early));
        await page.waitForFunction(() => document.querySelectorAll('#pnav .pnav-level[data-level="computers"] a.pnav-item').length > 0, null, { timeout: 6000 }).catch(() => {});
        await settled(page);
        l = await look(page);
        chk(l.nav && JSON.stringify(l.nav.level) === '["computers"]' && JSON.stringify(l.nav.comps) === JSON.stringify(['DIV:studio-laptop', 'A:desk-mini']) && l.nav.focusIn,
          T + 'C1 Switch Computers lists the account\'s computers (this one plain, the other a link) and focus stays in the menu', JSON.stringify(l.nav && { level: l.nav.level, comps: l.nav.comps, focus: l.focus }));
        await page.keyboard.press('Escape');
        await settled(page);
        l = await look(page);
        chk(l.nav && l.nav.shown && JSON.stringify(l.nav.level) === '["settings"]', T + 'C2 Escape one level deep goes back a level, not out', JSON.stringify(l.nav && l.nav.level));
        // Escape left focus on Switch Computers (it came back to the item that went forward).
        const backTo = await page.evaluate(() => document.activeElement && document.activeElement.id);
        chk(backTo === 'pnav-computers', T + 'C3 coming back, focus is on the item that went forward', JSON.stringify(backTo));
        // Appearance: choosing the other theme applies it, and the pair shows it.
        const other = theme === 'light' ? 'dark' : 'light';
        await page.click('.pnav-themeopt[data-theme-set="' + other + '"]');
        const th = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'),
          opts: [...document.querySelectorAll('#pnav .pnav-themeopt')].map((b) => b.dataset.themeSet + ':' + b.getAttribute('aria-checked') + ':' + b.tabIndex) }));
        chk(th.attr === other && th.opts.includes(other + ':true:0') && th.opts.includes(theme + ':false:-1'), T + 'P1 Appearance applies the theme chosen and moves the tab stop to it', JSON.stringify(th));
        await page.click('.pnav-themeopt[data-theme-set="' + theme + '"]');
        await page.click('#pnav-back');
        await settled(page);
        l = await look(page);
        chk(l.nav && JSON.stringify(l.nav.level) === '["main"]' && !l.nav.back, T + 'B1 back returns to the first level and the chevron goes', JSON.stringify(l.nav && { level: l.nav.level, back: l.nav.back }));

        // A needs-you section shows its dot; a second tap inside the 160ms move leaves exactly one level.
        // Closed in the middle of a move, then opened again: it opens on the first level, one level, nothing hanging.
        await page.evaluate(() => { document.querySelector('[data-pnav-go="settings"]').click(); document.getElementById('pnav-x').click(); });
        await page.click('#kplus-menu');
        await settled(page);
        l = await look(page);
        chk(l.nav && l.nav.shown && JSON.stringify(l.nav.level) === '["main"]' && !l.nav.back, T + 'B3 closed mid-move and reopened, the menu is on its first level', JSON.stringify(l.nav && { level: l.nav.level, back: l.nav.back }));
        await page.evaluate(() => document.querySelector('#s-nav button[data-go="plus"]').setAttribute('data-dot', '1'));
        await page.evaluate(() => { document.querySelector('[data-pnav-go="settings"]').click(); document.getElementById('pnav-back').click(); });
        await settled(page);
        l = await look(page);
        chk(l.nav && JSON.stringify(l.nav.level) === '["main"]', T + 'B2 forward and back inside one move leave exactly one level on screen', JSON.stringify(l.nav && l.nav.level));
        await page.click('[data-pnav-go="settings"]');
        await settled(page);
        l = await look(page);
        chk(l.nav && JSON.stringify(l.nav.dots) === '["Kosmos+"]', T + 'D1 a Settings section that needs you carries its dot in the menu', JSON.stringify(l.nav && l.nav.dots));
        await page.evaluate(() => document.querySelector('#s-nav button[data-go="plus"]').removeAttribute('data-dot'));
        await page.click('[data-pnav-sec="accounts"]');
        await page.waitForFunction(() => document.getElementById('pnav').hidden, null, { timeout: 3000 }).catch(() => {});
        l = await look(page);
        // Settings has no tab of its own in the tab bar, so the arm reads the Settings panel (round on render: it read the tab).
        chk(l.nav && !l.nav.shown && l.settingsShown && l.secOn === 'accounts' && !l.up && l.focus === 'kplus-menu',
          T + 'S5 a section opens that Settings section, closes the menu, and focus goes to the two lines', JSON.stringify({ shown: l.nav && l.nav.shown, settings: l.settingsShown, sec: l.secOn, up: l.up, focus: l.focus }));

        // Agents from the menu, and Escape on the first level.
        await page.click('#kplus-menu');
        await settled(page);
        await page.click('[data-pnav-tab="agents"]');
        l = await look(page);
        chk(l.nav && !l.nav.shown && l.tab === 'agents', T + 'T1 Agents in the menu opens the Agents tab', JSON.stringify({ shown: l.nav && l.nav.shown, tab: l.tab }));
        await page.click('#kplus-menu');
        await settled(page);
        await page.keyboard.press('Escape');
        l = await look(page);
        chk(l.nav && !l.nav.shown && l.focus === 'kplus-menu' && l.expanded === 'false', T + 'T2 Escape closes it and focus goes back to the two lines', JSON.stringify({ shown: l.nav && l.nav.shown, focus: l.focus, exp: l.expanded }));
        const cov2 = await page.evaluate(() => ({ tip: tipModalOpen(), wn: wnCovered() }));
        chk(!cov2.tip && !cov2.wn, T + 'K4 CONTROL: with the menu closed, tips and What\'s New are not held by it', JSON.stringify(cov2));

        // Wider while a level deep: the menu goes, and the board is today's again (the grid comes back).
        await page.click('#kplus-menu');
        await settled(page);
        await page.click('[data-pnav-go="settings"]');
        await settled(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForFunction(() => document.getElementById('pnav').hidden && BOARD_LAYOUT === 'grid', null, { timeout: 3000 }).catch(() => {});
        l = await look(page);
        chk(l.nav && !l.nav.shown && !l.menuBtn && l.logoutBtn && l.stats && l.gridBtn && l.layout === 'grid' && l.saved === 'grid' && !l.up,
          T + 'W1 CONTROL: at 1280 the menu closes and today\'s header and board are back, the saved grid with them',
          JSON.stringify({ shown: l.nav && l.nav.shown, menuBtn: !!l.menuBtn, out: l.logoutBtn, stats: l.stats, grid: l.gridBtn, layout: l.layout, saved: l.saved, up: l.up }));
        await ctx.close();
      }
      // A phone held sideways is still a phone (the board's PHONE_WIDTH): the navy header and menu button stay.
      // Chromium only: "hover: none" needs a mobile emulation, which Playwright offers in Chromium and not in WebKit.
      if (engine === 'chromium') {
        const { ctx, page } = await open('remote.test', 'light', { viewport: { width: 844, height: 390 }, isMobile: true });
        const l = await look(page);
        chk(l.bar && l.bar.h === 48 && l.menuBtn && !l.klink && !l.burger && !l.stats && !l.gridBtn,
          E + 'O1 sideways (844x390, touch) keeps the phone header and Agents page', JSON.stringify({ bar: l.bar, menuBtn: !!l.menuBtn, klink: l.klink, burger: l.burger, stats: l.stats, grid: l.gridBtn }));
        await ctx.close();
      }
      // Reduced motion: the level changes at once, with no movement.
      {
        const { ctx, page } = await open('remote.test', 'light', { reducedMotion: 'reduce' });
        await page.click('#kplus-menu');
        await page.evaluate(() => document.querySelector('[data-pnav-go="settings"]').click());
        const now = await page.evaluate(() => ({ level: [...document.querySelectorAll('#pnav .pnav-level')].filter((x) => !x.hidden).map((x) => x.dataset.level),
          running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && document.getElementById('pnav').contains(a.effect.target)).length }));
        chk(JSON.stringify(now.level) === '["settings"]' && now.running === 0, E + 'R1 with reduced motion Settings is there at once, nothing moving', JSON.stringify(now));
        await ctx.close();
      }
      // kosmos#4879: the phone menu's Log out, when it works, lands where the bar's does (P4 in render-plus-bar-3837):
      // the address's start, '#signed-out', reloaded. Its own context, since it leaves the board. S4 covers the refusal.
      // (LO1, not S5: S5 is the Settings-section arm above.)
      {
        const { ctx, page } = await open('remote.test', 'light');
        await page.unroute('**/_kosmos/logout');
        let asked = 0;
        await page.route('**/_kosmos/logout', (r) => { asked++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
        chk(await page.evaluate(() => location.pathname === '/' && location.search === ''), E + 'LO1 precondition: the board\'s address is a bare /', await page.evaluate(() => location.href));
        await page.click('#kplus-menu');
        await page.evaluate(() => document.querySelector('[data-pnav-go="settings"]').click());
        await page.waitForFunction(() => { const b = document.getElementById('pnav-logout'); return b && b.offsetParent !== null; }, null, { timeout: 5000 }).catch(() => {});
        await page.evaluate(() => { window.__before = true; });
        await page.click('#pnav-logout');
        await page.waitForFunction(() => !window.__before, null, { timeout: 8000 }).catch(() => {});
        const s5 = await page.evaluate(() => ({ reloaded: !window.__before, path: location.pathname, hash: location.hash, host: location.hostname }));
        chk(asked === 1 && s5.reloaded && s5.path === '/' && s5.hash === '#signed-out' && s5.host === 'remote.test',
          E + 'LO1 the phone menu\'s Log out that works posts once and lands on the address\'s start, signed out', JSON.stringify({ asked, lo1: s5 }));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  chk(errs.length === 0, 'no page errors', JSON.stringify(errs.slice(0, 3)));
  chk(unsettled === 0, 'every wait for the menu to settle settled', String(unsettled));
  server.close();
  for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  console.log(`\nrender-mobilenav-4823: ${pass} passed, ${fail.length} failed`);
  for (const f of fail) console.log('  FAIL  ' + f);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-mobilenav-4823 crashed: ' + (e && e.stack || e)); process.exit(1); });
