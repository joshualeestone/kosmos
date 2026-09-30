'use strict';
/**
 * #4603 (#4580 item 12, the Grok agent: "kosmos whoami cannot name the Grok model or account, even when the session
 * is Grok 4.6 on a connected xAI subscription"). Traced on main: the runner WAS named, as "a grok agent" in lower
 * case; the model was always null (the live reader knows only claude and codex, and the card's own session model was
 * never consulted); and the account was looked up in the Claude list alone, so a Grok account was never found.
 *
 * Pins: Grok and Gemini are named properly; a non-Claude agent's model comes from its card (what its session file
 * says, as the board shows it); a Grok agent on a key or a subscription is named by its account through the route's
 * account list; a Claude agent's answer is unchanged (CONTROL).
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whoami-grok-4603-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_GROK_HOME = path.join(SANDBOX, 'home', '.grok');
process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(SANDBOX, 'home', '.gemini');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_GROK_HOME, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_GEMINI_HOME, { recursive: true });

const srv = require('./server');
const { start, server, whoamiFor, sentenceForWhoami, setLiveReader } = srv;
const create = require('./engine/create');
const grokAccounts = require('./engine/grokaccounts');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

const NO_LIVE = () => ({ ok: false, because: 'nothing that looks like Claude Code or Codex is running under it' });
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; setLiveReader(NO_LIVE); });
test.after(() => { setLiveReader(null); try { server.close(); } catch { /* ignore */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function job(name, runner, bin) {
  fs.writeFileSync(create.plistPath(name), create.plistFor(name, bin, '/opt/homebrew/bin/tmux', null, null, runner), 'utf8');
  assert.equal(create.readJob(name).runner, runner, 'the plist this test wrote does not read back as ' + runner);
}
function grokJob(name) { job(name, 'grok', '/opt/homebrew/bin/grok'); }

test('#4603 the sentence names Grok and Gemini by their product names', () => {
  assert.match(sentenceForWhoami(null, null, 'grok'), /^This is a Grok agent, and /);
  assert.match(sentenceForWhoami(null, null, 'gemini'), /^This is a Gemini agent, and /);
  assert.match(sentenceForWhoami(null, null, 'codex'), /^This is a Codex agent, and /, 'CONTROL: Codex as before');
  const key = { email: null, name: null, label: null, keyTail: 'ABCD', dir: '/x' };
  assert.match(sentenceForWhoami(key, null, 'grok'), /runs on the API key ending in ABCD/);
  assert.match(sentenceForWhoami(Object.assign({}, key, { label: 'work' }), null, 'grok'), /runs on work\b/, 'a person-chosen label outranks the key tail');
});

test('#4603 a Grok agent\'s model comes from its card (its session file), not "we cannot tell"', (t) => {
  const board = fleet.install([fleet.agent('rex', { state: 'idle', runner: 'grok', command: 'grok' })]);
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('rex')); } catch { /* not written */ } });
  grokJob('rex');
  const real = board.agents.find((a) => a.name === 'rex');
  const before = whoamiFor(real, [], NO_LIVE());
  assert.equal(before.model, null, 'CONTROL: with no session model on the card there is still nothing to say');
  /* What status.js puts on a Grok card when Grok Build's summary.json names current_model_id (readGrokSession). */
  const withSession = Object.assign({}, real, { model: 'grok-4.6' });
  const after = whoamiFor(withSession, [], NO_LIVE());
  assert.equal(after.model && after.model.id, 'grok-4.6', JSON.stringify(after.model));
  assert.equal(after.source.model, 'session');
  assert.equal(after.model.name, 'Grok 4.6');
  assert.match(sentenceForWhoami(after.account, after.model, after.resolvedRunner), /This is a Grok agent, .*its model is Grok 4\.6\./);
});

test('#4603 CONTROL: a Claude agent never takes the card model over its transcript path', (t) => {
  const board = fleet.install([fleet.agent('clara', { state: 'idle' })]);
  t.after(() => board.restore());
  const real = board.agents.find((a) => a.name === 'clara');
  const out = whoamiFor(Object.assign({}, real, { model: 'grok-4.6' }), [], NO_LIVE());
  assert.notEqual(out.model && out.model.id, 'grok-4.6', 'a Claude agent was handed the card model');
});

