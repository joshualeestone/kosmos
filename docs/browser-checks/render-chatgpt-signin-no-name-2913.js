'use strict';

/**
 * kosmos#2913 (Josh, 6.59 QA 2026-09-12): the ChatGPT-subscription sign-in must
 * NOT ask for a name. The subscription flow pulls in the account's email
 * automatically, and that email is what tells one subscription account apart
 * from another -- so a name field is extra work for nothing. The API-key steps
 * (Claude key, OpenAI key) KEEP their name field: a pasted key carries no email
 * to pull, so a name is the only discriminator there.
 *
 * This asserts, on BOTH subscription surfaces:
 *   - Settings  add flow:  #acct-openai-sub-step  has NO #acct-openai-sub-label
 *   - First-run install:   #fr-openai-sub-step    has NO #fr-openai-sub-label
 * and, as a CONTROL that the removal is surgical rather than global, that the
 * Anthropic API-key step KEEPS its own name field (#acct-claude-key-label). The
 * Sign-in buttons (#acct-openai-sub-go / #fr-openai-sub-go) must still exist.
 *
 * Discriminator: the markup is static in web/index.html, so these ids are in the
 * DOM at load regardless of visibility. On origin/main the two *-sub-label inputs
 * exist, so the null-assertions RED there; on this branch they are gone -> GREEN.
 *
 * Hermetic: loads web/index.html over file://, no board.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-chatgpt-signin-no-name-2913.js
 */

// Browser-check-surface: acct-openai-sub-step acct-openai-sub-label acct-openai-sub-go fr-openai-sub-step fr-openai-sub-label fr-openai-sub-go acct-claude-key-label acct-openai-label

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-chatgpt-signin-no-name-2913: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-chatgpt-signin-no-name-2913: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    const has = (id) => !!document.getElementById(id);
    const stepText = (id) => {
      const e = document.getElementById(id);
      return e ? (e.textContent || '').replace(/\s+/g, ' ').toLowerCase() : '';
    };
    return {
      // Subscription surfaces: name field GONE, Sign-in button KEPT.
      acctSubStepExists: has('acct-openai-sub-step'),
      acctSubLabelGone: !has('acct-openai-sub-label'),
      acctSubGoKept: has('acct-openai-sub-go'),
      acctSubNoOptionalCopy: stepText('acct-openai-sub-step').indexOf('name is optional') === -1,
      frSubStepExists: has('fr-openai-sub-step'),
      frSubLabelGone: !has('fr-openai-sub-label'),
      frSubGoKept: has('fr-openai-sub-go'),
      frSubNoOptionalCopy: stepText('fr-openai-sub-step').indexOf('name is optional') === -1,
      // CONTROL: the API-key steps KEEP their name field (a key has no email to pull).
      // Both key steps, because the OpenAI one shares the "openai" prefix and sits in the
      // same modal -- it is the sibling most at risk of an accidental over-removal.
      claudeKeyLabelKept: has('acct-claude-key-label'),
      openaiKeyLabelKept: has('acct-openai-label'),
    };
  });
  await browser.close();

  const problems = [];
  if (!r.acctSubStepExists) problems.push('the Settings subscription step (#acct-openai-sub-step) is missing entirely -- fixture/flow drift, not the #2913 change');
  if (!r.frSubStepExists) problems.push('the first-run subscription step (#fr-openai-sub-step) is missing entirely -- fixture/flow drift, not the #2913 change');
  if (!r.acctSubLabelGone) problems.push('the Settings ChatGPT-subscription sign-in still has its name input (acct-openai-sub-label) -- #2913 asks to remove it');
  if (!r.frSubLabelGone) problems.push('the first-run ChatGPT-subscription sign-in still has its name input (fr-openai-sub-label) -- #2913 asks to remove it');
  if (!r.acctSubNoOptionalCopy) problems.push('the Settings subscription step still shows the "name is optional" copy');
  if (!r.frSubNoOptionalCopy) problems.push('the first-run subscription step still shows the "name is optional" copy');
  if (!r.acctSubGoKept) problems.push('the Settings "Sign in with ChatGPT" button (#acct-openai-sub-go) is missing -- the removal took too much');
  if (!r.frSubGoKept) problems.push('the first-run "Sign in with ChatGPT" button (#fr-openai-sub-go) is missing -- the removal took too much');
  if (!r.claudeKeyLabelKept) problems.push('CONTROL FAILED: the Anthropic API-key name field (acct-claude-key-label) was also removed -- #2913 is subscription-only; a key has no email to pull');
  if (!r.openaiKeyLabelKept) problems.push('CONTROL FAILED: the OpenAI API-key name field (acct-openai-label) was also removed -- #2913 is subscription-only; the OpenAI key step keeps its name too');

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error(`render-chatgpt-signin-no-name-2913: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-chatgpt-signin-no-name-2913: both ChatGPT-subscription sign-ins have no name field or "optional" copy, the Sign-in buttons remain, and the API-key name field is untouched.');
})();
