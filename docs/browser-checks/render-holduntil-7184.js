// Browser-check-surface: tk-hold tk-hold-msg tk-hold-until tk-hold-for tk-hold-for-row tk-hold-for-when tk-hold-task tk-hold-at tk-hold-takeover tk-hold-save tk-activity
'use strict';
/**
 * What a held task waits for, on its page (kosmos#7184, the screen half of #7180).
 *
 * What this pins, and why each line can fail:
 *  - a task not on hold shows no "Wait for" choice and no waiting line (the control for everything below),
 *  - once held, "Wait for" shows "Nothing in particular" with Save off; choosing "Another task to close" offers the
 *    project's open tasks, Save comes on once one is chosen, and saving stores { task } and says
 *    "Waiting for task N to close." (the board's own reading, t.holdUntil), with the activity's words,
 *  - when that task closes the line says it can come off hold (met, from the board, not worked out here),
 *  - "A date and time" saves the picker's local time as that instant, and the line says "Waiting until ...",
 *  - "Nothing in particular" clears it: no line, nothing stored, the activity says it no longer waits,
 *  - an unsaved choice survives a refresh (the five-second poll repaints this page),
 *  - a page that has not yet seen an agent's hold does not replace it: "Put on hold" changes nothing, says so, and
 *    the agent's condition and "only an agent or you" stay; the takeover line says saving makes the hold the person's,
 *  - light 1400 and dark 390, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-holduntil-7184.js            # headed
 *   HEADED=0 node docs/browser-checks/render-holduntil-7184.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holduntil-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holduntil-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holduntil-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holduntil-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holduntil-config-'));
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
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  require('../../engine/store').writeSettings({ tasksTabShown: true });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
  const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n) || {};
  const openTask = async (page, id, n) => {
    await page.evaluate(async ([pid, num]) => { if (await tskGoToProject(pid)) openTaskPage(num); }, [id, n]);
    await page.waitForSelector('#tk-hold', { state: 'visible', timeout: 5000 });
  };
  const waitText = (page, sel, re) => page.waitForFunction(([s, src]) => { const e = document.querySelector(s); return e && !e.hidden && new RegExp(src).test(e.textContent); }, [sel, re.source], { timeout: 6000 }).catch(() => {});
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 390]]) {
      const tag = `[${theme} ${width}]`;
      const p = projects.create({ name: 'Supplier order ' + theme });
      projects.addAgent(p.id, 'ada', null);
      tasks.create(p.id, { sentence: 'Order the parts', who: 'ada' });         // 1: held here
      tasks.create(p.id, { sentence: 'Get the price approved', who: 'ada' });  // 2: what 1 waits for
      tasks.create(p.id, { sentence: 'Book the courier', who: 'ada' });        // 3: held by an agent under a stale page
      tasks.create(p.id, { sentence: 'Pack the boxes', who: 'ada' });          // 4: open, the page a person moves to mid-Save
      tasks.create(p.id, { sentence: 'Send the invoice', who: 'ada' });        // 5: open, an unsaved choice on another task's page
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      await openTask(page, p.id, 1);
      chk(await page.isHidden('#tk-hold-for-row') && await page.isHidden('#tk-hold-until'), `${tag} CONTROL: a task not on hold has no Wait for choice and no waiting line`);
      await page.click('#tk-hold');
      await page.waitForFunction(() => document.getElementById('tk-hold').textContent === 'Take off hold', null, { timeout: 5000 }).catch(() => {});
      chk(await page.isVisible('#tk-hold-for-row') && await page.inputValue('#tk-hold-for') === '' && await page.isDisabled('#tk-hold-save')
        && await page.isHidden('#tk-hold-until') && await page.isHidden('#tk-hold-takeover'),
        `${tag} held: Wait for shows Nothing in particular, Save off, no waiting line, no takeover line (it is the person's hold)`);

      /* Review 1: the new selects wear the field fill, as the Repeats select beside them does (render-fields asserts that
         rule, but never opens a held task). */
      const fills = await page.evaluate(() => ['tk-hold-for', 'tk-hold-task', 'tk-repeat-every'].map((id) => getComputedStyle(document.getElementById(id)).backgroundColor));
      chk(fills[0] === fills[2] && fills[1] === fills[2], `${tag} Wait for and its task choice wear the Repeats select's field fill`, JSON.stringify(fills));
      await page.selectOption('#tk-hold-for', 'task');
      const opts =await page.evaluate(() => [...document.querySelectorAll('#tk-hold-task option')].map((o) => o.value));
      chk(await page.isVisible('#tk-hold-task') && JSON.stringify(opts) === JSON.stringify(['', '2', '3', '4', '5']) && await page.isDisabled('#tk-hold-save'),
        `${tag} Another task to close offers the project's other open tasks, Save still off until one is chosen`, JSON.stringify(opts));
      await page.selectOption('#tk-hold-task', '2');
      chk(await page.isEnabled('#tk-hold-save'), `${tag} choosing task 2 turns Save on`);
      await page.click('#tk-hold-save');
      await waitText(page, '#tk-hold-until', /^Waiting for task 2 to close\.$/);
      chk(await text(page, '#tk-hold-until') === 'Waiting for task 2 to close.' && JSON.stringify(stored(p.id, 1).onHoldUntil) === '{"task":2}'
        && await page.isDisabled('#tk-hold-save') && await text(page, '#tk-hold-msg') === 'Saved.',
        `${tag} Save stores { task: 2 } and the line says Waiting for task 2 to close.`, JSON.stringify([await text(page, '#tk-hold-until'), stored(p.id, 1).onHoldUntil]));
      await waitText(page, '#tk-activity', /Put on hold until task #2 is closed/);
      chk(/Put on hold until task #2 is closed/.test(await text(page, '#tk-activity') || ''), `${tag} the activity says what it waits for, in the engine's words`);

      tasks.close(p.id, 2);
      await page.evaluate(async () => { await pjReload(); });
      await waitText(page, '#tk-hold-until', /can come off hold/);
      chk(await text(page, '#tk-hold-until') === 'Task 2 is closed, so this can come off hold.', `${tag} once task 2 closes the line says it can come off hold`, await text(page, '#tk-hold-until'));

      await page.selectOption('#tk-hold-for', 'at');
      const local = await page.evaluate(() => { const d = new Date(Date.now() + 2 * 86400000); d.setHours(9, 30, 0, 0); const z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T09:30'; });
      const wantAt = await page.evaluate((v) => new Date(v).toISOString(), local);
      await page.fill('#tk-hold-at', local);
      await page.click('#tk-hold-save');
      await waitText(page, '#tk-hold-until', /^Waiting until /);
      chk(/^Waiting until .*9:30/.test(await text(page, '#tk-hold-until') || '') && stored(p.id, 1).onHoldUntil && stored(p.id, 1).onHoldUntil.at === wantAt,
        `${tag} A date and time saves the picker's local time as that instant and the line says Waiting until it`, JSON.stringify([await text(page, '#tk-hold-until'), stored(p.id, 1).onHoldUntil, wantAt]));
      await waitText(page, '#tk-activity', /Put on hold until [A-Z][a-z]{2},/);
      const act = await text(page, '#tk-activity') || '';
      chk(/Put on hold until [A-Z][a-z]{2}, .*9:30/.test(act) && !act.includes(wantAt), `${tag} the activity says the time in the person's clock, never the stored instant`, act.slice(-160));

      await page.selectOption('#tk-hold-for', '');
      await page.click('#tk-hold-save');
      await page.waitForFunction(() => document.getElementById('tk-hold-until').hidden, null, { timeout: 5000 }).catch(() => {});
      chk(await page.isHidden('#tk-hold-until') && stored(p.id, 1).onHoldUntil === undefined && stored(p.id, 1).onHold === true,
        `${tag} Nothing in particular clears it: still on hold, no line, nothing stored`, JSON.stringify(stored(p.id, 1).onHoldUntil));
      await waitText(page, '#tk-activity', /no longer waiting for anything/);
      chk(/no longer waiting for anything/.test(await text(page, '#tk-activity') || ''), `${tag} the activity says it no longer waits for anything`);

      /* An unsaved choice survives a refresh. */
      await page.selectOption('#tk-hold-for', 'task');
      await page.evaluate(async () => { await pjReload(); });
      chk(await page.inputValue('#tk-hold-for') === 'task' && await page.isVisible('#tk-hold-task'), `${tag} an unsaved choice survives a refresh`, await page.inputValue('#tk-hold-for'));

      /* A page that has not seen an agent's hold. */
      await openTask(page, p.id, 3);
      tasks.setOnHold(p.id, 3, true, { until: { task: 1 } });   // an agent, after the page last loaded
      await page.click('#tk-hold');
      await waitText(page, '#tk-hold-msg', /already on hold/);
      const s3 = stored(p.id, 3);
      chk(await text(page, '#tk-hold-msg') === 'This is already on hold, so nothing changed.'
        && JSON.stringify(s3.onHoldUntil) === '{"task":1}' && s3.onHoldByPerson !== true && s3.onHold === true,
        `${tag} Put on hold on a stale page changes nothing: the agent's condition stays, the hold stays the agent's`, JSON.stringify(s3));
      chk(await text(page, '#tk-hold-until') === 'Waiting for task 1 to close.' && await page.isVisible('#tk-hold-takeover') && await text(page, '#tk-hold') === 'Take off hold',
        `${tag} the page then shows it: Waiting for task 1 to close., and Saving makes this hold yours`, await text(page, '#tk-hold-until'));

      /* Review 1: Save on a page that has not seen an agent take the hold off changes nothing (it would put the task back
         on hold as the person's). */
      tasks.setOnHold(p.id, 3, false);   // an agent, after the page last loaded
      await page.selectOption('#tk-hold-for', 'at');
      await page.fill('#tk-hold-at', local);
      await page.click('#tk-hold-save');
      await waitText(page, '#tk-hold-msg', /taken off hold/);
      chk(await text(page, '#tk-hold-msg') === 'This was taken off hold, so nothing changed.' && stored(p.id, 3).onHold !== true && stored(p.id, 3).onHoldByPerson !== true,
        `${tag} Save after an agent took the hold off changes nothing`, JSON.stringify(stored(p.id, 3)));
      await page.waitForFunction(() => document.getElementById('tk-hold').textContent === 'Put on hold', null, { timeout: 5000 }).catch(() => {});

      /* Review 1: when the task cannot be read again, Put on hold changes nothing (the poll's old list is not a reading). */
      let refuse = true;
      await page.route('**/api/projects', async (route) => {   // #6022: inside a try
        try { if (refuse && route.request().method() === 'GET') await route.fulfill({ status: 500, body: '{}' }); else await route.fallback(); } catch { await route.abort().catch(() => {}); }
      });
      await page.click('#tk-hold');
      await waitText(page, '#tk-hold-msg', /could not check/);
      chk(await text(page, '#tk-hold-msg') === 'We could not check that task just now, so nothing changed.' && stored(p.id, 3).onHold !== true,
        `${tag} a failed read: Put on hold says so and changes nothing`, await text(page, '#tk-hold-msg'));
      refuse = false;
      await page.unroute('**/api/projects');

      /* Review 1: a hold waiting for a task that is gone keeps that choice, said as gone, and the line says it can come off. */
      tasks.setOnHold(p.id, 1, true, { viaScreen: true, until: { task: 3 } });
      projects.mutate(p.id, (x) => ({ ...x, tasks: x.tasks.filter((t) => t.number !== 3) }));
      await page.evaluate(async () => { await pjReload(); });
      await openTask(page, p.id, 1);
      await waitText(page, '#tk-hold-until', /no longer on this project/);
      const goneOpt = await page.evaluate(() => { const o = document.querySelector('#tk-hold-task option:checked'); return o ? o.textContent : null; });
      chk(await text(page, '#tk-hold-until') === 'Task 3 is no longer on this project, so this can come off hold.'
        && await page.inputValue('#tk-hold-for') === 'task' && await page.inputValue('#tk-hold-task') === '3' && goneOpt === '#3 (no longer on this project)' && await page.isDisabled('#tk-hold-save'),
        `${tag} a hold waiting for a task that is gone: the choice stays, said as gone, Save off`, JSON.stringify([await text(page, '#tk-hold-until'), goneOpt]));

      /* Round 3: Save then a move to another task while the fresh read is out: the hold goes to the task Save was
         pressed on, never the one now open. */
      await page.selectOption('#tk-hold-for', 'at');
      await page.fill('#tk-hold-at', local);
      let slow = true;
      await page.route('**/api/projects', async (route) => {   // #6022: every route call inside a try, so teardown cannot crash the check
        try { if (slow && route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1200)); await route.fallback(); } catch { await route.abort().catch(() => {}); }
      });
      await page.click('#tk-hold-save');
      await page.evaluate(() => openTaskPage(4));
      await page.waitForTimeout(2500);
      slow = false;
      await page.unroute('**/api/projects');
      chk(stored(p.id, 1).onHoldUntil && stored(p.id, 1).onHoldUntil.at === wantAt && stored(p.id, 4).onHold !== true,
        `${tag} a Save whose task was left mid-read holds that task, never the one now open`, JSON.stringify([stored(p.id, 1).onHoldUntil, stored(p.id, 4).onHold]));

      /* Round 4: an unsaved choice on one task never carries over to the next task's form. */
      await openTask(page, p.id, 1);
      await page.selectOption('#tk-hold-for', 'task');
      await page.selectOption('#tk-hold-task', '5');   // chosen, not saved
      tasks.setOnHold(p.id, 4, true, { viaScreen: true });
      await page.evaluate(async () => { await pjReload(); openTaskPage(4); });
      await page.waitForFunction(() => !document.getElementById('tk-hold-for-row').hidden, null, { timeout: 5000 }).catch(() => {});
      await page.selectOption('#tk-hold-for', 'task');
      chk(await page.inputValue('#tk-hold-task') === '' && await page.isDisabled('#tk-hold-save'),
        `${tag} another task's unsaved choice does not carry over: the task choice starts empty, Save off`, await page.inputValue('#tk-hold-task'));

      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      chk(!sideways, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASS');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); for (const d of SANDBOXES) fs.rmSync(d, { recursive: true, force: true }); process.exit(1); });
