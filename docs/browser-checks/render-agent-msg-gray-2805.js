'use strict';

/**
 * kosmos#2805: an AGENT message in the "Talk to <agent>" DM view wears a very
 * light gray bubble; the person's OWN message keeps the royal-blue wash.
 *
 * 🔑 Josh, 2026-09-11 (testing 0.6.56): "This dialog box is looking better with
 * the blue for me. Let's put a very light gray for messages from the agent."
 * This restores the `--k-sunk` agent tint that #2660 had dropped, now that the
 * dialog went white (#2711 item 6) so a light-gray bubble reads on it.
 *
 * ⚠️ WHAT IT MEASURES, AND WHY IT IS A RELATIONSHIP, NOT A LITERAL. It asserts
 * the agent bubble is (a) filled at all -- not transparent, the #2660 state it
 * came back from; (b) NOT the person's blue; (c) distinct from the DM panel it
 * sits on -- i.e. it did not dissolve into the surface, the trap web/index.html
 * already records (a `.theirs` fill that took `--k-surface` was invisible); and
 * (d) #2947: a WARM cream (R >= G >= B), not the neutral gray it started as and
 * not the person's blue. It does NOT pin an exact rgba: Josh can retune the
 * cream and this stays green, while a regression to transparent, to the blue,
 * to the surface colour, or back to a neutral/cool gray reds it. Measured IN THE
 * PAGE (computed backgrounds composited over what is behind them), so it is
 * render-mode independent -- headed and headless agree.
 *
 * #2947 (Josh, 2026-09-12): the agent bubble moved from the neutral --k-sunk
 * gray to an ultra-light cream (--agent-msg), with a subtle per-message shade
 * (data-am 0..4, a color-mix nudge) so a wall of bubbles stops reading as one
 * flat hex. This check now also probes that mechanism: same data-am -> same
 * shade (stable), different data-am -> different shade (variation), all cream.
 *
 * It loads the page over file:// and answers the thread poll from a fixture,
 * the same posture as render-talk.js: the paint is what `node --test` cannot
 * see, and this state (an agent row beside a person row) needs no server.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-agent-msg-gray-2805.js
 *
 * ⚠️ HEADED by default (like its siblings). `HEADED=0` on a machine with no
 * console session; the assertions are mode-independent either way.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

/* rgb/rgba string -> [r,g,b,a]. "transparent" and rgba(...,0) both give a=0.
   #2947: Chromium serializes a color-mix() result (the per-message cream shade)
   as `color(srgb r g b [/ a])` with 0..1 components, NOT `rgb(0..255)`. Without
   scaling those, spread/delta collapse to ~0 and every arm passes VACUOUSLY, so
   detect the srgb form and lift the three components to 0..255 (the alpha, if
   present after the slash, stays 0..1). */
function parse(c) {
  if (Array.isArray(c)) return c.length > 3 ? c.slice(0, 4) : [c[0], c[1], c[2], 1];
  if (!c || c === 'transparent') return [0, 0, 0, 0];
  const srgb = /^color\(\s*srgb\b/i.test(c);
  const n = (c.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return [0, 0, 0, 0];
  const s = srgb ? 255 : 1;
  return [n[0] * s, n[1] * s, n[2] * s, n.length > 3 ? n[3] : 1];
}
/* fg over bg -> composited [r,g,b] (fg alpha applied). Either arg may be a
   color string OR an already-parsed [r,g,b] triple, so composites can chain. */
function over(fg, bg) {
  const f = parse(fg); const g = parse(bg);
  const a = f[3];
  return [0, 1, 2].map((i) => f[i] * a + g[i] * (1 - a));
}
/* Max absolute per-channel difference between two composited rgb triples. */
function delta(a, b) { return Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i]))); }
/* Channel spread of an rgb triple -- 0 for a perfect gray. */
function spread(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]); }

