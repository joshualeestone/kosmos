'use strict';

/**
 * kosmos#2615: the removed-list Restore control is DISABLED when the account
 * folder the agent ran on is gone.
 *
 * 🛑 WHY A BROWSER CHECK AND NOT ONLY server.test.js. The suite proves the API
 * ships `accountFolderGone` and that it agrees with the predicate `restore()`
 * refuses on. It cannot prove `paintRemoved` actually RENDERS that field into a
 * disabled control: the whole card is the difference between the engine knowing
 * and the person seeing, so a green payload with a live button is precisely the
 * state this card exists to end. This drives the real `paintRemoved()` against a
 * stubbed /api/removed (no board) and reads the rendered buttons.
 *
 * ⚠️ THE NEGATIVE ARM IS NOT OPTIONAL. A check that only asserts "the blocked
 * row is disabled" passes just as happily on a page that disables EVERY Restore,
 * which would be a worse regression than the one this fixes: a control greyed
 * out where the engine would have said yes looks like a decision rather than a
 * bug, so nobody reports it. Both rows are seeded from one payload.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-restore-dircheck-2615.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine
 * with no console session; the verdicts are the same (computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-restore-dircheck-2615: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

// One blocked row and one normal row, so the negative arm has something to say.
const AGENTS = [
  { name: 'gone-acct', shownAs: 'Gone Account', removedAt: '2026-09-10T00:00:00Z', stopped: true, accountFolderGone: true },
  { name: 'fine-acct', shownAs: 'Fine Account', removedAt: '2026-09-10T00:00:00Z', stopped: true, accountFolderGone: false },
];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-restore-dircheck-2615: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async (agents) => {
    const realFetch = window.fetch;
    /* `/restore` is stubbed too, and only so the REVERSE arm at the bottom can
       reach the success path that writes "Starting X again". Without it the
       live press falls through to a file:// fetch, fails, and takes the
       "Restore failed" branch, so the sentence that arm is about never exists
       and it would pass while measuring nothing. */
    window.fetch = (u, opts) => {
      const url = String(u);
      if (url.indexOf('/api/removed') !== -1) return Promise.resolve({ ok: true, json: async () => ({ agents }) });
      if (url.indexOf('/restore') !== -1) return Promise.resolve({ ok: true, json: async () => ({ outcome: 'restored' }) });
      return realFetch(u, opts);
    };
    if (typeof paintRemoved !== 'function') return { error: 'paintRemoved is not a function' };
    await paintRemoved();
    /* 🛑 EXPAND THE LIST, BECAUSE EVERY ARM BELOW WAS RUNNING AGAINST
       `display: none`. `#removed-list` ships `hidden` and opens on the "show
       removed" toggle, and this check never pressed it. Measured on the old
       version: listHidden true, btnVisible false, and `b.focus()` left
       activeElement on BODY. The arms still passed, because attribute reads and
       programmatic `.click()` both work perfectly on an invisible element.
       ⇒ The check was asserting things about a page state no person ever sees.
       Nothing here is trustworthy until this control is actually on screen. */
    const toggle = document.getElementById('removed-toggle');
    if (toggle) toggle.click();
    await new Promise((r) => setTimeout(r, 30));
    if (document.getElementById('removed-list').hidden) {
      return { error: 'the removed list is still hidden after pressing the toggle, so every arm below would run against display:none' };
    }
    /* Found by SHOWN NAME, not by the acting attribute: a blocked row
       deliberately carries no `data-restore` (that absence is what stops the
       click), so selecting on it would make the blocked row invisible to this
       check and every assertion about it vacuous.
       ⚠️ SCOPED TO THE RESTORE CONTROLS EXPLICITLY. The "Delete its files..."
       button in the same row carries the SAME `data-shown-as`, so a bare
       `.acts button` search picked whichever renders first and this check was
       silently depending on Restore preceding Delete in the markup. It does
       today; nothing pins it. Selecting on the union of the two Restore
       attributes removes the dependency rather than relying on it. */
    const read = (shown) => {
      const b = [...document.querySelectorAll('#removed-list [data-restore], #removed-list [data-restore-blocked]')]
        .find((x) => (x.dataset.shownAs || '') === shown);
      if (!b) return null;
      /* 🛑 COMPUTED STYLE, NOT JUST SEMANTICS. Everything else this check reads
         is an attribute, and a card titled "grey out the control" shipped
         greying nothing out while every attribute arm passed: `disabled` had
         been doing two jobs (semantics AND the `.btn:disabled` dimming) and the
         move to `aria-disabled` kept the first and silently dropped the second.
         An attribute assertion cannot see that. This one can. */
      const cs = getComputedStyle(b);
      return {
        opacity: cs.opacity,
        cursor: cs.cursor,
        ariaDisabled: b.getAttribute('aria-disabled') === 'true',
        hardDisabled: b.disabled === true,
        acting: b.hasAttribute('data-restore'),
        blockedAttr: b.hasAttribute('data-restore-blocked'),
        /* 🛑 MEASURED, NOT DEFINED. This field read `!b.disabled`, which is a
           different proposition wearing this one's name: an element inside a
           collapsed container is not focusable however un-disabled it is, and
           that is exactly the state this check used to run in. The name is what
           a reviewer checks against the requirement, so nobody checked the name
           against the expression. Three iterations went past it. */
        focusable: (() => { b.focus(); return document.activeElement === b; })(),
        onScreen: b.offsetParent !== null,
        title: b.getAttribute('title') || '',
        label: b.getAttribute('aria-label') || '',
        text: (b.textContent || '').trim(),
      };
    };
    const out = { gone: read('Gone Account'), fine: read('Fine Account') };
    /* A press on the unavailable control must SAY WHY. Reaching a focusable
       control that does nothing is the failure `aria-disabled` invites, so this
       drives the real click and reads the live region. */
    const blockedBtn = document.querySelector('#removed-list [data-restore-blocked]');
    if (blockedBtn) {
      blockedBtn.click();
      await new Promise((r) => setTimeout(r, 20));
      const msgEl = document.getElementById('removed-msg');
      out.spoken = msgEl ? (msgEl.textContent || '').trim() : null;
      out.liveRegion = msgEl ? msgEl.getAttribute('aria-live') : null;

      /* 🛑 THE OTHER DIRECTION OF THE SAME SEAM, and it was unpinned: pressing a
         LIVE Restore must NOT fire the explain handler. There are now THREE
         click listeners delegated on `#removed-list` (restore, explain,
         delete-leftover) and they select on different attributes; a widened
         selector on any one of them would make a working control announce that
         it is unavailable. Nothing asserted that until now.
         📌 The delete-leftover control is pressed too, because it sits in the
         same row and carries the same `data-shown-as`, so it is the likeliest
         thing a widened selector would catch. */
      msgEl.textContent = '';
      /* 🛑 CLEAR THE HELD EXPLANATION FIRST, OR THIS ARM CANNOT TELL THE TWO
         CASES APART. A live press now legitimately RE-ASSERTS a standing
         blocked explanation (that is the reverse-direction fix below), and that
         text contains "account folder" too. Without this reset the arm reads a
         correct re-assertion as a cross-fire and reds on working code.
         ⭐ Found by this arm going red the moment the reverse fix landed: the
         discriminator was only ever valid while nothing else could put that
         phrase on screen. */
      RESTORE_BLOCKED_SAID = null;
      const liveBtn = document.querySelector('#removed-list [data-restore]');
      if (liveBtn) { liveBtn.click(); await new Promise((r2) => setTimeout(r2, 20)); }
      out.liveFiredExplain = /account folder/i.test(msgEl.textContent || '');
      msgEl.textContent = '';
      const delBtn = document.querySelector('#removed-list [data-delete-leftover]');
      if (delBtn) { delBtn.click(); await new Promise((r2) => setTimeout(r2, 20)); }
      out.deleteFiredExplain = /account folder/i.test(msgEl.textContent || '');

      /* Now with a restore already in flight. */
      out.bothSpoken = null;
      if (typeof RESTORE_WAITING_SENTENCE !== 'undefined' && msgEl) {
        RESTORE_WAITING_SENTENCE = 'Starting Other Agent again. It takes a few seconds.';
        msgEl.textContent = RESTORE_WAITING_SENTENCE;
        blockedBtn.click();
        await new Promise((r2) => setTimeout(r2, 20));
        out.afterBoth = (msgEl.textContent || '').trim();
        out.bothSpoken = /Other Agent/.test(out.afterBoth) && /account folder/i.test(out.afterBoth);
        RESTORE_WAITING_SENTENCE = null;
      }

      /* 🛑 THE REVERSE ORDER, WHICH WAS A REAL BUG AND IS THE POINT OF THIS ARM.
         The arm above proves the EXPLAIN press does not destroy an in-flight
         restore. Nothing proved the opposite: press an unavailable Restore on
         one row, read why, then press a WORKING Restore on another, and the
         explanation was silently erased.
         ⭐ A fix written in one direction reads as finished, which is why the
         asymmetry survived the iteration that created it. */
      if (typeof RESTORE_BLOCKED_SAID !== 'undefined') {
        RESTORE_WAITING_SENTENCE = null;
        RESTORE_BLOCKED_SAID = null;
        RESTORE_WAITING = null;
        msgEl.textContent = '';
        /* 🛑 FORCE A REPAINT FIRST. An arm above already pressed the live
           Restore, and that handler sets `btn.disabled = true` on the node. The
           generated markup is unchanged, so `paintRemoved`'s change-guard
           (`html !== REMOVED_HTML`) SKIPS the rewrite and the disabled node
           survives. Pressing it again does nothing, and this arm would then
           "pass" by measuring a button that never fired.
           ⇒ Clearing the cache is what makes the next press real. */
        REMOVED_HTML = null;
        await paintRemoved();
        const blockedBtn2 = document.querySelector('#removed-list [data-restore-blocked]');
        blockedBtn2.click();                      // 1. read why row A cannot restore
        await new Promise((r2) => setTimeout(r2, 20));
        const explained = (msgEl.textContent || '').trim();
        const liveBtn2 = document.querySelector('#removed-list [data-restore]:not([disabled])');
        if (liveBtn2) { liveBtn2.click(); await new Promise((r2) => setTimeout(r2, 150)); }
        out.afterReverse = (msgEl.textContent || '').trim();
        out.reverseKept = explained.length > 0
          && /account folder/i.test(out.afterReverse)   // A's explanation survived
          && /Starting/.test(out.afterReverse);         // and B's status is there too
      }
    }
    return out;
  }, AGENTS);

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);

  if (!r.gone) problems.push('the blocked row rendered no Restore control at all, so this check asserts nothing');
  if (!r.fine) problems.push('the normal row rendered no Restore control at all, so the negative arm asserts nothing');

  if (r.gone && r.fine) {
    // The positive arm: blocked means UNAVAILABLE, not merely styled.
    if (!r.gone.ariaDisabled) {
      problems.push('the Restore control for a gone account folder is not aria-disabled, so the person '
        + 'clicks a live button and is refused by the engine afterwards, which is the whole defect');
    }
    /* 🛑 THE LOAD-BEARING HALF: aria-disabled is ADVISORY. What actually stops
       the restore is the absence of `data-restore`, which is what the click
       handler selects. A row that is aria-disabled AND still carries
       `data-restore` looks correct and restores anyway. */
    if (r.gone.acting) {
      problems.push('the unavailable Restore still carries data-restore, so the click handler will '
        + 'select it and restore anyway: aria-disabled alone is advisory');
    }
    /* And it must stay FOCUSABLE, or the explanation is out of reach of exactly
       the keyboard users it was written for (the repo names a non-focusable
       control a WCAG AA failure). */
    if (r.gone.hardDisabled || !r.gone.focusable) {
      problems.push('the unavailable Restore uses hard `disabled`, so it leaves the tab order and a '
        + 'keyboard user never lands on it or hears why: WCAG AA failure, and a title on a disabled '
        + 'control is not announced at all');
    }
    /* 🛑 IT MUST ACTUALLY LOOK UNAVAILABLE. This is the card's own title and it
       was the one thing nothing asserted: the first version of this check
       passed clean while a getComputedStyle read found the blocked and live
       buttons IDENTICAL on opacity, cursor, background, colour and border, so a
       sighted mouse user still clicked a normal-looking button and learned why
       afterwards, which is the exact defect the card exists to end.
       ⚠️ Asserted as "dimmed at all" rather than a specific number, so a future
       contrast adjustment does not red this for no reason. The VALUE is argued
       at the CSS rule (`.8` keeps AA because this control is focusable and
       therefore not exempt; `.5` would fail it). */
    if (!(parseFloat(r.gone.opacity) < 1)) {
      problems.push('the unavailable Restore renders at full opacity (' + r.gone.opacity
        + '), so it looks exactly like a live button and the card greys nothing out');
    }
    if (r.gone.cursor !== 'not-allowed') {
      problems.push('the unavailable Restore does not show a not-allowed cursor (got '
        + JSON.stringify(r.gone.cursor) + '), so the only pre-click signal is missing');
    }
    /* 🛑 THE NEGATIVE ARM, and it is load-bearing for the same reason as the
       others: dimming EVERY Restore would satisfy both assertions above and be
       a worse regression than the one this fixes. */
    if (parseFloat(r.fine.opacity) < 1 || r.fine.cursor === 'not-allowed') {
      problems.push('a row whose account folder is PRESENT is dimmed or shows not-allowed (opacity '
        + r.fine.opacity + ', cursor ' + JSON.stringify(r.fine.cursor)
        + '), so a working Restore looks unavailable');
    }
    /* A press must SAY WHY. A focusable control that does nothing is the
       "pressable but silent" failure aria-disabled invites. */
    if (!r.spoken || !/account folder/i.test(r.spoken)) {
      problems.push('pressing the unavailable Restore said nothing useful: ' + JSON.stringify(r.spoken)
        + ' -- a focusable control that does nothing is worse than one that cannot be reached');
    }
    if (!r.gone.onScreen) {
      problems.push('the unavailable Restore is not actually on screen, so every arm about it is '
        + 'describing a page state nobody sees');
    }
    if (r.reverseKept === false) {
      problems.push('starting a live restore destroyed a blocked row\'s standing explanation: '
        + JSON.stringify(r.afterReverse) + ' -- both sentences are true at once, so both must be said, '
        + 'the same way the explain handler already re-asserts an in-flight restore');
    }
    /* 🛑 THE EXPLANATION MUST NOT DESTROY AN IN-FLIGHT RESTORE'S STATUS. This
       region is shared with the "Starting X again" sentence, which is written
       once and cleared only by the arrival it predicts, so a bare overwrite
       loses it permanently. Seeded here by writing the region and setting the
       page's own variable, then pressing the unavailable control. */
    if (r.bothSpoken !== null && !r.bothSpoken) {
      problems.push('pressing the unavailable Restore wiped an in-flight restore status: '
        + JSON.stringify(r.afterBoth) + ' -- the other agent is still coming up with nothing saying so');
    }
    if (r.liveFiredExplain) {
      problems.push('pressing the LIVE Restore announced the unavailable explanation, so a working '
        + 'control tells the person it cannot be used');
    }
    if (r.deleteFiredExplain) {
      problems.push('pressing "Delete its files" announced the Restore-unavailable explanation, so '
        + 'the explain listener selects more than the control it was written for');
    }
    if (r.liveRegion !== 'assertive') {
      problems.push('the message region is not aria-live=assertive (' + JSON.stringify(r.liveRegion)
        + '), so the reason is drawn but not announced');
    }
    // ...and it must SAY WHY, on the surface a screen reader reaches.
    if (!/account folder/i.test(r.gone.label)) {
      problems.push('the disabled Restore has no reason in its accessible name: '
        + JSON.stringify(r.gone.label) + ' -- a greyed control that does not say why is a dead end');
    }
    if (!/add that account back/i.test(r.gone.label)) {
      problems.push('the disabled Restore does not say what makes it work again: '
        + JSON.stringify(r.gone.label) + ' -- the engine refusal says so and the pre-click state must agree');
    }
    if (!/account folder/i.test(r.gone.title)) {
      problems.push('the disabled Restore has no tooltip reason: ' + JSON.stringify(r.gone.title));
    }
    /* 🛑 THE CONTROL, and the reason this check is worth more than the positive
       arm alone: a page that disabled EVERY Restore would satisfy everything
       above. */
    if (r.fine.ariaDisabled || r.fine.hardDisabled) {
      problems.push('the Restore control for a row whose account folder is PRESENT is disabled too, '
        + 'so the fix disables a control the engine would have allowed');
    }
    if (r.fine.label && /account folder/i.test(r.fine.label)) {
      problems.push('a row whose account folder is present carries the blocked explanation: '
        + JSON.stringify(r.fine.label));
    }
    /* The TOOLTIP too, not only the accessible name. The first version of this
       check read `title` and never asserted it, so a page putting the blocked
       tooltip on every row passed: a live Restore whose hover says the folder is
       gone. Reading a field without asserting it is coverage that is not there. */
    if (r.fine.title) {
      problems.push('a row whose account folder is present carries a tooltip: '
        + JSON.stringify(r.fine.title) + ' -- a live Restore must not hover-claim it is unavailable');
    }
    if (!r.fine.acting) {
      problems.push('the live Restore lost its data-restore attribute, so pressing it does nothing');
    }
  }

  console.log('  gone: ' + JSON.stringify(r.gone));
  console.log('  fine: ' + JSON.stringify(r.fine));
  if (problems.length) {
    console.error(`render-restore-dircheck-2615: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-restore-dircheck-2615: a gone account folder renders an UNAVAILABLE Restore that stays focusable, cannot act, and says why and what fixes it on press, while a present one stays live.');
})().catch((err) => {
  /* Without this a rejection inside the IIFE (paintRemoved throwing, say) exits
     on an unhandled rejection with NO quotable FAIL line, so the runner's
     reason-grep gate has nothing to report and the browser is never closed. */
  console.error('FAIL  render-restore-dircheck-2615: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
