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
// The sandbox claude is THE claude, as qwen-review2-5977 does for codex: Repair must not depend on this machine's.
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;

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

/* ---- switching an agent onto a vendor (setProvider), and Repair ---------------------------------------------- */
const store = require('./store');
const BINS = { claudeBin: CLAUDE_BIN, tmuxBin: TMUX_BIN };
function born(name, configDir, provider) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir || null, 'claude'), 'utf8');
  store.writeProfile(name, { provider });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief\n', 'utf8');
  return name;
}
function withSwitch(on, fn) { return require('../test-support/compat-switch').withSwitch(on, fn); }   // the marker in store.ROOT

test('switch OFF (the default): a switch to DeepSeek is refused and changes nothing', () => {
  const name = born('c7206-off', null, 'anthropic');
  const before = fs.readFileSync(jobfix.jobPath(name), 'utf8');
  const sw = withSwitch(false, () => create.setProvider(name, 'deepseek', { ...BINS, accountDir: DS_HOME, platform: 'darwin' }));
  assert.equal(sw.outcome, 'refused');
  assert.equal(sw.because, 'DeepSeek is not available in Kosmos yet');
  assert.equal(fs.readFileSync(jobfix.jobPath(name), 'utf8'), before, 'the job changed');
  assert.equal(store.readProfile(name).provider, 'anthropic');
});

test('switch ON: claude -> DeepSeek runs on the named account, records it for Repair; DeepSeek -> DeepSeek is refused', () => {
  const name = born('c7206-on', null, 'anthropic');
  const sw = withSwitch(true, () => create.setProvider(name, 'deepseek', { ...BINS, accountDir: DS_HOME, pickedByPerson: true, platform: 'darwin' }));
  assert.equal(sw.outcome, 'created', sw.because);
  const job = create.readJob(name);
  assert.equal(job.runner, 'claude');
  assert.equal(job.configDir, DS_HOME, 'the vendor account folder is the agent\'s CLAUDE_CONFIG_DIR');
  assert.equal(create.jobProvider(job), 'deepseek');
  const prof = store.readProfile(name);
  assert.equal(prof.provider, 'deepseek');
  assert.equal(prof.vendorAccount, DS_HOME, 'Repair would rebuild it without its account');
  const again = withSwitch(true, () => create.setProvider(name, 'deepseek', { ...BINS, accountDir: DS_HOME, platform: 'darwin' }));
  assert.equal(again.outcome, 'refused');
  assert.match(again.because, /already runs on DeepSeek/);
});

test('switch ON: a switch to DeepSeek needs a known, usable account; never Windows; refusals change nothing', () => {
  const name = born('c7206-refuse', null, 'anthropic');
  const before = fs.readFileSync(jobfix.jobPath(name), 'utf8');
  withSwitch(true, () => {
    const none = create.setProvider(name, 'deepseek', { ...BINS, platform: 'darwin' });
    assert.match(none.because, /pick which DeepSeek account/);
    const unknown = create.setProvider(name, 'deepseek', { ...BINS, accountDir: nodePath.join(HOME, '.kosmos-deepseek-nope'), platform: 'darwin' });
    assert.equal(unknown.outcome, 'refused');
    const claudeDir = create.setProvider(name, 'deepseek', { ...BINS, accountDir: CLAUDE_HOME, platform: 'darwin' });
    assert.equal(claudeDir.outcome, 'refused', 'a Claude folder was taken as a DeepSeek account');
    const win = create.setProvider(name, 'deepseek', { ...BINS, accountDir: DS_HOME, platform: 'win32' });
    assert.equal(win.because, 'DeepSeek is not available in Kosmos yet', 'Windows, whose launch does not point at a vendor');
  });
  assert.equal(fs.readFileSync(jobfix.jobPath(name), 'utf8'), before, 'a refusal changed the job');
});

test('a DeepSeek agent\'s model is its account\'s: a model change is refused', () => {
  const name = born('c7206-model', DS_HOME, 'deepseek');
  const r = create.setModel(name, 'claude-opus-5', { ...BINS, platform: 'darwin' });
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /is on DeepSeek, which runs the model its DeepSeek account names/);
});

