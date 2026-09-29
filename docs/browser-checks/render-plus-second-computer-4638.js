// Browser-check-surface: plus-si-register plus-si-name-field plus-si-owned plus-si-done plus-si-done-line plus-si-match plus-si-match-code
/**
 * #4638 (Josh, 2026-09-29 15:13-15:17): signing in to Kosmos+ on a SECOND computer. The sign-in answer has no
 * account address of its own (another computer holds the account's name) but names that computer's address and the
 * code its Allow card shows. The wizard must:
 *  - never show the "Choose your Kosmos+ address" chooser,
 *  - register this computer under its own name (PizzaRama -> pizzarama), trying pizzarama-2 when that is taken,
 *  - land on "PizzaRama is connected to Kosmos+ as ..." with the code to match on the other computer, large.
 * CONTROL: a first computer (no other address) still gets the chooser, and no code.
 * The signin-* routes are stubbed; plusSiStage is driven with the engine's page-safe answer shape (engine/remote.js
 * secondComputerFields, pinned in engine/remote.test.js).
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-plus-second-computer-4638.js
 */
'use strict';
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussecond-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussecond-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussecond-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussecond-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussecond-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };
let passed = 0;
const failed = [];
const ok = (label, cond, detail) => { if (cond) { passed += 1; console.log('PASS  ' + label); } else { failed.push(label); console.log('FAIL  ' + label + (detail ? '  --  ' + String(detail).slice(0, 300) : '')); } };

