// Browser-check-surface: plus-state1 plus-state2 plus-si-email plus-si-code plus-si-second plus-si-enrol plus-si-enrol-sms plus-si-enrol-why plus-si-enrol-confirm plus-si-secret plus-si-register plus-flow plus-status
'use strict';
/**
 * #3478: the Kosmos+ sign-in links open the IN-APP wizard, not the web.
 *
 * The bug: `plus-signin-top` / `plus-signin-bottom` bounced to KOSMOS_SITE + '/plus'
 * (a #2625/#2626 stopgap). Josh's ask is the in-app flow. The backend (server.js
 * signin-* proxies + engine/remote.js's stage machine) was built under #3149; this
 * change wires the client. `node --test` proves the markup and the stage-routing
 * shape; only a browser proves what a person SEES: that clicking "Sign in" reveals
 * the wizard (it does not navigate away), and that the wizard walks the engine's
 * stages to a named, addressed computer.
 *
 * /api/remote is stubbed unenrolled so state 1 (and the sign-in link) is on screen;
 * the signin-* POSTs are stubbed per scenario so the same sandboxed server can be
 * driven through all three signin-verify branches (existing 2FA / enrol a 2FA /
 * straight to a session) without a real coordinator, account, email or phone.
 *
 *   node docs/browser-checks/render-plus-signin-3478.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-signin-3478.js   # headless
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'plussignin-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };

// The three signin-verify branches, each a path -> mock response map. Every step
// returns { ok:true, stage } plus whatever fields the wizard renders for that stage.
const SCENARIOS = {
  'existing-2fa': {
    label: 'account already has a second factor (email code -> phone code -> name)',
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'second' },
      '/api/remote/signin-second': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'sunny-otter', name: 'sunny-otter', standing: 'active' },
    },
  },
  'enrol-2fa': {
    label: 'account needs a second factor (email code -> set up authenticator -> name)',
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'enrol_second_factor', sms_available: true, why_authenticator: 'An authenticator app on your phone gives a fresh code every time you sign in.' },
      '/api/remote/signin-enrol': { ok: true, stage: 'enrolment_started', kind: 'totp', secret: 'ABCD1234EFGH5678' },
      '/api/remote/signin-confirm-enrol': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'brave-finch', name: 'brave-finch', standing: 'active' },
    },
  },
  'straight-session': {
    label: 'email code lands straight on a session (no phone step -> name)',
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'quiet-heron', name: 'quiet-heron', standing: 'active' },
    },
  },
  'enrol-2fa-sms': {
    label: 'account sets up its second factor by TEXT (email code -> text a code -> name)',
    entry: 'plus-signin-bottom',   // also exercises the foot "Already a member? Sign in" link
    smsEnrol: true,
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'enrol_second_factor', sms_available: true, why_authenticator: 'An authenticator app on your phone gives a fresh code every time you sign in.' },
      '/api/remote/signin-enrol': { ok: true, stage: 'enrolment_started', kind: 'sms', sent_to: '(•••) •••-4321' },
      '/api/remote/signin-confirm-enrol': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'calm-otter', name: 'calm-otter', standing: 'active' },
    },
  },
};

async function openPlusState1(page) {
  await page.route('**/api/remote', (route, req) => {
    const m = req.method();
    if (m === 'GET' || m === 'HEAD') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNENROLLED) });
    } else { route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
  });
  await page.route('**/api/remote/devices**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) });
  });
  await page.goto(page.__url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.waitForFunction(() => {
    const s1 = document.getElementById('plus-state1');
    return s1 && s1.offsetHeight > 0;
  }, null, { timeout: 5000 });
}

