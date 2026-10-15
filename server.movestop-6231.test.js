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
const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

const accountmove = require('./engine/accountmove');
const updates = require('./engine/update');
const REAL = { busy: accountmove.busy, stop: accountmove.stop, boardBusyBecause: accountmove.boardBusyBecause };
const REAL_UPD = { available: updates.available, selfInstallRefusal: updates.selfInstallRefusal, rollbackOffer: updates.rollbackOffer };
/* Update and Roll back refuse earlier for their own reasons (nothing newer published, no earlier build kept, a platform
   that cannot self-install); those are set aside here so the request reaches the move check, which is what is tested. */
function updatesReachMoveCheck() {
  updates.available = () => ({ version: '9.9.9' });
  updates.selfInstallRefusal = () => null;
  updates.rollbackOffer = () => ({ version: '0.0.1' });
}
function moveRunning(on) {
  accountmove.busy = on ? () => true : REAL.busy;
  accountmove.boardBusyBecause = on ? () => 'an account move is running' : REAL.boardBusyBecause;
}

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => { Object.assign(accountmove, REAL); Object.assign(updates, REAL_UPD); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.afterEach(() => { Object.assign(accountmove, REAL); Object.assign(updates, REAL_UPD); });

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

test('#6231: Update and Roll back refused while a move runs say moveStoppable, and do not without a move', async () => {
  updatesReachMoveCheck();
  for (const path of ['/api/update', '/api/update/rollback']) {
    moveRunning(true);
    const held = await post(path);
    assert.equal(held.status, 409, path + ' ' + JSON.stringify(held.body));
    assert.equal(held.body.error, 'an account move is running', path + ': refused for another reason first: ' + JSON.stringify(held.body));
    assert.equal(held.body.moveStoppable, true, path + ' ' + JSON.stringify(held.body));
    moveRunning(false);
    const free = await post(path);
    assert.ok(!(free.body && free.body.moveStoppable), path + ': a refusal with no move running offers to stop one: ' + JSON.stringify(free.body));
  }
});

test('#6231: a Kosmos switch refused while a move runs says moveStoppable, and does not without a move', async () => {
  moveRunning(true);
  const held = await post('/api/worlds/active', { id: 'another-kosmos', agents: 'keep' });
  assert.equal(held.status, 409, JSON.stringify(held.body));
  assert.equal(held.body.moveStoppable, true, JSON.stringify(held.body));
  assert.equal(held.body.because, 'an account move is running');
  moveRunning(false);
  const free = await post('/api/worlds/active', { id: 'another-kosmos', agents: 'keep' });
  assert.ok(!(free.body && free.body.moveStoppable), 'a switch with no move running offers to stop one: ' + JSON.stringify(free.body));
});
