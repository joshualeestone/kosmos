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
 * PART 2 (the live input highlight): #pj-post is backed by a mirror div that renders the SAME text
 * with recognized @agent mentions blue, using pjMentionHighlightHTML -- the same recognized-name
 * rule as the message, so input and message never disagree. Two things a source read cannot see are
 * asserted here: (a) the live mention is COLOUR-ONLY, not bold (bold would widen the glyph and drift
 * the mirror off the caret), and (b) the mirror's font/line-height/padding EXACTLY match #pj-post's,
 * which is what keeps the visible text sitting where the caret is. Both are read from getComputedStyle.
 *
 * // Browser-check-surface: pjmention pj-mention pj-live-mention pj-post-mirror pj-mirror-in mention-live
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
          hyphenFlag: t('cc @mona-'),   // backend flags mona (strips trailing -), so it must highlight
          notKey: t('@mona_bar'),        // not a key, no trailing ._- -> backend does not flag -> plain
          invalid: t('@nobody'),
          invalidBold: t('**@nobody**'),
          // Self-mention: the backend never flags a non-operator post's own author, so an agent's
          // @<self> must NOT blue (would falsely promise reaching itself); someone else's post does.
          selfMention: pjRoomBody({ text: 'thanks @mona and @renet-tilley', from: 'mona', operator: false }, { agents: ['mona', 'renet-tilley'] }),
          otherMention: pjRoomBody({ text: 'thanks @mona and @renet-tilley', from: 'renet-tilley', operator: false }, { agents: ['mona', 'renet-tilley'] }),
          opMention: pjRoomBody({ text: 'hey @mona', from: null, operator: true }, { agents: ['mona'] }),
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
      check(`${tag} @mona- (trailing punct the BACKEND flags by stripping) still highlights`,
        /^cc <span class="pjmention">@mona<\/span>-$/.test(state.hyphenFlag), state.hyphenFlag);
      check(`${tag} @mona_bar (not a key, no trailing ._-) stays plain, like the backend`,
        state.notKey === '@mona_bar', state.notKey);
      check(`${tag} **@mona** highlights INSIDE the bold`,
        /<strong><span class="pjmention">@mona<\/span><\/strong>/.test(state.bold), state.bold);
      // The backend's left boundary is (^|[^A-Za-z0-9._-])@, and `_` is in that class, so a `_`
      // immediately before `@` means the backend does NOT flag it. The highlight must match: an
      // underscore-emphasised mention renders as plain emphasis, NOT blue, or the blue would falsely
      // promise delivery. (`**`/`~~`/`(` boundaries ARE non-identifier, so those DO flag + highlight.)
      check(`${tag} __@mona__ (underscore boundary, backend does NOT flag) is bold but NOT blue`,
        !/pjmention/.test(state.dunder) && /<strong>@mona<\/strong>/.test(state.dunder), state.dunder);
      check(`${tag} _@mona_ (underscore boundary, backend does NOT flag) is italic but NOT blue`,
        !/pjmention/.test(state.under) && /<em>@mona<\/em>/.test(state.under), state.under);
      check(`${tag} ~~@mona~~ (strike) highlights inside the strike`,
        /<s><span class="pjmention">@mona<\/span><\/s>/.test(state.strike), state.strike);
      check(`${tag} (@mona) keeps its parens around the span`,
        /^\(<span class="pjmention">@mona<\/span>\)$/.test(state.paren), state.paren);
      check(`${tag} **@nobody** (invalid, emphasised) stays plain, no .pjmention`,
        !/pjmention/.test(state.invalidBold) && /<strong>@nobody<\/strong>/.test(state.invalidBold), state.invalidBold);
      check(`${tag} the dialogue path (no agentNames) does NOT highlight`,
        state.scoped === '@mona', state.scoped);
      // Self-mention parity with the backend recipient filter.
      check(`${tag} an agent's post does NOT blue a mention of ITSELF (backend excludes the author)`,
        !/pjmention">@mona</.test(state.selfMention) && /pjmention">@renet-tilley</.test(state.selfMention), state.selfMention);
      check(`${tag} another agent's post DOES blue that same @mona`,
        /pjmention">@mona</.test(state.otherMention), state.otherMention);
      check(`${tag} an operator post blues the mention (operator flags anyone)`,
        /pjmention">@mona</.test(state.opMention), state.opMention);

      // CONTRAST against the real bubble grounds, blended from the live tokens.
      const fg = parseRgb(state.color);
      const kbg = parseRgb(state.kbg) || [255, 255, 255];
      const sunkRaw = parseRgb(state.sunk);            // rgba(20,22,26,.05) style
      const userRaw = parseRgb(state.usermsg);
      const sunkAlpha = (String(state.sunk).match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/) || [])[1];
      const userAlpha = (String(state.usermsg).match(/rgba?\([^)]*,\s*([0-9.]+)\s*\)/) || [])[1];
      const grounds = [['page', kbg]];
      if (sunkRaw && sunkAlpha != null) grounds.push(['sunk', blend(sunkRaw, parseFloat(sunkAlpha), kbg)]);
      // #3267: --usermsg-tint is now SOLID (opaque), so its painted ground IS userRaw directly.
      // The old arm only pushed a BLENDED ground when an rgba alpha was present, so against the
      // solid hex userAlpha is undefined and the usermsg ground was silently dropped -- the exact
      // wrong-ground/vacuous loss the header at :60-61 warns about. Push it either way: blend when
      // translucent (legacy rgba), use the opaque rgb directly when solid.
      if (userRaw) grounds.push(['usermsg', userAlpha != null ? blend(userRaw, parseFloat(userAlpha), kbg) : userRaw]);
      const ratios = grounds.map(([n, g]) => [n, fg ? contrast(fg, g) : 0]);
      const worst = Math.min(...ratios.map((r) => r[1]));
      check(`${tag} .pjmention clears WCAG AA (>=4.5:1) on every message-bubble ground`,
        fg != null && worst >= 4.5, JSON.stringify(ratios.map(([n, r]) => [n, Number(r.toFixed(2))])));

      // ---- PART 2: the live @-mention highlight in #pj-post ------------------
      const live = await page.evaluate(() => {
        const set = new Set(['mona', 'renet-tilley']);
        const H = (s) => pjMentionHighlightHTML(s, set);
        const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
        const post = document.getElementById('pj-post');
        const mirror = document.getElementById('pj-post-mirror');
        const inner = mirror && mirror.querySelector('.pj-mirror-in');
        let liveWeight = null, normalWeight = null;
        if (inner) {
          inner.innerHTML = 'x<span class="pj-live-mention">@mona</span>';
          const span = inner.querySelector('.pj-live-mention');
          liveWeight = span && getComputedStyle(span).fontWeight;
          normalWeight = getComputedStyle(inner).fontWeight;
          inner.innerHTML = '';
        }
        let plainColor = null, liveColor = null, liveCaret = null;
        if (post) {
          plainColor = getComputedStyle(post).color;
          post.classList.add('mention-live');
          liveColor = getComputedStyle(post).color;
          liveCaret = getComputedStyle(post).caretColor;
          post.classList.remove('mention-live');
        }
        // Hidden-safe: on this bare file:// load #pj-post is hidden (offsetWidth 0). pjMentionPaint
        // must NOT engage the mirror (add .mention-live) when the composer is not laid out, or a
        // draft restored before the room is shown would look empty (transparent text over a 0-size
        // mirror). Restore state after so no other arm is disturbed.
        let hiddenSafe = null;
        if (post && typeof pjMentionPaint === 'function') {
          const prev = post.value;
          post.value = 'draft @mona';
          post.classList.remove('mention-live');
          pjMentionPaint();
          hiddenSafe = { offsetW: post.offsetWidth, mentionLive: post.classList.contains('mention-live') };
          post.value = prev;
          post.classList.remove('mention-live');
          if (inner) inner.innerHTML = '';
        }
        return {
          valid: H('hi @mona'), partial: H('hi @mon'), hyphen: H('@mona-'),
          under: H('_@mona_'), esc: H('<b>@mona</b>'), twoLine: H('a\n@mona\n'),
          mirrorPresent: !!(mirror && inner),
          postFontSize: post && cs(post, 'font-size'), innerFontSize: inner && cs(inner, 'font-size'),
          postLineHeight: post && cs(post, 'line-height'), innerLineHeight: inner && cs(inner, 'line-height'),
          postPadTop: post && cs(post, 'padding-top'), innerPadTop: inner && cs(inner, 'padding-top'),
          postPadLeft: post && cs(post, 'padding-left'), innerPadLeft: inner && cs(inner, 'padding-left'),
          liveWeight, normalWeight, plainColor, liveColor, liveCaret, hiddenSafe,
        };
      });

      check(`${tag} live: a recognized @agent becomes a .pj-live-mention span`,
        live.valid === 'hi <span class="pj-live-mention">@mona</span>', live.valid);
      check(`${tag} live: a partial/unrecognized @name stays plain (only recognized names blue)`,
        live.partial === 'hi @mon', live.partial);
      check(`${tag} live: @mona- (backend strips the trailing -) still highlights mona`,
        live.hyphen === '<span class="pj-live-mention">@mona</span>-', live.hyphen);
      check(`${tag} live: _@mona_ (underscore boundary) stays plain, like the backend`,
        live.under === '_@mona_', live.under);
      check(`${tag} live: HTML in the input is escaped`,
        live.esc === '&lt;b&gt;@mona&lt;/b&gt;', live.esc);
      check(`${tag} live: a trailing newline is padded so the mirror matches the textarea`,
        /\n $/.test(live.twoLine), JSON.stringify(live.twoLine));
      check(`${tag} live: the mirror (#pj-post-mirror .pj-mirror-in) is in the DOM`,
        live.mirrorPresent, String(live.mirrorPresent));
      // The alignment guarantee a source read cannot make: the mirror's text metrics EQUAL the
      // textarea's, so wrapped/scrolled text sits exactly where the caret is.
      check(`${tag} live: mirror font-size matches #pj-post`,
        live.innerFontSize && live.innerFontSize === live.postFontSize, `${live.innerFontSize} vs ${live.postFontSize}`);
      check(`${tag} live: mirror line-height matches #pj-post`,
        live.innerLineHeight && live.innerLineHeight === live.postLineHeight, `${live.innerLineHeight} vs ${live.postLineHeight}`);
      check(`${tag} live: mirror padding matches #pj-post`,
        live.innerPadTop === live.postPadTop && live.innerPadLeft === live.postPadLeft,
        `top ${live.innerPadTop} vs ${live.postPadTop}, left ${live.innerPadLeft} vs ${live.postPadLeft}`);
      // COLOUR-ONLY, not bold: same weight as normal mirror text, or the glyphs widen and drift.
      check(`${tag} live: .pj-live-mention is colour-only (same weight as normal text, NOT bold)`,
        live.liveWeight != null && live.liveWeight === live.normalWeight, `${live.liveWeight} vs ${live.normalWeight}`);
      // The textarea's own text goes transparent so only the mirror shows; the caret stays inked.
      check(`${tag} live: #pj-post text is inked WITHOUT .mention-live (the class is what makes it transparent)`,
        live.plainColor && live.plainColor !== 'rgba(0, 0, 0, 0)' && live.plainColor !== 'transparent', live.plainColor);
      check(`${tag} live: #pj-post.mention-live text is transparent`,
        live.liveColor === 'rgba(0, 0, 0, 0)', live.liveColor);
      check(`${tag} live: #pj-post.mention-live keeps an inked caret (not transparent)`,
        live.liveCaret && live.liveCaret !== 'rgba(0, 0, 0, 0)' && live.liveCaret !== 'transparent', live.liveCaret);
      // Non-vacuous: requires offsetW === 0 (the composer really is hidden on this load) AND that
      // pjMentionPaint did NOT add .mention-live there -- so a draft restored before the room is
      // shown is not made invisible.
      check(`${tag} live: pjMentionPaint is hidden-safe (offsetWidth 0 -> no .mention-live)`,
        live.hiddenSafe && live.hiddenSafe.offsetW === 0 && live.hiddenSafe.mentionLive === false,
        JSON.stringify(live.hiddenSafe));

      await browser.close();
    }
  }

  // DIFFERENTIAL (kosmos#2922 part 2, repo Convention #5): the recognized-name ALGORITHM is
  // reproduced in two places -- pjMentionHighlightHTML (the live input) and pjRichSpans (the posted
  // message). They must classify @mentions IDENTICALLY, or the input and the message disagree about
  // what is a real mention. Rather than trust that two independently-typed regex chains stay equal,
  // run the SAME fixtures through both and assert the highlighted @keys match. A future edit to one
  // (e.g. widening the punctuation class) then fails here instead of shipping a silent desync. Pure
  // JS, so one engine/theme is enough.
  {
    const browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' });
    const page = await browser.newPage();
    await page.goto('file://' + PAGE);
    const rows = await page.evaluate(() => {
      const set = new Set(['mona', 'renet-tilley', 'ice-cream-kitty']);
      const fixtures = [
        'hi @mona', '@mon', '@mona-', 'cc @mona.', '_@mona_', '(@mona)', '**@mona**', '~@mona~',
        '@renet-tilley, @mona!', '@Mona', 'email a@mona', '@mona_bar', '@ice-cream-kitty done',
        'plain, no mention', '@nobody here', 'two @mona and @renet-tilley', '@mona_', '@mona.-',
      ];
      const keysFrom = (html, cls) => {
        const re = new RegExp('class="' + cls + '">@([^<]+)<', 'g');
        const out = []; let m;
        while ((m = re.exec(html)) !== null) out.push(m[1]);
        return out;
      };
      return fixtures.map((s) => {
        const live = keysFrom(pjMentionHighlightHTML(s, set), 'pj-live-mention');
        // pjRichSpans on the room path (agentNames supplied) is the posted-message highlighter.
        const posted = keysFrom(pjRichSpans(s, null, set), 'pjmention');
        return { s, live, posted, ok: JSON.stringify(live) === JSON.stringify(posted) };
      });
    });
    for (const r of rows) {
      check(`[differential] live == posted mention classification for ${JSON.stringify(r.s)}`,
        r.ok, `live=${JSON.stringify(r.live)} posted=${JSON.stringify(r.posted)}`);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
