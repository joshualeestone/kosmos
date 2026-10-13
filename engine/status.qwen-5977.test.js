'use strict';
/**
 * #5977: a Qwen agent runs on the codex runner with a Qwen account (an endpoint folder, no auth.json) as its account
 * home. None of the OpenAI sign-in paths may judge it: the live-auth probe leaves it unjudged, the signed-out list
 * does not list its folder as a signed-out OpenAI account, and an account problem names Qwen, not OpenAI. Each has
 * an OpenAI control, so the exemption is shown to be about the endpoint, not about codex.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-status-qwen-5977-'));
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
for (const d of [process.env.AGENT_WORKFORCE_HOME, process.env.AGENT_WORKFORCE_DATA]) fs.mkdirSync(d, { recursive: true });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const qwen = require('./qwenaccounts');
const status = require('./status');
const { signedOutRows } = require('./signedoutaccounts');
const { providerOf } = require('./accountproblem');
const store = require('./store');
const fleet = require('../test-support/fleet');
// A codex agent's pane as Codex draws it when idle (the shape cli.project-show-4581 uses).
const codexCard = (name, opts = {}) => fleet.agent(name, { runner: 'codex', command: 'node', screen: '\u203a Ask Codex to do anything', ...opts });

const QWEN_HOME = nodePath.join(process.env.AGENT_WORKFORCE_HOME, qwen.DIR_PREFIX + 'local');
qwen.storeEndpoint(QWEN_HOME, { baseUrl: 'http://localhost:11434/v1', model: 'kosmos-qwen2.5-7b-16k:latest', contextWindow: 16384 });
const OPENAI_HOME = nodePath.join(process.env.AGENT_WORKFORCE_HOME, '.codex-work1');
fs.mkdirSync(OPENAI_HOME, { recursive: true });

test('codexLiveAuthFor leaves a Qwen agent unjudged, and still asks about an OpenAI home', () => {
  const asked = [];
  const verdict = (dir) => { asked.push(dir); return { state: 'none' }; };
  assert.equal(status.codexLiveAuthFor('q', () => ({ runner: 'codex', configDir: QWEN_HOME }), verdict), undefined);
  assert.deepEqual(asked, [], 'no OpenAI check ran for the Qwen home');
  // CONTROL: an OpenAI home is still judged.
  assert.deepEqual(status.codexLiveAuthFor('o', () => ({ runner: 'codex', configDir: OPENAI_HOME }), verdict), { state: 'none' });
  assert.deepEqual(asked, [OPENAI_HOME]);
});

test('signedOutRows does not list a Qwen folder as a signed-out OpenAI account; an empty OpenAI folder still is', () => {
  const jobs = { q: { runner: 'codex', configDir: QWEN_HOME }, o: { runner: 'codex', configDir: OPENAI_HOME } };
  const board = fleet.install([codexCard('q'), codexCard('o')]);
  let rows;
  try {
    rows = signedOutRows([board.card('q'), board.card('o')], { openai: [] }, (n) => jobs[n], () => null);
  } finally { fleet.restore(); }
  assert.equal(rows.some((r) => r.dir === QWEN_HOME), false, 'the Qwen folder is not a signed-out OpenAI account');
  assert.equal(rows.some((r) => r.dir === OPENAI_HOME && r.provider === 'openai'), true, 'CONTROL: the empty OpenAI folder is listed');
});

test('an account problem on a Qwen agent names Qwen; an OpenAI agent still names OpenAI', () => {
  store.writeProfile('qwen-agent', { provider: 'alibaba' });
  store.writeProfile('openai-agent', { provider: 'openai' });
  const codex = fleet.install(['qwen-agent', 'openai-agent', 'no-profile-agent'].map((n) => codexCard(n)));
  try {
    assert.equal(providerOf(codex.card('qwen-agent')), 'Qwen');
    assert.equal(providerOf(codex.card('openai-agent')), 'OpenAI');
    assert.equal(providerOf(codex.card('no-profile-agent')), 'OpenAI', 'no profile keeps the runner\'s name');
  } finally { fleet.restore(); }
  const gemini = fleet.install([fleet.agent('qwen-agent', { runner: 'gemini', command: 'node' })]);
  try {
    assert.equal(providerOf(gemini.card('qwen-agent')), 'Gemini', 'only a codex card can be Qwen');
  } finally { fleet.restore(); }
});
