'use strict';
/**
 * kosmos#2241 sibling (Josh, 0.6.35): when an OpenAI/codex account is added in
 * SETTINGS (the add-a-provider modal), the success reads as the SAME gold check-row
 * box the first-run flow uses (frCheckRow -> #acct-success-box, the .acct-connbox
 * gold wash), reading "OpenAI GPT Codex is connected. / This computer is signed in.
 * (API key ending X)", instead of the plain "Added: API key ending X" line Josh
 * screenshotted. This is the Settings sibling of render-firstrun-openai-connectbox-2241.
 *
 * #2241 only covered first-run (frPaintOpenai -> #fr-openai-msg). The Settings add flow
 * (acctShowSuccess) still showed a plain panel; this drives the real Settings add flow
 * (stubbing the /api/accounts fetches) and reads computed style off #acct-success-box.
 *
 * CONTROL: a Claude success (acctShowSuccess with no gold-box) stays the plain green-check
 * panel, NOT the gold box, so a green is not "any success renders gold".
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-settings-openai-goldbox.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-settings-openai-goldbox: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

// The gold wash the connected box uses: rgba(184,137,32,.08) fill, rgba(184,137,32,.28)
// border. The discriminator is the gold hue ordering (r > g > b); white/grey/transparent fail.
function isGold(rgb) {
  const m = rgb && rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return Math.abs(r - 184) <= 45 && Math.abs(g - 137) <= 50 && Math.abs(b - 32) <= 50 && r > g && g > b;
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-settings-openai-goldbox: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof acctShowSuccess !== 'function') return { error: 'acctShowSuccess is not on the page' };
    if (typeof frCheckRow !== 'function') return { error: 'frCheckRow is not on the page' };
    if (typeof openAcctAdd !== 'function' || typeof acctPick !== 'function') return { error: 'the add-provider flow functions are gone' };
    if (!document.getElementById('acct-success-box')) return { error: '#acct-success-box is not in the markup' };

    // Stub the two routes the Settings OpenAI add flow touches.
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/api/accounts/openai') !== -1 && opts && opts.method === 'POST') {
        return { ok: true, json: async () => ({ account: { provider: 'openai', keyTail: 'm61a', dir: '~/.codex' } }) };
      }
      if (u.indexOf('/api/accounts') !== -1) {
        return { ok: true, json: async () => ({ accounts: [
          { provider: 'openai', keyTail: 'm61a', dir: '~/.codex', connection: { state: 'connected', badge: 'working', because: 'ok' } },
        ] }) };
      }
      return realFetch(url, opts);
    };
    const vis = (el) => { if (!el) return false; for (let n = el; n; n = n.parentElement) { if (n.hidden) return false; const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };

    // CONNECTED (OpenAI, Settings): drive the real add flow.
    openAcctAdd();
    acctPick('openai', { focus: false });
    document.getElementById('acct-openai-flow').hidden = false;
    document.getElementById('acct-openai-key').value = 'sk-fake-testkey-m61a';
    document.getElementById('acct-openai-go').click();
    await new Promise((res) => setTimeout(res, 500));

    const box = document.getElementById('acct-success-box');
    const row = box.querySelector('.fr-check.ok');
    const rr = row && row.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const gold = {
      boxVisible: vis(box),
      hasRow: Boolean(row),
      rowSized: Boolean(rr && rr.width > 0 && rr.height > 0),
      rowText: row ? (row.innerText || row.textContent || '') : '',
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      defaultCheckVisible: vis(document.getElementById('acct-success-check')),
      headingVisible: vis(document.getElementById('acct-success-t')),
      sayVisible: vis(document.getElementById('acct-success-say')),
    };

    // CONTROL: a plain (Claude) success reuses the SAME panel but stays the green-check
    // panel, NOT the gold box. Close first so the reset path is exercised too.
    if (typeof closeAcctAdd === 'function') closeAcctAdd();
    document.getElementById('acct-add-modal').hidden = false;
    acctShowSuccess('your Claude account');
    const plain = {
      boxVisible: vis(document.getElementById('acct-success-box')),
      defaultCheckVisible: vis(document.getElementById('acct-success-check')),
      sayText: document.getElementById('acct-success-say').textContent,
      sayVisible: vis(document.getElementById('acct-success-say')),
    };

    return { gold, plain };
  });

  if (r.error) { console.error('render-settings-openai-goldbox: ' + r.error); await browser.close(); process.exit(1); }
  if (pageErrors.length) { console.error('render-settings-openai-goldbox: page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  const g = r.gold;
  // Non-vacuous first: the check-row must actually paint, or the style asserts are about an empty box.
  check('the OpenAI Settings success paints the frCheckRow gold box in #acct-success-box',
    g.boxVisible && g.hasRow && g.rowSized
      && /OpenAI GPT Codex is connected/.test(g.rowText) && /signed in/i.test(g.rowText) && /m61a/.test(g.rowText),
    'text ' + JSON.stringify(g.rowText.slice(0, 80)) + ', sized ' + g.rowSized);
  if (g.boxVisible && g.hasRow && g.rowSized) {
    check('the connected box carries the gold-wash background', isGold(g.bg), 'bg ' + g.bg);
    check('the connected box has a gold border', parseFloat(g.borderWidth) >= 1 && isGold(g.border), g.borderWidth + ' ' + g.border);
    check('the gold-box arm hides the default check, "Success!" heading and say line',
      !g.defaultCheckVisible && !g.headingVisible && !g.sayVisible,
      'check ' + g.defaultCheckVisible + ', heading ' + g.headingVisible + ', say ' + g.sayVisible);
  }
  // Control: a plain success stays the green-check panel, not the gold box.
  check('CONTROL: a plain (Claude) success shows the green-check panel, not the gold box',
    !r.plain.boxVisible && r.plain.defaultCheckVisible && r.plain.sayVisible
      && /Successfully connected to your Claude account\./.test(r.plain.sayText),
    'box ' + r.plain.boxVisible + ', say ' + JSON.stringify(r.plain.sayText));

  await browser.close();
  if (problems.length) {
    console.error('render-settings-openai-goldbox: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-settings-openai-goldbox: the OpenAI Settings connected state renders the same gold check-row box as first-run ("OpenAI GPT Codex is connected. This computer is signed in."); a plain success stays the green-check panel.');
})();
