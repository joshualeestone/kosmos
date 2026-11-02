// Browser-check-surface: panel-tasks tsk-tiles tsk-groups tsk-ask tsk-asking tsk-answer tskAskRow tskAskList tskAskingShown
'use strict';
/**
 * kosmos#7797 item 1: an agent's question that no task carries is in Needs Your Decision on Tasks.
 *
 * What this pins, and why each line can fail:
 *  - Max asks about Spring launch and holds no task there; Zoe asks with no project. Both are listed first in Needs
 *    Your Decision, through the real rule (selfreport + a needs_you pane), not a stub: "Max asks about Spring launch",
 *    "Zoe asks you something"; the tile counts them with the one task an agent's question does carry (Ada's),
 *  - CONTROL: Ada asks about Spring launch and holds a task there, so her question is on her task row and NOT
 *    listed again (one question, one place),
 *  - Answer opens the agent (its conversation is there); grouped by project the questions lead, once,
 *  - scoped to Newsletter, neither Spring launch question shows; a search leaves them out (they are not tasks),
 *  - light, dark and a 390-wide phone, with no sideways scroll; the Answer button is 44px tall on a touch screen.
 *
 *   node docs/browser-checks/render-asknotask-7797.js [shots-dir]   # headed
 *   HEADED=0 node docs/browser-checks/render-asknotask-7797.js       # headless
 */
