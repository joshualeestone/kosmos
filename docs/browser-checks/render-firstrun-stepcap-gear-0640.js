/**
 * Screen 3 (Automation) step captions render compact, not gigantic + stretched, and
 * the "(stand-in graphic)" dev note is gone; Screen 4 (Notifications) cog is ~2x
 * (0.6.40 re-test, Josh's items #9 + #10). Plus (0.6.42 re-test, item #1): Screen 3's
 * tmux step depicts Privacy & Security > Accessibility ("Control your computer"), NOT the
 * Login Items pane -- see arms 4-6 below.
 *
 * #9: the two numbered step captions ("1 keep this computer awake", "2 when prompted,
 * switch TMUX to On") are `<p class="s3-step-cap">`. A bare `.s3-step-cap` (0,1,0) loses
 * its font to `#firstrun .fr-body p` (1,1,1, 400/1.0625rem), so they rendered 17px/400
 * uppercase+tracked = "gigantic + stretched". The 0.6.39 pass only tightened margin +
 * the gate label, never the caption font. Fix: scope to `#firstrun .fr-body p.s3-step-cap`
 * (1,2,1) so the intended .625rem/600 wins (10px, a small caption). Plus remove the
 * "(stand-in graphic)" `.s3-standin` span that leaked a build note to the user.
 * #10: `.s4-gear` was 38px box / 22px glyph; Josh wanted ~2x -> 76px / 44px. Then
 * 0.6.45 (Josh): the 76px box was too big for the cog (the cog size was right), so
 * the BOX was tightened to hug it -> ~52px box, glyph stays 44px.
 *
 * WHY A SOURCE READ CANNOT SEE #9: the caption size is a computed cascade result (a
 * bare class losing to an id-scoped rule), not a declared value; only reading the
 * computed font size tells the 17px bug from the 10px fix apart.
 *
 * Arms 1-3 red against the pre-0.6.40 page; arms 4-5 (0.6.42 #1) red against the pre-0.6.42
 * page; arm 6 is a scope CONTROL and stays GREEN on both (it verifies the change was scoped,
 * not that behavior flipped):
 *  1. S3: both `.s3-step-cap` render compact (<= 12px, weight 600), NOT 17px/400.
 *  2. S3: no `.s3-standin` element exists (the dev-note leak is removed).
 *  3. S4: `.s4-gear` box hugs the cog (box 48-58px, glyph 40-48px), NOT the old 76px box or 38px/22px.
 *  4. S3: the tmux window titles "Accessibility", NOT "Login Items" (0.6.42 #1: the tmux
 *     grant is Privacy & Security > Accessibility, not Login Items). Copy: Mona Lisa.
 *  5. S3: the tmux row sub-text is "Control your computer", NOT "Allow in the background".
 *  6. S4 CONTROL: S4 (bash) still says "Login Items" -- the move is scoped to S3's tmux
 *     window, not an over-removal of "Login Items" from the file.
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
      // #2236/0.6.42 #1: the tmux window must depict Privacy & Security > Accessibility,
      // NOT Login Items. There are two .s3-win blocks (Energy step 1, tmux step 2); pick
      // the tmux one by its "tmux" main label so this is robust to reordering.
      let tmuxTitle = null, tmuxSub = null;
      for (const w of pane.querySelectorAll('.s3-win')) {
        const mt = w.querySelector('.s3-mtxt');
        const mainLabel = mt && mt.childNodes[0] ? mt.childNodes[0].textContent.trim().toLowerCase() : '';
        if (mainLabel === 'tmux') {
          const titleEl = w.querySelector('.s3-title');
          const subEl = mt.querySelector('small');
          tmuxTitle = titleEl ? titleEl.textContent.trim() : null;
          tmuxSub = subEl ? subEl.textContent.trim() : null;
          break;
        }
      }
      return { caps, standinPresent: Boolean(pane.querySelector('.s3-standin')), tmuxTitle, tmuxSub };
    }, unhide.toString());

    if (s3.noPane) {
      check(`${engine}: fr-pane-3 reachable`, false, 'no pane');
    } else {
      const capsOk = s3.caps.length === 2 && s3.caps.every((c) => c.px > 0 && c.px <= 12 && c.wt === '600');
      check(`${engine}: both S3 step captions are compact (<=12px, weight 600), not the 17px/400 overlay body`,
        capsOk, JSON.stringify(s3.caps));
      check(`${engine}: the "(stand-in graphic)" dev note is removed (no .s3-standin)`,
        s3.standinPresent === false, `standinPresent ${s3.standinPresent}`);
      // #2236/0.6.42 #1: the tmux window depicts Accessibility, not Login Items. Reds on the
      // pre-fix page (title "Login Items & Extensions", sub "Allow in the background").
      check(`${engine}: the tmux window titles "Accessibility", NOT "Login Items"`,
        s3.tmuxTitle === 'Accessibility' && !/login items/i.test(s3.tmuxTitle || ''),
        `tmuxTitle ${JSON.stringify(s3.tmuxTitle)}`);
      check(`${engine}: the tmux row sub-text is "Control your computer", NOT "Allow in the background"`,
        s3.tmuxSub === 'Control your computer' && !/allow in the background/i.test(s3.tmuxSub || ''),
        `tmuxSub ${JSON.stringify(s3.tmuxSub)}`);
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
      // #2236/0.6.42 #1 CONTROL: S4 (bash background activity) must STILL say "Login Items" --
      // that pane is correct for the bash background grant; only S3's tmux window moved to
      // Accessibility. This guards against over-removing "Login Items" from the whole file.
      const nb = pane.querySelector('.s4-nb');
      const nt = pane.querySelector('.s4-nt');
      const ntc = nt ? getComputedStyle(nt) : null;
      const nbc = nb ? getComputedStyle(nb) : null;
      return { w: Math.round(r.width), h: Math.round(r.height), font: parseFloat(c.fontSize),
        s4Text: nb ? nb.textContent : null,
        // #768-batch (Josh, said 3x): the title must be BOLD, not LARGER. Weight >= 700
        // and font-size EQUAL to the body, so a future edit cannot re-introduce the
        // size-emphasis it kept regressing to.
        ntWeight: ntc ? Number(ntc.fontWeight) : null,
        ntSize: ntc ? parseFloat(ntc.fontSize) : null,
        nbSize: nbc ? parseFloat(nbc.fontSize) : null,
        // The cog is centred by flex + line-height:1 on the glyph, not place-items on
        // a line box that let the gear's ascent push it high.
        gearDisplay: c.display, gearAlign: c.alignItems, gearJustify: c.justifyContent };
    }, unhide.toString());

    if (s4.noPane || s4.noGear) {
      check(`${engine}: fr-pane-4 gear reachable`, false, JSON.stringify(s4));
    } else {
      // 0.6.45 (Josh): the box was tightened to HUG the cog (was 76px, too big);
      // the cog glyph stayed 44px (Josh: the cog size was right). So the box is
      // ~52px now, the glyph still 40-48px, and it must NOT be the old 76px box
      // nor the original 38/22.
      const gearOk = s4.w >= 48 && s4.w <= 58 && s4.h >= 48 && s4.h <= 58 && s4.font >= 40 && s4.font <= 48;
      check(`${engine}: the S4 notification cog box HUGS the cog (box 48-58px, glyph 40-48px), not the old 76px or 38/22`,
        gearOk, JSON.stringify(s4));
      check(`${engine}: CONTROL -- S4 (bash) still says "Login Items" (not over-removed)`,
        /login items/i.test(s4.s4Text || ''), `s4Text ${JSON.stringify((s4.s4Text || '').slice(0, 80))}`);
      // #768-batch (Josh, said 3 times): "App Background Activity" must be BOLD, NOT a
      // larger font. Weight >= 700 AND the SAME size as the body -- both arms, so
      // neither a non-bold weight nor a size-bump can pass. A computed-cascade fact a
      // source read cannot see, and the exact property that kept regressing.
      const boldNotLarger = s4.ntWeight != null && s4.ntWeight >= 700
        && s4.ntSize != null && s4.nbSize != null && Math.abs(s4.ntSize - s4.nbSize) < 0.5;
      check(`${engine}: the S4 title is BOLD (weight>=700) and the SAME size as the body (bold, not larger)`,
        boldNotLarger, `ntWeight ${s4.ntWeight}, ntSize ${s4.ntSize}, nbSize ${s4.nbSize}`);
      check(`${engine}: the S4 cog is flex-centred (display:flex, items+content center), so the glyph sits centred not high-left`,
        s4.gearDisplay === 'flex' && s4.gearAlign === 'center' && s4.gearJustify === 'center',
        `display ${s4.gearDisplay}, align ${s4.gearAlign}, justify ${s4.gearJustify}`);
    }

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
