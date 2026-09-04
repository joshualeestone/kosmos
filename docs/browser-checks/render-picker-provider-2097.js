'use strict';

/**
 * kosmos#2097/#2098: the create-agent picker is provider-aware. On OpenAI the model
 * SELECT is hidden WHOLE (not merely disabled), so no "Claude Sonnet 5" shows under
 * an OpenAI key; on Anthropic the model row is shown. And (#2097 re-rule, 2026-09-04)
 * the account row hides when there is only one account to choose from and shows at 2+.
 *
 * ⚠️ WHY A BROWSER. Drives the real applyCreateProviderUI and fillCreateAccounts
 * against the real create picker in web/index.html and reads the rendered
 * `#create-model-row` / `#create-account-row` hidden state. Reds on origin/main, where
 * `#create-model-row` does not exist (the model select was only DISABLED, still
 * displaying its stale Claude value -- the #2098 bug) and where `#create-account-row`
 * does not exist (the account row was shown even at one account).
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
    const read = () => {
      const w = document.getElementById('create-model-why') || {};
      // #2098: textContent returns the string even on a HIDDEN element, so the note's
      // VISIBILITY must be read separately or a hidden note reads as present (false green).
      return { modelRowHidden: !!modelRow.hidden, whyText: w.textContent || '', whyHidden: !!w.hidden };
    };
    prov.value = 'openai';    applyCreateProviderUI(); const openai = read();
    prov.value = 'anthropic'; applyCreateProviderUI(); const anthropic = read();

    // #2097 (Josh re-rule 2026-09-04): the account row HIDES at <2 accounts and SHOWS
    // at 2+. Drive the real fillCreateAccounts against real Anthropic account lists and
    // read #create-account-row's rendered hidden state. Reds on origin/main, where
    // #create-account-row does not exist (the row was shown even at one account).
    let account;
    if (typeof fillCreateAccounts !== 'function') {
      account = { error: 'fillCreateAccounts is not a function' };
    } else {
      const arow = document.getElementById('create-account-row');
      if (!arow) {
        account = { error: '#create-account-row is missing (the #2097 hide-at-one row was not added)' };
      } else {
        prov.value = 'anthropic';
        const hiddenAt = (n) => {
          CREATE_ACCOUNTS = Array.from({ length: n }, (_, i) => ({ provider: 'anthropic', email: 'a' + i + '@x.com', dir: 'd' + i }));
          fillCreateAccounts();
          return !!arow.hidden;
        };
        account = { oneHidden: hiddenAt(1), twoHidden: hiddenAt(2), zeroHidden: hiddenAt(0) };
      }
    }
    return { openai, anthropic, account };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (!r.openai.modelRowHidden) problems.push('OpenAI: the model row is NOT hidden -- a stale Claude model still shows under an OpenAI key (#2098)');
    if (!/OpenAI picks its own model/.test(r.openai.whyText)) problems.push('OpenAI: the "OpenAI picks its own model" note text is missing');
    if (r.openai.whyHidden) problems.push('OpenAI: the "OpenAI picks its own model" note is HIDDEN -- the user sees neither the picker nor the note, an empty gap (#2098)');
    if (r.anthropic.modelRowHidden) problems.push('Anthropic: the model row is hidden but should be shown');
    if (r.account.error) {
      problems.push('account row: ' + r.account.error);
    } else {
      if (!r.account.oneHidden) problems.push('one account: the account row is NOT hidden -- a single-entry menu is a choice with no choice (#2097 re-rule)');
      if (r.account.twoHidden) problems.push('two accounts: the account row IS hidden but should be shown (#2097 re-rule)');
      if (!r.account.zeroHidden) problems.push('no accounts: the account row is NOT hidden -- the placeholder is not a choice (#2097 re-rule)');
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-picker-provider-2097: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-picker-provider-2097: OpenAI hides the model row (no stale Claude model under an OpenAI key); Anthropic shows it; the account row hides at <2 accounts and shows at 2+.');
})();