require('./lib-sandbox-home.js'); // never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asknotask-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asknotask-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asknotask-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asknotask-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asknotask-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');
const selfreport = require('../../engine/selfreport');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const launch = projects.create({ name: 'Spring launch' });
  const news = projects.create({ name: 'Newsletter' });
  for (const [who, project, because] of [['max', launch.id, 'which cover do you want?'], ['zoe', null, 'can I use your calendar?'],
    ['ada', launch.id, 'which date works?']]) {
    const body = { state: 'needs_you', because };
    if (project) body.project = project;
    if (!selfreport.record(who, body).recorded) throw new Error('fixture: ' + who + '\'s question was not recorded');
  }
  fleet.install([
    fleet.agent('ada', { state: 'needs_you', displayName: 'Ada', role: 'a planner' }),
    fleet.agent('max', { state: 'needs_you', displayName: 'Max', role: 'a designer' }),
    fleet.agent('zoe', { state: 'needs_you', displayName: 'Zoe', role: 'an assistant' }),
    fleet.agent('rex', { state: 'idle', displayName: 'Rex', role: 'a writer' }),
  ]);
  for (const [p, a] of [[launch, 'ada'], [launch, 'max'], [news, 'rex']]) projects.addAgent(p.id, a, null);
  tasks.create(launch.id, { sentence: 'Pick the launch date', who: 'ada' });   // carries Ada's question
  tasks.create(news.id, { sentence: 'Clean up bounced addresses', who: 'rex' });
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const read = () => {
    const grp = [...document.querySelectorAll('#tsk-groups .tsk-grp')].find((g) => { const h = g.querySelector('h3'); return h && /Needs Your Decision/.test(h.textContent); });
    const tile = document.querySelector('#tsk-tiles .tsk-tile[data-tile="decision"]');
    return {
      tileN: tile ? tile.querySelector('.num').textContent : null,
      heading: grp ? grp.querySelector('.count').textContent : null,
      asks: grp ? [...grp.querySelectorAll('.tsk-ask .tsk-ask-l')].map((x) => x.textContent) : [],
      firstIsAsk: grp ? !!grp.querySelector('.tsk-list').classList.contains('tsk-asking') : false,
      taskRows: grp ? [...grp.querySelectorAll('.tsk-row .tl')].map((x) => x.textContent) : [],
      allAsks: document.querySelectorAll('#tsk-groups .tsk-ask').length,
      waits: grp ? [...grp.querySelectorAll('.tsk-ask .tsk-waiting')].map((x) => x.textContent) : [],
      answerH: (() => { const b = document.querySelector('#tsk-groups .tsk-answer'); return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  };
  try {
    for (const [tag, ctx] of [['[light 1400]', { viewport: { width: 1400, height: 950 }, colorScheme: 'light' }],
      ['[dark 1400]', { viewport: { width: 1400, height: 950 }, colorScheme: 'dark' }],
      ['[phone 390]', { viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile: true }]]) {
      const context = await browser.newContext(ctx);
      const page = await context.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      if (ctx.viewport.width < 1000) {
        await page.click('#burger');
        await page.waitForSelector('#tabs .tab[data-tab="tasks"]', { state: 'visible', timeout: 5000 });
      }
      await page.click('#tabs .tab[data-tab="tasks"]');
      await page.waitForFunction(() => document.querySelectorAll('#tsk-groups .tsk-ask').length > 0, null, { timeout: 8000 }).catch(() => {});
      const a = await page.evaluate(read);
      chk(JSON.stringify(a.asks) === JSON.stringify(['Max asks about Spring launch', 'Zoe asks you something']),
        `${tag} Max's and Zoe's questions are listed in Needs Your Decision`, JSON.stringify(a.asks));
      chk(a.firstIsAsk, `${tag} the questions come first in the group`, JSON.stringify(a));
      chk(JSON.stringify(a.taskRows) === JSON.stringify(['Pick the launch date']) && a.allAsks === 2,
        `${tag} CONTROL: Ada's question stays on her task row and is not listed again`, JSON.stringify(a));
      chk(a.tileN === '3' && a.heading === '3', `${tag} the tile and the heading count the two questions with the task`, JSON.stringify(a));
      chk(!a.sideways, `${tag} no sideways scroll`);
      if (ctx.hasTouch) chk(a.answerH >= 44, `${tag} Answer is 44px tall on a touch screen`, String(a.answerH));
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, 'asknotask-' + tag.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') + '.png'), fullPage: false });
      }
      if (tag === '[light 1400]') {
        /* Scope to Newsletter: neither Spring launch question shows, Zoe's (no project) does not either. */
        await page.selectOption('#tsk-projsel', news.id);
        await page.waitForTimeout(200);
        const scoped = await page.evaluate(read);
        chk(scoped.allAsks === 0, `${tag} scoped to Newsletter, no question about another project is listed`, JSON.stringify(scoped));
        await page.selectOption('#tsk-projsel', launch.id);
        await page.waitForTimeout(200);
        const scopedL = await page.evaluate(read);
        chk(JSON.stringify(scopedL.asks) === JSON.stringify(['Max asks about Spring launch']), `${tag} scoped to Spring launch, only Max's question`, JSON.stringify(scopedL.asks));
        await page.selectOption('#tsk-projsel', '');
        await page.waitForTimeout(200);
        /* A search is about tasks: the questions leave. */
        await page.evaluate(() => { TSK.q = 'launch'; tskPaint(); });
        const searched = await page.evaluate(read);
        chk(searched.allAsks === 0, `${tag} a search leaves the questions out`, JSON.stringify(searched));
        await page.evaluate(() => { TSK.q = ''; tskPaint(); });
        /* Review 2: grouped by project, the questions lead under the decision group's name, so the tile's 3 is on screen. */
        await page.selectOption('#tsk-by', 'project');
        await page.waitForTimeout(200);
        const byProj = await page.evaluate(() => {
          const first = document.querySelector('#tsk-groups .tsk-grp');
          return { head: first ? first.querySelector('h3').textContent : '', asks: first ? first.querySelectorAll('.tsk-ask').length : 0,
            all: document.querySelectorAll('#tsk-groups .tsk-ask').length };
        });
        chk(/^Needs Your Decision2$/.test(byProj.head) && byProj.asks === 2 && byProj.all === 2, `${tag} grouped by project, the two questions lead, once`, JSON.stringify(byProj));
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'asknotask-by-project.png'), fullPage: false });
        await page.selectOption('#tsk-by', 'status');
        await page.waitForTimeout(200);
        /* Answer opens the agent. */
        await page.click('#tsk-groups .tsk-ask[data-ask="max"] .tsk-answer');
        await page.waitForTimeout(400);
        const opened = await page.evaluate(() => ({ shown: !document.getElementById('panel-detail').hidden, name: document.getElementById('d-name').textContent }));
        chk(opened.shown && opened.name === 'Max', `${tag} Answer opens Max`, JSON.stringify(opened));
      }
      chk(!errs.length, `${tag} no page errors`, errs.join(' | '));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
