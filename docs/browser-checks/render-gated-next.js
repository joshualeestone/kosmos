/**
 * install-flow-9screen: the gated Next on the permission screens, driven for real.
 *
 * The gating screens and their subjects (#2559/#2911 re-gated S3 accessibility):
 *   S2 Access     data-gate="file-access"  -> /api/file-access-status (granted)     GATES
 *   S3 Automation data-gate="sleep"        -> /api/sleep-status (prevented)          advisory (#2587)
 *                 data-gate="tmux"         -> /api/a11y-status (app AX, trusted)     GATES  (#2559)
 *                 data-gate="tmux-a11y"    -> /api/tmux-a11y-status (tmux AX)         GATES  (#2911)
 * S3 asks for THREE things now (Josh: "turn on Kosmos, tmux, and accessibility"): the
 * app's own Accessibility grant (data-gate="tmux", label "Kosmos") AND tmux's OWN
 * Accessibility grant (data-gate="tmux-a11y", label "tmux") both GATE Next; sleep is
 * advisory. The contract (frPollGates) is FAIL-SAFE and POSITIVE-ONLY: a row goes green
 * (data-granted) ONLY on a measured grant; #fr-next is disabled ONLY when a GATING row
 * is measured-not-granted (checkable:true && !granted/!trusted). Uncheckable (a browser,
 * no FDA, an unreadable db, tmux not yet listed) and any fetch failure NEVER block and
 * NEVER show false green -- that is why the #2912 re-gate can never re-trap.
 * The poll (FR_GATE_POLL_MS, 750ms) re-checks, so granting in System Settings unlocks
 * Next on its own; a "Check again" control (#2451/#2559) also lets the user force it now.
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

/* Route the status endpoints to fixed verdicts for this context. Any omitted endpoint
   is left to answer however the served board does; every S3 test sets sleep, tmux (app
   AX) AND tmuxA11y, because all three are gating/advisory rows on S3 and an UNROUTED
   gating row would read the real board's live grant -> nondeterministic Next state.
   `undefined` means "leave unrouted". */
