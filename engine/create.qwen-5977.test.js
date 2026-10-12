'use strict';
/**
 * #5977: an agent can be switched onto and off Qwen (provider `alibaba`, the codex runner pointed at a Qwen
 * account's endpoint). OpenAI and Qwen share the codex runner, so the provider a job runs on is read from the job
 * (jobProvider): a codex job whose account home holds a Qwen endpoint is Qwen. Seeded directly (jobfixture +
 * writeProfile), the seam create.setprovider-google-xai-3296 uses; setProvider never calls launchctl.
 */
const test = require('node:test');
const jobfix = require('../test-support/jobfixture');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-create-qwen-5977-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const BINS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN };

const create = require('./create');
const store = require('./store');
const qwen = require('./qwenaccounts');

const EP = { baseUrl: 'http://localhost:11434/v1', model: 'kosmos-qwen2.5-7b-16k:latest', contextWindow: 16384 };
function qwenAccount(label) {
  const dir = nodePath.join(HOME, qwen.DIR_PREFIX + label);
  qwen.storeEndpoint(dir, EP);
  return dir;
}
function born(name, runner, configDir, provider) {
  const runnerBin = runner === 'codex' ? CODEX_BIN : CLAUDE_BIN;
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, runnerBin, TMUX_BIN, null, configDir || null, runner), 'utf8');
  store.writeProfile(name, { provider });
  fs.writeFileSync(nodePath.join(create.workerDir(name), runner === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'), '# brief\n', 'utf8');
  return name;
}

test('#5977: the provider maps: alibaba runs on codex, is labelled Qwen, and codex alone still means OpenAI', () => {
  assert.equal(create.providerRunner('alibaba'), 'codex');
  assert.equal(create.providerLabel('alibaba'), 'Qwen');
  assert.equal(create.runnerProvider('codex'), 'openai', 'the runner alone cannot say Qwen');
});

test('#5977: jobProvider reads Qwen from a codex job whose account home holds an endpoint, and OpenAI otherwise', () => {
  const acct = qwenAccount('jp');
  assert.equal(create.jobProvider({ runner: 'codex', configDir: acct }), 'alibaba');
  assert.equal(create.jobProvider({ runner: 'codex', configDir: null }), 'openai');
  const openaiHome = nodePath.join(HOME, '.codex-jp'); fs.mkdirSync(openaiHome, { recursive: true });
  assert.equal(create.jobProvider({ runner: 'codex', configDir: openaiHome }), 'openai', 'CONTROL: an OpenAI home is OpenAI');
  assert.equal(create.jobProvider({ runner: 'claude' }), 'anthropic');
});

test('#5977: claude -> Qwen switches to codex on the named Qwen account, writes it as the account home, records alibaba', () => {
  const acct = qwenAccount('sw1');
  const name = born('qw-claude-to-qwen', 'claude', null, 'anthropic');
  const sw = create.setProvider(name, 'alibaba', { ...BINS, accountDir: acct, pickedByPerson: true });
  assert.equal(sw.outcome, 'created', sw.because);
  const job = create.readJob(name);
  assert.equal(job.runner, 'codex');
  assert.equal(job.configDir, acct, 'the Qwen account folder is the codex account home');
  assert.equal(store.readProfile(name).provider, 'alibaba');
  assert.equal(sw.account.dir, acct);
  assert.equal(sw.account.chosen, true);
  assert.equal(sw.openaiAccount, null, 'no OpenAI sign-in was looked up for a Qwen switch');
  assert.equal(fs.existsSync(nodePath.join(create.workerDir(name), 'AGENTS.md')), true, 'the brief moved to the codex file');
});

test('#5977: OpenAI -> Qwen is a real switch (same runner, different provider), and Qwen -> Qwen is refused', () => {
  const acct = qwenAccount('sw2');
  const name = born('qw-openai-to-qwen', 'codex', null, 'openai');
  const sw = create.setProvider(name, 'alibaba', { ...BINS, accountDir: acct });
  assert.equal(sw.outcome, 'created', sw.because);
  assert.equal(create.readJob(name).configDir, acct);
  const again = create.setProvider(name, 'alibaba', { ...BINS, accountDir: acct });
  assert.equal(again.outcome, 'refused');
  assert.match(again.because, /already runs on Qwen/);
});

test('#5977: a switch to Qwen needs a known, usable Qwen account, and refuses without changing anything', () => {
  const name = born('qw-refusals', 'claude', null, 'anthropic');
  const before = fs.readFileSync(jobfix.jobPath(name), 'utf8');
  const none = create.setProvider(name, 'alibaba', { ...BINS });
  assert.equal(none.outcome, 'refused');
  assert.match(none.because, /pick which Qwen account/);
  const unknown = create.setProvider(name, 'alibaba', { ...BINS, accountDir: nodePath.join(HOME, qwen.DIR_PREFIX + 'nope') });
  assert.match(unknown.because, /do not know that Qwen account/);
  const bad = nodePath.join(HOME, qwen.DIR_PREFIX + 'bad'); fs.mkdirSync(bad);
  fs.writeFileSync(qwen.endpointFile(bad), JSON.stringify({ ...EP, contextWindow: 4096 }));
  const unusable = create.setProvider(name, 'alibaba', { ...BINS, accountDir: bad });
  assert.match(unusable.because, /cannot be used .*16384/);
  assert.equal(fs.readFileSync(jobfix.jobPath(name), 'utf8'), before, 'the launch job is unchanged by every refusal');
});

test('#5977: Qwen -> OpenAI switches back to an OpenAI home (the Qwen folder is not kept as the account home)', () => {
  const acct = qwenAccount('sw3');
  const openaiHome = nodePath.join(HOME, '.codex-work1');
  fs.mkdirSync(openaiHome, { recursive: true });
  fs.writeFileSync(nodePath.join(openaiHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test-openai-key-1234' }), { mode: 0o600 });
  const name = born('qw-qwen-to-openai', 'codex', acct, 'alibaba');
  const sw = create.setProvider(name, 'openai', { ...BINS, accountDir: openaiHome, pickedByPerson: true });
  assert.equal(sw.outcome, 'created', sw.because);
  assert.notEqual(create.readJob(name).configDir, acct, 'the Qwen folder is no longer the account home');
  assert.equal(create.jobProvider(create.readJob(name)), 'openai');
  assert.equal(store.readProfile(name).provider, 'openai');
});
