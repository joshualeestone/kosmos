'use strict';

/**
 * #6214: stopping a running account move. Driven with its dependencies stated, as accountmove-6173.test.js is: what is
 * asserted is what a stop does with each agent (already restarted, mid-restart, not reached), what the person reads,
 * that a hand change made since the move is kept (Liu Kang m5659), and that nothing is left held.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const accountmove = require('./accountmove');

const REFUSED = 'refused-by-create';
const RESTARTED = 'restarted-by-remove';

/* Each agent's saved account lives in `saved`; setAccount and putBack write it, readAccount reads it. */
function deps({ saved = {}, putBackRefuses = [], unreadable = [] } = {}) {
  const pending = new Map(), order = [], held = new Set(), putBacks = [];
  const names = { '/acct/old': 'old@example.com', '/acct/new': 'new@example.com', '/acct/other': 'other@example.com' };
  return {
    pending, order, held, putBacks, saved,
    hold: (ns) => ns.forEach((n) => held.add(n)),
    release: (n) => held.delete(n),
    setAccount: (n, dir) => { saved[n] = dir; return { outcome: 'changed', account: { email: names[dir] } }; },
    readAccount: (n) => { if (unreadable.includes(n)) throw new Error('unreadable'); return n in saved ? saved[n] : null; },
    putBack: (n, dir) => {
      putBacks.push([n, dir]);
      if (putBackRefuses.includes(n)) return { outcome: REFUSED, because: 'that account is signed out' };
      saved[n] = dir;
      return { outcome: 'changed', account: { email: dir === null ? 'default@example.com' : names[dir] } };
    },
    REFUSED,
    forget: () => {},
    restartAsync: (n) => { order.push(n); return new Promise((resolve) => pending.set(n, resolve)); },
    RESTARTED,
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test.afterEach(() => accountmove.resetForTests());

test('#6214: a stop keeps the restarted result, lets the one mid-restart finish, and puts the rest back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old', di: null } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy', 'di'] }, d);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await tick();
  assert.deepEqual(d.order, ['al', 'bo'], 'bo is mid-restart');

  const s = accountmove.stop();
  assert.equal(s.status, 200);
  assert.equal(s.body.stopped, true);
  assert.equal(s.body.waitingFor, 'bo', 'the answer names the agent whose restart finishes first');
  assert.deepEqual(s.body.agents.map((a) => [a.name, a.outcome]),
    [['al', 'changed'], ['bo', 'pending'], ['cy', 'stopped'], ['di', 'stopped']]);
  assert.deepEqual(d.putBacks, [['cy', '/acct/old'], ['di', null]], 'only the unreached are put back, the default account as null');
  assert.equal(d.saved.cy, '/acct/old');
  assert.equal(d.saved.di, null);
  assert.equal(s.body.agents[2].because, 'you stopped the move before their turn. They stay on old@example.com.');
  assert.equal(s.body.agents[3].because, 'you stopped the move before their turn. They stay on default@example.com.');
  assert.equal(s.body.agents[2].account, undefined, 'a put-back agent does not carry the new account');
  assert.deepEqual([...d.held], ['bo'], 'the unreached are released at once; the one mid-restart keeps its hold');
  assert.equal(accountmove.busy(), true, 'the move still runs until the restart under way ends');

  d.pending.get('bo')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.order, ['al', 'bo'], 'nothing after the stop is restarted');
  const end = accountmove.read(out.body.id);
  assert.equal(end.done, true);
  assert.equal(end.stopped, true);
  assert.equal(end.waitingFor, undefined, 'a finished move waits for nobody');
  assert.deepEqual(end.agents.map((a) => a.outcome), ['changed', 'changed', 'stopped', 'stopped'], 'the mid-restart one ends as its restart said');
  assert.equal(d.held.size, 0, 'nothing is left held');
  assert.equal(accountmove.busy(), false, 'the board is released');
});

test('#6214 (Liu Kang m5659): an account changed by hand since the move saved it is kept, not put back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  d.saved.bo = '/acct/other';   // the person moved bo by hand while al restarted
  const s = accountmove.stop();
  assert.deepEqual(d.putBacks, [], 'no write over the hand change');
  assert.equal(d.saved.bo, '/acct/other');
  const bo = s.body.agents[1];
  assert.equal(bo.outcome, 'stopped');
  assert.equal(bo.because, 'you stopped the move before their turn, and their account had been changed since the move saved it, so we left it as it is now.');
  assert.equal(d.held.has('bo'), false);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.equal(accountmove.busy(), false);
});

test('#6214: a hand change back to the default account is a change too (null is not the move\'s account)', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  d.saved.bo = null;
  accountmove.stop();
  assert.deepEqual(d.putBacks, []);
  assert.equal(d.saved.bo, null);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
});

test('#6214: a put-back that is refused is said as saved and not restarted', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, putBackRefuses: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  const s = accountmove.stop();
  const bo = s.body.agents[1];
  assert.equal(bo.outcome, 'partial');
  assert.equal(bo.because, 'We saved new@example.com, but could not start it again: you stopped the move before its turn, and we could not put it back on its old account (that account is signed out). It is still on the old account until it restarts.');
  assert.equal(d.held.has('bo'), false);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
});

test('#6214: an agent whose account could not be read when the move saved it is not put back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, unreadable: ['bo'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  const s = accountmove.stop();
  assert.deepEqual(d.putBacks, []);
  assert.equal(s.body.agents[1].outcome, 'partial');
  assert.match(s.body.agents[1].because, /we could not put it back on its old account \(we could not read which account it was on\)\./);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
});

test('#6214: without readAccount (a caller that never wired it) a stop still ends the move and puts nothing back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  delete d.readAccount;
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  const s = accountmove.stop();
  assert.deepEqual(d.putBacks, []);
  assert.equal(s.body.agents[1].outcome, 'partial');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.equal(accountmove.busy(), false);
  assert.equal(d.held.size, 0);
});

test('#6214: a second stop changes nothing and says so; a stop with no move running is refused plainly', async () => {
  assert.deepEqual(accountmove.stop(), { status: 409, body: { outcome: 'refused', because: 'No account move is running.' } });
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  accountmove.stop();
  const again = accountmove.stop();
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.deepEqual(d.putBacks, [['bo', '/acct/old']], 'put back once');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.equal(accountmove.stop().status, 409, 'after the move ended, nothing is running');
});

test('#6214: a stop while the first agent restarts leaves only that one restarted', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  accountmove.stop();
  d.pending.get('al')({ outcome: 'partial', because: 'its launch job did not reload.', steps: [] });
  await out.done;
  assert.deepEqual(d.order, ['al']);
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'stopped', 'stopped']);
  assert.equal(d.held.size, 0);
});
