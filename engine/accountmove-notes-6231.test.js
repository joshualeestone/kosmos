'use strict';

/**
 * #6231 items 9 and 10 (follow-up to #6214): an agent a move leaves saved on the new account while it still runs on its
 * old one (its put-back after a stop failed, or the move ended before it reached it) gets #6174's note through
 * deps.leftOnOld, as a partial restart does; and a caller with no putBack is told so in its own words. Driven with the
 * dependencies stated, as accountmove-stop-6214.test.js is.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const accountmove = require('./accountmove');

const REFUSED = 'refused-by-create';
const RESTARTED = 'restarted-by-remove';

function deps({ saved = {}, putBackRefuses = [], noPutBack = false, noteThrows = false } = {}) {
  const pending = new Map(), noted = [];
  const d = {
    pending, noted, saved,
    moveRefusal: () => null,
    hold: () => {},
    release: () => {},
    setAccount: (n, dir) => { saved[n] = dir; return { outcome: 'changed', account: { email: 'new@example.com' } }; },
    readAccount: (n) => (n in saved ? saved[n] : null),
    putBack: (n, dir) => {
      if (putBackRefuses.includes(n)) return { outcome: REFUSED, because: 'that account is signed out' };
      saved[n] = dir;
      return { outcome: 'changed', account: { email: 'old@example.com' } };
    },
    REFUSED,
    forget: () => {},
    restartAsync: (n) => new Promise((resolve) => pending.set(n, resolve)),
    RESTARTED,
    leftOnOld: (n) => { noted.push(n); if (noteThrows) throw new Error('the note could not be written'); },
  };
  if (noPutBack) delete d.putBack;
  return d;
}
const tick = () => new Promise((r) => setImmediate(r));

test.afterEach(() => accountmove.resetForTests());

test('#6231 item 9: a stop whose put-back fails notes the agent as still on its old account; a put-back that works does not', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' }, putBackRefuses: ['cy'] });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  await tick();   // al is mid-restart
  const s = accountmove.stop();
  assert.deepEqual(s.body.agents.map((a) => [a.name, a.outcome]), [['al', 'pending'], ['bo', 'stopped'], ['cy', 'partial']]);
  assert.deepEqual(d.noted, ['cy'], 'only the agent whose put-back failed is noted');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.deepEqual(d.noted, ['cy'], 'the restarted agent is not noted (its own restart path notes or clears it)');
});

test('#6231 item 9: an agent changed by hand since the move is left as changed; noted unless the change put it back', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old', cy: '/acct/old' } });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo', 'cy'] }, d);
  await tick();
  d.saved.bo = '/acct/other';   // a person pointed bo at a third account while al restarts: it still runs on old
  d.saved.cy = '/acct/old';     // and cy back on the old one: nothing left over
  const s = accountmove.stop();
  assert.deepEqual(s.body.agents.map((a) => a.outcome), ['pending', 'stopped', 'stopped']);
  assert.equal(d.saved.bo, '/acct/other', 'the hand change was overwritten');
  assert.deepEqual(d.noted, ['bo'], 'only the agent saved on another account and never restarted is noted');
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
});

test('#6231 item 9: a move that ends before reaching agents notes each of them', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  d.moveCapMs = 0;   // the move's time is up before its first restart
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await out.done;
  const end = accountmove.read(out.body.id);
  assert.deepEqual(end.agents.map((a) => a.outcome), ['partial', 'partial']);
  assert.deepEqual(d.noted, ['al', 'bo'], 'an agent the move never reached was not noted');
});

test('#6231 item 9: a note that throws does not change the move or its answer', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, putBackRefuses: ['bo'], noteThrows: true });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  const s = accountmove.stop();
  assert.equal(s.status, 200);
  assert.equal(s.body.agents[1].outcome, 'partial');
  assert.match(s.body.agents[1].because, /could not put it back on its old account \(that account is signed out\)/);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
  assert.equal(accountmove.busy(), false, 'the move did not end');
});

test('#6231 item 10: a caller with no putBack is told so in its own words, and the agent is noted', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' }, noPutBack: true });
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  const s = accountmove.stop();
  assert.equal(s.body.agents[1].outcome, 'partial');
  assert.match(s.body.agents[1].because, /\(this Kosmos cannot put an agent back on its old account\)/);
  assert.doesNotMatch(s.body.agents[1].because, /could not read which account/, 'the missing put-back still reads as an unreadable account');
  assert.deepEqual(d.noted, ['bo']);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
});

test('#6231 item 9: a move whose hold fails notes every agent it saved (none is restarted)', () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  d.hold = () => { throw new Error('the hold could not be taken'); };
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  assert.deepEqual(out.body.agents.map((a) => a.outcome), ['partial', 'partial']);
  assert.deepEqual(d.noted, ['al', 'bo'], 'agents saved but never restarted were not noted');
});

test('#6231 item 10: a caller with no readAccount is told so in its own words', async () => {
  const d = deps({ saved: { al: '/acct/old', bo: '/acct/old' } });
  delete d.readAccount;
  const out = accountmove.start({ dir: '/acct/new', names: ['al', 'bo'] }, d);
  await tick();
  const s = accountmove.stop();
  assert.match(s.body.agents[1].because, /\(this Kosmos cannot read which account an agent was on\)/);
  d.pending.get('al')({ outcome: RESTARTED, steps: [] });
  await out.done;
});
