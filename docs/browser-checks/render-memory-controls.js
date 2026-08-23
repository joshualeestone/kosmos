'use strict';
/**
 * The Memory box's three controls (#214): Compact, Clear, Restart together,
 * the sentence that says how they differ, and Compact's dialog naming the cost
 * then carrying the verdict. Not part of `npm test`; needs playwright on
 * NODE_PATH (this machine: ~/work/pw-runtime/node_modules).
 */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-config-'));
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
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL + '/?tab=detail&agent=mara', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 8000 });
  await page.click('#d-nav [data-go="memory"]'); await page.waitForTimeout(600);
  const vis = await page.evaluate(() => {
    const v = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; };
    return { compact: v('d-compact-go'), clear: v('d-clear-go'), restart: v('d-restart-start'), chooser: /Three ways to get it going again/.test(document.getElementById('d-sec-memory').textContent), names: ['d-compact-go', 'd-clear-go', 'd-restart-start'].map((id) => document.getElementById(id).textContent) };
  });
  chk(vis.compact && vis.clear && vis.restart, 'Compact, Clear and Restart are all on the Memory tab', JSON.stringify(vis));
  chk(vis.chooser, 'the sentence saying how the three differ is there');
  /* #404: long form on all three, the agent's name on every button. The seeded
     agent is named in the fixture, so a bare "Compact" here is a regression. */
  chk(vis.names.every((t) => /^(Compact|Clear) \S.*\u2019s memory$|^Restart \S/.test(t)), 'all three buttons name the agent', JSON.stringify(vis.names));
  await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'memory-controls.png') });
  await page.click('#d-compact-go'); await page.waitForTimeout(300);
  chk(!(await page.$eval('#chg-modal', (m) => m.hidden)), 'Compact opens a dialog rather than acting');
  const small = await page.$eval('#chg-small', (e) => e.textContent);
  chk(/Fine detail from earlier/.test(small) && /not read again/.test(small), 'the dialog names what compact costs and what it does not do', small.slice(0, 70));
  await page.click('#chg-go'); await page.waitForTimeout(2000);
  const out = await page.$eval('#chg-msg', (e) => e.textContent);
  chk(out.length > 0 && out !== 'Working…', 'the verdict is reported inside the dialog', out.slice(0, 90));
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); server.close(); process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
