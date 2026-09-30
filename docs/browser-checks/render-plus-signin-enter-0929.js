// Browser-check-surface: plus-state2 plus-signin-email plus-signin-code plus-si-code-in plus-si-code-go plus-si-second-in plus-si-second-go plus-si-phone plus-si-phone-go plus-si-enrol-code plus-si-enrol-confirm-go plus-si-name plus-si-register-go plus-email plus-send-code plus-code plus-name plus-confirm
'use strict';
/**
 * Josh, 2026-09-29 (live test on Windows): he typed his email into "Sign in to activate
 * Kosmos+", pressed Enter, and nothing happened. None of the wizard's boxes is in a <form>
 * and none had a key handler, so Enter did nothing on any step. The fix: Enter in each box
 * presses that step's own button.
 *
 * This walks the wizard with the KEYBOARD ONLY (no click on any step button) through every
 * box that takes typing: email, the email code, the second-factor code, the phone number,
 * the enrol confirm code and the address box; and the connected flow's enrol pair (email,
 * code, name). For each box it asserts that Enter sent exactly the request that step's
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
// The switch on, nothing enrolled yet. The pane's own paint does NOT show the enrol pair for this (enrolled is not
// true, so state 1 shows): the enrol-pair arm below shows it by hand (#4694).
const WAITING = { configured: true, on: true, ok: true, enrolled: false, email: '', status: {} };

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0 && !e.hidden);
}, sel);

/* Put a value in a box with no input event, so nothing but the key that follows can move the step. */
const focusOn = (page, id) => page.evaluate((i) => document.getElementById(i).focus(), id);
const quietly = (page, id, value) => page.evaluate(([i, v]) => { document.getElementById(i).value = v; }, [id, value]);

async function openPlus(page, remote) {
  await page.route('**/api/remote', async (route, req) => {
    const m = (req || route.request()).method();
    if (m === 'GET' || m === 'HEAD') {
      /* page.__holdRemote: once set, a status read never answers, so no later paintPlus (the 5s tick included)
         can repaint over a state the check set by hand (#4694). The hold ends only when the page closes, so never
         await paintPlus() after setting it: it would never finish. It relies on paintPlus's read having no timeout
         shorter than this arm's run (about 2s after the hold); a shorter one would end the held read, state 1 would
         repaint, and the arm would fail (loudly). */
      if (page.__holdRemote) { page.__held = (page.__held || 0) + 1; return; }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) });
    }
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

    // ---- The connected flow's enrol pair (switch on, not yet enrolled). ----
    {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'dark' });
      page.__url = BASE;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const posts = [];
      /* #4694: for WAITING the pane's own paint hides the connected flow (enrolled is false, so state 1 shows), so
         the check shows the pair by hand. A paint that landed after that and before Enter (the click's own paint,
         still in flight, or the 5s status tick) hid the pair again: Enter went nowhere, setup-start was never sent,
         and the next fill timed out (CI run 36672061656). So: let one paint run, hold every later status read, then
         start one more paint BEFORE showing the pair. That last one waits on a held read forever, and it takes a
         newer PLUS_EPOCH (paintPlus bumps it before its read, with no await between its epoch check and its writes),
         so every paint still in flight, including one whose read was answered before the hold, returns without
         touching the page. That cancellation rests on that order in web/index.html; this check asserts the hold and
         the pair's visibility, and does not itself force an in-flight paint (a probe did: see the plan). */
      await openPlus(page, WAITING);
      await page.evaluate(() => paintPlus());
      page.__holdRemote = true;
      await page.evaluate(() => { paintPlus(); });
      /* The epoch bump inside that evaluate is what cancels earlier paints, and it happened at once. This wait only
         proves the route really caught the pane's status read before the pair is shown (a self-check of the hold). */
      for (let i = 0; i < 40 && (page.__held || 0) < 1; i++) await new Promise((r) => setTimeout(r, 50));
      const heldBeforeShow = page.__held || 0;
      chk(heldBeforeShow >= 1, 'a status read was held before the pair was shown', String(heldBeforeShow));
      await page.route('**/api/remote/setup-**', (route, rq) => {
        const req = rq || route.request();
        let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
        posts.push({ step: new URL(req.url()).pathname.replace('/api/remote/', ''), body });
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });
      /* The pane decides which flow it shows from /api/remote; if this build does not put the enrol pair on
         screen for WAITING, show it directly: this check is about Enter, not about when the pair shows. */
      if (!(await visible(page, '#plus-email'))) {
        await page.evaluate(() => {
          for (const id of ['plus-state1', 'plus-state2']) { const e = document.getElementById(id); if (e) e.hidden = true; }
          for (const id of ['plus-flow', 'plus-enrol']) { const e = document.getElementById(id); if (e) e.hidden = false; }
        });
      }
      chk(await visible(page, '#plus-email'), 'the enrol pair is on screen after it is shown', '');
      /* A short fill that reports by name: if a repaint hid the pair after it was shown, this says so instead of
         Playwright's 30s timeout ending the run (exit 2) before the remaining checks print. */
      const filled = await page.fill('#plus-email', 'josh@example.com', { timeout: 3000 }).then(() => true, () => false);
      chk(filled, 'the enrol pair\'s email box takes the typed email', '');
      const heldAtFill = page.__held || 0;
      /* A repaint that STARTS here, between the fill and Enter, where CI's status tick landed. Its read is held, so it
         must not move anything; without the hold, Enter below sends nothing. Not awaited: it never finishes. (It also
         bumps PLUS_EPOCH, so it cancels a paint still in flight at the fill; the held paint before the show is what
         covers one landing between the show and the fill.) */
      await page.evaluate(() => { paintPlus(); });
      /* This repaint's own read reached the hold: the count rose past its value at the fill (a 5s-tick read held
         before the fill cannot satisfy this). If the route ever stops matching the pane's status read, the hold
         does nothing and this says so, instead of the arm going back to racing the tick. */
      for (let i = 0; i < 40 && (page.__held || 0) <= heldAtFill; i++) await new Promise((r) => setTimeout(r, 50));   // the read reaches the route asynchronously
      chk((page.__held || 0) > heldAtFill, 'the repaint after the fill was held (the hold engaged)', heldAtFill + ' -> ' + (page.__held || 0));
      // Still on screen at the moment Enter is pressed: the gap CI hit is after the fill, so it is checked here.
      chk(await visible(page, '#plus-email'), 'the enrol pair is still on screen when Enter is pressed', '');
      await focusOn(page, 'plus-email');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#plus-code-row', { state: 'visible', timeout: 5000 }).catch(() => {});
      const ss = posts.find((p) => p.step === 'setup-start');
      chk(!!ss && ss.body && ss.body.email === 'josh@example.com', 'Enter in the enrol pair\'s email box sends the code request', JSON.stringify(posts));
      // No code request, no code row: the code step cannot run, so it is reported as skipped, not left to time out.
      if (ss) {
        await quietly(page, 'plus-code', '444444');
        await page.fill('#plus-name', 'enter-pair');
        await focusOn(page, 'plus-code');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        const sc = posts.find((p) => p.step === 'setup-complete');
        chk(!!sc && sc.body && sc.body.code === '444444' && sc.body.name === 'enter-pair', 'Enter in the enrol pair\'s code box confirms with the code and name', JSON.stringify(posts));
      } else {
        chk(false, 'the enrol pair\'s code step (skipped: no code request was sent)', '');
      }
      chk(errs.length === 0, 'no page errors (enrol pair)', errs.join(' | '));
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
