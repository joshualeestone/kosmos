// Browser-check-surface: tk-occurrences tk-occ-list tkPaintOccurrences tkOccWords tkOccWhen paintTaskActivity TK_OPEN openTaskPage
'use strict';
/**
 * A repeating task's recent runs and misses on its page, one row per scheduled slot (kosmos#9142).
 *
 * What this pins, and why each line can fail:
 *  - O1 "Recent runs" shows under the reviewer row, newest first, one row per slot: delivered late, missed, missed
 *    with its reviewer told, delivered on time (the slots are written straight into the history, at their own times),
 *  - O2 a missed or late row is in the missed colour, an on-time row is not,
 *  - O3 a CONTROL task that does not repeat shows no list, and opening it after the repeating one clears the list,
 *  - O4 light 1400 and dark 390, no sideways scroll and no page errors. Screenshots go to $SHOTS when it is set.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-occurrences-9142.js            # headed
 *   HEADED=0 node docs/browser-checks/render-occurrences-9142.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');
const taskchat = require('../../engine/taskchat');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a watcher' })]);
  const watch = projects.create({ name: 'Log watch' });
  // #7185: a history row from before its project was made is an earlier project's, so the project is dated back first.
  projects.mutate(watch.id, (p) => ({ ...p, createdAt: '2020-01-01T00:00:00.000Z' }));
  projects.addAgent(watch.id, 'ada', null);
  const HOUR = 3600000;
  const top = Math.floor(Date.now() / HOUR) * HOUR;   // this hour, on the hour
  // 1: hourly, its rule set just before four hours back, so its first slot is top - 4h. Runs and a told miss written straight into the history at their own times
  // (recordRun stamps the time it is called).
  tasks.create(watch.id, { sentence: 'Check the error log', who: 'ada' });
  tasks.setRepeat(watch.id, 1, { every: 'hour' });
  projects.mutate(watch.id, (p) => ({ ...p, tasks: p.tasks.map((t) => (t.number === 1 ? { ...t, repeatSetAt: new Date(top - 4 * HOUR - 60000).toISOString() } : t)) }));
  const line = (o) => fs.appendFileSync(taskchat.taskChatFile(watch.id, 1), JSON.stringify(o) + '\n');
  line({ at: new Date(top - 4 * HOUR + 60000).toISOString(), kind: 'run', by: 'ada', note: 'clean' });         // on time
  line({ at: new Date(top - 3 * HOUR + 20 * 60000).toISOString(), kind: 'missed', slot: new Date(top - 3 * HOUR).toISOString(), count: 1, told: 'ada', reached: true });
  line({ at: new Date(top - 2 * HOUR + 40 * 60000).toISOString(), kind: 'run', by: 'ada', note: 'two warnings' }); // late
  // top - 1h: missed, nobody told
  // 2: the CONTROL, a task that does not repeat.
  tasks.create(watch.id, { sentence: 'Write the summary', who: 'ada' });
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openTask = async (page, n) => {
    await page.evaluate(async ([pid, num]) => { if (await tskGoToProject(pid)) openTaskPage(num); }, [watch.id, n]);
    await page.waitForFunction(() => { const h = document.getElementById('tk-activity'); return h && h.children.length > 0 && !/^\s*$/.test(h.textContent); }, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  const occ = (page) => page.evaluate(() => {
    const box = document.getElementById('tk-occurrences');
    const rows = [...document.querySelectorAll('#tk-occ-list li')];
    return { shown: !!box && !box.hidden && box.getBoundingClientRect().height > 0, rows: rows.map((li) => li.textContent), off: rows.map((li) => li.classList.contains('tk-occ-off')) };
  });
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
      const a = await occ(page);
      const want = [/: missed$/, /: delivered late, .+, by (Ada|ada)/, /: missed; (Ada|ada) was told it was missed$/, /: delivered on time, .+, by (Ada|ada)/];
      // The OLDEST four rows are top - 1h back to top - 4h whatever the minute (the current hour's slot shows only once
      // it is past its grace, so it may or may not head the list).
      const last4 = a.rows.slice(-4);
      chk(a.shown && (a.rows.length === 4 || a.rows.length === 5) && want.every((re, i) => re.test(last4[i] || '')) && a.rows.every((r) => /^Due /.test(r)),
        `${tag} O1 the recent runs, newest first, one row per slot`, JSON.stringify(a.rows));
      chk(JSON.stringify(a.off.slice(-4)) === '[true,true,true,false]', `${tag} O2 missed and late rows in the missed colour, on time not`, JSON.stringify(a.off));
      if (shots) await page.screenshot({ path: path.join(shots, `occurrences-${theme}-${width}.png`), fullPage: false });

      await openTask(page, 2);
      const b = await occ(page);
      chk(!b.shown && b.rows.length === 0, `${tag} O3 a task that does not repeat shows no list, and the last task's rows are gone`, JSON.stringify(b));

      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      chk(wide <= 0, `${tag} O4 no sideways scroll`, String(wide));
      chk(errs.length === 0, `${tag} O4 no page errors`, JSON.stringify(errs));
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
