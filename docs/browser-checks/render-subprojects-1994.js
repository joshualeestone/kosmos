'use strict';
/* #1994: sub-projects UI — a project can name a parent, shown as a tree in the
 * wide Projects tab (indent) and a "under <parent>" chip everywhere narrow, plus
 * a set-parent <select> in project settings that can only offer a valid parent.
 * Drives the SHIPPED paintProjects / projectCard / paintProjectSettings against a
 * real fixture PROJECTS tree in the real page — not a copy. Controls that can
 * return the dangerous answer: nothing vanishes (a child of an archived/dangling
 * parent still renders), a stored cycle still renders every row without hanging,
 * and the parent select excludes self + descendants (offer a cycle and the
 * engine would refuse it). Both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-subprojects-1994.js
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
    // The page fires startup polls at file:// that cannot load. We drive the
    // render functions directly with a fixture PROJECTS, so we do NOT stub fetch
    // (a blanket {} stub breaks the unrelated members/free-agent path). Just
    // stop the 5s poll and ignore the harness's own file:// fetch errors, so a
    // genuine console error from the code under test still surfaces.
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    // ---- Layer 1: the tree render ----
    const tree = await page.evaluate(() => {
      const mk = (id, name, parent, parentName, archived) => ({ id, name, parent: parent || null, parentName: parentName || null, parentArchived: false, archived: !!archived, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [
        mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos'), mk('mob', 'Mobile', 'app', 'App'),
        mk('and', 'Android', 'mob', 'Mobile'), mk('ios', 'iOS', 'mob', 'Mobile'), mk('site', 'Site', 'k', 'Kosmos'),
        mk('orph', 'Orphan', 'gone', null), mk('arch', 'Archived one', null, null, true), mk('ac', 'ArchChild', 'arch', 'Archived one'),
      ];
      PJ_SORT = 'az';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.getElementById('panel-projects').hidden = false;
      paintProjects();
      const rows = Array.from(document.querySelectorAll('#pj-list .pj-row'));
      const by = {};
      rows.forEach((r, i) => { by[r.getAttribute('data-project')] = {
        i, depth: Number(r.style.getPropertyValue('--pj-depth') || 0),
        sub: (r.querySelector('.pjsub') || {}).textContent || '',
        chip: (r.querySelector('.pj-parent') || {}).textContent || '',
        childClass: r.classList.contains('child') };
      });
      return { count: rows.length, ids: rows.map((r) => r.getAttribute('data-project')), by };
    });
    // 8 active projects (arch is archived); NOTHING vanishes.
    ok(t + ' all active rows render (nothing vanishes)', tree.count === 8, 'count=' + tree.count + ' ids=' + tree.ids.join(','));
    // nesting: a child of an ACTIVE parent nests (depth>0, after its parent)
    ok(t + ' app nests under k', tree.by.app && tree.by.app.depth === 1 && tree.by.app.i > tree.by.k.i, JSON.stringify(tree.by.app));
    ok(t + ' mobile depth 2', tree.by.mob && tree.by.mob.depth === 2);
    ok(t + ' android/ios depth 3', tree.by.and && tree.by.and.depth === 3 && tree.by.ios.depth === 3);
    ok(t + ' children carry .child class', tree.by.app.childClass && tree.by.and.childClass && !tree.by.k.childClass);
    // sub-project counts derived from the same grouping
    ok(t + ' k shows 2 sub-projects', /2 sub-projects/.test(tree.by.k.sub), tree.by.k.sub);
    ok(t + ' app shows 1 sub-project', /1 sub-project\b/.test(tree.by.app.sub), tree.by.app.sub);
    ok(t + ' leaf shows no sub count', tree.by.and.sub === '');
    // orphan (dangling parent id) renders at top level
    ok(t + ' dangling-parent child renders at top level', tree.by.orph && tree.by.orph.depth === 0);
    // archived-parent child renders at top level BUT keeps the chip (relationship not dropped)
    ok(t + ' archived-parent child renders top level', tree.by.ac && tree.by.ac.depth === 0);
    ok(t + ' archived-parent child keeps its chip', /under Archived one/.test(tree.by.ac.chip), tree.by.ac.chip);
    // the chip carries the parent name for a nested child too
    ok(t + ' nested child has parent chip', /under Kosmos/.test(tree.by.app.chip), tree.by.app.chip);
    // CONTROL: without nesting, app would be at the same depth as k. Prove the
    // instrument can see the dangerous answer by checking depth actually varies.
    ok(t + ' CONTROL depth varies (grouping is real, not flat)', new Set(Object.values(tree.by).map((x) => x.depth)).size >= 3);

    // ---- Layer 1b: a stored CYCLE must still render every row, not hang ----
    const cyc = await page.evaluate(() => {
      const mk = (id, name, parent) => ({ id, name, parent: parent || null, parentName: null, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('a', 'A', 'b'), mk('b', 'B', 'a'), mk('c', 'C')];   // a<->b cycle, c free
      PJ_SORT = 'az';
      paintProjects();
      return Array.from(document.querySelectorAll('#pj-list .pj-row')).map((r) => r.getAttribute('data-project')).sort();
    });
    ok(t + ' cycle renders all rows (no vanish, no hang)', cyc.length === 3 && cyc.join(',') === 'a,b,c', JSON.stringify(cyc));

    // ---- Layer 2: the set-parent select ----
    const select = await page.evaluate(() => {
      const mk = (id, name, parent, parentName, archived) => ({ id, name, parent: parent || null, parentName: parentName || null, archived: !!archived, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [
        mk('k', 'Kosmos'), mk('app', 'App', 'k', 'Kosmos'), mk('mob', 'Mobile', 'app', 'App'),
        mk('and', 'Android', 'mob', 'Mobile'), mk('site', 'Site', 'k', 'Kosmos'), mk('arch', 'Archived one', null, null, true),
      ];
      PJ_SORT = 'az'; PJ_CURRENT = 'app';
      paintProjectSettings(pjById('app'));
      const sel = document.getElementById('pjs-parent');
      return { value: sel.value, opts: Array.from(sel.options).map((o) => o.value) };
    });
    ok(t + ' select preselects current parent', select.value === 'k', select.value);
    ok(t + ' select offers Top level (none)', select.opts.includes(''), JSON.stringify(select.opts));
    ok(t + ' select excludes self', !select.opts.includes('app'), JSON.stringify(select.opts));
    // CONTROL that can return the dangerous answer: descendants MUST be excluded,
    // or picking one would create a cycle the engine refuses.
    ok(t + ' select excludes descendants (mob/and)', !select.opts.includes('mob') && !select.opts.includes('and'), JSON.stringify(select.opts));
    ok(t + ' select excludes archived', !select.opts.includes('arch'), JSON.stringify(select.opts));
    ok(t + ' select includes valid parents (k, site)', select.opts.includes('k') && select.opts.includes('site'), JSON.stringify(select.opts));

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