test('#4603 through the route: a default-account Grok agent on an xAI key is named by the key\'s last four', async (t) => {
  const board = fleet.install([fleet.agent('rex', { state: 'idle', runner: 'grok', command: 'grok' })]);
  const keyFile = path.join(process.env.AGENT_WORKFORCE_GROK_HOME, '.kosmos-grok-apikey');
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('rex')); } catch { /* */ } try { fs.unlinkSync(keyFile); } catch { /* */ } });
  grokJob('rex');
  const tok = sendertoken.mint('rex');
  assert.ok(tok.ok, tok.because);
  const ask = async () => (await (await fetch(base + '/api/whoami', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok.token }, body: '{}' })).json());
  const none = await ask();
  assert.equal(none.ok, true, JSON.stringify(none));
  assert.match(none.because, /This is a Grok agent, and we cannot tell which account it runs on/, 'CONTROL: no xAI account on disk, nothing to name: ' + none.because);
  fs.writeFileSync(keyFile, 'xai-test-key-ABCD', { mode: 0o600 });
  assert.equal(grokAccounts.list().length, 1, 'the sandboxed xAI key did not list as an account');
  const named = await ask();
  assert.match(named.because, /This is a Grok agent, and it runs on the API key ending in ABCD/, named.because);
  assert.equal(named.account && named.account.keyTail, 'ABCD');
});

test('#4603 after a provider switch (job says grok, the running pane is still Claude) the old model is not named', (t) => {
  const board = fleet.install([fleet.agent('swap', { state: 'idle' })]);
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('swap')); } catch { /* */ } });
  grokJob('swap');
  const real = board.agents.find((a) => a.name === 'swap');
  assert.equal(real.runner, 'claude', 'CONTROL: the card still describes the running Claude pane');
  const out = whoamiFor(Object.assign({}, real, { model: 'claude-opus-5' }), [], NO_LIVE());
  assert.equal(out.resolvedRunner, 'grok');
  assert.equal(out.model, null, 'a Claude model was named under the Grok runner: ' + JSON.stringify(out.model));
});

test('#4603 a Codex agent the live reader missed takes its own card model when the card agrees', (t) => {
  const board = fleet.install([fleet.agent('cody', { state: 'idle', runner: 'codex', command: 'node', screen: '\u203a Ask Codex to do anything' })]);
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('cody')); } catch { /* */ } });
  job('cody', 'codex', '/opt/homebrew/bin/codex');
  const real = board.agents.find((a) => a.name === 'cody');
  const out = whoamiFor(Object.assign({}, real, { model: 'gpt-5.6-sol' }), [], NO_LIVE());
  assert.equal(out.model && out.model.id, 'gpt-5.6-sol', JSON.stringify(out.model));
  assert.equal(out.source.model, 'session');
});

test('#4603 through the route: a default-account Gemini agent on a key is named by its last four', async (t) => {
  const board = fleet.install([fleet.agent('gem', { state: 'idle', runner: 'gemini', command: 'node' })]);
  const keyFile = path.join(process.env.AGENT_WORKFORCE_GEMINI_HOME, '.kosmos-gemini-apikey');
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('gem')); } catch { /* */ } try { fs.unlinkSync(keyFile); } catch { /* */ } });
  job('gem', 'gemini', '/opt/homebrew/bin/gemini');
  fs.writeFileSync(keyFile, 'gemini-test-key-WXYZ', { mode: 0o600 });
  const tok = sendertoken.mint('gem');
  assert.ok(tok.ok, tok.because);
  const got = await (await fetch(base + '/api/whoami', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok.token }, body: '{}' })).json();
  assert.match(got.because, /This is a Gemini agent, and it runs on the API key ending in WXYZ/, got.because);
});

