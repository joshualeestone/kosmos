// Browser-check-surface: tk-hold tk-hold-msg tk-hold-hint tk-activity pj-one-pause pj-one-pause-label pj-one-pause-hint pj-one-pause-msg tsk-tiles tk-repeat-every tk-repeat-day tk-repeat-at tk-repeat-save tk-repeat-line tk-repeat-msg tkPaintRepeat pj-head-pause pj-one-paused pj-head-pause-msg paintHeadPause pjTogglePause
'use strict';
/**
 * On hold and paused, on the screen (kosmos#4771).
 *
 * What this pins, and why each line can fail:
 *  - a task's page offers "Put on hold"; pressing it puts the task on hold (the button then reads "Take off hold"),
 *    and the task's activity says "Put on hold",
 *  - the Tasks view's On hold tile counts it and filters to it, while the same project's task that is NOT on hold
 *    stays out of On hold (the control),
 *  - a project's settings offer "Pause it"; pressing it pauses the project ("Resume it", "This project is paused"),
 *    its task then counts under On hold, and that task's page says the project is paused,
 *  - taking the task off hold and resuming the project brings On hold back to zero,
 *  - light 1400 and dark 390, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-onhold-4771.js            # headed
 *   HEADED=0 node docs/browser-checks/render-onhold-4771.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onhold-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onhold-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onhold-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onhold-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onhold-config-'));
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
  const launch = projects.create({ name: 'Spring launch' });
  projects.addAgent(launch.id, 'ada', null);
  tasks.create(launch.id, { sentence: 'Write the blurb', who: 'ada' });   // 1: put on hold here
  tasks.create(launch.id, { sentence: 'Order proofs', who: 'ada' });      // 2: the control, never on hold
  tasks.create(launch.id, { sentence: 'Old checklist' });                 // 3: closed, so nothing to hold
  tasks.close(launch.id, 3);
  const winter = projects.create({ name: 'Winter catalog' });
  tasks.create(winter.id, { sentence: 'Draft the plan' });                // 1: held by pausing its project
  const summer = projects.create({ name: 'Summer list' });                // paused by an agent, before the page loads
  projects.edit(summer.id, { paused: true });
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
  const heldCount = async (page, want) => {
    await page.evaluate(() => showTab('tasks'));
    await page.waitForFunction((w) => { const n = document.querySelector('#tsk-tiles [data-tile="held"] .num'); return n && n.textContent === w; }, want, { timeout: 6000 }).catch(() => {});
    return text(page, '#tsk-tiles [data-tile="held"] .num');
  };
  const heldRows = async (page) => {
    await page.click('#tsk-tiles [data-tile="held"]');
    await page.waitForTimeout(250);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
    await page.click('#tsk-tiles [data-tile="held"]');   // back to everything
    await page.waitForTimeout(150);
    return rows;
  };
  const openTask = async (page, id, n) => {
    await page.evaluate(async ([pid, num]) => { if (await tskGoToProject(pid)) openTaskPage(num); }, [id, n]);
    await page.waitForSelector('#tk-hold', { state: 'visible', timeout: 5000 });
  };
  const openSettings = async (page, id) => {
    await page.evaluate((pid) => tskGoToProject(pid), id);
    await page.click('#pj-settings-link');
    await page.waitForSelector('#pj-one-pause', { state: 'visible', timeout: 5000 });
  };
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 390]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      chk(await heldCount(page, '0') === '0', `${tag} nothing is on hold to start`);

      /* A task put on hold from its page. */
      await openTask(page, launch.id, 1);
      chk(await text(page, '#tk-hold') === 'Put on hold', `${tag} a task's page offers Put on hold`, await text(page, '#tk-hold'));
      await page.click('#tk-hold');
      await page.waitForFunction(() => document.getElementById('tk-hold').textContent === 'Take off hold', null, { timeout: 5000 }).catch(() => {});
      chk(await text(page, '#tk-hold') === 'Take off hold', `${tag} pressing it puts the task on hold; the button then offers Take off hold`, await text(page, '#tk-hold'));
      await page.waitForFunction(() => /Put on hold/.test(document.getElementById('tk-activity').textContent), null, { timeout: 5000 }).catch(() => {});
      chk(/Put on hold/.test(await text(page, '#tk-activity') || ''), `${tag} the task's activity says Put on hold`);
      chk(!/by an agent/.test(await text(page, '#tk-activity') || ''), `${tag} the person's own hold is not credited to an agent`, await text(page, '#tk-activity'));

      chk(await heldCount(page, '1') === '1', `${tag} the On hold tile counts the held task`, await text(page, '#tsk-tiles [data-tile="held"] .num'));
      const held1 = await heldRows(page);
      chk(held1.includes('Write the blurb'), `${tag} the On hold tile shows the held task`, JSON.stringify(held1));
      chk(!held1.includes('Order proofs'), `${tag} the same project's task that is not on hold is not under On hold (control)`, JSON.stringify(held1));

      /* A project paused from its settings. */
      await openSettings(page, winter.id);
      chk(await text(page, '#pj-one-pause') === 'Pause it', `${tag} a project's settings offer Pause it`, await text(page, '#pj-one-pause'));
      await page.click('#pj-one-pause');
      await page.waitForFunction(() => document.getElementById('pj-one-pause').textContent === 'Resume it', null, { timeout: 5000 }).catch(() => {});
      chk(await text(page, '#pj-one-pause') === 'Resume it' && await text(page, '#pj-one-pause-label') === 'This project is paused',
        `${tag} pressing it pauses the project: This project is paused, and Resume it`, JSON.stringify([await text(page, '#pj-one-pause'), await text(page, '#pj-one-pause-label')]));
      chk(!/An agent paused it/.test(await text(page, '#pj-one-pause-hint') || ''), `${tag} the person's own pause is not credited to an agent`, await text(page, '#pj-one-pause-hint'));
      chk(await heldCount(page, '2') === '2', `${tag} a paused project's task counts under On hold`, await text(page, '#tsk-tiles [data-tile="held"] .num'));
      const held2 = await heldRows(page);
      chk(held2.includes('Draft the plan') && !held2.includes('Order proofs'), `${tag} On hold shows the paused project's task, and still not the control`, JSON.stringify(held2));
      await openTask(page, winter.id, 1);
      chk(/This project is paused/.test(await text(page, '#tk-hold-hint') || ''), `${tag} a paused project's task says its project is paused`, await text(page, '#tk-hold-hint'));

      /* Back again: resume the project, take the task off hold. */
      await openSettings(page, winter.id);
      await page.click('#pj-one-pause');
      await page.waitForFunction(() => document.getElementById('pj-one-pause').textContent === 'Pause it', null, { timeout: 5000 }).catch(() => {});
      chk(await text(page, '#pj-one-pause') === 'Pause it', `${tag} Resume it resumes the project`, await text(page, '#pj-one-pause'));
      /* kosmos#5391: the project page's own Pause / Resume, beside the name: one press pauses (it reads Resume and the
         Paused line shows), the next resumes, through the same call as Settings (the Settings button agrees). */
      await page.evaluate((pid) => tskGoToProject(pid), winter.id);
      await page.waitForSelector('#pj-head-pause', { state: 'visible', timeout: 5000 });
      chk(/^\s*Pause\s*$/.test(await text(page, '#pj-head-pause') || '') && await page.isHidden('#pj-one-paused'),
        `${tag} #5391 the project page offers Pause beside its name, and says nothing about pausing yet`, await text(page, '#pj-head-pause'));
      await page.click('#pj-head-pause');
      await page.waitForFunction(() => /Resume/.test(document.getElementById('pj-head-pause').textContent), null, { timeout: 5000 }).catch(() => {});
      chk(/Resume/.test(await text(page, '#pj-head-pause') || '') && await page.isVisible('#pj-one-paused')
        && /^Paused: Kosmos is not nudging anyone/.test(await text(page, '#pj-one-paused') || ''),
        `${tag} #5391 pressing it pauses the project: it reads Resume and the Paused line shows`, await text(page, '#pj-one-paused'));
      // Review 1: Settings repaints only while it is open, so it is opened to read its agreement, then left.
      await openSettings(page, winter.id);
      chk(await text(page, '#pj-one-pause') === 'Resume it', `${tag} #5391 Settings agrees: Resume it`, await text(page, '#pj-one-pause'));
      await page.evaluate((pid) => tskGoToProject(pid), winter.id);
      await page.waitForSelector('#pj-head-pause', { state: 'visible', timeout: 5000 });
      await page.click('#pj-head-pause');
      await page.waitForFunction(() => /Pause/.test(document.getElementById('pj-head-pause').textContent), null, { timeout: 5000 }).catch(() => {});
      chk(/^\s*Pause\s*$/.test(await text(page, '#pj-head-pause') || '') && await page.isHidden('#pj-one-paused'),
        `${tag} #5391 Resume resumes it, and the Paused line goes`, await text(page, '#pj-head-pause'));
      await openTask(page, launch.id, 1);
      await page.click('#tk-hold');
      await page.waitForFunction(() => document.getElementById('tk-hold').textContent === 'Put on hold', null, { timeout: 5000 }).catch(() => {});
      chk(await text(page, '#tk-hold') === 'Put on hold', `${tag} Take off hold takes the task off hold`, await text(page, '#tk-hold'));
      chk(await heldCount(page, '0') === '0', `${tag} with both undone, nothing is on hold`, await text(page, '#tsk-tiles [data-tile="held"] .num'));

      /* kosmos#4787 slice 1b: the task page's Repeats. Save is off until the choice differs from what is stored; Every
         week shows a day and a time; saving makes the board's sentence appear; Never clears it again. */
      await openTask(page, winter.id, 1);
      chk(await page.inputValue('#tk-repeat-every') === '' && await page.isDisabled('#tk-repeat-save') && await page.isHidden('#tk-repeat-line')
        && await page.isHidden('#tk-repeat-when'),
        `${tag} #4787 a one-off task says Repeats: Never, with Save off and no repeat line`, await page.inputValue('#tk-repeat-every'));
      await page.selectOption('#tk-repeat-every', 'week');
      chk(await page.isVisible('#tk-repeat-day') && await page.isVisible('#tk-repeat-at') && await page.isEnabled('#tk-repeat-save'),
        `${tag} #4787 choosing Every week shows a day and a time, and Save comes on`);
      await page.selectOption('#tk-repeat-day', 'tue');
      await page.fill('#tk-repeat-at', '10:30');
      await page.click('#tk-repeat-save');
      await page.waitForFunction(() => !document.getElementById('tk-repeat-line').hidden, null, { timeout: 5000 }).catch(() => {});
      chk(/^Repeats every Tuesday at 10:30am\. No run reported yet\. Next /.test(await text(page, '#tk-repeat-line') || '') && await page.isDisabled('#tk-repeat-save'),
        `${tag} #4787 Save sets the rule: the board's sentence shows and Save goes off again`, await text(page, '#tk-repeat-line'));
      /* Review 2: an unsaved choice survives a refresh EVEN WHEN the stored rule changes under it (the rule moves to hourly
         elsewhere while the person has Every day chosen); once they choose what is stored now, the controls follow again. */
      const setRule = (body) => page.evaluate(([id, b]) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status), [winter.id, body]);
      await page.selectOption('#tk-repeat-every', 'day');
      chk(await setRule({ every: 'hour' }) === 200, `${tag} #4787 the rule changes elsewhere (setup)`);
      await page.evaluate(async () => { await pjReload(); });
      chk(await page.inputValue('#tk-repeat-every') === 'day' && await page.isEnabled('#tk-repeat-save') && /^Repeats every hour/.test(await text(page, '#tk-repeat-line') || ''),
        `${tag} #4787 an unsaved choice survives a refresh that changed the stored rule; the line says the stored rule`, await page.inputValue('#tk-repeat-every'));
      await page.selectOption('#tk-repeat-every', 'hour');   // review 3: choosing what is stored NOW (hourly) is nothing unsaved
      chk(await setRule({ every: 'day', at: '07:45' }) === 200, `${tag} #4787 the rule changes again (setup)`);
      await page.evaluate(async () => { await pjReload(); });
      await page.waitForFunction(() => document.getElementById('tk-repeat-every').value === 'day', null, { timeout: 5000 }).catch(() => {});
      chk(await page.inputValue('#tk-repeat-every') === 'day' && await page.inputValue('#tk-repeat-at') === '07:45' && await page.isDisabled('#tk-repeat-save'),
        `${tag} #4787 with no unsaved choice the controls follow a rule changed elsewhere (control for the arm above)`, await page.inputValue('#tk-repeat-at'));
      await page.fill('#tk-repeat-at', '');
      chk(await page.isDisabled('#tk-repeat-save') && /Choose a time/.test(await text(page, '#tk-repeat-msg') || ''),
        `${tag} #4787 an empty time is no choice: Save stays off and the page asks for a time`, await text(page, '#tk-repeat-msg'));
      await page.selectOption('#tk-repeat-every', '');
      await page.click('#tk-repeat-save');
      await page.waitForFunction(() => document.getElementById('tk-repeat-line').hidden, null, { timeout: 5000 }).catch(() => {});
      chk(await page.isHidden('#tk-repeat-line') && await page.isHidden('#tk-repeat-when') && await page.inputValue('#tk-repeat-every') === '',
        `${tag} #4787 Never clears it: no repeat line, back to a one-off`, await text(page, '#tk-repeat-line'));

      /* A project an agent paused says so where it is resumed. */
      await openSettings(page, summer.id);
      chk(await text(page, '#pj-one-pause') === 'Resume it' && /^An agent paused it\./.test(await text(page, '#pj-one-pause-hint') || ''),
        `${tag} a project an agent paused says an agent paused it`, JSON.stringify([await text(page, '#pj-one-pause'), await text(page, '#pj-one-pause-hint')]));

      /* A finished task offers no hold; the open task above is the control that it is offered at all. */
      await page.evaluate(async (pid) => { if (await tskGoToProject(pid)) openTaskPage(3); }, launch.id);
      await page.waitForTimeout(300);
      const closedHold = await page.evaluate(() => ({ row: document.getElementById('tk-hold-row').hidden, hint: document.getElementById('tk-hold-hint').hidden, title: document.getElementById('tk-title').textContent }));
      chk(closedHold.row && closedHold.hint && /Old checklist/.test(closedHold.title), `${tag} a closed task offers no On hold control`, JSON.stringify(closedHold));

      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      chk(wide <= 0, `${tag} no sideways scroll`, String(wide));
      chk(errs.length === 0, `${tag} no page errors`, JSON.stringify(errs));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
