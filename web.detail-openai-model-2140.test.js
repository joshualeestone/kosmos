"use strict";
/**
 * #2140 Surface 2: the OpenAI model picker on an EXISTING agent's detail page.
 * Runs the SHIPPED paintOpenaiDetailModel against a hand-rolled document stub
 * (a small getElementById fake, NOT jsdom) with a stubbed
 * /api/accounts/openai/models fetch. The point is the bug Josh flagged: an OpenAI
 * agent's detail page must NEVER show Claude models (the Claude flow matches by
 * label against CREATE_MODELS). Asserts: LISTABLE shows the account's models with
 * "Let OpenAI choose" first and the agent's CURRENT model (a.plannedModelName, which
 * for OpenAI is the raw id) pre-selected, no Claude; NOT LISTABLE shows the single
 * "OpenAI picks its own model for now" option, no Claude, with the reason on the msg.
 *
 * ⚠️ THE AGENT CARDS ARE REAL, from test-support/fleet, never a hand-written
 * stand-in (fixture-discipline.test.js refuses one, rightly). fleet gives the
 * engine snapshot's sessionName + isNamedOurs; the OpenAI-only fields the SERVER
 * card stage adds -- provider, account, plannedModelName, runner -- are spread on
 * (all verified server-emitted: server.js emits plannedModelName/account/runner on
 * the agent card). Sandbox before the fleet require, as every fixture consumer does.
 *
 *   node --test web.detail-openai-model-2140.test.js
 */
