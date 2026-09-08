/**
 * Click the whole thing, like a person. Nothing here reads source.
 *
 * install-flow-9screen: rewritten for Josh's signed-off 9-screen flow (was the
 * 6-screen driver). The flow is now LINEAR 1..9 -- Welcome, Access(gate),
 * Automation(2 gates), Notifications, Model, Self-improving, Success, About-you,
 * Your-agents -- opening on Welcome (not Success), with no step crumb / progress
 * segments (Josh's spec), no standalone machine-check screen, and no #2163
 * pre-flight interstitial. The persistent shell head (#fr-title/#fr-eyebrow) is
 * retired: each pane owns its own <h2>, so heads are read off the VISIBLE pane's
 * <h2> (activeHead), never #fr-title. The permission gates (S2 file-access, S3
 * sleep+tmux) are mocked UNCHECKABLE in the walk-throughs so Next follows the
 * fail-safe path (a browser is genuinely uncheckable); the gate's BLOCKING
 * behaviour has its own check (render-gated-next). Retired the two machine-check
 * sections with the screen they tested.
 *
 * 🛑 RUN IN THE BROWSER PASS: this driver was rewritten to match the new markup
 * with the node selectors validated, but its RUNTIME timing/navigation is proven
 * only when it actually runs against a served board. Validate + tune waits on the
 * post-serve browser-quiet window.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { paneCount } = require('./lib-firstrun-steps.js');
/* KOSMOS_URL so this can join the release runner, which asks the kernel for a
   free port (#633/#708). The literal stays as the hand-run fallback. */
const BASE = process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const FLAG = process.argv[2];   // the sandboxed first-run.json
// The About-you record lives at the DATA root (the flag's grandparent, per
// engine/you.js's BASE), and it is first-run state: left behind by an earlier
// run it prefills the About-you step and arms the gate, so the "Continue waits"
// assertions would measure the leftover, not the gate. Cleared everywhere the
// flag is cleared.
const YOU = path.join(path.dirname(path.dirname(FLAG)), 'you.json');

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

/* install-flow-9screen: the permission gates (S2/S3) disable Next until granted.
   In a walk-through we mock them UNCHECKABLE so Next follows the fail-safe path
   (never blocks) -- a real browser reports checkable:false anyway, so this models
   the honest browser experience. The gate's positive-not-granted BLOCK is proven
   by render-gated-next, not here. */
async function mockGatesUncheckable(page) {
  for (const url of ['**/api/file-access-status', '**/api/sleep-status', '**/api/a11y-status']) {
    await page.route(url, (r) => r.fulfill({ json: { checkable: false } }));
  }
}

