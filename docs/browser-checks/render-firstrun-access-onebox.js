/**
 * Screen 2 (Access) shows SIX macOS-style permission previews, grouped and
 * labeled by the app that actually raises each prompt: Terminal (Documents /
 * Downloads / Desktop) and Kosmos (Documents / Downloads / Desktop). #2910
 * (Josh 6.59): "Three for Kosmos and three for Terminal, all six in a row...
 * Right now we show that it's Terminal asking for access on that screen but then
 * when it pops up, it's actually Kosmos asking for it. We really need both so
 * let's ask for both."
 *
 * FILENAME IS HISTORICAL. This check began at 0.6.39 #8 asserting ONE box
 * ("onebox") that replaced a three-card fan; #2910 reverses that to six labeled
 * previews. The name is kept so the browser-check surface map / count gates do
 * not churn on a rename; the arms below assert the six-ask layout.
 *
 * This is the preview cluster (`.s2-dlg-fan`, aria-hidden). Each preview's mock
 * Allow keeps `.s2-mockallow`, so a click forwards into the one real
 * file-access flow (the #fr-pane-2 handler targets the single `.s2-allow`); the
 * keyboard/AT grant path stays the real `.s2-gate-row` Allow Access button,
 * whose click wiring this check does not assert (pinned in
 * engine/machine.a11y-1344.test.js).
 *
 * WHY A SOURCE TEST CANNOT SEE THE RING. The ring is a `::after` pseudo-element
 * on `.s2-db.s2-hl` -- a computed result. A rule that loses the cascade, or a
 * wrong token, reads in the diff like a rule that works; only reading the
 * computed `::after` border tells them apart.
 *
 * Arms:
 *  1. STRUCTURE: exactly six `.s2-dlg`, in two `.s2-appgrp` groups.
 *  2. LABELS: the two group labels name Terminal and Kosmos.
 *  3. MISLABEL FIXED: at least one preview names Kosmos (was only "Terminal"),
 *     and the old generic "...in your folders." line is gone.
 *  4. COVERAGE: each app covers Documents, Downloads and Desktop.
 *  5. COMPACT COPY: a preview line renders at the compact dialog size (~12-13px,
 *     weight 600), not the 17px/400 first-run body.
 *  6. BUTTONS: every preview renders a "Don't Allow" and an "Allow".
 *  7. MOCK AFFORDANCE: every Allow is a live affordance (`.s2-mockallow` +
 *     cursor:pointer).
 *  8. RING: every Allow draws a solid gold `::after` ring and is the blue macOS
 *     default button.
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
const FOLDERS = ['Documents', 'Downloads', 'Desktop'];

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
      check(`${engine}: the access dialog previews are reachable`, false, JSON.stringify(pre));
      await browser.close();
      continue;
    }

    const state = await page.evaluate(() => {
      const fan = document.querySelector('#fr-pane-2 .s2-dlg-fan') || document.querySelector('.s2-dlg-fan');
      const dlgs = fan ? Array.from(fan.querySelectorAll('.s2-dlg')) : [];
      const groups = fan ? Array.from(fan.querySelectorAll('.s2-appgrp')) : [];
      const labels = fan ? Array.from(fan.querySelectorAll('.s2-applbl')).map((p) => p.textContent.trim()) : [];
      const says = dlgs.map((d) => { const p = d.querySelector('.s2-say'); return p ? p.textContent.trim() : ''; });
      // Per-app say-lines: read the group label's app name, then the folder copy of each dialog under it.
      const perApp = groups.map((g) => {
        const lbl = g.querySelector('.s2-applbl');
        const app = lbl ? lbl.textContent.trim().split(/\s|\(/)[0] : '';
        const lines = Array.from(g.querySelectorAll('.s2-say')).map((p) => p.textContent.trim());
        return { app, lines };
      });

      const allows = dlgs.map((d) => Array.from(d.querySelectorAll('.s2-db')).find((b) => /^Allow$/.test(b.textContent.trim())) || null);
      const denies = dlgs.map((d) => Array.from(d.querySelectorAll('.s2-db')).find((b) => /Don't Allow/.test(b.textContent.trim())) || null);

      const sayEl = fan ? fan.querySelector('.s2-say') : null;
      const sayCs = sayEl ? getComputedStyle(sayEl) : null;

      const allowInfo = allows.map((a) => {
        if (!a) return null;
        const af = getComputedStyle(a, '::after');
        const r = a.getBoundingClientRect();
        return {
          mock: a.classList.contains('s2-mockallow'),
          cursor: getComputedStyle(a).cursor,
          bg: getComputedStyle(a).backgroundColor,
          sized: r.width > 0 && r.height > 0,
          ring: { content: af.content, bw: af.borderTopWidth, bs: af.borderTopStyle, bc: af.borderTopColor },
        };
      });

      return {
        dlgCount: dlgs.length,
        groupCount: groups.length,
        labels,
        says,
        perApp,
        oldGenericCopy: says.some((s) => /in your folders\.?$/.test(s)),
        namesKosmos: says.some((s) => /"Kosmos"/.test(s)),
        namesTerminal: says.some((s) => /"Terminal"/.test(s)),
        denyCount: denies.filter(Boolean).length,
        allowCount: allows.filter(Boolean).length,
        sayPx: sayCs ? parseFloat(sayCs.fontSize) : null,
        sayWeight: sayCs ? String(sayCs.fontWeight) : null,
        allowInfo,
      };
    });

    check(`${engine}: exactly SIX dialog previews in two groups (was one)`,
      state.dlgCount === 6 && state.groupCount === 2,
      `dlgs ${state.dlgCount}, groups ${state.groupCount}`);

    check(`${engine}: the two group labels name Terminal and Kosmos`,
      state.labels.length === 2
        && state.labels.some((l) => /^Terminal/.test(l))
        && state.labels.some((l) => /^Kosmos/.test(l)),
      JSON.stringify(state.labels));

    // The mislabel Josh reported: the screen said only "Terminal" while the real prompt is often
    // Kosmos. Fixed = both apps are named AND the old generic "...in your folders." line is gone.
    check(`${engine}: mislabel fixed - both Terminal and Kosmos are named, the old generic line is gone`,
      state.namesTerminal && state.namesKosmos && !state.oldGenericCopy,
      `terminal ${state.namesTerminal}, kosmos ${state.namesKosmos}, oldGeneric ${state.oldGenericCopy}`);

    // Each app's three previews cover Documents, Downloads and Desktop, and name their own app.
    const coverageOk = state.perApp.length === 2 && state.perApp.every((g) =>
      FOLDERS.every((f) => g.lines.some((l) => new RegExp('"' + g.app + '".*' + f + ' folder').test(l))));
    check(`${engine}: each app (Terminal, Kosmos) covers Documents, Downloads and Desktop`,
      coverageOk, JSON.stringify(state.perApp));

    check(`${engine}: preview copy is compact dialog-sized (~12-13px, weight 600), not the overlay 17px/400 body`,
      state.sayPx !== null && state.sayPx >= 11.5 && state.sayPx <= 14 && state.sayWeight === '600',
      `sayPx ${state.sayPx}, weight ${state.sayWeight}`);

    check(`${engine}: every preview renders a Don't Allow and an Allow`,
      state.denyCount === 6 && state.allowCount === 6,
      `deny ${state.denyCount}, allow ${state.allowCount}`);

    // Josh 2026-09-08: people click the mock "Allow" (they read it as the real macOS button), so
    // every one is a live mouse affordance (.s2-mockallow + pointer). The click BEHAVIOUR is pinned
    // in engine/machine.a11y-1344.test.js; this arm verifies the RENDERED affordance across all six.
    const allMock = state.allowInfo.length === 6 && state.allowInfo.every((a) => a && a.mock && a.cursor === 'pointer' && a.sized);
    check(`${engine}: every mock Allow is a live clickable affordance (.s2-mockallow + cursor:pointer)`,
      allMock, JSON.stringify(state.allowInfo.map((a) => a && { mock: a.mock, cursor: a.cursor })));

    // Non-vacuous: the ring pseudo must actually exist on every Allow, then be a gold solid ring on a blue button.
    const allRinged = state.allowInfo.length === 6 && state.allowInfo.every((a) => {
      const present = a && a.ring && a.ring.content && a.ring.content !== 'none' && parseFloat(a.ring.bw) >= 1;
      return present && a.ring.bs === 'solid' && isGold(a.ring.bc) && isBlue(a.bg);
    });
    check(`${engine}: every Allow is ringed (solid gold ::after) and is the blue default button`,
      allRinged, JSON.stringify(state.allowInfo.map((a) => a && { ring: a.ring, bg: a.bg })));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
