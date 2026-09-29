// Browser-check-surface: conn-ask ask-agent s-sec-connect
'use strict';
/**
 * #4451 (Josh, 2026-09-28 19:57): the top of Settings > Connections carries a flat light-gold callout,
 * "Ask your agent: What connections do we need? It can set them up for you." Words, not a button.
 *
 * Asserted in light and dark, at a desktop and a phone width:
 *   - it is on screen, at the top of the Connections box (above the first service row);
 *   - it is not a button or a link (the person asks in a conversation);
 *   - its background is a real tint (not transparent) and its ink keeps 4.5:1 against it;
 *   - the words are the card's.
 * CONTROL: the same measurement on the AI Models section finds no callout, so "found" is not a selector
 * that matches anything.
 *
 * file://, like render-dm-chatfirst-718.js: the callout is markup, so no board is needed.
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-conn-ask-4451.js
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const fail = [];
let ran = 0;
const chk = (ok, label, extra) => { ran += 1; console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

/* sRGB relative luminance and contrast, from computed rgb()/rgba() strings. */
function parse(c) {
  const s = String(c);
  /* color-mix() computes to color(srgb r g b / a), channels 0 to 1. */
  const cm = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (cm) return { r: +cm[1] * 255, g: +cm[2] * 255, b: +cm[3] * 255, a: cm[4] === undefined ? 1 : +cm[4] };
  const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lum({ r, g, b }) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function over(top, under) { const a = top.a; return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 }; }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

(async () => {
  const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      for (const theme of ['light', 'dark']) {
        const t = `[${w}x${h} ${theme}]`;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(PAGE);
        await page.evaluate(() => {
          const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
          document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
          showTab('settings');
          settingsGo('connect');
        });
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
          const el = document.getElementById('conn-ask');
          const sec = document.getElementById('s-sec-connect');
          if (!el || !sec) return { missing: true };
          const R = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const firstRow = sec.querySelector('.con-cat');
          /* The page background the tint sits on: the nearest ancestor with an opaque background. */
          let under = null;
          for (let a = el.parentElement; a; a = a.parentElement) {
            const b = getComputedStyle(a).backgroundColor;
            if (b && !/rgba\([^)]*,\s*0\)$/.test(b) && !/\/\s*0\)$/.test(b) && b !== 'transparent') { under = b; break; }
          }
          return { missing: false, shown: !sec.hidden && R.height > 0 && R.width > 0, top: R.top, bottom: R.bottom, left: R.left, right: R.right, vw: innerWidth,
            aboveRows: !firstRow || R.bottom <= firstRow.getBoundingClientRect().top + 0.5,
            tag: el.tagName, interactive: !!el.closest('button, a') || el.querySelector('button, a') !== null,
            bg: cs.backgroundColor, ink: cs.color, under, text: el.textContent.replace(/\s+/g, ' ').trim() };
        });
        chk(!m.missing && m.shown, `${t} the callout is on the Connections section`, JSON.stringify(m));
        if (m.missing) { await ctx.close(); continue; }
        chk(m.left >= 0 && m.right <= m.vw + 0.5, `${t} it fits the width`, JSON.stringify({ left: m.left, right: m.right, vw: m.vw }));
        chk(m.aboveRows, `${t} it sits above the first service row`);
        chk(m.tag === 'P' && !m.interactive, `${t} it is words, not a button or a link`, m.tag);
        chk(m.text === 'Ask your agent: “What connections do we need?” It can set them up for you.', `${t} the words are the card's`, JSON.stringify(m.text));
        const bg = parse(m.bg), ink = parse(m.ink), under = parse(m.under);
        chk(!!bg && bg.a > 0 && bg.a < 1, `${t} the background is a soft tint, not transparent and not a solid fill`, m.bg);
        if (bg && ink && under) {
          const c = contrast(over(ink, under), over(bg, under));
          chk(c >= 4.5, `${t} the ink keeps 4.5:1 on the tint (${c.toFixed(2)}:1)`);
        } else chk(false, `${t} colours readable`, JSON.stringify({ bg: m.bg, ink: m.ink, under: m.under }));
        // CONTROL: the AI Models section (it exists, and it is on screen) carries no such callout.
        const ctl = await page.evaluate(() => { settingsGo('accounts'); const s = document.getElementById('s-sec-accounts');
          return s && !s.hidden ? !!s.querySelector('#conn-ask') : 'no section'; }).catch(() => null);
        chk(ctl === false, `${t} CONTROL: the AI Models section is on screen and has no callout`, String(ctl));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  const EXPECTED = 4 * 9;
  if (ran !== EXPECTED) { console.log(`FAIL  ran ${ran} checks, expected ${EXPECTED}`); fail.push('count'); }
  console.log(fail.length ? `\n${fail.length} FAILED` : `\nall ${ran} passed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
