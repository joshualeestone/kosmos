'use strict';
/**
 * kosmos#5820: the person sees an agent's declared reply channel (#5805 part 2) on its page and can clear it. Over HTTP
 * on a sandboxed board: /api/status carries `replyChannel` on an agent that declared one and on no other, the page's
 * POST /api/agent/<name>/reply-channel/clear clears it, and an agent token, an unknown agent and an unreadable name are
 * refused.
 *
 *   node --test server.reply-channel-clear-5820.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reply-channel-clear-5820-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const store = require('./engine/store');
const replychannel = require('./engine/replychannel');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const clear = (name, headers) => fetch(`${base}/api/agent/${encodeURIComponent(name)}/reply-channel/clear`,
  { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', ...headers } });
const declared = (name) => replychannel.forAgent(name, store);
async function cards() {
  const r = await fetch(`${base}/api/status`);
  assert.equal(r.status, 200, 'the status read failed');
  const body = await r.json();
  return new Map((body.agents || []).map((a) => [a.sessionName, a]));
}

function twoAgents() {
  const board = fleet.install([fleet.agent('rcc-ada', { state: 'idle', displayName: 'Ada' }), fleet.agent('rcc-bo', { state: 'idle', displayName: 'Bo' })]);
  const name = (p) => (board.agents.find((c) => (c.sessionName || '').startsWith(p)) || {}).sessionName;
  return { board, ada: name('rcc-ada'), bo: name('rcc-bo') };
}

test('kosmos#5820: the status card carries replyChannel on the agent that declared one, and on no other', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    assert.ok(ada && bo, 'the fleet gave no cards');
    let c = await cards();
    assert.ok(c.has(ada) && c.has(bo), 'fixture: both agents are on the board');
    assert.equal('replyChannel' in c.get(ada), false, 'control: no field before anything is declared');
    replychannel.set(ada, 'the Discord channel', store);
    c = await cards();
    assert.equal(c.get(ada).replyChannel, 'the Discord channel');
    assert.equal('replyChannel' in c.get(bo), false, 'an agent that declared nothing carries the field');
    // A stored value the command would refuse today counts as none here too, as it does for the first-reply nudge.
    store.writeProfile(ada, { replyChannel: '-x' });
    c = await cards();
    assert.equal('replyChannel' in c.get(ada), false, 'a refused stored value reached the page');
  } finally { board.restore && board.restore(); }
});

test('kosmos#5820: the page clears an agent\'s declared reply channel, and only that agent\'s', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    replychannel.set(ada, 'Slack', store);
    replychannel.set(bo, 'Discord', store);
    const r = await clear(ada);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await r.json(), { ok: true, channel: null });
    assert.equal(declared(ada), null, 'the clear did not hold');
    assert.equal(declared(bo), 'Discord', 'clearing one agent cleared another');
    const c = await cards();
    assert.equal('replyChannel' in c.get(ada), false, 'the cleared agent still shows a channel');
    assert.equal(c.get(bo).replyChannel, 'Discord', 'control: the other agent still shows its channel');
    // Clearing an agent with nothing declared is not an error: the page may race the agent's own clear.
    const again = await clear(ada);
    assert.equal(again.status, 200, await again.clone().text());
  } finally { board.restore && board.restore(); }
});

test('kosmos#5820: an agent token is refused (an agent clears its own with the command), and so are unknown and unreadable names', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    replychannel.set(bo, 'Discord', store);
    const minted = sendertoken.mint(ada);
    assert.equal(minted.ok, true, 'fixture: no token was minted');
    let r = await clear(bo, { 'x-kosmos-agent-token': minted.token });
    assert.equal(r.status, 403, await r.clone().text());
    assert.equal(declared(bo), 'Discord', 'an agent cleared another agent\'s channel');
    // No browser headers: a process holding the board token, not the page. Refused: the clear is the person's.
    r = await fetch(`${base}/api/agent/${encodeURIComponent(bo)}/reply-channel/clear`, { method: 'POST' });
    assert.equal(r.status, 403, await r.clone().text());
    assert.equal(declared(bo), 'Discord', 'a request without the page cleared it');
    r = await clear('no-such-agent-5820');
    assert.equal(r.status, 404, await r.clone().text());
    r = await fetch(`${base}/api/agent/%E0%A4%A/reply-channel/clear`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(r.status, 400, await r.clone().text());
    // CONTROL: the same page request without the agent token goes through, so the 403 above was the token.
    r = await clear(bo);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(declared(bo), null);
  } finally { board.restore && board.restore(); }
});

test('kosmos#5820: an agent that declared with no worker folder (any roster agent can) can still be cleared', async () => {
  replychannel.set('rcc-folderless', 'Slack', store);
  assert.equal(declared('rcc-folderless'), 'Slack', 'fixture: the declaration was not stored');
  const r = await clear('rcc-folderless');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(declared('rcc-folderless'), null);
  // CONTROL: once nothing is declared and there is no folder, the same name is unknown.
  const again = await clear('rcc-folderless');
  assert.equal(again.status, 404, await again.clone().text());
});
