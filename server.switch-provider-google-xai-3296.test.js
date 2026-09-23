'use strict';

/**
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

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-switch-gx-3296-'));
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

test('#3296 route: a claude -> google switch is labelled Gemini and names the Gemini account', async () => {
  const name = born('srv-gx-to-gemini');
  const r = await switchTo(name, { provider: 'google' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'changed', JSON.stringify(r.body));
  assert.equal(r.body.provider, 'google', 'the route echoes the wrong provider');
  assert.match(r.body.because, /Gemini it is\./, 'the label was not Gemini (was it "Claude"?): ' + r.body.because);
  assert.match(r.body.because, /It runs on your Gemini account\./, 'the account sentence was not generalized to Gemini: ' + r.body.because);
  // The OpenAI-sign-in live-check note must NOT appear for a Gemini switch (its authMode
  // is undefined, so an ungated `!== 'apikey'` would wrongly append it).
  assert.doesNotMatch(r.body.because, /Kosmos cannot live-check/, 'the OpenAI signInNote leaked onto a Gemini switch: ' + r.body.because);
});

test('#3391 route: a claude -> xai switch is labelled Grok and names the Grok account', async () => {
  const name = born('srv-gx-to-grok');
  const r = await switchTo(name, { provider: 'xai' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'changed', JSON.stringify(r.body));
  assert.equal(r.body.provider, 'xai');
  assert.match(r.body.because, /Grok it is\./, 'the label was not Grok: ' + r.body.because);
  assert.match(r.body.because, /It runs on your Grok account\./, 'the account sentence was not generalized to Grok: ' + r.body.because);
});

test('#3296 route: a PICKED named Gemini account is named back with its key tail and the you-picked wording', async () => {
  const name = born('srv-gx-named-gemini');
  const r = await switchTo(name, { provider: 'google', account: GEMINI_ALPHA, picked: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'changed', JSON.stringify(r.body));
  // picked:true is forwarded as pickedByPerson, so switchAccount.chosen is true and the
  // route says "the Gemini account you picked", matching the codex #1373 affirmation.
  assert.match(r.body.because, /It runs on the Gemini account you picked \(API key ending WXYZ\)\./,
    'a picked named Gemini account did not get the you-picked wording + key tail: ' + r.body.because);
});

test('#3296 route: an UNPICKED named Gemini account travels but does NOT claim the person chose it', async () => {
  const name = born('srv-gx-named-gemini-unpicked');
  // account sent (as a repainted page does on every switch) but picked omitted -> chosen false.
  const r = await switchTo(name, { provider: 'google', account: GEMINI_ALPHA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.because, /It runs on your Gemini account \(API key ending WXYZ\)\./,
    'an unpicked named account wrongly claimed a choice, or lost its key tail: ' + r.body.because);
  assert.doesNotMatch(r.body.because, /you picked/, 'the route claimed a pick nobody made: ' + r.body.because);
});

test('#3296 route: the dropped-choice sentence is generalized (previous model does not cross)', async () => {
  // Born WITH a model, so wrote.dropped.model is truthy and the dropped sentence renders.
  const name = born('srv-gx-dropped', 'claude-opus-5-5');
  const r = await switchTo(name, { provider: 'google' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // "Its" is capitalized here because the route uppercases the first letter of the
  // dropped clause; match without the leading word so the case is not load-bearing.
  assert.match(r.body.because, /previous model choice does not cross \(Gemini picks its own\)/,
    'the dropped-model sentence was not generalized to the target provider: ' + r.body.because);
});

test('#3296 route: switching BACK to Claude keeps the anthropic-branch sentence', async () => {
  // Seed a gemini agent directly, then switch it to anthropic.
  const name = 'srv-gx-back-to-claude';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, GEMINI_BIN, TMUX_BIN, null, null, 'gemini'), 'utf8');
  store.writeProfile(name, { provider: 'google' });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'GEMINI.md'), '# brief\n', 'utf8');
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');

  const r = await switchTo(name, { provider: 'anthropic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.provider, 'anthropic');
  assert.match(r.body.because, /Claude it is\./, 'switching back to Claude lost its label: ' + r.body.because);
  assert.match(r.body.because, /starts on your main Claude account/,
    'the anthropic-branch dropped sentence was lost: ' + r.body.because);
});
