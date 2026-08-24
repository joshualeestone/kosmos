'use strict';
/**
 * The org chart's organic layer (#285): grab a node, the rings follow; a drag
 * does not open the agent, a click still does. Not part of `npm test`; needs
 * playwright on NODE_PATH (this machine: ~/work/pw-runtime/node_modules).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-org-drag.js
 */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgdrag-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgdrag-workers-'));
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgdrag-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgdrag-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgdrag-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fleet = require(path.join(ROOT, 'test-support', 'fleet'));
const store = require(path.join(ROOT, 'engine', 'store'));
const firstrun = require(path.join(ROOT, 'engine', 'firstrun'));
const srv = require(path.join(ROOT, 'server.js'));
const fail = [];
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
(async () => {
  fleet.install([
    fleet.agent('mara', { state: 'idle', displayName: 'Mara' }),
    fleet.agent('scarlet', { state: 'working', displayName: 'Scarlet' }),
    fleet.agent('sam', { state: 'idle', displayName: 'Sam' }),
    fleet.agent('kid', { state: 'idle', displayName: 'Kid' }),
  ]);
  store.writeProfile('kid', { reportsTo: 'mara' });
  // Sam gets a real picture (#381): a node with an <img> is the one whose
  // drag the browser hijacks, and the initials disc never reproduces it.
  const avatars = path.join(store.ROOT, 'avatars');
  fs.mkdirSync(avatars, { recursive: true });
  fs.writeFileSync(path.join(avatars, 'sam.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGNgYGD4z0AswKqQUgwAAP//AwAD9QSGqBOqDgAAAABJRU5ErkJggg==', 'base64'));
  try { firstrun.complete(); } catch { /* fine */ }
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.waitForSelector('[data-agent="mara"]', { timeout: 8000 });
  await page.click('.viewtoggle[data-scope="agents"] [data-layout="org"]');
  await page.waitForSelector('#orgmap .onode', { timeout: 8000 });
  await page.waitForTimeout(1800); // let the first settle finish
  const pos = async (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const before = { mara: await pos('.onode[data-agent="mara"]'), kid: await pos('.onode[data-agent="kid"]'), hub: await pos('#orgmap .hub') };
  // Drag the hub 120px right and 80px down, in steps.
  await page.mouse.move(before.hub.x, before.hub.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(before.hub.x + 10 * i, before.hub.y + (80 / 12) * i); await page.waitForTimeout(30); }
  const during = { hub: await pos('#orgmap .hub'), mara: await pos('.onode[data-agent="mara"]') };
  await page.mouse.up();
  await page.waitForTimeout(300);
  chk(Math.abs(during.hub.x - (before.hub.x + 120)) < 3 && Math.abs(during.hub.y - (before.hub.y + 80)) < 3, 'the hub follows the pointer while held', JSON.stringify(during.hub));
  chk(Math.hypot(during.mara.x - before.mara.x, during.mara.y - before.mara.y) > 25, 'a first-ring node moved with the hub', Math.hypot(during.mara.x - before.mara.x, during.mara.y - before.mara.y).toFixed(0) + 'px');
  chk(!(await page.$('#panel-detail:not([hidden])')), 'a drag did not open an agent page');
  await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'org-drag.png') });
  // Wires follow: the kid's wire ends where the kid is.
  const kidNow = await pos('.onode[data-agent="kid"]');
  const wireEnd = await page.$eval('#orgmap line[data-for="kid"]', (l) => { const r = l.ownerSVGElement.getBoundingClientRect(); const vb = l.ownerSVGElement.viewBox.baseVal; const sx = r.width / vb.width; return { x: r.x + Number(l.getAttribute('x2')) * sx, y: r.y + Number(l.getAttribute('y2')) * sx }; });
  chk(Math.hypot(wireEnd.x - kidNow.x, wireEnd.y - kidNow.y) < 4, 'the wire ends on the node it belongs to', Math.hypot(wireEnd.x - kidNow.x, wireEnd.y - kidNow.y).toFixed(1) + 'px');
  // Drag a NODE, not only the hub (#381): a node has a click action, the hub
  // does not, so this is the case the first version of this check could not
  // see. Letting go must not open the agent.
  await page.waitForTimeout(1500);
  const samBefore = await pos('.onode[data-agent="sam"]');
  await page.mouse.move(samBefore.x, samBefore.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) { await page.mouse.move(samBefore.x - 10 * i, samBefore.y + 6 * i); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  chk(!(await page.$('#panel-detail:not([hidden])')), 'letting go of a dragged node does not open its page');
  const samAfter = await pos('.onode[data-agent="sam"]');
  chk(Math.hypot(samAfter.x - samBefore.x, samAfter.y - samBefore.y) > 30, 'the node moved with the pointer', Math.hypot(samAfter.x - samBefore.x, samAfter.y - samBefore.y).toFixed(0) + 'px');
  chk(await page.$eval('#orgmap', (m) => [...m.querySelectorAll('img')].every((i) => i.getAttribute('draggable') === 'false')), 'every picture on the chart refuses the native image drag');
  // A plain click still opens the agent.
  await page.waitForTimeout(2500);
  const maraNow = await pos('.onode[data-agent="mara"]');
  await page.mouse.click(maraNow.x, maraNow.y);
  await page.waitForTimeout(500);
  chk(!!(await page.$('#panel-detail:not([hidden])')), 'a click still opens the agent');
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close(); server.close();
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
