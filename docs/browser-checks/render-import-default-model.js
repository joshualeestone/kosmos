'use strict';
/**
 * kosmos#2453 follow-up (Mona, 2026-09-08): an IMPORTED OpenAI agent lands on the
 * provider's default model (a concrete base GPT), not "Let OpenAI choose". The import
 * response carries the default model KEY (server-side defaultModelKeyFor); the create
 * form pre-selects it once the account's per-account /v1/models list loads (async), and
 * falls back to "Let OpenAI choose" gracefully when the account does not offer that key.
 *
 * WHAT SOURCE CANNOT SEE: that paintOpenaiCreateModel, after its async model fetch,
 * actually pre-selects the stashed IMPORT_OPENAI_MODEL when the account offers it,
 * leaves "Let OpenAI choose" when it does not, and consumes the one-shot pref either way.
 * Drives the REAL paintOpenaiCreateModel against a stubbed models fetch.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-import-default-model.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */
const nodePath = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { console.log('render-import-default-model: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-import-default-model: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const sel = document.getElementById('create-model');
    const prov = document.getElementById('create-provider');
    const acct = document.getElementById('create-account');
    // Make OpenAI the provider and give the account picker a dir so the models fetch runs.
    prov.innerHTML = '<option value="openai">OpenAI</option>'; prov.value = 'openai';
    acct.innerHTML = '<option value="/acct/a">a</option>'; acct.value = '/acct/a';
    const realFetch = window.fetch;
    let OFFER = [];
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/api/accounts/openai/models') !== -1) {
        return { ok: true, json: async () => ({ ok: true, models: OFFER }) };
      }
      return realFetch(url, opts);
    };

    // Case 1: the import default is one of the account's models -> pre-selected.
    OFFER = [{ key: 'gpt-mid', label: 'GPT Mid' }, { key: 'gpt-hi', label: 'GPT Hi' }];
    IMPORT_OPENAI_MODEL = 'gpt-mid';   // eslint-disable-line no-undef
    paintOpenaiCreateModel();          // eslint-disable-line no-undef
    await sleep(60);
    const picked = sel.value;
    const clearedAfterPick = (typeof IMPORT_OPENAI_MODEL === 'undefined') ? null : IMPORT_OPENAI_MODEL;   // eslint-disable-line no-undef

    // Case 2: the import default is NOT offered by this account -> falls back to "".
    OFFER = [{ key: 'gpt-mid', label: 'GPT Mid' }];
    IMPORT_OPENAI_MODEL = 'gpt-absent';   // eslint-disable-line no-undef
    paintOpenaiCreateModel();             // eslint-disable-line no-undef
    await sleep(60);
    const fellBack = sel.value;
    const clearedAfterFallback = (typeof IMPORT_OPENAI_MODEL === 'undefined') ? null : IMPORT_OPENAI_MODEL;   // eslint-disable-line no-undef

    // Case 3: no import pref -> "Let OpenAI choose" default, unchanged.
    OFFER = [{ key: 'gpt-mid', label: 'GPT Mid' }];
    IMPORT_OPENAI_MODEL = null;   // eslint-disable-line no-undef
    paintOpenaiCreateModel();     // eslint-disable-line no-undef
    await sleep(60);
    const noPref = sel.value;

    // Case 4 (leak fix): a fresh-form reset clears a dangling import default, so an
    // abandoned import cannot pre-pick a model on a later, unrelated create. The clear
    // is the sibling of LAST_CLAUDE_MODEL at the top of resetCreateProvider.
    IMPORT_OPENAI_MODEL = 'gpt-mid';   // eslint-disable-line no-undef
    resetCreateProvider();             // eslint-disable-line no-undef
    const clearedByReset = (typeof IMPORT_OPENAI_MODEL === 'undefined') ? 'undef' : IMPORT_OPENAI_MODEL;   // eslint-disable-line no-undef

    window.fetch = realFetch;
    return { picked, clearedAfterPick, fellBack, clearedAfterFallback, noPref, clearedByReset };
  });

  if (pageErrors.length) { console.error('page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  check('an imported OpenAI agent pre-selects the provider default model when the account offers it',
    r.picked === 'gpt-mid', 'value=' + JSON.stringify(r.picked));
  check('the one-shot import pref is consumed after the pre-pick', r.clearedAfterPick === null, JSON.stringify(r.clearedAfterPick));
  check('a default the account does NOT offer falls back to "Let OpenAI choose" (graceful, never worse)',
    r.fellBack === '', 'value=' + JSON.stringify(r.fellBack));
  check('the one-shot pref is consumed even on the fall-back', r.clearedAfterFallback === null, JSON.stringify(r.clearedAfterFallback));
  check('with no import pref, the default stays "Let OpenAI choose"', r.noPref === '', 'value=' + JSON.stringify(r.noPref));
  check('a fresh-form reset clears a dangling import default (no leak into a later create)',
    r.clearedByReset === null, JSON.stringify(r.clearedByReset));

  await browser.close();
  if (problems.length) {
    console.error('render-import-default-model: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-import-default-model: an imported OpenAI agent lands on the provider default model when the account offers it, falls back to "Let OpenAI choose" when it does not, and consumes the one-shot pref either way.');
})();
