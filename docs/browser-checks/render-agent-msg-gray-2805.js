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
 * (d) a NEUTRAL gray, not a tint. It does NOT pin `--k-sunk`'s exact rgba: Josh
 * can retune the gray and this stays green, while a regression to transparent,
 * to the blue, or to the surface colour reds it. Measured IN THE PAGE (computed
 * backgrounds composited over what is behind them), so it is render-mode
 * independent -- headed and headless agree.
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

/* rgb/rgba string -> [r,g,b,a]. "transparent" and rgba(...,0) both give a=0. */
function parse(c) {
  if (Array.isArray(c)) return c.length > 3 ? c.slice(0, 4) : [c[0], c[1], c[2], 1];
  if (!c || c === 'transparent') return [0, 0, 0, 0];
  const n = (c.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return [0, 0, 0, 0];
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
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

      if (m.theirsCount >= 1 && m.mineCount >= 1) {
        const theirs = parse(m.theirsBg);
        // (a) filled at all -- not the transparent #2660 state.
        chk(theirs[3] > 0, `${t} the agent bubble carries a fill (not transparent)`, m.theirsBg);
        // (b) not the person's blue.
        chk(delta(over(m.theirsBg, m.talkBoxBg), over(m.mineBg, m.talkBoxBg)) > 8,
          `${t} the agent gray is distinct from the person's blue`,
          `theirs=${m.theirsBg} mine=${m.mineBg}`);
        // (c) distinct from the surface it sits on -- did NOT dissolve.
        const surface = over(m.talkBoxBg, m.bodyBg);
        chk(delta(over(m.theirsBg, surface), surface) >= 4,
          `${t} the agent bubble reads against the DM panel (did not dissolve into the surface)`,
          `theirs=${m.theirsBg} panel=${m.talkBoxBg}`);
        // (d) a neutral gray, not a tint. Generous tolerance so a retune of the
        // exact gray stays green; a coloured wash (e.g. reusing the blue) reds.
        chk(spread(over(m.theirsBg, surface)) <= 12,
          `${t} the agent bubble is a neutral gray, not a tint`,
          `composited spread=${spread(over(m.theirsBg, surface)).toFixed(1)}`);
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
