'use strict';
// Browser-check-surface: rail-me-go openConsolidatedSettings placeAppSettings
// (#2518) the distinctive web/index.html tokens this check asserts: the settings button in
// the consolidated rail and the two functions that open/relocate the settings panel into the
// display column. A change to any of them must update this check at PR time.
/* #2842 (Josh, 0.6.57 review): opening user settings from the CONSOLIDATED view used to
 * kick the whole layout back to the tab view, because #rail-me-go clicked the Settings tab
 * and showTab drops body.consolidated for any tab that is not agents/projects. The fix opens
 * settings IN the display column (like View-All for tasks/files): #panel-settings is
 * relocated into #panel-projects, the agents column and projects list stay, and settings take
 * over the display area. This drives the SHIPPED showTab + #rail-me-go handler +
 * openConsolidatedSettings + pjView against a real fixture in the real page.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-consolidated-settings-2842.js
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
    // 1280px clears the 960px consolidated floor, so layoutConsolidated() is true.
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
      const res = {};
      const panelSettings = document.getElementById('panel-settings');
      const panelProjects = document.getElementById('panel-projects');
      const listView = document.getElementById('pj-list-view');
      const railGo = document.getElementById('rail-me-go');
      const rect = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) }; };
      try {
        // Enter the consolidated view through the real path; showTab relocates settings.
        document.documentElement.setAttribute('data-layout', 'consolidated');
        PJ_CURRENT = 'k';
        showTab('projects');
        res.relocatedByShowTab = panelSettings.parentElement === panelProjects;
        res.hiddenBeforeOpen = panelSettings.hidden === true;
        // Open settings via the real #rail-me-go click handler.
        railGo.click();
        res.stillConsolidated = document.body.classList.contains('consolidated');   // THE FIX: no kick-out
        res.settingsVisible = panelSettings.hidden === false;
        res.settingsInDisplay = panelSettings.parentElement === panelProjects;
        res.listStillVisible = listView.hidden === false;                            // projects column kept
        res.projectViewHidden = document.getElementById('pj-one-view').hidden === true;
        // Fills the display column (guards the margin:0 fix): its left sits just past the
        // list's right edge, and it is wide, not a centered content-width island.
        const ps = rect(panelSettings); const lv = rect(listView); const pp = rect(panelProjects);
        res.leftGapPastList = ps.left - lv.right;              // small (~gap), not ~180 (centered)
        res.settingsWidth = ps.w;                              // ~878 filled, not ~554 shrunk
        res.col2Width = pp.w - lv.w;                           // approx column-2 width
        // Navigate to a project -> settings hides, project shows.
        pjView('one');
        res.settingsHiddenAfterNav = panelSettings.hidden === true;
        res.projectShownAfterNav = document.getElementById('pj-one-view').hidden === false;
        // Leave the consolidated view -> settings restored to the top level (tab-view home).
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects');
        res.restoredToTopLevel = panelSettings.parentElement !== panelProjects;
        // CONTROL: in the tab view #rail-me-go routes to the Settings tab and does NOT enter
        // the consolidated view (layoutConsolidated() is false, so openConsolidatedSettings is
        // never called). body.consolidated must be false after the tab-view open.
        railGo.click();
        res.tabViewNotConsolidated = document.body.classList.contains('consolidated') === false;
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });

    ok(t + ' #2842 showTab relocates the settings panel into the display area (consolidated)', out.err === null && out.relocatedByShowTab === true && out.hiddenBeforeOpen === true, JSON.stringify(out));
    ok(t + ' #2842 THE FIX: opening settings stays in the consolidated view (no kick-out to tab view)', out.err === null && out.stillConsolidated === true, JSON.stringify(out));
    ok(t + ' #2842 settings opens visible in the display column', out.err === null && out.settingsVisible === true && out.settingsInDisplay === true, JSON.stringify(out));
    ok(t + ' #2842 the projects list stays visible beside settings', out.err === null && out.listStillVisible === true && out.projectViewHidden === true, JSON.stringify(out));
    // The margin:0 fix: without it the panel centers and shrinks to ~554px offset ~180px into
    // the column. Assert it sits just past the list and fills most of column 2.
    ok(t + ' #2842 settings FILLS the display column (guards the margin:0 fix)', out.err === null && out.leftGapPastList < 40 && out.settingsWidth > out.col2Width - 60, JSON.stringify(out));
    ok(t + ' #2842 navigating to a project hides settings and shows the project', out.err === null && out.settingsHiddenAfterNav === true && out.projectShownAfterNav === true, JSON.stringify(out));
    ok(t + ' #2842 leaving the consolidated view restores settings to the top level', out.err === null && out.restoredToTopLevel === true, JSON.stringify(out));
    ok(t + ' #2842 CONTROL: in the tab view #rail-me-go does not enter the consolidated view', out.err === null && out.tabViewNotConsolidated === true, JSON.stringify(out));

    // ---- The LIST state: settings must not render over the #pj-none "nothing is open" hint.
    // The first evaluate hardcodes PJ_CURRENT='k' (PJ_VIEW='one'); this covers PJ_VIEW='list'
    // with projects present but none open -- the state where paintPjNone shows the hint
    // ("Nothing is open yet. Pick a project..."). #pj-none is a #panel-projects display-column
    // child too, so it must be hidden while settings shows -- AND stay hidden when the 5s poll
    // re-invokes paintPjNone. (The zero-projects case is not a conflict: paintPjNone renders an
    // empty string there, so the hint is already hidden.) ----
    const listState = await page.evaluate(() => {
      const res = {};
      const none = document.getElementById('pj-none');
      const settings = document.getElementById('panel-settings');
      try {
        // Projects exist, but none is open (PJ_VIEW='list') -> the hint shows.
        PROJECTS = [{ id: 'k', name: 'Kosmos', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
        PJ_SORT = 'az'; PJ_CURRENT = null;
        PJ_LOADED_ONCE = true; PJ_READ_FAILED = false;   // a successful read
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');                              // PJ_VIEW becomes 'list'
        res.noneShownBeforeOpen = none.hidden === false;  // control: the hint IS up in the list state
        // Open settings from the list state.
        document.getElementById('rail-me-go').click();
        res.settingsOpen = settings.hidden === false && settings.parentElement === document.getElementById('panel-projects');
        res.noneHiddenAfterOpen = none.hidden === true;   // THE BLOCKER: hint must be hidden under settings
        // The 5s project poll re-invokes paintPjNone; it must NOT re-show the hint over settings.
        paintPjNone();
        res.noneStillHiddenAfterPoll = none.hidden === true;
        res.settingsStillOpenAfterPoll = settings.hidden === false;
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });
    ok(t + ' #2842 CONTROL: the list-state hint (#pj-none) shows before settings opens', listState.err === null && listState.noneShownBeforeOpen === true, JSON.stringify(listState));
    ok(t + ' #2842 BLOCKER: opening settings from the list state hides #pj-none (no hint over settings)', listState.err === null && listState.settingsOpen === true && listState.noneHiddenAfterOpen === true, JSON.stringify(listState));
    ok(t + ' #2842 the project poll (paintPjNone) does not re-show #pj-none while settings is open', listState.err === null && listState.noneStillHiddenAfterPoll === true && listState.settingsStillOpenAfterPoll === true, JSON.stringify(listState));

    // ---- Reachable from the AGENTS tab too (#rail-me-go shows whenever cons is true, and cons
    // includes tab==='agents'). Opening settings there must behave the same. ----
    const agentsTab = await page.evaluate(() => {
      const res = {};
      const settings = document.getElementById('panel-settings');
      try {
        PROJECTS = [{ id: 'k', name: 'Kosmos', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
        PJ_SORT = 'az'; PJ_CURRENT = null;
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('agents');                                 // consolidated agents tab
        res.consolidatedOnAgents = document.body.classList.contains('consolidated');
        document.getElementById('rail-me-go').click();
        res.stillConsolidated = document.body.classList.contains('consolidated');
        res.settingsOpen = settings.hidden === false && settings.parentElement === document.getElementById('panel-projects');
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });
    ok(t + ' #2842 settings opens from the Agents tab too, staying consolidated', agentsTab.err === null && agentsTab.consolidatedOnAgents === true && agentsTab.stillConsolidated === true && agentsTab.settingsOpen === true, JSON.stringify(agentsTab));

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
