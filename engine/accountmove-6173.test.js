'use strict';

/**
 * #6173: several agents' account move in one request. The module is driven with its dependencies stated (no board,
 * no launchd), so what is asserted is the move's own rules: what the request answers, one move at a time, every
 * agent's outcome, and that nothing reads as moved unless its restart said RESTARTED.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const accountmove = require('./accountmove');

const REFUSED = 'refused-by-create';
const RESTARTED = 'restarted-by-remove';

/* A restart each test answers by hand: restartAsync returns a promise the test settles. */
function deps({ refuse = [], account = { email: 'spare@example.com' } } = {}) {
  const pending = new Map(), order = [], forgot = [], wrote = [], held = new Set();
  return {
    pending, order, forgot, wrote, held,
    hold: (names) => names.forEach((n) => held.add(n)),
    release: (name) => held.delete(name),
    setAccount: (name, dir) => {
      wrote.push([name, dir]);
      return refuse.includes(name) ? { outcome: REFUSED, because: `${name} cannot go there` } : { outcome: 'changed', account };
    },
    REFUSED,
    moveRefusal: () => null,   // #6190: nothing held unless a test says so
    forget: (name) => forgot.push(name),
    restartAsync: (name) => {
      order.push(name);
      return new Promise((resolve, reject) => pending.set(name, { resolve, reject }));
    },
    RESTARTED,
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test.afterEach(() => accountmove.resetForTests());

test('#6173: the request saves every account and answers before any restart has finished', async () => {
  const d = deps({ refuse: ['bo'] });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'bo', 'cy'] }, d);
  assert.equal(out.status, 202);
  assert.deepEqual(d.wrote, [['al', '/acct/spare'], ['bo', '/acct/spare'], ['cy', '/acct/spare']], 'every account is saved on the request');
  assert.deepEqual(d.forgot, ['al', 'cy'], 'a refused write forgets nothing');
  assert.equal(out.body.done, false);
  assert.deepEqual(out.body.agents.map((a) => [a.name, a.outcome]), [['al', 'pending'], ['bo', 'refused'], ['cy', 'pending']]);
  assert.equal(out.body.agents[1].because, 'bo cannot go there', 'a refusal carries the engine\'s own sentence at once');
  assert.deepEqual(d.order, ['al'], 'one restart at a time: the second waits for the first');
  assert.deepEqual([...d.held].sort(), ['al', 'cy'], 'every agent the move will restart is held, a refused one is not');

  d.pending.get('al').resolve({ outcome: RESTARTED, steps: [] });
  await tick();
  assert.deepEqual(d.order, ['al', 'cy']);
  assert.deepEqual([...d.held], ['cy'], 'an agent is released once its own restart has answered');
  const mid = accountmove.read(out.body.id);
  assert.deepEqual(mid.agents.map((a) => a.outcome), ['changed', 'refused', 'pending'], 'the record says how far it got');
  assert.match(mid.agents[0].because, /^al runs on spare@example\.com now\. It is starting again/);

  d.pending.get('cy').resolve({ outcome: 'partial', because: 'its launch job did not reload.', steps: [] });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.equal(end.done, true);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['changed', 'refused', 'partial']);
  assert.equal(end.agents[2].because, 'We saved spare@example.com, but could not start it again: its launch job did not reload. It is still on the old account until it restarts.');
});

test('#6173: one move at a time: a second move is refused plainly while one runs, and allowed after', async () => {
  const d = deps();
  const first = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  assert.equal(accountmove.busy(), true);
  const second = accountmove.start({ dir: '/acct/spare', names: ['bo'] }, deps());
  assert.equal(second.status, 409);
  assert.equal(second.body.outcome, 'refused');
  assert.equal(second.body.because, 'Another account move is still running. Try again when it has finished.');
  assert.equal(second.body.because, accountmove.busyBecause(), 'the single-agent route says the same sentence');
  d.pending.get('al').resolve({ outcome: RESTARTED });
  await first.done;
  assert.equal(accountmove.busy(), false);
  const third = accountmove.start({ dir: '/acct/spare', names: ['bo'] }, deps());
  assert.equal(third.status, 202);
});

