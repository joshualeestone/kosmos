/**
 * install-flow-9screen: the gated Next on the permission screens, driven for real.
 *
 * Two screens gate Next on a measured permission grant:
 *   S2 Access     data-gate="file-access"   -> /api/file-access-status (granted)
 *   S3 Automation data-gate="sleep"+"tmux"   -> /api/sleep-status (prevented),
 *                                               /api/a11y-status (trusted)
 * The contract (frPollGates) is FAIL-SAFE and POSITIVE-ONLY: a row goes green
 * (data-granted) ONLY on a measured grant; #fr-next is disabled ONLY when some row
 * is measured-not-granted (checkable:true && !granted). Uncheckable (a browser, no
 * native writer yet) and any fetch failure NEVER block and NEVER show false green.
 * The poll (FR_GATE_POLL_MS, 750ms) re-checks, so granting in System Settings unlocks
 * Next on its own; a "Check again" button (#2451/#2559) also lets the user force it now.
 *
 * It ALSO covers the S3 sleep "Turn On" action itself (0.6.41 re-test blocker E):
 * a failed open-settings must show a VISIBLE error (danger colour, not body ink)
 * and a success must stay silent, so a button that cannot resolve the pane on some
 * macOS never again reads as simply "dead".
 *
 * This RUNS the real page against a served board, mocking only the status endpoints
 * so each verdict is deterministic. It subsumes the retired render-a11y-gate-2125
 * (tmux gate), render-sleep-button (sleep gate) and the gate half of the old
 * standalone Accessibility step. Selectors + step numbers are DISCOVERED from the
 * gate rows (stepForAnchor), so an inserted/removed screen moves the check with the
 * pane rather than naming a number (kosmos#1801).
 */
const { chromium } = require('playwright');
const { stepForAnchor } = require('./lib-firstrun-steps.js');
const BASE = process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

/* Route the three status endpoints to fixed verdicts for this context. Any omitted
   endpoint is left to answer however the served board does; every test sets the
   ones it depends on. `undefined` means "leave unrouted". */
async function routeGates(page, { fileAccess, sleep, tmux }) {
  if (fileAccess !== undefined) await page.route('**/api/file-access-status', (r) => r.fulfill({ json: fileAccess }));
  if (sleep !== undefined) await page.route('**/api/sleep-status', (r) => r.fulfill({ json: sleep }));
  if (tmux !== undefined) await page.route('**/api/a11y-status', (r) => r.fulfill({ json: tmux }));
}

/* Deep-link to the screen holding `anchorSel`, discovering its step number. Loads
   once so the panes exist, reads the step off the anchor's fr-pane-N ancestor, then
   navigates to it. Gates are routed BEFORE the real navigation so the first poll
   reads the mocked verdict. */
async function gotoGate(page, anchorSel, gates) {
  await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
  const step = await stepForAnchor(page, anchorSel);
  await routeGates(page, gates);
  await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
  // The gate is soft-open at entry; the first poll resolves ~a fetch later, so wait
  // for the poll to settle rather than reading the entry frame.
  await page.waitForTimeout(600);
  return step;
}

const nextDisabled = (page) => page.evaluate(() => !!document.getElementById('fr-next').disabled);
const rowGranted = (page, gate) => page.evaluate((g) => {
  const row = document.querySelector(`[data-gate="${g}"]`);
  return !!(row && row.hasAttribute('data-granted'));
}, gate);

async function fresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
  return { ctx, page };
}

