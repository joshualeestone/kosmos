// Browser-check-surface: plus-state2 plus-signin-email plus-signin-company plus-si-company plus-si-company-code plus-si-company-open plus-si-company-finish plus-si-company-name plus-si-company-second-row plus-si-company-second plus-si-company-go plus-si-company-resend
'use strict';
/**
 * kosmos#5628 slice 2b-ui: a computer whose company's MDM installed the Kosmos profile signs in through the company's
 * sign-in, from the same "Sign in to activate Kosmos+" wizard. This walks it in a real browser against the board's
 * routes (answered here):
 *  - an unmanaged computer is not offered the company button; a managed one is;
 *  - start opens the company's page in the browser and shows the code it must show; the name step waits for approval;
 *  - once approved, Enter in the name box finishes with that name (and no terms: slice 2c asks them in the browser);
 *  - an account with a second step is asked for its code, and Enter in that box finishes with it;
 *  - the boxes are laid out (visible, usable width) and the page throws nothing.
 *
 *   node docs/browser-checks/render-plus-company-5628.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-company-5628.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscompany-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscompany-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscompany-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscompany-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pluscompany-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pluscompany-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };
const URL_SSO = 'https://login.kosmosplus.com/v1/sso/begin?email=neo%40acme.test&device_id=ks_setup_x';

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0 && !e.hidden && !e.closest('[hidden]'));
}, sel);
const width = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().width) : 0; }, sel);

async function openWizard(browser, BASE, managed, answers) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'dark' });
  const errs = [];
  const posts = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // Record window.open instead of opening a real tab.
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await page.route('**/api/remote', (route, req) => {
    const m = (req || route.request()).method();
    if (m === 'GET' || m === 'HEAD') route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNENROLLED) });
    else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/remote/devices**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) }));
  await page.route('**/api/remote/managed', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ managed: managed ? { orgSlug: 'acme' } : null }) }));
  await page.route('**/api/remote/company/**', async (route, rq) => {
    const req = rq || route.request();
    const step = new URL(req.url()).pathname.replace('/api/remote/company/', '');
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
    posts.push({ step, body });
    const [status, json] = answers(step, body, posts);
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  await page.route('**/api/remote/signin-**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stage":"cancelled"}' }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.click('#plus-signin-top');
  await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);   // the profile read
  return { page, errs, posts, sent: (step) => posts.filter((p) => p.step === step) };
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ---- An unmanaged computer: no company button. ----
    {
      const w = await openWizard(browser, BASE, false, () => [200, {}]);
      chk(!(await visible(w.page, '#plus-signin-company')), 'an unmanaged computer is not offered company sign-in');
      chk(await visible(w.page, '#plus-signin-code'), 'CONTROL: the email-code button is there');
      chk(w.errs.length === 0, 'no page errors (unmanaged)', w.errs.join(' | '));
      await w.page.close();
    }
    // ---- A managed computer: the whole company sign-in, with a second step. ----
    {
      let ready = false;
      const w = await openWizard(browser, BASE, true, (step, body) => {
        if (step === 'start') return [200, { ok: true, matchCode: 'K7-3M', url: URL_SSO, interval: 1 }];
        if (step === 'open') return [200, { ok: true }];
        // kosmos#5651: an authenticator account (no text to send).
        if (step === 'second-text') return [200, { ok: true, sent: false, second: 'totp' }];
        if (step === 'status') return [200, { ready, gone: false, retry: false }];
        if (step === 'complete') {
          return body && body.second ? [200, { ok: true, status: {} }]
            : [400, { error: 'this account has a second step, so adding a computer to it needs that code too.' }];
        }
        return [404, {}];
      });
      const { page } = w;
      chk(await visible(page, '#plus-signin-company'), 'a managed computer is offered "Sign in with your company"');
      await page.screenshot({ path: path.join(OUT, 'company-email-step.png') });
      await page.fill('#plus-signin-email', 'neo@acme.test');
      await page.click('#plus-signin-company');
      await page.waitForSelector('#plus-si-company', { state: 'visible', timeout: 5000 }).catch(() => {});
      const st = w.sent('start')[0];
      chk(!!st && st.body && st.body.email === 'neo@acme.test', 'start asks for the typed email', JSON.stringify(st));
      chk(w.sent('open').length === 1, 'the engine is asked to open the company sign-in (review 1: not window.open)', JSON.stringify(w.posts));
      chk((await page.evaluate(() => window.__opened)).length === 0, 'the page opens no window itself (the Mac app blocks it)');
      chk(/opened in your browser/.test(await page.textContent('#plus-si-company-lead')), 'it says opened only after the engine opened it');
      chk((await page.textContent('#plus-si-company-code')) === 'K7-3M', 'the code to compare is shown');
      chk((await page.getAttribute('#plus-si-company-open', 'href')) === URL_SSO, 'the open-again link goes to the company sign-in');
      chk(!(await visible(page, '#plus-si-company-name')), 'the name step waits for approval');
      await page.screenshot({ path: path.join(OUT, 'company-waiting.png') });
      ready = true;
      await page.waitForSelector('#plus-si-company-name', { state: 'visible', timeout: 6000 }).catch(() => {});
      chk(await visible(page, '#plus-si-company-name'), 'once approved, the name step shows');
      chk((await width(page, '#plus-si-company-name')) >= 200, 'the name box has a usable width', String(await width(page, '#plus-si-company-name')));
      await page.fill('#plus-si-company-name', 'neo-mac');
      await page.focus('#plus-si-company-name');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-company-second', { state: 'visible', timeout: 5000 }).catch(() => {});
      const c1 = w.sent('complete')[0];
      chk(!!c1 && c1.body && c1.body.name === 'neo-mac' && !('acceptTerms' in c1.body), 'Enter in the name box finishes with that name, and sends no terms', JSON.stringify(c1));
      chk(await visible(page, '#plus-si-company-second'), 'an account with a second step is asked for its code');
      await page.screenshot({ path: path.join(OUT, 'company-second-step.png') });
      await page.fill('#plus-si-company-second', '123456');
      await page.focus('#plus-si-company-second');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      const c2 = w.sent('complete')[1];
      chk(!!c2 && c2.body && c2.body.second === '123456' && c2.body.name === 'neo-mac', 'Enter in the second-step box finishes with its code', JSON.stringify(c2));
      chk(w.errs.length === 0, 'no page errors (managed)', w.errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
