// Browser-check-surface: tsk-wake tk-wake-line
'use strict';
/**
 * A task's wake on the screen (kosmos#8669): a task that waits for something (kosmos task wake) says so on its Tasks
 * row and on its own page, in the board's words; one that woke says on what and whether its holder was told.
 *
 * What this pins, and why each line can fail:
 *  - a pull request wake's row says "Waits for PR #12 in octo/hello to merge." (the board's words, capitalised),
 *  - a time wake's row says "Waits until ..." and a file wake's row names only the file, never its folder,
 *  - a wake that happened says "Woke: ... Its holder is still to be told.",
 *  - CONTROLS: a task with no wake, and a closed task that had one, draw no wake line,
 *  - the task's page shows the same sentence under the repeat section, and hides the line for a task with none,
 *  - light and dark, 1400 and 390 wide, with no sideways scroll and no page errors.
 *
 * The board is a real one in a sandbox (as render-subtasks-3861.js). gh is pointed at /usr/bin/false, so the board's
 * own minute look cannot reach GitHub; a row may then add "Not checked just now: ...", which this check allows.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-task-wake-8669.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwake-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwake-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwake-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwake-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwake-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_GH_BIN = '/usr/bin/false';
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwake-files-'));
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT, FILES];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');
const taskwake = require('../../engine/taskwake');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const p = projects.create({ name: 'Refresh' });
  projects.addAgent(p.id, 'ada', null);
  tasks.create(p.id, { sentence: 'Re-check after the merge', who: 'ada' });         // 1 pr wake
  tasks.setWake(p.id, 1, { kind: 'pr', repo: 'octo/hello', number: 12 }, { by: 'ada' });
  tasks.create(p.id, { sentence: 'Look again this afternoon', who: 'ada' });        // 2 time wake
  tasks.setWake(p.id, 2, { kind: 'at', at: Date.now() + 5 * 3600e3 }, { by: 'ada' });
  const folder = path.join(FILES, 'private-folder-name');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'brief.md'), 'first');
  tasks.create(p.id, { sentence: 'Read the brief when it changes', who: 'ada' });   // 3 file wake
  tasks.setWake(p.id, 3, (await taskwake.prepare({ file: path.join(folder, 'brief.md') }, { home: FILES })).wake, { by: 'ada' });
  tasks.create(p.id, { sentence: 'Ship once the fix lands', who: 'ada' });          // 4 woke
  tasks.setWake(p.id, 4, { kind: 'pr', repo: 'octo/hello', number: 13 }, { by: 'ada' });
  tasks.saveWakeMet(p.id, 4, tasks.byNumber(projects.readAll().find((x) => x.id === p.id), 4).wake.setAt, { at: new Date().toISOString(), words: 'it was merged' });
  tasks.create(p.id, { sentence: 'No wake here', who: 'ada' });                     // 5 control
  tasks.create(p.id, { sentence: 'Closed with a wake', who: 'ada' });               // 6 control
  tasks.setWake(p.id, 6, { kind: 'at', at: Date.now() + 3600e3 }, { by: 'ada' });
  tasks.close(p.id, 6);
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1400, 390]) {
        const tag = `[${theme} ${width}]`;
        const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(URL, { waitUntil: 'networkidle' });
        await clearFirstRun(page);
        await page.evaluate(() => showTab('tasks'));
        await page.waitForFunction(() => document.querySelectorAll('#tsk-groups .tsk-row').length >= 5, null, { timeout: 8000 });
        await page.evaluate(() => { document.querySelectorAll('#tsk-groups details').forEach((d) => { d.open = true; }); });
        await page.waitForTimeout(200);
        const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#tsk-groups .tsk-row')].map((r) => {
          const w = r.querySelector('.tsk-wake');
          return [Number(r.querySelector('.n').textContent.slice(1)), w ? w.textContent : null];
        })));
        chk(/^Waits for PR #12 in octo\/hello to merge\.( Not checked just now: .+\.)?$/.test(rows[1] || ''), `${tag} the PR wake's row says what it waits for`, JSON.stringify(rows[1]));
        chk(/^Waits until (today|tomorrow) at \d{1,2}(:\d\d)?(am|pm)\.$/.test(rows[2] || ''), `${tag} the time wake's row says when`, JSON.stringify(rows[2]));
        chk(rows[3] === 'Waits for brief.md to change.', `${tag} the file wake's row names the file`, JSON.stringify(rows[3]));
        const html = await page.evaluate(() => document.getElementById('tsk-groups').innerHTML);
        chk(!html.includes('private-folder-name'), `${tag} the file's folder is nowhere on the Tasks view`);
        chk(rows[4] === 'Woke: PR #13 in octo/hello: it was merged. Its holder is still to be told.', `${tag} the woken task says on what, and that its holder is still to be told`, JSON.stringify(rows[4]));
        chk(rows[5] === null, `${tag} CONTROL: a task with no wake draws no wake line`, JSON.stringify(rows[5]));
        chk(rows[6] === null, `${tag} CONTROL: a closed task draws no wake line`, JSON.stringify(rows[6]));
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        chk(!wide, `${tag} no sideways scroll on the Tasks view`);

        await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, p.id);
        await page.waitForTimeout(400);
        await page.evaluate(() => openTaskPage(1));
        await page.waitForFunction(() => { const l = document.getElementById('tk-wake-line'); return l && !l.hidden; }, null, { timeout: 8000 }).catch(() => {});
        const line = await page.evaluate(() => { const l = document.getElementById('tk-wake-line'); return l ? { hidden: l.hidden, text: l.textContent, shown: l.offsetHeight > 0 } : null; });
        chk(line && !line.hidden && line.shown && /^Waits for PR #12 in octo\/hello to merge\./.test(line.text), `${tag} the task's page shows what it waits for`, JSON.stringify(line));
        await page.evaluate(() => openTaskPage(5));
        await page.waitForTimeout(400);
        const none = await page.evaluate(() => { const l = document.getElementById('tk-wake-line'); return l ? { hidden: l.hidden, text: l.textContent } : null; });
        chk(none && none.hidden && none.text === '', `${tag} CONTROL: a task with no wake hides the line on its page`, JSON.stringify(none));
        const wide2 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        chk(!wide2, `${tag} no sideways scroll on the task's page`);
        chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
