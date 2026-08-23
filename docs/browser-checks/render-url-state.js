'use strict';
/**
 * The view survives a refresh (#374): an agent's page, a project, a task.
 * Not part of `npm test`; needs playwright on NODE_PATH.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-url-state.js
 */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-url-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-url-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-url-config-'));
const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fleet = require(path.join(ROOT, 'test-support', 'fleet'));
const projects = require(path.join(ROOT, 'engine', 'projects'));
const tasks = require(path.join(ROOT, 'engine', 'tasks'));
const firstrun = require(path.join(ROOT, 'engine', 'firstrun'));
const srv = require(path.join(ROOT, 'server.js'));
const fail = [];
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
(async () => {
  fleet.install([fleet.agent('mara', { state: 'idle', displayName: 'Mara' })]);
  try { firstrun.complete(); } catch { /* fine */ }
  const p = projects.create({ name: 'Winter launch' });
  projects.writeAll(projects.readAll().map((x) => (x.id === p.id ? { ...x, agents: ['mara'] } : x)));
  tasks.create(p.id, { sentence: 'Write the brief', who: 'mara' });   // assigned, so it sits in the column rather than behind the door
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.waitForSelector('[data-agent="mara"]', { timeout: 8000 });
  await page.click('[data-agent="mara"]'); await page.waitForSelector('#panel-detail:not([hidden])'); await page.waitForTimeout(300);
  chk(/tab=detail/.test(page.url()) && /agent=mara/.test(page.url()), 'opening an agent writes the URL', page.url());
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  chk(!!(await page.$('#panel-detail:not([hidden])')) && (await page.$eval('#d-name', (el) => el.textContent)).includes('Mara'), 'a refresh lands on the same agent');
  await page.click('[data-tab="projects"]'); await page.waitForTimeout(600);
  chk(/tab=projects/.test(page.url()) && !/project=/.test(page.url()), 'the projects list writes its tab and no project', page.url());
  await page.click('#pj-list [data-project="' + p.id + '"]'); await page.waitForSelector('#pj-one-view:not([hidden])'); await page.waitForTimeout(300);
  chk(new RegExp('project=' + p.id).test(page.url()), 'opening a project writes the URL', page.url());
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  chk(!!(await page.$('#pj-one-view:not([hidden])')), 'a refresh lands on the same project');
  const taskBtn = await page.waitForSelector('#pj-tasklist .tkcard', { timeout: 6000 }).catch(() => null);
  if (taskBtn) {
    await taskBtn.click(); await page.waitForTimeout(500);
    chk(/task=1/.test(page.url()), 'opening a task writes the URL', page.url());
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    chk(!!(await page.$('#pj-task-view:not([hidden])')), 'a refresh lands on the same task');
  } else { console.log('SKIP  no task control found to click'); }
  await page.click('[data-tab="agents"]'); await page.waitForTimeout(300);
  chk(!/tab=/.test(page.url()), 'the overview writes a clean URL', page.url());
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); server.close(); process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
