/**
 * The Claude connect output on first-run step 3 sits in a light-gold box (#2187).
 *
 * Josh, 2026-09-04 (0.6.30 fresh install, screenshot 9.46.08 PM): group the
 * "... is connected" checkbox AND the setup/installing notifications that lead up
 * to it into a gold box with a light-gold background -- the styled box that fits
 * right underneath the Claude row. Everything the connect flow writes lands in
 * one element, `#fr-sub`, at different moments: the install notifications
 * ("Setting Claude up on this computer...") while it runs, and the connected
 * checkrow after. The fix styles that ONE element as the box.
 *
 * 🔑 WHY A SOURCE TEST CANNOT SEE THIS. The box is a CSS rule
 * (`#firstrun #fr-sub:not(:empty)`) whose whole behaviour is conditional on the
 * element being non-empty and on the pack's forced-light ground -- a computed
 * result, not a declared one. A rule that loses the cascade, or a wrong colour
 * token, reads in the diff exactly like a rule that works.
 *
 * The three arms, and the empty one is the discriminator:
 *  1. CONNECTED: drive the page's own frPaintSubscription() with a connected
 *     subscription; the checkrow paints into #fr-sub with real size (non-vacuous)
 *     AND #fr-sub computes the gold wash (background + border in the gold hue).
 *  2. SETUP NOTIFICATION: drive frPaintConnect({phase:'installing'}); the same
 *     #fr-sub still carries the gold box, so the setup text is boxed too.
 *  3. EMPTY (the control that must fail if the box were unconditional): clear
 *     #fr-sub; it computes display:none, so there is no bare gold rectangle under
 *     Claude before anyone presses Connect. If someone drops the `:empty` guard,
 *     THIS arm reds.
 *
 * It drives the page's OWN painters, so a change to what they write cannot pass
 * here while breaking on screen.
 *
 * Run: see the README in this directory.
 *   NODE_PATH="$PW/node_modules" node docs/browser-checks/render-firstrun-connect-box-2187.js http://127.0.0.1:PORT
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// The gold wash is rgba(184,137,32,.08) fill / rgba(184,137,32,.28) border,
// the same values .fr-confirm uses. A gold hue is r > g > b with r near 184;
// a transparent, white, or grey background fails this and so would a wrong
// token. Tolerance is generous because the fill composites over the card.
function isGold(rgb) {
  if (!rgb) return false;
  const m = rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  const [r, g, b] = p;
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return Math.abs(r - 184) <= 40 && Math.abs(g - 137) <= 45 && Math.abs(b - 32) <= 45
    && r > g && g > b;
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' || !process.env.HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const pre = await page.evaluate(() => {
      const host = document.getElementById('fr-sub');
      if (!host) return { noHost: true };
      if (typeof frPaintSubscription !== 'function') return { noSubFn: true };
      if (typeof frPaintConnect !== 'function') return { noConnFn: true };
      // The first-run pane is hidden on a set-up board, and an ancestor carries
      // the `hidden` too. Unhide the whole chain; the size guards below require
      // real area, so an unhide that failed cannot pass as a layout result.
      // ⚠️ Force display on the ANCESTORS only, never on #fr-sub itself: its own
      // display is the thing under test (the `:empty` rule sets it to none), and
      // an inline `display:block` here would override that rule and make the
      // empty control vacuously pass as visible.
      host.removeAttribute('hidden');
      for (let n = host.parentElement; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      return { ok: true };
    });
    if (!pre.ok) {
      check(`${engine}: the connect box is reachable`, false, JSON.stringify(pre));
      await browser.close();
      continue;
    }

    // 1. CONNECTED arm -- the checkbox Josh named, inside the gold box.
    const connected = await page.evaluate(() => {
      try { FR = { subscription: { state: 'connected', plan: 'Claude Max 20' } }; } catch { /* not writable */ }
      frPaintSubscription();
      const host = document.getElementById('fr-sub');
      const row = host.querySelector('.fr-check.ok');
      const rr = row && row.getBoundingClientRect();
      const cs = getComputedStyle(host);
      const hr = host.getBoundingClientRect();
      return {
        hasRow: Boolean(row),
        rowText: row ? row.innerText : '',
        rowSized: Boolean(rr && rr.width > 0 && rr.height > 0),
        bg: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        boxSized: hr.width > 0 && hr.height > 0,
      };
    });

    // Non-vacuous first: the checkbox must actually be painted, or every style
    // assertion below is about an empty box.
    check(`${engine}: the "... is connected" checkrow paints in #fr-sub`,
      connected.hasRow && connected.rowSized && /is connected/.test(connected.rowText),
      `text ${JSON.stringify(connected.rowText.slice(0, 48))}, sized ${connected.rowSized}`);

    if (connected.hasRow && connected.rowSized) {
      check(`${engine}: the connected box has the gold-wash background`,
        connected.boxSized && isGold(connected.bg), `bg ${connected.bg}`);
      const bw = parseFloat(connected.borderWidth);
      check(`${engine}: the connected box has a gold border`,
        bw >= 1 && isGold(connected.borderColor),
        `${connected.borderWidth} ${connected.borderColor}`);
    }

    // 2. SETUP NOTIFICATION arm -- the "preceding setup text" is boxed too.
    const setup = await page.evaluate(() => {
      try { FR_CONN_LAST = null; } catch { /* not writable */ }
      frPaintConnect({ phase: 'installing' });
      const host = document.getElementById('fr-sub');
      const title = host.querySelector('.fr-ctitle');
      const cs = getComputedStyle(host);
      return {
        titleText: title ? title.innerText : '',
        bg: cs.backgroundColor,
        borderWidth: cs.borderTopWidth,
      };
    });
    check(`${engine}: the setup notification is boxed too`,
      /Setting Claude up/i.test(setup.titleText) && isGold(setup.bg) && parseFloat(setup.borderWidth) >= 1,
      `title ${JSON.stringify(setup.titleText.slice(0, 48))}, bg ${setup.bg}`);

    // 3. EMPTY control -- the box must vanish when there is no content, or it is
    // a bare gold rectangle under Claude before anyone connects. Reds if the
    // :empty guard is dropped and #fr-sub is styled unconditionally.
    const empty = await page.evaluate(() => {
      const host = document.getElementById('fr-sub');
      host.innerHTML = '';
      const cs = getComputedStyle(host);
      const hr = host.getBoundingClientRect();
      return { display: cs.display, bg: cs.backgroundColor, h: hr.height };
    });
    check(`${engine}: an empty #fr-sub draws no box`,
      empty.display === 'none' && !(empty.h > 0),
      `display ${empty.display}, height ${Math.round(empty.h)}, bg ${empty.bg}`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