const now = () => new Date().toISOString();
/* A fixture with an agent row (m.from set -> `.dm.theirs`) beside a person row
 * (a placed message, no `from` -> `.dm.mine`), so BOTH bubbles are on screen and
 * the "not the same colour as mine" comparison is real, not vacuous. */
const FX = {
  messages: [
    { from: 'April', at: now(), text: 'ready, board cleared. Ready for the updated version you wanted to test.' },
    { at: now(), text: 'what account are you on?', wire: null,
      delivery: { state: 'placed', because: null, paneState: 'working', paneNote: 'mid-task' } },
    { from: 'April', at: now(), text: 'I am on the shared account. Here is `kosmos whoami` output.' },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null,
  questionBecause: null, options: null,
};

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADED === '0',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  try {
    // Light and dark only, deliberately. The navy "world" theme's `--k-sunk` is
    // rgba(120,150,200,.08) -- a bluish inset by that theme's own design language,
    // not a neutral gray -- so the neutral-gray arm (d) is a light/dark claim and
    // navy is out of its scope. The other arms (filled, not-blue, reads-against-
    // panel) would hold there too, but are not asserted here.
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        // The page requests the open agent's avatar; under file:// there is no
        // server to serve it. That is this harness's condition, not a page defect.
        if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;
        errs.push('console ' + m.text());
      });
      await page.addInitScript(() => {
        window.__fx = null;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        // Refuse the app's 5s polls so they do not race the paint or fill the
        // console against file://.
        window.setInterval = () => 0;
        window.fetch = async (url) => {
          const u = String(url);
          if (u.includes('/thread')) return enc(window.__fx);
          if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
          return enc({});
        };
      });
      await page.goto(PAGE);
      await page.evaluate((f) => {
        window.__fx = f;
        // A bare assignment: the page declares `let CURRENT` (a lexical binding,
        // not a window property), and paintTalk reads that one.
        CURRENT = { sessionName: 'april', name: 'April' };
        document.getElementById('panel-detail').hidden = false;
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        // Clear `inert` the overlay sets on every body child, else the page is
        // non-hit-testable even after the overlay is hidden.
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      }, FX);
      await page.evaluate(() => paintTalk('april', 'April'));

      const m = await page.evaluate(() => {
        const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
        return {
          theirsCount: document.querySelectorAll('#d-dmthread .dm.theirs .dm-b').length,
          mineCount: document.querySelectorAll('#d-dmthread .dm.mine .dm-b').length,
          theirsBg: bg('#d-dmthread .dm.theirs .dm-b'),
          mineBg: bg('#d-dmthread .dm.mine .dm-b'),
          // #2947: the data-am the REAL dmRow render emitted on the agent bubble
          // (the probe below tests the CSS mechanism on synthetic elements; this
          // reads the actual production path, so a dropped/NaN/out-of-range
          // amShade would be caught). null when there is no agent bubble.
          theirsDataAm: (() => { const el = document.querySelector('#d-dmthread .dm.theirs .dm-b'); return el ? el.getAttribute('data-am') : null; })(),
          // The panel the bubbles sit on, and the page behind it -- for the
          // "did it dissolve into the surface" comparison, composited in order.
          talkBoxBg: bg('#d-talk-box'),
          bodyBg: getComputedStyle(document.body).backgroundColor,
        };
      });
      const t = `[${theme}]`;

      // Positive controls: the fixture actually rendered both kinds of bubble,
      // so every comparison below is real rather than vacuous.
      chk(m.theirsCount >= 1, `${t} an agent bubble (.dm.theirs .dm-b) is on screen`, `count=${m.theirsCount}`);
      chk(m.mineCount >= 1, `${t} a person bubble (.dm.mine .dm-b) is on screen`, `count=${m.mineCount}`);
      // #2947: the REAL dmRow render emits a valid per-message shade index (0..4),
      // so amShade never drops the attribute or produces NaN/out-of-range.
      chk(/^[0-4]$/.test(m.theirsDataAm || ''), `${t} the real agent bubble carries a valid data-am (0..4)`, `data-am=${m.theirsDataAm}`);

      if (m.theirsCount >= 1 && m.mineCount >= 1) {
        const theirs = parse(m.theirsBg);
        // (a) filled at all -- not the transparent #2660 state.
        chk(theirs[3] > 0, `${t} the agent bubble carries a fill (not transparent)`, m.theirsBg);
        // (b) not the person's blue. Threshold 4, not 8: at today's exact tokens
        // the real gray-vs-blue delta is ~8.65 (light), so a tighter bound risks a
        // false RED on a legitimate retune of either token. A reused-blue regression
        // (theirs == mine) gives delta ~0 and still fails here; the neutral-gray arm
        // (d) is a second backstop for it, since blue's channel spread is large.
        chk(delta(over(m.theirsBg, m.talkBoxBg), over(m.mineBg, m.talkBoxBg)) >= 4,
          `${t} the agent gray is distinct from the person's blue`,
          `theirs=${m.theirsBg} mine=${m.mineBg}`);
        // (c) distinct from the surface it sits on -- did NOT dissolve.
        const surface = over(m.talkBoxBg, m.bodyBg);
        chk(delta(over(m.theirsBg, surface), surface) >= 4,
          `${t} the agent bubble reads against the DM panel (did not dissolve into the surface)`,
          `theirs=${m.theirsBg} panel=${m.talkBoxBg}`);
        // (d) #2947: a WARM cream, not a neutral gray and not a loud tint. The
        // composited bubble reads warm (R >= G >= B, with a real red-over-blue
        // margin), which is the opposite of the neutral --k-sunk gray (whose
        // faint cool cast makes B the highest channel) and of the person's blue
        // (B dominant). The spread stays small so it is still ultra-light and
        // subtle. A regression to the old gray, or to the blue, reds this.
        const cream = over(m.theirsBg, surface);
        chk(cream[0] >= cream[1] && cream[1] >= cream[2] && (cream[0] - cream[2]) >= 2 && spread(cream) <= 20,
          `${t} the agent bubble is a warm cream (R>=G>=B), not a neutral gray or the blue`,
          `composited=[${cream.map((x) => x.toFixed(1)).join(', ')}]`);
      }

      // #2947: the per-message VARIATION mechanism, probed deterministically so
      // it does not depend on which shades the fixture's two messages hashed to.
      // Same data-am must render the SAME shade (stable, no shimmer on repaint);
      // different data-am must render DIFFERENT shades (the "break in a single
      // hex" Josh asked for); and every shade stays a warm cream.
      const vary = await page.evaluate(() => {
        const host = document.getElementById('d-dmthread');
        const shadeOf = (am) => {
          const row = document.createElement('div'); row.className = 'dm theirs';
          const b = document.createElement('div'); b.className = 'dm-b';
          if (am != null) b.setAttribute('data-am', String(am));
          b.textContent = 'x'; row.appendChild(b); host.appendChild(row);
          const c = getComputedStyle(b).backgroundColor; row.remove(); return c;
        };
        return { a1: shadeOf(1), a1b: shadeOf(1), a3: shadeOf(3), a0: shadeOf(0) };
      });
      chk(vary.a1 === vary.a1b, `${t} the same data-am renders the same shade (stable, no shimmer)`, vary.a1);
      chk(vary.a1 !== vary.a3, `${t} different data-am render different shades (a break in the single hex)`, `am1=${vary.a1} am3=${vary.a3}`);
      for (const [k, c] of [['am1', vary.a1], ['am3', vary.a3], ['am0(base)', vary.a0]]) {
        const p = parse(c);
        chk(p[0] >= p[1] && p[1] >= p[2] && (p[0] - p[2]) >= 2, `${t} shade ${k} is a warm cream`, c);
      }

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
