'use strict';
// Browser-check-functions: stateReason, card

/**
 * kosmos#8979 (and #8988 on a Mac): a Claude agent whose process stopped and was started again by its supervisor says so on its
 * card's pill (its hover and a screen reader's hidden text, never a line on the tile, #6716): "Restarted at <time>:
 * <why>." (engine/status.js restartedOf sets the card's restarted { at, why }; a good turn clears it).
 *
 * Drives the real card() builder with the golden card shape, in Chromium and WebKit, at desktop and phone width.
 * NEGATIVE ARM: the same idle card with no restarted says nothing about a restart.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-restarted-8979.js
 */

const nodePath = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-restarted-8979: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const BASE = require('./fixtures/agent-card.json');

(async () => {
  const fail = [];
  const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { chk(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h] of [[1100, 900], [390, 844]]) {
      const tag = '[' + engine + ' ' + w + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errs = [];
      page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate((base) => {
        if (typeof card !== 'function') return { error: 'card is not a function (renamed? re-anchor this check)' };
        const mk = (id, restarted) => Object.assign({}, base, {
          sessionName: 's-' + id, name: 'Agent ' + id, isNamedOurs: true, paneless: false, runner: 'claude',
          state: 'idle', stateConfidence: 'scraped', stateReported: false, stateReportedBy: null, stateEvidence: null,
          restarted,
        });
        const host = document.createElement('div');
        host.style.width = '320px';
        document.body.prepend(host);
        const at = new Date(Date.now() - 7 * 60e3);
        host.innerHTML = card(mk('left', { at: at.toISOString(), why: 'Claude stopped unexpectedly (exit code 3221225477 = 0xC0000005).' })) + card(mk('clear', null));
        const cards = [...host.querySelectorAll('.acard')];
        if (cards.length !== 2) return { error: 'expected 2 cards, got ' + cards.length };
        /* #6716 (Josh, 2026-10-20): no sentence on a tile. The words are the pill's hover and its visually hidden text. */
        const shown = (c) => [...c.querySelectorAll('*')].filter((e) => e.children.length === 0 && /Restarted at /.test(e.textContent))
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; });
        const pill = cards[0].querySelector('.astate');
        return { clock: at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), texts: cards.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
          visibleOnTile: shown(cards[0]).length, title: pill ? (pill.getAttribute('title') || '') : '' };
      }, BASE);
      if (r.error) { chk(false, tag + ' ' + r.error); await page.close(); continue; }
      const [left, clear] = r.texts;
      const want = 'Restarted at ' + r.clock + ': Claude stopped unexpectedly (exit code 3221225477 = 0xC0000005).';
      chk(r.title.includes(want), tag + ' the pill hover says when and why', r.title);
      chk(left.includes(want), tag + ' a screen reader hears it (the pill\'s hidden text)', left);
      chk(r.visibleOnTile === 0, tag + ' #6716: no sentence is drawn on the tile', String(r.visibleOnTile));
      chk(!/Restarted at /.test(clear), tag + ' NEGATIVE: an idle card with no restart says nothing about one', clear);
      chk(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
