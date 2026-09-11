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
  await page.click('#d-nav [data-go="memory"]'); await page.waitForTimeout(600);
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
  /* #2809 (Josh, 2026-09-11, reviewing 0.6.56 live: the fresh-start buttons
     "look terrible" full-width): each of the three now sizes to its content
     (`display:block; width:fit-content`), not the full container width, and
     they stay stacked one per line. Two assertions guard two distinct
     regressions: a re-widen to the old full-bleed `width:100%` (the width
     check), and a switch away from block stacking -- e.g. flex-row -- that would
     let three narrow buttons sit on one line and still pass a width-only check
     (the stacking check). Each button is measured against its own parent
     container (compact+clear share one `.freshstack` div; restart sits in the
     separate `.field.freshstack`). 0.9 leaves headroom for the longest label. */
  const geo = await page.evaluate(() => ['d-compact-go', 'd-clear-go', 'd-restart-start'].map((id) => {
    const b = document.getElementById(id); const r = b.getBoundingClientRect();
    return { id, btn: r.width, container: b.parentElement.getBoundingClientRect().width, top: r.top, left: r.left, bottom: r.bottom };
  }));
  chk(geo.every((g) => g.btn > 0 && g.container > 0 && g.btn <= g.container * 0.9),
    'the three fresh-start buttons size to content, not full width (#2809)',
    JSON.stringify(geo.map((g) => ({ id: g.id, btn: Math.round(g.btn), container: Math.round(g.container) }))));
  const stacked = geo[1].top >= geo[0].bottom - 2 && geo[2].top >= geo[1].bottom - 2
    && Math.abs(geo[1].left - geo[0].left) < 2 && Math.abs(geo[2].left - geo[0].left) < 2;
  chk(stacked, 'the three fresh-start buttons stack one per line, left-aligned (#2809)',
    JSON.stringify(geo.map((g) => ({ id: g.id, top: Math.round(g.top), left: Math.round(g.left) }))));
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
