'use strict';

/**
 * #3296 / #3391: `setProvider` can switch an EXISTING agent onto (and off) the
 * Gemini and Grok runners, not only claude <-> codex.
 *
 * The codex switch is pinned by create.setprovider-writes-2811.test.js (an exact
 * writes snapshot) and create.switch-account-1373.test.js; this file adds the
 * gemini/grok arms without touching the codex path, so those stay green.
 *
 * Seeded DIRECTLY (plistFor + writeProfile), NOT through createAgent, which calls
 * the real /bin/launchctl -- the same seam the codex switch tests use, for the same
 * measured reason. setProvider itself never invokes launchctl (the restart lives in
 * the server route), so a direct call exercises the whole switch.
 *
 *   node --test engine/create.setprovider-google-xai-3296.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sealed BEFORE ./create is required so every module-level path resolves inside the
   sandbox, and the gemini/grok home overrides are DELETED so defaultDir() floors at
   <sandbox>/home/.gemini and .grok rather than an operator's real home. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'setprovider-google-xai-3296-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
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
const BINS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, geminiBin: GEMINI_BIN, grokBin: GROK_BIN, tmuxBin: TMUX_BIN };

const create = require('./create');
const store = require('./store');

const BRIEF = { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md', grok: 'AGENTS.md' };
const PROVIDER_OF = { claude: 'anthropic', codex: 'openai', gemini: 'google', grok: 'xai' };

/* Seed an agent already running on `runner`, with the brief file that runner boots
   from -- so a switch AWAY from it must move the brief, and the plist must already
   name it (a switch back to the same runner is refused). */
function born(name, runner) {
  const runnerBin = runner === 'gemini' ? GEMINI_BIN : runner === 'grok' ? GROK_BIN : runner === 'codex' ? CODEX_BIN : CLAUDE_BIN;
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, runnerBin, TMUX_BIN, null, null, runner), 'utf8');
  store.writeProfile(name, { provider: PROVIDER_OF[runner] });
  fs.writeFileSync(nodePath.join(create.workerDir(name), BRIEF[runner]), '# brief\n', 'utf8');
  return name;
}

/* A named Gemini/Grok account is a <home>/.gemini-<label> (or .grok-<label>) dir with
   a non-empty mode-600 key file -- exactly what addWithKey writes and what list() gates
   on (rowFor returns null without a stored key). */
function seedAccount(runner, label) {
  const prefix = runner === 'gemini' ? '.gemini-' : '.grok-';
  const keyBase = runner === 'gemini' ? '.kosmos-gemini-apikey' : '.kosmos-grok-apikey';
  const dir = nodePath.join(HOME, prefix + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, keyBase), 'test-key-' + label + '-WXYZ', { mode: 0o600 });
  return dir;
}

test('#3296: claude -> gemini switches the runner, moves the brief to GEMINI.md, lands on the default account', () => {
  const name = born('sp-gx-claude-to-gemini', 'claude');
  const dir = create.workerDir(name);
  // CONTROLS, so a no-op switch would red rather than pass.
  assert.equal(create.readJob(name).runner, 'claude', 'CONTROL: starts on claude');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'CONTROL: brief starts as CLAUDE.md');

  const sw = create.setProvider(name, 'google', { ...BINS });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(sw.provider, 'google', 'the result names the new provider');
  assert.equal(create.readJob(name).runner, 'gemini', 'the plist now names the gemini runner');
  assert.equal(create.readJob(name).configDir, null, 'the default account writes NO GEMINI_CLI_HOME');
  assert.ok(sw.account && sw.account.isDefault === true, 'the landed account is the default one');
  assert.equal(fs.existsSync(nodePath.join(dir, 'GEMINI.md')), true, 'the brief moved to GEMINI.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), false, 'the old CLAUDE.md is gone');
  assert.equal(store.readProfile(name).provider, 'google', 'the profile provider was stamped');
});

test('#3391: claude -> grok switches the runner and moves the brief to AGENTS.md', () => {
  const name = born('sp-gx-claude-to-grok', 'claude');
  const dir = create.workerDir(name);
  const sw = create.setProvider(name, 'xai', { ...BINS });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(sw.provider, 'xai', 'the result names the new provider');
  assert.equal(create.readJob(name).runner, 'grok', 'the plist now names the grok runner');
  assert.equal(create.readJob(name).configDir, null, 'the default account writes NO GROK_HOME');
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), true, 'the brief moved to AGENTS.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), false, 'the old CLAUDE.md is gone');
  assert.equal(store.readProfile(name).provider, 'xai', 'the profile provider was stamped');
});

