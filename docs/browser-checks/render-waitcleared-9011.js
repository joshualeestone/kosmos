'use strict';
// Browser-check-functions: stateReason, card, pillSay, pillVh

/**
 * kosmos#9011: when an agent's own question (or what it was blocked on) was ended recently, its card's pill says when
 * and by what (its hover and a screen reader's hidden text, never a line on the tile, #6716): the agent itself, the
 * person, leaving the project, starting again, or the session ending (engine/status.js waitClearedOf).
 *
 * Drives the real card() builder with the golden card shape, in Chromium and WebKit, at desktop and phone width. The
 * card only: the list row reads the same pillSay.
 * NEGATIVE ARMS: an idle card with no waitCleared says none of it; a needs_you card with one does not either (a wait
 * standing again says itself).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-waitcleared-9011.js
 */

const nodePath = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-waitcleared-9011: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const BASE = require('./fixtures/agent-card.json');

const ENDS = {
  agent: ' was closed at {T} by the agent itself.',
  person: ' was closed at {T} by you.',
  left: ' was closed at {T} when it left the project.',
  restart: ' was set aside at {T} when it started again.',
  ended: ' was set aside at {T} when its session ended.',
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
      const r = await page.evaluate(({ base, kinds }) => {
        if (typeof card !== 'function') return { error: 'card is not a function (renamed? re-anchor this check)' };
        /* Inside today, so the page says the bare clock at any hour. */
        const today = new Date(); today.setHours(0, 1, 0, 0);
        const at = new Date(Math.max(Date.now() - 25 * 60e3, today.getTime()));
        const mk = (id, extra) => Object.assign({}, base, {
          sessionName: 's-' + id, name: 'Agent ' + id, isNamedOurs: true, paneless: false, runner: 'claude',
          state: 'idle', stateConfidence: 'structured', stateReported: true, stateReportedBy: 'agent', stateEvidence: null,
          because: 'May I merge the pull request secret-plan?', restarted: null,
        }, extra);
        const rows = [
          ...kinds.map((k) => [k, { waitCleared: { at: at.toISOString(), by: k, state: 'needs_you', held: true } }]),
          ['blocked', { state: 'working', waitCleared: { at: at.toISOString(), by: 'agent', state: 'blocked', held: false } }],
          ['none', { waitCleared: null }],
          ['waiting', { state: 'needs_you', waitCleared: { at: at.toISOString(), by: 'restart', state: 'needs_you', held: false } }],
        ];
        const host = document.createElement('div');
        host.style.width = '320px';
        document.body.prepend(host);
        host.innerHTML = rows.map(([id, extra]) => card(mk(id, extra))).join('');
        const cards = [...host.querySelectorAll('.acard')];
        if (cards.length !== rows.length) return { error: 'expected ' + rows.length + ' cards, got ' + cards.length };
        /* #6716 (Josh, 2026-10-20): no sentence on a tile. */
        const drawn = (c) => [...c.querySelectorAll('*')].filter((e) => e.children.length === 0 && /was (closed|set aside) at/.test(e.textContent))
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; }).length;
        return { clock: at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), rows: rows.map(([id], i) => {
          const pill = cards[i].querySelector('.astate');
          return { id, title: pill ? (pill.getAttribute('title') || '') : '', text: cards[i].textContent.replace(/\s+/g, ' ').trim(), drawn: drawn(cards[i]) };
        }) };
      }, { base: BASE, kinds: Object.keys(ENDS) });
      if (r.error) { chk(false, tag + ' ' + r.error); await page.close(); continue; }
      for (const row of r.rows) {
        if (row.id === 'none' || row.id === 'waiting') {
          chk(!/was (closed|set aside) at/.test(row.title + row.text), tag + ' NEGATIVE: ' + row.id + ': nothing about an ended wait', row.title);
          continue;
        }
        const want = (row.id === 'blocked' ? 'What it was waiting on' : 'Its question for you')
          + (row.id === 'blocked' ? ENDS.agent : ENDS[row.id]).replace('{T}', r.clock);
        chk(row.title.includes(want), tag + ' ' + row.id + ': the pill hover says what ended the wait', row.title);
        chk(row.text.includes(want), tag + ' ' + row.id + ': a screen reader hears it (the pill\'s hidden text)', row.text);
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
