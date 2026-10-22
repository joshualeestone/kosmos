// Browser-check-surface: panel-tasks tsk-groups pj-tasklist tk-subs tk-subadd tk-partof nt-parent tk-subs-built tk-subs-closeall
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
    /* In the finished-work fold, by the element, not its label (#3949 renamed it from Closed to Completed). */
    folded: !!r.closest('.tsk-fold'),
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
      const order = rows.filter((r) => !r.folded).map((r) => r.n);
      /* Unassigned holds 1..5 and 7 (all unassigned): 7 then 1 (newest first), 1's family under it. */
      /* The family: every row after 1 until the next top-level row is one of its descendants, and
         all four seeded ones are there (a subtask added by the first pass joins it later). */
      const open = rows.filter((r) => !r.folded);
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
      chk(at(6).folded && /^Completed/.test(at(6).group) && at(6).depth === 0 && /^Part of #1 Plan the launch week/.test(at(6).part),
        `${tag} a closed child under an open parent stays in Completed and says what it is part of`, JSON.stringify(at(6)));
      /* The two lists above must hold open rows only: a label change once let closed rows into them unnoticed. */
      chk(!order.includes(6) && !order.includes(8), `${tag} the open order leaves out the finished rows`, JSON.stringify(order));
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
        /* The five newest open (7, 5, 4, 3, 2; 1 is sixth), nested among themselves: 3 and 2 lost
           their parent to the cap, so they stand top level and name it; 4 nests under 3, 5 under 4. */
        const cn = (n) => col.find((c) => c.n === n) || {};
        chk(JSON.stringify(col.map((c) => c.n)) === JSON.stringify([7, 3, 4, 5, 2]), '[column] the five newest open tasks, a family kept together', JSON.stringify(col.map((c) => c.n)));
        chk(cn(4).sub === 1 && cn(5).sub === 2 && cn(3).sub === 0, '[column] a subtask nests under its parent', JSON.stringify(col));
        chk(/^Part of #1 Plan the launch week/.test(cn(3).part) && /^Part of #1 /.test(cn(2).part) && !cn(4).part, '[column] one whose parent is past the cap names it; one under its parent does not', JSON.stringify(col));
        chk(/^0\/1 subtasks done$/.test(cn(3).chip) && /^1\/1, all subtasks done$/.test(cn(7).chip), '[column] a parent carries its chip', JSON.stringify(col));
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
        await page.fill('#nt-done', 'No typos left');   // kosmos#5956
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
        /* A preset belongs to its "+ Add subtask" press: Cancel it, then a plain New task starts at None. */
        await page.evaluate(() => openTaskPage(3));
        await page.click('#tk-subadd');
        await page.waitForSelector('#nt-modal:not([hidden])', { timeout: 5000 });
        await page.click('#nt-back');
        await page.evaluate(() => openNewTask(PJ_CURRENT));
        const afterCancel = await page.evaluate(() => document.getElementById('nt-parent').value);
        chk(afterCancel === '', '[new task] after a cancelled "+ Add subtask", a plain New task starts at None', afterCancel);
        await page.evaluate(() => leaveNewTask());
      }
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await page.close();
    }
    /* The dialog's own project switch keeps the words but never the Part of pick: a task number means
       nothing in another project. A second project with a task #3 is the dangerous case. */
    {
      const other = projects.create({ name: 'Newsletter' });
      for (const s of ['Pick a template', 'Write the intro', 'Send the test']) tasks.create(other.id, { sentence: s });
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await page.evaluate(async (id) => { await loadProjects(); TSK.proj = null; openNewTask(null, 'tasks'); document.getElementById('nt-proj').value = id; document.getElementById('nt-proj').dispatchEvent(new Event('change')); }, launch.id);
      await page.selectOption('#nt-parent', '3');
      await page.evaluate((id) => { const s = document.getElementById('nt-proj'); s.value = id; s.dispatchEvent(new Event('change')); }, other.id);
      const sw = await page.evaluate(() => ({ v: document.getElementById('nt-parent').value, first: (document.getElementById('nt-parent').options[1] || {}).textContent }));
      chk(sw.v === '' && /^#3 Send the test$/.test(sw.first || ''), '[new task] switching project in the dialog drops the Part of pick and lists the new project\'s tasks', JSON.stringify(sw));
      await page.close();
    }
    /* kosmos#6501: every subtask built or closed, so the parent's page offers "Close them and this task". One press
       closes the built subtasks and then the parent; a refusal stops it there, names the task, and leaves the parent
       open. A fresh project per run: 1 the parent, 2, 3 and 5 built, 4 already closed. */
    for (const width of [1400, 390]) {
      const tag = `[rollup ${width}]`;
      const roll = projects.create({ name: 'Roll-up ' + width });
      projects.addAgent(roll.id, 'ada', null);
      tasks.create(roll.id, { sentence: 'Ship the brochure' });
      for (const s of ['Draft the copy', 'Lay out the pages', 'Old proof', 'Print the cover']) tasks.create(roll.id, { sentence: s, parent: 1, who: 'ada' });
      for (const n of [2, 3, 5]) tasks.setBuilt(roll.id, n, { by: 'ada' });
      tasks.close(roll.id, 4);
      const read = (n) => projects.readAll().find((p) => p.id === roll.id).tasks.find((t) => t.number === n);
      const closed = () => JSON.stringify([1, 2, 3, 4, 5].map((n) => (read(n).closedAt ? n : 0)).filter(Boolean));
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const openParent = async () => {
        await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); openTaskPage(1); }, roll.id);
        await page.waitForFunction(() => !document.getElementById('tk-subs-built').hidden, null, { timeout: 8000 });
      };
      await openParent();
      const line = await page.evaluate(() => ({
        shown: !document.getElementById('tk-subs-built').hidden, text: document.getElementById('tk-subs-built').textContent,
        allDone: !document.getElementById('tk-subs-done').hidden }));
      chk(line.shown && !line.allDone && /Close them and this task$/.test(line.text), `${tag} every subtask built or closed: the line offers Close them and this task`, JSON.stringify(line));

      // The refusal arm: 3's close is refused after 2 closed, so it stops there: 5 is never asked, the parent stays open,
      // and the line names 3 and counts what it already closed (review 3).
      await page.route('**/task/3/close', (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'that task cannot be closed right now' }) }));
      await page.click('#tk-subs-closeall');
      await page.waitForFunction(() => /^Task #3: /.test(document.getElementById('tk-msg').textContent), null, { timeout: 8000 });
      const refusedMsg = await page.evaluate(() => document.getElementById('tk-msg').textContent);
      chk(refusedMsg === 'Task #3: that task cannot be closed right now. 1 subtask before it is closed. This task is still open.', `${tag} a refusal names the task, counts what closed before it, and says the parent is still open`, refusedMsg);
      chk(closed() === JSON.stringify([2, 4]), `${tag} it stopped at the refusal: 2 closed; 3, the later 5 and the parent open`, closed());
      await page.unroute('**/task/3/close');

      // Review 2: a request that never answers (aborted) on 5: 3 closes, 5 and the parent stay open, and the line says it could not finish.
      await openParent();
      await page.route('**/task/5/close', (r) => r.abort('connectionreset'));
      await page.click('#tk-subs-closeall');
      await page.waitForFunction(() => /^We could not finish/.test(document.getElementById('tk-msg').textContent), null, { timeout: 8000 });
      const threwMsg = await page.evaluate(() => document.getElementById('tk-msg').textContent);
      chk(threwMsg === 'We could not finish closing them. The list below shows where it stopped.', `${tag} a request with no answer says it could not finish`, threwMsg);
      chk(closed() === JSON.stringify([2, 3, 4]), `${tag} it stopped where the request failed: 3 closed, 5 and the parent open`, closed());
      await page.unroute('**/task/5/close');

      // Review 4: the person opens another task while the press runs; the refusal that arrives later is not written on that page.
      await openParent();
      await page.route('**/task/5/close', async (r) => {
        try {   // #6022: a page closed before the delayed answer must not crash the check at teardown
          await new Promise((res) => setTimeout(res, 1500));
          await r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'that task cannot be closed right now' }) });
        } catch { /* the page went away first */ }
      });
      // Review 5: wait for the refusal itself and for the press to finish, so the check reads after it, never before.
      const refused = page.waitForResponse((resp) => /\/task\/5\/close$/.test(resp.url()), { timeout: 15000 });
      await page.click('#tk-subs-closeall');
      await page.evaluate(() => openTaskPage(2));
      await refused;
      await page.waitForFunction(() => !document.getElementById('tk-subs-closeall').disabled, null, { timeout: 15000 });
      const away = await page.evaluate(() => ({ open: TK_OPEN, msg: document.getElementById('tk-msg').textContent }));
      chk(away.open === 2 && away.msg === '', `${tag} a refusal that arrives after the person opened another task is not written there`, JSON.stringify(away));
      // kosmos#6928: it is not dropped either: the page-wide toast says it, naming the parent.
      await page.waitForFunction(() => { const el = document.getElementById('msg-toast'); return el && !el.hidden && /^Closing task #1 /.test(el.textContent); }, null, { timeout: 8000 });
      const toast = await page.evaluate(() => document.getElementById('msg-toast').textContent);
      chk(toast === 'Closing task #1 stopped at task #5: that task cannot be closed right now. Task #1 is still open.', `${tag} #6928 the refusal reaches the person on the page they moved to, as a toast`, toast);
      chk(closed() === JSON.stringify([2, 3, 4]), `${tag} and nothing more closed`, closed());
      await page.unroute('**/task/5/close');

      // The press, pressed twice in a row (review 2): what is left (5) closes, then the parent, each asked once; the closed
      // subtasks are never asked again.
      await openParent();
      const asked = [];
      const count = (req) => { const m = /\/task\/(\d+)\/close$/.exec(req.url()); if (m && req.method() === 'POST') asked.push(Number(m[1])); };
      page.on('request', count);
      await page.dblclick('#tk-subs-closeall');
      await page.waitForFunction(() => document.getElementById('tk-subs-built').hidden, null, { timeout: 8000 });   // a timeout here is the failure, not a later count
      await page.waitForTimeout(500);
      page.off('request', count);
      chk(JSON.stringify(asked) === JSON.stringify([5, 1]), `${tag} a double press asks each close once: 5, then the parent`, JSON.stringify(asked));
      chk(closed() === JSON.stringify([1, 2, 3, 4, 5]), `${tag} one press closed the built subtasks and then the parent`, closed());
      await page.waitForFunction(() => !document.getElementById('tk-subs-closeall').disabled, null, { timeout: 8000 });
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
      chk(focused === 'tk-back', `${tag} focus moves to the top of the page (not Reopen) once the line is gone`, String(focused));
      chk(await page.evaluate(() => document.getElementById('tk-msg').textContent) === '', `${tag} no message after it succeeded`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'subtasks-rollup-' + width + '.png'), fullPage: false });

      /* kosmos#6928: the closes land but the reload that follows fails (the board's project read is refused). The page
         knows the read failed (PJ_READ_FAILED), and focus is not moved to the top of a page that still shows the old
         line. Its own project, so the arms above are untouched. */
      const roll2 = projects.create({ name: 'Roll-up reload ' + width });
      projects.addAgent(roll2.id, 'ada', null);
      tasks.create(roll2.id, { sentence: 'Send the mailer' });
      tasks.create(roll2.id, { sentence: 'Write the mailer', parent: 1, who: 'ada' });
      tasks.setBuilt(roll2.id, 2, { by: 'ada' });
      const read2 = (n) => projects.readAll().find((p) => p.id === roll2.id).tasks.find((t) => t.number === n);
      await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); openTaskPage(1); }, roll2.id);
      await page.waitForFunction(() => !document.getElementById('tk-subs-built').hidden, null, { timeout: 8000 });
      await page.route('**/api/projects', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.continue()));
      await page.focus('#tk-subs-closeall');
      await page.click('#tk-subs-closeall');
      await page.waitForFunction(() => PJ_READ_FAILED === true && !document.getElementById('tk-subs-closeall').disabled, null, { timeout: 8000 });
      const afterFail = await page.evaluate(() => ({ failed: PJ_READ_FAILED, focus: document.activeElement && document.activeElement.id }));
      chk(!!read2(2).closedAt && !!read2(1).closedAt, `${tag} #6928 the closes landed though the reload failed`, JSON.stringify([read2(1).closedAt, read2(2).closedAt]));
      chk(afterFail.failed === true && afterFail.focus !== 'tk-back', `${tag} #6928 a failed reload does not move focus to the top`, JSON.stringify(afterFail));
      await page.unroute('**/api/projects');

      /* kosmos#6928 review 1: the other two away sentences, after a real tab switch (which keeps PJ_CURRENT and TK_OPEN).
         A fresh project: 1 the parent, 2 and 3 built. First a request that never answers, then the parent refused. */
      const roll3 = projects.create({ name: 'Roll-up away ' + width });
      projects.addAgent(roll3.id, 'ada', null);
      tasks.create(roll3.id, { sentence: 'Open the shop' });
      for (const s of ['Stock the shelves', 'Price the stock']) tasks.create(roll3.id, { sentence: s, parent: 1, who: 'ada' });
      for (const n of [2, 3]) tasks.setBuilt(roll3.id, n, { by: 'ada' });
      const read3 = (n) => projects.readAll().find((p) => p.id === roll3.id).tasks.find((t) => t.number === n);
      const openParent3 = async () => {
        await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); openTaskPage(1); }, roll3.id);
        await page.waitForFunction(() => !document.getElementById('tk-subs-built').hidden, null, { timeout: 8000 });
      };
      const delayed = (pattern, answer) => page.route(pattern, async (r) => {
        try {   // #6022: a page closed before the delayed answer must not crash the check at teardown
          await new Promise((res) => setTimeout(res, 1500));
          await answer(r);
        } catch { /* the page went away first */ }
      });
      const toastSays = async (re) => {
        await page.waitForFunction((src) => { const el = document.getElementById('msg-toast'); return el && !el.hidden && new RegExp(src).test(el.textContent); }, re.source, { timeout: 15000 });
        return page.evaluate(() => document.getElementById('msg-toast').textContent);
      };
      await openParent3();
      await delayed('**/task/2/close', (r) => r.abort('connectionreset'));
      await page.click('#tk-subs-closeall');
      await page.evaluate(() => showTab('agents'));
      const noAnswer = await toastSays(/did not finish/);
      chk(noAnswer === 'Closing task #1 and its subtasks did not finish. Open it to see where it stopped.', `${tag} #6928 after a tab switch, a request with no answer is said as a toast`, noAnswer);
      chk(!read3(1).closedAt && !read3(2).closedAt && !read3(3).closedAt, `${tag} #6928 and nothing closed`, JSON.stringify([1, 2, 3].map((n) => !!read3(n).closedAt)));
      await page.unroute('**/task/2/close');
      await page.waitForFunction(() => !document.getElementById('tk-subs-closeall').disabled, null, { timeout: 15000 });

      await openParent3();
      await delayed('**/task/1/close', (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'the person set this task to repeat' }) }));
      const parentAsked = page.waitForResponse((resp) => /\/task\/1\/close$/.test(resp.url()), { timeout: 15000 });
      await page.click('#tk-subs-closeall');
      await page.waitForFunction(() => document.getElementById('tk-subs-built').hidden || !!document.getElementById('tk-subs-closeall').disabled, null, { timeout: 8000 });
      await page.evaluate(() => showTab('agents'));
      await parentAsked;
      const parentRefused = await toastSays(/was not closed/);
      chk(parentRefused === 'Task #1 was not closed: the person set this task to repeat. Its built subtasks are closed.', `${tag} #6928 after a tab switch, a refused parent is said as a toast`, parentRefused);
      chk(!read3(1).closedAt && !!read3(2).closedAt && !!read3(3).closedAt, `${tag} #6928 its built subtasks closed, the parent did not`, JSON.stringify([1, 2, 3].map((n) => !!read3(n).closedAt)));
      await page.unroute('**/task/1/close');
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