(async () => {
  // A browser-start failure prints a line the gate can quote (#1864), same shape
  // as the sibling checks, rather than an unhandled rejection.
  let browser;
  try { browser = await chromium.launch({ headless: !HEADED }); }
  catch (e) { console.error('FAIL  render-gated-next: could not start a browser (' + ((e && e.message) || e) + ')'); process.exit(1); }
  try {

  /* ---------- S2 Access: the file-access gate (kosmos#2347 nativePresent) ----------
     File access cannot be measured on entry without firing the TCC prompt, so the S2
     gate keys on the PROMPT-FREE presence signal `nativePresent` (native app is
     maintaining status) + no grant yet -- NOT on checkable, which is false on entry.
     The native half exposes { checkable, granted?, because?, nativePresent } on
     /api/file-access-status; these mocks drive that shape. */
  console.log('\nS2 Access -- the file-access gate (nativePresent)');
  {
    // ENTRY on a real install: native present, no verdict on file yet (ENOENT ->
    // checkable:false) -> BLOCK. This is the case Josh hit; the old checkable-only
    // rule left Next enabled here. THE new capability.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: false, nativePresent: true } });
    ok(await nextDisabled(page), 'S2 entry (native present, no verdict yet) disables Next -- the fix');
    ok(!(await rowGranted(page, 'file-access')), 'and the row is NOT shown granted (no false green)');
    await ctx.close();
  }
  {
    // Native present, measured NOT granted (post-Allow denial) -> Next disabled.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: true, granted: false, nativePresent: true } });
    ok(await nextDisabled(page), 'file-access native-present + not-granted disables Next');
    ok(!(await rowGranted(page, 'file-access')), 'and the row is NOT shown granted (no false green)');
    await ctx.close();
  }
  {
    // Measured granted -> Next enabled, row green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: true, granted: true, nativePresent: true } });
    ok(!(await nextDisabled(page)), 'file-access granted enables Next');
    ok(await rowGranted(page, 'file-access'), 'and the row is shown granted (data-granted)');
    await ctx.close();
  }
  {
    // No native app (a browser tester): nativePresent falsey -> FAIL-SAFE, Next
    // enabled, never a false green. The browser tester is never stranded.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: false, nativePresent: false } });
    ok(!(await nextDisabled(page)), 'file-access no-native-app never blocks (fail-safe browser tester)');
    ok(!(await rowGranted(page, 'file-access')), 'and it is NOT shown as granted (never false green)');
    await ctx.close();
  }
  {
    // Belt-and-suspenders: a reading with NO nativePresent field at all (e.g. the
    // native route not yet deployed) must also fail-safe, so this front-end half is
    // inert-and-safe before the native half ships.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: false } });
    ok(!(await nextDisabled(page)), 'file-access with no nativePresent field never blocks (safe before the route ships)');
    ok(!(await rowGranted(page, 'file-access')), 'and it is NOT shown as granted (never false green)');
    await ctx.close();
  }

  /* ---------- S3 Automation: the sleep + tmux gates (Next needs BOTH) ---------- */
  console.log('\nS3 Automation -- sleep + tmux, Next needs BOTH');
  {
    // Both measured-not-granted -> disabled.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false }, tmux: { checkable: true, trusted: false },
    });
    ok(await nextDisabled(page), 'S3 both-not-granted disables Next');
    ok(!(await rowGranted(page, 'sleep')) && !(await rowGranted(page, 'tmux')), 'neither S3 row is green');
    await ctx.close();
  }
  {
    // ONE granted, one not -> still disabled (Next needs BOTH).
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true }, tmux: { checkable: true, trusted: false },
    });
    ok(await nextDisabled(page), 'Accessibility (tmux) not-granted still disables Next -- it gates even with sleep granted (sleep is advisory, #2587)');
    ok(await rowGranted(page, 'sleep'), 'the granted (sleep) row is green');
    ok(!(await rowGranted(page, 'tmux')), 'the not-granted (tmux) row is not green');
    await ctx.close();
  }
  {
    // Both granted -> enabled, both green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true }, tmux: { checkable: true, trusted: true },
    });
    ok(!(await nextDisabled(page)), 'S3 both-granted enables Next');
    ok(await rowGranted(page, 'sleep') && await rowGranted(page, 'tmux'), 'both S3 rows are green');
    await ctx.close();
  }
  {
    // Both uncheckable -> FAIL-SAFE: enabled, neither green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: false }, tmux: { checkable: false },
    });
    ok(!(await nextDisabled(page)), 'S3 both-uncheckable never blocks (fail-safe)');
    ok(!(await rowGranted(page, 'sleep')) && !(await rowGranted(page, 'tmux')), 'and neither uncheckable row is false-green');
    await ctx.close();
  }

  /* ---------- #2587: the sleep step is ADVISORY (Josh's ruling) ----------
     A laptop that sleeps on battery is prevented:false forever (macOS has no
     never-sleep-on-battery switch), so gating Next on it walled laptop users in. Now the
     sleep step NEVER gates Next; the honest note replaces the useless Turn On on that
     (battOnly) row. Accessibility/tmux STILL gates -- it is satisfiable + required, so
     letting a user past it would land them in broken agents. Arms: (A) laptop-battery +
     Accessibility granted -> Next ENABLED though sleep is blocked, note shown, Turn On
     hidden, not green, no Continue button; (B) laptop-battery + Accessibility NOT granted
     -> Next stays LOCKED (advisory sleep does not bypass the real gate); (C) control: a
     fixable desktop that sleeps on AC -> Next ENABLED too (advisory for everyone), no note,
     Turn On shown. */
  console.log('\n#2587 -- the sleep step is advisory: it never gates Next, Accessibility still does');
  const sleepUi = (page) => page.evaluate(() => {
    const row = document.querySelector('[data-gate="sleep"]');
    const vis = (sel) => { const e = row.querySelector(sel); return !!(e && getComputedStyle(e).display !== 'none'); };
    return {
      battonly: row.hasAttribute('data-battonly'), green: vis('.s3-granted'),
      note: vis('.s3-battonly'), turnOn: vis('.s3-req'),
      hasContinueBtn: !!row.querySelector('.s3-continue'),
    };
  });
  {
    // (A) laptop that sleeps on battery, Accessibility granted: sleep is blocked but Next is
    // ENABLED; the honest note replaces Turn On; row not green; no Continue button.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false, battOnly: true }, tmux: { checkable: true, trusted: true },
    });
    const u = await sleepUi(page);
    ok(!(await nextDisabled(page)), '#2587 a blocked sleep row does NOT gate Next (the laptop is not walled in)');
    ok(u.battonly && u.note, 'the honest laptop note is shown');
    ok(!u.turnOn, 'the useless "Turn On" is hidden on the laptop-battery row');
    ok(!u.green, 'the sleep row is NOT shown green/Activated (it honestly still sleeps)');
    ok(!u.hasContinueBtn, 'there is no "Continue anyway" button any more -- Next just works');
    await ctx.close();
  }
  {
    // (B) same laptop-battery sleep, but Accessibility NOT granted: Next stays LOCKED. The
    // advisory sleep row must not bypass the tmux gate (satisfiable + required).
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false, battOnly: true }, tmux: { checkable: true, trusted: false },
    });
    ok(await nextDisabled(page), '#2587 Accessibility STILL gates Next even when sleep is advisory (no bypass into broken agents)');
    await ctx.close();
  }
  {
    // (C) CONTROL: a fixable desktop that sleeps on AC (no battOnly), Accessibility granted.
    // Sleep is advisory for EVERYONE, so Next is enabled; but Turn On (which CAN set Never)
    // still shows, and there is no laptop note.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false }, tmux: { checkable: true, trusted: true },
    });
    const u = await sleepUi(page);
    ok(!(await nextDisabled(page)), '#2587 CONTROL: a desktop that sleeps also gets a non-gating sleep step (advisory for everyone)');
    ok(!u.battonly && !u.note, 'a fixable desktop shows no laptop note (not battOnly)');
    ok(u.turnOn, 'a fixable desktop still shows "Turn On" (it CAN set Sleep to Never)');
    await ctx.close();
  }

  /* ---------- S3 sleep "Turn On": a FAILED open must show a VISIBLE error ---------- */
  // 0.6.41 re-test blocker (E): the prevent-sleep Turn On button felt DEAD to Josh.
  // The front-end DID surface the 409 message, but in body ink with no red, so a
  // real failure read as one more line of copy. The failure message now carries
  // .fr-msg-err (danger colour); a success leaves the line empty and un-classed.
  console.log('\nS3 sleep Turn On -- a failed open shows a VISIBLE error; a success stays silent');
  {
    // Enter S3 in Josh's state (sleep not prevented) so the "Turn On" button shows.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false }, tmux: { checkable: true, trusted: false },
    });
    // The decoy Energy window is an illustration, not a control: it must be inert
    // to clicks so its blue/On switch cannot be mistaken for the real action.
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('#fr-pane-3 .s3-win')).pointerEvents === 'none'),
      'the decoy Energy window (.s3-win) is pointer-events:none, so its switch cannot be the wrong click');

    // Baseline: the message line is empty and un-classed before any click.
    const before = await page.evaluate(() => {
      const el = document.getElementById('fr-s3-msg');
      return { text: el.textContent.trim(), hasErr: el.classList.contains('fr-msg-err'), color: getComputedStyle(el).color };
    });
    ok(before.text === '' && !before.hasErr, 'the message line starts empty and un-errored');

    // The open endpoint FAILS (409 with a message), as it would on a macOS whose
    // pane we cannot resolve. Click the sleep row's real "Turn On".
    await page.route('**/api/open-sleep-settings', (r) => r.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'we could not find the sleep settings screen on this computer automatically. Open System Settings, choose Battery (or Energy Saver on older Macs), and turn off automatic sleep' }),
    }));
    await page.click('[data-gate="sleep"] .s3-on');
    await page.waitForFunction(() => document.getElementById('fr-s3-msg').textContent.trim().length > 0, null, { timeout: 4000 }).catch(() => {});
    const after = await page.evaluate(() => {
      const el = document.getElementById('fr-s3-msg');
      return { text: el.textContent.trim(), hasErr: el.classList.contains('fr-msg-err'), color: getComputedStyle(el).color };
    });
    ok(after.text.length > 0, 'a failed open puts a message on the line (never silent)');
    ok(after.hasErr, 'the failed-open message carries .fr-msg-err (reads as an error, not body copy)');
    ok(after.color !== before.color,
      `and its colour actually changed from the body ink (before=${before.color}, after=${after.color}); if equal, the "red" is invisible exactly as it was for Josh`);
    // The firstrun card is white in BOTH themes, so the error must stay a readable
    // dark red in dark theme too -- not the dark-ground coral (#ff6b5e / rgb 255,107,94)
    // that --danger resolves to under a dark root, which washes out to ~2.8:1 on white.
    // Force the explicit dark toggle and re-read: the #firstrun subtree pins --danger
    // to the light value, so the colour must be the same readable red as in light.
    const darkColor = await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      return getComputedStyle(document.getElementById('fr-s3-msg')).color;
    });
    ok(darkColor === after.color && darkColor !== 'rgb(255, 107, 94)',
      `the error stays a readable dark red in dark theme (dark=${darkColor}, light=${after.color}); a dark-ground coral on the white card would be below AA`);
    await ctx.close();
  }
  {
    // CONTROL: a SUCCESSFUL open is silent -- empty line, no error class. This is
    // what makes the failure assertions above non-vacuous: the same reader returns
    // the opposite outcome when the endpoint succeeds.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false }, tmux: { checkable: true, trusted: false },
    });
    await page.route('**/api/open-sleep-settings', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
    await page.click('[data-gate="sleep"] .s3-on');
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => {
      const el = document.getElementById('fr-s3-msg');
      return { text: el.textContent.trim(), hasErr: el.classList.contains('fr-msg-err') };
    });
    ok(s.text === '' && !s.hasErr, 'a successful open leaves the line empty and un-errored (the check discriminates)');
    await ctx.close();
  }

  /* ---------- the poll unlocks WITHOUT a manual re-check ---------- */
  console.log('\nThe poll unlocks Next on its own when the grant lands (no manual click needed)');
  {
    const { ctx, page } = await fresh(browser);
    // Enter S3 with tmux not-granted (Next disabled), then flip it granted mid-screen.
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '[data-gate="sleep"]');
    let tmuxTrusted = false;
    await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: true } }));
    await page.route('**/api/a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: tmuxTrusted } }));
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    ok(await nextDisabled(page), 'Next starts disabled while tmux is not yet granted');
    tmuxTrusted = true;   // the user grants it in System Settings
    await page.waitForFunction(() => !document.getElementById('fr-next').disabled, null, { timeout: 4000 })
      .catch(() => {});
    ok(!(await nextDisabled(page)), 'the poll re-checks and unlocks Next once tmux is granted (no manual click in this scenario)');
    await ctx.close();
  }

  /* ---------- #2451/#2559 + #2648: the "Check again" nav alt fires an IMMEDIATE re-check ---------- */
  // Josh 0.6.50: after granting, the screen "sat here forever" -- the poll was slow and there
  // was no way to force it. #2648 moved the Check-again affordance OUT of the pane body (it sat
  // below the fold on first load, so a person could not see it when they needed it) INTO the
  // far-left nav alt (#fr-alt), which is always visible, carrying a shortened hint. Assert the
  // nav button + hint exist on step 3 and, on click, fire a gate re-check RIGHT NOW (a new
  // /api/a11y-status request well inside one poll interval) and unlock Next once the grant lands.
  console.log('\n#2451/#2559 + #2648 -- the step-3 "Check again" nav alt forces an immediate gate re-check');
  {
    const { ctx, page } = await fresh(browser);
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '[data-gate="sleep"]');
    let tmuxTrusted = false;
    let a11yHits = 0;
    await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: true } }));
    await page.route('**/api/a11y-status', (r) => { a11yHits += 1; return r.fulfill({ json: { checkable: true, trusted: tmuxTrusted } }); });
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    // #2648: the Check-again affordance is now the far-left nav alt (#fr-alt), not an in-pane
    // button; it must be VISIBLE on step 3 (its whole point is that the person can see it).
    const btn = await page.$('#fr-alt');
    ok(!!btn && await btn.isVisible(), 'the "Check again" nav alt (#fr-alt) is visible on step 3');
    const label = btn ? (await btn.textContent()).trim() : '';
    ok(/check again/i.test(label), `the nav alt reads "Check again" (got: ${JSON.stringify(label)})`);
    const hint = await page.$('#fr-alt-hint');
    const hintText = hint ? (await hint.textContent()).trim() : '';
    ok(!!hint && await hint.isVisible() && /^turned it on\? tap to check\.$/i.test(hintText),
      `the shortened hint rides beside it (#2648 item 3) (got: ${JSON.stringify(hintText)})`);
    ok(await nextDisabled(page), 'Next is disabled while the grant has not landed');
    // Grant it, then FORCE the check via the button and confirm a re-poll fires at once
    // (before the next timer tick) and unlocks Next.
    tmuxTrusted = true;
    const before = a11yHits;
    if (btn) await btn.click();
    // 80ms is far under the 750ms poll interval, so a hit in this window is almost
    // certainly the click's (a timer tick could coincide ~1-in-9, so this is a strong
    // integration signal, not a proof of isolation -- the DETERMINISTIC wiring guard is
    // the unit test web.firstrun-a11y-1214.test.js, which pins the step-3 alt -> frRecheckGates).
    await page.waitForTimeout(80);
    ok(a11yHits > before, `clicking "Check again" fired an immediate /api/a11y-status re-check (hits ${before} -> ${a11yHits})`);
    await page.waitForFunction(() => !document.getElementById('fr-next').disabled, null, { timeout: 2000 }).catch(() => {});
    ok(!(await nextDisabled(page)), 'the manual re-check unlocks Next once the grant has landed');
    await ctx.close();
  }

  /* ---------- #2085: the cannot-check state shows the neutral "Checking..." pill ---------- */
  console.log('\n#2085 -- an uncheckable tmux grant shows the neutral "Checking..." pill, never a false green, never blocks');
  {
    const { ctx, page } = await fresh(browser);
    // sleep granted (so only the a11y gate is in question); a11y uncheckable
    // (checkable:false) -- what /api/a11y-status returns when no native verdict is on
    // file (a11ystatus.read() ENOENT/stale: a browser, or not yet written). This check
    // mocks the HTTP response directly, so it is engine-agnostic.
    await gotoGate(page, '[data-gate="tmux"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: false, because: 'the accessibility database was not readable' },
    });
    const st = await page.evaluate(() => {
      const row = document.querySelector('[data-gate="tmux"]');
      const disp = (sel) => { const e = row && row.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
      const checkPill = row && row.querySelector('.s3-checking .s3-pill-wait');
      const lbl = row && row.querySelector('.s3-gate-lbl');
      const pane = document.getElementById('fr-pane-3');
      // fr-pane-3 has TWO mock windows (Energy for the sleep row, Accessibility for
      // this row); pick the Accessibility one by its title, not the first .s3-win.
      const wins = pane ? Array.from(pane.querySelectorAll('.s3-win')) : [];
      const axWin = wins.find((w) => { const t = w.querySelector('.s3-title'); return t && /Accessibility/i.test(t.textContent); });
      const mock = axWin && axWin.querySelector('.s3-mtxt');
      return {
        hasChecking: !!(row && row.hasAttribute('data-checking')),
        hasGranted: !!(row && row.hasAttribute('data-granted')),
        reqDisp: disp('.s3-req'), grantedDisp: disp('.s3-granted'), checkingDisp: disp('.s3-checking'),
        checkText: checkPill ? checkPill.textContent.trim() : null,
        lblText: lbl ? lbl.textContent.trim() : null,
        mockText: mock ? mock.textContent.trim() : null,
      };
    });
    ok(st.hasChecking && !st.hasGranted, 'the uncheckable tmux row is data-checking, not data-granted (never a false green)');
    ok(st.checkingDisp !== 'none' && st.reqDisp === 'none' && st.grantedDisp === 'none',
      `only the neutral pill shows (checking=${st.checkingDisp}, req/TurnOn=${st.reqDisp}, granted=${st.grantedDisp})`);
    ok(/Checking/i.test(st.checkText || ''), `the neutral pill reads "Checking..." (got: ${JSON.stringify(st.checkText)})`);
    ok(!(await nextDisabled(page)), 'an uncheckable tmux grant does NOT block Next (fail-safe invariant preserved)');
    // #2451: the gate names Kosmos (the binary macOS shows + grants), never tmux.
    // The grant is keyed on the calling binary = the kosmos-app, so the row label and
    // the mock Accessibility row read "Kosmos"; "tmux" here sent Josh looking for a
    // row macOS never shows.
    ok(st.lblText === 'Kosmos', `the a11y gate row label reads "Kosmos" (got: ${JSON.stringify(st.lblText)})`);
    ok(!/tmux/i.test(st.lblText || '') && !/tmux/i.test(st.mockText || ''),
      `neither the gate label nor the mock names tmux (label=${JSON.stringify(st.lblText)}, mock=${JSON.stringify(st.mockText)})`);
    ok(/Kosmos/i.test(st.mockText || ''), `the mock Accessibility row names Kosmos (got: ${JSON.stringify(st.mockText)})`);
    await ctx.close();
  }

  /* ---------- CONTROL: the reader discriminates ---------- */
  console.log('\nCONTROL -- the harness reads a real, discriminating verdict');
  {
    // A non-gated screen (S1 Welcome) must read Next-enabled, and a gated-not-granted
    // screen must read Next-disabled, from the SAME reader. Two opposite outcomes
    // prove nextDisabled() reflects the page rather than returning a constant -- so
    // the disabled/enabled assertions above are not vacuous.
    const { ctx, page } = await fresh(browser);
    await page.goto(`${BASE}/?first-run=1&fr-step=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const welcomeEnabled = !(await nextDisabled(page));
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: true, granted: false, nativePresent: true } });
    const gatedDisabled = await nextDisabled(page);
    ok(welcomeEnabled && gatedDisabled,
      `the reader discriminates (Welcome enabled=${welcomeEnabled}, gated-not-granted disabled=${gatedDisabled}); if either is wrong the gate assertions above are vacuous`);
    await ctx.close();
  }

  } catch (e) {
    fails.push('THREW, so everything after it was never asked: ' + ((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
  }
  console.log('\n' + (fails.length ? `${fails.length} FAILURES:\n  ` + fails.join('\n  ') : 'all clear'));
  process.exit(fails.length ? 1 : 0);
})();
