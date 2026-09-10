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
    window.fetch = (u, opts) => (String(u).indexOf('/api/removed') !== -1
      ? Promise.resolve({ ok: true, json: async () => ({ agents }) })
      : realFetch(u, opts));
    if (typeof paintRemoved !== 'function') return { error: 'paintRemoved is not a function' };
    await paintRemoved();
    const read = (n) => {
      const b = document.querySelector('#removed-list [data-restore="' + n + '"]');
      if (!b) return null;
      return {
        disabled: b.disabled === true,
        title: b.getAttribute('title') || '',
        label: b.getAttribute('aria-label') || '',
        text: (b.textContent || '').trim(),
      };
    };
    return { gone: read('gone-acct'), fine: read('fine-acct') };
  }, AGENTS);

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);

  if (!r.gone) problems.push('the blocked row rendered no Restore control at all, so this check asserts nothing');
  if (!r.fine) problems.push('the normal row rendered no Restore control at all, so the negative arm asserts nothing');

  if (r.gone && r.fine) {
    // The positive arm: blocked means DISABLED, not merely styled.
    if (!r.gone.disabled) {
      problems.push('the Restore control for a gone account folder is NOT disabled, so the person '
        + 'clicks a live button and is refused by the engine afterwards, which is the whole defect');
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
    if (r.fine.disabled) {
      problems.push('the Restore control for a row whose account folder is PRESENT is disabled too, '
        + 'so the fix disables a control the engine would have allowed');
    }
    if (r.fine.label && /account folder/i.test(r.fine.label)) {
      problems.push('a row whose account folder is present carries the blocked explanation: '
        + JSON.stringify(r.fine.label));
    }
  }

  console.log('  gone: ' + JSON.stringify(r.gone));
  console.log('  fine: ' + JSON.stringify(r.fine));
  if (problems.length) {
    console.error(`render-restore-dircheck-2615: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-restore-dircheck-2615: a gone account folder renders a DISABLED Restore that says why and what fixes it, while a present one stays live.');
})();
