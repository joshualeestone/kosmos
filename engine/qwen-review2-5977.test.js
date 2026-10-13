'use strict';
/**
 * #5977 review 2: every reader that named an agent's provider from its runner alone called a Qwen agent OpenAI (Qwen
 * shares the codex runner). create.agentProvider reads the agent's launch job; these tests run each reader on a Qwen
 * agent and on an OpenAI codex agent (the control), seeded the way create.qwen-5977 seeds them.
 */
const test = require('node:test');
const jobfix = require('../test-support/jobfixture');
const fleet = require('../test-support/fleet');
// A codex agent's pane as Codex draws it when idle (the shape cli.project-show-4581 uses).
const codexCard = (name, opts = {}) => fleet.agent(name, { runner: 'codex', command: 'node', screen: '\u203a Ask Codex to do anything', ...opts });
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
// The suite creates agents, so Claude Code's own config is sandboxed too (fixture-discipline's fourth root).
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
// The sandbox codex is THE codex: Repair (and anything else that asks runners for codex) must not depend on whether
// this machine has one. CI does not; this Mac does, which is how the Repair test passed here and failed there.
process.env.AGENT_WORKFORCE_CODEX_BIN = CODEX_BIN;

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

test('#5977 r2 + #5975: the org rollup sends a Qwen agent as alibaba, never as openai', () => {
  const s = require('./orgrollup').defaultSources();
  assert.equal(s.providerOf('codex', QW), 'alibaba', 'a company cannot see which agents run on its own model');
  assert.equal(s.providerOf('codex', OA), 'openai', 'CONTROL');
});

test('#5975: the rollup body itself carries alibaba for a Qwen agent (build, not only the source)', () => {
  const body = require('./orgrollup').build({ world: 'w', at: new Date().toISOString(), reason: 'daily',
    agents: [{ name: 'qwr2-built', provider: 'alibaba', model: null, state: 'working' },
      { name: 'qwr2-built-unknown', provider: 'somethingnew', model: null, state: 'working' }] });
  const byName = Object.fromEntries((body.agents || []).map((a) => [a.name, a.provider]));
  assert.equal(byName['qwr2-built'], 'alibaba', 'build() dropped alibaba: the console would show a blank provider');
  assert.equal(byName['qwr2-built-unknown'], null, 'CONTROL: an unknown provider must still go as null');
});

test('#5975: a stopped Qwen agent with no launch job goes as alibaba through the whole source chain, never openai', () => {
  const s = require('./orgrollup').defaultSources();
  store.writeProfile('qwr2-nojob', { provider: 'alibaba' });
  store.writeProfile('qwr2-nojob-oa', { provider: 'openai' });
  const sent = (n) => { const r = s.recordedRunner(n); return r ? s.providerOf(r, n) : null; };
  assert.equal(sent('qwr2-nojob'), 'alibaba', 'a stopped Qwen agent with no job was sent as ' + sent('qwr2-nojob'));
  assert.equal(sent('qwr2-nojob-oa'), 'openai', 'CONTROL: an OpenAI agent with no job stays openai');
});

test('#5975: a job is the answer even when an old profile still says alibaba (the job wins, as in accountproblem)', () => {
  const s = require('./orgrollup').defaultSources();
  store.writeProfile(OA, { provider: 'alibaba' });
  try {
    assert.equal(s.providerOf('codex', OA), 'openai', 'a stale alibaba profile overrode an OpenAI launch job');
  } finally {
    store.writeProfile(OA, { provider: 'openai' });
  }
});