async function fresh(browser, opts = {}) {
  fs.rmSync(FLAG, { force: true });
  fs.rmSync(YOU, { force: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
  // Gates first, so an app route the caller adds can still override a specific one.
  if (opts.gates !== false) await mockGatesUncheckable(page);
  if (opts.route) await page.route(...opts.route);
  await page.goto(`${BASE}/${opts.query || ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  return { ctx, page };
}

/* The heading of whichever pane is showing. The shell #fr-title is retired; each
   pane owns its <h2> (frFocusActiveHead focuses it), so "the current heading" is
   the visible pane's own <h2>. */
async function activeHead(page) {
  return page.evaluate(() => {
    const pane = [...document.querySelectorAll('.fr-pane')].find((p) => !p.hidden);
    const h2 = pane && pane.querySelector('h2');
    return h2 ? h2.textContent.trim() : '';
  });
}

/* Walk forward by CONTENT until the pane holding `anchorSel` is showing, never by
   a fixed click count (identity, not index -- an inserted/removed step is walked
   through, never mis-counted; kosmos#1801). With the gates mocked uncheckable, no
   step before the target disables Next; a disabled Next on a non-target step means
   an intermediate step grew a required-answer gate this walk does not handle.

   🛑 THE PRIMARY IS NOT ALWAYS #fr-next, AND ASSUMING SO TIMED OUT ON A CLEAN
   MACHINE (kosmos#2445). The Model step (S5) HIDES #fr-next and offers only
   "Skip connecting a model" as #fr-alt whenever nothing is connected --
   frPaintSubscription's non-`connected` arm calls frActions(null, { alt }), so
   `next.hidden = true`. A machine signed into Claude reports subscription
   `connected` and shows a #fr-next "Next"; a CLEAN machine (every CI runner, and
   a real fresh install) reports not-connected and shows only the #fr-alt Skip
   link. A walk that only ever clicks #fr-next therefore passed on the signed-in
   build box and timed out for the full 30s on the headless macos-latest runner
   ("<button hidden id=fr-next>Next</button> ... element is not visible"). It read
   as a SwiftShader paint weakness; it is not -- `hidden` is a DOM attribute, and
   the button is deterministically hidden by the not-connected arm. The fix is to
   click whatever control is ACTUALLY forward: #fr-next when it is usable, else the
   sole forward #fr-alt link a "no primary" step offers instead. #fr-next is
   preferred, so the connected arm (whose #fr-alt is "Check again", NOT forward) is
   still driven by its Next; #fr-alt is used only when #fr-next is unusable, which
   in a straight walk to #fr-success is only ever the S5 Skip. */
async function advanceToAnchor(page, anchorSel, max = 12) {
  for (let i = 0; i < max; i += 1) {
    // Let the step SETTLE into an actionable state before reading it: the target
    // pane is showing, or a forward control (#fr-next, else #fr-alt) is usable.
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      const pane = el && el.closest('.fr-pane');
      if (pane && !pane.hidden) return true;
      const usable = (b) => !!(b && !b.hidden && !b.disabled);
      return usable(document.getElementById('fr-next')) || usable(document.getElementById('fr-alt'));
    }, anchorSel, { timeout: 6000 }).catch(() => {});
    const state = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const pane = el && el.closest('.fr-pane');
      const next = document.getElementById('fr-next');
      const alt = document.getElementById('fr-alt');
      const usable = (b) => !!(b && !b.hidden && !b.disabled);
      return {
        atTarget: !!(pane && !pane.hidden),
        nextUsable: usable(next),
        nextDisabled: !!(next && next.disabled),
        altUsable: usable(alt),
      };
    }, anchorSel);
    if (state.atTarget) return;
    if (state.nextUsable) {
      await page.click('#fr-next');
    } else if (state.nextDisabled) {
      // #1801: a DISABLED Next (present but disabled) means an intermediate step
      // grew a required-answer gate this walk does not handle. Diagnose it BEFORE
      // falling to #fr-alt -- a gated step that ALSO exposes a usable alt would
      // otherwise be silently walked via the alt and this signal lost. The S5 Skip
      // case is Next HIDDEN, not disabled, so it does not reach here (gates are
      // mocked uncheckable, so a disabled Next is unexpected; kosmos#1801).
      throw new Error(`Continue is disabled on a step before ${anchorSel} -- an `
        + 'intermediate step grew a required-answer gate this walk does not handle '
        + '(gates are mocked uncheckable, so this is unexpected; kosmos#1801).');
    } else if (state.altUsable) {
      // #fr-next is hidden (the S5 not-connected arm), and the step's sole
      // forward action is the #fr-alt "Skip connecting a model" link. Reached only
      // when Next is neither usable nor disabled -- i.e. genuinely hidden, not gated.
      await page.click('#fr-alt');
    } else {
      throw new Error(`no forward control (neither #fr-next nor #fr-alt is usable) `
        + `on a step before ${anchorSel} -- the step painted no way onward.`);
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`never reached ${anchorSel} in ${max} advances`);
}

async function waitAnchorLeft(page, anchorSel, timeout = 5000) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    const pane = el && el.closest('.fr-pane');
    return !!(pane && pane.hidden);
  }, anchorSel, { timeout });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });

  /* ⚠️ A CHECKER THAT CANNOT REPORT ITS OWN FAILURE. A section's first click
     timing out after 30s used to kill the run WITHOUT its FAILURES line and
     without an exit code of its own. The throw is now a finding like any other,
     the summary always prints, and the browser is always closed. */
  try {

  /* ------------------------------------------------------------------ */
  console.log('\n1. A machine that has never been through it opens ON first run, at Welcome');
  {
    const { ctx, page } = await fresh(browser);
    ok(await page.isVisible('#firstrun'), 'the overlay is up with no ?first-run flag at all');
    ok((await activeHead(page)) === 'Welcome to Kosmos', 'on step 1, the Welcome screen');
    // install-flow-9screen: the step crumb + progress segments are GONE (Josh's
    // spec), so there is nothing to assert about a "Step N of M" indicator.
    ok((await page.locator('#fr-step').count()) === 0, 'no step crumb (removed by spec)');
    ok((await page.locator('#fr-segs .fr-seg').count()) === 0, 'no progress segments (removed by spec)');
    // The ruled privacy copy is STAGED hidden on Welcome pending Josh's placement:
    // present in the DOM, not visibly placed.
    ok(await page.locator('#fr-privacy-staged').count() === 1, 'the staged privacy block is in the DOM');
    ok(await page.locator('#fr-privacy-staged').isHidden(), 'and it is staged hidden, not yet placed');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === true),
      'the board behind it is inert');
    ok(await page.evaluate(() => document.querySelector('#firstrun')
      .contains(document.elementFromPoint(300, 400))), 'nothing behind it is clickable');

    console.log('   ...clicking through every step, in the pack\'s order');
    ok(/Get Started/.test(await page.locator('#fr-next').textContent()), 'the Welcome primary is Get Started');

    // Walk to the Success screen (step 7) by content. #12 (0.6.39): it is now a
    // FIXED STATIC screen -- no app-location look, no reveal button, no machine
    // dependency. Assert the ruled copy and the ABSENCE of the removed subsystem.
    await advanceToAnchor(page, '#fr-success');
    ok((await activeHead(page)) === 'Kosmos is installed and configured.', 'reached the Success screen (S7)');
    const successText = await page.locator('#fr-pane-7').textContent();
    /* 🔑 THE DOCK GUIDANCE IS ON SUCCESS, at Josh's ruling of 2026-08-27 16:08.
       render-first-run asserts it ABSENT on the fleet ending; this asserts it
       PRESENT here, and the pair is what stops it drifting or vanishing. */
    ok(/you will see Kosmos in your dock\./.test(successText),
      'the Success screen tells the person they will see Kosmos in their dock');
    ok(/Drag the Kosmos icon to the far left so it stays there and is easy to find later\./.test(successText),
      'the dock drag line is on the Success screen (Josh asked for it back 2026-08-27)');
    // The removed reveal subsystem must not be on the Success screen.
    ok((await page.locator('#fr-s7-showwhere').count()) === 0, 'no static Show-me-where button');
    ok((await page.locator('#fr-reveal').count()) === 0, 'no injected reveal button');
    ok(!/Checking where the Kosmos icon is/.test(successText), 'no app-location check row');
    // The real Kosmos app icon is in the dock illustration, not a gold placeholder.
    ok((await page.locator('#fr-pane-7 img.fc-k').count()) >= 1, 'the real Kosmos app icon renders in the dock tile');

    // On to About-you (step 8), reached by content. The gate IS the design (no
    // skip): Continue WAITS on the two required answers.
    await advanceToAnchor(page, '#fr-you');
    ok((await activeHead(page)) === 'Who are your agents working for?', 'the About-you step (S8), reached by content');
    ok(await page.locator('#fr-next').isDisabled(), 'Continue waits for the two required answers');
    await page.fill('#fr-you-name', 'Josh');
    ok(await page.locator('#fr-next').isDisabled(), 'one answer alone does not arm it');
    await page.fill('#fr-you-do', 'I run a company that builds AI tools');
    ok(!(await page.locator('#fr-next').isDisabled()), 'both answers arm Next; the third stays optional');
    ok(/Next/.test(await page.locator('#fr-next').textContent()), 'the About-you primary is Next (Continue->Next rename)');
    await page.click('#fr-next');
    // Continue SAVES before it advances (a real PUT), so wait for the About-you
    // pane to LEAVE rather than reading the head mid-flight.
    await waitAnchorLeft(page, '#fr-you');
    // The Your-agents fork (step 9). #2497 (Josh, 2026-09-08): onboarding no longer
    // auto-scans/auto-imports, so this step ALWAYS lands on the no-agent "Create your
    // first agent." / Giddy Up screen, even on a fleet-present (rich) board. What must
    // be true is it rendered a real heading and a single onward action (Giddy Up).
    ok((await activeHead(page)).length > 0, 'the Your-agents fork rendered a heading');
    ok((await page.locator('#fr-next').textContent()).trim().length > 0, 'and a single onward action');
    console.log('   ...and out the front door, through the Giddy Up create ending');
    await page.click('#fr-next');
    await page.waitForTimeout(600);
    // #2497: the Giddy Up action is frFinish(openCreate) -- it closes the overlay and
    // opens the Create-your-first-agent panel (showTab('agents')), so the surface is
    // #panel-create, not the board grid. The board is un-inert behind it either way.
    ok(await page.isHidden('#firstrun'), 'the overlay closed');
    ok(await page.isVisible('#panel-create'), 'the Create-your-first-agent panel is there (#2497 Giddy Up ending)');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
      'the app behind is interactive again');
    ok(fs.existsSync(FLAG), 'the flag was written, so it will not reappear');
    ok(JSON.parse(fs.readFileSync(FLAG, 'utf8')).completedAt, 'and the flag has a timestamp in it');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n2. Having been through it, it does not come back');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok(await page.isHidden('#firstrun'), 'a returning person gets their board, not onboarding');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
      'and nothing left the page inert');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n3. No Back, no Skip, and Escape');
  {
    const { ctx, page } = await fresh(browser);
    // Welcome -> Access -> Automation (two clicks; gates mocked uncheckable so
    // Next is live).
    await page.click('#fr-next');   // Welcome -> Access
    await page.click('#fr-next');   // Access -> Automation
    // ⚠️ NO BACK anywhere (Josh, 2026-08-17): the flow only moves forward.
    ok((await page.locator('#fr-back').count()) === 0, 'no Back button exists on any step');
    // The visible Skip died by the pack's ruling; Escape is the exit and it
    // carries the same contract (marks seen, so it does not nag).
    ok((await page.locator('#fr-skip').count()) === 0, 'no visible Skip link anywhere (pack decisions table)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'Escape closed it');
    ok(fs.existsSync(FLAG), 'Escape marked it seen, so it does not nag');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'Escape closed it');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
      'Escape did not leave the page inert and unusable');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n4. The hand-off into making an agent actually lands there (create fork)');
  {
    const { ctx, page } = await fresh(browser, {
      route: ['**/api/first-run', (r) => r.fulfill({ json: { done: false, fleetKnown: true, fleetCount: 0, fleetNames: [], path: 'create', subscription: { state: 'connected', plan: 'Claude Max', because: '' } } })],
    });
    // Advance to About-you (step 8) by content, then through to the create fork.
    await advanceToAnchor(page, '#fr-you');
    await page.fill('#fr-you-name', 'Josh');
    await page.fill('#fr-you-do', 'Testing the create path');
    await page.click('#fr-next');
    await waitAnchorLeft(page, '#fr-you');
    /* 🛑 THE CREATE ARM PAINTS TWICE. It renders "Looking for agents already here"
       and RETURNS while frFindAgents() reads the disk, then repaints to the real
       ending. Wait past the interim screen before reading the heading. */
    await page.waitForFunction(
      () => {
        const pane = [...document.querySelectorAll('.fr-pane')].find((p) => !p.hidden);
        const h2 = pane && pane.querySelector('h2');
        return h2 && !/Looking for agents/i.test(h2.textContent || '');
      }, null, { timeout: 5000 });
    const endTitle = await activeHead(page);
    const endAction = (await page.locator('#fr-next').textContent()).trim();
    ok(/Create your first agent/.test(endTitle), `on the create ending (saw ${JSON.stringify(endTitle)})`);
    /* Josh, 2026-08-27: the create-fork label is "Giddy Up" (kosmos#1204). */
    ok(/Giddy Up/.test(endAction),
      `the create ending carries the pack's single action (saw ${JSON.stringify(endAction)})`);
    await page.click('#fr-next');
    await page.waitForTimeout(800);
    ok(await page.isHidden('#firstrun'), 'the overlay got out of the way');
    ok(await page.isVisible('#panel-create'), 'and the create panel is open');
    // Not just open -- usable. The picker's radios are only un-hidden by the fetch.
    await page.waitForSelector('#roles-list .pick2', { state: 'visible', timeout: 5000 }).catch(() => {});
    // Four since #1652 added "import an agent from a file" as a fourth .pick2.
    ok((await page.locator('#roles-list .pick2:visible').count()) === 4, 'with its roles actually loaded');
    ok(await page.isVisible('#cstep-role'), 'on step one of creating, not somewhere mid-flow');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n5. A first-run route that fails does NOT put onboarding over a working board');
  {
    fs.rmSync(FLAG, { force: true });
    fs.rmSync(YOU, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await page.route('**/api/first-run', (r) => r.fulfill({ status: 500, json: { error: 'nope' } }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok(await page.isHidden('#firstrun'), 'no overlay when we could not read whether to show one');
    ok(await page.isVisible('#grid'), 'and the board painted anyway');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n6. The S3 automation gate BLOCKS Next until a measured grant, then unblocks (fail-safe otherwise)');
  {
    // A measured NOT-granted reading on either S3 gate must disable Next; the
    // uncheckable/failure paths must NOT (fail-safe). This is the walk-through's
    // view of the gate; render-gated-next pins the poll mechanics.
    const { ctx, page } = await fresh(browser, { gates: false });
    // Both S3 gates measured-not-granted -> Next disabled on S3.
    await page.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: true } }));
    await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: false } }));
    await page.route('**/api/a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: false } }));
    await advanceToAnchor(page, '.s3-gate-row');       // S2 file-access is granted, so we can reach S3
    await page.waitForTimeout(400);
    ok(await page.locator('#fr-next').isDisabled(), 'S3 Next is disabled while sleep + tmux are measured-not-granted');
    // Grant both -> the 1.5s poll re-enables Next.
    await page.unroute('**/api/sleep-status');
    await page.unroute('**/api/a11y-status');
    await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: true } }));
    await page.route('**/api/a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: true } }));
    await page.waitForFunction(() => !document.getElementById('fr-next').disabled, null, { timeout: 4000 })
      .catch(() => {});
    ok(!(await page.locator('#fr-next').isDisabled()), 'granting both gates unlocks Next (the poll re-enables it)');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n7. A completion flag that will not stick is SAID, not swallowed');
  {
    const { ctx, page } = await fresh(browser, {
      route: ['**/api/first-run/complete', (r) => r.fulfill({ status: 500, json: { error: 'we could not remember that, so this may appear again next time' } })],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(await page.isVisible('#firstrun'), 'it stayed up long enough to say so');
    const said = await page.locator('#fr-forgot').textContent();
    ok(/could not remember/i.test(said), 'and it said it: ' + said.trim().slice(0, 60));
    ok(await page.locator('#fr-forgot').isVisible(), 'and the sentence is actually on screen');
    ok(await page.locator('#fr-next').textContent() === 'Carry on anyway', 'with a way onward');
    await page.click('#fr-next');
    await page.waitForTimeout(400);
    ok(await page.isHidden('#firstrun'), 'and the second click always gets out');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n8. A deep link with rubbish in it still renders a step');
  for (const bad of ['3.7', '2.5', '0', '99', 'banana', '-1', '<script>']) {
    const { ctx, page } = await fresh(browser, { query: '?first-run=1&fr-step=' + encodeURIComponent(bad) });
    /* ⚠️ The failure this is for drew a titled, buttoned, COMPLETELY EMPTY dialog:
       frGo(3.7) matched no pane, hid every one, and painted a step into one it had
       just hidden. Count the panes SHOWING rather than naming an index range. */
    const showing = await page.evaluate(() =>
      [...document.querySelectorAll('.fr-pane')].filter((p) => !p.hidden).length);
    ok(showing === 1, `fr-step=${bad} shows exactly one pane (showed ${showing})`);
    // install-flow-9screen: no step crumb anymore; the invariant is that the ONE
    // showing pane has a non-empty heading (never the empty titled dialog).
    ok((await activeHead(page)).length > 0, `fr-step=${bad} has a heading`);
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n9. Escape during an in-flight completion does not fire two of them');
  {
    fs.rmSync(FLAG, { force: true });
    fs.rmSync(YOU, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await mockGatesUncheckable(page);
    let posts = 0;
    await page.route('**/api/first-run/complete', async (r) => {
      posts += 1;
      await new Promise((res) => setTimeout(res, 1200));   // hold it open
      r.fulfill({ json: { done: true } });
    });
    await page.route('**/api/first-run', (r) => r.fulfill({ json: { done: false, fleetKnown: true, fleetCount: 0, fleetNames: [], path: 'create', subscription: { state: 'connected', plan: 'Claude Max', because: '' } } }));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await advanceToAnchor(page, '#fr-you');
    await page.fill('#fr-you-name', 'Josh');      // About you gates Continue
    await page.fill('#fr-you-do', 'Testing');
    await page.click('#fr-next');                 // saves, then advances
    await waitAnchorLeft(page, '#fr-you');
    await page.click('#fr-next');                 // starts "Giddy Up"
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');          // ...and Escape mid-flight
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2200);
    ok(posts === 1, `exactly one completion was written (saw ${posts})`);
    // ⚠️ And the callback that won is the one they CHOSE. Two completions ran both
    // callbacks, so openCreate() opened the panel and showTab('agents') took it off.
    ok(await page.isVisible('#panel-create'),
      'the create panel they asked for survived, rather than being closed by a second callback');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n10. A completion POST that never answers does not lock anybody in');
  {
    fs.rmSync(FLAG, { force: true });
    fs.rmSync(YOU, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await mockGatesUncheckable(page);
    // Never fulfilled. The overlay must degrade into its could-not-remember path
    // rather than sitting disabled over an inert page forever.
    await page.route('**/api/first-run/complete', () => {});
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(10000);            // past the 8s abort
    ok(await page.locator('#fr-forgot').isVisible(), 'a hung POST turned into a message, not a trap');
    ok(await page.isEnabled('#fr-next'), 'and the way out came back');
    await page.click('#fr-next');
    await page.waitForTimeout(400);
    ok(await page.isHidden('#firstrun'), 'and it actually let them out');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
      'and did not leave the board inert');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n11. The keyboard cannot get out of the dialog, in either direction');
  {
    const { ctx, page } = await fresh(browser);
    const inside = () => page.evaluate(() =>
      document.querySelector('#firstrun').contains(document.activeElement));
    const where = () => page.evaluate(() => (document.activeElement
      && (document.activeElement.id || document.activeElement.tagName)) || 'none');

    /* ⚠️ `inert` IS TURNED OFF FIRST, or this whole section is vacuous: Chromium
       implements `inert`, which alone keeps Tab inside, so the Tab-wrap + focusin
       backstop (the fallback FOR engines without inert) would be untested. Clearing
       inert reproduces that machine. */
    await page.evaluate(() => {
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; el.removeAttribute('inert'); });
    });
    ok(await page.evaluate(() => !document.querySelector('.apphead').inert),
      'inert really is off, so what follows measures the fallback and not the browser');

    ok(await inside(), 'focus starts inside the dialog (on ' + await where() + ')');

    let escaped = null;
    for (let i = 0; i < 25 && escaped === null; i += 1) {
      await page.keyboard.press('Tab');
      if (!(await inside())) escaped = 'forward at press ' + (i + 1) + ' onto ' + await where();
    }
    ok(escaped === null, escaped || 'Tab never leaves the dialog');

    escaped = null;
    for (let i = 0; i < 25 && escaped === null; i += 1) {
      await page.keyboard.press('Shift+Tab');
      if (!(await inside())) escaped = 'backward at press ' + (i + 1) + ' onto ' + await where();
    }
    ok(escaped === null, escaped || 'Shift+Tab never leaves the dialog');

    /* ⚠️ AND NOT A DEAD END: the focusin-only version pulled every escape back to
       the heading, so Shift+Tab could never REACH the action bar. Focus the active
       pane's own <h2> (the shell #fr-title is retired) and prove the primary is
       reachable backwards. */
    const seen = new Set();
    await page.evaluate(() => {
      const pane = [...document.querySelectorAll('.fr-pane')].find((p) => !p.hidden);
      const h2 = pane && pane.querySelector('h2');
      if (h2) h2.focus();
    });
    for (let i = 0; i < 8; i += 1) { await page.keyboard.press('Shift+Tab'); seen.add(await where()); }
    ok(seen.has('fr-next'), 'Shift+Tab reaches the primary button (saw: ' + [...seen].join(', ') + ')');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    ok(await page.isHidden('#firstrun'), 'Escape closes setup from anywhere in the trap');

    // Every step, because the button set changes between them. 1..N from the pane
    // count (not a literal), so "every step" means every step even after a
    // renumber. Gates mocked uncheckable so the gated steps are navigable/inert-safe.
    const lastStep = await paneCount(page);
    for (let step = 1; step <= lastStep; step += 1) {
      await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; el.removeAttribute('inert'); });
      });
      let out = null;
      for (let i = 0; i < 20 && out === null; i += 1) {
        await page.keyboard.press('Tab');
        if (!(await inside())) out = await where();
      }
      ok(out === null, `step ${step}: Tab stays inside` + (out ? ' (escaped onto ' + out + ')' : ''));
    }
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n12. The open-settings buttons actually POST (S2 Allow Access, S3 Turn On)');
  // The challenge review flagged that nothing clicked these open-settings buttons
  // end to end -- a labelled primary that silently did nothing on the S2 button was
  // exactly the class of defect that shipped once. This clicks each and asserts the
  // POST fires, and that a refusal is SPOKEN in the pane's own message line, not
  // swallowed. The endpoints are mocked so no real System Settings opens.
  {
    // #1: S2 "Allow Access" FIRES the native prompt (/api/file-access-prompt), and
    // only falls back to open-file-access-settings when the trigger is unavailable.
    const { ctx, page } = await fresh(browser);
    let promptPosts = 0; let settingsPosts = 0;
    await page.route('**/api/file-access-prompt', (r) => { promptPosts += 1; r.fulfill({ json: { ok: true } }); });
    await page.route('**/api/open-file-access-settings', (r) => { settingsPosts += 1; r.fulfill({ json: { ok: true } }); });
    await advanceToAnchor(page, '.s2-allow');
    await page.click('.s2-allow');
    await page.waitForTimeout(250);
    ok(promptPosts === 1, `#1: S2 "Allow Access" fires the native file-access-prompt (saw ${promptPosts})`);
    ok(settingsPosts === 0, `#1: a fired prompt does NOT also open Settings (saw ${settingsPosts} settings POSTs)`);
    // Trigger unavailable ({ok:false}) -> fall back to opening Settings.
    await page.unroute('**/api/file-access-prompt');
    await page.route('**/api/file-access-prompt', (r) => r.fulfill({ json: { ok: false, because: 'no native mechanism' } }));
    await page.click('.s2-allow');
    await page.waitForTimeout(250);
    ok(settingsPosts === 1, `#1: when the native trigger is unavailable, S2 falls back to open-file-access-settings (saw ${settingsPosts})`);
    // A fallback failure (409) must speak in the pane's own line, not fail silently.
    await page.unroute('**/api/open-file-access-settings');
    await page.route('**/api/open-file-access-settings', (r) => r.fulfill({ status: 409, json: { error: 'we could not open System Settings' } }));
    await page.click('.s2-allow');
    await page.waitForFunction(
      () => /could not open/i.test((document.getElementById('fr-s2-msg') || {}).textContent || ''),
      null, { timeout: 3000 }).catch(() => {});
    ok(/could not open/i.test(await page.locator('#fr-s2-msg').textContent()),
      'a refused S2 fallback is spoken in #fr-s2-msg, not swallowed');
    await ctx.close();
  }
  {
    // #1: S3 tmux "Turn On" FIRES the native a11y prompt (/api/a11y-prompt); the
    // sleep row is programmatic and opens Energy settings (no trigger).
    // The two S3 gates must be mocked CHECKABLE-not-granted, not the walk-through's
    // uncheckable default: since #2085 an uncheckable gate row is `data-checking`,
    // which hides .s3-req (the "Turn On" button) behind a "Checking..." state, so a
    // click on .s3-on can never become visible. "Turn On" is only shown to a real
    // user when the gate is checkable and not granted, which is exactly what this
    // section clicks. The S2 file-access gate is mocked granted so the walk can
    // advance past it to reach the S3 anchor.
    const { ctx, page } = await fresh(browser, { gates: false });
    await page.route('**/api/file-access-status', (r) => r.fulfill({ json: { checkable: true, granted: true } }));
    await page.route('**/api/sleep-status', (r) => r.fulfill({ json: { checkable: true, prevented: false } }));
    await page.route('**/api/a11y-status', (r) => r.fulfill({ json: { checkable: true, trusted: false } }));
    let sleepPosts = 0; let a11yPromptPosts = 0; let a11ySettingsPosts = 0;
    await page.route('**/api/open-sleep-settings', (r) => { sleepPosts += 1; r.fulfill({ json: { ok: true } }); });
    await page.route('**/api/a11y-prompt', (r) => { a11yPromptPosts += 1; r.fulfill({ json: { ok: true } }); });
    await page.route('**/api/open-accessibility-settings', (r) => { a11ySettingsPosts += 1; r.fulfill({ json: { ok: true } }); });
    await advanceToAnchor(page, '.s3-gate-row');
    await page.click('[data-gate="sleep"] .s3-on');
    await page.waitForTimeout(150);
    await page.click('[data-gate="tmux"] .s3-on');
    await page.waitForTimeout(250);
    ok(sleepPosts === 1, `S3 sleep "Turn On" POSTs open-sleep-settings (no prompt; saw ${sleepPosts})`);
    ok(a11yPromptPosts === 1, `#1: S3 tmux "Turn On" fires the native a11y-prompt (saw ${a11yPromptPosts})`);
    ok(a11ySettingsPosts === 0, `#1: a fired a11y prompt does NOT also open Settings (saw ${a11ySettingsPosts})`);
    // A 409 on the tmux FALLBACK (native trigger unavailable) must SPEAK in
    // #fr-s3-msg, the same not-swallowed contract S2 has.
    await page.unroute('**/api/a11y-prompt');
    await page.route('**/api/a11y-prompt', (r) => r.fulfill({ json: { ok: false, because: 'no native mechanism' } }));
    await page.unroute('**/api/open-accessibility-settings');
    await page.route('**/api/open-accessibility-settings', (r) => r.fulfill({ status: 409, json: { error: 'we could not open System Settings' } }));
    await page.click('[data-gate="tmux"] .s3-on');
    await page.waitForFunction(
      () => /could not open/i.test((document.getElementById('fr-s3-msg') || {}).textContent || ''),
      null, { timeout: 3000 }).catch(() => {});
    ok(/could not open/i.test(await page.locator('#fr-s3-msg').textContent()),
      'a refused S3 "Turn On" is spoken in #fr-s3-msg, not swallowed');
    await ctx.close();
  }

  } catch (e) {
    // Named as a THROW, not folded into an ordinary ok(): a section that died
    // tells you nothing about the assertions it never reached, and a reader must
    // be able to tell "this went red" from "this stopped".
    fails.push('THREW, so everything after it was never asked: ' + ((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
  }
  console.log('\n' + (fails.length ? `${fails.length} FAILURES:\n  ` + fails.join('\n  ') : 'all clear'));
  process.exit(fails.length ? 1 : 0);
})();
