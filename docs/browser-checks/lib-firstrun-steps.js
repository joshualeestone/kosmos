'use strict';

/**
 * First-run step discovery for the browser checks.
 *
 * The first-run wizard numbers its steps -- fr-pane-N, and the deep link
 * ?fr-step=N. #1214 inserted Accessibility as step 5, which moved every later
 * step up one and silently broke nine assertions across four checks that had
 * NAMED a step number (kosmos#1801, #1751). Re-pinning the numbers fixes the
 * instance and re-arms the trap for the next insertion.
 *
 * The fix this file exists for: key on IDENTITY, not index. Every pane is in the
 * DOM from first paint (hidden until its step is shown), so a check can DISCOVER
 * the step that holds a given content anchor -- #fr-fleet for "Your agents",
 * #fr-you for "About you" -- instead of hard-coding its position. When the next
 * step is inserted, discovery follows the pane; a hard-coded number does not.
 */

/**
 * The step number of the pane that contains `anchorSel`.
 *
 *   stepForAnchor(page, '#fr-fleet')  ->  7   (the "Your agents" ending)
 *   stepForAnchor(page, '#fr-you')    ->  6   (the "About you" step)
 *
 * Reads the DOM as loaded -- every pane is present (hidden) from first paint, so
 * the page does not need to have navigated to that step first. Throws, rather
 * than returning a wrong number, if the anchor or its `#fr-pane-N` ancestor is
 * not found: a discovery that cannot find its pane must fail loud, not fall back
 * to an index and reintroduce the very bug this replaces.
 */
async function stepForAnchor(page, anchorSel) {
  const step = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { err: 'anchor not in the DOM' };
    const pane = el.closest('.fr-pane');
    if (!pane) return { err: 'anchor has no .fr-pane ancestor' };
    const m = /^fr-pane-(\d+)$/.exec(pane.id || '');
    if (!m) return { err: `pane id is "${pane.id}", not fr-pane-N` };
    return { step: Number(m[1]) };
  }, anchorSel);
  if (!step || !Number.isInteger(step.step)) {
    throw new Error(`could not discover the first-run step for ${anchorSel}: `
      + `${(step && step.err) || 'unknown'}. the anchor or the pane markup changed `
      + `(see kosmos#1801).`);
  }
  return step.step;
}

/**
 * The wizard's total step count, read from the STATIC panes in the DOM
 * (the fr-pane-N divs shipped in index.html). This is deliberately a DIFFERENT
 * source from the crumb ("Step N of M") and the progress segments, which frGo()
 * builds dynamically from the app's own FR_STEPS constant -- so a check can
 * assert the dynamic count against this static one and catch a build where the
 * two disagree, instead of pinning a literal that goes stale on the next
 * insertion.
 */
async function paneCount(page) {
  return page.$$eval('.fr-pane', (panes) => panes.length);
}

/**
 * Navigate `page` to the step that holds `anchorSel`, discovering its number.
 *
 * Loads the flow once so the panes exist, reads the step off the anchor's pane,
 * then deep-links to it -- exercising the same ?fr-step= path the checks were
 * built on, but with a number that follows the pane rather than naming it.
 * `extraParams` is any additional query string already joined (no leading &).
 * Returns the discovered step number so the caller can report what it landed on.
 */
async function gotoStepForAnchor(page, base, anchorSel, extraParams = '', opts = {}) {
  await page.goto(`${base}/?first-run=1`, { waitUntil: 'domcontentloaded' });
  const step = await stepForAnchor(page, anchorSel);
  const extra = extraParams ? `&${extraParams}` : '';
  await page.goto(`${base}/?first-run=1&fr-step=${step}${extra}`,
    { waitUntil: opts.waitUntil || 'networkidle' });
  return step;
}

module.exports = { stepForAnchor, paneCount, gotoStepForAnchor };
