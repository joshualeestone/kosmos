'use strict';
// Browser-check-surface: pj-dragging
// (#2929 slice 2) the distinctive web/index.html token this check asserts (the class
// on the cluster being dragged); a rename must update this check at PR time. The drag
// reorder itself is keyed on data-project + --pj-depth, which render-cons-tree-2929
// already declares as its surfaces.
/* #2929 slice 2 (Josh, 6.59 QA: "let's also make them draggable ... drag it up to the
 * very top"): a whole top-level project CLUSTER can be dragged to reorder it in the
 * CONSOLIDATED view. Drives the SHIPPED paintProjects / pjTreeRows / wirePjClusterDrag
 * against a real fixture PROJECTS tree in the real page, by dispatching HTML5 DragEvents
 * with a shared DataTransfer (Playwright's mouse-drag does not fire native drag events).
 *
 * Controls that can return the dangerous answer, so no arm is vacuous:
 *   - the pre-drag top-level order is the SORTED order and DIFFERS from the post-drag
 *     order (the reorder assertion is meaningful);
 *   - the dragged cluster's SUBPROJECT moves with it and stays under its parent (only
 *     top-level clusters reorder);
 *   - choosing a SORT clears the manual order and reverts (mutually exclusive, last wins);
 *   - in the TAB view (not consolidated) the same PJ_ORDER is IGNORED (scoped).
 * Both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-cluster-reorder-2929.js
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
    await page.addInitScript(() => { window.setInterval = () => 0; });   // stop the file:// poll
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    // ---- Set up a consolidated tree: 3 top-level clusters (a,b,c) + a1 under a ----
    const before = await page.evaluate(() => {
      const mk = (id, name, parent, parentName) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('a', 'Alpha'), mk('a1', 'Alpha Sub', 'a', 'Alpha'), mk('b', 'Bravo'), mk('c', 'Charlie')];
      PJ_SORT = 'az';
      PJ_TREE_FOLDED.clear();
      PJ_ORDER = null;
      try { localStorage.removeItem('kosmos.order.projects'); } catch { /* ignore */ }
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.getElementById('panel-projects').hidden = false;
      document.getElementById('pj-list').classList.remove('asgrid');
      document.documentElement.setAttribute('data-layout', 'consolidated');
      document.body.classList.add('consolidated');
      paintProjects();
      const topIds = () => Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
      const rowOrder = () => Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]')).map((r) => r.dataset.project);
      return { topIds: topIds(), rowOrder: rowOrder(), aDraggable: document.querySelector('#pj-list .pj-row[data-project="a"]').draggable, a1Draggable: document.querySelector('#pj-list .pj-row[data-project="a1"]').draggable };
    });
    // Pre-drag: sorted top-level order is a,b,c; a1 sits under a; only top-level is draggable.
    ok(`${t} pre-drag top order is the sorted a,b,c`, JSON.stringify(before.topIds) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(before.topIds));
    ok(`${t} a1 renders under a (a,a1,b,c)`, JSON.stringify(before.rowOrder) === JSON.stringify(['a', 'a1', 'b', 'c']), JSON.stringify(before.rowOrder));
    ok(`${t} top-level row is draggable, subproject is NOT`, before.aDraggable === true && before.a1Draggable === false, `a=${before.aDraggable} a1=${before.a1Draggable}`);

    // ---- Drag Charlie (last) to the top (drop on Alpha's upper half) ----
    const after = await page.evaluate(() => {
      const row = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const from = row('c'); const to = row('a');
      const dt = new DataTransfer();
      const rect = to.getBoundingClientRect();
      const upperY = rect.top + 2;   // upper half => insert BEFORE the target
      const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 4, clientY: y }));
      fire(from, 'dragstart', rect.top);
      fire(to, 'dragover', upperY);
      fire(to, 'drop', upperY);
      fire(from, 'dragend', upperY);
      const topIds = () => Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
      const rowOrder = () => Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]')).map((r) => r.dataset.project);
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('kosmos.order.projects') || 'null'); } catch { saved = 'PARSE-ERR'; }
      return { topIds: topIds(), rowOrder: rowOrder(), saved, pjOrder: (typeof PJ_ORDER !== 'undefined' ? PJ_ORDER : 'undef'), selValue: document.getElementById('pj-sort').value };
    });
    // Charlie is now first; a1 still directly under Alpha (cluster moved as a unit).
    ok(`${t} after drag, top order is c,a,b`, JSON.stringify(after.topIds) === JSON.stringify(['c', 'a', 'b']), JSON.stringify(after.topIds));
    ok(`${t} a1 still under a after the reorder (c,a,a1,b)`, JSON.stringify(after.rowOrder) === JSON.stringify(['c', 'a', 'a1', 'b']), JSON.stringify(after.rowOrder));
    ok(`${t} the new order PERSISTED to localStorage`, JSON.stringify(after.saved) === JSON.stringify(['c', 'a', 'b']), JSON.stringify(after.saved));
    ok(`${t} PJ_ORDER in memory matches the drop`, JSON.stringify(after.pjOrder) === JSON.stringify(['c', 'a', 'b']), JSON.stringify(after.pjOrder));
    // The sort control honestly reflects the manual order (shows the disabled "Custom
    // order" option, not a stale named sort). This also verifies a disabled option is
    // settable via .value; if it were not, this reds and the reflection approach is wrong.
    ok(`${t} the sort control shows "custom" after a drag (not a stale named sort)`, after.selValue === 'custom', after.selValue);

    // ---- Control: choosing a SORT clears the manual order (mutually exclusive) ----
    const sortReverts = await page.evaluate(() => {
      const sel = document.getElementById('pj-sort');
      sel.value = 'az';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const topIds = () => Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
      let saved = null;
      try { saved = localStorage.getItem('kosmos.order.projects'); } catch { saved = 'ERR'; }
      return { topIds: topIds(), saved, pjOrder: (typeof PJ_ORDER !== 'undefined' ? PJ_ORDER : 'undef'), selValue: document.getElementById('pj-sort').value };
    });
    ok(`${t} choosing a sort CLEARS the manual order (localStorage removed)`, sortReverts.saved === null, String(sortReverts.saved));
    ok(`${t} the sort control shows the chosen sort again after clearing`, sortReverts.selValue === 'az', sortReverts.selValue);
    ok(`${t} choosing a sort reverts to the sorted a,b,c`, JSON.stringify(sortReverts.topIds) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(sortReverts.topIds));

    // ---- Scoping: the manual order is IGNORED in the tab (non-consolidated) view ----
    const tabIgnores = await page.evaluate(() => {
      PJ_ORDER = ['c', 'a', 'b'];                 // a manual order is set...
      document.body.classList.remove('consolidated');   // ...but the tab view is showing
      document.documentElement.setAttribute('data-layout', 'tabs');
      paintProjects();
      return Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
    });
    ok(`${t} tab view IGNORES the manual order (keeps sorted a,b,c)`, JSON.stringify(tabIgnores) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(tabIgnores));

    await page.close();
  }
  await browser.close();

  console.log('=== problems ===');
  console.log(problems.length ? problems.join('\n') : 'none');
  console.log(`\n${pass} checks passed, ${problems.length} problem(s)`);
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
