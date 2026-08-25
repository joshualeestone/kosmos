'use strict';

/**
 * The consolidated view under every Agents layout (#774).
 *
 * 🔑 THE BUG WAS STATE CARRIED IN FROM ANOTHER SCREEN. Josh: "depending on what
 * I left my agents on affects how the consolidated view renders." The org chart
 * is a tab-view layout, and with the Agents page last left on it, the chart
 * painted full-width above the rails. A rendered check is the only kind that
 * can see that: the markup is the same in all three cases.
 *
 * Also here: with nothing open the centre is not blank. It says what to press,
 * and says it differently when the projects rail is folded, because a blank
 * centre with both rails folded read as "I have no way to get back".
 *
 *   node docs/browser-checks/render-consolidated-layouts.js <url>     (default http://127.0.0.1:17471)
 *
 * Needs a board with at least one project. Leaves the layout on tabs.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  const style = (layout) => pg.evaluate((l) => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: l }) }).then((r) => r.text()), layout);
  const rect = (sel) => pg.$eval(sel, (el) => { if (el.hidden || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }).catch(() => null);
  const none = () => pg.$eval('#pj-none', (e) => (e.hidden ? null : e.textContent)).catch(() => '(no #pj-none on the page)');

  try {
  await pg.goto(URL + '/?tab=projects', { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await style('consolidated');

  for (const lay of ['grid', 'list', 'org']) {
    for (const tab of ['agents', 'projects']) {
      await pg.goto(URL + '/?tab=' + tab, { waitUntil: 'networkidle' });
      await pg.evaluate((l) => { localStorage.setItem('kosmos.layout.agents', l); sessionStorage.removeItem('rail-fold-a'); sessionStorage.removeItem('rail-fold-p'); }, lay);
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(900);
      const tag = 'agents left on ' + lay + ', arriving on ' + tab;
      say(await pg.evaluate(() => document.body.classList.contains('consolidated')), tag + ': the consolidated view is up');
      say((await rect('#orgview')) === null, tag + ': the org chart is not painted');
      say((await rect('#grid')) === null, tag + ': the grid is not painted');
      const list = await rect('#alist'); const rail = await rect('#pj-list-view');
      say(!!list && !!rail, tag + ': the agents rail and the projects rail are both up', JSON.stringify({ list, rail }));
      /* The two rails start within their own padding of each other (measured
         8px apart on a correct page: the projects rail carries its 8px inset).
         The sentence taking grid row 1 pushed the projects rail down 273px in
         the first cut, so 12px is the whole tolerance and deleting its
         grid-row rule fails this line. */
      const ra = await rect('#rail-agents'); const rp = await rect('#rail-projects');
      say(!!ra && !!rp && Math.abs(ra.y - rp.y) <= 12, tag + ': the two rails start at the same height', ra && rp ? ra.y + ' vs ' + rp.y : JSON.stringify({ ra, rp }));
      const said = await none();
      say(!!said && /Pick a project on the left/.test(said), tag + ': the empty centre says what to press', JSON.stringify(said));
    }
  }

  // fold the projects rail alone, then both: the sentence says where the list went, and which column when there are two
  await pg.click('#rail-projects-fold'); await pg.waitForTimeout(300);
  const foldedP = await none();
  say(!!foldedP && /folded; press › at the top of the narrow column/.test(foldedP), 'projects rail folded: the sentence names the fold button', JSON.stringify(foldedP));
  await pg.click('#rail-agents-fold'); await pg.waitForTimeout(300);
  const folded = await none();
  say(!!folded && /the second narrow column/.test(folded), 'both rails folded: the sentence says the second narrow column', JSON.stringify(folded));
  await pg.click('#rail-projects-fold'); await pg.click('#rail-agents-fold'); await pg.waitForTimeout(300);
  say(/Pick a project on the left/.test((await none()) || ''), 'rails open again: back to the plain sentence');

  // the New project form open: the sentence is not painted over it by a fold press
  await pg.click('#rail-projects-new'); await pg.waitForTimeout(400);
  await pg.click('#rail-agents-fold'); await pg.waitForTimeout(300);
  say((await none()) === null, 'New project form open, then a fold press: the sentence stays hidden');
  await pg.click('#rail-agents-fold'); await pg.click('#pj-add-back'); await pg.waitForTimeout(400);

  // a board with no projects: the open rail's own card says it, so the sentence stays hidden;
  // folded, the sentence says press + (the + survives the fold); a failed read never says "no projects"
  const paintAs = (loaded, failed, foldP) => pg.evaluate(([l, f, p]) => {
    const keep = { P: PROJECTS, L: PJ_LOADED_ONCE, F: PJ_READ_FAILED, fp: document.body.classList.contains('fold-p') };
    PROJECTS = []; PJ_LOADED_ONCE = l; PJ_READ_FAILED = f; document.body.classList.toggle('fold-p', p);
    paintPjNone('list');
    const el = document.getElementById('pj-none'); const t = el.hidden ? null : el.textContent;
    PROJECTS = keep.P; PJ_LOADED_ONCE = keep.L; PJ_READ_FAILED = keep.F; document.body.classList.toggle('fold-p', keep.fp); paintPjNone('list');
    return t;
  }, [loaded, failed, foldP]);
  say((await paintAs(true, false, false)) === null, 'no projects, rail open: the sentence is hidden (the rail card says it)');
  const foldedEmpty = await paintAs(true, false, true);
  say(/^No projects yet\. Press \+ at the top of the narrow column to start one\.$/.test(foldedEmpty || ''), 'no projects, rail folded: press +', JSON.stringify(foldedEmpty));
  say(/Pick a project on the left/.test((await paintAs(false, false, false)) || ''), 'before the first read: never "No projects yet"');
  say(/Pick a project on the left/.test((await paintAs(true, true, false)) || ''), 'after a failed read: never "No projects yet"');

  // open a project: the sentence goes
  const first = await pg.$('#pj-list [data-project]');
  if (first) {
    await first.click(); await pg.waitForTimeout(700);
    say((await none()) === null, 'a project open: the sentence is gone');
    say((await rect('#pj-one-view')) !== null, 'a project open: the project page is up');
  } else {
    say(false, 'the board has a project to open (this check needs one)');
  }

  // the tab view keeps the person's org chart and never shows the sentence
  await style('tabs');
  await pg.goto(URL + '/?tab=agents', { waitUntil: 'networkidle' }); await pg.waitForTimeout(900);
  say(!(await pg.evaluate(() => document.body.classList.contains('consolidated'))), 'tabs: the consolidated view is down');
  say((await rect('#orgview')) !== null, 'tabs, agents left on org: the org chart is painted');
  say((await none()) === null, 'tabs: the sentence is never shown');
  // positive control for the grid absence lines above: the grid does paint when asked for
  await pg.evaluate(() => localStorage.setItem('kosmos.layout.agents', 'grid'));
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(900);
  say((await rect('#grid')) !== null, 'tabs, agents left on grid: the grid is painted (control)');
  } finally {
    /* Whatever happened, the sandbox's saved layout goes back to tabs and the
       browser closes; a selector timeout must not leave the next check on a
       consolidated board. */
    try { await style('tabs'); } catch { /* the server may be gone */ }
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
