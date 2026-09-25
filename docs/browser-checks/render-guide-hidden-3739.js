'use strict';
/**
 * #3739 (Josh, 2026-09-25; hide ruled 09:22): the setup guide is hidden from the Agents grid, list, org chart
 * and counts, and reached only from the bubble; it is titled "Kosmos Guide" and never reads "Unknown". A real
 * board with a guide (the seed's name and marker stubbed in-process) and one ordinary agent, Ida, as the control.
 * Screenshots: the grid, and the guide's own page opened by its URL.
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guidehide-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guidehide-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guidehide-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guidehide-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guidehide-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const setupAssistant = require('../../engine/setup-assistant');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'guidehide-shots-'));
const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

(async () => {
  setupAssistant.guideName = () => 'guidebot';
  setupAssistant.isGuideFolder = (n) => n === 'guidebot';
  fleet.install([
    fleet.agent('guidebot', { state: 'idle', displayName: 'Josh' }),
    fleet.agent('ida', { state: 'idle', displayName: 'Ida', role: 'Bookkeeper' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    await page.waitForSelector('#grid .acard', { timeout: 10000 });
    const board = await page.evaluate(() => ({
      cards: [...document.querySelectorAll('#grid .acard')].map((c) => c.textContent),
      listed: (typeof LISTED !== 'undefined' ? LISTED : []).map((a) => a.sessionName),
      all: (typeof LAST !== 'undefined' ? LAST : []).map((a) => a.sessionName),
      total: (document.getElementById('st-agents') || {}).textContent,
      banner: document.body.innerText,
    }));
    await page.screenshot({ path: path.join(OUT, 'grid.png') });
    say(board.cards.some((t) => /Ida/.test(t)), 'CONTROL: the ordinary agent is on the grid');
    say(!board.cards.some((t) => /Josh|Kosmos Guide/.test(t)), 'the guide is not on the grid', JSON.stringify(board.cards.map((t) => t.slice(0, 40))));
    say(board.all.includes('guidebot') && !board.listed.includes('guidebot'), 'the page still holds the guide for lookups, and lists it nowhere');
    say(String(board.total).trim() === '1', 'the Agents tile counts one agent, not the guide', 'tile=' + board.total);
    say(!/2 agents are sitting idle/.test(board.banner), 'the connection banner does not count the guide');

    await page.goto(URL + '/?tab=detail&agent=guidebot', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const detail = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: path.join(OUT, 'guide-page.png') });
    say(/Kosmos Guide/.test(detail), 'the guide\'s own page shows the title Kosmos Guide');
    say(!/Kosmos setup guide/.test(detail), 'the long title is gone');
    say(!/Unknown model|Model: Unknown|Unknown Model/i.test(detail), 'the guide\'s page never says Unknown for its model');
    say(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('shots: ' + OUT);
  console.log('render-guide-hidden-3739: ' + (fail.length ? fail.length + ' FAILED' : 'all passed'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
