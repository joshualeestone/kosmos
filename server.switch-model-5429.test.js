'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#5429: a provider switch carries the MODEL too, so provider, account and model change in ONE restart.
 * Harness copied from server.switch-provider-google-xai-3296.test.js (the #3296/#3391 notes below are its own).
 *
 * #3296 / #3391: the POST /api/agent/:name/provider route, EXECUTED for a switch to
 * google (Gemini) and xai (Grok).
 *
 * Why this file exists: engine/create.setprovider-google-xai-3296.test.js drives the
 * ENGINE, and web.switch-account-1373.test.js only source-greps the templated copy. So
 * the route's four-way generalization -- the vendor `label`, the `acctNoun` phrase, the
 * anthropic-keyed `dropped` sentence, and `acct = openaiAccount || account` -- had no
 * arm that actually runs it and reads the composed sentence back. A source-grep passes
 * even if the sentence is assembled wrong; this boots the server and asserts the bytes.
 *
 * The harness is the sibling switch-account-1373 route test's, narrowed to what these
 * arms need: fake claude/codex/gemini/grok bins via the env overrides resolveBin honours,
 * a fake tmux + a running pane line so the switch lands on the OK branch (whose sentence
 * is the one under test), and a fakeRun whose has-session answers GONE so remove.restart
 * reports a real restart rather than the partial branch.
 *
 *   node --test server.switch-provider-google-xai-3296.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-switch-model-5429-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
delete process.env.AGENT_WORKFORCE_GROK_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const GEMINI_BIN = nodePath.join(BIN, 'gemini');
const GROK_BIN = nodePath.join(BIN, 'grok');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, GEMINI_BIN, GROK_BIN, TMUX_BIN]) {
  fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_CODEX_BIN = CODEX_BIN;
process.env.AGENT_WORKFORCE_GEMINI_BIN = GEMINI_BIN; // resolveBin('gemini') honours this
process.env.AGENT_WORKFORCE_GROK_BIN = GROK_BIN;     // resolveBin('grok') honours this

const FAKE_TMUX = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
const PANES = nodePath.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_TMUX_BIN = FAKE_TMUX;
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;

const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const store = require('./engine/store');

/* A named Gemini account: a <home>/.gemini-<label> dir with a non-empty mode-600 key
   file, so geminiaccounts.list() includes it (rowFor gates on a stored key) and the
   route can name its keyTail. */
function seedGemini(label, key) {
  const dir = nodePath.join(HOME, '.gemini-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.kosmos-gemini-apikey'), key, { mode: 0o600 });
  return nodePath.resolve(dir);
}
const GEMINI_ALPHA = seedGemini('alpha', 'gm-key-alpha-WXYZ');

/* Born on claude and made to read RUNNING, so the switch reaches the OK branch (the one
   whose "It runs on your <provider> account" sentence these arms exist to check). `model`
   is optional: an agent born WITH one exercises the `dropped` model sentence. */
function born(name, model) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, model || null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');
  assert.equal(store.readProfile(name).provider, 'anthropic',
    'the seeded agent is not readable as a Claude job, so every assertion below would be right for the wrong reason');
  return name;
}

const fakeRun = (_file, args) => (Array.isArray(args) && args[0] === 'has-session'
  ? { ok: false, code: 1 }
  : { ok: true, stdout: '' });
create.setRunner(fakeRun);
require('./engine/remove').setRunner(fakeRun);

const { start, server } = require('./server');
let base = '';

test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  create.setRunner(null);
  require('./engine/remove').setRunner(null);
});

async function switchTo(name, body) {
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(name) + '/provider', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}


/* Count the restarts the route makes (it calls removal.restart once per switch). */
const removal = require('./engine/remove');
const realRestart = removal.restart;
let restarts = 0;
removal.restart = (...a) => { restarts += 1; return realRestart(...a); };
test.after(() => { removal.restart = realRestart; });
const plist = (name) => fs.readFileSync(create.plistPath(name), 'utf8');

