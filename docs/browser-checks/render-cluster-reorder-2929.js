'use strict';
// Browser-check-surface: pj-dragging pj-drop-before pj-drop-after
// (#2929 slice 2) the distinctive web/index.html tokens this check asserts: the class
// on the cluster being dragged, and (#3127) the placement-line classes set on the row
// under the pointer during a reorder drag; a rename must update this check at PR time.
// The drag reorder itself is keyed on data-project + --pj-depth, which render-cons-tree-2929
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

    // ---- Lower-half drop (the +1 "insert after" branch, the plan's flagged risk) + a
    // self-drop no-op. Resets to the sorted order first so these arms stand alone. ----
    const lower = await page.evaluate(() => {
      PJ_ORDER = null;
      try { localStorage.removeItem('kosmos.order.projects'); } catch { /* ignore */ }
      PJ_SORT = 'az';
      paintProjects();
      const row = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const topIds = () => Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
      const drag = (fromId, toId, half) => {
        const from = row(fromId); const to = row(toId);
        const dt = new DataTransfer();
        const rect = to.getBoundingClientRect();
        const y = half === 'lower' ? rect.bottom - 2 : rect.top + 2;
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 4, clientY: y }));
        fire(from, 'dragstart'); fire(to, 'dragover'); fire(to, 'drop'); fire(from, 'dragend');
      };
      drag('a', 'a', 'upper');           // self-drop => guarded no-op
      const afterSelf = topIds();
      let selfSaved = null; try { selfSaved = localStorage.getItem('kosmos.order.projects'); } catch { selfSaved = 'ERR'; }
      drag('a', 'c', 'lower');           // a onto c's LOWER half => a goes AFTER c => b,c,a
      return { afterSelf, selfSaved, afterLower: topIds() };
    });
    ok(`${t} self-drop is a no-op (order stays a,b,c)`, JSON.stringify(lower.afterSelf) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(lower.afterSelf));
    ok(`${t} self-drop sets no manual order`, lower.selfSaved === null, String(lower.selfSaved));
    ok(`${t} lower-half drop inserts AFTER the target (a onto c's lower half => b,c,a; exercises the +1 branch and drag-to-last)`, JSON.stringify(lower.afterLower) === JSON.stringify(['b', 'c', 'a']), JSON.stringify(lower.afterLower));

    // ---- Cancelled drag + stranded-flag self-heal: the repaint guard must never freeze
    // the list. draggingDuring=true is the non-vacuous control (the guard IS engaged). ----
    const cancel = await page.evaluate(() => {
      PJ_ORDER = null;
      try { localStorage.removeItem('kosmos.order.projects'); } catch { /* ignore */ }
      PJ_SORT = 'az';
      if (typeof PJ_DRAGGING !== 'undefined') PJ_DRAGGING = false;
      paintProjects();
      const list = document.getElementById('pj-list');
      const rowA = list.querySelector('.pj-row[data-project="a"]');
      const dt = new DataTransfer();
      rowA.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const draggingDuring = (typeof PJ_DRAGGING !== 'undefined') ? PJ_DRAGGING : 'undef';
      rowA.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));   // no drop
      const draggingAfter = (typeof PJ_DRAGGING !== 'undefined') ? PJ_DRAGGING : 'undef';
      const classCleared = !list.querySelector('.pj-dragging');
      let stranded = 'n/a';
      if (typeof PJ_DRAGGING !== 'undefined') {
        PJ_DRAGGING = true;   // simulate a flag stranded by a detach (no .pj-dragging row present)
        paintProjects();      // the self-heal at the top of paintProjects must clear it
        stranded = PJ_DRAGGING;
      }
      return { draggingDuring, draggingAfter, classCleared, stranded };
    });
    ok(`${t} PJ_DRAGGING is set true during a drag (the repaint guard engages)`, cancel.draggingDuring === true, String(cancel.draggingDuring));
    ok(`${t} a cancelled drag (dragend, no drop) clears PJ_DRAGGING`, cancel.draggingAfter === false, String(cancel.draggingAfter));
    ok(`${t} a cancelled drag removes the .pj-dragging class`, cancel.classCleared === true, String(cancel.classCleared));
    ok(`${t} paintProjects self-heals a stranded PJ_DRAGGING flag (never freezes the list)`, cancel.stranded === false, String(cancel.stranded));

    // ---- Control: choosing a SORT clears an ACTIVE manual order (mutually exclusive) ----
    const sortReverts = await page.evaluate(() => {
      // Activate a manual order FIRST (PJ_ORDER + localStorage set, control -> 'custom'), so this
      // genuinely tests that a sort choice CLEARS it -- not a vacuous pass against an already-null
      // order. Without this, deleting pjClearOrder() from the change handler would still pass.
      pjSaveOrder(['c', 'a', 'b']);
      paintProjects();
      const sel = document.getElementById('pj-sort');
      let savedBefore = null;
      try { savedBefore = localStorage.getItem('kosmos.order.projects'); } catch { savedBefore = 'ERR'; }
      const before = { selValue: sel.value, saved: savedBefore };
      sel.value = 'az';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const topIds = Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
      let saved = null;
      try { saved = localStorage.getItem('kosmos.order.projects'); } catch { saved = 'ERR'; }
      return { before, topIds, saved, selValue: sel.value };
    });
    ok(`${t} precondition: a manual order is active before the sort pick (control 'custom', localStorage set)`, sortReverts.before.selValue === 'custom' && sortReverts.before.saved !== null && sortReverts.before.saved !== 'ERR', JSON.stringify(sortReverts.before));
    ok(`${t} choosing a sort CLEARS the active manual order (localStorage removed)`, sortReverts.saved === null, String(sortReverts.saved));
    ok(`${t} the sort control shows the chosen sort after clearing`, sortReverts.selValue === 'az', sortReverts.selValue);
    ok(`${t} choosing a sort reverts to the sorted a,b,c`, JSON.stringify(sortReverts.topIds) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(sortReverts.topIds));

    // ---- Scoping: the manual order is IGNORED in the tab (non-consolidated) view ----
    const tabIgnores = await page.evaluate(() => {
      PJ_ORDER = ['c', 'a', 'b'];                 // a manual order is set...
      document.body.classList.remove('consolidated');   // ...but the tab view is showing
      document.documentElement.setAttribute('data-layout', 'tabs');
      paintProjects();
      const topIds = Array.from(document.querySelectorAll('#pj-list .pj-row[data-project]'))
        .filter((r) => (Number(r.style.getPropertyValue('--pj-depth')) || 0) === 0)
        .map((r) => r.dataset.project);
      return { topIds, selValue: document.getElementById('pj-sort').value };
    });
    ok(`${t} tab view IGNORES the manual order (keeps sorted a,b,c)`, JSON.stringify(tabIgnores.topIds) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(tabIgnores.topIds));
    // Both gates read the single pjManualOrderActive() predicate: outside consolidated not
    // only the rows ignore PJ_ORDER, the sort control also shows the named sort (not 'custom').
    // Pins the two gates equal, so a drift where one honors the manual order and the other
    // does not (repo convention #5, the screen contradicting itself) is caught.
    ok(`${t} tab view sort control shows the sort, not 'custom' (both gates agree)`, tabIgnores.selValue === 'az', tabIgnores.selValue);

    // ---- #3127: the placement LINE during dragover -- above the target (upper half,
    // pj-drop-before) or below it (lower half, pj-drop-after), the same split the drop
    // uses; it clears when the pointer moves to another row, shows nothing over the
    // dragged row itself, and is gone after the drop/dragend repaint. Asserts the class
    // (the mechanism); the line's pixels are the CSS pseudo-element, Josh's in-app review. ----
    const dropLine = await page.evaluate(() => {
      PJ_ORDER = null;
      try { localStorage.removeItem('kosmos.order.projects'); } catch { /* ignore */ }
      PJ_SORT = 'az';
      // Re-enter the consolidated view (the tab-scoping arm above left the tab layout);
      // the reorder drag + its line are consolidated-only.
      document.documentElement.setAttribute('data-layout', 'consolidated');
      document.body.classList.add('consolidated');
      paintProjects();
      const row = (id) => document.querySelector('#pj-list .pj-row[data-project="' + id + '"]');
      const cls = (id) => { const r = row(id); return { before: r.classList.contains('pj-drop-before'), after: r.classList.contains('pj-drop-after') }; };
      const anyLine = () => document.querySelectorAll('#pj-list .pj-drop-before, #pj-list .pj-drop-after').length;
      const dt = new DataTransfer();
      const from = row('c');
      const fire = (el, type, y, x) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x || 0, clientY: y || 0 }));
      fire(from, 'dragstart', 0, 0);
      const ra = row('a').getBoundingClientRect();
      fire(row('a'), 'dragover', ra.top + 2, ra.left + 4);          // upper half of Alpha => line ABOVE Alpha
      const upper = cls('a');
      const rb = row('b').getBoundingClientRect();
      fire(row('b'), 'dragover', rb.bottom - 2, rb.left + 4);       // lower half of Bravo => line BELOW Bravo
      const lower = cls('b');
      const aClearedOnMove = cls('a');                              // Alpha's line cleared when we moved to Bravo
      const rc = row('c').getBoundingClientRect();
      fire(row('c'), 'dragover', rc.top + 2, rc.left + 4);          // over the dragged row itself => no line
      const overSelf = anyLine();
      fire(row('b'), 'dragover', rb.bottom - 2, rb.left + 4);
      fire(row('b'), 'drop', rb.bottom - 2, rb.left + 4);
      fire(from, 'dragend', rb.bottom - 2, rb.left + 4);
      const afterDrop = anyLine();
      return { upper, lower, aClearedOnMove, overSelf, afterDrop };
    });
    ok(`${t} #3127 dragover upper half sets the line ABOVE the target (pj-drop-before)`, dropLine.upper.before === true && dropLine.upper.after === false, JSON.stringify(dropLine.upper));
    ok(`${t} #3127 dragover lower half sets the line BELOW the target (pj-drop-after)`, dropLine.lower.after === true && dropLine.lower.before === false, JSON.stringify(dropLine.lower));
    ok(`${t} #3127 moving to another row clears the previous target's line`, dropLine.aClearedOnMove.before === false && dropLine.aClearedOnMove.after === false, JSON.stringify(dropLine.aClearedOnMove));
    ok(`${t} #3127 dragover the dragged row itself shows NO line`, dropLine.overSelf === 0, String(dropLine.overSelf));
    ok(`${t} #3127 the line is gone after drop + dragend`, dropLine.afterDrop === 0, String(dropLine.afterDrop));

    await page.close();
  }
  await browser.close();

  console.log('=== problems ===');
  console.log(problems.length ? problems.join('\n') : 'none');
  console.log(`\n${pass} checks passed, ${problems.length} problem(s)`);
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
