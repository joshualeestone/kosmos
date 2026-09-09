/**
 * Screen 2 (Access) shows ONE compact macOS-style permission prompt with the
 * Allow button ringed, not the old three-card stacked fan (0.6.39 #8, Josh's
 * fresh-account test, screen 9.50.20).
 *
 * Josh's ask (via Mona's #8 spec): replace the three vertically reproduced
 * dialogs (Documents / Downloads / Desktop) with ONE simplified, smaller,
 * horizontal box styled like the real macOS prompt the person will actually
 * see, verbatim "\"Terminal\" would like to access files in your folders.", the
 * two Don't Allow / Allow buttons, and a ring drawn around Allow so the person
 * clicks Allow rather than Don't Allow.
 *
 * This is the preview (`.s2-dlg-fan`, aria-hidden). Josh, 2026-09-08: its Allow is
 * now a live mouse affordance (`.s2-mockallow`) that forwards into the real
 * file-access flow, asserted below; the keyboard/AT grant path stays the real
 * `.s2-gate-row` Allow Access button, whose click wiring this check does not assert
 * (that is pinned in engine/machine.a11y-1344.test.js).
 *
 * WHY A SOURCE TEST CANNOT SEE THE RING. The ring is a `::after` pseudo-element
 * on `.s2-db.s2-hl` -- a computed result. A rule that loses the cascade, or a
 * wrong token, reads in the diff like a rule that works; only reading the
 * computed `::after` border tells them apart.
 *
 * Arms (each reds against the pre-#8 three-card page):
 *  1. STRUCTURE: exactly one `.s2-dlg` inside `.s2-dlg-fan` (was three).
 *  2. COPY: the single `.s2-say` is the verbatim generalized line, and the old
 *     per-folder strings (Documents/Downloads/Desktop folder) are gone.
 *  3. BUTTONS: a "Don't Allow" and an "Allow" button both render.
 *  4. RING: the Allow button's `::after` draws a solid gold ring (the callout),
 *     and Allow is the blue macOS default button. The three-card page had no
 *     ::after ring, so this arm reds there.
 *
 * Later arms (not part of the pre-#8 comparison):
 *  - COMPACT COPY (#768): the box copy renders at the compact dialog size
 *    (~13px/600), not the 17px/400 first-run body.
 *  - MOCK AFFORDANCE (Josh 2026-09-08): the mock "Allow" is a live clickable
 *    affordance (`.s2-mockallow` + `cursor:pointer`), the render half of the
 *    mock-forward behaviour whose click logic lives in machine.a11y-1344.test.js.
 *
 * HERMETIC: loads web/index.html over file://, boots no server. Everything it
 * reads is static markup + computed style, so it sits in the browser-checks.sh
 * `for n in` loop with no URL and no board.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-access-onebox.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-firstrun-access-onebox: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];
const VERBATIM = '"Terminal" would like to access files in your folders.';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// Gold hue ordering r > g > b with r near the brand gold (#e3b341 = 227,179,65).
// A transparent, white, grey, or blue ring fails this, and so would a wrong token.
function isGold(rgb) {
  if (!rgb) return false;
  const m = rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return Math.abs(r - 227) <= 45 && Math.abs(g - 179) <= 45 && Math.abs(b - 65) <= 55
    && r > g && g > b;
}
// Blue-ish: the macOS default/suggested button. b is the dominant channel.
function isBlue(rgb) {
  if (!rgb) return false;
  const m = rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return b > r && b > 120;
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    // The first-run overlay and fr-pane-2 are hidden on a set-up board. Unhide the
    // chain up from the dialog fan so it has real layout for the computed-style read.
    const pre = await page.evaluate(() => {
      const fan = document.querySelector('#fr-pane-2 .s2-dlg-fan') || document.querySelector('.s2-dlg-fan');
      if (!fan) return { noFan: true };
      for (let n = fan.parentElement; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      return { ok: true };
    });
    if (!pre.ok) {
      check(`${engine}: the access dialog preview is reachable`, false, JSON.stringify(pre));
      await browser.close();
      continue;
    }

    const state = await page.evaluate((VERBATIM) => {
      const fan = document.querySelector('#fr-pane-2 .s2-dlg-fan') || document.querySelector('.s2-dlg-fan');
      const dlgs = fan ? fan.querySelectorAll('.s2-dlg') : [];
      const says = fan ? Array.from(fan.querySelectorAll('.s2-say')).map((p) => p.textContent.trim()) : [];
      const allow = fan ? Array.from(fan.querySelectorAll('.s2-db')).find((b) => /^Allow$/.test(b.textContent.trim())) : null;
      const deny = fan ? Array.from(fan.querySelectorAll('.s2-db')).find((b) => /Don't Allow/.test(b.textContent.trim())) : null;
      const sayEl = fan ? fan.querySelector('.s2-say') : null;
      const sayCs = sayEl ? getComputedStyle(sayEl) : null;
      let ring = null, allowBg = null, allowSized = false;
      if (allow) {
        const af = getComputedStyle(allow, '::after');
        ring = { content: af.content, bw: af.borderTopWidth, bs: af.borderTopStyle, bc: af.borderTopColor };
        allowBg = getComputedStyle(allow).backgroundColor;
        const r = allow.getBoundingClientRect();
        allowSized = r.width > 0 && r.height > 0;
      }
      return {
        dlgCount: dlgs.length,
        says,
        hasVerbatim: says.length === 1 && says[0] === VERBATIM,
        oldFolderCopy: says.some((s) => /Documents folder|Downloads folder|Desktop folder/.test(s)),
        hasAllow: Boolean(allow),
        hasDeny: Boolean(deny),
        sayPx: sayCs ? parseFloat(sayCs.fontSize) : null,
        sayWeight: sayCs ? String(sayCs.fontWeight) : null,
        allowSized, allowBg, ring,
        allowMock: allow ? allow.classList.contains('s2-mockallow') : false,
        allowCursor: allow ? getComputedStyle(allow).cursor : null,
      };
    }, VERBATIM);

    check(`${engine}: exactly ONE dialog card (was three)`,
      state.dlgCount === 1, `count ${state.dlgCount}`);

    check(`${engine}: the box carries the verbatim generalized copy, per-folder copy gone`,
      state.hasVerbatim && !state.oldFolderCopy, JSON.stringify(state.says));

    // The box copy must render at the compact dialog size (~13px / .8125rem, weight 600),
    // NOT the 17px/400 first-run body <p> that `#firstrun .fr-body p` imposes on a bare
    // class. Reds if the .s2-say specificity is dropped back below (1,1,1).
    check(`${engine}: the box copy is compact dialog-sized (~13px, weight 600), not the overlay 17px/400 body`,
      state.sayPx !== null && state.sayPx >= 12 && state.sayPx <= 14 && state.sayWeight === '600',
      `sayPx ${state.sayPx}, weight ${state.sayWeight}`);

    check(`${engine}: both Don't Allow and Allow buttons render`,
      state.hasDeny && state.hasAllow && state.allowSized,
      `deny ${state.hasDeny}, allow ${state.hasAllow}, sized ${state.allowSized}`);

    // Josh 2026-09-08 (blue-Allow, no card): people click the mock "Allow" (they read it as the real macOS button),
    // so it is a live mouse affordance -- it carries the .s2-mockallow hook and a
    // pointer cursor. The click BEHAVIOUR (it routes through the real Allow Access
    // button and is guarded against re-firing) is pinned in engine/machine.a11y-1344
    // .test.js; this arm verifies the RENDERED affordance. Reds if the class or the
    // cursor is dropped (the mock going back to inert art).
    check(`${engine}: the mock Allow is a live clickable affordance (.s2-mockallow + cursor:pointer)`,
      state.allowMock && state.allowCursor === 'pointer',
      `mock ${state.allowMock}, cursor ${state.allowCursor}`);

    // Non-vacuous first: the ring pseudo must actually exist, then be a gold solid ring.
    const ringPresent = state.ring && state.ring.content && state.ring.content !== 'none' && parseFloat(state.ring.bw) >= 1;
    check(`${engine}: Allow is ringed (solid gold ::after) and is the blue default button`,
      ringPresent && state.ring.bs === 'solid' && isGold(state.ring.bc) && isBlue(state.allowBg),
      `ring ${JSON.stringify(state.ring)}, allowBg ${state.allowBg}`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
