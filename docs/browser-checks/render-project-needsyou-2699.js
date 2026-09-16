'use strict';

/**
 * kosmos#2699 (Josh, design channel 2026-09-10): on the PROJECT view a member that needs
 * the operator "just says 'needs you' in text and doesn't show" - it sits in the same spot
 * as Idle/Working and blends in. Josh asked for the little red triangle over the agent's
 * icon and the "Issue" text in red, so it calls for attention. This drives the real
 * pjMember() row builder (the project card / settings member roster) for a needs_you member
 * and an idle member, and checks the rendered result.
 *
 * 🛑 WHY A BROWSER CHECK. The triangle (LROW_WARN) is display:none inside a .lav by default;
 * the fix shows and positions it over .pj-face, and colors the status red. Both are computed
 * layout/style facts (display, geometry, color) that no unit test sees. This renders the real
 * row into the page and reads the computed result.
 *
 * ⚠️ NEGATIVE ARM: an idle member must get NEITHER the triangle NOR the red, or the signal
 * stops meaning "needs you".
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-project-needsyou-2699.js
 *
 * ⚠️ HEADED by default (matches the others here). HEADED=0 on a console-less machine; the
 * verdicts are computed DOM (display, bounding boxes, color), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-project-needsyou-2699: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-project-needsyou-2699: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof pjMember !== 'function') return { error: 'pjMember is not a function (renamed? re-anchor this check)' };
    const mk = (state) => ({ sessionName: 's-' + state, name: 'Agent ' + state, present: true, state, hasAvatar: false, told: {}, role: null, because: '' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    /* suppressTold=true, withMinus=false: minimise the row. Three members: needs_you (must
       light up), idle (control), and stopped (a state whose STATE_COPY.attn is ALSO true but
       is NOT needs_you - the exact class that a too-broad condition would wrongly light up, so
       it is the load-bearing negative arm; idle alone could not catch that). */
    host.innerHTML = '<div class="pj-members">' + pjMember(mk('needs_you'), true, false)
      + pjMember(mk('idle'), true, false) + pjMember(mk('stopped'), true, false)
      /* #3131: the Agents-column roster passes hideState=true, which drops the per-member
         STATE label -- but the red needs-you triangle must STILL show. This 4th row renders
         a needs-you member the way the real Agents column does. */
      + pjMember(mk('needs_you'), true, false, true) + '</div>';
    const rows = host.querySelectorAll('.pj-member');
    if (rows.length !== 4) return { error: 'expected 4 member rows, got ' + rows.length };
    const needsRow = rows[0], idleRow = rows[1], stoppedRow = rows[2], hiddenRow = rows[3];
    const needsWarn = needsRow.querySelector('.pj-face .lwarn');
    const idleWarn = idleRow.querySelector('.pj-face .lwarn');
    const stoppedWarn = stoppedRow.querySelector('.pj-face .lwarn');
    const stoppedSmallCls = (stoppedRow.querySelector('small') || {}).className || '';
    const face = needsRow.querySelector('.pj-face');
    const needsSmall = needsRow.querySelector('small');
    const idleSmall = idleRow.querySelector('small');
    // #3131: the hideState (Agents-column) row -- triangle kept, state label dropped.
    const hiddenWarn = hiddenRow.querySelector('.pj-face .lwarn');
    const hiddenSmall = hiddenRow.querySelector('small');
    const disp = (el) => (el ? getComputedStyle(el).display : 'absent');
    let overFace = false;
    if (needsWarn && face) {
      const w = needsWarn.getBoundingClientRect(), f = face.getBoundingClientRect();
      overFace = w.width > 0 && w.height > 0 && w.left < f.right && w.right > f.left && w.top < f.bottom && w.bottom > f.top;
    }
    return {
      needsWarnPresent: !!needsWarn,
      needsWarnDisplay: disp(needsWarn),
      needsWarnOverFace: overFace,
      idleWarnPresent: !!idleWarn,
      stoppedWarnPresent: !!stoppedWarn,
      stoppedSmallClass: stoppedSmallCls,
      needsSmallClass: needsSmall ? needsSmall.className : '(no small)',
      needsColor: needsSmall ? getComputedStyle(needsSmall).color : '',
      idleColor: idleSmall ? getComputedStyle(idleSmall).color : '',
      needsLabel: needsSmall ? needsSmall.textContent : '',
      hiddenWarnPresent: !!hiddenWarn,
      hiddenWarnDisplay: disp(hiddenWarn),
      hiddenHasSmall: !!hiddenSmall,
      hiddenSmallText: hiddenSmall ? hiddenSmall.textContent : '',
    };
  });

  await browser.close();

  if (r.error) { console.error('FAIL  render-project-needsyou-2699: ' + r.error); process.exit(1); }

  const fail = [];
  // Needs-you member: triangle present, shown (not the base display:none), and over the avatar.
  if (!r.needsWarnPresent) fail.push('the needs-you member has no warning triangle over its icon (pjMember did not emit LROW_WARN for needs_you)');
  if (r.needsWarnDisplay === 'none') fail.push('the triangle is display:none - the base ".lav .lwarn{display:none}" was not overridden for .pj-member .pj-face, so it never shows');
  if (!r.needsWarnOverFace) fail.push('the triangle is not positioned over the avatar (no overlap with .pj-face) - the show/position rule is missing');
  if (!/\bpj-attn\b/.test(r.needsSmallClass)) fail.push('the needs-you status <small> did not get the pj-attn class (' + r.needsSmallClass + ')');
  if (!r.needsColor || r.needsColor === r.idleColor) fail.push('the needs-you status text is not a distinct (red) color from the idle status (' + r.needsColor + ' vs ' + r.idleColor + ')');
  if (!/^issue$/i.test(r.needsLabel)) fail.push('the needs-you row does not read "Issue" (' + JSON.stringify(r.needsLabel) + ')');
  // Negative arm: an idle member gets neither the triangle nor the red.
  if (r.idleWarnPresent) fail.push('an IDLE member also got the warning triangle - the signal no longer means needs-you');
  // Load-bearing negative arm: a STOPPED member (STATE_COPY.attn is true for it, but it is NOT
  // needs_you) must get NEITHER the triangle NOR the red, or the condition is keying on the
  // wrong attn (stateCopyOf) and lights up six states instead of one.
  if (r.stoppedWarnPresent) fail.push('a STOPPED member got the warning triangle - the condition lights up more than needs_you (keying on stateCopyOf.attn, not cardStOf.st===attn)');
  if (/\bpj-attn\b/.test(r.stoppedSmallClass)) fail.push('a STOPPED member got the red pj-attn status - the condition is broader than needs_you');
  // #3131 arm: the Agents column (hideState=true) drops the state LABEL but KEEPS the red triangle.
  if (!r.hiddenWarnPresent) fail.push('#3131: a needs-you member rendered with hideState lost its warning triangle - the Agents column must keep the red-! even without the label');
  if (r.hiddenWarnDisplay === 'none') fail.push('#3131: the hideState needs-you triangle is display:none - the Agents column no longer shows the red-!');
  if (r.hiddenHasSmall) fail.push('#3131: a member rendered with hideState still shows a status <small> label (' + JSON.stringify(r.hiddenSmallText) + ') - the Agents column should show only the triangle, no waiting/idle/busy text');

  if (fail.length) {
    console.error('FAIL  render-project-needsyou-2699: ' + fail.join('; '));
    console.error('  measured=' + JSON.stringify(r));
    process.exit(1);
  }
  console.log('render-project-needsyou-2699: a needs-you project member shows the red warning triangle over its icon and its status text in red; an idle member gets neither; and with hideState (the Agents column, #3131) the triangle stays while the status label is dropped. PASS');
})().catch((e) => { console.error('FAIL  render-project-needsyou-2699', e && e.message); process.exit(1); });
