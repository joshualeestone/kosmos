'use strict';

/**
 * kosmos#2621 (Josh, 2026-09-09): the first-run INSTALL flow offers the same
 * "Sign in with ChatGPT" subscription choice Settings does, not API-key-only.
 *
 * 🛑 WHY A BROWSER, AND WHY THIS IS THE #1720 GUARD FOR THE CHANGE. Before this,
 * the first-run OpenAI step revealed the key form directly (frOpenaiShowKey); a
 * render check that verified the key form renders would pass while the whole
 * subscription OPTION was missing -- a parity gap is invisible to a "does it
 * render" check. This drives the real first-run flow and asserts the OPTION is
 * present and both branches work: the picker offers Sign-in-with-ChatGPT AND an
 * API key; choosing the key reveals #fr-openai-flow; choosing the subscription
 * reveals #fr-openai-sub-step; and a stubbed subscription start -> connected
 * paints the SAME gold "OpenAI GPT Codex is connected" box the key path uses
 * (a subscription carries no keyTail, so "This computer is signed in." with no
 * key suffix), with the connect button flipped and the flow cleared.
 *
 * Hermetic: loads web/index.html over file://, no board. Reds on origin/main,
 * where first-run has no #fr-openai-pick / #fr-openai-sub-step at all.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-openai-sub-2621.js
 *
 * ⚠️ HEADED by default, matching its neighbours. HEADED=0 on a machine with no
 * console session; the verdicts are the same (computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-firstrun-openai-sub-2621: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-firstrun-openai-sub-2621: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
    const out = {};
    document.getElementById('firstrun').hidden = false;
    if (typeof frOpenaiShowPick !== 'function') return { error: 'frOpenaiShowPick is not a function (first-run picker was not ported)' };
    // The runner-present hand-off shows the picker.
    frOpenaiShowPick();
    out.pickShown = vis('fr-openai-pick');
    out.hasSubBtn = !!document.getElementById('fr-openai-pick-sub');
    out.hasKeyBtn = !!document.getElementById('fr-openai-pick-key');
    // Key branch.
    document.getElementById('fr-openai-pick-key').click();
    out.keyRevealed = vis('fr-openai-flow');
    out.subHiddenOnKey = !vis('fr-openai-sub-step');
    // Subscription branch.
    frOpenaiShowPick();
    document.getElementById('fr-openai-pick-sub').click();
    out.subRevealed = vis('fr-openai-sub-step');
    out.keyHiddenOnSub = !vis('fr-openai-flow');
    out.hasSubGo = !!document.getElementById('fr-openai-sub-go');
    // Stub the subscription flow and drive it to connected.
    const seen = { start: false, reauthDirSent: undefined };
    window.fetch = (u, opts) => {
      const url = String(u);
      if (url.indexOf('/api/accounts/openai/subscription/start') !== -1) {
        seen.start = true;
        try { seen.reauthDirSent = JSON.parse(opts.body).reauthDir; } catch { /* body shape */ }
        return Promise.resolve({ ok: true, json: async () => ({ sessionId: 's1', authUrl: 'https://openai.example/signin', mode: 'browser' }) });
      }
      if (url.indexOf('/api/accounts/openai/subscription/status') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: 'connected', account: { email: 'you@example.com' } }) });
      }
      if (url.indexOf('/api/accounts') !== -1) {
        return Promise.resolve({ ok: true, json: async () => ({ accounts: [{ provider: 'openai', authMode: 'chatgpt', email: 'you@example.com', dir: '/h/.codex', isDefault: true, connection: { state: 'connected', because: 'ok' } }] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    document.getElementById('fr-openai-sub-go').click();
    out.startCalled = seen.start;
    // First-run is a fresh add: it must NOT send a reauthDir.
    out.reauthDirOmitted = seen.reauthDirSent === undefined;
    return out;
  });

  if (r.error) { await browser.close(); console.error('render-firstrun-openai-sub-2621: 1 problem(s)'); console.error('  FAIL  ' + r.error); process.exit(1); }

  // Give the poll (1200ms) + the connected paint time to run.
  await page.waitForTimeout(2100);
  const after = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
    const msg = document.getElementById('fr-openai-msg');
    const btn = document.getElementById('fr-openai-connect');
    return {
      goldBox: !!msg && msg.className === 'fr-connbox',
      says: msg ? (msg.textContent || '').replace(/\s+/g, ' ').trim() : '',
      connectFlipped: btn ? (btn.textContent || '').includes('Connected') : false,
      subCleared: !vis('fr-openai-sub-step'),
      pickCleared: !vis('fr-openai-pick'),
    };
  });
  await browser.close();

  const problems = [];
  if (!r.pickShown) problems.push('the first-run picker (#fr-openai-pick) did not show at the runner-present hand-off');
  if (!r.hasSubBtn) problems.push('no "Sign in with ChatGPT" option (#fr-openai-pick-sub) in the install flow -- the #2621 gap');
  if (!r.hasKeyBtn) problems.push('no "Use an API key" option (#fr-openai-pick-key) in the picker');
  if (!(r.keyRevealed && r.subHiddenOnKey)) problems.push('"Use an API key" did not reveal only the key form');
  if (!(r.subRevealed && r.keyHiddenOnSub && r.hasSubGo)) problems.push('"Sign in with ChatGPT" did not reveal only the subscription step');
  if (!r.startCalled) problems.push('the subscription Sign-in did not POST subscription/start');
  if (!r.reauthDirOmitted) problems.push('first-run sent a reauthDir on a fresh add (must be a new account, never a reauth)');
  if (!after.goldBox) problems.push('a connected subscription did not paint the gold #fr-openai-msg box');
  if (!/OpenAI GPT Codex is connected/.test(after.says)) problems.push('the connected box did not read "OpenAI GPT Codex is connected": ' + JSON.stringify(after.says));
  if (/API key ending/.test(after.says)) problems.push('a subscription connect wrongly showed an "API key ending" suffix: ' + JSON.stringify(after.says));
  if (!after.connectFlipped) problems.push('the Connect button did not flip to Connected after a subscription connect');
  if (!(after.subCleared && after.pickCleared)) problems.push('the connected paint left the picker or sub-step visible over the gold box');

  console.log('  ' + JSON.stringify({ ...r, ...after }));
  if (problems.length) {
    console.error(`render-firstrun-openai-sub-2621: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-firstrun-openai-sub-2621: the install flow offers Sign-in-with-ChatGPT vs API key; both branches reveal correctly; a subscription connect paints the gold connected box (no key suffix) and clears the flow.');
})();