test('#6173: a failure partway never reads as moved: a restart that throws, and one that refuses', async () => {
  const d = deps();
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'bo', 'cy'] }, d);
  d.pending.get('al').reject(new Error('launchctl went away'));
  await tick();
  d.pending.get('bo').resolve({ outcome: 'refused', because: 'bo is part of an account move that has not finished with it yet, so we left it alone.' });
  await tick();
  d.pending.get('cy').resolve({ outcome: RESTARTED });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'partial', 'changed'], 'only a RESTARTED is changed');
  assert.match(end.agents[0].because, /could not start it again: launchctl went away/);
  assert.match(end.agents[1].because, /could not start it again: bo is part of an account move that has not finished with it yet/);
  assert.equal(accountmove.busy(), false, 'the move ends, so the next one can run');
  assert.deepEqual([...d.held], [], 'a move that failed partway holds nobody afterwards');
});

test('#6173: a move nobody started here is unknown (the board restarted): read answers null', () => {
  assert.equal(accountmove.read('not-a-move'), null);
});

test('#6173: a move with nothing to restart is done at once and holds nothing', () => {
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'al'] }, deps({ refuse: ['al'] }));
  assert.equal(out.status, 202);
  assert.equal(out.body.done, true);
  assert.equal(out.body.agents.length, 1, 'a name given twice is moved once');
  const twoSpellings = accountmove.start({ dir: '/acct/spare', names: ['al', ' al'] }, deps({ refuse: ['al', ' al'] }));
  assert.deepEqual(twoSpellings.body.agents.map((a) => a.name), ['al'], 'two spellings of one agent (the engine trims) are moved once');
  assert.equal(accountmove.busy(), false);
});

test('#6173: a request it cannot act on is refused with a sentence', () => {
  const d = deps();
  for (const body of [null, { dir: '/x' }, { dir: '/x', names: [] }, { names: ['al'] }, { dir: '/x', names: ['al', 3] },
    { dir: '/x', names: Array.from({ length: 201 }, (_, i) => `a${i}`) }]) {
    const out = accountmove.start(body, d);
    assert.equal(out.status, 400, JSON.stringify(body));
    assert.equal(out.body.outcome, 'refused');
    assert.ok(out.body.because, 'refused without a sentence');
  }
  assert.deepEqual(d.wrote, [], 'nothing was saved for a request it refused');
});

test('#6173: the sentence names the chat that stays behind on a per-home account, as the single route always did', () => {
  const said = accountmove.sentence('al', { account: { name: 'Work', provider: 'openai' } }, { outcome: RESTARTED, steps: [] }, RESTARTED);
  assert.equal(said.outcome, 'changed');
  assert.equal(said.because, 'al runs on Work now. It is starting again, and it will look idle until you say something to it. '
    + 'Its files and projects come with it; its earlier Codex chat stays with the account it was on.');
  const claude = accountmove.sentence('al', { account: { email: 'a@b.c' } }, { outcome: RESTARTED }, RESTARTED);
  assert.match(claude.because, /Everything it has done comes with it\.$/);
});

test('#6173 review 1: a sentence that throws ends that agent as not confirmed, and the move goes on to the next', async () => {
  const d = deps({ account: { get name() { throw new Error('odd account'); } } });
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'bo'] }, d);
  d.pending.get('al').resolve({ outcome: RESTARTED });
  await tick();
  assert.deepEqual(d.order, ['al', 'bo'], 'the move did not go on past the agent it could not word');
  d.pending.get('bo').resolve({ outcome: RESTARTED });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.equal(end.done, true);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'partial'], 'an agent the move could not word is not said as moved');
  assert.equal(accountmove.busy(), false);
  assert.deepEqual([...d.held], []);
});

