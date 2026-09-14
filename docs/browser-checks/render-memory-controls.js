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
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
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
  // #2916: Memory folded under the "Model and Memory" pill (data-go="model"); its section + controls are unchanged.
  await page.click('#d-nav [data-go="model"]'); await page.waitForTimeout(600);
  const vis = await page.evaluate(() => {
    const v = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; };
    return { compact: v('d-compact-go'), clear: v('d-clear-go'), restart: v('d-restart-start'), chooser: /Three ways to get .{1,40} going again/.test(document.getElementById('d-sec-memory').innerText), names: ['d-compact-go', 'd-clear-go', 'd-restart-start'].map((id) => document.getElementById(id).textContent) };
  });
  chk(vis.compact && vis.clear && vis.restart, 'Compact, Clear and Restart are all on the Memory tab', JSON.stringify(vis));
  chk(vis.chooser, 'the pack\u2019s lede is on the Memory tab and names the agent');
  /* The pack's shape, ruled by Josh 2026-08-23 19:57 and pinned the same way
     in regress-a-night.js: one lede that names the agent ("Three ways to get
     Mara going again"), three stacked buttons with the pack's own words, and
     only Restart names the agent. The older #404 assertion (the agent's
     name on every button) asserted the design this replaced; it was red from
     the moment the pack landed and nobody ran it. Restated to the ruling, not
     to a guess: regress-a-night carries the same pins and is green. */
  chk(vis.names[0] === 'Compact: summarise and keep going' && vis.names[1] === 'Clear: start over, loses what it is holding' && /^Restart: stop and start \S/.test(vis.names[2]),
    'the three buttons carry the pack\u2019s words, and Restart names the agent', JSON.stringify(vis.names));
  /* #2917 (Josh, 6.59 QA: "make Compact and Restart the same width as Clear and
     center the text"): the three fresh-start buttons are now EQUAL width and
     fill their column (`width:100%; text-align:center`), superseding #2809's
     fit-content sizing. #2809's "look terrible" full width was the FULL PAGE;
     under #2917 the Fresh start box is 50% of the panel (Memory/Fresh-start
     side by side), so 100%-of-column is half that and equal by construction.
     Equal width is the load-bearing promise: the Restart label is DYNAMIC
     ("Restart: stop and start <name>"), so fit-content-to-widest would jump per
     agent. Assertions guard three regressions: a revert to fit-content (the
     fill check), unequal widths (the equal check), and a switch away from block
     stacking (the stacking check). Each button is measured against its own
     parent (compact+clear share one `.freshstack`; restart sits in the separate
     `.field.freshstack`). */
  const geo = await page.evaluate(() => ['d-compact-go', 'd-clear-go', 'd-restart-start'].map((id) => {
    const b = document.getElementById(id); const r = b.getBoundingClientRect();
    return { id, btn: r.width, container: b.parentElement.getBoundingClientRect().width, top: r.top, left: r.left, bottom: r.bottom, align: getComputedStyle(b).textAlign };
  }));
  chk(geo.every((g) => g.btn > 0 && g.btn >= g.container * 0.95),
    'the three fresh-start buttons fill their column, not fit-content (#2917 supersedes #2809)',
    JSON.stringify(geo.map((g) => ({ id: g.id, btn: Math.round(g.btn), container: Math.round(g.container) }))));
  const bw = geo.map((g) => g.btn);
  chk(Math.max(...bw) - Math.min(...bw) < 2, 'the three fresh-start buttons are equal width (#2917)', JSON.stringify(bw.map(Math.round)));
  chk(geo.every((g) => g.align === 'center'), 'the three fresh-start button labels are centered (#2917)', JSON.stringify(geo.map((g) => g.align)));
  const stacked = geo[1].top >= geo[0].bottom - 2 && geo[2].top >= geo[1].bottom - 2
    && Math.abs(geo[1].left - geo[0].left) < 2 && Math.abs(geo[2].left - geo[0].left) < 2;
  chk(stacked, 'the three fresh-start buttons stack one per line (#2917)',
    JSON.stringify(geo.map((g) => ({ id: g.id, top: Math.round(g.top), left: Math.round(g.left) }))));
  /* #2917: Memory (50%) and Fresh start (50%) sit side by side under the
     combined Model+Memory. Same top, second to the right of the first, widths
     within 15% of each other; at 1300px the row does not wrap. */
  const cols = await page.evaluate(() => {
    const row = document.querySelector('.mem-fresh-row');
    return [...row.children].filter((c) => c.classList.contains('dbox'))
      .map((b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), width: Math.round(r.width), left: Math.round(r.left) }; });
  });
  chk(cols.length === 2 && Math.abs(cols[0].top - cols[1].top) < 4 && cols[1].left > cols[0].left
      && Math.abs(cols[0].width - cols[1].width) < cols[0].width * 0.15,
    'Memory and Fresh start sit side by side at ~50/50 (#2917)', JSON.stringify(cols));
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
