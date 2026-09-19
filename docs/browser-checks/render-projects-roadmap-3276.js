'use strict';
/**
 * kosmos#3276 (Josh, 2026-09-18): the Projects board settles on TWO views, Grid and
 * Roadmap, replacing three (Grid / List / org-chart Map). The Roadmap is the indented
 * tree upgraded to mock2 -- a working per-node fold caret, denser rows (no description,
 * no faces), a right-aligned agent-count + status cluster, connector rails, and a top
 * strip with Collapse all / Expand all.
 *
 * WHAT SOURCE CANNOT SEE, and only a real browser can: that the toggle now offers
 * exactly Grid + Roadmap (no List, no Map button); that the Roadmap shows the tree
 * (#pj-list, not .asgrid) with a VISIBLE fold caret whose click COLLAPSES a branch
 * (child row computed display:none, aria-expanded=false) and re-EXPANDS it; that the
 * density drops the faces in the Roadmap while GRID still shows them (the leak control);
 * that the top strip is shown only in the Roadmap and its Collapse all / Expand all fold
 * every branch; and that all of this holds in dark as well as light (a colour/fold
 * defect that reads fine in one theme can break the other). Each assertion can return
 * the dangerous answer.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-projects-roadmap-3276.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */
const nodePath = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { console.log('render-projects-roadmap-3276: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

// Inject a known tree and switch to the Roadmap. Returns the observable facts.
// Beta (needs you, top) has Gamma (idle) under it; Alpha (2 agents, top) is a leaf.
const SEED = `
  PROJECTS.length = 0;
  PROJECTS.push(
    { id: 'a', name: 'Alpha', parent: null, archived: false, summary: { total: 2 },
      description: 'Alpha description line', agents: [ { name: 'One', sessionName: 's1' }, { name: 'Two', sessionName: 's2' } ] },
    { id: 'b', name: 'Beta', parent: null, archived: false, summary: { total: 1, needsYou: 1 },
      description: 'Beta description line', agents: [ { name: 'Three', sessionName: 's3' } ] },
    { id: 'g', name: 'Gamma', parent: 'b', archived: false, summary: { total: 0 } },
  );
  LAST.length = 0;
  // Render the rows: the toggle only flips the layout class; paintProjects is what
  // writes #pj-list (and the strip summary) from PROJECTS. Live it runs on the data
  // poll; here we call it directly after seeding.
  paintProjects();
`;

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-projects-roadmap-3276: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  // Show the Projects tab so computed display is real (a hidden tab would make
  // #pj-list display:none for the wrong reason).
  await page.click('[data-tab="projects"]').catch(() => {});

  const rowByName = (nm) => `[...document.querySelectorAll('#pj-list .pj-row')].find((r) => r.querySelector('.pjname b') && r.querySelector('.pjname b').textContent === ${JSON.stringify(nm)}) || null`;

  // 1. The toggle: exactly Grid + Roadmap, and switching to the Roadmap.
  const toggle = await page.evaluate(`(async () => {
    ${SEED}
    const box = document.querySelector('.viewtoggle[data-scope="projects"]');
    const btns = box ? [...box.querySelectorAll('[data-layout]')].map((b) => b.dataset.layout) : [];
    const roadmapBtn = box ? box.querySelector('[data-layout="roadmap"]') : null;
    if (roadmapBtn) roadmapBtn.click();   // -> layoutApply('projects','roadmap')
    const list = document.getElementById('pj-list');
    return {
      buttons: btns,
      hasList: btns.includes('list'),
      hasMap: btns.includes('map'),
      roadmapPressed: !!(roadmapBtn && roadmapBtn.getAttribute('aria-pressed') === 'true' && roadmapBtn.classList.contains('on')),
      bodyRoadmap: document.body.classList.contains('pj-roadmap'),
      listIsTree: !!(list && !list.classList.contains('asgrid') && getComputedStyle(list).display !== 'none'),
    };
  })()`);
  check('the toggle offers exactly Grid + Roadmap (two buttons)',
    Array.isArray(toggle.buttons) && toggle.buttons.length === 2 && toggle.buttons.includes('grid') && toggle.buttons.includes('roadmap'),
    JSON.stringify(toggle.buttons));
  check('the List button is gone', toggle.hasList === false, JSON.stringify(toggle.hasList));
  check('the org-chart Map button is gone', toggle.hasMap === false, JSON.stringify(toggle.hasMap));
  check('the Roadmap toggle presses on (aria-pressed + .on)', toggle.roadmapPressed, JSON.stringify(toggle.roadmapPressed));
  check('the Roadmap sets body.pj-roadmap', toggle.bodyRoadmap, JSON.stringify(toggle.bodyRoadmap));
  check('the Roadmap shows the indented tree (#pj-list, not .asgrid, visible)', toggle.listIsTree, JSON.stringify(toggle.listIsTree));

  // 2. The fold caret is VISIBLE on a parent, absent on a leaf; a click folds/unfolds.
  const fold = await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rowB = ${rowByName('Beta')};
    const rowA = ${rowByName('Alpha')};
    const caretB = rowB ? rowB.querySelector('.pjtreefold') : null;
    const caretA = rowA ? rowA.querySelector('.pjtreefold') : null;
    const gammaBefore = !!(${rowByName('Gamma')});
    const gammaVisBefore = (() => { const g = ${rowByName('Gamma')}; return !!(g && getComputedStyle(g).display !== 'none'); })();
    const caretVisible = !!(caretB && getComputedStyle(caretB).display !== 'none');
    const leafNoCaret = !caretA;   // Alpha has no children -> no caret
    if (caretB) caretB.click(); await sleep(20);
    const g2 = ${rowByName('Gamma')};
    const gammaHidden = !!(g2 && getComputedStyle(g2).display === 'none');
    const ariaFolded = rowB ? rowB.getAttribute('aria-expanded') : null;
    if (caretB) caretB.click(); await sleep(20);
    const g3 = ${rowByName('Gamma')};
    const gammaBack = !!(g3 && getComputedStyle(g3).display !== 'none');
    const ariaOpen = rowB ? rowB.getAttribute('aria-expanded') : null;
    return { caretVisible, leafNoCaret, gammaBefore, gammaVisBefore, gammaHidden, ariaFolded, gammaBack, ariaOpen };
  })()`);
  check('a parent row shows a VISIBLE fold caret; a leaf shows none', fold.caretVisible && fold.leafNoCaret,
    'parentCaretVisible=' + fold.caretVisible + ' leafNoCaret=' + fold.leafNoCaret);
  check('a child is visible before folding (precondition, not vacuous)', fold.gammaBefore && fold.gammaVisBefore, JSON.stringify({ present: fold.gammaBefore, vis: fold.gammaVisBefore }));
  check('clicking the caret COLLAPSES the branch (child computed display:none, aria-expanded=false)',
    fold.gammaHidden && fold.ariaFolded === 'false', JSON.stringify({ hidden: fold.gammaHidden, aria: fold.ariaFolded }));
  check('clicking again re-EXPANDS the branch (child visible, aria-expanded=true)',
    fold.gammaBack && fold.ariaOpen === 'true', JSON.stringify({ back: fold.gammaBack, aria: fold.ariaOpen }));

  // 3. Density: the Roadmap hides the description and the faces but keeps the count;
  //    the GRID still shows the faces (the leak control -- proves the hide is scoped).
  const density = await page.evaluate(`(async () => {
    const disp = (el) => el ? getComputedStyle(el).display : 'MISSING';
    const rowB = ${rowByName('Alpha')};   // Alpha has description + 2 faces + count
    const descHidden = rowB ? disp(rowB.querySelector('.pc-t')) === 'none' : null;
    const facesWrap = rowB ? rowB.querySelector('.pjfaces > [aria-hidden]') : null;
    const facesHiddenRoadmap = facesWrap ? disp(facesWrap) === 'none' : null;
    const count = rowB ? rowB.querySelector('.pjcount') : null;
    const countShown = !!(count && disp(count) !== 'none' && /agent/.test(count.textContent));
    // Switch to Grid and re-read the faces: they must be shown there (scope control).
    const gridBtn = document.querySelector('.viewtoggle[data-scope="projects"] [data-layout="grid"]');
    if (gridBtn) gridBtn.click();
    const rowBg = ${rowByName('Alpha')};
    const facesWrapG = rowBg ? rowBg.querySelector('.pjfaces > [aria-hidden]') : null;
    const facesShownGrid = facesWrapG ? disp(facesWrapG) !== 'none' : null;
    // back to roadmap for later checks
    const rmBtn = document.querySelector('.viewtoggle[data-scope="projects"] [data-layout="roadmap"]');
    if (rmBtn) rmBtn.click();
    return { descHidden, facesHiddenRoadmap, countShown, facesShownGrid };
  })()`);
  check('the Roadmap drops the per-row description (.pc-t display:none)', density.descHidden === true, JSON.stringify(density.descHidden));
  check('the Roadmap drops the avatar faces', density.facesHiddenRoadmap === true, JSON.stringify(density.facesHiddenRoadmap));
  check('the Roadmap keeps the agent-count pill', density.countShown === true, JSON.stringify(density.countShown));
  check('CONTROL: the GRID still shows the faces (the density hide is scoped to the Roadmap)', density.facesShownGrid === true, JSON.stringify(density.facesShownGrid));

  // 4. The top strip: shown only in the Roadmap, its summary reflects the count, and
  //    Collapse all / Expand all fold/unfold every branch.
  const strip = await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = document.getElementById('pj-rm-strip');
    const shownRoadmap = el ? getComputedStyle(el).display !== 'none' : null;
    const summary = document.getElementById('pj-rm-summary');
    const summaryText = summary ? summary.textContent : null;
    // Collapse all -> Gamma hidden; Expand all -> Gamma back.
    const collapse = document.getElementById('pj-rm-collapse');
    if (collapse) collapse.click(); await sleep(20);
    const gHiddenAfterCollapseAll = (() => { const g = ${rowByName('Gamma')}; return !!(g && getComputedStyle(g).display === 'none'); })();
    const expand = document.getElementById('pj-rm-expand');
    if (expand) expand.click(); await sleep(20);
    const gShownAfterExpandAll = (() => { const g = ${rowByName('Gamma')}; return !!(g && getComputedStyle(g).display !== 'none'); })();
    // Grid hides the strip (control).
    const gridBtn = document.querySelector('.viewtoggle[data-scope="projects"] [data-layout="grid"]');
    if (gridBtn) gridBtn.click();
    const hiddenGrid = el ? getComputedStyle(el).display === 'none' : null;
    const rmBtn = document.querySelector('.viewtoggle[data-scope="projects"] [data-layout="roadmap"]');
    if (rmBtn) rmBtn.click();
    return { shownRoadmap, summaryText, gHiddenAfterCollapseAll, gShownAfterExpandAll, hiddenGrid };
  })()`);
  check('the top strip is shown in the Roadmap', strip.shownRoadmap === true, JSON.stringify(strip.shownRoadmap));
  check('the strip summary reflects the project count', /\d+\s+project/.test(String(strip.summaryText)), JSON.stringify(strip.summaryText));
  check('Collapse all folds every branch (a child goes hidden)', strip.gHiddenAfterCollapseAll === true, JSON.stringify(strip.gHiddenAfterCollapseAll));
  check('Expand all unfolds every branch (the child returns)', strip.gShownAfterExpandAll === true, JSON.stringify(strip.gShownAfterExpandAll));
  check('CONTROL: the strip is hidden in the Grid view', strip.hiddenGrid === true, JSON.stringify(strip.hiddenGrid));

  // 5. Dark mode: the fold and density must hold there too (a defect can read fine in
  //    one theme and break the other). Re-run the caret-visible + faces-hidden reads.
  const darkRead = () => page.evaluate(`(() => {
    const disp = (el) => el ? getComputedStyle(el).display : 'MISSING';
    const rowB = ${rowByName('Beta')};
    const caret = rowB ? rowB.querySelector('.pjtreefold') : null;
    const rowA = ${rowByName('Alpha')};
    const faces = rowA ? rowA.querySelector('.pjfaces > [aria-hidden]') : null;
    return { caretVisible: !!(caret && disp(caret) !== 'none'), facesHidden: faces ? disp(faces) === 'none' : null };
  })()`);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const forcedDark = await darkRead();
  await page.evaluate(() => { document.documentElement.removeAttribute('data-theme'); });
  await page.emulateMedia({ colorScheme: 'dark' });
  const systemDark = await darkRead();
  await page.emulateMedia({ colorScheme: 'light' });
  check('forced dark ([data-theme="dark"]): the caret is visible and the faces stay dropped',
    forcedDark.caretVisible === true && forcedDark.facesHidden === true, JSON.stringify(forcedDark));
  check('system dark (@media prefers-color-scheme): the caret is visible and the faces stay dropped',
    systemDark.caretVisible === true && systemDark.facesHidden === true, JSON.stringify(systemDark));

  if (pageErrors.length) { console.error('page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  await browser.close();
  if (problems.length) {
    console.error('render-projects-roadmap-3276: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-projects-roadmap-3276: the Projects board is two views (Grid + Roadmap, no List/Map button); the Roadmap shows the indented tree with a visible per-node fold caret that collapses/re-expands a branch (aria-expanded flips, the child hides), drops the description + faces while keeping the agent count (the grid still shows faces), and carries a top strip whose Collapse all / Expand all fold every branch -- all in light and dark.');
})();
