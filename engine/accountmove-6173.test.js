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
  const pending = new Map(), order = [], forgot = [], wrote = [];
  return {
    pending, order, forgot, wrote,
    setAccount: (name, dir) => {
      wrote.push([name, dir]);
      return refuse.includes(name) ? { outcome: REFUSED, because: `${name} cannot go there` } : { outcome: 'changed', account };
    },
    REFUSED,
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

  d.pending.get('al').resolve({ outcome: RESTARTED, steps: [] });
  await tick();
  assert.deepEqual(d.order, ['al', 'cy']);
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
  d.pending.get('bo').resolve({ outcome: 'refused', because: 'bo is being restarted by an account move right now, so we left it alone.' });
  await tick();
  d.pending.get('cy').resolve({ outcome: RESTARTED });
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'partial', 'changed'], 'only a RESTARTED is changed');
  assert.match(end.agents[0].because, /could not start it again: launchctl went away/);
  assert.match(end.agents[1].because, /could not start it again: bo is being restarted/);
  assert.equal(accountmove.busy(), false, 'the move ends, so the next one can run');
});

test('#6173: a move nobody started here is unknown (the board restarted): read answers null', () => {
  assert.equal(accountmove.read('not-a-move'), null);
});

test('#6173: a move with nothing to restart is done at once and holds nothing', () => {
  const out = accountmove.start({ dir: '/acct/spare', names: ['al', 'al'] }, deps({ refuse: ['al'] }));
  assert.equal(out.status, 202);
  assert.equal(out.body.done, true);
  assert.equal(out.body.agents.length, 1, 'a name given twice is moved once');
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
