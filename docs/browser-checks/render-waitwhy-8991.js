'use strict';
// Browser-check-functions: stateReason, card

/**
 * kosmos#8991: an agent waiting on the person says why in plain words on its card's pill (its hover and a screen
 * reader's hidden text, never a line on the tile, #6716): a question, a question held until the person is back, a
 * permission prompt, or anything else it waits on the person for. Fixed words; the agent's own `because` never shows.
 *
 * Drives the real card() builder with the golden card shape, in Chromium and WebKit, at desktop and phone width. The
 * card only: the list row's pill reads the same pillSay, and the empty task lines are pinned by engine/waitwhy-8991.test.js.
 * NEGATIVE ARMS: an idle, a working and a usage-limited card say none of these sentences (each carrying the fields
 * that pick a sentence, so only the needs_you guard keeps them out).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-waitwhy-8991.js
 */

const nodePath = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-waitwhy-8991: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const BASE = require('./fixtures/agent-card.json');

const WANT = {
  question: 'It has asked you a question and is waiting for your answer. Open it to answer.',
  held: 'It has a question for you and is holding it until you are back. Open it to answer.',
  /* Read off the screen (the cards below are scraped), so hedged as #874's sign-in and limit sentences are. */
  permission: 'Looks like it is waiting for your permission to go on. Open it to answer.',
  other: 'Looks like it is waiting for you. Open it to see what it needs.',
};

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
      const r = await page.evaluate(({ base, want }) => {
        if (typeof card !== 'function') return { error: 'card is not a function (renamed? re-anchor this check)' };
        const mk = (id, extra) => Object.assign({}, base, {
          sessionName: 's-' + id, name: 'Agent ' + id, isNamedOurs: true, paneless: false, runner: 'claude',
          state: 'needs_you', stateConfidence: 'scraped', stateReported: false, stateReportedBy: null, stateEvidence: null,
          because: 'May I push the branch secret-plan?', restarted: null,
        }, extra);
        const kinds = [
          ['question', { stateReported: true, stateReportedBy: 'agent', stateConfidence: 'reported' }],
          ['held', { stateReported: true, stateReportedBy: 'agent', stateConfidence: 'reported', stateHeld: true }],
          ['permission', { awaitingApproval: true }],
          ['other', {}],
          ['idle', { state: 'idle', because: null }],
          ['working', { state: 'working', because: null, stateReportedBy: 'agent', awaitingApproval: true }],
          ['limited', { state: 'rate_limited', because: null, stateReportedBy: 'agent' }],
        ];
        const host = document.createElement('div');
        host.style.width = '320px';
        document.body.prepend(host);
        host.innerHTML = kinds.map(([id, extra]) => card(mk(id, extra))).join('');
        const cards = [...host.querySelectorAll('.acard')];
        if (cards.length !== kinds.length) return { error: 'expected ' + kinds.length + ' cards, got ' + cards.length };
        const sentences = Object.values(want);
        /* #6716 (Josh, 2026-10-20): no sentence on a tile. The words are the pill's hover and its visually hidden text. */
        const drawn = (c) => [...c.querySelectorAll('*')].filter((e) => e.children.length === 0 && sentences.some((s) => e.textContent.includes(s)))
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; }).length;
        return { rows: kinds.map(([id], i) => {
          const pill = cards[i].querySelector('.astate');
          return { id, title: pill ? (pill.getAttribute('title') || '') : '', text: cards[i].textContent.replace(/\s+/g, ' ').trim(), drawn: drawn(cards[i]) };
        }) };
      }, { base: BASE, want: WANT });
      if (r.error) { chk(false, tag + ' ' + r.error); await page.close(); continue; }
      for (const row of r.rows) {
        if (!(row.id in WANT)) {
          const said = Object.values(WANT).filter((s) => row.title.includes(s) || row.text.includes(s));
          chk(said.length === 0, tag + ' NEGATIVE: a ' + row.id + ' card says none of the waiting-on-you sentences', said.join(' | '));
          continue;
        }
        chk(row.title.includes(WANT[row.id]), tag + ' ' + row.id + ': the pill hover says why it waits', row.title);
        chk(row.text.includes(WANT[row.id]), tag + ' ' + row.id + ': a screen reader hears it (the pill\'s hidden text)', row.text);
        chk(!/secret-plan/.test(row.title + row.text), tag + ' ' + row.id + ': the agent\'s own words do not show', row.title);
        chk(row.drawn === 0, tag + ' ' + row.id + ': #6716: no sentence is drawn on the tile', String(row.drawn));
      }
      chk(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
