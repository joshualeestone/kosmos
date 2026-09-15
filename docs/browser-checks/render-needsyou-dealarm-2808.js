'use strict';

/**
 * #2808 class 2 (Josh, 2026-09-14 16:49): a needs_you the agent reported DELIBERATELY
 * (stateReportedBy 'agent' -- its own substantive question, e.g. an agent asking the operator
 * to pick a visual direction) renders as a CALM "Has a question" card, NOT the red "Needs you" alarm a QA
 * tester read as "the app is broken". The technical permission/trust junk (by:'auto', class 1)
 * and a scraped prompt (null provenance) STAY red -- only the KNOWN agent case is de-alarmed.
 *
 * 🛑 WHY A BROWSER CHECK. The complaint was VISUAL. The node test (web.needsyou-dealarm-2808)
 * proves cardStOf/stateCopyOf RETURN the calm 'question' shape; it cannot prove that
 * `.acard.question` / `.astate.st-question` actually RENDER a non-red border and a calm glyph.
 * This drives the real card() builder and reads the COMPUTED border color, the state class and
 * the glyph -- style facts no unit test sees.
 *
 * ⚠️ TWO NEGATIVE ARMS, load-bearing: a class-1 (auto) needs_you MUST stay red (it is
 * PigeonPete's invisible-handle target, and the red is the fallback if the handle ever misses),
 * and a SCRAPED needs_you (null provenance) MUST stay red (absence is never "an agent typed it",
 * selfreport.js:389). Without both, a too-broad de-alarm that calmed every needs_you would pass.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-needsyou-dealarm-2808.js
 *
 * ⚠️ HEADED by default (matches the others here). HEADED=0 on a console-less machine; the
 * verdicts are computed DOM (border color, classes, glyph presence), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-needsyou-dealarm-2808: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
// The golden card shape (every field card() reads), so the fabricated agents render the real
// card rather than a minimal stub that misses a branch. It carries stateReportedBy since #2808.
const BASE = require('./fixtures/agent-card.json');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-needsyou-dealarm-2808: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate((base) => {
    if (typeof card !== 'function') return { error: 'card is not a function (renamed? re-anchor this check)' };
    // by:'agent' = class 2 (calm), by:'auto' = class 1 (control, stays red), null = scraped/legacy
    // (control, stays red). isNamedOurs true + paneless false so the real needs_you card path runs.
    const mk = (by) => Object.assign({}, base, {
      sessionName: 's-' + (by || 'scraped'), name: 'Agent', isNamedOurs: true, paneless: false,
      state: 'needs_you', stateReported: by !== null, stateReportedBy: by,
      because: by === 'agent' ? 'Which venue for the launch?' : 'asking permission to use Bash',
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = card(mk('agent')) + card(mk('auto')) + card(mk(null));
    const cards = host.querySelectorAll('.acard');
    if (cards.length !== 3) return { error: 'expected 3 cards, got ' + cards.length };
    const read = (c) => {
      const p = c.querySelector('.astate');
      const b = p ? p.querySelector('b') : null;
      return {
        acardClass: c.className,
        pillClass: p ? p.className : '(no pill)',
        label: b ? b.textContent : '',
        border: getComputedStyle(c).borderColor,
        glyphAsk: !!c.querySelector('.astate .ask'),
        glyphHaz: !!c.querySelector('.astate .haz'),
      };
    };
    return { q: read(cards[0]), auto: read(cards[1]), scr: read(cards[2]) };
  }, BASE);

  await browser.close();

  if (r.error) { console.error('FAIL  render-needsyou-dealarm-2808: ' + r.error); process.exit(1); }

  const fail = [];
  // Class 2 (the agent's own question): CALM.
  if (/\battn\b/.test(r.q.acardClass)) fail.push('a class-2 agent question got the RED attn card wash (' + r.q.acardClass + ')');
  if (!/\bquestion\b/.test(r.q.acardClass)) fail.push('a class-2 card lacks the calm "question" class (' + r.q.acardClass + ')');
  if (!/st-question\b/.test(r.q.pillClass)) fail.push('a class-2 pill is not st-question (' + r.q.pillClass + ')');
  if (!/has a question/i.test(r.q.label)) fail.push('a class-2 card does not read "Has a question" (' + JSON.stringify(r.q.label) + ')');
  if (!r.q.glyphAsk || r.q.glyphHaz) fail.push('a class-2 card shows the red hazard ! instead of the calm ? glyph (' + JSON.stringify(r.q) + ')');
  // Negative arm 1: class 1 (auto) stays red.
  if (!/\battn\b/.test(r.auto.acardClass)) fail.push('a class-1 (auto) needs_you LOST its red attn - class 1 must stay red as PigeonPete\'s fallback (' + r.auto.acardClass + ')');
  if (!/needs you/i.test(r.auto.label)) fail.push('a class-1 card no longer reads "Needs you" (' + JSON.stringify(r.auto.label) + ')');
  // Negative arm 2: a scraped needs_you (null provenance) stays red.
  if (!/\battn\b/.test(r.scr.acardClass)) fail.push('a SCRAPED needs_you (null provenance) was wrongly calmed - only KNOWN by:agent is de-alarmed (' + r.scr.acardClass + ')');
  // Computed-color proof: the calm border must actually differ from the red one, or .acard.question
  // is not overriding and the "calm" card still paints like the alarm.
  if (r.q.border === r.auto.border) fail.push('the calm class-2 border is the SAME computed color as the red class-1 border (' + r.q.border + ') - .acard.question is not overriding');

  if (fail.length) {
    console.error('FAIL  render-needsyou-dealarm-2808: ' + fail.join('; '));
    console.error('  measured=' + JSON.stringify(r));
    process.exit(1);
  }
  console.log('render-needsyou-dealarm-2808: a deliberate agent question renders as a calm "Has a question" card (no red attn, calm ? glyph, a border color distinct from the alarm); a class-1 (auto) and a scraped needs_you both stay red. PASS');
})().catch((e) => { console.error('FAIL  render-needsyou-dealarm-2808', e && e.message); process.exit(1); });
