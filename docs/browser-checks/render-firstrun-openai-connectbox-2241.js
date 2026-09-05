'use strict';
/**
 * kosmos#2241 (Josh, 0.6.35): when an OpenAI/codex account is connected, the
 * first-run OpenAI row renders the SAME gold check-row box Claude's connection
 * uses (frPaintSubscription -> frCheckRow -> #fr-sub), reading "OpenAI GPT Codex
 * is connected. / This computer is signed in.", instead of the plain "Added: API
 * key ending X" line. This is the OpenAI sibling of render-firstrun-connect-box-2187.
 *
 * ⚠️ WHY A BROWSER. The unit test (web.firstrun-model.test.js) runs frPaintOpenai's
 * LOGIC against a stub with a frCheckRow STUB, so it cannot prove the REAL frCheckRow
 * paints a sized check-row into #fr-openai-msg with the gold-wash computed style. This
 * drives the real frPaintOpenai({connected:true}) against the real page (file://, no
 * board) and reads computed style off #fr-openai-msg. Control: the not-connected
 * (dead) paint leaves a plain hint, NOT the gold box, so a green is not "any content
 * is gold".
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-openai-connectbox-2241.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-firstrun-openai-connectbox-2241: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

// The gold wash Claude's #fr-sub / .fr-confirm use: rgba(184,137,32,.08) fill,
// rgba(184,137,32,.28) border. getComputedStyle returns the declared rgba, so
// r=184,g=137,b=32; the discriminator is the gold hue ordering (r > g > b), which
// transparent / white / grey all fail. Tolerance is a defensive margin.
function isGold(rgb) {
  const m = rgb && rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return Math.abs(r - 184) <= 40 && Math.abs(g - 137) <= 45 && Math.abs(b - 32) <= 45 && r > g && g > b;
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-firstrun-openai-connectbox-2241: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const host = document.getElementById('fr-openai-msg');
    if (!host) return { error: '#fr-openai-msg is gone from the page' };
    if (typeof frPaintOpenai !== 'function') return { error: 'frPaintOpenai is not on the page' };
    if (typeof frCheckRow !== 'function') return { error: 'frCheckRow is not on the page' };
    // Unhide the ANCESTORS so #fr-openai-msg gets real layout; never force display
    // on #fr-openai-msg itself (its own box is what is under test).
    for (let n = host.parentElement; n; n = n.parentElement) {
      n.removeAttribute('hidden');
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    host.removeAttribute('hidden');

    // CONNECTED: the real paint, told directly (no fetch).
    await frPaintOpenai({ connected: true, keyTail: 'NfYA', justAdded: true });
    const row = host.querySelector('.fr-check.ok');
    const rr = row && row.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const hr = host.getBoundingClientRect();
    const connected = {
      hasRow: Boolean(row),
      rowText: row ? (row.innerText || row.textContent || '') : '',
      rowSized: Boolean(rr && rr.width > 0 && rr.height > 0),
      cls: host.className, bg: cs.backgroundColor, borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth, boxSized: hr.width > 0 && hr.height > 0,
    };

    // CONTROL: not connected (a dead key) -> a plain hint, NOT the gold box.
    await frPaintOpenai({ connected: false, keyTail: null, deadWhy: 'OpenAI rejected this key.' });
    const dcs = getComputedStyle(host);
    const dead = { cls: host.className, hasRow: Boolean(host.querySelector('.fr-check.ok')), bg: dcs.backgroundColor };

    return { connected, dead };
  });

  if (r.error) { console.error('render-firstrun-openai-connectbox-2241: ' + r.error); await browser.close(); process.exit(1); }

  const c = r.connected;
  // Non-vacuous first: the check-row must actually paint, or the style asserts are about an empty box.
  check('the "OpenAI GPT Codex is connected" checkrow paints in #fr-openai-msg',
    c.hasRow && c.rowSized && /OpenAI GPT Codex is connected/.test(c.rowText) && /signed in/i.test(c.rowText),
    'text ' + JSON.stringify(c.rowText.slice(0, 64)) + ', sized ' + c.rowSized);
  if (c.hasRow && c.rowSized) {
    check('the connected box carries the .fr-connbox gold-wash background',
      c.cls.indexOf('fr-connbox') !== -1 && c.boxSized && isGold(c.bg), 'cls "' + c.cls + '", bg ' + c.bg);
    check('the connected box has a gold border',
      parseFloat(c.borderWidth) >= 1 && isGold(c.borderColor), c.borderWidth + ' ' + c.borderColor);
  }
  // Control: the dead state is a plain hint, never the gold box.
  check('CONTROL: a not-connected (dead) OpenAI state is a plain hint, not the gold box',
    r.dead.cls.indexOf('fr-connbox') === -1 && !r.dead.hasRow && !isGold(r.dead.bg),
    'cls "' + r.dead.cls + '", bg ' + r.dead.bg);

  await browser.close();
  if (problems.length) {
    console.error('render-firstrun-openai-connectbox-2241: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-firstrun-openai-connectbox-2241: the connected OpenAI state renders the same gold check-row box as Claude ("OpenAI GPT Codex is connected. This computer is signed in."); a not-connected state stays a plain hint.');
})();
