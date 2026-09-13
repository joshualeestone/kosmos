'use strict';
// Browser-check-surface: pjtreefold pj-fold-hidden
// (#2929) the distinctive web/index.html tokens this check asserts (the
// consolidated tree's fold caret + the folded-descendant hide class); a rename of
// either must update this check at PR time.
/* #2929 (Josh, 6.59 QA): the CONSOLIDATED projects rail reads as an openable file
 * structure -- each row indented by its tree depth, a fold caret on any parent, and
 * a folded branch's descendants hidden -- while the wide tab list and the grid
 * (the SAME #pj-list markup) are untouched. Drives the SHIPPED paintProjects /
 * projectCard / applyConsFold / pjTreeToggleFold + the #pj-list click and keydown
 * delegates against a real fixture PROJECTS tree in the real page, not a copy.
 * Controls that can return the dangerous answer: before folding, descendants are
 * visible (the fold assertion is not vacuous); a leaf gets NO caret; and in the tab
 * view the caret is hidden and a fold hides nothing (the change is consolidated-only,
 * so the shared markup the tab list reuses is never reshaped). Both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-cons-tree-2929.js
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
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    // Stop the 5s poll (it fetches at file:// and cannot load); ignore only the
    // harness's own file:// fetch noise so a genuine console error from the code
    // under test still surfaces (a syntax slip in the edits would land here).
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    // ---- Layer 1: the consolidated tree renders (indent + caret + aria) ----
    const tree = await page.evaluate(() => {
      const mk = (id, name, parent, parentName) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      // k (top) > app (subproject) > mob (third level); site a top-level leaf;
      // orph a child whose parent id is dangling (falls back to depth 0).
      PROJECTS = [mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos'), mk('mob', 'Mobile', 'app', 'App'), mk('site', 'Site'), mk('orph', 'Orphan', 'gone', 'Gone')];
      PJ_SORT = 'az';
      PJ_TREE_FOLDED.clear();
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.getElementById('panel-projects').hidden = false;
      document.getElementById('pj-list').classList.remove('asgrid');
      document.documentElement.setAttribute('data-layout', 'consolidated');
      document.body.classList.add('consolidated');
      paintProjects();
      const rowOf = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const info = (id) => {
        const r = rowOf(id);
        const caret = r.querySelector('.pjtreefold');
        const chip = r.querySelector('.pj-parent');
        return {
          padLeft: getComputedStyle(r).paddingLeft,
          hasCaret: !!caret,
          caretDisplay: caret ? getComputedStyle(caret).display : 'none',
          ariaExpanded: r.getAttribute('aria-expanded'),
          childClass: r.classList.contains('child'),
          chipDisplay: chip ? getComputedStyle(chip).display : 'none',
        };
      };
      return { k: info('k'), app: info('app'), mob: info('mob'), site: info('site'), orph: info('orph') };
    });
    // Indent grows with depth (computed, so a calc() typo in the padding rule reds):
    // 24px + depth*14px -> k 24, app 38, mob 52.
    ok(t + ' indent depth0 = 24px', tree.k.padLeft === '24px', tree.k.padLeft);
    ok(t + ' indent depth1 = 38px', tree.app.padLeft === '38px', tree.app.padLeft);
    ok(t + ' indent depth2 = 52px', tree.mob.padLeft === '52px', tree.mob.padLeft);
    // CONTROL: depth is real, not flat -- the three indents differ.
    ok(t + ' CONTROL indent varies with depth', new Set([tree.k.padLeft, tree.app.padLeft, tree.mob.padLeft]).size === 3, JSON.stringify([tree.k.padLeft, tree.app.padLeft, tree.mob.padLeft]));
    // A parent shows a displayed fold caret; a leaf shows none.
    ok(t + ' parent k has a displayed caret', tree.k.hasCaret && tree.k.caretDisplay !== 'none', JSON.stringify(tree.k));
    ok(t + ' parent app has a displayed caret', tree.app.hasCaret && tree.app.caretDisplay !== 'none', JSON.stringify(tree.app));
    ok(t + ' leaf mob has NO caret', !tree.mob.hasCaret, JSON.stringify(tree.mob));
    ok(t + ' leaf site has NO caret', !tree.site.hasCaret, JSON.stringify(tree.site));
    // aria-expanded is on parent rows (foldable) and only there.
    ok(t + ' parent k carries aria-expanded=true', tree.k.ariaExpanded === 'true', tree.k.ariaExpanded);
    ok(t + ' parent app carries aria-expanded=true', tree.app.ariaExpanded === 'true', tree.app.ariaExpanded);
    ok(t + ' leaf mob has no aria-expanded', tree.mob.ariaExpanded === null, String(tree.mob.ariaExpanded));
    // The indent now carries the relationship, so a nested child (.child) drops its
    // chip; a dangling-parent child at depth 0 keeps its chip (nothing else shows it).
    ok(t + ' nested child app is .child with chip hidden', tree.app.childClass && tree.app.chipDisplay === 'none', JSON.stringify(tree.app));
    ok(t + ' dangling-parent child keeps its chip', tree.orph.chipDisplay !== 'none', JSON.stringify(tree.orph));

    // ---- Layer 2: folding hides a whole branch; independent per parent ----
    const fold = await page.evaluate(() => {
      const rowOf = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const hidden = (id) => { const r = rowOf(id); return getComputedStyle(r).display === 'none' || r.classList.contains('pj-fold-hidden'); };
      const caretText = (id) => { const c = rowOf(id).querySelector('.pjtreefold'); return c ? c.textContent : ''; };
      const out = {};
      // BEFORE (control): everything visible.
      out.appVisibleBefore = !hidden('app');
      out.mobVisibleBefore = !hidden('mob');
      // Fold the top-level k: its whole subtree (app + mob) leaves the rail.
      pjTreeToggleFold('k');
      out.appHiddenAfterK = hidden('app');
      out.mobHiddenAfterK = hidden('mob');
      out.kCaretFolded = caretText('k');                 // expect ▸
      out.kAriaFolded = rowOf('k').getAttribute('aria-expanded');   // expect false
      // Unfold k: the branch returns.
      pjTreeToggleFold('k');
      out.appVisibleAfterUnfold = !hidden('app');
      out.kCaretOpen = caretText('k');                   // expect ▾
      // Fold only app (k open): just the third level (mob) hides; app itself stays.
      pjTreeToggleFold('app');
      out.appVisibleWhenOnlyAppFolded = !hidden('app');
      out.mobHiddenWhenOnlyAppFolded = hidden('mob');
      out.kVisibleWhenOnlyAppFolded = !hidden('k');
      pjTreeToggleFold('app');
      out.mobVisibleAfterAllUnfold = !hidden('mob');
      return out;
    });
    ok(t + ' CONTROL branch visible before folding', fold.appVisibleBefore && fold.mobVisibleBefore, JSON.stringify(fold));
    ok(t + ' folding k hides its whole subtree (app + mob)', fold.appHiddenAfterK && fold.mobHiddenAfterK, JSON.stringify(fold));
    ok(t + ' folded k shows the ▸ caret and aria-expanded=false', fold.kCaretFolded === '▸' && fold.kAriaFolded === 'false', JSON.stringify(fold));
    ok(t + ' unfolding k restores the branch and the ▾ caret', fold.appVisibleAfterUnfold && fold.kCaretOpen === '▾', JSON.stringify(fold));
    ok(t + ' folding app (k open) hides only the third level, app stays', fold.appVisibleWhenOnlyAppFolded && fold.mobHiddenWhenOnlyAppFolded && fold.kVisibleWhenOnlyAppFolded, JSON.stringify(fold));
    ok(t + ' unfolding restores every row', fold.mobVisibleAfterAllUnfold, JSON.stringify(fold));

    // ---- Layer 3: keyboard fold (ARIA tree convention: Right/Left) ----
    const kbd = await page.evaluate(() => {
      const rowOf = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const hidden = (id) => rowOf(id).classList.contains('pj-fold-hidden') || getComputedStyle(rowOf(id)).display === 'none';
      const out = {};
      PJ_TREE_FOLDED.clear(); paintProjects();
      const k = rowOf('k');
      // ArrowLeft on an OPEN parent collapses it.
      k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      out.foldedAfterLeft = hidden('app') && k.getAttribute('aria-expanded') === 'false';
      // ArrowRight on a COLLAPSED parent expands it.
      k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      out.openAfterRight = !hidden('app') && k.getAttribute('aria-expanded') === 'true';
      // CONTROL: ArrowRight on an already-open parent is a no-op (no double toggle).
      k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      out.stillOpenAfterRedundantRight = !hidden('app') && k.getAttribute('aria-expanded') === 'true';
      return out;
    });
    ok(t + ' keyboard: ArrowLeft collapses an open parent', kbd.foldedAfterLeft, JSON.stringify(kbd));
    ok(t + ' keyboard: ArrowRight expands a collapsed parent', kbd.openAfterRight, JSON.stringify(kbd));
    ok(t + ' keyboard CONTROL: ArrowRight on an open parent is a no-op', kbd.stillOpenAfterRedundantRight, JSON.stringify(kbd));

    // ---- Layer 4: the change is CONSOLIDATED-ONLY (the shared markup is safe) ----
    // The tab list reuses the SAME #pj-list rows. Fold a branch, switch to the tab
    // layout, and prove: the caret is hidden AND no row is hidden by the fold. If
    // this fails, a consolidated fold would silently reshape the wide list, whose
    // rows have no reachable disclosure to bring them back.
    const tabCtl = await page.evaluate(() => {
      const rowOf = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      PJ_TREE_FOLDED.clear(); PJ_TREE_FOLDED.add('k');   // k folded from the rail
      document.documentElement.setAttribute('data-layout', 'tabs');
      document.body.classList.remove('consolidated');
      document.getElementById('pj-list').classList.remove('asgrid');   // the wide LIST sub-view
      paintProjects();
      const app = rowOf('app');
      const caret = rowOf('k').querySelector('.pjtreefold');
      const out = {
        caretHiddenInTab: caret ? getComputedStyle(caret).display === 'none' : true,
        appVisibleInTab: getComputedStyle(app).display !== 'none' && !app.classList.contains('pj-fold-hidden'),
        kAriaDroppedInTab: rowOf('k').getAttribute('aria-expanded') === null,
      };
      // restore for the next theme iteration
      PJ_TREE_FOLDED.clear();
      document.body.classList.remove('consolidated');
      return out;
    });
    ok(t + ' tab CONTROL: the fold caret is hidden outside the rail', tabCtl.caretHiddenInTab, JSON.stringify(tabCtl));
    ok(t + ' tab CONTROL: a consolidated fold hides nothing in the wide list', tabCtl.appVisibleInTab, JSON.stringify(tabCtl));
    ok(t + ' tab CONTROL: aria-expanded is dropped outside the rail', tabCtl.kAriaDroppedInTab, JSON.stringify(tabCtl));

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
