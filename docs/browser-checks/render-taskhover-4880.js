// Browser-check-surface: panel-tasks tsk-list tsk-row tsk-groups
'use strict';
/**
 * #4880 (Josh, 2026-10-01): on the Tasks tab, each task row reads as clickable, the way a project
 * room's task cards do.
 *
 * What this pins, and why each line can fail:
 *  - a row at rest and the same row under the mouse have different grounds (the hover state), and
 *    the hover ground differs from the list it sits on, so it can be seen,
 *  - with the mouse away and the keyboard on the row's title, the row shows the same ground
 *    (focus, not only hover),
 *  - the row does not move or change size when hovered (background only),
 *  - the row says it is clickable (cursor: pointer),
 *  - a click on an empty part of the row opens that task's page, because a row that lights up must
 *    do something when clicked; a click on the project name inside the row still opens the PROJECT,
 *    not the task (a control keeps its own action),
 *  - a picked (ticked) row keeps its own wash under the mouse,
 *  - a click in the checkbox column, just below the box, does not open the task,
 *  - on a touchscreen (390 wide) there is no tint or pointer and a tap on the row opens nothing,
 *  - light and dark, with the new look off and on.
 * CONTROL: run against main before #4880, the rest and hover grounds are the same (the first line
 * fails), and the empty-part click opens nothing.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-taskhover-4880.js            # headed
 *   HEADED=0 node docs/browser-checks/render-taskhover-4880.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskhover-' + p));
const SANDBOX = mk('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mk('workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mk('config-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const launch = projects.create({ name: 'Spring launch' });
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  projects.addAgent(launch.id, 'ada', null);
  tasks.create(launch.id, { sentence: 'Book the podcast tour' });
  tasks.create(launch.id, { sentence: 'Order proof copies', who: 'ada' });
  tasks.create(launch.id, { sentence: 'Pick the launch date' });
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const errs = [];

  /* A row's box and cursor, and a patch of what is PAINTED at its empty right end (pixels, not a computed value: the
     hover is a see-through tint over the list's own ground, so only the composite says what a person sees). */
  const look = async (page, sentence) => {
    const row = page.locator('#tsk-groups .tsk-row', { hasText: sentence }).first();
    const b = await row.boundingBox();
    if (!b) return null;
    const cursor = await row.evaluate((r) => getComputedStyle(r).cursor);
    const patch = await page.screenshot({ clip: { x: b.x + b.width - 40, y: b.y + b.height - 12, width: 30, height: 6 } });
    return { box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], cursor, patch: patch.toString('base64') };
  };
  const same = (a, b) => a && b && a.patch === b.patch;

  for (const newLook of [false, true]) for (const theme of ['light', 'dark']) {
    const T = (newLook ? 'new look ' : 'old look ') + theme + ': ';
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    if (newLook) await ctx.addInitScript(() => { try { localStorage.setItem('kosmos-look', 'new'); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(T + e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => showTab('tasks'));
    await page.waitForSelector('#tsk-groups .tsk-row .tl', { timeout: 10000 });
    chk(await page.evaluate((n) => (document.documentElement.getAttribute('data-look') === 'new') === n, newLook), T + 'CONTROL: the look is the one this pass is for');
    chk(await page.evaluate((dark) => { const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number); return ((m[0] + m[1] + m[2]) / 3 < 128) === dark; }, theme === 'dark'), T + 'CONTROL: the page is painted in the theme this pass is for');

    const S = 'Book the podcast tour';
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    const rest = await look(page, S);
    const rowH = await page.locator('#tsk-groups .tsk-row', { hasText: S }).first();
    const box = await rowH.boundingBox();
    // Hover the row's right end, past its text: a part of the row that is not a control.
    await page.mouse.move(box.x + box.width - 6, box.y + box.height - 4);
    await page.waitForTimeout(250);
    const hover = await look(page, S);
    chk(rest && hover && !same(rest, hover), T + 'a task row under the mouse is PAINTED differently from the same row at rest (pixels)');
    chk(rest && hover && JSON.stringify(rest.box) === JSON.stringify(hover.box), T + 'nothing moves: the row keeps its place and size under the mouse', JSON.stringify({ rest: rest && rest.box, hover: hover && hover.box }));
    chk(hover && hover.cursor === 'pointer', T + 'the row shows a pointing cursor', hover && hover.cursor);

    // Keyboard: mouse away, then Tab from the row's checkbox onto its title (a real key, so the focus is :focus-visible).
    await page.mouse.move(2, 2);
    await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().locator('input[type="checkbox"]').focus();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    const onTitle = await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('tl'));
    chk(onTitle, T + 'CONTROL: Tab from the checkbox lands on the row\'s title');
    const focused = await look(page, S);
    chk(same(focused, hover) && !same(focused, rest), T + 'with the keyboard on the row\'s title, the row is painted as under the mouse, not as at rest');
    // A mouse click on the checkbox (no keyboard) must not leave the row tinted once the mouse moves away.
    await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().locator('input[type="checkbox"]').click();
    await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().locator('input[type="checkbox"]').click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    chk(same(await look(page, S), rest), T + 'after a mouse tick and untick, with the mouse away, the row is back at rest (no tint from a mouse-given focus)');

    // A picked row keeps its wash under the mouse.
    const P = 'Pick the launch date';
    await page.locator('#tsk-groups .tsk-row', { hasText: P }).first().locator('input[type="checkbox"]').check();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    const picked = await look(page, P);
    const pbox = await page.locator('#tsk-groups .tsk-row', { hasText: P }).first().boundingBox();
    await page.mouse.move(pbox.x + pbox.width - 6, pbox.y + pbox.height - 4);
    await page.waitForTimeout(250);
    const pickedHover = await look(page, P);
    chk(same(picked, pickedHover) && !same(picked, rest), T + 'a ticked row keeps its own wash under the mouse (and that wash is not the plain row)');
    await page.locator('#tsk-groups .tsk-row', { hasText: P }).first().locator('input[type="checkbox"]').uncheck();

    // A control inside the row keeps its own action: the project name opens the project, not the task.
    await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().locator('[data-open-project]').click();
    await page.waitForTimeout(800);
    const projOpen = await page.evaluate(() => {
      const tv = document.getElementById('pj-task-view'), pv = document.getElementById('pj-one-view');
      return { task: !!tv && !tv.hidden && tv.getClientRects().length > 0, project: !!pv && !pv.hidden && pv.getClientRects().length > 0 && pv.innerText.includes('Spring launch') };
    });
    chk(!projOpen.task && projOpen.project, T + 'CONTROL: the project name inside a row opens the project, not the task', JSON.stringify(projOpen));

    const taskOpen = () => page.evaluate(() => {
      const tv = document.getElementById('pj-task-view');
      return { task: !!tv && !tv.hidden && tv.getClientRects().length > 0, title: (document.getElementById('tk-title') || {}).textContent || '' };
    });
    // A click just below the checkbox, in its column, is a missed tick, not "open the task".
    await page.evaluate(() => showTab('tasks'));
    await page.waitForSelector('#tsk-groups .tsk-row .tl', { timeout: 10000 });
    const cb = await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().locator('input[type="checkbox"]').boundingBox();
    const b1 = await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().boundingBox();
    await page.mouse.click(cb.x + cb.width / 2, b1.y + b1.height - 3);
    await page.waitForTimeout(800);
    chk(!(await taskOpen()).task, T + 'a click in the checkbox\'s column, just below the box, does not open the task');
    // A click on an empty part of the row opens that task.
    await page.evaluate(() => showTab('tasks'));
    await page.waitForSelector('#tsk-groups .tsk-row .tl', { timeout: 10000 });
    const b2 = await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().boundingBox();
    await page.mouse.click(b2.x + b2.width - 6, b2.y + b2.height - 4);
    await page.waitForTimeout(1000);
    const opened = await taskOpen();
    chk(opened.task && opened.title.includes(S), T + 'a click on an empty part of the row opens that task\'s page', JSON.stringify(opened));
    await ctx.close();
  }
  /* A touchscreen (390 wide): no tint and no pointer, and a tap on the row's empty part opens nothing (its tap areas
     sit close together, so a near-miss must not leave the view). */
  for (const theme of ['light', 'dark']) {
    const T = 'phone ' + theme + ': ';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(T + e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => showTab('tasks'));
    await page.waitForSelector('#tsk-groups .tsk-row .tl', { timeout: 10000 });
    chk(await page.evaluate(() => matchMedia('(hover: none)').matches), T + 'CONTROL: the page is a touchscreen to the page (hover: none)');
    const S = 'Book the podcast tour';
    await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const rest = await look(page, S);
    const b = await page.locator('#tsk-groups .tsk-row', { hasText: S }).first().boundingBox();
    await page.touchscreen.tap(b.x + b.width - 6, b.y + b.height - 4);
    await page.waitForTimeout(800);
    const tv = await page.evaluate(() => { const v = document.getElementById('pj-task-view'); return !!v && !v.hidden && v.getClientRects().length > 0; });
    chk(!tv, T + 'a tap on an empty part of a row does not open the task');
    const after = await look(page, S);
    chk(after && after.cursor !== 'pointer' && same(after, rest), T + 'no pointer and no tint on a touchscreen, before or after a tap', after && after.cursor);
    await ctx.close();
  }
  chk(errs.length === 0, 'no page errors', JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  await new Promise((r) => server.close(r));
  for (const d of SANDBOXES) fs.rmSync(d, { recursive: true, force: true });
  console.log('render-taskhover-4880: ' + (fail.length ? fail.length + ' FAILED' : 'all passed'));
  for (const f of fail) console.log('  FAIL  ' + f);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
