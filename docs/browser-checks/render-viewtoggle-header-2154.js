'use strict';

/**
 * The board-view toggle (#2154): one press flips tabs <-> consolidated, it persists through /api/style, and it is hidden below 960px. After #2194 it sits to the right of the light/dark switcher in the header. After #2282 (the persistent full-width header) it lives in the header in EVERY view, including consolidated; the #rail-me copy is hidden there.
 *
 * 🔑 A RENDERED CHECK IS THE ONLY KIND THAT CAN SEE THIS. The toggle drives the
 * real applyLayout path over a real /api/style round-trip, and the effective
 * consolidated view (body.consolidated) is set by showTab, not by the saved
 * preference alone. Since #2282 the header's .headright stays visible in the
 * consolidated view (the header is full-width across every view), so the toggle
 * lives in the header in BOTH views and the #rail-me copy is display:none in
 * consolidated -- the check proves the header toggle is reachable and functional
 * in each view, and that the control is correctly absent below 960px where the
 * consolidated view is not offered at all. (Before #2282 .headright collapsed in
 * consolidated and the toggle was duplicated into the agents rail; this check
 * proved that reversed placement, which is why the whole consolidated block
 * changed when the persistent header landed.)
 *
 *   node docs/browser-checks/render-viewtoggle-header-2154.js <url> <sandbox-root>
 *
 * Writes the board's saved layout (the same field the Settings tiles write) and
 * puts it back to what it was on exit. Refuses a board that is not a fixture.
 */