test('#6173 review 2: the board wires the move to the engine\'s hold, and the class-1 sweep to it (no route test reaches these)', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("pathname === '/api/agents/account' && req.method === 'POST'"));
  assert.ok(route.length < server.length, 'the bulk move route is not in server.js');
  const call = route.slice(0, route.indexOf('sendJson(res, started.status'));
  assert.match(call, /hold: \(names\) => removal\.holdForMove\(names\)/, 'the move does not hold its agents in the engine');
  assert.match(call, /release: \(n\) => removal\.releaseFromMove\(n\)/, 'the move does not release its agents');
  assert.match(call, /restartAsync: \(n\) => restartForMoveAsync\(n, fromDirs\.has\(n\) \? fromDirs\.get\(n\) : null\)/, 'the move does not restart through #6174\'s note');
  assert.match(call, /setAccount: \(n, dir\) => \{ fromDirs\.set\(n, moveFromDir\(n\)\); return create\.setAccount\(n, dir\); \}/,
    'the account each agent ran on is not read before its account is written (#6174)');
  assert.match(server, /heldByMove: removal\.heldByMove,/, 'the class-1 sweep does not ask whether a move holds the agent');
  assert.match(call, /boardRestarting: \(\) => boardRestartingSoon\(\),/, 'a move can start under an update or a board restart');
  assert.match(server, /function boardRestartingSoon\(\) \{ return updates\.alreadyInstalling\(\) \|\| engineRestartAsked \|\| worldSwitchRestarting; \}/,
    'the board-restart test leaves out one of the three restarters');
  assert.match(server, /worldSwitchRestarting = true;\n\s+setTimeout\(\(\) => \{\n\s+let r = null;\n\s+try \{ r = require\('\.\/engine\/boardrestart'\)\.selfRestart/,
    'a Kosmos switch does not mark the board as about to restart before its restart is scheduled (review 3)');
  assert.match(server, /if \(boardRestartingSoon\(\)\) \{ sendJson\(res, 409, \{ outcome: 'refused', because: accountmove\.boardGoingBecause\(\) \}\); return; \}/,
    'the one-agent Move can start under a board restart');
  /* Everything that restarts the board refuses while a move (or a restart it gave up on) holds it, and the refusal
     comes BEFORE the act in its own route (review 4: a text match alone would pass a check moved after the act). */
  assert.match(server, /function moveHoldsBoard\(\) \{ return accountmove\.busy\(\) \|\| removal\.restartingNow\(\); \}/);
  const guardThenAct = (routeHead, guard, act, what) => {
    const at = server.indexOf(routeHead);
    assert.ok(at > 0, `${what}: its route is not in server.js`);
    const body = server.slice(at, at + 12000);
    const g = body.indexOf(guard), a = body.indexOf(act);
    assert.ok(g > 0, `${what} does not refuse during a move`);
    assert.ok(a > g, `${what} acts before it checks for a move`);
  };
  const busyRefusal = "if (moveHoldsBoard()) { sendJson(res, 409, { ";
  guardThenAct("pathname === '/api/engine/restart' && req.method === 'POST'", busyRefusal, "engineRestartAsked = true;", 'the restart button');
  guardThenAct("pathname === '/api/update/rollback' && req.method === 'POST'", busyRefusal, 'updates.beginRollback(', 'the rollback');
  guardThenAct("pathname === '/api/worlds/active' && req.method === 'POST'", 'if (!isNoop && moveHoldsBoard())', 'worldstarts.pauseForSwitch(', 'a Kosmos switch');
  guardThenAct('const platRefusal = updates.selfInstallRefusal();', busyRefusal, 'updates.beginInstall()', 'the Update button');
  assert.match(server, /updates\.setAutoDefer\(\(\) => moveHoldsBoard\(\)\)/, 'the automatic install does not wait for a move');
  assert.match(server, /setTimeout\(\(\) => \{ worldSwitchRestarting = false; \}, ENGINE_RESTART_CHECK_MS\)\.unref\(\);/,
    'a switch whose detached restart failed leaves moves refused for the life of the board (review 4)');
  /* The provider and model writes refuse a held agent before they write. */
  const heldGuard = "{ const held = removal.moveRefusal(name); if (held) { sendJson(res, 409, { outcome: 'refused', because: held.because }); return; } }";
  for (const write of ['const wrote = create.setProvider(name, body && body.provider, {', 'const wrote = create.setModel(name, body && body.model);']) {
    const at = server.indexOf(write);
    assert.ok(at > 0, `${write} is not in server.js`);
    assert.ok(server.slice(at - 400, at).includes(heldGuard), `${write} writes an agent a move holds`);
  }
});

test('#6173 review 2: a move is refused while the board is about to restart, and nothing is saved', () => {
  const d = deps();
  d.boardRestarting = () => true;
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  assert.equal(out.status, 409);
  assert.match(out.body.because, /^The board is about to restart/);
  assert.deepEqual(d.wrote, [], 'an account was saved for a move that was refused');
  assert.equal(accountmove.busy(), false);
});

test('#6173 review 2: a hold that throws ends the move with a sentence, restarts nothing, and leaves no move running', () => {
  const d = deps();
  d.hold = () => { throw new Error('hold went away'); };
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  assert.equal(out.status, 202);
  assert.equal(out.body.done, true);
  assert.equal(out.body.agents[0].outcome, 'partial', 'an agent nothing restarted was not said as moved');
  assert.match(out.body.agents[0].because, /could not start it again: the move could not start \(hold went away\)/);
  assert.deepEqual(d.order, [], 'a restart ran without its hold');
  assert.equal(accountmove.busy(), false);
});

test('#6173 Liu Kang m5496: the move\'s overall cap starts no further agent; the ones not reached are not restarted, and nothing stays held', async () => {
  const d = deps();
  d.moveCapMs = 30;
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'bo', 'cy'] }, d);
  await new Promise((r) => setTimeout(r, 60));   // the first restart outlasts the whole move's cap
  d.pending.get('al').resolve({ outcome: RESTARTED });
  await out.done;
  assert.deepEqual(d.order, ['al'], 'an agent was started after the move ran out of time');
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['changed', 'partial', 'partial']);
  assert.match(end.agents[1].because, /could not start it again: the move ended \(it ran out of time, or failed\) before it reached this agent/);
  assert.deepEqual([...d.held], []);
  assert.equal(accountmove.busy(), false);
});

