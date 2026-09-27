/**
 * A phone (or any remote device) whose relay sign-in has lapsed must be offered a way to
 * sign in, not the generic "We cannot read your agents right now" card whose Try again can
 * never fix it (kosmos #718, Kano's phone-states list, state 3).
 *
 * The relay answers a signed-out device's script fetch with 401 and
 * {"signed_out":true,"error":"this device is not signed in to this Mac"} (kosmos-relay
 * crates/tunnel/src/proxy.rs gate_page), and answers a NAVIGATION with its sign-in page.
 * So the remedy is a button that reloads: that is what this checks the button does.
 *
 * 🔑 THE ROUTES ARE STUBBED IN THE PAGE with the relay's own body, the way
 * render-board-signin-403-2023 stubs the board's 403, so no relay is needed.
 *
 * CONTROLS: a 401 WITHOUT signed_out keeps the generic card (the new state is keyed on the
 * relay's field, not on 401 alone); the board's own 403 keeps its #2023 copy; a 500 keeps
 * "cannot read"; a normal board draws its agents and none of this.
 *
 * Run: NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *   node docs/browser-checks/render-device-signed-out-401-718.js http://127.0.0.1:PORT
 * against a sandboxed board with first-run completed (the rich board in tools/browser-checks.sh).
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// The relay's body, verbatim from kosmos-relay main (proxy.rs gate_page).
const RELAY_401 = { signed_out: true, error: 'this device is not signed in to this Mac' };
const OTHER_401 = { error: 'unauthorized' };
const BOARD_403 = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };

const SIGN_IN_AGAIN = /Sign in again to see your (agents|projects)/i;
const SIGNED_OUT_NOTE = /signed out of your Kosmos/i;
const CANNOT_READ = /We cannot read your (agents|projects) right now/i;
const BOARD_NOT_SIGNED_IN = /This board is not signed in/i;

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  // Mobile-sized, since this is the phone state; the logic is the same at any width.
  const fresh = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    return { ctx, page: await ctx.newPage() };
  };
  const stub = async (page, status, json) => {
    /* The relay answers EVERY script fetch from a signed-out device with its 401, so its scenarios
       stub every /api/ read. Stubbing only these two left /api/first-run reaching the sandbox board,
       whose first-run screen then opened over the card and swallowed the Sign in click. */
    if (json === RELAY_401) await page.route('**/api/**', (r) => r.fulfill({ status, json }));
    await page.route('**/api/status', (r) => r.fulfill({ status, json }));
    await page.route('**/api/projects', (r) => r.fulfill({ status, json }));
  };
  const boardText = (page) => page.evaluate(() => ['grid', 'alist']
    .map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));

  // ---- Scenario 1: agents read 401 signed_out -> sign in again, with a Sign in button.
  {
    const { ctx, page } = await fresh();
    await stub(page, 401, RELAY_401);
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const t = await boardText(page);
    check('agents 401 signed_out: says sign in again', SIGN_IN_AGAIN.test(t), t.slice(0, 140));
    check('agents 401 signed_out: not the generic cannot-read card', !CANNOT_READ.test(t), t.slice(0, 140));
    const btn = page.locator('[data-device-signin]:visible').first();
    check('agents 401 signed_out: a visible Sign in button', (await btn.count()) === 1 && /Sign in/i.test(await btn.textContent().catch(() => '')));
    const org = await page.evaluate(() => {
      const n = document.getElementById('orgnote');
      return { text: (n && n.textContent) || '', button: !!(n && n.querySelector('[data-device-signin]')) };
    });
    check('agents 401 signed_out: the org note says signed out and carries its own Sign in button',
      SIGNED_OUT_NOTE.test(org.text) && org.button, org.text.slice(0, 120));
    // The button must NAVIGATE back to this same address (the relay answers a navigation with its sign-in page).
    const here = page.url();
    let navigated = false;
    page.on('request', (req) => { if (req.isNavigationRequest() && req.frame() === page.mainFrame() && req.url() === here) navigated = true; });
    let clickErr = '';
    if (await btn.count()) await btn.click({ timeout: 3000 }).catch((e) => { clickErr = String(e && e.message || e).split('\n')[0]; });
    await page.waitForTimeout(900);
    // On a failed click, say which button it was and what covers it, so a red is diagnosable.
    const where = clickErr ? await btn.evaluate((b) => {
      const r = b.getBoundingClientRect(), host = b.closest('[id]');
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const topHost = top && (top.closest('[id]') || top);
      return ' | button in #' + (host ? host.id : '?') + ' at ' + Math.round(r.left) + ',' + Math.round(r.top)
        + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + '; on top: ' + (top ? top.tagName.toLowerCase() : 'nothing')
        + (topHost && topHost.id ? ' in #' + topHost.id : '');
    }).catch((e) => ' | ' + String(e).slice(0, 80)) : '';
    check('agents 401 signed_out: Sign in reloads this page (a navigation the relay turns into its sign-in page)', navigated, clickErr + where);
    await ctx.close();
  }

  // ---- Scenario 1b: the five-second poll must not rebuild the org note's button (a keyboard's
  // focus would be lost). Its own page, because Scenario 1's click reloads the page it is on.
  {
    const { ctx, page } = await fresh();
    await stub(page, 401, RELAY_401);
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    let polls = 0;
    page.on('request', (r) => { if (/\/api\/status(\?|$)/.test(r.url())) polls += 1; });
    const noteBtn = await page.$('#orgnote [data-device-signin]');
    const cardBtn = await page.$('#grid [data-device-signin]');
    // Keyboard focus is what the keep is for, so hold focus on the card's button through the poll.
    if (cardBtn) await cardBtn.focus().catch(() => {});
    const focusedBefore = cardBtn ? await cardBtn.evaluate((n) => document.activeElement === n).catch(() => false) : false;
    check('agents 401 signed_out: the card\'s Sign in button takes keyboard focus', focusedBefore);
    await page.waitForTimeout(6500);
    // Proof a poll ran in the wait; without one, "kept" would be true for nothing.
    check('agents 401 signed_out: a poll ran while the buttons were watched', polls >= 1, 'status reads: ' + polls);
    const kept = noteBtn ? await noteBtn.evaluate((n) => n.isConnected).catch(() => false) : false;
    check('agents 401 signed_out: the org note keeps the same Sign in button across a poll', kept);
    const cardKept = cardBtn ? await cardBtn.evaluate((n) => n.isConnected).catch(() => false) : false;
    check('agents 401 signed_out: the card keeps the same Sign in button across a poll', cardKept);
    const focusedAfter = cardBtn ? await cardBtn.evaluate((n) => document.activeElement === n).catch(() => false) : false;
    check('agents 401 signed_out: the card\'s Sign in button still has keyboard focus after a poll', focusedAfter);
    await ctx.close();
  }

  // ---- Scenario 2: projects read 401 signed_out -> #pj-list says sign in again.
  {
    const { ctx, page } = await fresh();
    await stub(page, 401, RELAY_401);
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const pj = await page.evaluate(() => (document.getElementById('pj-list') || {}).textContent || '');
    check('projects 401 signed_out: #pj-list says sign in again', SIGN_IN_AGAIN.test(pj), pj.slice(0, 140));
    check('projects 401 signed_out: #pj-list is not the generic cannot-read', !CANNOT_READ.test(pj), pj.slice(0, 140));
    const pjBtn = await page.$('#pj-list [data-device-signin]');
    const pjBtnShown = pjBtn ? await pjBtn.isVisible().catch(() => false) : false;
    check('projects 401 signed_out: #pj-list shows its own Sign in button', pjBtnShown);
    await ctx.close();
  }

  // ---- Scenario 3: projects 401 signed_out, THEN a network outage -> #pj-list un-latches to
  // cannot-read. An abort, not a 500, so it reaches loadProjects' catch with the prior 401's
  // flag standing (the same reasoning as render-board-signin-403-2023's anti-latch scenario).
  {
    const { ctx, page } = await fresh();
    let mode = '401';
    await page.route('**/api/**', (r) => r.fulfill({ status: 401, json: RELAY_401 }));
    await page.route('**/api/status', (r) => r.fulfill({ status: 401, json: RELAY_401 }));
    await page.route('**/api/projects', (r) => (mode === 'abort' ? r.abort() : r.fulfill({ status: 401, json: RELAY_401 })));
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const first = await page.evaluate(() => (document.getElementById('pj-list') || {}).textContent || '');
    check('anti-latch: projects 401 signed_out first says sign in again', SIGN_IN_AGAIN.test(first), first.slice(0, 100));
    mode = 'abort';
    await page.evaluate(() => (typeof loadProjects === 'function' ? loadProjects() : null)).catch(() => null);
    let unlatched = false;
    try {
      await page.waitForFunction(() => /cannot read your projects/i.test((document.getElementById('pj-list') || {}).textContent || ''), { timeout: 8000 });
      unlatched = true;
    } catch { unlatched = false; }
    const after = await page.evaluate(() => (document.getElementById('pj-list') || {}).textContent || '');
    check('anti-latch: an outage after the relay 401 un-latches #pj-list to cannot-read', unlatched && !SIGN_IN_AGAIN.test(after), after.slice(0, 120));
    await ctx.close();
  }

  // ---- CONTROL A: a 401 WITHOUT signed_out is not claimed as signed out.
  {
    const { ctx, page } = await fresh();
    await stub(page, 401, OTHER_401);
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const t = await boardText(page);
    check('CONTROL bare 401: keeps the generic cannot-read card', CANNOT_READ.test(t), t.slice(0, 120));
    check('CONTROL bare 401: does not say sign in again', !SIGN_IN_AGAIN.test(t), t.slice(0, 120));
    await ctx.close();
  }

  // ---- CONTROL B: the board's own 403 keeps its #2023 copy.
  {
    const { ctx, page } = await fresh();
    await stub(page, 403, BOARD_403);
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const t = await boardText(page);
    check('CONTROL board 403: still the board-not-signed-in copy', BOARD_NOT_SIGNED_IN.test(t), t.slice(0, 120));
    check('CONTROL board 403: not the device sign-in copy', !SIGN_IN_AGAIN.test(t), t.slice(0, 120));
    await ctx.close();
  }

  // ---- CONTROL C: a genuine 500 keeps "cannot read".
  {
    const { ctx, page } = await fresh();
    await stub(page, 500, { error: 'we could not read tmux' });
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const t = await boardText(page);
    check('CONTROL 500: keeps the generic cannot-read card', CANNOT_READ.test(t), t.slice(0, 120));
    check('CONTROL 500: does not say sign in again', !SIGN_IN_AGAIN.test(t), t.slice(0, 120));
    await ctx.close();
  }

  // ---- CONTROL D: a normal board shows none of it, and did draw something.
  {
    const { ctx, page } = await fresh();
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const t = await boardText(page);
    const drew = await page.evaluate(() => document.querySelectorAll('#grid .acard, #alist .acard, #grid .pj-empty:not(.boardfail), #alist .pj-empty:not(.boardfail)').length);
    check('CONTROL 200: a normal board drew its agents (or its own empty state)', drew > 0, 'elements ' + drew);
    check('CONTROL 200: a normal board does not say sign in again or cannot read', !SIGN_IN_AGAIN.test(t) && !CANNOT_READ.test(t), t.slice(0, 100));
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('render-device-signed-out-401-718 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
