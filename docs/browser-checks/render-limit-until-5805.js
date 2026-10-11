'use strict';

/**
 * #5805 slice 3: a Claude agent out of usage says when its usage comes back on its card, "Out of usage until <time>",
 * from the card's limitUntil (the reset its limit line printed, dated or not; engine/status.js claudeLimitUntil). Past
 * that time it says nothing about a time (its limit line stays on screen until something is typed).
 *
 * Drives the real card() builder with the golden card shape and reads the rendered card's text.
 * NEGATIVE ARMS: a past limitUntil and no limitUntil both keep the hedge ("Looks like a usage limit"), so a card that
 * said a time for every capped agent would fail.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-limit-until-5805.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-limit-until-5805: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const BASE = require('./fixtures/agent-card.json');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-limit-until-5805: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate((base) => {
    if (typeof card !== 'function') return { error: 'card is not a function (renamed? re-anchor this check)' };
    const mk = (id, limitUntil) => Object.assign({}, base, {
      sessionName: 's-' + id, name: 'Agent ' + id, isNamedOurs: true, paneless: false, runner: 'claude',
      state: 'rate_limited', stateConfidence: 'scraped', stateReported: false, stateReportedBy: null,
      stateEvidence: "You've hit your session limit · resets 4pm (America/Chicago)", limitUntil,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ahead = new Date(Date.now() + 2 * 3600e3).toISOString();
    const past = new Date(Date.now() - 5 * 60e3).toISOString();
    host.innerHTML = card(mk('ahead', ahead)) + card(mk('past', past)) + card(mk('none', null));
    const cards = [...host.querySelectorAll('.acard')];
    if (cards.length !== 3) return { error: 'expected 3 cards, got ' + cards.length };
    return { texts: cards.map((c) => c.textContent.replace(/\s+/g, ' ').trim()) };
  }, BASE);

  const fail = [];
  const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
  if (r.error) chk(false, r.error);
  else {
    const [ahead, past, none] = r.texts;
    console.log('  ahead: ' + ahead + '\n  past:  ' + past + '\n  none:  ' + none);
    chk(/Out of usage until \d{1,2}:\d{2}/.test(ahead), 'a reset ahead: the card says Out of usage until <time>', ahead);
    chk(!/Out of usage until/.test(past) && /Looks like a usage limit/.test(past), 'NEGATIVE: a reset that passed says no time', past);
    chk(!/Out of usage until/.test(none) && /Looks like a usage limit/.test(none), 'NEGATIVE: no reset read says no time', none);
  }
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
