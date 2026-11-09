'use strict';
// Browser-check-functions: stateReason, card

/**
 * kosmos#8286: a working agent that has been on one tool call for minutes says so, as #6249's sentence does (on its card's
 * pill: the hover and a screen reader's hidden text, never a line on the tile, #6716): "<Name> has been on one step for
 * about N minutes: <tool>. If that is a long job, it is fine; if not, open it to see what it shows." (engine/status.js
 * oneStepOf sets the card's oneStep { tool, since } from the agent's transcript, engine/onestep.js).
 *
 * Drives the real card() builder with the golden card shape, in Chromium and WebKit, at desktop and phone width, and
 * reads the rendered card: the pill's hover carries the sentence, a screen reader still hears it, and no element
 * drawn on the tile shows it.
 * NEGATIVE ARM: the same working card with no oneStep says nothing about a step.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-onestep-8286.js
 */

const nodePath = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-onestep-8286: playwright is not on NODE_PATH - SKIPPED, not passed.');
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
        const mk = (id, oneStep) => Object.assign({}, base, {
          sessionName: 's-' + id, name: 'Agent ' + id, isNamedOurs: true, paneless: false, runner: 'claude',
          state: 'working', stateConfidence: 'scraped', stateReported: false, stateReportedBy: null, stateEvidence: null,
          unsentInput: null, deliveryStall: null, oneStep,
        });
        const host = document.createElement('div');
        host.style.width = '320px';
        document.body.prepend(host);
        const since = new Date(Date.now() - 12 * 60e3).toISOString();
        host.innerHTML = card(mk('left', { tool: 'Bash', since })) + card(mk('clear', null));
        const cards = [...host.querySelectorAll('.acard')];
        if (cards.length !== 2) return { error: 'expected 2 cards, got ' + cards.length };
        /* #6716 (Josh, 2026-10-20): no sentence on a tile. The words are the pill's hover and its visually hidden text. */
        const shown = (c) => [...c.querySelectorAll('*')].filter((e) => e.children.length === 0 && /on one step for/.test(e.textContent))
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; });
        const pill = cards[0].querySelector('.astate');
        return { texts: cards.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
          visibleOnTile: shown(cards[0]).length, title: pill ? (pill.getAttribute('title') || '') : '' };
      }, BASE);
      if (r.error) { chk(false, tag + ' ' + r.error); await page.close(); continue; }
      const [left, clear] = r.texts;
      chk(/Agent left has been on one step for about 12 minutes: Bash\. If that is a long job, it is fine; if not, open it to see what it shows\./.test(r.title),
        tag + ' kosmos#8286: the pill hover says it, with the minutes and the tool', r.title);
      chk(/on one step for about 12 minutes/.test(left), tag + ' a screen reader still hears it (the pill\'s hidden text)', left);
      chk(r.visibleOnTile === 0, tag + ' #6716: no sentence is drawn on the tile', String(r.visibleOnTile));
      chk(!/one step/.test(clear), tag + ' NEGATIVE: a working card with no long step says nothing about one', clear);
      chk(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
