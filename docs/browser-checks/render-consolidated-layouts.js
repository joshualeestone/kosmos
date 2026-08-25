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
 *   node docs/browser-checks/render-consolidated-layouts.js http://127.0.0.1:17010
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

  await pg.goto(URL + '/?tab=projects', { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await style('consolidated');

  for (const lay of ['grid', 'list', 'org']) {
    for (const tab of ['agents', 'projects']) {
      await pg.goto(URL + '/?tab=' + tab, { waitUntil: 'networkidle' });
      await pg.evaluate((l) => { localStorage.setItem('kosmos.layout.agents', l); localStorage.removeItem('kosmos.fold.a'); localStorage.removeItem('kosmos.fold.p'); }, lay);
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(900);
      const tag = 'agents left on ' + lay + ', arriving on ' + tab;
      say(await pg.evaluate(() => document.body.classList.contains('consolidated')), tag + ': the consolidated view is up');
      say((await rect('#orgview')) === null, tag + ': the org chart is not painted');
      say((await rect('#grid')) === null, tag + ': the grid is not painted');
      const list = await rect('#alist'); const rail = await rect('#pj-list-view');
      say(!!list && !!rail, tag + ': the agents rail and the projects rail are both up', JSON.stringify({ list, rail }));
      say(!!list && !!rail && Math.abs(list.y - rail.y) < 40, tag + ': the two rails start at the same height', list && rail ? list.y + ' vs ' + rail.y : '');
      const said = await none();
      say(!!said && /Pick a project on the left/.test(said), tag + ': the empty centre says what to press', JSON.stringify(said));
    }
  }

  // fold both rails: the sentence changes to say where the list went
  await pg.click('#rail-agents-fold'); await pg.click('#rail-projects-fold'); await pg.waitForTimeout(300);
  const folded = await none();
  say(!!folded && /folded/.test(folded) && /›/.test(folded), 'both rails folded: the sentence names the fold button', JSON.stringify(folded));
  await pg.click('#rail-projects-fold'); await pg.waitForTimeout(300);
  say(/Pick a project on the left/.test((await none()) || ''), 'projects rail open again: back to the plain sentence');

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

  await pg.close();
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