test('Repair rebuilds a lost DeepSeek job on its recorded account, and refuses one whose account it does not know', () => {
  const register = require('./register');
  create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false);
  require('../test-support/compat-switch').set(true);
  try {
    for (const [n, prof] of [['c7206-rep-known', { provider: 'deepseek', vendorAccount: DS_HOME }], ['c7206-rep-unknown', { provider: 'deepseek' }]]) {
      fs.mkdirSync(create.workerDir(n), { recursive: true });
      fs.writeFileSync(nodePath.join(create.workerDir(n), 'CLAUDE.md'), '# brief\n');
      store.writeProfile(n, prof);
      require('./liveness').seen(n);
    }
    const out = register.repair({ platform: 'darwin' });
    const k = (out.results || []).find((x) => x.name === 'c7206-rep-known');
    const u = (out.results || []).find((x) => x.name === 'c7206-rep-unknown');
    assert.ok(k && u, 'repair did not see both: ' + JSON.stringify(out));
    const job = create.readJob('c7206-rep-known');
    assert.ok(job, 'repair wrote no job: ' + JSON.stringify(k));
    assert.equal(job.runner, 'claude');
    assert.equal(job.configDir, DS_HOME, 'rebuilt without its account, it would be a Claude agent on the default account');
    assert.equal(u.ok, false);
    assert.match(String(u.because), /runs on DeepSeek and Kosmos does not know which DeepSeek account/);
    assert.equal(create.readJob('c7206-rep-unknown'), null, 'an agent with no recorded account was rebuilt anyway');
  } finally {
    create.setRunner(null);
    require('../test-support/compat-switch').set(false);
  }
});

test('1b review 1: with the switch OFF, Repair does not rebuild a DeepSeek agent (it would launch with the key)', () => {
  const register = require('./register');
  create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false);
  try {
    const n = 'c7206-rep-off';
    fs.mkdirSync(create.workerDir(n), { recursive: true });
    fs.writeFileSync(nodePath.join(create.workerDir(n), 'CLAUDE.md'), '# brief\n');
    store.writeProfile(n, { provider: 'deepseek', vendorAccount: DS_HOME });
    require('./liveness').seen(n);
    const out = withSwitch(false, () => register.repair({ platform: 'darwin' }));
    const r = (out.results || []).find((x) => x.name === n);
    assert.ok(r, 'repair did not see it: ' + JSON.stringify(out));
    assert.equal(r.ok, false);
    assert.match(String(r.because), /DeepSeek is not available in Kosmos yet/);
    assert.equal(create.readJob(n), null, 'a DeepSeek agent was rebuilt with the switch off');
  } finally { create.setRunner(null); }
});

test('1b review 1: an account move keeps the provider: DeepSeek between DeepSeek accounts only, never Claude onto one', () => {
  const DS2 = nodePath.join(HOME, '.kosmos-deepseek-two');
  compat.storeAccount(DS2, { vendor: 'deepseek', model: 'deepseek-reasoner', key: 'sk-deepseek-second-0123456789' });
  const ds = born('c7206-move-ds', DS_HOME, 'deepseek');
  store.writeProfile(ds, { provider: 'deepseek', vendorAccount: DS_HOME });
  const cl = born('c7206-move-cl', null, 'anthropic');
  withSwitch(true, () => {
    const moved = create.setAccount(ds, DS2, { ...BINS, platform: 'darwin' });
    assert.equal(moved.outcome, 'created', moved.because);
    assert.equal(create.readJob(ds).configDir, DS2);
    assert.equal(store.readProfile(ds).vendorAccount, DS2, 'Repair would rebuild it on the old account');
    const toClaude = create.setAccount(ds, CLAUDE_HOME, { ...BINS, platform: 'darwin' });
    assert.equal(toClaude.outcome, 'refused');
    assert.match(toClaude.because, /runs on DeepSeek; to move it to another provider, switch its provider/);
    const toDefault = create.setAccount(ds, '', { ...BINS, platform: 'darwin' });
    assert.equal(toDefault.outcome, 'refused', 'the default (Claude) account is another provider too');
    const claudeOnto = create.setAccount(cl, DS2, { ...BINS, platform: 'darwin' });
    assert.equal(claudeOnto.outcome, 'refused');
    assert.match(claudeOnto.because, /runs on Claude; to move it to DeepSeek, switch its provider/);
  });
  assert.equal(create.readJob(ds).configDir, DS2, 'a refused move changed the job');
  const off = withSwitch(false, () => create.setAccount(ds, DS_HOME, { ...BINS, platform: 'darwin' }));
  assert.equal(off.because, 'DeepSeek is not available in Kosmos yet', 'a move between DeepSeek accounts with the switch off');
});

