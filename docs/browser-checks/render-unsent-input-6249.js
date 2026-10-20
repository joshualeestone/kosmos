'use strict';
// Browser-check-functions: stateReason, card

/**
 * #6249: an agent whose input box has held unsent text for a few minutes says so (since #6716 on its card's pill: the
 * hover and a screen reader's hidden text, never a line on the tile), "Text has been sitting
 * unsent in its input box for about N minutes, and Kosmos's messages to it may wait behind it. Open it to send it with Enter." (engine/status.js
 * unsentInputOf sets the card's unsentInput.since).
 *
 * Drives the real card() builder with the golden card shape, in Chromium and WebKit, at desktop and phone width, and
 * reads the rendered card: the pill's hover carries the sentence, a screen reader still hears it, and no element
 * drawn on the tile shows it.
 * NEGATIVE ARM: the same idle card with no unsentInput says nothing about an input box.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-unsent-input-6249.js
 */

const nodePath = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-unsent-input-6249: playwright is not on NODE_PATH - SKIPPED, not passed.');
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
        const mk = (id, unsentInput) => Object.assign({}, base, {
          sessionName: 's-' + id, name: 'Agent ' + id, isNamedOurs: true, paneless: false, runner: 'claude',
          state: 'idle', stateConfidence: 'scraped', stateReported: false, stateReportedBy: null, stateEvidence: null,
          unsentInput,
        });
        const host = document.createElement('div');
        host.style.width = '320px';
        document.body.prepend(host);
        const since = new Date(Date.now() - 7 * 60e3).toISOString();
        host.innerHTML = card(mk('left', { since })) + card(mk('clear', null));
        const cards = [...host.querySelectorAll('.acard')];
        if (cards.length !== 2) return { error: 'expected 2 cards, got ' + cards.length };
        /* #6716 (Josh, 2026-10-20): no sentence on a tile. The words are the pill's hover and its visually hidden text. */
        const shown = (c) => [...c.querySelectorAll('*')].filter((e) => e.children.length === 0 && /sitting unsent in its input box/.test(e.textContent))
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; });
        const pill = cards[0].querySelector('.astate');
        return { texts: cards.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
          visibleOnTile: shown(cards[0]).length, title: pill ? (pill.getAttribute('title') || '') : '' };
      }, BASE);
      if (r.error) { chk(false, tag + ' ' + r.error); await page.close(); continue; }
      const [left, clear] = r.texts;
      chk(/Text has been sitting unsent in its input box for about 7 minutes, and Kosmos's messages to it may wait behind it\./.test(r.title),
        tag + ' #6716: the pill hover says it, with the minutes', r.title);
      chk(/sitting unsent in its input box/.test(left), tag + ' a screen reader still hears it (the pill\'s hidden text)', left);
      chk(r.visibleOnTile === 0, tag + ' #6716: no sentence is drawn on the tile', String(r.visibleOnTile));
      chk(!/input box/.test(clear), tag + ' NEGATIVE: an idle card with an empty box says nothing about it', clear);
      chk(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
