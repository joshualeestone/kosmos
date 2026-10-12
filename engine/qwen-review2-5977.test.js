'use strict';
/**
 * #5977 review 2: every reader that named an agent's provider from its runner alone called a Qwen agent OpenAI (Qwen
 * shares the codex runner). create.agentProvider reads the agent's launch job; these tests run each reader on a Qwen
 * agent and on an OpenAI codex agent (the control), seeded the way create.qwen-5977 seeds them.
 */
const test = require('node:test');
const jobfix = require('../test-support/jobfixture');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-qwen-review2-5977-'));
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

const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

const create = require('./create');
const store = require('./store');
const qwen = require('./qwenaccounts');

const EP = { baseUrl: 'http://localhost:11434/v1', model: 'kosmos-qwen2.5-7b-16k:latest', contextWindow: 16384 };
function codexAgent(name, configDir, profileProvider) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, CODEX_BIN, TMUX_BIN, null, configDir, 'codex'), 'utf8');
  if (profileProvider !== undefined) store.writeProfile(name, { provider: profileProvider });
  return name;
}
const QWEN_HOME = nodePath.join(HOME, qwen.DIR_PREFIX + 'r2');
qwen.storeEndpoint(QWEN_HOME, EP);
const OPENAI_HOME = nodePath.join(HOME, '.codex-r2');
fs.mkdirSync(OPENAI_HOME, { recursive: true });
// The Qwen agent has NO profile: the job alone must say Qwen (the profile is written best-effort).
const QW = codexAgent('r2-qwen', QWEN_HOME);
const OA = codexAgent('r2-openai', OPENAI_HOME, 'openai');

test('#5977 r2: agentProvider reads Qwen from the job, OpenAI otherwise, and falls back to the runner', () => {
  assert.equal(create.agentProvider(QW, 'codex'), 'alibaba');
  assert.equal(create.agentProvider(OA, 'codex'), 'openai', 'CONTROL');
  assert.equal(create.agentProvider('r2-nobody', 'codex'), 'openai', 'no job: the runner answers');
  assert.equal(create.agentProvider(QW, 'claude'), 'anthropic', 'only a codex runner reads the job');
  assert.equal(create.agentProvider(null, 'gemini'), 'google');
});

test('#5977 r2: the failover counts a Qwen agent and an OpenAI one as different providers', () => {
  const { providerOf } = require('./assigner');
  assert.equal(providerOf('codex', QW), 'alibaba');
  assert.equal(providerOf('codex', OA), 'openai', 'CONTROL');
});

test('#5977 r2: a project member on Qwen is in the Qwen family, not GPT', () => {
  const { familyOf } = require('./projectview');
  assert.equal(familyOf('codex', QW), 'Qwen');
  assert.notEqual(familyOf('codex', OA), 'Qwen', 'CONTROL');
});

test('#5977 r2: the org rollup sends a Qwen agent as null (unknown to the company), never as openai', () => {
  const s = require('./orgrollup').defaultSources();
  assert.equal(s.providerOf('codex', QW), null);
  assert.equal(s.providerOf('codex', OA), 'openai', 'CONTROL');
});

test('#5977 r2: a Qwen agent with no profile is told about Qwen, not an OpenAI sign-in', () => {
  const { providerOf } = require('./accountproblem');
  assert.equal(providerOf({ runner: 'codex', sessionName: QW }), 'Qwen');
  assert.equal(providerOf({ runner: 'codex', sessionName: OA }), 'OpenAI', 'CONTROL');
});

test('#5977 r2: the Claude sign-in check is never asked about a Qwen home', () => {
  const { liveAuthForAuthFailed } = require('./status');
  let asked = 0;
  const verdict = () => { asked += 1; return 'healthy'; };
  assert.equal(liveAuthForAuthFailed(QW, (n) => create.readJob(n), verdict), undefined);
  assert.equal(asked, 0, 'the Claude check ran against a Qwen home');
  assert.equal(liveAuthForAuthFailed(OA, (n) => create.readJob(n), verdict), 'healthy', 'CONTROL: another home is still asked');
});

test('#5977 r2: connecting a folder as Qwen is refused, not turned into an OpenAI agent', () => {
  const discover = require('./discover');
  const dir = nodePath.join(SANDBOX, 'workers', 'r2-folder');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'AGENTS.md'), '# brief\n', 'utf8');
  const out = discover.connect(dir, { name: 'r2-folder', provider: 'alibaba' });
  assert.equal(out.ok, false);
  assert.match(out.because, /Qwen/);
  assert.equal(create.readJob('r2-folder'), null, 'nothing was written');
});

test('#5977 r2: a key needs https off this computer, a link-local address is refused, a short key shows no tail', () => {
  const ep = (o) => ({ ...EP, ...o });
  assert.match(qwen.endpointProblem(ep({ baseUrl: 'http://203.0.113.5/v1', key: 'k'.repeat(20) })), /https/);
  assert.equal(qwen.endpointProblem(ep({ baseUrl: 'https://203.0.113.5/v1', key: 'k'.repeat(20) })), null, 'CONTROL: https carries a key');
  assert.equal(qwen.endpointProblem(ep({ baseUrl: 'http://203.0.113.5/v1' })), null, 'CONTROL: http without a key');
  assert.equal(qwen.endpointProblem(ep({ key: 'k'.repeat(20) })), null, 'CONTROL: http to this computer carries a key');
  assert.match(qwen.endpointProblem(ep({ baseUrl: 'http://169.254.169.254/v1' })), /link-local/);
  assert.match(qwen.endpointProblem(ep({ baseUrl: 'http://[fe80::1]/v1' })), /link-local/);
  const shortDir = nodePath.join(HOME, qwen.DIR_PREFIX + 'r2short');
  qwen.storeEndpoint(shortDir, ep({ key: 'abcd1234' }));
  const longDir = nodePath.join(HOME, qwen.DIR_PREFIX + 'r2long');
  qwen.storeEndpoint(longDir, ep({ key: 'abcdefghijklmnop9876' }));
  const rows = qwen.list();
  assert.equal(rows.find((r) => r.dir === shortDir).keyTail, null);
  assert.equal(rows.find((r) => r.dir === longDir).keyTail, '9876', 'CONTROL: a long key still names its last four');
});