test('#3296: a NAMED gemini account is resolved and written as GEMINI_CLI_HOME', () => {
  const accountDir = seedAccount('gemini', 'alpha');
  const name = born('sp-gx-named-gemini', 'claude');
  const sw = create.setProvider(name, 'google', { ...BINS, accountDir });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(sw.account.dir, accountDir, 'the result names the account the person picked');
  assert.equal(sw.account.isDefault, false, 'a labelled account is not the default');
  assert.equal(create.readJob(name).configDir, accountDir, 'the launch job carries the named account home');
});

test('#3296: an UNKNOWN named gemini account is REFUSED and nothing is changed', () => {
  const name = born('sp-gx-unknown-gemini', 'claude');
  const ghost = nodePath.join(HOME, '.gemini-doesnotexist');
  const sw = create.setProvider(name, 'google', { ...BINS, accountDir: ghost });
  assert.equal(sw.outcome, create.OUTCOME.REFUSED, 'an unknown account should fail closed');
  assert.match(String(sw.because), /we do not know that Gemini account/, sw.because);
  assert.equal(create.readJob(name).runner, 'claude', 'the runner was switched despite the refusal');
  assert.equal(fs.existsSync(nodePath.join(create.workerDir(name), 'CLAUDE.md')), true, 'the brief moved despite the refusal');
});

test('#3391: an UNKNOWN named grok account is REFUSED', () => {
  const name = born('sp-gx-unknown-grok', 'claude');
  const ghost = nodePath.join(HOME, '.grok-nope');
  const sw = create.setProvider(name, 'xai', { ...BINS, accountDir: ghost });
  assert.equal(sw.outcome, create.OUTCOME.REFUSED, 'an unknown account should fail closed');
  assert.match(String(sw.because), /we do not know that Grok account/, sw.because);
});

test('#3296: gemini -> claude switches back and moves the brief GEMINI.md -> CLAUDE.md, carrying no account', () => {
  const name = born('sp-gx-gemini-to-claude', 'gemini');
  const dir = create.workerDir(name);
  assert.equal(create.readJob(name).runner, 'gemini', 'CONTROL: starts on gemini');
  const sw = create.setProvider(name, 'anthropic', { ...BINS });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(create.readJob(name).runner, 'claude', 'the plist now names claude');
  assert.equal(sw.account, null, 'a switch to claude carries no gemini/grok account');
  assert.equal(sw.openaiAccount, null, 'and no openai account either');
  assert.equal(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), true, 'the brief moved to CLAUDE.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'GEMINI.md')), false, 'the old GEMINI.md is gone');
});

test('#3391: gemini -> grok switches directly between the two new providers', () => {
  const name = born('sp-gx-gemini-to-grok', 'gemini');
  const dir = create.workerDir(name);
  const sw = create.setProvider(name, 'xai', { ...BINS });
  assert.equal(sw.outcome, create.OUTCOME.CREATED, sw.because);
  assert.equal(create.readJob(name).runner, 'grok', 'the plist now names grok');
  // GEMINI.md -> AGENTS.md (grok boots AGENTS.md).
  assert.equal(fs.existsSync(nodePath.join(dir, 'AGENTS.md')), true, 'the brief moved to AGENTS.md');
  assert.equal(fs.existsSync(nodePath.join(dir, 'GEMINI.md')), false, 'the old GEMINI.md is gone');
});

test('#3296: switching an agent onto the provider it ALREADY runs is refused, naming the provider', () => {
  const name = born('sp-gx-already-gemini', 'gemini');
  const sw = create.setProvider(name, 'google', { ...BINS });
  assert.equal(sw.outcome, create.OUTCOME.REFUSED, 'a no-op switch should be refused');
  assert.match(String(sw.because), /already runs on Gemini/, sw.because);
});

test('#3296: a switch onto a runner that is not installed is refused, naming the runner', () => {
  const name = born('sp-gx-no-gemini-runner', 'claude');
  const missing = nodePath.join(BIN, 'gemini-not-here');
  const sw = create.setProvider(name, 'google', { ...BINS, geminiBin: missing });
  assert.equal(sw.outcome, create.OUTCOME.REFUSED, 'an absent runner should be refused');
  assert.match(String(sw.because), /could not find the Gemini runner/, sw.because);
  assert.equal(create.readJob(name).runner, 'claude', 'the runner was switched despite the missing-runner refusal');
});
