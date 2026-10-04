// Browser-check-surface: plus-state2 plus-signin-email plus-signin-code plus-si-code-in plus-si-code-go plus-si-second-in plus-si-second-go plus-si-phone plus-si-phone-go plus-si-enrol-code plus-si-enrol-confirm-go plus-si-name plus-si-register-go
'use strict';
/**
 * Josh, 2026-09-29 (live test on Windows): he typed his email into "Sign in to activate
 * Kosmos+", pressed Enter, and nothing happened. None of the wizard's boxes is in a <form>
 * and none had a key handler, so Enter did nothing on any step. The fix: Enter in each box
 * presses that step's own button.
 *
 * This walks the wizard with the KEYBOARD ONLY (no click on any step button) through every
 * box that takes typing: email, the email code, the second-factor code, the phone number,
 * the enrol confirm code and the address box. (The connected flow's own enrol pair, which
 * could never show, was removed in kosmos#4698.) For each box it asserts that Enter sent exactly the request that step's
 * button sends, with what was typed. Codes are put in the six boxes QUIETLY (no input
 * event), so the sixth digit's auto-submit (#3942) cannot be what moved the step: only
 * Enter can. It also asserts Enter with Shift does not submit, and a disabled (busy)
 * button is not pressed by Enter.
 *
 * Without the fix, the first Enter (the email box) sends nothing and the check fails there.
 *
 *   node docs/browser-checks/render-plus-signin-enter-0929.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-signin-enter-0929.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusenter-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusenter-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusenter-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusenter-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusenter-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'plusenter-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0 && !e.hidden);
}, sel);

/* Put a value in a box with no input event, so nothing but the key that follows can move the step. */
const focusOn = (page, id) => page.evaluate((i) => document.getElementById(i).focus(), id);
const quietly = (page, id, value) => page.evaluate(([i, v]) => { document.getElementById(i).value = v; }, [id, value]);