// Stub the signin-* POSTs for one scenario. Unroute first: a scenario runs on its
// own page, but be explicit so a future refactor onto a shared page cannot stack
// handlers (the #1615 flake).
async function routeScenario(page, steps) {
  await page.unroute('**/api/remote/signin-**');
  await page.route('**/api/remote/signin-**', (route, req) => {
    const p = new URL(req.url()).pathname;
    const body = steps[p];
    if (!body) { route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'no stub for ' + p }) }); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0 && !e.hidden);
}, sel);

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const key of Object.keys(SCENARIOS)) {
      const sc = SCENARIOS[key];
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
      page.__url = URL;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await openPlusState1(page);
      await routeScenario(page, sc.steps);

      // Before the click: state 1 is on screen and the wizard is NOT. The click must
      // NOT navigate away (the whole bug was that it did).
      const beforeUrl = page.url();
      chk(await visible(page, '#plus-state1'), `[${key}] state 1 is on screen before the click`);
      chk(!(await visible(page, '#plus-si-email')), `[${key}] the wizard email step is hidden before the click`);

      const entry = sc.entry || 'plus-signin-top';
      await page.click('#' + entry);
      await page.waitForTimeout(300);  // give a real navigation a beat to begin, then assert none did
      chk(page.url() === beforeUrl, `[${key}] the #${entry} sign-in link did NOT navigate away`, page.url());
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      chk(!(await visible(page, '#plus-state1')), `[${key}] state 1 gives way to the wizard on the sign-in click`);

      // #12/#13 (once, on the first scenario): "Not now" hides the wizard synchronously and
      // returns to the marketing state, and re-entering starts from a cleared field rather
      // than a stale one. Scenario-independent behavior, so exercise it just here.
      if (key === 'existing-2fa') {
        await page.fill('#plus-signin-email', 'stale@example.com');
        await page.click('#plus-si-cancel');
        chk(await visible(page, '#plus-state1'), `[${key}] "Not now" returns to the marketing state`);
        chk(!(await visible(page, '#plus-si-email')), `[${key}] "Not now" hides the wizard`);
        await page.click('#' + entry);
        await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
        const stale = await page.inputValue('#plus-signin-email');
        chk(stale === '', `[${key}] re-entering the wizard clears the stale field`, JSON.stringify(stale));
      }

      // Step: email -> code.
      await page.fill('#plus-signin-email', 'you@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      chk(true, `[${key}] email step advances to the code step`);

      // Step: email code -> the branch signin-verify chose.
      await page.fill('#plus-si-code-in', '123456');
      await page.click('#plus-si-code-go');

      const verifyStage = sc.steps['/api/remote/signin-verify'].stage;
      if (verifyStage === 'second') {
        await page.waitForSelector('#plus-si-second', { state: 'visible', timeout: 5000 });
        chk(true, `[${key}] verify -> the phone-code step is shown`);
        await page.fill('#plus-si-second-in', '654321');
        await page.click('#plus-si-second-go');
      } else if (verifyStage === 'enrol_second_factor') {
        await page.waitForSelector('#plus-si-enrol', { state: 'visible', timeout: 5000 });
        chk(await visible(page, '#plus-si-enrol-sms'), `[${key}] verify -> set-up step offers text when sms_available`);
        const why = await page.textContent('#plus-si-enrol-why');
        chk(!!(why && why.trim()), `[${key}] the why-authenticator copy is rendered`, JSON.stringify(why));
        if (sc.smsEnrol) {
          // The text path: reveal the phone field, submit it, and confirm the code went to
          // the masked number the coordinator reports (exercises plusSiStage's non-totp lead
          // branch and the phone-go handler, which the totp path never touches).
          await page.click('#plus-si-enrol-sms');
          await page.waitForSelector('#plus-si-phone-field', { state: 'visible', timeout: 5000 });
          await page.fill('#plus-si-phone', '+15555550123');
          await page.click('#plus-si-phone-go');
          await page.waitForSelector('#plus-si-enrol-confirm', { state: 'visible', timeout: 5000 });
          const lead = await page.textContent('#plus-si-enrol-lead');
          const sentTo = sc.steps['/api/remote/signin-enrol'].sent_to;
          chk(!!(lead && lead.includes(sentTo)), `[${key}] the texted-code lead names the masked number`, JSON.stringify(lead));
          chk(!(await visible(page, '#plus-si-secret-field')), `[${key}] the authenticator key field is hidden on the text path`);
        } else {
          await page.click('#plus-si-enrol-totp');
          await page.waitForSelector('#plus-si-enrol-confirm', { state: 'visible', timeout: 5000 });
          const secret = await page.inputValue('#plus-si-secret');
          chk(secret === 'ABCD1234EFGH5678', `[${key}] the authenticator key is shown to type in`, JSON.stringify(secret));
        }
        await page.fill('#plus-si-enrol-code', '111222');
        await page.click('#plus-si-enrol-confirm-go');
      }

      // Step: session -> name -> hand off to the connected flow.
      await page.waitForSelector('#plus-si-register', { state: 'visible', timeout: 5000 });
      chk(true, `[${key}] the flow reaches the name step (a session)`);
      // The engine writes this computer's state dir SYNCHRONOUSLY before answering register,
      // so the machine reads enrolled immediately after. Flip /api/remote to enrolled BEFORE
      // the register click, so the post-register paintPlus() exercises the REAL end state:
      // the connected flow with the address. Leaving the mock permanently unenrolled (the
      // earlier shape) let a "done panel" assertion pass precisely because it never drove the
      // repaint the wizard actually performs -- false coverage of the one step most likely to
      // regress. status.state:'up' so the flow's status line renders the address now.
      const wantAddr = sc.steps['/api/remote/signin-register'].address;
      await page.unroute('**/api/remote');
      await page.route('**/api/remote', (route, req) => {
        const m = req.method();
        if (m === 'GET' || m === 'HEAD') {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com',
            status: { state: 'up', address: wantAddr } }) });
        } else { route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
      });
      await page.fill('#plus-si-name', sc.steps['/api/remote/signin-register'].name);
      await page.click('#plus-si-register-go');
      // The wizard hands off to the connected flow: state 2 gone, flow shown, address in
      // its status line -- the same success screen the enrol flow ends on.
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      const flowStatus = await page.textContent('#plus-status');
      chk(!!(flowStatus && flowStatus.includes(wantAddr)), `[${key}] done: the connected flow shows the new address`, JSON.stringify(flowStatus));
      chk(!(await visible(page, '#plus-state2')), `[${key}] the wizard hands off to the connected flow after register`);
      await page.screenshot({ path: path.join(OUT, `plus-signin-${key}.png`), fullPage: false });

      chk(errs.length === 0, `[${key}] no page errors`, errs.join(' | '));
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
