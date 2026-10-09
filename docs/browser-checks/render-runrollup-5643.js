// Browser-check-surface: tk-activity tkActRowsHtml paintTaskActivity tkActPhrase tk-repeat-line tskRepeatSentence tkPaintRepeat
'use strict';
/**
 * A recurring task's runs that found nothing new, on the task's page (kosmos#5643).
 *
 * What this pins, and why each line can fail:
 *  - R1 the history rolls each streak of 2 or more unchanged runs into ONE row ("3 runs found nothing new"), and keeps
 *    the runs that changed something as rows of their own, in order,
 *  - R2 a rolled-up row starts closed and opens to show each run, with its own words,
 *  - R3 the repeat line (the status card) says how many runs in a row found nothing new and what the last change was,
 *  - R4 a CONTROL task whose runs all changed something has no rolled-up row and no "nothing new" words,
 *  - R5 light 1400 and dark 390, no sideways scroll and no page errors. Screenshots go to $SHOTS when it is set.
 * Every run is on the hour, so none is late (a late run is never rolled up, which the page test pins).
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-runrollup-5643.js            # headed
 *   HEADED=0 node docs/browser-checks/render-runrollup-5643.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runroll-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runroll-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runroll-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runroll-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runroll-config-'));
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
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a watcher' })]);
  const watch = projects.create({ name: 'Price watch' });
  projects.addAgent(watch.id, 'ada', null);
  const HOUR = 3600000;
  const top = Math.floor(Date.now() / HOUR) * HOUR;   // this hour, on the hour: no run is late
  // 1: the task under test. A change, 3 unchanged, a change, 2 unchanged (the flag, then the same note).
  tasks.create(watch.id, { sentence: 'Check the price list', who: 'ada' });
  tasks.setRepeat(watch.id, 1, { every: 'hour' });
  tasks.recordRun(watch.id, 1, 'ada', 'two prices went up', top - 6 * HOUR);
  tasks.recordRun(watch.id, 1, 'ada', 'checked 40 items', top - 5 * HOUR, { unchanged: true });
  tasks.recordRun(watch.id, 1, 'ada', 'checked 40 items', top - 4 * HOUR);   // the same note: unchanged
  tasks.recordRun(watch.id, 1, 'ada', 'checked 40 items', top - 3 * HOUR);
  tasks.recordRun(watch.id, 1, 'ada', 'one supplier is out of stock', top - 2 * HOUR);
  tasks.recordRun(watch.id, 1, 'ada', 'all clear', top - 1 * HOUR, { unchanged: true });
  tasks.recordRun(watch.id, 1, 'ada', 'all clear', top);
  // 2: the CONTROL, every run a change.
  tasks.create(watch.id, { sentence: 'Check the stock list', who: 'ada' });
  tasks.setRepeat(watch.id, 2, { every: 'hour' });
  tasks.recordRun(watch.id, 2, 'ada', 'stock is 10', top - 2 * HOUR);
  tasks.recordRun(watch.id, 2, 'ada', 'stock is 8', top - 1 * HOUR);
  tasks.recordRun(watch.id, 2, 'ada', 'stock is 7', top);
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openTask = async (page, n) => {
    await page.evaluate(async ([pid, num]) => { if (await tskGoToProject(pid)) openTaskPage(num); }, [watch.id, n]);
    await page.waitForFunction(() => { const h = document.getElementById('tk-activity'); return h && h.children.length > 0 && !/^\s*$/.test(h.textContent); }, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(200);
  };
  const shots = process.env.SHOTS || '';
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 390]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      await openTask(page, 1);
      const hist = await page.evaluate(() => {
        const h = document.getElementById('tk-activity');
        const rolls = [...h.querySelectorAll('details.tkact-roll')];
        const top = [...h.children].map((c) => (c.matches('details') ? 'ROLL:' + c.querySelector('summary').textContent.trim() : c.textContent.trim()));
        return { rolls: rolls.map((d) => ({ open: d.open, summary: d.querySelector('summary').textContent.trim(), rows: d.querySelectorAll('.tkact-rows .tkact').length })), top };
      });
      chk(hist.rolls.length === 2 && /3 runs found nothing new/.test(hist.rolls[0].summary) && /2 runs found nothing new/.test(hist.rolls[1].summary),
        `${tag} R1 two streaks roll up, 3 runs then 2`, JSON.stringify(hist.rolls));
      const order = hist.top.map((x) => (x.startsWith('ROLL:') ? 'roll' : /two prices went up/.test(x) ? 'change1' : /out of stock/.test(x) ? 'change2' : 'other'));
      chk(JSON.stringify(order.filter((o) => o !== 'other')) === JSON.stringify(['change1', 'roll', 'change2', 'roll']),
        `${tag} R1 the changes keep their own rows, in order around the rollups`, JSON.stringify(hist.top));
      chk(hist.rolls.every((r) => r.open === false), `${tag} R2 a rollup starts closed`);
      await page.click('#tk-activity details.tkact-roll >> nth=0 >> summary');
      await page.waitForTimeout(150);
      const opened = await page.evaluate(() => {
        const d = document.querySelector('#tk-activity details.tkact-roll');
        const rows = [...d.querySelectorAll('.tkact-rows .tkact')].map((r) => r.textContent.trim());
        const box = d.querySelector('.tkact-rows .tkact');
        return { open: d.open, rows, visible: !!box && box.getBoundingClientRect().height > 0 };
      });
      chk(opened.open && opened.visible && opened.rows.length === 3 && opened.rows.every((r) => /nothing new: checked 40 items/.test(r)),
        `${tag} R2 pressing it shows each run with its words`, JSON.stringify(opened));
      const line = await page.evaluate(() => { const l = document.getElementById('tk-repeat-line'); return l && !l.hidden ? l.textContent : null; });
      chk(/The last 2 runs found nothing new; the last change was .*: one supplier is out of stock\./.test(line || ''),
        `${tag} R3 the status line says the streak and the last change`, String(line));
      if (shots) await page.screenshot({ path: path.join(shots, `runrollup-${theme}-${width}.png`), fullPage: false });

      await openTask(page, 2);
      const control = await page.evaluate(() => ({ rolls: document.querySelectorAll('#tk-activity details.tkact-roll').length, line: document.getElementById('tk-repeat-line').textContent, rows: document.querySelectorAll('#tk-activity .tkact').length }));
      chk(control.rolls === 0 && control.rows >= 3 && !/nothing new/.test(control.line), `${tag} R4 the control task has no rollup and no nothing-new words`, JSON.stringify(control));

      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      chk(wide <= 0, `${tag} R5 no sideways scroll`, String(wide));
      chk(errs.length === 0, `${tag} R5 no page errors`, JSON.stringify(errs));
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