test('#5429 route: Gemini to Claude WITH a model is one restart, lands on that model, and says so', async () => {
  const name = born('srv-sm-g2c');
  let r = await switchTo(name, { provider: 'google' });
  assert.equal(r.status, 200, 'setup: on Gemini first ' + JSON.stringify(r.body));
  restarts = 0;
  r = await switchTo(name, { provider: 'anthropic', model: 'opus55' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.provider, 'anthropic');
  assert.equal(restarts, 1, 'one restart for provider and model together');
  assert.match(plist(name), /claude-opus-5-5/, 'the switched job carries the picked model');
  assert.equal(r.body.model && r.body.model.label, 'Claude Opus 5.5');
  assert.match(r.body.because, /it starts on your main Claude account and Claude Opus 5\.5/i, r.body.because);
  assert.doesNotMatch(r.body.because, /default model/, 'a picked model is never called the default');
});

test('#5429 route: CONTROL: with no model it starts on Claude\'s default, as before', async () => {
  const name = born('srv-sm-g2c-none');
  await switchTo(name, { provider: 'google' });
  const r = await switchTo(name, { provider: 'anthropic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.because, /Claude’s own default model/, r.body.because);
  assert.equal(r.body.model, undefined);
});

test('#5429 route: a model that is not a Claude model is refused BEFORE anything changes', async () => {
  const name = born('srv-sm-bad');
  await switchTo(name, { provider: 'google' });
  restarts = 0;
  const r = await switchTo(name, { provider: 'anthropic', model: 'gpt-9' });
  assert.equal(r.status, 400);
  assert.match(r.body.because, /not a Claude model/);
  assert.equal(restarts, 0, 'nothing restarted');
  assert.equal(store.readProfile(name).provider, 'google', 'still on Gemini: nothing was written');
});

test('#5429 route: a model sent with a switch to a provider that picks its own is refused, nothing changed', async () => {
  const name = born('srv-sm-gem');
  const r = await switchTo(name, { provider: 'google', model: 'opus55' });
  assert.equal(r.status, 400);
  assert.match(r.body.because, /picks its own model/);
  assert.equal(store.readProfile(name).provider, 'anthropic');
});

/* Review 1: the OpenAI path. The account's model list is stubbed (the route reads it through openaiaccounts). */
/* An OpenAI API-key sign-in in the sandbox home (as server.switch-account-1373.test.js seeds one), so the switch has
   somewhere to land; the switch sends it as the account. */
function seedOpenai(label) {
  const dir = nodePath.join(HOME, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-switchmodel5429test' + label }));
  return nodePath.resolve(dir);
}
const OAI = seedOpenai('sm');
const openaiAccounts = require('./engine/openaiaccounts');
function withOpenaiList(list, fn) {
  const realModels = openaiAccounts.accountModels;
  const realAllow = openaiAccounts.runnableAllowlist;
  openaiAccounts.accountModels = async () => { if (list instanceof Error) throw list; return { ok: true, models: list.map((k) => ({ key: k })) }; };
  openaiAccounts.runnableAllowlist = (got) => (got && Array.isArray(got.models) ? got.models.map((m) => m.key) : null);
  return Promise.resolve(fn()).finally(() => { openaiAccounts.accountModels = realModels; openaiAccounts.runnableAllowlist = realAllow; });
}

test('#5429 route: to OpenAI with a model the account runs: one restart, the model is in the switched job', () => withOpenaiList(['gpt-6'], async () => {
  const name = born('srv-sm-oai-ok');
  restarts = 0;
  const r = await switchTo(name, { provider: 'openai', account: OAI, model: 'gpt-6' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.provider, 'openai');
  assert.equal(restarts, 1);
  assert.match(plist(name), /gpt-6/, 'the switched Codex job carries the model');
}));

test('#5429 route: to OpenAI with a model the account does not run: refused, nothing changed', () => withOpenaiList(['gpt-6'], async () => {
  const name = born('srv-sm-oai-no');
  restarts = 0;
  const r = await switchTo(name, { provider: 'openai', account: OAI, model: 'gpt-9' });
  assert.equal(r.status, 400);
  assert.match(r.body.because, /not a model that account can run/);
  assert.equal(restarts, 0);
  assert.equal(store.readProfile(name).provider, 'anthropic');
}));

test("#5429 route: when the account's list cannot be read it fails open, as the model route does", () => withOpenaiList(new Error('offline'), async () => {
  const name = born('srv-sm-oai-open');
  const r = await switchTo(name, { provider: 'openai', account: OAI, model: 'gpt-6' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(plist(name), /gpt-6/);
}));

test('#5429 review 2: when the switch is partial (the picked Claude account could not be applied), the picked model is still named', async () => {
  const name = born('srv-sm-partial');
  await switchTo(name, { provider: 'google' });
  const real = create.setProvider;
  // The real switch runs; its answer is marked partial, as the engine does when the picked Claude account is refused.
  create.setProvider = (...a) => { const w = real(...a); return { ...w, outcome: create.OUTCOME.PARTIAL, because: 'srv-sm-partial is switched to Claude, on your main Claude account: it could not be moved to b@example.com (test).' }; };
  let r;
  try { r = await switchTo(name, { provider: 'anthropic', model: 'opus55' }); } finally { create.setProvider = real; }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'partial');
  assert.equal(r.body.model && r.body.model.label, 'Claude Opus 5.5', 'Runs on can name it');
  assert.match(r.body.because, /It runs on Claude Opus 5\.5\./, r.body.because);
  assert.match(plist(name), /claude-opus-5-5/, 'the model was written');
});
