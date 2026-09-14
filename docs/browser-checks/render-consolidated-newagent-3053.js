'use strict';
// Browser-check-surface: rail-agents-new openConsolidatedCreate placeCreatePanel
// (#2518) the distinctive web/index.html tokens this check asserts: the New Agent + button in
// the consolidated rail and the two functions that open/relocate the create panel into the
// display column. A change to any of them must update this check at PR time.
/* #3053 (Josh, 6.63 review): clicking New Agent from the CONSOLIDATED view used to kick the
 * whole layout back to the tab view, because openCreate calls showTab('create') and showTab drops
 * body.consolidated for any tab that is not agents/projects. The fix opens the create panel IN the
 * display column (the same #2842 treatment settings got): #panel-create is relocated into
 * #panel-projects, the agents column and projects list stay, and the create form takes over the
 * display area. This drives the SHIPPED showTab + #rail-agents-new/#new-agent handler +
 * openCreate + openConsolidatedCreate + pjView against a real fixture in the real page.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-consolidated-newagent-3053.js
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
      // loadRoles/loadProjects fetch /api/* over file:// and fail; those are expected here.
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
      const panelCreate = document.getElementById('panel-create');
      const panelProjects = document.getElementById('panel-projects');
      const listView = document.getElementById('pj-list-view');
      const railNew = document.getElementById('rail-agents-new');
      const rect = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) }; };
      try {
        // Enter the consolidated view through the real path; showTab relocates the create panel.
        document.documentElement.setAttribute('data-layout', 'consolidated');
        PJ_CURRENT = 'k';
        showTab('projects');
        res.relocatedByShowTab = panelCreate.parentElement === panelProjects;
        res.hiddenBeforeOpen = panelCreate.hidden === true;
        // Open New Agent via the real consolidated + button (#rail-agents-new -> #new-agent -> openCreate).
        railNew.click();
        res.stillConsolidated = document.body.classList.contains('consolidated');   // THE FIX: no kick-out
        res.createVisible = panelCreate.hidden === false;
        res.createInDisplay = panelCreate.parentElement === panelProjects;
        res.listStillVisible = listView.hidden === false;                            // projects column kept
        res.projectViewHidden = document.getElementById('pj-one-view').hidden === true;
        // Fills the display column: its left sits just past the list's right edge, wide, not a
        // centered content-width island offset into the column.
        const pc = rect(panelCreate); const lv = rect(listView); const pp = rect(panelProjects);
        res.leftGapPastList = pc.left - lv.right;
        res.createWidth = pc.w;
        res.col2Width = pp.w - lv.w;
        res.onRoleStep = document.getElementById('cstep-role') && document.getElementById('cstep-role').hidden === false;
        // Navigate to a project -> create hides, project shows (create-back / done path).
        pjView('one');
        res.createHiddenAfterNav = panelCreate.hidden === true;
        res.projectShownAfterNav = document.getElementById('pj-one-view').hidden === false;
        // Leave the consolidated view -> create panel restored to the top level (tab-view home).
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects');
        res.restoredToTopLevel = panelCreate.parentElement !== panelProjects;
        // CONTROL: in the tab view New Agent routes through showTab('create') and does NOT enter
        // the consolidated view (openCreate's else branch). body.consolidated must be false after.
        document.getElementById('new-agent').click();
        res.tabViewNotConsolidated = document.body.classList.contains('consolidated') === false;
        res.tabViewCreateShown = document.getElementById('panel-create').hidden === false;
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });

    ok(t + ' #3053 showTab relocates the create panel into the display area (consolidated)', out.err === null && out.relocatedByShowTab === true && out.hiddenBeforeOpen === true, JSON.stringify(out));
    ok(t + ' #3053 THE FIX: New Agent stays in the consolidated view (no kick-out to tab view)', out.err === null && out.stillConsolidated === true, JSON.stringify(out));
    ok(t + ' #3053 the create panel opens visible in the display column, on the role step', out.err === null && out.createVisible === true && out.createInDisplay === true && out.onRoleStep === true, JSON.stringify(out));
    ok(t + ' #3053 the projects list stays visible beside the create panel', out.err === null && out.listStillVisible === true && out.projectViewHidden === true, JSON.stringify(out));
    // The create panel is a 34rem FORM, not a full-width fill like settings: it must sit at the
    // top-LEFT of the display column (small gap past the list, not offset ~180 into it) at its real
    // form width (~34rem/544px), never collapsed to a narrow content-width island (~193px was the
    // pre-CSS-fix bug). Range excludes both the slammed-narrow and the accidental full-fill outcomes.
    ok(t + ' #3053 the create form sits at the top-left of the display column at its form width, not a narrow island', out.err === null && out.leftGapPastList < 40 && out.createWidth >= 400 && out.createWidth <= 640, JSON.stringify(out));
    ok(t + ' #3053 navigating to a project hides create and shows the project (the exit path)', out.err === null && out.createHiddenAfterNav === true && out.projectShownAfterNav === true, JSON.stringify(out));
    ok(t + ' #3053 leaving the consolidated view restores the create panel to the top level', out.err === null && out.restoredToTopLevel === true, JSON.stringify(out));
    ok(t + ' #3053 CONTROL: in the tab view New Agent does not enter the consolidated view (full-page create)', out.err === null && out.tabViewNotConsolidated === true && out.tabViewCreateShown === true, JSON.stringify(out));

    // ---- The LIST state: the create panel must not render over the #pj-none "nothing is open"
    // hint, and the 5s poll (paintPjNone) must not re-show the hint over the create panel. Mirrors
    // the #2842 settings list-state guard, for the create panel's appCreateOpen check. ----
    const listState = await page.evaluate(() => {
      const res = {};
      const none = document.getElementById('pj-none');
      const create = document.getElementById('panel-create');
      try {
        PROJECTS = [{ id: 'k', name: 'Kosmos', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
        PJ_SORT = 'az'; PJ_CURRENT = null;
        PJ_LOADED_ONCE = true; PJ_READ_FAILED = false;   // a successful read
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');                              // PJ_VIEW becomes 'list'
        res.noneShownBeforeOpen = none.hidden === false;  // control: the hint IS up in the list state
        document.getElementById('rail-agents-new').click();
        res.createOpen = create.hidden === false && create.parentElement === document.getElementById('panel-projects');
        res.noneHiddenAfterOpen = none.hidden === true;   // THE BLOCKER: hint must be hidden under create
        paintPjNone();                                    // the 5s poll re-invokes this
        res.noneStillHiddenAfterPoll = none.hidden === true;
        res.createStillOpenAfterPoll = create.hidden === false;
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });
    ok(t + ' #3053 CONTROL: the list-state hint (#pj-none) shows before New Agent opens', listState.err === null && listState.noneShownBeforeOpen === true, JSON.stringify(listState));
    ok(t + ' #3053 BLOCKER: opening New Agent from the list state hides #pj-none (no hint over create)', listState.err === null && listState.createOpen === true && listState.noneHiddenAfterOpen === true, JSON.stringify(listState));
    ok(t + ' #3053 the project poll (paintPjNone) does not re-show #pj-none while create is open', listState.err === null && listState.noneStillHiddenAfterPoll === true && listState.createStillOpenAfterPoll === true, JSON.stringify(listState));

    // ---- Reachable from the AGENTS tab too (rail-agents-new lives in the agents rail, and cons
    // includes tab==='agents'). Opening New Agent there must behave the same. ----
    const agentsTab = await page.evaluate(() => {
      const res = {};
      const create = document.getElementById('panel-create');
      try {
        PROJECTS = [{ id: 'k', name: 'Kosmos', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
        PJ_SORT = 'az'; PJ_CURRENT = null;
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('agents');                                 // consolidated agents tab
        res.consolidatedOnAgents = document.body.classList.contains('consolidated');
        document.getElementById('rail-agents-new').click();
        res.stillConsolidated = document.body.classList.contains('consolidated');
        res.createOpen = create.hidden === false && create.parentElement === document.getElementById('panel-projects');
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });
    ok(t + ' #3053 New Agent opens from the Agents tab too, staying consolidated', agentsTab.err === null && agentsTab.consolidatedOnAgents === true && agentsTab.stillConsolidated === true && agentsTab.createOpen === true, JSON.stringify(agentsTab));

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