test('#4603 CONTROL through the route: a Claude agent\'s answer is the same with an xAI and a Google key on disk', async (t) => {
  const board = fleet.install([fleet.agent('clem', { state: 'idle' })]);
  const grokKey = path.join(process.env.AGENT_WORKFORCE_GROK_HOME, '.kosmos-grok-apikey');
  const gemKey = path.join(process.env.AGENT_WORKFORCE_GEMINI_HOME, '.kosmos-gemini-apikey');
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('clem')); } catch { /* */ } for (const f of [grokKey, gemKey]) { try { fs.unlinkSync(f); } catch { /* */ } } });
  /* A default-account Claude launch job, so accountForAgent reaches its default arm, the one a keyed default row
     could wrongly match. No Claude account rows exist in this sandbox, so the right answer is no account. */
  job('clem', 'claude', '/opt/homebrew/bin/claude');
  const tok = sendertoken.mint('clem');
  assert.ok(tok.ok, tok.because);
  const ask = async () => (await (await fetch(base + '/api/whoami', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok.token }, body: '{}' })).json());
  const before = await ask();
  fs.writeFileSync(grokKey, 'xai-test-key-ABCD', { mode: 0o600 });
  fs.writeFileSync(gemKey, 'gemini-test-key-WXYZ', { mode: 0o600 });
  const after = await ask();
  assert.equal(after.because, before.because, 'a Claude agent\'s answer changed when keyed accounts appeared');
  assert.deepEqual(after.account, before.account);
  assert.equal(after.account, null, 'a Claude agent was matched to a keyed (xAI or Google) default account');
});

test('#4603 a Codex agent whose live read answers with no model also takes its card model', (t) => {
  const board = fleet.install([fleet.agent('cody2', { state: 'idle', runner: 'codex', command: 'node', screen: '› Ask Codex to do anything' })]);
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('cody2')); } catch { /* */ } });
  job('cody2', 'codex', '/opt/homebrew/bin/codex');
  const real = board.agents.find((a) => a.name === 'cody2');
  const out = whoamiFor(Object.assign({}, real, { model: 'gpt-5.6-sol' }), [], { ok: true, runner: 'codex', account: null, model: null, configDir: null });
  assert.equal(out.model && out.model.id, 'gpt-5.6-sol', JSON.stringify(out.model));
  assert.equal(out.source.model, 'session');
});

test('#4603 through the route: the model Grok Build wrote to its session file reaches the sentence', async (t) => {
  const board = fleet.install([fleet.agent('rexs', { state: 'idle', runner: 'grok', command: 'grok' })]);
  const sess = path.join(process.env.AGENT_WORKFORCE_GROK_HOME, 'sessions', 'rexs-cwd', 'sess-1');
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('rexs')); } catch { /* */ } fs.rmSync(path.join(process.env.AGENT_WORKFORCE_GROK_HOME, 'sessions'), { recursive: true, force: true }); });
  grokJob('rexs');
  const work = create.workerDir('rexs');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(sess, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(sess, 'summary.json'), JSON.stringify({ info: { id: 'sess-1', cwd: work }, created_at: now, updated_at: now, last_active_at: now, num_messages: 2, current_model_id: 'grok-4.6' }));
  const tok = sendertoken.mint('rexs');
  assert.ok(tok.ok, tok.because);
  const got = await (await fetch(base + '/api/whoami', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok.token }, body: '{}' })).json();
  assert.equal(got.model && got.model.id, 'grok-4.6', JSON.stringify(got));
  assert.match(got.because, /This is a Grok agent, .*its model is Grok 4\.6\./, got.because);
});

test('#4603 for a non-Claude agent the card model (its session file) outranks the launch argument', (t) => {
  const board = fleet.install([fleet.agent('cody3', { state: 'idle', runner: 'codex', command: 'node', screen: '\u203a Ask Codex to do anything' })]);
  t.after(() => { board.restore(); try { fs.unlinkSync(create.plistPath('cody3')); } catch { /* */ } });
  job('cody3', 'codex', '/opt/homebrew/bin/codex');
  const real = board.agents.find((a) => a.name === 'cody3');
  const out = whoamiFor(Object.assign({}, real, { model: 'gpt-5.6-sol' }), [], { ok: true, runner: 'codex', account: null, model: 'gpt-5-codex', configDir: null });
  assert.equal(out.model && out.model.id, 'gpt-5.6-sol', 'the launch argument beat the session file after a /model switch: ' + JSON.stringify(out.model));
  const noCard = whoamiFor(real, [], { ok: true, runner: 'codex', account: null, model: 'gpt-5-codex', configDir: null });
  assert.equal(noCard.model && noCard.model.id, 'gpt-5-codex', 'CONTROL: with no card model the launch argument still answers');
});
