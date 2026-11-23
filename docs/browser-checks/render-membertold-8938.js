// Browser-check-surface: plus-org-sees userpop-org fr-work-org acct-policy-note
'use strict';
/**
 * kosmos#8938: a company member's own Kosmos says it is the company's. HERMETIC (file://, fetch stubbed): /api/org is
 * a stand-in. Asserts, in the browser, for a company member (Testville, allowing Anthropic and OpenAI):
 *   M1  Settings, Kosmos+, Your company: the company's own accepted report words (what it reports, what it never
 *       sends) show, as text, under the company line;
 *   M2  Add a provider says, under its intro, which providers the company allows (the server's menu words), and
 *       leaves every option as it was (the options belong to the code that owns them);
 *   M3  the You menu shows "Work Kosmos for Testville Municipal" under the member line;
 *   M4  the setup welcome shows "This is your work Kosmos for Testville Municipal." under Josh's words;
 * and the CONTROLS, each on a fresh page: a family shows none of M1, M3, M4 and its M2 line says "Your family"; a
 * company with no provider list says nothing in M2; a company asking for no reports shows the company line but not
 * M1's what-it-sees line; a Kosmos in no company shows none of it.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-membertold-8938.js [shots-dir]
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-membertold-8938: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const COMPANY = { enrolled: true, reporting: true, reportingWait: null, wordsNeeded: false, stoppedFor: null, leaveRefused: null, org: { name: 'Testville Municipal', slug: 'testville', kind: 'company' }, role: 'member', enrolledAt: '2026-11-23T15:34:11.000Z', allowedProviderNames: ['Anthropic Claude', 'OpenAI'],
  reportWords: { reports: ['agent names, the AI provider and model each uses', 'project names'], backsUp: ['agent folders and their files'], never: ['keys and passwords'] } };
const STATES = {
  company: COMPANY,
  unlisted: Object.assign({}, COMPANY, { allowedProviderNames: undefined }),
  family: Object.assign({}, COMPANY, { org: { name: 'The Smiths', slug: 'smiths', kind: 'family' }, wordsNeeded: false }),
  quiet: Object.assign({}, COMPANY, { reporting: false, reportingWait: 'noReports' }),
  none: { enrolled: false, stoppedFor: null, leaveRefused: null, org: null, role: null, enrolledAt: null },
};

async function open(browser, state, tag) {
  TAG = tag;
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((st) => {
    window.setInterval = () => 0;
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url) => {
      const u = String(url);
      if (/\/api\/org(\?|$)/.test(u)) return enc(JSON.parse(JSON.stringify(st)));
      if (u.endsWith('/api/remote')) return enc({ enrolled: true, on: true });
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: [] });
      if (/\/api\/accounts\/compat(\?|$)/.test(u)) return enc({ enabled: false, vendors: [] });
      if (/\/api\/runners(\?|$)/.test(u)) return enc({ runners: {} });
      if (/\/api\/antigravity(\?|$)/.test(u)) return enc({ enabled: true, supported: false, installed: false });
      if (u.includes('/api/history')) return enc({ readable: false });
      return enc({});
    };
  }, state);
  await page.goto(PAGE);
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  return { page, errs };
}
let TAG = 'company';   // which state the screenshots belong to (each state saves its own)
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const seen = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && !el.hidden && el.getClientRects().length > 0 ? el.textContent : null; }, id);

async function companySees(page) {
  await page.evaluate(() => { showTab('settings'); settingsGo('plus'); });
  await page.waitForFunction(() => { const el = document.getElementById('plus-org-in'); return el && !el.hidden; }, null, { timeout: 5000 }).catch(() => {});
  await settle(page);
  return { say: await seen(page, 'plus-org-say'), sees: await seen(page, 'plus-org-sees'), order: await page.evaluate(() => { const a = document.getElementById('plus-org-say'), b = document.getElementById('plus-org-sees'); return !!(a && b && a.nextElementSibling === b); }) };
}
async function providers(page) {
  await page.evaluate(() => { showTab('settings'); settingsGo('accounts'); openAcctAdd(); });
  await settle(page, 600);
  const out = await page.evaluate(() => {
    const sel = document.getElementById('acct-provider-pick');
    const row = (v) => { const o = sel.querySelector('option[value="' + v + '"]'); return { text: o.textContent, disabled: o.disabled }; };
    return { claude: row('claude'), openai: row('openai'), google: row('google'), xai: row('xai') };
  });
  const note = await seen(page, 'acct-policy-note');
  const under = await page.evaluate(() => { const el = document.getElementById('acct-policy-note'); return !!el && !!el.previousElementSibling && el.previousElementSibling.id === 'acct-add-in'; });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'membertold-' + TAG + '-providers.png') }).catch(() => {});
  await page.evaluate(() => { if (!document.getElementById('acct-add-modal').hidden) closeAcctAdd(); });
  return { out, note, under };
}
const untouched = (out) => out.claude.text === 'Anthropic Claude' && out.openai.text === 'OpenAI' && out.google.text === 'Google Gemini' && out.xai.text === 'xAI Grok'
  && !out.claude.disabled && !out.openai.disabled && !out.google.disabled && !out.xai.disabled;
async function youMenu(page) {
  await page.evaluate(() => { document.documentElement.setAttribute('data-fed-member', ''); showTab('agents'); });
  await page.click('#userpop-btn');
  await settle(page, 500);
  const t = await seen(page, 'userpop-org');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'membertold-' + TAG + '-youmenu.png') }).catch(() => {});
  await page.keyboard.press('Escape');
  return t;
}
async function welcome(page) {
  await page.evaluate(() => { frOpen(); frGo(1); });
  await settle(page, 600);
  const t = await seen(page, 'fr-work-org');
  const after = await page.evaluate(() => { const el = document.getElementById('fr-work-org'); const p = el && el.previousElementSibling; return p ? p.textContent : null; });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'membertold-' + TAG + '-welcome.png') }).catch(() => {});
  await page.evaluate(() => { if (typeof frClose === 'function') frClose(); });
  return { t, after };
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch { console.error('FAIL  render-membertold-8938: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).')); process.exit(1); }
  const errsAll = [];
  try {
    // ----- a company member -----
    {
      const { page, errs } = await open(browser, STATES.company, 'company');
      const m1 = await companySees(page);
      chk(m1.say && /work Kosmos for Testville Municipal/.test(m1.say), 'M1 the company line shows', String(m1.say));
      chk(m1.sees === 'Your company\u2019s words for this computer. Reported: agent names, the AI provider and model each uses; project names. May back up: agent folders and their files. Never sent: keys and passwords.', 'M1 the company\u2019s own report words show', String(m1.sees));
      chk(m1.order, 'M1 it sits right under the company line');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'membertold-' + TAG + '-settings.png') }).catch(() => {});
      const m2 = await providers(page);
      chk(m2.note === 'Your company allows only Anthropic Claude and OpenAI for new agents in this Kosmos.', 'M2 Add a provider says which providers the company allows', String(m2.note));
      chk(m2.under, 'M2 the line sits right under the intro');
      chk(untouched(m2.out), 'M2 the options are left as they were', JSON.stringify(m2.out));
      chk((await youMenu(page)) === 'Work Kosmos for Testville Municipal', 'M3 the You menu names the company');
      const m4 = await welcome(page);
      chk(m4.t === 'This is your work Kosmos for Testville Municipal.', 'M4 the welcome names the company', String(m4.t));
      chk(m4.after === 'Create and manage a workforce of AI agents that work for you.', 'M4 it follows Josh’s words, unchanged', String(m4.after));
      errsAll.push(...errs);
      await page.close();
    }
    // ----- CONTROL: a company with no provider list -----
    {
      const { page, errs } = await open(browser, STATES.unlisted, 'unlisted');
      const m2 = await providers(page);
      chk(m2.note === null, 'CONTROL no list: Add a provider says nothing', String(m2.note));
      chk(untouched(m2.out), 'CONTROL no list: the options are as they were', JSON.stringify(m2.out));
      errsAll.push(...errs);
      await page.close();
    }
    // ----- CONTROL: a company that asks for no reports: the company line shows, the what-it-sees line does not -----
    {
      const { page, errs } = await open(browser, STATES.quiet, 'quiet');
      const m1 = await companySees(page);
      chk(!!m1.say, 'CONTROL no reports: the company line still shows', String(m1.say));
      chk(m1.sees === null, 'CONTROL no reports: no what-the-company-sees line under it', String(m1.sees));
      errsAll.push(...errs);
      await page.close();
    }
    // ----- CONTROL: a family, and a Kosmos in no company -----
    for (const k of ['family', 'none']) {
      const { page, errs } = await open(browser, STATES[k], k);
      const m1 = await companySees(page);
      chk(m1.sees === null, 'CONTROL ' + k + ': no what-the-company-sees line', String(m1.sees));
      chk((await youMenu(page)) === null, 'CONTROL ' + k + ': the You menu names no company');
      const m4 = await welcome(page);
      chk(m4.t === null, 'CONTROL ' + k + ': the welcome names no company', String(m4.t));
      const m2 = await providers(page);
      if (k === 'family') chk(m2.note === 'Your family allows only Anthropic Claude and OpenAI for new agents in this Kosmos.', 'CONTROL family: the provider line names the family, not a company', String(m2.note));
      else chk(m2.note === null, 'CONTROL none: Add a provider says nothing', String(m2.note));
      chk(untouched(m2.out), 'CONTROL ' + k + ': the options are as they were', JSON.stringify(m2.out));
      errsAll.push(...errs);
      await page.close();
    }
    chk(errsAll.length === 0, 'no page errors', errsAll.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
  console.log(fail.length ? '\nFAIL  render-membertold-8938: ' + fail.length + ' failed' : '\nPASS  render-membertold-8938: all passed');
  process.exit(fail.length ? 1 : 0);
})();
