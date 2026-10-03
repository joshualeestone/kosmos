'use strict';
/**
 * kosmos#3997 ruling A (Josh, 2026-10-02): a signed-in Claude account whose login is valid and unexpired is GREEN in
 * Settings > AI Models, like the other providers, without spending a `claude -p` turn. A real failure stays non-green.
 *
 * Drives the REAL page from the REAL server, in this process. Nothing reads the keychain or runs claude: the login
 * date is injected (claudeloginlive.setReaderForTests) and `claude auth status` answers signed in
 * (subscription.setRunner). Three Claude accounts:
 *   - boss (the default account): login good for 20 days  -> GREEN, "Signed in · login good until <date>"
 *   - aria: login good for 20 days, but Anthropic rejected it (recorded for its folder) -> NOT green, says Not connected
 *   - cleo: login ran out yesterday -> NOT green, and no "login good" date
 *   - then boss's Check now FAILS (a 403 refusal) -> the row is NOT green at once, and its button says so
 *
 * Control, measured: on main (the switch off, ruling C) boss renders the grey "acct-loginok" pill, so the first arm
 * fails there.
 *
 *   node docs/browser-checks/render-claude-login-green-3997.js            # headed
 *   HEADED=0 node docs/browser-checks/render-claude-login-green-3997.js   # headless
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-claude-login-green-3997.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cl-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cl-workers-'));
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cl-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cl-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

/* Three Claude sign-ins in the sandbox home: the default beside ~/.claude, two labelled folders. */
const HOME = process.env.AGENT_WORKFORCE_HOME;
const BOSS = 'boss3997@example.com';
const ARIA = 'aria3997@example.com';
const CLEO = 'cleo3997@example.com';
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: BOSS } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
const ARIA_DIR = path.join(HOME, '.claude-aria');
const CLEO_DIR = path.join(HOME, '.claude-cleo');
for (const [dir, email] of [[ARIA_DIR, ARIA], [CLEO_DIR, CLEO]]) {
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }));
}

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-claude-login-green-3997: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
fleet.install([]);
const subscription = require('../../engine/subscription');
subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }), err: null }));
const claudeloginlive = require('../../engine/claudeloginlive');
const observed = require('../../engine/observed');
const create = require('../../engine/create');
const DAY = 86400000;
claudeloginlive.setReaderForTests((ccd) => (ccd === CLEO_DIR ? Date.now() - DAY : Date.now() + 20 * DAY));
const srv = require('../../server.js');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-claude-login-green-3997: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* A Claude row's pill: its class, its text and its title. */
function pill(page, email) {
  return page.evaluate((em) => {
    const box = [...document.querySelectorAll('#s-sec-accounts .acct-box')].find((b) => (b.querySelector('.acct-who b') || {}).textContent === em);
    if (!box) return null;
    const p = box.querySelector('.acct-box-top > span[class^="acct-"]');
    return p ? { cls: p.className, text: p.textContent.trim(), title: p.getAttribute('title') || '' } : { cls: 'no pill', text: '', title: '' };
  }, email);
}

async function openAiModels(page, base) {
  await page.goto(base + '/?tab=settings', { waitUntil: 'load' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.evaluate(() => settingsGo('accounts'));
  await page.waitForSelector('#s-sec-accounts:not([hidden])', { timeout: 8000 });
}

/* Polls until all three rows are drawn, so a slow first read cannot pass or fail an arm by timing. */
async function rows(page) {
  const end = Date.now() + 8000;
  let got = {};
  while (Date.now() < end) {
    got = { boss: await pill(page, BOSS), aria: await pill(page, ARIA), cleo: await pill(page, CLEO) };
    if (got.boss && got.aria && got.cleo && got.boss.cls !== 'no pill') break;
    await page.waitForTimeout(150);
  }
  return got;
}

(async () => {
  const server = await srv.start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const fr = await fetch(base + '/api/first-run/complete', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    chk(fr.ok, 'first run completed on the board', 'status ' + fr.status);
    for (const engine of ENGINES) {
      const tag = `[${engine}]`;
      let browser;
      try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
      catch (err) {
        chk(false, `${tag} could not start a browser` + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
          err && err.message ? err.message.split('\n')[0] : String(err));
        continue;
      }
      try {
        observed._clearForTest();
        claudeloginlive._clearForTest();
        create.setClaudeProbe(null);
        // aria's sign-in was refused by Anthropic (as Check now or an agent would record it): its login date is still ahead.
        observed.sawDir(observed.PROVIDER.ANTHROPIC, ARIA_DIR, observed.OUTCOME.REJECTED, Date.now());
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message || e).split('\n')[0]));
        await openAiModels(page, base);
        const r = await rows(page);

        chk(r.boss && r.boss.cls === 'acct-connected', `${tag} a signed-in Claude account with a good login is GREEN`, JSON.stringify(r.boss));
        chk(r.boss && /^Signed in · login good until /.test(r.boss.text), `${tag} the green row says its login date`, JSON.stringify(r.boss && r.boss.text));
        chk(r.boss && /Check now to ask Anthropic directly/.test(r.boss.title) && !/turns green/.test(r.boss.title),
          `${tag} the green row's title says what the green rests on, not "turns green later"`, JSON.stringify(r.boss && r.boss.title));
        chk(r.aria && r.aria.cls !== 'acct-connected', `${tag} control: a rejected account with a good login date is NOT green`, JSON.stringify(r.aria));
        chk(r.aria && /Not connected/.test(r.aria.text), `${tag} control: the rejected account says why`, JSON.stringify(r.aria && r.aria.text));
        chk(r.cleo && r.cleo.cls !== 'acct-connected' && !/login good/.test(r.cleo.text),
          `${tag} control: an expired login is NOT green and claims no good date`, JSON.stringify(r.cleo));
        /* Review 3: Check now that FAILS (a 403 refusal, not a dead sign-in and not capacity) takes the green away on
           the page too, at once, with the button saying so; not green beside "Could not check". */
        create.setClaudeProbe(async () => ({ exitCode: 1, out: 'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"This organization has been disabled."}}' }));
        try {
          await page.evaluate((em) => {
            const box = [...document.querySelectorAll('#s-sec-accounts .acct-box')].find((b) => (b.querySelector('.acct-who b') || {}).textContent === em);
            box.querySelector('[data-check-claude]').click();
          }, BOSS);
          await page.waitForFunction((em) => {
            const box = [...document.querySelectorAll('#s-sec-accounts .acct-box')].find((b) => (b.querySelector('.acct-who b') || {}).textContent === em);
            const btn = box && box.querySelector('[data-check-claude]');
            return btn && /Could not check/.test(btn.textContent);
          }, BOSS, { timeout: 8000 }).catch(() => {});
          const after = await pill(page, BOSS);
          const btnText = await page.evaluate((em) => {
            const box = [...document.querySelectorAll('#s-sec-accounts .acct-box')].find((b) => (b.querySelector('.acct-who b') || {}).textContent === em);
            const btn = box && box.querySelector('[data-check-claude]');
            return btn ? btn.textContent : null;
          }, BOSS);
          chk(after && after.cls !== 'acct-connected', `${tag} a failed Check now takes the green away on the page at once`, JSON.stringify(after));
          chk(/Could not check/.test(btnText || ''), `${tag} and the button says the check failed`, JSON.stringify(btnText));
        } finally { create.setClaudeProbe(null); }
        chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    subscription.setRunner(null);
    claudeloginlive.setReaderForTests(null);
  }
  console.log(fail.length ? `render-claude-login-green-3997: ${fail.length} failed` : 'render-claude-login-green-3997: all passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
