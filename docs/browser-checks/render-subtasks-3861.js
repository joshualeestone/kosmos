// Browser-check-surface: panel-tasks tsk-groups pj-tasklist tk-subs tk-subadd tk-partof nt-parent
'use strict';
/**
 * Subtasks on the screen (#3861 part 2; part 1, the data, is #3873).
 *
 * What this pins, and why each line can fail:
 *  - in the Tasks view a subtask sits indented under its parent when both are in the same list,
 *    two levels deep; a third level is drawn at the second and names its parent,
 *  - a parent carries its "2/5" chip (done / all, from the engine), and the chip folds its
 *    subtasks away and back,
 *  - a subtask whose parent is in another group (a closed child under an open parent) stays top
 *    level there and says "Part of #N ...",
 *  - a parent whose subtasks are all closed says "all subtasks done" and Close it closes it (and
 *    closing the last child did not close it),
 *  - the project column nests the same way and shows the chip,
 *  - a task's page lists its subtasks, names what it is part of, and "+ Add subtask" opens New
 *    task with "Part of" already set; creating it files the subtask under that task,
 *  - light and dark, 1400 and 390 wide, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-subtasks-3861.js            # headed
 *   HEADED=0 node docs/browser-checks/render-subtasks-3861.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subtasks-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subtasks-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subtasks-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subtasks-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-subtasks-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
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
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const launch = projects.create({ name: 'Spring launch' });
  projects.addAgent(launch.id, 'ada', null);
  tasks.create(launch.id, { sentence: 'Plan the launch week' });                    // 1 parent
  tasks.create(launch.id, { sentence: 'Book the venue', parent: 1 });               // 2 child
  tasks.create(launch.id, { sentence: 'Write the invitations', parent: 1 });        // 3 child
  tasks.create(launch.id, { sentence: 'Pick the paper stock', parent: 3 });         // 4 grandchild
  tasks.create(launch.id, { sentence: 'Order the paper', parent: 4 });              // 5 level three
  tasks.create(launch.id, { sentence: 'Old guest list', parent: 1 });               // 6 closed child
  tasks.close(launch.id, 6);
  tasks.create(launch.id, { sentence: 'Tidy the press kit' });                      // 7 parent, all done
  tasks.create(launch.id, { sentence: 'Fix the logo file', parent: 7 });            // 8
  tasks.close(launch.id, 8);
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const rowsOf = () => [...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => ({
    n: Number(r.querySelector('.n').textContent.slice(1)),
    depth: r.classList.contains('d2') ? 2 : r.classList.contains('d1') ? 1 : 0,
    part: (r.querySelector('.tsk-part') || {}).textContent || '',
    chip: (r.querySelector('.tsk-chip') || {}).textContent || '',
    allDone: /all subtasks done/.test(r.querySelector('.meta').textContent),
    group: (() => { const g = r.closest('.tsk-grp'); const h = g && (g.querySelector('h3') || g.querySelector('summary')); return h ? h.textContent : ''; })(),
  }));
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 390]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await page.evaluate(() => showTab('tasks'));
      await page.waitForFunction(() => document.querySelectorAll('#tsk-groups .tsk-row').length > 0, null, { timeout: 8000 });
      await page.evaluate(() => { const f = document.querySelector('#tsk-groups .tsk-fold'); if (f) f.open = true; });
      const rows = await page.evaluate(rowsOf);
      const at = (n) => rows.find((r) => r.n === n) || {};
      const order = rows.filter((r) => !/Closed/.test(r.group)).map((r) => r.n);
      /* Nobody-on-it holds 1..5 and 7 (all unassigned): 7 then 1 (newest first), 1's family under it. */
      /* The family: every row after 1 until the next top-level row is one of its descendants, and
         all four seeded ones are there (a subtask added by the first pass joins it later). */
      const open = rows.filter((r) => !/Closed/.test(r.group));
      const i1 = open.findIndex((r) => r.n === 1);
      const fam = [];
      for (let k = i1 + 1; i1 > -1 && k < open.length && open[k].depth > 0; k += 1) fam.push(open[k].n);
      chk(i1 > -1 && [2, 3, 4, 5].every((n) => fam.includes(n)) && fam.every((n) => n >= 2 && n !== 7 && n !== 8),
        `${tag} the family sits together under its parent`, JSON.stringify(order));
      chk(at(1).depth === 0 && at(2).depth === 1 && at(3).depth === 1 && at(4).depth === 2 && at(5).depth === 2,
        `${tag} two levels drawn, the third flattened to the second`, JSON.stringify(rows.map((r) => [r.n, r.depth])));
      chk(!at(2).part && !at(4).part, `${tag} a row its indent explains says nothing more`, JSON.stringify([at(2).part, at(4).part]));
      chk(/^Part of #4 Pick the paper stock/.test(at(5).part), `${tag} the flattened third level names its parent`, at(5).part);
      /* Direct subtasks only (2, 3, 6; 6 closed): a grandchild is counted by its own parent. */
      chk(/(^|\D)1\/3$/.test(at(1).chip), `${tag} the parent's chip counts its direct subtasks (1 of 3 done)`, at(1).chip);
      /* 0/1 on the first pass; the first pass then adds a subtask under 3, so later passes read 0/2. */
      chk(/(^|\D)0\/[12]$/.test(at(3).chip), `${tag} a subtask with its own subtask carries its own chip`, at(3).chip);
      chk(/Closed/.test(at(6).group) && at(6).depth === 0 && /^Part of #1 Plan the launch week/.test(at(6).part),
        `${tag} a closed child under an open parent stays in Closed and says what it is part of`, JSON.stringify(at(6)));
      chk(at(7).allDone && /1\/1/.test(at(7).chip), `${tag} a parent with every subtask closed says so (and stayed open)`, JSON.stringify(at(7)));
      const bad = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      chk(!bad, `${tag} no sideways scroll`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `subtasks-tasks-${theme}-${width}.png`), fullPage: true }); }

      if (theme === 'light' && width === 1400) {
        /* The fold: the chip hides the family and brings it back. */
        await page.click('#tsk-groups .tsk-chip[data-fold$="#1"]');
        const folded = await page.evaluate(rowsOf);
        chk(!folded.some((r) => [2, 3, 4, 5].includes(r.n)) && folded.some((r) => r.n === 1), '[fold] the chip folds the subtasks away', JSON.stringify(folded.map((r) => r.n)));
        const exp = await page.evaluate(() => document.querySelector('#tsk-groups .tsk-chip[data-fold$="#1"]').getAttribute('aria-expanded'));
        chk(exp === 'false', '[fold] the chip says it is folded', exp);
        await page.click('#tsk-groups .tsk-chip[data-fold$="#1"]');
        chk((await page.evaluate(rowsOf)).some((r) => r.n === 4), '[fold] and brings them back');
        /* Close it, on the all-done parent. */
        await page.click('#tsk-groups [data-close-parent$="#7"]');
        await page.waitForFunction(() => /Closed task 7/.test(document.getElementById('tsk-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        const closed = projects.readAll().find((p) => p.id === launch.id).tasks.find((t) => t.number === 7);
        chk(!!(closed && closed.closedAt), '[close] Close it closed the parent', JSON.stringify(closed && closed.closedAt));
        tasks.reopen(launch.id, 7);

        /* The project column. */
        await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, launch.id);
        await page.waitForFunction(() => document.querySelectorAll('#pj-tasklist .tkcard').length > 0, null, { timeout: 8000 });
        const col = await page.evaluate(() => [...document.querySelectorAll('#pj-tasklist .tkcard')].map((c) => ({
          n: Number(c.dataset.task), sub: c.classList.contains('sub2') ? 2 : c.classList.contains('sub1') ? 1 : 0,
          chip: (c.querySelector('.tsk-chip') || {}).textContent || '', part: (c.querySelector('.tkcard-part-of') || {}).textContent || '' })));
        const c1 = col.find((c) => c.n === 1) || {};
        chk(col.length === 5 && col[0].n === 7, '[column] five cards, newest top-level first', JSON.stringify(col.map((c) => c.n)));
        chk(/^1\/3$/.test(c1.chip) && col.some((c) => c.sub === 1), '[column] the parent carries its chip and a subtask nests under it', JSON.stringify(col));
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'subtasks-project-column.png'), fullPage: false });

        /* The task page. */
        await page.evaluate(() => openTaskPage(1));
        await page.waitForTimeout(300);
        const tp = await page.evaluate(() => ({
          subs: [...document.querySelectorAll('#tk-subs .tksub')].map((b) => b.dataset.sub + ':' + b.querySelector('.tksub-s').textContent),
          partHidden: document.getElementById('tk-partof-row').hidden,
          allDoneHidden: document.getElementById('tk-subs-done').hidden,
        }));
        chk(JSON.stringify(tp.subs) === JSON.stringify(['2:Open', '3:Open', '6:Done']) && tp.partHidden && tp.allDoneHidden,
          '[task page] the parent lists its direct subtasks, stands alone, not all done', JSON.stringify(tp));
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'subtasks-task-page.png'), fullPage: false });
        await page.click('#tk-subs .tksub[data-sub="3"]');
        await page.waitForTimeout(300);
        const child = await page.evaluate(() => ({ title: document.getElementById('tk-title').textContent, up: document.getElementById('tk-partof').textContent, shown: !document.getElementById('tk-partof-row').hidden }));
        chk(child.title === 'Write the invitations' && child.shown && child.up === '#1 Plan the launch week', '[task page] a subtask opens and names what it is part of', JSON.stringify(child));
        /* + Add subtask: the dialog opens with Part of set to this task. */
        await page.click('#tk-subadd');
        await page.waitForSelector('#nt-modal:not([hidden])', { timeout: 5000 });
        const preset = await page.evaluate(() => document.getElementById('nt-parent').value);
        chk(preset === '3', '[add subtask] New task opens with Part of set to this task', preset);
        await page.fill('#nt-what', 'Proofread the invitations');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'subtasks-new-task-dialog.png'), fullPage: false });
        await page.click('#nt-go');
        await page.waitForFunction(() => document.getElementById('nt-modal').hidden, null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        const made = projects.readAll().find((p) => p.id === launch.id).tasks.find((t) => t.sentence === 'Proofread the invitations');
        chk(!!made && made.parent === 3, '[add subtask] the new task is filed under that task', JSON.stringify(made && made.parent));
        const after = await page.evaluate(() => ({ title: document.getElementById('tk-title').textContent, subs: [...document.querySelectorAll('#tk-subs .tksub')].map((b) => b.dataset.sub) }));
        chk(after.title === 'Write the invitations' && made && after.subs.includes(String(made.number)), '[add subtask] it stays on the task page, the new subtask in its list', JSON.stringify(after));
        /* The plain New task dialog starts at none. */
        await page.evaluate(() => openNewTask(PJ_CURRENT));
        const none = await page.evaluate(() => ({ v: document.getElementById('nt-parent').value, opts: document.getElementById('nt-parent').options.length }));
        chk(none.v === '' && none.opts > 1, '[new task] Part of starts at None and offers the open tasks', JSON.stringify(none));
        await page.evaluate(() => leaveNewTask());
      }
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
