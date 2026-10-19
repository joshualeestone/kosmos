'use strict';
/**
 * #6231 item 6 (follow-up to #6214): the stop route and the moveStoppable note, driven through the REAL board's routes
 * rather than read in server.js as text. The move itself is the engine's (engine/accountmove-stop-6214.test.js covers
 * it); here its busy / stop / boardBusyBecause are set per test, so what is proved is the board's wiring: the stop
 * route answers with the engine's own status and body, and a board-restarting route refused while a move runs says
 * moveStoppable (and does not say it when nothing holds the board).
 *
 *   node --test server.movestop-6231.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-movestop-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
delete process.env.TMUX;        // never the runner's own tmux, whatever a code path shells out to
delete process.env.TMUX_PANE;
const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

const accountmove = require('./engine/accountmove');
const updates = require('./engine/update');
const removal = require('./engine/remove');
const create = require('./engine/create');
const REAL = { busy: accountmove.busy, stop: accountmove.stop, boardBusyBecause: accountmove.boardBusyBecause, start: accountmove.start };
const REAL_UPD = { available: updates.available, selfInstallRefusal: updates.selfInstallRefusal, rollbackOffer: updates.rollbackOffer,
  installedRoot: updates.installedRoot };
const REAL_REMOVAL = { restartingNow: removal.restartingNow };
updates.setFetcher(async () => ({ ok: false, status: 503, json: async () => null }));   // the board's update check stays off the network
const REAL_CREATE = { readJob: create.readJob };
function restoreAll() {
  Object.assign(accountmove, REAL); Object.assign(updates, REAL_UPD); Object.assign(removal, REAL_REMOVAL); Object.assign(create, REAL_CREATE);
}
/* Update and Roll back refuse earlier for their own reasons (nothing newer published, no earlier build kept, a platform
   that cannot self-install); those are set aside here so the request reaches the move check, which is what is tested. */
function updatesReachMoveCheck() {
  updates.available = () => ({ version: '9.9.9' });
  updates.selfInstallRefusal = () => null;
  updates.rollbackOffer = () => ({ version: '0.0.1' });
  updates.installedRoot = () => null;   // past the move check the route stops here: nothing installs, whatever the layout
}
/* The board held by something other than a move (a restart a removal gave up on): it refuses, and offers no stop. */
function heldByOther(on) {
  removal.restartingNow = on ? () => true : REAL_REMOVAL.restartingNow;
}
const SOURCE_ONLY = 'this Kosmos runs from its source code, so it updates from git, not from here';
function moveRunning(on) {
  accountmove.busy = on ? () => true : REAL.busy;
  accountmove.boardBusyBecause = on ? () => 'an account move is running' : REAL.boardBusyBecause;
}

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => { restoreAll(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.afterEach(restoreAll);

const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('#6231: the stop route answers 409 from the real engine when no move is running', async () => {
  const r = await post('/api/agents/account-moves/stop');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.deepEqual(r.body, REAL.stop().body, 'the route does not answer with the engine\'s own words');
});

test('#6231: the stop route passes the engine\'s answer through, status and body', async () => {
  let asked = 0;
  accountmove.stop = () => { asked += 1; return { status: 202, body: { stopped: true, waitingFor: 'bo' } }; };
  const r = await post('/api/agents/account-moves/stop');
  assert.equal(asked, 1, 'the route did not ask the engine to stop');
  assert.deepEqual(r, { status: 202, body: { stopped: true, waitingFor: 'bo' } });
});

test('#6231: Update and Roll back refused while a move runs say moveStoppable; held by anything else they do not', async () => {
  updatesReachMoveCheck();
  for (const path of ['/api/update', '/api/update/rollback']) {
    moveRunning(true);
    const held = await post(path);
    assert.equal(held.status, 409, path + ' ' + JSON.stringify(held.body));
    assert.equal(held.body.error, 'an account move is running', path + ': refused for another reason first: ' + JSON.stringify(held.body));
    assert.equal(held.body.moveStoppable, true, path + ' ' + JSON.stringify(held.body));
    moveRunning(false);
    heldByOther(true);
    const other = await post(path);
    assert.equal(other.status, 409, path + ' ' + JSON.stringify(other.body));
    assert.equal(other.body.moveStoppable, undefined, path + ': a board held by something else offers to stop a move: ' + JSON.stringify(other.body));
    assert.equal(other.body.error, REAL.boardBusyBecause(), path + ': not refused as held (the hold never reached the route): ' + JSON.stringify(other.body));
    heldByOther(false);
    const free = await post(path);
    assert.deepEqual(free, { status: 409, body: { error: SOURCE_ONLY } }, path + ': with nothing holding the board it did not go on to the next check');
  }
});

test('#6231: a Kosmos switch refused while a move runs says moveStoppable; held by anything else it does not', async () => {
  moveRunning(true);
  const held = await post('/api/worlds/active', { id: 'another-kosmos', agents: 'keep' });
  assert.equal(held.status, 409, JSON.stringify(held.body));
  assert.equal(held.body.moveStoppable, true, JSON.stringify(held.body));
  assert.equal(held.body.because, 'an account move is running');
  moveRunning(false);
  heldByOther(true);
  const other = await post('/api/worlds/active', { id: 'another-kosmos', agents: 'keep' });
  assert.equal(other.status, 409, JSON.stringify(other.body));
  assert.equal(other.body.moveStoppable, undefined, 'a board held by something else offers to stop a move: ' + JSON.stringify(other.body));
});

test('#6231: the bulk move reads each agent\'s account strictly: an unreadable job throws, never "the default account"', async () => {
  let deps = null;
  accountmove.start = (body, d) => { deps = d; return { status: 202, body: { id: 'm1', done: false, agents: [] } }; };
  const r = await post('/api/agents/account', { names: ['ghost'], dir: '/acct/new' });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(typeof (deps && deps.readAccount), 'function', 'the board gave the move no strict account read');
  assert.throws(() => deps.readAccount('ghost'), /launch job could not be read/, 'an agent with no readable job was read as some account');
  create.readJob = () => ({ configDir: '/acct/old' });
  assert.equal(deps.readAccount('al'), '/acct/old', 'a readable job\'s account was not returned');
  create.readJob = () => ({});
  assert.equal(deps.readAccount('al'), null, 'a job with no account folder (the default account) was not null');
});
