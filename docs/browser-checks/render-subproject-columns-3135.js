'use strict';
// Browser-check-surface: column-width column-gap break-before break-inside
// (#2518) the distinctive web/index.html tokens this check asserts: the
// multi-column FLOW of the hierarchical Projects LIST view and the break rules
// that keep a subtree together in one column. A change to them must update this
// check at PR time.
/* #3135 (Josh, 6.68): the hierarchical (subprojects) Projects-tab LIST view kept
 * every project HEADLINE at 100% width, so a long tree ran down the page one row
 * per line and half the projects fell off screen. The fix flows the list into
 * RESPONSIVE MULTIPLE COLUMNS (narrower cards, more per page) with the hierarchy
 * KEPT: multi-column so a child flows directly under its parent, and a column
 * break may fall only BEFORE a top-level row (break-before:avoid on .child) so a
 * top-level project plus its subtree stay together and no child is orphaned at a
 * column top with no parent above it.
 *
 * Drives the SHIPPED paintProjects / projectCard against a real fixture PROJECTS
 * tree in the real page (not a copy). Controls that return the DANGEROUS answer on
 * origin/main (a single flex column, headline at 100% width): the list is NOT
 * columnised there (column-width is 'auto'/'normal'), only one column is used at a
 * wide viewport, and the description sits on the SAME line as the name rather than
 * stacked under it. A narrow-viewport arm is the responsiveness control (one column
 * again), and the indent arm proves the fix did not flatten the tree.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-subproject-columns-3135.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

// A tree: many top-level projects (so a wide page uses several columns) plus one
// real subtree (parent k with children app + site) to exercise the break rules.
const FIXTURE = () => {
  const mk = (id, name, parent, parentName) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: false, archived: false, summary: {}, agents: [], description: 'A short line so the card has a description row.', unread: 0 });
  PROJECTS = [
    mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos'), mk('site', 'Site', 'k', 'Kosmos'),
    mk('p1', 'Ledger'), mk('p2', 'Reader'), mk('p3', 'Vault'), mk('p4', 'Forecast'),
    mk('p5', 'Relay'), mk('p6', 'Inbox'), mk('p7', 'Studio'), mk('p8', 'Almanac'),
    mk('p9', 'Beacon'), mk('p10', 'Cartograph'), mk('p11', 'Docket'), mk('p12', 'Ember'),
  ];
  PJ_SORT = 'az';
  const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
  document.getElementById('panel-projects').hidden = false;
  document.getElementById('pj-list').classList.remove('asgrid');   // the LIST sub-view
  document.body.classList.remove('consolidated');
  paintProjects();
};

// Distinct column x-origins among TOP-LEVEL rows (marginLeft 0, so their left IS
// the column start): the count is how many columns the multi-column flow used.
const readLayout = () => {
  const rows = Array.from(document.querySelectorAll('#pj-list .pj-row'));
  const list = document.getElementById('pj-list');
  const topLefts = new Set();
  for (const r of rows) {
    if (r.classList.contains('child')) continue;            // top-level only
    topLefts.add(Math.round(r.getBoundingClientRect().left));
  }
  const cs = getComputedStyle(list);
  return { rowCount: rows.length, columns: topLefts.size, listWidth: Math.round(list.getBoundingClientRect().width), columnWidth: cs.columnWidth, display: cs.display };
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const x = m.text();
    if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
    problems.push(`console: ${x}`);
  });
  await page.goto(PAGE);
  await page.evaluate(FIXTURE);

  // ---- Layer 1: a WIDE page flows the list into MULTIPLE columns ----
  const wide = await page.evaluate(readLayout);
  ok('the list is columnised, not a single flex column (column-width is set)', /px$/.test(wide.columnWidth) && wide.columnWidth !== 'auto' && wide.columnWidth !== 'normal', 'column-width=' + wide.columnWidth + ' display=' + wide.display);
  // The load-bearing arm: at 1600px the list is wide enough for several 20rem
  // columns, so the top-level rows spread across >= 2 column origins. On main this
  // is 1 (every headline at 100% width, one per line) -> the dangerous answer.
  ok('a wide page shows the projects in more than one column', wide.columns >= 2, JSON.stringify(wide));

  // ---- Layer 2: the subtree-cohesion mechanism is in place ----
  // A column break may fall only BEFORE a top-level row: children carry
  // break-before:avoid, so a subtree never splits across a column boundary and a
  // child is never orphaned at a column top with no parent. Assert the COMPUTED
  // break rules on a real child row and on any row (break-inside). Both are 'auto'
  // on origin/main (no such rule) -> non-vacuous.
  const breaks = await page.evaluate(() => {
    const child = document.querySelector('#pj-list .pj-row.child');
    const any = document.querySelector('#pj-list .pj-row');
    const cs = getComputedStyle(child);
    return { childBreakBefore: cs.breakBefore, rowBreakInside: getComputedStyle(any).breakInside, isChild: !!child };
  });
  ok('a child row carries break-before:avoid (keeps a subtree together in one column)', breaks.isChild && breaks.childBreakBefore === 'avoid', JSON.stringify(breaks));
  ok('a row carries break-inside:avoid (a single card never splits across columns)', breaks.rowBreakInside === 'avoid', JSON.stringify(breaks));

  // ---- Layer 3: each row is a COMPACT card, not a 100%-width row ----
  // The description stacks UNDER the name (grid-row 2), and the status pill stays
  // on the first line beside the name. On origin/main the description sits on the
  // SAME line as the name (grid-column 2, grid-row 1) -> the dangerous answer.
  const shape = await page.evaluate(() => {
    const row = document.querySelector('#pj-list .pj-row[data-project="p1"]');   // a top-level card with a description
    const name = row.querySelector('.pjname');
    const desc = row.querySelector('.pc-t');
    const pill = row.querySelector('.pjpill');
    const nb = name.getBoundingClientRect();
    const db = desc ? desc.getBoundingClientRect() : null;
    return {
      hasDesc: !!desc,
      descBelowName: !!db && db.top >= nb.bottom - 2,
      pillSameLineAsName: !!pill && Math.abs((pill.getBoundingClientRect().top + pill.getBoundingClientRect().height / 2) - (nb.top + nb.height / 2)) <= 10,
    };
  });
  ok('the description stacks under the name (a compact card, not a full-width row)', shape.hasDesc && shape.descBelowName, JSON.stringify(shape));

  // ---- Layer 4: the tree indent is UNCHANGED (the fix did not flatten hierarchy) ----
  const indent = await page.evaluate(() => {
    const app = document.querySelector('#pj-list .pj-row[data-project="app"]');   // depth 1 under k
    const k = document.querySelector('#pj-list .pj-row[data-project="k"]');
    return { appMargin: getComputedStyle(app).marginLeft, kMargin: getComputedStyle(k).marginLeft, appIsChild: app.classList.contains('child') };
  });
  ok('a nested child still carries its depth indent (hierarchy kept)', indent.appIsChild && indent.appMargin === '22px' && indent.kMargin === '0px', JSON.stringify(indent));

  // ---- Layer 5 (CONTROL): a NARROW page collapses back to a single column ----
  await page.setViewportSize({ width: 460, height: 900 });
  await page.evaluate(FIXTURE);
  const narrow = await page.evaluate(readLayout);
  ok('CONTROL: a narrow page falls back to a single column (responsive)', narrow.columns === 1, JSON.stringify(narrow));

  await page.close();
  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
