'use strict';
/**
 * The Model section (#386): three chained menus like the create form, and a
 * change that is confirmed with its cost and reports its outcome in the dialog.
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-model-change.js
 */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-workers-'));
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-config-'));
const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fleet = require(path.join(ROOT, 'test-support', 'fleet'));
const firstrun = require(path.join(ROOT, 'engine', 'firstrun'));
const srv = require(path.join(ROOT, 'server.js'));
const fail = [];
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
(async () => {
  fleet.install([fleet.agent('mara', { state: 'idle', displayName: 'Mara' })]);
  try { firstrun.complete(); } catch { /* fine */ }
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL + '/?tab=detail&agent=mara', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 8000 });
  await page.click('#d-nav [data-go="model"]'); await page.waitForTimeout(500);
  const shape = await page.evaluate(() => ({
    provider: !!document.getElementById('d-provider'), account: !!document.getElementById('d-account'), model: !!document.getElementById('d-model'),
    chained: !!document.querySelector('#d-sec-model .msteps .mstep .mstep #d-model'),
    models: document.querySelectorAll('#d-model option').length,
  }));
  chk(shape.provider && shape.account && shape.model && shape.chained, 'provider, account, model, chained like the create form', JSON.stringify(shape));
  await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'model-section.png') });
  const opt = await page.$eval('#d-model', (s) => { const o = [...s.options].find((x) => x.value); return o ? o.value : null; });
  chk(!!opt, 'the model menu offers a choice', opt);
  if (opt) {
    await page.selectOption('#d-model', opt);
    await page.click('#d-model-go'); await page.waitForTimeout(300);
    chk(!(await page.$eval('#chg-modal', (m) => m.hidden)), 'the change opens a dialog rather than acting');
    const small = await page.$eval('#chg-small', (e) => e.textContent);
    chk(/agreed to and has not done yet/.test(small) && /^Mara restarts/.test(small), 'the dialog names what is lost, before it happens', small.slice(0, 60));
    chk(/^Change Mara to /.test(await page.$eval('#chg-title', (e) => e.textContent)), 'the title names the agent and the model');
    await page.click('#chg-go'); await page.waitForTimeout(2500);
    const out = await page.$eval('#chg-msg', (e) => e.textContent);
    chk(out.length > 0 && out !== 'Working…', 'the outcome is reported inside the dialog, in a sentence', out.slice(0, 80));
    chk(!(await page.$eval('#chg-modal', (m) => m.hidden)) && (await page.$eval('#chg-keep', (b) => b.textContent)) !== 'Keep it as it is', 'the dialog stays open with a Done/Close rather than vanishing');
    await page.click('#chg-keep'); await page.waitForTimeout(200);
    chk(await page.$eval('#chg-modal', (m) => m.hidden), 'Done closes it');
  }
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); server.close(); process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
