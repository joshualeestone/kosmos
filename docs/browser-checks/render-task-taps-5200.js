// Browser-check-surface: pj-task-view tk-newpart tk-newpart-go tk-say tk-say-go tk-chats-reveal tk-due tk-hold tk-subadd
'use strict';
/**
 * The task page's controls are 44px targets on a touch screen (kosmos#5200).
 *
 * What this pins, and why each line can fail:
 *  - the phone context really is a touch screen ((hover: none) or (pointer: coarse) matches), else the rule under test
 *    never applies and every line below would test nothing,
 *  - on that phone, each of the task page's controls (Change who, Done, + Add subtask, Add a part, Add, the message
 *    box, Send, Show me where the task conversations live, Due, Put on hold) is at least 44x44,
 *  - the small links in a row keep their line: the who row is the same height with the rule switched off on the
 *    same page. (+ Add subtask and Close this task are honest 44px boxes on their own lines, so the subtasks block
 *    may grow; that is by design and not asserted as unchanged.)
 *  - two neighbouring targets never overlap: with a 40-character name, Change who ends before Done starts, and a tap
 *    just inside each one's edge lands on that control; "Close this task" and "+ Add subtask" likewise,
 *  - the name's dashed affordance stays under the name (an underline, not the padded box's bottom border),
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
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
    fleet.agent('long', { state: 'idle', displayName: 'Bartholomew Montgomery-Fairweather III', role: 'a writer' })]);
  const launch = projects.create({ name: 'Spring launch' });
  projects.addAgent(launch.id, 'ada', null);
  projects.addAgent(launch.id, 'long', null);
  tasks.create(launch.id, { sentence: 'Write the blurb', who: 'ada' });              // 1: Ada, Change who + Done
  tasks.create(launch.id, { sentence: 'Draft the long copy', who: 'long' });         // 2: a 40-character name
  tasks.create(launch.id, { sentence: 'Pick the venue' });                           // 3: all subtasks done
  tasks.create(launch.id, { sentence: 'Book it', parent: 3 });                       // 4: its only subtask, closed
  tasks.close(launch.id, 4);
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openTask = async (page, n = 1, wait = '.tkwho-pick') => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await clearFirstRun(page);
    await page.evaluate(async ([pid, num]) => { if (await tskGoToProject(pid)) openTaskPage(num); }, [launch.id, n]);
    await page.waitForSelector('#pj-task-view:not([hidden]) ' + wait, { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(300);
  };
  // The rule switched off on the same page: the base look, with + Add subtask's own 10px gap.
  const RULE_OFF = '#pj-task-view .tkwho-pick, #pj-task-view .tkpart-go, #pj-task-view #tk-subadd, #pj-task-view #tk-subs-close'
    + ' { padding: 0 !important; margin: 0 !important; min-width: 0 !important; } #pj-task-view #tk-subadd { margin-top: 10px !important; }';
  const heights = (page) => page.evaluate(() => {
    const h = (e) => (e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null);
    const pick = document.querySelector('#pj-task-view .tkwho-pick');
    const add = document.querySelector('#pj-task-view #tk-subadd');
    return { who: h(pick && pick.parentElement), subs: h(add && add.parentElement), addTop: add ? Math.round(add.getBoundingClientRect().top) : null };
  });
  // Two targets on one row or one above the other: their boxes must not overlap, and a tap just inside each one's
  // inner edge must land on that control.
  const apart = (page, a, b, vertical) => page.evaluate(([a, b, vertical]) => {
    const ea = document.querySelector('#pj-task-view ' + a), eb = document.querySelector('#pj-task-view ' + b);
    if (!ea || !eb || !ea.offsetParent || !eb.offsetParent) return { ok: false, why: 'missing' };
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
    const gap = vertical ? rb.top - ra.bottom : rb.left - ra.right;
    const pa = vertical ? [ra.left + ra.width / 2, ra.bottom - 1] : [ra.right - 1, ra.top + ra.height / 2];
    const pb = vertical ? [rb.left + rb.width / 2, rb.top + 1] : [rb.left + 1, rb.top + rb.height / 2];
    const hitA = document.elementFromPoint(pa[0], pa[1]), hitB = document.elementFromPoint(pb[0], pb[1]);
    return { ok: gap >= 0 && !!hitA && ea.contains(hitA) && !!hitB && eb.contains(hitB), gap: Math.round(gap * 10) / 10 };
  }, [a, b, vertical]);
  const sizes = (page) => page.evaluate((list) => list.map(([sel]) => {
    const e = [...document.querySelectorAll('#pj-task-view ' + sel)].find((x) => x.offsetParent);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  }), CONTROLS);

  try {
    for (const theme of ['light', 'dark']) {
      const tag = `[${theme} phone 390]`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: theme, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await openTask(page);
      chk(await page.evaluate(() => matchMedia('(hover: none), (pointer: coarse)').matches), `${tag} the context is a touch screen ((hover: none) or (pointer: coarse) matches)`);
      const got = await sizes(page);
      CONTROLS.forEach(([sel, label], i) => {
        const s = got[i];
        chk(!!s && s[0] >= 44 && s[1] >= 44, `${tag} ${label} is at least 44x44`, JSON.stringify(s) + ' ' + sel);
      });
      const deco = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#pj-task-view .tkwho-pick')); return { border: c.borderBottomWidth, style: c.textDecorationStyle }; });
      chk(deco.border === '0px' && deco.style === 'dashed', `${tag} the name's dashed affordance is an underline, not the padded box's border`, JSON.stringify(deco));
      // Without the rule, the same layout: measured with the rule switched off, on the same page.
      const on = await heights(page);
      const style = await page.addStyleTag({ content: RULE_OFF });
      const off = await heights(page);
      await style.evaluate((el) => el.remove());
      chk(on.who !== null && on.who === off.who, `${tag} the who row keeps its height`, `${on.who} vs ${off.who}`);
      // A long name: Change who and Done side by side must not overlap.
      await openTask(page, 2);
      const longPair = await apart(page, '.tkwho-pick', '.tkpart-go', false);
      chk(longPair.ok, `${tag} with a 40-character name, Change who and Done do not overlap and each takes its own tap`, JSON.stringify(longPair));
      // All subtasks done: Close this task sits above + Add subtask.
      await openTask(page, 3, '#tk-subs-close');
      const closeSize = await page.evaluate(() => { const r = document.querySelector('#tk-subs-close').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      chk(closeSize[0] >= 44 && closeSize[1] >= 44, `${tag} Close this task is at least 44x44`, JSON.stringify(closeSize));
      const stack = await apart(page, '#tk-subs-close', '#tk-subadd', true);
      chk(stack.ok, `${tag} Close this task and + Add subtask do not overlap and each takes its own tap`, JSON.stringify(stack));
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