test('#6173 Liu Kang m5496: one agent whose restart never settles is given up at the agent cap, and the move goes on', async () => {
  const d = deps();
  d.agentCapMs = 2000;
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'bo'] }, d);   // al's promise is never settled
  await new Promise((r) => setTimeout(r, 2100));
  assert.deepEqual(d.order, ['al', 'bo'], 'the move waited on a restart past its cap');
  assert.deepEqual([...d.held], ['bo'], 'al stayed held after it was given up');
  d.pending.get('bo').resolve({ outcome: RESTARTED });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'changed']);
  assert.match(end.agents[0].because, /its restart did not answer within 2 seconds\./);
  assert.equal(accountmove.busy(), false);
});

test('#6173 review 3: a hold that throws, with a sentence that throws too, still ends the move and leaves nothing pending', () => {
  const d = deps({ account: { get name() { throw new Error('odd account'); } } });
  d.hold = () => { throw new Error('hold went away'); };
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  assert.equal(out.status, 202);
  assert.equal(out.body.done, true, 'the move was left pending, where prune never removes it');
  assert.equal(out.body.agents[0].outcome, 'partial');
  assert.equal(accountmove.busy(), false);
});

test('#6173 review 3: a release that throws still ends the move, so later moves, updates and restarts are not refused for good', async () => {
  const d = deps();
  d.release = () => { throw new Error('release went away'); };
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  d.pending.get('al').resolve({ outcome: RESTARTED });
  await out.done;
  assert.equal(accountmove.busy(), false, 'the move stayed running after a release threw');
  assert.equal(accountmove.read(out.body.id).agents[0].outcome, 'changed');
});

