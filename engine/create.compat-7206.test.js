'use strict';
/**
 * #7206 slice 1b: a claude agent on a vendor account (~/.kosmos-deepseek-<label>) runs on that vendor. The provider is
 * read from the agent's launch job (create.jobProvider / agentProvider), the way a Qwen agent's is on codex, so every
 * reader that names an agent's provider says DeepSeek, never Anthropic. Seeded the way qwen-review2-5977 seeds jobs.
 *
 *   node --test engine/create.compat-7206.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const jobfix = require('../test-support/jobfixture');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-create-compat-7206-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

const create = require('./create');
const compat = require('./anthropiccompat');

function claudeAgent(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'claude'), 'utf8');
  return name;
}
const DS_HOME = nodePath.join(HOME, '.kosmos-deepseek-work');
compat.storeAccount(DS_HOME, { vendor: 'deepseek', model: 'deepseek-chat', key: 'sk-deepseek-0123456789abcdef' });
const CLAUDE_HOME = nodePath.join(HOME, '.claude-work');
fs.mkdirSync(CLAUDE_HOME, { recursive: true });
const DS = claudeAgent('c7206-ds', DS_HOME);
const CL = claudeAgent('c7206-claude', CLAUDE_HOME);

test('the provider map: a vendor runs on claude and is named by the vendor', () => {
  assert.equal(create.providerRunner('deepseek'), 'claude');
  assert.equal(create.providerLabel('deepseek'), 'DeepSeek');
  assert.equal(create.providerLabel('anthropic'), 'Anthropic', 'CONTROL');
  assert.equal(create.providerLabel('constructor'), 'Anthropic', 'an inherited name is not a vendor');
});

test('jobProvider: a claude job on a vendor folder is that vendor; a Claude folder and a codex job are unchanged', () => {
  assert.equal(create.jobProvider({ runner: 'claude', configDir: DS_HOME }), 'deepseek');
  // A vendor folder whose account file went missing is still the vendor's (it fails closed at launch).
  assert.equal(create.jobProvider({ runner: 'claude', configDir: nodePath.join(HOME, '.kosmos-deepseek-gone') }), 'deepseek');
  assert.equal(create.jobProvider({ runner: 'claude', configDir: CLAUDE_HOME }), 'anthropic', 'CONTROL');
  assert.equal(create.jobProvider({ runner: 'claude' }), 'anthropic', 'the default account');
  assert.equal(create.jobProvider({ runner: 'codex', configDir: DS_HOME }), 'openai', 'only a claude job reads a vendor folder');
});

test('agentProvider reads a claude agent\'s job: DeepSeek for the vendor agent, Anthropic otherwise', () => {
  assert.equal(create.agentProvider(DS, 'claude'), 'deepseek');
  assert.equal(create.claudeJobProvider(DS), 'deepseek');
  assert.equal(create.agentProvider(CL, 'claude'), 'anthropic', 'CONTROL');
  assert.equal(create.agentProvider('c7206-nobody', 'claude'), 'anthropic', 'no job: the runner answers');
  assert.equal(create.claudeJobProvider('c7206-nobody'), null);
});

test('the project view names a DeepSeek member DeepSeek, never Claude', () => {
  const pv = require('./projectview');
  const familyOf = pv.familyOf || (pv._test && pv._test.familyOf);
  if (!familyOf) return;   // not exported: the provider itself is pinned above
  assert.equal(familyOf('claude', DS), 'DeepSeek');
  assert.equal(familyOf('claude', CL), 'Claude', 'CONTROL');
});
