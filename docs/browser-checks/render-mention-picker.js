'use strict';
/**
 * The @ picker in the project room (#312). Not part of `npm test`; needs
 * playwright on NODE_PATH (this machine: ~/work/pw-runtime/node_modules).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-mention-picker.js
 *
 * Seeds two agents on one project, opens its room, types "Hi @s", and prints:
 * whether the list opened and what it offered; what Enter inserted (must be
 * the session KEY with a trailing space); whether typing an email address
 * opened the menu (must not); and page errors. Screenshot at $SHOT.
 */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mention-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mention-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mention-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const W = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fleet = require(W + '/test-support/fleet');
const srv = require(W + '/server.js');
const projects = require(W + '/engine/projects');
const firstrun = require(W + '/engine/firstrun');
(async () => {
  fleet.install([
    fleet.agent('scarlet', { state: 'idle', displayName: 'Scarlet', role: 'a copywriter' }),
    fleet.agent('mara', { state: 'idle', displayName: 'Mara', role: 'a researcher' }),
  ]);
  try { firstrun.complete(); } catch (e) { console.log('firstrun', e.message); }
  const made = projects.create({ name: 'Winter launch', agents: ['scarlet', 'mara'], roster: [] });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.click('[data-tab="projects"]');
  await page.waitForSelector('#pj-list', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(600);
  const card = await page.$('#pj-list [data-pj="' + made.id + '"], #pj-list .pjcard, #pj-list article, #pj-list a, #pj-list button');
  if (!card) { console.log('no card; list html:', (await page.$eval('#pj-list', (el) => el.innerHTML)).slice(0, 400)); process.exit(2); }
  await card.click();
  await page.waitForSelector('#pj-post', { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.click('#pj-post');
  await page.keyboard.type('Hi @s');
  await page.waitForTimeout(300);
  const open = await page.$eval('#pj-mention', (el) => ({ hidden: el.hidden, html: el.innerHTML }));
  console.log('open:', !open.hidden, open.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: (process.env.SHOT || path.join(os.tmpdir(), 'mention-picker.png')), clip: { x: 0, y: 0, width: 1200, height: 800 } });
  await page.keyboard.press('Enter');
  const val = await page.$eval('#pj-post', (el) => el.value);
  console.log('after Enter:', JSON.stringify(val));
  await page.keyboard.type('admin@mara');
  await page.waitForTimeout(200);
  console.log('mid-address open?', !(await page.$eval('#pj-mention', (el) => el.hidden)));
  console.log('pageerrors:', errs);
  await browser.close(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
