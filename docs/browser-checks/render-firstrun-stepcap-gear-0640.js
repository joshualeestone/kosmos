/**
 * Screen 3 (Automation) step captions render compact, not gigantic + stretched, and
 * the "(stand-in graphic)" dev note is gone; Screen 4 (Notifications) cog is ~2x
 * (0.6.40 re-test, Josh's items #9 + #10).
 *
 * #9: the two numbered step captions ("1 keep this computer awake", "2 when prompted,
 * switch TMUX to On") are `<p class="s3-step-cap">`. A bare `.s3-step-cap` (0,1,0) loses
 * its font to `#firstrun .fr-body p` (1,1,1, 400/1.0625rem), so they rendered 17px/400
 * uppercase+tracked = "gigantic + stretched". The 0.6.39 pass only tightened margin +
 * the gate label, never the caption font. Fix: scope to `#firstrun .fr-body p.s3-step-cap`
 * (1,2,1) so the intended .625rem/600 wins (10px, a small caption). Plus remove the
 * "(stand-in graphic)" `.s3-standin` span that leaked a build note to the user.
 * #10: `.s4-gear` was 38px box / 22px glyph; Josh wants ~2x -> 76px / 44px.
 *
 * WHY A SOURCE READ CANNOT SEE #9: the caption size is a computed cascade result (a
 * bare class losing to an id-scoped rule), not a declared value; only reading the
 * computed font size tells the 17px bug from the 10px fix apart.
 *
 * Arms, each reds against the pre-0.6.40 page:
 *  1. S3: both `.s3-step-cap` render compact (<= 12px, weight 600), NOT 17px/400.
 *  2. S3: no `.s3-standin` element exists (the dev-note leak is removed).
 *  3. S4: `.s4-gear` is ~2x (box 70-82px, glyph 40-48px), NOT the old 38px/22px.
 *
 * HERMETIC: loads web/index.html over file://, boots no server. Static markup +
 * computed style only, so it sits in the browser-checks.sh no-URL loop.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-stepcap-gear-0640.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-firstrun-stepcap-gear-0640: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function unhide(id) {
  const pane = document.getElementById(id);
  if (!pane) return null;
  for (let n = pane; n; n = n.parentElement) {
    n.removeAttribute('hidden');
    if (getComputedStyle(n).display === 'none') n.style.display = 'block';
  }
  return pane;
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    const s3 = await page.evaluate((unhideSrc) => {
      // eslint-disable-next-line no-new-func
      const unhideFn = new Function('id', unhideSrc + '; return unhide(id);');
      const pane = unhideFn('fr-pane-3');
      if (!pane) return { noPane: true };
      const caps = Array.from(pane.querySelectorAll('.s3-step-cap')).map((e) => {
        const c = getComputedStyle(e);
        return { text: e.textContent.trim().slice(0, 40), px: parseFloat(c.fontSize), wt: String(c.fontWeight) };
      });
      return { caps, standinPresent: Boolean(pane.querySelector('.s3-standin')) };
    }, unhide.toString());

    if (s3.noPane) {
      check(`${engine}: fr-pane-3 reachable`, false, 'no pane');
    } else {
      const capsOk = s3.caps.length === 2 && s3.caps.every((c) => c.px > 0 && c.px <= 12 && c.wt === '600');
      check(`${engine}: both S3 step captions are compact (<=12px, weight 600), not the 17px/400 overlay body`,
        capsOk, JSON.stringify(s3.caps));
      check(`${engine}: the "(stand-in graphic)" dev note is removed (no .s3-standin)`,
        s3.standinPresent === false, `standinPresent ${s3.standinPresent}`);
    }

    const s4 = await page.evaluate((unhideSrc) => {
      // eslint-disable-next-line no-new-func
      const unhideFn = new Function('id', unhideSrc + '; return unhide(id);');
      const pane = unhideFn('fr-pane-4');
      if (!pane) return { noPane: true };
      const gear = pane.querySelector('.s4-gear');
      if (!gear) return { noGear: true };
      const c = getComputedStyle(gear);
      const r = gear.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), font: parseFloat(c.fontSize) };
    }, unhide.toString());

    if (s4.noPane || s4.noGear) {
      check(`${engine}: fr-pane-4 gear reachable`, false, JSON.stringify(s4));
    } else {
      const gearOk = s4.w >= 70 && s4.w <= 82 && s4.h >= 70 && s4.h <= 82 && s4.font >= 40 && s4.font <= 48;
      check(`${engine}: the S4 notification cog is ~2x (box 70-82px, glyph 40-48px), not the old 38/22`,
        gearOk, JSON.stringify(s4));
    }

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