test('#6190: an agent a restart still holds is refused BEFORE its account is written; the others move', async () => {
  const d = deps();
  d.moveRefusal = (name) => (name === 'held' ? { because: 'held is part of an account move that has not finished with it yet' } : null);
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'held'] }, d);
  assert.equal(out.status, 202);
  assert.deepEqual(d.wrote.map((w) => w[0]), ['al'], 'the held agent\'s account was written');
  const heldRow = out.body.agents.find((a) => a.name === 'held');
  assert.equal(heldRow.outcome, 'refused');
  assert.match(heldRow.because, /has not finished with it yet/);
  assert.equal(d.held.has('held'), false, 'a refused agent is held by this move');
  assert.ok(d.held.has('al'), 'the agent that moved is not held while its restart runs');
  d.pending.get('al').resolve({ outcome: RESTARTED });
  await out.done;
});

test('#6190: a hold check that throws refuses that agent with a sentence and writes nothing for it', () => {
  const d = deps();
  d.moveRefusal = () => { throw new Error('the hold could not be read'); };
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  assert.deepEqual(d.wrote, [], 'an unreadable hold still wrote the account');
  assert.equal(out.body.agents[0].outcome, 'refused');
  assert.equal(out.body.agents[0].because, 'we could not check whether it is still being restarted', 'the person sees the raw error');
});

test('#6190: both account routes ask the engine\'s hold before they write (no route test reaches these)', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const heldGuard = "{ const held = removal.moveRefusal(name); if (held) { sendJson(res, 409, { outcome: 'refused', because: held.because }); return; } }";
  const write = 'const wrote = create.setAccount(name, body && body.dir);';
  const at = server.indexOf(write);
  assert.ok(at > 0, 'the one-agent account write is not in server.js');
  assert.ok(server.slice(at - 400, at).includes(heldGuard), 'the one-agent Move writes an agent a restart holds');
  const route = server.slice(server.indexOf("pathname === '/api/agents/account' && req.method === 'POST'"));
  const call = route.slice(0, route.indexOf('sendJson(res, started.status'));
  assert.match(call, /moveRefusal: \(n\) => removal\.moveRefusal\(n\),/, 'the bulk move does not ask the engine\'s hold');
});

test('#6190 review 2: a caller that leaves out the hold check refuses every agent rather than writing past it', () => {
  const d = deps();
  delete d.moveRefusal;
  const out = accountmove.start({ dir: '/acct/spare', names: ['al'] }, d);
  assert.deepEqual(d.wrote, [], 'a move with no hold check wrote the account');
  assert.equal(out.body.agents[0].outcome, 'refused');
  assert.equal(accountmove.busy(), false, 'a move that wrote nothing is still running');
});

test('a move whose restart never answers does not hold a process open (its cap timer is unref\'d)', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const script = `
    const am = require(${JSON.stringify(path.join(__dirname, 'accountmove'))});
    am.start({ dir: '/acct/spare', names: ['al'] }, {
      moveRefusal: () => null,
      setAccount: () => ({ outcome: 'changed', account: { email: 'spare@example.com' } }),
      REFUSED: 'refused', forget: () => {}, RESTARTED: 'restarted',
      restartAsync: () => new Promise(() => {}),   // never answers
      hold: () => {}, release: () => {},
    });
  `;
  const r = spawnSync(process.execPath, ['-e', script], { timeout: 20000 });
  assert.equal(r.error, undefined, 'the process was still open after 20 s: a cap timer keeps it alive');
  assert.equal(r.status, 0, String(r.stderr));
});
