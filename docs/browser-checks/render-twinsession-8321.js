'use strict';
// Browser-check-surface: twinNote twinSay atwin d-meta

/**
 * kosmos#8321: two sessions running one agent. On the real page, no board: the agent's card (card()) carries "Two copies
 * running" with the full sentence on hover, the agent page's header carries the sentence, and an agent with no second
 * session carries neither (the control).
 *
 *   HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-twinsession-8321.js
 */
const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-twinsession-8321: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  await page.goto(PAGE);
  const r = await page.evaluate(() => {
    const base = { name: 'Kappa', sessionName: 'kappa', state: 'idle', nameDerived: true, tied: true, present: true };
    const html = (a) => { const d = document.createElement('div'); d.innerHTML = card(a); document.body.appendChild(d); return d; };
    const two = html({ ...base, twinSession: 'kappa' });
    const one = html(base);
    const note = two.querySelector('.atwin');
    paintDetailMeta({ ...base, twinSession: 'kappa' });
    const meta = document.getElementById('d-meta').textContent;
    paintDetailMeta(base);
    const metaOne = document.getElementById('d-meta').textContent;
    return { text: note && note.textContent, title: note && note.title, color: note && getComputedStyle(note).color, none: one.querySelector('.atwin') === null, meta, metaOne };
  });
  say(r.text === 'Two copies running', 'the card says two copies are running', JSON.stringify(r.text));
  say(/overwrite each other/.test(r.title || '') && /running as kappa/.test(r.title || ''), 'hovering says what that means and names the other', r.title);
  say(/Two copies of this agent are running/.test(r.meta), "the agent's page says so");
  say(r.none === true && !/Two copies/.test(r.metaOne), 'CONTROL: one session, neither', r.metaOne);
  say(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
