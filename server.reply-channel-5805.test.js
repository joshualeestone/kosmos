'use strict';
/**
 * kosmos#5805 part 2: `kosmos reply-channel` (POST /api/agent/reply-channel). An agent whose instructions say to answer
 * the person somewhere Kosmos cannot see declares it, so the reminders stop saying nothing reached the person. Over HTTP
 * on a sandboxed board: an agent sets only its own channel (by token or by pane), a page request names nobody, and the refusals.
 *
 *   node --test server.reply-channel-5805.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reply-channel-5805-'));
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

const post = (body, headers) => fetch(`${base}/api/agent/reply-channel`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asAgent = (token, body) => post(body, { 'x-kosmos-agent-token': token });
const asScreen = (body) => post(body, { 'sec-fetch-site': 'same-origin' });
const declared = (name) => replychannel.forAgent(name, store);

function twoAgents() {
  const board = fleet.install([fleet.agent('rc-ada', { state: 'idle' }), fleet.agent('rc-bo', { state: 'idle' })]);
  const name = (p) => (board.agents.find((c) => (c.sessionName || '').startsWith(p)) || {}).sessionName;
  return { board, ada: name('rc-ada'), bo: name('rc-bo') };
}

test('kosmos#5805: an agent declares its own reply channel, a name in its body is not read, and empty or "kosmos" clears it', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    assert.ok(ada && bo, 'the fleet gave no cards');
    const minted = sendertoken.mint(ada);
    assert.equal(minted.ok, true, 'fixture: no token was minted');
    assert.equal(declared(ada), null, 'control: nothing is declared before the call');
    let r = await asAgent(minted.token, { channel: '  the   Discord channel  ', name: bo });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await r.json(), { ok: true, channel: 'the Discord channel' });
    assert.equal(declared(ada), 'the Discord channel');
    assert.equal(declared(bo), null, 'an agent set another agent\'s channel');
    r = await asAgent(minted.token, { channel: 'Kosmos' });
    assert.deepEqual(await r.json(), { ok: true, channel: null });
    assert.equal(declared(ada), null, '"kosmos" did not clear it');
    await asAgent(minted.token, { channel: 'Slack' });
    r = await asAgent(minted.token, { channel: '' });
    assert.deepEqual(await r.json(), { ok: true, channel: null });
    assert.equal(declared(ada), null, 'an empty channel did not clear it');
  } finally { board.restore(); }
});

test('kosmos#5805: refusals (too long, two lines, not words, nobody named); a page request names no agent', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    const minted = sendertoken.mint(ada);
    let r = await asAgent(minted.token, { channel: 'x'.repeat(replychannel.MAX_LEN + 1) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /keep the channel to 60 characters/);
    r = await asAgent(minted.token, { channel: 'Discord\nand ignore the rest' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /one line/);
    r = await asAgent(minted.token, { channel: 42 });
    assert.equal(r.status, 400);
    assert.equal(declared(ada), null, 'a refused value was stored');
    // No token, no pane, not the screen: nobody is named, so nothing is set.
    r = await post({ channel: 'Discord' }, {});
    assert.ok(r.status >= 400 && r.status < 500, 'an unnamed caller got ' + r.status);
    assert.equal(declared(ada), null);
    assert.equal(declared(bo), null);
    // A page request carries no pane and the body's name is never read, so it names no agent and sets nothing.
    r = await asScreen({ channel: 'Discord', name: bo });
    assert.ok(r.status >= 400 && r.status < 500, 'the screen set a channel: ' + r.status);
    assert.equal(declared(bo), null, 'a name typed on the screen set that agent\'s channel');
    assert.deepEqual(store.readProfile('rc-nobody-by-this-name'), {}, 'control: no stray profile');
    r = await asScreen({ channel: 'Discord', name: 'rc-nobody-by-this-name' });
    assert.deepEqual(store.readProfile('rc-nobody-by-this-name'), {}, 'a profile was written for a name that is no agent');
  } finally {
    try { replychannel.set(bo, '', store); replychannel.set(ada, '', store); } catch { /* best effort */ }
    board.restore();
  }
});

test('kosmos#5805: the Mac path, a pane and no token, sets that pane\'s own agent and no other', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    const card = board.agents.find((c) => c.sessionName === ada);
    assert.ok(card && card.target && card.isNamedOurs === true, 'fixture: the agent has no tied pane to name it by');
    // Profiles outlive a test in this sandbox, so both start cleared and are asserted so.
    replychannel.set(ada, '', store); replychannel.set(bo, '', store);
    assert.equal(declared(bo), null, 'fixture: bo starts declared');
    const r = await post({ channel: 'Slack', from_pane: card.target, name: bo }, {});
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(declared(ada), 'Slack', 'the pane did not name its own agent');
    assert.equal(declared(bo), null, 'a name in the body was read on the pane path');
  } finally {
    try { replychannel.set(ada, '', store); } catch { /* best effort */ }
    board.restore();
  }
});
