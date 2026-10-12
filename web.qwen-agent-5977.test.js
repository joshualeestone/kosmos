'use strict';
/* #5977: a Qwen agent runs on codex, so its runner alone says OpenAI. The board marks its
   account `provider: 'alibaba'` (server accountForAgent), and the page reads that in three
   places: the provider word (providerOf), the accounts it may move to (acctMoveWorld), and
   the model menu (paintModelPicker). Each test runs the page's own function. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

const QWEN = { runner: 'codex', account: { dir: '/h/.kosmos-qwen-local', provider: 'alibaba' } };
const OPENAI = { runner: 'codex', account: { dir: '/h/.codex-work' } };

test('#5977: providerOf names a Qwen agent alibaba, and a plain codex agent still openai', () => {
  const at = PAGE.indexOf('const providerOf = (a) =>');
  const end = PAGE.indexOf("'anthropic');", at);
  assert.ok(at > -1 && end > at, 'providerOf moved; re-anchor');
  // eslint-disable-next-line no-new-func
  const providerOf = new Function(PAGE.slice(at, end + "'anthropic');".length) + '\nreturn providerOf;')();
  assert.equal(providerOf(QWEN), 'alibaba');
  assert.equal(providerOf(OPENAI), 'openai', 'CONTROL: a codex agent with no Qwen account is OpenAI');
  assert.equal(providerOf({ runner: 'codex', account: null }), 'openai', 'CONTROL: a default codex agent');
});

test('#5977: a Qwen agent moves only among signed-in Qwen accounts, never OpenAI ones', () => {
  // eslint-disable-next-line no-new-func
  const world = new Function(grab('function acctMoveWorld(') + '; return acctMoveWorld;')();
  const rows = [
    { provider: 'openai', dir: '/h/.codex', isDefault: true, connection: { state: 'connected' } },
    { provider: 'openai', dir: '/h/.codex-work', connection: { state: 'connected' } },
    { provider: 'alibaba', dir: '/h/.kosmos-qwen-local', connection: { state: 'connected' } },
    { provider: 'alibaba', dir: '/h/.kosmos-qwen-other', connection: { state: 'connected' } },
    { provider: 'alibaba', dir: '/h/.kosmos-qwen-gone', connection: { state: 'none' } },
  ];
  const q = world(QWEN, rows);
  assert.equal(q.keyedProvider, 'alibaba');
  assert.equal(q.isCodex, false, 'a Qwen agent is not offered the OpenAI move wording');
  assert.deepEqual(q.movable.map((x) => x.dir), ['/h/.kosmos-qwen-local', '/h/.kosmos-qwen-other']);
  assert.equal(q.currentDir, '/h/.kosmos-qwen-local');
  const o = world(OPENAI, rows);
  assert.equal(o.keyedProvider, 'openai', 'CONTROL');
  assert.deepEqual(o.movable.map((x) => x.dir), ['/h/.codex', '/h/.codex-work'], 'CONTROL: an OpenAI agent never sees Qwen rows');
});

test('#5977: the model menu under a Qwen agent offers no OpenAI list and says the account names the model', async () => {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', disabled: false, hidden: true, dataset: {}, closest: () => null });
  const document = { getElementById: el };
  let openaiPainted = 0;
  const body = grab('async function paintModelPicker(');
  // eslint-disable-next-line no-new-func
  const paint = new Function('document', 'paintOpenaiDetailModel', 'menuRunsOn', 'modelLine', 'esc', 'OPENAI_DETAIL_GEN', 'CREATE_MODELS', 'CURRENT',
    body + '\nreturn paintModelPicker;')(
    document, async () => { openaiPainted += 1; }, () => '', (a) => a.modelName, (x) => String(x), 0, [], null);
  await paint({ ...QWEN, sessionName: 'q' });
  assert.equal(openaiPainted, 0, 'a Qwen agent was handed the OpenAI model picker');
  assert.match(els['d-model'].innerHTML, /The Qwen account names the model/);
  assert.equal(els['d-model'].disabled, true);
  await paint({ ...QWEN, sessionName: 'q', modelName: 'kosmos-qwen2.5-7b-16k' });
  assert.match(els['d-model'].innerHTML, /Runs on kosmos-qwen2\.5-7b-16k/);
  await paint({ ...OPENAI, sessionName: 'o' });
  assert.equal(openaiPainted, 1, 'CONTROL: an OpenAI codex agent still gets the OpenAI picker');
});

test('#5977: the board marks only a Qwen account with its provider', () => {
  assert.match(SERVER, /\.\.\.\(found\.provider === 'alibaba' \? \{ provider: 'alibaba' \} : \{\}\)/,
    'accountForAgent no longer marks a Qwen account; the page cannot tell a Qwen agent from an OpenAI one');
});
