/**
 * The OpenAI key step, rebuilt to its approved design (#1207).
 *
 * 🔑 WHAT SOURCE CANNOT SEE. "All of it inside a bounding box" and "the font
 * sizes should all match" are both about computed layout. A grep confirms the
 * class is on the element; only a browser confirms the box is drawn and that
 * four separate text nodes resolve to one size.
 *
 * ⚠️ IT ASSERTS PAINT BEFORE IT ASSERTS SIZE. A hidden element computes a font
 * size perfectly well while being invisible, so a size comparison on something
 * nobody can see is true and worthless.
 *
 * 📌 IT ALSO PINS THAT THE "Get a key" LINK DOES NOT OVERLAP THE LINE ABOVE IT.
 * That link is an `<a class="btn">`, and `.btn` sets padding with no `display`;
 * an anchor is plain `inline`, so its padding overlaps rather than pushes. That
 * is the collision Josh photographed on the sign-in step (#1209). The row is a
 * `.frow`, which is flex and blockifies it -- this check is what stops that
 * being undone by someone tidying the markup.
 *
 * Run: see the README in this directory.
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

    const seen = await page.evaluate(() => {
      const flow = document.getElementById('fr-openai-flow');
      if (!flow) return { missing: true };
      for (let n = flow; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      const t = document.getElementById('fr-openai-key-t');
      const back = document.getElementById('fr-openai-key-back');
      const get = document.getElementById('fr-openai-getkey');
      const add = document.getElementById('fr-openai-go');
      const key = document.getElementById('fr-openai-key');
      /* ⚠️ GATE ONLY ON WHAT EVERY BUILD HAS. `fr-openai-key-t` and the
         Get-a-key link are elements this change ADDS; requiring them here makes
         the check fail on an unfixed build for a structural reason and never
         exercise the box, the sizes or the collision. Each assertion below
         reports its own absence instead. (Same mistake was made once on
         `render-openai-step.js` and caught by running the control.) */
      if (!add || !key) return { incomplete: true };
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
      const cs = getComputedStyle(flow);
      return {
        hasGet: Boolean(get), hasBack: Boolean(back),
        href: get ? get.getAttribute('href') : null,
        getText: get ? get.textContent.trim() : null,
        copy: t ? t.textContent.trim() : null, hasT: Boolean(t),
        boxed: cs.borderTopWidth !== '0px' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
        border: cs.borderTopWidth, bg: cs.backgroundColor,
        tFs: t ? getComputedStyle(t).fontSize : null,
        backFs: back ? getComputedStyle(back).fontSize : null,
        tBox: t ? r(t) : { w: 0, h: 0 }, backBox: back ? r(back) : null, getBox: get ? r(get) : null,
        addClass: add.className,
      };
    });

    if (seen.missing || seen.incomplete) {
      check(`${engine}: the OpenAI key step is reachable and complete`, false, JSON.stringify(seen));
      await browser.close();
      continue;
    }

    check(`${engine}: the copy is the approved explanation`,
      seen.hasT && seen.tBox.w > 0 && /^Download complete\. You will need an OpenAI API key to finish\./.test(seen.copy || ''),
      seen.hasT ? (seen.copy || '').slice(0, 64) + '…' : 'no identified copy element exists');
    check(`${engine}: there is a Get-a-key button to platform.openai.com`,
      seen.hasGet && seen.getText === 'Get a key' && /^https:\/\/platform\.openai\.com\//.test(seen.href || ''),
      `"${seen.getText}" -> ${seen.href}`);
    check(`${engine}: it all sits in a bounding box, like the prior step`,
      seen.boxed, `border ${seen.border}, background ${seen.bg}`);
    check(`${engine}: the two text blocks are the same size`,
      seen.tFs !== null && seen.backFs !== null && seen.tFs === seen.backFs,
      `${seen.tFs} and ${seen.backFs}`);
    check(`${engine}: the Add button is the primary, like the prior step`,
      /\buprime\b/.test(seen.addClass), seen.addClass);

    // #1209's collision, pinned here so tidying the markup cannot bring it back.
    if (seen.getBox && seen.backBox) {
      const xo = Math.min(seen.getBox.right, seen.backBox.right) - Math.max(seen.getBox.x, seen.backBox.x);
      const yo = Math.min(seen.getBox.bottom, seen.backBox.bottom) - Math.max(seen.getBox.y, seen.backBox.y);
      check(`${engine}: the Get-a-key button does not overlap the text around it`,
        !(xo > 0 && yo > 0), `x-overlap ${Math.round(xo)}px, y-overlap ${Math.round(yo)}px`);
    }

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
