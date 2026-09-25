'use strict';
/**
 * #3081: Create an agent remembers the last provider, account and model.
 *
 * web.create-prefs-3081.test.js proves the save and restore functions exist and
 * are wired. Only a browser can prove the whole path on a screen: an agent made
 * with a non-default account and model, then Create opened again, shows those
 * two pre-selected. The create POST is answered by the page's own route with
 * outcome 'created' so nothing is launched; everything before and after the
 * answer is the real page.
 *
 * Leads with a control: on a fresh page (no remembered choice) the account and
 * model are the ordinary defaults, and the values the check picks differ from
 * them, so a restore that silently did nothing would read as a failure rather
 * than as the defaults happening to match.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-create-prefs-3081.js
 */
require('./lib-sandbox-home.js').plantSubscribedClaude(); // #3675: its own home, one fixture account
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cprefs-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cprefs-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cprefs-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cprefs-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cprefs-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

/* Two fixture Claude accounts, so there is a non-default one to pick. */
const home = process.env.AGENT_WORKFORCE_HOME;
const second = path.join(home, '.claude-fixture2');
fs.mkdirSync(second, { recursive: true });
fs.writeFileSync(path.join(second, '.claude.json'), JSON.stringify({ oauthAccount: {
  emailAddress: 'fixture2@example.invalid', organizationName: 'Kosmos browser checks',
  organizationType: 'claude_max' } }) + '\n');

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function openCreate(page) {
  await page.evaluate(() => { showTab('create'); openCreate(); });
  await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });
  await page.evaluate(() => { document.getElementById('pick-pm').click(); document.getElementById('role-next').click(); });
  await page.waitForFunction(() => !document.getElementById('cstep-name').hidden, null, { timeout: 8000 });
  /* The accounts arrive async; wait until the account menu is filled. */
  await page.waitForFunction(() => document.getElementById('create-account').options.length >= 2, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const v = (id) => document.getElementById(id).value;
    const opts = (id) => Array.from(document.getElementById(id).options).filter((o) => !o.disabled).map((o) => o.value);
    return { provider: v('create-provider'), account: v('create-account'), model: v('create-model'),
      accounts: opts('create-account'), models: opts('create-model') };
  });
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    /* Control: nothing remembered yet. */
    const before = await openCreate(page);
    const saved = await page.evaluate(() => localStorage.getItem('kosmos.create.account'));
    chk(saved === null, 'control: no remembered choice on a fresh page', String(saved));
    chk(before.provider === 'anthropic', 'control: Claude is the provider', before.provider);
    const pickAccount = before.accounts.find((a) => a && a !== before.account);
    const pickModel = before.models.find((m) => m && m !== before.model);
    chk(!!pickAccount, 'control: a second account exists to pick', JSON.stringify(before.accounts));
    chk(!!pickModel, 'control: a second model exists to pick', JSON.stringify(before.models));

    /* Make an agent with the non-default account and model. */
    await page.route('**/api/agents', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ outcome: 'created', name: 'prefcheck', steps: [] }) });
    });
    await page.evaluate(({ a, m }) => {
      document.getElementById('create-account').value = a;
      document.getElementById('create-account').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('create-model').value = m;
      document.getElementById('create-model').dispatchEvent(new Event('change', { bubbles: true }));
      const name = document.getElementById('create-name');
      name.value = 'prefcheck';
      name.dispatchEvent(new Event('input', { bubbles: true }));
    }, { a: pickAccount, m: pickModel });
    await page.fill('#create-label', 'Checks the create defaults').catch(() => {});
    await page.click('#create-go');
    await page.waitForFunction(() => !!localStorage.getItem('kosmos.create.account'), null, { timeout: 8000 })
      .catch(() => {});
    const stored = await page.evaluate(() => ({
      provider: localStorage.getItem('kosmos.create.provider'),
      account: localStorage.getItem('kosmos.create.account'),
      model: localStorage.getItem('kosmos.create.model') }));
    chk(stored.account === pickAccount && stored.model === pickModel,
      'a created agent\'s account and model are remembered', JSON.stringify(stored));

    /* Open Create again, after a reload, the way a person comes back to it. */
    await page.unroute('**/api/agents');
    await page.goto(URL, { waitUntil: 'networkidle' });
    const after = await openCreate(page);
    chk(after.provider === 'anthropic', 'reopened: provider comes back', after.provider);
    chk(after.account === pickAccount, 'reopened: the last account is pre-selected', after.account + ' want ' + pickAccount);
    chk(after.model === pickModel, 'reopened: the last model is pre-selected', after.model + ' want ' + pickModel);

    /* A default, not a lock: the person can still change it. */
    const changed = await page.evaluate((a) => {
      const s = document.getElementById('create-account');
      s.value = a; s.dispatchEvent(new Event('change', { bubbles: true }));
      return s.value;
    }, before.account);
    chk(changed === before.account, 'reopened: the account can still be changed', changed);

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
