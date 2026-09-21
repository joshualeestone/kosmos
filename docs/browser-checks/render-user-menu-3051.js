'use strict';
// Browser-check-surface: userpop-btn userpop-menu userpop-settings userpop-plus userpop-plus-member userpop-go-you userpop-go-models userpop-go-usage BUTTONLESS
// (#2518) the distinctive web/index.html tokens this check asserts: the user menu button + its
// dropdown, the four settings deep-links inside it (Your Profile / AI Models / Token Usage /
// View All Settings, the last keeping the #userpop-settings id), the Kosmos+ promo + dormant
// member line, and the BUTTONLESS array that keeps showTab('settings') working with no Settings
// tab. A change to any of them must update this check at PR time.
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

    // ── #3360: opening the menu reveals the reworked structure -- a Kosmos+ promo at the
    //    top (the member line dormant/hidden until a signal exists), the four settings
    //    deep-links (Your Profile / AI Models / Token Usage / View All Settings), the two
    //    toggle rows (Appearance + the renamed "View"), and the agent-status line. ──
    await page.click('#userpop-btn');
    await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
    await page.waitForTimeout(120);
    const open = await page.evaluate(() => {
      const shown = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const viewLbl = document.querySelector('#userpop-menu .userpop-row-view .userpop-lbl');
      return {
        expanded: document.getElementById('userpop-btn').getAttribute('aria-expanded'),
        plusPromo: shown('#userpop-menu #userpop-plus'),
        // The member line is DORMANT (plusMember() stub returns false), so it must be hidden
        // and the promo must show. This is the honest logged-out default, not a dead control.
        memberHidden: document.getElementById('userpop-plus-member').hidden === true,
        goYou: shown('#userpop-menu #userpop-go-you'),
        goModels: shown('#userpop-menu #userpop-go-models'),
        goUsage: shown('#userpop-menu #userpop-go-usage'),
        settings: shown('#userpop-menu #userpop-settings'),
        theme: shown('#userpop-menu .themepick'),
        view: shown('#userpop-menu .laypick'),
        // The row is renamed "View" (was "Board view"). Assert the label text carries it.
        viewRenamed: !!viewLbl && /View/.test(viewLbl.textContent) && !/Board view/.test(viewLbl.textContent),
        // Every menu item and toggle row carries a leading icon (Josh: "an icon for each one").
        icons: document.querySelectorAll('#userpop-menu .userpop-ico').length,
        // Deliberately an EXISTENCE check, not shown(), and do not "upgrade" it: over file://
        // there is no /api/status, so tick() never paints #checked, it has zero size, and a
        // shown() arm would fail the hermetic run. Presence in the menu is what this asserts.
        status: !!document.querySelector('#userpop-menu #checked'),
      };
    });
    ok(t + ' opening the menu sets aria-expanded=true', open.expanded === 'true', JSON.stringify(open));
    ok(t + ' the menu shows the Log in to Kosmos+ promo', open.plusPromo === true, JSON.stringify(open));
    ok(t + ' the dormant Kosmos+ member line is hidden (no membership signal yet)', open.memberHidden === true, JSON.stringify(open));
    ok(t + ' the menu holds Your Profile', open.goYou === true, JSON.stringify(open));
    ok(t + ' the menu holds AI Models', open.goModels === true, JSON.stringify(open));
    ok(t + ' the menu holds Token Usage', open.goUsage === true, JSON.stringify(open));
    ok(t + ' the menu holds View All Settings (#userpop-settings)', open.settings === true, JSON.stringify(open));
    ok(t + ' the menu holds the light/dark control', open.theme === true, JSON.stringify(open));
    ok(t + ' the menu holds the view toggle', open.view === true, JSON.stringify(open));
    ok(t + ' the view toggle row is renamed "View" (not "Board view")', open.viewRenamed === true, JSON.stringify(open));
    ok(t + ' every menu line carries a leading icon (>= 6)', open.icons >= 6, JSON.stringify(open.icons));
    ok(t + ' the menu holds the agent-status line (#checked)', open.status === true, JSON.stringify(open));

    // The structure block left the menu OPEN. Close it so each re-open below toggles a CLOSED
    // menu open (clicking #userpop-btn on an open menu would close it and the wait would hang).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('userpop-menu').hidden === true, null, { timeout: 5000 });

    // ── #3360: each settings deep-link opens #panel-settings ON its section (aria-current on
    //    the matching #s-nav pill) AND closes the menu. Tab-view path (default layout). ──
    const deepLinks = [
      ['#userpop-go-you', 'you', 'Your Profile'],
      ['#userpop-go-models', 'accounts', 'AI Models'],
      ['#userpop-go-usage', 'usage', 'Token Usage'],
    ];
    for (const [sel, sec, label] of deepLinks) {
      await page.click('#userpop-btn');
      await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
      await page.click(sel);
      await page.waitForTimeout(120);
      const r = await page.evaluate((section) => ({
        settingsShown: document.getElementById('panel-settings').hidden === false,
        menuClosed: document.getElementById('userpop-menu').hidden === true,
        onSection: (() => { const b = document.querySelector('#s-nav button[data-go="' + section + '"]'); return !!b && b.getAttribute('aria-current') === 'true'; })(),
      }), sec);
      ok(t + ' ' + label + ' opens Settings on its section', r.settingsShown === true && r.onSection === true, JSON.stringify(r));
      ok(t + ' ' + label + ' closes the menu', r.menuClosed === true, JSON.stringify(r));
    }

    // ── View All Settings (#userpop-settings) opens #panel-settings with NO section forced and
    //    no tab lit (BUTTONLESS keeps it working with the Settings tab gone), and closes the
    //    menu. This is the old #userpop-settings behaviour, id preserved. ──
    await page.click('#userpop-btn');
    await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
    await page.click('#userpop-settings');
    await page.waitForTimeout(150);
    const afterSettings = await page.evaluate(() => ({
      settingsShown: document.getElementById('panel-settings').hidden === false,
      menuClosed: document.getElementById('userpop-menu').hidden === true,
      noTabLit: !document.querySelector('#tabs .tab.on'),
    }));
    ok(t + ' View All Settings opens #panel-settings', afterSettings.settingsShown === true, JSON.stringify(afterSettings));
    ok(t + ' View All Settings closes the menu', afterSettings.menuClosed === true, JSON.stringify(afterSettings));
    ok(t + ' no tab is lit on the settings screen (BUTTONLESS)', afterSettings.noTabLit === true, JSON.stringify(afterSettings));

    // ── #3360: picking an Appearance option now CLOSES the menu (Josh: every item takes its
    //    action and closes, the appearance toggle included -- it used to stay open). ──
    await page.click('#userpop-btn');
    await page.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
    await page.click('#userpop-menu .themepick [data-theme-set="dark"]');
    await page.waitForTimeout(120);
    const afterTheme = await page.evaluate(() => ({
      menuClosed: document.getElementById('userpop-menu').hidden === true,
      themeApplied: document.documentElement.getAttribute('data-theme') === 'dark',
    }));
    ok(t + ' picking Appearance closes the menu', afterTheme.menuClosed === true, JSON.stringify(afterTheme));
    ok(t + ' picking Appearance still applies the theme', afterTheme.themeApplied === true, JSON.stringify(afterTheme));

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
  console.log('render-user-menu-3051: ' + pass + ' passed (the upper-right user menu: 2-tab nav, avatar+name button, the #3360 reworked dropdown -- Kosmos+ promo with a dormant member line, the four settings deep-links each landing on their section and closing the menu, the renamed "View" toggle, icons on every line, Appearance now closes the menu, Escape + outside-click close). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-user-menu-3051: ' + (e && e.message ? e.message.split('\n')[0] : e)); process.exit(1); });
