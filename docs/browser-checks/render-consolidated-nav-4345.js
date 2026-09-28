'use strict';
// Browser-check-surface: panel-cons-agents openConsolidatedAgents placeAgentsPanel consNavLight CONS_AGENTS_OPEN
// (#2518) the distinctive web/index.html tokens this check asserts. A change to any of them must
// update this check at PR time.
/* #4345 (Josh, #admin 2026-09-28 09:21): in the consolidated view the top nav (Agents, Projects,
 * Tasks) used to disappear, so there was no easy way from anything in the display column back to
 * the board. Now the nav stays, and its items load INTO the display column instead of switching to
 * the tab view:
 *  - Agents: the person's agents view (org chart if their Agents layout is org, else the card grid)
 *    moves into the column; the agents list stays the rail. An agent click there opens that agent's
 *    page, the same openDetail the rail calls.
 *  - Tasks: the existing consolidated Tasks panel (#3559).
 *  - Projects: the board comes back (the way back).
 * The lit nav item says what the column holds. Leaving the consolidated view restores #grid and
 * #orgview to their tab-view slots. This drives the SHIPPED #tabs click handler, showTab, pjView,
 * takeOverDisplayColumn and boardApplyVisibility in the real page.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-consolidated-nav-4345.js
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
      const $ = (id) => document.getElementById(id);
      const tab = (name) => document.querySelector('#tabs .tab[data-tab="' + name + '"]');
      const lit = () => [...document.querySelectorAll('#tabs .tab.on')].map((b) => b.dataset.tab).join(',');
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const cons = () => document.body.classList.contains('consolidated');
      const opened = [];
      window.openDetail = (name) => { opened.push(name); };   // record what an agent click opens
      const res = {};
      try {
        document.documentElement.setAttribute('data-layout', 'consolidated');
        PJ_CURRENT = 'k';
        showTab('projects');
        // 1. The nav is on screen in the consolidated view, and Projects is lit for the board.
        res.navShown = shown($('tabs')) && shown(tab('agents')) && shown(tab('projects'));
        res.litOnBoard = lit();
        const hr = document.querySelector('.headright');
        const a = $('tabs').getBoundingClientRect(); const b = hr ? hr.getBoundingClientRect() : null;
        res.navClearOfRight = !b || a.right <= b.left + 1 || a.left >= b.right - 1;
        res.noSideScroll = document.documentElement.scrollWidth <= window.innerWidth;

        // 2. Agents loads the card grid into the display column; everything else stays.
        BOARD_LAYOUT = 'grid';
        tab('agents').click();
        res.a_cons = cons();
        res.a_inColumn = $('panel-cons-agents').parentElement === $('panel-projects') && $('grid').parentElement === $('panel-cons-agents');
        res.a_gridShown = shown($('grid'));
        res.a_orgHidden = $('orgview').hidden === true;
        res.a_railShown = shown($('alist'));
        res.a_projectsColShown = $('pj-list-view').hidden === false;
        res.a_projectHidden = $('pj-one-view').hidden === true;
        res.a_lit = lit();
        res.a_noneHidden = $('pj-none').hidden === true;

        // 3. An agent click in the column opens that agent's page (openDetail), as the rail does.
        $('grid').innerHTML = '<div class="acard" data-agent="max"><b>Max</b></div>';
        $('grid').querySelector('.acard').click();
        res.a_clickOpened = opened.join(',');

        // 4. Someone whose Agents layout is org sees the chart there, not the grid.
        BOARD_LAYOUT = 'org';
        tab('agents').click();
        res.o_orgShown = $('orgview').hidden === false && $('orgview').parentElement === $('panel-cons-agents');
        res.o_gridHidden = $('grid').hidden === true;
        BOARD_LAYOUT = 'grid';

        // 5. Projects is the way back: the board returns and the Agents view closes.
        tab('projects').click();
        res.p_cons = cons();
        res.p_agentsHidden = $('panel-cons-agents').hidden === true;
        res.p_gridHidden = $('grid').hidden === true;
        res.p_lit = lit();
        res.p_projectsColShown = $('pj-list-view').hidden === false;

        // 6. Opening a project from the rail while Agents is open closes it (project navigation).
        tab('agents').click();
        openProject('s');
        res.n_agentsHidden = $('panel-cons-agents').hidden === true;
        // The record, not only the DOM: a flag left on keeps drawing the chart into a hidden panel.
        res.n_flagCleared = CONS_AGENTS_OPEN === false && $('grid').hidden === true;
        res.n_projectShown = $('pj-one-view').hidden === false;
        res.n_lit = lit();

        // 7. Settings over the Agents view: one overlay at a time, and no nav item is lit.
        tab('agents').click();
        $('userpop-settings').click();
        res.s_settingsShown = $('panel-settings').hidden === false;
        res.s_agentsHidden = $('panel-cons-agents').hidden === true;
        res.s_lit = lit();

        // 8. Tasks loads into the column too (its tab shows once a person has 25 tasks; unhidden here).
        tab('tasks').hidden = false;
        tab('tasks').click();
        res.t_cons = cons();
        res.t_inColumn = $('panel-tasks').parentElement === $('panel-projects') && $('panel-tasks').hidden === false;
        res.t_lit = lit();

        // 9. Leaving the consolidated view puts #grid and #orgview back in their tab-view slots, and
        //    CONTROL: a tab click there is the ordinary tab switch (no consolidated class).
        // The real layout switch (the Settings pick, the resize handler) sets the layout and runs showTab.
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects');
        tab('agents').click();
        res.x_cons = cons();
        res.x_gridHome = $('grid').parentElement !== $('panel-cons-agents') && !$('panel-projects').contains($('grid'));
        res.x_orgHome = !$('panel-projects').contains($('orgview'));
        res.x_gridShown = shown($('grid'));
        res.err = null;
      } catch (e) { res.err = String(e && e.stack || e); }
      return res;
    });
    const J = JSON.stringify(out);
    const e0 = out.err === null;
    ok(t + ' the top nav is on screen in the consolidated view, Projects lit for the board', e0 && out.navShown === true && out.litOnBoard === 'projects', J);
    ok(t + ' the nav does not collide with the right-hand header cluster, and nothing scrolls sideways', e0 && out.navClearOfRight === true && out.noSideScroll === true, J);
    ok(t + ' Agents loads the card grid into the display column and stays consolidated', e0 && out.a_cons && out.a_inColumn && out.a_gridShown && out.a_orgHidden, J);
    ok(t + ' the agents rail and the projects column stay beside it; the project view steps aside', e0 && out.a_railShown && out.a_projectsColShown && out.a_projectHidden, J);
    ok(t + ' Agents is lit while the column holds it, and the empty-board hint stays off', e0 && out.a_lit === 'agents' && out.a_noneHidden === true, J);
    ok(t + ' an agent click in the column opens that agent (openDetail, as the rail does)', e0 && out.a_clickOpened === 'max', J);
    ok(t + ' an org-chart person gets the chart in the column, not the grid', e0 && out.o_orgShown && out.o_gridHidden, J);
    ok(t + ' Projects brings the board back and closes the Agents view', e0 && out.p_cons && out.p_agentsHidden && out.p_gridHidden && out.p_lit === 'projects' && out.p_projectsColShown, J);
    ok(t + ' opening a project closes the Agents view, Projects lit', e0 && out.n_agentsHidden && out.n_projectShown && out.n_lit === 'projects', J);
    ok(t + ' ...and clears the record, so the grid is hidden again, not only its wrapper', e0 && out.n_flagCleared === true, J);
    ok(t + ' Settings over the Agents view hides it, and no nav item is lit', e0 && out.s_settingsShown && out.s_agentsHidden && out.s_lit === '', J);
    ok(t + ' Tasks loads into the column, staying consolidated, Tasks lit', e0 && out.t_cons && out.t_inColumn && out.t_lit === 'tasks', J);
    ok(t + ' leaving the consolidated view restores the grid and chart to the tab view (CONTROL: an ordinary tab switch)', e0 && out.x_cons === false && out.x_gridHome && out.x_orgHome && out.x_gridShown, J);
    // ---- The LIST state (no project open): the "Open or create a project" hint must not draw over
    // the Agents view, including after the 5s poll's paintPjNone. Same guard #3053 has for Create. ----
    const listState = await page.evaluate(() => {
      const res = {};
      const none = document.getElementById('pj-none');
      try {
        PROJECTS = [{ id: 'k', name: 'Kosmos', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
        PJ_SORT = 'az'; PJ_CURRENT = null; PJ_LOADED_ONCE = true; PJ_READ_FAILED = false;
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');
        res.noneShownBefore = none.hidden === false;   // CONTROL: the hint IS up in the list state
        document.querySelector('#tabs .tab[data-tab="agents"]').click();
        res.noneHiddenAfterOpen = none.hidden === true;
        paintPjNone();
        res.noneHiddenAfterPoll = none.hidden === true;
        res.err = null;
      } catch (e) { res.err = String(e && e.stack || e); }
      return res;
    });
    const L = JSON.stringify(listState);
    ok(t + ' CONTROL: the list-state hint shows before Agents opens', listState.err === null && listState.noneShownBefore === true, L);
    ok(t + ' the hint is hidden under the Agents view, and the poll does not bring it back', listState.err === null && listState.noneHiddenAfterOpen === true && listState.noneHiddenAfterPoll === true, L);
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
