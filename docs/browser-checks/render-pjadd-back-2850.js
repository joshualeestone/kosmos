'use strict';
// Browser-check-surface: pj-add-back pj-add-view openAddProject
// (#2850 item 1) the distinctive web/index.html tokens this check asserts: the add-project
// back control, the view it lives in, and the function that opens the form. A change to any
// of them must update this check at PR time.
/* #2850 item 1 (Josh, 0.6.57 consolidated review): adding a project FROM the consolidated
 * view, the "back / All projects" control is redundant -- you are already right here. It is
 * hidden there with visibility:hidden, which keeps the button's box (its height plus the
 * .back margin-bottom) so New project keeps its exact position and the form does not move
 * up. In the TAB view the back button stays visible: it is the only route back to the list,
 * so the rule is scoped to body.consolidated only. This drives the SHIPPED openAddProject +
 * the consolidated CSS against the real page in both layouts.
 *
 * visibility:hidden is theme-invariant, so one viewport pass at 1280px (clearing the 960px
 * consolidated floor) is the whole surface; a second theme would assert nothing new.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pjadd-back-2850.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  // 1280px clears the 960px consolidated floor, so layoutConsolidated() is true.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const x = m.text();
    if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
    problems.push('console: ' + x);
  });
  await page.goto(PAGE);

  const out = await page.evaluate(() => {
    const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
    PROJECTS = [mk('k', 'Kosmos'), mk('s', 'Site')];
    PJ_SORT = 'az';
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    const res = {};
    const back = document.getElementById('pj-add-back');
    const addView = document.getElementById('pj-add-view');
    const vis = () => getComputedStyle(back).visibility;
    const rect = (el) => { const b = el.getBoundingClientRect(); return { h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom) }; };

    // --- TAB view (not consolidated): back stays visible ---
    // data-layout=tabs -> layoutConsolidated() is false, so showTab leaves
    // body.consolidated off; this activates the projects panel so #pj-add-view
    // is actually laid out (a hidden panel measures 0 whatever its visibility).
    document.documentElement.setAttribute('data-layout', 'tabs');
    PJ_CURRENT = 'k';
    showTab('projects');
    openAddProject();
    res.tabAddViewHidden = addView.hidden;
    res.tabVisibility = vis();
    res.tabBackHeight = rect(back).h;

    // --- CONSOLIDATED view: back hidden, but its space is reserved ---
    document.documentElement.setAttribute('data-layout', 'consolidated');
    PJ_CURRENT = 'k';
    showTab('projects');                     // sets body.consolidated at >= 960px
    openAddProject();                        // shows #pj-add-view inside the display column
    res.bodyConsolidated = document.body.classList.contains('consolidated');
    res.consAddViewHidden = addView.hidden;
    res.consVisibility = vis();
    const rb = rect(back);
    res.consBackHeight = rb.h;                // box still occupies space (display:none would be 0)
    res.consBackBottom = rb.bottom;
    const h2 = addView.querySelector('h2');
    res.h2Top = h2 ? rect(h2).top : null;     // New project heading sits below the reserved box
    res.backInline = back.style.visibility;   // must be CSS-driven, no inline override
    return res;
  });

  ok('tab view: #pj-add-view is shown', out.tabAddViewHidden === false, 'hidden=' + out.tabAddViewHidden);
  ok('tab view: back button visible', out.tabVisibility === 'visible', 'got ' + out.tabVisibility);
  ok('tab view: back button has height', out.tabBackHeight > 0, 'h=' + out.tabBackHeight);
  ok('consolidated: body.consolidated is set at 1280px', out.bodyConsolidated === true, 'got ' + out.bodyConsolidated);
  ok('consolidated: #pj-add-view is shown', out.consAddViewHidden === false, 'hidden=' + out.consAddViewHidden);
  ok('consolidated: back button hidden', out.consVisibility === 'hidden', 'got ' + out.consVisibility);
  ok('consolidated: back box still reserves space (New project does not move up)', out.consBackHeight > 0, 'h=' + out.consBackHeight);
  ok('consolidated: New project heading sits below the reserved back box', out.h2Top !== null && out.consBackBottom !== null && out.h2Top >= out.consBackBottom, 'h2Top=' + out.h2Top + ' backBottom=' + out.consBackBottom);
  ok('the hide is CSS-driven, not an inline style', !out.backInline, 'inline=' + out.backInline);

  await browser.close();
  if (problems.length) {
    console.error('render-pjadd-back-2850: ' + problems.length + ' problem(s) (' + pass + ' ok)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-pjadd-back-2850: the "back / All projects" control on the New project form is hidden in the consolidated view (visibility:hidden, its box still reserving space so New project does not move up) and stays visible in the tab view; the hide is CSS-driven, not an inline style.');
})().catch((err) => {
  console.error('FAIL  render-pjadd-back-2850: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
