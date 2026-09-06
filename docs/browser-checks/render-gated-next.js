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
 * The 1.5s poll re-checks, so granting in System Settings unlocks Next with no
 * manual re-check.
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

  /* ---------- S2 Access: the file-access gate ---------- */
  console.log('\nS2 Access -- the file-access gate');
  {
    // Measured NOT granted -> Next disabled, row not green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: true, granted: false } });
    ok(await nextDisabled(page), 'file-access measured-not-granted disables Next');
    ok(!(await rowGranted(page, 'file-access')), 'and the row is NOT shown granted (no false green)');
    await ctx.close();
  }
  {
    // Measured granted -> Next enabled, row green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: true, granted: true } });
    ok(!(await nextDisabled(page)), 'file-access measured-granted enables Next');
    ok(await rowGranted(page, 'file-access'), 'and the row is shown granted (data-granted)');
    await ctx.close();
  }
  {
    // Uncheckable (a browser / no native writer) -> FAIL-SAFE: Next enabled, no false green.
    const { ctx, page } = await fresh(browser);
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: false } });
    ok(!(await nextDisabled(page)), 'file-access UNCHECKABLE never blocks (fail-safe)');
    ok(!(await rowGranted(page, 'file-access')), 'and uncheckable is NOT shown as granted (never false green)');
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
    ok(await nextDisabled(page), 'S3 sleep-granted but tmux-not still disables Next (needs BOTH)');
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

  /* ---------- the poll unlocks WITHOUT a manual re-check ---------- */
  console.log('\nThe 1.5s poll unlocks Next when the grant lands, no re-check needed');
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
    ok(!(await nextDisabled(page)), 'the poll re-checks and unlocks Next once tmux is granted (no manual re-check)');
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
    await gotoGate(page, '[data-gate="file-access"]', { fileAccess: { checkable: true, granted: false } });
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
