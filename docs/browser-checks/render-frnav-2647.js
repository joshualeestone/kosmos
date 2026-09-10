'use strict';

/**
 * kosmos#2647: the first-run energy/accessibility screen's Check-again control
 * lives in the BOTTOM NAV (far left, beside Next), with its copy next to it.
 *
 * 🛑 WHY A BROWSER CHECK. Josh's report was that he "could not see the helper
 * copy at all before finishing the connection". The defect and the fix are both
 * about WHERE a control is on screen, which no unit test can see: the old
 * version rendered perfectly and was simply below the fold.
 *
 * 🛑 AND THE LOAD-BEARING ARM IS THE PRESS, not the placement. The obvious
 * implementation of this card is a DEAD BUTTON that looks completely correct:
 * the existing Check-again handler is delegated on `#fr-pane-3`, and `#fr-alt`
 * lives in `.fr-acts`, OUTSIDE every pane, so wiring the move by moving the
 * class would render a button that is styled, focusable, and silently does
 * nothing. Placement arms would all pass. Only pressing it can tell.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-frnav-2647.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-frnav-2647: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const TOP_COPY = 'To get the most out of your agents we need to ensure they can stay awake and access the computer.';
const HINT = 'Turned it on? Tap to check.';

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-frnav-2647: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'blocked' }),
  }));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async (K) => {
    const out = {};
    /* Keyed on IDENTITY, not index: this file's own lib-firstrun-steps explains
       why (a step inserted ahead of this one silently broke nine assertions
       across four checks). `#fr-s3-msg` is this screen's own status line. */
    const anchor = document.getElementById('fr-s3-msg');
    if (!anchor) return { error: '#fr-s3-msg is gone; re-anchor this check' };
    const pane = anchor.closest('.fr-pane');
    const step = Number(/^fr-pane-(\d+)$/.exec(pane.id)[1]);
    out.step = step;

    /* 🛑 UNHIDE THE OVERLAY BEFORE MEASURING ANYTHING GEOMETRIC. `#firstrun` is
       `display: none` until the wizard is opened for real, and every rect inside
       a display:none subtree is 0x0 at 0,0. A "far left" arm computed from those
       compares zeros to zeros and PASSES on any layout at all, which is the
       worst kind of green. Measured: without this, every rect read 0.
       Same reason the sibling first-run checks unhide the pane they read. */
    const overlay = document.getElementById('firstrun');
    if (!overlay) return { error: '#firstrun is gone; re-anchor this check' };
    overlay.hidden = false;
    frGo(step);
    await new Promise((r2) => setTimeout(r2, 120));
    if (document.getElementById('fr-alt').getBoundingClientRect().width === 0) {
      return { error: 'the nav has no layout (width 0), so every geometric arm below would compare zeros and pass on anything' };
    }

    /* `h2 + p`, NOT the first <p>: the pane opens with a `.fc-eyebrow`
       paragraph ("Automation"), so `querySelector('p')` returns the eyebrow and
       the copy assertion compares Josh's sentence against one word. */
    out.topCopy = ((pane.querySelector('h2 + p')) || {}).textContent || '';

    /* The old in-pane block must be GONE, not merely hidden: "moved" means one
       control, and a second (invisible) one is the thing he complained about. */
    out.oldNote = !!pane.querySelector('.s3-recheck-note');
    out.oldRow = !!pane.querySelector('.s3-recheck-row');
    out.oldBtn = !!pane.querySelector('.fr-recheck, .s3-recheck');

    const alt = document.getElementById('fr-alt');
    const hint = document.getElementById('fr-alt-hint');
    const next = document.getElementById('fr-next');
    out.altLabel = alt ? (alt.textContent || '').trim() : null;
    out.altHidden = alt ? alt.hidden : null;
    out.hintText = hint ? (hint.textContent || '').trim() : null;
    out.hintHidden = hint ? hint.hidden : null;

    /* In the NAV, not in a pane. This is the whole point of the card. */
    out.altInNav = !!(alt && alt.closest('.fr-acts'));
    out.altInAPane = !!(alt && alt.closest('.fr-pane'));
    out.hintInNav = !!(hint && hint.closest('.fr-acts'));

    /* FAR LEFT, measured geometrically rather than assumed from source order. */
    const ar = alt.getBoundingClientRect();
    const nr = next.getBoundingClientRect();
    const hr = hint.getBoundingClientRect();
    out.altLeftOfNext = ar.right <= nr.left;
    /* 🛑 A REAL ADJACENCY, NOT "somewhere between the two buttons". The first
       version was `hr.left >= ar.right - 1 && hr.left < nr.left`, which admits
       any position in the ~350px between them: moving this span after
       `.fr-spacer` (the exact "wedged toward Next, reads as a caption for the
       wrong button" failure) drifts it 100px off its own button and that arm
       still passed. The flex `gap` is 14px at every width measured, so 24 is a
       real bound rather than a restatement of the layout. */
    out.hintGap = Math.round(hr.left - ar.right);
    out.hintBesideAlt = out.hintGap >= -1 && out.hintGap < 24;
    out.sameRowAsNext = Math.abs((ar.top + ar.height / 2) - (nr.top + nr.height / 2)) < 40;

    /* 🛑 THE PRESS. Spying on frRecheckGates rather than counting network calls,
       because a 750ms background poll also calls the API and would make a dead
       button look alive. The spy answers exactly one question: did pressing this
       control run the re-check? */
    let fired = 0;
    const real = window.frRecheckGates;
    window.frRecheckGates = function spy() { fired += 1; return Promise.resolve(); };
    alt.click();
    await new Promise((r2) => setTimeout(r2, 60));
    window.frRecheckGates = real;
    out.pressFiredRecheck = fired > 0;

    /* 🛑 AND IT MUST STILL BE PRESSABLE AFTERWARDS. The control's whole purpose
       is "flip the switch, press again", so a ONE-SHOT button that disables
       itself and never comes back is the realistic regression here, and the
       press arm above cannot see it: it only asks whether the first press did
       anything. Measured against a mutant that drops the re-enable from
       frRecheckPress's finally: baseline re-enables, mutant stays disabled
       forever, and without this arm the check passed on BOTH. */
    await new Promise((r2) => setTimeout(r2, 250));
    out.altReenabled = !alt.disabled;

    /* The hint must be tied to the button programmatically, not merely adjacent:
       the move cost this control the proximity that used to do the explaining. */
    out.altDescribedBy = alt.getAttribute('aria-describedby');

    /* NEGATIVE ARM: a screen that passes no hint must not inherit this one's.
       `.fr-acts` is shared by nine screens, so a sentence left on reappears
       under a different screen's buttons describing an action that is not there. */
    frGo(1);
    await new Promise((r2) => setTimeout(r2, 60));
    out.hintOnOtherScreen = !!(hint && !hint.hidden && (hint.textContent || '').trim());
    /* and the tie must go with it, or the button on a hintless screen points at
       an empty hidden span belonging to a different screen's action. */
    out.staleDescribedBy = document.getElementById('fr-alt').getAttribute('aria-describedby');
    return out;
  }, { TOP_COPY, HINT });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  else {
    if (r.topCopy.trim() !== TOP_COPY) {
      problems.push('the top copy is not Josh\'s exact wording.\n    want: ' + JSON.stringify(TOP_COPY)
        + '\n    got:  ' + JSON.stringify(r.topCopy.trim()));
    }
    if (r.oldNote) problems.push('the deleted line ("This can take a few seconds...") is still rendered');
    if (r.oldRow || r.oldBtn) {
      problems.push('the old in-pane Check-again is still there, so the control was COPIED rather than '
        + 'MOVED and the invisible one he complained about survives');
    }
    if (r.altHidden || r.altLabel !== 'Check again') {
      problems.push('the nav does not offer a "Check again" control on this screen (hidden='
        + r.altHidden + ', label=' + JSON.stringify(r.altLabel) + ')');
    }
    if (!r.altInNav || r.altInAPane) {
      problems.push('the Check-again control is not in the bottom nav (inNav=' + r.altInNav
        + ', inAPane=' + r.altInAPane + ')');
    }
    if (r.hintHidden || r.hintText !== HINT) {
      problems.push('the hint copy is wrong or hidden.\n    want: ' + JSON.stringify(HINT)
        + '\n    got:  ' + JSON.stringify(r.hintText) + ' (hidden=' + r.hintHidden + ')');
    }
    if (!r.hintInNav) problems.push('the hint copy is not in the bottom nav beside its control');
    if (!r.altLeftOfNext) problems.push('the Check-again control is not left of Next, so it is not "far left"');
    if (!r.sameRowAsNext) problems.push('the Check-again control is not on the same row as Next');
    if (!r.hintBesideAlt) {
      problems.push('the hint is not sitting beside its own control (gap ' + r.hintGap
        + 'px; expected under 24). It has drifted toward Next, where it reads as a caption for the '
        + 'wrong button');
    }
    if (!r.pressFiredRecheck) {
      problems.push('PRESSING the nav Check-again did not run a re-check: the control renders, styles '
        + 'and focuses correctly and does nothing, which is worse than not moving it. The old handler '
        + 'is delegated on #fr-pane-3 and this button is outside every pane');
    }
    if (r.altReenabled === false) {
      problems.push('the Check-again control stayed disabled after one press, so "flip the switch and '
        + 'press again" works exactly once');
    }
    if (r.altDescribedBy !== 'fr-alt-hint') {
      problems.push('the Check-again control is not tied to its hint (aria-describedby='
        + JSON.stringify(r.altDescribedBy) + '), so a screen-reader user reaching it in the shared '
        + 'footer hears only "Check again" with nothing saying check what');
    }
    if (r.hintOnOtherScreen) {
      problems.push('the hint survived onto another screen, describing a control that is not there');
    }
    if (r.staleDescribedBy) {
      problems.push('aria-describedby survived onto a screen with no hint (' + r.staleDescribedBy
        + '), pointing the button at an empty hidden span from a different screen');
    }
  }

  if (problems.length) {
    console.error('render-frnav-2647: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-frnav-2647: the Check-again control and its copy sit in the bottom nav on the far '
    + 'left beside Next, a press actually re-checks, the old in-pane block is gone, the copy is Josh\'s '
    + 'exact wording, and the hint does not leak to other screens.');
})().catch((err) => { console.error('FAIL  render-frnav-2647 threw: ' + err.message); process.exit(1); });
