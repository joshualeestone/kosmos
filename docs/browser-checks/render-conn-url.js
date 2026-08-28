/**
 * The sign-in step's fallback link, which Josh photographed overlapping itself
 * (#1209): "Browser did not open?" with the button's box riding up over it.
 *
 * 🔑 WHY A SOURCE TEST CANNOT SEE THIS. `.btn` sets padding and no `display`.
 * A `<button>` is `inline-block` by default, so its padding pushes neighbours
 * apart. `frConnPaintUrl` writes the file's ONLY `<a class="btn">`, and an
 * anchor is plain `inline` -- vertical padding on an inline box does not push
 * the line above away, it OVERLAPS it. Nothing in the markup or the diff looks
 * wrong; the collision exists only once a browser lays it out.
 *
 * ⚠️ IT ASSERTS BOTH BOXES ARE PAINTED BEFORE IT ASSERTS WHERE THEY ARE.
 * A hidden element reports a zero-size rect, and two zero-size rects never
 * intersect, so "they do not overlap" is vacuously true for a control that
 * was never drawn. That is how a sibling check in this directory passed with
 * its paint deleted. Paint first, position second.
 *
 * 📌 It drives the page's OWN `frConnPaintUrl` rather than a copy of its
 * markup, so a change to what that function writes cannot pass here while
 * breaking on screen.
 *
 * Run: see the README in this directory.
 *   NODE_PATH="$PW/node_modules" node docs/browser-checks/render-conn-url.js http://127.0.0.1:PORT
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

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const box = await page.evaluate(() => {
      const host = document.getElementById('fr-sub');
      if (!host) return { noHost: true };
      if (typeof frPaintConnect !== 'function') return { noFn: true };
      /* The first-run pane is hidden on a board that has already been set up, and
         `hidden` on the host alone is not enough -- an ancestor carries it too.
         Unhide the whole chain, then REQUIRE the container to have real size
         below, so an unhide that failed cannot pass as a layout result. */
      for (let n = host; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      try { FR_CONN_LAST = null; } catch { /* not writable in this build */ }
      frPaintConnect({ phase: 'signin-awaiting-code', url: 'https://claude.ai/oauth/authorize?example=1' });
      const el = document.getElementById('fr-conn-url');
      if (!el) return { missing: true };
      const text = el.querySelector('.fr-cdetail');
      const btn = el.querySelector('a.btn');
      if (!text || !btn) return { unpainted: true, html: el.innerHTML.slice(0, 120) };
      const c = el.getBoundingClientRect();
      if (!(c.width > 0 && c.height > 0)) return { containerUnpainted: true, w: c.width, h: c.height };
      const t = text.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return {
        t: { x: t.x, y: t.y, w: t.width, h: t.height, right: t.right, bottom: t.bottom },
        b: { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom },
      };
    });

    if (box.missing || box.noFn || box.noHost || box.unpainted || box.containerUnpainted) {
      check(`${engine}: the sign-in fallback is reachable`, false, JSON.stringify(box));
      await browser.close();
      continue;
    }

    // 1. PAINTED. Both boxes must have real area, or every test below is vacuous.
    const painted = box.t.w > 0 && box.t.h > 0 && box.b.w > 0 && box.b.h > 0;
    check(`${engine}: both the question and the button are painted`, painted,
      `text ${Math.round(box.t.w)}x${Math.round(box.t.h)}, button ${Math.round(box.b.w)}x${Math.round(box.b.h)}`);
    if (!painted) { await browser.close(); continue; }

    // 2. NO COLLISION. Their boxes must not intersect in both axes at once.
    const xOverlap = Math.min(box.t.right, box.b.right) - Math.max(box.t.x, box.b.x);
    const yOverlap = Math.min(box.t.bottom, box.b.bottom) - Math.max(box.t.y, box.b.y);
    const collides = xOverlap > 0 && yOverlap > 0;
    check(`${engine}: the button does not overlap "Browser did not open?"`, !collides,
      `x-overlap ${Math.round(xOverlap)}px, y-overlap ${Math.round(yOverlap)}px`);

    // 3. Josh asked for the button on the right, which is also what separates them.
    check(`${engine}: the button sits to the right of the question`, box.b.x >= box.t.right,
      `question ends at ${Math.round(box.t.right)}, button starts at ${Math.round(box.b.x)}`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