const { chromium } = require('playwright');
(async () => {
  /* #1156: this check PUTs to /api/style, so it declines rather than mutating a
     board that is not a fixture. */
  require('./lib-sandbox-guard.js').requireSandbox('render-viewtoggle-header-2154.js');
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const SANDBOX = process.argv[3] || '';
  if (!SANDBOX) throw new Error('pass the server\'s sandbox root as the 2nd argument; this check rewrites the saved layout on the server it is pointed at');
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  const putLayout = (l) => pg.evaluate((v) => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: v }) }).then((r) => r.text()), l);
  const savedLayoutOf = () => pg.evaluate(() => fetch('/api/style').then((r) => r.json()).then((j) => (j && j.layout) || 'tabs').catch(() => 'tabs'));
  /* The state, not a timer: the body class arrives by paintStyles -> applyLayout
     -> showTab after load, and by the click handler after a press. */
  const settled = async (cons) => { await pg.waitForFunction((c) => document.body.classList.contains('consolidated') === c, cons, { timeout: 15000 }); await pg.waitForTimeout(200); };
  /* isVisible reflects the EFFECTIVE rendered visibility: it honours display:none
     whether on the element itself (since #2282 the rail's own copy .railme-lay is
     display:none in the consolidated view, where the header copy takes over) or on
     an ancestor, which a computed display read on the element alone would miss. */
  const visible = (sel) => pg.locator(sel).first().isVisible();
  const ariaOf = (sel) => pg.locator(sel).first().getAttribute('aria-checked').catch(() => 'missing');
  const dismissFirstRun = async () => { if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); } };
  const htmlLayout = () => pg.evaluate(() => document.documentElement.getAttribute('data-layout') || 'tabs');
  const LAY = '#userpop-menu .laypick';
  const RAIL = '#rail-me .laypick';
  // #3051: the board-view toggle moved OFF the always-visible header row INTO the
  // upper-right user menu (#userpop), so every interaction opens the menu first. The
  // menu stays open across a layout flip (only the Settings link, an outside click, or
  // Escape close it), but a reload closes it, so re-open after each reload.
  const openPop = async () => {
    if (!(await pg.locator('#userpop-menu').isVisible())) {
      await pg.click('#userpop-btn');
      await pg.waitForFunction(() => { const m = document.getElementById('userpop-menu'); return m && !m.hidden; }, null, { timeout: 5000 });
      await pg.waitForTimeout(120);
    }
  };

  let savedLayout = 'tabs';
  try {
    await pg.goto(URL + '/?tab=agents', { waitUntil: 'networkidle' });
    await dismissFirstRun();
    savedLayout = await savedLayoutOf();

    // A known starting point: the tabbed view. Reload so the boot paint sets the
    // toggle from the saved layout, the way a person's first sight of it is set.
    await putLayout('tabs');
    await pg.reload({ waitUntil: 'networkidle' });
    await dismissFirstRun();
    await settled(false);

    // --- Tabbed view: the toggle lives in the user menu; the rail copy is away. ---
    await openPop();
    say(await visible(LAY), 'tabbed view: the board-view toggle is in the user menu');
    say((await pg.$$(LAY + ' [data-layout-switch]')).length === 2, 'the menu toggle has two segments (tabs, consolidated)');
    say(!(await visible(RAIL)), 'tabbed view: the rail copy is not shown');
    // #3051/#3360: in the menu the view row sits BELOW the appearance (light/dark)
    // row (menu order after #3360: Kosmos+, the settings deep-links, Appearance, View
    // [renamed from "Board view"], Agent status). A RENDERED position read, replacing the
    // old #2194 header "toggle to the right of the switcher" now that both controls stack
    // in the dropdown.
    const belowTheme = await pg.evaluate(() => {
      const lay = document.querySelector('#userpop-menu .laypick');
      const th = document.querySelector('#userpop-menu .themepick');
      if (!lay || !th) return null;
      const l = lay.getBoundingClientRect(), t = th.getBoundingClientRect();
      return { layTop: Math.round(l.top), thBottom: Math.round(t.bottom) };
    });
    say(belowTheme && belowTheme.layTop >= belowTheme.thBottom,
      'tabbed view: in the menu the board-view toggle sits below the light/dark switcher (#3051)',
      belowTheme ? JSON.stringify(belowTheme) : 'one of .laypick/.themepick missing');
    say((await ariaOf(LAY + ' [data-layout-switch="tabs"]')) === 'true', 'tabbed view: the tabs segment is checked');
    say((await ariaOf(LAY + ' [data-layout-switch="consolidated"]')) === 'false', 'tabbed view: the consolidated segment is not checked');

    // A press on "one screen" (from the menu) flips the whole board and persists.
    await pg.click(LAY + ' [data-layout-switch="consolidated"]');
    await settled(true);
    say((await htmlLayout()) === 'consolidated', 'press one screen: html data-layout is consolidated');
    say(await pg.evaluate(() => document.body.classList.contains('consolidated')), 'press one screen: the consolidated view is up');
    say((await savedLayoutOf()) === 'consolidated', 'press one screen: the layout is saved on the server (not a second store)');

    // --- Consolidated view (#2282 keeps the header full-width; #3051 puts the
    // toggle in the user menu, carried in BOTH views). The menu toggle is still
    // reachable and the rail copy (with the whole rail person slot) is hidden. ---
    await openPop();
    say(await visible(LAY), 'consolidated view: the menu toggle is still reachable (#2282 persistent header)');
    say(!(await visible(RAIL)), 'consolidated view: the rail copy is hidden (#3051 retires the rail person slot)');
    say((await ariaOf(LAY + ' [data-layout-switch="consolidated"]')) === 'true', 'consolidated view: the one-screen segment is checked');
    say((await ariaOf(LAY + ' [data-layout-switch="tabs"]')) === 'false', 'consolidated view: the tabs segment is not checked');

    // It survives a reload, because it was saved and the boot paint reads it.
    await pg.reload({ waitUntil: 'networkidle' });
    await dismissFirstRun();
    await settled(true);
    await openPop();
    say(await visible(LAY), 'after a reload: the menu toggle is still reachable (the saved one-screen choice)');
    say((await ariaOf(LAY + ' [data-layout-switch="consolidated"]')) === 'true', 'after a reload: the toggle still shows one screen');

    // A press on "separate tabs" from the MENU flips it back -- the user menu is the
    // route back in the consolidated view.
    await pg.click(LAY + ' [data-layout-switch="tabs"]');
    await settled(false);
    say((await htmlLayout()) === 'tabs', 'press separate tabs: html data-layout is tabs');
    say(!(await pg.evaluate(() => document.body.classList.contains('consolidated'))), 'press separate tabs: the consolidated view is down');
    await openPop();
    say(await visible(LAY), 'press separate tabs: the menu toggle is shown');
    say((await ariaOf(LAY + ' [data-layout-switch="tabs"]')) === 'true', 'press separate tabs: the tabs segment is checked again');
    say((await savedLayoutOf()) === 'tabs', 'press separate tabs: the tabbed layout is saved on the server');

    // The narrow-window gate: below 960px the consolidated view is not offered, so
    // the board-view toggle must not be a dead control even inside the menu. Open the
    // menu at 800px and the toggle is gone (its .laypick media gate still applies in
    // the dropdown); at 1400px (positive control) it is present.
    await pg.setViewportSize({ width: 800, height: 950 });
    await pg.waitForTimeout(200);
    await openPop();
    say(!(await visible(LAY)), 'on a narrow (800px) window: the view toggle is hidden in the menu');
    await pg.setViewportSize({ width: 1400, height: 950 });
    await pg.waitForTimeout(200);
    await openPop();
    say(await visible(LAY), 'back to a wide window: the view toggle is shown again (control)');
  } finally {
    try { await putLayout(savedLayout); } catch { /* the server may be gone */ }
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
