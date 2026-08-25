'use strict';

/**
 * The consolidated view under each Agents layout: no org chart over the rails, and an empty centre that says what to press (#774).
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
 *   node docs/browser-checks/render-consolidated-layouts.js <url> <sandbox-root>
 *
 * Seeds one project of its own to open, inside the sandbox, and PROVES the
 * server writes there before it touches anything (the seed lands in
 * <sandbox>/data/AgentWorkforce/projects.json or the check refuses). Puts the
 * board's saved layout back to what it was, and removes the seeded folder.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
(async () => {
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const SANDBOX = process.argv[3] || '';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  const style = (layout) => pg.evaluate((l) => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: l }) }).then((r) => r.text()), layout);
  /* null means hidden; a selector that matches nothing is 'missing', so an
     absence line cannot pass on a page that has lost the element. */
  const rect = (sel) => pg.$eval(sel, (el) => { if (el.hidden || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }).catch(() => 'missing');
  const up = (sel) => pg.$eval(sel, (el) => !(el.hidden || getComputedStyle(el).display === 'none')).catch(() => false);
  /* The state, not a timer: the layout arrives by paintStyles -> applyLayout ->
     showTab after the page loads, and a slow fixture would make a fixed wait
     flaky. A short settle after it lands lets the rails finish their first paint. */
  const settled = async (cons) => { await pg.waitForFunction((c) => document.body.classList.contains('consolidated') === c, cons, { timeout: 15000 }); await pg.waitForTimeout(300); };
  const none = () => pg.$eval('#pj-none', (e) => (e.hidden ? null : e.textContent)).catch(() => '(no #pj-none on the page)');

  let seedFolder = '';
  let savedLayout = 'tabs';
  try {
  await pg.goto(URL + '/?tab=projects', { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  /* This check writes to the board it is pointed at (a project, the saved
     layout). It seeds one project of its own to open and, like
     render-projects, proves the record landed inside the sandbox it was
     handed before it goes on; pointed at a person's own Kosmos it refuses. */
  if (!SANDBOX) throw new Error('pass the server\'s sandbox root as the 2nd argument; this check adds a project and rewrites the saved layout on the server it is pointed at');
  seedFolder = fs.mkdtempSync(path.join(SANDBOX, 'cons-774-seed-'));
  const made = await pg.evaluate((f) => fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Consolidated check', folder: f }) }).then((r) => r.status), seedFolder);
  say(made >= 200 && made < 300, 'seeded one project for the check', String(made));
  const store = path.join(SANDBOX, 'data', 'AgentWorkforce', 'projects.json');
  if (!fs.existsSync(store) || !fs.readFileSync(store, 'utf8').includes('Consolidated check')) {
    throw new Error('the server at ' + URL + ' did not write the seed to ' + store + ': it is NOT running against the sandbox passed. Refusing to touch it.');
  }
  savedLayout = await pg.evaluate(() => fetch('/api/style').then((r) => r.json()).then((j) => (j && j.layout) || 'tabs').catch(() => 'tabs'));
  await style('consolidated');

  for (const lay of ['grid', 'list', 'org']) {
    for (const tab of ['agents', 'projects']) {
      await pg.goto(URL + '/?tab=' + tab, { waitUntil: 'networkidle' });
      await pg.evaluate((l) => { localStorage.setItem('kosmos.layout.agents', l); sessionStorage.removeItem('rail-fold-a'); sessionStorage.removeItem('rail-fold-p'); }, lay);
      await pg.reload({ waitUntil: 'networkidle' });
      await settled(true);
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
         grid-row rule fails this line. Geometry, run headless: the runner's
         caveat is about PAINT (compositor, scroll, screenshots); grid
         placement is layout, which headless computes the same way, and this
         line measures placement only. */
      const ra = await rect('#rail-agents'); const rp = await rect('#rail-projects');
      say(!!ra && !!rp && Math.abs(ra.y - rp.y) <= 12, tag + ': the two rails start at the same height', ra && rp ? ra.y + ' vs ' + rp.y : JSON.stringify({ ra, rp }));
      const said = await none();
      say(!!said && /Pick a project on the left/.test(said), tag + ': the empty centre says what to press', JSON.stringify(said));
    }
  }

  // fold the projects rail alone, then both: the sentence says where the list went, and which column when there are two
  await pg.click('#rail-projects-fold'); await pg.waitForTimeout(300);
  const foldedP = await none();
  say(!!foldedP && /^Nothing is open yet\. The projects list is folded; press › at the top of the narrow column to open it\.$/.test(foldedP), 'projects rail folded: the sentence names the fold button', JSON.stringify(foldedP));
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
  say((await paintAs(true, true, false)) === null, 'after a failed read, rail open: silence beside the rail\'s own message');
  say(/folded; press ›/.test((await paintAs(true, true, true)) || ''), 'after a failed read, rail folded: open the column and see');

  // open a project: the sentence goes
  const first = await pg.$('#pj-list [data-project]'); // active rows only; the seed is active
  if (first) {
    await first.click(); await pg.waitForTimeout(700);
    say((await none()) === null, 'a project open: the sentence is gone');
    say(await up('#pj-one-view'), 'a project open: the project page is up');
  } else {
    say(false, 'the board has a project to open (this check needs one)');
  }

  // the tab view keeps the person's org chart and never shows the sentence
  await style('tabs');
  await pg.goto(URL + '/?tab=agents', { waitUntil: 'networkidle' }); await settled(false);
  say(!(await pg.evaluate(() => document.body.classList.contains('consolidated'))), 'tabs: the consolidated view is down');
  say(await up('#orgview'), 'tabs, agents left on org: the org chart is painted');
  say((await none()) === null, 'tabs: the sentence is never shown');
  // positive control for the grid absence lines above: the grid does paint when asked for
  await pg.evaluate(() => localStorage.setItem('kosmos.layout.agents', 'grid'));
  await pg.reload({ waitUntil: 'networkidle' }); await settled(false);
  say(await up('#grid'), 'tabs, agents left on grid: the grid is painted (control)');
  // leaving the consolidated view without a reload (the resize handler's path): the chart comes back
  await pg.evaluate(() => localStorage.setItem('kosmos.layout.agents', 'org'));
  await style('consolidated'); await pg.reload({ waitUntil: 'networkidle' }); await settled(true);
  say((await rect('#orgview')) === null, 'back in the consolidated view: the chart is hidden again');
  await pg.evaluate(() => { document.documentElement.setAttribute('data-layout', 'tabs'); showTab('agents'); });
  await pg.waitForTimeout(300);
  say(await up('#orgview'), 'to tabs without a reload: the chart is painted again on the same tick');
  } finally {
    /* Whatever happened, the board's saved layout goes back to what it was,
       the seeded folder goes, and the browser closes; a selector timeout must
       not leave the next check on a consolidated board. The seeded record
       dies with the sandbox. */
    try { await style(savedLayout); } catch { /* the server may be gone */ }
    if (seedFolder) { try { fs.rmSync(seedFolder, { recursive: true, force: true }); } catch { /* fine */ } }
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