async function routeGates(page, { fileAccess, sleep, tmux, tmuxA11y }) {
  if (fileAccess !== undefined) await page.route('**/api/file-access-status', (r) => r.fulfill({ json: fileAccess }));
  if (sleep !== undefined) await page.route('**/api/sleep-status', (r) => r.fulfill({ json: sleep }));
  if (tmux !== undefined) await page.route('**/api/a11y-status', (r) => r.fulfill({ json: tmux }));
  if (tmuxA11y !== undefined) await page.route('**/api/tmux-a11y-status', (r) => r.fulfill({ json: tmuxA11y }));
  // #3221: entering S3 fires the tmux-a11y REGISTER (/api/tmux-a11y-prompt) up front (client
  // frFireTmuxA11yRegister), fire-and-forget, during this gotoGate navigation. Mock it so it
  // resolves deterministically instead of hitting the real board mid-goto -- the same reason the
  // *-status polls above are routed. #3113 had recorded an entry-time fire hanging this check's
  // networkidle wait; that no longer reproduces (the served endpoint answers fast), and this
  // route removes the dependency on that timing entirely.
  await page.route('**/api/tmux-a11y-prompt', (r) => r.fulfill({ json: { ok: true } }));
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

// The S3-satisfied baseline for a test that is NOT probing a given row: both
// accessibility rows granted, so Next is gated only by whatever that test varies.
const S3_GRANTED = { tmux: { checkable: true, trusted: true }, tmuxA11y: { checkable: true, trusted: true } };

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

  /* ---------- S3 Automation: app AX + tmux AX GATE, sleep is advisory (#2559/#2911) ----------
     #2559/#2911 RE-GATED the accessibility rows. Both the app's own Accessibility grant
     (data-gate="tmux", /api/a11y-status) and tmux's own Accessibility grant
     (data-gate="tmux-a11y", /api/tmux-a11y-status) block Next when measured-not-granted;
     sleep stays advisory (#2587). This is safe to re-gate (where #2912 could not) because
     the readings are now LIVE TCC-db reads that flip the instant the toggle does, and the
     gate is still POSITIVE-ONLY + FAIL-SAFE: only a definite checkable:true+!granted
     blocks; uncheckable (browser, no FDA, unreadable db, or tmux-not-yet-listed) never
     blocks. RED-CAPABLE both ways: a regression that drops either accessibility gate makes
     the "not-granted disables Next" arms go green->red; a regression that gates on an
     uncheckable reading makes the fail-safe arms red. */
  console.log('\nS3 Automation -- app AX + tmux AX GATE, sleep advisory (#2559/#2911)');
  {
    // All three not-granted -> Next DISABLED (both accessibility rows gate). Sleep alone
    // would not block (advisory), so this proves the accessibility gates, not sleep.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false },
      tmux: { checkable: true, trusted: false }, tmuxA11y: { checkable: true, trusted: false },
    });
    ok(await nextDisabled(page), 'S3 accessibility-not-granted DISABLES Next (re-gated #2559/#2911)');
    ok(!(await rowGranted(page, 'tmux')) && !(await rowGranted(page, 'tmux-a11y')), 'neither accessibility row is green (honest, no false grant)');
    await ctx.close();
  }
  {
    // App AX granted, tmux AX NOT granted -> Next DISABLED by the tmux row ALONE. The new
    // #2911 capability: the tmux accessibility grant is independently required.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: true, trusted: true }, tmuxA11y: { checkable: true, trusted: false },
    });
    ok(await nextDisabled(page), 'tmux accessibility not-granted alone DISABLES Next (#2911: tmux is independently required)');
    ok(await rowGranted(page, 'tmux'), 'the app-AX row is honestly green');
    ok(!(await rowGranted(page, 'tmux-a11y')), 'the tmux-AX row is honestly not green');
    await ctx.close();
  }
  {
    // Tmux AX granted, app AX NOT granted -> Next DISABLED by the app row (the #2559 re-gate).
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: true, trusted: false }, tmuxA11y: { checkable: true, trusted: true },
    });
    ok(await nextDisabled(page), 'app accessibility not-granted alone DISABLES Next (#2559 re-gate)');
    ok(!(await rowGranted(page, 'tmux')) && await rowGranted(page, 'tmux-a11y'), 'app-AX not green, tmux-AX green');
    await ctx.close();
  }
  {
    // All granted -> Next ENABLED, both accessibility rows green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: true, trusted: true }, tmuxA11y: { checkable: true, trusted: true },
    });
    ok(!(await nextDisabled(page)), 'S3 all-granted enables Next');
    ok(await rowGranted(page, 'sleep') && await rowGranted(page, 'tmux') && await rowGranted(page, 'tmux-a11y'), 'all three S3 rows are green');
    await ctx.close();
  }
  {
    // Both accessibility rows uncheckable -> FAIL-SAFE: Next ENABLED, neither green. This is
    // the invariant that makes the re-gate un-trappable: a browser / no-FDA / unreadable-db
    // context is never blocked.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: false },
      tmux: { checkable: false }, tmuxA11y: { checkable: false },
    });
    ok(!(await nextDisabled(page)), 'S3 uncheckable accessibility never blocks (fail-safe -- the #2912 un-trap preserved)');
    ok(!(await rowGranted(page, 'tmux')) && !(await rowGranted(page, 'tmux-a11y')), 'and neither uncheckable row is false-green');
    await ctx.close();
  }
  {
    // #2911/#3113 tmux-not-yet-listed: the route maps present:false -> checkable:false +
    // actionable:true, so a screen reached before tmux registers is advisory (never a trap) BUT
    // the row offers a real "Not activated" + Turn On affordance instead of a dead "Checking..."
    // spinner (Josh's #3113). App granted -> Next ENABLED even though the tmux row is not yet
    // granted; the tmux row is actionable (Turn On shown), not green, not a spinner.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: true, trusted: true },
      tmuxA11y: { checkable: false, actionable: true, because: 'tmux is not yet listed in Accessibility; turn it on to grant it' },
    });
    ok(!(await nextDisabled(page)), '#2911/#3113 tmux-not-yet-listed (actionable-uncheckable) never blocks -- no trap before tmux registers');
    ok(!(await rowGranted(page, 'tmux-a11y')), 'and the not-yet-listed tmux row is not false-green');
    const a11yUi = await page.evaluate(() => {
      const row = document.querySelector('[data-gate="tmux-a11y"]');
      const vis = (sel) => { const e = row.querySelector(sel); return !!(e && getComputedStyle(e).display !== 'none'); };
      return { turnOn: vis('.s3-req'), checking: vis('.s3-checking'), granted: vis('.s3-granted') };
    });
    ok(a11yUi.turnOn && !a11yUi.checking && !a11yUi.granted,
      '#3113 the not-yet-listed tmux row shows the "Not activated" + Turn On affordance, NOT a dead "Checking..." spinner');
    await ctx.close();
  }
  {
    // #3113 negative control: a plain uncheckable (no actionable flag -- a browser / no-FDA box,
    // where tmux genuinely cannot be granted) KEEPS the honest "Checking..." spinner and no Turn
    // On, proving the actionable render is gated on the flag and not applied to every uncheckable.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: true, trusted: true },
      tmuxA11y: { checkable: false, because: 'accessibility is not live-checkable here' },
    });
    const plainUi = await page.evaluate(() => {
      const row = document.querySelector('[data-gate="tmux-a11y"]');
      const vis = (sel) => { const e = row.querySelector(sel); return !!(e && getComputedStyle(e).display !== 'none'); };
      return { turnOn: vis('.s3-req'), checking: vis('.s3-checking') };
    });
    ok(plainUi.checking && !plainUi.turnOn,
      '#3113 CONTROL: a non-actionable uncheckable (browser/no-FDA) keeps "Checking..." and shows no Turn On');
    await ctx.close();
  }

  /* ---------- #2587: the sleep step is ADVISORY (Josh's ruling) ----------
     A laptop that sleeps on battery is prevented:false forever (macOS has no
     never-sleep-on-battery switch), so gating Next on it walled laptop users in. Now the
     sleep step NEVER gates Next; the honest note replaces the useless Turn On on that
     (battOnly) row. Accessibility DOES gate (#2559/#2911), so these arms hold the
     accessibility rows GRANTED and vary only sleep, to prove sleep alone never walls.
     Arms: (A) laptop-battery, accessibility granted -> Next ENABLED, note shown, Turn On
     hidden, not green, no Continue button; (B) control: a fixable desktop that sleeps on
     AC -> Next ENABLED, no note, Turn On shown. */
  console.log('\n#2587 -- the sleep step is advisory: sleep alone never gates Next (accessibility granted)');
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
    // (A) laptop that sleeps on battery, accessibility granted: sleep is blocked but Next is
    // ENABLED; the honest note replaces Turn On; row not green; no Continue button.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false, battOnly: true }, ...S3_GRANTED,
    });
    const u = await sleepUi(page);
    ok(!(await nextDisabled(page)), '#2587 a blocked sleep row does NOT gate Next (the laptop is not walled in; accessibility granted)');
    ok(u.battonly && u.note, 'the honest laptop note is shown');
    ok(!u.turnOn, 'the useless "Turn On" is hidden on the laptop-battery row');
    ok(!u.green, 'the sleep row is NOT shown green/Activated (it honestly still sleeps)');
    ok(!u.hasContinueBtn, 'there is no "Continue anyway" button any more -- Next just works');
    await ctx.close();
  }
  {
    // (B) CONTROL: a fixable desktop that sleeps on AC (no battOnly), accessibility granted.
    // Sleep is advisory for EVERYONE, so Next is enabled; but Turn On (which CAN set Never)
    // still shows, and there is no laptop note.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false }, ...S3_GRANTED,
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
    // Enter S3 with the sleep "Turn On" button shown (sleep not prevented); accessibility
    // granted so the screen is not otherwise blocked while we exercise the sleep button.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="sleep"]', {
      sleep: { checkable: true, prevented: false }, ...S3_GRANTED,
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
      sleep: { checkable: true, prevented: false }, ...S3_GRANTED,
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

  /* ---------- the poll unlocks a GATING screen WITHOUT a manual re-check ----------
     Granting in System Settings unlocks Next on its own. Exercised on S2 file-access. */
  console.log('\nThe poll unlocks Next on its own when the grant lands (S2 file-access, a gating screen)');
  {
    const { ctx, page } = await fresh(browser);
    // Enter S2 with file-access not-granted (Next disabled), then flip it granted mid-screen.
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '[data-gate="file-access"]');
    let faGranted = false;
    await page.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: faGranted, nativePresent: true } }));
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    ok(await nextDisabled(page), 'Next starts disabled while file-access is not yet granted');
    faGranted = true;   // the user grants it in System Settings
    await page.waitForFunction(() => !document.getElementById('fr-next').disabled, null, { timeout: 4000 })
      .catch(() => {});
    ok(!(await nextDisabled(page)), 'the poll re-checks and unlocks Next once file-access is granted (no manual click in this scenario)');
    await ctx.close();
  }

  /* ---------- #2451/#2559: the manual "Check again" button fires an IMMEDIATE re-check ---------- */
  // Josh 0.6.50 (7.58.24): after granting, the screen "sat here forever" -- the poll was slow
  // and there was no way to force it. Assert the S3 "Check again" button exists and, on click,
  // fires a gate re-check RIGHT NOW (a new /api/a11y-status request lands well inside one poll
  // interval), and that this manual re-check unlocks Next when the grant has landed. S3 now
  // GATES on accessibility, so we enter with app-AX not-granted (Next disabled), hold tmux-AX
  // granted so the app row is the only variable, then grant the app row and force the re-check.
  console.log('\n#2451/#2559 -- the S3 "Check again" button forces an immediate gate re-check');
  {
    const { ctx, page } = await fresh(browser);
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '[data-gate="sleep"]');
    let appTrusted = false;
    let a11yHits = 0;
    await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: true } }));
    await page.route('**/api/tmux-a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: true } }));
    await page.route('**/api/a11y-status', (r) => { a11yHits += 1; return r.fulfill({ json: { checkable: true, trusted: appTrusted } }); });
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const btn = await page.$('#fr-alt');
    ok(!!btn, 'the S3 "Check again" control is present in the nav');
    ok(btn ? !(await btn.isHidden()) : false, 'the nav Check-again control is visible on S3');
    const label = btn ? (await btn.textContent()).trim() : '';
    ok(/check again/i.test(label), `the button reads "Check again" (got: ${JSON.stringify(label)})`);
    // App accessibility not-granted -> Next is DISABLED (re-gated); the row is honestly not green.
    ok(await nextDisabled(page), 'Next is disabled on S3 while app accessibility is not granted (re-gated #2559)');
    ok(!(await rowGranted(page, 'tmux')), 'the app-accessibility row is honestly not-granted before the grant');
    // Grant it, then FORCE the check via the button and confirm a re-poll fires at once
    // (before the next timer tick), flips the row to Activated, and unlocks Next.
    appTrusted = true;
    const before = a11yHits;
    if (btn) await btn.click();
    // 80ms is far under the 750ms poll interval, so a hit in this window is almost
    // certainly the click's (a timer tick could coincide ~1-in-9, so this is a strong
    // integration signal, not a proof of isolation -- the DETERMINISTIC wiring guard is
    // the unit test web.firstrun-a11y-1214.test.js, which pins handler -> frRecheckGates).
    await page.waitForTimeout(80);
    ok(a11yHits > before, `clicking "Check again" fired an immediate /api/a11y-status re-check (hits ${before} -> ${a11yHits})`);
    await page.waitForFunction(() => { const r = document.querySelector('[data-gate="tmux"]'); return r && r.hasAttribute('data-granted'); }, null, { timeout: 2000 }).catch(() => {});
    ok(await rowGranted(page, 'tmux'), 'the manual re-check flips the accessibility row to Activated once the grant has landed');
    ok(!(await nextDisabled(page)), 'and Next unlocks once the grant is read (re-gated screen clears on the forced re-check)');
    await ctx.close();
  }

  /* ---------- #2085: the cannot-check state shows the neutral "Checking..." pill ---------- */
  console.log('\n#2085 -- an uncheckable app-accessibility grant shows the neutral "Checking..." pill, never a false green, never blocks');
  {
    const { ctx, page } = await fresh(browser);
    // sleep + tmux-AX granted (so only the app-AX gate is in question); app-AX uncheckable
    // (checkable:false) -- what /api/a11y-status returns when no live verdict is available
    // (a browser, no FDA). This check mocks the HTTP response directly, so it is engine-agnostic.
    await gotoGate(page, '[data-gate="tmux"]', {
      sleep: { checkable: true, prevented: true },
      tmux: { checkable: false, because: 'the accessibility database was not readable' },
      tmuxA11y: { checkable: true, trusted: true },
    });
    const st = await page.evaluate(() => {
      const row = document.querySelector('[data-gate="tmux"]');
      const disp = (sel) => { const e = row && row.querySelector(sel); return e ? getComputedStyle(e).display : 'missing'; };
      const checkPill = row && row.querySelector('.s3-checking .s3-pill-wait');
      const lbl = row && row.querySelector('.s3-gate-lbl');
      // The tmux-AX row (data-gate="tmux-a11y") is the NEW #2911 row; its label reads "tmux".
      const tmuxRow = document.querySelector('[data-gate="tmux-a11y"]');
      const tmuxLbl = tmuxRow && tmuxRow.querySelector('.s3-gate-lbl');
      return {
        hasChecking: !!(row && row.hasAttribute('data-checking')),
        hasGranted: !!(row && row.hasAttribute('data-granted')),
        reqDisp: disp('.s3-req'), grantedDisp: disp('.s3-granted'), checkingDisp: disp('.s3-checking'),
        checkText: checkPill ? checkPill.textContent.trim() : null,
        lblText: lbl ? lbl.textContent.trim() : null,
        tmuxLblText: tmuxLbl ? tmuxLbl.textContent.trim() : null,
      };
    });
    ok(st.hasChecking && !st.hasGranted, 'the uncheckable app-AX row is data-checking, not data-granted (never a false green)');
    ok(st.checkingDisp !== 'none' && st.reqDisp === 'none' && st.grantedDisp === 'none',
      `only the neutral pill shows (checking=${st.checkingDisp}, req/TurnOn=${st.reqDisp}, granted=${st.grantedDisp})`);
    ok(/Checking/i.test(st.checkText || ''), `the neutral pill reads "Checking..." (got: ${JSON.stringify(st.checkText)})`);
    ok(!(await nextDisabled(page)), 'an uncheckable app-AX grant does NOT block Next (fail-safe invariant preserved)');
    // #2451/#2911: the APP row names "Kosmos" (the app is the calling binary macOS shows +
    // grants), and the NEW tmux row names "tmux" (its own separate grant, #2911). Both must
    // be honestly labelled so the user knows which of the two Accessibility entries to toggle.
    ok(st.lblText === 'Kosmos', `the app-AX gate row label reads "Kosmos" (got: ${JSON.stringify(st.lblText)})`);
    ok(st.tmuxLblText === 'tmux', `the tmux-AX gate row label reads "tmux" (got: ${JSON.stringify(st.tmuxLblText)})`);
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