const os = require('node:os');
const fsSb = require('node:fs');
const pathSb = require('node:path');
const SANDBOX = fsSb.realpathSync(fsSb.mkdtempSync(pathSb.join(os.tmpdir(), 'detail-oa-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fsSb.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
function sliceFn(name) {
  // Include a leading `async ` when the shipped function has one, so the slice
  // exercises the SAME shape that ships. Anchoring on `function <name>(` alone
  // drops `async`, and a future direct `await` in the body would then make the
  // sliced non-async copy a SyntaxError instead of running the real function.
  let at = SCRIPT.indexOf('async function ' + name + '(');
  if (at < 0) at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' not found -- Surface 2 not present (or moved; re-anchor)');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
const paintFn = sliceFn('paintOpenaiDetailModel');
const noteFn = sliceFn('openaiNoModelsNote');

/* Real engine cards, produced once. `ours` is our idle agent; `stranger` holds
   one of our names but is not tied, so isNamedOurs is false. No displayName, so
   nothing is written under AGENT_WORKFORCE_WORKERS (which this test does not
   sandbox and must not write). */
function realCards() {
  const board = fleet.install([
    fleet.agent('oa1', { state: 'idle' }),
    fleet.stranger('stranger', { state: 'idle' }),
  ]);
  try {
    const pick = (name) => {
      const c = board.agents.find((x) => x.name === name);
      assert.ok(c, 'the fixture produced no card for ' + name);
      const { sessionName, isNamedOurs, runner } = c;
      return { sessionName, isNamedOurs, runner };
    };
    return { ours: pick('oa1'), stranger: pick('stranger') };
  } finally { board.restore(); }
}
const CARDS = realCards();

/* An OpenAI agent card: a real engine card + the fields the SERVER card stage
   adds for a codex agent. `provider`/`account`/`plannedModelName` are all
   producer-emitted; this spreads them onto the real base rather than inventing
   a card. */
function openaiAgent(base, extra) {
  return Object.assign({}, base, { provider: 'openai', account: { dir: '/home/.codex' } }, extra);
}

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
  // CURRENT is the flight guard; paintOpenaiDetailModel reads only its
  // sessionName, so the agent card itself stands in (no separate stand-in).
  const current = agent;
  const wrap = `
    let OPENAI_DETAIL_GEN = 0;
    let OPENAI_PICK_MODELS = [];
    const CURRENT = _current;
    const esc = (s) => String(s == null ? '' : s);
    const paintModelWhy = () => { _calls.paintWhy += 1; };
    const fetch = async (url) => { _calls.fetchUrl = url; return { ok: ${fetchOk ? 'true' : 'false'}, json: async () => (${JSON.stringify(fetchBody || {})}) }; };
    ${noteFn}
    ${paintFn}
    paintOpenaiDetailModel(_agent, _agent.sessionName);
    return () => ({ pick: OPENAI_PICK_MODELS.slice() });
  `;
  // eslint-disable-next-line no-new-func
  const read = new Function('document', '_calls', '_agent', '_current', wrap)(document, calls, agent, current);
  await new Promise((r) => setTimeout(r, 15));
  return { els, calls, pick: read().pick };
}

test('#2140 S2 LISTABLE: the detail picker shows the account models + "Let OpenAI choose", NEVER a Claude model, current pre-selected', async () => {
  const r = await run({
    agent: openaiAgent(CARDS.ours, { plannedModelName: 'o3' }),
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

test('#2140 S2 default-codex (isDefault account) sends an EMPTY dir so the route resolves the default OpenAI account', async () => {
  // accountForAgent resolves a default-codex agent (configDir null) to the default
  // CLAUDE account {dir: ~/.claude, isDefault:true}, which is not an OpenAI account.
  // The picker must NOT send that dir (it would 404); it sends empty so the server
  // resolves the default OpenAI account. isDefault is the signal.
  const r = await run({
    agent: openaiAgent(CARDS.ours, { account: { dir: '/home/.claude', isDefault: true }, plannedModelName: 'o3' }),
    fetchOk: true,
    fetchBody: { ok: true, models: [{ key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' }] },
  });
  assert.match(r.calls.fetchUrl, /\/api\/accounts\/openai\/models\?dir=$/, 'an isDefault (Claude-default fallback) account must send an EMPTY dir, not the Claude dir');
  assert.match(r.els['d-model'].innerHTML, /value="o3"/, 'the default account\'s models still render (the picker is not parked)');
  assert.doesNotMatch(r.els['d-model'].innerHTML, /Claude|sonnet|opus/i, 'no Claude model appears for a default-codex agent');
});

test('#2191 S2 current-not-in-(collapsed)-list -> the current model is injected + selected (its actual model shown, never a WRONG pre-select)', async () => {
  /* Supersedes the pre-#2191 assertion. Before the snapshot collapse, a current
     model absent from the menu fell back to auto-selected ("Let OpenAI choose").
     After the collapse, "absent from the menu" is the NORMAL case for a
     snapshot-pinned agent -- the pinned model is real, just collapsed away -- so
     the picker now adds a row for the agent's ACTUAL current model and selects
     it. The original intent survives: it still never pre-selects a DIFFERENT
     model (it must not silently swap the snapshot pin for its collapsed alias). */
  const r = await run({
    agent: openaiAgent(CARDS.ours, { plannedModelName: 'gpt-4o-2024-08-06' }),
    fetchOk: true,
    fetchBody: { ok: true, models: [
      { key: 'gpt-4o', provider: 'openai', label: 'GPT-4o', arg: 'gpt-4o', why: 'x' },
      { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'x' },
    ] },
  });
  const html = r.els['d-model'].innerHTML;
  assert.match(html, /value="gpt-4o-2024-08-06"[^>]*selected/, 'the pinned snapshot is injected and pre-selected (its actual model)');
  assert.doesNotMatch(html, /value="" selected/, '"Let OpenAI choose" is NOT auto-selected when we know the current model');
  assert.doesNotMatch(html, /value="gpt-4o"[^>]*selected/, 'the collapsed representative is NOT silently selected in place of the pin (non-destructive)');
  assert.equal(r.els['d-model'].dataset.current, 'gpt-4o-2024-08-06', 'dataset.current reflects the actual pinned model');
});

test('#2140 S2 NOT LISTABLE: single "OpenAI picks its own model for now" option, no Claude, reason on the msg', async () => {
  const r = await run({
    agent: openaiAgent(CARDS.ours, { plannedModelName: '' }),
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
    agent: openaiAgent(CARDS.stranger, { plannedModelName: 'o3' }),
    fetchOk: true,
    fetchBody: { ok: true, models: [{ key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'x' }] },
  });
  assert.equal(CARDS.stranger.isNamedOurs, false, 'the control: the stranger card really is not ours');
  assert.doesNotMatch(r.els['d-model'].innerHTML, /Claude|sonnet|opus/i);
  assert.equal(r.els['d-model'].disabled, true, 'a not-ours agent cannot change its model');
  assert.equal(r.els['d-model-go'].disabled, true);
  assert.match(r.els['d-model-msg'].textContent, /Kosmos did not start this agent/);
});