test('#5977 r2: a Qwen agent with no profile is told about Qwen, not an OpenAI sign-in', () => {
  const { providerOf } = require('./accountproblem');
  const board = fleet.install([codexCard(QW), codexCard(OA)]);
  try {
    assert.equal(providerOf(board.card(QW)), 'Qwen');
    assert.equal(providerOf(board.card(OA)), 'OpenAI', 'CONTROL');
  } finally { fleet.restore(); }
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

/* ---- review 3 --------------------------------------------------------------------------------------------- */

test('#5977 r3: Windows refuses a Qwen agent everywhere (its codex launch has no endpoint), and says why', () => {
  const acct = nodePath.join(HOME, qwen.DIR_PREFIX + 'r3win');
  qwen.storeEndpoint(acct, EP);
  const name = codexAgent('r3-win-claude', null, 'anthropic');
  const sw = create.setProvider(name, 'alibaba', { accountDir: acct, platform: 'win32', codexBin: CODEX_BIN, tmuxBin: TMUX_BIN });
  assert.equal(sw.outcome, 'refused');
  assert.match(sw.because, /Qwen agent on Windows/);
  // (setAccount's win32 guard is defence only: a Windows job is read through Task Scheduler first, and no Qwen job
  // can exist there once create and switch refuse, so a test process cannot reach it.)
  const made = create.createAgent({ name: 'r3-win-new', role: 'pm', provider: 'alibaba', account: acct, platform: 'win32', codexBin: CODEX_BIN, tmuxBin: TMUX_BIN });
  assert.equal(made.outcome, 'refused');
  assert.match(made.because, /Qwen agent on Windows/);
});

test('#5977 r3: moving a Qwen agent to an account whose model the policy forbids is refused; the codex trust entry goes into the new home', () => {
  const orgpolicy = require('./orgpolicy');
  const okDir = nodePath.join(HOME, qwen.DIR_PREFIX + 'r3ok');
  qwen.storeEndpoint(okDir, EP);
  const badDir = nodePath.join(HOME, qwen.DIR_PREFIX + 'r3bad');
  qwen.storeEndpoint(badDir, { ...EP, model: 'some-other-model' });
  const name = codexAgent('r3-mover', QWEN_HOME, 'alibaba');
  fs.mkdirSync(nodePath.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), JSON.stringify({ org: 'org-1', version: 1, applied_at: 1,
    policy: { providers_allowed: ['alibaba'], models_allowed: { alibaba: [EP.model] } } }));
  try {
    const bad = create.setAccount(name, badDir, { platform: 'darwin' });
    assert.equal(bad.outcome, 'refused');
    assert.match(bad.because, /policy/);
    assert.equal(create.readJob(name).configDir, QWEN_HOME, 'the job was not rewritten');
    const ok = create.setAccount(name, okDir, { platform: 'darwin' });
    assert.equal(ok.outcome, 'created', 'CONTROL: an allowed model moves: ' + ok.because);
    assert.equal(create.readJob(name).configDir, okDir);
    const toml = fs.readFileSync(nodePath.join(okDir, 'config.toml'), 'utf8');
    assert.ok(toml.includes(create.workerDir(name)) || toml.includes(fs.realpathSync(create.workerDir(name))), 'no folder-trust entry in the new Qwen home');
    assert.equal(fs.existsSync(nodePath.join(okDir, '.claude.json')), false, 'a Claude config was written into a Qwen home');
  } finally {
    fs.rmSync(orgpolicy.APPLIED(), { force: true });
  }
});

test('#5977 r3: a message to a signed-out Qwen agent names Qwen, not an OpenAI sign-in', () => {
  const chat = require('./chat');
  const AUTH = require('./status').STATE.AUTH_FAILED;
  const q = chat.waitingNote(AUTH, 'unconfirmed', 'codex', false, QW);
  assert.match(q, /Qwen endpoint/);
  assert.doesNotMatch(q, /sign-in/, 'a Qwen account has no sign-in (review 4)');
  assert.match(chat.waitingNote(AUTH, 'unconfirmed', 'codex', false, OA), /OpenAI sign-in/, 'CONTROL');
});

test('#5977 r3: a job that says OpenAI wins over a stale Qwen profile; the profile speaks only with no job', () => {
  const { providerOf } = require('./accountproblem');
  const stale = codexAgent('r3-stale', OPENAI_HOME, 'alibaba');
  store.writeProfile('r3-nojob', { provider: 'alibaba' });
  const board = fleet.install([codexCard(stale), codexCard('r3-nojob')]);
  try {
    assert.equal(providerOf(board.card(stale)), 'OpenAI');
    assert.equal(providerOf(board.card('r3-nojob')), 'Qwen', 'CONTROL: with no job the profile answers');
  } finally { fleet.restore(); }
});

test('#5977 r3: IPv4 written inside IPv6 is decoded before the link-local test; a key with a control character is refused', () => {
  const ep = (o) => ({ ...EP, ...o });
  for (const u of ['http://[::ffff:169.254.169.254]/v1', 'http://[::ffff:a9fe:a9fe]/v1', 'http://[64:ff9b::169.254.169.254]/v1']) {
    assert.match(String(qwen.endpointProblem(ep({ baseUrl: u }))), /link-local/, u);
  }
  assert.equal(qwen.endpointProblem(ep({ baseUrl: 'http://[::ffff:10.0.0.1]/v1' })), null, 'CONTROL: a mapped private address is not link-local');
  assert.match(String(qwen.endpointProblem(ep({ key: 'abcdefghij\u0000klmnopqrst' }))), /control characters/);
});

test('#5977 r3: the live check never follows a redirect', async () => {
  const http = require('node:http');
  let followed = 0;
  const target = http.createServer((req, res) => { followed += 1; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: EP.model }] })); });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const tp = target.address().port;
  const hop = http.createServer((req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${tp}/v1/models` }); res.end(); });
  await new Promise((r) => hop.listen(0, '127.0.0.1', r));
  try {
    qwen.setFetcher(null);
    const v = await qwen.validateLive({ ...EP, baseUrl: `http://127.0.0.1:${hop.address().port}/v1` });
    assert.equal(followed, 0, 'the redirect was followed');
    assert.notEqual(v.state, qwen.STATE.CONNECTED);
    const direct = await qwen.validateLive({ ...EP, baseUrl: `http://127.0.0.1:${tp}/v1` });
    assert.equal(direct.state, qwen.STATE.CONNECTED, 'CONTROL: the target answers when asked directly');
  } finally { hop.close(); target.close(); }
});

