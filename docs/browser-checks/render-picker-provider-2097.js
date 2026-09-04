'use strict';

/**
 * kosmos#2097/#2098: the create-agent picker is provider-aware. On OpenAI the model
 * SELECT is hidden WHOLE (not merely disabled), so no "Claude Sonnet 5" shows under
 * an OpenAI key; on Anthropic the model row is shown.
 *
 * ⚠️ WHY A BROWSER. Drives the real applyCreateProviderUI against the real create
 * picker in web/index.html and reads the rendered `#create-model-row` hidden state.
 * Reds on origin/main, where `#create-model-row` does not exist (the model select was
 * only DISABLED, still displaying its stale Claude value -- the #2098 bug).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-picker-provider-2097.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-picker-provider-2097: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-picker-provider-2097: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof applyCreateProviderUI !== 'function') return { error: 'applyCreateProviderUI is not a function' };
    const prov = document.getElementById('create-provider');
    const modelRow = document.getElementById('create-model-row');
    if (!prov) return { error: '#create-provider is missing' };
    if (!modelRow) return { error: '#create-model-row is missing (the #2098 hide-whole row was not added)' };
    const read = () => ({ modelRowHidden: !!modelRow.hidden, whyText: (document.getElementById('create-model-why') || {}).textContent || '' });
    prov.value = 'openai';    applyCreateProviderUI(); const openai = read();
    prov.value = 'anthropic'; applyCreateProviderUI(); const anthropic = read();
    return { openai, anthropic };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (!r.openai.modelRowHidden) problems.push('OpenAI: the model row is NOT hidden -- a stale Claude model still shows under an OpenAI key (#2098)');
    if (!/OpenAI picks its own model/.test(r.openai.whyText)) problems.push('OpenAI: the "OpenAI picks its own model" note is not shown in the row\'s place');
    if (r.anthropic.modelRowHidden) problems.push('Anthropic: the model row is hidden but should be shown');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-picker-provider-2097: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-picker-provider-2097: OpenAI hides the model row (no stale Claude model under an OpenAI key); Anthropic shows it.');
})();
