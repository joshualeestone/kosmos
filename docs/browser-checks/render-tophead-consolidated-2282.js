'use strict';

/**
 * kosmos#2282 (Josh 0.6.36 ask; Mona's mock chaoskosmos-site design/top-header.html):
 * ONE full-width header across the top on EVERY view. The fix is the consolidated
 * view: it used to hide the whole top header and drift the appearance + view-toggle
 * controls into the #rail-me side rail. Now the top header stays as a real bar (K mark
 * + Kosmos switcher on the left, appearance + view-toggle on the right), the center
 * tabs stay hidden (consolidated is one screen), and the rail no longer carries its
 * own copies of the controls.
 *
 * ⚠️ WHY A BROWSER. This is a pure-CSS layout change keyed on
 * `html[data-layout="consolidated"] body.consolidated`. A source grep cannot tell
 * whether the header actually RENDERS (computed display) in that state, nor that the
 * rail copies actually STOP rendering. This drives the real page and reads computed
 * style in both the tab (control) and consolidated states.
 *
 * HERMETIC: loads web/index.html over file://, boots no server. Reds on origin/main,
 * where the consolidated view hides `.headright` (display:none) and shows the rail's
 * `.railme-theme`/`.railme-lay`.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-tophead-consolidated-2282.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-tophead-consolidated-2282: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-tophead-consolidated-2282: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  // >=960px so the consolidated view + its view-toggle floor are in play.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    const disp = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : '__absent__'; };
    // Baseline (tab view, the default): the header and its controls show.
    const tab = {
      headright: disp('.apphead header .headright'),
      themepick: disp('.apphead header .headright .themepick'),
      tabs: disp('.apphead header .tabs'),
    };
    // Enter the consolidated state the CSS keys on (data-layout + body.consolidated),
    // the same two hooks applyLayout/showTab set for the real view.
    document.documentElement.setAttribute('data-layout', 'consolidated');
    document.body.classList.add('consolidated');
    const consolidated = {
      // THE FIX: the top header + its right cluster stay visible in consolidated.
      headright: disp('.apphead header .headright'),
      headerThemepick: disp('.apphead header .headright .themepick'),
      headerLaypick: disp('.apphead header .headright .laypick'),
      kmark: disp('.apphead header .klink'),
      worldsw_present: !!document.querySelector('.apphead header .worldsw'),
      // Center tabs stay hidden (one screen).
      tabs: disp('.apphead header .tabs'),
      // The rail no longer carries its own copies.
      railTheme: disp('.railme-theme'),
      railLay: disp('.railme-lay'),
      // The rail keeps the per-view person -> Settings affordance.
      railGo: disp('#rail-me .railme-go'),
    };
    return { tab, consolidated };
  });

  await browser.close();

  const problems = [];
  const c = r.consolidated;
  // Control: the tab view must show the header (so a green is not "header always hidden").
  if (r.tab.headright === 'none' || r.tab.headright === '__absent__') problems.push('CONTROL failed: the header .headright is not shown in the tab view (' + r.tab.headright + ')');
  if (r.tab.tabs === 'none' || r.tab.tabs === '__absent__') problems.push('CONTROL failed: the center .tabs are not shown in the tab view (' + r.tab.tabs + ')');
  // The fix, consolidated view:
  if (c.headright === 'none' || c.headright === '__absent__') problems.push('the top header .headright is HIDDEN in the consolidated view (#2282: it must stay across the top) -- got ' + c.headright);
  if (c.headerThemepick === 'none' || c.headerThemepick === '__absent__') problems.push('the appearance control is not in the top header in consolidated view -- got ' + c.headerThemepick);
  if (c.headerLaypick === 'none' || c.headerLaypick === '__absent__') problems.push('the view-toggle is not in the top header in consolidated view -- got ' + c.headerLaypick);
  if (c.kmark === 'none' || c.kmark === '__absent__') problems.push('the K mark is not in the top header in consolidated view -- got ' + c.kmark);
  if (!c.worldsw_present) problems.push('the Kosmos switcher is absent from the top header in consolidated view');
  if (c.tabs !== 'none') problems.push('the center .tabs should be hidden in the consolidated view (one screen), got ' + c.tabs);
  if (c.railTheme !== 'none') problems.push('the side rail still shows its own appearance control (.railme-theme) in consolidated -- it should move to the top header, got ' + c.railTheme);
  if (c.railLay !== 'none') problems.push('the side rail still shows its own view-toggle (.railme-lay) in consolidated -- it should move to the top header, got ' + c.railLay);
  if (c.railGo === 'none' || c.railGo === '__absent__') problems.push('the rail lost its per-view person -> Settings affordance (.railme-go), which should stay -- got ' + c.railGo);

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-tophead-consolidated-2282: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-tophead-consolidated-2282: OK (one top header across every view; consolidated controls folded up from the rail)');
  process.exit(0);
})();
