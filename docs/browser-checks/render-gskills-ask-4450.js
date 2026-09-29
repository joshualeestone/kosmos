'use strict';

/**
 * Settings > Global Skills opens with a light-gold note: Ask your agent: "What skills should we
 * install?" (#4450, Josh 2026-09-28 19:56).
 *
 * 🔑 Josh took the gold BUTTONS out that same afternoon (#4407), so the property that matters is
 * that this is a flat tinted panel with text, not a control. That, the tint and the text contrast
 * are computed styles, which only a browser can read.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-gskills-ask-4450.js <url>
 *
 * Runs in light and dark, at a desktop and a phone width. Read-only: it only navigates within
 * Settings and never POSTs. Set SHOTS=<dir> to save a screenshot of the section per run.
 */
const path = require('path');
const { chromium } = require('playwright');

/* WCAG relative luminance and contrast ratio for [r, g, b] in 0..255. */
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

(async () => {
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const SHOTS = process.env.SHOTS || '';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };

  // CONTROL for the contrast arithmetic: plain --gold (#d6a62e) on white is the pair the stylesheet
  // records at 2.25:1. If the helper cannot fail that, a pass below means nothing.
  const ctl = contrast([214, 166, 46], [255, 255, 255]);
  say(ctl < 3 && ctl > 2, 'control: the contrast helper fails gold on white', ctl.toFixed(2));

  try {
    for (const scheme of ['light', 'dark']) {
      for (const vp of [{ w: 1200, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'phone' }]) {
        const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: vp.w, height: vp.h } });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => say(false, scheme + '/' + vp.tag + ' page error: ' + e.message));
        const at = scheme + '/' + vp.tag + ': ';
        await pg.goto(URL, { waitUntil: 'load' });
        await pg.waitForTimeout(800);
        if (await pg.$('#firstrun:not([hidden])')) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
        await pg.evaluate(() => showTab('settings'));
        await pg.waitForSelector('#panel-settings:not([hidden])');
        // The button's own handler, so the phone layout's nav placement does not matter here.
        await pg.evaluate(() => document.querySelector('#s-nav button[data-go="gskills"]').click());
        await pg.waitForSelector('#s-sec-gskills:not([hidden])');
        await pg.waitForTimeout(300);

        const r = await pg.evaluate(() => {
          const el = document.getElementById('g-skills-ask');
          if (!el) return null;
          const sec = document.getElementById('s-sec-gskills');
          const box = el.closest('.dbox');
          const head = box.querySelector('h3.dlab');
          const hint = box.querySelector('p.dhint');
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            text: el.textContent.replace(/\s+/g, ' ').trim(),
            tag: el.tagName,
            role: el.getAttribute('role'),
            tabIndex: el.tabIndex,
            controls: el.querySelectorAll('button, a, input, [role="button"], [tabindex]').length,
            cursor: cs.cursor,
            visible: rect.width > 0 && rect.height > 0 && !sec.hidden,
            afterHead: !!(head && (head.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)),
            beforeHint: !!(hint && (el.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING)),
            bg: cs.backgroundColor,
            color: cs.color,
            boxBg: getComputedStyle(box).backgroundColor,
            hintBg: getComputedStyle(hint).backgroundColor,
            right: rect.right,
            docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            elOverflow: el.scrollWidth > el.clientWidth,
          };
        });
        say(r !== null, at + 'the note exists');
        if (!r) { await ctx.close(); continue; }

        say(r.visible, at + 'the note is on screen when Global Skills opens');
        say(r.text === 'Ask your agent: “What skills should we install?”', at + 'it carries Josh\'s words', JSON.stringify(r.text));
        say(r.afterHead && r.beforeHint, at + 'it sits under the "Global skills" heading, above the hint');
        say(r.tag === 'P' && !r.role && r.tabIndex < 0 && r.controls === 0 && r.cursor !== 'pointer',
          at + 'it is a note, not a button (no role, not focusable, nothing to press, no pointer cursor)',
          r.tag + ' role=' + r.role + ' tab=' + r.tabIndex + ' controls=' + r.controls + ' cursor=' + r.cursor);

        // The tint: the note's background is painted and differs from the card's, while the plain
        // hint on the same card is not painted (the control that the read can tell them apart).
        const parse = (s) => {
          let m = s.match(/rgba?\(([^)]+)\)/);
          if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
          m = s.match(/color\(srgb ([^)]+)\)/);
          if (m) { const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3).map((v) => v * 255), a: p.length > 3 ? p[3] : 1 }; }
          return null;
        };
        const bg = parse(r.bg), box = parse(r.boxBg), fg = parse(r.color), hintBg = parse(r.hintBg);
        say(!!(bg && bg.a > 0 && bg.a < 1), at + 'the note has a tint, not a solid fill', r.bg);
        say(!!(hintBg && hintBg.a === 0), at + 'control: the hint beside it has no tint', r.hintBg);
        if (bg && box && fg) {
          say(box.a === 1, at + 'the card behind it is opaque, so the ground is known', r.boxBg);
          const ground = box.rgb;
          const eff = bg.rgb.map((v, i) => v * bg.a + ground[i] * (1 - bg.a));
          const cr = contrast(fg.rgb, eff);
          say(cr >= 4.5, at + 'its text reads at AA contrast on the tint', cr.toFixed(2) + ':1');
          const warm = eff[0] > eff[2] + 3;
          say(warm, at + 'the tint is gold (warmer than it is blue)', eff.map((v) => Math.round(v)).join(','));
        } else {
          say(false, at + 'colours parse', r.bg + ' / ' + r.color + ' / ' + r.boxBg);
        }

        say(r.right <= vp.w && !r.elOverflow, at + 'it fits the width', 'right=' + Math.round(r.right));
        say(!r.docOverflow, at + 'the page does not scroll sideways');

        if (SHOTS) {
          const sec = await pg.$('#s-sec-gskills .dbox');
          await sec.screenshot({ path: path.join(SHOTS, 'gskills-ask-4450-' + scheme + '-' + vp.tag + '.png') });
        }
        await ctx.close();
      }
    }
  } finally {
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
