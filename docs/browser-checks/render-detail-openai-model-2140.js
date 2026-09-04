'use strict';

/**
 * kosmos#2140 Surface 2: the OpenAI model picker on an EXISTING agent's detail
 * page. The Claude change-model flow matches by label against the Claude
 * CREATE_MODELS, so an OpenAI agent would show Claude Sonnet 5 etc. as
 * switchable options -- the "Claude models under an OpenAI agent" bug Josh
 * flagged, here on the detail surface. paintOpenaiDetailModel gives OpenAI its
 * own per-account picker instead.
 *
 * ⚠️ WHY A BROWSER, and why a STUBBED fetch + CURRENT. Drives the real
 * paintOpenaiDetailModel against the real #d-model controls in web/index.html
 * on a file:// page, overriding window.fetch and setting CURRENT so no board is
 * needed. Reds on origin/main, where paintOpenaiDetailModel does not exist.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-detail-openai-model-2140.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-detail-openai-model-2140: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-detail-openai-model-2140: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof paintOpenaiDetailModel !== 'function') return { error: 'paintOpenaiDetailModel is not a function (Surface 2 was not added)' };
    const sel = document.getElementById('d-model');
    if (!sel) return { error: '#d-model is missing' };
    const settle = () => new Promise((res) => setTimeout(res, 40));
    const agent = { sessionName: 'oa1', isNamedOurs: true, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: 'o3' };
    // paintOpenaiDetailModel bails unless CURRENT is the agent it is painting.
    CURRENT = { sessionName: 'oa1' };

    // LISTABLE
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT-5-codex', arg: 'gpt-5-codex', why: 'The coding one.' },
      { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
    ] }) });
    paintOpenaiDetailModel(agent, 'oa1');
    await settle();
    const listable = {
      html: sel.innerHTML,
      hasAuto: /value="">Let OpenAI choose/.test(sel.innerHTML),
      currentSelected: /value="o3"[^>]*selected/.test(sel.innerHTML),
      noClaude: !/Claude|sonnet|opus/i.test(sel.innerHTML),
      current: sel.dataset.current,
    };

    // NOT LISTABLE
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an API key' }) });
    paintOpenaiDetailModel({ ...agent, plannedModelName: '' }, 'oa1');
    await settle();
    const msg = document.getElementById('d-model-msg') || {};
    const notListable = {
      onlyOption: sel.options.length === 1,
      optionText: sel.options[0] ? sel.options[0].textContent : '',
      noClaude: !/Claude|sonnet|opus/i.test(sel.innerHTML),
      msg: msg.textContent || '',
    };
    return { listable, notListable };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (!r.listable.hasAuto) problems.push('LISTABLE: "Let OpenAI choose" option is missing');
    if (!r.listable.currentSelected) problems.push('LISTABLE: the agent\'s current model (o3) is not pre-selected');
    if (!r.listable.noClaude) problems.push('LISTABLE: a Claude model appears on an OpenAI agent detail page');
    if (r.listable.current !== 'o3') problems.push('LISTABLE: dataset.current is not the agent\'s current key: ' + JSON.stringify(r.listable.current));
    if (!r.notListable.onlyOption || !/OpenAI picks its own model for now/.test(r.notListable.optionText)) problems.push('NOT LISTABLE: not a single "OpenAI picks its own model for now" option: ' + JSON.stringify(r.notListable.optionText));
    if (!r.notListable.noClaude) problems.push('NOT LISTABLE: a Claude model appears under OpenAI');
    if (!/signed in with ChatGPT/.test(r.notListable.msg)) problems.push('NOT LISTABLE: the reason-keyed note is missing from the msg');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-detail-openai-model-2140: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-detail-openai-model-2140: an OpenAI agent detail page shows the account models with the current one pre-selected (never a Claude model); a not-listable account shows the single "OpenAI picks its own model for now" option with the reason.');
})();
