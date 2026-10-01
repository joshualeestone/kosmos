// Browser-check-surface: kplus-bar kplus-menu pnav pnav-item pnav-back pnav-logout lpill lpres boardbar new-agent setNavBadge
'use strict';

/**
 * Josh's mobile web redesign (kosmos#4823, 2026-09-30 20:54 and 20:56, mockups navigation-mock.png and
 * agents-listview-mock.png): on a phone viewing the board through Kosmos+, the navy bar is the whole header (apple.com's
 * 48px, the Kosmos+ mark left, two lines right), the two lines open a full-screen navy menu (Agents, Projects, Tasks
 * when its tab shows, Settings, with the tab bubbles), Settings goes one level deeper the apple.com way (a back chevron,
 * every Settings section, Switch Computers when there is another computer, a small Log out), and the Agents page has
 * no count tiles and no grid, a square plus, and white rows with the ring, the dot and a state pill.
 *
 * Harness: the real board (render-plus-bar-3837's), reached through remote.test (Chromium maps it to loopback; the
 * board is told to accept it), at 430x932, the size Josh's mock was drawn at. CONTROLS: the same phone size on the
 * Mac's own address (127.0.0.1) keeps today's header and board, and the remote board at 1280 wide keeps today's list.
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

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const NAVY = 'rgb(23, 35, 61)';

// Everything the arms read, in one pass, so an arm cannot read a different moment from its neighbour.
const look = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const q = (s) => document.querySelector(s);
  const nav = q('#pnav');
  const level = nav ? [...nav.querySelectorAll('.pnav-level')].filter((l) => !l.hidden).map((l) => l.dataset.level) : [];
  const items = (lv) => nav ? [...nav.querySelectorAll('.pnav-level[data-level="' + lv + '"] .pnav-item')].filter(vis).map((b) => b.querySelector('.pnav-text').textContent) : [];
  const firstItem = nav && nav.querySelector('.pnav-level[data-level="main"] .pnav-item .pnav-text');
  const row = q('#alist .lrow:not(.notrunning)');
  return {
    bar: rect(q('#kplus-bar')), barBg: q('#kplus-bar') ? getComputedStyle(q('#kplus-bar')).backgroundColor : null,
    mark: rect(q('#kplus-bar canvas')), menuBtn: vis(q('#kplus-menu')) ? rect(q('#kplus-menu')) : null,
    logoutBtn: vis(q('#kplus-logout')), klink: vis(q('#klink')), userpop: vis(q('#userpop')), burger: vis(q('#burger')),
    apphead: rect(q('.apphead')), stats: vis(q('#boardbar .stats')), gridBtn: vis(q('#boardbar .vt[data-layout="grid"]')),
    newAgent: rect(q('#new-agent')), newAgentName: q('#new-agent') ? q('#new-agent').textContent.replace(/\s+/g, ' ').trim() : '',
    sortH: rect(q('#agent-sort')) && rect(q('#agent-sort')).h, vtH: rect(q('#boardbar .vt[data-layout="list"]')) && rect(q('#boardbar .vt[data-layout="list"]')).h,
    layout: typeof BOARD_LAYOUT !== 'undefined' ? BOARD_LAYOUT : null, saved: (() => { try { return localStorage.getItem('kosmos.layout.agents'); } catch { return 'X'; } })(),
    listShown: vis(q('#alist')),
    row: row && { bg: getComputedStyle(row).backgroundColor, ring: vis(row.querySelector('.lring')) ? rect(row.querySelector('.lring')) : null,
      dot: vis(row.querySelector('.lpres')), pill: vis(row.querySelector('.lpill')) ? row.querySelector('.lpill').textContent.trim() : null,
      mem: vis(row.querySelector('.lmem')), task: vis(row.querySelector('.ltask')) },
    nav: nav && { shown: !nav.hidden, rect: rect(nav), bg: getComputedStyle(nav).backgroundColor, level, items: items(level[0] || 'main'),
      font: firstItem ? getComputedStyle(firstItem).fontSize : null, textLeft: firstItem ? Math.round(firstItem.getBoundingClientRect().left) : null,
      x: vis(q('#pnav-x')), back: vis(q('#pnav-back')) && getComputedStyle(q('#pnav-back')).opacity === '1',
      logout: vis(q('#pnav-logout')), msg: q('#pnav-msg').textContent, computers: vis(q('#pnav-computers')),
      badge: vis(q('#nav-badge-agents-m')) ? q('#nav-badge-agents-m').textContent : null, focusIn: nav.contains(document.activeElement) },
    tabBadge: vis(q('#nav-badge-agents')) || (q('#nav-badge-agents') && !q('#nav-badge-agents').hidden) ? q('#nav-badge-agents').textContent : null,
    sNav: [...document.querySelectorAll('#s-nav button[data-go]')].filter((b) => !b.hidden && !b.closest('[hidden]')).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
    up: document.documentElement.classList.contains('pnav-up'), expanded: q('#kplus-menu') && q('#kplus-menu').getAttribute('aria-expanded'),
    tab: (q('#tabs .tab.on') || {}).dataset ? q('#tabs .tab.on').dataset.tab : null, secOn: (q('#s-nav button.on') || {}).dataset ? q('#s-nav button.on').dataset.go : null,
    focus: document.activeElement && document.activeElement.id,
  };
});

(async () => {
  fleet.install([
    fleet.agent('marcus', { state: 'idle', displayName: 'Marcus Webb', role: 'Director of Research & Market Intelligence' }),
    fleet.agent('elon', { state: 'working', displayName: 'Elon', role: 'Project Manager' }),
  ]);
  const server = await srv.start(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'] });
  const errs = [];
  const open = async (host, theme, width) => {
    const ctx = await browser.newContext({ viewport: { width: width || 430, height: 932 }, colorScheme: theme, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    // A known context reading and an unread message, so the ring and the bubbles have something to show.
    await page.route('**/api/status*', async (r) => {
      const res = await r.fetch(); let j;
      try { j = await res.json(); } catch { return r.fulfill({ response: res }); }
      (j.agents || []).forEach((a, i) => { a.context = Object.assign({}, a.context || {}, { percent: 40 + i * 20 }); a.dmUnread = i === 0 ? 3 : 0; });
      return r.fulfill({ response: res, json: j });
    });
    await page.route('**/_kosmos/logout', (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto('http://' + host + ':' + port + '/', { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await page.evaluate(() => { try { localStorage.setItem('kosmos.layout.agents', 'grid'); } catch { /* reported by the saved arm */ } });
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await page.waitForFunction(() => document.querySelectorAll('#alist .lrow, #grid .acard').length >= 2 && (document.getElementById('nav-badge-agents') || {}).hidden === false, null, { timeout: 15000 }).catch(() => {});
    return { ctx, page };
  };
  try {
    // L CONTROL: a phone-size window on the Mac's own address keeps today's header and board.
    {
      const { ctx, page } = await open('127.0.0.1', 'light');
      const l = await look(page);
      chk(!l.bar && !l.nav && l.klink && l.burger && l.stats && l.gridBtn && l.layout === 'grid',
        'L CONTROL: on the Mac itself at phone width there is no navy bar or phone menu; the K mark, the menu button, the count tiles and the grid stay',
        JSON.stringify({ bar: !!l.bar, nav: !!l.nav, klink: l.klink, burger: l.burger, stats: l.stats, grid: l.gridBtn, layout: l.layout }));
      await ctx.close();
    }
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await open('remote.test', theme);
      let l = await look(page);
      chk(l.bar && l.bar.t === 0 && l.bar.h === 48 && l.bar.l === 0 && l.bar.r === 430 && l.barBg === NAVY,
        theme + ' H1 the navy bar is apple.com\'s 48px, edge to edge at the top', JSON.stringify({ bar: l.bar, bg: l.barBg }));
      chk(l.mark && l.mark.h === 14 && l.mark.l === 16 && Math.abs((l.mark.t + l.mark.h / 2) - 24) <= 1,
        theme + ' H2 the Kosmos+ mark is 14px tall, 16px in, centred on the bar (Josh\'s mock)', JSON.stringify(l.mark));
      chk(l.menuBtn && l.menuBtn.r === 430 && l.menuBtn.h === 48 && l.menuBtn.t === 0,
        theme + ' H3 the two lines sit at the right of the bar in a 48px box', JSON.stringify(l.menuBtn));
      chk(!l.logoutBtn && !l.klink && !l.userpop && !l.burger,
        theme + ' H4 no Log out button, K mark, name or old menu button in the header', JSON.stringify({ out: l.logoutBtn, klink: l.klink, userpop: l.userpop, burger: l.burger }));
      chk(l.apphead && l.apphead.b === 48, theme + ' H5 on a quiet board the navy bar is the whole header', JSON.stringify(l.apphead));
      chk(!l.stats && !l.gridBtn, theme + ' A1 no count tiles and no grid button', JSON.stringify({ stats: l.stats, grid: l.gridBtn }));
      chk(l.layout === 'list' && l.saved === 'grid' && l.listShown, theme + ' A2 a saved grid shows as the list here, and the saved choice is kept', JSON.stringify({ layout: l.layout, saved: l.saved, list: l.listShown }));
      chk(l.newAgent && l.newAgent.w === 44 && l.newAgent.h === 44 && l.newAgentName.includes('New agent') && l.sortH === 44 && l.vtH === 44,
        theme + ' A3 New agent is a 44px square plus (still named New agent), the sort and the view buttons 44px tall', JSON.stringify({ na: l.newAgent, name: l.newAgentName, sort: l.sortH, vt: l.vtH }));
      chk(l.row && l.row.ring && l.row.ring.w === 74 && l.row.dot && l.row.pill && !l.row.mem && !l.row.task,
        theme + ' A4 a row has the 74px ring, the dot and a state pill, and no memory bar or task line', JSON.stringify(l.row));
      chk(l.row && (theme === 'dark' || l.row.bg === 'rgb(255, 255, 255)'), theme + ' A5 rows are white (light)', JSON.stringify(l.row && l.row.bg));

      // The menu.
      await page.click('#kplus-menu');
      await page.waitForTimeout(700);
      l = await look(page);
      chk(l.nav && l.nav.shown && l.nav.rect.t === 0 && l.nav.rect.l === 0 && l.nav.rect.w === 430 && l.nav.rect.h === 932 && l.nav.bg === NAVY && l.up && l.expanded === 'true',
        theme + ' M1 the menu takes the whole screen in Kosmos+ navy and the page stops scrolling', JSON.stringify({ nav: l.nav && l.nav.rect, bg: l.nav && l.nav.bg, up: l.up, exp: l.expanded }));
      chk(l.nav && JSON.stringify(l.nav.items) === JSON.stringify(['Agents', 'Projects', 'Settings']) && l.nav.font === '28px' && l.nav.textLeft === 63,
        theme + ' M2 Agents, Projects, Settings (Tasks waits for its tab) in 28px type, 63px in (the mock)', JSON.stringify(l.nav && { items: l.nav.items, font: l.nav.font, left: l.nav.textLeft }));
      chk(l.nav && l.nav.badge === '3' && l.tabBadge === '3', theme + ' M3 the Agents bubble says what the Agents tab bubble says', JSON.stringify({ menu: l.nav && l.nav.badge, tab: l.tabBadge }));
      chk(l.nav && l.nav.x && !l.nav.back && l.nav.focusIn, theme + ' M4 an X, no back chevron on the first level, and focus inside the menu', JSON.stringify(l.nav && { x: l.nav.x, back: l.nav.back, focus: l.nav.focusIn }));

      // Settings, one level deeper.
      await page.click('[data-pnav-go="settings"]');
      await page.waitForTimeout(600);
      l = await look(page);
      chk(l.nav && JSON.stringify(l.nav.level) === '["settings"]' && JSON.stringify(l.nav.items) === JSON.stringify(l.sNav) && l.sNav.length >= 5,
        theme + ' S1 Settings lists every section the Settings page shows, in its order', JSON.stringify(l.nav && { level: l.nav.level, items: l.nav.items, sNav: l.sNav }));
      chk(l.nav && l.nav.back && l.nav.logout && !l.nav.computers, theme + ' S2 a back chevron, a Log out, and no Switch Computers on a one-computer account',
        JSON.stringify(l.nav && { back: l.nav.back, out: l.nav.logout, comps: l.nav.computers }));
      await page.click('#pnav-logout');
      await page.waitForFunction(() => document.getElementById('pnav-msg').textContent !== '', null, { timeout: 12000 }).catch(() => {});
      l = await look(page);
      chk(l.nav && l.nav.msg === 'Log out is not available on this Kosmos yet.', theme + ' S3 Log out runs the Kosmos+ log out and says what happened', JSON.stringify(l.nav && l.nav.msg));
      await page.click('#pnav-back');
      await page.waitForTimeout(600);
      l = await look(page);
      chk(l.nav && JSON.stringify(l.nav.level) === '["main"]' && !l.nav.back, theme + ' S4 back returns to the first level and the chevron goes', JSON.stringify(l.nav && { level: l.nav.level, back: l.nav.back }));
      await page.click('[data-pnav-go="settings"]');
      await page.waitForTimeout(600);
      await page.click('[data-pnav-sec="accounts"]');
      await page.waitForTimeout(400);
      l = await look(page);
      chk(l.nav && !l.nav.shown && l.tab === 'settings' && l.secOn === 'accounts' && !l.up, theme + ' S5 a section opens that Settings section and closes the menu',
        JSON.stringify({ shown: l.nav && l.nav.shown, tab: l.tab, sec: l.secOn, up: l.up }));

      // Agents from the menu, and Escape.
      await page.click('#kplus-menu');
      await page.waitForTimeout(600);
      await page.click('[data-pnav-tab="agents"]');
      await page.waitForTimeout(300);
      l = await look(page);
      chk(l.nav && !l.nav.shown && l.tab === 'agents', theme + ' T1 Agents in the menu opens the Agents tab', JSON.stringify({ shown: l.nav && l.nav.shown, tab: l.tab }));
      await page.click('#kplus-menu');
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      l = await look(page);
      chk(l.nav && !l.nav.shown && l.focus === 'kplus-menu' && l.expanded === 'false', theme + ' T2 Escape closes it and focus goes back to the two lines', JSON.stringify({ shown: l.nav && l.nav.shown, focus: l.focus, exp: l.expanded }));

      // Wider: the menu goes, and the board is today's again (the grid comes back).
      await page.click('#kplus-menu');
      await page.waitForTimeout(400);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(500);
      l = await look(page);
      chk(l.nav && !l.nav.shown && !l.menuBtn && l.logoutBtn && l.stats && l.gridBtn && l.layout === 'grid' && l.saved === 'grid',
        theme + ' W1 CONTROL: at 1280 the menu closes and today\'s header and board are back, the saved grid with them',
        JSON.stringify({ shown: l.nav && l.nav.shown, menuBtn: !!l.menuBtn, out: l.logoutBtn, stats: l.stats, grid: l.gridBtn, layout: l.layout, saved: l.saved }));
      await ctx.close();
    }
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs.slice(0, 3)));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\nrender-mobilenav-4823: ${pass} passed, ${fail.length} failed`);
  for (const f of fail) console.log('  FAIL  ' + f);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-mobilenav-4823 crashed: ' + (e && e.stack || e)); process.exit(1); });