async function openWizard(page, url) {
  await page.route('**/api/remote', (route, req) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(req.method() === 'GET' || req.method() === 'HEAD' ? UNENROLLED : { ok: true }) }));
  await page.route('**/api/remote/devices**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) }));
  await page.goto(url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.waitForFunction(() => { const s1 = document.getElementById('plus-state1'); return s1 && s1.offsetHeight > 0; }, null, { timeout: 5000 });
  await page.evaluate(() => plusSiEnter());
}

const seen = (page, id) => page.evaluate((i) => { const e = document.getElementById(i); return !!(e && !e.hidden && e.getBoundingClientRect().height > 0); }, id);

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ---- a second computer ----
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await openWizard(page, URL);
    const names = [];
    let chooserSeen = false;
    await page.route('**/api/remote/signin-register', async (route, req) => {
      const name = req.postDataJSON().name;
      names.push(name);
      chooserSeen = chooserSeen || await seen(page, 'plus-si-name-field');
      if (name === 'pizzarama') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'the coordinator said no (409): that name is taken' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'registered', address: name + '.kosmosplus.com', name, standing: 'active', switchedOn: true }) });
    });
    await page.evaluate(() => plusSiStage('session', { stage: 'session', account_address: '', other_address: 'josh09292026.kosmosplus.com', other_labels: ['josh09292026'], match_code: 'K7-3M', computer: 'PizzaRama' }));
    await page.waitForSelector('#plus-si-done', { state: 'visible', timeout: 10000 });
    ok('the address chooser never showed', !chooserSeen && !(await seen(page, 'plus-si-name-field')));
    ok('registered under its own name, then name-2 when that was taken', JSON.stringify(names) === JSON.stringify(['pizzarama', 'pizzarama-2']), JSON.stringify(names));
    const done = await page.evaluate(() => ({
      line: document.getElementById('plus-si-done-line').textContent,
      lead: document.getElementById('plus-si-match-lead').textContent,
      code: document.getElementById('plus-si-match-code').textContent,
      size: parseFloat(getComputedStyle(document.getElementById('plus-si-match-code')).fontSize),
    }));
    ok('it says which computer is connected, and where', done.line === 'PizzaRama is connected to Kosmos+ as pizzarama-2.kosmosplus.com.', done.line);
    ok('it names the other computer that is asking', /your other computer \(josh09292026\) is asking whether to let this one in/.test(done.lead), done.lead);
    ok('it shows the code to match, large', done.code === 'K7-3M' && await seen(page, 'plus-si-match-code') && done.size >= 28, JSON.stringify(done));
    ok('no page errors (second computer)', errs.length === 0, errs.join(' | '));
    await page.close();

    // ---- review round 1: the refusals that must NOT be retried, the ones that must, and the end of the run ----
    const flow = async (answer, refuse) => {
      const pg = await browser.newPage({ viewport: { width: 1400, height: 950 } });
      await openWizard(pg, URL);
      const tried = [];
      await pg.route('**/api/remote/signin-register', (route, req) => {
        const name = req.postDataJSON().name;
        tried.push(name);
        const no = refuse(name, tried.length);
        if (no) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: no }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'registered', address: name + '.kosmosplus.com', name, standing: 'active', switchedOn: true }) });
      });
      await pg.evaluate((a) => plusSiStage('session', a), answer);
      await pg.waitForTimeout(1500);
      const st = await pg.evaluate(() => ({ chooser: !document.getElementById('plus-si-name-field').hidden, done: !document.getElementById('plus-si-done').hidden, msg: document.getElementById('plus-signin-msg').textContent, lead: document.getElementById('plus-si-match-lead').textContent }));
      await pg.close();
      return { tried, st };
    };
    const SECOND = { stage: 'session', account_address: '', other_address: 'josh09292026.kosmosplus.com', other_labels: ['josh09292026'], match_code: 'K7-3M', computer: 'PizzaRama' };
    const reinstall = await flow({ ...SECOND, other_labels: ['josh09292026', 'pizzarama'] }, () => 'not expected');
    ok('a computer whose own name is already on the account gets today\'s chooser, and nothing registers by itself', reinstall.st.chooser && reinstall.tried.length === 0, JSON.stringify(reinstall));
    const inUse = await flow(SECOND, () => 'the coordinator said no (409): The name pizzarama is already in use by a Mac on this account, at pizzarama.kosmosplus.com. If that is this Mac, it is already set up and there is nothing more to do here.');
    ok('"already in use by a Mac on this account" is shown to the person, never retried as name-2', JSON.stringify(inUse.tried) === '["pizzarama"]' && /already in use by a Mac on this account/.test(inUse.st.msg), JSON.stringify(inUse));
    const reserved = await flow({ ...SECOND, computer: 'Admin' }, (n) => (n === 'admin' ? 'the coordinator said no (400): that name is kept by Kosmos itself: please pick another' : ''));
    ok('a name Kosmos keeps for itself moves on to name-2', JSON.stringify(reserved.tried) === '["admin","admin-2"]' && reserved.st.done, JSON.stringify(reserved));
    const run = await flow(SECOND, (n, i) => (i <= 9 ? 'the coordinator said no (409): that name is taken' : ''));
    ok('a long run of clashes ends on a private name, not an endless Try again', run.tried.length === 10 && run.tried[8] === 'pizzarama-9' && /^[a-z0-9]{8}$/.test(run.tried[9]) && run.st.done, JSON.stringify(run.tried));
    const several = await flow({ ...SECOND, other_labels: ['josh09292026', 'studio'] }, () => '');
    ok('with several other computers it does not name one that may not be the one asking', /one of your other computers is asking/.test(several.st.lead), several.st.lead);

    // ---- CONTROL: a first computer ----
    const first = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    await openWizard(first, URL);
    let registered = 0;
    await first.route('**/api/remote/signin-register', (route) => { registered += 1; route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"not expected"}' }); });
    await first.evaluate(() => plusSiStage('session', { stage: 'session', account_address: '' }));
    await first.waitForTimeout(400);
    ok('CONTROL: a first computer gets the address chooser, and nothing registers by itself', await seen(first, 'plus-si-name-field') && registered === 0);
    // And a finished second-computer sign-in leaves nothing behind for the next one.
    await first.evaluate(() => { PLUS_SI_SECOND = { base: 'x', tries: 0, code: 'AB-CD', other: 'y.kosmosplus.com', computer: 'X', domain: 'kosmosplus.com' }; plusSiSecondDone('x.kosmosplus.com'); plusSiClear(); });
    const after = await first.evaluate(() => ({ match: document.getElementById('plus-si-match').hidden, line: document.getElementById('plus-si-done-line').textContent, second: PLUS_SI_SECOND }));
    ok('CONTROL: a new sign-in starts with the plain landing', after.match === true && /login\.kosmosplus\.com/.test(after.line) && after.second === null, JSON.stringify(after));
    await first.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed.length ? passed + ' passed, ' + failed.length + ' FAILED' : 'render-plus-second-computer-4638: all ' + passed + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
