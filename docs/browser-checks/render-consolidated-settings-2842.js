'use strict';
// Browser-check-surface: userpop-settings openConsolidatedSettings placeAppSettings
// (#2518) the distinctive web/index.html tokens this check asserts: the settings button in
// the consolidated rail and the two functions that open/relocate the settings panel into the
// display column. A change to any of them must update this check at PR time.
/* #2842 (Josh, 0.6.57 review): opening user settings from the CONSOLIDATED view used to
 * kick the whole layout back to the tab view, because #rail-me-go clicked the Settings tab
 * and showTab drops body.consolidated for any tab that is not agents/projects. The fix opens
 * settings IN the display column (like View-All for tasks/files): #panel-settings is
 * relocated into #panel-projects, the agents column and projects list stay, and settings take
 * over the display area. This drives the SHIPPED showTab + the user menu's Settings link
 * handler (#userpop-settings, #3051; the person moved off the bottom-left rail into the
 * top-right user menu) + openConsolidatedSettings + pjView against a real fixture.
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
      // #3051: the person moved from the bottom-left rail (#rail-me-go, now retired in the
      // consolidated view) to the top-right user menu; its Settings link is the shipped entry
      // and calls the SAME openConsolidatedSettings in the consolidated view, so this check
      // now drives the real #userpop-settings handler.
      const userSet = document.getElementById('userpop-settings');
      const rect = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) }; };
      try {
        // Enter the consolidated view through the real path; showTab relocates settings.
        document.documentElement.setAttribute('data-layout', 'consolidated');
        PJ_CURRENT = 'k';
        showTab('projects');
        res.relocatedByShowTab = panelSettings.parentElement === panelProjects;
        res.hiddenBeforeOpen = panelSettings.hidden === true;
        // Open settings via the real #userpop-settings click handler (#3051 entry).
        userSet.click();
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
        // #3054: the panel carries a top + right inset so Your Profile is not slammed to the
        // top and the content box not to the right edge. Read computed padding on the panel.
        const csp = getComputedStyle(panelSettings);
        res.padTop = parseFloat(csp.paddingTop);
        res.padRight = parseFloat(csp.paddingRight);
        // #3505: the settings nav pills were flush against the projects-list vertical rule
        // (nav.left == list.right, zero gap) and stretched to fill the full nav column. Measure
        // the gap off the rule and the pill width against the nav's horizontal span to the content.
        const snavEl = document.getElementById('s-nav');
        const firstPill = document.querySelector('#s-nav button');
        const firstSec = document.querySelector('#panel-settings .dsec:not([hidden])');
        if (snavEl && firstPill && firstSec) {
          const nr = rect(snavEl); const fp = rect(firstPill); const sc = rect(firstSec);
          res.navGapPastList = nr.left - lv.right;   // #3505a: gap off the left vertical rule (was 0)
          res.pillWidth = fp.w;                      // #3505b: pill box width (was the full column)
          res.navToContentSpan = sc.left - nr.left;  // nav-left to content-left; pill should be well inside it
        }
        // Navigate to a project -> settings hides, project shows.
        pjView('one');
        res.settingsHiddenAfterNav = panelSettings.hidden === true;
        res.projectShownAfterNav = document.getElementById('pj-one-view').hidden === false;
        // Leave the consolidated view -> settings restored to the top level (tab-view home).
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('projects');
        res.restoredToTopLevel = panelSettings.parentElement !== panelProjects;
        // CONTROL: in the tab view #userpop-settings routes to the Settings panel and does NOT
        // enter the consolidated view (layoutConsolidated() is false, so openConsolidatedSettings
        // is never called -- it calls showTab('settings')). body.consolidated must be false after.
        userSet.click();
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
    // #3054: the panel has a top + right inset (padding), so the content is not slammed to
    // the top/right edge. Both must be > 0. This is compatible with the fill assertion above:
    // padding is inside the border-box, so settingsWidth (the border-box width) is unchanged.
    ok(t + ' #3054 the settings panel has a real top + right inset (Your Profile not slammed to the edge)', out.err === null && out.padTop >= 12 && out.padRight >= 12, JSON.stringify(out));
    // #3505 (Josh, 2026-09-23): the settings nav pills touched the projects-list vertical rule at a
    // zero gap. Assert a real gap now. Positive-controlled: pre-fix nav.left == list.right so the
    // gap was 0, which fails >= 12.
    ok(t + ' #3505 the settings nav sits off the left vertical rule (was flush at 0 gap)', out.err === null && out.navGapPastList >= 12, JSON.stringify(out));
    // #3505: the pills are sized to their longest label, not stretched to the full nav column.
    // Positive-controlled: pre-fix the pill filled the column (pillWidth ~= navToContentSpan minus
    // the column gap), which fails this "comfortably inside its span" bound.
    // #3598 made the nav column the pills' own width (max-content), so "a pill stretched to the
    // full column" and "a pill sized to its label" are now the same width and this arm can no
    // longer tell them apart. What it still guards is the pill stopping short of the content by a
    // real gap; the fixed-gap arm (#3598, below) is the sharper guard for the layout.
    ok(t + ' #3505/#3598 the settings pills stop short of the content by a real gap', out.err === null && out.pillWidth > 0 && out.pillWidth <= out.navToContentSpan - 16, JSON.stringify(out));
    ok(t + ' #2842 navigating to a project hides settings and shows the project', out.err === null && out.settingsHiddenAfterNav === true && out.projectShownAfterNav === true, JSON.stringify(out));
    ok(t + ' #2842 leaving the consolidated view restores settings to the top level', out.err === null && out.restoredToTopLevel === true, JSON.stringify(out));
    ok(t + ' #2842 CONTROL: in the tab view #rail-me-go does not enter the consolidated view', out.err === null && out.tabViewNotConsolidated === true, JSON.stringify(out));

    // ---- The LIST state: settings must not render over the #pj-none "nothing is open" hint.
    // The first evaluate hardcodes PJ_CURRENT='k' (PJ_VIEW='one'); this covers PJ_VIEW='list'
    // with projects present but none open -- the state where paintPjNone shows the hint
    // ("Open or create a project to get started.", #3597). #pj-none is a #panel-projects display-column
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
        document.getElementById('userpop-settings').click();
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

    // ---- Reachable from the AGENTS tab too (the user menu is in the header in every
    // consolidated view, and cons includes tab==='agents'). Opening settings there must
    // behave the same. ----
    const agentsTab = await page.evaluate(() => {
      const res = {};
      const settings = document.getElementById('panel-settings');
      try {
        PROJECTS = [{ id: 'k', name: 'Kosmos', parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 }];
        PJ_SORT = 'az'; PJ_CURRENT = null;
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('agents');                                 // consolidated agents tab
        res.consolidatedOnAgents = document.body.classList.contains('consolidated');
        document.getElementById('userpop-settings').click();
        res.stillConsolidated = document.body.classList.contains('consolidated');
        res.settingsOpen = settings.hidden === false && settings.parentElement === document.getElementById('panel-projects');
        res.err = null;
      } catch (e) { res.err = String(e && e.message || e); }
      return res;
    });
    ok(t + ' #2842 settings opens from the Agents tab too, staying consolidated', agentsTab.err === null && agentsTab.consolidatedOnAgents === true && agentsTab.stillConsolidated === true && agentsTab.settingsOpen === true, JSON.stringify(agentsTab));

    // ---- #3598 / #3599 (Josh, 0.6.91 QA), measured on the settings just opened above. ----
    // #3598 (1): the pill-to-content gap is FIXED, not a share of the window. Measured at a
    // narrow and a very wide window; the old minmax(120px, 30%) column gave 142px vs 337px.
    const gapAt = async (width) => {
      await page.setViewportSize({ width, height: 900 });
      return page.evaluate(() => {
        document.querySelector('#s-nav button[data-go="you"]').click();
        const nav = document.getElementById('s-nav').getBoundingClientRect();
        const box = document.querySelector('#s-sec-you > *').getBoundingClientRect();
        return Math.round(box.left - nav.right);
      });
    };
    const gapNarrow = await gapAt(1200);
    const gapWide = await gapAt(2400);
    ok(t + ' #3598 the pill nav to content gap is a fixed small margin at any width', gapNarrow === gapWide && gapNarrow > 0 && gapNarrow <= 32, JSON.stringify({ gapNarrow, gapWide }));
    // #3598 (2): the five sections Josh named sat ON the header rule. They are the tall ones:
    // opening one scrolls it into view inside #panel-settings, and that scroll went past the
    // panel's top padding. The fixture's panel grows with its content, so it is given a fixed
    // height here to make it the scroll container a person's board has, and each section is
    // made to overflow; then the same scrollIntoView runs and the box's inset is measured. The
    // CONTROL runs it with scroll-margin-top switched off, where the box must land on the edge.
    const tops = await page.evaluate(() => {
      const panel = document.getElementById('panel-settings');
      const oldH = panel.style.height;
      panel.style.height = '320px';
      const measure = (sec, noMargin) => {
        document.querySelector('#s-nav button[data-go="' + sec + '"]').click();
        const el = document.getElementById('s-sec-' + sec);
        const spacer = document.createElement('div'); spacer.style.height = '2000px'; el.appendChild(spacer);
        if (noMargin) el.style.scrollMarginTop = '0px';
        panel.scrollTop = 0; el.scrollIntoView({ block: 'start' });
        const box = [...el.children].find((k) => k.offsetParent !== null);
        const r = { inset: Math.round(box.getBoundingClientRect().top - panel.getBoundingClientRect().top), scrolled: panel.scrollTop };
        spacer.remove(); el.style.scrollMarginTop = ''; panel.scrollTop = 0;
        return r;
      };
      const out = {};
      for (const sec of ['accounts', 'connect', 'mac', 'automation', 'usage']) out[sec] = measure(sec, false);
      out.control = measure('accounts', true);
      panel.style.height = oldH;
      return out;
    });
    const named = ['accounts', 'connect', 'mac', 'automation', 'usage'].map((k) => tops[k]);
    // With the fix the box already sits at the panel's inset, so the scroll has nothing to do
    // (scrollTop stays 0); the CONTROL below proves this panel really scrolls when it would not.
    ok(t + ' #3598 Models, Connections, This computer, Automation and Token Usage keep a top inset when scrolled into view', named.every((v) => v.inset >= 16), JSON.stringify(tops));
    ok(t + ' #3598 CONTROL: with scroll-margin-top off the same scroll lands the box on the edge (the arm can see the bug)', tops.control.scrolled > 0 && tops.control.inset < 8, JSON.stringify(tops.control));
    await page.setViewportSize({ width: 1280, height: 900 });
    // #3599: Kosmos+ opened in the consolidated view takes the same blue ground as the tab view
    // (body.plus-active), and gives it back the moment another section is chosen.
    const plus = await page.evaluate(() => {
      const blue = () => document.body.classList.contains('plus-active');
      const toPlus = () => { openConsolidatedSettings(); document.querySelector('#s-nav button[data-go="plus"]').click(); };
      toPlus();
      const on = blue();
      const bg = /gradient/.test(getComputedStyle(document.body).backgroundImage);
      const tickSees = typeof plusOnScreen === 'function' && plusOnScreen();   // the #743 status tick reads the same predicate
      // Re-opening Settings while already on Kosmos+ must not tear the canvases down and
      // remount them (the wordmark's intro would replay for nothing). Count teardowns.
      let teardowns = 0; const realTeardown = window.plusTeardown;
      window.plusTeardown = function () { teardowns += 1; return realTeardown.apply(this, arguments); };
      openConsolidatedSettings();
      window.plusTeardown = realTeardown;
      const reopenTeardowns = teardowns;
      document.querySelector('#s-nav button[data-go="you"]').click();
      const offOnSection = !blue();
      toPlus(); pjView('one');                          // project navigation leaves Settings
      const offOnProject = !blue();
      toPlus(); openConsolidatedCreate();               // New Agent takes over the column
      const offOnCreate = !blue();
      pjView('list');
      return { on, bg, tickSees, reopenTeardowns, offOnSection, offOnProject, offOnCreate };
    });
    ok(t + ' #3599 Kosmos+ in the consolidated view is on the blue ground, and the status tick sees it on screen', plus.on === true && plus.bg === true && plus.tickSees === true, JSON.stringify(plus));
    ok(t + ' #3599 the blue leaves with it: another section, opening a project, or New Agent', plus.offOnSection === true && plus.offOnProject === true && plus.offOnCreate === true, JSON.stringify(plus));
    ok(t + ' #3599 re-opening Settings while on Kosmos+ keeps the canvases (no teardown)', plus.reopenTeardowns === 0, JSON.stringify(plus));
    // #3597: with nothing open the centre says "Open or create a project to get started." centred
    // both ways in the display column (it sat top-left).
    const none = await page.evaluate(() => {
      // The fixture's /api/projects read fails over file://; a person's board has read its list.
      PJ_READ_FAILED = false; PJ_LOADED_ONCE = true;
      PJ_CURRENT = null; pjView('list'); pjMarkOpen(null);
      const el = document.getElementById('pj-none');
      if (!el || el.hidden) return { shown: false };
      const r = el.getBoundingClientRect();
      const list = document.getElementById('pj-list-view').getBoundingClientRect();
      const col = document.getElementById('panel-projects').getBoundingClientRect();
      const colLeft = list.right;
      return { shown: true, text: el.textContent, align: getComputedStyle(el).textAlign,
        dx: Math.round((r.left + r.width / 2) - (colLeft + (col.right - colLeft) / 2)),
        dy: Math.round((r.top + r.height / 2) - (col.top + col.height / 2)) };
    });
    ok(t + ' #3597 the empty centre reads "Open or create a project to get started." centred both ways', none.shown === true && none.text === 'Open or create a project to get started.' && none.align === 'center' && Math.abs(none.dx) <= 4 && Math.abs(none.dy) <= 4, JSON.stringify(none));

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
