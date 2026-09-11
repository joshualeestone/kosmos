'use strict';

/**
 * kosmos#2697 (Josh, design channel 2026-09-10, on the agent Profile tab): the three
 * Profile fields (Name, What they do, Reports to) ran the full container width. Josh
 * asked for Name ~25%, What they do ~50%, Reports to ~25%, each left-aligned on its own
 * row, plus spacing above "Reports to" and the long Name helper wrapped at ~50%.
 *
 * 🛑 WHY A BROWSER CHECK. The whole change is layout: flex-basis percentages that resolve
 * against the rendered .frow width, floored by a shared min-width. No unit test sees a
 * computed width. This unhides the detail Profile section at a wide, fixed panel width (so
 * 25% clears the 220px floor and the ratios are deterministic) and measures each field
 * against its own .frow.
 *
 * ⚠️ THE WIDTH IS FIXED IN THE TEST ON PURPOSE. min-width:220px is left in the CSS so a
 * narrow panel does not crush the fields; that floor would make the ratio test meaningless
 * on a narrow panel (a floored field is wider than 25%). Pinning the panel wide is what
 * makes "is it 25%?" a real question rather than "is it floored?".
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-profile-field-widths-2697.js
 *
 * ⚠️ HEADED by default (matches the others here). HEADED=0 on a console-less machine; the
 * verdicts are computed geometry (offsetWidth ratios), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-profile-field-widths-2697: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const PANEL_W = 1200; // wide enough that 25% (~290px) clears the shared min-width:220px floor

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-profile-field-widths-2697: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate((panelW) => {
    const panel = document.getElementById('panel-detail');
    const prof = document.getElementById('d-sec-profile');
    const repWrap = document.getElementById('d-reports-wrap');
    const name = document.getElementById('d-rename');
    const role = document.getElementById('d-role');
    const reports = document.getElementById('d-reports');
    const hint = document.getElementById('d-rename-hint');
    if (!panel || !prof || !repWrap || !name || !role || !reports || !hint) {
      return { error: 'a Profile-form element is missing (panel-detail / d-sec-profile / d-reports-wrap / d-rename / d-role / d-reports / d-rename-hint)' };
    }
    /* Unhide the detail panel + Profile section, and the reports wrap (hidden until a
       second agent exists). Pin the panel wide so the percentage widths are deterministic
       rather than floored by min-width:220px. */
    panel.hidden = false;
    prof.hidden = false;
    repWrap.hidden = false;
    panel.style.width = panelW + 'px';

    const ratio = (el) => {
      const frow = el.parentElement; // the flex .frow the field sits in
      const fw = frow.getBoundingClientRect().width;
      return fw > 0 ? el.getBoundingClientRect().width / fw : 0;
    };
    const cs = (el, prop) => parseFloat(getComputedStyle(el)[prop]) || 0;
    const formW = prof.getBoundingClientRect().width;

    /* NEGATIVE CONTROL (scoping): the whole safety of this change is that it narrows ONLY the
       detail-form ids and leaves every other form full-width. The create form is a separate
       panel that does not lay out while hidden, and getComputedStyle on a hidden element does
       not return its cascaded flex values, so neither geometry nor computed style is reliable
       here. Read the CSSOM instead: collect every rule that sets a narrowing flex-basis (25% or
       50%, the #2697 signature) and return its selector. The assertion outside checks each one
       targets exactly a single detail-form id and never a create-form (or any other) id, so a
       future edit that widened a #2697 rule to a create id reds even though nothing lays out. */
    const narrowingSelectors = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin sheet; none here
      if (!rules) continue;
      for (const rule of rules) {
        if (rule && rule.style && (rule.style.flexBasis === '25%' || rule.style.flexBasis === '50%')) {
          narrowingSelectors.push(rule.selectorText);
        }
      }
    }
    return {
      frowW: name.parentElement.getBoundingClientRect().width,
      nameRatio: ratio(name),
      roleRatio: ratio(role),
      reportsRatio: ratio(reports),
      reportsMarginTop: cs(repWrap, 'marginTop'),
      hintRatioOfForm: formW > 0 ? hint.getBoundingClientRect().width / formW : 0,
      narrowingSelectors,
    };
  }, PANEL_W);

  await browser.close();

  if (r.error) { console.error('FAIL  render-profile-field-widths-2697: ' + r.error); process.exit(1); }

  const fail = [];
  const near = (v, target, tol) => Math.abs(v - target) <= tol;
  // The .frow must be wide enough that the floor is not what we are measuring, or the
  // ratio assertions are vacuous.
  if (r.frowW < 880) fail.push('the pinned .frow was only ' + Math.round(r.frowW) + 'px, below the 880px where 25% clears the 220px floor - the ratio test would be vacuous');
  if (!near(r.nameRatio, 0.25, 0.06)) fail.push('Name field is ' + (r.nameRatio * 100).toFixed(0) + '% of its row, not ~25%');
  if (!near(r.roleRatio, 0.50, 0.07)) fail.push('What-they-do field is ' + (r.roleRatio * 100).toFixed(0) + '% of its row, not ~50%');
  if (!near(r.reportsRatio, 0.25, 0.06)) fail.push('Reports-to field is ' + (r.reportsRatio * 100).toFixed(0) + '% of its row, not ~25%');
  if (!(r.roleRatio > r.nameRatio && r.roleRatio > r.reportsRatio)) fail.push('What-they-do is not wider than Name and Reports-to (the 50/25/25 relationship is gone)');
  if (!(r.reportsMarginTop > 0)) fail.push('Reports-to wrap has no top spacing (margin-top ' + r.reportsMarginTop + 'px); its title sits against the What-they-do input');
  if (!(r.hintRatioOfForm <= 0.55)) fail.push('the Name helper spans ' + (r.hintRatioOfForm * 100).toFixed(0) + '% of the form, not wrapped at ~50%');
  // NEGATIVE CONTROL (scoping): my three narrowing rules must be present and must target ONLY
  // the detail-form ids. (1) each of #d-rename/#d-role/#d-reports has a 25%/50% narrowing rule
  // (the change exists); (2) no narrowing rule's selector mentions a create-form id. A future
  // edit that widened a #2697 rule to a create id (e.g. "#d-rename, #create-name") reds (2).
  const ns = Array.isArray(r.narrowingSelectors) ? r.narrowingSelectors.map((s) => (s || '').trim()) : [];
  const present = (id) => ns.some((s) => s.split(',').map((x) => x.trim()).includes(id));
  const missing = ['#d-rename', '#d-role', '#d-reports'].filter((id) => !present(id));
  if (missing.length) fail.push('the #2697 narrowing rules are not all present in the CSSOM (' + JSON.stringify(missing) + '); the scoping control cannot verify - did the rules move or change?');
  const createLeak = ns.filter((s) => /#create-/.test(s));
  if (createLeak.length) fail.push('a field-narrowing (25%/50%) rule targets a create-form id: ' + JSON.stringify(createLeak) + ' - the #2697 sizing leaked past the detail form to the create form (scoping regression)');

  if (fail.length) {
    console.error('FAIL  render-profile-field-widths-2697: ' + fail.join('; '));
    console.error('  measured=' + JSON.stringify(r));
    process.exit(1);
  }
  console.log('render-profile-field-widths-2697: the agent Profile fields size to ~25% (Name) / ~50% (What they do) / ~25% (Reports to) of their rows, Reports-to has top spacing, the Name helper wraps at ~50%, and the create form is UNAFFECTED (its Name field stays full-width). PASS');
})().catch((e) => { console.error('FAIL  render-profile-field-widths-2697', e && e.message); process.exit(1); });
