'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8320: a keep call that carries an agent token names THAT agent as the writer, board token or not, so a
 * Codex, Gemini, Grok or Antigravity agent's edit inside a project folder is recorded (its session id is no Claude
 * transcript id, and a project folder is not its own folder). Sandboxed as server.filewho-5812.test.js is.
 *   node --test server.tokenwriter-8320.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenwriter-8320-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const BOARD = 'BOARD_TOKEN_8320_test_0123456789abcdef';
const store = require('./engine/store');
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');
const mk = (name) => {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, name), { recursive: true });
  store.writeProfile(name, { displayName: name.toUpperCase() });
};
const keep = (headers, body) => fetch(base + '/api/undo/keep', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const changedBy = async (id) => {
  const docs = await (await fetch(base + `/api/project/${id}/documents?limit=50`)).json();
  return Object.fromEntries(docs.files.map((f) => [f.name, f.changedBy || null]));
};

test('kosmos#8320: a bridge call (board token AND agent token, a non-Claude session, cwd the project folder) names the token\'s agent', async () => {
  mk('gpt'); mk('cla');
  require('./engine/undo').resetForTests();
  const gptTok = sendertoken.mint('gpt').token;
  const folder = path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'brief');
  fs.mkdirSync(folder, { recursive: true });
  projects.writeAll([...projects.readAll(), { id: 'tw-p', name: 'Brief', folder, agents: ['gpt', 'cla'], tasks: [] }]);
  require('./engine/filewriters').resetForTests();
  const real = fs.realpathSync(folder);
  const withTok = path.join(folder, 'with-token.md');
  const noTok = path.join(folder, 'board-only.md');
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  try {
    // The Codex bridge's call: both tokens, its own thread id as the session, the project folder as cwd.
    assert.equal((await keep({ 'x-kosmos-board-token': BOARD, 'x-kosmos-agent-token': gptTok }, { path: withTok, cwd: real, session: 'codex-thread-1' })).status, 200);
    // CONTROL: the same call with the board token alone is today's call, and names nobody.
    assert.equal((await keep({ 'x-kosmos-board-token': BOARD }, { path: noTok, cwd: real, session: 'codex-thread-1' })).status, 200);
  } finally {
    boardAuthState.on = was.on;
    boardAuthState.token = was.token;
  }
  await new Promise((r) => setImmediate(r));
  fs.writeFileSync(withTok, 'x');
  fs.writeFileSync(noTok, 'y');
  const by = await changedBy('tw-p');
  assert.equal(by['with-token.md'], 'GPT', 'the token\'s agent was not named: ' + JSON.stringify(by));
  assert.equal(by['board-only.md'], null, 'CONTROL: a call with no agent token named somebody');
});

test('kosmos#8320: the token decides over the session and folder lookup, and a token for no known agent names nobody', async () => {
  mk('gem'); mk('own');
  require('./engine/undo').resetForTests();
  const gemTok = sendertoken.mint('gem').token;
  const ghostTok = sendertoken.mint('ghost').token;   // a token whose agent has no profile here
  const folder = path.join(process.env.AGENT_WORKFORCE_PROJECTS, 'deck');
  fs.mkdirSync(folder, { recursive: true });
  projects.writeAll([...projects.readAll(), { id: 'tw-q', name: 'Deck', folder, agents: ['gem', 'own'], tasks: [] }]);
  require('./engine/filewriters').resetForTests();
  const ownDir = fs.realpathSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'own'));
  const claimed = path.join(folder, 'claimed.md');
  const ghost = path.join(folder, 'ghost.md');
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  try {
    // gem's token, but the cwd is own's folder (the folder lookup alone would say "own").
    await keep({ 'x-kosmos-board-token': BOARD, 'x-kosmos-agent-token': gemTok }, { path: claimed, cwd: ownDir, session: 's' });
    await keep({ 'x-kosmos-board-token': BOARD, 'x-kosmos-agent-token': ghostTok }, { path: ghost, cwd: fs.realpathSync(folder), session: 's' });
  } finally {
    boardAuthState.on = was.on;
    boardAuthState.token = was.token;
  }
  await new Promise((r) => setImmediate(r));
  fs.writeFileSync(claimed, 'x');
  fs.writeFileSync(ghost, 'y');
  const by = await changedBy('tw-q');
  assert.equal(by['claimed.md'], 'GEM', 'the folder lookup won over the caller\'s own token: ' + JSON.stringify(by));
  assert.equal(by['ghost.md'], null, 'a token for an agent with no profile was recorded as a writer');
});

test('kosmos#8320: tokenWriter takes the token\'s name, or its key only when no second name shares it, and only a known agent', () => {
  mk('kip'); mk('lou');
  const { tokenWriter } = require('./engine/undo');
  assert.equal(tokenWriter({ name: 'kip', key: 'kip', twins: false }), 'kip');
  assert.equal(tokenWriter({ name: 'Kip', key: 'kip', twins: false }), 'kip', 'a named token whose name is not a profile is found by its key');
  assert.equal(tokenWriter({ name: 'Kip', key: 'kip', twins: true }), null, 'the key was taken although two names share it');
  assert.equal(tokenWriter({ name: 'lou', key: 'kip', twins: true }), 'lou', 'an exact known name is taken even with twins');
  assert.equal(tokenWriter({ name: 'kip', key: 'kip', byKey: true }), 'kip');
  assert.equal(tokenWriter({ name: 'nobody', key: 'nobody', twins: false }), null, 'an agent with no profile was taken');
  assert.equal(tokenWriter(null), null);
  assert.equal(tokenWriter(''), null);
});
