'use strict';
// Browser-check-surface: userpop-btn userpop-menu userpop-settings BUTTONLESS
// (#2518) the distinctive web/index.html tokens this check asserts: the user menu button + its
// dropdown + the Settings link inside it, and the BUTTONLESS array that keeps showTab('settings')
// working with no Settings tab. A change to any of them must update this check at PR time.
/*
 * kosmos#3051 (Josh, 0.6.63 review, for 6.65): the upper-right nav is a user AVATAR + NAME that
 * opens a dropdown. The Settings LINK lives in the dropdown (Settings is GONE from the top nav,
 * which is now just Agents + Projects), together with the light/dark control, the board-view
 * toggle, and the agent-status line. Removing the Settings tab is safe because 'settings' is in
 * the BUTTONLESS array, so showTab('settings') still shows #panel-settings with no tab lit.
 *
 * WHY A BROWSER. The dropdown is a real popover (aria-expanded, hidden menu, click-away/Escape
 * close) driven by wireUserpop, and the Settings link routes through the real showTab. A source
 * grep cannot tell whether the menu opens, whether the four items render in it, or whether the
 * Settings link actually reaches #panel-settings once the tab button is gone.
 *
 * HERMETIC: loads web/index.html over file://, boots no server. The name comes from /api/you at
 * runtime (unreachable over file://), so the button reads its "You" default here -- this check
 * asserts the STRUCTURE and the INTERACTION, not the fetched name.
 *
 * Reds on origin/main, where there is a third Settings tab, no #userpop, and the light/dark +
 * view controls sit bare on the header row.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-user-menu-3051.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-user-menu-3051: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(nodePath.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-user-menu-3051: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  for (const theme of ['light', 'dark']) {
    // >=960px so the board-view toggle (its .laypick 960px floor) is offered in the menu.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    const t = '[' + theme + ']';
    page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
    await page.goto(PAGE);
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    // ── The top nav is Agents + Projects only; Settings is gone from it. ──
    const nav = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#tabs .tab')].map((b) => b.dataset.tab);
      return { tabs, hasSettingsTab: !!document.querySelector('#tabs .tab[data-tab="settings"]') };
    });
    ok(t + ' the top nav is exactly Agents + Projects', nav.tabs.length === 2 && nav.tabs.join(',') === 'agents,projects', JSON.stringify(nav.tabs));
    ok(t + ' the Settings tab is gone from the top nav', nav.hasSettingsTab === false);

    // ── The user menu button shows an avatar slot + a name, closed by default. ──
    const btn = await page.evaluate(() => {
      const b = document.getElementById('userpop-btn');
      const face = document.getElementById('userpop-face');
      const name = document.getElementById('userpop-name');
      const menu = document.getElementById('userpop-menu');
      if (!b || !face || !name || !menu) return { missing: true };
      const r = b.getBoundingClientRect();
      return {
        missing: false,
        shown: r.width > 0 && r.height > 0,
        hasFace: !!face,
        name: (name.textContent || '').trim(),
        expanded: b.getAttribute('aria-expanded'),
        controls: b.getAttribute('aria-controls'),
        menuHidden: menu.hidden === true,
      };
    });
    ok(t + ' the user menu button renders (avatar + name)', btn.missing === false && btn.shown === true && btn.hasFace === true, JSON.stringify(btn));
    ok(t + ' the name has a value (the "You" default over file://)', !!btn.name, JSON.stringify(btn.name));
    ok(t + ' the menu is closed by default (aria-expanded=false, hidden)', btn.expanded === 'false' && btn.menuHidden === true, JSON.stringify(btn));

    // ── Opening the menu reveals the four items. ──
    await page.click('#userpop-btn');
    await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
    await page.waitForTimeout(120);
    const open = await page.evaluate(() => {
      const shown = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        expanded: document.getElementById('userpop-btn').getAttribute('aria-expanded'),
        settings: shown('#userpop-menu #userpop-settings'),
        theme: shown('#userpop-menu .themepick'),
        view: shown('#userpop-menu .laypick'),
        status: !!document.querySelector('#userpop-menu #checked'),
      };
    });
    ok(t + ' opening the menu sets aria-expanded=true', open.expanded === 'true', JSON.stringify(open));
    ok(t + ' the menu holds the Settings link', open.settings === true, JSON.stringify(open));
    ok(t + ' the menu holds the light/dark control', open.theme === true, JSON.stringify(open));
    ok(t + ' the menu holds the board-view toggle', open.view === true, JSON.stringify(open));
    ok(t + ' the menu holds the agent-status line (#checked)', open.status === true, JSON.stringify(open));

    // ── The Settings link routes to #panel-settings (BUTTONLESS keeps it working with no
    //    tab) and closes the menu. ──
    await page.click('#userpop-settings');
    await page.waitForTimeout(150);
    const afterSettings = await page.evaluate(() => ({
      settingsShown: document.getElementById('panel-settings').hidden === false,
      menuClosed: document.getElementById('userpop-menu').hidden === true,
      noTabLit: !document.querySelector('#tabs .tab.on'),
    }));
    ok(t + ' the Settings link opens #panel-settings', afterSettings.settingsShown === true, JSON.stringify(afterSettings));
    ok(t + ' the Settings link closes the menu', afterSettings.menuClosed === true, JSON.stringify(afterSettings));
    ok(t + ' no tab is lit on the settings screen (BUTTONLESS)', afterSettings.noTabLit === true, JSON.stringify(afterSettings));

    // ── Escape closes the open menu. ──
    await page.click('#userpop-btn');
    await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    ok(t + ' Escape closes the menu', await page.evaluate(() => document.getElementById('userpop-menu').hidden === true));

    // ── An outside click closes the open menu. ──
    await page.click('#userpop-btn');
    await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
    await page.mouse.click(20, 400);   // well away from #userpop
    await page.waitForTimeout(120);
    ok(t + ' an outside click closes the menu', await page.evaluate(() => document.getElementById('userpop-menu').hidden === true));

    await page.screenshot({ path: nodePath.join(process.argv[2] || '/tmp', 'user-menu-' + theme + '.png') }).catch(() => {});
    await page.close();
  }

  await browser.close();
  if (problems.length) {
    console.error('render-user-menu-3051: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-user-menu-3051: ' + pass + ' passed (the upper-right user menu: 2-tab nav, avatar+name button, the four dropdown items, the Settings link reaches #panel-settings, Escape + outside-click close). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-user-menu-3051: ' + (e && e.message ? e.message.split('\n')[0] : e)); process.exit(1); });
