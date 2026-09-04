'use strict';

/**
 * kosmos#2096: the "cannot reach a Claude subscription" banner is provider-aware.
 * An OpenAI-only machine (dependsOnClaude=false) shows NO banner; a machine that
 * DEPENDS on Claude still shows it when Claude is unreachable, and a MISSING field
 * falls back to showing it (never hide a real Claude failure on a stale field).
 *
 * ⚠️ WHY A BROWSER. web.openai-only-banner-2096.test.js executes renderConnection
 * against a fake DOM; this drives the REAL renderConnection into the REAL #conn
 * element in web/index.html and reads its rendered hidden/text. Reds on origin/main:
 * there renderConnection takes only (conn, agents), so the third arg is ignored and
 * the OpenAI-only case still shows the banner -- the exact false-positive #2096 fixes.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-openai-only-2096.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM
 * (hidden + text), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-openai-only-2096: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-openai-only-2096: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof renderConnection !== 'function') return { error: 'renderConnection is not a function' };
    const el = document.getElementById('conn');
    if (!el) return { error: '#conn element is missing' };
    const none = { state: 'none', because: 'nobody has signed in yet' };
    const read = () => ({ hidden: !!el.hidden, text: (el.textContent || '').trim() });
    renderConnection(none, [], false);      const openaiOnly = read();
    renderConnection(none, [], true);       const dependsUnreachable = read();
    renderConnection(none, [], undefined);  const missingField = read();
    renderConnection({ state: 'connected' }, [], false); const connected = read();
    return { openaiOnly, dependsUnreachable, missingField, connected };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (!r.openaiOnly.hidden) problems.push('OpenAI-only (dependsOnClaude=false) still showed the Claude banner: "' + r.openaiOnly.text + '"');
    if (r.dependsUnreachable.hidden) problems.push('a Claude-dependent machine HID the banner when Claude is unreachable (a real failure hidden)');
    if (!/cannot reach a Claude subscription/.test(r.dependsUnreachable.text)) problems.push('the Claude-dependent unreachable case did not show the warning text');
    if (r.missingField.hidden) problems.push('a MISSING dependsOnClaude field suppressed the warning (must fall back to showing it)');
    if (!r.connected.hidden) problems.push('a connected machine still showed a banner');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-openai-only-2096: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-openai-only-2096: OpenAI-only shows no Claude banner; a real Claude failure (unreachable, or a missing field) still warns.');
})();
