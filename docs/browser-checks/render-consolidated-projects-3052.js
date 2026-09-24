'use strict';
// Browser-check-surface: placeProjectsView pj-list asgrid pj-roadmap
// (#2518) the distinctive web/index.html tokens this check asserts: the function that
// relocates the projects panel's VIEW for the consolidated column, and the two class states
// (`#pj-list.asgrid` = grid, `body.pj-roadmap` = roadmap) it clears to force the list. A change
// to any of them must update this check at PR time.
/* #3052 (Josh, 6.63 testing): the CONSOLIDATED view's projects panel used to inherit whatever
 * layout the Projects TAB was last left on (grid/roadmap), because both read the one
 * `#pj-list.asgrid` / `body.pj-roadmap` state. In the narrow consolidated column a wide tab
 * layout drew where Josh "can't see anything". The fix (placeProjectsView) gives the
 * consolidated projects panel its OWN view -- the readable list -- forcing it on the way IN and
 * restoring the tab's saved layout on the way OUT (analogous to the #2842 settings and #3053
 * create-panel relocations at the same chokepoint). This drives the SHIPPED placeProjectsView +
 * layoutApply against the real class states, for both the grid and roadmap tab layouts.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-consolidated-projects-3052.js
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
  for (const theme of ['light', 'dark']) {
    // 1280px clears the 960px consolidated floor, so the consolidated layout is reachable.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    const out = await page.evaluate(() => {
      const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('s', 'Site')];
      PJ_SORT = 'az';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      const list = document.getElementById('pj-list');
      const hasGrid = () => list.classList.contains('asgrid');
      const hasRoadmap = () => document.body.classList.contains('pj-roadmap');
      const res = {};
      try {
        // Drive the REAL entry chokepoint (showTab -> placeProjectsView at the cons gate),
        // not placeProjectsView directly: a regression that UNWIRED that call -- the exact bug
        // class #3052/#2842/#3053 live at -- must red this check, so it enters/leaves the
        // consolidated view the way the app does (data-layout + showTab('projects')), like the
        // sibling render-consolidated-settings-2842.js. 1280px already clears the 960 cons floor.
        const enterCons = () => { document.documentElement.setAttribute('data-layout', 'consolidated'); PJ_CURRENT = 'k'; showTab('projects'); };
        const leaveCons = () => { document.documentElement.setAttribute('data-layout', 'tabs'); showTab('projects'); };
        const resetTab = () => { document.documentElement.setAttribute('data-layout', 'tabs'); PJ_CURRENT = 'k'; showTab('projects'); };

        // ---- GRID tab layout -> consolidated forces LIST -> leaving restores GRID ----
        resetTab();
        try { localStorage.setItem('kosmos.layout.projects', 'grid'); } catch { /* ignore */ }
        layoutApply('projects', 'grid');
        res.gridSetBefore = hasGrid() === true && hasRoadmap() === false;   // control: tab view IS grid
        enterCons();
        res.enteredCons = document.body.classList.contains('consolidated'); // the chokepoint actually fired
        res.gridForcedToList = hasGrid() === false && hasRoadmap() === false; // THE FIX, THROUGH showTab
        leaveCons();
        res.leftCons = document.body.classList.contains('consolidated') === false;
        res.gridRestored = hasGrid() === true;                              // saved grid comes back

        // ---- ROADMAP tab layout -> consolidated forces LIST -> leaving restores ROADMAP ----
        // (roadmapRestored is the discriminating restore assertion: unlike grid -- which is also
        // LAYOUTS.projects.fallback, so a broken saved-read would still land on grid -- restoring
        // roadmap REQUIRES reading saved='roadmap' and re-applying it.)
        resetTab();
        try { localStorage.setItem('kosmos.layout.projects', 'roadmap'); } catch { /* ignore */ }
        layoutApply('projects', 'roadmap');
        res.roadmapSetBefore = hasRoadmap() === true && hasGrid() === false; // control: tab view IS roadmap
        enterCons();
        res.roadmapForcedToList = hasRoadmap() === false && hasGrid() === false; // THE FIX, THROUGH showTab
        leaveCons();
        res.roadmapRestored = hasRoadmap() === true;                         // saved roadmap comes back (read path)

        // ---- The consolidated force is DISPLAY-ONLY: it must not write the saved layout ----
        resetTab();
        try { localStorage.setItem('kosmos.layout.projects', 'grid'); } catch { /* ignore */ }
        layoutApply('projects', 'grid');
        enterCons();                                                         // in consolidated (list)
        let savedWhileCons = null;
        try { savedWhileCons = localStorage.getItem('kosmos.layout.projects'); } catch { savedWhileCons = null; }
        res.savedUntouchedInCons = savedWhileCons === 'grid';                // still 'grid', not 'list'
        leaveCons();
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });

    ok(t + ' #3052 CONTROL: the tab GRID layout is set before entering consolidated', out.err === null && out.gridSetBefore === true, JSON.stringify(out));
    ok(t + ' #3052 the real showTab chokepoint enters AND leaves the consolidated view (wiring, not just the function)', out.err === null && out.enteredCons === true && out.leftCons === true, JSON.stringify(out));
    ok(t + ' #3052 THE FIX: consolidated forces the projects panel to LIST from a GRID tab layout', out.err === null && out.gridForcedToList === true, JSON.stringify(out));
    ok(t + ' #3052 leaving the consolidated view restores the saved GRID layout', out.err === null && out.gridRestored === true, JSON.stringify(out));
    ok(t + ' #3052 CONTROL: the tab ROADMAP layout is set before entering consolidated', out.err === null && out.roadmapSetBefore === true, JSON.stringify(out));
    ok(t + ' #3052 THE FIX: consolidated forces the projects panel to LIST from a ROADMAP tab layout', out.err === null && out.roadmapForcedToList === true, JSON.stringify(out));
    ok(t + ' #3052 leaving the consolidated view restores the saved ROADMAP layout', out.err === null && out.roadmapRestored === true, JSON.stringify(out));
    ok(t + ' #3052 the consolidated force is DISPLAY-ONLY (does not overwrite the saved layout)', out.err === null && out.savedUntouchedInCons === true, JSON.stringify(out));

    await page.close();
  }
  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
