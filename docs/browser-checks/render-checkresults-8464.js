// Browser-check-surface: tk-donewhen tk-donewhen-row tsk-checks
'use strict';
/**
 * #8464 item 2: what agents report about a task's done-when checks (kosmos task check), on the screen.
 *
 * What this pins, and why each line can fail:
 *  - a task's page lists its checks (it never did before), each with what an agent says about it, by the agent's
 *    name: "Ada says met: ...", "Ada says not met: ...", or "Not reported yet",
 *  - an agent's words reach the page as text: a report carrying markup paints as those characters, not as an element,
 *  - a task with no checks shows no "Done when" row at all,
 *  - the Tasks row of a task with reports says "1 of 3 checks reported met, 1 reported not met"; a task with checks
 *    and no reports says nothing about them,
 *  - light and dark, 1400 and 390 wide, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-checkresults-8464.js            # headed
 *   HEADED=0 node docs/browser-checks/render-checkresults-8464.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-checkresults-8464: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a builder' })]);
  const proj = projects.create({ name: 'Release notes' });
  projects.addAgent(proj.id, 'ada', null);
  const made = { via: 'process', by: 'ada' };
  tasks.create(proj.id, { sentence: 'Write the notes', who: 'ada', made,                                       // 1
    doneWhen: ['the notes build', 'they are on the page', 'the person has read them'] });
  tasks.setCheckResult(proj.id, 1, 1, true, 'yarn docs built with no warnings', { by: 'ada' });
  tasks.setCheckResult(proj.id, 1, 2, false, 'the page shows <b>old</b> notes still', { by: 'ada' });
  tasks.create(proj.id, { sentence: 'Checks, none reported', who: 'ada', made, doneWhen: ['it ships'] });   // 2
  tasks.create(proj.id, { sentence: 'No checks at all', who: 'ada', made });                                // 3
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openTask = async (page, n) => {
    await page.evaluate(async ([id, num]) => { await loadProjects(); showTab('projects'); openProject(id); openTaskPage(num); }, [proj.id, n]);
    await page.waitForFunction((num) => TK_OPEN === num, n, { timeout: 8000 });
  };
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 390]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      /* The Tasks row. */
      await page.evaluate(() => showTab('tasks'));
      await page.waitForFunction(() => document.querySelectorAll('#tsk-groups .tsk-row').length >= 3, null, { timeout: 8000 });
      const rows = await page.evaluate(() => [...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => ({
        n: Number(r.querySelector('.n').textContent.slice(1)),
        checks: [...r.querySelectorAll('.tsk-checks')].map((e) => e.textContent),
      })));
      const row = (n) => rows.find((r) => r.n === n) || { checks: ['(no row)'] };
      chk(JSON.stringify(row(1).checks) === JSON.stringify(['1 of 3 checks reported met, 1 reported not met']), `${tag} the row counts the reports`, JSON.stringify(row(1).checks));
      chk(row(2).checks.length === 0 && rows.some((r) => r.n === 2), `${tag} a row with checks but no reports says nothing of them`, JSON.stringify(row(2).checks));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `checkresults-tasks-${theme}-${width}.png`), fullPage: true }); }

      /* The task's own page. */
      await openTask(page, 1);
      await page.waitForFunction(() => !document.getElementById('tk-donewhen-row').hidden, null, { timeout: 8000 }).catch(() => {});
      const one = await page.evaluate(() => {
        const rowEl = document.getElementById('tk-donewhen-row');
        const list = document.getElementById('tk-donewhen');
        const box = rowEl.getBoundingClientRect();
        return {
          hidden: rowEl.hidden, visible: box.height > 0,
          items: [...list.querySelectorAll(':scope > li')].map((li) => ({ check: li.firstChild ? li.firstChild.textContent : '', says: (li.querySelector('.why') || {}).textContent || '' })),
          markup: list.querySelectorAll('b').length,
          right: box.right, vw: window.innerWidth,
        };
      });
      chk(!one.hidden && one.visible, `${tag} the task page shows its checks`);
      chk(JSON.stringify(one.items) === JSON.stringify([
        { check: 'the notes build', says: 'Ada says met: yarn docs built with no warnings' },
        { check: 'they are on the page', says: 'Ada says not met: the page shows <b>old</b> notes still' },
        { check: 'the person has read them', says: 'Not reported yet' },
      ]), `${tag} each check with what the agent says, by name`, JSON.stringify(one.items));
      chk(one.markup === 0, `${tag} an agent's words paint as text, never as markup`, String(one.markup));
      chk(one.right <= one.vw + 1, `${tag} the checks stay inside the window`, one.right + ' > ' + one.vw);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `checkresults-task-${theme}-${width}.png`), fullPage: true });

      await openTask(page, 3);
      const none = await page.evaluate(() => ({ hidden: document.getElementById('tk-donewhen-row').hidden, items: document.querySelectorAll('#tk-donewhen > li').length }));
      chk(none.hidden === true, `${tag} a task with no checks has no Done when row (control: the list above did paint)`, JSON.stringify(none));

      const bad = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      chk(!bad, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
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
