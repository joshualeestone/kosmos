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
  // Set up before as another of the account's addresses: it keeps that one, with no pick.
  'this-other': { lists: [{ ok: true, live: true, this_name: 'spare', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'in_use'), row('other', 'free')] }], auto: 'spare' },
  // An account with no address yet, switch on: it cannot name one here, so it is told how to buy one (no name step).
  'no-address': { account: '', lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [] }], auto: null },
  // Check again that finds the switch now off takes the step as before, not a list that can never work.
  'recheck-switched-off': { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use')] }, { ok: true, live: false }], auto: null },
  // Check again that cannot reach the service stays on the panel and says so; it never falls back to the account's address.
  'recheck-fails': { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use')] }, null], auto: null },
  // The read is slow: the code step is gone at once (its spent code cannot be sent again) and the step says it is checking.
  'slow-read': { delay: 2500, lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: null },
  // A re-read after the sign-in has ended goes to the Start over panel, not a list that can no longer work.
  'recheck-expired': { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use')] }, { error: 'your sign-in has ended; start again from the email' }], auto: null },
  // A re-read that finds the account's own address free again takes the step as before, with the list gone.
  'recheck-now-free': { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use')] }, { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'free')] }], auto: null },
  // A refused pick whose re-read also fails keeps the refusal, and never re-offers the refused address.
  'pick-refused-reread-fails': { refuse: 'spare', lists: [
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free'), row('other', 'free')] }, null,
  ], auto: null },
  // A pick that cannot reach the service is not a refusal: the address is still theirs, and Try again retries it.
  'pick-offline': { offline: 'spare', lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: null },
  // A pick that fails for a reason that is not "taken" (a certificate) is not a refusal either: Try again, same address.
  'pick-cert-fail': { certfail: 'spare', lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: null },
  // The account's own address still waiting for payment is not bought yet: the list with its waiting line, no register.
  'own-pending': { lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'pending')] }], auto: null },
  // A pick that failed offline, then was taken by another computer before Try again: back to the list, not Try again forever.
  'retry-refused': { refuseSecond: 'spare', lists: [
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free'), row('other', 'free')] },
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'in_use'), row('other', 'free')] },
  ], auto: null },
  // A retire that failed with a 409 is not "that address is taken": Try again on the same address.
  'pick-retire-409': { retire409: 'spare', lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: null },
  // The first read fails, so the old step registers to the account's address; another computer holds it, and the
  // refusal goes to the list (read again) rather than Try again on an address that can never work.
  'unread-then-refused': { refuse: 'first', lists: [null, { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: null },
  // The account's own address reads free, but another computer takes it first: the refusal goes to the list, and the
  // address is not registered to again even if a re-read still says it is free.
  'own-free-taken': { refuse: 'first', lists: [
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'free'), row('spare', 'free')] },
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'free'), row('spare', 'free')] },
  ], auto: null },
  // This computer's own stale sign-in holds the picked address: not a refusal, so Try again on it (after removing the
  // stale entry on the website) works, and the address is never banished.
  'pick-own-stale': { stale: 'spare', lists: [{ ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free')] }], auto: null },
  // The first read fails and the person TYPES a name that is taken: that keeps the name step (not the list), as before.
  'unread-typed-taken': { account: '', refuse: 'mine', lists: [null], auto: null },
  // A pick refused (another computer took it first) returns to the list with the reason, not Try again on the same address.
  'pick-refused': { refuse: 'spare', lists: [
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'free'), row('other', 'free')] },
    { ok: true, live: true, this_name: '', buy_url: BUY, addresses: [row('first', 'in_use'), row('spare', 'in_use'), row('other', 'free')] },
  ], auto: null },
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
  // The Settings nav can still be drawing when the panel shows (seen twice under load): wait for the button itself,
  // and open Settings once more if it has not come.
  for (let i = 0; i < 2; i += 1) {
    await page.evaluate(() => showTab('settings'));
    await page.waitForSelector('#panel-settings:not([hidden])');
    if (await page.waitForSelector('#s-nav button[data-go="plus"]', { state: 'visible', timeout: 10000 }).then(() => true, () => false)) break;
  }
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
        if (p === '/api/remote/signin-verify') return json(200, { ok: true, stage: 'session', account_address: sc.account === undefined ? 'first.kosmosplus.com' : sc.account });
        if (p === '/api/remote/signin-addresses') {
          const ans = sc.lists[Math.min(asked, sc.lists.length - 1)]; asked += 1;
          const answer = () => (!ans ? json(400, { error: 'Kosmos+ could not be reached to list your addresses' }) : ans.error ? json(400, ans) : json(200, ans));
          if (sc.delay) { setTimeout(answer, sc.delay); return; }
          return answer();
        }
        if (p === '/api/remote/signin-register') {
          const b = req.postDataJSON(); regs.push(b.name);
          // The coordinator's own 409 sentence, as the tunnel program passes it on.
          if (sc.refuse === b.name) return json(400, { error: 'Kosmos+ said no (409): that name is taken.' });
          if (sc.refuseSecond === b.name && regs.length === 2) return json(400, { error: 'Kosmos+ said no (409): that name is taken.' });
          if ((sc.offline === b.name || sc.refuseSecond === b.name) && regs.length === 1) return json(400, { error: 'this computer could not reach the sign-in service' });
          if (sc.retire409 === b.name && regs.length === 1) return json(400, { error: 'an earlier sign-in on this computer could not be removed (the coordinator said no (409): busy); try again in a moment' });
          if (sc.stale === b.name && regs.length === 1) return json(400, { error: 'The name spare may be held by an earlier sign-in on this computer. Remove it on your account page, or pick another name.' });
          if (sc.certfail === b.name && regs.length === 1) return json(400, { error: 'the certificate for spare.kosmosplus.com could not be issued; try again in a minute' });
          return json(200, reg(b.name));
        }
        if (p === '/api/remote/signin-cancel') return json(200, { ok: true, stage: 'cancelled' });
        return json(400, { error: 'no stub for ' + p });
      });
      await page.click('#plus-signin-top');
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-signin-email', 'her@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-si-code-in', '123456');   // six digits submit by themselves (#3942)
      if (sc.delay) {
        await page.waitForTimeout(700);
        chk(!(await visible(page, '#plus-si-code')), `[${key}] the code step is gone while the list is read`);
        chk(/Checking your Kosmos\+ addresses/.test(await page.textContent('#plus-si-owned')), `[${key}] the step says it is checking`, await page.textContent('#plus-si-owned'));
        chk(await visible(page, '#plus-si-spin'), `[${key}] with the ring loader`);
        await page.waitForTimeout(sc.delay);
      }
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
        chk(/If this computer used to be first\.kosmosplus\.com, retire it on your account page first/.test(await page.textContent('#plus-si-bought-none-hint')), `[${key}] and says how to free the account's address if it was this computer's`, await page.textContent('#plus-si-bought-none-hint'));
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
      else if (key === 'slow-read') {
        chk(await visible(page, '#plus-si-bought-list button[data-bought="spare"]'), `[${key}] then the list`);
        chk(!(await visible(page, '#plus-si-spin')), `[${key}] and the loader stops`);
        chk(!/Checking/.test(await page.textContent('#plus-si-owned')) || !(await visible(page, '#plus-si-owned')), `[${key}] and the checking line is gone`);
      } else if (key === 'recheck-expired') {
        await page.click('#plus-si-bought-recheck');
        await page.waitForSelector('#plus-si-expired', { state: 'visible', timeout: 8000 }).catch(() => {});
        chk(await visible(page, '#plus-si-expired'), `[${key}] an ended sign-in goes to Start over`);
        chk(!(await visible(page, '#plus-si-bought')), `[${key}] not a list that can no longer work`);
      } else if (key === 'recheck-now-free') {
        await page.click('#plus-si-bought-recheck');
        await page.waitForFunction(() => { const d = document.getElementById('plus-si-done'); return d && !d.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(regs.length === 1 && regs[0] === 'first', `[${key}] registers to the account's own address, as before`, JSON.stringify(regs));
        chk(!(await visible(page, '#plus-si-bought')), `[${key}] with the list hidden`);
      } else if (key === 'pick-refused-reread-fails') {
        await page.click('#plus-si-bought-list button[data-bought="spare"]');
        await page.waitForFunction(() => /could not be reached/.test(document.getElementById('plus-signin-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        const msg = await page.textContent('#plus-signin-msg');
        chk(/that name is taken/.test(msg) && /could not be reached/.test(msg), `[${key}] both the refusal and the failed read are said`, msg);
        chk(!/\.\./.test(msg), `[${key}] without a doubled full stop`, msg);
        const btns = await page.$$eval('#plus-si-bought-list button', (b) => b.map((x) => x.getAttribute('data-bought')));
        chk(JSON.stringify(btns) === JSON.stringify(['other']), `[${key}] the refused address is not offered again`, JSON.stringify(btns));
        chk(!(await visible(page, '#plus-si-owned')), `[${key}] no "Connecting this computer as" line left beside it`);
        chk(regs.length === 1, `[${key}] nothing else was registered`, JSON.stringify(regs));
      } else if (key === 'recheck-switched-off') {
        await page.click('#plus-si-bought-recheck');
        await page.waitForFunction(() => { const d = document.getElementById('plus-si-done'); return d && !d.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(regs.length === 1 && regs[0] === 'first', `[${key}] takes the step as before (registers to the account's address)`, JSON.stringify(regs));
        chk(!(await visible(page, '#plus-si-bought')), `[${key}] with the list gone`);
      } else if (key === 'unread-then-refused') {
        await page.waitForSelector('#plus-si-bought-list button[data-bought="spare"]', { state: 'visible', timeout: 8000 }).catch(() => {});
        chk(regs.length === 1 && regs[0] === 'first', `[${key}] the old step tried the account's address once`, JSON.stringify(regs));
        chk(asked === 2, `[${key}] then read the list again`, String(asked));
        const btns = await page.$$eval('#plus-si-bought-list button', (b) => b.map((x) => x.getAttribute('data-bought')));
        chk(JSON.stringify(btns) === JSON.stringify(['spare']), `[${key}] and offers the free address`, JSON.stringify(btns));
        chk(!(await visible(page, '#plus-si-register-go')), `[${key}] not Try again on the held address`);
      } else if (key === 'own-free-taken') {
        await page.waitForSelector('#plus-si-bought-list button[data-bought="spare"]', { state: 'visible', timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        chk(JSON.stringify(regs) === JSON.stringify(['first']), `[${key}] one register to the account's address, not a second`, JSON.stringify(regs));
        const btns = await page.$$eval('#plus-si-bought-list button', (b) => b.map((x) => x.getAttribute('data-bought')));
        chk(JSON.stringify(btns) === JSON.stringify(['spare']), `[${key}] the list, without the refused address though the re-read says free`, JSON.stringify(btns));
      } else if (key === 'unread-typed-taken') {
        await page.waitForSelector('#plus-si-name', { state: 'visible', timeout: 8000 }).catch(() => {});
        await page.fill('#plus-si-name', 'mine');
        await page.click('#plus-si-register-go');
        await page.waitForFunction(() => /that name is taken/.test(document.getElementById('plus-signin-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        chk(regs.length === 1 && regs[0] === 'mine', `[${key}] the typed name was sent`, JSON.stringify(regs));
        chk(await visible(page, '#plus-si-name-field'), `[${key}] the name step stays, so another name can be typed`);
        chk(asked === 1, `[${key}] the list is not read again for a typed name`, String(asked));
      } else if (key === 'own-pending') {
        chk(await visible(page, '#plus-si-bought-none'), `[${key}] the none panel shows`);
        chk(/waiting for its payment/.test(await page.textContent('#plus-si-bought-none-lead')), `[${key}] with the waiting-for-payment line`);
        chk(regs.length === 0, `[${key}] and nothing is registered to the unpaid address`, JSON.stringify(regs));
      } else if (key === 'retry-refused') {
        await page.click('#plus-si-bought-list button[data-bought="spare"]');
        await page.waitForSelector('#plus-si-register-go', { state: 'visible', timeout: 8000 }).catch(() => {});
        await page.click('#plus-si-register-go');
        await page.waitForFunction(() => /that name is taken/.test(document.getElementById('plus-signin-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        chk(JSON.stringify(regs) === JSON.stringify(['spare', 'spare']), `[${key}] the pick, then its retry`, JSON.stringify(regs));
        const btns = await page.$$eval('#plus-si-bought-list button', (b) => b.map((x) => x.getAttribute('data-bought')));
        chk(JSON.stringify(btns) === JSON.stringify(['other']), `[${key}] the refused retry goes back to the list, without the taken address`, JSON.stringify(btns));
        chk(!(await visible(page, '#plus-si-register-go')), `[${key}] not Try again forever`);
      } else if (key === 'pick-offline' || key === 'pick-cert-fail' || key === 'pick-retire-409' || key === 'pick-own-stale') {
        await page.click('#plus-si-bought-list button[data-bought="spare"]');
        await page.waitForSelector('#plus-si-register-go', { state: 'visible', timeout: 8000 }).catch(() => {});
        chk(asked === 1, `[${key}] the list is not re-read (the address was not refused)`, String(asked));
        chk((await page.textContent('#plus-si-register-go')).trim() === 'Try again', `[${key}] Try again is offered`);
        chk(/could not connect as/.test(await page.textContent('#plus-si-owned')) && /spare/.test(await page.textContent('#plus-si-owned')), `[${key}] on the same address`, await page.textContent('#plus-si-owned'));
        await page.click('#plus-si-register-go');
        await page.waitForFunction(() => { const d = document.getElementById('plus-si-done'); return d && !d.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(JSON.stringify(regs) === JSON.stringify(['spare', 'spare']), `[${key}] and it succeeds on the retry`, JSON.stringify(regs));
      } else if (key === 'no-address') {
        chk(!(await visible(page, '#plus-si-name-field')), `[${key}] no name field: a computer never makes an address`);
        chk(await visible(page, '#plus-si-bought-none'), `[${key}] it is told how to buy one`);
        chk(regs.length === 0, `[${key}] nothing registered by itself`, JSON.stringify(regs));
      } else if (key === 'recheck-fails') {
        chk(await visible(page, '#plus-si-bought-none'), `[${key}] starts on the none panel`);
        await page.click('#plus-si-bought-recheck');
        await page.waitForFunction(() => /could not/i.test(document.getElementById('plus-signin-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        chk(asked === 2, `[${key}] Check again asked again`, String(asked));
        chk(/could not be reached to list your addresses/.test(await page.textContent('#plus-signin-msg')), `[${key}] the failure is said`, await page.textContent('#plus-signin-msg'));
        chk(await visible(page, '#plus-si-bought-none'), `[${key}] and the none panel stays`);
        chk(!(await page.isDisabled('#plus-si-bought-recheck')), `[${key}] Check again is usable again`);
        await page.waitForTimeout(800);
        chk(regs.length === 0, `[${key}] it never fell back to registering the account's address`, JSON.stringify(regs));
      } else if (key === 'pick-refused') {
        await page.click('#plus-si-bought-list button[data-bought="spare"]');
        await page.waitForFunction(() => /that name is taken/.test(document.getElementById('plus-signin-msg').textContent), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        chk(regs.length === 1 && regs[0] === 'spare', `[${key}] the pick was sent once`, JSON.stringify(regs));
        chk(/that name is taken/.test(await page.textContent('#plus-signin-msg')), `[${key}] the reason is said`);
        chk(asked === 2, `[${key}] the list was read again`, String(asked));
        const btns = await page.$$eval('#plus-si-bought-list button', (b) => b.map((x) => x.getAttribute('data-bought')));
        chk(JSON.stringify(btns) === JSON.stringify(['other']), `[${key}] back on the list, now without the taken address`, JSON.stringify(btns));
        chk(!(await visible(page, '#plus-si-register-go')), `[${key}] no Try again on the taken address`);
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
