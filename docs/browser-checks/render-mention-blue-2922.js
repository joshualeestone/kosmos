/**
 * #2922 (Josh 6.59): an @name that names an agent ON THIS PROJECT is highlighted bright blue in
 * the project room, so the reader sees it will flag that agent. This asserts the RENDER contract:
 *
 *  1. A valid @agent (a key in the room's agentNames set) -> a `.pjmention` span; an @name matching
 *     nobody stays plain.
 *  2. Bold- and paren-wrapped mentions still highlight: `**@mona**` -> a `.pjmention` INSIDE
 *     `<strong>`, `(@mona)` -> parens around the span. The token-splitter only peels the tail, so
 *     the head (leading `**`/`(`) is handled in pjRichSpans; a source read cannot see whether that
 *     re-attach actually produced the span, only the rendered output can.
 *  3. SCOPED to the room: pjRichSpans called with NO agentNames (the agent-dialogue path) never
 *     highlights, so a DM is byte-identical to before.
 *  4. CONTRAST: the computed `.pjmention` color clears WCAG AA (>= 4.5:1) against the message-bubble
 *     grounds it actually sits on -- the --k-sunk wash (agent posts) and the --usermsg-tint wash
 *     (your own) -- in BOTH light and dark themes. A source read cannot see a computed color against
 *     a semi-transparent blended ground; only reading getComputedStyle here can. (This arm exists
 *     because the first cut of the token was checked against the bare page, not the bubble, and
 *     failed AA on the real ground.)
 *
 * HERMETIC: loads web/index.html over file://, boots no server. Everything it reads is the pure
 * pjRichSpans/pjBody renderers + computed style, so it sits in the browser-checks.sh `for n in`
 * loop with no URL and no board.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-mention-blue-2922.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 *
 * // Browser-check-surface: pjmention pj-mention
 */
'use strict';

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-mention-blue-2922: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* WCAG relative-luminance contrast, and an alpha blend, so the arm measures the color against the
   real semi-transparent bubble ground rather than the opaque page. */
function lum(rgb) {
  const s = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}
function contrast(a, b) { const hi = Math.max(lum(a), lum(b)); const lo = Math.min(lum(a), lum(b)); return (hi + 0.05) / (lo + 0.05); }
function blend(fg, alpha, bg) { return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))); }
function parseRgb(s) {
  const str = String(s).trim();
  // --k-bg and friends are HEX tokens (#0c0d0f); a computed color is rgb(). Handle both, or the
  // background silently defaults and the contrast is measured against the wrong ground.
  const h = str.match(/^#([0-9a-f]{6})$/i);
  if (h) { const n = parseInt(h[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = str.match(/rgba?\(([^)]+)\)/i);
  return m ? m[1].split(',').slice(0, 3).map((x) => parseFloat(x.trim())) : null;
}
// A file:// load has no board, so webkit surfaces the app's /api fetches as page errors (chromium
// does not). Those are not real defects in the render under test; drop them.
function realPageErrors(errs) { return errs.filter((e) => !/access control checks|net::ERR_FILE|Failed to load|\/api\//.test(String(e))); }

(async () => {
  for (const engine of ENGINES) {
    for (const theme of ['light', 'dark']) {
      const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
      const ctx = await browser.newContext({ colorScheme: theme });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto('file://' + PAGE);

      const state = await page.evaluate(() => {
        const set = new Set(['mona']);
        const t = (s) => pjRichSpans(s, null, set);
        // The mention color, and the message-bubble grounds it renders on, read from the live tokens.
        const cs = getComputedStyle(document.documentElement);
        const el = document.createElement('span'); el.className = 'pjmention';
        document.body.appendChild(el); const color = getComputedStyle(el).color; el.remove();
        const tok = (n) => cs.getPropertyValue(n).trim();
        return {
          plain: t('@mona'),
          bold: t('**@mona**'),
          dunder: t('__@mona__'),
          under: t('_@mona_'),
          strike: t('~~@mona~~'),
          paren: t('(@mona)'),
          invalid: t('@nobody'),
          invalidBold: t('**@nobody**'),
          scoped: pjRichSpans('@mona', null),   // no agentNames -> dialogue path
          color,
          kbg: tok('--k-bg'), sunk: tok('--k-sunk'), usermsg: tok('--usermsg-tint'),
        };
      });

      const tag = `[${engine}/${theme}]`;
      const realErrs = realPageErrors(errs);
      check(`${tag} no page errors`, realErrs.length === 0, realErrs.join(' | '));
      check(`${tag} a valid @agent renders a .pjmention span`,
        /^<span class="pjmention">@mona<\/span>$/.test(state.plain), state.plain);
      check(`${tag} an @name matching nobody stays plain`, state.invalid === '@nobody', state.invalid);
      check(`${tag} **@mona** highlights INSIDE the bold`,
        /<strong><span class="pjmention">@mona<\/span><\/strong>/.test(state.bold), state.bold);
      check(`${tag} __@mona__ (double-underscore bold) highlights inside the bold`,
        /<strong><span class="pjmention">@mona<\/span><\/strong>/.test(state.dunder), state.dunder);
      check(`${tag} _@mona_ (underscore italic) highlights inside the em`,
        /<em><span class="pjmention">@mona<\/span><\/em>/.test(state.under), state.under);
      check(`${tag} ~~@mona~~ (strike) highlights inside the strike`,
        /<s><span class="pjmention">@mona<\/span><\/s>/.test(state.strike), state.strike);
      check(`${tag} (@mona) keeps its parens around the span`,
        /^\(<span class="pjmention">@mona<\/span>\)$/.test(state.paren), state.paren);
      check(`${tag} **@nobody** (invalid, emphasised) stays plain, no .pjmention`,
        !/pjmention/.test(state.invalidBold) && /<strong>@nobody<\/strong>/.test(state.invalidBold), state.invalidBold);
      check(`${tag} the dialogue path (no agentNames) does NOT highlight`,
        state.scoped === '@mona', state.scoped);

      // CONTRAST against the real bubble grounds, blended from the live tokens.
      const fg = parseRgb(state.color);
      const kbg = parseRgb(state.kbg) || [255, 255, 255];
      const sunkRaw = parseRgb(state.sunk);            // rgba(20,22,26,.05) style
      const userRaw = parseRgb(state.usermsg);
      const sunkAlpha = (String(state.sunk).match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/) || [])[1];
      const userAlpha = (String(state.usermsg).match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/) || [])[1];
      const grounds = [['page', kbg]];
      if (sunkRaw && sunkAlpha != null) grounds.push(['sunk', blend(sunkRaw, parseFloat(sunkAlpha), kbg)]);
      if (userRaw && userAlpha != null) grounds.push(['usermsg', blend(userRaw, parseFloat(userAlpha), kbg)]);
      const ratios = grounds.map(([n, g]) => [n, fg ? contrast(fg, g) : 0]);
      const worst = Math.min(...ratios.map((r) => r[1]));
      check(`${tag} .pjmention clears WCAG AA (>=4.5:1) on every message-bubble ground`,
        fg != null && worst >= 4.5, JSON.stringify(ratios.map(([n, r]) => [n, Number(r.toFixed(2))])));

      await browser.close();
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