/* ---- review 4 --------------------------------------------------------------------------------------------- */

test('#5977 r4: agentProvider reads a job once per tick, and a switch is seen at once', () => {
  const name = codexAgent('r4-memo', QWEN_HOME, 'alibaba');
  const fsReads = [];
  const orig = fs.readFileSync;
  fs.readFileSync = function patched(p, ...rest) { if (String(p).includes('r4-memo')) fsReads.push(p); return orig.call(this, p, ...rest); };
  try {
    for (let i = 0; i < 5; i += 1) assert.equal(create.agentProvider(name, 'codex'), 'alibaba');
  } finally { fs.readFileSync = orig; }
  assert.ok(fsReads.length <= 1, `five asks in one tick read the job ${fsReads.length} times`);
  // A switch away from Qwen (to Claude: this sandbox has no OpenAI sign-in) rewrites the job through create.
  const sw = create.setProvider(name, 'anthropic', { claudeBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' });
  assert.equal(sw.outcome, 'created', sw.because);
  assert.notEqual(create.agentProvider(name, 'codex'), 'alibaba', 'the switch rewrote the job, so the cached Qwen answer must go');
});

test('#5977 r4: the account list asks a dead endpoint briefly and remembers it for a minute', async () => {
  const http = require('node:http');
  const sockets = new Set();
  const hang = http.createServer(() => { /* never answers */ });
  hang.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const dir = nodePath.join(HOME, qwen.DIR_PREFIX + 'r4dead');
  qwen.storeEndpoint(dir, { ...EP, baseUrl: `http://127.0.0.1:${hang.address().port}/v1` });
  qwen.resetLiveCacheForTest();
  qwen.setFetcher(null);
  try {
    let t0 = Date.now();
    const first = (await qwen.listLive()).find((r) => r.dir === dir);
    const took = Date.now() - t0;
    assert.equal(first.connection.state, qwen.STATE.UNKNOWN);
    assert.ok(took < 4000, `the list waited ${took} ms on one dead endpoint (the person's own check keeps 5 s)`);
    t0 = Date.now();
    await qwen.listLive();
    assert.ok(Date.now() - t0 < 500, 'a dead endpoint is remembered, not asked again on the next list');
  } finally { for (const s of sockets) s.destroy(); hang.close(); }
});

/* ---- review 5 --------------------------------------------------------------------------------------------- */

test('#5977 r5: a Qwen switch and an account move record the account; a switch away clears it', () => {
  const a = nodePath.join(HOME, qwen.DIR_PREFIX + 'r5a'); qwen.storeEndpoint(a, EP);
  const b = nodePath.join(HOME, qwen.DIR_PREFIX + 'r5b'); qwen.storeEndpoint(b, EP);
  const name = codexAgent('r5-rec', null, 'anthropic');
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief\n');
  const sw = create.setProvider(name, 'alibaba', { accountDir: a, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' });
  assert.equal(sw.outcome, 'created', sw.because);
  assert.equal(store.readProfile(name).qwenAccount, a);
  const mv = create.setAccount(name, b, { platform: 'darwin' });
  assert.equal(mv.outcome, 'created', mv.because);
  assert.equal(store.readProfile(name).qwenAccount, b);
  const back = create.setProvider(name, 'anthropic', { claudeBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' });
  assert.equal(back.outcome, 'created', back.because);
  assert.equal(store.readProfile(name).qwenAccount, null, 'an agent no longer on Qwen keeps no Qwen account');
});

test('#5977 r5: create refuses a Qwen account whose endpoint positively says no, and not one it cannot reach', async () => {
  const dir = nodePath.join(HOME, qwen.DIR_PREFIX + 'r5conn'); qwen.storeEndpoint(dir, EP);
  qwen.resetLiveCacheForTest();
  qwen.setFetcher(async () => ({ status: 401, body: null }));
  try {
    const no = await create.accountConnectable({ provider: 'alibaba', accountDir: dir });
    assert.equal(no.ok, false);
    assert.match(no.because, /did not accept the key/);
    qwen.setFetcher(async () => { throw new Error('ECONNREFUSED'); });
    assert.equal((await create.accountConnectable({ provider: 'alibaba', accountDir: dir })).ok, true, 'CONTROL: Ollama closed is not a refusal');
  } finally { qwen.setFetcher(null); }
});

test('#5977 r5: a held message to a Qwen agent never mentions signing in', () => {
  const chat = require('./chat');
  // Real cards, signed out the way a codex agent is: its supervisor's automatic blocked report (engine/signinhold-5948
  // does the same). The fleet is installed once to learn the board name the report is filed under, then again so the
  // card is read with the report in place.
  const selfreport = require('./selfreport');
  const first = fleet.install([codexCard(QW)]);
  const boardName = first.card(QW).name;
  fleet.restore();
  assert.equal(selfreport.record(boardName, { state: 'blocked', auto: true, on: 'provider api (authentication_failed)',
    owner: 'provider', because: 'the endpoint refused the request' }).recorded, true, 'premise: the report was recorded');
  const board = fleet.install([codexCard(QW, { state: null })]);
  let v;
  try {
    assert.equal(board.card(QW).state, require('./status').STATE.AUTH_FAILED, 'premise: the card is a reported failed sign-in');
    v = chat.signinHeldVerdict(QW, board.agents);
  } finally { fleet.restore(); fs.rmSync(selfreport.DIR, { recursive: true, force: true }); }
  assert.ok(v, "the held verdict was not reached");
  assert.match(v.because, /Qwen endpoint/);
  assert.doesNotMatch(v.because, /signed/);
  const src = fs.readFileSync(nodePath.join(__dirname, 'chat.js'), 'utf8');
  assert.match(src, /provider === 'Qwen'   \/\/ #5977 review 5: a Qwen account has no sign-in/, 'the Qwen branch of the held sentence is gone');
});

test('#5977 r5: a slow endpoint is "did not answer in time", not "could not reach"', async () => {
  qwen.setFetcher(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  try {
    const v = await qwen.validateLive({ ...EP, baseUrl: 'https://qwen.example.com/v1' });
    assert.match(v.because, /did not answer in time/);
    qwen.setFetcher(async () => { throw new Error('ECONNREFUSED'); });
    assert.match((await qwen.validateLive({ ...EP, baseUrl: 'https://qwen.example.com/v1' })).because, /could not reach/, 'CONTROL');
  } finally { qwen.setFetcher(null); }
});

/* ---- review 6 --------------------------------------------------------------------------------------------- */

test('#5977 r6: codexJobProvider says null with no job, so a caller can fall back; agentProvider still floors at the runner', () => {
  assert.equal(create.codexJobProvider(QW), 'alibaba');
  assert.equal(create.codexJobProvider(OA), 'openai');
  assert.equal(create.codexJobProvider('r6-nobody'), null, 'no job is not OpenAI');
  assert.equal(create.agentProvider('r6-nobody', 'codex'), 'openai', 'CONTROL: the floor callers rely on');
});

test('#5977 r6: an account move that cannot record the new account moves nothing', () => {
  const a = nodePath.join(HOME, qwen.DIR_PREFIX + 'r6a'); qwen.storeEndpoint(a, EP);
  const b = nodePath.join(HOME, qwen.DIR_PREFIX + 'r6b'); qwen.storeEndpoint(b, EP);
  const name = codexAgent('r6-mover', a, 'alibaba');
  store.writeProfile(name, { qwenAccount: a });
  const orig = store.writeProfile;
  store.writeProfile = () => { throw new Error('disk full'); };
  let r;
  try { r = create.setAccount(name, b, { platform: 'darwin' }); } finally { store.writeProfile = orig; }
  assert.equal(r.outcome, 'refused');
  assert.equal(create.readJob(name).configDir, a, 'the job moved while the record did not');
  const ok = create.setAccount(name, b, { platform: 'darwin' });
  assert.equal(ok.outcome, 'created', 'CONTROL: ' + ok.because);
  assert.equal(store.readProfile(name).qwenAccount, b);
});

/* ---- review 7 --------------------------------------------------------------------------------------------- */

test('#5977 r7: a switch to Qwen that cannot record it changes nothing; a recorded one carries its account', () => {
  const a = nodePath.join(HOME, qwen.DIR_PREFIX + 'r7a'); qwen.storeEndpoint(a, EP);
  const name = codexAgent('r7-sw', null, 'anthropic');
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), '# brief\n');
  const before = create.readJob(name).configDir;
  const orig = store.writeProfile;
  store.writeProfile = () => { throw new Error('disk full'); };
  let r;
  try { r = create.setProvider(name, 'alibaba', { accountDir: a, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' }); }
  finally { store.writeProfile = orig; }
  assert.equal(r.outcome, 'refused');
  assert.equal(create.readJob(name).configDir, before, 'the job moved to Qwen while the record still said otherwise');
  const ok = create.setProvider(name, 'alibaba', { accountDir: a, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' });
  assert.equal(ok.outcome, 'created', 'CONTROL: ' + ok.because);
  assert.equal(store.readProfile(name).qwenAccount, a);
});

test('#5977 r7: the create pre-check asks only a listed Qwen account', async () => {
  const stray = nodePath.join(HOME, 'not-a-qwen-account');
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(nodePath.join(stray, qwen.ENDPOINT_BASENAME), JSON.stringify({ ...EP, baseUrl: 'https://stray.example.com/v1' }));
  let asked = 0;
  qwen.setFetcher(async () => { asked += 1; return { status: 401, body: null }; });
  try {
    assert.equal((await create.accountConnectable({ provider: 'alibaba', accountDir: stray })).ok, true);
    assert.equal(asked, 0, 'an unlisted folder\'s endpoint was fetched');
  } finally { qwen.setFetcher(null); }
});

test('#5977 r7: IPv4-compatible IPv6 and the IPv6 metadata address are link-local too', () => {
  for (const u of ['http://[::a9fe:a9fe]/v1', 'http://[::169.254.169.254]/v1', 'http://[fd00:ec2::254]/v1']) {
    assert.match(String(qwen.endpointProblem({ ...EP, baseUrl: u })), /link-local/, u);
  }
  assert.equal(qwen.endpointProblem({ ...EP, baseUrl: 'http://[::1]:11434/v1' }), null, 'CONTROL: this computer');
});

test('#5977 r7: the supervisor takes the key only from a launch-key that succeeded (pinned: a race cannot be staged)', () => {
  const sup = fs.readFileSync(nodePath.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  assert.match(sup, /launch-key "\$EFFECTIVE_CODEX_HOME" 2>\/dev\/null\)" \|\| _ep_key=""/);
  assert.doesNotMatch(sup, /launch-key "\$EFFECTIVE_CODEX_HOME" 2>\/dev\/null \|\| true\)/, 'a failed launch-key\'s words would become the key');
});

/* Last in the file: setRunner(null) leaves dry-run on, which the earlier switch tests must not inherit. */
test('#5977 r5: Repair rebuilds a Qwen agent on its recorded Qwen account, and refuses rather than make it OpenAI', () => {
  const register = require('./register');
  // installJob would bootstrap with the real launchctl; stubbed, as create.installjob-gemini-grok-3296 does.
  create.setRunner(() => ({ ok: true, stdout: '' })); create.setDryRun(false);
  try {
  const acct = nodePath.join(HOME, qwen.DIR_PREFIX + 'r5rep');
  qwen.storeEndpoint(acct, EP);
  // A Qwen agent whose job is gone, with its account recorded.
  fs.mkdirSync(create.workerDir('r5-known'), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir('r5-known'), 'AGENTS.md'), '# brief\n');
  store.writeProfile('r5-known', { provider: 'alibaba', qwenAccount: acct });
  fs.mkdirSync(create.workerDir('r5-unknown'), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir('r5-unknown'), 'AGENTS.md'), '# brief\n');
  store.writeProfile('r5-unknown', { provider: 'alibaba' });
  const out = register.repair({ platform: 'darwin' });
  const r = (out.results || []).find((x) => x.name === 'r5-known');
  const u = (out.results || []).find((x) => x.name === 'r5-unknown');
  assert.ok(r && u, 'repair did not see both job-less agents: ' + JSON.stringify(out));
  const job = create.readJob('r5-known');
  assert.ok(job, 'repair wrote no job: ' + JSON.stringify(r));
  assert.equal(job.runner, 'codex');
  assert.equal(job.configDir, acct, 'rebuilt without its Qwen account, it would be an OpenAI agent');
  // One with no account recorded (an agent made before this was recorded).
  assert.equal(u.ok, false);
  assert.match(u.because, /switch it to Qwen again/);
  assert.equal(create.readJob('r5-unknown'), null, 'no OpenAI job was written for a Qwen agent');
  // installJob, the shared door (connect, backfill), refuses the same way.
  const i = create.installJob('r5-unknown', { platform: 'darwin' });
  assert.equal(i.ok, false);
  assert.equal(create.readJob('r5-unknown'), null);
  // And create records the account at birth, which is what Repair reads back.
  const born = create.createAgent({ name: 'r5-born', role: 'pm', provider: 'alibaba', account: acct, codexBin: CODEX_BIN, claudeBin: CODEX_BIN, tmuxBin: TMUX_BIN, platform: 'darwin' });
  assert.equal(born.outcome, 'created', born.because);
  assert.equal(store.readProfile('r5-born').qwenAccount, acct);
  // Review 6: a policy-held Qwen agent is checked against its account's model on Repair.
  const orgpolicy = require('./orgpolicy');
  const other = nodePath.join(HOME, qwen.DIR_PREFIX + 'r6pol'); qwen.storeEndpoint(other, { ...EP, model: 'not-allowed-model' });
  fs.mkdirSync(create.workerDir('r6-held'), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir('r6-held'), 'AGENTS.md'), '# brief\n');
  store.writeProfile('r6-held', { provider: 'alibaba', qwenAccount: other, policyHeld: true });
  fs.mkdirSync(nodePath.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), JSON.stringify({ org: 'org-1', version: 1, applied_at: 1,
    policy: { providers_allowed: ['alibaba'], models_allowed: { alibaba: [EP.model] } } }));
  try {
    const held = (register.repair({ platform: 'darwin' }).results || []).find((x) => x.name === 'r6-held');
    assert.ok(held, 'repair did not see the held agent');
    assert.equal(held.ok, false, 'a model the policy forbids was restored');
    assert.match(String(held.because), /not-allowed-model/);
  } finally { fs.rmSync(orgpolicy.APPLIED(), { force: true }); }
  } finally { create.setRunner(null); }
});