/* Real cards from the board's own snapshot (fixture-discipline: no card is built by hand), for the agents above,
   whose launch jobs are real; the pane source is test-support/fleet's. */
function cardsFor(states) {
  const fleet = require('../test-support/fleet');
  const board = fleet.install(Object.entries(states).map(([sn, [state, displayName]]) => fleet.agent(sn, { state, runner: 'claude', displayName })));
  try {
    const agents = require('./status').snapshot().agents;
    return Object.fromEntries(Object.keys(states).map((sn) => [sn, agents.find((c) => c && c.sessionName === sn)]));
  } finally { board.restore(); }
}

test('a DeepSeek agent\'s problems name DeepSeek and its key, never a Claude sign-in; a Claude agent is unchanged', () => {
  const { accountProblemOf } = require('./accountproblem');
  const failing = cardsFor({ [DS]: ['auth_failed', 'Dee'], [CL]: ['auth_failed', 'Cee'] });
  const limited = cardsFor({ [DS]: ['rate_limited', 'Dee'] });
  assert.ok(failing[DS] && failing[CL] && limited[DS], 'PRE-CONTROL: the board gave no card for the agents');
  const auth = accountProblemOf(failing[DS]);
  assert.equal(auth.provider, 'DeepSeek');
  assert.match(auth.text, /Dee's DeepSeek key is no longer accepted/);
  assert.doesNotMatch(auth.text, /Claude|Sign in again/);
  const limit = accountProblemOf(limited[DS]);
  assert.match(limit.text, /DeepSeek usage limit/);
  assert.doesNotMatch(limit.summary, /Claude/);
  // CONTROL: a Claude agent still reads as Claude.
  const claudeAuth = accountProblemOf(failing[CL]);
  assert.equal(claudeAuth.provider, 'Claude');
  assert.match(claudeAuth.text, /Claude sign-in has stopped working/);
});

test('the setup guide masks a DeepSeek account\'s key by value', () => {
  const held = require('./knownsecrets').collect({ home: HOME });
  assert.ok(held.includes('sk-deepseek-0123456789abcdef'), 'the DeepSeek key is not among the known secrets');
});

test('1b review 2: a switch onto Qwen still writes its codex trust entry; a switch onto DeepSeek writes no codex config', (t) => {
  // The Qwen account block runs only out of dry-run (earlier tests' setRunner(null) turns dry-run back on).
  create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false);
  t.after(() => create.setRunner(null));
  const qwen = require('./qwenaccounts');
  const qdir = nodePath.join(HOME, qwen.DIR_PREFIX + 'trust7206');
  qwen.storeEndpoint(qdir, { baseUrl: 'http://localhost:11434/v1', model: 'kosmos-qwen2.5-7b-16k:latest', contextWindow: 16384 });
  const toQwen = born('c7206-trust-qwen', null, 'anthropic');
  const codexBin = nodePath.join(BIN, 'codex');
  fs.writeFileSync(codexBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const q = create.setProvider(toQwen, 'alibaba', { ...BINS, codexBin, accountDir: qdir, platform: 'darwin' });
  assert.equal(q.outcome, 'created', q.because);
  const qcfg = nodePath.join(qdir, 'config.toml');
  assert.ok(fs.existsSync(qcfg) && fs.readFileSync(qcfg, 'utf8').includes(fs.realpathSync(create.workerDir(toQwen)))   /* the trust file holds the real path (/private/var) */, 'the Qwen switch lost its codex trust entry');

  const DS3 = nodePath.join(HOME, '.kosmos-deepseek-trust');
  compat.storeAccount(DS3, { vendor: 'deepseek', model: 'deepseek-chat', key: 'sk-deepseek-trust-0123456789' });
  const toDs = born('c7206-trust-ds', null, 'anthropic');
  const d = withSwitch(true, () => create.setProvider(toDs, 'deepseek', { ...BINS, accountDir: DS3, platform: 'darwin' }));
  assert.equal(d.outcome, 'created', d.because);
  assert.equal(fs.existsSync(nodePath.join(DS3, 'config.toml')), false, 'a codex config was written into a DeepSeek (Claude Code) folder');
});
