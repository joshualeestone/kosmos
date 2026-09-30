'use strict';
// Browser-check-surface: panel-cons-agents cons-agents-lay consLaySync openConsolidatedAgents placeAgentsPanel consNavLight CONS_AGENTS_OPEN panel-cons-projects pj-full-list pj-full-sort openConsolidatedProjects paintConsProjects CONS_PROJECTS_OPEN
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
 *  - Projects (#4377, slice 2): the full projects page (the Projects tab's grid, with its sort) in
 *    the column; a row click activates that project, as the rail does. Pressed again, or any project
 *    opened, is the way back to the board, which lights no nav item.
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

        // 5. Projects (#4377) opens the full projects page over the Agents view; pressed again it is the
        //    way back to the board.
        tab('projects').click();
        res.p_fullOpen = $('panel-cons-projects') && $('panel-cons-projects').hidden === false && lit() === 'projects';
        tab('projects').click();
        res.p_cons = cons();
        res.p_agentsHidden = $('panel-cons-agents').hidden === true;
        res.p_gridHidden = $('grid').hidden === true;
        res.p_lit = lit();
        res.p_projectsColShown = $('pj-list-view').hidden === false;
        res.p_fullHidden = $('panel-cons-projects').hidden === true;
        // The way back keeps the active project (review round 1: it used to drop it).
        res.p_keptProject = PJ_CURRENT === 'k' && $('pj-one-view').hidden === false;

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
    const $hidden = (o) => o.p_fullHidden === true;
    const e0 = out.err === null;
    ok(t + ' the top nav is on screen in the consolidated view, and the board itself lights no item', e0 && out.navShown === true && out.litOnBoard === '', J);
    ok(t + ' the nav does not collide with the right-hand header cluster, and nothing scrolls sideways', e0 && out.navClearOfRight === true && out.noSideScroll === true, J);
    ok(t + ' Agents loads the card grid into the display column and stays consolidated', e0 && out.a_cons && out.a_inColumn && out.a_gridShown && out.a_orgHidden, J);
    ok(t + ' the agents rail and the projects column stay beside it; the project view steps aside', e0 && out.a_railShown && out.a_projectsColShown && out.a_projectHidden, J);
    ok(t + ' Agents is lit while the column holds it, and the empty-board hint stays off', e0 && out.a_lit === 'agents' && out.a_noneHidden === true, J);
    ok(t + ' an agent click in the column opens that agent (openDetail, as the rail does)', e0 && out.a_clickOpened === 'max', J);
    ok(t + ' an org-chart person gets the chart in the column, not the grid', e0 && out.o_orgShown && out.o_gridHidden, J);
    ok(t + ' Projects over the Agents view opens the full projects page, Projects lit', e0 && out.p_fullOpen === true, J);
    ok(t + ' Projects pressed again brings the board back (Agents view closed, nothing lit)', e0 && out.p_cons && out.p_agentsHidden && out.p_gridHidden && out.p_lit === '' && out.p_projectsColShown && $hidden(out), J);
    ok(t + ' ...and keeps the project that was open, rather than resetting to the list', e0 && out.p_keptProject === true, J);
    ok(t + ' opening a project closes the Agents view; the board lights nothing', e0 && out.n_agentsHidden && out.n_projectShown && out.n_lit === '', J);
    ok(t + ' ...and clears the record, so the grid is hidden again, not only its wrapper', e0 && out.n_flagCleared === true, J);
    ok(t + ' Settings over the Agents view hides it, and no nav item is lit', e0 && out.s_settingsShown && out.s_agentsHidden && out.s_lit === '', J);
    ok(t + ' Tasks loads into the column, staying consolidated, Tasks lit', e0 && out.t_cons && out.t_inColumn && out.t_lit === 'tasks', J);
    ok(t + ' leaving the consolidated view restores the grid and chart to the tab view (CONTROL: an ordinary tab switch)', e0 && out.x_cons === false && out.x_gridHome && out.x_orgHome && out.x_gridShown, J);
    // ---- Review round 1: an agent's page, the column's own layout switch, and a takeover. ----
    const r1 = await page.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      const tab = (name) => document.querySelector('#tabs .tab[data-tab="' + name + '"]');
      const res = {};
      try {
        document.documentElement.setAttribute('data-layout', 'consolidated');
        PJ_CURRENT = 'k'; BOARD_LAYOUT = 'grid';
        showTab('projects');
        // (a) From an agent's page (which drops the consolidated class), Agents lands on the Agents view.
        showTab('detail');
        res.d_leftCons = document.body.classList.contains('consolidated') === false;   // CONTROL: the page really left it
        tab('agents').click();
        res.d_agentsOpen = document.body.classList.contains('consolidated') && $('panel-cons-agents').hidden === false && CONS_AGENTS_OPEN === true;
        // (b) "All agents" opens the Agents view in the consolidated layout from EVERY opener. Asserted on
        // the screen (the lit item, the grid itself visible), not only the flag (review round 2).
        const lit = () => [...document.querySelectorAll('#tabs .tab.on')].map((x) => x.dataset.tab).join(',');
        const vis = (el) => !!el && el.getClientRects().length > 0;
        for (const [label, from] of [['fromAgents', () => tab('agents').click()], ['fromBoard', () => tab('projects').click()]]) {
          from();
          showTab('detail');
          $('detail-back').click();
          res['b_' + label] = document.body.classList.contains('consolidated') && lit() === 'agents' && vis($('grid')) && $('panel-cons-agents').parentElement === $('panel-projects');
        }
        // (b2) New Agent's own "All agents" goes to the same place (review round 3).
        tab('projects').click();
        $('rail-agents-new').click();
        $('create-back').click();
        res.b_create = document.body.classList.contains('consolidated') && lit() === 'agents' && vis($('grid'));
        // (b3) Focus after a removal lands on the lit item, so focus and the highlight agree.
        tab('projects').click();
        focusBoardHome();
        res.f_lit = document.activeElement === document.querySelector('#tabs .tab[data-tab="projects"]');
        // CONTROL: in the tab layout "All agents" is the ordinary Agents tab (no consolidated class).
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects'); showTab('detail');
        $('detail-back').click();
        res.b_tabs = document.body.classList.contains('consolidated') === false && lit() === 'agents' && vis($('grid'));
        showTab('create'); $('create-back').click();
        res.b_createTabs = document.body.classList.contains('consolidated') === false && lit() === 'agents' && vis($('grid'));
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');
        // (c) The column's switch: Org chart shows the chart and saves the choice; Grid brings the grid back.
        tab('agents').click();
        const sw = (v) => $('panel-cons-agents').querySelector('[data-conslay="' + v + '"]');
        sw('org').click();
        let saved = null; try { saved = localStorage.getItem('kosmos.layout.agents'); } catch { saved = 'unreadable'; }
        res.s_org = $('orgview').hidden === false && $('grid').hidden === true && sw('org').getAttribute('aria-checked') === 'true' && saved === 'org';
        sw('grid').click();
        res.s_grid = $('grid').hidden === false && $('orgview').hidden === true && sw('grid').getAttribute('aria-checked') === 'true';
        // (c2) A saved 'list' shows the grid but presses neither button (no silent overwrite).
        BOARD_LAYOUT = 'list';
        tab('agents').click();
        res.l_neither = $('grid').hidden === false && sw('grid').getAttribute('aria-checked') === 'false' && sw('org').getAttribute('aria-checked') === 'false';
        BOARD_LAYOUT = 'grid';
        tab('agents').click();
        // (d) Another overlay taking the column re-hides the grid, not only its wrapper.
        $('userpop-settings').click();
        res.t_rehidden = $('grid').hidden === true && CONS_AGENTS_OPEN === false;
        res.err = null;
      } catch (e) { res.err = String(e && e.stack || e); }
      return res;
    });
    const R1 = JSON.stringify(r1);
    const r0 = r1.err === null;
    ok(t + ' from an agent\'s page, Agents lands on the Agents view (CONTROL: the page had left the consolidated class)', r0 && r1.d_leftCons === true && r1.d_agentsOpen === true, R1);
    ok(t + ' "All agents" opens the Agents view (lit, grid visible) when the agent came from the Agents view', r0 && r1.b_fromAgents === true, R1);
    ok(t + ' "All agents" opens the Agents view too when the agent was opened from the board', r0 && r1.b_fromBoard === true, R1);
    ok(t + ' CONTROL: in the tab layout "All agents" is the ordinary Agents tab', r0 && r1.b_tabs === true, R1);
    ok(t + ' New Agent\'s "All agents" opens the Agents view too (same label, same place)', r0 && r1.b_create === true, R1);
    ok(t + ' CONTROL: in the tab layout New Agent\'s "All agents" is the ordinary Agents tab', r0 && r1.b_createTabs === true, R1);
    ok(t + ' focus after a removal lands on the lit nav item', r0 && r1.f_lit === true, R1);
    ok(t + ' the column\'s Org chart switch shows the chart and saves the choice', r0 && r1.s_org === true, R1);
    ok(t + ' the column\'s Grid switch brings the grid back', r0 && r1.s_grid === true, R1);
    ok(t + ' a saved list layout shows the grid and checks neither segment', r0 && r1.l_neither === true, R1);
    ok(t + ' another overlay taking the column re-hides the grid itself', r0 && r1.t_rehidden === true, R1);

    // ---- #4594 (Josh, 2026-09-29 12:01): the Agents view switch is ONE segmented control, not two pills. ----
    await page.evaluate(() => { BOARD_LAYOUT = 'grid'; document.querySelector('#tabs .tab[data-tab="agents"]').click(); });
    const seg = await page.evaluate(() => {
      const box = document.querySelector('#panel-cons-agents .cons-agents-lay');
      const bs = [...box.querySelectorAll('[data-conslay]')];
      const cs = getComputedStyle(box);
      const r0 = bs[0].getBoundingClientRect(); const r1b = bs[1].getBoundingClientRect();
      const probe = (v) => { const e = document.createElement('i'); e.style.color = v; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
      return {
        role: box.getAttribute('role'), radios: bs.map((b) => b.getAttribute('role')).join(','),
        track: parseFloat(cs.borderTopWidth) > 0 && cs.overflow === 'hidden',
        touching: Math.abs(r1b.left - r0.right) <= 1 && Math.abs(r0.top - r1b.top) <= 1,
        onBg: getComputedStyle(bs[0]).backgroundColor, gold: probe('var(--gold-bright)'),
        offBg: getComputedStyle(bs[1]).backgroundColor,
        tabs: bs.map((b) => b.tabIndex).join(','),
        checked: bs.map((b) => b.getAttribute('aria-checked')).join(','),
      };
    });
    const SEG = JSON.stringify(seg);
    ok(t + ' #4594: the switch is a radiogroup of two radios', seg.role === 'radiogroup' && seg.radios === 'radio,radio', SEG);
    ok(t + ' #4594: one connected track: a bordered, clipped box with the segments touching (not two pills with a gap)', seg.track && seg.touching, SEG);
    ok(t + ' #4594: the selected segment is filled gold and the other is not', seg.onBg === seg.gold && seg.offBg !== seg.gold && seg.checked === 'true,false', SEG);
    ok(t + ' #4594: one tab stop, on the selected segment', seg.tabs === '0,-1', SEG);
    await page.focus('#panel-cons-agents [data-conslay="grid"]');
    await page.keyboard.press('ArrowRight');
    const k1 = await page.evaluate(() => ({ org: document.getElementById('orgview').hidden === false, focus: document.activeElement && document.activeElement.dataset.conslay,
      checked: [...document.querySelectorAll('#panel-cons-agents [data-conslay]')].map((b) => b.getAttribute('aria-checked')).join(',') }));
    ok(t + ' #4594: ArrowRight moves to Org chart, chooses it and takes focus', k1.org && k1.focus === 'org' && k1.checked === 'false,true', JSON.stringify(k1));
    await page.keyboard.press('ArrowRight');
    const k2 = await page.evaluate(() => ({ grid: document.getElementById('grid').hidden === false, focus: document.activeElement && document.activeElement.dataset.conslay }));
    ok(t + ' #4594: ArrowRight from the last segment wraps to Grid', k2.grid && k2.focus === 'grid', JSON.stringify(k2));

    // ---- #4377, slice 2: the full projects page. fetch never settles here, so the fixture's rows are
    // the ones painted (over file:// the read fails and would paint "cannot read" instead). ----
    const s2 = await page.evaluate(async () => {
      const $ = (id) => document.getElementById(id);
      const tab = (name) => document.querySelector('#tabs .tab[data-tab="' + name + '"]');
      const lit = () => [...document.querySelectorAll('#tabs .tab.on')].map((x) => x.dataset.tab).join(',');
      const names = (el) => [...el.querySelectorAll('[data-project] .pjname b')].map((b) => b.textContent).join(',');
      const res = {};
      try {
        window.fetch = () => new Promise(() => {});
        const mk = (id, name, at) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0, createdAt: at });
        PROJECTS = [mk('a', 'Alpha', '2026-01-01'), mk('b', 'Beta', '2026-02-01'), mk('c', 'Gamma', '2026-03-01')];
        PJ_SORT = 'az'; PJ_CURRENT = null; PJ_LOADED_ONCE = true; PJ_READ_FAILED = false;
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');
        paintProjects();
        res.noneBefore = $('pj-none').hidden === false;   // CONTROL: the list-state hint is up on the board
        tab('projects').click();
        paintProjects();
        const full = $('pj-full-list');
        res.open = $('panel-cons-projects').hidden === false && $('panel-cons-projects').parentElement === $('panel-projects') && lit() === 'projects' && document.body.classList.contains('consolidated');
        res.rows = full.querySelectorAll('[data-project]').length;
        res.railRows = $('pj-list').querySelectorAll('[data-project]').length;
        res.isGrid = full.classList.contains('pj-list') && full.classList.contains('asgrid');
        const fr = full.querySelector('.pj-row'); const rr = $('pj-list').querySelector('.pj-row');
        res.fullAlign = fr ? getComputedStyle(fr).textAlign : null;   // the grid card is centred
        res.railAlign = rr ? getComputedStyle(rr).textAlign : null;   // the rail row stays left
        res.railShown = $('pj-list-view').hidden === false;
        res.noneHidden = $('pj-none').hidden === true;
        // Sort from the column drives the one sort (#pj-sort, PJ_SORT) and the rail follows.
        res.orderAz = names(full);
        $('pj-full-sort').value = 'za';
        $('pj-full-sort').dispatchEvent(new Event('change'));
        res.orderZa = names(full);
        res.sortShared = PJ_SORT === 'za' && $('pj-sort').value === 'za' && names($('pj-list')) === res.orderZa;
        PJ_SORT = 'az'; $('pj-sort').value = 'az'; paintProjects();
        // A row click activates that project in the column, as the rail does; no nested view.
        full.querySelector('[data-project="b"]').click();
        res.clicked = PJ_CURRENT === 'b' && $('pj-one-view').hidden === false && $('panel-cons-projects').hidden === true && lit() === '' && CONS_PROJECTS_OPEN === false;
        // Empty and failed reads say what the rail says.
        tab('projects').click();
        PROJECTS = []; paintProjects();
        res.emptySame = full.querySelectorAll('[data-project]').length === 0 && full.textContent.trim() !== '' && full.textContent.trim() === $('pj-list').textContent.trim();
        // No duplicate id from the copied empty state, and its "Add a project" still works.
        res.oneEmptyId = document.querySelectorAll('#pj-new-empty').length <= 1 && !!full.querySelector('[data-pj-new-empty]');
        PROJECTS = [mk('a', 'Alpha', '2026-01-01')]; paintProjects();
        res.backRows = full.querySelectorAll('[data-project]').length === 1;
        // The 5s poll's hint repaint keeps the hint off while the page is open. From the LIST state (no
        // project open), where the hint does show on the board: that is the control.
        PJ_CURRENT = null; showTab('projects'); paintPjNone();
        res.noneOnBoard = $('pj-none').hidden === false;
        tab('projects').click();
        paintPjNone();
        res.noneAfterPoll = $('pj-none').hidden === true && $('panel-cons-projects').hidden === false;
        // A failed read: the page says what the rail says (the read's own failure path paints it).
        window.fetch = () => Promise.reject(new Error('down'));
        await loadProjects();
        res.failSame = full.querySelectorAll('[data-project]').length === 0 && /cannot read your projects/i.test(full.textContent)
          && full.textContent.trim() === $('pj-list').textContent.trim();
        window.fetch = () => new Promise(() => {});
        // Review round 1: a parent/child pair. The copy is a grid, so no fold caret shows on the parent and
        // the child's parent chip stays centred, as in the Projects tab's grid; the rail keeps both.
        PROJECTS = [mk('a', 'Alpha', '2026-01-01'), Object.assign(mk('d', 'Delta', '2026-04-01'), { parent: 'a', parentName: 'Alpha' })];
        paintProjects();
        const caret = (root) => root.querySelector('[data-project="a"] .pjtreefold');
        const anc = (root) => root.querySelector('[data-project="d"] .pj-anc');
        res.caretCopy = caret(full) ? getComputedStyle(caret(full)).display : 'absent';
        res.caretRail = caret($('pj-list')) ? getComputedStyle(caret($('pj-list'))).display : 'absent';
        res.ancCopy = anc(full) ? getComputedStyle(anc(full)).justifyContent : 'absent';
        res.ancRail = anc($('pj-list')) ? getComputedStyle(anc($('pj-list'))).justifyContent : 'absent';
        // The sort control carries its chevron.
        res.chevron = !!$('panel-cons-projects').querySelector('.sortctl .sortctl-i');
        // With a project current, only the rail marks it.
        PJ_CURRENT = 'a'; paintProjects();
        res.oneCurrent = document.querySelectorAll('[aria-current="true"][data-project]').length === 1;
        PJ_CURRENT = null; paintProjects();
        // Settings taking the column closes it (one overlay at a time).
        $('userpop-settings').click();
        res.settingsClosed = $('panel-cons-projects').hidden === true && CONS_PROJECTS_OPEN === false;
        // Leaving the consolidated layout leaves it closed.
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects');
        res.tabsClosed = $('panel-cons-projects').hidden === true && document.body.classList.contains('consolidated') === false;
        document.documentElement.setAttribute('data-layout', 'consolidated');
        res.err = null;
      } catch (e) { res.err = String(e && e.stack || e); }
      return res;
    });
    const S2 = JSON.stringify(s2);
    const s0 = s2.err === null;
    ok(t + ' #4377 CONTROL: the list-state hint shows on the board before Projects is pressed', s0 && s2.noneBefore === true, S2);
    ok(t + ' #4377 Projects opens the full projects page in the column, Projects lit, still consolidated', s0 && s2.open === true, S2);
    ok(t + ' #4377 it holds every active project, and the rail keeps its own rows', s0 && s2.rows === 3 && s2.railRows === 3 && s2.railShown === true, S2);
    ok(t + ' #4377 it is the Projects grid (centred cards), while the rail rows stay left-aligned', s0 && s2.isGrid && s2.fullAlign === 'center' && s2.railAlign === 'left', S2);
    ok(t + ' #4377 the empty-board hint is off while it is open', s0 && s2.noneHidden === true, S2);
    ok(t + ' #4377 its sort drives the one sort, and the rail follows', s0 && s2.orderAz === 'Alpha,Beta,Gamma' && s2.orderZa === 'Gamma,Beta,Alpha' && s2.sortShared === true, S2);
    ok(t + ' #4377 a row click activates that project in the column (no nested view)', s0 && s2.clicked === true, S2);
    ok(t + ' #4377 an empty read shows the rail\'s own sentence, and rows come back', s0 && s2.emptySame === true && s2.backRows === true, S2);
    ok(t + ' #4377 the copied empty state adds no duplicate id and keeps its action', s0 && s2.oneEmptyId === true, S2);
    ok(t + ' #4377 no fold caret on a parent tile in the copy (the rail keeps its caret)', s0 && s2.caretCopy === 'none' && s2.caretRail !== 'none' && s2.caretRail !== 'absent', S2);
    ok(t + ' #4377 a child\'s parent chip is centred in the copy, left in the rail', s0 && s2.ancCopy === 'center' && s2.ancRail === 'flex-start', S2);
    ok(t + ' #4377 the copy\'s sort control has its dropdown chevron', s0 && s2.chevron === true, S2);
    ok(t + ' #4377 only one row says it is the current project', s0 && s2.oneCurrent === true, S2);
    ok(t + ' #4377 the poll\'s hint repaint keeps the hint off while it is open (CONTROL: it shows on the board)', s0 && s2.noneOnBoard === true && s2.noneAfterPoll === true, S2);
    ok(t + ' #4377 a failed projects read shows the rail\'s "cannot read" sentence there too', s0 && s2.failSame === true, S2);
    ok(t + ' #4377 Settings taking the column closes it, and the tab layout leaves it closed', s0 && s2.settingsClosed === true && s2.tabsClosed === true, S2);

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
