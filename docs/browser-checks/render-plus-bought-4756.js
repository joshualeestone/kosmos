// Browser-check-surface: plus-si-bought plus-si-bought-list plus-si-bought-none plus-si-bought-none-hint plus-si-bought-buy plus-si-bought-recheck plus-si-register plus-si-name-field plus-si-owned plus-si-done
'use strict';
/**
 * kosmos#4756 (the website + app half of #4754; Josh 2026-09-30, ruling "A": a new computer is a purchase).
 *
 * With bought addresses live, the in-app sign-in's session step lists the account's BOUGHT addresses that
 * have no computer yet, and a second computer signs in to one. It never names one. With none bought it
 * says so and links to the website. Everything else is the step as before: the switch off, the account's
 * first computer, and a computer signing in again to the address it already holds.
 *
 * The engine and the coordinator are stubbed at /api/remote/signin-*, so no account, email or network is
 * used. What only a browser shows: which panel a person SEES, what the buttons say, and that no register
 * is sent until they pick.
 *
 *   node docs/browser-checks/render-plus-bought-4756.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-bought-4756.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusbought-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusbought-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusbought-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusbought-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusbought-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'plusbought-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };
const BUY = 'https://login.kosmosplus.test/signin#add-computer';
const row = (name, state) => ({ name, address: name + '.kosmosplus.com', state });
const reg = (name) => ({ ok: true, stage: 'registered', address: name + '.kosmosplus.com', name, standing: 'good' });

/* Each scenario: what signin-addresses answers (a list, so a Check again can get the next one), and the
   one address the wizard must register to by itself (auto), or null when it must wait for a pick. */
const SCENARIOS = {
  pick: { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free'), row('other', 'free'), row('paying', 'pending')] }], auto: null },
  none: { lists: [
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('paying', 'pending')] },
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('paying', 'free')] },
  ], auto: null },
  off: { lists: [{ ok: true, live: false }], auto: 'first' },
  unreachable: { lists: [null], auto: 'first' },   // the engine route refuses: the step as before
  'first-computer': { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'free')] }], auto: 'first' },
  'this-computer': { lists: [{ ok: true, live: true, this_name: 'first', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: 'first' },
};

async function open(page) {
  await page.route('**/api/remote', (route, req) => {
    const m = req.method();
    if (m === 'GET' || m === 'HEAD') route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNENROLLED) });
    else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/remote/devices**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) }));
  await page.goto(page.__url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.waitForFunction(() => { const s1 = document.getElementById('plus-state1'); return s1 && s1.offsetHeight > 0; }, null, { timeout: 5000 });
}

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0 && !e.hidden);
}, sel);

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const key of Object.keys(SCENARIOS)) {
      const sc = SCENARIOS[key];
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
      page.__url = BASE;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const regs = [];
      let asked = 0;
      await open(page);
      await page.route('**/api/remote/signin-**', (route, req) => {
        const p = new URL(req.url()).pathname;
        const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (p === '/api/remote/signin-start') return json(200, { ok: true, stage: 'code_sent' });
        if (p === '/api/remote/signin-verify') return json(200, { ok: true, stage: 'session', account_address: 'first.kosmosplus.com' });
        if (p === '/api/remote/signin-addresses') {
          const ans = sc.lists[Math.min(asked, sc.lists.length - 1)]; asked += 1;
          return ans ? json(200, ans) : json(400, { error: 'Kosmos+ could not be reached to list your addresses' });
        }
        if (p === '/api/remote/signin-register') { const b = req.postDataJSON(); regs.push(b.name); return json(200, reg(b.name)); }
        if (p === '/api/remote/signin-cancel') return json(200, { ok: true, stage: 'cancelled' });
        return json(400, { error: 'no stub for ' + p });
      });
      await page.click('#plus-signin-top');
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-signin-email', 'her@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-si-code-in', '123456');   // six digits submit by themselves (#3942)
      await page.waitForFunction(() => { const r = document.getElementById('plus-si-register'); const d = document.getElementById('plus-si-done'); return (r && !r.hidden) || (d && !d.hidden); }, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      chk(asked >= 1, `[${key}] the session step asked for the account's addresses`);

      if (sc.auto) {
        await page.waitForFunction(() => { const d = document.getElementById('plus-si-done'); return d && !d.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(regs.length === 1 && regs[0] === sc.auto, `[${key}] registers to ${sc.auto} by itself, as before`, JSON.stringify(regs));
        chk(!(await visible(page, '#plus-si-bought')), `[${key}] no bought-address chooser`);
      } else if (key === 'pick') {
        chk(await visible(page, '#plus-si-bought'), `[${key}] the bought-address chooser shows`);
        const btns = await page.$$eval('#plus-si-bought-list button', (b) => b.map((x) => x.textContent.trim()));
        chk(JSON.stringify(btns) === JSON.stringify(['spare.kosmosplus.com', 'other.kosmosplus.com']), `[${key}] one button per FREE bought address (not in use, not pending)`, JSON.stringify(btns));
        chk(!(await visible(page, '#plus-si-name-field')), `[${key}] no field to type a name: a computer never makes an address`);
        chk(!(await visible(page, '#plus-si-register-go')), `[${key}] no Finish button beside the choices`);
        chk(regs.length === 0, `[${key}] nothing registered before a pick`, JSON.stringify(regs));
        await page.screenshot({ path: path.join(OUT, 'plus-bought-pick-light.png') });
        await page.click('#plus-si-bought-list button[data-bought="spare"]');
        await page.waitForFunction(() => { const d = document.getElementById('plus-si-done'); return d && !d.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(regs.length === 1 && regs[0] === 'spare', `[${key}] the pick registers exactly that address`, JSON.stringify(regs));
        chk(await visible(page, '#plus-si-done'), `[${key}] and lands on the signed-in landing`);
      } else if (key === 'none') {
        chk(await visible(page, '#plus-si-bought-none'), `[${key}] with none free it says so`);
        chk(/waiting for its payment/.test(await page.textContent('#plus-si-bought-none-lead')), `[${key}] a pending purchase is named as waiting for its payment`);
        chk((await page.getAttribute('#plus-si-bought-buy', 'href')) === BUY, `[${key}] the buy link is the coordinator's`, await page.getAttribute('#plus-si-bought-buy', 'href'));
        chk(!(await visible(page, '#plus-si-name-field')), `[${key}] no field to type a name`);
        await page.screenshot({ path: path.join(OUT, 'plus-bought-none-light.png') });
        await page.click('#plus-si-bought-recheck');
        await page.waitForSelector('#plus-si-bought-list button[data-bought="paying"]', { state: 'visible', timeout: 5000 }).catch(() => {});
        chk(asked === 2, `[${key}] Check again asks again`, String(asked));
        chk(await visible(page, '#plus-si-bought-list button[data-bought="paying"]'), `[${key}] and offers the address once it is confirmed`);
        chk(!(await visible(page, '#plus-si-bought-none')), `[${key}] the none panel goes`);
        chk(regs.length === 0, `[${key}] nothing registered without a pick`);
      }
      chk(errs.length === 0, `[${key}] no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('shots: ' + OUT);
  if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
  console.log('\nALL PASS');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
