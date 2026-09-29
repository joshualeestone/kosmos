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
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_GROK_HOME, { recursive: true });

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

function grokJob(name, configDir) {
  fs.writeFileSync(create.plistPath(name), create.plistFor(name, '/opt/homebrew/bin/grok', '/opt/homebrew/bin/tmux', null, configDir || null, 'grok'), 'utf8');
  assert.equal(create.readJob(name).runner, 'grok', 'the plist this test wrote does not read back as grok');
}

test('#4603 the sentence names Grok and Gemini by their product names', () => {
  assert.match(sentenceForWhoami(null, null, 'grok'), /^This is a Grok agent, and /);
  assert.match(sentenceForWhoami(null, null, 'gemini'), /^This is a Gemini agent, and /);
  assert.match(sentenceForWhoami(null, null, 'codex'), /^This is a Codex agent, and /, 'CONTROL: Codex as before');
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
  assert.match(sentenceForWhoami(after.account, after.model, after.resolvedRunner), /This is a Grok agent, .*its model is /);
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