async function openPlus(page, remote) {
  await page.route('**/api/remote', (route, req) => {
    const m = (req || route.request()).method();
    if (m === 'GET' || m === 'HEAD') route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) });
    else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/remote/devices**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) });
  });
  await page.goto(page.__url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ---- The sign-in wizard (state 2), keyboard only. ----
    {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'dark' });
      page.__url = BASE;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const posts = [];   // every signin-* POST, in order: { step, body }
      let verifyAnswer = { ok: true, stage: 'second', second_kind: 'totp', sent_to: '' };
      let holdStart = null;   // when set, signin-start waits on this promise (a busy button)
      await openPlus(page, UNENROLLED);
      await page.route('**/api/remote/signin-**', async (route, rq) => {
        const req = rq || route.request();
        const step = new URL(req.url()).pathname.replace('/api/remote/', '');
        let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
        posts.push({ step, body });
        if (step === 'signin-start' && holdStart) await holdStart;
        const answers = {
          'signin-start': { ok: true, stage: 'code_sent' },
          'signin-verify': verifyAnswer,
          'signin-second': { ok: true, stage: 'session' },
          'signin-enrol': { ok: true, stage: 'enrolment_started', kind: 'sms', sent_to: '(•••) •••-4321' },
          'signin-confirm-enrol': { ok: true, stage: 'session' },
          'signin-register': { ok: true, stage: 'registered', address: 'enter-test', name: 'enter-test', standing: 'active' },
          'signin-cancel': { ok: true, stage: 'cancelled' },
        };
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[step] || { ok: true }) });
      });
      const sent = (step) => posts.filter((p) => p.step === step);

      await page.click('#plus-signin-top');
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });

      // Shift+Enter is not Enter: nothing is sent.
      await page.fill('#plus-signin-email', 'josh@example.com');
      await focusOn(page, 'plus-signin-email');
      // A synthetic Shift+Enter, the same way in every driver (the handler reads e.shiftKey).
      await page.evaluate(() => document.getElementById('plus-signin-email').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })));
      await page.waitForTimeout(300);
      chk(sent('signin-start').length === 0, 'Shift+Enter in the email box sends nothing', JSON.stringify(posts));

      // A busy button is not pressed again by Enter: hold the first start open, press Enter twice.
      let release;
      holdStart = new Promise((r) => { release = r; });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('plus-signin-code').disabled, null, { timeout: 5000 }).catch(() => {});
      await page.screenshot({ path: path.join(OUT, 'enter-email-busy.png') });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      chk(sent('signin-start').length === 1, 'a second Enter while the email button is busy sends nothing more', String(sent('signin-start').length));
      holdStart = null; release();

      // 1. The email box: Enter sends the code request with the typed email and shows the code step.
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 }).catch(() => {});
      chk(await visible(page, '#plus-si-code'), 'Enter in the email box moves on to the code step');
      const st = sent('signin-start')[0];
      chk(!!st && st.body && st.body.email === 'josh@example.com', 'Enter in the email box asks for a code for the typed email', JSON.stringify(st));

      // 2. The email code: put in quietly (no auto-submit), then Enter.
      await quietly(page, 'plus-si-code-in', '123456');
      await focusOn(page, 'plus-si-code-in');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-second', { state: 'visible', timeout: 5000 }).catch(() => {});
      const v = sent('signin-verify')[0];
      chk(!!v && v.body && v.body.code === '123456' && v.body.email === 'josh@example.com', 'Enter in the code boxes sends the email code (Verify)', JSON.stringify(v));
      chk(await visible(page, '#plus-si-second'), 'Enter in the code boxes moves on to the second step');

      // 3. The second-factor code.
      await quietly(page, 'plus-si-second-in', '654321');
      await focusOn(page, 'plus-si-second-in');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-register', { state: 'visible', timeout: 5000 }).catch(() => {});
      const s2 = sent('signin-second')[0];
      chk(!!s2 && s2.body && s2.body.code === '654321', 'Enter in the second-step boxes sends that code', JSON.stringify(s2));
      chk(await visible(page, '#plus-si-name'), 'Enter in the second-step boxes moves on to the address step');

      // 4. The address box (while it still exists).
      await page.fill('#plus-si-name', 'enter-test');
      await focusOn(page, 'plus-si-name');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      const reg = sent('signin-register')[0];
      chk(!!reg && reg.body && reg.body.name === 'enter-test', 'Enter in the address box finishes signing in with the typed name', JSON.stringify(reg));

      // 5. The set-up branch: the phone number and the confirm code. Start over from the email step.
      await page.evaluate(() => plusSiEnter());
      verifyAnswer = { ok: true, stage: 'enrol_second_factor', sms_available: true, why_authenticator: 'x' };
      await page.fill('#plus-signin-email', 'josh@example.com');
      await focusOn(page, 'plus-signin-email');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await quietly(page, 'plus-si-code-in', '222222');
      await focusOn(page, 'plus-si-code-in');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-enrol-sms', { state: 'visible', timeout: 5000 }).catch(() => {});
      await page.click('#plus-si-enrol-sms');   // choosing text over an app is a choice, not a box
      await page.fill('#plus-si-phone', '+1 555 010 4321');
      await focusOn(page, 'plus-si-phone');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-enrol-confirm', { state: 'visible', timeout: 5000 }).catch(() => {});
      const en = sent('signin-enrol')[0];
      chk(!!en && en.body && en.body.kind === 'sms' && en.body.phone === '+1 555 010 4321', 'Enter in the phone box texts a code to the typed number', JSON.stringify(en));
      await quietly(page, 'plus-si-enrol-code', '333333');
      await focusOn(page, 'plus-si-enrol-code');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-si-register', { state: 'visible', timeout: 5000 }).catch(() => {});
      const ce = sent('signin-confirm-enrol')[0];
      chk(!!ce && ce.body && ce.body.code === '333333', 'Enter in the confirm boxes sends the set-up code', JSON.stringify(ce));
      await page.screenshot({ path: path.join(OUT, 'enter-register-step.png') });

      chk(errs.length === 0, 'no page errors (wizard)', errs.join(' | '));
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
