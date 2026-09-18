'use strict';

/**
 * kosmos#3264 (Josh, brand-owner, 2026-09-18): the CONSOLIDATED view's message ground
 * is WHITE (--k-surface), like the tab view. Verbatim: "the background is supposed to be
 * white just like it is on the tab view." This reverses #980 iter-5's cream (--k-bg) tuning.
 *
 * The load-bearing coupling is that FOUR things must move together, or a mismatched band
 * (or a tail sliver) returns -- glaring in dark:
 *   - the consolidated .pj3 > .pjmid ground,
 *   - its sticky .pjmid .composer (which #980 repainted to --k-bg to hide the band),
 *   - the agent wing-carve `.msg:not(.you) .msg-bd::after` mask,
 *   - the operator's OWN wing-carve `.msg.you .msg-bd::after` mask (both masks match the
 *     GROUND behind the bubble, not the bubble tint, so a --k-bg sliver shows at the tail
 *     tip on a white ground if either is missed -- an 11/channel darker sliver in dark).
 *
 * WHAT IT MEASURES, and why it is render-mode independent: the COMPUTED background-color of
 * each, compared token-to-token against a painted `var(--k-surface)` probe (and asserted
 * DISTINCT from a `var(--k-bg)` probe -- the cream it came from). It pins the TOKEN, not an
 * exact rgb, so Josh can retune --k-surface and this stays green, while a regression of any of
 * the three back to --k-bg reds it. Computed colors agree headed and headless.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-consolidated-white-3264.js
 *
 * HEADED by default (like its siblings); HEADED=0 on a no-console machine -- the assertions
 * are computed-color facts, mode-independent either way.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};
const norm = (c) => String(c).replace(/\s+/g, '');

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
        if (/ERR_FILE_NOT_FOUND/.test(m.text())) return; // file:// avatar 404, harness condition
        errs.push('console ' + m.text());
      });
      await page.addInitScript(() => {
        // Refuse the app's polls (they would race the paint) and stub fetch so its API calls
        // do not error against file:// -- the harness's condition, not a page defect (the
        // sibling render checks do the same).
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async (url) => {
          if (String(url).includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
          return enc({});
        };
      });
      await page.goto(PAGE);

      const r = await page.evaluate(() => {
        // Paint two probes to resolve the tokens to concrete rgb in THIS theme.
        const probe = document.createElement('div');
        document.body.appendChild(probe);
        probe.style.background = 'var(--k-surface)'; const surface = getComputedStyle(probe).backgroundColor;
        probe.style.background = 'var(--k-bg)'; const bg = getComputedStyle(probe).backgroundColor;

        // NO-REGRESSION control: carves OUTSIDE the consolidated layout keep --k-bg (the global
        // rules the consolidated-scoped #3264 override must not leak into -- i.e. the tab view).
        // BOTH arms: the agent (.msg:not(.you)) AND the operator's own (.msg.you) carve.
        const tabMsg = document.createElement('div'); tabMsg.className = 'msg';
        const tabBd = document.createElement('div'); tabBd.className = 'msg-bd'; tabBd.textContent = 'x';
        tabMsg.appendChild(tabBd); document.body.appendChild(tabMsg);
        const tabCarve = getComputedStyle(tabBd, '::after').backgroundColor;
        const tabYouMsg = document.createElement('div'); tabYouMsg.className = 'msg you';
        const tabYouBd = document.createElement('div'); tabYouBd.className = 'msg-bd'; tabYouBd.textContent = 'x';
        tabYouMsg.appendChild(tabYouBd); document.body.appendChild(tabYouMsg);
        const tabYouCarve = getComputedStyle(tabYouBd, '::after').backgroundColor;

        // Now switch to CONSOLIDATED and inject the structure the #3264 rules target.
        document.documentElement.setAttribute('data-layout', 'consolidated');
        document.body.classList.add('consolidated');
        const pj3 = document.createElement('div'); pj3.className = 'pj3';
        const pjmid = document.createElement('div'); pjmid.className = 'pjmid';
        const composer = document.createElement('div'); composer.className = 'composer';
        const msg = document.createElement('div'); msg.className = 'msg'; // agent (:not(.you)) -> the carve applies
        const bd = document.createElement('div'); bd.className = 'msg-bd'; bd.textContent = 'x';
        // The operator's OWN message also mounts in the consolidated discussion (the room
        // renderer adds .you for isOp). Its tail carve must ALSO go white, or a --k-bg sliver
        // shows at its tail tip on the white ground (glaring in dark). Cover both arms.
        const youMsg = document.createElement('div'); youMsg.className = 'msg you';
        const youBd = document.createElement('div'); youBd.className = 'msg-bd'; youBd.textContent = 'x';
        youMsg.appendChild(youBd);
        msg.appendChild(bd); pjmid.appendChild(msg); pjmid.appendChild(youMsg); pjmid.appendChild(composer); pj3.appendChild(pjmid);
        document.body.appendChild(pj3);
        const cs = (el, pseudo) => getComputedStyle(el, pseudo || null).backgroundColor;
        const out = {
          surface, bg, tabCarve, tabYouCarve,
          pjmid: cs(pjmid),
          composer: cs(composer),
          carve: cs(bd, '::after'),
          youCarve: cs(youBd, '::after'),
        };
        pj3.remove(); tabMsg.remove(); tabYouMsg.remove(); probe.remove();
        return out;
      });
      const t = `[${theme}]`;

      // Control: the two tokens are distinct, so "== surface AND != bg" is a real test, not vacuous.
      chk(norm(r.surface) !== norm(r.bg),
        `${t} --k-surface and --k-bg are distinct tokens (control)`, `surface=${r.surface} bg=${r.bg}`);
      chk(norm(r.pjmid) === norm(r.surface) && norm(r.pjmid) !== norm(r.bg),
        `${t} consolidated .pjmid ground is --k-surface (white), not --k-bg cream`, `pjmid=${r.pjmid} surface=${r.surface}`);
      chk(norm(r.composer) === norm(r.surface),
        `${t} consolidated sticky .composer matches --k-surface (no #980 mismatched band)`, `composer=${r.composer} surface=${r.surface}`);
      chk(norm(r.carve) === norm(r.surface),
        `${t} the agent wing-carve ::after is --k-surface (no cream tail sliver on the white ground)`, `carve=${r.carve} surface=${r.surface}`);
      chk(norm(r.youCarve) === norm(r.surface),
        `${t} the OPERATOR'S OWN (.msg.you) wing-carve ::after is --k-surface too (no dark sliver on its tail)`, `youCarve=${r.youCarve} surface=${r.surface}`);
      // NO tab-view regression: BOTH non-consolidated carves keep --k-bg (the override is scoped).
      chk(norm(r.tabCarve) === norm(r.bg),
        `${t} the NON-consolidated (tab) agent carve is untouched (still --k-bg) -- the #3264 override did not leak`, `tabCarve=${r.tabCarve} bg=${r.bg}`);
      chk(norm(r.tabYouCarve) === norm(r.bg),
        `${t} the NON-consolidated (tab) .msg.you carve is untouched (still --k-bg) -- no leak`, `tabYouCarve=${r.tabYouCarve} bg=${r.bg}`);

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
