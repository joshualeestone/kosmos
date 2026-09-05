'use strict';

/**
 * The board-view toggle (#2154): one press flips tabs <-> consolidated, it persists through /api/style, it lives in the header on the tabbed view and in the agents rail on the consolidated view, and it is hidden below 960px. After #2194 it sits to the right of the light/dark switcher in the header.
 *
 * 🔑 A RENDERED CHECK IS THE ONLY KIND THAT CAN SEE THIS. The toggle drives the
 * real applyLayout path over a real /api/style round-trip, and the effective
 * consolidated view (body.consolidated) is set by showTab, not by the saved
 * preference alone. The header's .headright is display:none in the consolidated
 * view, so the toggle is duplicated into the agents rail (like the theme pill
 * beside it) and the check has to prove BOTH placements are reachable in their
 * own view -- a source read cannot tell that the header copy vanishes and the
 * rail copy takes over, nor that the control is correctly absent below 960px
 * where the consolidated view is not offered at all.
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
  /* isVisible honours a display:none ANCESTOR (the header's .headright collapses
     whole in the consolidated view), where a computed display read on the element
     itself would not. */
  const visible = (sel) => pg.locator(sel).first().isVisible();
  const ariaOf = (sel) => pg.locator(sel).first().getAttribute('aria-checked').catch(() => 'missing');
  const dismissFirstRun = async () => { if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); } };
  const htmlLayout = () => pg.evaluate(() => document.documentElement.getAttribute('data-layout') || 'tabs');
  const HEAD = '.headright .laypick';
  const RAIL = '#rail-me .laypick';

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

    // --- Tabbed view: the toggle lives in the header, the rail copy is away. ---
    say(await visible(HEAD), 'tabbed view: the toggle is in the header');
    say((await pg.$$(HEAD + ' [data-layout-switch]')).length === 2, 'the header toggle has two segments (tabs, consolidated)');
    say(!(await visible(RAIL)), 'tabbed view: the rail copy is not shown');
    // #2194: the toggle sits to the RIGHT of the light/dark switcher in the
    // header (Josh moved it past the switcher). A RENDERED position read, not a
    // DOM-order read: it compares laid-out geometry, so it reds on the pre-#2194
    // page where the toggle was to the switcher's left.
    const rightOfTheme = await pg.evaluate(() => {
      const lay = document.querySelector('.headright .laypick');
      const th = document.querySelector('.headright .themepick');
      if (!lay || !th) return null;
      const l = lay.getBoundingClientRect(), t = th.getBoundingClientRect();
      return { layLeft: Math.round(l.left), thRight: Math.round(t.right) };
    });
    say(rightOfTheme && rightOfTheme.layLeft >= rightOfTheme.thRight,
      'tabbed view: the board-view toggle sits to the right of the light/dark switcher (#2194)',
      rightOfTheme ? JSON.stringify(rightOfTheme) : 'one of .laypick/.themepick missing');
    say((await ariaOf(HEAD + ' [data-layout-switch="tabs"]')) === 'true', 'tabbed view: the tabs segment is checked');
    say((await ariaOf(HEAD + ' [data-layout-switch="consolidated"]')) === 'false', 'tabbed view: the consolidated segment is not checked');

    // A press on "one screen" (from the header) flips the whole board and persists.
    await pg.click(HEAD + ' [data-layout-switch="consolidated"]');
    await settled(true);
    say((await htmlLayout()) === 'consolidated', 'press one screen: html data-layout is consolidated');
    say(await pg.evaluate(() => document.body.classList.contains('consolidated')), 'press one screen: the consolidated view is up');
    say((await savedLayoutOf()) === 'consolidated', 'press one screen: the layout is saved on the server (not a second store)');

    // --- Consolidated view: the header copy is gone, the rail copy takes over. ---
    say(!(await visible(HEAD)), 'consolidated view: the header toggle is gone (headright collapses)');
    say(await visible(RAIL), 'consolidated view: the toggle is in the agents rail');
    say((await ariaOf(RAIL + ' [data-layout-switch="consolidated"]')) === 'true', 'consolidated view: the rail one-screen segment is checked');
    say((await ariaOf(RAIL + ' [data-layout-switch="tabs"]')) === 'false', 'consolidated view: the rail tabs segment is not checked');

    // It survives a reload, because it was saved and the boot paint reads it.
    await pg.reload({ waitUntil: 'networkidle' });
    await dismissFirstRun();
    await settled(true);
    say(await visible(RAIL), 'after a reload: the rail toggle is still shown (the saved one-screen choice)');
    say((await ariaOf(RAIL + ' [data-layout-switch="consolidated"]')) === 'true', 'after a reload: the rail toggle still shows one screen');

    // A press on "separate tabs" from the RAIL flips it back -- the only route
    // back, since the header copy is hidden in this view.
    await pg.click(RAIL + ' [data-layout-switch="tabs"]');
    await settled(false);
    say((await htmlLayout()) === 'tabs', 'press separate tabs (rail): html data-layout is tabs');
    say(!(await pg.evaluate(() => document.body.classList.contains('consolidated'))), 'press separate tabs (rail): the consolidated view is down');
    say(await visible(HEAD), 'press separate tabs (rail): the header toggle is back');
    say((await ariaOf(HEAD + ' [data-layout-switch="tabs"]')) === 'true', 'press separate tabs (rail): the header tabs segment is checked again');
    say((await savedLayoutOf()) === 'tabs', 'press separate tabs (rail): the tabbed layout is saved on the server');

    // The narrow-window gate: below 960px the consolidated view is not offered,
    // so the toggle must not be a dead control. Positive control: at 1400px it is
    // shown (asserted above), so this absence is a real gate, not a lost element.
    await pg.setViewportSize({ width: 800, height: 950 });
    await pg.waitForTimeout(200);
    say(!(await visible(HEAD)), 'on a narrow (800px) window: the view toggle is hidden');
    await pg.setViewportSize({ width: 1400, height: 950 });
    await pg.waitForTimeout(200);
    say(await visible(HEAD), 'back to a wide window: the view toggle is shown again (control)');
  } finally {
    try { await putLayout(savedLayout); } catch { /* the server may be gone */ }
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
