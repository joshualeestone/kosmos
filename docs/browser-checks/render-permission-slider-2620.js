/**
 * #2620: the first-run S3 permission switches are HONEST and CLICKABLE.
 *
 * The mock macOS switch (.s3-sw, inside the aria-hidden .s3-win illustration) used to be
 * hardcoded blue/On. #2620 makes it MIRROR the real gate: gray with a gentle swipe "hint"
 * while the permission is not granted, static blue once it is. A real focusable button
 * (.s3-sw-open), lifted OUT of the aria-hidden mock into the .s3-mock wrapper, sits over the
 * switch and opens the exact macOS pane -- so a click on the switch does something honest,
 * while .s3-win stays decorative (pointer-events:none, the 0.6.41 decoy fix).
 *
 * This RUNS the real page against a served board, mocking the a11y status endpoint so the
 * Accessibility (tmux) gate is deterministically not-granted, then granted. It asserts the
 * DETERMINISTIC, headless-safe facts: the state mirror (data-granted + the hint animation)
 * and the overlay button (present, a real focusable button, target-naming aria-label).
 *
 * ⚠️ Two things this deliberately does NOT assert, because they belong to the headed pass:
 *   - the pixel-precise overlay POSITION over the switch (frSyncSwitchOverlays measures it at
 *     runtime; the two mocks differ in height, so a human eyeball on a headed pass confirms
 *     alignment), and
 *   - the swipe FEEL (Mona confirms it reads as a gentle "go flip this", not a jitter).
 * The background color while NOT granted is also intentionally unchecked: the hint animation
 * cycles it through blue mid-flip, so it is non-deterministic by design. The state ATTRIBUTE
 * and the animation-name are the deterministic signals, and those are what this pins.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-permission-slider-2620.js http://127.0.0.1:PORT
 */
const { chromium } = require('playwright');
const { stepForAnchor } = require('./lib-firstrun-steps.js');
const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

// Deep-link to S3 (discovered from the tmux gate anchor), with the a11y status mocked to a
// fixed verdict BEFORE the navigation so the first gate poll reads it. Mirrors gotoGate in
// render-gated-next.js. sleep is left prevented so only the tmux state under test varies.
async function gotoS3(page, tmuxTrusted) {
  await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
  const step = await stepForAnchor(page, '[data-gate="tmux"]');
  await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: true } }));
  await page.route('**/api/a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: tmuxTrusted } }));
  await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700); // let the gate poll settle + frSyncSwitchOverlays run
}

// Read the Accessibility (tmux) switch + its overlay button in one pass.
function readTmuxSwitch(page) {
  return page.evaluate(() => {
    const sw = document.querySelector('.s3-sw[data-sw-gate="tmux"]');
    const btn = document.querySelector('.s3-sw-open[data-sw-gate="tmux"]');
    const cs = sw ? getComputedStyle(sw) : null;
    return {
      swPresent: !!sw,
      granted: sw ? sw.hasAttribute('data-granted') : null,
      animName: cs ? cs.animationName : null,
      bg: cs ? cs.backgroundColor : null,
      btnPresent: !!btn,
      btnTag: btn ? btn.tagName : null,
      btnLabel: btn ? (btn.getAttribute('aria-label') || '') : null,
      btnDisabled: btn ? btn.disabled === true : null,
    };
  });
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: !HEADED }); }
  catch (e) { console.error('FAIL  render-permission-slider-2620: could not start a browser (' + ((e && e.message) || e) + ')'); process.exit(1); }
  try {
    // ---- NOT granted: the switch is off (no data-granted) and the swipe hint is running ----
    console.log('\n#2620 -- Accessibility permission NOT granted');
    const c1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p1 = await c1.newPage();
    p1.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await gotoS3(p1, false);
    const off = await readTmuxSwitch(p1);
    ok(off.swPresent, 'the Accessibility mock switch (.s3-sw[data-sw-gate="tmux"]) is on the page');
    ok(off.granted === false, 'not-granted -> the switch carries NO data-granted (it is off, not a hardcoded On)');
    ok(/s3-sw-hint/.test(off.animName || ''), `not-granted -> the swipe hint animation is running (animation-name: ${off.animName})`);
    ok(off.btnPresent && off.btnTag === 'BUTTON', 'a real focusable overlay button (.s3-sw-open) exists and is a <button>');
    ok(/Accessibility/i.test(off.btnLabel || ''), `the overlay aria-label names the target pane (got: ${JSON.stringify(off.btnLabel)})`);
    ok(off.btnDisabled === false, 'the overlay button is enabled (focusable / clickable)');
    await c1.close();

    // ---- Granted: the switch is blue and static (no hint) ----
    console.log('\n#2620 -- Accessibility permission GRANTED');
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await gotoS3(p2, true);
    const on = await readTmuxSwitch(p2);
    ok(on.granted === true, 'granted -> the switch carries data-granted (mirrors the real gate)');
    ok((on.animName || 'none') === 'none', `granted -> the hint animation stops (animation-name: ${on.animName})`);
    ok(on.bg === 'rgb(47, 123, 227)', `granted -> the switch is the on-brand blue #2f7bf6 (got: ${on.bg})`);
    await c2.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-permission-slider-2620: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-permission-slider-2620 threw: ' + ((e && e.message) || e)); process.exit(1); });
