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
         STATE label -- but the red needs-you triangle must STILL show. Row 4 is a needs-you
         member (triangle kept, label dropped); row 5 is an idle member the same way (the
         canonical "no idle text" case: no label AND no triangle). */
      + pjMember(mk('needs_you'), true, false, true)
      + pjMember(mk('idle'), true, false, true) + '</div>';
    const rows = host.querySelectorAll('.pj-member');
    if (rows.length !== 5) return { error: 'expected 5 member rows, got ' + rows.length };
    const needsRow = rows[0], idleRow = rows[1], stoppedRow = rows[2], hiddenRow = rows[3], hiddenIdleRow = rows[4];
    const needsWarn = needsRow.querySelector('.pj-face .lwarn');
    const idleWarn = idleRow.querySelector('.pj-face .lwarn');
    const stoppedWarn = stoppedRow.querySelector('.pj-face .lwarn');
    const stoppedSmallCls = (stoppedRow.querySelector('small') || {}).className || '';
    const face = needsRow.querySelector('.pj-face');
    const needsSmall = needsRow.querySelector('small');
    const idleSmall = idleRow.querySelector('small');
    // #3131: the hideState (Agents-column) rows -- needs-you keeps the triangle, both drop the label.
    const hiddenWarn = hiddenRow.querySelector('.pj-face .lwarn');
    const hiddenSmall = hiddenRow.querySelector('small');
    const hiddenIdleWarn = hiddenIdleRow.querySelector('.pj-face .lwarn');
    const hiddenIdleSmall = hiddenIdleRow.querySelector('small');
    const disp = (el) => (el ? getComputedStyle(el).display : 'absent');
    let overFace = false;
    if (needsWarn && face) {
      const w = needsWarn.getBoundingClientRect(), f = face.getBoundingClientRect();
      overFace = w.width > 0 && w.height > 0 && w.left < f.right && w.right > f.left && w.top < f.bottom && w.bottom > f.top;
    }
    /* #5688: a member the project's Issue pill counts (needsYouHere) shows the triangle even in a state the card draws
       calm (a crash loop on a working agent; #6341: a rate limit is never counted on a project now); the same member
       uncounted does not (control). And the "needs you" block
       that names it renders, visible, with an Open button. */
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    host2.innerHTML = '<div class="pj-members">' + pjMember(Object.assign(mk('working'), { needsYouHere: 'crash_loop' }), true, false, true)
      + pjMember(Object.assign(mk('working'), { needsYouHere: null }), true, false, true) + '</div>'
      + '<div class="ny-host-5688">' + (typeof pjNeedsNotice === 'function' ? pjNeedsNotice([Object.assign(mk('working'), { name: 'Elon', needsYouHere: 'crash_loop' })]) : '') + '</div>';
    const r2 = host2.querySelectorAll('.pj-member');
    const nb = host2.querySelector('.ny-host-5688 .pnotice');
    const ob = host2.querySelector('.ny-host-5688 [data-pn-open]');
    const vis = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    // #5692: with the real row builder as the red test, a red row not counted here (a question about another project)
    // is named in the block; an idle member is not.
    const also = typeof pjNeedsNotice === 'function' && typeof pjRedHere === 'function'
      ? pjNeedsNotice([Object.assign(mk('needs_you'), { name: 'Sam', stateProject: 'elsewhere', needsYouHere: null }), Object.assign(mk('idle'), { name: 'Ida', needsYouHere: null })], pjRedHere) : '';
    const also5692 = { another: /Sam[\s\S]*Waiting for your answer about another project\./.test(also), idleListed: /Ida/.test(also) };
    /* #6341 (Josh, 10-16): every row has a visible Dismiss, in the same row as Open; a member the engine marked quiet
       (out of usage, dismissed) is not listed again among the uncounted red rows. */
    const db = host2.querySelector('.ny-host-5688 [data-pn-dismiss]');
    const sameRow = !!(db && ob && db.closest('.pnrow') && db.closest('.pnrow') === ob.closest('.pnrow'));
    const quietHtml = typeof pjNeedsNotice === 'function' && typeof pjRedHere === 'function'
      ? pjNeedsNotice([Object.assign(mk('needs_you'), { name: 'Quinn', stateProject: 'elsewhere', needsYouHere: null, needsYouQuiet: { reason: 'elsewhere', because: 'dismissed' } })], pjRedHere) : 'no pjNeedsNotice';
    // A red member (a question about another project) drawn quiet: no triangle and no red ground; the control is red.
    const qh = document.createElement('div');
    document.body.appendChild(qh);
    const redM = Object.assign(mk('needs_you'), { name: 'Rho', stateProject: 'elsewhere', needsYouHere: null });
    qh.innerHTML = '<div class="pj-members">' + pjMember(redM, true, false, true)
      + pjMember(Object.assign({}, redM, { needsYouQuiet: { reason: 'elsewhere', because: 'dismissed' } }), true, false, true) + '</div>';
    const qr = qh.querySelectorAll('.pj-member');
    const quietRow6341 = { controlRed: !!(qr[0] && qr[0].querySelector('.pj-face .lwarn')) && /\bpjm-attn\b/.test(qr[0] ? qr[0].className : ''),
      quietWarn: !!(qr[1] && qr[1].querySelector('.pj-face .lwarn')), quietClass: qr[1] ? qr[1].className : '' };
    const dismiss6341 = { quietRow6341, shown: vis(db), label: db ? db.getAttribute('aria-label') : '', reason: db ? db.getAttribute('data-pn-reason') : '',
      sameRow, height: db ? db.getBoundingClientRect().height : 0, quietListed: quietHtml !== '' };
    const counted5688 = { countedWarn: !!(r2[0] && r2[0].querySelector('.pj-face .lwarn')), countedWarnDisplay: disp(r2[0] && r2[0].querySelector('.pj-face .lwarn')),
      uncountedWarn: !!(r2[1] && r2[1].querySelector('.pj-face .lwarn')), noticeShown: vis(nb), noticeText: nb ? nb.textContent : '', openShown: vis(ob), openLabel: ob ? ob.getAttribute('aria-label') : '' };
    /* #6484: a member whose restart failed while it was asking its own question carries restartFailed (no disruption):
       it is drawn red like its card; the same member without restartFailed stays a calm Question (CONTROL). */
    const fh = document.createElement('div');
    document.body.appendChild(fh);
    const askM = Object.assign(mk('needs_you'), { name: 'Fay', stateReportedBy: 'agent', needsYouHere: null });
    fh.innerHTML = '<div class="pj-members">' + pjMember(Object.assign({}, askM, { restartFailed: true }), true, false, true)
      + pjMember(askM, true, false, true) + '</div>';
    const fr = fh.querySelectorAll('.pj-member');
    const failed6484 = { failedRed: !!(fr[0] && fr[0].querySelector('.pj-face .lwarn')) && /\bpjm-attn\b/.test(fr[0] ? fr[0].className : ''),
      failedClass: fr[0] ? fr[0].className : '', calmWarn: !!(fr[1] && fr[1].querySelector('.pj-face .lwarn')), calmClass: fr[1] ? fr[1].className : '' };
    return {
      failed6484,
      also5692,
      dismiss6341,
      counted5688,
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
      hiddenIdleHasSmall: !!hiddenIdleSmall,
      hiddenIdleSmallText: hiddenIdleSmall ? hiddenIdleSmall.textContent : '',
      hiddenIdleWarnPresent: !!hiddenIdleWarn,
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
  // #3131: an IDLE member under hideState drops its label too (the canonical "no idle text" case) and gets NO triangle.
  if (r.hiddenIdleHasSmall) fail.push('#3131: an IDLE member with hideState still shows a status <small> label (' + JSON.stringify(r.hiddenIdleSmallText) + ') - the Agents column drops all state text, not just needs-you');
  if (r.hiddenIdleWarnPresent) fail.push('#3131: an IDLE member with hideState got the warning triangle - only needs-you gets the red-!');

  // #5688 arms.
  const c = r.counted5688 || {};
  if (!c.countedWarn || c.countedWarnDisplay === 'none') fail.push('#5688: a member the Issue pill counts (a crash loop on an agent the card reads as working) has no visible triangle');
  if (c.uncountedWarn) fail.push('#5688 CONTROL: the same member, not counted, got the triangle');
  if (!c.noticeShown || !/Elon needs you on this project\./.test(c.noticeText) || !/keeps restarting it/.test(c.noticeText)) fail.push('#5688: the needs-you block is not shown or does not say who and why (' + JSON.stringify(c.noticeText) + ')');
  if (!c.openShown || c.openLabel !== 'Open Elon') fail.push('#5688: the needs-you block has no visible Open for the member (' + JSON.stringify(c.openLabel) + ')');
  const a5692 = r.also5692 || {};
  if (!a5692.another) fail.push('#5692: a red row about another project is not named in the needs-you block');
  if (a5692.idleListed) fail.push('#5692 CONTROL: an idle member was named in the needs-you block');
  const d6341 = r.dismiss6341 || {};
  if (!d6341.shown || d6341.label !== 'Dismiss Elon') fail.push('#6341: the needs-you row has no visible Dismiss for the member (' + JSON.stringify(d6341.label) + ')');
  if (d6341.reason !== 'crash_loop') fail.push('#6341: Dismiss does not carry the reason the row shows (' + JSON.stringify(d6341.reason) + ')');
  if (!d6341.sameRow) fail.push('#6341: Dismiss is not in the same row as Open');
  if (d6341.height < 24) fail.push('#6341: Dismiss is under 24px tall (' + d6341.height + ')');
  const q6341 = d6341.quietRow6341 || {};
  if (!q6341.controlRed) fail.push('#6341 CONTROL: a member needing you about another project is not drawn red (the quiet arm below proves nothing)');
  if (q6341.quietWarn || /\bpjm-attn\b/.test(q6341.quietClass || '')) fail.push('#6341: a member the engine marked quiet is still drawn red on the project (' + q6341.quietClass + ')');
  if (d6341.quietListed) fail.push('#6341: a member the engine marked quiet (dismissed) was listed again in the block');
  const f6484 = r.failed6484 || {};
  if (!f6484.failedRed) fail.push('#6484: a member whose restart failed while asking a question is not drawn red (' + f6484.failedClass + ')');
  if (f6484.calmWarn || /\bpjm-attn\b/.test(f6484.calmClass || '')) fail.push('#6484 CONTROL: the same member without a failed restart is drawn red, not a calm Question (' + f6484.calmClass + ')');
  if (fail.length) {
    console.error('FAIL  render-project-needsyou-2699: ' + fail.join('; '));
    console.error('  measured=' + JSON.stringify(r));
    process.exit(1);
  }
  console.log('render-project-needsyou-2699: a needs-you project member shows the red warning triangle over its icon and its status text in red; an idle member gets neither; and with hideState (the Agents column, #3131) the triangle stays while the status label is dropped. PASS');
})().catch((e) => { console.error('FAIL  render-project-needsyou-2699', e && e.message); process.exit(1); });
