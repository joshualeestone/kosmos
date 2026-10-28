// Browser-check-surface: tsk-paused tsk-groups tk-hold tk-hold-msg tk-hold-hint tk-activity pj-one-pause pj-one-pause-label pj-one-pause-hint pj-one-pause-msg tsk-tiles tk-repeat-every tk-repeat-mins tk-repeat-mins-wrap tk-repeat-day tk-repeat-at tk-repeat-save tk-repeat-line tk-repeat-msg tkPaintRepeat pj-head-pause pj-one-paused pj-head-pause-msg paintHeadPause pjTogglePause pj-one-goalask paintGoalAsk tk-review-row tk-review-who tk-review-msg tkPaintReviewer tkReviewerOf
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
 *  - kosmos#6072: a project the Assigner gave up on today (injected on the board's own /api/projects answer) shows the
 *    goal-ask line under its name, on its own full-width row in the new look (the phone layout #5391 review 1 fixed for
 *    the paused line), and the line goes once the give-up does (the control),
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
  tasks.create(launch.id, { sentence: 'Proof the index', who: 'ada' });   // 4: #5864 control, built in a running project
  tasks.setBuilt(launch.id, 4, { by: 'ada' });
  const winter = projects.create({ name: 'Winter catalog' });
  tasks.create(winter.id, { sentence: 'Draft the plan' });                // 1: held by pausing its project
  // #5864: ada builds task 2 here. Making her a project agent cannot get task 1 handed to her mid-check: the board
  // here never runs live execution, and the Assigner ticks only when it is allowed (server.js, assigner.tick).
  projects.addAgent(winter.id, 'ada', null);
  tasks.create(winter.id, { sentence: 'Finish the cover', who: 'ada' });  // 2: #5864, built, so pausing leaves it built
  tasks.setBuilt(winter.id, 2, { by: 'ada' });
  const summer = projects.create({ name: 'Summer list' });                // paused by an agent, before the page loads
  projects.edit(summer.id, { paused: true });
  /* #5456: a repeating task with nobody on it is run by a schedule: "On a schedule", never Unassigned. */
  const watch = projects.create({ name: 'Price watch' });
  tasks.create(watch.id, { sentence: 'Check the price list' });           // 1: repeats, nobody on it
  tasks.setRepeat(watch.id, 1, { every: 'day', at: '09:00' });
  tasks.create(watch.id, { sentence: 'Pick a supplier' });                // 2: the control, unassigned, no repeat
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
  const tileRows = async (page, k) => {   // #5456: the rows a tile filters to, then back to everything
    await page.click('#tsk-tiles [data-tile="' + k + '"]');
    await page.waitForTimeout(250);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row .tl')].map((x) => x.textContent));
    await page.click('#tsk-tiles [data-tile="' + k + '"]');
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
      /* #5456 */
      chk(await text(page, '#tsk-tiles [data-tile="scheduled"] .num') === '1', `${tag} the On a schedule tile counts the repeating task with nobody on it`, await text(page, '#tsk-tiles [data-tile="scheduled"] .num'));
      const sched = await tileRows(page, 'scheduled');
      chk(sched.includes('Check the price list') && !sched.includes('Pick a supplier'), `${tag} On a schedule shows it, and not the ordinary unassigned task (control)`, JSON.stringify(sched));
      const nobody = await tileRows(page, 'nobody');
      chk(nobody.includes('Pick a supplier') && !nobody.includes('Check the price list'), `${tag} Unassigned leaves the scheduled task out, and keeps the control`, JSON.stringify(nobody));
      // #5456: the project room's task card says the same; in a paused project the task is held, so not "On a schedule".
      const roomWho = async (pid, sentence) => {
        await page.evaluate((id) => tskGoToProject(id), pid);
        await page.waitForSelector('#pj-tasklist', { state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(300);
        return page.evaluate((want) => {
          const card = [...document.querySelectorAll('#pj-tasklist .tkcard, #pj-tasklist li, #pj-tasklist > *')].find((c) => c.textContent.includes(want));
          const w = card && card.querySelector('.tkcard-who-b');
          return w ? w.textContent.trim() : null;
        }, sentence);
      };
      const rw1 = await roomWho(watch.id, 'Check the price list');
      chk(rw1 === 'On a schedule', `${tag} the project room card says On a schedule for it`, String(rw1));
      projects.edit(watch.id, { paused: true });                 // briefly, from this process (the board's own store)
      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const rw2 = await roomWho(watch.id, 'Check the price list');
      chk(rw2 === 'Nobody yet', `${tag} with its project paused the task is held, so its card does not say On a schedule`, String(rw2));
      projects.edit(watch.id, { paused: false });
      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await page.evaluate(() => showTab('tasks'));

      /* A task put on hold from its page. */
      await openTask(page, launch.id, 1);
      chk(await text(page, '#tk-hold') === 'Put on hold', `${tag} a task's page offers Put on hold`, await text(page, '#tk-hold'));
      chk(await text(page, '#tk-hold-hint') === 'While a task is on hold, Kosmos does not nudge anyone about it or hand it out.',
        `${tag} #6683 CONTROL: a task not on hold names nobody who lifts a hold`, await text(page, '#tk-hold-hint'));
      await page.click('#tk-hold');
      await page.waitForFunction(() => document.getElementById('tk-hold').textContent === 'Take off hold', null, { timeout: 5000 }).catch(() => {});
      chk(await text(page, '#tk-hold') === 'Take off hold', `${tag} pressing it puts the task on hold; the button then offers Take off hold`, await text(page, '#tk-hold'));
      chk(/^You put this on hold, so only you can take it off, here\./.test(await text(page, '#tk-hold-hint') || ''),
        `${tag} #6683 the person's own hold says only they take it off`, await text(page, '#tk-hold-hint'));
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
      // #5864: the paused project's BUILT task is waiting for review, not stalled: under Built but waiting, not On hold.
      chk(!held2.includes('Finish the cover'), `${tag} a built task in a paused project is not under On hold`, JSON.stringify(held2));
      const built2 = await tileRows(page, 'built');
      chk(built2.includes('Finish the cover'), `${tag} a built task in a paused project is under Built but waiting`, JSON.stringify(built2));
      const pausedNote = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row')]
        .map((r) => [(r.querySelector('.tl') || {}).textContent, !!r.querySelector('.tsk-paused')]));
      chk(pausedNote.some(([s, has]) => s === 'Finish the cover' && has), `${tag} its row says the project is paused`, JSON.stringify(pausedNote));
      chk(pausedNote.some(([s, has]) => s === 'Order proofs' && !has), `${tag} a task in a project that is not paused carries no paused note (control)`, JSON.stringify(pausedNote));
      // One control per half of the row's condition: built, AND in a paused project.
      chk(pausedNote.some(([s, has]) => s === 'Draft the plan' && !has), `${tag} an unbuilt task in a paused project carries no paused note (its On hold group says it)`, JSON.stringify(pausedNote));
      chk(pausedNote.some(([s, has]) => s === 'Proof the index' && !has), `${tag} a built task in a project that is not paused carries no paused note`, JSON.stringify(pausedNote));
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
      chk(await text(page, '#pj-one-pause') === 'Resume it' && await page.isEnabled('#pj-one-pause'),
        `${tag} #5391 Settings agrees: Resume it, and its button is usable (review 3: it never sticks disabled)`, await text(page, '#pj-one-pause'));
      await page.evaluate((pid) => tskGoToProject(pid), winter.id);
      await page.waitForSelector('#pj-head-pause', { state: 'visible', timeout: 5000 });
      await page.click('#pj-head-pause');
      await page.waitForFunction(() => /Pause/.test(document.getElementById('pj-head-pause').textContent), null, { timeout: 5000 }).catch(() => {});
      chk(/^\s*Pause\s*$/.test(await text(page, '#pj-head-pause') || '') && await page.isHidden('#pj-one-paused'),
        `${tag} #5391 Resume resumes it, and the Paused line goes`, await text(page, '#pj-head-pause'));
      /* kosmos#6072: the goal-ask line. The board's real answer, with a give-up added to this project only (the
         Assigner never runs here); then the same answer without it, so the line must go (the control). */
      // Review 2: the look this page had, put back after the block, so every later check runs in the look it always did.
      const lookBefore = await page.evaluate(() => document.documentElement.getAttribute('data-look'));
      /* Review 3: in try/finally, so a throw inside cannot leave the later checks on the faked answer or the new look. */
      try {
        const GAVE = { at: Date.now() - 60000, tries: 3, agent: 'Echo', session: 'echo', because: 'could_not' };
        let inject = true;
        await page.route('**/api/projects', async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          let res; let body;
          try { res = await route.fetch(); body = await res.json(); } catch { await route.abort().catch(() => {}); return; }
          for (const proj of body.projects || []) if (proj.id === winter.id) proj.goalAskGaveUp = inject ? GAVE : null;
          try { await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-type': 'application/json' } }); } catch { await route.abort().catch(() => {}); }
        });
        await page.evaluate(() => { document.documentElement.setAttribute('data-look', 'new'); });
        await page.evaluate(async (pid) => { await pjReload(); tskGoToProject(pid); }, winter.id);
        await page.waitForFunction(() => { const e = document.getElementById('pj-one-goalask'); return e && !e.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(await page.isVisible('#pj-one-goalask')
          && /^Kosmos could not reach Echo to plan the next work toward this project's goal \(3 tries in the last day\)/.test(await text(page, '#pj-one-goalask') || ''),
          `${tag} #6072 a project the Assigner gave up on today says so under its name`, await text(page, '#pj-one-goalask'));
        const row = await page.evaluate(() => {
          const e = document.getElementById('pj-one-goalask');
          const head = e && e.closest('.pjmidhead');
          if (!e || !head) return null;
          const r = e.getBoundingClientRect(); const h = head.getBoundingClientRect();
          return { w: Math.round(r.width), hw: Math.round(h.width), x: Math.round(r.left - h.left) };
        });
        /* Measured: this holds with or without the line's flex: 1 0 100% rule (removing it passed at both 1400 and 390),
           because a sentence this long cannot sit beside the title row. So this does NOT test the rule; it pins only
           that, as rendered today, the line is not squeezed. The rule is kept for parity with the paused line. */
        chk(!!row && row.w >= row.hw - 2 && row.x <= 2, `${tag} #6072 the goal-ask line takes its own full-width row (not squeezed beside the title row)`, JSON.stringify(row));
        inject = false;
        await page.evaluate(async (pid) => { await pjReload(); tskGoToProject(pid); }, winter.id);
        await page.waitForFunction(() => { const e = document.getElementById('pj-one-goalask'); return e && e.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(await page.isHidden('#pj-one-goalask'), `${tag} #6072 the line goes once the give-up does (control)`, await text(page, '#pj-one-goalask'));
      } finally {
        await page.unroute('**/api/projects');
        await page.evaluate((v) => { if (v === null) document.documentElement.removeAttribute('data-look'); else document.documentElement.setAttribute('data-look', v); }, lookBefore);
      }
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
      /* kosmos#6893: Every so many minutes shows only its number box (no time, no day); 30 saved is the board's own
         "every 30 minutes", and Save goes off. */
      await page.selectOption('#tk-repeat-every', 'minutes');
      chk(await page.isVisible('#tk-repeat-mins') && await page.isHidden('#tk-repeat-at') && await page.isHidden('#tk-repeat-day') && await page.isEnabled('#tk-repeat-save'),
        `${tag} #6893 Every so many minutes shows the number box only, with Save on`, String(await page.isVisible('#tk-repeat-mins')));
      await page.fill('#tk-repeat-mins', '30');
      await page.click('#tk-repeat-save');
      await page.waitForFunction(() => /every 30 minutes/.test(document.getElementById('tk-repeat-line').textContent), null, { timeout: 5000 }).catch(() => {});
      chk(/^Repeats every 30 minutes\. /.test(await text(page, '#tk-repeat-line') || '') && await page.isDisabled('#tk-repeat-save') && await page.inputValue('#tk-repeat-mins') === '30',
        `${tag} #6893 Save sets every 30 minutes: the board's sentence says it and Save goes off`, await text(page, '#tk-repeat-line'));
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
      /* kosmos#4787 slice 3: "If missed, tell", shown once the task repeats: Nobody, Me and the project's agents, showing what
         is stored. Choosing Me saves at once (the board stores the person as reviewer), says Saved. and keeps focus on the
         choice; Nobody puts it back. */
      const revOpts = await page.evaluate(() => [...document.querySelectorAll('#tk-review-who option')].map((o) => o.value));
      chk(await page.isVisible('#tk-review-who') && await page.inputValue('#tk-review-who') === 'none' && revOpts[0] === 'none' && revOpts[1] === 'me',
        `${tag} #4787 slice 3 a repeating task offers If missed, tell: Nobody, Me and the project's agents, showing Nobody`, JSON.stringify(revOpts));
      await page.focus('#tk-review-who');
      await page.selectOption('#tk-review-who', 'me');
      await page.waitForFunction(() => document.getElementById('tk-review-msg').textContent === 'Saved.', null, { timeout: 5000 }).catch(() => {});
      const revStored = tasks.byNumber(projects.readAll().find((x) => x.id === winter.id), 1) || {};
      const revFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
      chk(await text(page, '#tk-review-msg') === 'Saved.' && revStored.repeatReviewerPerson === true && await page.inputValue('#tk-review-who') === 'me' && revFocus === 'tk-review-who',
        `${tag} #4787 slice 3 choosing Me saves it, says Saved. and keeps focus on the choice`, JSON.stringify({ msg: await text(page, '#tk-review-msg'), person: revStored.repeatReviewerPerson, focus: revFocus }));
      await page.selectOption('#tk-review-who', 'none');
      await page.waitForFunction(() => document.getElementById('tk-review-who').value === 'none' && !document.getElementById('tk-review-who').disabled, null, { timeout: 5000 }).catch(() => {});
      const revBack = tasks.byNumber(projects.readAll().find((x) => x.id === winter.id), 1) || {};
      chk(revBack.repeatReviewerPerson === undefined && revBack.repeatReviewer === undefined,
        `${tag} #4787 slice 3 Nobody puts it back (control: the Me above was stored)`, JSON.stringify({ person: revBack.repeatReviewerPerson, who: revBack.repeatReviewer }));
      await page.fill('#tk-repeat-at', '');
      chk(await page.isDisabled('#tk-repeat-save') && /Choose a time/.test(await text(page, '#tk-repeat-msg') || ''),
        `${tag} #4787 an empty time is no choice: Save stays off and the page asks for a time`, await text(page, '#tk-repeat-msg'));
      await page.selectOption('#tk-repeat-every', '');
      await page.click('#tk-repeat-save');
      await page.waitForFunction(() => document.getElementById('tk-repeat-line').hidden, null, { timeout: 5000 }).catch(() => {});
      chk(await page.isHidden('#tk-repeat-line') && await page.isHidden('#tk-repeat-when') && await page.inputValue('#tk-repeat-every') === '',
        `${tag} #4787 Never clears it: no repeat line, back to a one-off`, await text(page, '#tk-repeat-line'));
      chk(await page.isHidden('#tk-review-row'), `${tag} #4787 slice 3 a one-off task has no If missed, tell`);

      /* A project an agent paused says so where it is resumed. */
      await openSettings(page, summer.id);
      chk(await text(page, '#pj-one-pause') === 'Resume it' && /^An agent paused it\./.test(await text(page, '#pj-one-pause-hint') || ''),
        `${tag} a project an agent paused says an agent paused it`, JSON.stringify([await text(page, '#pj-one-pause'), await text(page, '#pj-one-pause-hint')]));

      /* #6683: a hold made outside the screen (here the engine, as an agent's CLI does) says an agent or the person can
         lift it. Taken off again after, so the next viewport starts with the same tasks held. */
      tasks.setOnHold(launch.id, 2, true);
      await openTask(page, launch.id, 2);
      await page.waitForFunction(() => document.getElementById('tk-hold').textContent === 'Take off hold', null, { timeout: 5000 }).catch(() => {});
      chk(/^This was put on hold outside this screen \(by an agent, or with kosmos task hold\), so an agent or you can take it off\./.test(await text(page, '#tk-hold-hint') || ''),
        `${tag} #6683 a hold made outside the screen says an agent or the person can take it off`, await text(page, '#tk-hold-hint'));
      tasks.setOnHold(launch.id, 2, false);

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
