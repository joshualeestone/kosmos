"use strict";
/**
 * #2140 Surface 2: the OpenAI model picker on an EXISTING agent's detail page.
 * Runs the SHIPPED paintOpenaiDetailModel against a fake document with a stubbed
 * /api/accounts/openai/models fetch. The point is the bug Josh flagged: an OpenAI
 * agent's detail page must NEVER show Claude models (the Claude flow matches by
 * label against CREATE_MODELS). Asserts: LISTABLE shows the account's models with
 * "Let OpenAI choose" first and the agent's CURRENT model (a.plannedModelName, which
 * for OpenAI is the raw id) pre-selected, no Claude; NOT LISTABLE shows the single
 * "OpenAI picks its own model for now" option, no Claude, with the reason on the msg.
 *
 *   node --test web.detail-openai-model-2140.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
function sliceFn(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' not found -- Surface 2 not present (or moved; re-anchor)');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
const paintFn = sliceFn('paintOpenaiDetailModel');
const noteFn = sliceFn('openaiNoModelsNote');

async function run({ agent, fetchOk, fetchBody }) {
  const els = {
    'd-model': { disabled: false, innerHTML: '', dataset: {}, get value() {
      const m = (this.innerHTML.match(/<option value="([^"]*)"[^>]*selected/) || [])[1];
      return m == null ? '' : m;
    } },
    'd-model-go': { disabled: false },
    'd-model-msg': { textContent: '' },
    'd-model-row': { hidden: false },
    'd-model-why': { textContent: '', hidden: true },
  };
  const document = { getElementById: (id) => (id in els ? els[id] : null) };
  const calls = { paintWhy: 0, fetchUrl: null };
  const wrap = `
    let OPENAI_DETAIL_GEN = 0;
    let OPENAI_PICK_MODELS = [];
    const CURRENT = { sessionName: ${JSON.stringify(agent.sessionName)} };
    const esc = (s) => String(s == null ? '' : s);
    const paintModelWhy = () => { _calls.paintWhy += 1; };
    const fetch = async (url) => { _calls.fetchUrl = url; return { ok: ${fetchOk ? 'true' : 'false'}, json: async () => (${JSON.stringify(fetchBody || {})}) }; };
    ${noteFn}
    ${paintFn}
    paintOpenaiDetailModel(${JSON.stringify(agent)}, ${JSON.stringify(agent.sessionName)});
    return () => ({ pick: OPENAI_PICK_MODELS.slice() });
  `;
  // eslint-disable-next-line no-new-func
  const read = new Function('document', '_calls', wrap)(document, calls);
  await new Promise((r) => setTimeout(r, 15));
  return { els, calls, pick: read().pick };
}

const OURS = { sessionName: 'oa1', isNamedOurs: true, provider: 'openai', account: { dir: '/home/.codex' } };

test('#2140 S2 LISTABLE: the detail picker shows the account models + "Let OpenAI choose", NEVER a Claude model, current pre-selected', async () => {
  const r = await run({
    agent: { ...OURS, plannedModelName: 'o3' },
    fetchOk: true,
    fetchBody: { ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT-5-codex', arg: 'gpt-5-codex', why: 'x' },
      { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
    ] },
  });
  const html = r.els['d-model'].innerHTML;
  assert.match(html, /value="">Let OpenAI choose \(recommended\)/, 'the auto option must be present');
  assert.match(html, /value="o3"[^>]*selected/, 'the agent\'s current model (o3) must be pre-selected');
  assert.doesNotMatch(html, /Claude|sonnet|opus/i, 'no Claude model may appear on an OpenAI agent detail page');
  assert.equal(r.els['d-model'].dataset.current, 'o3', 'dataset.current must be the current key so Switch stays down on no-change');
  assert.equal(r.els['d-model'].disabled, false, 'the picker is enabled for our agent');
  assert.ok(r.pick.some((m) => m.key === 'o3'), 'the models were cached for paintModelWhy');
  assert.match(r.calls.fetchUrl, /\/api\/accounts\/openai\/models\?dir=/);
});

test('#2140 S2 current-not-in-list -> "Let OpenAI choose" selected (never a wrong pre-select)', async () => {
  const r = await run({
    agent: { ...OURS, plannedModelName: 'gpt-4o-mini-retired' },
    fetchOk: true,
    fetchBody: { ok: true, models: [{ key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'x' }] },
  });
  assert.match(r.els['d-model'].innerHTML, /value="" selected>Let OpenAI choose/, 'a current model not in the list falls back to auto-selected');
});

test('#2140 S2 NOT LISTABLE: single "OpenAI picks its own model for now" option, no Claude, reason on the msg', async () => {
  const r = await run({
    agent: { ...OURS, plannedModelName: '' },
    fetchOk: true,
    fetchBody: { ok: false, because: 'this sign-in cannot list models yet; it is not an API key' },
  });
  const html = r.els['d-model'].innerHTML;
  assert.match(html, /value="" selected>OpenAI picks its own model for now/);
  assert.doesNotMatch(html, /Claude|sonnet|opus/i);
  assert.equal(r.els['d-model'].disabled, true);
  assert.equal(r.els['d-model-go'].disabled, true);
  assert.match(r.els['d-model-msg'].textContent, /signed in with ChatGPT/);
});

test('#2140 S2 not-ours agent: the box shows no Claude model and says Kosmos did not start it', async () => {
  const r = await run({
    agent: { sessionName: 'stranger', isNamedOurs: false, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: 'o3' },
    fetchOk: true,
    fetchBody: { ok: true, models: [{ key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'x' }] },
  });
  assert.doesNotMatch(r.els['d-model'].innerHTML, /Claude|sonnet|opus/i);
  assert.equal(r.els['d-model'].disabled, true, 'a not-ours agent cannot change its model');
  assert.equal(r.els['d-model-go'].disabled, true);
  assert.match(r.els['d-model-msg'].textContent, /Kosmos did not start this one/);
});
