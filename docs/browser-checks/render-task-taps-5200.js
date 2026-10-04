// Browser-check-surface: pj-task-view tk-newpart tk-newpart-go tk-say tk-say-go tk-chats-reveal tk-due tk-hold tk-subadd
'use strict';
/**
 * The task page's controls are 44px targets on a touch screen (kosmos#5200).
 *
 * What this pins, and why each line can fail:
 *  - the phone context really is a touch screen ((hover: none) matches), else the rule under test never applies and
 *    every line below would test nothing,
 *  - on that phone, each of the task page's controls (Change who, Done, + Add subtask, Add a part, Add, the message
 *    box, Send, Show me where the task conversations live, Due, Put on hold) is at least 44x44,
 *  - the small text links keep their line: the who sentence ("Ada has not reported...") does not grow taller,
 *  - CONTROL: on a desktop with a mouse the same links stay their small size (the rule is touch only),
 *  - no sideways scroll and no page errors, light and dark.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-task-taps-5200.js            # headed
 *   HEADED=0 node docs/browser-checks/render-task-taps-5200.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taps5200-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taps5200-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taps5200-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taps5200-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taps5200-config-'));
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

const CONTROLS = [
  ['.tkwho-pick', 'Change who'], ['.tkpart-go', 'Done'], ['#tk-subadd', '+ Add subtask'], ['#tk-newpart', 'Add a part'],
  ['#tk-newpart-go', 'Add'], ['#tk-say', 'the message box'], ['#tk-say-go', 'Send'],
  ['#tk-chats-reveal', 'Show me where the task conversations live'], ['#tk-due', 'Due'], ['#tk-hold', 'Put on hold'],
];

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  const launch = projects.create({ name: 'Spring launch' });
  projects.addAgent(launch.id, 'ada', null);
  tasks.create(launch.id, { sentence: 'Write the blurb', who: 'ada' });   // open, given to Ada: Change who + Done
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openTask = async (page) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await clearFirstRun(page);
    await page.evaluate(async (pid) => { if (await tskGoToProject(pid)) openTaskPage(1); }, launch.id);
    await page.waitForSelector('#pj-task-view:not([hidden]) .tkwho-pick', { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(300);
  };
  const sizes = (page) => page.evaluate((list) => list.map(([sel]) => {
    const e = [...document.querySelectorAll('#pj-task-view ' + sel)].find((x) => x.offsetParent);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  }), CONTROLS);
  // The who sentence's own box: the padding on its link must not make the line taller.
  const whoLine = (page) => page.evaluate(() => {
    const p = document.querySelector('#pj-task-view .tkwho-pick');
    const row = p && p.parentElement;
    return row ? Math.round(row.getBoundingClientRect().height) : null;
  });

  try {
    for (const theme of ['light', 'dark']) {
      const tag = `[${theme} phone 390]`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: theme, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await openTask(page);
      chk(await page.evaluate(() => matchMedia('(hover: none)').matches), `${tag} the context is a touch screen ((hover: none) matches)`);
      const got = await sizes(page);
      CONTROLS.forEach(([sel, label], i) => {
        const s = got[i];
        chk(!!s && s[0] >= 44 && s[1] >= 44, `${tag} ${label} is at least 44x44`, JSON.stringify(s) + ' ' + sel);
      });
      // Without the rule the same line: measured with the rule switched off, on the same page.
      const withRule = await whoLine(page);
      await page.addStyleTag({ content: '#pj-task-view .tkwho-pick, #pj-task-view .tkpart-go { padding: 0 !important; margin: 0 !important; }' });
      const withoutRule = await whoLine(page);
      chk(withRule !== null && withRule === withoutRule, `${tag} the who line keeps its height (the links' hit area does not move it)`, `${withRule} vs ${withoutRule}`);
      chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.slice(0, 2).join(' | '));
      await ctx.close();
    }
    // CONTROL: a desktop with a mouse keeps the small links small, so the phone rule is not leaking.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await openTask(page);
    chk(await page.evaluate(() => matchMedia('(hover: hover)').matches), '[desktop 1280] the context has a mouse ((hover: hover) matches)');
    const d = await sizes(page);
    chk(!!d[0] && d[0][1] < 44 && !!d[1] && d[1][1] < 44, '[desktop 1280] CONTROL: Change who and Done stay their small size with a mouse', JSON.stringify([d[0], d[1]]));
    await ctx.close();
  } catch (e) {
    console.error(e);
    fail.push('crashed: ' + (e && e.message));
  } finally {
    await browser.close();
    server.close();
    for (const dir of SANDBOXES) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
