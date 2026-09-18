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
 * gray to an ultra-light cream (--agent-msg). #3260 (Josh, 2026-09-18): agent
 * messages are ONE fixed color -- the earlier per-message variation was removed,
 * so this check now probes the opposite: a data-am attribute has NO effect on the
 * color (every agent bubble renders the identical base cream), all warm cream.
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
   Defensive srgb scaler: Chromium serializes a color-mix() result as
   `color(srgb r g b [/ a])` with 0..1 components, NOT `rgb(0..255)`, and without
   scaling those, spread/delta collapse to ~0 and every arm passes VACUOUSLY. The
   agent color is now a plain hex (#3260 removed the color-mix nudges) so this
   branch is currently inert, but it is kept so any future color-mix color is
   scaled rather than passing vacuously (the alpha, if present after the slash,
   stays 0..1). */
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
          // #3260: the REAL dmRow render no longer emits data-am (agent messages
          // are one fixed color), so this reads the production agent bubble's
          // data-am to confirm it is absent (asserted null below). null also when
          // there is no agent bubble.
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
      // #3260 (Josh, 2026-09-18): agent messages are ONE fixed color -- the REAL
      // dmRow render no longer emits a per-message data-am, so the production agent
      // bubble carries no such attribute. A regression re-adding it fails here.
      chk(m.theirsDataAm === null, `${t} the real agent bubble carries NO data-am (one fixed color, #3260)`, `data-am=${m.theirsDataAm}`);

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

      // #3260 (Josh, 2026-09-18): agent messages are ONE fixed color -- the #2947
      // per-message variation was removed. Probed by construction: a data-am
      // attribute must now have NO effect on the bubble color (the color-mix nudge
      // rules are gone), so every agent bubble renders the identical base cream. A
      // regression re-adding the nudge rules would make the shades differ and red
      // this. The base still reads as a warm cream.
      const flat = await page.evaluate(() => {
        const host = document.getElementById('d-dmthread');
        const shadeOf = (am) => {
          const row = document.createElement('div'); row.className = 'dm theirs';
          const b = document.createElement('div'); b.className = 'dm-b';
          if (am != null) b.setAttribute('data-am', String(am));
          b.textContent = 'x'; row.appendChild(b); host.appendChild(row);
          const c = getComputedStyle(b).backgroundColor; row.remove(); return c;
        };
        return { base: shadeOf(null), am1: shadeOf(1), am3: shadeOf(3) };
      });
      chk(flat.base === flat.am1 && flat.base === flat.am3,
        `${t} a data-am attribute no longer changes the agent bubble color (one fixed color, #3260)`,
        `base=${flat.base} am1=${flat.am1} am3=${flat.am3}`);
      { const p = parse(flat.base);
        chk(p[0] >= p[1] && p[1] >= p[2] && (p[0] - p[2]) >= 2, `${t} the one agent color is a warm cream`, flat.base); }

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
